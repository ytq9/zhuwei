#!/usr/bin/env node

import { execFile as nodeExecFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  LIVE_KP_EVAL_MODEL,
  LIVE_KP_EVAL_PRODUCTION_ORIGIN,
  LIVE_KP_EVAL_PROVIDER,
  LIVE_KP_EVAL_REPORT_SCHEMA,
  runLiveKpEvaluation,
} from "./live-kp-eval.mjs";

export const LIVE_KP_PROVISION_REPORT_SCHEMA =
  "zhuwei-live-kp-provision-report-v2";

export const LIVE_KP_CLI_ERROR_CODES = Object.freeze({
  unsupportedArguments: "LIVE_EVAL_UNSUPPORTED_ARGUMENTS",
  invalidTarget: "LIVE_EVAL_INVALID_TARGET",
  hostRegistration: "LIVE_EVAL_HOST_REGISTRATION_FAILED",
  playerRegistration: "LIVE_EVAL_PLAYER_REGISTRATION_FAILED",
  roomCreation: "LIVE_EVAL_ROOM_CREATION_FAILED",
  roomJoin: "LIVE_EVAL_ROOM_JOIN_FAILED",
  hostCharacter: "LIVE_EVAL_HOST_CHARACTER_FAILED",
  playerCharacter: "LIVE_EVAL_PLAYER_CHARACTER_FAILED",
  roomStart: "LIVE_EVAL_ROOM_START_FAILED",
  evaluationExecution: "LIVE_EVAL_EXECUTION_FAILED",
  evaluationStatus: "LIVE_EVAL_STATUS_FAILED",
  evaluationVerification: "LIVE_EVAL_NOT_LIVE_VERIFIED",
  evaluationInteractions: "LIVE_EVAL_INTERACTIONS_INCOMPLETE",
  cleanupIncomplete: "LIVE_EVAL_CLEANUP_INCOMPLETE",
  authCleanup: "LIVE_EVAL_AUTH_CLEANUP_FAILED",
  redaction: "LIVE_EVAL_REDACTION_FAILED",
  unexpected: "LIVE_EVAL_UNEXPECTED_FAILURE",
});

const DEFAULT_TIMEOUT_MS = 60_000;
const SESSION_COOKIE_PATTERN = /^(?:__Host-)?zhuwei_session=[^;\s]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GENERATED_EMAIL_PATTERN = /^zhuwei-live-eval-(host|player)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@example\.test$/u;
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const LOCAL_WRANGLER_EXECUTABLE = fileURLToPath(
  new URL("../node_modules/.bin/wrangler", import.meta.url),
);

class InternalProvisionError extends Error {
  constructor(code) {
    super(code);
    this.name = "InternalProvisionError";
    this.code = code;
  }
}

export class LiveKpProvisionError extends Error {
  constructor(code, report) {
    super(`Live KP evaluation failed (${code}).`);
    this.name = "LiveKpProvisionError";
    this.code = code;
    this.report = report;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("Target must be a credential-free origin.");
  }
  return url.origin;
}

function boundedTimeout(value) {
  return Number.isFinite(value)
    ? Math.max(1_000, Math.min(120_000, Math.floor(value)))
    : DEFAULT_TIMEOUT_MS;
}

function accountState() {
  return { creation: "notAttempted", cookie: undefined, userId: undefined };
}

function cleanupState() {
  return {
    room: {
      status: "notCreated",
      authorityCleanup: "notApplicable",
    },
    sessions: { host: "notCreated", player: "notCreated" },
    authUsers: {
      status: "noneCreated",
      confirmedCount: 0,
      uncertainCount: 0,
    },
  };
}

function stableAuthCleanupFailure() {
  return new InternalProvisionError(LIVE_KP_CLI_ERROR_CODES.authCleanup);
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function exactCleanupUsers(users) {
  if (!Array.isArray(users) || users.length === 0 || users.length > 2) {
    throw stableAuthCleanupFailure();
  }
  const seenRoles = new Set();
  const seenIds = new Set();
  const seenEmails = new Set();
  const normalized = users.map((user) => {
    if (!isRecord(user) || (user.role !== "host" && user.role !== "player")) {
      throw stableAuthCleanupFailure();
    }
    if (typeof user.userId !== "string" || !UUID_PATTERN.test(user.userId)) {
      throw stableAuthCleanupFailure();
    }
    if (typeof user.email !== "string") throw stableAuthCleanupFailure();
    const emailMatch = GENERATED_EMAIL_PATTERN.exec(user.email);
    if (!emailMatch || emailMatch[1] !== user.role || !UUID_PATTERN.test(emailMatch[2])) {
      throw stableAuthCleanupFailure();
    }
    if (
      seenRoles.has(user.role)
      || seenIds.has(user.userId)
      || seenEmails.has(user.email)
    ) {
      throw stableAuthCleanupFailure();
    }
    seenRoles.add(user.role);
    seenIds.add(user.userId);
    seenEmails.add(user.email);
    return { role: user.role, userId: user.userId, email: user.email };
  });
  return normalized.sort((left, right) => left.role.localeCompare(right.role));
}

function runWranglerJson(execFileImpl, command) {
  const args = [
    "d1",
    "execute",
    "zhuwei-dev",
    "--remote",
    "--config",
    "wrangler.jsonc",
    "--yes",
    "--json",
    "--command",
    command,
  ];
  return new Promise((resolve, reject) => {
    execFileImpl(
      LOCAL_WRANGLER_EXECUTABLE,
      args,
      {
        cwd: REPOSITORY_ROOT,
        shell: false,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
      },
      (error, stdout) => {
        if (error) {
          reject(stableAuthCleanupFailure());
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout ?? ""));
          const executions = Array.isArray(parsed) ? parsed : [parsed];
          if (
            executions.length === 0
            || executions.some((entry) => !isRecord(entry) || entry.success !== true)
          ) {
            reject(stableAuthCleanupFailure());
            return;
          }
          resolve(executions);
        } catch {
          reject(stableAuthCleanupFailure());
        }
      },
    );
  });
}

export async function cleanupProvisionedAuthUsers(input) {
  try {
    const users = exactCleanupUsers(input?.users);
    const execFileImpl = input?.execFileImpl ?? nodeExecFile;
    if (typeof execFileImpl !== "function") throw stableAuthCleanupFailure();
    const idList = users.map((user) => sqlLiteral(user.userId)).join(", ");
    const emailList = users.map((user) => sqlLiteral(user.email)).join(", ");
    const exactUserPredicate = users
      .map((user) => `(id = ${sqlLiteral(user.userId)} AND email = ${sqlLiteral(user.email)})`)
      .join(" OR ");
    const deleteSql = [
      `DELETE FROM auth_sessions WHERE user_id IN (${idList});`,
      `DELETE FROM auth_users WHERE ${exactUserPredicate};`,
    ].join(" ");
    await runWranglerJson(execFileImpl, deleteSql);
    const verifySql = [
      "SELECT",
      `(SELECT count(*) FROM auth_users WHERE id IN (${idList}) OR email IN (${emailList})) AS auth_users_remaining,`,
      `(SELECT count(*) FROM auth_sessions WHERE user_id IN (${idList})) AS auth_sessions_remaining;`,
    ].join(" ");
    const verification = await runWranglerJson(execFileImpl, verifySql);
    const rows = verification.flatMap((entry) =>
      Array.isArray(entry.results) ? entry.results : []);
    const counts = rows.find((row) =>
      isRecord(row)
      && Object.hasOwn(row, "auth_users_remaining")
      && Object.hasOwn(row, "auth_sessions_remaining"));
    if (
      !counts
      || Number(counts.auth_users_remaining) !== 0
      || Number(counts.auth_sessions_remaining) !== 0
    ) {
      throw stableAuthCleanupFailure();
    }
    return { status: "deletedAndVerified" };
  } catch {
    throw stableAuthCleanupFailure();
  }
}

function createCredentials(role) {
  const unique = randomUUID();
  return {
    email: `zhuwei-live-eval-${role}-${unique}@example.test`,
    password: `Zv-${randomBytes(32).toString("base64url")}`,
    name: role === "host" ? "线上评测房主" : "线上评测玩家",
  };
}

function fighterDraft(role) {
  if (role === "host") {
    return {
      name: "灰灯卫士",
      raceId: "human",
      classId: "fighter",
      subclassId: "champion",
      backgroundId: "soldier",
      scores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      extraSkillIds: ["perception", "insight", "survival"],
      cantrips: [],
      prepared: [],
      spellbook: [],
      equipmentChoice: 0,
      appearance: "披着灰色旅行斗篷，盾缘留有灯灰。",
      trait: "行动前先观察退路。",
      ideal: "事实必须经得住复核。",
      bond: "保护仍在桌边作出选择的人。",
      flaw: "对未经证实的捷径过分警惕。",
    };
  }
  return {
    name: "河岸守望",
    raceId: "hill-dwarf",
    classId: "fighter",
    subclassId: "battlemaster",
    backgroundId: "soldier",
    scores: { str: 14, dex: 12, con: 15, int: 8, wis: 13, cha: 10 },
    extraSkillIds: ["perception", "survival"],
    cantrips: [],
    prepared: [],
    spellbook: [],
    equipmentChoice: 1,
    appearance: "短辫束在颈后，腰间挂着测距绳。",
    trait: "先确认同伴的位置再推进。",
    ideal: "每个人都应掌握自己的风险。",
    bond: "不让失踪者被当成已经遗忘的人。",
    flaw: "一旦承诺警戒就很难主动撤退。",
  };
}

async function fetchJson(input) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), input.timeoutMs);
  let response;
  try {
    response = await input.fetchImpl(new URL(input.path, input.baseUrl), {
      method: "POST",
      headers: input.headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      redirect: "error",
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw new TypeError("Response was not JSON.");
  }
  return { response, parsed };
}

function sessionCookieFrom(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";", 1)[0]?.trim() ?? "";
  if (!SESSION_COOKIE_PATTERN.test(cookie)) {
    throw new TypeError("Registration did not issue the expected session cookie.");
  }
  return cookie;
}

async function registerActor(input) {
  input.account.creation = "uncertain";
  const { response, parsed } = await fetchJson({
    ...input,
    path: "/api/auth/register",
    headers: {
      "content-type": "application/json",
      origin: input.baseUrl,
    },
    body: input.credentials,
  });
  if (response.status !== 201 || !isRecord(parsed?.user)) {
    input.account.creation = response.status >= 400 ? "notCreated" : "uncertain";
    throw new TypeError("Registration was not accepted.");
  }
  input.account.creation = "confirmed";
  input.account.userId = typeof parsed.user.userId === "string"
    ? parsed.user.userId
    : undefined;
  input.account.cookie = sessionCookieFrom(response);
}

async function gameCommand(input) {
  const { response, parsed } = await fetchJson({
    ...input,
    path: "/api/game",
    headers: {
      "content-type": "application/json",
      cookie: input.cookie,
    },
    body: { command: input.command, data: input.data },
  });
  if (!response.ok || !isRecord(parsed) || parsed.ok !== true) {
    throw new TypeError("Game command was not accepted.");
  }
  return parsed;
}

async function logout(input) {
  try {
    const { response, parsed } = await fetchJson({
      ...input,
      path: "/api/auth/logout",
      headers: { cookie: input.cookie, origin: input.baseUrl },
    });
    return response.ok && parsed?.ok === true ? "revoked" : "revocationUnconfirmed";
  } catch {
    return "revocationUnconfirmed";
  }
}

async function stage(code, action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof InternalProvisionError) throw error;
    throw new InternalProvisionError(code);
  }
}

function publicCleanup(accounts, roomStatus, sessionStatuses, authUserStatus) {
  const confirmedCount = Object.values(accounts)
    .filter((account) => account.creation === "confirmed").length;
  const uncertainCount = Object.values(accounts)
    .filter((account) => account.creation === "uncertain").length;
  return {
    room: roomStatus === "deleteRoomConfirmed"
      ? {
          status: roomStatus,
          authorityCleanup: "finalized",
        }
      : roomStatus === "deleteRoomScheduled"
        ? { status: roomStatus, authorityCleanup: "scheduled" }
        : roomStatus === "deleteRoomUnconfirmed"
          ? { status: roomStatus, authorityCleanup: "unknown" }
          : roomStatus === "creationUnknown"
            ? { status: roomStatus, authorityCleanup: "unknown" }
            : { status: roomStatus, authorityCleanup: "notApplicable" },
    sessions: sessionStatuses,
    authUsers: {
      status: authUserStatus,
      confirmedCount,
      uncertainCount,
    },
  };
}

function cleanupComplete(cleanup) {
  const roomComplete = cleanup.room.status === "deleteRoomConfirmed"
    || cleanup.room.status === "notCreated";
  const sessionsComplete = Object.values(cleanup.sessions).every((status) =>
    status === "revoked" || status === "notCreated");
  const authUsersComplete = cleanup.authUsers.status === "deletedAndVerified"
    || cleanup.authUsers.status === "noneCreated";
  return roomComplete && sessionsComplete && authUsersComplete;
}

function containsAny(value, sensitiveValues) {
  const serialized = JSON.stringify(value);
  return sensitiveValues.some((entry) => typeof entry === "string" && entry && serialized.includes(entry));
}

function evaluationIsRedacted(value) {
  return value?.schemaVersion === LIVE_KP_EVAL_REPORT_SCHEMA
    && value?.redaction?.rawIntentStored === false
    && value?.redaction?.narrationStored === false
    && value?.redaction?.credentialsStored === false
    && value?.redaction?.promptStored === false
    && value?.redaction?.canariesStored === false;
}

function evaluationMatchesPinnedModel(value) {
  return value?.target?.modelId === LIVE_KP_EVAL_MODEL
    && value?.target?.modelProvider === LIVE_KP_EVAL_PROVIDER
    && value?.execution?.mode === "live";
}

function failureReport(code, cleanup, evaluation) {
  return {
    schemaVersion: LIVE_KP_PROVISION_REPORT_SCHEMA,
    status: "error",
    error: { code },
    ...(evaluation ? { evaluation } : {}),
    cleanup,
  };
}

export async function runProvisionedLiveKpEvaluation(options = {}) {
  const accounts = { host: accountState(), player: accountState() };
  const credentials = {
    host: createCredentials("host"),
    player: createCredentials("player"),
  };
  const runId = randomUUID();
  const secretCanary = `ZEVAL-${randomBytes(8).toString("hex").toUpperCase()}`;
  const privatePlanCanary = `ZPLAN-${randomBytes(8).toString("hex").toUpperCase()}`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = boundedTimeout(options.timeoutMs);
  let baseUrl;
  let roomCode;
  let evaluation;
  let failure;
  let roomStatus = "notCreated";
  let sessionStatuses = { host: "notCreated", player: "notCreated" };
  let authUserStatus = "noneCreated";

  try {
    baseUrl = await stage(LIVE_KP_CLI_ERROR_CODES.invalidTarget, async () => {
      const normalized = normalizeOrigin(options.baseUrl ?? LIVE_KP_EVAL_PRODUCTION_ORIGIN);
      if (typeof fetchImpl !== "function") throw new TypeError("Fetch implementation is required.");
      if (
        normalized !== LIVE_KP_EVAL_PRODUCTION_ORIGIN
        && options.allowNonProductionTarget !== true
      ) {
        throw new TypeError("Only the production Worker is allowed.");
      }
      return normalized;
    });

    await stage(LIVE_KP_CLI_ERROR_CODES.hostRegistration, () => registerActor({
      account: accounts.host,
      credentials: credentials.host,
      baseUrl,
      fetchImpl,
      timeoutMs,
    }));
    await stage(LIVE_KP_CLI_ERROR_CODES.playerRegistration, () => registerActor({
      account: accounts.player,
      credentials: credentials.player,
      baseUrl,
      fetchImpl,
      timeoutMs,
    }));

    roomStatus = "creationUnknown";
    const created = await stage(LIVE_KP_CLI_ERROR_CODES.roomCreation, () => gameCommand({
      baseUrl,
      fetchImpl,
      timeoutMs,
      cookie: accounts.host.cookie,
      command: "createRoom",
      data: { nickname: "评测房主" },
    }));
    if (typeof created.code !== "string" || !/^[A-Z0-9]{6}$/u.test(created.code)) {
      throw new InternalProvisionError(LIVE_KP_CLI_ERROR_CODES.roomCreation);
    }
    roomCode = created.code;
    roomStatus = "created";

    await stage(LIVE_KP_CLI_ERROR_CODES.roomJoin, () => gameCommand({
      baseUrl,
      fetchImpl,
      timeoutMs,
      cookie: accounts.player.cookie,
      command: "joinRoom",
      data: {
        code: roomCode,
        nickname: "评测玩家",
        submissionId: `live-eval:${runId}:join-player`,
      },
    }));
    await stage(LIVE_KP_CLI_ERROR_CODES.hostCharacter, () => gameCommand({
      baseUrl,
      fetchImpl,
      timeoutMs,
      cookie: accounts.host.cookie,
      command: "lockCharacter",
      data: {
        code: roomCode,
        draft: fighterDraft("host"),
        submissionId: `live-eval:${runId}:lock-host`,
      },
    }));
    await stage(LIVE_KP_CLI_ERROR_CODES.playerCharacter, () => gameCommand({
      baseUrl,
      fetchImpl,
      timeoutMs,
      cookie: accounts.player.cookie,
      command: "lockCharacter",
      data: {
        code: roomCode,
        draft: fighterDraft("player"),
        submissionId: `live-eval:${runId}:lock-player`,
      },
    }));
    await stage(LIVE_KP_CLI_ERROR_CODES.roomStart, () => gameCommand({
      baseUrl,
      fetchImpl,
      timeoutMs,
      cookie: accounts.host.cookie,
      command: "startGame",
      data: roomCode,
    }));

    const evaluationRunner = options.evaluationRunner ?? runLiveKpEvaluation;
    evaluation = await stage(LIVE_KP_CLI_ERROR_CODES.evaluationExecution, () => evaluationRunner({
      baseUrl,
      roomCode,
      actors: {
        host: { cookie: accounts.host.cookie },
        player: { cookie: accounts.player.cookie },
      },
      fetchImpl,
      timeoutMs,
      allowNonProductionTarget: options.allowNonProductionTarget === true,
      runId,
      secretCanary,
      privatePlanCanary,
    }));
    if (evaluation?.status !== "pass") {
      throw new InternalProvisionError(LIVE_KP_CLI_ERROR_CODES.evaluationStatus);
    }
    if (
      evaluation?.execution?.liveModelVerified !== true
      || !evaluationMatchesPinnedModel(evaluation)
    ) {
      throw new InternalProvisionError(LIVE_KP_CLI_ERROR_CODES.evaluationVerification);
    }
    if (Number(evaluation?.execution?.interactionsCompleted) < 24) {
      throw new InternalProvisionError(LIVE_KP_CLI_ERROR_CODES.evaluationInteractions);
    }
  } catch (error) {
    failure = error instanceof InternalProvisionError
      ? error
      : new InternalProvisionError(LIVE_KP_CLI_ERROR_CODES.unexpected);
  } finally {
    if (roomCode && accounts.host.cookie && baseUrl) {
      try {
        const deleted = await gameCommand({
          baseUrl,
          fetchImpl,
          timeoutMs,
          cookie: accounts.host.cookie,
          command: "deleteRoom",
          data: { code: roomCode },
        });
        roomStatus = deleted.authorityCleanup === "finalized"
          ? "deleteRoomConfirmed"
          : deleted.authorityCleanup === "scheduled"
            ? "deleteRoomScheduled"
            : "deleteRoomUnconfirmed";
      } catch {
        roomStatus = "deleteRoomUnconfirmed";
      }
    }
    for (const role of ["host", "player"]) {
      const account = accounts[role];
      if (account.cookie && baseUrl) {
        sessionStatuses[role] = await logout({
          baseUrl,
          fetchImpl,
          timeoutMs,
          cookie: account.cookie,
        });
      } else if (account.creation === "confirmed") {
        sessionStatuses[role] = "missingCookie";
      } else if (account.creation === "uncertain") {
        sessionStatuses[role] = "unknown";
      }
    }
    const exactUsers = ["host", "player"]
      .filter((role) => accounts[role].creation === "confirmed")
      .map((role) => ({
        role,
        userId: accounts[role].userId,
        email: credentials[role].email,
      }));
    const uncertainCount = Object.values(accounts)
      .filter((account) => account.creation === "uncertain").length;
    if (exactUsers.length > 0) {
      try {
        const validatedUsers = exactCleanupUsers(exactUsers);
        const authCleanup = options.authCleanup ?? ((cleanupInput) =>
          cleanupProvisionedAuthUsers(cleanupInput));
        const result = await authCleanup({ users: validatedUsers });
        authUserStatus = result?.status === "deletedAndVerified" && uncertainCount === 0
          ? "deletedAndVerified"
          : "cleanupUnconfirmed";
      } catch {
        authUserStatus = "cleanupUnconfirmed";
      }
    } else if (uncertainCount > 0) {
      authUserStatus = "creationUnknown";
    }
  }

  const cleanup = publicCleanup(accounts, roomStatus, sessionStatuses, authUserStatus);
  if (!failure && !cleanupComplete(cleanup)) {
    failure = new InternalProvisionError(LIVE_KP_CLI_ERROR_CODES.cleanupIncomplete);
  }
  const sensitiveValues = [
    credentials.host.email,
    credentials.host.password,
    credentials.player.email,
    credentials.player.password,
    accounts.host.cookie,
    accounts.player.cookie,
    accounts.host.userId,
    accounts.player.userId,
    secretCanary,
    privatePlanCanary,
  ];
  if (evaluation && !evaluationIsRedacted(evaluation)) {
    failure = new InternalProvisionError(LIVE_KP_CLI_ERROR_CODES.redaction);
    evaluation = undefined;
  }
  const candidate = failure
    ? failureReport(failure.code, cleanup, evaluation)
    : {
        schemaVersion: LIVE_KP_PROVISION_REPORT_SCHEMA,
        status: "pass",
        evaluation,
        cleanup,
      };
  if (containsAny(candidate, sensitiveValues)) {
    const report = failureReport(LIVE_KP_CLI_ERROR_CODES.redaction, cleanup);
    throw new LiveKpProvisionError(LIVE_KP_CLI_ERROR_CODES.redaction, report);
  }
  if (failure) throw new LiveKpProvisionError(failure.code, candidate);
  return candidate;
}

export async function runProvisionedLiveKpEvalCli(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const write = options.write ?? ((value) => process.stdout.write(value));
  if (argv.length > 0) {
    const report = failureReport(
      LIVE_KP_CLI_ERROR_CODES.unsupportedArguments,
      cleanupState(),
    );
    write(`${JSON.stringify(report)}\n`);
    return 64;
  }
  try {
    const report = await (options.run ?? runProvisionedLiveKpEvaluation)();
    write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    const report = error instanceof LiveKpProvisionError
      ? error.report
      : failureReport(LIVE_KP_CLI_ERROR_CODES.unexpected, cleanupState());
    write(`${JSON.stringify(report)}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  process.exitCode = await runProvisionedLiveKpEvalCli();
}
