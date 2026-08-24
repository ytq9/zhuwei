import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { unstable_dev } from "wrangler";

function startDevWorker() {
  return unstable_dev("dist/server/index.js", {
    config: "dist/server/wrangler.json",
    local: true,
    logLevel: "error",
    experimental: { watch: false, disableDevRegistry: true },
  });
}

const devWorkerPromise = startDevWorker();

after(async () => {
  const worker = await devWorkerPromise;
  await worker.stop();
});

async function renderRoot() {
  const worker = await devWorkerPromise;
  return worker.fetch("https://zhuwei.test/", {
    headers: { accept: "text/html", host: "zhuwei.test" },
  });
}

async function renderPath(path, init = {}) {
  const worker = await devWorkerPromise;
  return worker.fetch(`https://zhuwei.test${path}`, init);
}

test("server-renders the finished 烛帷 landing page", async () => {
  const response = await renderRoot();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>烛帷｜AI 主持的多人 D&amp;D 跑团<\/title>/);
  assert.match(html, /帷幕后，/);
  assert.match(html, /黑橡居酒屋的第三份遗嘱/);
  assert.match(html, /https:\/\/zhuwei\.test\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Building your site/);
});

test("standalone hall returns an explicit login response instead of 500", async () => {
  const response = await renderPath("/hall", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /先登录，再入座/);
  assert.match(html, /用邮箱登录或注册一个座位/);
  assert.doesNotMatch(html, /本地冒险者/);
});

test("standalone API rejects anonymous writes explicitly", async () => {
  const response = await renderPath("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "listMyRooms" }),
  });
  assert.equal(response.status, 401);
  assert.match(await response.text(), /请先登录/);
});

test("email session opens the hall and can create a table", async () => {
  const authWorker = await startDevWorker();
  const authPath = (path, init = {}) =>
    authWorker.fetch(`https://zhuwei.test${path}`, init);
  try {
  const email = `adventurer-${crypto.randomUUID()}@example.test`;
  const password = "correct-horse-battery-staple";
  const registration = await authPath("/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://zhuwei.test",
    },
    body: JSON.stringify({ email, password, name: "迁移验收员" }),
  });
  const registrationBody = await registration.text();
  assert.equal(registration.status, 201, registrationBody);
  const setCookie = registration.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^(?:__Host-)?zhuwei_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(";", 1)[0];

  const hall = await authPath("/hall", {
    headers: { accept: "text/html", cookie },
  });
  assert.equal(hall.status, 200);
  const hallHtml = await hall.text();
  assert.match(hallHtml, /迁移验收员/);
  assert.match(hallHtml, /我来做房主/);

  const room = await authPath("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      command: "createRoom",
      data: { nickname: "迁移验收员" },
    }),
  });
  assert.equal(room.status, 200);
  const roomResult = await room.json();
  assert.equal(roomResult.ok, true);
  assert.match(roomResult.code, /^[A-Z0-9]{6}$/);

  const table = await authPath(`/table/${roomResult.code}`, {
    headers: { accept: "text/html", cookie },
  });
  assert.equal(table.status, 200);
  assert.match(await table.text(), /正在掀开帷幕|黑橡居酒屋/);

  const wrongPassword = await authPath("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "definitely-wrong" }),
  });
  assert.equal(wrongPassword.status, 401);

  const logout = await authPath("/api/auth/logout", {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const revoked = await authPath("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ command: "listMyRooms" }),
  });
  assert.equal(revoked.status, 401);

  } finally {
    await authWorker.stop();
  }
});

test("registered credentials reject a wrong password and restore a session", async () => {
  const authWorker = await startDevWorker();
  const authPath = (path, init = {}) =>
    authWorker.fetch(`https://zhuwei.test${path}`, init);
  try {
    const email = `login-${crypto.randomUUID()}@example.test`;
    const password = "another-correct-battery-staple";
    const registration = await authPath("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: "登录验收员" }),
    });
    assert.equal(registration.status, 201);
    const cookie = (registration.headers.get("set-cookie") ?? "").split(";", 1)[0];
    assert.equal(
      (await authPath("/api/auth/logout", {
        method: "POST",
        headers: { cookie },
      })).status,
      200,
    );

    const wrong = await authPath("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "definitely-wrong" }),
    });
    assert.equal(wrong.status, 401);

    const login = await authPath("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie") ?? "", /^(?:__Host-)?zhuwei_session=/);
  } finally {
    await authWorker.stop();
  }
});

test("targets the existing Worker and declares the D1 migration contract", async () => {
  const [wrangler, migration, parityMigration, authMigration] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0000_cheerful_freak.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0001_free_elektra.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0002_robust_lord_tyger.sql", import.meta.url),
      "utf8",
    ),
  ]);
  const config = JSON.parse(wrangler);
  assert.equal(config.name, "zhuwei");
  assert.equal(config.main, "worker/index.ts");
  assert.equal(config.d1_databases?.length, 1);
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.equal(config.d1_databases[0].migrations_dir, "drizzle");
  const tick = String.fromCharCode(96);
  for (const table of [
    "rooms",
    "room_members",
    "characters",
    "messages",
    "game_states",
    "session_logs",
  ]) {
    assert.ok(migration.includes("CREATE TABLE " + tick + table + tick));
  }
  assert.match(parityMigration, /ADD `combat` text/);
  assert.match(parityMigration, /ADD `tts_text` text/);
  assert.match(parityMigration, /ADD `seated` integer/);
  assert.match(authMigration, /CREATE TABLE `auth_users`/);
  assert.match(authMigration, /CREATE TABLE `auth_sessions`/);
  assert.match(authMigration, /`password_hash` text NOT NULL/);
  assert.doesNotMatch(authMigration, /`password` text/);
});
