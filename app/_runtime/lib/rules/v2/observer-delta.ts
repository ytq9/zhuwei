import { canonicalSha256 } from "../profiles/canonical";
import { socialResolutionProfileEnabled } from "../profiles/social-resolution";
import { worldInteractionProfileEnabled } from "../profiles/vnext-world-interaction";
import type { RuntimeProfileManifest } from "../profiles/types";
import type {
  AuthoritativeWorldState,
  EventEnvelope,
  EventPayloadByType,
  JsonRecord,
  KpSpatialReadModel,
  LifecycleReadModel,
  NpcViewer,
  ObserverCommittedDelta,
  ObserverDeltaChange,
  ObserverIncrementalDelta,
  ObserverProjectionAnchor,
  PlayerViewer,
  ProjectionQuery,
  ProjectionResult,
  PublicReceipt,
  SafeReadModel,
} from "./model";
import { eventHash, foldEvent, validateEventEnvelope } from "./events";
import {
  deriveAuthorityClaimsFromCommittedRange,
  projectRenderableClaims,
  type FrozenAuthorityClaims,
  type FrozenRenderableClaims,
} from "./claims";
import { rejected } from "./results";
import { characterTimelineId } from "./timeline";
import {
  hashWorldState,
  isAuthoritativeWorldState,
  isNonEmptyString,
  isRecord,
} from "./validation";

type CurrentProjection =
  | SafeReadModel
  | LifecycleReadModel
  | KpSpatialReadModel
  | ReturnType<typeof rejected>;

type CurrentProjectionProjector = (
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: unknown,
) => CurrentProjection;

export function safeReceipt(receipt: AuthoritativeWorldState["receipts"][string]): PublicReceipt {
  return {
    receiptId: receipt.receiptId,
    rootActionId: receipt.rootActionId,
    status: receipt.status,
    branchId: receipt.branchId,
    eventRange: structuredClone(receipt.eventRange),
    rulesetVersion: receipt.rulesetVersion,
    eventSchemaVersion: receipt.eventSchemaVersion,
    scopeProofHash: receipt.scopeProofHash,
  };
}

function isKpSpatialReadModel(value: ProjectionResult): value is KpSpatialReadModel {
  return value.kind === "projected" && value.viewer.kind === "kp";
}

function isLifecycleReadModel(value: ProjectionResult): value is LifecycleReadModel {
  return value.kind === "projected"
    && "controlledCharacter" in value
    && value.controlledCharacter === null;
}

const ACTOR_DELTA_FIELDS = [
  "controlledCharacter",
  "safetyPresentation",
  "fictionTime",
  "visibleFacts",
  "knowledge",
  "pendingInputs",
  "campaign",
  "chapters",
  "visibleItems",
  "factions",
  "factionPlans",
  "npcPlans",
  "adjudicationPrecedents",
  "relationships",
  "promises",
  "activities",
  "unresolvedThreats",
  "sourceClaims",
  "conversationThreads",
  "stories",
  "epilogues",
  "entities",
  "encounters",
  "tacticalProjection",
  "story",
] as const;

const OBSERVER_DELTA_FIELDS = [
  "visibleFacts",
  "adjudicationPrecedents",
  "campaign",
  "chapters",
  "unresolvedThreats",
  "conversationThreads",
  "stories",
  "entities",
  "encounters",
  "tacticalProjection",
  "story",
] as const;

type VerifiedCommittedRange = {
  actorCharacterId: string;
  priorState: AuthoritativeWorldState;
  events: EventEnvelope[];
  receipt: PublicReceipt;
};

function sameProjectedValue(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalSha256({ value: left }) === canonicalSha256({ value: right });
}

type VerifiedIncrementalRange = {
  priorState: AuthoritativeWorldState;
  events: EventEnvelope[];
  expectedFrom: {
    eventSeq: string;
    stateHash?: `sha256:${string}`;
    eventHash?: `sha256:${string}`;
    projectionHash?: `sha256:${string}`;
  };
};

function verifiedIncrementalRange(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  query: ProjectionQuery | undefined,
): VerifiedIncrementalRange | "invalid" | undefined {
  const rangeValue = isRecord(query) ? query.incrementalRange : undefined;
  if (rangeValue === undefined) return undefined;
  if (
    !isRecord(rangeValue)
    || !isAuthoritativeWorldState(rangeValue.priorState)
    || !Array.isArray(rangeValue.events)
    || !isRecord(rangeValue.expectedFrom)
    || !isNonEmptyString(rangeValue.expectedFrom.eventSeq)
  ) return "invalid";

  const priorState = rangeValue.priorState;
  if (
    priorState.roomId !== state.roomId
    || priorState.runtimeEpochId !== state.runtimeEpochId
    || priorState.version !== rangeValue.expectedFrom.eventSeq
  ) return "invalid";

  const fromStateHash = hashWorldState(priorState);
  if (
    (rangeValue.expectedFrom.stateHash !== undefined
      && rangeValue.expectedFrom.stateHash !== fromStateHash)
    || (rangeValue.expectedFrom.eventHash !== undefined
      && rangeValue.expectedFrom.eventHash !== priorState.eventHeadHash)
  ) return "invalid";

  let folded = structuredClone(priorState);
  const events: EventEnvelope[] = [];
  try {
    for (const eventValue of rangeValue.events) {
      const validation = validateEventEnvelope(eventValue);
      if (!validation.ok) return "invalid";
      const event = validation.event;
      const expectedSeq = (BigInt(folded.version) + 1n).toString();
      if (
        event.roomId !== folded.roomId
        || event.runtimeEpochId !== folded.runtimeEpochId
        || event.eventSeq !== expectedSeq
        || event.previousEventHash !== folded.eventHeadHash
        || event.parentEventId !== folded.lastEventId
        || event.stateBeforeHash !== hashWorldState(folded)
        || canonicalSha256(event.profiles) !== canonicalSha256(profiles)
      ) return "invalid";
      const next = foldEvent(folded, event);
      if (
        hashWorldState(next) !== event.stateHashAfter
        || eventHash(event) !== event.eventHash
      ) return "invalid";
      folded = next;
      events.push(event);
    }
  } catch {
    return "invalid";
  }

  if (
    folded.version !== state.version
    || folded.lastEventId !== state.lastEventId
    || folded.eventHeadHash !== state.eventHeadHash
    || hashWorldState(folded) !== hashWorldState(state)
  ) return "invalid";
  return {
    priorState,
    events,
    expectedFrom: rangeValue.expectedFrom,
  };
}

const INCREMENTAL_METADATA_FIELDS = new Set([
  "activeBranchId",
  "incrementalDelta",
  "kind",
  "projectionHash",
  "runtimeProfiles",
  "stateVersion",
  "viewer",
]);

function incrementalProjectionChanges(
  before: SafeReadModel | LifecycleReadModel,
  after: SafeReadModel | LifecycleReadModel,
  correction: boolean,
): ObserverDeltaChange[] {
  const beforeRecord = before as unknown as JsonRecord;
  const afterRecord = after as unknown as JsonRecord;
  const fields = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
    .filter((field) => !INCREMENTAL_METADATA_FIELDS.has(field))
    .sort();
  return fields.flatMap((field) => {
    const beforeValue = beforeRecord[field];
    const afterValue = afterRecord[field];
    if (sameProjectedValue(beforeValue, afterValue)) return [];
    if (correction) {
      return [{
        kind: "projectionFieldCorrected",
        field,
        ...(afterValue === undefined
          ? { removed: true }
          : { current: structuredClone(afterValue) }),
      }];
    }
    return [{
      kind: "projectionFieldChanged",
      field,
      ...(afterValue === undefined
        ? { removed: true }
        : { current: structuredClone(afterValue) }),
    }];
  });
}

function lifecyclePriorProjection(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  projectCurrent: CurrentProjectionProjector,
): SafeReadModel | LifecycleReadModel | undefined {
  const lifecycle = projectCurrent(profiles, state, viewerValue);
  if (
    lifecycle.kind !== "rejected"
    && !isKpSpatialReadModel(lifecycle)
  ) return lifecycle;
  if (!isRecord(viewerValue) || viewerValue.kind !== "player") return undefined;
  const { purpose: _purpose, ...activeViewer } = viewerValue;
  const active = projectCurrent(profiles, state, activeViewer);
  return active.kind !== "rejected"
    && !isKpSpatialReadModel(active)
    && !isLifecycleReadModel(active)
    ? active
    : undefined;
}

function lifecycleIncrementalDelta(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  after: LifecycleReadModel,
  query: ProjectionQuery | undefined,
  projectCurrent: CurrentProjectionProjector,
): ObserverIncrementalDelta | "invalid" | undefined {
  const range = verifiedIncrementalRange(profiles, state, query);
  if (range === undefined || range === "invalid") return range;
  const before = lifecyclePriorProjection(
    profiles,
    range.priorState,
    viewerValue,
    projectCurrent,
  );
  if (
    before === undefined
    || (range.expectedFrom.projectionHash !== undefined
      && range.expectedFrom.projectionHash !== before.projectionHash)
  ) return "invalid";

  return {
    schema: "zhuwei.observer-incremental-delta/v1",
    from: {
      eventSeq: range.priorState.version,
      stateHash: hashWorldState(range.priorState),
      eventHash: range.priorState.eventHeadHash,
      projectionHash: before.projectionHash,
    },
    to: {
      eventSeq: state.version,
      stateHash: hashWorldState(state),
      eventHash: state.eventHeadHash,
      projectionHash: after.projectionHash,
    },
    changes: incrementalProjectionChanges(
      before,
      after,
      range.events.some((event) =>
        event.eventType === "CorrectionApplied"
        || event.eventType === "CorrectionBranchOpened"
        || event.eventType === "BranchActivated"),
    ),
  };
}

function observerIncrementalDelta(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  after: SafeReadModel,
  query: ProjectionQuery | undefined,
  projectCurrent: CurrentProjectionProjector,
): ObserverIncrementalDelta | "invalid" | undefined {
  const range = verifiedIncrementalRange(profiles, state, query);
  if (range === undefined || range === "invalid") return range;
  const beforeValue = projectCurrent(profiles, range.priorState, viewerValue);
  if (
    beforeValue.kind === "rejected"
    || isKpSpatialReadModel(beforeValue)
    || isLifecycleReadModel(beforeValue)
    || (range.expectedFrom.projectionHash !== undefined
      && range.expectedFrom.projectionHash !== beforeValue.projectionHash)
  ) return "invalid";

  const from: ObserverProjectionAnchor = {
    eventSeq: range.priorState.version,
    stateHash: hashWorldState(range.priorState),
    eventHash: range.priorState.eventHeadHash,
    projectionHash: beforeValue.projectionHash,
  };
  const to: ObserverProjectionAnchor = {
    eventSeq: state.version,
    stateHash: hashWorldState(state),
    eventHash: state.eventHeadHash,
    projectionHash: after.projectionHash,
  };
  return {
    schema: "zhuwei.observer-incremental-delta/v1",
    from,
    to,
    changes: incrementalProjectionChanges(
      beforeValue,
      after,
      range.events.some((event) =>
        event.eventType === "CorrectionApplied"
        || event.eventType === "CorrectionBranchOpened"
        || event.eventType === "BranchActivated"),
    ),
  };
}

function verifiedCommittedRange(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  query: ProjectionQuery | undefined,
): VerifiedCommittedRange | "invalid" | undefined {
  const rangeValue = isRecord(query) ? query.committedRange : undefined;
  if (rangeValue === undefined) return undefined;
  if (
    !isRecord(rangeValue)
    || !isNonEmptyString(rangeValue.receiptId)
    || !isNonEmptyString(rangeValue.actorCharacterId)
    || !isAuthoritativeWorldState(rangeValue.priorState)
    || !Array.isArray(rangeValue.events)
    || rangeValue.events.length === 0
  ) return "invalid";

  const receipt = Object.values(state.receipts)
    .find((candidate) => candidate.receiptId === rangeValue.receiptId);
  if (
    receipt === undefined
    || !receipt.subjectCharacterIds.includes(rangeValue.actorCharacterId)
  ) return "invalid";

  let folded = structuredClone(rangeValue.priorState);
  const events: EventEnvelope[] = [];
  try {
    for (const eventValue of rangeValue.events) {
      const validation = validateEventEnvelope(eventValue);
      if (!validation.ok) return "invalid";
      const event = validation.event;
      const expectedSeq = (BigInt(folded.version) + 1n).toString();
      if (
        event.roomId !== folded.roomId
        || event.runtimeEpochId !== folded.runtimeEpochId
        || event.eventSeq !== expectedSeq
        || event.rootActionId !== receipt.rootActionId
        || event.previousEventHash !== folded.eventHeadHash
        || event.parentEventId !== folded.lastEventId
        || event.stateBeforeHash !== hashWorldState(folded)
        || event.profiles.manifest.profileId !== profiles.manifest.profileId
        || event.profiles.manifest.profileHash !== profiles.manifest.profileHash
      ) return "invalid";
      const next = foldEvent(folded, event);
      if (
        hashWorldState(next) !== event.stateHashAfter
        || eventHash(event) !== event.eventHash
      ) return "invalid";
      folded = next;
      events.push(event);
    }
  } catch {
    return "invalid";
  }

  const first = events[0];
  const last = events[events.length - 1];
  let receiptFrom: bigint;
  let receiptTo: bigint;
  let segmentFrom: bigint;
  let segmentTo: bigint;
  try {
    receiptFrom = BigInt(receipt.eventRange.fromEventSeq);
    receiptTo = BigInt(receipt.eventRange.toEventSeq);
    segmentFrom = BigInt(first.eventSeq);
    segmentTo = BigInt(last.eventSeq);
  } catch {
    return "invalid";
  }
  const vnext = worldInteractionProfileEnabled(profiles.extensions);
  if (
    (vnext
      ? receiptFrom !== segmentFrom || receiptTo !== segmentTo
      : receiptFrom > segmentFrom || receiptTo < segmentTo)
    || folded.version !== state.version
    || folded.lastEventId !== state.lastEventId
    || folded.eventHeadHash !== state.eventHeadHash
    || hashWorldState(folded) !== hashWorldState(state)
  ) return "invalid";

  return {
    actorCharacterId: rangeValue.actorCharacterId,
    priorState: rangeValue.priorState,
    events,
    receipt: {
      ...safeReceipt(receipt),
      eventRange: {
        fromEventSeq: first.eventSeq,
        toEventSeq: last.eventSeq,
      },
    },
  };
}

function projectionFieldChanges(
  before: SafeReadModel | undefined,
  after: SafeReadModel,
  actor: boolean,
): ObserverDeltaChange[] {
  const fields = actor ? ACTOR_DELTA_FIELDS : OBSERVER_DELTA_FIELDS;
  const beforeRecord = before as unknown as JsonRecord | undefined;
  const afterRecord = after as unknown as JsonRecord;
  return fields.flatMap((field) => {
    const beforeValue = beforeRecord?.[field];
    const afterValue = afterRecord[field];
    if (sameProjectedValue(beforeValue, afterValue)) return [];
    return [{
      kind: "projectionFieldChanged",
      field,
      ...(beforeValue === undefined ? {} : { before: structuredClone(beforeValue) }),
      ...(afterValue === undefined ? {} : { after: structuredClone(afterValue) }),
    }];
  });
}

function isCorrectionCommittedRange(range: VerifiedCommittedRange): boolean {
  return range.events.some((event) =>
    event.eventType === "CorrectionApplied"
    || event.eventType === "CorrectionBranchOpened"
    || event.eventType === "BranchActivated");
}

/** A superseded branch may contain material the active viewer must no longer
 * receive. Correction narration therefore describes only the safe current
 * projection and the explicit public explanation; it never serializes the
 * invalid branch's `before` values or departure location. */
function correctionProjectionFieldChanges(
  before: SafeReadModel | undefined,
  after: SafeReadModel,
  actor: boolean,
): ObserverDeltaChange[] {
  const fields = actor ? ACTOR_DELTA_FIELDS : OBSERVER_DELTA_FIELDS;
  const beforeRecord = before as unknown as JsonRecord | undefined;
  const afterRecord = after as unknown as JsonRecord;
  return fields.flatMap((field) => {
    const beforeValue = beforeRecord?.[field];
    const currentValue = afterRecord[field];
    if (sameProjectedValue(beforeValue, currentValue)) return [];
    return [{
      kind: "projectionFieldCorrected",
      field,
      ...(currentValue === undefined ? {} : { current: structuredClone(currentValue) }),
    }];
  });
}

function publicCorrectionChanges(range: VerifiedCommittedRange): ObserverDeltaChange[] {
  const event = range.events.find((candidate) =>
    candidate.eventType === "CorrectionApplied"
    || candidate.eventType === "CorrectionBranchOpened");
  if (event === undefined) return [];
  if (event.eventType === "CorrectionApplied") {
    const payload = event.payload as EventPayloadByType["CorrectionApplied"];
    return [{
      kind: "correctionApplied",
      correctionId: payload.correctionId,
      strategy: "forwardCompensation",
      publicExplanation: payload.publicExplanation,
    }];
  }
  const payload = event.payload as EventPayloadByType["CorrectionBranchOpened"];
  return [{
    kind: "correctionApplied",
    correctionId: payload.correctionId,
    strategy: "causalBranch",
    publicExplanation: payload.publicExplanation,
  }];
}

function movementChanges(
  range: VerifiedCommittedRange,
  state: AuthoritativeWorldState,
  viewerCharacterId: string,
): ObserverDeltaChange[] {
  const changes: ObserverDeltaChange[] = [];
  const addMovement = (characterId: string, destinationSceneId: string) => {
    const sourceSceneId = range.priorState.entities[characterId]?.sceneId;
    const viewerPriorSceneId = range.priorState.entities[viewerCharacterId]?.sceneId;
    const viewerCurrentSceneId = state.entities[viewerCharacterId]?.sceneId;
    if (viewerCharacterId === characterId) {
      if (sourceSceneId !== undefined) {
        changes.push({
          kind: "characterMoved",
          characterId,
          fromSceneId: sourceSceneId,
          toSceneId: destinationSceneId,
        });
      }
      return;
    }
    if (sourceSceneId !== undefined && viewerPriorSceneId === sourceSceneId) {
      changes.push({ kind: "characterDeparted", characterId, sceneId: sourceSceneId });
    }
    if (viewerCurrentSceneId === destinationSceneId) {
      changes.push({ kind: "characterArrived", characterId, sceneId: destinationSceneId });
    }
  };

  for (const event of range.events) {
    if (event.eventType === "CharacterMoved") {
      const payload = event.payload as EventPayloadByType["CharacterMoved"];
      addMovement(payload.characterId, payload.destinationSceneId);
    }
    if (event.eventType === "PartyMoved") {
      const payload = event.payload as EventPayloadByType["PartyMoved"];
      for (const characterId of payload.memberCharacterIds) {
        addMovement(characterId, payload.destinationSceneId);
      }
    }
  }
  return changes;
}

function dynamicEntityChanges(
  range: VerifiedCommittedRange,
  state: AuthoritativeWorldState,
  viewerCharacterId: string,
): ObserverDeltaChange[] {
  const viewerSceneId = state.entities[viewerCharacterId]?.sceneId;
  const viewerTimelineId = characterTimelineId(state, viewerCharacterId);
  if (viewerSceneId === undefined || viewerTimelineId === undefined) return [];
  return range.events.flatMap((event) => {
    if (event.eventType !== "DynamicEntityMaterialized") return [];
    const payload = event.payload as EventPayloadByType["DynamicEntityMaterialized"];
    const entity = state.entities[payload.entityId];
    if (payload.sceneId !== viewerSceneId
      || payload.sourceTimelineId !== viewerTimelineId
      || entity?.kind !== "npc"
      || entity.sceneId !== payload.sceneId
      || characterTimelineId(state, entity.id) !== viewerTimelineId) return [];
    return [{
      kind: "dynamicEntityArrived",
      entityId: payload.entityId,
      entityKind: payload.entityKind,
      name: entity.name,
      sceneId: payload.sceneId,
    }];
  });
}

function actorEventChanges(
  range: VerifiedCommittedRange,
  state: AuthoritativeWorldState,
  viewerCharacterId: string,
): ObserverDeltaChange[] {
  if (viewerCharacterId !== range.actorCharacterId) return [];
  const changes: ObserverDeltaChange[] = [];
  for (const event of range.events) {
    switch (event.eventType) {
      case "ImprovisedActionResolved": {
        const payload = event.payload as EventPayloadByType["ImprovisedActionResolved"];
        const match = /^character-premise-(?:established|recalled):(.+)$/u.exec(
          payload.outcomeCode,
        );
        if (payload.actorCharacterId !== viewerCharacterId || match === null) break;
        const predicate = match[1];
        const fact = payload.fact ?? Object.values(state.canonicalFacts).find((candidate) =>
          candidate.kind === "characterPremise"
          && candidate.subjectRefs.length === 1
          && candidate.subjectRefs[0] === viewerCharacterId
          && isRecord(candidate.value)
          && candidate.value.predicate === predicate);
        if (fact === undefined || !isRecord(fact.value)) break;
        const bindings = Array.isArray(fact.value.bindings)
          ? fact.value.bindings.filter(isRecord).map((binding) => {
              const entityRef = typeof binding.entityRef === "string" ? binding.entityRef : "";
              const entity = state.entities[entityRef];
              const definition = state.campaignRuntime.definitions[entityRef];
              const content = isRecord(definition?.content) ? definition.content : {};
              const displayName = entity?.name
                ?? state.scenes[entityRef]?.name
                ?? (typeof content.name === "string" ? content.name : undefined)
                ?? (typeof content.displayAlias === "string" ? content.displayAlias : undefined)
                ?? entityRef;
              return {
                slotRef: binding.slotRef,
                relationKind: binding.relationKind,
                referenceKind: binding.referenceKind,
                entityRef,
                entityKind: binding.entityKind,
                displayName,
              };
            })
          : [];
        changes.push({
          kind: "characterPremiseResolved",
          resolution: payload.fact === null ? "recalled" : "established",
          factRef: fact.id,
          predicate,
          policyRef: fact.value.policyRef,
          statementTemplateRef: fact.value.statementTemplateRef,
          bindings,
          sourceRefs: structuredClone(fact.value.sourceRefs),
        });
        break;
      }
      case "FeasibilityRuled": {
        const payload = event.payload as EventPayloadByType["FeasibilityRuled"];
        if (payload.characterId !== viewerCharacterId) break;
        changes.push({
          kind: "actionRuled",
          characterId: payload.characterId,
          goal: payload.goal,
          method: payload.method,
          feasibility: payload.feasibilityKind,
          publicBasis: payload.publicBasis,
        });
        break;
      }
      case "ImprovisedCheckResolved": {
        const payload = event.payload as EventPayloadByType["ImprovisedCheckResolved"];
        if (payload.request.actorCharacterId !== viewerCharacterId) break;
        changes.push({
          kind: "checkResolved",
          characterId: viewerCharacterId,
          outcome: payload.succeeded ? "success" : "failure",
          selectedRoll: payload.selectedRoll,
          total: payload.total,
          result: payload.outcome,
        });
        break;
      }
      case "SocialResolutionDeclined": {
        const payload = event.payload as EventPayloadByType["SocialResolutionDeclined"];
        if (payload.actorCharacterId !== viewerCharacterId) break;
        changes.push({
          kind: "socialResolutionChanged",
          resolution: payload.reason === "reframed"
            ? "reframed"
            : payload.reason === "invalidated" ? "invalidated" : "statusQuo",
          npcCharacterId: payload.npcCharacterId,
          claimRef: payload.claimRef,
          threadRef: payload.threadRef,
          threadDisposition: payload.disposition,
          relationshipChanged: false,
          result: payload.outcome,
        });
        break;
      }
      case "SocialDirectResolved": {
        const payload = event.payload as EventPayloadByType["SocialDirectResolved"];
        if (payload.actorCharacterId !== viewerCharacterId) break;
        changes.push({
          kind: "socialResolutionChanged",
          resolution: "direct",
          npcCharacterId: payload.npcCharacterId,
          claimRef: payload.claimRef,
          responseClaimRef: payload.responseClaimRef,
          responseMode: payload.responseMode,
          responseReaction: payload.responseReaction,
          addressedThreadRef: payload.addressedThreadRef,
          threadRef: payload.threadRef,
          threadDisposition: payload.threadDisposition,
          relationshipChanged: false,
          result: payload.outcome,
        });
        break;
      }
      case "SocialCheckResolved": {
        const payload = event.payload as EventPayloadByType["SocialCheckResolved"];
        if (payload.actorCharacterId !== viewerCharacterId) break;
        changes.push({
          kind: "socialResolutionChanged",
          resolution: "check",
          npcCharacterId: payload.npcCharacterId,
          claimRef: payload.claimRef,
          responseClaimRef: payload.responseClaimRef,
          responseMode: payload.responseMode,
          responseReaction: payload.responseReaction,
          addressedThreadRef: payload.addressedThreadRef,
          addressedThreadDisposition: payload.addressedThreadDisposition,
          threadRef: payload.threadRef,
          boundary: payload.boundary,
          selectedRoll: payload.selectedRoll,
          total: payload.total,
          margin: payload.margin,
          marginDegree: payload.marginDegree,
          degree: payload.degree,
          outcome: payload.succeeded ? "success" : "failure",
          maximumInfluenceDegree: payload.maximumInfluenceDegree,
          threadDisposition: payload.threadDisposition,
          relationshipBefore: payload.relationshipBefore,
          relationshipDelta: payload.relationshipDelta,
          relationshipScore: payload.relationshipScore,
          result: payload.outcome,
        });
        break;
      }
      case "ContestResolved": {
        const payload = event.payload as EventPayloadByType["ContestResolved"];
        if (payload.initiatorId !== viewerCharacterId && payload.defenderId !== viewerCharacterId) break;
        changes.push({
          kind: "contestResolved",
          characterId: viewerCharacterId,
          outcome: payload.winnerId === viewerCharacterId
            ? "success"
            : payload.winnerId === null ? "tie" : "failure",
          result: payload.outcome,
        });
        break;
      }
      case "CharacterInferenceFormed": {
        const payload = event.payload as EventPayloadByType["CharacterInferenceFormed"];
        if (payload.characterId !== viewerCharacterId) break;
        changes.push({
          kind: "privateInferenceFormed",
          characterId: payload.characterId,
          inferenceId: payload.inferenceId,
          conclusion: payload.conclusion,
          confidence: payload.confidence,
        });
        break;
      }
      case "MeaningfulFailureCommitted": {
        const payload = event.payload as EventPayloadByType["MeaningfulFailureCommitted"];
        if (payload.characterId !== viewerCharacterId) break;
        changes.push({
          kind: "meaningfulFailureCommitted",
          characterId: payload.characterId,
          outcome: "failure",
        });
        break;
      }
    }
  }
  return changes;
}

function socialObserverEventChanges(
  range: VerifiedCommittedRange,
  state: AuthoritativeWorldState,
  viewerCharacterId: string,
): ObserverDeltaChange[] {
  const changes: ObserverDeltaChange[] = [];
  for (const event of range.events) {
    if (event.eventType === "SourceClaimCreated") {
      const payload = event.payload as EventPayloadByType["SourceClaimCreated"];
      if (!payload.claimId.startsWith("claim:social:")
        && !payload.claimId.startsWith("claim:social-npc:")) continue;
      const heard = payload.speakerId === viewerCharacterId
        || range.events.some((candidate) => {
          if (candidate.eventType !== "KnowledgeAcquired") return false;
          const acquired = candidate.payload as EventPayloadByType["KnowledgeAcquired"];
          return "medium" in acquired
            && acquired.characterId === viewerCharacterId
            && acquired.medium === "spokenConversation"
            && acquired.items.some((item) => item.knowledgeRef === payload.claimId);
        });
      if (!heard) continue;
      const thread = Object.values(state.campaignRuntime.conversationThreads ?? {})
        .find((candidate) => candidate.claimRef === payload.claimId);
      changes.push({
        kind: "spokenClaimHeard",
        speakerCharacterId: payload.speakerId,
        speakerName: state.entities[payload.speakerId]?.name ?? payload.speakerId,
        claimRef: payload.claimId,
        truthStatus: "unresolved",
        ...(thread?.claimSemantics.assertion === undefined
          || thread.claimSemantics.assertion === null
          ? {}
          : {
              assertion: structuredClone(thread?.claimSemantics.assertion),
            }),
        utterance: payload.semanticContent,
      });
      continue;
    }
    if (event.eventType === "SocialDirectResolved") {
      const payload = event.payload as EventPayloadByType["SocialDirectResolved"];
      const viewer = state.entities[viewerCharacterId];
      const npc = state.entities[payload.npcCharacterId];
      const observed = payload.responseClaimRef === null
        ? payload.responseReaction === "silence"
          && viewer !== undefined
          && npc !== undefined
          && viewer.sceneId === npc.sceneId
          && characterTimelineId(state, viewer.id) !== undefined
          && characterTimelineId(state, viewer.id) === characterTimelineId(state, npc.id)
        : state.knowledge[viewerCharacterId]?.[payload.responseClaimRef] !== undefined;
      if (!observed) continue;
      changes.push({
        kind: "socialBehaviorObserved",
        npcCharacterId: payload.npcCharacterId,
        claimRef: payload.claimRef,
        responseClaimRef: payload.responseClaimRef,
        responseMode: payload.responseMode,
        responseReaction: payload.responseReaction,
        addressedThreadRef: payload.addressedThreadRef,
        threadDisposition: payload.threadDisposition,
        immediateBehavior: payload.immediateBehavior,
      });
      continue;
    }
    if (event.eventType === "SocialCheckResolved") {
      const payload = event.payload as EventPayloadByType["SocialCheckResolved"];
      if (viewerCharacterId === range.actorCharacterId
        || state.knowledge[viewerCharacterId]?.[payload.claimRef] !== undefined) {
        changes.push({
          kind: "socialBehaviorObserved",
          npcCharacterId: payload.npcCharacterId,
          claimRef: payload.claimRef,
          responseClaimRef: payload.responseClaimRef,
          responseMode: payload.responseMode,
          responseReaction: payload.responseReaction,
          addressedThreadRef: payload.addressedThreadRef,
          addressedThreadDisposition: payload.addressedThreadDisposition,
          threadDisposition: payload.threadDisposition,
          immediateBehavior: payload.immediateBehavior,
        });
      }
    }
  }
  return changes;
}

function observerRenderableClaims(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  after: SafeReadModel,
  range: VerifiedCommittedRange | undefined,
  projectCurrent: CurrentProjectionProjector,
): FrozenRenderableClaims | "invalid" | undefined {
  if (range === undefined || !worldInteractionProfileEnabled(profiles.extensions)) return undefined;
  const beforeValue = projectCurrent(profiles, range.priorState, viewerValue);
  const before = beforeValue.kind === "rejected"
    || isKpSpatialReadModel(beforeValue)
    || isLifecycleReadModel(beforeValue)
    ? undefined
    : beforeValue;
  let authorityClaims: FrozenAuthorityClaims;
  try {
    authorityClaims = deriveAuthorityClaimsFromCommittedRange({
      receipt: range.receipt,
      actorCharacterId: range.actorCharacterId,
      priorState: range.priorState,
      state,
      events: range.events,
    });
  } catch {
    return "invalid";
  }
  const refs = viewerClaimRefs(
    state,
    range,
    viewerValue,
    before,
    after,
    authorityClaims,
  );
  let projected: FrozenRenderableClaims;
  try {
    projected = projectRenderableClaims(authorityClaims, {
      viewerKey: viewerClaimKey(viewerValue, after.viewer.subjectId),
      refs,
      projectionHash: after.projectionHash,
    });
  } catch {
    return "invalid";
  }
  return projected.claims.length === 0 ? undefined : projected;
}

function viewerClaimKey(
  viewerValue: PlayerViewer | NpcViewer | unknown,
  viewerCharacterId: string,
): string {
  if (isRecord(viewerValue)
    && viewerValue.kind === "player"
    && isNonEmptyString(viewerValue.principalId)) {
    return `${viewerValue.principalId}\u001f${viewerCharacterId}`;
  }
  return `npc:${viewerCharacterId}`;
}

function viewerClaimRefs(
  state: AuthoritativeWorldState,
  range: VerifiedCommittedRange,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  before: SafeReadModel | undefined,
  after: SafeReadModel,
  authorityClaims: FrozenAuthorityClaims,
): string[] {
  const viewerCharacterId = after.viewer.subjectId;
  const refs = new Set<string>([viewerCharacterId, range.receipt.receiptId]);
  collectProjectedRefs(before, refs);
  collectProjectedRefs(after, refs);

  for (const event of range.events) {
    if (!visibilityPolicyVisibleToViewer(
      event.visibilityPolicyId,
      event.payload,
      state,
      range,
      viewerValue,
      viewerCharacterId,
    )) continue;
    refs.add(event.visibilityPolicyId);
    refs.add(event.eventId);
  }

  for (const [definitionRef, definition] of Object.entries(state.campaignRuntime.definitions)) {
    if (!isRecord(definition) || definition.schema !== "zhuwei.semantic-definition/vnext-1") continue;
    const policyRef = isNonEmptyString(definition.visibilityPolicyRef)
      ? definition.visibilityPolicyRef
      : undefined;
    if (policyRef === undefined || !visibilityPolicyVisibleToViewer(
      policyRef,
      definition.content,
      state,
      range,
      viewerValue,
      viewerCharacterId,
    )) continue;
    refs.add(policyRef);
    refs.add(definitionRef);
    if (isNonEmptyString(definition.definitionId)) refs.add(definition.definitionId);
    collectReferenceFields(definition.content, refs);
  }

  for (const claim of authorityClaims.claims) {
    if (claim.visibility.kind !== "grants") continue;
    for (const policyRef of claim.visibility.allOf) {
      if (refs.has(policyRef)) continue;
      if (visibilityPolicyVisibleToViewer(
        policyRef,
        undefined,
        state,
        range,
        viewerValue,
        viewerCharacterId,
      )) refs.add(policyRef);
    }
  }
  return [...refs].sort();
}

function collectProjectedRefs(value: unknown, refs: Set<string>): void {
  if (value === undefined) return;
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, field = ""): void => {
    if (candidate === null || candidate === undefined) return;
    if (typeof candidate === "string") {
      if (referenceField(field) || candidate.includes(":")) refs.add(candidate);
      return;
    }
    if (typeof candidate !== "object") return;
    if (seen.has(candidate as object)) return;
    seen.add(candidate as object);
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry, field);
      return;
    }
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
      if (key.includes(":")) refs.add(key);
      visit(nested, key);
    }
  };
  visit(value);
}

function collectReferenceFields(value: unknown, refs: Set<string>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectReferenceFields(entry, refs);
    return;
  }
  if (!isRecord(value)) return;
  for (const [field, nested] of Object.entries(value)) {
    if (typeof nested === "string" && referenceField(field)) refs.add(nested);
    if (Array.isArray(nested) && referenceField(field)) {
      for (const entry of nested) if (isNonEmptyString(entry)) refs.add(entry);
    }
    collectReferenceFields(nested, refs);
  }
}

function referenceField(field: string): boolean {
  return field === "id"
    || field.endsWith("Id")
    || field.endsWith("Ids")
    || field.endsWith("Ref")
    || field.endsWith("Refs");
}

function visibilityPolicyVisibleToViewer(
  policyRef: string,
  subject: unknown,
  state: AuthoritativeWorldState,
  range: VerifiedCommittedRange,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  viewerCharacterId: string,
): boolean {
  if (policyRef === "visibility:public" || policyRef.startsWith("visibility:public:")) return true;
  if (policyRef === `visibility:character-controller:${viewerCharacterId}`
    || policyRef === `visibility:knowledge-holder:${viewerCharacterId}`
    || policyRef === `visibility:npc:${viewerCharacterId}`) return true;
  if (isRecord(viewerValue)
    && isNonEmptyString(viewerValue.principalId)
    && policyRef === `visibility:principal:${viewerValue.principalId}`) return true;

  const viewerPriorSceneId = range.priorState.entities[viewerCharacterId]?.sceneId;
  const viewerCurrentSceneId = state.entities[viewerCharacterId]?.sceneId;
  const actorPriorSceneId = range.priorState.entities[range.actorCharacterId]?.sceneId;
  const actorCurrentSceneId = state.entities[range.actorCharacterId]?.sceneId;
  const coPresent = viewerCharacterId === range.actorCharacterId
    || (viewerPriorSceneId !== undefined && viewerPriorSceneId === actorPriorSceneId)
    || (viewerCurrentSceneId !== undefined && viewerCurrentSceneId === actorCurrentSceneId);
  if (policyRef === "visibility:scene-observers"
    || policyRef === "visibility:combat-observers") {
    if (!coPresent) return false;
    if (!isRecord(subject)) return true;
    const sceneRef = isNonEmptyString(subject.sceneRef)
      ? subject.sceneRef
      : isNonEmptyString(subject.sceneId) ? subject.sceneId : undefined;
    return sceneRef === undefined
      || sceneRef === viewerPriorSceneId
      || sceneRef === viewerCurrentSceneId;
  }

  if (policyRef === "visibility:relationship-participants") {
    return isRecord(subject)
      && Array.isArray(subject.subjectIds)
      && subject.subjectIds.includes(viewerCharacterId);
  }
  if (policyRef === "visibility:promise-participants") {
    return isRecord(subject)
      && (subject.promisorId === viewerCharacterId || subject.promiseeId === viewerCharacterId);
  }
  if (policyRef === "visibility:debt-participants") {
    return isRecord(subject)
      && (subject.debtorId === viewerCharacterId || subject.creditorId === viewerCharacterId);
  }
  if (policyRef === "visibility:party-group") {
    return Object.values(state.multiplayerRuntime.partyGroups).some((group) =>
      group.status === "active"
      && Array.isArray(group.memberCharacterIds)
      && group.memberCharacterIds.includes(viewerCharacterId));
  }
  return false;
}

function observerCommittedDelta(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  after: SafeReadModel,
  range: VerifiedCommittedRange | undefined,
  projectCurrent: CurrentProjectionProjector,
): ObserverCommittedDelta | undefined {
  if (range === undefined) return undefined;
  const viewerCharacterId = after.viewer.subjectId;
  const actor = viewerCharacterId === range.actorCharacterId;
  const beforeProjection = projectCurrent(profiles, range.priorState, viewerValue);
  const before = beforeProjection.kind === "rejected"
    || isKpSpatialReadModel(beforeProjection)
    || isLifecycleReadModel(beforeProjection)
    ? undefined
    : beforeProjection;
  const actorPriorSceneId = range.priorState.entities[range.actorCharacterId]?.sceneId;
  const actorCurrentSceneId = state.entities[range.actorCharacterId]?.sceneId;
  const viewerPriorSceneId = range.priorState.entities[viewerCharacterId]?.sceneId;
  const viewerCurrentSceneId = state.entities[viewerCharacterId]?.sceneId;
  const coPresent = actor
    || (actorPriorSceneId !== undefined && actorPriorSceneId === viewerPriorSceneId)
    || (actorCurrentSceneId !== undefined && actorCurrentSceneId === viewerCurrentSceneId);
  if (!coPresent) return undefined;

  const correction = isCorrectionCommittedRange(range);
  const movement = correction ? [] : movementChanges(range, state, viewerCharacterId);
  const dynamicEntities = correction ? [] : dynamicEntityChanges(range, state, viewerCharacterId);
  const fieldChanges = correction
    ? correctionProjectionFieldChanges(before, after, actor)
    : projectionFieldChanges(before, after, actor);
  const eventChanges = actorEventChanges(range, state, viewerCharacterId);
  const socialChanges = socialResolutionProfileEnabled(profiles.extensions)
    ? socialObserverEventChanges(range, state, viewerCharacterId)
    : [];
  const correctionChanges = correction ? publicCorrectionChanges(range) : [];
  const changes = [
    ...correctionChanges,
    ...eventChanges,
    ...socialChanges,
    ...dynamicEntities,
    ...movement,
    ...fieldChanges,
  ];
  if (actor && changes.length === 0) {
    changes.push({ kind: "actionCommitted", status: range.receipt.status });
  }
  if (!actor && changes.length === 0) return undefined;
  return {
    schema: "zhuwei.observer-committed-delta/v1",
    actorCharacterId: range.actorCharacterId,
    viewerCharacterId,
    receipt: range.receipt,
    changes,
  };
}

function projectFormerActorCommittedResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  range: VerifiedCommittedRange | undefined,
  projectCurrent: CurrentProjectionProjector,
): SafeReadModel | undefined {
  if (range === undefined || !isRecord(viewerValue) || viewerValue.kind !== "player") {
    return undefined;
  }
  if (viewerValue.characterId !== range.actorCharacterId) return undefined;
  const prior = projectCurrent(profiles, range.priorState, viewerValue);
  if (prior.kind === "rejected"
    || isKpSpatialReadModel(prior)
    || isLifecycleReadModel(prior)) return undefined;
  const beforeStatus = range.priorState.entities[range.actorCharacterId]?.tenureStatus;
  const afterStatus = state.entities[range.actorCharacterId]?.tenureStatus ?? "missing";
  if (beforeStatus === afterStatus || afterStatus === "active") return undefined;
  const committedDelta: ObserverCommittedDelta = {
    schema: "zhuwei.observer-committed-delta/v1",
    actorCharacterId: range.actorCharacterId,
    viewerCharacterId: range.actorCharacterId,
    receipt: range.receipt,
    changes: [
      ...actorEventChanges(range, state, range.actorCharacterId),
      {
        kind: "characterLifecycleChanged",
        characterId: range.actorCharacterId,
        before: beforeStatus,
        after: afterStatus,
        successorRequired: true,
      },
    ],
  };
  const receipts = [
    ...prior.receipts.filter((receipt) => receipt.receiptId !== range.receipt.receiptId),
    range.receipt,
  ];
  const { projectionHash: _projectionHash, ...priorHashable } = prior;
  const hashable = {
    ...priorHashable,
    stateVersion: state.version,
    activeBranchId: state.activeBranchId,
    controlledCharacter: {
      ...prior.controlledCharacter,
      tenureStatus: afterStatus,
    },
    receipts,
    committedDelta,
  };
  return { ...hashable, projectionHash: canonicalSha256(hashable) };
}

export function applyObserverRangeProjection(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  viewerValue: PlayerViewer | NpcViewer | unknown,
  query: ProjectionQuery | undefined,
  projected: CurrentProjection,
  projectCurrent: CurrentProjectionProjector,
): ProjectionResult {
  const rangeStatus = verifiedCommittedRange(profiles, state, query);
  const committedRange = rangeStatus === "invalid" ? undefined : rangeStatus;
  const vnextClaims = worldInteractionProfileEnabled(profiles.extensions);
  if (projected.kind === "rejected") {
    return projectFormerActorCommittedResult(
      profiles,
      state,
      viewerValue,
      committedRange,
      projectCurrent,
    ) ?? projected;
  }
  if (vnextClaims && rangeStatus === "invalid") {
    return rejected(
      "projectionIntegrity",
      "The committed event range is incomplete or does not match its authoritative Receipt and hashes.",
    );
  }
  if (vnextClaims
    && isRecord(query)
    && query.committedRange !== undefined
    && query.incrementalRange !== undefined) {
    return rejected(
      "projectionIntegrity",
      "A committed Claim projection cannot also request an observer increment.",
    );
  }
  if (isLifecycleReadModel(projected)) {
    const incrementalDelta = lifecycleIncrementalDelta(
      profiles,
      state,
      viewerValue,
      projected,
      query,
      projectCurrent,
    );
    if (incrementalDelta === "invalid") {
      return rejected(
        "projectionIntegrity",
        "The observer increment is incomplete or does not match its authoritative hashes.",
      );
    }
    if (incrementalDelta === undefined) return projected;
    const { projectionHash: _projectionHash, ...hashable } = projected;
    return {
      ...projected,
      incrementalDelta,
      projectionHash: canonicalSha256({ ...hashable, incrementalDelta }),
    };
  }
  if (isKpSpatialReadModel(projected)) return projected;
  const incrementalDelta = observerIncrementalDelta(
    profiles,
    state,
    viewerValue,
    projected,
    query,
    projectCurrent,
  );
  if (incrementalDelta === "invalid") {
    return rejected(
      "projectionIntegrity",
      "The observer increment is incomplete or does not match its authoritative hashes.",
    );
  }
  if (incrementalDelta !== undefined) {
    const { projectionHash: _projectionHash, ...hashable } = projected;
    return {
      ...projected,
      incrementalDelta,
      projectionHash: canonicalSha256({ ...hashable, incrementalDelta }),
    };
  }
  const committedDelta = observerCommittedDelta(
    profiles,
    state,
    viewerValue,
    projected,
    committedRange,
    projectCurrent,
  );
  const renderableClaims = observerRenderableClaims(
    profiles,
    state,
    viewerValue,
    projected,
    committedRange,
    projectCurrent,
  );
  if (renderableClaims === "invalid") {
    return rejected(
      "projectionIntegrity",
      "The committed event range could not produce canonical Viewer Claims.",
    );
  }
  if (committedDelta === undefined && renderableClaims === undefined) return projected;
  const { projectionHash: _projectionHash, ...hashable } = projected;
  const additions = {
    ...(committedDelta === undefined ? {} : { committedDelta }),
    ...(renderableClaims === undefined ? {} : { renderableClaims }),
  };
  return {
    ...projected,
    ...additions,
    projectionHash: canonicalSha256({ ...hashable, ...additions }),
  };
}
