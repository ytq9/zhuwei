import {
  authMiddleware,
  createServerFn,
  PublicServerError,
} from "@/lib/platform/server-fn";
import { getSql } from "@/lib/db";
import { abilityMod, roomCode, uid } from "@/lib/utils";
import { compileSheet, ensureGear, casterMod } from "@/lib/dnd/compute";
import { applyCast, applyFeature, applyIncomingDamage, consumeAmmo, dropConcentration, ensureResources, left, longRestSheet, matchSpell, shortRestSheet, spendCharge, spendHitDie, spendHitDice, wantsRest, type FeatId } from "@/lib/dnd/resources";
import type { CharacterSheet, DraftSheet, SkillId } from "@/lib/dnd/types";
import { SKILLS } from "@/lib/dnd/types";
import { acFromGear, stowSlot, wearItem, type GearSlot } from "@/lib/dnd/gear";
import { applyWorldEffect } from "@/lib/dnd/world-items";
import { classById, spellById } from "@/lib/dnd/catalog";
import { d20, d4, eligibleBoosts, rollKind, type BoostId } from "@/lib/dnd/boosts";
import { getModule, listModules } from "@/lib/module";
import { publicNpc } from "@/lib/module/schema";
import { interpretPlayerAction, narrateDecision } from "@/lib/rules/ai-adapter";
import {
  AUTHORITATIVE_RULESET_VERSION,
  rollDie,
  RULESET_VERSION,
} from "@/lib/rules/ruleset";
import type { Command } from "@/lib/rules/model";
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
  commitRoomTurn,
  departRoomPlayer,
  failRoomInterpretation,
  finishRoomNarration,
  initializeRoomAuthority,
  prepareRoomTurn,
  roomProjection,
  synchronizeRoomPlayerLoadout,
  upsertRoomPlayer,
} from "@/lib/room/server";
import type { PendingRoll } from "@/lib/kp/prompt";
import { kpModelConfigurationError, readClueLayer, runKpTurn, KP_BUSY_MSG } from "@/lib/kp/engine";
import { publicPendingRoll } from "@/lib/kp/clue-state";
import { readWorldItemClaims } from "@/lib/kp/action-ruling";
import {
  authoritativeKpProfileByBinding,
  authoritativeKpProfileByModelId,
  hasExactV3KpWorkflowManifest,
  isV3AuthoritativeKpProfile,
  runtimeManifestForExactV3KpWorkflow,
  V4_KP_WORKFLOW_MANIFEST_JSON,
} from "@/lib/kp/authoritative-policy";
import { canonicalJson } from "@/lib/kp/authoritative-helpers";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "@/lib/kp/model-registry";
import {
  CURRENT_RUNTIME_PROFILE_MANIFEST,
} from "@/lib/rules/profiles/manifests";
import { claimsV3RoomBinding } from "@/lib/room/v3-binding";
import {
  AUTHORITATIVE_KP_MODEL,
  isAuthoritativeKpModel,
  isKpModelId,
  isLegacyKpModel,
  publicKpModelId,
  type KpModelId,
} from "@/lib/kp/models";
import { projectLocationMessages } from "@/lib/table/message-projection";
import {
  buildAuthoritativeActionInput,
  buildAuthoritativeButtonAction,
  buildAuthoritativeCharacterSeed,
  buildAuthoritativeRoomSeeds,
  buildAuthoritativeTableState,
  publicAuthoritativeOutcomeError,
  publicV3FailureCode,
  projectAuthoritativeTableObservation,
} from "@/lib/table/authoritative";
import {
  synchronizeAuthoritativeGrowthStaticCard,
  synchronizeGrowthAfterAuthoritativeOutcome,
} from "@/lib/table/authoritative-growth";
import { buildRoomTelemetryEvent } from "@/lib/room/telemetry";
import { openingStances } from "@/lib/kp/stance";
import { placeOf, readWhere } from "@/lib/kp/where";
import { publicClocks, readClocks, readRestHold, restRemain, REST_BEATS, clockOf } from "@/lib/kp/clock";
import { isPlaceBusy, sweepBusyPlaces } from "@/lib/kp/busy";
import {
  joinSquad,
  leaveSquad,
  matesOf,
  readSquadInvite,
  readSquadQueue,
  readSquads,
  squadOf,
  squadRecord,
  isCaptain,
  transferCaptain,
  sweepSquadInvite,
} from "@/lib/kp/squad";
import {
  applyInit,
  asCombat,
  coverAc,
  hurtNpc,
  joinCombat as joinCombatState,
  leaveCombat as applyLeave,
  dropFromCombat,
  nextTurn,
  publicCombat,
  rollDiceExpr,
  shotCheck,
  spendCost,
  weaponAttack,
  type LeaveKind,
} from "@/lib/kp/combat";

function spellTimeIsBonus(id: string) {
  return Boolean(spellById(id)?.time?.includes("附赠"));
}

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
    : publicView.kind === "awaitingInput"
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
      error: "行动已经提交，但 KP 回应尚未送达。请重试；不会重复执行行动。",
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
  if (action === "committed" && narration === "published") {
    return { action, narration };
  }
  return {
    action,
    narration,
    ...(publicV3FailureCode(outcome.narrationFailureCode) === undefined
      ? {}
      : { code: publicV3FailureCode(outcome.narrationFailureCode) }),
    error: action === "committed"
      ? "行动保持已提交，但 KP 回复仍未送达。"
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

async function runRulesV2Action(input: {
  sql: Awaited<ReturnType<typeof getSql>>;
  roomId: string;
  moduleId: string;
  model: KpModelId;
  actorId: string;
  actorName: string;
  text: string;
}) {
  const completeServerDice = async (command: Command, projection: Awaited<ReturnType<typeof prepareRoomTurn>>["projection"]) => {
    if (command.kind !== "combatMove" || command.mode === "disengage" || !projection.combat) {
      return command;
    }
    const mover = projection.combat.order.find(
      (entry) => entry.entityId === command.actorId,
    );
    if (!mover) return command;
    const opportunityRolls: Extract<Command, { kind: "combatMove" }>["opportunityRolls"] = {};
    for (const entry of projection.combat.order) {
      if (
        entry.side === mover.side ||
        entry.economy.reaction === false
      ) {
        continue;
      }
      const enemyView = (await roomProjection(input.roomId, entry.entityId)).projection;
      const attack = enemyView.viewer.attacks.find((candidate) => candidate.kind !== "ranged");
      const reach = attack?.reachFeet ?? 5;
      if (
        !attack ||
        Math.abs(mover.positionFeet - entry.positionFeet) > reach ||
        Math.abs(command.toPositionFeet - entry.positionFeet) <= reach
      ) {
        continue;
      }
      const face = rollDie(20);
      opportunityRolls[entry.entityId] = {
        d20Roll: face,
        damageRolls: Array.from(
          { length: attack.damage.count * (face === 20 ? 2 : 1) },
          () => rollDie(attack.damage.sides),
        ),
      };
    }
    return { ...command, opportunityRolls };
  };
  const module = getModule(input.moduleId);
  let ticket = await prepareRoomTurn(input.roomId, input.actorId);
  const archiveSay = async () => {
    const audience = ticket.projection.visibleEntities
      .filter((entity) => entity.kind === "player")
      .map((entity) => entity.id);
    await input.sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${input.roomId}, ${input.actorId}, ${"say"}, ${input.actorName}, ${input.text},
        ${JSON.stringify({
          place: ticket.projection.viewer.sceneId,
          audience,
          rulesetVersion: RULESET_VERSION,
        })}::jsonb
      )
    `;
  };
  await archiveSay();
  let interpretation = await interpretPlayerAction({
    model: input.model,
    module,
    ticket,
    rawText: input.text,
  });
  if (!interpretation.ok) {
    await failRoomInterpretation(input.roomId, ticket.id);
    return { ok: false as const, error: interpretation.error };
  }
  interpretation = {
    ...interpretation,
    command: await completeServerDice(interpretation.command, ticket.projection),
  };
  let committed = await commitRoomTurn(
    input.roomId,
    ticket.id,
    interpretation.command,
  );
  if (committed.conflictedScope) {
    ticket = await prepareRoomTurn(input.roomId, input.actorId);
    interpretation = await interpretPlayerAction({
      model: input.model,
      module,
      ticket,
      rawText: input.text,
    });
    if (!interpretation.ok) {
      await failRoomInterpretation(input.roomId, ticket.id);
      return { ok: false as const, error: interpretation.error };
    }
    interpretation = {
      ...interpretation,
      command: await completeServerDice(interpretation.command, ticket.projection),
    };
    committed = await commitRoomTurn(input.roomId, ticket.id, interpretation.command);
  }
  const projection =
    committed.projection ?? (await roomProjection(input.roomId, input.actorId)).projection;
  const narration = await narrateDecision({
    model: input.model,
    module,
    rawText: input.text,
    decision: committed.decision,
    projection,
  });
  const place = projection.viewer.sceneId;
  const audience = projection.visibleEntities
    .filter((entity) => entity.kind === "player")
    .map((entity) => entity.id);
  await input.sql`
    insert into messages (id, room_id, user_id, kind, name, body, tts_text, meta)
    values (
      ${uid("msg")}, ${input.roomId}, null,
      ${committed.decision.kind === "rejected" ? "refuse" : committed.decision.kind === "awaitingRoll" ? "call_roll" : "narrate"},
      ${"KP"}, ${narration.speech}, ${narration.tts},
      ${JSON.stringify({
        place,
        audience,
        rulesetVersion: RULESET_VERSION,
        eventIds: narration.referencedEventIds,
        canonicalFacts: narration.canonicalFacts,
      })}::jsonb
    )
  `;
  for (const fact of narration.canonicalFacts) {
    await input.sql`
      insert into session_logs (id, room_id, entry)
      values (${uid("log")}, ${input.roomId}, ${fact})
    `;
  }
  await finishRoomNarration(input.roomId, ticket.id);
  if (projection.combat) {
    await settleNpcCombatTurns({
      sql: input.sql,
      roomId: input.roomId,
      moduleId: input.moduleId,
      model: input.model,
      viewerId: input.actorId,
    });
  }
  return {
    ok: true as const,
    rulesetVersion: RULESET_VERSION,
    decision: committed.decision.kind,
  };
}

type DirectCommand = Command extends infer Candidate
  ? Candidate extends Command
    ? Omit<Candidate, "id" | "actorId" | "expectedVersion">
    : never
  : never;

async function commitRulesV2Direct(
  roomId: string,
  actorId: string,
  draft: DirectCommand,
) {
  let ticket = await prepareRoomTurn(roomId, actorId);
  const makeCommand = () =>
    ({
      ...draft,
      id: crypto.randomUUID(),
      actorId,
      expectedVersion: ticket.stateVersion,
    }) as Command;
  let result = await commitRoomTurn(roomId, ticket.id, makeCommand());
  if (result.conflictedScope) {
    ticket = await prepareRoomTurn(roomId, actorId);
    result = await commitRoomTurn(roomId, ticket.id, makeCommand());
  }
  await finishRoomNarration(roomId, ticket.id);
  return result;
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

async function settleNpcCombatTurns(input: {
  sql: Awaited<ReturnType<typeof getSql>>;
  roomId: string;
  moduleId: string;
  model: KpModelId;
  viewerId: string;
}) {
  for (let turn = 0; turn < 12; turn += 1) {
    const publicView = (await roomProjection(input.roomId, input.viewerId)).projection;
    const combat = publicView.combat;
    if (!combat) return;
    const activeId = combat.order[combat.activeIndex]?.entityId;
    if (!activeId) return;
    const activePublic = publicView.visibleEntities.find((entity) => entity.id === activeId);
    if (activePublic?.kind !== "npc") return;
    const npcView = (await roomProjection(input.roomId, activeId)).projection;
    const attack = npcView.viewer.attacks[0];
    const attackerCombatant = npcView.combat?.order.find(
      (entry) => entry.entityId === activeId,
    );
    const hostileTargets = npcView.combat?.order
      .filter((entry) => entry.side !== attackerCombatant?.side)
      .map((entry) => npcView.visibleEntities.find((entity) => entity.id === entry.entityId))
      .filter((entity) => entity?.kind === "player");
    const target = hostileTargets?.find((entity) => entity?.condition === "active") ?? hostileTargets?.[0];
    if (attack && target && npcView.combat) {
      const targetCombatant = npcView.combat.order.find((entry) => entry.entityId === target.id);
      const distance = attackerCombatant && targetCombatant
        ? Math.abs(attackerCombatant.positionFeet - targetCombatant.positionFeet)
        : 0;
      const adjacentHostile = attack.kind === "ranged" && attackerCombatant
        ? npcView.combat.order.some((entry) => {
            return entry.side !== attackerCombatant.side &&
              Math.abs(entry.positionFeet - attackerCombatant.positionFeet) <= 5;
          })
        : false;
      const rangedDisadvantage =
        attack.kind === "ranged" &&
        (distance > (attack.normalRangeFeet ?? 80) || adjacentHostile);
      const downedAdvantage = target.condition === "down" && distance <= 5;
      const mode = rangedDisadvantage && downedAdvantage
        ? ("normal" as const)
        : rangedDisadvantage
          ? ("disadvantage" as const)
          : downedAdvantage
            ? ("advantage" as const)
            : ("normal" as const);
      const d20Rolls = Array.from({ length: mode === "normal" ? 1 : 2 }, () => rollDie(20));
      const face = mode === "advantage"
        ? Math.max(...d20Rolls)
        : mode === "disadvantage"
          ? Math.min(...d20Rolls)
          : d20Rolls[0];
      const damageRolls = Array.from(
        { length: attack.damage.count * (face === 20 ? 2 : 1) },
        () => rollDie(attack.damage.sides),
      );
      const attacked = await commitRulesV2Direct(input.roomId, activeId, {
        kind: "combatAttack",
        combatId: npcView.combat.id,
        targetId: target.id,
        attackId: attack.id,
        mode,
        d20Rolls,
        damageRolls,
      });
      const projection =
        attacked.projection ?? (await roomProjection(input.roomId, activeId)).projection;
      const narration = await narrateDecision({
        model: input.model,
        module: getModule(input.moduleId),
        rawText: `${activePublic.name} 按已声明的战斗能力攻击 ${target.name}`,
        decision: attacked.decision,
        projection,
      });
      const audience = projection.visibleEntities
        .filter((entity) => entity.kind === "player")
        .map((entity) => entity.id);
      await input.sql`
        insert into messages (id, room_id, user_id, kind, name, body, tts_text, meta)
        values (
          ${uid("msg")}, ${input.roomId}, null, ${"narrate"}, ${"KP"},
          ${narration.speech}, ${narration.tts},
          ${JSON.stringify({
            place: projection.viewer.sceneId,
            audience,
            rulesetVersion: RULESET_VERSION,
            eventIds: narration.referencedEventIds,
            canonicalFacts: narration.canonicalFacts,
          })}::jsonb
        )
      `;
    }
    const after = (await roomProjection(input.roomId, activeId)).projection;
    if (!after.combat) return;
    const ended = await commitRulesV2Direct(input.roomId, activeId, {
      kind: "endCombatTurn",
      combatId: after.combat.id,
    });
    if (ended.decision.kind === "rejected") return;
  }
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

type RestVote = {
  kind: "short" | "long";
  from: string;
  fromName: string;
  agreed: string[];
  hitDice: Record<string, number>;
  arcane: Record<string, number>;
};

function readRestVote(flags: Record<string, unknown>): RestVote | null {
  const raw = flags.restVote;
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<RestVote>;
  if (v.kind !== "short" && v.kind !== "long") return null;
  if (!v.from) return null;
  return {
    kind: v.kind,
    from: String(v.from),
    fromName: String(v.fromName ?? ""),
    agreed: Array.isArray(v.agreed) ? v.agreed.map(String) : [],
    hitDice:
      v.hitDice && typeof v.hitDice === "object" ? (v.hitDice as Record<string, number>) : {},
    arcane:
      v.arcane && typeof v.arcane === "object" ? (v.arcane as Record<string, number>) : {},
  };
}

async function writeFlags(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  flags: Record<string, unknown>,
) {
  await sql`
    update game_states
    set npc_flags = ${JSON.stringify(flags)}::jsonb, updated_at = now()
    where room_id = ${roomId}
  `;
}

async function settleRest(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  kind: "short" | "long",
  actorUserId: string,
  actorName: string,
  vote: RestVote,
) {
  const kp = await runKpTurn({
    roomId,
    actorUserId,
    actorName,
    action: `全员已同意${kind === "long" ? "长休（过夜）" : "短休（约一小时）"}。若此地仍有明确敌对或马上要出事，hat=refuse 并说明为什么不能歇。若可以歇，hat=narrate。不要改人物数字，休整由程序结算。`,
    kind: "action",
  });
  if (!kp.ok) return { ok: false as const, error: kp.error };
  if (kp.hat === "refuse") return { ok: true as const };
  const rows = await seatedLocked(sql, roomId);
  for (const row of rows) {
    if (!vote.agreed.includes(row.user_id)) continue;
    let sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    const who = sheet.name || row.user_id;
    if (kind === "long") {
      const done = longRestSheet(sheet);
      sheet = done.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${roomId} and user_id = ${row.user_id}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body)
        values (${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"}, ${`${who}：${done.note}`})
      `;
    } else {
      const arcane = (vote.arcane[row.user_id] ?? 0) as 0 | 1 | 2;
      sheet = shortRestSheet(sheet, arcane);
      const n = Math.max(0, vote.hitDice[row.user_id] ?? 0);
      const spent = n ? spendHitDice(sheet, n) : { sheet, note: "没有花生命骰。" };
      sheet = spent.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${roomId} and user_id = ${row.user_id}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body)
        values (${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"}, ${`${who} 短休结束。引导、如潮、回气、战术骰已恢复。${spent.note} 生命 ${sheet.hp.current}/${sheet.hp.max}。`})
      `;
    }
  }
  return { ok: true as const };
}

async function requestRestInner(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  _code: string,
  userId: string,
  name: string,
  kind: "short" | "long",
  text: string,
  opts?: { hitDice?: number; arcane?: 0 | 1 | 2 },
) {
  const st = (
    await sql<{ combat: unknown; npc_flags: unknown }>`
      select combat, npc_flags from game_states where room_id = ${roomId}
    `
  )[0];
  if (asCombat(st?.combat)) {
    return { ok: false as const, error: "战斗中不能休整" };
  }
  const locked = await seatedLocked(sql, roomId);
  const flags = asJson<Record<string, unknown>>(st?.npc_flags, {});
  let vote = readRestVote(flags);

  await sql`
    insert into messages (id, room_id, user_id, kind, name, body)
    values (${uid("msg")}, ${roomId}, ${userId}, ${"say"}, ${name}, ${text})
  `;

  if (locked.length <= 1) {
    const alone: RestVote = {
      kind,
      from: userId,
      fromName: name,
      agreed: [userId],
      hitDice: { [userId]: opts?.hitDice ?? 0 },
      arcane: { [userId]: opts?.arcane ?? 0 },
    };
    return settleRest(sql, roomId, kind, userId, name, alone);
  }

  if (vote && vote.kind !== kind) {
    return {
      ok: false as const,
      error: `桌上正在表决${vote.kind === "long" ? "长休" : "短休"}。先反对或等它结束。`,
    };
  }

  if (!vote) {
    vote = {
      kind,
      from: userId,
      fromName: name,
      agreed: [userId],
      hitDice: { [userId]: opts?.hitDice ?? 0 },
      arcane: { [userId]: opts?.arcane ?? 0 },
    };
    flags.restVote = vote;
    await writeFlags(sql, roomId, flags);
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (
        ${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"},
        ${`${name} 提议${kind === "long" ? "长休过夜" : "短休约一小时"}。全员同意才会开始。`}
      )
    `;
    return { ok: true as const };
  }

  if (!vote.agreed.includes(userId)) vote.agreed = [...vote.agreed, userId];
  vote.hitDice = { ...vote.hitDice, [userId]: opts?.hitDice ?? vote.hitDice[userId] ?? 0 };
  vote.arcane = { ...vote.arcane, [userId]: opts?.arcane ?? vote.arcane[userId] ?? 0 };

  if (vote.agreed.length < locked.length) {
    flags.restVote = vote;
    await writeFlags(sql, roomId, flags);
    const waiting = locked
      .filter((r) => !vote!.agreed.includes(r.user_id))
      .map((r) => asJson<CharacterSheet>(r.sheet, {} as CharacterSheet).name || "同伴");
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (
        ${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"},
        ${`${name} 同意${kind === "long" ? "长休" : "短休"}。还等：${waiting.join("、")}。`}
      )
    `;
    return { ok: true as const };
  }

  delete flags.restVote;
  const whereNow = readWhere(flags);
  const sceneId = (
    await sql<{ scene_id: string }>`select scene_id from game_states where room_id = ${roomId}`
  )[0]?.scene_id ?? "wake";
  const proposerPlace = placeOf(whereNow, vote.from, sceneId);
  const resters = locked
    .filter((r) => placeOf(whereNow, r.user_id, sceneId) === proposerPlace)
    .map((r) => r.user_id);
  const actives = locked.filter((r) => !resters.includes(r.user_id));
  if (!actives.length) {
    await writeFlags(sql, roomId, flags);
    return settleRest(sql, roomId, kind, userId, name, { ...vote, agreed: resters });
  }
  const clocks = readClocks(flags);
  const startBeats = Math.max(
    0,
    ...locked.map((r) => clockOf(clocks, r.user_id).beats),
  );
  const needBeats = REST_BEATS[kind];
  flags.restHold = {
    kind,
    resters,
    fromName: vote.fromName,
    startBeats,
    needBeats,
    hitDice: vote.hitDice,
    arcane: vote.arcane,
  };
  await writeFlags(sql, roomId, flags);
  const resterNames = resters.map(
    (id) =>
      asJson<CharacterSheet>(
        locked.find((r) => r.user_id === id)?.sheet,
        {} as CharacterSheet,
      ).name || "同伴",
  );
  await sql`
    insert into messages (id, room_id, user_id, kind, name, body, meta)
    values (
      ${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"},
      ${`${resterNames.join("、")} 开始${kind === "long" ? "长休" : "短休"}（${needBeats} 拍）。另一边可以继续行动；走满 ${needBeats} 拍后休息结束，时间对齐。`},
      ${JSON.stringify({ place: "all" })}::jsonb
    )
  `;
  return { ok: true as const };
}

async function cancelRestInner(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  userId: string,
  name: string,
) {
  const st = (
    await sql<{ npc_flags: unknown }>`
      select npc_flags from game_states where room_id = ${roomId}
    `
  )[0];
  const flags = asJson<Record<string, unknown>>(st?.npc_flags, {});
  const vote = readRestVote(flags);
  const hold = readRestHold(flags);
  if (!vote && !hold) return { ok: false as const, error: "现在没有休整要表决" };
  delete flags.restVote;
  delete flags.restHold;
  await writeFlags(sql, roomId, flags);
  await sql`
    insert into messages (id, room_id, user_id, kind, name, body)
    values (
      ${uid("msg")}, ${roomId}, ${userId}, ${"say"}, ${name}, ${"不同意这次休整"}
    )
  `;
  await sql`
    insert into messages (id, room_id, user_id, kind, name, body, meta)
    values (
      ${uid("msg")}, ${roomId}, null, ${"narrate"}, ${"KP"},
      ${`${name} 打断了${(hold ?? vote)?.kind === "long" ? "长休" : "短休"}。时间没有为休息过去。`},
      ${JSON.stringify({ place: "all" })}::jsonb
    )
  `;
  return { ok: true as const };
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
        ${profile.modelProfileVersion}, ${V4_KP_WORKFLOW_MANIFEST_JSON},
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
    if (
      rules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      && rules?.ruleset_version !== RULESET_VERSION
    ) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
    }
    if (!existing[0]) {
      await sql`
        insert into room_members (room_id, user_id, nickname, is_host)
        values (${room.id}, ${context.userId}, ${nick}, false)
      `;
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      await reseatPlayer(sql, room.id, context.userId);
      if (rules.status === "play") {
        const character = (
          await sql<{ sheet: unknown; locked: boolean }>`
            select sheet, locked from characters
            where room_id = ${room.id} and user_id = ${context.userId}
          `
        )[0];
        if (character?.locked) {
          const sheet = ensureGear(asJson<CharacterSheet>(character.sheet, {} as CharacterSheet));
          await upsertRoomPlayer(room.id, context.userId, sheet);
          const synchronized = await synchronizeRoomPlayerLoadout(
            room.id,
            context.userId,
            sheet,
          );
          if (!synchronized.ok) throw new Error(synchronized.error);
        }
      }
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
          pendingRolls: [],
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
    if (info.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    const messages = await sql<{
      id: string;
      user_id: string | null;
      kind: string;
      name: string;
      body: string;
      tts_text: string | null;
      meta: unknown;
      created_at: string;
    }>`
      select id, user_id, kind, name, body, tts_text, meta, created_at
      from (
        select rowid, id, user_id, kind, name, body, tts_text, meta, created_at
        from messages where room_id = ${room.id}
        order by rowid desc
        limit 400
      )
      order by rowid asc
    `;
    const logs = await sql<{ id: string; entry: string; created_at: string }>`
      select id, entry, created_at from session_logs
      where room_id = ${room.id}
      order by created_at asc
      limit 80
    `;
    const st = (
      await sql<{
        chapter_id: string;
        scene_id: string;
        revealed_clues: unknown;
        npc_flags: unknown;
        combat: unknown;
        pending_rolls: unknown;
        kp_busy: boolean;
      }>`
        select chapter_id, scene_id, revealed_clues, npc_flags, combat, pending_rolls, kp_busy
        from game_states where room_id = ${room.id}
      `
    )[0];
    const module = getModule(info.module_id);
    const ruleSnapshot =
      info.ruleset_version === RULESET_VERSION &&
      info.status === "play" &&
      characters.some(
        (character) => character.user_id === context.userId && character.locked,
      )
        ? await roomProjection(room.id, context.userId)
        : null;
    const revealedIds = asJson<string[]>(st?.revealed_clues, []);
    const flags = asJson<Record<string, unknown>>(st?.npc_flags, {});
    if (sweepBusyPlaces(flags)) {
      void writeFlags(sql, room.id, flags);
    }
    const myPlace =
      ruleSnapshot?.projection.viewer.sceneId ??
      placeOf(readWhere(flags), context.userId, st?.scene_id ?? "wake");
    const visitedRaw = flags.visited;
    const visited: string[] = ruleSnapshot
      ? ruleSnapshot.projection.viewer.visitedSceneIds
      : Array.isArray(
            visitedRaw && typeof visitedRaw === "object"
              ? (visitedRaw as Record<string, unknown>)[context.userId]
              : null,
          )
        ? ((visitedRaw as Record<string, string[]>)[context.userId] ?? [])
        : [myPlace];
    const clueLayer = readClueLayer(flags);
    const v2Knowledge = new Map(
      ruleSnapshot?.projection.knowledge.map((entry) => [entry.clueId, entry.layer]) ?? [],
    );
    const clues = module.clues
      .filter((c) => (ruleSnapshot ? v2Knowledge.has(c.id) : revealedIds.includes(c.id)))
      .map((c) => {
        const v2Layer = v2Knowledge.get(c.id);
        const layer = v2Layer ? (v2Layer === "full" ? "full" : "talk") : (clueLayer[c.id] ?? "full");
        return {
          id: c.id,
          name: c.name,
          text: layer === "full" ? c.playerText : c.talkText,
          hint: c.hint,
          layer,
        };
      });
    const where = readWhere(flags);
    const allScenes = module.chapters.flatMap((c) => c.scenes);
    const labelOf = (id: string) => {
      const s = allScenes.find((x) => x.id === id);
      if (s?.location) return s.location;
      if (s?.name) return s.name;
      return id;
    };
    const placeNames: Record<string, string> = {};
    for (const c of characters) {
      const pid = placeOf(where, c.user_id, st?.scene_id ?? "wake");
      placeNames[c.user_id] = labelOf(pid);
    }
    const myPlaceIds = new Set(
      characters.map((c) => placeOf(where, c.user_id, st?.scene_id ?? "wake")),
    );
    const partySplit = myPlaceIds.size > 1;
    const chapter = module.chapters.find((c) => c.id === st?.chapter_id);
    const scene = chapter?.scenes.find((s) => s.id === st?.scene_id);
    const sceneHere =
      module.chapters.flatMap((c) => c.scenes).find((s) => s.id === myPlace) ?? scene;
    const metIds = Array.isArray(flags.met)
      ? flags.met.map(String)
      : (sceneHere?.npcs ?? []);
    const visibleNpcIds = new Set(
      ruleSnapshot?.projection.visibleEntities
        .filter((entity) => entity.kind === "npc")
        .map((entity) => entity.id) ?? [],
    );
    const npcs = module.npcs
      .filter((n) => ruleSnapshot ? visibleNpcIds.has(n.id) : metIds.includes(n.id))
      .filter((n) => ruleSnapshot || !sceneHere || sceneHere.npcs.includes(n.id))
      .map(publicNpc);
    const locationLabels = Object.fromEntries(
      allScenes.map((scene) => [scene.id, scene.location || scene.name || scene.id]),
    );
    const projectedMessages = projectLocationMessages({
      rows: messages,
      userId: context.userId,
      currentPlace: myPlace,
      visitedPlaces: visited.length ? visited : [myPlace],
      labels: locationLabels,
      userNames: [
        me.nickname,
        ensureGear(
          asJson<CharacterSheet>(
            characters.find((character) => character.user_id === context.userId)?.sheet,
            {} as CharacterSheet,
          ),
        ).name,
      ].filter(Boolean),
    });
    const publicMessage = (m: (typeof messages)[number]) => {
      const meta = asJson<Record<string, unknown>>(m.meta, {});
      const raw = Array.isArray(meta.clues) ? meta.clues : [];
      const pinned = raw
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const o = row as { id?: string; name?: string; hint?: string };
          if (!o.id || !o.name || !o.hint) return null;
          return { id: String(o.id), name: String(o.name), hint: String(o.hint) };
        })
        .filter((clue): clue is { id: string; name: string; hint: string } => Boolean(clue));
      return {
        id: m.id,
        user_id: m.user_id,
        kind: m.kind,
        name: m.name,
        body: m.body,
        created_at: m.created_at,
        clues: pinned,
      };
    };
    const projectedRuleLogs = ruleSnapshot
      ? [...projectedMessages.current, ...projectedMessages.history.flatMap((thread) => thread.messages)]
          .flatMap((message) => {
            const meta = asJson<Record<string, unknown>>(message.meta, {});
            const facts = Array.isArray(meta.canonicalFacts)
              ? meta.canonicalFacts.filter((fact): fact is string => typeof fact === "string")
              : [];
            return facts.map((entry, index) => ({
              id: `${message.id}:fact:${index}`,
              entry,
              created_at: message.created_at,
            }));
          })
      : logs;

    return {
      ok: true as const,
      me: { userId: context.userId, ...me },
      room: publicRoomInfo,
      members,
      characters: characters.map((c) => ({
        userId: c.user_id,
        locked: c.locked,
        sheet: overlayRuleResources(
          ensureGear(asJson<CharacterSheet>(c.sheet, {} as CharacterSheet)),
          ruleSnapshot && c.user_id === context.userId
            ? ruleSnapshot.projection.viewer
            : undefined,
        ),
      })),
      messages: projectedMessages.current.map(publicMessage),
      locationThreads: projectedMessages.history.map((thread) => ({
        placeId: thread.placeId,
        name: thread.name,
        messages: thread.messages.map(publicMessage),
      })),
      logs: projectedRuleLogs,
      state: {
        chapterName: chapter?.name ?? "第一章",
        sceneName: sceneHere?.name ?? scene?.name ?? "开场",
        kpBusy: ruleSnapshot
          ? ruleSnapshot.ux.some((lease) => lease.scopeId === myPlace)
          : isPlaceBusy(flags, myPlace),
        pendingRolls: ruleSnapshot
          ? ruleSnapshot.projection.pendingRolls.map((roll) => ({
              ...roll,
              userId: context.userId,
              name: ruleSnapshot.projection.viewer.name,
              kind: "check" as const,
              advantage: roll.mode === "advantage",
            }))
          : asJson<PendingRoll[]>(st?.pending_rolls, []).map(publicPendingRoll),
        clues,
        npcs,
        sceneId: ruleSnapshot ? myPlace : (st?.scene_id ?? "wake"),
        places: ruleSnapshot
          ? Object.fromEntries(
              characters.map((c) => [
                c.user_id,
                ruleSnapshot.projection.visibleEntities.some(
                  (entity) => entity.kind === "player" && entity.id === c.user_id,
                )
                  ? myPlace
                  : "unknown",
              ]),
            )
          : Object.fromEntries(
              characters.map((c) => [
                c.user_id,
                placeOf(where, c.user_id, st?.scene_id ?? "wake"),
              ]),
            ),
        placeNames: ruleSnapshot
          ? Object.fromEntries(
              characters.map((c) => [
                c.user_id,
                ruleSnapshot.projection.visibleEntities.some(
                  (entity) => entity.kind === "player" && entity.id === c.user_id,
                )
                  ? labelOf(myPlace)
                  : "未知位置",
              ]),
            )
          : placeNames,
        partySplit: ruleSnapshot
          ? ruleSnapshot.projection.visibleEntities.filter((entity) => entity.kind === "player").length <
            characters.length
          : partySplit,
        clocks: ruleSnapshot
          ? {
              [context.userId]: {
                beats: ruleSnapshot.projection.viewer.timeline.spotlightBeat,
                minutes: Math.floor(
                  ruleSnapshot.projection.viewer.timeline.fictionSeconds / 60,
                ),
              },
            }
          : publicClocks(
              readClocks(flags),
              characters.map((c) => c.user_id),
            ),
        restVote: (() => {
          if (ruleSnapshot) {
            const v = ruleSnapshot.projection.restVote;
            if (!v) return null;
            const fromName =
              ensureGear(
                asJson<CharacterSheet>(
                  characters.find((character) => character.user_id === v.proposerId)?.sheet,
                  {} as CharacterSheet,
                ),
              ).name || "同伴";
            return {
              kind: v.kind,
              fromName,
              agreed: v.agreedIds,
              waiting: v.eligibleIds.filter((id) => !v.agreedIds.includes(id)),
            };
          }
          const v = readRestVote(flags);
          if (!v) return null;
          const lockedIds = characters.filter((c) => c.locked).map((c) => c.user_id);
          const waiting = lockedIds.filter((id) => !v.agreed.includes(id));
          return {
            kind: v.kind,
            fromName: v.fromName,
            agreed: v.agreed,
            waiting,
          };
        })(),
        restHold: (() => {
          if (ruleSnapshot) return null;
          const h = readRestHold(flags);
          if (!h) return null;
          return {
            kind: h.kind,
            resters: h.resters,
            fromName: h.fromName,
            needBeats: h.needBeats,
            remain: restRemain(h, readClocks(flags), characters.map((c) => c.user_id)),
          };
        })(),
        squads: ruleSnapshot?.projection.squad
          ? [{
              ids: ruleSnapshot.projection.squad.memberIds,
              captain: ruleSnapshot.projection.squad.captainId,
            }]
          : ruleSnapshot
            ? []
            : readSquads(flags).map((s) => ({
                ids: s.ids,
                captain: s.captain,
              })),
        squadInvite: (() => {
          if (ruleSnapshot) {
            const invite = ruleSnapshot.projection.squadInvites[0];
            if (!invite) return null;
            const fromName =
              ensureGear(
                asJson<CharacterSheet>(
                  characters.find((character) => character.user_id === invite.fromId)?.sheet,
                  {} as CharacterSheet,
                ),
              ).name || "同伴";
            return {
              from: invite.fromId,
              to: invite.toId,
              fromName,
              at: 0,
            };
          }
          if (sweepSquadInvite(flags)) {
            void writeFlags(sql, room.id, flags);
            return null;
          }
          return readSquadInvite(flags);
        })(),
        squadQueue: (() => {
          if (ruleSnapshot) return [];
          const mine = squadRecord(readSquads(flags), context.userId);
          if (!mine) return [];
          return readSquadQueue(flags).filter((q) => mine.ids.includes(q.userId));
        })(),
        combat: ruleSnapshot?.projection.combat
          ? {
              place: ruleSnapshot.projection.combat.sceneId,
              round: ruleSnapshot.projection.combat.round,
              activeId:
                ruleSnapshot.projection.combat.order[
                  ruleSnapshot.projection.combat.activeIndex
                ]?.entityId ?? null,
              waiting: "turn" as const,
              hazards: [],
              reacts: [],
              order: ruleSnapshot.projection.combat.order.map((entry) => {
                const entity = ruleSnapshot.projection.visibleEntities.find(
                  (candidate) => candidate.id === entry.entityId,
                );
                const viewerPosition =
                  ruleSnapshot.projection.combat?.order.find(
                    (candidate) => candidate.entityId === context.userId,
                  )?.positionFeet ?? 0;
                const distance = Math.abs(entry.positionFeet - viewerPosition);
                return {
                  id: entry.entityId,
                  name: entity?.name ?? entry.entityId,
                  kind: entity?.kind === "npc" ? ("npc" as const) : ("pc" as const),
                  init: entry.initiative,
                  band: distance <= 5
                    ? ("melee" as const)
                    : distance <= 30
                      ? ("near" as const)
                      : ("far" as const),
                  cover: "none" as const,
                  inCombat: true,
                  spend: {
                    action: entry.economy.action,
                    bonus: entry.economy.bonusAction,
                    reaction: entry.economy.reaction,
                    attacked: entry.attackedThisTurn ?? false,
                  },
                };
              }),
            }
          : ruleSnapshot
            ? null
            : publicCombat(asCombat(st?.combat)),
        ruleProjection: ruleSnapshot?.projection ?? null,
      },
      module: {
        title: module.title,
        chapters: module.chapters.map((c) => ({ id: c.id, name: c.name })),
      },
    };
  });

export const setRoomModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { code: string; model: string }) => input)
  .handler(async ({ context, data }) => {
    if (!isKpModelId(data.model)) {
      return { ok: false as const, error: "这个模型不在本桌支持范围内" };
    }
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    const me = await memberOf(room.id, context.userId);
    if (!me.is_host) return { ok: false as const, error: "只有房主能选择模型" };
    const sql = await getSql();
    const current = (
      await sql<{ status: string; kp_model: string; ruleset_version: string }>`
        select status, kp_model, ruleset_version from rooms where id = ${room.id}
      `
    )[0];
    if (
      current.ruleset_version === AUTHORITATIVE_RULESET_VERSION
    ) {
      return { ok: false as const, error: "本桌模型在创建时固定，创建后不能更换" };
    }
    if (current.status !== "lobby") {
      return { ok: false as const, error: "守灵已经开始，整桌模型不能再更换" };
    }
    if (current.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (!isLegacyKpModel(data.model)) {
      return { ok: false as const, error: "旧规则房间只支持已配置的 Legacy 模型" };
    }
    await sql`
      update rooms set kp_model = ${data.model}
      where id = ${room.id} and host_user_id = ${context.userId} and status = ${"lobby"}
    `;
    const saved = (
      await sql<{ kp_model: string }>`
        select kp_model from rooms where id = ${room.id}
      `
    )[0];
    if (saved.kp_model !== data.model) {
      return { ok: false as const, error: "模型没有保存，请再试一次" };
    }
    return { ok: true as const, model: data.model };
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
      const staticCharacter = buildAuthoritativeCharacterSeed({
        characterId,
        controllerPrincipalId: context.userId,
        sheet,
        sceneId: openingScene,
        ...(runtimeProfiles === undefined ? {} : { runtimeProfiles }),
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
    if (
      rules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      && rules?.ruleset_version !== RULESET_VERSION
    ) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
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
    if (rules?.ruleset_version === RULESET_VERSION && rules.status === "play") {
      await upsertRoomPlayer(room.id, context.userId, sheet);
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
    const room = await roomByCode(data.code);
    if (!room) return { ok: false as const, error: "找不到这间房" };
    await memberOf(room.id, context.userId);
    const sql = await getSql();
    const activeRules = await roomRuleset(sql, room.id);
    if (
      activeRules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION
      && activeRules.status === "play"
    ) {
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
    }
    if (
      activeRules?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      && activeRules?.ruleset_version !== RULESET_VERSION
    ) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
    }
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    if (!row) return { ok: false as const, error: "还没有人物卡" };
    const sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    const equipped = sheet.equipped ?? {};
    const backpack = sheet.backpack ?? [];
    if (
      (data.action === "wear" && equipped[data.slot] === data.itemId)
      || (data.action === "stow" && equipped[data.slot] === undefined)
    ) {
      return { ok: true as const };
    }
    const next =
      data.action === "stow"
        ? stowSlot(equipped, backpack, data.slot)
        : wearItem(equipped, backpack, data.itemId ?? "", data.slot);
    if ("error" in next && next.error) {
      return { ok: false as const, error: next.error };
    }
    sheet.equipped = next.equipped;
    sheet.backpack = next.backpack;
    sheet.ac = acFromGear(sheet.classId, sheet.scores, sheet.equipped);
    if (activeRules?.ruleset_version === RULESET_VERSION && activeRules.status === "play") {
      const synchronized = await synchronizeRoomPlayerLoadout(
        room.id,
        context.userId,
        sheet,
      );
      if (!synchronized.ok) {
        return { ok: false as const, error: synchronized.error };
      }
    }
    await sql`
      update characters
      set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
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
    if (info.status === "play") return { ok: true as const };
    const authoritativeProfile = info.ruleset_version === AUTHORITATIVE_RULESET_VERSION
      ? authoritativeKpProfileByBinding(info.kp_model, info.kp_model_profile)
      : undefined;
    if (
      info.ruleset_version === AUTHORITATIVE_RULESET_VERSION
      && authoritativeProfile === undefined
    ) {
      return { ok: false as const, error: "本桌绑定的权威 KP 模型 Profile 已不可用" };
    }
    const startClaimsV3 = claimsV3RoomBinding({
      binding: info,
      roomProfile: authoritativeProfile,
    });
    if (startClaimsV3 && (
      authoritativeProfile === undefined
      || !isV3AuthoritativeKpProfile(authoritativeProfile)
      || !hasExactV3KpWorkflowManifest(info.kp_workflow_manifest)
      || info.kp_context_planner_profile !== DISABLED_CONTEXT_PLANNER_PROFILE_REF
    )) {
      return { ok: false as const, error: "本桌的 V3 工作流或 Context Planner Profile 已不可用" };
    }
    if (
      info.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      && !isKpModelId(info.kp_model)
    ) {
      return { ok: false as const, error: "本桌选择的模型已不可用，请重新选择" };
    }
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
          ...(workflowRuntimeProfiles === undefined
            ? {}
            : { runtimeProfiles: workflowRuntimeProfiles }),
        });
      } catch {
        return { ok: false as const, error: "已锁定的人物卡无法初始化，请检查人物姓名" };
      }
      const initialized = await initializeAuthoritativeRoom({
        roomId: room.id,
        moduleId: info.module_id,
        members: seeds.members,
        characters: seeds.characters,
        ...(workflowRuntimeProfiles === undefined
          ? {}
          : { runtimeProfiles: workflowRuntimeProfiles }),
      });
      if (
        initialized
        && typeof initialized === "object"
        && "kind" in initialized
        && initialized.kind === "rejected"
      ) {
        return { ok: false as const, error: "权威房间初始化失败，请稍后重试" };
      }
      const expectedRuntimeProfiles = startClaimsV3
        ? workflowRuntimeProfiles
        : CURRENT_RUNTIME_PROFILE_MANIFEST;
      if (
        expectedRuntimeProfiles === undefined
        ||
        !("runtimeProfiles" in initialized)
        || canonicalJson(initialized.runtimeProfiles) !== canonicalJson(expectedRuntimeProfiles)
      ) {
        return { ok: false as const, error: "权威房间已绑定到另一套运行时 Profile" };
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
    if (info.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (info.ruleset_version === RULESET_VERSION) {
      const ruleCharacters = await sql<{ user_id: string; sheet: unknown }>`
        select user_id, sheet from characters
        where room_id = ${room.id} and locked = true
      `;
      if (!ruleCharacters.length) {
        return { ok: false as const, error: "至少需要一张已锁定的人物卡才能开始" };
      }
      await initializeRoomAuthority({
        roomId: room.id,
        moduleId: info.module_id,
        characters: ruleCharacters.map((character) => ({
          userId: character.user_id,
          sheet: ensureGear(asJson<CharacterSheet>(character.sheet, {} as CharacterSheet)),
        })),
      });
    }
    const where: Record<string, string> = {};
    const visited: Record<string, string[]> = {};
    for (const s of seated) {
      where[s.user_id] = openingScene;
      visited[s.user_id] = [openingScene];
    }
    await sql`update rooms set status = ${"play"} where id = ${room.id} and host_user_id = ${context.userId}`;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, tts_text, meta)
      values (
        ${uid("msg")}, ${room.id}, null, ${"open"}, ${"KP"}, ${opening}, ${opening},
        ${JSON.stringify({ hat: "narrate" })}::jsonb
      )
    `;
    await sql`
      insert into session_logs (id, room_id, entry)
      values (${uid("log")}, ${room.id}, ${"守灵夜开始。"})
    `;
    await sql`
      update game_states
      set npc_flags = ${JSON.stringify({
        met: openingNpcs,
        stance: openingStances(module.npcs),
        where,
        visited,
      })}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    return { ok: true as const };
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
    if (info.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (info.ruleset_version === RULESET_VERSION) {
      if (!isKpModelId(info.kp_model)) {
        return { ok: false as const, error: "本桌选择的模型已不可用，请重新选择" };
      }
      const sheet = ensureGear(asJson<CharacterSheet>(pc.sheet, {} as CharacterSheet));
      const name = sheet.name || me.nickname || "冒险者";
    return runRulesV2Action({
        sql,
        roomId: room.id,
        moduleId: info.module_id,
        model: info.kp_model,
        actorId: context.userId,
        actorName: name,
        text,
      });
    }
    let sheet = ensureGear(asJson<CharacterSheet>(pc.sheet, {} as CharacterSheet));
    const name = sheet.name || me.nickname || "冒险者";
    const flagsNow = asJson<Record<string, unknown>>(
      (
        await sql<{ npc_flags: unknown }>`
          select npc_flags from game_states where room_id = ${room.id}
        `
      )[0]?.npc_flags,
      {},
    );
    const squadsNow = readSquads(flagsNow);
    const mySquad = squadRecord(squadsNow, context.userId);
    if (mySquad && mySquad.captain !== context.userId) {
      const clocks = readClocks(flagsNow);
      const item = {
        id: uid("q"),
        userId: context.userId,
        name,
        body: text,
        beat: clockOf(clocks, mySquad.captain).beats,
      };
      flagsNow.squadQueue = [...readSquadQueue(flagsNow), item];
      await writeFlags(sql, room.id, flagsNow);
      return { ok: true as const, queued: true as const };
    }
    const restKind = wantsRest(text);
    const flagRow = (
      await sql<{ npc_flags: unknown }>`
        select npc_flags from game_states where room_id = ${room.id}
      `
    )[0];
    const voteNow = readRestVote(asJson<Record<string, unknown>>(flagRow?.npc_flags, {}));
    if (restKind) {
      return requestRestInner(sql, room.id, data.code, context.userId, name, restKind, text);
    }
    if (voteNow && /不同意|反对/.test(text) && /休|歇/.test(text)) {
      return cancelRestInner(sql, room.id, context.userId, name);
    }
    const holdNow = readRestHold(asJson<Record<string, unknown>>(flagRow?.npc_flags, {}));
    if (holdNow && /醒来|打断.*休|结束休息/.test(text)) {
      return cancelRestInner(sql, room.id, context.userId, name);
    }
    if (
      voteNow &&
      /同意/.test(text) &&
      /休|歇/.test(text) &&
      !/不同意/.test(text)
    ) {
      return requestRestInner(
        sql,
        room.id,
        data.code,
        context.userId,
        name,
        voteNow.kind,
        text,
      );
    }
    if (/进入狂暴|我狂暴/.test(text)) {
      const feat = applyFeature(sheet, "rage");
      if (!feat.ok) return { ok: false as const, error: feat.error };
      sheet = feat.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    } else if (/动作如潮/.test(text)) {
      const feat = applyFeature(sheet, "surge");
      if (!feat.ok) return { ok: false as const, error: feat.error };
      sheet = feat.sheet;
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
      const stC = (
        await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
      )[0];
      const combat = asCombat(stC?.combat);
      if (combat) {
        const meC = combat.order.find((o) => o.id === context.userId);
        if (meC) {
          const next = {
            ...combat,
            order: combat.order.map((o) =>
              o.id === context.userId
                ? { ...o, spend: { ...(o.spend ?? { action: false, bonus: true, reaction: true, attacked: false }), action: true } }
                : o,
            ),
          };
          await sql`
            update game_states set combat = ${JSON.stringify(next)}::jsonb where room_id = ${room.id}
          `;
        }
      }
    } else {
      const sp = matchSpell(text);
      if (sp && /施放|使用|给自己|祝福|治愈|神导|光亮|侦测|命令|致伤|神圣火焰|护盾/.test(text)) {
        const slot = /二环|2环/.test(text) ? 2 : undefined;
        const cast = applyCast(sheet, sp.id, slot);
        if (!cast.ok) return { ok: false as const, error: cast.error };
        sheet = cast.sheet;
        await sql`
          update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${room.id} and user_id = ${context.userId}
        `;
        const stC = (
          await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
        )[0];
        const combat = asCombat(stC?.combat);
        if (combat?.order.some((o) => o.id === context.userId && o.inCombat)) {
          const cost = spellTimeIsBonus(sp.id) ? "bonus" : "action";
          const spent = spendCost(combat, context.userId, cost);
          if (!spent.ok) {
            return { ok: false as const, error: spent.error };
          }
          await sql`
            update game_states set combat = ${JSON.stringify(spent.combat)}::jsonb where room_id = ${room.id}
          `;
        }
      }
    }
    const flagsSay = (
      await sql<{ npc_flags: unknown; scene_id: string }>`
        select npc_flags, scene_id from game_states where room_id = ${room.id}
      `
    )[0];
    const sayPlace = placeOf(
      readWhere(asJson<Record<string, unknown>>(flagsSay?.npc_flags, {})),
      context.userId,
      flagsSay?.scene_id ?? "wake",
    );
    const sayWhere = readWhere(asJson<Record<string, unknown>>(flagsSay?.npc_flags, {}));
    const sayMembers = await sql<{ user_id: string }>`
      select user_id from room_members where room_id = ${room.id}
    `;
    const sayAudience = sayMembers
      .filter(
        (member) =>
          placeOf(sayWhere, member.user_id, flagsSay?.scene_id ?? "wake") === sayPlace,
      )
      .map((member) => member.user_id);
    const sayId = uid("msg");
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${sayId}, ${room.id}, ${context.userId}, ${"say"}, ${name}, ${text},
        ${JSON.stringify({ place: sayPlace, audience: sayAudience })}::jsonb
      )
    `;
    let lastErr = KP_BUSY_MSG;
    for (let i = 0; i < 8; i++) {
      const kp = await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: name,
        action: text,
        kind: "action",
        consumeSayId: sayId,
      });
      if (kp.ok) return { ok: true as const };
      lastErr = kp.error;
      if (kp.error !== KP_BUSY_MSG) return { ok: false as const, error: kp.error };
      await new Promise((r) => setTimeout(r, 700));
    }
    return { ok: false as const, error: lastErr };
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
    if (rules?.ruleset_version === RULESET_VERSION) {
      await memberOf(room.id, context.userId);
      return { ok: false as const, error: "这间房不使用当前回应确认协议" };
    }
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
      }>`
        select module_id, ruleset_version, kp_model
        from rooms where id = ${room.id}
      `
    )[0];
    if (roomInfo?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      const submissionId = authoritativeSubmissionId(data.submissionId);
      if (!submissionId) return { ok: false as const, error: "行动缺少可重试提交标识" };
      return {
        ok: false as const,
        submissionId,
        error: "权威骰面只能由 Room Authority 在骰前冻结后生成；客户端不能提供骰面。",
      };
    }
    if (roomInfo?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (roomInfo?.ruleset_version === RULESET_VERSION) {
      if (!isKpModelId(roomInfo.kp_model)) {
        return { ok: false as const, error: "本桌选择的模型已不可用，请重新选择" };
      }
      let ticket = await prepareRoomTurn(room.id, context.userId);
      let pending = ticket.projection.pendingRolls.find((entry) => entry.id === data.rollId);
      if (!pending) return { ok: false as const, error: "没有这个检定" };
      const available = new Set(ticket.projection.viewer.availableRollBoosts);
      const chosen = [...new Set(data.boostIds ?? [])];
      if (chosen.some((boost) => !available.has(boost as "guidance" | "inspiration" | "lucky"))) {
        return { ok: false as const, error: "所选加值不在当前规则状态中。" };
      }
      const useInspiration = chosen.includes("inspiration");
      const hasAdvantage = pending.mode === "advantage" || useInspiration;
      const hasDisadvantage = pending.mode === "disadvantage";
      const effectiveMode = hasAdvantage === hasDisadvantage
        ? ("normal" as const)
        : hasAdvantage
          ? ("advantage" as const)
          : ("disadvantage" as const);
      let luckyReplacedOnes = 0;
      const rolled = Array.from({ length: effectiveMode === "normal" ? 1 : 2 }, () => {
        const initial = rollDie(20);
        if (chosen.includes("lucky") && initial === 1) {
          luckyReplacedOnes += 1;
          return rollDie(20);
        }
        return initial;
      });
      const guidanceRoll = chosen.includes("guidance") ? rollDie(4) : undefined;
      const makeCommand = () => ({
        id: crypto.randomUUID(),
        actorId: context.userId,
        expectedVersion: ticket.stateVersion,
        kind: "resolveRoll" as const,
        requestId: data.rollId,
        rolls: rolled,
        boosts: {
          guidanceRoll,
          useInspiration: useInspiration || undefined,
          luckyReplacedOnes: chosen.includes("lucky") ? luckyReplacedOnes : undefined,
        },
      });
      let committed = await commitRoomTurn(room.id, ticket.id, makeCommand());
      if (committed.conflictedScope) {
        ticket = await prepareRoomTurn(room.id, context.userId);
        pending = ticket.projection.pendingRolls.find((entry) => entry.id === data.rollId);
        if (!pending) return { ok: false as const, error: "这个检定已经被结算" };
        committed = await commitRoomTurn(room.id, ticket.id, makeCommand());
      }
      const projection =
        committed.projection ?? (await roomProjection(room.id, context.userId)).projection;
      const module = getModule(roomInfo.module_id);
      const narration = await narrateDecision({
        model: roomInfo.kp_model,
        module,
        rawText: `掷出 ${rolled.join("、")}${guidanceRoll ? `，神导术 d4=${guidanceRoll}` : ""}，结算 ${pending.reason}`,
        decision: committed.decision,
        projection,
      });
      const audience = projection.visibleEntities
        .filter((entity) => entity.kind === "player")
        .map((entity) => entity.id);
      const resolved =
        committed.decision.kind === "committed"
          ? committed.decision.events.find((event) => event.type === "RollResolved")
          : undefined;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${projection.viewer.name},
          ${resolved
            ? `${pending.reason}：${rolled.join(" / ")}，总值 ${resolved.total}，${resolved.success ? "成功" : "失败"}`
            : narration.speech},
          ${JSON.stringify({
            place: projection.viewer.sceneId,
            audience,
            rulesetVersion: RULESET_VERSION,
            requestId: pending.id,
            rolls: rolled,
            boosts: chosen,
            guidanceRoll,
            luckyReplacedOnes,
            total: resolved?.total,
            success: resolved?.success,
          })}::jsonb
        )
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, tts_text, meta)
        values (
          ${uid("msg")}, ${room.id}, null,
          ${committed.decision.kind === "rejected" ? "refuse" : "narrate"},
          ${"KP"}, ${narration.speech}, ${narration.tts},
          ${JSON.stringify({
            place: projection.viewer.sceneId,
            audience,
            rulesetVersion: RULESET_VERSION,
            eventIds: narration.referencedEventIds,
            canonicalFacts: narration.canonicalFacts,
          })}::jsonb
        )
      `;
      for (const fact of narration.canonicalFacts) {
        await sql`
          insert into session_logs (id, room_id, entry)
          values (${uid("log")}, ${room.id}, ${fact})
        `;
      }
      await finishRoomNarration(room.id, ticket.id);
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      return {
        ok: true as const,
        roll: resolved
          ? {
              d20:
                effectiveMode === "advantage"
                  ? Math.max(...rolled)
                  : effectiveMode === "disadvantage"
                    ? Math.min(...rolled)
                    : rolled[0],
              total: resolved.total,
              success: resolved.success,
            }
          : undefined,
        rulesetVersion: RULESET_VERSION,
      };
    }
    const st = (
      await sql<{ pending_rolls: unknown; kp_busy: boolean }>`
        select pending_rolls, kp_busy from game_states where room_id = ${room.id}
      `
    )[0];
    const rolls = asJson<PendingRoll[]>(st.pending_rolls, []);
    const roll = rolls.find((r) => r.id === data.rollId);
    if (!roll) return { ok: false as const, error: "没有这个检定" };
    if (roll.userId !== context.userId) {
      return { ok: false as const, error: "这颗骰不是你的" };
    }
    if (roll.result) return { ok: true as const };

    const charRows = await seatedLocked(sql, room.id);
    const party = charRows.map((c) => ({
      userId: c.user_id,
      sheet: asJson<CharacterSheet>(c.sheet, {} as CharacterSheet),
    }));
    const pc = party.find((p) => p.userId === context.userId);
    let sheet = ensureGear(pc?.sheet ?? ({} as CharacterSheet));
    const stFull = (
      await sql<{ npc_flags: unknown; scene_id: string; combat: unknown }>`
        select npc_flags, scene_id, combat from game_states where room_id = ${room.id}
      `
    )[0];
    const where = readWhere(asJson<Record<string, unknown>>(stFull?.npc_flags, {}));
    const offered = eligibleBoosts(party, roll, {
      where,
      sceneId: stFull?.scene_id ?? "wake",
      inCombat: Boolean(asCombat(stFull?.combat)),
      activeId: asCombat(stFull?.combat)?.activeId ?? null,
      spendAction: Object.fromEntries(
        (asCombat(stFull?.combat)?.order ?? []).map((o) => [
          o.id,
          o.spend?.action !== false,
        ]),
      ),
    });
    const allowed = new Set(
      offered.filter((b) => !b.blocked).map((b) => b.id as string),
    );
    const chosen = (data.boostIds ?? []).filter((id): id is BoostId => allowed.has(id));
    const boostFrom = (id: BoostId) => offered.find((b) => b.id === id);

    const kind0 = rollKind(roll);
    const kind =
      (kind0 === "damage" || kind0 === "check") &&
      /治愈|治疗|疗伤|cure|heal/i.test(`${roll.reason ?? ""} ${roll.dice ?? ""}`)
        ? "heal"
        : kind0;
    const myPlace = placeOf(where, context.userId, stFull?.scene_id ?? "wake");
    const rollAudience = party
      .filter(
        (member) =>
          placeOf(where, member.userId, stFull?.scene_id ?? "wake") === myPlace,
      )
      .map((member) => member.userId);
    const placeFree = !isPlaceBusy(
      asJson<Record<string, unknown>>(stFull?.npc_flags, {}),
      myPlace,
    );
    let combat = asCombat(stFull?.combat);

    if (kind === "heal") {
      const spell = /真言/.test(roll.reason) ? "治愈真言" : "治愈伤口";
      const expr = roll.dice || (/真言/.test(roll.reason) ? "1d4" : "1d8");
      const dice = rollDiceExpr(expr);
      const { mod, ability } = casterMod(sheet);
      const heal = Math.max(0, dice.total + mod);
      const nextHp = Math.min(sheet.hp.max, sheet.hp.current + heal);
      sheet.hp = { ...sheet.hp, current: nextHp };
      await sql`
        update characters
        set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
      roll.result = {
        d20: 0,
        total: heal,
        success: true,
        bonus: mod,
        parts: [`${expr}=${dice.parts.join("+") || dice.total}`, `${mod >= 0 ? "+" : ""}${mod}${ability}`],
      };
      const next = rolls.map((r) => (r.id === roll.id ? roll : r));
      await sql`
        update game_states
        set pending_rolls = ${JSON.stringify(next)}::jsonb,
            combat = ${combat ? JSON.stringify(combat) : null}::jsonb,
            updated_at = now()
        where room_id = ${room.id}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${sheet.name ?? "冒险者"},
          ${`治疗 ${heal}（${spell} ${expr}${mod >= 0 ? "+" : ""}${mod}）生命 ${sheet.hp.current - heal}→${nextHp}`},
          ${JSON.stringify({ place: myPlace, audience: rollAudience, heal, spell })}::jsonb
        )
      `;
      if (next.every((r) => r.result) && placeFree) {
        const kp = await runKpTurn({
          roomId: room.id,
          actorUserId: context.userId,
          actorName: sheet.name ?? "冒险者",
          action: `治疗已掷：${spell}恢复 ${heal} 点生命，当前 ${nextHp}/${sheet.hp.max}。请叙述伤口收拢，不要改这个数字，不要把它说成武器伤害。`,
          kind: "roll-followup",
        });
        return { ok: true as const, roll: roll.result, kp };
      }
      return { ok: true as const, roll: roll.result };
    }

    if (kind === "damage") {
      const w = weaponAttack(sheet);
      const crit = Boolean(
        rolls.find((r) => r.kind === "attack" && r.targetId === roll.targetId && r.result?.d20 === 20),
      );
      const dice = rollDiceExpr(roll.dice || w.damage, crit);
      const mod =
        w.ability === "dex"
          ? abilityMod(sheet.scores?.dex ?? 10)
          : abilityMod(sheet.scores?.str ?? 10);
      let extraDmg = 0;
      const extraParts: string[] = [];
      if (chosen.includes("guided-strike")) {
        extraDmg += 10;
        extraParts.push("导向+10");
        const ch = applyFeature(sheet, "channel");
        if (!ch.ok) return { ok: false as const, error: ch.error };
        sheet = ch.sheet;
        await sql`
          update characters
          set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${room.id} and user_id = ${context.userId}
        `;
      }
      if (chosen.includes("sneak")) {
        const s = rollDiceExpr("2d6");
        extraDmg += s.total;
        extraParts.push(`偷袭2d6=${s.parts.join("+")}`);
      }
      if (chosen.includes("superiority")) {
        const wr = ensureResources(sheet).resources!;
        const c = spendCharge(wr.superiority);
        if (!c) return { ok: false as const, error: "战术骰用完了，短休后恢复" };
        const s = rollDiceExpr("1d8");
        extraDmg += s.total;
        extraParts.push(`战术骰1d8=${s.parts.join("+") || s.total}`);
        sheet = { ...sheet, resources: { ...wr, superiority: c } };
        await sql`
          update characters
          set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${room.id} and user_id = ${context.userId}
        `;
      }
      const dmg = Math.max(0, dice.total + mod + extraDmg);
      if (combat && roll.targetId) {
        combat = hurtNpc(combat, roll.targetId, dmg);
        const t = combat.order.find(
          (o) => o.id === roll.targetId || o.name === roll.targetId,
        );
        if (t?.kind === "pc") {
          const row = charRows.find((c) => c.user_id === t.id);
          if (row) {
            const ts = asJson<CharacterSheet>(row.sheet, {} as CharacterSheet);
            const hit = applyIncomingDamage(ts, dmg);
            await sql`
              update characters
              set sheet = ${JSON.stringify(hit.sheet)}::jsonb, updated_at = now()
              where room_id = ${room.id} and user_id = ${t.id}
            `;
            if (hit.relentless) {
              extraParts.push("不屈不挠");
            }
          }
        }
      }
      roll.result = {
        d20: 0,
        total: dmg,
        success: true,
        bonus: mod,
        parts: [
          `${roll.dice || w.damage}=${dice.parts.join("+") || dice.total}`,
          `${mod >= 0 ? "+" : ""}${mod}`,
          ...extraParts,
        ],
      };
      const next = rolls.map((r) => (r.id === roll.id ? roll : r));
      await sql`
        update game_states
        set pending_rolls = ${JSON.stringify(next)}::jsonb,
            combat = ${combat ? JSON.stringify(combat) : null}::jsonb,
            updated_at = now()
        where room_id = ${room.id}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${sheet.name ?? "冒险者"},
          ${`伤害 ${dmg}（${w.weapon}${crit ? " 重击" : ""}${extraParts.length ? " " + extraParts.join(" ") : ""}）`},
          ${JSON.stringify({ place: myPlace, audience: rollAudience, dmg, targetId: roll.targetId })}::jsonb
        )
      `;
      if (next.every((r) => r.result) && placeFree) {
        const kp = await runKpTurn({
          roomId: room.id,
          actorUserId: context.userId,
          actorName: sheet.name ?? "冒险者",
          action: `伤害已掷：${dmg} 点打在 ${roll.targetId ?? "目标"} 上。请叙述伤口，不要改这个数字。若目标未倒，不要替玩家结束回合。`,
          kind: "roll-followup",
        });
        return { ok: true as const, roll: roll.result, kp };
      }
      return { ok: true as const, roll: roll.result };
    }

    const ability = (roll.ability || "str") as keyof CharacterSheet["scores"];
    const score = sheet.scores?.[ability] ?? 10;
    let bonus = abilityMod(score);
    const prof = sheet.proficiency ?? 2;
    const parts: string[] = [];

    if (kind === "check" && roll.skill) {
      const skill = SKILLS.find((s) => s.id === (roll.skill as SkillId));
      if (skill) {
        bonus = abilityMod(sheet.scores?.[skill.ability] ?? 10);
        if (sheet.skills?.includes(skill.id)) bonus += prof;
        if (sheet.expertise?.includes(skill.id)) bonus += prof;
      }
    } else if (kind === "save" || kind === "death") {
      const cls = classById(sheet.classId);
      if (kind === "save" && cls?.saves.includes(ability)) bonus += prof;
      if (kind === "death") bonus = 0;
    } else if (kind === "attack") {
      const w = weaponAttack(sheet);
      bonus = w.bonus;
    } else if (kind === "init") {
      bonus = abilityMod(sheet.scores?.dex ?? 10);
    }

    parts.push(`${bonus >= 0 ? "+" : ""}${bonus}`);

    const useHelp =
      Boolean(roll.advantage) ||
      chosen.includes("help") ||
      chosen.includes("inspiration");
    let disadv = Boolean(roll.disadvantage);
    if (kind === "attack" && combat) {
      const atk = combat.order.find((o) => o.id === context.userId);
      const tgt = combat.order.find(
        (o) => o.id === roll.targetId || o.name === roll.targetId || o.id === `npc:${roll.targetId}`,
      );
      if (atk && tgt) {
        const shot = shotCheck(atk, tgt, weaponAttack(sheet));
        if (!shot.ok) return { ok: false as const, error: shot.reason };
        disadv = disadv || shot.disadvantage;
        if (combat.hazards.some((h) => h.id === "rain") && weaponAttack(sheet).ranged && (atk.band === "far" || tgt.band === "far")) {
          disadv = true;
        }
        roll.dc = tgt.ac + coverAc(tgt.cover);
      }
      const meAtk = combat.order.find((o) => o.id === context.userId);
      const warExtra =
        sheet.subclassId === "war" &&
        Boolean(meAtk?.spend?.attacked) &&
        meAtk?.spend?.action === false &&
        meAtk?.spend?.bonus !== false;
      const bonusAttack =
        warExtra || /附赠|战争祭司|再抢|再来一/.test(roll.reason ?? "");
      if (bonusAttack && sheet.subclassId === "war") {
        const wr = ensureResources(sheet).resources!;
        if (left(wr.warPriest) <= 0) {
          return { ok: false as const, error: "战争祭司次数用完了（长休恢复）" };
        }
      }
      const spent = spendCost(combat, context.userId, "attack", {
        classId: sheet.classId,
        subclassId: sheet.subclassId,
        bonusAttack,
      });
      if (!spent.ok) return { ok: false as const, error: spent.error };
      combat = spent.combat;
      if (bonusAttack && sheet.subclassId === "war") {
        const wr = ensureResources(sheet).resources!;
        const c = spendCharge(wr.warPriest);
        if (!c) return { ok: false as const, error: "战争祭司次数用完了（长休恢复）" };
        sheet = { ...sheet, resources: { ...wr, warPriest: c } };
      }
      const wAtk = weaponAttack(sheet);
      let sheetDirty = Boolean(bonusAttack && sheet.subclassId === "war");
      if (wAtk.ranged) {
        const ammo = consumeAmmo(sheet, /弩/.test(wAtk.weapon) ? "bolt" : "arrow");
        if (!ammo.ok) return { ok: false as const, error: ammo.error };
        sheet = ammo.sheet;
        sheetDirty = true;
      }
      if (sheetDirty) {
        await sql`
          update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
          where room_id = ${room.id} and user_id = ${context.userId}
        `;
      }
    }
    const useAdv = useHelp && !disadv;
    disadv = disadv && !useHelp;
    let a = d20();
    let b = useAdv || disadv ? d20() : a;
    let face = useAdv ? Math.max(a, b) : disadv ? Math.min(a, b) : a;
    if (chosen.includes("lucky") && face === 1) {
      const reroll = d20();
      parts.push(`幸运1→${reroll}`);
      if (useAdv) {
        if (a === 1) a = reroll;
        else b = reroll;
        face = Math.max(a, b);
      } else if (disadv) {
        if (a === 1) a = reroll;
        else b = reroll;
        face = Math.min(a, b);
      } else {
        face = reroll;
      }
    }

    let extra = 0;
    const concId = sheet.resources?.conc?.id;
    if ((kind === "attack" || kind === "save" || kind === "death") && concId === "bless") {
      const g = d4();
      extra += g;
      parts.push(`祝福1d4=${g}`);
    }
    if ((kind === "check" || kind === "init") && concId === "guidance") {
      const g = d4();
      extra += g;
      parts.push(`神导1d4=${g}`);
      sheet = dropConcentration(sheet);
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    } else if ((kind === "check" || kind === "init") && chosen.includes("guidance")) {
      const g = d4();
      extra += g;
      parts.push(`神导1d4=${g}`);
      const casterId = boostFrom("guidance")?.fromUserId ?? context.userId;
      if (combat) {
        const spent = spendCost(combat, casterId, "action");
        if (!spent.ok) return { ok: false as const, error: spent.error };
        combat = spent.combat;
      }
    }

    const total = face + bonus + extra;
    const vs = kind === "death" ? 10 : roll.dc;
    const success =
      kind === "init"
        ? true
        : face === 20
          ? true
          : face === 1
            ? false
            : total >= vs;
    roll.result = {
      d20: face,
      total,
      success,
      bonus: bonus + extra,
      parts,
    };
    if (roll.worldEffect) {
      if (!success) {
        roll.result.effectNote =
          roll.worldEffect.type === "grant_item"
            ? `没有找到${roll.worldEffect.itemName}`
            : "没有完成这次物品操作";
      } else {
        const latestState = (
          await sql<{ npc_flags: unknown }>`
            select npc_flags from game_states where room_id = ${room.id}
          `
        )[0];
        const latestFlags = asJson<Record<string, unknown>>(latestState?.npc_flags, {});
        const latestClaims = readWorldItemClaims(latestFlags);
        if (
          roll.worldEffect.type === "grant_item" &&
          latestClaims[roll.worldEffect.sourceId]
        ) {
          roll.result.effectNote = `${roll.worldEffect.itemName}已经被人取走`;
        } else {
          const applied = applyWorldEffect(sheet, roll.worldEffect);
          if (!applied.ok) {
            roll.result.effectNote = applied.error;
          } else {
            sheet = applied.sheet;
            roll.result.effectNote = applied.note;
            await sql`
              update characters
              set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
              where room_id = ${room.id} and user_id = ${context.userId}
            `;
            if (roll.worldEffect.type === "grant_item") {
              latestFlags.worldItemClaims = {
                ...latestClaims,
                [roll.worldEffect.sourceId]: context.userId,
              };
              await sql`
                update game_states
                set npc_flags = ${JSON.stringify(latestFlags)}::jsonb, updated_at = now()
                where room_id = ${room.id}
              `;
            }
          }
        }
      }
    }
    let next = rolls.map((r) => (r.id === roll.id ? roll : r));

    if (kind === "init" && combat) {
      combat = applyInit(combat, context.userId, total);
    }
    if (kind === "attack" && success) {
      const w = weaponAttack(sheet);
      next = [
        ...next,
        {
          id: uid("roll"),
          userId: context.userId,
          name: sheet.name ?? "冒险者",
          ability: w.ability,
          kind: "damage",
          dc: 0,
          dice: w.damage,
          targetId: roll.targetId,
          sneakOk:
            useAdv ||
            Boolean(
              combat?.order.some(
                (o) =>
                  o.kind === "pc" &&
                  o.inCombat &&
                  o.id !== context.userId &&
                  o.band === "melee",
              ) && combat.order.find((o) => o.id === context.userId)?.band === "melee",
            ),
          reason: `伤害：${w.weapon}（${w.damage}）命中后可勾选导向打击/偷袭`,
        },
      ];
      if (combat) combat = { ...combat, waiting: "damage" };
    }
    if (kind === "death" && pc) {
      const ds = { ...(sheet.deathSaves ?? { success: 0, fail: 0 }) };
      if (face === 20) {
        sheet.hp = { ...sheet.hp, current: 1 };
        sheet.conditions = sheet.conditions.filter((x) => x !== "昏迷");
        ds.success = 0;
        ds.fail = 0;
      } else if (face === 1) ds.fail += 2;
      else if (success) ds.success += 1;
      else ds.fail += 1;
      sheet.deathSaves = ds;
      if (ds.fail >= 3) sheet.conditions = Array.from(new Set([...sheet.conditions, "死亡"]));
      if (ds.success >= 3) {
        sheet.conditions = sheet.conditions.filter((x) => x !== "昏迷");
        sheet.conditions = Array.from(new Set([...sheet.conditions, "稳定"]));
      }
      await sql`
        update characters
        set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    }

    await sql`
      update game_states
      set pending_rolls = ${JSON.stringify(next)}::jsonb,
          combat = ${combat ? JSON.stringify(combat) : null}::jsonb,
          updated_at = now()
      where room_id = ${room.id}
    `;

    if (chosen.includes("inspiration") && pc) {
      const nextSheet = { ...sheet, inspiration: false };
      sheet = nextSheet;
      await sql`
        update characters
        set sheet = ${JSON.stringify(nextSheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    }

    const skillLabel =
      kind === "init"
        ? "先攻"
        : kind === "death"
          ? "死亡豁免"
          : (SKILLS.find((s) => s.id === roll.skill)?.label ??
            (kind === "save" ? `${roll.ability}豁免` : kind === "attack" ? "攻击" : roll.ability));
    const advBit = useAdv ? ` 优势(${a}/${b})` : disadv ? ` 劣势(${a}/${b})` : "";
    const formula =
      kind === "init"
        ? `d20=${face}${advBit} ${parts.join(" ")} = ${total}`
        : `d20=${face}${advBit} ${parts.join(" ")} = ${total} vs DC ${kind === "death" ? 10 : roll.dc}`;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${sheet.name ?? "冒险者"},
        ${`${skillLabel} ${kind === "init" ? total : face === 20 ? "大成功" : face === 1 ? "大失败" : success ? "成功" : "失败"}：${formula}${roll.result.effectNote ? `；${roll.result.effectNote}` : ""}`},
        ${JSON.stringify({ d20: face, bonus: bonus + extra, total, dc: roll.dc, success, boosts: chosen, parts, place: myPlace, audience: rollAudience })}::jsonb
      )
    `;

    if (next.every((r) => r.result) && placeFree) {
      const summary = next
        .map((r) => {
          const lab = SKILLS.find((s) => s.id === r.skill)?.label ?? r.ability;
          const p = r.result?.parts?.join(" ") ?? "";
          const clue = r.clueId ? ` clueId=${r.clueId}` : "";
          const effect = r.result?.effectNote ? `；物品结果：${r.result.effectNote}` : "";
          return `${r.name} 的${lab}：d20=${r.result!.d20} ${p} → ${r.result!.total} vs DC ${r.dc}（${r.result!.success ? "成功" : "失败"}）${clue}${effect}`;
        })
        .join("；");
      const kp = await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: sheet.name ?? "冒险者",
        action: `检定已全部掷完：${summary}。加值已计入总分。双轨：成功则写该 clueId 的完整层（playerText），失败则停留在已说出的免费层，不要惩罚、不要重复免费层。不要再要同一批骰。旁白用清楚完整的现代中文，禁止点名收尾。`,
        kind: "roll-followup",
      });
      return { ok: true as const, roll: roll.result, kp };
    }
    return { ok: true as const, roll: roll.result };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      if (!isKpModelId(rules.kp_model)) {
        return { ok: false as const, error: "本桌选择的模型已不可用，请重新选择" };
      }
      const projection = (await roomProjection(room.id, context.userId)).projection;
      if (!projection.combat) return { ok: false as const, error: "现在没有战斗" };
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "joinCombat",
        combatId: projection.combat.id,
        initiativeRoll: rollDie(20),
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      await settleNpcCombatTurns({
        sql,
        roomId: room.id,
        moduleId: rules.module_id,
        model: rules.kp_model,
        viewerId: context.userId,
      });
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const st = (
      await sql<{ combat: unknown; npc_flags: unknown; scene_id: string; pending_rolls: unknown }>`
        select combat, npc_flags, scene_id, pending_rolls from game_states where room_id = ${room.id}
      `
    )[0];
    const combat0 = asCombat(st?.combat);
    if (!combat0) return { ok: false as const, error: "现在没有战斗" };
    const where = readWhere(asJson<Record<string, unknown>>(st.npc_flags, {}));
    const here = placeOf(where, context.userId, st.scene_id);
    if (here !== combat0.place) {
      return { ok: false as const, error: "你不在战场上，先过去才能加入" };
    }
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    const sheet = asJson<CharacterSheet>(row.sheet, {} as CharacterSheet);
    const combat = joinCombatState(combat0, { userId: context.userId, sheet });
    const rolls = asJson<PendingRoll[]>(st.pending_rolls, []);
    if (combat.waiting === "init" && !rolls.some((r) => r.userId === context.userId && r.kind === "init" && !r.result)) {
      rolls.push({
        id: uid("roll"),
        userId: context.userId,
        name: sheet.name,
        ability: "dex",
        kind: "init",
        dc: 0,
        reason: "先攻：同处的人都要掷。被发现或开打，在场即参战。",
      });
    }
    await sql`
      update game_states
      set combat = ${JSON.stringify(combat)}::jsonb,
          pending_rolls = ${JSON.stringify(rolls)}::jsonb,
          updated_at = now()
      where room_id = ${room.id}
    `;
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      if (!isKpModelId(rules.kp_model)) {
        return { ok: false as const, error: "本桌选择的模型已不可用，请重新选择" };
      }
      const before = (await roomProjection(room.id, context.userId)).projection;
      const combat = before.combat;
      const attack = before.viewer.attacks[0];
      if (!combat || !attack || !combat.order.some((entry) => entry.entityId === data.targetId)) {
        return { ok: false as const, error: "找不到这场战斗中的目标或攻击方式。" };
      }
      const attackerCombatant = combat.order.find((entry) => entry.entityId === context.userId);
      const targetCombatant = combat.order.find((entry) => entry.entityId === data.targetId);
      const distance = attackerCombatant && targetCombatant
        ? Math.abs(attackerCombatant.positionFeet - targetCombatant.positionFeet)
        : 0;
      const adjacentHostile = attack.kind === "ranged" && attackerCombatant
        ? combat.order.some((entry) => {
            return entry.side !== attackerCombatant.side &&
              Math.abs(entry.positionFeet - attackerCombatant.positionFeet) <= 5;
          })
        : false;
      const rangedDisadvantage =
        attack.kind === "ranged" &&
        (distance > (attack.normalRangeFeet ?? 80) || adjacentHostile);
      const downedAdvantage =
        before.visibleEntities.find((entity) => entity.id === data.targetId)?.condition === "down" &&
        distance <= 5;
      const mode = rangedDisadvantage && downedAdvantage
        ? ("normal" as const)
        : rangedDisadvantage
          ? ("disadvantage" as const)
          : downedAdvantage
            ? ("advantage" as const)
            : ("normal" as const);
      const d20Rolls = Array.from({ length: mode === "normal" ? 1 : 2 }, () => rollDie(20));
      const face = mode === "advantage"
        ? Math.max(...d20Rolls)
        : mode === "disadvantage"
          ? Math.min(...d20Rolls)
          : d20Rolls[0];
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "combatAttack",
        combatId: combat.id,
        targetId: data.targetId,
        attackId: attack.id,
        mode,
        d20Rolls,
        damageRolls: Array.from(
          { length: attack.damage.count * (face === 20 ? 2 : 1) },
          () => rollDie(attack.damage.sides),
        ),
        cost: "bonusAction",
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      const projection =
        committed.projection ?? (await roomProjection(room.id, context.userId)).projection;
      const narration = await narrateDecision({
        model: rules.kp_model,
        module: getModule(rules.module_id),
        rawText: `使用战争祭司，以${attack.name}附赠攻击 ${data.targetId}`,
        decision: committed.decision,
        projection,
      });
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, tts_text, meta)
        values (
          ${uid("msg")}, ${room.id}, null, ${"narrate"}, ${"KP"},
          ${narration.speech}, ${narration.tts},
          ${JSON.stringify({
            place: projection.viewer.sceneId,
            audience: projection.visibleEntities
              .filter((entity) => entity.kind === "player")
              .map((entity) => entity.id),
            rulesetVersion: RULESET_VERSION,
            eventIds: narration.referencedEventIds,
            canonicalFacts: narration.canonicalFacts,
          })}::jsonb
        )
      `;
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const st = (
      await sql<{ combat: unknown; pending_rolls: unknown }>`
        select combat, pending_rolls from game_states where room_id = ${room.id}
      `
    )[0];
    const combat = asCombat(st?.combat);
    if (!combat) return { ok: false as const, error: "现在没有战斗" };
    if (combat.activeId !== context.userId) {
      return { ok: false as const, error: "还没轮到你" };
    }
    const meC = combat.order.find((o) => o.id === context.userId);
    if (!meC?.inCombat) return { ok: false as const, error: "你不在这场战斗里" };
    const spend = meC.spend ?? { action: true, bonus: true, reaction: true, attacked: false };
    if (!spend.attacked || spend.action) {
      return { ok: false as const, error: "战争祭司要先用动作打出一次，再花附赠" };
    }
    if (!spend.bonus) return { ok: false as const, error: "本回合附赠已经用过" };
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    const sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    if (sheet.subclassId !== "war") {
      return { ok: false as const, error: "你没有战争祭司" };
    }
    const wr = ensureResources(sheet).resources!;
    const remain = left(wr.warPriest);
    if (remain <= 0) {
      return { ok: false as const, error: "战争祭司次数用完了（长休恢复）" };
    }
    const tgt = combat.order.find(
      (o) =>
        o.inCombat &&
        (o.id === data.targetId ||
          o.id === `npc:${data.targetId}` ||
          o.name === data.targetId),
    );
    if (!tgt) return { ok: false as const, error: "找不到这个目标" };
    const rolls = asJson<PendingRoll[]>(st.pending_rolls, []);
    if (rolls.some((r) => r.userId === context.userId && !r.result)) {
      return { ok: false as const, error: "先把桌上这颗骰掷完" };
    }
    const w = weaponAttack(sheet);
    rolls.push({
      id: uid("roll"),
      userId: context.userId,
      name: sheet.name,
      ability: w.ability,
      kind: "attack",
      dc: tgt.ac + coverAc(tgt.cover),
      targetId: tgt.id,
      reason: `战争祭司附赠再攻：${tgt.name}（还剩 ${remain} 次，掷出才扣）`,
    });
    await sql`
      update game_states
      set pending_rolls = ${JSON.stringify(rolls)}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      if (!isKpModelId(rules.kp_model)) {
        return { ok: false as const, error: "本桌选择的模型已不可用，请重新选择" };
      }
      const projection = (await roomProjection(room.id, context.userId)).projection;
      if (!projection.combat) return { ok: false as const, error: "现在没有战斗" };
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "endCombatTurn",
        combatId: projection.combat.id,
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      await settleNpcCombatTurns({
        sql,
        roomId: room.id,
        moduleId: rules.module_id,
        model: rules.kp_model,
        viewerId: context.userId,
      });
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const st = (
      await sql<{ combat: unknown }>`
        select combat from game_states where room_id = ${room.id}
      `
    )[0];
    let combat = asCombat(st?.combat);
    if (!combat) return { ok: false as const, error: "现在没有战斗" };
    if (combat.activeId !== context.userId && !me.is_host) {
      return { ok: false as const, error: "还没轮到你" };
    }
    combat = nextTurn(combat);
    await sql`
      update game_states
      set combat = ${JSON.stringify(combat)}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    const active = combat.order.find((o) => o.id === combat?.activeId);
    if (active?.kind === "npc") {
      await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: active.name,
        action: `现在是 ${active.name} 的回合。按它的目标出手（hat=oppose 或要玩家豁免）。不要替玩家行动。地点仍是 ${combat.place}。`,
        kind: "action",
      });
    } else if (active && combat.waiting === "death") {
      const death = [
        {
          id: uid("roll"),
          userId: active.id,
          name: active.name,
          ability: "con",
          kind: "death" as const,
          dc: 10,
          reason: "死亡豁免：d20，10 成功。不要加体质。",
        },
      ];
      await sql`
        update game_states
        set pending_rolls = ${JSON.stringify(death)}::jsonb, updated_at = now()
        where room_id = ${room.id}
      `;
    }
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      return {
        ok: false as const,
        error:
          data.kind === "disengage"
            ? "撤离是本回合的动作；请在行动栏使用撤离后再移动。"
            : "D&D 5e 没有无条件“退出战斗”状态；必须按移动、撤离、疾走、投降或借机攻击逐项结算。",
      };
    }
    const st = (
      await sql<{ combat: unknown }>`
        select combat from game_states where room_id = ${room.id}
      `
    )[0];
    const combat0 = asCombat(st?.combat);
    if (!combat0) return { ok: false as const, error: "现在没有战斗" };
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    const sheet = asJson<CharacterSheet>(row?.sheet, {} as CharacterSheet);
    const cost =
      data.kind === "disengage"
        ? sheet.classId === "rogue"
          ? "bonus"
          : "action"
        : data.kind === "flee"
          ? "action"
          : data.kind === "surrender"
            ? null
            : "action";
    let combatBase = combat0;
    if (cost) {
      const spent = spendCost(combat0, context.userId, cost, {
        classId: sheet.classId,
      });
      if (!spent.ok) return { ok: false as const, error: spent.error };
      combatBase = spent.combat;
    }
    const { combat, oa, note } = applyLeave(
      combatBase,
      context.userId,
      data.kind,
      sheet.classId,
    );
    await sql`
      update game_states
      set combat = ${JSON.stringify(combat)}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${sheet.name ?? "冒险者"},
        ${note},
        ${JSON.stringify({ place: combat.place, leave: data.kind })}::jsonb
      )
    `;
    if (oa) {
      await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: sheet.name ?? "冒险者",
        action: `${sheet.name} 从贴身离开且未撤离。贴身的敌人获得一次借机攻击。请立刻 call_roll 攻击（dc=其 AC，targetId=${context.userId}）。不要跳过这颗骰。`,
        kind: "action",
      });
    } else {
      await runKpTurn({
        roomId: room.id,
        actorUserId: context.userId,
        actorName: sheet.name ?? "冒险者",
        action: `${sheet.name}：${note}。请用一句旁白交代场面，不要拦已经合法的脱离。`,
        kind: "action",
      });
    }
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      return {
        ok: false as const,
        error: "当前规则内核没有向该角色开放待处理反应；不会回退到旧 D1 战斗状态。",
      };
    }
    const st = (
      await sql<{ combat: unknown }>`
        select combat from game_states where room_id = ${room.id}
      `
    )[0];
    const combat0 = asCombat(st?.combat);
    if (!combat0) return { ok: false as const, error: "没有待处理的反应" };
    const react = (combat0.reacts ?? []).find(
      (r) => r.id === data.reactId && r.userId === context.userId,
    );
    if (!react) return { ok: false as const, error: "没有这个反应" };
    let combatWork = combat0;
    if (data.use && react.kind === "shield") {
      const spent = spendCost(combat0, context.userId, "reaction");
      if (!spent.ok) return { ok: false as const, error: spent.error };
      combatWork = spent.combat;
    }
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    const sheet = asJson<CharacterSheet>(row?.sheet, {} as CharacterSheet);
    let note = "没有用护盾。";
    let dmg = react.damage;
    if (data.use && react.kind === "shield") {
      const newAc = react.ac + 5;
      if (react.attackTotal < newAc) {
        dmg = 0;
        note = `护盾术：AC ${react.ac}→${newAc}，这次打不中。`;
      } else {
        note = `护盾术：AC ${react.ac}→${newAc}，仍被命中。`;
      }
    }
    if (dmg > 0) {
      const hit = applyIncomingDamage(sheet, dmg);
      Object.assign(sheet, hit.sheet);
      if (hit.relentless) note = `${note} ${hit.note}`;
      await sql`
        update characters
        set sheet = ${JSON.stringify(hit.sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
    }
    const reacts = (combatWork.reacts ?? []).filter((r) => r.id !== react.id);
    const combat = {
      ...combatWork,
      reacts,
      waiting: reacts.length ? "react" : "turn",
    };
    await sql`
      update game_states
      set combat = ${JSON.stringify(combat)}::jsonb, updated_at = now()
      where room_id = ${room.id}
    `;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${sheet.name ?? "冒险者"},
        ${note}${dmg ? ` 伤害 ${dmg}` : ""},
        ${JSON.stringify({ place: combat.place, react: react.kind, use: data.use })}::jsonb
      )
    `;
    return { ok: true as const };
  });

export const restNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    code: string;
    kind: "short" | "long";
    mode?: "personal" | "group";
    hitDice?: number;
    arcaneRecoverySlotLevels?: number[];
    /** Legacy Adapter shorthand; never used by authoritative-v2. */
    arcane?: 0 | 1 | 2;
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    const pc = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    const sheet = ensureGear(asJson<CharacterSheet>(pc?.sheet, {} as CharacterSheet));
    if (rules?.ruleset_version === RULESET_VERSION) {
      const snapshot = await roomProjection(room.id, context.userId);
      const projection = snapshot.projection;
      const hitDiceCount = Math.max(0, Math.floor(data.hitDice ?? 0));
      const hitDie = sheet.resources?.hitDice.die ?? 8;
      const options =
        data.kind === "short"
          ? {
              hitDiceRolls: Array.from(
                { length: hitDiceCount },
                () => rollDie(hitDie),
              ),
              arcaneRecovery: data.arcane === 1 || data.arcane === 2 ? data.arcane : undefined,
            }
          : undefined;
      let draft: DirectCommand;
      if (data.mode === "personal" || !projection.squad) {
        draft = { kind: "startRest", rest: data.kind, options };
      } else if (projection.restVote) {
        if (projection.restVote.kind !== data.kind) {
          return { ok: false as const, error: "当前正在表决另一种休息。" };
        }
        draft = {
          kind: "voteGroupRest",
          voteId: projection.restVote.id,
          agree: true,
          options,
        };
      } else {
        draft = {
          kind: "proposeGroupRest",
          squadId: projection.squad.id,
          rest: data.kind,
          options,
        };
      }
      const committed = await commitRulesV2Direct(room.id, context.userId, draft);
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      const personal = draft.kind === "startRest";
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${room.id}, null, ${"stage"}, ${"休整"},
          ${personal
            ? `${sheet.name || me.nickname} 选择单独${data.kind === "long" ? "长休" : "短休"}；若原在队伍中，已直接离队。`
            : `${sheet.name || me.nickname} ${draft.kind === "proposeGroupRest" ? "发起" : "同意"}队伍${data.kind === "long" ? "长休" : "短休"}。`},
          ${JSON.stringify({
            place: projection.viewer.sceneId,
            rulesetVersion: RULESET_VERSION,
            mode: personal ? "personal" : "group",
          })}::jsonb
        )
      `;
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    return requestRestInner(
      sql,
      room.id,
      data.code,
      context.userId,
      sheet.name || me.nickname,
      data.kind,
      data.kind === "long" ? "我想长休过夜" : "我想短休一小时",
      { hitDice: data.hitDice, arcane: data.arcane },
    );
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    const pc = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    const sheet = ensureGear(asJson<CharacterSheet>(pc?.sheet, {} as CharacterSheet));
    if (rules?.ruleset_version === RULESET_VERSION) {
      const projection = (await roomProjection(room.id, context.userId)).projection;
      const draft: DirectCommand = projection.viewer.rest?.status === "resting"
        ? { kind: "interruptRest" }
        : projection.restVote
          ? { kind: "voteGroupRest", voteId: projection.restVote.id, agree: false }
          : { kind: "interruptRest" };
      const committed = await commitRulesV2Direct(room.id, context.userId, draft);
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${room.id}, null, ${"stage"}, ${"休整"},
          ${`${sheet.name || me.nickname} ${draft.kind === "interruptRest" ? "提前结束了自己的休息" : "没有同意这次队伍休息"}。`},
          ${JSON.stringify({
            place: projection.viewer.sceneId,
            rulesetVersion: RULESET_VERSION,
          })}::jsonb
        )
      `;
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    return cancelRestInner(
      sql,
      room.id,
      context.userId,
      sheet.name || me.nickname,
    );
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    const sheet0 = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    if (rules?.ruleset_version === RULESET_VERSION) {
      if (!isKpModelId(rules.kp_model)) {
        return { ok: false as const, error: "本桌选择的模型已不可用，请重新选择" };
      }
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "castSpell",
        spellId: data.spellId,
        slotLevel: data.slot === 2 ? 2 : data.slot === 1 ? 1 : undefined,
        targetIds: data.targetIds,
        choice: data.choice,
        destinationFeet: data.destinationFeet,
        originFeet: data.originFeet,
        ritual: data.ritual,
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      const projection =
        committed.projection ?? (await roomProjection(room.id, context.userId)).projection;
      const narration = await narrateDecision({
        model: rules.kp_model,
        module: getModule(rules.module_id),
        rawText: `施放${spellById(data.spellId)?.name ?? data.spellId}`,
        decision: committed.decision,
        projection,
      });
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, tts_text, meta)
        values (
          ${uid("msg")}, ${room.id}, null, ${"narrate"}, ${"KP"},
          ${narration.speech}, ${narration.tts},
          ${JSON.stringify({
            place: projection.viewer.sceneId,
            rulesetVersion: RULESET_VERSION,
            eventIds: narration.referencedEventIds,
          })}::jsonb
        )
      `;
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const st = (
      await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
    )[0];
    let combat = asCombat(st?.combat);
    const sp = spellById(data.spellId);
    if (combat?.order.some((o) => o.id === context.userId && o.inCombat) && sp) {
      const react = Boolean(sp.time?.includes("反应"));
      const cost = react ? "reaction" : spellTimeIsBonus(data.spellId) ? "bonus" : "action";
      const spent = spendCost(combat, context.userId, cost);
      if (!spent.ok) return { ok: false as const, error: spent.error };
      combat = spent.combat;
    }
    const cast = applyCast(sheet0, data.spellId, data.slot);
    if (!cast.ok) return { ok: false as const, error: cast.error };
    await sql`
      update characters set sheet = ${JSON.stringify(cast.sheet)}::jsonb, updated_at = now()
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    if (combat) {
      await sql`
        update game_states set combat = ${JSON.stringify(combat)}::jsonb where room_id = ${room.id}
      `;
    }
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (
        ${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${cast.sheet.name},
        ${`施放${sp?.name ?? data.spellId}。${cast.note}`}
      )
    `;
    const kp = await runKpTurn({
      roomId: room.id,
      actorUserId: context.userId,
      actorName: cast.sheet.name,
      action: `${cast.sheet.name} 已由系统扣资源：${cast.note} 请叙述效果。需要治疗骰则 hat=call_roll kind=heal。不要再扣环，也不要改库存数字。`,
      kind: "action",
    });
    if (!kp.ok) return { ok: false as const, error: kp.error };
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    let sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    if (rules?.ruleset_version === RULESET_VERSION) {
      const rolls =
        data.feat === "secondWind"
          ? [rollDie(10)]
          : data.feat === "breath"
            ? [rollDie(6), rollDie(6)]
            : undefined;
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "useFeature",
        featureId: data.feat,
        rolls,
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      const used = committed.decision.events.find((event) => event.type === "FeatureUsed");
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body, meta)
        values (
          ${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${sheet.name},
          ${`使用 ${data.feat}${used?.total === undefined ? "" : `，规则结果 ${used.total}`}。`},
          ${JSON.stringify({
            place: committed.projection?.viewer.sceneId,
            rulesetVersion: RULESET_VERSION,
            eventIds: committed.decision.events.map((event) => event.id),
          })}::jsonb
        )
      `;
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    if (data.feat === "surge") {
      const feat = applyFeature(sheet, "surge");
      if (!feat.ok) return { ok: false as const, error: feat.error };
      sheet = feat.sheet;
      const st = (
        await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
      )[0];
      const combat = asCombat(st?.combat);
      if (combat) {
        const next = {
          ...combat,
          order: combat.order.map((o) =>
            o.id === context.userId
              ? {
                  ...o,
                  spend: {
                    ...(o.spend ?? { action: false, bonus: true, reaction: true, attacked: false }),
                    action: true,
                  },
                }
              : o,
          ),
        };
        await sql`update game_states set combat = ${JSON.stringify(next)}::jsonb where room_id = ${room.id}`;
      }
      await sql`
        update characters set sheet = ${JSON.stringify(sheet)}::jsonb, updated_at = now()
        where room_id = ${room.id} and user_id = ${context.userId}
      `;
      await sql`
        insert into messages (id, room_id, user_id, kind, name, body)
        values (${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${sheet.name}, ${"动作如潮：本回合再获得一个动作。"})
      `;
      return { ok: true as const };
    }
    const feat = applyFeature(sheet, data.feat);
    if (!feat.ok) return { ok: false as const, error: feat.error };
    if (data.feat === "breath") {
      const st = (
        await sql<{ combat: unknown }>`select combat from game_states where room_id = ${room.id}`
      )[0];
      const combat = asCombat(st?.combat);
      if (combat?.order.some((o) => o.id === context.userId && o.inCombat)) {
        const spent = spendCost(combat, context.userId, "action");
        if (!spent.ok) return { ok: false as const, error: spent.error };
        await sql`update game_states set combat = ${JSON.stringify(spent.combat)}::jsonb where room_id = ${room.id}`;
      }
    }
    await sql`
      update characters set sheet = ${JSON.stringify(feat.sheet)}::jsonb, updated_at = now()
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (${uid("msg")}, ${room.id}, ${context.userId}, ${"say"}, ${feat.sheet.name}, ${feat.note})
    `;
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间房的规则版本不可用" };
    }
    const row = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId} and locked = true
      `
    )[0];
    if (!row) return { ok: false as const, error: "没有人物卡" };
    const sheet = ensureGear(asJson<CharacterSheet>(row.sheet, {} as CharacterSheet));
    if (rules?.ruleset_version === RULESET_VERSION) {
      return {
        ok: false as const,
        error: "D&D 5e 2014 的生命骰在短休结束时结算；请从短休面板选择要花的颗数。",
      };
    }
    const out = spendHitDie(sheet);
    if (!out.ok) return { ok: false as const, error: out.error };
    await sql`
      update characters set sheet = ${JSON.stringify(out.sheet)}::jsonb, updated_at = now()
      where room_id = ${room.id} and user_id = ${context.userId}
    `;
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body)
      values (${uid("msg")}, ${room.id}, ${context.userId}, ${"roll"}, ${out.sheet.name}, ${out.note})
    `;
    return { ok: true as const };
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
    if (rules?.ruleset_version === AUTHORITATIVE_RULESET_VERSION) {
      await detachAuthoritativeDirectory(sql, room.id, data.userId);
      return { ok: true as const };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      await detachSeated(sql, room.id, data.userId);
      return { ok: true as const };
    }
    return { ok: false as const, error: "这间旧房间的规则版本不可用" };
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
    if (rules?.ruleset_version === RULESET_VERSION) {
      await detachSeated(sql, room.id, context.userId);
      return { ok: true as const };
    }
    return { ok: false as const, error: "这间旧房间的规则版本不可用" };
  });

async function seatedLocked(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
) {
  return sql<{ user_id: string; sheet: unknown }>`
    select c.user_id, c.sheet
    from characters c
    join room_members m on m.room_id = c.room_id and m.user_id = c.user_id
    where c.room_id = ${roomId} and c.locked = true
  `;
}

async function detachSeated(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  userId: string,
) {
  const activeRules = await roomRuleset(sql, roomId);
  if (activeRules?.ruleset_version === RULESET_VERSION && activeRules.status === "play") {
    await departRoomPlayer(roomId, userId);
  }
  const nameRow = (
    await sql<{ sheet: unknown; nickname: string | null }>`
      select c.sheet, m.nickname
      from room_members m
      left join characters c on c.room_id = m.room_id and c.user_id = m.user_id
      where m.room_id = ${roomId} and m.user_id = ${userId}
    `
  )[0];
  const name =
    asJson<CharacterSheet>(nameRow?.sheet, {} as CharacterSheet).name ||
    nameRow?.nickname ||
    "有人";
  const hostRow = (
    await sql<{ is_host: boolean }>`
      select is_host from room_members where room_id = ${roomId} and user_id = ${userId}
    `
  )[0];
  if (hostRow?.is_host) {
    const nextHost = (
      await sql<{ user_id: string }>`
        select user_id from room_members
        where room_id = ${roomId} and user_id <> ${userId}
        order by joined_at asc
        limit 1
      `
    )[0];
    if (nextHost) {
      await sql`
        update room_members set is_host = false
        where room_id = ${roomId} and user_id = ${userId}
      `;
      await sql`
        update room_members set is_host = true
        where room_id = ${roomId} and user_id = ${nextHost.user_id}
      `;
      await sql`
        update rooms set host_user_id = ${nextHost.user_id} where id = ${roomId}
      `;
    }
  }

  const { flags, sceneId } = await flagsOf(sql, roomId);
  flags.squads = leaveSquad(readSquads(flags), userId);
  flags.squadQueue = readSquadQueue(flags).filter((q) => q.userId !== userId);
  const inv = readSquadInvite(flags);
  if (inv && (inv.from === userId || inv.to === userId)) delete flags.squadInvite;
  const vote = readRestVote(flags);
  if (vote) {
    vote.agreed = vote.agreed.filter((id) => id !== userId);
    if (vote.from === userId || vote.agreed.length === 0) delete flags.restVote;
    else flags.restVote = vote;
  }
  const hold = readRestHold(flags);
  if (hold) {
    const resters = hold.resters.filter((id) => id !== userId);
    if (!resters.length) delete flags.restHold;
    else flags.restHold = { ...hold, resters };
  }
  const where = readWhere(flags);
  delete where[userId];
  flags.where = where;
  const clocks = { ...readClocks(flags) };
  delete clocks[userId];
  flags.clock = clocks;
  await writeFlags(sql, roomId, flags);

  const st = (
    await sql<{ combat: unknown; pending_rolls: unknown }>`
      select combat, pending_rolls from game_states where room_id = ${roomId}
    `
  )[0];
  const combat0 = asCombat(st?.combat);
  const combat = combat0 ? dropFromCombat(combat0, userId) : null;
  const rolls = asJson<PendingRoll[]>(st?.pending_rolls, []).filter(
    (r) => r.userId !== userId,
  );
  await sql`
    update game_states
    set combat = ${combat ? JSON.stringify(combat) : null}::jsonb,
        pending_rolls = ${JSON.stringify(rolls)}::jsonb,
        updated_at = now()
    where room_id = ${roomId}
  `;

  await sql`
    delete from room_members where room_id = ${roomId} and user_id = ${userId}
  `;
  await sql`
    insert into messages (id, room_id, user_id, kind, name, body, meta)
    values (
      ${uid("msg")}, ${roomId}, null, ${"stage"}, ${"离席"},
      ${`${name} 离开了这一桌。人物卡还留着，用房间码可以再进来。`},
      ${JSON.stringify({ place: "all" })}::jsonb
    )
  `;
}

async function reseatPlayer(
  sql: Awaited<ReturnType<typeof getSql>>,
  roomId: string,
  userId: string,
) {
  const { flags, sceneId } = await flagsOf(sql, roomId);
  const where = readWhere(flags);
  where[userId] = sceneId;
  flags.where = where;
  const clocks = readClocks(flags);
  const others = await sql<{ user_id: string }>`
    select user_id from room_members where room_id = ${roomId} and user_id <> ${userId}
  `;
  const maxB = Math.max(0, ...others.map((r) => clockOf(clocks, r.user_id).beats));
  const maxM = Math.max(0, ...others.map((r) => clockOf(clocks, r.user_id).minutes));
  flags.clock = { ...clocks, [userId]: { beats: maxB, minutes: maxM } };
  await writeFlags(sql, roomId, flags);
}

async function flagsOf(sql: Awaited<ReturnType<typeof getSql>>, roomId: string) {
  const st = (
    await sql<{ npc_flags: unknown; scene_id: string }>`
      select npc_flags, scene_id from game_states where room_id = ${roomId}
    `
  )[0];
  return {
    flags: asJson<Record<string, unknown>>(st?.npc_flags, {}),
    sceneId: st?.scene_id ?? "wake",
  };
}

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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "inviteSquad",
        targetId: data.targetUserId,
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const { flags, sceneId } = await flagsOf(sql, room.id);
    sweepSquadInvite(flags);
    const live = readSquadInvite(flags);
    if (live && live.from !== context.userId) {
      return { ok: false as const, error: "桌上已有一条组队邀请，等它结束或让对方取消" };
    }
    if (live && live.to !== data.targetUserId) {
      return { ok: false as const, error: "先取消现在这条邀请，再邀别人" };
    }
    const where = readWhere(flags);
    if (placeOf(where, context.userId, sceneId) !== placeOf(where, data.targetUserId, sceneId)) {
      return { ok: false as const, error: "要先到同一处才能组队" };
    }
    const squads = readSquads(flags);
    if (squadOf(squads, context.userId).includes(data.targetUserId)) {
      return { ok: false as const, error: "已经在同一组" };
    }
    if (matesOf(squads, data.targetUserId).length) {
      return { ok: false as const, error: "对方已在别的组里，请先让他们离队" };
    }
    const mePc = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    const fromName =
      asJson<CharacterSheet>(mePc?.sheet, {} as CharacterSheet).name || "同伴";
    flags.squadInvite = {
      from: context.userId,
      to: data.targetUserId,
      fromName,
      at: Date.now(),
    };
    await writeFlags(sql, room.id, flags);
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      const projection = (await roomProjection(room.id, context.userId)).projection;
      const invite = projection.squadInvites.find((entry) => entry.fromId === context.userId);
      if (!invite) return { ok: true as const };
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "cancelSquadInvite",
        inviteId: invite.id,
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const { flags } = await flagsOf(sql, room.id);
    sweepSquadInvite(flags);
    const invite = readSquadInvite(flags);
    if (!invite) return { ok: true as const };
    if (invite.from !== context.userId) {
      return { ok: false as const, error: "只能取消自己发出的邀请" };
    }
    delete flags.squadInvite;
    await writeFlags(sql, room.id, flags);
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      const projection = (await roomProjection(room.id, context.userId)).projection;
      const invite = projection.squadInvites.find((entry) => entry.toId === context.userId);
      if (!invite) return { ok: false as const, error: "没有发给你的组队邀请" };
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "respondSquadInvite",
        inviteId: invite.id,
        accept: data.accept,
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const { flags, sceneId } = await flagsOf(sql, room.id);
    if (sweepSquadInvite(flags)) await writeFlags(sql, room.id, flags);
    const invite = readSquadInvite(flags);
    if (!invite || invite.to !== context.userId) {
      return { ok: false as const, error: "没有发给你的组队邀请" };
    }
    delete flags.squadInvite;
    if (!data.accept) {
      await writeFlags(sql, room.id, flags);
      return { ok: true as const };
    }
    const where = readWhere(flags);
    if (placeOf(where, invite.from, sceneId) !== placeOf(where, invite.to, sceneId)) {
      await writeFlags(sql, room.id, flags);
      return { ok: false as const, error: "已经不在同一处，组队取消" };
    }
    const nextSquads = joinSquad(readSquads(flags), invite.from, invite.to);
    flags.squads = nextSquads;
    await writeFlags(sql, room.id, flags);
    const rows = await sql<{ user_id: string; sheet: unknown }>`
      select user_id, sheet from characters where room_id = ${room.id} and locked = true
    `;
    const g = nextSquads.find((s) => s.ids.includes(context.userId));
    const names = g?.ids.map((id) => {
      const row = rows.find((r) => r.user_id === id);
      return asJson<CharacterSheet>(row?.sheet, {} as CharacterSheet).name || "同伴";
    });
    const capName =
      asJson<CharacterSheet>(
        rows.find((r) => r.user_id === g?.captain)?.sheet,
        {} as CharacterSheet,
      ).name || "队长";
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, null, ${"stage"}, ${"组队"},
        ${`${(names ?? []).join("、")} 组成一队，队长是 ${capName}。队员发言先入队内，队长批准才进桌。`},
        ${JSON.stringify({ place: placeOf(where, context.userId, sceneId) })}::jsonb
      )
    `;
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "leaveSquad",
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const { flags, sceneId } = await flagsOf(sql, room.id);
    const squads = readSquads(flags);
    if (squadOf(squads, context.userId).length < 2) {
      return { ok: false as const, error: "你不在任何组里" };
    }
    const mePc = (
      await sql<{ sheet: unknown }>`
        select sheet from characters
        where room_id = ${room.id} and user_id = ${context.userId}
      `
    )[0];
    const name =
      asJson<CharacterSheet>(mePc?.sheet, {} as CharacterSheet).name || "有人";
    flags.squads = leaveSquad(squads, context.userId);
    flags.squadQueue = readSquadQueue(flags).filter((q) => q.userId !== context.userId);
    await writeFlags(sql, room.id, flags);
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, null, ${"stage"}, ${"离队"},
        ${`${name} 离开了队伍，之后独自行动。`},
        ${JSON.stringify({ place: placeOf(readWhere(flags), context.userId, sceneId) })}::jsonb
      )
    `;
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      const projection = (await roomProjection(room.id, context.userId)).projection;
      if (!projection.squad) return { ok: false as const, error: "你不在任何组里" };
      const committed = await commitRulesV2Direct(room.id, context.userId, {
        kind: "transferSquadCaptain",
        squadId: projection.squad.id,
        targetId: data.toUserId,
      });
      if (committed.decision.kind === "rejected") {
        return { ok: false as const, error: committed.decision.rejection.message };
      }
      return { ok: true as const, rulesetVersion: RULESET_VERSION };
    }
    const { flags, sceneId } = await flagsOf(sql, room.id);
    const next = transferCaptain(readSquads(flags), context.userId, data.toUserId);
    if (!next) return { ok: false as const, error: "只能把队长交给同队的人" };
    flags.squads = next;
    await writeFlags(sql, room.id, flags);
    const rows = await sql<{ user_id: string; sheet: unknown }>`
      select user_id, sheet from characters where room_id = ${room.id} and locked = true
    `;
    const nameOf = (id: string) =>
      asJson<CharacterSheet>(
        rows.find((r) => r.user_id === id)?.sheet,
        {} as CharacterSheet,
      ).name || "同伴";
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, null, ${"stage"}, ${"队长"},
        ${`${nameOf(context.userId)} 把队长交给 ${nameOf(data.toUserId)}。`},
        ${JSON.stringify({ place: placeOf(readWhere(flags), context.userId, sceneId) })}::jsonb
      )
    `;
    return { ok: true as const };
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
    if (rules?.ruleset_version !== RULESET_VERSION) {
      return { ok: false as const, error: "这间旧房间的规则版本不可用" };
    }
    if (rules?.ruleset_version === RULESET_VERSION) {
      return {
        ok: false as const,
        error: "个人合法行动不再进入队长审批队列；成员可直接行动，移动或单独休息时会自动离队。",
      };
    }
    const { flags, sceneId } = await flagsOf(sql, room.id);
    const squads = readSquads(flags);
    if (!isCaptain(squads, context.userId)) {
      return { ok: false as const, error: "只有队长能批准队内发言" };
    }
    const queue = readSquadQueue(flags);
    const item = queue.find((q) => q.id === data.queueId);
    if (!item) return { ok: false as const, error: "这条已经不在缓冲里" };
    const mine = squadRecord(squads, context.userId);
    if (!mine?.ids.includes(item.userId)) {
      return { ok: false as const, error: "不是你们队的话" };
    }
    flags.squadQueue = queue.filter((q) => q.id !== data.queueId);
    await writeFlags(sql, room.id, flags);
    if (!data.accept) return { ok: true as const };
    const sayPlace = placeOf(readWhere(flags), item.userId, sceneId);
    await sql`
      insert into messages (id, room_id, user_id, kind, name, body, meta)
      values (
        ${uid("msg")}, ${room.id}, ${item.userId}, ${"say"}, ${item.name}, ${item.body},
        ${JSON.stringify({ place: sayPlace, solo: true })}::jsonb
      )
    `;
    const kp = await runKpTurn({
      roomId: room.id,
      actorUserId: item.userId,
      actorName: item.name,
      action: item.body,
      kind: "action",
      solo: true,
    });
    if (!kp.ok) return { ok: false as const, error: kp.error };
    return { ok: true as const };
  });
