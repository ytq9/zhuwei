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
 *   node tools/gate.mjs --update         # lower improved baselines
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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

function measureUnitTests() {
  let out = "";
  try {
    out = execFileSync("npx", ["tsx", "--test", "tests/*.test.mjs"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    out = `${err?.stdout ?? ""}${err?.stderr ?? ""}`;
  }
  if (!/^ℹ fail \d+$/m.test(out)) return null;  // the suite never reported: fail loudly
  // Node's spec reporter marks a failing test and every ancestor with ✖, so the
  // names are taken from the trailing "failing tests:" list instead.
  const start = out.lastIndexOf("failing tests:");
  if (start === -1) return [];  // the suite reported, and nothing failed
  const tail = out.slice(start);
  return [...new Set(
    tail.split("\n")
      .filter((l) => l.startsWith("✖ "))
      .map((l) => l.slice(2).replace(/ \([0-9.]+ms\)$/, "").trim())
      .filter(Boolean),
  )];
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, "utf8"))
  : { spec: { errors: 0 }, modules: {}, tests: {} };

const actual = { spec: { errors: measureSpec() }, modules: await measureModules(), tests: {} };
if (flag("--with-tests")) actual.tests = { unitFailures: measureUnitTests() };

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
walk("modules", actual.modules);
walk("tests", actual.tests);

const broke = (r) => {
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
  const mark = r.base === null ? "新增"
    : r.value === null ? "无法测量"
    : broke(r) ? `✗ 新增 ${r.added.length || "?"} 项`
    : Array.isArray(r.value) ? (r.fixed.length ? `↓ 修好 ${r.fixed.length} 项` : "= 持平")
    : r.value < r.base ? "↓ 改善" : r.value > r.base ? "✗ 变差" : "= 持平";
  console.log(W(`${r.group}.${r.key}`, 42) + W(r.count ?? "?", 8) + W(r.baseCount ?? "—", 8) + mark);
}

if (!flag("--with-tests")) console.log("\n（未跑单测：加 --with-tests）");
if (better.length) {
  console.log(`\n${better.length} 项已改善，可用 --update 收紧基线：`);
  for (const r of better) console.log(`  ${r.group}.${r.key}  ${r.baseCount} → ${r.count}`);
}
if (unseen.length) console.log(`\n${unseen.length} 项没有基线，用 --update 记录当前值`);
if (worse.length) {
  console.log(`\n✗ ${worse.length} 项超出基线：`);
  for (const r of worse) {
    console.log(`  ${r.group}.${r.key}  基线 ${r.baseCount}，当前 ${r.count ?? "无法测量"}`);
    for (const a of r.added.slice(0, 10)) console.log(`      + ${a}`);
    if (r.added.length > 10) console.log(`      + …其余 ${r.added.length - 10} 项`);
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
      next[r.group][r.key] = current.filter((v) => r.value.includes(v));
    } else if (!Array.isArray(r.value) && !Array.isArray(current)) {
      next[r.group][r.key] = Math.min(current, r.value);
    } else next[r.group][r.key] = r.value;  // format change: adopt the new shape
  }
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\n基线已写入 ${BASELINE.replace(`${ROOT}/`, "")}（只收紧，不放宽）`);
}

console.log("");
if (flag("--check") && worse.length) process.exit(1);
