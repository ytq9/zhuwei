import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(
  await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);

assert.equal(config.name, "zhuwei", "Wrangler target must remain the existing zhuwei Worker");
assert.equal(config.main, "worker/index.ts", "Deployment must use the Worker ESM entry");
assert.equal(config.d1_databases?.length, 1, "Exactly one existing D1 binding is required");
assert.equal(config.d1_databases[0]?.binding, "DB", "D1 binding must be named DB");
assert.match(
  config.d1_databases[0]?.database_id ?? "",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Replace the D1 placeholder with the existing database id before deployment",
);

console.log("Cloudflare deployment configuration is complete.");
