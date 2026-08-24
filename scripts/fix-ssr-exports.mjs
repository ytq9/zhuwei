#!/usr/bin/env node
/**
 * Vite 8.2 + Rolldown 1.2.2+ emits Nitro SSR chunks that re-export
 * `ssr_exports` without declaring it. Node then 500s every request with:
 *   Export 'ssr_exports' is not defined in module
 * See tanstack/router#8031. Patch emitted server ESM after `vite build`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOTS = [".output", ".vercel/output", "dist", "node_modules/.nitro"];

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (/\.(mjs|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function isUndeclared(src) {
  if (!src.includes("ssr_exports")) return false;
  const declares =
    /\b(?:var|let|const|function|class)\s+ssr_exports\b/.test(src) ||
    /\bssr_exports\s*=/.test(src);
  if (declares) return false;
  return /export\s*\{[^}]*\bssr_exports\b/.test(src);
}

function patch(src) {
  if (!isUndeclared(src)) return null;
  const alias = /\b(?:var|let|const)\s+server_exports\b/.test(src)
    ? "server_exports"
    : /\b(?:var|let|const)\s+request_helpers_exports\b/.test(src)
      ? "request_helpers_exports"
      : null;
  const insert = alias
    ? `var ssr_exports = ${alias};\n`
    : `var ssr_exports = {};\n`;
  const marker = "\nexport {";
  const at = src.lastIndexOf(marker);
  if (at >= 0) return src.slice(0, at) + "\n" + insert + src.slice(at);
  return insert + src;
}

let fixed = 0;
let leftover = [];
for (const root of ROOTS) {
  const files = await walk(join(process.cwd(), root));
  for (const file of files) {
    const src = await readFile(file, "utf8");
    const next = patch(src);
    if (next) {
      await writeFile(file, next);
      console.log("[fix-ssr-exports]", file);
      fixed += 1;
    }
    const checkSrc = next ?? src;
    if (isUndeclared(checkSrc)) leftover.push(file);
    if (file.endsWith(".mjs") && checkSrc.includes("ssr_exports")) {
      const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      if (r.status !== 0) leftover.push(file + " (syntax)");
    }
  }
}
console.log(
  fixed
    ? `[fix-ssr-exports] patched ${fixed} file(s)`
    : "[fix-ssr-exports] no undeclared ssr_exports found",
);
if (leftover.length) {
  console.error("[fix-ssr-exports] still broken:\n" + leftover.join("\n"));
  process.exit(1);
}
