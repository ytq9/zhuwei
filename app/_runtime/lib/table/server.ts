import {
  authMiddleware,
  createServerFn,
  PublicServerError,
} from "@/lib/platform/server-fn";
import { getSql } from "@/lib/db";
import { roomCode, uid } from "@/lib/utils";
import { compileSheet, ensureGear } from "@/lib/dnd/compute";
import type { FeatId } from "@/lib/dnd/resources";
import type { CharacterSheet, DraftSheet } from "@/lib/dnd/types";
import { GEAR_SLOTS, type GearSlot } from "@/lib/dnd/gear";
import { getModule, listModules } from "@/lib/module";
import { SOCIAL_RESOLUTION_MODULE_VERSION } from "@/lib/module/authoritative";
import { pinnedModuleRef } from "@/lib/module/registry";
import { AUTHORITATIVE_RULESET_VERSION } from "@/lib/rules/ruleset";
import type { RoomActionInput } from "@/lib/room/action";
import {
  acknowledgeAuthoritativeDelivery,
  activateAuthoritativeMember,
  authoritativeCharacterId,
  cancelAuthoritativeRoomDeletion,
  departAuthoritativeMember,
  finalizeAuthoritativeRoomDeletion,
  initializeAuthoritativeRoom,
  introduceAuthoritativeSuccessor,
  materializeAuthoritativeCharacter,
  observeAuthoritativeRoom,
  prepareAuthoritativeRoomDeletion,
  removeAuthoritativeMember,
  retryAuthoritativeViewerNarration,
  runAuthoritativeRoomAction,
  runAuthoritativePartyAction,
  type AuthoritativePartyAction,
  transferAndDepartAuthoritativeHost,
} from "@/lib/room/server";
import { kpModelConfigurationError } from "@/lib/kp/provider";
import {
  authoritativeKpProfileByBinding,
  authoritativeKpProfileByModelId,
  hasExactV3KpWorkflowManifest,
  isV3AuthoritativeKpProfile,
  PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON,
  runtimeManifestForExactV3KpWorkflow,
} from "@/lib/kp/authoritative-policy";
import { canonicalJson } from "@/lib/kp/authoritative-helpers";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "@/lib/kp/model-registry";
import { hasExactV3KpGenerationBinding } from "@/lib/room/v3-binding";
import {
  AUTHORITATIVE_KP_MODEL,
  isAuthoritativeKpModel,
  publicKpModelId,
} from "@/lib/kp/models";
import {
  buildAuthoritativeActionInput,
  buildAuthoritativeButtonAction,
  buildAuthoritativeCharacterSeed,
  buildAuthoritativeRoomSeeds,
  buildAuthoritativeTableState,
  publicAuthoritativeOutcomeError,
  publicNarrationFailureReason,
  publicV3FailureCode,
  projectAuthoritativeTableObservation,
} from "@/lib/table/authoritative";
import {
  synchronizeAuthoritativeGrowthStaticCard,
  synchronizeGrowthAfterAuthoritativeOutcome,
} from "@/lib/table/authoritative-growth";
import { buildRoomTelemetryEvent } from "@/lib/room/telemetry";
import type { LeaveKind } from "@/lib/kp/combat";

function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function overlayRuleResources(
  sheet: CharacterSheet,
  viewer: {
    hp?: { current: number; max: number };
    resources: Array<{ id: string; current: number; max?: number }>;
    loadout?: {
      armorClass: number;
      speedFeet: number;
      equipped: Record<string, string>;
      backpack: Array<{ itemId: string; quantity: number }>;
    };
  } | undefined,
) {
  if (!viewer) return sheet;
  const next = structuredClone(sheet);
  if (viewer.hp) next.hp = { ...next.hp, ...viewer.hp };
  const inspiration = viewer.resources.find((pool) => pool.id === "inspiration");
  if (inspiration) next.inspiration = inspiration.current > 0;
  if (next.resources) {
    const resources = next.resources as unknown as Record<string, unknown>;
    for (const pool of viewer.resources) {
      const current = resources[pool.id];
      if (current && typeof current === "object" && "max" in current) {
        const charge = current as { max: number; used: number };
        const maximum = pool.max ?? charge.max;
        resources[pool.id] = {
          ...charge,
          max: maximum,
          used: Math.max(0, maximum - pool.current),
        };
      } else if (typeof current === "number") {
        resources[pool.id] = pool.current;
      }
    }
  }
  if (viewer.loadout) {
    next.ac = viewer.loadout.armorClass;
    next.speed = viewer.loadout.speedFeet;
    next.equipped = structuredClone(viewer.loadout.equipped);
    next.backpack = viewer.loadout.backpack.map(({ itemId, quantity }) => ({
      itemId,
      qty: quantity,
    }));
  }
  return next;
}

function emptyCharacterSheet(name: string): CharacterSheet {
  return {
    name,
    raceId: "",
    classId: "",
    subclassId: "",
    backgroundId: "",
    level: 3,
    scores: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: [],
    expertise: [],
    cantrips: [],
    prepared: [],
    spellbook: [],
    equipment: [],
    appearance: "",
    trait: "",
    ideal: "",
    bond: "",
    flaw: "",
    hp: { current: 0, max: 0, temp: 0 },
    ac: 0,
    speed: 0,
    proficiency: 2,
    deathSaves: { success: 0, fail: 0 },
    conditions: [],
    inspiration: false,
    features: [],
  };
}

function observerIdentitySheet(name: string): CharacterSheet {
  return {
    ...emptyCharacterSheet(name),
    observerSummary: true,
  } as CharacterSheet;
}

function authoritativeSubmissionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const submissionId = value.trim();
  return submissionId && submissionId.length <= 200 ? submissionId : undefined;
}

function hasExactTableInputKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

async function bestEffortSynchronizeAuthoritativeGrowthCard(input: {
  roomId: string;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  let result: "synchronized" | "unchanged" | "failed" = "failed";
  try {
    const observation = await observeAuthoritativeRoom(input.roomId, input.userId);
    const sql = await getSql();
    const current = (await sql<{ sheet: unknown }>`
      select sheet from characters
      where room_id = ${input.roomId} and user_id = ${input.userId}
    `)[0];
    if (current !== undefined) {
      const synchronized = await synchronizeAuthoritativeGrowthStaticCard({
        currentStaticCard: current.sheet,
        observation,
        writeStaticCard: async (card) => {
          await sql`
            update characters
            set sheet = ${JSON.stringify(card)}::jsonb, updated_at = now()
            where room_id = ${input.roomId} and user_id = ${input.userId}
          `;
        },
      });
      result = synchronized.kind;
    }
  } catch {
    result = "failed";
  }
  if (result === "unchanged") return;
  const event = buildRoomTelemetryEvent({
    occurredAt: new Date().toISOString(),
    severity: result === "synchronized" ? "info" : "warn",
    eventName: result === "synchronized"
      ? "room.static-card-sync.completed"
      : "room.static-card-sync.failed",
    correlation: { roomId: input.roomId, principalId: input.userId },
    outcome: { kind: result },
    measurements: {
      operationKind: "directorySync",
      durationMs: Math.max(0, Date.now() - startedAt),
    },
  });
  const serialized = JSON.stringify(event);
  if (result === "synchronized") console.info(serialized);
  else console.warn(serialized);
}

function authoritativeRoomKpProfileIsAvailable(
  model: string,
  modelProfileVersion: string,
): boolean {
  return authoritativeKpProfileByBinding(model, modelProfileVersion) !== undefined;
}

async function submitAuthoritativeTableAction(input: {
  roomId: string;
  userId: string;
  model: string;
  modelProfileVersion: string;
  submissionId: string;
  action: RoomActionInput;
}) {
  const sql = await getSql();
  const workflow = (await sql<{ kp_workflow_manifest: string | null }>`
    select kp_workflow_manifest from rooms where id = ${input.roomId}
  `)[0];
  const v3 = hasExactV3KpWorkflowManifest(workflow?.kp_workflow_manifest);
  if (!authoritativeRoomKpProfileIsAvailable(input.model, input.modelProfileVersion)) {
    const failure = {
      ok: false as const,
      submissionId: input.submissionId,
      error: "本桌绑定的权威 KP 模型 Profile 已不可用",
    };
    return v3
      ? {
          submissionId: input.submissionId,
          action: "notCommitted" as const,
          narration: "notApplicable" as const,
          error: failure.error,
        }
      : failure;
  }
  const committedOutcome = await runAuthoritativeRoomAction({
    roomId: input.roomId,
    userId: input.userId,
    modelId: input.model,
    modelProfileVersion: input.modelProfileVersion,
    action: input.action,
  });
  const outcome = await synchronizeGrowthAfterAuthoritativeOutcome({
    outcome: committedOutcome,
    synchronize: () => bestEffortSynchronizeAuthoritativeGrowthCard(input),
  });
  return authoritativeTableOutcome(input.submissionId, outcome, v3);
}

async function submitAuthoritativePartyTableAction(input: {
  roomId: string;
  userId: string;
  model: string;
  modelProfileVersion: string;
  submissionId: string;
  action: AuthoritativePartyAction;
}) {
  const sql = await getSql();
  const workflow = (await sql<{ kp_workflow_manifest: string | null }>`
    select kp_workflow_manifest from rooms where id = ${input.roomId}
  `)[0];
  const v3 = hasExactV3KpWorkflowManifest(workflow?.kp_workflow_manifest);
  if (!authoritativeRoomKpProfileIsAvailable(input.model, input.modelProfileVersion)) {
    const failure = {
      ok: false as const,
      submissionId: input.submissionId,
      error: "本桌绑定的权威 KP 模型 Profile 已不可用",
    };
    return v3
      ? {
          submissionId: input.submissionId,
          action: "notCommitted" as const,
          narration: "notApplicable" as const,
          error: failure.error,
        }
      : failure;
  }
  const outcome = await runAuthoritativePartyAction({
    roomId: input.roomId,
    userId: input.userId,
    modelId: input.model,
    modelProfileVersion: input.modelProfileVersion,
    submissionId: input.submissionId,
    action: input.action,
  });
  return authoritativeTableOutcome(input.submissionId, outcome, v3);
}

function authoritativeTableOutcome(
  submissionId: string,
  outcome:
    | Awaited<ReturnType<typeof runAuthoritativeRoomAction>>
    | Awaited<ReturnType<typeof runAuthoritativePartyAction>>,
  v3 = false,
) {
  const failureCode = publicV3FailureCode(
    "narrationFailureCode" in outcome
      ? outcome.narrationFailureCode
      : "code" in outcome ? outcome.code : undefined,
  );
  const v3Outcome = () => {
    const source = outcome as unknown as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of [
      "code",
      "kind",
      "retryAfter",
    ]) {
      if (Object.hasOwn(source, key)) result[key] = source[key];
    }
    const receipt = source.receipt;
    if (typeof receipt === "object" && receipt !== null && !Array.isArray(receipt)) {
      const record = receipt as Record<string, unknown>;
      if (
        typeof record.receiptId === "string"
        && typeof record.rootActionId === "string"
        && typeof record.status === "string"
        && typeof record.runtimeEpochId === "string"
        && typeof record.activeBranchId === "string"
      ) {
        // The Room/archive receipt intentionally retains exact event ranges,
        // scope versions, and per-request randomness commitments.  A V3 table
        // response exposes only this fixed-cardinality identity/status view so
        // an area effect cannot reveal hidden target counts through lengths.
        result.receipt = {
          receiptId: record.receiptId,
          rootActionId: record.rootActionId,
          status: record.status,
          runtimeEpochId: record.runtimeEpochId,
          activeBranchId: record.activeBranchId,
        };
      }
    }
    return result;
  };
  const publicView = outcome as unknown as {
    kind: string;
    action?: string;
    narration?: string;
    delivery?: unknown;
    deliveryPending?: boolean;
  };
  const actionState = typeof publicView.action === "string"
    ? publicView.action
    : publicView.kind === "awaitingInput" || publicView.kind === "awaitingPlayerRoll"
      ? "awaitingInput"
      : publicView.kind === "committed"
        ? "committed"
        : publicView.kind === "concluded"
          ? "concluded"
          : "notCommitted";
  const narrationState = typeof publicView.narration === "string"
    ? publicView.narration
    : (publicView.kind === "committed" || publicView.kind === "concluded")
      ? publicView.delivery !== undefined
        ? "published"
        : publicView.deliveryPending === true
          ? "retryableFailure"
          : "notApplicable"
      : "notApplicable";
  if (
    (outcome.kind === "committed" || outcome.kind === "concluded")
    && (narrationState === "rejected" || narrationState === "retryableFailure")
  ) {
    const result = {
      ok: false as const,
      submissionId,
      outcomeKind: outcome.kind,
      action: actionState,
      narration: narrationState,
      committed: true as const,
      retryable: true as const,
      error: `行动已经提交；${publicNarrationFailureReason(failureCode)}。请重试；不会重复执行行动。`,
    };
    if (!v3) return result;
    const { ok: _ok, committed: _committed, ...v3Result } = result;
    return {
      ...v3Result,
      ...(failureCode === undefined ? {} : { code: failureCode }),
    };
  }
  if (
    outcome.kind === "committed" ||
    outcome.kind === "awaitingInput" ||
    outcome.kind === "awaitingPlayerRoll" ||
    outcome.kind === "concluded"
  ) {
    const result = {
      ok: true as const,
      submissionId,
      action: actionState,
      narration: narrationState,
      outcome: v3 ? v3Outcome() : outcome,
    };
    if (!v3) return result;
    const { ok: _ok, ...v3Result } = result;
    return {
      ...v3Result,
      ...(failureCode === undefined ? {} : { code: failureCode }),
    };
  }
  if (outcome.kind === "rejected") {
    const result = {
      ok: false as const,
      submissionId,
      outcomeKind: outcome.kind,
      action: actionState,
      narration: narrationState,
      error: outcome.explanation || "当前行动没有被接受",
    };
    if (!v3) return result;
    const { ok: _ok, ...v3Result } = result;
    return {
      ...v3Result,
      ...(failureCode === undefined ? {} : { code: failureCode }),
    };
  }
  const result = {
    ok: false as const,
    submissionId,
    outcomeKind: outcome.kind,
    action: actionState,
    narration: narrationState,
    retryable: true as const,
    error: publicAuthoritativeOutcomeError(outcome),
  };
  if (!v3) return result;
  const { ok: _ok, ...v3Result } = result;
  return {
    ...v3Result,
    ...(failureCode === undefined ? {} : { code: failureCode }),
  };
}

function viewerNarrationRecoveryTableOutcome(outcome: {
  kind: string;
  action?: string;
  narration?: string;
  narrationFailureCode?: unknown;
}) {
  const action = outcome.action === "committed" ? "committed" as const : "notCommitted" as const;
  const narration = outcome.narration === "published"
    || outcome.narration === "rejected"
    || outcome.narration === "retryableFailure"
    ? outcome.narration
    : "notApplicable" as const;
  const failureCode = publicV3FailureCode(outcome.narrationFailureCode);
  if (action === "committed" && narration === "published") {
    return { action, narration };
  }
  return {
    action,
    narration,
    ...(failureCode === undefined ? {} : { code: failureCode }),
    error: action === "committed"
      ? `行动保持已提交；${publicNarrationFailureReason(failureCode)}。重试只恢复回复，不会重新裁定、掷骰或消耗资源。`
      : "当前没有可恢复的 KP 回复。",
  };
}

function publicActionInputFailure(
  error: string,
  v3: boolean,
  submissionId?: string,
) {
  if (!v3) return { ok: false as const, error };
  return {
    ...(submissionId === undefined || submissionId.length === 0 ? {} : { submissionId }),
    action: "notCommitted" as const,
    narration: "notApplicable" as const,
    error,
  };
}

function authoritativeAdministrationError(
  result: { ok: true } | { ok: false; error: string },
) {
  return result.ok
    ? undefined
    : { ok: false as const, error: result.error };
}

async function roomRuleset(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
) {
  return (
    await sql<{
      ruleset_version: string;
      module_id: string;
      kp_model: string;
      kp_model_profile: string;
      kp_workflow_manifest: string | null;
      status: string;
    }>`
      select ruleset_version, module_id, kp_model, kp_model_profile,
             kp_workflow_manifest, status
      from rooms where id = ${roomId}
    `
  )[0];
}

async function memberOf(roomId: string, userId: string) {
  const sql = await getSql();
  const rows = await sql<{ is_host: boolean; nickname: string }>`
    select is_host, nickname from room_members
    where room_id = ${roomId} and user_id = ${userId}
  `;
  if (!rows[0]) throw new PublicServerError("你不在这一桌");
  return rows[0];
}

async function roomByCode(code: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string; code: string }>`
    select id, code from rooms where code = ${code.toUpperCase()}
  `;
  return rows[0] ?? null;
}

export const listMyRooms = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      id: string;
      code: string;
      title: string;
      status: string;
      is_host: boolean;
      created_at: string;
    }>`
      select r.id, r.code, r.title, r.status, m.is_host, r.created_at
      from rooms r
      join room_members m on m.room_id = r.id
      where m.user_id = ${context.userId}
      order by r.created_at desc
      limit 20
    `;
  });

export const getRoomManagement = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    if (!me.is_host) {
      return { ok: false as const, error: "只有房主能管理这张桌" };
    }
    const sql = await getSql();
    const roomInfo = (
      await sql<{
        code: string;
        title: string;
        status: string;
        ruleset_version: string;
        kp_model: string;
        kp_model_profile: string;
      }>`
        select code, title, status, ruleset_version, kp_model, kp_model_profile
        from rooms
        where id = ${room.id} and host_user_id = ${context.userId}
      `
    )[0];
    if (!roomInfo) {
      return { ok: false as const, error: "房主状态已经变化，请刷新酒馆" };
    }
    const characterRows = await sql<{
      user_id: string;
      locked: boolean;
      sheet: unknown;
      updated_at: string;
    }>`
      select user_id, locked, sheet, updated_at
      from characters
      where room_id = ${room.id}
      order by updated_at desc
    `;
    const managementMembers = roomInfo.ruleset_version === AUTHORITATIVE_RULESET_VERSION
      && roomInfo.status === "play"
      ? await sql<{ user_id: string; nickname: string }>`
          select user_id, nickname from room_members where room_id = ${room.id}
        `
      : [];
    const nicknameByUserId = new Map(
      managementMembers.map((member) => [member.user_id, member.nickname]),
    );
    return {
      ok: true as const,
      room: {
        code: roomInfo.code,
        title: roomInfo.title,
        status: roomInfo.status,
        ruleset_version: roomInfo.ruleset_version,
        kp_model: publicKpModelId(roomInfo.kp_model),
      },
      characters: characterRows.map((character) => ({
        userId: character.user_id,
        locked: character.locked,
        sheet: roomInfo.ruleset_version === AUTHORITATIVE_RULESET_VERSION
            && roomInfo.status === "play"
            && character.user_id !== context.userId
          ? observerIdentitySheet(
              nicknameByUserId.get(character.user_id) ?? "在座玩家",
            )
          : asJson<CharacterSheet>(character.sheet, {} as CharacterSheet),
        ...(roomInfo.ruleset_version === AUTHORITATIVE_RULESET_VERSION
            && roomInfo.status === "play"
            && character.user_id !== context.userId
          ? { visibility: "identityOnly" as const }
          : {}),
        updatedAt: character.updated_at,
      })),
    };
  });

export const deleteRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    if (!me.is_host) {
      return { ok: false as const, error: "只有房主能删除这张桌" };
    }
    const sql = await getSql();
    const directory = (await sql<{
      id: string;
      code: string;
      host_user_id: string;
      ruleset_version: string;
      runtime_epoch_id: string | null;
      status: string;
    }>`
      select id, code, host_user_id, ruleset_version, runtime_epoch_id, status
      from rooms
      where id = ${room.id} and host_user_id = ${context.userId}
    `)[0];
    if (!directory) {
      return { ok: false as const, error: "房主状态已经变化，请刷新酒馆" };
    }
    const previousStatus = directory.status;
    const markedHere = previousStatus !== "deleting";
    if (markedHere) {
      await sql`
        update rooms
        set status = ${"deleting"}
        where id = ${room.id} and host_user_id = ${context.userId}
          and status = ${previousStatus}
      `;
    }
    const marked = (await sql<{ id: string; status: string }>`
      select id, status from rooms
      where id = ${room.id} and host_user_id = ${context.userId}
    `)[0];
    if (marked?.status !== "deleting") {
      return { ok: false as const, error: "桌子状态已经变化，请刷新后再试" };
    }

    const restoreDirectoryStatus = async (): Promise<"restored" | "missing" | "unknown"> => {
      if (!markedHere) return "unknown";
      try {
        await sql`
          update rooms
          set status = ${previousStatus}
          where id = ${room.id} and host_user_id = ${context.userId}
            and status = ${"deleting"}
        `;
        const restored = (await sql<{ id: string; status: string }>`
          select id, status from rooms
          where id = ${room.id} and host_user_id = ${context.userId}
        `)[0];
        if (!restored) return "missing";
        return restored.status === previousStatus ? "restored" : "unknown";
      } catch {
        return "unknown";
      }
    };

    const initializedAuthority = directory.ruleset_version === AUTHORITATIVE_RULESET_VERSION
      && directory.runtime_epoch_id !== null;
    const finalizeAuthorityCleanup = async (): Promise<
      "finalized" | "scheduled" | "notApplicable"
    > => {
      if (!initializedAuthority) return "notApplicable";
      try {
        const result = await finalizeAuthoritativeRoomDeletion({ roomId: room.id });
        return result
          && typeof result === "object"
          && (result as { kind?: unknown }).kind === "deletionFinalized"
          ? "finalized"
          : "scheduled";
      } catch {
        return "scheduled";
      }
    };
    if (initializedAuthority) {
      let prepared: unknown;
      try {
        prepared = await prepareAuthoritativeRoomDeletion({
          roomId: room.id,
          userId: context.userId,
        });
      } catch {
        const recovery = await restoreDirectoryStatus();
        if (recovery === "restored") {
          await cancelAuthoritativeRoomDeletion({
            roomId: room.id,
            userId: context.userId,
          }).catch(() => undefined);
        } else if (recovery === "missing") {
          const authorityCleanup = await finalizeAuthorityCleanup();
          return { ok: true as const, code: room.code, authorityCleanup };
        }
        return { ok: false as const, error: "房间权威暂时无法准备删除，请稍后再试" };
      }
      if (
        !prepared
        || typeof prepared !== "object"
        || (prepared as { kind?: unknown }).kind !== "deletionPrepared"
      ) {
        const recovery = await restoreDirectoryStatus();
        if (recovery === "restored") {
          await cancelAuthoritativeRoomDeletion({
            roomId: room.id,
            userId: context.userId,
          }).catch(() => undefined);
        } else if (recovery === "missing") {
          const authorityCleanup = await finalizeAuthorityCleanup();
          return { ok: true as const, code: room.code, authorityCleanup };
        }
        return { ok: false as const, error: "房间权威没有接受删除，请刷新后再试" };
      }
    }

    try {
      await sql`
        delete from rooms
        where id = ${room.id} and host_user_id = ${context.userId}
          and status = ${"deleting"}
      `;
      const remaining = await sql<{ id: string }>`
        select id from rooms where id = ${room.id}
      `;
      if (remaining[0]) throw new Error("room directory delete was not committed");
    } catch {
      const recovery = await restoreDirectoryStatus();
      if (recovery === "missing") {
        const authorityCleanup = await finalizeAuthorityCleanup();
        return { ok: true as const, code: room.code, authorityCleanup };
      }
      if (recovery === "restored" && initializedAuthority) {
        await cancelAuthoritativeRoomDeletion({
          roomId: room.id,
          userId: context.userId,
        }).catch(() => undefined);
      }
      return { ok: false as const, error: "桌子没有删除，请刷新后再试" };
    }
    // D1 absence is the terminal directory decision. If this best-effort RPC
    // is lost, the persisted Room alarm repeats the same D1 check and clears
    // the object without recreating directory state. The response distinguishes
    // immediate proof from scheduled reconciliation instead of claiming both.
    const authorityCleanup = await finalizeAuthorityCleanup();
    return { ok: true as const, code: room.code, authorityCleanup };
  });

export const getCatalog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ modules: listModules() }));

export const createRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { nickname: string; model?: string }) => input)
  .handler(async ({ context, data }) => {
    const model = data.model === undefined ? AUTHORITATIVE_KP_MODEL : data.model;
    const profile = authoritativeKpProfileByModelId(model);
    if (!isAuthoritativeKpModel(model) || profile === undefined) {
      return { ok: false as const, error: "这个模型不支持新规则房间" };
    }
    const sql = await getSql();
    const id = uid("room");
    let code = roomCode();
    for (let i = 0; i < 6; i++) {
      const exists = await sql<{ code: string }>`select code from rooms where code = ${code}`;
      if (!exists[0]) break;
      code = roomCode();
    }
    const nick = data.nickname.trim().slice(0, 16) || "房主";
    await sql`
      insert into rooms (
        id, code, host_user_id, title, module_id, ruleset_version,
        kp_model, kp_model_profile, kp_workflow_manifest,
        kp_context_planner_profile, status
      )
      values (
        ${id}, ${code}, ${context.userId}, ${"黑橡居酒屋的第三份遗嘱"},
        ${"black-oak-will"}, ${AUTHORITATIVE_RULESET_VERSION}, ${profile.modelId},
        ${profile.modelProfileVersion}, ${PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON},
        ${DISABLED_CONTEXT_PLANNER_PROFILE_REF}, ${"lobby"}
      )
    `;
    await sql`
      insert into room_members (room_id, user_id, nickname, is_host)
      values (${id}, ${context.userId}, ${nick}, true)
    `;
    return { ok: true as const, code };
  });

export const joinRoom = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; nickname: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION) {
      return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
    }
    const existing = await sql<{ user_id: string; joined_at: string }>`
      select user_id, joined_at from room_members
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    const authoritativePlay =
      rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION && rules.status === "play";
    if (existing[0] && !authoritativePlay) {
      return { ok: true as const, code: room.code };
    }
    const count = await sql<{ n: number }>`
      select count(*)::int as n from room_members where room_id = ${room.id}
    `;
    if (!existing[0] && (count[0]?.n ?? 0) >= 5) {
      return { ok: false as const, error: "这桌已经满了" };
    }
    const nick = data.nickname.trim().slice(0, 16) || "冒险者";
    if (authoritativePlay) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) {
        return { ok: false as const, error: "入席缺少可重试提交标识" };
      }
      if (existing[0]) {
        try {
          const observed: unknown = await observeAuthoritativeRoom(room.id, context.userId);
          if (
            observed && typeof observed === "object" && "readModel" in observed
            && observed.readModel && typeof observed.readModel === "object"
            && "kind" in observed.readModel && observed.readModel.kind === "projected"
          ) {
            return { ok: true as const, code: room.code };
          }
        } catch {
          // An inactive Room seat is repaired below with the caller's stable submission id.
        }
      }
      const character = (
        await sql<{ sheet: unknown; locked: boolean }>`
          select sheet, locked from characters
          where room_id = ${room.id} and user_id = ${context.userId}
        `
      )[0];
      if (existing[0] && !character?.locked) {
        return { ok: true as const, code: room.code };
      }
      const activated = await activateAuthoritativeMember({
        roomId: room.id,
        commandId: `table:${submissionId}:join`,
        principalId: context.userId,
        role: "player",
        ...(character?.locked
          ? { characterId: authoritativeCharacterId(context.userId) }
          : {}),
      });
      const activationError = authoritativeAdministrationError(activated);
      if (activationError) return activationError;
      if (!existing[0]) {
        await sql`
          insert into room_members (room_id, user_id, nickname, is_host)
          values (${room.id}, ${context.userId}, ${nick}, false)
          on conflict (room_id, user_id) do nothing
        `;
      }
      return { ok: true as const, code: room.code };
    }
    if (!existing[0]) {
      await sql`
        insert into room_members (room_id, user_id, nickname, is_host)
        values (${room.id}, ${context.userId}, ${nick}, false)
      `;
    }
    return { ok: true as const, code: room.code };
  });

export const fetchTable = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: string) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const sql = await getSql();
    const meRow = (
      await sql<{ is_host: boolean; nickname: string }>`
        select is_host, nickname from room_members
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    if (!meRow) {
      return {
        ok: false as const,
        left: true as const,
        error: "你已离开这一桌。人物卡还留着，用房间码可以再进来。",
      };
    }
    const me = meRow;
    const info = (
      await sql<{
        id: string;
        code: string;
        title: string;
        status: string;
        module_id: string;
        ruleset_version: string;
        kp_model: string;
        kp_model_profile: string;
      }>`
        select id, code, title, status, module_id, ruleset_version,
               kp_model, kp_model_profile
        from rooms where id = ${room.id}
      `
    )[0];
    const members = await sql<{
      user_id: string;
      nickname: string;
      is_host: boolean;
    }>`
      select user_id, nickname, is_host from room_members
      where room_id = ${room.id}
      order by joined_at asc
    `;
    const characters = await sql<{
      user_id: string;
      locked: boolean;
      sheet: unknown;
    }>`
      select c.user_id, c.locked, c.sheet
      from characters c
      join room_members m on m.room_id = c.room_id and m.user_id = c.user_id
      where c.room_id = ${room.id}
    `;
    const publicRoomInfo = {
      id: info.id,
      code: info.code,
      title: info.title,
      status: info.status,
      module_id: info.module_id,
      ruleset_version: info.ruleset_version,
      kp_model: publicKpModelId(info.kp_model),
    };
    if (info.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      if (
        authoritativeKpProfileByBinding(
          info.kp_model,
          info.kp_model_profile,
        ) === undefined
      ) {
        return { ok: false as const, error: "本桌绑定的权威 KP 模型 Profile 已不可用" };
      }
      const module = getModule(info.module_id);
      const allScenes = module.chapters.flatMap((chapter) => chapter.scenes);
      const locationLabels = Object.fromEntries(
        allScenes.map((scene) => [scene.id, scene.location || scene.name || scene.id]),
      );
      let projected: ReturnType<typeof projectAuthoritativeTableObservation> | null = null;
      if (info.status === "play") {
        try {
          projected = projectAuthoritativeTableObservation({
            userId: context.userId,
            members: members.map((member) => member.user_id),
            locationLabels,
            observation: await observeAuthoritativeRoom(room.id, context.userId),
          });
        } catch {
          const ownsLockedD1Card = characters.some(
            (character) => character.user_id === context.userId && character.locked,
          );
          if (ownsLockedD1Card) {
            return { ok: false as const, error: "房间投影暂时不可用，请稍后刷新" };
          }
        }
      }
      const projectedLifecycle = projected && "lifecycle" in projected
        ? projected.lifecycle
        : undefined;
      const projectedFictionTime = projected && "fictionTime" in projected
        ? projected.fictionTime
        : undefined;
      const authoritativeState = buildAuthoritativeTableState({
        rulesetVersion: info.ruleset_version,
        projected,
      });
      const sceneId = projected?.controlledCharacter?.sceneId ?? allScenes[0]?.id ?? "wake";
      const chapter = module.chapters.find((candidate) =>
        candidate.scenes.some((scene) => scene.id === sceneId)
      );
      const scene = allScenes.find((candidate) => candidate.id === sceneId);

      const authoritativeCharacters = info.status === "play"
        ? await sql<{ user_id: string; locked: boolean; sheet: unknown }>`
            select user_id, locked, sheet from characters where room_id = ${room.id}
          `
        : characters;
      const characterByOwner = new Map(
        authoritativeCharacters.map((character) => [character.user_id, character]),
      );
      const controlledOwnerId = projected?.controlledCharacter?.characterId
        ?.startsWith("character:")
        ? projected.controlledCharacter.characterId.slice("character:".length)
        : undefined;
      const controlledStaticCard = controlledOwnerId === undefined
        ? characterByOwner.get(context.userId)
        : characterByOwner.get(controlledOwnerId) ?? characterByOwner.get(context.userId);

      return {
        ok: true as const,
        me: { userId: context.userId, ...me },
        room: publicRoomInfo,
        members,
        characters: members.map((member) => {
          const ownControlledCharacter = member.user_id === context.userId
            ? projected?.controlledCharacter
            : undefined;
          const staticCard = member.user_id === context.userId
            ? controlledStaticCard
            : characterByOwner.get(member.user_id);
          if (member.user_id !== context.userId && info.status === "play") {
            return {
              userId: member.user_id,
              locked: staticCard?.locked ?? false,
              sheet: observerIdentitySheet(member.nickname || "在座玩家"),
              visibility: "identityOnly" as const,
            };
          }
          const sheet = staticCard === undefined
            ? emptyCharacterSheet(ownControlledCharacter?.name ?? member.nickname ?? "冒险者")
            : ensureGear(asJson<CharacterSheet>(staticCard.sheet, {} as CharacterSheet));
          return {
            userId: member.user_id,
            locked: projectedLifecycle?.kind === "successorRequired"
              && member.user_id === context.userId
              ? false
              : ownControlledCharacter !== undefined || (staticCard?.locked ?? false),
            sheet: ownControlledCharacter
              ? overlayRuleResources(sheet, {
                  hp: ownControlledCharacter.hitPoints
                    ? {
                        current: ownControlledCharacter.hitPoints.current,
                        max: ownControlledCharacter.hitPoints.maximum,
                      }
                    : undefined,
                  resources: Object.entries(
                    ownControlledCharacter.resources ?? {},
                  ).map(([id, current]) => ({
                    id,
                    current,
                    ...(ownControlledCharacter.resourceMaximums?.[id] === undefined
                      ? {}
                      : { max: ownControlledCharacter.resourceMaximums[id] }),
                  })),
                  ...(ownControlledCharacter.loadout === undefined
                    ? {}
                    : { loadout: ownControlledCharacter.loadout }),
                })
              : sheet,
          };
        }),
        messages: projected?.messages ?? [],
        locationThreads: projected?.locationThreads ?? [],
        logs: [],
        state: {
          chapterName: chapter?.name ?? module.chapters[0]?.name ?? "第一章",
          sceneName: scene?.name ?? locationLabels[sceneId] ?? "开场",
          kpBusy: false,
          pendingRolls: projected?.pendingRolls ?? [],
          pendingInputs: projected?.pendingInputs ?? [],
          clues: projected?.clues ?? [],
          npcs: projected?.npcs ?? [],
          sceneId,
          places: projected?.places ?? {},
          placeNames: projected?.placeNames ?? {},
          partySplit: false,
          clocks: {},
          fictionTime: projectedFictionTime,
          currentDeliveryId: projected?.currentDeliveryId,
          receipts: projected?.receipts ?? [],
          authoritative: authoritativeState,
          restVote: null,
          restHold: null,
          squads: projected?.squads ?? [],
          squadInvite: projected?.squadInvite ?? null,
          squadQueue: [],
          combat: null,
          ruleProjection: null,
        },
        module: {
          title: module.title,
          chapters: chapter === undefined
            ? []
            : [{ id: chapter.id, name: chapter.name }],
        },
      };
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const lockCharacter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    draft: DraftSheet;
    submissionId?: string;
    predecessorCharacterId?: string;
    worldEntry?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sheet = compileSheet(data.draft);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION) {
      return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
    }
    const existing = await sql<{ id: string; locked: boolean }>`
      select id, locked from characters
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    if (
      rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION
      && rules.status === "play"
    ) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) {
        return { ok: false as const, error: "锁定人物卡缺少可重试提交标识" };
      }
      const openingScene = getModule(rules.module_id).chapters[0]?.scenes[0]?.id ?? "wake";
      const successor = existing[0]?.locked === true;
      const characterId = successor
        ? `${authoritativeCharacterId(context.userId)}:successor:${submissionId}`
        : authoritativeCharacterId(context.userId);
      const runtimeProfiles = runtimeManifestForExactV3KpWorkflow(
        rules.kp_workflow_manifest,
      );
      if (runtimeProfiles === undefined) {
        return { ok: false as const, error: "本桌的 0.4 Runtime Profile 已不可用" };
      }
      const staticCharacter = buildAuthoritativeCharacterSeed({
        characterId,
        controllerPrincipalId: context.userId,
        sheet,
        sceneId: openingScene,
        runtimeProfiles,
      });
      const materialized = successor
        ? await introduceAuthoritativeSuccessor({
            roomId: room.id,
            commandId: `table:${submissionId}:introduce-successor`,
            principalId: context.userId,
            predecessorCharacterId: data.predecessorCharacterId
              ?? authoritativeCharacterId(context.userId),
            character: staticCharacter,
            worldEntry: data.worldEntry?.trim() || "作为继任冒险者加入当前长团",
          })
        : await materializeAuthoritativeCharacter({
            roomId: room.id,
            commandId: `table:${submissionId}:lock-character`,
            principalId: context.userId,
            character: staticCharacter,
          });
      if (!materialized.ok) {
        return { ok: false as const, error: materialized.error };
      }
      if (existing[0]) {
        await sql`
          update characters
          set sheet = ${JSON.stringify(sheet)}::jsonb, locked = true, updated_at = now()
          where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into characters (id, room_id, user_id, sheet, locked)
          values (${uid("pc")}, ${room.id}, ${context.userId}, ${JSON.stringify(sheet)}::jsonb, true)
        `;
      }
      return { ok: true as const, sheet };
    }
    if (existing[0]?.locked) {
      return { ok: false as const, error: "人物卡已经锁定" };
    }
    if (existing[0]) {
      await sql`
        update characters
        set sheet = ${JSON.stringify(sheet)}::jsonb, locked = true, updated_at = now()
        where id = ${existing[0].id}
      `;
    } else {
      await sql`
        insert into characters (id, room_id, user_id, sheet, locked)
        values (${uid("pc")}, ${room.id}, ${context.userId}, ${JSON.stringify(sheet)}::jsonb, true)
      `;
    }
    return { ok: true as const, sheet };
  });

export const setGear = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      code: string;
      action: "wear" | "stow";
      slot: GearSlot;
      itemId?: string;
      submissionId?: string;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const expectedKeys = data.action === "wear"
      ? ["action", "code", "itemId", "slot", "submissionId"]
      : ["action", "code", "slot", "submissionId"];
    if (
      !hasExactTableInputKeys(data, expectedKeys)
      || typeof data.code !== "string"
      || data.code.trim().length === 0
      || !["wear", "stow"].includes(data.action)
      || !GEAR_SLOTS.some(({ id }) => id === data.slot)
      || (data.action === "wear"
        && (typeof data.itemId !== "string"
          || data.itemId.length === 0
          || data.itemId.length > 300))
    ) return { ok: false as const, error: "装备变更请求无效" };
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const activeRules = await roomRuleset(sql, room.id);
    if (
      activeRules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      || activeRules.status !== "play"
    ) return { ok: false as const, error: "这间房不支持权威装备变更" };
    const submissionId = authoritativeSubmissionId(data.submissionId);
    if (!submissionId) {
      return { ok: false as const, error: "装备变更缺少可重试提交标识" };
    }
    return submitAuthoritativeTableAction({
      roomId: room.id,
      userId: context.userId,
      model: activeRules.kp_model,
      modelProfileVersion: activeRules.kp_model_profile,
      submissionId,
      action: {
        kind: "gear",
        submissionId,
        action: data.action,
        slot: data.slot,
        ...(data.action === "wear" ? { itemId: data.itemId } : {}),
      },
    });
  });

export const useInventoryItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: {
      code: string;
      itemEntryId: string;
      submissionId: string;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    if (
      !hasExactTableInputKeys(data, ["code", "itemEntryId", "submissionId"])
      || typeof data.code !== "string"
      || data.code.trim().length === 0
      || typeof data.itemEntryId !== "string"
      || data.itemEntryId.length === 0
      || data.itemEntryId.length > 300
    ) return { ok: false as const, error: "物品使用请求无效" };
    const submissionId = authoritativeSubmissionId(data.submissionId);
    if (!submissionId) {
      return { ok: false as const, error: "物品使用缺少可重试提交标识" };
    }
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const activeRules = await roomRuleset(sql, room.id);
    if (
      activeRules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      || activeRules.status !== "play"
    ) return { ok: false as const, error: "这间房不支持权威物品使用" };
    return submitAuthoritativeTableAction({
      roomId: room.id,
      userId: context.userId,
      model: activeRules.kp_model,
      modelProfileVersion: activeRules.kp_model_profile,
      submissionId,
      action: {
        kind: "itemActivity",
        submissionId,
        itemEntryId: data.itemEntryId,
      },
    });
  });

export const startGame = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: string) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    if (!me.is_host) return { ok: false as const, error: "只有房主能开始" };
    const sql = await getSql();
    const info = (
      await sql<{
        status: string;
        module_id: string;
        ruleset_version: string;
        kp_model: string;
        kp_model_profile: string;
        kp_workflow_manifest: string | null;
        kp_context_planner_profile: string | null;
      }>`
        select status, module_id, ruleset_version, kp_model, kp_model_profile,
               kp_workflow_manifest, kp_context_planner_profile
        from rooms where id = ${room.id}
      `
    )[0];
    if (info.ruleset_version !== AUTHORITATIVE_RULESET_VERSION) {
      return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
    }
    const authoritativeProfile = authoritativeKpProfileByBinding(
      info.kp_model,
      info.kp_model_profile,
    );
    if (authoritativeProfile === undefined) {
      return { ok: false as const, error: "本桌绑定的权威 KP 模型 Profile 已不可用" };
    }
    if (
      !isV3AuthoritativeKpProfile(authoritativeProfile)
      || !hasExactV3KpWorkflowManifest(info.kp_workflow_manifest)
      || !hasExactV3KpGenerationBinding(authoritativeProfile, info.kp_workflow_manifest)
      || info.kp_context_planner_profile !== DISABLED_CONTEXT_PLANNER_PROFILE_REF
    ) {
      return { ok: false as const, error: "本桌的 V3 工作流或 Context Planner Profile 已不可用" };
    }
    if (info.status === "play") return { ok: true as const };
    const modelError = kpModelConfigurationError(info.kp_model);
    if (modelError) return { ok: false as const, error: modelError };
    const module = getModule(info.module_id);
    const opening = module.chapters[0]?.scenes[0]?.boxedText ?? "蜡烛亮了。你们可以问、看、或动手。";
    const openingNpcs = module.chapters[0]?.scenes[0]?.npcs ?? [];
    const openingScene = module.chapters[0]?.scenes[0]?.id ?? "wake";
    const seated = await sql<{ user_id: string; nickname: string; is_host: boolean }>`
      select user_id, nickname, is_host from room_members where room_id = ${room.id}
    `;
    if (info.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const workflowRuntimeProfiles = runtimeManifestForExactV3KpWorkflow(
        info.kp_workflow_manifest,
      );
      if (workflowRuntimeProfiles === undefined) {
        return { ok: false as const, error: "本桌的 0.4 Runtime Profile 已不可用" };
      }
      const lockedCharacters = await sql<{ user_id: string; sheet: unknown }>`
        select c.user_id, c.sheet
        from characters c
        join room_members m on m.room_id = c.room_id and m.user_id = c.user_id
        where c.room_id = ${room.id} and c.locked = true
      `;
      if (!lockedCharacters.length) {
        return { ok: false as const, error: "至少需要一张已锁定的人物卡才能开始" };
      }
      let seeds: ReturnType<typeof buildAuthoritativeRoomSeeds>;
      try {
        seeds = buildAuthoritativeRoomSeeds({
          members: seated.map((member) => ({
            userId: member.user_id,
            nickname: member.nickname,
            isHost: member.is_host,
          })),
          lockedCharacters: lockedCharacters.map((character) => ({
            userId: character.user_id,
            sheet: asJson<Record<string, unknown>>(character.sheet, {}),
          })),
          openingSceneId: openingScene,
          characterIdFor: authoritativeCharacterId,
          runtimeProfiles: workflowRuntimeProfiles,
        });
      } catch {
        return { ok: false as const, error: "已锁定的人物卡无法初始化，请检查人物姓名" };
      }
      const initialized = await initializeAuthoritativeRoom({
        roomId: room.id,
        moduleId: info.module_id,
        moduleVersion: SOCIAL_RESOLUTION_MODULE_VERSION,
        members: seeds.members,
        characters: seeds.characters,
        runtimeProfiles: workflowRuntimeProfiles,
      });
      if (
        initialized
        && typeof initialized === "object"
        && "kind" in initialized
        && initialized.kind === "rejected"
      ) {
        return { ok: false as const, error: "权威房间初始化失败，请稍后重试" };
      }
      const expectedRuntimeProfiles = workflowRuntimeProfiles;
      if (
        expectedRuntimeProfiles === undefined
        ||
        !("runtimeProfiles" in initialized)
        || canonicalJson(initialized.runtimeProfiles) !== canonicalJson(expectedRuntimeProfiles)
      ) {
        return { ok: false as const, error: "权威房间已绑定到另一套运行时 Profile" };
      }
      const expectedSocialModuleRef = pinnedModuleRef(
        info.module_id,
        SOCIAL_RESOLUTION_MODULE_VERSION,
      );
      if (expectedSocialModuleRef === undefined
          || !("moduleRef" in initialized)
          || canonicalJson(initialized.moduleRef) !== canonicalJson(expectedSocialModuleRef)) {
        return { ok: false as const, error: "权威房间已绑定到另一套模组 Profile" };
      }
      const runtimeEpochId = initialized
        && typeof initialized === "object"
        && "runtimeEpochId" in initialized
        && typeof initialized.runtimeEpochId === "string"
          ? initialized.runtimeEpochId
          : undefined;
      const genesisHash = initialized
        && typeof initialized === "object"
        && "genesisHash" in initialized
        && typeof initialized.genesisHash === "string"
          ? initialized.genesisHash
          : undefined;
      if (!runtimeEpochId || !genesisHash) {
        return {
          ok: false as const,
          error: "权威房间初始化没有返回完整运行时元数据，请稍后重试",
        };
      }
      await sql`
        update rooms
        set status = ${"play"},
            runtime_epoch_id = ${runtimeEpochId},
            genesis_hash = ${genesisHash}
        where id = ${room.id} and host_user_id = ${context.userId}
      `;
      return {
        ok: true as const,
        rulesetVersion: AUTHORITATIVE_RULESET_VERSION,
      };
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const sendAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    text: string;
    submissionId?: string;
    pendingInputId?: string;
    answer?: unknown;
  }) => input)
  .handler(async ({ context, data }) => {
    const text = data.text.trim();
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    const sql = await getSql();
    const info = (
      await sql<{
        status: string;
        module_id: string;
        ruleset_version: string;
        kp_model: string;
        kp_model_profile: string;
        kp_workflow_manifest: string | null;
      }>`
        select status, module_id, ruleset_version, kp_model, kp_model_profile,
               kp_workflow_manifest
        from rooms where id = ${room.id}
      `
    )[0];
    const v3 = hasExactV3KpWorkflowManifest(info.kp_workflow_manifest);
    const suppliedSubmissionId = data.submissionId?.trim();
    if (!text) return publicActionInputFailure("空话不会进桌", v3, suppliedSubmissionId);
    if (text.length > 1200) {
      return publicActionInputFailure("太长了，拆开说", v3, suppliedSubmissionId);
    }
    if (info.status !== "play") {
      return publicActionInputFailure("这一桌还没开团", v3, suppliedSubmissionId);
    }
    const pc = (
      await sql<{ sheet: unknown; locked: boolean }>`
        select sheet, locked from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    if (!pc?.locked) return publicActionInputFailure("先锁定人物卡", v3, suppliedSubmissionId);
    if (info.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      if (
        authoritativeKpProfileByBinding(
          info.kp_model,
          info.kp_model_profile,
        ) === undefined
      ) {
        return publicActionInputFailure(
          "本桌绑定的权威 KP 模型 Profile 已不可用",
          v3,
          suppliedSubmissionId,
        );
      }
      const pendingInputId = data.pendingInputId?.trim();
      if ((suppliedSubmissionId?.length ?? 0) > 200 || (pendingInputId?.length ?? 0) > 200) {
        return publicActionInputFailure("行动标识无效", v3, suppliedSubmissionId);
      }
      const submissionId = suppliedSubmissionId || uid("submission");
      const action = buildAuthoritativeActionInput({
        submissionId,
        text,
        ...(pendingInputId ? { pendingInputId } : {}),
        ...(pendingInputId && data.answer !== undefined ? { answer: data.answer } : {}),
      });
      const committedOutcome = await runAuthoritativeRoomAction({
        roomId: room.id,
        userId: context.userId,
        modelId: info.kp_model,
        modelProfileVersion: info.kp_model_profile,
        action,
      });
      const outcome = await synchronizeGrowthAfterAuthoritativeOutcome({
        outcome: committedOutcome,
        synchronize: () => bestEffortSynchronizeAuthoritativeGrowthCard({
          roomId: room.id,
          userId: context.userId,
        }),
      });
      return authoritativeTableOutcome(
        submissionId,
        outcome,
        v3,
      );
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const retryNarration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; capability: string }) => input)
  .handler(async ({ context, data }) => {
    const capability = data.capability?.trim();
    const room = await roomByCode(data.code);
    if (!room || !capability || capability.length > 200) {
      return {
        action: "notCommitted" as const,
        narration: "notApplicable" as const,
        error: "当前没有可恢复的 KP 回复。",
      };
    }
    const me = await memberOf(room.id, context.userId);
    if (!me) {
      return {
        action: "notCommitted" as const,
        narration: "notApplicable" as const,
        error: "当前没有可恢复的 KP 回复。",
      };
    }
    const sql = await getSql();
    const info = (
      await sql<{
        ruleset_version: string;
        kp_model: string;
        kp_model_profile: string;
        kp_workflow_manifest: string | null;
      }>`
        select ruleset_version, kp_model, kp_model_profile, kp_workflow_manifest
        from rooms where id = ${room.id}
      `
    )[0];
    const profile = authoritativeKpProfileByBinding(
      info?.kp_model,
      info?.kp_model_profile,
    );
    if (
      info?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      || profile === undefined
      || !isV3AuthoritativeKpProfile(profile)
      || !hasExactV3KpWorkflowManifest(info.kp_workflow_manifest)
    ) {
      return {
        action: "notCommitted" as const,
        narration: "notApplicable" as const,
        error: "当前没有可恢复的 KP 回复。",
      };
    }
    const outcome = await retryAuthoritativeViewerNarration({
      roomId: room.id,
      userId: context.userId,
      capability,
      modelId: info.kp_model,
      modelProfileVersion: info.kp_model_profile,
    });
    return viewerNarrationRecoveryTableOutcome(outcome);
  });

export const requestSafetyPause = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; submissionId: string }) => input)
  .handler(async ({ context, data }) => {
    if (!hasExactTableInputKeys(data, ["code", "submissionId"])) {
      return { ok: false as const, error: "安全暂停不接受原因或自由文本" };
    }
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (
      rules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      || rules.status !== "play"
    ) {
      return { ok: false as const, error: "这间房当前不能使用安全暂停" };
    }
    const submissionId = authoritativeSubmissionId(data.submissionId);
    if (!submissionId) {
      return { ok: false as const, error: "安全暂停缺少可重试提交标识" };
    }
    return submitAuthoritativeTableAction({
      roomId: room.id,
      userId: context.userId,
      model: rules.kp_model,
      modelProfileVersion: rules.kp_model_profile,
      submissionId,
      action: { kind: "safetyPause", submissionId },
    });
  });

export const adjustSafetyPresentation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    submissionId: string;
    presentationAdjustment: "fadeToBlack" | "reduceDetail" | "skipSensitiveContent";
  }) => input)
  .handler(async ({ context, data }) => {
    if (!hasExactTableInputKeys(data, [
      "code",
      "presentationAdjustment",
      "submissionId",
    ]) || ![
      "fadeToBlack",
      "reduceDetail",
      "skipSensitiveContent",
    ].includes(data.presentationAdjustment)) {
      return { ok: false as const, error: "安全调整只接受已注册的最小呈现选项" };
    }
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (
      rules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      || rules.status !== "play"
    ) {
      return { ok: false as const, error: "这间房当前不能提交安全调整" };
    }
    const submissionId = authoritativeSubmissionId(data.submissionId);
    if (!submissionId) {
      return { ok: false as const, error: "安全调整缺少可重试提交标识" };
    }
    return submitAuthoritativeTableAction({
      roomId: room.id,
      userId: context.userId,
      model: rules.kp_model,
      modelProfileVersion: rules.kp_model_profile,
      submissionId,
      action: {
        kind: "safetyAdjust",
        submissionId,
        presentationAdjustment: data.presentationAdjustment,
      },
    });
  });

export const acknowledgeDelivery = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; deliveryId: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    const unavailable = () => ({
      ok: false as const,
      error: "当前回应已确认或不再可用",
    });
    if (!room) return unavailable();
    const deliveryId = data.deliveryId.trim();
    if (!deliveryId || deliveryId.length > 200) {
      return { ok: false as const, error: "回应标识无效" };
    }
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION) {
      return unavailable();
    }
    const result = await acknowledgeAuthoritativeDelivery(
      room.id,
      context.userId,
      deliveryId,
    );
    const acknowledged: unknown = result;
    if (
      acknowledged &&
      typeof acknowledged === "object" &&
      "kind" in acknowledged &&
      acknowledged.kind === "acknowledged"
    ) {
      return { ok: true as const, deliveryId };
    }
    return unavailable();
  });

export const resolveRoll = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    rollId: string;
    boostIds?: string[];
    submissionId?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const roomInfo = (
      await sql<{
        module_id: string;
        ruleset_version: string;
        kp_model: string;
        kp_model_profile: string;
      }>`
        select module_id, ruleset_version, kp_model, kp_model_profile
        from rooms where id = ${room.id}
      `
    )[0];
    if (roomInfo?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      if (Array.isArray(data.boostIds) && data.boostIds.length > 0) {
        return { ok: false as const, error: "权威检定不接受客户端追加骰值或加值" };
      }
      return submitAuthoritativeTableAction({
        roomId: room.id,
        userId: context.userId,
        model: roomInfo.kp_model,
        modelProfileVersion: roomInfo.kp_model_profile,
        submissionId,
        action: {
          kind: "roll",
          submissionId,
          randomnessId: data.rollId,
        },
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const joinCombat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      return submitAuthoritativeTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: buildAuthoritativeButtonAction({
          submissionId,
          command: { kind: "joinCombat" },
        }),
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const extraAttack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; targetId: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      try {
        return submitAuthoritativeTableAction({
          roomId: room.id,
          userId: context.userId,
          model: rules.kp_model,
          modelProfileVersion: rules.kp_model_profile,
          submissionId,
          action: buildAuthoritativeButtonAction({
            submissionId,
            command: { kind: "extraAttack", targetId: data.targetId },
          }),
        });
      } catch {
        return { ok: false as const, submissionId, error: "必须明确选择一个可见目标" };
      }
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const endTurn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      return submitAuthoritativeTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: buildAuthoritativeButtonAction({
          submissionId,
          command: { kind: "endTurn" },
        }),
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const leaveFight = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; kind: LeaveKind; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      return submitAuthoritativeTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: buildAuthoritativeButtonAction({
          submissionId,
          command: { kind: "leaveFight", leaveKind: data.kind },
        }),
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const resolveReact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    reactId: string;
    use: boolean;
    submissionId?: string;
    pendingInputId?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      try {
        return submitAuthoritativeTableAction({
          roomId: room.id,
          userId: context.userId,
          model: rules.kp_model,
          modelProfileVersion: rules.kp_model_profile,
          submissionId,
          action: buildAuthoritativeButtonAction({
            submissionId,
            pendingInputId: data.pendingInputId?.trim() || data.reactId,
            command: {
              kind: "resolveReact",
              reactionId: data.reactId,
              use: data.use,
            },
          }),
        });
      } catch {
        return { ok: false as const, submissionId, error: "当前反应选择无效" };
      }
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const restNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    kind: "short" | "long";
    mode?: "personal" | "group";
    hitDice?: number;
    arcaneRecoverySlotLevels?: number[];
    submissionId?: string;
    pendingInputId?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      return submitAuthoritativeTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: buildAuthoritativeButtonAction({
          submissionId,
          ...(data.pendingInputId ? { pendingInputId: data.pendingInputId } : {}),
          command: {
            kind: "restNow",
            restKind: data.kind,
            mode: data.mode,
            hitDice: data.hitDice,
            arcaneRecoverySlotLevels: data.arcaneRecoverySlotLevels,
          },
        }),
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const cancelRest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    submissionId?: string;
    pendingInputId?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      return submitAuthoritativeTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: buildAuthoritativeButtonAction({
          submissionId,
          ...(data.pendingInputId ? { pendingInputId: data.pendingInputId } : {}),
          command: { kind: "cancelRest" },
        }),
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const castSpell = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    spellId: string;
    slot?: number;
    targetIds?: string[];
    choice?: string;
    destinationFeet?: number;
    originFeet?: number;
    ritual?: boolean;
    submissionId?: string;
    pendingInputId?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      try {
        return submitAuthoritativeTableAction({
          roomId: room.id,
          userId: context.userId,
          model: rules.kp_model,
          modelProfileVersion: rules.kp_model_profile,
          submissionId,
          action: buildAuthoritativeButtonAction({
            submissionId,
            ...(data.pendingInputId ? { pendingInputId: data.pendingInputId } : {}),
            command: {
              kind: "castSpell",
              spellId: data.spellId,
              slot: data.slot,
              targetIds: data.targetIds,
              choice: data.choice,
              destinationFeet: data.destinationFeet,
              originFeet: data.originFeet,
              ritual: data.ritual,
            },
          }),
        });
      } catch {
        return { ok: false as const, submissionId, error: "法术选择或目标无效" };
      }
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const useFeature = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    feat: FeatId;
    submissionId?: string;
    pendingInputId?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      return submitAuthoritativeTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: buildAuthoritativeButtonAction({
          submissionId,
          ...(data.pendingInputId ? { pendingInputId: data.pendingInputId } : {}),
          command: { kind: "useFeature", featureId: data.feat },
        }),
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const useHitDie = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    submissionId?: string;
    pendingInputId?: string;
  }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      return submitAuthoritativeTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: buildAuthoritativeButtonAction({
          submissionId,
          ...(data.pendingInputId ? { pendingInputId: data.pendingInputId } : {}),
          command: { kind: "useHitDie" },
        }),
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

async function detachAuthoritativeDirectory(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  userId: string,
  nextHostUserId?: string,
) {
  if (nextHostUserId !== undefined) {
    await sql`
      update room_members set is_host = false
      where room_id = ${roomId} and user_id = ${userId}
    `;
    await sql`
      update room_members set is_host = true
      where room_id = ${roomId} and user_id = ${nextHostUserId}
    `;
    await sql`
      update rooms set host_user_id = ${nextHostUserId}
      where id = ${roomId} and host_user_id = ${userId}
    `;
  }
  await sql`
    delete from room_members where room_id = ${roomId} and user_id = ${userId}
  `;
}

export const kickMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; userId: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    if (!me.is_host) return { ok: false as const, error: "只有房主能请离" };
    if (data.userId === context.userId) return { ok: false as const, error: "房主不能请离自己" };
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION) {
      return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
    }
    if (
      rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION
      && rules.status === "play"
    ) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) {
        return { ok: false as const, error: "请离缺少可重试提交标识" };
      }
      const removed = await removeAuthoritativeMember({
        roomId: room.id,
        commandId: `table:${submissionId}:kick`,
        principalId: data.userId,
        reason: "hostRemovedMember",
      });
      const removalError = authoritativeAdministrationError(removed);
      if (removalError) return removalError;
      await detachAuthoritativeDirectory(sql, room.id, data.userId);
      return { ok: true as const };
    }
    const there = (
      await sql<{ user_id: string }>`
        select user_id from room_members where room_id = ${room.id} and user_id = ${data.userId}
      `
    )[0];
    if (!there) return { ok: false as const, error: "这人不在桌上" };
    await detachAuthoritativeDirectory(sql, room.id, data.userId);
    return { ok: true as const };
  });

export const leaveTable = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const sql = await getSql();
    const there = (
      await sql<{ user_id: string; is_host: boolean }>`
        select user_id, is_host from room_members
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    if (!there) return { ok: true as const };
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const nextHost = there.is_host
        ? (
            await sql<{ user_id: string }>`
              select user_id from room_members
              where room_id = ${room.id} and user_id <> ${context.userId}
              order by joined_at asc
              limit 1
            `
          )[0]
        : undefined;
      if (there.is_host && !nextHost) {
        return { ok: false as const, error: "最后一位房主请从房间管理页删除房间" };
      }
      if (rules.status === "play") {
        const submissionId = authoritativeSubmissionId(data.submissionId);
        if (!submissionId) {
          return { ok: false as const, error: "离席缺少可重试提交标识" };
        }
        const departed = there.is_host
          ? await transferAndDepartAuthoritativeHost({
              roomId: room.id,
              commandId: `table:${submissionId}:host-leave`,
              fromPrincipalId: context.userId,
              toPrincipalId: nextHost!.user_id,
              reason: "hostLeftTable",
            })
          : await departAuthoritativeMember({
              roomId: room.id,
              commandId: `table:${submissionId}:leave`,
              principalId: context.userId,
              reason: "memberLeftTable",
            });
        const departureError = authoritativeAdministrationError(departed);
        if (departureError) return departureError;
      }
      await detachAuthoritativeDirectory(
        sql,
        room.id,
        context.userId,
        nextHost?.user_id,
      );
      return { ok: true as const };
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const inviteSquad = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; targetUserId: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    if (data.targetUserId === context.userId) {
      return { ok: false as const, error: "不能和自己组队" };
    }
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "同行邀请缺少可重试提交标识" };
      return submitAuthoritativePartyTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: { kind: "invite", targetPrincipalId: data.targetUserId },
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const cancelSquadInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "取消邀请缺少可重试提交标识" };
      return submitAuthoritativePartyTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: { kind: "cancelInvitation" },
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const answerSquad = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; accept: boolean; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "邀请回应缺少可重试提交标识" };
      return submitAuthoritativePartyTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: { kind: "answerInvitation", accept: data.accept },
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const leaveSquadNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "离队缺少可重试提交标识" };
      return submitAuthoritativePartyTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: { kind: "leave" },
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const passCaptain = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; toUserId: string; submissionId?: string }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    if (data.toUserId === context.userId) {
      return { ok: false as const, error: "你已经是队长" };
    }
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "移交队长缺少可重试提交标识" };
      return submitAuthoritativePartyTableAction({
        roomId: room.id,
        userId: context.userId,
        model: rules.kp_model,
        modelProfileVersion: rules.kp_model_profile,
        submissionId,
        action: { kind: "transferLeadership", targetPrincipalId: data.toUserId },
      });
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });

export const approveSquadQueue = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; queueId: string; accept: boolean }) => input)
  .handler(async ({ context, data }) => {
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const rules = await roomRuleset(sql, room.id);
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      return {
        ok: false as const,
        error: "个人合法行动不再进入队长审批队列；成员可直接行动，移动或单独休息时会自动离队。",
      };
    }
    return { ok: false as const, error: "这间房属于 0.4 之前的开发数据，已不再支持" };
  });
