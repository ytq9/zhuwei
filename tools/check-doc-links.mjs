#!/usr/bin/env node
/**
 * Relative links in docs/ that do not resolve.
 *
 * Moving a file inside docs/ silently breaks every link to it. Markdown has no
 * compiler, so nothing else reports this.
 *
 *   node tools/check-doc-links.mjs           # list broken links
 *   node tools/check-doc-links.mjs --json    # one line per broken link
 *   node tools/check-doc-links.mjs --check   # exit 1 if any
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
};

async function main() {
  const files = [...walk(join(ROOT, "docs")), join(ROOT, "AGENTS.md"), join(ROOT, "CONTEXT.md"), join(ROOT, "CLAUDE.md")]
    .filter((f) => existsSync(f));

  const broken = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      // `path.ts:172` is a source reference with a line number, not a filename.
      const path = href.split("#")[0].replace(/:\d+$/, "");
      const target = resolve(dirname(file), path);
      if (!existsSync(target)) broken.push({ from: relative(ROOT, file), href });
    }
  }

  // --baseline: fail only on a link that is not already accepted in
// .gate-baseline.json. The one stale reference that predates this tool would
// otherwise make every Markdown edit fail, which is how a check gets ignored.
if (process.argv.includes("--baseline")) {
  const file = join(ROOT, ".gate-baseline.json");
  let accepted = [];
  try { accepted = JSON.parse(readFileSync(file, "utf8"))?.docs?.brokenLinks ?? []; } catch {}
  const seen = broken.map((b) => `${b.from} → ${b.href}`);
  const added = seen.filter((x) => !accepted.includes(x));
  if (!added.length) { console.log(`断链 ${seen.length} 条，均在基线内`); process.exit(0); }
  console.log(`✗ ${added.length} 条新断链（基线 ${accepted.length} 条）：`);
  for (const a of added) console.log("    " + a);
  process.exit(1);
}

if (process.argv.includes("--json")) {
    console.log(JSON.stringify(broken.map((b) => `${b.from} → ${b.href}`).sort(), null, 2));
    process.exit(0);
  }

  const by = new Map();
  for (const b of broken) {
    if (!by.has(b.from)) by.set(b.from, []);
    by.get(b.from).push(b.href);
  }
  for (const [from, hrefs] of by) {
    console.log(from);
    for (const h of hrefs.slice(0, 8)) console.log("    " + h);
    if (hrefs.length > 8) console.log(`    …其余 ${hrefs.length - 8} 条`);
  }
  console.log(`\n断链 ${broken.length} 条，分布在 ${by.size} 个文件（共扫描 ${files.length} 个 Markdown）`);
  if (process.argv.includes("--check") && broken.length) process.exit(1);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
