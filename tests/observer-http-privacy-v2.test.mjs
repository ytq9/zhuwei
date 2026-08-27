import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { unstable_dev } from "wrangler";

const execFileAsync = promisify(execFile);
const unavailableNarration = Object.freeze({
  ok: false,
  error: "这段旁白已经不可回看",
});

const localD1Promise = (async () => {
  const persistTo = await mkdtemp(join(tmpdir(), "zhuwei-observer-http-"));
  await execFileAsync(process.execPath, [
    fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    "dist/server/wrangler.json",
    "--persist-to",
    persistTo,
  ], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    maxBuffer: 4 * 1024 * 1024,
  });
  return persistTo;
})();

const workerPromise = localD1Promise.then((persistTo) => unstable_dev("dist/server/index.js", {
  config: "dist/server/wrangler.json",
  local: true,
  persistTo,
  logLevel: "error",
  vars: { DEEPSEEK_API_KEY: "local-observer-test-key" },
  experimental: { watch: false, disableDevRegistry: true },
}));

after(async () => {
  const worker = await workerPromise;
  await worker.stop();
  await rm(await localD1Promise, { recursive: true, force: true });
});

async function api(cookie, command, data, headerOverrides = {}) {
  const worker = await workerPromise;
  const response = await worker.fetch("https://zhuwei.test/api/game", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      ...headerOverrides,
    },
    body: JSON.stringify({ command, data }),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON API response (${response.status}): ${text.slice(0, 500)}`);
  }
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body,
  };
}

async function apiAfterRejectedRequest(cookie, command, data) {
  try {
    return await api(cookie, command, data);
  } catch (error) {
    // unstable_dev closes one local pooled connection when a request is rejected
    // before its body is consumed. Retry only the non-mutating probe that follows.
    assert.match(String(error), /Network connection lost/u);
    return api(cookie, command, data);
  }
}

async function register(label) {
  const worker = await workerPromise;
  const response = await worker.fetch("https://zhuwei.test/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `${label}-${crypto.randomUUID()}@example.test`,
      password: "correct-horse-battery-staple",
      name: label,
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 201, body);
  return (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function setLocalRoomRuleset(roomId, rulesetVersion) {
  const persistTo = await localD1Promise;
  assert.match(roomId, /^[a-zA-Z0-9_:-]+$/u);
  assert.match(rulesetVersion, /^[a-zA-Z0-9._:-]+$/u);
  await execFileAsync(process.execPath, [
    fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    "dist/server/wrangler.json",
    "--persist-to",
    persistTo,
    "--command",
    `UPDATE rooms SET ruleset_version = '${rulesetVersion}' WHERE id = '${roomId}'`,
  ], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    maxBuffer: 4 * 1024 * 1024,
  });
}

function characterDraft(name, flaw = "多疑") {
  return {
    name,
    raceId: "human",
    classId: "fighter",
    subclassId: "champion",
    backgroundId: "soldier",
    scores: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
    extraSkillIds: [],
    cantrips: [],
    prepared: [],
    spellbook: [],
    equipmentChoice: 0,
    appearance: "披着深色斗篷。",
    trait: "谨慎",
    ideal: "真相",
    bond: "遗嘱",
    flaw,
  };
}

test("authoritative HTTP poll, reconnect, ACK, and voice expose only the caller's current slot", async () => {
  const hostCookie = await register("观察者验收房主");
  const playerCookie = await register("观察者验收玩家");
  const outsiderCookie = await register("观察者验收外部人");

  const created = await api(hostCookie, "createRoom", { nickname: "房主" });
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  const code = created.body.code;

  const joined = await api(playerCookie, "joinRoom", { code, nickname: "玩家" });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.ok, true);

  for (const [cookie, name] of [
    [hostCookie, "守灯人"],
    [playerCookie, "抄写员"],
  ]) {
    const locked = await api(cookie, "lockCharacter", {
      code,
      draft: characterDraft(
        name,
        cookie === playerCookie ? "PRIVATE_OTHER_CHARACTER_SHEET_SENTINEL" : undefined,
      ),
    });
    assert.equal(locked.status, 200);
    assert.equal(locked.body.ok, true, JSON.stringify(locked.body));
  }

  const started = await api(hostCookie, "startGame", code);
  assert.equal(started.status, 200);
  assert.equal(started.body.ok, true, JSON.stringify(started.body));

  const hostPoll = await api(hostCookie, "fetchTable", code);
  const playerPoll = await api(playerCookie, "fetchTable", code);
  assert.equal(hostPoll.status, 200);
  assert.equal(playerPoll.status, 200);
  assert.equal(hostPoll.cacheControl, "no-store, private");
  assert.equal(playerPoll.cacheControl, "no-store, private");
  assert.equal(hostPoll.body.ok, true, JSON.stringify(hostPoll.body));
  assert.equal(playerPoll.body.ok, true, JSON.stringify(playerPoll.body));
  assert.equal(hostPoll.body.messages.length, 1);
  assert.equal(playerPoll.body.messages.length, 1);
  const roomId = hostPoll.body.room.id;
  const hostDeliveryId = hostPoll.body.messages[0].id;
  const playerDeliveryId = playerPoll.body.messages[0].id;
  assert.notEqual(hostDeliveryId, playerDeliveryId);
  assert.equal(JSON.stringify(playerPoll.body).includes(hostDeliveryId), false);
  assert.equal(JSON.stringify(hostPoll.body).includes(playerDeliveryId), false);
  assert.deepEqual(hostPoll.body.locationThreads, []);
  assert.deepEqual(hostPoll.body.logs, []);
  assert.equal(
    JSON.stringify(hostPoll.body).includes("PRIVATE_OTHER_CHARACTER_SHEET_SENTINEL"),
    false,
  );
  assert.equal(JSON.stringify(hostPoll.body).includes("酒窖之下"), false);

  const hostPollAgain = await api(hostCookie, "fetchTable", code);
  const hostReconnectBeforeAck = await api(hostCookie, "fetchTable", code);
  assert.equal(hostPollAgain.body.messages[0].id, hostDeliveryId);
  assert.equal(hostReconnectBeforeAck.body.messages[0].id, hostDeliveryId);
  assert.equal(hostPollAgain.body.state.currentDeliveryId, hostDeliveryId);
  assert.equal(hostReconnectBeforeAck.body.state.currentDeliveryId, hostDeliveryId);

  const hostManagement = await api(hostCookie, "getRoomManagement", { code });
  assert.equal(hostManagement.status, 200);
  assert.equal(hostManagement.body.ok, true);
  assert.equal(
    JSON.stringify(hostManagement.body).includes("PRIVATE_OTHER_CHARACTER_SHEET_SENTINEL"),
    false,
  );

  const crossOriginAck = await api(hostCookie, "acknowledgeDelivery", {
    code,
    deliveryId: hostDeliveryId,
  }, { origin: "https://malicious.example" });
  assert.equal(crossOriginAck.status, 403);
  assert.equal(crossOriginAck.cacheControl, "no-store, private");
  assert.deepEqual(crossOriginAck.body, { error: "请求来源不可信。" });
  const afterCrossOriginAttempt = await apiAfterRejectedRequest(
    hostCookie,
    "fetchTable",
    code,
  );
  assert.equal(afterCrossOriginAttempt.body.messages[0].id, hostDeliveryId);

  const textPlain = await api(hostCookie, "acknowledgeDelivery", {
    code,
    deliveryId: "delivery:not-present",
  }, {
    origin: "https://zhuwei.test",
    "content-type": "text/plain",
  });
  assert.equal(textPlain.status, 415);
  assert.deepEqual(textPlain.body, { error: "请求内容类型必须是 JSON。" });

  const prototypeCommand = await apiAfterRejectedRequest(
    hostCookie,
    "__proto__",
    null,
  );
  assert.equal(prototypeCommand.status, 404);
  assert.deepEqual(prototypeCommand.body, { error: "未知桌面指令。" });

  const malformedAction = await api(hostCookie, "sendAction", null);
  assert.equal(malformedAction.status, 500);
  assert.deepEqual(malformedAction.body, { error: "桌面暂时无法响应，请稍后再试。" });
  assert.doesNotMatch(JSON.stringify(malformedAction.body), /Cannot read|TypeError|stack|SQL/i);

  const guessedByPlayer = await api(playerCookie, "speakNarration", {
    roomId,
    messageId: hostDeliveryId,
  });
  const guessedByOutsider = await api(outsiderCookie, "speakNarration", {
    roomId,
    messageId: hostDeliveryId,
  });
  const missingReference = await api(playerCookie, "speakNarration", {
    roomId,
    messageId: "delivery:not-present",
  });
  const missingRoomVoice = await api(outsiderCookie, "speakNarration", {
    roomId: `room:not-present:${crypto.randomUUID()}`,
    messageId: hostDeliveryId,
  });
  for (const result of [
    guessedByPlayer,
    guessedByOutsider,
    missingReference,
    missingRoomVoice,
  ]) {
    assert.equal(result.status, 200);
    assert.equal(result.cacheControl, "no-store, private");
    assert.deepEqual(result.body, unavailableNarration);
  }

  const outsiderAck = await api(outsiderCookie, "acknowledgeDelivery", {
    code,
    deliveryId: hostDeliveryId,
  });
  const missingRoomAck = await api(outsiderCookie, "acknowledgeDelivery", {
    code: "ZZZZZZ",
    deliveryId: hostDeliveryId,
  });
  for (const result of [outsiderAck, missingRoomAck]) {
    assert.equal(result.status, 200);
    assert.equal(result.cacheControl, "no-store, private");
    assert.deepEqual(result.body, {
      ok: false,
      error: "当前回应已确认或不再可用",
    });
  }

  const acknowledged = await api(hostCookie, "acknowledgeDelivery", {
    code,
    deliveryId: hostDeliveryId,
  });
  assert.equal(acknowledged.status, 200);
  assert.deepEqual(acknowledged.body, { ok: true, deliveryId: hostDeliveryId });

  const refreshed = await api(hostCookie, "fetchTable", code);
  const reconnected = await api(hostCookie, "fetchTable", code);
  assert.deepEqual(refreshed.body.messages, []);
  assert.deepEqual(reconnected.body.messages, []);
  assert.equal(JSON.stringify(refreshed.body).includes(hostDeliveryId), false);
  assert.equal(JSON.stringify(reconnected.body).includes(hostDeliveryId), false);

  const voiceAfterAck = await api(hostCookie, "speakNarration", {
    roomId,
    messageId: hostDeliveryId,
  });
  assert.equal(voiceAfterAck.status, 200);
  assert.deepEqual(voiceAfterAck.body, unavailableNarration);

  const forgedTranscriptInput = await api(playerCookie, "transcribeAudio", {
    mime: "audio/webm",
    b64: "",
    actorId: "character:host",
    principalId: "principal:host",
    transcript: "PRIVATE_TRANSCRIPT_SENTINEL",
  });
  assert.equal(forgedTranscriptInput.status, 200);
  assert.equal(forgedTranscriptInput.cacheControl, "no-store, private");
  assert.deepEqual(forgedTranscriptInput.body, {
    ok: false,
    error: "录音过长，请说得更短一些",
  });
  assert.equal(JSON.stringify(forgedTranscriptInput.body).includes("PRIVATE_TRANSCRIPT_SENTINEL"), false);

  const playerStillCurrent = await api(playerCookie, "fetchTable", code);
  assert.equal(playerStillCurrent.body.messages[0].id, playerDeliveryId);
  assert.equal(JSON.stringify(playerStillCurrent.body).includes(hostDeliveryId), false);

  const invitation = await api(hostCookie, "inviteSquad", {
    code,
    targetUserId: playerPoll.body.me.userId,
    submissionId: `submission:http-private-pending:${crypto.randomUUID()}`,
  });
  assert.equal(invitation.status, 200);
  assert.equal(invitation.body.ok, true, JSON.stringify(invitation.body));
  assert.equal(invitation.body.outcome.kind, "awaitingInput");
  const projectedPending = invitation.body.outcome.readModel.pendingInputs.find(
    (entry) => entry.pendingInputId === invitation.body.outcome.pending.pendingInputId,
  );
  assert.deepEqual(invitation.body.outcome.pending, projectedPending);
  assert.doesNotMatch(
    JSON.stringify(invitation.body.outcome.pending),
    /controllerPrincipalId|internalCandidates|privateWindowState/,
  );
  assert.equal(
    JSON.stringify(invitation.body).includes("PRIVATE_PENDING_CANDIDATE_SENTINEL"),
    false,
  );

  await setLocalRoomRuleset(roomId, "unknown-future-ruleset-v999");
  const unknownRulesetVoice = await api(hostCookie, "speakNarration", {
    roomId,
    messageId: playerDeliveryId,
  });
  assert.equal(unknownRulesetVoice.status, 200);
  assert.deepEqual(unknownRulesetVoice.body, unavailableNarration);
  const unknownRulesetAck = await api(hostCookie, "acknowledgeDelivery", {
    code,
    deliveryId: playerDeliveryId,
  });
  assert.equal(unknownRulesetAck.status, 200);
  assert.deepEqual(unknownRulesetAck.body, {
    ok: false,
    error: "当前回应已确认或不再可用",
  });
});
