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

test("uses one DeepSeek provider adapter for structured KP text and Workers AI for Chinese voice", async () => {
  const [configText, engine, provider, deepseek, voice] = await Promise.all([
    source("wrangler.jsonc"),
    source("app/_runtime/lib/kp/engine.ts"),
    source("app/_runtime/lib/kp/provider.ts"),
    source("app/_runtime/lib/kp/deepseek.ts"),
    source("app/_runtime/lib/voice/server.ts"),
  ]);
  const config = JSON.parse(configText);
  assert.equal(config.ai?.binding, "AI");
  assert.match(engine, /chatModelText/);
  assert.match(provider, /DEEPSEEK_API_KEY/);
  assert.match(deepseek, /https:\/\/api\.deepseek\.com\/chat\/completions/);
  assert.match(provider, /response_format:\s*\{ type: "json_object" \}/);
  assert.match(voice, /@cf\/openai\/whisper-large-v3-turbo/);
  assert.match(voice, /@cf\/myshell-ai\/melotts/);
  assert.doesNotMatch(voice, /api\.x\.ai/);
  assert.doesNotMatch(voice, /XAI_API_KEY/);
  assert.doesNotMatch(voice, /new Map/);
});

test("pins one host-selected KP profile when the room is created", async () => {
  const [
    schema,
    models,
    server,
    engine,
    hall,
    lobby,
    migration,
    profileMigration,
    roomServer,
    provider,
    policy,
  ] = await Promise.all([
    source("db/schema.ts"),
    source("app/_runtime/lib/kp/models.ts"),
    source("app/_runtime/lib/table/server.ts"),
    source("app/_runtime/lib/kp/engine.ts"),
    source("app/hall/hall-client.tsx"),
    source("app/table/[code]/table-client.tsx"),
    source("drizzle/0003_rich_boom_boom.sql"),
    source("drizzle/0007_free_black_bolt.sql"),
    source("app/_runtime/lib/room/server.ts"),
    source("app/_runtime/lib/kp/provider.ts"),
    source("app/_runtime/lib/kp/authoritative-policy.ts"),
  ]);
  const {
    AUTHORITATIVE_KP_MODELS,
    LEGACY_KP_MODELS,
    kpModelById,
    publicKpModelId,
  } = await import("../app/_runtime/lib/kp/models.ts");
  assert.deepEqual(
    AUTHORITATIVE_KP_MODELS.map(({ id }) => id),
    ["deepseek-v4-flash", "deepseek-v4-pro"],
  );
  assert.deepEqual(
    LEGACY_KP_MODELS.map(({ id }) => id),
    ["deepseek-v4-flash", "deepseek-v4-pro"],
  );
  assert.equal(kpModelById("@cf/zai-org/glm-4.7-flash"), undefined);
  assert.equal(kpModelById("@cf/google/gemma-4-26b-a4b-it"), undefined);
  assert.equal(publicKpModelId("@cf/zai-org/glm-4.7-flash"), null);
  assert.equal(publicKpModelId("@cf/google/gemma-4-26b-a4b-it"), null);
  assert.match(schema, /kpModel: text\("kp_model"\).*default\("deepseek-v4-flash"\)/);
  assert.match(schema, /kpModelProfile: text\("kp_model_profile"\)/);
  assert.match(models, /AUTHORITATIVE_KP_MODELS/);
  assert.match(models, /LEGACY_KP_MODELS/);
  assert.doesNotMatch(models, /@cf\/zai-org|@cf\/google/);
  assert.match(models, /deepseek-v4-flash/);
  assert.match(models, /deepseek-v4-pro/);
  assert.match(policy, /@cf\/zai-org\/glm-4\.7-flash/);
  assert.match(policy, /@cf\/google\/gemma-4-26b-a4b-it/);
  assert.match(policy, /provider: "deepseek"/);
  const { AUTHORITATIVE_KP_PROFILES } = await import(
    "../app/_runtime/lib/kp/authoritative-policy.ts"
  );
  assert.deepEqual(
    AUTHORITATIVE_KP_PROFILES.map((profile) => ({
      modelId: profile.modelId,
      modelProfileVersion: profile.modelProfileVersion,
      provider: profile.provider,
    })),
    [
      {
        modelId: "deepseek-v4-flash",
        modelProfileVersion: "authoritative-kp-deepseek-v4-flash-v1",
        provider: "deepseek",
      },
      {
        modelId: "deepseek-v4-pro",
        modelProfileVersion: "authoritative-kp-deepseek-v4-pro-v1",
        provider: "deepseek",
      },
      {
        modelId: "@cf/zai-org/glm-4.7-flash",
        modelProfileVersion: "authoritative-kp-profile-v1",
        provider: "cloudflare-workers-ai",
      },
      {
        modelId: "@cf/google/gemma-4-26b-a4b-it",
        modelProfileVersion: "authoritative-kp-model-gemma-4-26b-a4b-it-v1",
        provider: "cloudflare-workers-ai",
      },
    ],
  );
  assert.match(server, /export const setRoomModel = createServerFn/);
  assert.match(server, /if \(!me\.is_host\)/);
  assert.match(server, /status = \$\{"lobby"\}/);
  assert.match(server, /本桌模型在创建时固定，创建后不能更换/);
  assert.match(server, /isLegacyKpModel\(data\.model\)/);
  assert.match(server, /kp_model, kp_model_profile/);
  assert.match(roomServer, /authoritativeKpProfileByBinding/);
  assert.match(roomServer, /authoritativeKpModelBinding\(profile\)/);
  assert.match(provider, /createDeepSeekAuthoritativeBinding/);
  assert.match(provider, /return ai\.run\(model, input, options\)/);
  const publicRoomProjection = server.slice(
    server.indexOf("const publicRoomInfo ="),
    server.indexOf("if (info.ruleset_version === AUTHORITATIVE_RULESET_VERSION)"),
  );
  assert.match(publicRoomProjection, /kp_model: publicKpModelId\(info\.kp_model\)/);
  assert.doesNotMatch(publicRoomProjection, /kp_model_profile/);
  assert.doesNotMatch(server, /room: info|room: roomInfo/);
  const correction = roomServer.slice(
    roomServer.indexOf("export type AuthoritativeRoomCorrectionInput"),
    roomServer.indexOf("async function executeAuthoritativeRoomAction"),
  );
  assert.doesNotMatch(correction, /modelId|modelProfileVersion/);
  assert.match(correction, /select ruleset_version, kp_model, kp_model_profile/);
  assert.match(correction, /where id = \$\{input\.roomId\}/);
  assert.match(engine, /chatJson\(rooms\[0\]\.kp_model, messages\)/);
  assert.doesNotMatch(engine, /grok-4\.5/);
  assert.match(hall, /创建桌子前选择 KP 模型/);
  assert.match(hall, /createRoom\(\{ data: \{ nickname: nick, model \} \}\)/);
  assert.match(hall, /AUTHORITATIVE_KP_MODELS\.map/);
  assert.match(hall, /LEGACY_KP_MODELS\.map/);
  assert.match(lobby, /本次跑团模型/);
  assert.match(lobby, /模型在创建桌子时固定/);
  assert.match(lobby, /LEGACY_KP_MODELS\.map/);
  assert.match(migration, /ALTER TABLE `rooms` ADD `kp_model`/);
  assert.match(profileMigration, /ALTER TABLE `rooms` ADD `kp_model_profile`/);
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
