import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertImportBoundaries,
  assertNoModuleScopeEffects,
  assertRulesPublicSurface,
  assertSingleRulesAuthority,
  assertStaticRagInputs,
  assertStructuredProductionLogging,
} from "../tools/check-modules.mjs";
import {
  invokeProfileReferenceGate,
  verifyCurrentDeployment,
  verifyDeployGuard,
} from "../cloudflare/verify-deploy-config.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function put(root, path, contents) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "zhuwei-v3-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) put(root, path, contents);
  return root;
}

function deployInputs() {
  return {
    config: JSON.parse(readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8")),
    frozenSpec: readFileSync(
      join(repoRoot, "docs/specs/0001-llm-kp-responsibility-contract.md"),
      "utf8",
    ),
    packageJson: JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")),
    gateSource: readFileSync(
      join(repoRoot, "tools/check-runtime-profile-references.mts"),
      "utf8",
    ),
    branch: "cloudflare",
    status: "",
    head: "a".repeat(40),
    deploySourceSha: undefined,
    requireSourceProof: false,
    profileGate: {
      invoked: true,
      evidenceProvided: false,
      result: { ok: true, referencedManifestRefs: [], roomCount: 0 },
    },
    requireProfileEvidence: false,
  };
}

test("Rules public surface rejects declaration, star, alias, and re-export bypasses", (t) => {
  const root = fixture(t, {
    "app/_runtime/lib/rules/index.ts": [
      'export { project, replay, step } from "./v2-runtime";',
      'export type { Command } from "./model";',
    ].join("\n"),
  });
  assert.doesNotThrow(() => assertRulesPublicSurface(root));

  const invalidEntries = [
    [
      'export { project, replay, step } from "./v2-runtime";',
      "export function adjudicate() {}",
    ].join("\n"),
    [
      'export { project, replay, step } from "./v2-runtime";',
      "export function* hiddenReplay() {}",
    ].join("\n"),
    [
      'export { project, replay, step } from "./v2-runtime";',
      "export abstract class HiddenMechanics {}",
    ].join("\n"),
    [
      'export { project, replay } from "./v2-runtime";',
      "export const step = () => undefined, hiddenMechanics = 1;",
    ].join("\n"),
    'export * from "./v2-runtime";',
    'export { project, replay, step, internalStep as publicStep } from "./v2-runtime";',
    'export { project, replay, step as default } from "./v2-runtime";',
  ];

  for (const entry of invalidEntries) {
    put(root, "app/_runtime/lib/rules/index.ts", entry);
    assert.throws(
      () => assertRulesPublicSurface(root),
      /value-export only|forbidden export forms/,
    );
  }
});

test("private v2 and legacy engine imports reject every supported loading form", (t) => {
  const root = fixture(t, {
    "app/_runtime/lib/rules/index.ts": 'export { project, replay, step } from "./v2-runtime";',
    "app/consumer.ts": 'import { step } from "@/lib/rules";',
    "app/_runtime/lib/rules/v2/internal.ts": 'import type { WorldState } from "./model";',
  });
  assert.doesNotThrow(() => assertImportBoundaries(root));

  const bypasses = [
    'import { fold } from "./_runtime/lib/rules/v2/model";',
    'export { fold } from "./_runtime/lib/rules/v2/model";',
    'const privateRules = await import("./_runtime/lib/rules/v2/model");',
    'const privateRules = require("./_runtime/lib/rules/v2/model");',
    'import privateRules = require("./_runtime/lib/rules/v2/model");',
    'const target = "./_runtime/lib/rules/v2/model"; import(target);',
    'const segment = "model"; import(`./_runtime/lib/rules/v2/${segment}`);',
    'import { step } from "@/lib/rules/engine";',
  ];
  for (const source of bypasses) {
    put(root, "app/bypass.ts", source);
    assert.throws(
      () => assertImportBoundaries(root),
      /private rules imports are forbidden/,
      source,
    );
  }
});

test("second mechanics, projection, random, replay, and state authorities fail closed", (t) => {
  const root = fixture(t, {
    "app/feature.ts": "export const harmless = true;",
  });
  assert.doesNotThrow(() => assertSingleRulesAuthority(root));

  const bypasses = [
    ["worker/mechanics.ts", "export const harmless = true;"],
    ["tools/alternate.ts", "export function project() {}"],
    ["db/alternate.ts", "const localReplay = 1; export { localReplay as replay };"],
    ["app/alternate.ts", "export const CampaignStateAuthority = {};"],
    ["app/replay-engine.ts", "export default {};"],
  ];
  for (const [path, source] of bypasses) {
    const isolated = fixture(t, { [path]: source });
    assert.throws(
      () => assertSingleRulesAuthority(isolated),
      /second mechanics\/projection\/random\/replay\/state authorities are forbidden/,
      path,
    );
  }
});

test("module-global random, fetch, DB, timer, secret, and IIFE effects are rejected", (t) => {
  const allowed = fixture(t, {
    "app/handler.ts": [
      "export async function handler(env) {",
      "  crypto.getRandomValues(new Uint8Array(1));",
      "  const db = getD1();",
      "  const secret = env.SECRET;",
      '  await fetch("https://example.invalid");',
      "  setTimeout(() => undefined, 1);",
      "  return { db, secret };",
      "}",
    ].join("\n"),
    "app/request-adapter.ts": [
      "const EMPTY = Object.freeze([]);",
      "export function makeAdapter(db) {",
      "  return { async search() { return db.prepare('SELECT 1').all(); } };",
      "}",
      "export async function retrieve(adapter, skip) {",
      "  return skip ? Object.freeze([]) : await adapter.search(Object.freeze({ terms: [] }));",
      "}",
    ].join("\n"),
  });
  assert.doesNotThrow(() => assertNoModuleScopeEffects(allowed));

  const bypasses = [
    "const seed = Math.random();",
    'const response = fetch("https://example.invalid");',
    "const db = getD1();",
    "setInterval(() => undefined, 1000);",
    "const secret = process.env.API_KEY;",
    'const secret = process.env["API_KEY"];',
    'const response = globalThis.fetch("https://example.invalid");',
    'const value = `seed:${Math.random()}`;',
    'const config = readFileSync("config.json", "utf8");',
    'void (() => fetch("https://example.invalid"))();',
    'function boot() { fetch("https://example.invalid"); } boot();',
    'const boot = () => fetch("https://example.invalid"); boot();',
  ];
  for (const source of bypasses) {
    const root = fixture(t, { "app/effect.ts": source });
    assert.throws(
      () => assertNoModuleScopeEffects(root),
      /module-scope I\/O and nondeterminism are forbidden/,
      source,
    );
  }
});

test("production RAG indexes accept static corpus inputs but reject dynamic knowledge", (t) => {
  const root = fixture(t, {
    "app/_runtime/lib/kp/static-retrieval.ts":
      "export function retrieve(query: string, corpusRef: string) { return [query, corpusRef]; }",
  });
  assert.doesNotThrow(() => assertStaticRagInputs(root));

  const dynamicInputs = [
    "worldState: WorldState",
    "roomState: RoomState",
    "tacticalProjection: TacticalProjection",
    "npcKnowledge: NpcKnowledge",
  ];
  for (const input of dynamicInputs) {
    put(
      root,
      "app/_runtime/lib/kp/static-retrieval.ts",
      `export function retrieve(query: string, ${input}) { return query; }`,
    );
    assert.throws(
      () => assertStaticRagInputs(root),
      /static corpus inputs only/,
      input,
    );
  }
  put(root, "app/_runtime/lib/kp/rag/index.ts", "export function build(worldState: unknown) {}");
  assert.throws(() => assertStaticRagInputs(root), /static corpus inputs only/);
});

test("production console calls require a structured serializer or trusted sink", (t) => {
  const root = fixture(t, {
    "worker/index.ts": [
      "declare function buildRoomTelemetryEvent(input: unknown): unknown;",
      'console.info(JSON.stringify(buildRoomTelemetryEvent({ eventName: "ready" })));',
    ].join("\n"),
  });
  assert.doesNotThrow(() => assertStructuredProductionLogging(root));

  for (const source of [
    'console.log("ready");',
    "console.error(error);",
    "console.info(JSON.stringify({ secret }));",
    "const log = console.info; log(secret);",
    "console[method](secret);",
    "globalThis.console.info(secret);",
    "console.info(JSON.stringify(buildRoomTelemetryEvent({})), secret);",
  ]) {
    put(root, "worker/index.ts", source);
    assert.throws(
      () => assertStructuredProductionLogging(root),
      /structured serializer/,
      source,
    );
  }
});

test("deploy guard accepts only clean cloudflare HEAD with matching evidence", () => {
  const valid = deployInputs();
  assert.deepEqual(
    verifyDeployGuard(valid),
    {
      ok: true,
      branch: "cloudflare",
      sourceSha: "a".repeat(40),
      profileRoomCount: 0,
      referencedManifestRefs: [],
    },
  );
  assert.doesNotThrow(() => verifyDeployGuard({
    ...valid,
    deploySourceSha: valid.head,
    requireSourceProof: true,
    requireProfileEvidence: true,
    profileGate: { ...valid.profileGate, evidenceProvided: true },
  }));

  const rejected = [
    [{ branch: "main" }, /cloudflare branch/],
    [{ branch: "feature" }, /cloudflare branch/],
    [{ ciSourceBranch: "main" }, /CI deploy source/],
    [{ ciBaseBranch: "main" }, /pull-request\/target-branch/],
    [{ status: " M wrangler.jsonc" }, /clean tracked and untracked worktree/],
    [{ deploySourceSha: "b".repeat(40) }, /exactly match git HEAD/],
    [{ requireSourceProof: true }, /DEPLOY_SOURCE_SHA is required/],
    [{
      requireProfileEvidence: true,
      deploySourceSha: valid.head,
      requireSourceProof: true,
    }, /PROFILE_REFERENCE_GATE_JSON is required/],
    [{
      profileGate: {
        invoked: true,
        evidenceProvided: true,
        result: { ok: false, code: "missingProfile", referencedManifestRefs: [], roomCount: 1 },
      },
    }, /profile reference gate rejected deploy/],
  ];
  for (const [change, message] of rejected) {
    assert.throws(() => verifyDeployGuard({ ...valid, ...change }), message);
  }
});

test("deploy guard rejects main-entry/resource drift and an unavailable profile gate", () => {
  const valid = deployInputs();
  assert.throws(
    () => verifyDeployGuard({
      ...valid,
      config: { ...valid.config, main: "main.ts" },
    }),
    /existing Worker entry/,
  );
  assert.throws(
    () => verifyDeployGuard({
      ...valid,
      config: { ...valid.config, kv_namespaces: [{ binding: "CACHE", id: "new" }] },
    }),
    /new top-level deployment\/resource surface/,
  );
  assert.throws(
    () => verifyDeployGuard({
      ...valid,
      packageJson: {
        ...valid.packageJson,
        scripts: { ...valid.packageJson.scripts, "profile:reference-gate": "echo skipped" },
      },
    }),
    /must remain wired/,
  );
  assert.throws(
    () => verifyDeployGuard({
      ...valid,
      profileGate: { ...valid.profileGate, invoked: false },
    }),
    /must invoke/,
  );
});

test("current deploy verification invokes the profile gate and inspects Git locally", (t) => {
  const root = fixture(t, {
    "wrangler.jsonc": readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8"),
    "docs/specs/0001-llm-kp-responsibility-contract.md": readFileSync(
      join(repoRoot, "docs/specs/0001-llm-kp-responsibility-contract.md"),
      "utf8",
    ),
    "package.json": readFileSync(join(repoRoot, "package.json"), "utf8"),
    "tools/check-runtime-profile-references.mts": readFileSync(
      join(repoRoot, "tools/check-runtime-profile-references.mts"),
      "utf8",
    ),
  });
  execFileSync("git", ["init", "-q", "-b", "cloudflare"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    ["-c", "user.name=Guard Test", "-c", "user.email=guard@example.invalid", "commit", "-qm", "fixture"],
    { cwd: root },
  );
  let invocation;
  const result = verifyCurrentDeployment({
    root,
    environment: {},
    profileGateRunner: (receivedRoot, input) => {
      invocation = { receivedRoot, input };
      return { ok: true, referencedManifestRefs: [], roomCount: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(invocation, { receivedRoot: root, input: "[]" });
});

test("real profile reference gate executable accepts a bounded empty D1 snapshot", () => {
  assert.deepEqual(
    invokeProfileReferenceGate(repoRoot, "[]"),
    { ok: true, referencedManifestRefs: [], roomCount: 0 },
  );
});
