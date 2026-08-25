import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

test("pins GitHub as the product authority and records the migrated baseline", async () => {
  const agents = await source("AGENTS.md");
  assert.match(agents, /ytq9\/zhuwei/);
  assert.match(agents, /29eb06dc009c983ad61b2d862454503e67a7f40a/);
  assert.match(agents, /唯一权威/);
  assert.match(agents, /等价 Cloudflare 迁移/);
});

test("retains the complete nine-step level-three character builder", async () => {
  const wizard = await source("app/_runtime/components/character-wizard.tsx");
  const labels = [
    "种族",
    "职业",
    "属性",
    "背景",
    "技能",
    "法术",
    "装备",
    "身份",
    "总览",
  ];
  let cursor = -1;
  for (const label of labels) {
    const next = wizard.indexOf(`"${label}"`, cursor + 1);
    assert.ok(next > cursor, `missing or reordered builder step: ${label}`);
    cursor = next;
  }
  assert.match(wizard, /POINT_BUY_CAP/);
  assert.match(wizard, /compileSheet\(draft\)/);
  assert.match(wizard, /锁定人物卡/);
});

test("exposes every upstream table and voice command through the authenticated API", async () => {
  const [server, voice, route] = await Promise.all([
    source("app/_runtime/lib/table/server.ts"),
    source("app/_runtime/lib/voice/server.ts"),
    source("app/api/game/route.ts"),
  ]);
  const exports = [
    ...server.matchAll(/export const (\w+) = createServerFn/g),
    ...voice.matchAll(/export const (\w+) = createServerFn/g),
  ].map((match) => match[1]);
  assert.ok(exports.length >= 30, "the upstream command surface was truncated");
  for (const name of exports) {
    assert.match(route, new RegExp(`\\b${name},`), `API omits ${name}`);
  }
  assert.match(route, /requireApiUser\(\)/);
  assert.match(route, /userId: user\.userId/);
});

test("keeps clocks, squads, rest voting, combat, voice and public projection in the live UI", async () => {
  const [play, server, engine] = await Promise.all([
    source("app/_runtime/components/play-table.tsx"),
    source("app/_runtime/lib/table/server.ts"),
    source("app/_runtime/lib/kp/engine.ts"),
  ]);
  for (const token of [
    "transcribeAudio",
    "speakNarration",
    "inviteSquad",
    "approveSquadQueue",
    "passCaptain",
    "restNow",
    "cancelRest",
    "joinCombat",
    "resolveReact",
    "leaveTable",
  ]) {
    assert.match(play, new RegExp(`\\b${token}\\b`), `table UI omits ${token}`);
  }
  for (const token of [
    "publicClocks",
    "readRestHold",
    "readSquads",
    "publicCombat",
    "partySplit",
    "placeNames",
  ]) {
    assert.match(server, new RegExp(`\\b${token}\\b`), `snapshot omits ${token}`);
  }
  assert.match(engine, /spotlightSkew/);
  assert.match(engine, /syncReunion/);
  assert.match(engine, /isPlaceBusy/);
  assert.match(server, /\.map\(publicNpc\)/);
  assert.doesNotMatch(play, /\btruth\b/);
});

test("keeps production entrypoints out of the legacy src and Vercel trees", async () => {
  const [packageJson, tsconfig, worker, auth, authServer] = await Promise.all([
    source("package.json"),
    source("tsconfig.json"),
    source("worker/index.ts"),
    source("app/chatgpt-auth.ts"),
    source("app/_lib/auth.server.ts"),
  ]);
  for (const forbidden of ["better-auth", "@electric-sql/pglite", '"pg"', "@openai/sites-vite-plugin"]) {
    assert.ok(!packageJson.includes(forbidden), `production manifest still includes ${forbidden}`);
  }
  assert.match(tsconfig, /\.\/app\/_runtime\/\*/);
  assert.match(tsconfig, /"src"/);
  assert.doesNotMatch(worker, /\.vercel|PGlite|previewAuthSecret|randomBytes/);
  assert.match(auth, /userFromCookie/);
  assert.doesNotMatch(auth, /oai-authenticated-user-id/);
  assert.doesNotMatch(auth, /local-cloudflare-user|import\.meta\.env\.DEV/);
  assert.match(authServer, /PBKDF2/);
  assert.match(authServer, /crypto\.getRandomValues/);
  const passwordIterations = authServer.match(
    /const PASSWORD_ITERATIONS = ([\d_]+);/,
  );
  assert.ok(passwordIterations, "password iteration policy is explicit");
  assert.ok(
    Number(passwordIterations[1].replaceAll("_", "")) <= 100_000,
    "Cloudflare Workers rejects PBKDF2 requests above 100,000 iterations",
  );
  assert.doesNotMatch(authServer, /randomBytes|randomFillSync|BETTER_AUTH_SECRET/);
});

test("landing and hall retain the exact upstream calls to action with native fallbacks", async () => {
  const [page, hall] = await Promise.all([
    source("app/page.tsx"),
    source("app/hall/hall-client.tsx"),
  ]);
  for (const text of ["进入酒馆", "登录", "今晚的案子", "完整 5e 建卡", "语音进出", "房间与存档"]) {
    assert.ok(page.includes(text), `landing omits upstream copy: ${text}`);
  }
  assert.match(page, /pointer-events-none absolute inset-0/);
  assert.match(hall, /window\.location\.assign\(`\/table\/\$\{result\.code\}`\)/);
  assert.match(hall, /href=\{`\/table\/\$\{room\.code\}`\}/);
  assert.match(hall, /我来做房主/);
  assert.match(hall, /已有房间码？坐下。/);
});
