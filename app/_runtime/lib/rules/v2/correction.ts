import { canonicalSha256 } from "../profiles/canonical";
import type { Sha256Ref } from "../profiles/types";
import type {
  AuthoritativeWorldState,
  CharacterControlRecord,
  CharacterRecord,
  CorrectionAuditRecord,
  CorrectionEffect,
  CorrectionRuntimeState,
  EventEnvelope,
  EventPayloadByType,
  JsonRecord,
  KnowledgeRecord,
} from "./model";
import { fictionTimelineIdForScene } from "./multiplayer-model";
import { npcMechanicalItemStateCauseUseFactId } from "./multiplayer-events";

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function exact(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalStrings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(nonEmpty)
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

const COMBAT_RUNTIME_KEYS = [
  "definitions",
  "effects",
  "encounters",
  "entities",
  "pendingInputs",
  "randomnessResolutions",
  "scenes",
  "story",
] as const;

function isCombatRuntimeSnapshot(value: unknown): boolean {
  if (
    !record(value)
    || !exact(value, COMBAT_RUNTIME_KEYS)
    || !(value.story === null || record(value.story))
  ) return false;
  return COMBAT_RUNTIME_KEYS
    .filter((key) => key !== "story")
    .every((key) => record(value[key]));
}

export function correctionAuthorityCapability(roomId: string, runtimeEpochId: string): Sha256Ref {
  return canonicalSha256({
    kind: "roomCorrectionAuthority",
    roomId,
    runtimeEpochId,
  });
}

export function emptyCorrectionRuntime(roomId: string, runtimeEpochId: string): CorrectionRuntimeState {
  return {
    authorityCapability: correctionAuthorityCapability(roomId, runtimeEpochId),
    audit: {},
    corrections: {},
    branches: {},
  };
}

export function isCorrectionEffect(value: unknown): value is CorrectionEffect {
  if (!record(value) || !nonEmpty(value.kind)) return false;
  switch (value.kind) {
    case "restoreFictionTime":
      return exact(value, ["beforeMicros", "kind", "timelineId"])
        && nonEmpty(value.timelineId)
        && typeof value.beforeMicros === "string"
        && /^(0|[1-9][0-9]*)$/.test(value.beforeMicros);
    case "restoreScene":
      return exact(value, ["before", "kind", "sceneId"])
        && nonEmpty(value.sceneId)
        && (value.before === null || record(value.before));
    case "restoreCanonicalFact":
      return exact(value, ["before", "factId", "kind"])
        && nonEmpty(value.factId)
        && (value.before === null || record(value.before));
    case "restoreKnowledge":
      return exact(value, ["before", "characterId", "kind", "knowledgeRef"])
        && nonEmpty(value.characterId)
        && nonEmpty(value.knowledgeRef)
        && (value.before === null || record(value.before));
    case "restoreCharacter":
      return exact(value, ["before", "characterId", "controlBefore", "kind"])
        && nonEmpty(value.characterId)
        && (value.before === null || record(value.before))
        && (value.controlBefore === null || record(value.controlBefore));
    case "restoreCharacterTimeline":
      return exact(value, ["beforeTimelineId", "characterId", "kind"])
        && nonEmpty(value.characterId)
        && nonEmpty(value.beforeTimelineId);
    case "restoreCombatEntity":
      return exact(value, ["before", "entityId", "kind"])
        && nonEmpty(value.entityId)
        && (value.before === null || record(value.before));
    case "restoreCombatRuntime":
      return exact(value, ["before", "kind"])
        && isCombatRuntimeSnapshot(value.before);
    case "restoreDefinition":
      return exact(value, ["beforeCampaign", "beforeCombat", "definitionId", "kind"])
        && nonEmpty(value.definitionId)
        && (value.beforeCampaign === null || record(value.beforeCampaign))
        && (value.beforeCombat === null || record(value.beforeCombat));
    case "restoreCampaignEntry":
      return exact(value, ["before", "collection", "entryId", "kind"])
        && nonEmpty(value.collection)
        && nonEmpty(value.entryId)
        && (value.before === null || record(value.before));
    case "restoreCampaignDescriptor":
      return exact(value, ["before", "kind"])
        && (value.before === null || record(value.before));
    case "restorePendingInputs":
      return exact(value, ["before", "kind"])
        && record(value.before);
    case "restoreTenureRuntime":
      return exact(value, [
        "characterId",
        "combatEntityBefore",
        "kind",
        "partyGroupsBefore",
        "partyInvitationsBefore",
        "partyMoveProposalsBefore",
        "pendingInputsBefore",
        "pendingReceiptsBefore",
        "suspendedPendingInputsBefore",
      ])
        && nonEmpty(value.characterId)
        && record(value.pendingInputsBefore)
        && record(value.suspendedPendingInputsBefore)
        && record(value.pendingReceiptsBefore)
        && record(value.partyGroupsBefore)
        && record(value.partyInvitationsBefore)
        && record(value.partyMoveProposalsBefore)
        && (value.combatEntityBefore === null || record(value.combatEntityBefore));
    case "restoreSuccessorRuntime":
      return exact(value, [
        "causalFrontierBefore",
        "characterTimelineBefore",
        "kind",
        "spotlightBefore",
        "successorCharacterId",
        "timelineBefore",
        "timelineId",
      ])
        && nonEmpty(value.successorCharacterId)
        && nonEmpty(value.timelineId)
        && (value.characterTimelineBefore === null || nonEmpty(value.characterTimelineBefore))
        && (value.timelineBefore === null || record(value.timelineBefore))
        && (value.causalFrontierBefore === null || record(value.causalFrontierBefore))
        && (value.spotlightBefore === null || record(value.spotlightBefore));
    default:
      return false;
  }
}

export function isCorrectionRuntime(value: unknown): value is CorrectionRuntimeState {
  if (
    !record(value)
    || !exact(value, ["audit", "authorityCapability", "branches", "corrections"])
    || typeof value.authorityCapability !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(value.authorityCapability)
    || !record(value.audit)
    || !record(value.corrections)
    || !record(value.branches)
  ) return false;
  return Object.entries(value.audit).every(([eventId, entry]) => record(entry)
    && exact(entry, ["branchId", "effects", "eventId", "eventSeq", "eventType", "payloadHash", "rootActionId"])
    && entry.eventId === eventId
    && [entry.branchId, entry.eventSeq, entry.eventType, entry.rootActionId].every(nonEmpty)
    && typeof entry.payloadHash === "string"
    && /^sha256:[0-9a-f]{64}$/.test(entry.payloadHash)
    && Array.isArray(entry.effects)
    && entry.effects.every(isCorrectionEffect));
}

function restoreCharacter(
  state: AuthoritativeWorldState,
  characterId: string,
): CorrectionEffect {
  return {
    kind: "restoreCharacter",
    characterId,
    before: state.entities[characterId] === undefined
      ? null
      : structuredClone(state.entities[characterId]),
    controlBefore: state.characterControls[characterId] === undefined
      ? null
      : structuredClone(state.characterControls[characterId]),
  };
}

function restoreKnowledge(
  state: AuthoritativeWorldState,
  characterId: string,
  knowledgeRef: string,
): CorrectionEffect {
  return {
    kind: "restoreKnowledge",
    characterId,
    knowledgeRef,
    before: state.knowledge[characterId]?.[knowledgeRef] === undefined
      ? null
      : structuredClone(state.knowledge[characterId][knowledgeRef]),
  };
}

function restoreCharacterTimeline(
  state: AuthoritativeWorldState,
  characterId: string,
): CorrectionEffect | undefined {
  const beforeTimelineId = state.multiplayerRuntime.characterTimelineIds[characterId];
  return beforeTimelineId === undefined
    ? undefined
    : { kind: "restoreCharacterTimeline", characterId, beforeTimelineId };
}

function restoreCombatEntity(state: AuthoritativeWorldState, entityId: string): CorrectionEffect {
  return {
    kind: "restoreCombatEntity",
    entityId,
    before: state.combatRuntime.entities[entityId] === undefined
      ? null
      : structuredClone(state.combatRuntime.entities[entityId]),
  };
}

function restoreCombatRuntime(state: AuthoritativeWorldState): CorrectionEffect {
  return {
    kind: "restoreCombatRuntime",
    before: structuredClone(state.combatRuntime),
  };
}

function restoreDefinition(state: AuthoritativeWorldState, definitionId: string): CorrectionEffect {
  return {
    kind: "restoreDefinition",
    definitionId,
    beforeCampaign: state.campaignRuntime.definitions[definitionId] === undefined
      ? null
      : structuredClone(state.campaignRuntime.definitions[definitionId]),
    beforeCombat: state.combatRuntime.definitions[definitionId] === undefined
      ? null
      : structuredClone(state.combatRuntime.definitions[definitionId]),
  };
}

function restoreCampaignEntry(
  state: AuthoritativeWorldState,
  collection: keyof AuthoritativeWorldState["campaignRuntime"],
  entryId: string,
): CorrectionEffect | undefined {
  const candidate = state.campaignRuntime[collection];
  if (!record(candidate)) return undefined;
  const entries = candidate as JsonRecord;
  return {
    kind: "restoreCampaignEntry",
    collection,
    entryId,
    before: entries[entryId] === undefined ? null : structuredClone(entries[entryId] as JsonRecord),
  };
}

function restoreItemSystemCollection(
  state: AuthoritativeWorldState,
  collection: "definitions" | "entries",
): CorrectionEffect {
  const effect = restoreCampaignEntry(state, "itemSystem", collection);
  if (effect === undefined) throw new TypeError("authoritative item system is unavailable");
  return effect;
}

function restoreTenureRuntime(
  state: AuthoritativeWorldState,
  characterId: string,
): CorrectionEffect {
  const pendingRootActionIds = Object.values(state.pendingInputs)
    .filter((pending) => pending.controllerCharacterId === characterId)
    .map((pending) => pending.rootActionId);
  return {
    kind: "restoreTenureRuntime",
    characterId,
    pendingInputsBefore: structuredClone(state.pendingInputs) as unknown as JsonRecord,
    suspendedPendingInputsBefore: structuredClone(
      state.multiplayerRuntime.suspendedPendingInputs,
    ) as JsonRecord,
    pendingReceiptsBefore: Object.fromEntries(
      [...new Set(pendingRootActionIds)].sort().flatMap((rootActionId) => {
        const receipt = state.receipts[rootActionId];
        return receipt === undefined ? [] : [[rootActionId, structuredClone(receipt)]];
      }),
    ),
    partyGroupsBefore: structuredClone(state.multiplayerRuntime.partyGroups) as JsonRecord,
    partyInvitationsBefore: structuredClone(
      state.multiplayerRuntime.partyInvitations,
    ) as JsonRecord,
    partyMoveProposalsBefore: structuredClone(
      state.multiplayerRuntime.partyMoveProposals,
    ) as JsonRecord,
    combatEntityBefore: state.combatRuntime.entities[characterId] === undefined
      ? null
      : structuredClone(state.combatRuntime.entities[characterId]),
  };
}

function restoreSuccessorRuntime(
  state: AuthoritativeWorldState,
  successorCharacterId: string,
  successorSceneId: string,
): CorrectionEffect {
  const primarySceneId = String(
    state.multiplayerRuntime.causalFrontiers[state.activeBranchId]?.sceneId ?? "",
  );
  const timelineId = successorSceneId === primarySceneId
    ? state.activeBranchId
    : fictionTimelineIdForScene(state.activeBranchId, successorSceneId);
  return {
    kind: "restoreSuccessorRuntime",
    successorCharacterId,
    timelineId,
    characterTimelineBefore:
      state.multiplayerRuntime.characterTimelineIds[successorCharacterId] ?? null,
    timelineBefore: state.fictionTimelines[timelineId] === undefined
      ? null
      : structuredClone(state.fictionTimelines[timelineId]),
    causalFrontierBefore: state.multiplayerRuntime.causalFrontiers[timelineId] === undefined
      ? null
      : structuredClone(state.multiplayerRuntime.causalFrontiers[timelineId]),
    spotlightBefore: state.multiplayerRuntime.spotlightLedger[successorCharacterId] === undefined
      ? null
      : structuredClone(state.multiplayerRuntime.spotlightLedger[successorCharacterId]),
  };
}

/** Capture only deterministic inverse primitives before the typed event folds. */
export function correctionEffectsBefore(
  state: AuthoritativeWorldState,
  event: EventEnvelope,
): CorrectionEffect[] {
  const payload = event.payload as JsonRecord;
  switch (event.eventType) {
    case "ImprovisedActionResolved": {
      const fact = payload.fact;
      return record(fact) && nonEmpty(fact.id)
        ? [{ kind: "restoreCanonicalFact", factId: fact.id, before: null }]
        : [];
    }
    case "CanonicalFactDeclared": {
      const fact = payload.fact;
      return record(fact) && nonEmpty(fact.id)
        ? [{ kind: "restoreCanonicalFact", factId: fact.id, before: null }]
        : [];
    }
    case "KnowledgeAcquired": {
      if (Array.isArray(payload.items) && nonEmpty(payload.characterId)) {
        return payload.items.flatMap((item) => record(item) && nonEmpty(item.knowledgeRef)
          ? [restoreKnowledge(state, payload.characterId as string, item.knowledgeRef)]
          : []);
      }
      return nonEmpty(payload.characterId) && nonEmpty(payload.knowledgeRef)
        ? [restoreKnowledge(state, payload.characterId, payload.knowledgeRef)]
        : [];
    }
    case "KnowledgeShared":
      return Array.isArray(payload.recipientCharacterIds) && nonEmpty(payload.sourceKnowledgeRef)
        ? payload.recipientCharacterIds.filter(nonEmpty)
          .map((characterId) => restoreKnowledge(state, characterId, payload.sourceKnowledgeRef as string))
        : [];
    case "SensoryEvidenceAcquired":
      return nonEmpty(payload.characterId) && nonEmpty(payload.factId)
        ? [restoreKnowledge(state, payload.characterId, payload.factId)]
        : [];
    case "SourceClaimCreated": {
      const effects: CorrectionEffect[] = nonEmpty(payload.speakerId) && nonEmpty(payload.claimId)
        ? [restoreKnowledge(state, payload.speakerId, payload.claimId)]
        : [];
      const campaign = nonEmpty(payload.claimId)
        ? restoreCampaignEntry(state, "sourceClaims", payload.claimId)
        : undefined;
      if (campaign !== undefined) effects.push(campaign);
      return effects;
    }
    case "SocialResolutionOffered": {
      const effects: CorrectionEffect[] = [{
        kind: "restorePendingInputs",
        before: structuredClone(state.pendingInputs) as unknown as JsonRecord,
      }];
      const thread = nonEmpty(payload.threadRef)
        ? restoreCampaignEntry(state, "conversationThreads", payload.threadRef)
        : undefined;
      if (thread !== undefined) effects.push(thread);
      return effects;
    }
    case "SocialResolutionDeclined":
    case "SocialDirectResolved":
    case "SocialCheckResolved": {
      return [...new Set([payload.threadRef, payload.addressedThreadRef].filter(nonEmpty))]
        .flatMap((threadRef) => {
          const thread = restoreCampaignEntry(state, "conversationThreads", threadRef);
          return thread === undefined ? [] : [thread];
        });
    }
    case "PendingInputAnswered":
      return [{
        kind: "restorePendingInputs",
        before: structuredClone(state.pendingInputs) as unknown as JsonRecord,
      }];
    case "CharacterInferenceFormed":
      return nonEmpty(payload.characterId) && nonEmpty(payload.inferenceId)
        ? [restoreKnowledge(state, payload.characterId, payload.inferenceId)]
        : [];
    case "FictionTimeAdvanced":
    case "RoundEnded":
    case "EncounterConcluded":
      return [
        {
          kind: "restoreFictionTime",
          timelineId: event.fictionTimelineId,
          beforeMicros: state.fictionTimelines[event.fictionTimelineId].nowMicros,
        },
        ...(event.eventType === "FictionTimeAdvanced" ? [] : [restoreCombatRuntime(state)]),
      ];
    case "ResourceReserved":
    case "ResourceUsed":
    case "ResourceChanged":
    case "CharacterControlTransferred":
    case "ExperienceAwarded":
      return nonEmpty(payload.characterId) ? [restoreCharacter(state, payload.characterId)] : [];
    case "CharacterControlGranted": {
      if (!nonEmpty(payload.characterId)) return [];
      const eventCharacter = record(payload.character) ? payload.character : undefined;
      const currentCharacter = state.entities[payload.characterId];
      const sceneId = nonEmpty(eventCharacter?.sceneId)
        ? eventCharacter.sceneId
        : currentCharacter?.sceneId;
      const effects: CorrectionEffect[] = [restoreCharacter(state, payload.characterId)];
      if (nonEmpty(sceneId)) {
        effects.push(restoreSuccessorRuntime(state, payload.characterId, sceneId));
      }
      if (eventCharacter !== undefined && Array.isArray(payload.definitions)) {
        effects.push(
          restoreCombatEntity(state, payload.characterId),
          restoreCombatRuntime(state),
          ...payload.definitions.flatMap((definition) =>
            record(definition) && nonEmpty(definition.definitionId)
              ? [restoreDefinition(state, definition.definitionId)]
              : []),
        );
      }
      return effects;
    }
    case "HitPointsChanged":
      return nonEmpty(payload.characterId)
        ? [restoreCharacter(state, payload.characterId), restoreCombatRuntime(state)]
        : [restoreCombatRuntime(state)];
    case "ItemUsed":
      return nonEmpty(payload.characterId)
        ? [
            restoreItemSystemCollection(state, "entries"),
            restoreCharacter(state, payload.characterId),
            restoreCombatRuntime(state),
          ]
        : [];
    case "ItemDefinitionRegistered": {
      return [restoreItemSystemCollection(state, "definitions")];
    }
    case "ItemMaterialized": {
      return [restoreItemSystemCollection(state, "entries")];
    }
    case "ItemAcquired": {
      const effects: CorrectionEffect[] = [];
      effects.push(restoreItemSystemCollection(state, "entries"));
      if (nonEmpty(payload.characterId)) {
        effects.push(restoreCharacter(state, payload.characterId));
      }
      effects.push(restoreCombatRuntime(state));
      return effects;
    }
    case "ItemTransferred": {
      const characterIds = [payload.fromCharacterId, payload.toCharacterId]
        .filter(nonEmpty)
        .filter((characterId, index, all) => all.indexOf(characterId) === index);
      return [
        restoreItemSystemCollection(state, "entries"),
        ...characterIds.map((characterId) => restoreCharacter(state, characterId)),
        restoreCombatRuntime(state),
      ];
    }
    case "CharacterAdvanced": {
      const effects: CorrectionEffect[] = nonEmpty(payload.characterId)
        ? [restoreCharacter(state, payload.characterId)]
        : [];
      effects.push({
        kind: "restorePendingInputs",
        before: structuredClone(state.pendingInputs) as unknown as JsonRecord,
      });
      return effects;
    }
    case "AdvancementAvailable":
      return [{
        kind: "restorePendingInputs",
        before: structuredClone(state.pendingInputs) as unknown as JsonRecord,
      }];
    case "RestCompleted":
      return nonEmpty(payload.characterId) ? [restoreCharacter(state, payload.characterId)] : [];
    case "RestStarted":
    case "ActivityStarted":
    case "ActivityInterrupted":
    case "ActivityCompleted": {
      const effect = nonEmpty(payload.activityId)
        ? restoreCampaignEntry(state, "activities", payload.activityId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "GroupRestOffered":
    case "GroupRestConsentRecorded":
      return [{
        kind: "restorePendingInputs",
        before: structuredClone(state.pendingInputs) as unknown as JsonRecord,
      }];
    case "CharacterRetired":
      return nonEmpty(payload.characterId)
        ? [
            restoreCharacter(state, payload.characterId),
            restoreTenureRuntime(state, payload.characterId),
            restoreCombatRuntime(state),
          ]
        : [];
    case "CharacterMechanicsSynchronized": {
      if (!nonEmpty(payload.characterId) || !Array.isArray(payload.definitions)) return [];
      return [
        restoreCombatEntity(state, payload.characterId),
        restoreCombatRuntime(state),
        ...payload.definitions.flatMap((definition) =>
          record(definition) && nonEmpty(definition.definitionId)
            ? [restoreDefinition(state, definition.definitionId)]
            : []),
      ];
    }
    case "CharacterGearChanged": {
      if (!nonEmpty(payload.characterId)) return [];
      return [
        restoreItemSystemCollection(state, "entries"),
        restoreCharacter(state, payload.characterId),
        restoreCombatEntity(state, payload.characterId),
        restoreCombatRuntime(state),
      ];
    }
    case "NpcGearChanged": {
      const effects: CorrectionEffect[] = [restoreItemSystemCollection(state, "entries")];
      if (nonEmpty(payload.characterId)) effects.push(restoreCharacter(state, payload.characterId));
      effects.push(restoreCombatRuntime(state));
      return effects;
    }
    case "NpcMechanicalItemStateChanged": {
      const effects: CorrectionEffect[] = [restoreItemSystemCollection(state, "entries")];
      if (nonEmpty(payload.characterId)) effects.push(restoreCharacter(state, payload.characterId));
      effects.push(restoreCombatRuntime(state));
      if (nonEmpty(payload.causeFactRef)) {
        effects.push({
          kind: "restoreCanonicalFact",
          factId: npcMechanicalItemStateCauseUseFactId(payload.causeFactRef),
          before: null,
        });
      }
      return effects;
    }
    case "CharacterMoved": {
      if (!nonEmpty(payload.characterId)) return [];
      const effects: CorrectionEffect[] = [restoreCharacter(state, payload.characterId)];
      const timeline = restoreCharacterTimeline(state, payload.characterId);
      if (timeline !== undefined) effects.push(timeline);
      return effects;
    }
    case "CreatureDied":
      return nonEmpty(payload.characterId)
        ? [
            restoreCharacter(state, payload.characterId),
            restoreTenureRuntime(state, payload.characterId),
            restoreCombatRuntime(state),
          ]
        : [];
    case "SuccessorIntroduced": {
      const successor = payload.successor;
      const effects = nonEmpty(payload.predecessorCharacterId)
        ? [restoreCharacter(state, payload.predecessorCharacterId)]
        : [];
      if (record(successor) && nonEmpty(successor.id) && nonEmpty(successor.sceneId)) {
        effects.push(
          restoreCharacter(state, successor.id),
          restoreSuccessorRuntime(state, successor.id, successor.sceneId),
          restoreCombatEntity(state, successor.id),
          restoreCombatRuntime(state),
          ...(Array.isArray(payload.definitions)
            ? payload.definitions.flatMap((definition) =>
              record(definition) && nonEmpty(definition.definitionId)
                ? [restoreDefinition(state, definition.definitionId)]
                : [])
            : []),
        );
      }
      return effects;
    }
    case "RelationshipChanged":
    case "RelationshipEstablished": {
      const effect = nonEmpty(payload.relationshipId)
        ? restoreCampaignEntry(state, "relationships", payload.relationshipId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "PromiseMade":
    case "PromiseAssumed": {
      const effect = nonEmpty(payload.promiseId)
        ? restoreCampaignEntry(state, "promises", payload.promiseId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "DebtIncurred":
    case "DebtAssumed": {
      const effect = nonEmpty(payload.debtId)
        ? restoreCampaignEntry(state, "debts", payload.debtId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "InheritanceSourceEstablished": {
      const source = nonEmpty(payload.factId)
        ? restoreCampaignEntry(state, "inheritanceSources", payload.factId)
        : undefined;
      const fact: CorrectionEffect | undefined = nonEmpty(payload.factId)
        ? {
            kind: "restoreCanonicalFact",
            factId: payload.factId,
            before: state.canonicalFacts[payload.factId] === undefined
              ? null
              : structuredClone(state.canonicalFacts[payload.factId]),
          }
        : undefined;
      return [source, fact].filter((entry): entry is CorrectionEffect => entry !== undefined);
    }
    case "ChapterConcluded":
    case "ChapterContinuityRecorded": {
      const chapterId = event.eventType === "ChapterConcluded"
        ? payload.chapterId
        : payload.fromChapterId;
      const effect = nonEmpty(chapterId)
        ? restoreCampaignEntry(state, "chapters", chapterId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "ChapterStarted": {
      const effects: CorrectionEffect[] = [{
        kind: "restoreCampaignDescriptor",
        before: state.campaignRuntime.campaign === null
          ? null
          : structuredClone(state.campaignRuntime.campaign),
      }];
      const chapter = nonEmpty(payload.chapterId)
        ? restoreCampaignEntry(state, "chapters", payload.chapterId)
        : undefined;
      if (chapter !== undefined) effects.push(chapter);
      return effects;
    }
    case "InheritanceTransferred": {
      const effect = nonEmpty(payload.sourceFactId)
        ? restoreCampaignEntry(state, "inheritanceSources", payload.sourceFactId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "DefinitionRegistered": {
      const definition = payload.definition;
      const effect = record(definition) && nonEmpty(definition.definitionId)
        ? restoreDefinition(state, definition.definitionId)
        : undefined;
      const content = record(definition) && record(definition.content)
        ? definition.content
        : undefined;
      const sceneEffect: CorrectionEffect | undefined = record(definition)
        && definition.definitionKind === "location"
        && content !== undefined
        && nonEmpty(content.sceneId)
        ? {
            kind: "restoreScene",
            sceneId: content.sceneId,
            before: state.scenes[content.sceneId] === undefined
              ? null
              : structuredClone(state.scenes[content.sceneId]),
          }
        : undefined;
      const factionEffect: CorrectionEffect | undefined = record(definition)
        && definition.definitionKind === "faction"
        && content !== undefined
        && nonEmpty(content.factionId)
        ? restoreCampaignEntry(state, "factions", content.factionId)
        : undefined;
      return [effect, sceneEffect, factionEffect, restoreCombatRuntime(state)]
        .filter((entry): entry is CorrectionEffect => entry !== undefined);
    }
    case "NpcPlanFormed": {
      const effect = nonEmpty(payload.planId)
        ? restoreCampaignEntry(state, "npcPlans", payload.planId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "FactionPlanAdvanced": {
      const effect = nonEmpty(payload.planId)
        ? restoreCampaignEntry(state, "factionPlans", payload.planId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "SceneQuestionOpened": {
      const effect = nonEmpty(payload.sceneQuestionId)
        ? restoreCampaignEntry(state, "sceneQuestions", payload.sceneQuestionId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "RandomnessRequested":
      return record(payload.resolution) ? [restoreCombatRuntime(state)] : [];
    case "EntityMaterialized": {
      const entity = payload.entity;
      return record(entity) && nonEmpty(entity.entityId)
        ? [restoreCharacter(state, entity.entityId), restoreCombatRuntime(state)]
        : [restoreCombatRuntime(state)];
    }
    case "DynamicEntityMaterialized": {
      const effect = nonEmpty(payload.entityId)
        ? restoreCharacter(state, payload.entityId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "MeaningfulFailureCommitted": {
      const effect = nonEmpty(payload.goalId)
        ? restoreCampaignEntry(state, "meaningfulFailures", payload.goalId)
        : undefined;
      return effect === undefined ? [] : [effect];
    }
    case "EncounterStarted":
    case "HostilityChanged":
    case "EnvironmentFeatureMaterialized":
    case "EnvironmentFeatureDamaged":
    case "EnvironmentFeatureStateChanged":
    case "EnvironmentAreaFeatureDamaged":
    case "InitiativeRequested":
    case "InitiativeEstablished":
    case "InitiativeTieOrdered":
    case "RoundStarted":
    case "TurnStarted":
    case "TurnEnded":
    case "MovementSegmentCommitted":
    case "AbilityInvoked":
    case "HealingResolved":
    case "TemporaryHitPointsGranted":
    case "ConditionChanged":
    case "ConcentrationStarted":
    case "ConcentrationEnded":
    case "DeathSaveResolved":
    case "DamagePacketResolved":
    case "ReactionOffered":
    case "ReactionAnswered":
    case "CombatPendingOpened":
    case "CombatPendingClosed":
    case "EncounterConclusionProposed":
      return [restoreCombatRuntime(state)];
    case "ResourceSpent": {
      const effects: CorrectionEffect[] = [];
      if (nonEmpty(payload.resourceId) && payload.resourceId.startsWith("item-entry:")) {
        effects.push(restoreItemSystemCollection(state, "entries"));
      }
      if (nonEmpty(payload.entityId)) effects.push(restoreCharacter(state, payload.entityId));
      effects.push(restoreCombatRuntime(state));
      return effects;
    }
    default:
      return [];
  }
}

export function recordCorrectionAudit(
  state: AuthoritativeWorldState,
  event: EventEnvelope,
  effects: CorrectionEffect[],
): void {
  state.correctionRuntime.audit[event.eventId] = {
    eventId: event.eventId,
    eventSeq: event.eventSeq,
    eventType: event.eventType,
    rootActionId: event.rootActionId,
    branchId: event.branchId,
    payloadHash: event.payloadHash,
    effects: structuredClone(effects),
  };
}

function applyEffects(
  state: AuthoritativeWorldState,
  effects: CorrectionEffect[],
): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case "restoreFictionTime":
        if (!(effect.timelineId in state.fictionTimelines)) {
          throw new TypeError("correction fiction timeline is unavailable");
        }
        state.fictionTimelines[effect.timelineId].nowMicros = effect.beforeMicros;
        break;
      case "restoreScene":
        if (effect.before === null) delete state.scenes[effect.sceneId];
        else state.scenes[effect.sceneId] = structuredClone(effect.before);
        break;
      case "restoreCanonicalFact":
        if (effect.before === null) delete state.canonicalFacts[effect.factId];
        else state.canonicalFacts[effect.factId] = structuredClone(effect.before);
        break;
      case "restoreKnowledge": {
        state.knowledge[effect.characterId] ??= {};
        if (effect.before === null) delete state.knowledge[effect.characterId][effect.knowledgeRef];
        else state.knowledge[effect.characterId][effect.knowledgeRef] = structuredClone(effect.before);
        break;
      }
      case "restoreCharacter":
        if (effect.before === null) {
          delete state.entities[effect.characterId];
          delete state.knowledge[effect.characterId];
          delete state.multiplayerRuntime.characterTimelineIds[effect.characterId];
        } else {
          state.entities[effect.characterId] = structuredClone(effect.before as CharacterRecord);
        }
        if (effect.controlBefore === null) delete state.characterControls[effect.characterId];
        else state.characterControls[effect.characterId] = structuredClone(
          effect.controlBefore as CharacterControlRecord,
        );
        break;
      case "restoreCharacterTimeline":
        if (!(effect.beforeTimelineId in state.fictionTimelines)) {
          throw new TypeError("correction character timeline is unavailable");
        }
        state.multiplayerRuntime.characterTimelineIds[effect.characterId] = effect.beforeTimelineId;
        break;
      case "restoreCombatEntity":
        if (effect.before === null) delete state.combatRuntime.entities[effect.entityId];
        else state.combatRuntime.entities[effect.entityId] = structuredClone(effect.before);
        break;
      case "restoreCombatRuntime":
        state.combatRuntime = structuredClone(effect.before);
        break;
      case "restoreDefinition":
        if (effect.beforeCampaign === null) delete state.campaignRuntime.definitions[effect.definitionId];
        else state.campaignRuntime.definitions[effect.definitionId] = structuredClone(effect.beforeCampaign);
        if (effect.beforeCombat === null) delete state.combatRuntime.definitions[effect.definitionId];
        else state.combatRuntime.definitions[effect.definitionId] = structuredClone(effect.beforeCombat);
        break;
      case "restoreCampaignEntry": {
        const candidate = state.campaignRuntime[effect.collection];
        if (!record(candidate)) throw new TypeError("correction campaign collection is unavailable");
        const entries = candidate as JsonRecord;
        if (effect.before === null) delete entries[effect.entryId];
        else entries[effect.entryId] = structuredClone(effect.before);
        break;
      }
      case "restoreCampaignDescriptor":
        state.campaignRuntime.campaign = effect.before === null
          ? null
          : structuredClone(effect.before);
        break;
      case "restorePendingInputs":
        state.pendingInputs = structuredClone(
          effect.before,
        ) as unknown as AuthoritativeWorldState["pendingInputs"];
        break;
      case "restoreTenureRuntime": {
        state.pendingInputs = structuredClone(
          effect.pendingInputsBefore,
        ) as unknown as AuthoritativeWorldState["pendingInputs"];
        state.multiplayerRuntime.suspendedPendingInputs = structuredClone(
          effect.suspendedPendingInputsBefore,
        ) as unknown as AuthoritativeWorldState["multiplayerRuntime"]["suspendedPendingInputs"];
        state.multiplayerRuntime.partyGroups = structuredClone(
          effect.partyGroupsBefore,
        ) as unknown as AuthoritativeWorldState["multiplayerRuntime"]["partyGroups"];
        state.multiplayerRuntime.partyInvitations = structuredClone(
          effect.partyInvitationsBefore,
        ) as unknown as AuthoritativeWorldState["multiplayerRuntime"]["partyInvitations"];
        state.multiplayerRuntime.partyMoveProposals = structuredClone(
          effect.partyMoveProposalsBefore,
        ) as unknown as AuthoritativeWorldState["multiplayerRuntime"]["partyMoveProposals"];
        for (const [rootActionId, receipt] of Object.entries(effect.pendingReceiptsBefore)) {
          state.receipts[rootActionId] = structuredClone(
            receipt,
          ) as unknown as AuthoritativeWorldState["receipts"][string];
        }
        if (effect.combatEntityBefore === null) {
          delete state.combatRuntime.entities[effect.characterId];
        } else {
          state.combatRuntime.entities[effect.characterId] = structuredClone(
            effect.combatEntityBefore,
          );
        }
        break;
      }
      case "restoreSuccessorRuntime":
        if (effect.characterTimelineBefore === null) {
          delete state.multiplayerRuntime.characterTimelineIds[effect.successorCharacterId];
        } else {
          state.multiplayerRuntime.characterTimelineIds[effect.successorCharacterId] =
            effect.characterTimelineBefore;
        }
        if (effect.timelineBefore === null) delete state.fictionTimelines[effect.timelineId];
        else state.fictionTimelines[effect.timelineId] = structuredClone(effect.timelineBefore) as never;
        if (effect.causalFrontierBefore === null) {
          delete state.multiplayerRuntime.causalFrontiers[effect.timelineId];
        } else {
          state.multiplayerRuntime.causalFrontiers[effect.timelineId] = structuredClone(
            effect.causalFrontierBefore,
          );
        }
        if (effect.spotlightBefore === null) {
          delete state.multiplayerRuntime.spotlightLedger[effect.successorCharacterId];
        } else {
          state.multiplayerRuntime.spotlightLedger[effect.successorCharacterId] = structuredClone(
            effect.spotlightBefore,
          ) as never;
        }
        break;
    }
  }
}

export function validateCorrectionEffects(value: unknown): value is CorrectionEffect[] {
  return Array.isArray(value) && value.every(isCorrectionEffect);
}

export function applyCorrectionEvent(state: AuthoritativeWorldState, event: EventEnvelope): boolean {
  switch (event.eventType) {
    case "CorrectionApplied": {
      const payload = event.payload as EventPayloadByType["CorrectionApplied"];
      if (payload.correctionId in state.correctionRuntime.corrections) {
        throw new TypeError("correction already exists");
      }
      applyEffects(state, payload.effects);
      state.correctionRuntime.corrections[payload.correctionId] = {
        correctionId: payload.correctionId,
        strategy: "forwardCompensation",
        targetReceiptId: payload.targetReceiptId,
        targetRootActionId: payload.targetRootActionId,
        appliedByEventId: event.eventId,
      };
      return true;
    }
    case "CorrectionBranchOpened": {
      const payload = event.payload as EventPayloadByType["CorrectionBranchOpened"];
      if (
        payload.parentBranchId !== state.activeBranchId
        || payload.branchId in state.fictionTimelines
        || payload.correctionId in state.correctionRuntime.corrections
      ) throw new TypeError("correction branch cannot be opened");
      state.fictionTimelines[payload.branchId] = {
        branchId: payload.branchId,
        nowMicros: state.fictionTimelines[payload.parentBranchId].nowMicros,
      };
      state.correctionRuntime.branches[payload.branchId] = {
        branchId: payload.branchId,
        parentBranchId: payload.parentBranchId,
        cutoffEventSeq: payload.cutoffEventSeq,
        correctionId: payload.correctionId,
        openedByEventId: event.eventId,
      };
      return true;
    }
    case "BranchActivated": {
      const payload = event.payload as EventPayloadByType["BranchActivated"];
      if (
        payload.parentBranchId !== state.activeBranchId
        || !(payload.branchId in state.fictionTimelines)
        || payload.correctionId in state.correctionRuntime.corrections
      ) throw new TypeError("correction branch cannot be activated");
      state.activeBranchId = payload.branchId;
      applyEffects(state, payload.effects);
      for (const fact of Object.values(state.canonicalFacts)) fact.branchId = payload.branchId;
      for (const rootActionId of payload.supersededRootActionIds) {
        const receipt = state.receipts[rootActionId];
        if (receipt !== undefined) receipt.status = "superseded";
      }
      state.correctionRuntime.corrections[payload.correctionId] = {
        correctionId: payload.correctionId,
        strategy: "causalBranch",
        branchId: payload.branchId,
        activatedByEventId: event.eventId,
      };
      return true;
    }
    default:
      return false;
  }
}

export type CorrectionPlan = {
  targetReceiptId: string;
  targetRootActionId: string;
  cutoffEventSeq: string;
  affectedEventIds: string[];
  effects: CorrectionEffect[];
  strategy: "forwardCompensation" | "causalBranch";
  supersededRootActionIds: string[];
  branchId?: string;
};

function isForwardCompensablePublicKnowledge(
  state: AuthoritativeWorldState,
  effect: CorrectionEffect,
  affectedEventIds: ReadonlySet<string>,
): boolean {
  if (effect.kind !== "restoreKnowledge" || effect.before !== null) return false;
  const current = state.knowledge[effect.characterId]?.[effect.knowledgeRef];
  return current?.visibility === "publiclyObservable"
    && affectedEventIds.has(current.acquiredByEventId);
}

function isAutomaticActionScaffoldingEffect(
  entry: CorrectionAuditRecord,
  effect: CorrectionEffect,
  targetRootActionId: string,
): boolean {
  const actionBasisFactId = `fact:action-basis:${targetRootActionId}`;
  switch (entry.eventType) {
    case "DefinitionRegistered": {
      const createsOnlyActionBasis = entry.effects.some((candidate) =>
        candidate.kind === "restoreDefinition"
        && candidate.definitionId === actionBasisFactId
        && candidate.beforeCampaign === null
        && candidate.beforeCombat === null)
        && entry.effects.every((candidate) =>
          candidate.kind === "restoreDefinition" || candidate.kind === "restoreCombatRuntime");
      return createsOnlyActionBasis
        && (effect.kind === "restoreDefinition" || effect.kind === "restoreCombatRuntime");
    }
    case "CanonicalFactDeclared":
      return effect.kind === "restoreCanonicalFact"
        && effect.factId === actionBasisFactId
        && effect.before === null;
    case "SceneQuestionOpened":
      return effect.kind === "restoreCampaignEntry"
        && effect.collection === "sceneQuestions"
        && effect.entryId === `scene-question:${targetRootActionId}`
        && effect.before === null;
    default:
      return false;
  }
}

export function correctionPlan(
  state: AuthoritativeWorldState,
  correctionId: string,
  targetReceiptId: string,
): CorrectionPlan | undefined {
  const targetReceipt = Object.values(state.receipts)
    .find((receipt) => receipt.receiptId === targetReceiptId);
  if (targetReceipt === undefined) return undefined;
  const targetAudits = Object.values(state.correctionRuntime.audit)
    .filter((entry) => entry.rootActionId === targetReceipt.rootActionId)
    .sort((left, right) => BigInt(left.eventSeq) < BigInt(right.eventSeq) ? -1 : 1);
  if (targetAudits.length === 0) return undefined;
  const cutoffEventSeq = targetAudits[0].eventSeq;
  const affected = Object.values(state.correctionRuntime.audit)
    .filter((entry) => BigInt(entry.eventSeq) >= BigInt(cutoffEventSeq))
    .filter((entry) => !["CorrectionApplied", "CorrectionBranchOpened", "BranchActivated"].includes(entry.eventType))
    .sort((left, right) => BigInt(left.eventSeq) > BigInt(right.eventSeq) ? -1 : 1);
  const downstreamRoot = affected.some((entry) => entry.rootActionId !== targetReceipt.rootActionId);
  const affectedEventIdSet = new Set(affected.map((entry) => entry.eventId));
  const hasForwardCompensablePublicKnowledge = affected.some((entry) =>
    entry.effects.some((effect) =>
      isForwardCompensablePublicKnowledge(state, effect, affectedEventIdSet)));
  const causalEffect = affected.some((entry) => entry.effects.some((effect) =>
    effect.kind !== "restoreFictionTime"
    && !isForwardCompensablePublicKnowledge(state, effect, affectedEventIdSet)
    && !(hasForwardCompensablePublicKnowledge
      && isAutomaticActionScaffoldingEffect(entry, effect, targetReceipt.rootActionId))));
  const strategy = downstreamRoot || causalEffect ? "causalBranch" : "forwardCompensation";
  const selected = strategy === "causalBranch"
    ? affected
    : affected.filter((entry) => entry.rootActionId === targetReceipt.rootActionId);
  const effects = selected.flatMap((entry) => [...entry.effects].reverse());
  const supersededRootActionIds = [...new Set(selected.map((entry) => entry.rootActionId))].sort();
  const affectedEventIds = selected.map((entry) => entry.eventId).sort((left, right) => {
    const leftSeq = state.correctionRuntime.audit[left].eventSeq;
    const rightSeq = state.correctionRuntime.audit[right].eventSeq;
    return BigInt(leftSeq) < BigInt(rightSeq) ? -1 : 1;
  });
  const branchId = strategy === "causalBranch"
    ? `branch:correction:${canonicalSha256({ correctionId, targetReceiptId }).slice("sha256:".length, "sha256:".length + 24)}`
    : undefined;
  return {
    targetReceiptId,
    targetRootActionId: targetReceipt.rootActionId,
    cutoffEventSeq,
    affectedEventIds,
    effects,
    strategy,
    supersededRootActionIds,
    ...(branchId === undefined ? {} : { branchId }),
  };
}

export function isCanonicalCorrectionStringArray(value: unknown): value is string[] {
  return canonicalStrings(value);
}
