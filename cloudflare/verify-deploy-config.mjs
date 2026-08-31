import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frozenSpecSha256 = "b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be";
const expectedConfigKeys = [
  "$schema",
  "ai",
  "assets",
  "compatibility_date",
  "compatibility_flags",
  "d1_databases",
  "durable_objects",
  "main",
  "migrations",
  "name",
  "observability",
].sort();

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function environmentFlag(value) {
  if (typeof value !== "string") return Boolean(value);
  return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function assertStaticDeployConfiguration({ config, frozenSpec }) {
  assert.equal(
    sha256(frozenSpec),
    frozenSpecSha256,
    "SPEC 0001 hash drifted; deploy requires an explicit freeze update",
  );
  assert.deepEqual(
    Object.keys(config).sort(),
    expectedConfigKeys,
    "wrangler.jsonc contains a missing or new top-level deployment/resource surface",
  );
  assert.equal(config.name, "zhuwei", "deploy must target the existing zhuwei Worker");
  assert.equal(config.main, "worker/index.ts", "deploy must keep the existing Worker entry");
  assert.deepEqual(config.compatibility_flags, ["nodejs_compat"], "Worker compatibility flags drifted");
  assert.deepEqual(config.assets, { directory: "./dist/client", binding: "ASSETS" }, "assets binding drifted");
  assert.deepEqual(config.ai, { binding: "AI" }, "Workers AI binding drifted");
  assert.deepEqual(
    config.durable_objects,
    { bindings: [{ name: "ROOMS", class_name: "RoomDurableObject" }] },
    "Durable Object resources drifted",
  );
  assert.deepEqual(
    config.migrations,
    [{ tag: "room-do-v1", new_sqlite_classes: ["RoomDurableObject"] }],
    "Durable Object migration/resource set drifted",
  );
  assert.deepEqual(
    config.d1_databases,
    [{
      binding: "DB",
      database_name: "zhuwei-dev",
      database_id: "f5a448fd-4224-4e52-bafb-a84cb190b618",
      migrations_dir: "drizzle",
    }],
    "D1 binding must remain the existing DB/zhuwei-dev resource",
  );
  assert.deepEqual(config.observability, { enabled: true }, "Worker observability configuration drifted");
}

export function assertDeploymentGitState({
  branch,
  status,
  head,
  deploySourceSha,
  requireSourceProof,
  ciSourceBranch,
  ciBaseBranch,
}) {
  assert.equal(branch, "cloudflare", "deploy is permitted only from the cloudflare branch");
  if (ciSourceBranch) {
    assert.equal(ciSourceBranch, "cloudflare", "CI deploy source must be the cloudflare branch");
  }
  assert.ok(!ciBaseBranch, "deploy is forbidden from pull-request/target-branch CI contexts");
  assert.equal(status, "", "deploy requires a clean tracked and untracked worktree");
  assert.match(head, /^[0-9a-f]{40}$/, "git HEAD must be a full lowercase commit SHA");
  if (deploySourceSha === undefined || deploySourceSha === "") {
    assert.equal(
      requireSourceProof,
      false,
      "DEPLOY_SOURCE_SHA is required in CI and cf:deploy lifecycle runs",
    );
    return;
  }
  assert.match(
    deploySourceSha,
    /^[0-9a-f]{40}$/,
    "DEPLOY_SOURCE_SHA must be a full lowercase commit SHA",
  );
  assert.equal(deploySourceSha, head, "DEPLOY_SOURCE_SHA must exactly match git HEAD");
}

export function verifyDeployGuard({
  config,
  frozenSpec,
  branch,
  status,
  head,
  deploySourceSha,
  requireSourceProof,
  ciSourceBranch,
  ciBaseBranch,
}) {
  assertStaticDeployConfiguration({ config, frozenSpec });
  assertDeploymentGitState({
    branch,
    status,
    head,
    deploySourceSha,
    requireSourceProof,
    ciSourceBranch,
    ciBaseBranch,
  });
  return {
    ok: true,
    branch,
    sourceSha: head,
  };
}

export function verifyCurrentDeployment({
  root = defaultRepoRoot,
  environment = process.env,
} = {}) {
  const configPath = join(root, "wrangler.jsonc");
  const specPath = join(root, "docs/specs/0001-llm-kp-responsibility-contract.md");
  for (const path of [configPath, specPath]) {
    assert.ok(existsSync(path), `required deploy guard input is missing: ${path}`);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const frozenSpec = readFileSync(specPath, "utf8");
  const isCi = environmentFlag(environment.CI);
  const isDeployLifecycle = environment.npm_lifecycle_event === "cf:deploy"
    || environment.npm_lifecycle_event === "deploy"
    || /(?:^|\s)wrangler\s+deploy(?:\s|$)/.test(environment.npm_lifecycle_script ?? "");
  const localBranch = git(root, ["branch", "--show-current"]);
  const ciSourceBranch = isCi
    ? environment.GITHUB_HEAD_REF ?? environment.GITHUB_REF_NAME ?? environment.DEPLOY_SOURCE_BRANCH ?? ""
    : undefined;
  const branch = localBranch || ciSourceBranch || "";

  return verifyDeployGuard({
    config,
    frozenSpec,
    branch,
    status: git(root, ["status", "--porcelain", "--untracked-files=all"]),
    head: git(root, ["rev-parse", "HEAD"]),
    deploySourceSha: environment.DEPLOY_SOURCE_SHA,
    requireSourceProof: isCi || isDeployLifecycle,
    ciSourceBranch,
    ciBaseBranch: isCi ? environment.GITHUB_BASE_REF : undefined,
  });
}

function main() {
  const result = verifyCurrentDeployment();
  console.log(JSON.stringify(result));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`deploy guard rejected: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
