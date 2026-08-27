import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const config = JSON.parse(
  await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);
const frozenSpec = await readFile(
  new URL("../docs/specs/0001-llm-kp-responsibility-contract.md", import.meta.url),
);
assert.equal(
  createHash("sha256").update(frozenSpec).digest("hex"),
  "b420123d45959b88f4ede6753ab6e38aa7b5307e2834f0303c72d6d6eaa323be",
  "SPEC 0001 content and frozen status must remain unchanged",
);

assert.equal(config.name, "zhuwei", "Wrangler target must remain the existing zhuwei Worker");
assert.equal(config.main, "worker/index.ts", "Deployment must use the Worker ESM entry");
assert.equal(config.ai?.binding, "AI", "Workers AI binding must be named AI");
assert.deepEqual(
  config.durable_objects?.bindings,
  [{ name: "ROOMS", class_name: "RoomDurableObject" }],
  "Deployment must retain the one authorized ROOMS Durable Object binding",
);
assert.ok(
  config.migrations?.some(
    (migration) =>
      migration.tag === "room-do-v1"
      && migration.new_sqlite_classes?.includes("RoomDurableObject"),
  ),
  "Deployment must retain the existing RoomDurableObject SQLite migration",
);
assert.equal(config.d1_databases?.length, 1, "Exactly one existing D1 binding is required");
assert.equal(config.d1_databases[0]?.binding, "DB", "D1 binding must be named DB");
assert.equal(
  config.d1_databases[0]?.database_name,
  "zhuwei-dev",
  "D1 binding must target the authorized zhuwei-dev database",
);
assert.equal(
  config.d1_databases[0]?.database_id,
  "f5a448fd-4224-4e52-bafb-a84cb190b618",
  "D1 binding must target the authorized zhuwei-dev database id",
);
for (const forbiddenResource of [
  "kv_namespaces",
  "r2_buckets",
  "queues",
  "workflows",
  "vectorize",
]) {
  assert.ok(
    !config[forbiddenResource]?.length,
    `Deployment must not add ${forbiddenResource}`,
  );
}

console.log("Cloudflare deployment configuration is complete.");
