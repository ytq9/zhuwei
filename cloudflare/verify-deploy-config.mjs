import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(
  await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);

assert.equal(config.name, "zhuwei", "Wrangler target must remain the existing zhuwei Worker");
assert.equal(config.main, "worker/index.ts", "Deployment must use the Worker ESM entry");
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

console.log("Cloudflare deployment configuration is complete.");
