import { env } from "cloudflare:workers";

import { ensureGear, spellcastingProfile } from "../dnd/compute";
import { classById } from "../dnd/catalog";
import { itemById } from "../dnd/gear";
import { getSql } from "../db";
import { weaponAttack } from "../kp/combat";
import {
  createAuthoritativeKpAdapter,
  type WorkersAiBinding,
} from "../kp/authoritative";
import { authoritativeKpProfileByBinding } from "../kp/authoritative-policy";
import type {
  KpNarrationRequest,
  KpProposalDraft,
  SemanticActionPlan,
} from "../kp/authoritative-types";
import type { CharacterSheet } from "../dnd/types";
import type { ProjectionQuery } from "../rules";
import type { Command } from "../rules/model";
import {
  AUTHORITATIVE_RULESET_VERSION,
  RULESET_VERSION,
} from "../rules/ruleset";
import { spellDefinition } from "../rules/spell-catalog";
import {
  handleRoomAction,
  handleRoomCorrection,
  type KpAdapterCapability,
  type RoomActionInput,
} from "./action";
import { roomServiceCapabilities } from "./archive";
import type {
  AuthoritativeCharacterSeed,
  AuthoritativeInitializationOutcome,
  AuthoritativeMemberSeed,
  TrustedPrincipalContext,
} from "./authority-types";
import {
  buildModelInvocationTelemetryEvent,
  buildRoomTelemetryEvent,
} from "./telemetry";
import { withRoomAuthorityTelemetry } from "./authority-telemetry";
import type { CommitTurnResult, TurnTicket } from "./types";

function roomStub(roomId: string) {
  return env.ROOMS.getByName(roomId);
}

function workersAiBinding(): WorkersAiBinding {
  return {
    run(model, input, options) {
      return env.AI.run(model, input, options);
    },
  };
}

function telemetryRoomAuthority(input: {
  roomId: string;
  userId: string;
  requestId?: string;
  submissionId?: string;
}) {
  return withRoomAuthorityTelemetry(roomStub(input.roomId), {
    roomId: input.roomId,
    principalId: input.userId,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    ...(input.submissionId === undefined ? {} : { submissionId: input.submissionId }),
    emit(event) {
      console.info(JSON.stringify(event));
    },
  });
}

/**
 * The API authenticates before reaching this adapter.  Keep the principal
 * construction here so no table request body, transcription, or model output
 * can supply the actor identity used by the authoritative Room RPCs.
 */
export function trustedRoomPrincipal(userId: string): TrustedPrincipalContext {
  if (!userId) throw new TypeError("A trusted authenticated user id is required.");
  return { principal: { id: userId, sessionVersion: 1 } };
}

export function authoritativeCharacterId(userId: string): string {
  if (!userId) throw new TypeError("A trusted authenticated user id is required.");
  return `character:${userId}`;
}

export async function initializeAuthoritativeRoom(input: {
  roomId: string;
  moduleId: string;
  members: AuthoritativeMemberSeed[];
  characters: AuthoritativeCharacterSeed[];
  fixtureFacts?: unknown[];
}): Promise<AuthoritativeInitializationOutcome> {
  return await roomStub(input.roomId).initializeAuthoritative({
    roomId: input.roomId,
    moduleId: input.moduleId,
    members: input.members,
    characters: input.characters,
    ...(input.fixtureFacts === undefined ? {} : { fixtureFacts: input.fixtureFacts }),
  }) as AuthoritativeInitializationOutcome;
}

export async function runAuthoritativeRoomAction(input: {
  roomId: string;
  userId: string;
  modelId: string;
  modelProfileVersion: string;
  action: RoomActionInput;
}) {
  const profile = authoritativeKpProfileByBinding(
    input.modelId,
    input.modelProfileVersion,
  );
  if (profile === undefined) {
    throw new TypeError("The room is not bound to a supported authoritative KP model profile.");
  }
  const kp = createAuthoritativeKpAdapter({
    ai: workersAiBinding(),
    profile,
    onInvocationReceipt(receipt) {
      console.info(JSON.stringify(buildModelInvocationTelemetryEvent({
        roomId: input.roomId,
        principalId: input.userId,
        receipt,
      })));
    },
  });
  return executeAuthoritativeRoomAction(input, kp);
}

export type AuthoritativeRoomCorrectionInput = {
  roomId: string;
  correctionId: string;
  receiptId: string;
  errorKind: string;
  explanation: string;
};

/**
 * Server-only entrypoint for applying an audited Receipt-bound correction.
 * No player route receives the opaque correction capability.
 */
export async function runAuthoritativeRoomCorrection(
  input: AuthoritativeRoomCorrectionInput,
) {
  const servicePrincipalId = "service:room-correction";
  const startedAt = Date.now();
  const sql = await getSql();
  const binding = (
    await sql<{
      ruleset_version: string;
      kp_model: string;
      kp_model_profile: string;
    }>`
      select ruleset_version, kp_model, kp_model_profile
      from rooms
      where id = ${input.roomId}
    `
  )[0];
  const profile = authoritativeKpProfileByBinding(
    binding?.kp_model,
    binding?.kp_model_profile,
  );
  if (
    binding?.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
    || profile === undefined
  ) {
    throw new TypeError("The room is not bound to a supported authoritative KP model profile.");
  }
  const kp = createAuthoritativeKpAdapter({
    ai: workersAiBinding(),
    profile,
    onInvocationReceipt(receipt) {
      console.info(JSON.stringify(buildModelInvocationTelemetryEvent({
        roomId: input.roomId,
        principalId: servicePrincipalId,
        receipt,
      })));
    },
  });
  const stub = roomStub(input.roomId);
  const outcome = await handleRoomCorrection({
    authority: {
      commitCorrection(capability, request) {
        return stub.commitCorrection(capability, request);
      },
      deliveryPublicationStatus(query) {
        return stub.deliveryPublicationStatus(query);
      },
      publishDelivery(authorization, publication) {
        return stub.publishDelivery(authorization, publication);
      },
    },
    kp,
  }, roomServiceCapabilities().correction, {
    correctionId: input.correctionId,
    receiptId: input.receiptId,
    errorKind: input.errorKind,
    explanation: input.explanation,
  });
  const receipt = outcome.receipt !== null && typeof outcome.receipt === "object"
    ? outcome.receipt as Record<string, unknown>
    : undefined;
  console.info(JSON.stringify(buildRoomTelemetryEvent({
    occurredAt: new Date().toISOString(),
    severity: outcome.kind === "committed" ? "info" : "warn",
    eventName: "room.correction.completed",
    requestId: input.correctionId,
    correlation: {
      roomId: input.roomId,
      principalId: servicePrincipalId,
      rootActionId: receipt?.rootActionId,
      receiptId: receipt?.receiptId,
    },
    outcome: { kind: outcome.kind },
    failure: "code" in outcome ? { code: outcome.code } : undefined,
    measurements: {
      operationKind: "roomCorrection",
      durationMs: Date.now() - startedAt,
    },
    archive: {
      correctionIntegrity: outcome.kind === "committed"
        ? outcome.deliveryPending === true ? "deliveryPending" : "published"
        : "rejected",
    },
  })));
  return outcome;
}

async function executeAuthoritativeRoomAction(input: {
  roomId: string;
  userId: string;
  action: RoomActionInput;
}, kp: KpAdapterCapability) {
  const startedAt = Date.now();
  const principal = trustedRoomPrincipal(input.userId);
  const authority = telemetryRoomAuthority({
    roomId: input.roomId,
    userId: input.userId,
    requestId: input.action.kind === "acknowledge"
      ? input.action.deliveryId
      : input.action.submissionId,
    ...(input.action.kind === "acknowledge"
      ? {}
      : { submissionId: input.action.submissionId }),
  });
  const outcome = await handleRoomAction({ principal, authority, kp }, input.action);
  const receipt = outcome.receipt !== null && typeof outcome.receipt === "object"
    ? outcome.receipt as Record<string, unknown>
    : undefined;
  console.info(JSON.stringify(buildRoomTelemetryEvent({
    occurredAt: new Date().toISOString(),
    severity: outcome.kind === "retryableFailure" || outcome.kind === "needsKp"
      ? "warn"
      : outcome.kind === "rejected" ? "info" : "info",
    eventName: "room.action.completed",
    requestId: input.action.kind === "acknowledge"
      ? input.action.deliveryId
      : input.action.submissionId,
    correlation: {
      roomId: input.roomId,
      principalId: input.userId,
      submissionId: input.action.kind === "acknowledge"
        ? undefined
        : input.action.submissionId,
      rootActionId: receipt?.rootActionId,
      receiptId: receipt?.receiptId,
    },
    outcome: { kind: outcome.kind },
    failure: "code" in outcome
      ? { code: outcome.code }
      : outcome.kind === "needsKp"
        ? { code: "mechanicalDiagnostic" }
        : undefined,
    measurements: {
      operationKind: "roomAuthority",
      durationMs: Date.now() - startedAt,
    },
  })));
  return outcome;
}

type AuthoritativeAdministrationResult =
  | { ok: true; receipt?: unknown }
  | { ok: false; code: string; error: string };

function administrationResult(value: unknown): AuthoritativeAdministrationResult {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "committed") {
      return {
        ok: true,
        ...(record.receipt === undefined ? {} : { receipt: record.receipt }),
      };
    }
    return {
      ok: false,
      code: typeof record.code === "string" ? record.code : "roomAdministrationRejected",
      error: typeof record.explanation === "string"
        ? record.explanation
        : "房间权威没有接受这项席位变更。",
    };
  }
  return {
    ok: false,
    code: "roomAdministrationUnavailable",
    error: "房间权威暂时没有回应。",
  };
}

async function applyAuthoritativeRoomAdministration(
  roomId: string,
  command: Record<string, unknown>,
): Promise<AuthoritativeAdministrationResult> {
  const value = await roomStub(roomId).applyRoomAdministration(
    roomServiceCapabilities().roomAdministration,
    command,
  );
  return administrationResult(value);
}

export async function prepareAuthoritativeRoomDeletion(input: {
  roomId: string;
  userId: string;
}) {
  return await roomStub(input.roomId).prepareDeletion(
    roomServiceCapabilities().roomDeletion,
    trustedRoomPrincipal(input.userId),
  ) as unknown;
}

export async function cancelAuthoritativeRoomDeletion(input: {
  roomId: string;
  userId: string;
}) {
  return await roomStub(input.roomId).cancelDeletion(
    roomServiceCapabilities().roomDeletion,
    trustedRoomPrincipal(input.userId),
  ) as unknown;
}

export async function finalizeAuthoritativeRoomDeletion(input: {
  roomId: string;
}) {
  return await roomStub(input.roomId).finalizeDeletion(
    roomServiceCapabilities().roomDeletion,
  ) as unknown;
}

export async function activateAuthoritativeMember(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  role: "player" | "observer";
  characterId?: string;
}): Promise<AuthoritativeAdministrationResult> {
  const seat = await applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: `${input.commandId}:seat`,
    kind: "grantSeat",
    principal: { id: input.principalId, sessionVersion: 1 },
    role: input.role,
  });
  if (!seat.ok || input.characterId === undefined) return seat;

  const control = await applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: `${input.commandId}:control`,
    kind: "grantControl",
    characterId: input.characterId,
    seatId: `seat:${input.principalId}`,
  });
  if (control.ok) return control;

  await applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: `${input.commandId}:rollback`,
    kind: "departMember",
    principalId: input.principalId,
    reason: "characterControlRestoreRejected",
  });
  return control;
}

export function removeAuthoritativeMember(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  reason: string;
}) {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "removeMember",
    principalId: input.principalId,
    reason: input.reason,
  });
}

export function departAuthoritativeMember(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  reason: string;
}) {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "departMember",
    principalId: input.principalId,
    reason: input.reason,
  });
}

export async function transferAndDepartAuthoritativeHost(input: {
  roomId: string;
  commandId: string;
  fromPrincipalId: string;
  toPrincipalId: string;
  reason: string;
}): Promise<AuthoritativeAdministrationResult> {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "transferHostAndDepart",
    fromPrincipalId: input.fromPrincipalId,
    toPrincipalId: input.toPrincipalId,
    reason: input.reason,
  });
}

export function materializeAuthoritativeCharacter(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  character: AuthoritativeCharacterSeed;
}) {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "materializeCharacter",
    principalId: input.principalId,
    seatId: `seat:${input.principalId}`,
    character: input.character,
  });
}

export function introduceAuthoritativeSuccessor(input: {
  roomId: string;
  commandId: string;
  principalId: string;
  predecessorCharacterId: string;
  character: AuthoritativeCharacterSeed;
  worldEntry: string;
}) {
  return applyAuthoritativeRoomAdministration(input.roomId, {
    commandId: input.commandId,
    kind: "introduceSuccessor",
    principalId: input.principalId,
    predecessorCharacterId: input.predecessorCharacterId,
    character: input.character,
    worldEntry: input.worldEntry,
  });
}

export type AuthoritativePartyAction =
  | { kind: "invite"; targetPrincipalId: string }
  | { kind: "cancelInvitation" }
  | { kind: "answerInvitation"; accept: boolean }
  | { kind: "leave" }
  | { kind: "transferLeadership"; targetPrincipalId: string };

function directPartyActionPlan(
  goal: string,
  method: string,
  mechanicalProposal: SemanticActionPlan,
): KpProposalDraft {
  return {
    kind: "directSuccess",
    goal,
    method,
    publicBasisRefs: [],
    privateBasisRefs: [],
    adjudicationPrecedent: null,
    risk: null,
    pendingInput: null,
    dynamicMaterializations: [],
    npcActions: [],
    mechanicalProposal,
    scene: {
      question: goal,
      pressure: "",
      opportunities: [],
      conclusionCandidate: null,
    },
  };
}

function projectedPendingInput(
  observation: unknown,
  kind: "partyInvitation" | "partyMoveConsent",
  access?: "controller" | "initiator",
): string | undefined {
  if (!observation || typeof observation !== "object") return undefined;
  const readModel = (observation as { readModel?: unknown }).readModel;
  if (!readModel || typeof readModel !== "object") return undefined;
  const pending = (readModel as { pendingInputs?: unknown }).pendingInputs;
  if (!Array.isArray(pending)) return undefined;
  const match = pending.find((entry) =>
    entry
    && typeof entry === "object"
    && (entry as { kind?: unknown }).kind === kind
    && (access === undefined || (entry as { access?: unknown }).access === access)
    && typeof (entry as { pendingInputId?: unknown }).pendingInputId === "string"
  ) as { pendingInputId: string } | undefined;
  return match?.pendingInputId;
}

function projectedActiveCharacterId(observation: unknown, principalId: string): string | undefined {
  if (!observation || typeof observation !== "object") return undefined;
  const readModel = (observation as { readModel?: unknown }).readModel;
  if (!readModel || typeof readModel !== "object") return undefined;
  const roomMembers = (readModel as { roomMembers?: unknown }).roomMembers;
  if (!Array.isArray(roomMembers)) return undefined;
  const member = roomMembers.find((entry) => entry && typeof entry === "object"
    && (entry as { principalId?: unknown }).principalId === principalId) as {
      characterIds?: unknown;
    } | undefined;
  if (!Array.isArray(member?.characterIds) || member.characterIds.length !== 1
    || typeof member.characterIds[0] !== "string") return undefined;
  return member.characterIds[0];
}

export async function runAuthoritativePartyAction(input: {
  roomId: string;
  userId: string;
  modelId: string;
  modelProfileVersion: string;
  submissionId: string;
  action: AuthoritativePartyAction;
}) {
  const profile = authoritativeKpProfileByBinding(
    input.modelId,
    input.modelProfileVersion,
  );
  if (profile === undefined) {
    throw new TypeError("The room is not bound to a supported authoritative KP model profile.");
  }
  let action: RoomActionInput;
  let proposal: KpProposalDraft | undefined;
  switch (input.action.kind) {
    case "invite": {
      const targetCharacterId = projectedActiveCharacterId(
        await roomStub(input.roomId).observe(trustedRoomPrincipal(input.userId)),
        input.action.targetPrincipalId,
      );
      if (targetCharacterId === undefined) {
        return {
          kind: "rejected" as const,
          code: "targetSeatUnavailable",
          explanation: "目标席位当前没有唯一的活跃角色。",
        };
      }
      action = {
        kind: "intent",
        submissionId: input.submissionId,
        text: `我邀请 ${targetCharacterId} 同行。`,
      };
      proposal = directPartyActionPlan(
        `邀请 ${targetCharacterId} 同行`,
        "由当前角色发出明确的同行邀请",
        {
          operation: "changeParty",
          partyAction: "inviteMember",
          memberRefs: [targetCharacterId],
        },
      );
      break;
    }
    case "cancelInvitation": {
      const authority = roomStub(input.roomId);
      const principal = trustedRoomPrincipal(input.userId);
      const pendingInputId = projectedPendingInput(
        await authority.observe(principal),
        "partyInvitation",
        "initiator",
      );
      if (pendingInputId === undefined) {
        return {
          kind: "rejected" as const,
          code: "partyInvitationUnavailable",
          explanation: "当前没有由你发出且仍在等待回应的同行邀请。",
        };
      }
      action = {
        kind: "intent",
        submissionId: input.submissionId,
        text: "我取消自己尚未得到回应的同行邀请。",
      };
      proposal = directPartyActionPlan(
        "取消尚未得到回应的同行邀请",
        "撤回由当前角色发出的待决邀请",
        {
          operation: "changeParty",
          partyAction: "cancelInvitation",
          pendingInputRef: pendingInputId,
        },
      );
      break;
    }
    case "answerInvitation": {
      const authority = roomStub(input.roomId);
      const principal = trustedRoomPrincipal(input.userId);
      const pendingInputId = projectedPendingInput(
        await authority.observe(principal),
        "partyInvitation",
        "controller",
      );
      if (pendingInputId === undefined) {
        return {
          kind: "rejected" as const,
          code: "partyInvitationUnavailable",
          explanation: "当前没有等待你回答的同行邀请。",
        };
      }
      action = {
        kind: "answer",
        submissionId: input.submissionId,
        pendingInputId,
        answer: { accept: input.action.accept },
      };
      proposal = undefined;
      break;
    }
    case "leave":
      action = {
        kind: "intent",
        submissionId: input.submissionId,
        text: "我明确离开当前同行队伍，之后独自行动。",
      };
      proposal = directPartyActionPlan(
        "离开当前同行队伍",
        "当前角色明确选择独自行动",
        { operation: "changeParty", partyAction: "leave" },
      );
      break;
    case "transferLeadership": {
      const targetCharacterId = projectedActiveCharacterId(
        await roomStub(input.roomId).observe(trustedRoomPrincipal(input.userId)),
        input.action.targetPrincipalId,
      );
      if (targetCharacterId === undefined) {
        return {
          kind: "rejected" as const,
          code: "targetSeatUnavailable",
          explanation: "目标席位当前没有唯一的活跃角色。",
        };
      }
      action = {
        kind: "intent",
        submissionId: input.submissionId,
        text: `我把同行队伍的组织权交给 ${targetCharacterId}。`,
      };
      proposal = directPartyActionPlan(
        `把同行队伍的组织权交给 ${targetCharacterId}`,
        "当前队长明确转交组织权",
        {
          operation: "changeParty",
          partyAction: "transferLeadership",
          memberRefs: [targetCharacterId],
        },
      );
      break;
    }
  }
  const narration = createAuthoritativeKpAdapter({
    ai: workersAiBinding(),
    profile,
    onInvocationReceipt(receipt) {
      console.info(JSON.stringify(buildModelInvocationTelemetryEvent({
        roomId: input.roomId,
        principalId: input.userId,
        receipt,
      })));
    },
  });
  return executeAuthoritativeRoomAction({
    roomId: input.roomId,
    userId: input.userId,
    action,
  }, {
    propose: async () => {
      if (proposal === undefined) {
        throw new Error("Authenticated party answers must resolve without a KP proposal.");
      }
      return structuredClone(proposal);
    },
    narrate: (request) => narration.narrate(request as unknown as KpNarrationRequest),
  });
}

export function observeAuthoritativeRoom(
  roomId: string,
  userId: string,
  query?: ProjectionQuery,
) {
  return telemetryRoomAuthority({ roomId, userId }).observe(
    trustedRoomPrincipal(userId),
    query,
  );
}

export function acknowledgeAuthoritativeDelivery(
  roomId: string,
  userId: string,
  deliveryId: string,
) {
  return telemetryRoomAuthority({ roomId, userId, requestId: deliveryId }).acknowledge(
    trustedRoomPrincipal(userId),
    deliveryId,
  );
}

function resourceCounts(sheet: CharacterSheet) {
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(sheet.resources ?? {})) {
    if (typeof value === "number") values[key] = value;
    else if (value && typeof value === "object") {
      const record = value as { max?: unknown; used?: unknown };
      if (typeof record.max === "number") {
        values[key] = Math.max(0, record.max - (typeof record.used === "number" ? record.used : 0));
      }
    }
  }
  if (sheet.classId === "wizard") {
    values.arcaneRecovery = sheet.resources?.arcaneRecovery ? 0 : 1;
  }
  values.inspiration = sheet.inspiration ? 1 : 0;
  return values;
}

function resourceRules(sheet: CharacterSheet) {
  const values: Record<
    string,
    { max: number; recovery: "none" | "short" | "long" | "shortOrLong"; die?: number }
  > = {};
  const short = new Set(["channel", "surge", "secondWind", "superiority", "breath"]);
  const long = new Set(["slot1", "slot2", "hitDice", "rage", "warPriest", "relentless"]);
  for (const [key, value] of Object.entries(sheet.resources ?? {})) {
    if (value && typeof value === "object" && "max" in value) {
      const maximum = Number((value as { max?: unknown }).max);
      if (Number.isFinite(maximum) && maximum >= 0) {
        values[key] = {
          max: maximum,
          recovery: short.has(key) ? "shortOrLong" : long.has(key) ? "long" : "none",
          die:
            key === "hitDice" && "die" in value
              ? Number((value as { die?: unknown }).die)
              : undefined,
        };
      }
    } else if (typeof value === "number") {
      values[key] = { max: value, recovery: "none" };
    }
  }
  if (sheet.classId === "wizard") {
    values.arcaneRecovery = { max: 1, recovery: "long" };
  }
  values.inspiration = { max: 1, recovery: "none" };
  return values;
}

function primaryAttack(sheet: CharacterSheet) {
  const attack = weaponAttack(sheet);
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(attack.damage.replace(/\s/g, ""));
  const item = itemById(sheet.equipped?.main);
  const range = /（?(\d+)\/(\d+)）?/.exec(item?.text ?? "");
  return {
    id: "primary-weapon",
    name: attack.weapon,
    attackBonus: attack.bonus,
    kind: attack.ranged ? ("ranged" as const) : ("melee" as const),
    ammoResource:
      item?.id === "light-crossbow"
        ? ("bolt" as const)
        : item?.id === "shortbow" || item?.id === "longbow"
          ? ("arrow" as const)
          : undefined,
    reachFeet: attack.ranged ? undefined : /触及/.test(item?.text ?? "") ? 10 : 5,
    normalRangeFeet: attack.ranged ? Number(range?.[1] ?? 80) : undefined,
    longRangeFeet: attack.ranged ? Number(range?.[2] ?? 320) : undefined,
    damage: {
      count: Number(match?.[1] ?? 1),
      sides: Number(match?.[2] ?? 4),
      bonus: Number(match?.[3] ?? 0),
      damageType: attack.ranged ? "piercing" : "physical",
    },
  };
}

function playerCapabilities(sheet: CharacterSheet) {
  return [
    ...(sheet.equipment ?? []).map((item) => `equipment:${item}`),
    ...(sheet.backpack ?? []).map((entry) => `item:${entry.itemId}`),
    ...(["high-elf", "wood-elf", "half-elf"].includes(sheet.raceId)
      ? ["immunity:magical-sleep", "save-advantage:charmed"]
      : []),
    ...(["hill-dwarf", "mountain-dwarf"].includes(sheet.raceId)
      ? ["resistance:poison", "save-advantage:poisoned"]
      : []),
    ...(sheet.raceId === "tiefling" ? ["resistance:fire"] : []),
  ];
}

function playerEntity(userId: string, rawSheet: CharacterSheet) {
  const sheet = ensureGear(rawSheet);
  const resources = resourceCounts(sheet);
  const ownedResourceFeatures = new Set(Object.keys(sheet.resources ?? {}));
  const spellIds = [...new Set([...sheet.cantrips, ...sheet.prepared, ...sheet.spellbook])];
  return {
    id: userId,
    kind: "player" as const,
    name: sheet.name || "冒险者",
    abilityScores: sheet.scores,
    proficiencyBonus: sheet.proficiency,
    proficientSaves: [...(classById(sheet.classId)?.saves ?? [])],
    proficientSkills: [...sheet.skills],
    expertiseSkills: [...sheet.expertise],
    creatureType: "humanoid",
    conditionImmunities: playerCapabilities(sheet)
      .filter((entry) => entry.startsWith("immunity:"))
      .map((entry) => entry.slice("immunity:".length)),
    capabilities: playerCapabilities(sheet),
    level: sheet.level,
    spellLevels: Object.fromEntries(
      spellIds
        .map((spellId) => [spellId, spellDefinition(spellId)?.level] as const)
        .filter((entry): entry is [string, 0 | 1 | 2] => entry[1] !== undefined),
    ),
    spellActionCosts: Object.fromEntries(
      spellIds.flatMap((spellId) => {
        const definition = spellDefinition(spellId);
        return definition ? [[spellId, definition.actionCost] as const] : [];
      }),
    ),
    spellcasting: Object.fromEntries(
      spellIds.flatMap((spellId) => {
        const profile = spellcastingProfile(sheet, spellId);
        return profile ? [[spellId, profile] as const] : [];
      }),
    ),
    featureIds: [
      "rage",
      "surge",
      "secondWind",
      "channel",
      "breath",
      "torch",
      "ration",
      ...(sheet.classId === "rogue" ? ["cunningAction"] : []),
      ...(sheet.raceId === "lightfoot" ? ["halflingLucky"] : []),
      ...(sheet.classId === "wizard" ? ["arcaneRecovery"] : []),
      ...(sheet.classId === "cleric" && sheet.subclassId === "life"
        ? ["discipleOfLife"]
        : []),
    ].filter(
      (featureId) =>
        featureId === "arcaneRecovery" ||
        featureId === "discipleOfLife" ||
        featureId === "cunningAction" ||
        featureId === "halflingLucky" ||
        ownedResourceFeatures.has(featureId),
    ),
    activeEffects: [
      ...(sheet.resources?.rage.on ? ["rage"] : []),
      ...(["guidance", "bless"].includes(sheet.resources?.conc?.id ?? "")
        ? [sheet.resources!.conc!.id]
        : []),
    ],
    attacks: [primaryAttack(sheet)],
    resources,
    resourceRules: resourceRules(sheet),
    hp: { current: sheet.hp.current, max: sheet.hp.max },
    ac: sheet.ac,
    speedFeet: sheet.speed,
  };
}

export async function initializeRoomAuthority(input: {
  roomId: string;
  moduleId: string;
  characters: Array<{ userId: string; sheet: CharacterSheet }>;
}) {
  const stub = roomStub(input.roomId);
  const players = input.characters.map(({ userId, sheet }) => playerEntity(userId, sheet));
  const result = await stub.initialize({
    roomId: input.roomId,
    moduleId: input.moduleId,
    rulesetVersion: RULESET_VERSION,
    players,
  });
  for (const player of players) await stub.upsertPlayer({ player });
  return result;
}

export function upsertRoomPlayer(roomId: string, userId: string, sheet: CharacterSheet) {
  return roomStub(roomId).upsertPlayer({ player: playerEntity(userId, sheet) });
}

export function departRoomPlayer(roomId: string, userId: string) {
  return roomStub(roomId).departPlayer(userId);
}

export function synchronizeRoomPlayerLoadout(
  roomId: string,
  userId: string,
  rawSheet: CharacterSheet,
) {
  const sheet = ensureGear(rawSheet);
  const player = playerEntity(userId, sheet);
  return roomStub(roomId).synchronizePlayerLoadout({
    playerId: userId,
    ac: sheet.ac,
    attacks: [primaryAttack(sheet)],
    capabilities: player.capabilities,
    proficientSaves: player.proficientSaves,
    creatureType: player.creatureType,
    conditionImmunities: player.conditionImmunities,
    spellLevels: player.spellLevels,
    spellActionCosts: player.spellActionCosts,
    spellcasting: player.spellcasting,
  });
}

export function prepareRoomTurn(roomId: string, actorId: string): Promise<TurnTicket> {
  return roomStub(roomId).prepareTurn({ actorId });
}

export function commitRoomTurn(
  roomId: string,
  ticketId: string,
  command: Command,
): Promise<CommitTurnResult> {
  return roomStub(roomId).commitTurn({ ticketId, command });
}

export function roomProjection(roomId: string, viewerId: string) {
  return roomStub(roomId).getSnapshot(viewerId);
}

export function finishRoomNarration(roomId: string, ticketId: string) {
  return roomStub(roomId).finishNarration(ticketId);
}

export function failRoomInterpretation(roomId: string, ticketId: string) {
  return roomStub(roomId).markInterpretationFailed(ticketId);
}
