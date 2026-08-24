#!/usr/bin/env node
/**
 * Nitro bundles `@electric-sql/pglite` JS into `_libs/` but not the sibling
 * wasm/data files `new URL("./pglite.data", import.meta.url)` resolves to.
 * Local `vite preview` (no DATABASE_URL) needs them; Neon deploys ignore them.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const destDir = join(root, ".vercel/output/functions/__server.func/_libs");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];

if (!existsSync(destDir)) {
  console.log("[pglite-assets] no nitro output, skip");
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
for (const name of files) {
  const from = join(srcDir, name);
  if (!existsSync(from)) {
    console.warn(`[pglite-assets] missing ${from}`);
    continue;
  }
  copyFileSync(from, join(destDir, name));
  console.log(`[pglite-assets] copied ${name}`);
}
