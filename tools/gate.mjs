#!/usr/bin/env node
/**
 * Ratchet gate: existing debt does not block, growth does.
 *
 * Two checks in this repository are red with a large backlog -- the deep
 * module boundary carries hundreds of private `rules/v2` imports, and the unit
 * suite carries dozens of failures. Wiring either as a zero-tolerance gate
 * would make every run red, which is the same as having no gate: the signal
 * people actually need is "did this change make it worse", and a permanently
 * red check cannot answer that.
 *
 * So each metric is compared against a committed baseline. A count-based
 * ratchet is easy to satisfy dishonestly -- fix one failure, break another,
 * and the total is unchanged -- so the baseline records the exact violations
 * and failing test names instead. Any name not already in the baseline fails
 * the gate; names that disappear are reported as fixed. `--update` writes the
 * intersection, so it can only ever remove entries: a regression has to be
 * fixed, never recorded.
 *
 *   node tools/gate.mjs                  # report
 *   node tools/gate.mjs --check          # exit 1 if any metric grew
 *   node tools/gate.mjs --with-tests     # also run the unit suite (slow)
 *   node tools/gate.mjs --with-gates     # also run every test a SPEC declares as a gate
 *   node tools/gate.mjs --update         # lower improved baselines
 *
 * Declared gates are ratcheted per file and failing test name: a red gate that
 * is not in the baseline fails the check even when it was just declared, so a
 * clause can never be "covered" by a test nobody has seen pass.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverTests, selectTests } from "../tests/config/suites.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, ".gate-baseline.json");

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);

/** Checks exported by tools/check-modules.mjs. The repository-specific guards
 *  it also runs are not exported, so they stay covered by `npm run
 *  module:check` alone -- this gate never claims to cover them. */
const MODULE_CHECKS = [
  "assertRulesPublicSurface",
  "assertImportBoundaries",
  "assertRulesShapeVocabulary",
  "assertSingleRulesAuthority",
  "assertNoModuleScopeEffects",
  "assertStaticRagInputs",
  "assertStructuredProductionLogging",
];

async function measureModules() {
  const cm = await import("./check-modules.mjs");
  const out = {};
  for (const name of MODULE_CHECKS) {
    try {
      cm[name](ROOT);
      out[name] = [];
    } catch (err) {
      // Each check throws assert.deepEqual(violations, [], `<title>:\n<list>`),
      // so the message carries the violation list itself -- counting it beats
      // re-implementing the rule and letting the two definitions drift. Node
      // then appends its own `+ [ … ] - []` diff, which repeats every entry, so
      // the list ends at the first diff marker.
      const lines = String(err?.message ?? "").split("\n").slice(1);
      const end = lines.findIndex((l) => /^\s*[+-]\s/.test(l));
      const violations = (end === -1 ? lines : lines.slice(0, end)).filter((l) => l.trim());
      out[name] = violations.map((l) => l.trim());
    }
  }
  return out;
}

function measureSpec() {
  try {
    const raw = execFileSync("node", [join(ROOT, "tools/spec-trace.mjs"), "--json"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20,
    });
    const findings = JSON.parse(raw).findings ?? [];
    return findings.filter((f) => f.severity === "error").length;
  } catch {
    return Number.NaN;  // NaN never compares below a baseline, so it fails loudly
  }
}

/** Runs node test files once and attributes each failing test to its file.
 *  Node's spec reporter marks a failing test and every ancestor with ✖, so the
 *  names come from the trailing "failing tests:" list, where each entry is
 *  preceded by its `test at <file>:<line>:<column>` origin. */
function runNodeTests(files) {
  if (files.length === 0) return { reported: true, byFile: new Map() };
  let out = "";
  try {
    out = execFileSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", ...files], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    out = `${err?.stdout ?? ""}${err?.stderr ?? ""}`;
  }
  if (!/^ℹ fail \d+$/m.test(out)) return { reported: false, byFile: new Map() };  // the suite never reported
  const byFile = new Map();
  const start = out.lastIndexOf("failing tests:");
  if (start === -1) return { reported: true, byFile };
  let file = "(unknown file)";
  for (const raw of out.slice(start).split("\n")) {
    const line = raw.trim();
    const at = /^test at (.+?):\d+:\d+$/.exec(line);
    if (at) { file = at[1]; continue; }
    if (!line.startsWith("✖ ") || line.startsWith("✖ failing tests")) continue;
    const title = line.slice(2).replace(/ \([0-9.]+ms\)$/, "").trim();
    if (!title) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    if (!byFile.get(file).includes(title)) byFile.get(file).push(title);
  }
  return { reported: true, byFile };
}

/** Runs Worker (Durable Object) test files under the test worker config and
 *  reads vitest's JSON report; a suite that failed to load counts as one
 *  failure of its own so a broken import can never look green. */
function runWorkerTests(files) {
  if (files.length === 0) return { reported: true, byFile: new Map() };
  const output = join(mkdtempSync(join(tmpdir(), "zhuwei-gates-")), "vitest.json");
  try {
    execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/config/worker.config.ts",
      "--reporter=json", `--outputFile=${output}`, ...files], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // A failing suite exits non-zero; the report still names each failing test.
  }
  if (!existsSync(output)) return { reported: false, byFile: new Map() };
  const report = JSON.parse(readFileSync(output, "utf8"));
  const byFile = new Map(files.map((file) => [file, null]));
  for (const result of report.testResults ?? []) {
    const file = relative(ROOT, result.name).replaceAll("\\", "/");
    const failed = (result.assertionResults ?? []).filter((a) => a.status === "failed").map((a) => a.title);
    byFile.set(file, result.status === "failed" && failed.length === 0 ? ["(suite did not run)"] : failed);
  }
  for (const [file, value] of byFile) if (value === null) byFile.set(file, ["(suite did not report)"]);
  return { reported: true, byFile };
}

function nodeSuiteFiles() {
  return selectTests(discoverTests(ROOT), { suite: "node" }).map((entry) => entry.file);
}

function measureUnitTests(run) {
  if (!run.reported) return null;  // fail loudly
  return [...new Set([...run.byFile.values()].flat())];
}

/** Every test file a SPEC declares as a gate, with the specs declaring it.
 *  spec-trace already parses the frontmatter; asking it keeps one parser. */
function declaredGates() {
  const raw = execFileSync("node", [join(ROOT, "tools/spec-trace.mjs"), "--json"], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20,
  });
  const gates = new Map();
  for (const entry of JSON.parse(raw).coverage ?? []) {
    for (const gate of entry.gates ?? []) {
      if (!gates.has(gate)) gates.set(gate, []);
      gates.get(gate).push(entry.spec);
    }
  }
  return gates;
}

/** Failing test names per declared gate file. `nodeRun` is the unit-suite run
 *  when --with-tests already produced one, so node gates are not run twice. */
function measureGates(nodeRun) {
  const declared = declaredGates();
  const known = new Map(discoverTests(ROOT).map((entry) => [entry.file, entry]));
  const failures = {};
  const tools = [];
  const skipped = [];
  const nodeFiles = [];
  const workerFiles = [];
  for (const file of declared.keys()) {
    const entry = known.get(file);
    if (entry === undefined) {
      if (file.startsWith("tools/")) tools.push(file);
      else failures[file] = ["(declared gate is not a test file)"];
      continue;
    }
    if (entry.suite === "http" && !existsSync(join(ROOT, "dist/server/index.js"))) { skipped.push(file); continue; }
    if (entry.suite === "worker") workerFiles.push(file);
    else nodeFiles.push(file);
  }
  const node = nodeRun ?? runNodeTests(nodeFiles);
  for (const file of nodeFiles) failures[file] = node.reported ? (node.byFile.get(file) ?? []) : ["(suite did not report)"];
  const worker = runWorkerTests(workerFiles);
  for (const file of workerFiles) failures[file] = worker.reported ? (worker.byFile.get(file) ?? []) : ["(suite did not report)"];
  return { failures, declared, tools, skipped };
}

/** Per-selection proposal request size, ratcheted decrease-only by user
 *  ruling on 2026-09-20. One entry per selection rather than a total, so cost
 *  moving between capabilities cannot hide. Runs out of process because the
 *  measurement imports TypeScript. */
function measureRequestSize() {
  try {
    const raw = execFileSync("node", ["--import", "tsx",
      join(ROOT, "tools/measure-vnext-proposal-request-size.mjs"), "--json"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 8 << 20, stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(raw);
  } catch {
    return null;  // could not measure: fails against any baseline
  }
}

function measureDocLinks() {
  try {
    const raw = execFileSync("node", [join(ROOT, "tools/check-doc-links.mjs"), "--json"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 32 << 20,
    });
    return JSON.parse(raw);
  } catch {
    return null;  // could not measure: fails against any baseline
  }
}

async function main() {
  const baseline = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, "utf8"))
    : { spec: { errors: 0 }, modules: {}, tests: {} };

  const actual = {
    spec: { errors: measureSpec() },
    docs: { brokenLinks: measureDocLinks() },
    modules: await measureModules(),
    requestSize: measureRequestSize() ?? { unmeasured: null },
    tests: {},
  };
  const nodeRun = flag("--with-tests") ? runNodeTests(nodeSuiteFiles()) : null;
  if (flag("--with-tests")) actual.tests = { unitFailures: measureUnitTests(nodeRun) };
  const gates = flag("--with-gates") ? measureGates(nodeRun) : null;
  if (gates) actual.gates = gates.failures;

  const rows = [];
  const walk = (group, actuals) => {
    for (const [key, value] of Object.entries(actuals)) {
      const base = baseline[group]?.[key];
      const list = Array.isArray(value);
      const baseList = Array.isArray(base);
      rows.push({
        group, key, value, base: base === undefined ? null : base,
        // A name present now and absent from the baseline is a regression; the
        // reverse is progress. Numeric metrics keep the simple comparison.
        added: list && baseList ? value.filter((v) => !base.includes(v)) : [],
        fixed: list && baseList ? base.filter((v) => !value.includes(v)) : [],
        count: list ? value.length : value,
        baseCount: base === undefined ? null : baseList ? base.length : base,
      });
    }
  };
  walk("spec", actual.spec);
  walk("docs", actual.docs);
  walk("modules", actual.modules);
  walk("requestSize", actual.requestSize);
  walk("tests", actual.tests);
  if (actual.gates) walk("gates", actual.gates);

  const broke = (r) => {
    // A declared gate must have been seen green: red with no baseline fails.
    if (r.group === "gates" && r.base === null) return Array.isArray(r.value) && r.value.length > 0;
    if (r.base === null) return false;
    if (r.value === null) return true;                       // could not measure
    if (Array.isArray(r.value)) return r.added.length > 0;
    return Number.isNaN(r.value) || r.value > r.base;
  };
  const worse = rows.filter(broke);
  const better = rows.filter((r) => r.base !== null && (Array.isArray(r.value)
    ? r.fixed.length > 0 && r.added.length === 0
    : r.value < r.base));
  const unseen = rows.filter((r) => r.base === null);

  const W = (s, n) => String(s).padEnd(n);
  console.log(`\n闸门基线对照  (${BASELINE.replace(`${ROOT}/`, "")})\n`);
  console.log(`${W("指标", 42)}${W("当前", 8)}${W("基线", 8)}状态`);
  console.log("─".repeat(72));
  for (const r of rows) {
    if (r.group === "gates" && r.count === 0 && !(r.baseCount > 0)) continue;  // green gates stay quiet
    // 22 selections would drown the report. Level ones are summarised below;
    // only a selection that grew or shrank prints its own row.
    if (r.group === "requestSize" && r.base !== null && r.value === r.base) continue;
    const mark = r.base === null ? "新增"
      : r.value === null ? "无法测量"
      : broke(r) && Array.isArray(r.value) ? `✗ 新增 ${r.added.length || "?"} 项`
      : broke(r) ? "✗ 变差"
      : Array.isArray(r.value) ? (r.fixed.length ? `↓ 修好 ${r.fixed.length} 项` : "= 持平")
      : r.value < r.base ? "↓ 改善" : r.value > r.base ? "✗ 变差" : "= 持平";
    const label = `${r.group}.${r.key}`;
    console.log(W(label.length > 41 ? `${label.slice(0, 38)}...` : label, 42)
      + W(r.count ?? "?", 8) + W(r.baseCount ?? "—", 8) + mark);
  }

  const sizes = rows.filter((r) => r.group === "requestSize" && r.base !== null);
  if (sizes.length && sizes.every((r) => r.value === r.base)) {
    const worst = sizes.reduce((a, b) => (b.value > a.value ? b : a));
    console.log(W("requestSize（22 项选择）", 42) + W("", 8) + W("", 8)
      + `= 全部持平，最高 ${worst.key} ${worst.value}`);
  }

  if (!flag("--with-tests")) console.log("\n（未跑单测：加 --with-tests）");
  if (gates) {
    const files = Object.keys(gates.failures);
    const green = files.filter((f) => gates.failures[f].length === 0).length;
    console.log(`\n声明的门：${files.length} 个测试文件已运行，${green} 个全绿，${files.length - green} 个有失败用例`
      + (gates.skipped.length ? `；${gates.skipped.length} 个 HTTP 门未运行（需要 dist 构建）` : "")
      + (gates.tools.length ? `；${gates.tools.length} 个工具门不在此运行（${gates.tools.join("、")}）` : ""));
    for (const f of files.filter((f) => gates.failures[f].length > 0)) {
      console.log(`  ${f}  ← SPEC ${gates.declared.get(f).join("、")}`);
    }
  } else console.log("（未跑声明的门：加 --with-gates）");
  if (better.length) {
    console.log(`\n${better.length} 项已改善，可用 --update 收紧基线：`);
    for (const r of better) console.log(`  ${r.group}.${r.key}  ${r.baseCount} → ${r.count}`);
  }
  if (unseen.length) console.log(`\n${unseen.length} 项没有基线，用 --update 记录当前值`);
  if (worse.length) {
    console.log(`\n✗ ${worse.length} 项超出基线：`);
    for (const r of worse) {
      console.log(`  ${r.group}.${r.key}  基线 ${r.baseCount}，当前 ${r.count ?? "无法测量"}`);
      // A gate with no baseline yet lists every failing case: nothing is "added".
      const listed = r.added.length || !Array.isArray(r.value) ? r.added : r.value;
      for (const a of listed.slice(0, 10)) console.log(`      + ${a}`);
      if (listed.length > 10) console.log(`      + …其余 ${listed.length - 10} 项`);
    }
  }

  if (flag("--update")) {
    const next = JSON.parse(JSON.stringify(baseline));
    for (const r of rows) {
      if (r.value === null || Number.isNaN(r.value)) continue;
      next[r.group] ??= {};
      const current = next[r.group][r.key];
      // Only ever tightens. A first record takes the current state; afterwards
      // the intersection drops what is fixed and refuses to adopt what is new.
      if (current === undefined) next[r.group][r.key] = r.value;
      else if (Array.isArray(r.value) && Array.isArray(current)) {
        // Multiset intersection. One file can import the same private module
        // from two statements, so the same violation text legitimately repeats;
        // a membership test would keep every copy forever and leave the
        // baseline permanently looser than reality once one of them is fixed.
        const remaining = new Map();
        for (const v of r.value) remaining.set(v, (remaining.get(v) ?? 0) + 1);
        next[r.group][r.key] = current.filter((v) => {
          const left = remaining.get(v) ?? 0;
          if (left === 0) return false;
          remaining.set(v, left - 1);
          return true;
        });
      } else if (!Array.isArray(r.value) && !Array.isArray(current)) {
        next[r.group][r.key] = Math.min(current, r.value);
      } else next[r.group][r.key] = r.value;  // format change: adopt the new shape
    }
    for (const key of Object.keys(next.gates ?? {})) {
      if (!(key in (actual.gates ?? {})) && !existsSync(join(ROOT, key))) delete next.gates[key];
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\n基线已写入 ${BASELINE.replace(`${ROOT}/`, "")}（只收紧，不放宽）`);
  }

  console.log("");
  if (flag("--check") && worse.length) process.exit(1);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
