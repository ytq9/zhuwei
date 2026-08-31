import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const at = (...parts) => join(root, ...parts);

test("V3 has one production tree and no archived platform entrypoints", () => {
  const packageJson = JSON.parse(readFileSync(at("package.json"), "utf8"));
  assert.equal(packageJson.version, "0.4.0");

  for (const path of [
    "src",
    "server",
    "scripts",
    "migrations",
    "public/__grok",
    "startup.sh",
    "AGENTS.project.md",
  ]) {
    assert.equal(existsSync(at(path)), false, `${path} must remain archive-only in V3`);
  }

  const ignore = readFileSync(at(".gitignore"), "utf8");
  assert.match(ignore, /^\/output$/mu);
  assert.match(ignore, /^\/\.playwright-cli$/mu);

  for (const path of [
    "app",
    "worker",
    "db",
    "drizzle",
    "tests",
    "tools/check-modules.mjs",
    "tools/live-kp-eval.mjs",
    "tools/run-live-kp-eval.mjs",
  ]) {
    assert.equal(existsSync(at(path)), true, `${path} is required by the V3 workspace`);
  }
});

test("product V3 does not relabel the pinned authoritative-v2 ruleset", () => {
  const ruleset = readFileSync(at("app/_runtime/lib/rules/ruleset.ts"), "utf8");
  const adr = readFileSync(
    at("docs/adr/0013-v3-product-generation-and-repository-boundary.md"),
    "utf8",
  );

  assert.match(ruleset, /dnd5e-2014-srd5\.1-authoritative-v2/u);
  assert.match(adr, /产品代际与规则版本分离/u);
  assert.match(adr, /step \/ project \/ replay/u);
});
