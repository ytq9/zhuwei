#!/usr/bin/env node
/**
 * Spec/code drift report.
 *
 * The traceability matrix used to be maintained by hand, which means it began
 * to lie on the first commit that changed code without changing it, and lied
 * silently. This derives the same relation from two sources that cannot drift
 * from the thing they describe: the frontmatter each spec declares about
 * itself, and the `SPEC NNNN` citations that already exist in 56 files under
 * worker/, app/, tests/ and tools/.
 *
 * A finding is an error only when something is provably inconsistent -- a
 * citation to a spec or clause that does not exist, a supersession recorded on
 * one side only. Everything that is merely unproven (a clause no test gates, a
 * spec no code cites) is a warning, because "not yet" and "wrong" are
 * different facts and a report that conflates them gets ignored.
 *
 *   node tools/spec-trace.mjs            # human report
 *   node tools/spec-trace.mjs --check    # exit 1 if any error
 *   node tools/spec-trace.mjs --json     # machine output
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SPECS_DIR = join(ROOT, "docs/specs");
const ADR_DIR = join(ROOT, "docs/adr");
const CITING_ROOTS = ["worker", "app", "tests", "tools", "db"];
const CODE_EXT = /\.(ts|tsx|mts|mjs|js|jsx|sql)$/;

/** Per-spec reading budget, in CJK-ish characters. A spec that cannot be loaded
 *  beside the code it governs cannot govern it; this project's own proposal
 *  input gate is 58k tokens. */
const CHAR_BUDGET = 8000;

const findings = [];
const add = (severity, code, subject, message, detail) =>
  findings.push({ severity, code, subject, message, ...(detail ? { detail } : {}) });

// ---------------------------------------------------------------- frontmatter

/** Parses exactly the YAML subset tools/add-frontmatter emits: scalars, inline
 *  string arrays, and lists of two-key objects. Deliberately not a YAML
 *  implementation -- an unparseable field is reported, never guessed. */
function parseFrontmatter(src, subject) {
  if (!src.startsWith("---\n")) return null;
  const end = src.indexOf("\n---\n", 3);
  if (end === -1) {
    add("error", "frontmatter-unterminated", subject, "frontmatter 缺少结束的 ---");
    return null;
  }
  const body = src.slice(4, end);
  const out = {};
  let listKey = null;
  let item = null;
  const unquote = (v) => {
    const t = v.trim();
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
      return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return t;
  };
  for (const raw of body.split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const listScalar = raw.match(/^  - (?!\w+:)(.*)$/);
    const listStart = raw.match(/^  - (\w+): (.*)$/);
    const listCont = raw.match(/^    (\w+): (.*)$/);
    const scalar = raw.match(/^(\w+): ?(.*)$/);
    if (listScalar && listKey) {
      out[listKey].push(unquote(listScalar[1]));
      item = null;
    } else if (listStart && listKey) {
      item = { [listStart[1]]: unquote(listStart[2]) };
      out[listKey].push(item);
    } else if (listCont && item) {
      item[listCont[1]] = unquote(listCont[2]);
    } else if (scalar) {
      const [, key, rawVal] = scalar;
      listKey = null;
      item = null;
      const val = rawVal.trim();
      if (val === "") {
        out[key] = [];
        listKey = key;
      } else if (val.startsWith("[")) {
        const inner = val.slice(1, -1).trim();
        out[key] = inner ? inner.split(",").map(unquote) : [];
      } else if (val === "true" || val === "false") {
        out[key] = val === "true";
      } else {
        out[key] = unquote(val);
      }
    }
  }
  return out;
}

/** `## 7. Title` and `### 7.2 Title` are clauses; the H1 and unnumbered
 *  headings are not. `### 0.4 ...` counts -- 0013 uses it for the reset. */
function parseClauses(src) {
  const clauses = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^(#{2,4})\s+(\d+(?:\.\d+)*)[.．、]?\s+(.*)$/);
    if (m) clauses.push({ id: m[2], title: m[3].trim(), depth: m[1].length });
  }
  return clauses;
}

const specFiles = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".md"));
const specs = new Map(); // "0001" -> record
const annexes = [];

for (const file of specFiles) {
  const path = join(SPECS_DIR, file);
  const src = readFileSync(path, "utf8");
  const rel = relative(ROOT, path);
  const fm = parseFrontmatter(src, rel);
  if (!fm) {
    add("error", "frontmatter-missing", rel, "没有 frontmatter，无法参与追踪");
    continue;
  }
  if ((fm.kind ?? "spec") === "annex") {
    annexes.push({ rel, fm });
    continue;
  }
  if (!fm.spec) {
    add("error", "frontmatter-invalid", rel, "kind: spec 但缺少 spec 编号");
    continue;
  }
  if (specs.has(fm.spec)) {
    add("error", "duplicate-spec-id", rel, `SPEC ${fm.spec} 已由 ${specs.get(fm.spec).rel} 占用`);
    continue;
  }
  const chars = src.replace(/\s/g, "").length;
  specs.set(fm.spec, { rel, file, fm, src, clauses: parseClauses(src), chars, citedBy: new Map() });
}

// -------------------------------------------------------- declared references

const adrIds = new Set(
  existsSync(ADR_DIR)
    ? readdirSync(ADR_DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, 4))
    : [],
);

for (const [id, s] of specs) {
  const { fm } = s;
  if (!["frozen", "ruled", "superseded"].includes(fm.status ?? "")) {
    add("error", "bad-status", s.rel, `status "${fm.status}" 不在 frozen|ruled|superseded 中`);
  }
  for (const dep of fm.depends_on ?? []) {
    if (!specs.has(dep)) add("error", "broken-ref", s.rel, `depends_on 指向不存在的 SPEC ${dep}`);
  }
  for (const a of fm.adr ?? []) {
    if (!adrIds.has(a)) add("error", "broken-ref", s.rel, `adr 指向不存在的 ADR ${a}`);
  }
  // Supersession must be recorded on both sides, or one side silently keeps
  // claiming authority it no longer has. Range forms ("0003..0013") are the
  // 0002 wholesale case and are checked loosely.
  for (const r of fm.supersedes ?? []) {
    if (r.spec.includes("..")) continue;
    const target = specs.get(r.spec);
    if (!target) {
      add("error", "broken-ref", s.rel, `supersedes 指向不存在的 SPEC ${r.spec}`);
      continue;
    }
    const back = (target.fm.superseded_by ?? []).some((b) => b.spec === id || b.spec.includes(".."));
    if (!back) {
      add("error", "asymmetric-supersession", s.rel,
        `声明取代 SPEC ${r.spec}，但 ${target.file} 的 superseded_by 未记录 ${id}`);
    }
  }
  for (const r of fm.superseded_by ?? []) {
    if (r.spec.includes("..")) continue;
    const source = specs.get(r.spec);
    if (!source) {
      add("error", "broken-ref", s.rel, `superseded_by 指向不存在的 SPEC ${r.spec}`);
      continue;
    }
    if (!(source.fm.supersedes ?? []).some((b) => b.spec === id)) {
      add("error", "asymmetric-supersession", s.rel,
        `声明被 SPEC ${r.spec} 取代，但 ${source.file} 的 supersedes 未记录 ${id}`);
    }
  }
  for (const g of fm.gates ?? []) {
    if (!existsSync(join(ROOT, g))) {
      add("error", "missing-gate-file", s.rel, `gates 声明的 ${g} 不存在`);
    }
  }
  if (s.chars > CHAR_BUDGET) {
    add("warn", "oversize", s.rel,
      `${s.chars} 字，超出每份 ${CHAR_BUDGET} 字预算 ${Math.round((s.chars / CHAR_BUDGET - 1) * 100)}%`);
  }
}

// --------------------------------------------------- prose header duplication

/** Header list items that a frontmatter field now also carries. Until the
 *  prose copies are removed the two can disagree, so the list is reported and
 *  is meant to shrink to zero. */
const HEADER_FIELDS = [
  [/^- 状态：/, "status / status_detail"],
  [/^- (裁定|批准|起草)日期：/, "ruled_on / drafted_on"],
  [/^- .*修订日期：/, "revisions"],
  [/^- 上位(与协作)?规格：/, "depends_on"],
  [/^- 取代范围：/, "supersedes"],
  [/^- 替代规格：/, "superseded_by"],
  [/^- ADR：/, "adr"],
  [/^- 范围：/, "scope"],
];

for (const [, s] of specs) {
  const afterFm = s.src.slice(s.src.indexOf("\n---\n") + 5);
  const head = afterFm.split(/\n## /)[0];
  const dupes = [];
  for (const line of head.split("\n")) {
    for (const [re, field] of HEADER_FIELDS) {
      if (re.test(line.trim())) dupes.push(`${line.trim().slice(0, 28)}… → ${field}`);
    }
  }
  if (dupes.length) {
    add("warn", "duplicated-header", s.rel,
      `${dupes.length} 行散文头部与 frontmatter 重复，应删散文保 frontmatter`, dupes);
  }
}

// ------------------------------------------------------------ citation scan

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (CODE_EXT.test(e.name)) out.push(p);
  }
  return out;
}

const SELF = relative(ROOT, new URL(import.meta.url).pathname);
const codeFiles = CITING_ROOTS.flatMap((r) => walk(join(ROOT, r)))
  .filter((p) => relative(ROOT, p) !== SELF);

/** `SPEC 0013 §7.1`, `SPEC 0015 6.1`, `SPEC 0001 section 8`, `SPEC 0001 21.I`,
 *  `SPEC 0013 F04`, `SPEC-0015`, and `§§3.3、7、12` continuations. */
const CITE = /SPEC[ _-]?(\d{4})(?:\s*(?:§§?|sections?\s+)?\s*([\d]+(?:\.[\dA-Z]+)?|[A-Z]\d{2}))?/g;

for (const path of codeFiles) {
  const rel = relative(ROOT, path);
  const src = readFileSync(path, "utf8");
  for (const m of src.matchAll(CITE)) {
    const id = m[1];
    const clause = m[2];
    const spec = specs.get(id);
    if (!spec) {
      add("error", "dangling-citation", rel, `引用了不存在的 SPEC ${id}`);
      continue;
    }
    if (!spec.citedBy.has(rel)) spec.citedBy.set(rel, new Set());
    if (clause) spec.citedBy.get(rel).add(clause);

    if (spec.fm.status === "superseded") {
      add("error", "superseded-cited", rel,
        `引用了已被取代的 SPEC ${id}，应改指取代它的规格`);
    }
    if (!clause) continue;
    // Numeric refs must match a heading. Letter-labelled items (F04, 21.I,
    // B23) are labels inside a clause, so check they appear in the text.
    const letterItem = clause.match(/^(\d+)\.([A-Z])$/);
    if (/^\d+(\.\d+)?$/.test(clause)) {
      const known = spec.clauses.some((c) => c.id === clause || c.id.startsWith(`${clause}.`));
      if (!known) {
        add("error", "unknown-clause", rel, `SPEC ${id} 没有 §${clause} 这一节`);
      }
    } else if (letterItem) {
      const [, section, item] = letterItem;
      if (!spec.clauses.some((c) => c.id === section)) {
        add("error", "unknown-clause", rel, `SPEC ${id} 没有 §${section} 这一节`);
      } else if (!new RegExp(`^#{2,4}\\s+${item}[.．、]`, "m").test(spec.src)) {
        add("error", "unknown-clause", rel, `SPEC ${id} §${section} 没有 ${item} 项`);
      }
    } else if (!spec.src.includes(clause)) {
      add("error", "unknown-clause", rel, `SPEC ${id} 正文中找不到条目 ${clause}`);
    }
  }
}

// ------------------------------------------------------------ coverage + age

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 << 20,
    });
  } catch { return null; }
};

/** Epoch ms of the file's last commit. ISO offsets do not compare as strings,
 *  so every date in this report is parsed, never sliced. */
const gitDate = (p) => {
  const out = git("log", "-1", "--format=%cI", "--", p)?.trim();
  return out ? Date.parse(out) : null;
};

const stripFrontmatter = (text) => {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 3);
  return end === -1 ? text : text.slice(end + 5);
};

/** Epoch ms of the last commit that changed a spec's BODY.
 *
 *  A bulk metadata commit -- the one that introduced this frontmatter, or any
 *  later `gates:` edit -- touches every spec file without touching a single
 *  normative sentence. Dating staleness from `git log -1` would age every
 *  spec's gates at once and report them all as stale, which is how a check
 *  teaches people to ignore it. So walk the file's history and return the
 *  newest commit whose content differs from its parent once frontmatter is
 *  removed. */
const BODY_HISTORY_LIMIT = 60;
const gitBodyDate = (p) => {
  const log = git("log", `-${BODY_HISTORY_LIMIT}`, "--format=%H %cI", "--", p)?.trim();
  if (!log) return null;
  const commits = log.split("\n").map((l) => {
    const [sha, iso] = l.split(" ");
    return { sha, ms: Date.parse(iso) };
  });
  for (const c of commits) {
    const now = git("show", `${c.sha}:${p}`);
    const before = git("show", `${c.sha}^:${p}`);
    // No parent version: the commit that created the file is substantive.
    if (before === null) return c.ms;
    if (stripFrontmatter(now ?? "") !== stripFrontmatter(before)) return c.ms;
  }
  return commits.at(-1)?.ms ?? null;
};

for (const [id, s] of specs) {
  const normative = s.fm.status !== "superseded" && s.fm.normative !== false;
  if (!normative) continue;

  if (s.citedBy.size === 0) {
    add("warn", "uncited", s.rel, `没有任何代码或测试引用 SPEC ${id}：未实现或未验收`);
  }
  const gates = s.fm.gates ?? [];
  if (gates.length === 0) {
    add("warn", "ungated", s.rel, `gates 为空：没有声明权威验收门`);
    continue;
  }
  // A clause edited after every one of its gates last ran means the gate is
  // green against text that no longer exists.
  const specDate = gitBodyDate(s.rel);
  const gateDates = gates.map((g) => gitDate(g)).filter(Boolean);
  if (specDate && gateDates.length && gateDates.every((d) => d < specDate)) {
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    add("warn", "stale-gate", s.rel,
      `正文改于 ${day(specDate)}，但所有 gates 的最后改动都更早（最新 ${day(Math.max(...gateDates))}）：门可能在守旧文本`);
  }
}

// ------------------------------------------------------------------- output

if (process.argv.includes("--suggest-gates")) {
  console.log("\n每份未声明 gates 的规格，及引用它的测试/探针候选：\n");
  for (const [id, s] of [...specs].sort()) {
    if (s.fm.status === "superseded" || (s.fm.gates ?? []).length) continue;
    const cand = [...s.citedBy.keys()].filter((f) => /^(tests|tools)\//.test(f));
    console.log(`SPEC ${id}  ${s.fm.title}`);
    if (!cand.length) console.log("  （无测试或探针引用本规格）");
    for (const c of cand) console.log(`  - ${c}`);
    console.log("");
  }
  process.exit(0);
}

const errors = findings.filter((f) => f.severity === "error");
const warns = findings.filter((f) => f.severity === "warn");
const args = process.argv.slice(2);

if (args.includes("--json")) {
  const coverage = [...specs.entries()].map(([id, s]) => ({
    spec: id, status: s.fm.status, chars: s.chars,
    gates: s.fm.gates ?? [],
    citedBy: [...s.citedBy.keys()],
    clauses: s.clauses.length,
    clausesCited: [...new Set([...s.citedBy.values()].flatMap((v) => [...v]))].sort(),
  }));
  console.log(JSON.stringify({ coverage, findings }, null, 2));
} else {
  const W = (n, w) => String(n).padEnd(w);
  console.log(`\nSPEC 追踪报告 — ${specs.size} 份规格，${annexes.length} 份附件，扫描 ${codeFiles.length} 个代码文件\n`);
  console.log(`${W("SPEC", 6)}${W("状态", 12)}${W("字数", 8)}${W("节", 5)}${W("引用文件", 10)}${W("被引条款", 10)}gates`);
  console.log("─".repeat(74));
  for (const [id, s] of [...specs].sort()) {
    const clausesCited = new Set([...s.citedBy.values()].flatMap((v) => [...v]));
    console.log(
      W(id, 6) + W(s.fm.status, 12) + W(s.chars, 8) + W(s.clauses.length, 5) +
      W(s.citedBy.size, 10) + W(`${clausesCited.size}/${s.clauses.length}`, 10) +
      (s.fm.gates?.length ? s.fm.gates.length : "—"),
    );
  }

  const group = (list) => {
    const by = new Map();
    for (const f of list) {
      if (!by.has(f.code)) by.set(f.code, []);
      by.get(f.code).push(f);
    }
    return [...by].sort((a, b) => b[1].length - a[1].length);
  };

  for (const [label, list] of [["错误", errors], ["警告", warns]]) {
    if (!list.length) continue;
    console.log(`\n${label} (${list.length})`);
    console.log("─".repeat(74));
    for (const [code, items] of group(list)) {
      console.log(`\n  ${code} × ${items.length}`);
      for (const f of items.slice(0, 8)) {
        console.log(`    ${f.subject}\n      ${f.message}`);
        for (const d of (f.detail ?? []).slice(0, 4)) console.log(`        · ${d}`);
        if ((f.detail ?? []).length > 4) console.log(`        · …${f.detail.length - 4} 行未列`);
      }
      if (items.length > 8) console.log(`    …其余 ${items.length - 8} 条，用 --json 查看`);
    }
  }
  console.log(`\n合计：${errors.length} 错误，${warns.length} 警告\n`);
}

if (args.includes("--check") && errors.length) process.exit(1);
