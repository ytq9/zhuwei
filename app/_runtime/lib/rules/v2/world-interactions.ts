import { canonicalSha256 } from "../profiles/canonical";
import { worldInteractionProfileEnabled } from "../profiles/vnext-world-interaction";
import type { RuntimeProfileManifest } from "../profiles/types";
import {
  createCandidateEventTransition,
  createEventTransition,
  createScopeProof,
} from "./events";
import {
  authorityReadSetMatches,
  authorityRevisionOrHash,
  authorityRefBoundToScene,
  authoritySpatialRefVisibleTo,
} from "./authority-bindings";
import type {
  AuthoritativeWorldState,
  AuthorityContinuation,
  EventEnvelope,
  EventPayloadByType,
  JsonRecord,
  RandomnessRequest,
  ScopeProof,
  StepResult,
} from "./model";
import { rejected } from "./results";
import {
  skillCheckModifier,
  type ProficiencyAbility,
} from "./proficiency";
import {
  worldInteractionAbilityAuthority,
  type WorldInteractionAbilityAuthority,
} from "./world-interaction-mechanics";
import { WORLD_DAMAGE_PROFILE_REGISTRY } from "../profiles/world-interaction-registry";
import {
  composeDefinition,
  createDefinitionSnapshot,
  isSemanticDefinitionMaterializationPlan,
  isStoredSemanticDefinition,
  materializedSemanticDefinition,
  semanticDefinitionSnapshot,
  storedSemanticDefinition,
  type SemanticDefinitionMaterializedPayload,
  type SemanticFieldPolicy,
  type StoredSemanticDefinition,
} from "./semantic-definitions";
import {
  hasExactKeys,
  hashWorldState,
  isNonEmptyString,
  isRecord,
  isSha256,
} from "./validation";
import { spatialVisibilityPolicyKind } from "./spatial-visibility";
import {
  ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA,
  atomicWorldInteractionCheckPlan,
  atomicWorldInteractionStepsPlanHash,
  isAtomicWorldInteractionStepsPlan,
  isSemanticDefinitionRevisionPlan,
  isWorldInteractionFeasibilityRulingPlan,
  isWorldInteractionResolutionPlan,
  type AppliedWorldInteractionEffect,
  type AtomicWorldInteractionOutcomeBinding,
  type AtomicWorldInteractionProducedReference,
  type AtomicWorldInteractionReference,
  type AtomicWorldInteractionRulesInput,
  type AtomicWorldInteractionStep,
  type AtomicWorldInteractionStepsPlan,
  type SemanticDefinitionRevisionPlan,
  type WorldInteractionBranch,
  type WorldInteractionCost,
  type WorldInteractionEffect,
  type WorldInteractionFeasibilityRuledPayload,
  type WorldInteractionFeasibilityRulingPlan,
  type WorldInteractionRegisteredHazardEffect,
  type WorldInteractionResolutionPlan,
  worldInteractionPlanHash,
} from "./world-interaction-model";

const NPC_SEMANTIC_ALLOWLIST: readonly SemanticFieldPolicy[] = Object.freeze([
  Object.freeze({ kind: "value", path: Object.freeze(["semantics", "attitude"]) }),
  Object.freeze({
    kind: "referenceArray",
    path: Object.freeze(["semantics", "goals"]),
    referenceField: "goalRef",
  }),
  Object.freeze({
    kind: "referenceArray",
    path: Object.freeze(["semantics", "plans"]),
    referenceField: "planRef",
  }),
]);

type TransitionAccumulator = {
  source?: AuthoritativeWorldState;
  state: AuthoritativeWorldState;
  events: EventEnvelope[];
  scopeProof?: ScopeProof;
  candidate?: boolean;
  transactionReads?: Set<string>;
  transactionWrites?: Set<string>;
  transactionCreates?: Set<string>;
  transactionCreatedAuthorityRefs?: Set<string>;
};

/**
 * Shared by the four single-step vNext world-interaction/semantic functions
 * below so an atomic multi-step commit (see `applyAtomicWorldInteractionSteps`)
 * can thread every step through one `TransitionAccumulator` -- one shared
 * mutable `{state, events}` pair -- instead of each step settling its own
 * isolated transition. `accumulator`, when supplied, replaces the function's
 * own fresh accumulator so its events/state land in the caller's shared one.
 * `skipDuplicateCheck` lets the second and later steps of one atomic
 * RootAction proceed past the "this RootAction already has a Receipt" guard,
 * which would otherwise fire the moment the first step's Receipt exists.
 */
type AtomicStepOptions = Readonly<{
  accumulator?: TransitionAccumulator;
  skipDuplicateCheck?: boolean;
}>;

export function stepVNextWorldInteraction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (input.kind !== "reviseSemanticDefinition"
    && input.kind !== "resolveWorldInteraction"
    && input.kind !== "materializeSemanticDefinition"
    && input.kind !== "ruleWorldInteractionFeasibility"
    && input.kind !== "applyAtomicWorldInteractionSteps") {
    return undefined;
  }
  if (!worldInteractionProfileEnabled(profiles.extensions)) {
    return rejected(
      "unsupportedOperation",
      "The pinned runtime does not enable vNext semantic revision or world interaction.",
    );
  }
  if (input.kind === "reviseSemanticDefinition") {
    return reviseSemanticDefinition(profiles, state, input);
  }
  if (input.kind === "materializeSemanticDefinition") {
    return materializeSemanticDefinition(profiles, state, input);
  }
  if (input.kind === "ruleWorldInteractionFeasibility") {
    return ruleWorldInteractionFeasibility(profiles, state, input);
  }
  if (input.kind === "applyAtomicWorldInteractionSteps") {
    return applyAtomicWorldInteractionSteps(profiles, state, input);
  }
  return resolveWorldInteraction(profiles, state, input);
}

export function fulfillVNextWorldInteractionRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  rolls: readonly number[],
): StepResult | undefined {
  const stored = state.internalContinuations[continuationId];
  if (stored === undefined) return undefined;
  const plan = stored.resolutionPlan;
  // Ownership is decided before the Profile gate. A continuation belonging to
  // the legacy causal path is not this handler's to reject: returning
  // undefined is how it declines so the V3 handler can settle it. Gating on
  // the Profile first rejected every foreign continuation whenever the vNext
  // extension was disabled, which is a rejection this handler has no standing
  // to make.
  if (!isAtomicWorldInteractionStepsPlan(plan) && !isWorldInteractionResolutionPlan(plan)) {
    return undefined;
  }
  if (!worldInteractionProfileEnabled(profiles.extensions)) {
    return rejected("unsupportedOperation", "The frozen world interaction Profile is unavailable.");
  }
  if (isAtomicWorldInteractionStepsPlan(plan)) {
    return fulfillAtomicWorldInteractionRandomness(
      profiles,
      state,
      continuationId,
      rolls,
      plan,
    );
  }
  if (!isWorldInteractionResolutionPlan(plan)) return undefined;
  return settleCheckedWorldInteraction(
    profiles,
    transitionAccumulator(state),
    continuationId,
    rolls,
    plan,
  );
}

function settleCheckedWorldInteraction(
  profiles: RuntimeProfileManifest,
  accumulator: TransitionAccumulator,
  continuationId: string,
  rolls: readonly number[],
  plan: WorldInteractionResolutionPlan,
): StepResult {
  const stored = accumulator.state.internalContinuations[continuationId];
  if (stored === undefined) {
    return rejected("invalidWorldState", "The world interaction continuation is unavailable.");
  }
  if (stored.request.purpose !== "worldInteractionCheck"
    || plan.ruling.kind !== "check"
    || stored.request.actorCharacterId !== plan.actorCharacterId
    || stored.request.resolutionId !== plan.resolutionId
    || stored.request.randomnessId !== plan.ruling.randomnessId
    || canonicalSha256(stored.request.frozenCheck) !== canonicalSha256(plan.ruling.check)) {
    return rejected("invalidWorldState", "The world interaction continuation changed its frozen ruling.");
  }
  const expectedRollCount = plan.ruling.check.mode === "normal" ? 1 : 2;
  if (rolls.length !== expectedRollCount
    || !rolls.every((roll) => Number.isSafeInteger(roll) && roll >= 1 && roll <= 20)) {
    return rejected("invalidRulesInput", "The world interaction roll does not match its frozen d20 request.");
  }
  if (!authorityReadSetMatches(accumulator.state, plan.readSet)) {
    return rejected("causalFrontierConflict", "The world interaction read set changed before settlement.");
  }
  const selectedRoll = plan.ruling.check.mode === "advantage"
    ? Math.max(...rolls)
    : plan.ruling.check.mode === "disadvantage"
      ? Math.min(...rolls)
      : rolls[0]!;
  const total = selectedRoll + Number(plan.ruling.check.modifier);
  const succeeded = plan.ruling.resolutionKind === "attack"
    ? selectedRoll === 20
      || (selectedRoll !== 1 && total >= Number(plan.ruling.check.dc))
    : total >= Number(plan.ruling.check.dc);
  const branchName = succeeded ? "success" : "failure";
  const branch = plan.branches[branchName];
  const planValidation = validatePlanAgainstState(profiles, accumulator.state, plan.actorCharacterId, plan);
  if (planValidation !== undefined) return planValidation;
  const validation = validateBranchAgainstState(accumulator.state, plan, branch);
  if (validation !== undefined) return validation;

  appendTransition(accumulator, profiles, stored.rootActionId, {
    eventType: "DiceRolled",
    resolutionId: stored.request.resolutionId,
    payload: {
      randomnessId: stored.request.randomnessId,
      resolutionId: stored.request.resolutionId,
      formula: stored.request.diceExpression,
      faces: [...rolls],
      selectedFace: selectedRoll,
      requestHash: canonicalSha256(stored.request),
      frozenParametersHash: canonicalSha256(stored.request.frozenCheck),
    },
    reads: [`continuation:${continuationId}`],
    writes: [`receipt:${stored.rootActionId}`],
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  });
  appendAbilityInvocation(accumulator, profiles, stored.rootActionId, plan);
  const appliedEffects = applyItemCosts(
    accumulator, profiles, stored.rootActionId, plan.actorCharacterId, plan.costs, plan.interactionRef,
  );
  if (!Array.isArray(appliedEffects)) return appliedEffects;
  const branchEffects = applyBranchEffects(
    accumulator,
    profiles,
    stored.rootActionId,
    plan,
    branch,
  );
  appliedEffects.push(...branchEffects);
  return finalizeInteraction(accumulator, profiles, stored.rootActionId, plan, branchName, branch, {
    resolutionKind: plan.ruling.resolutionKind,
    randomnessId: stored.request.randomnessId,
    rolls: [...rolls],
    selectedRoll,
    total,
    dc: Number(plan.ruling.check.dc),
    succeeded,
  }, appliedEffects);
}

function reviseSemanticDefinition(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  options?: AtomicStepOptions,
): StepResult {
  if (!hasExactKeys(input, ["actorCharacterId", "kind", "plan", "rootActionId"])
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId)
    || !isSemanticDefinitionRevisionPlan(input.plan)) {
    return rejected("invalidRulesInput", "Semantic definition revision input is not canonical.");
  }
  const accumulator: TransitionAccumulator = options?.accumulator ?? { state, events: [] };
  if (!options?.skipDuplicateCheck && input.rootActionId in accumulator.state.receipts) {
    return rejected("duplicateRootAction", "The semantic revision RootAction already has a Receipt.");
  }
  const actor = accumulator.state.entities[input.actorCharacterId];
  const plan = input.plan;
  if (actor?.tenureStatus !== "active") {
    return rejected("privateOrUnknownReference", "The semantic revision actor is unavailable.");
  }
  if (plan.semanticKind !== "npc") {
    return rejected(
      "unsupportedOperation",
      "Stage-three sparse semantic revision is currently closed to NPC semantics.",
    );
  }
  if (!authorityReadSetMatches(accumulator.state, plan.readSet)) {
    return rejected("causalFrontierConflict", "The semantic revision read set changed after prepare.");
  }
  const currentValue = accumulator.state.campaignRuntime.definitions[plan.definitionRef];
  if (!isStoredSemanticDefinition(currentValue)
    || currentValue.semanticKind !== plan.semanticKind
    || currentValue.revision !== plan.baseRevision
    || currentValue.definitionHash !== plan.baseHash
    || currentValue.templateRef !== plan.templateRef
    || currentValue.templateHash !== plan.templateHash) {
    return rejected("causalFrontierConflict", "The semantic revision base or template binding changed.");
  }
  const npcRef = npcEntityRef(currentValue);
  if (npcRef === undefined || accumulator.state.entities[npcRef]?.kind !== "npc") {
    return rejected("privateOrUnknownReference", "The semantic definition is not bound to an NPC.");
  }
  if (!plan.basisRefs.every((ref) => npcMayUseBasis(accumulator.state, npcRef, ref))) {
    return rejected("npcKnowledgeInsufficient", "The NPC revision cites a fact outside that NPC's knowledge.");
  }
  const base = semanticDefinitionSnapshot(currentValue)!;
  const composed = composeDefinition({
    base,
    expectedRevision: plan.baseRevision,
    expectedHash: plan.baseHash,
    allowlist: NPC_SEMANTIC_ALLOWLIST,
    operations: plan.operations,
  });
  if (composed.kind === "rejected") {
    return rejected(
      composed.code === "DEFINITION_CONFLICT" ? "causalFrontierConflict" : "invalidRulesInput",
      `Semantic revision was rejected: ${composed.issues.join(", ")}`,
    );
  }
  const nextDefinition = storedSemanticDefinition(
    currentValue.semanticKind,
    currentValue.visibilityPolicyRef,
    composed.snapshot,
    { templateRef: currentValue.templateRef, templateHash: currentValue.templateHash },
  );
  appendTransition(accumulator, profiles, input.rootActionId, {
    eventType: "SemanticDefinitionRevised",
    payload: revisionPayload(input.actorCharacterId, plan, nextDefinition),
    reads: canonicalRefs([
      `entity:${input.actorCharacterId}`,
      `entity:${npcRef}`,
      `definition:${plan.definitionRef}:${plan.baseRevision}`,
      `template:${plan.templateRef}:${plan.templateHash}`,
      ...plan.basisRefs,
    ]),
    writes: [`definition:${plan.definitionRef}:${nextDefinition.revision}`, `entity:${npcRef}`,
      `receipt:${input.rootActionId}`],
    visibilityPolicyId: currentValue.visibilityPolicyRef,
    secrecy: currentValue.visibilityPolicyRef === "visibility:public" ? "public" : "private",
  });
  const finalEvent = accumulator.events.at(-1)!;
  return {
    kind: "committed",
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: finalEvent.stateHashAfter,
    scopeProof: accumulator.scopeProof!,
    receipt: accumulator.state.receipts[input.rootActionId]!,
    mechanicalResult: {
      kind: "semanticDefinitionRevision",
      definitionRef: plan.definitionRef,
      fromRevision: plan.baseRevision,
      toRevision: nextDefinition.revision,
      definitionHash: nextDefinition.definitionHash,
    },
  };
}

/**
 * Creates a brand-new sparse semantic definition. Unlike revision, there is
 * no prior authoritative version to bind against, so the plan's frozen
 * readSet carries that weight: it must still match current authority state,
 * and the derived definitionRef must not already exist -- creating over one
 * is a DEFINITION_CONFLICT, never a silent overwrite.
 *
 * `plan.contextHash` is the frozen RequiredContext binding hash, checked
 * against the adjudication context at Proposal lowering time and carried
 * here only so the committed event records which context authorised it.
 * Rules cannot re-derive it (it has no RequiredContext) and must not invent
 * a substitute computed from the plan's own fields -- that would be
 * self-satisfying, and would reject the KP-side lowering, which sets this to
 * the binding hash exactly as the semantic revision path does.
 */
function materializeSemanticDefinition(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  options?: AtomicStepOptions,
): StepResult {
  if (!hasExactKeys(input, ["actorCharacterId", "kind", "plan", "rootActionId"])
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId)
    || !isSemanticDefinitionMaterializationPlan(input.plan)) {
    return rejected("invalidRulesInput", "Semantic definition materialization input is not canonical.");
  }
  const accumulator: TransitionAccumulator = options?.accumulator ?? { state, events: [] };
  if (!options?.skipDuplicateCheck && input.rootActionId in accumulator.state.receipts) {
    return rejected("duplicateRootAction", "The semantic materialization RootAction already has a Receipt.");
  }
  const actor = accumulator.state.entities[input.actorCharacterId];
  if (actor?.tenureStatus !== "active") {
    return rejected("privateOrUnknownReference", "The semantic materialization actor is unavailable.");
  }
  const plan = input.plan;
  if (!authorityReadSetMatches(accumulator.state, plan.readSet)) {
    return rejected("causalFrontierConflict", "The semantic materialization read set changed after prepare.");
  }
  if (![...plan.basisRefs, ...plan.sourceRefs]
    .every((ref) => authorityRefExists(accumulator.state, ref))) {
    return rejected(
      "privateOrUnknownReference",
      "The semantic materialization cites an unavailable authority ref.",
    );
  }
  const visibilityKind = spatialVisibilityPolicyKind(plan.visibilityPolicyRef);
  if (visibilityKind === undefined
    || (plan.semanticKind === "sceneFeature"
      && (!isNonEmptyString(plan.content.sceneRef)
        || accumulator.state.scenes[plan.content.sceneRef] === undefined))
    || (visibilityKind === "hiddenUntilEvidence"
      && !isNonEmptyString(plan.content.visibilityFactId))) {
    return rejected(
      "privateOrUnknownReference",
      "The semantic materialization visibility policy or spatial binding is unsupported.",
    );
  }
  const materialized = materializedSemanticDefinition(input.rootActionId, plan);
  if (accumulator.state.campaignRuntime.definitions[materialized.definitionRef] !== undefined) {
    return rejected(
      "causalFrontierConflict",
      "DEFINITION_CONFLICT: the materialized semantic definition ref already exists.",
    );
  }
  const payload: SemanticDefinitionMaterializedPayload = {
    actorCharacterId: input.actorCharacterId,
    bundleHash: plan.bundleHash,
    prospectiveRef: materialized.prospectiveRef,
    definitionRef: materialized.definitionRef,
    semanticKind: plan.semanticKind,
    templateRef: plan.templateRef,
    templateHash: plan.templateHash,
    contextHash: plan.contextHash,
    basisRefs: [...plan.basisRefs],
    sourceRefs: [...plan.sourceRefs],
    summary: plan.summary,
    definition: materialized.definition,
  };
  accumulator.transactionCreatedAuthorityRefs?.add(materialized.definitionRef);
  appendTransition(accumulator, profiles, input.rootActionId, {
    eventType: "SemanticDefinitionMaterialized",
    payload,
    reads: canonicalRefs([
      `entity:${input.actorCharacterId}`,
      ...plan.readSet.map((binding) => binding.ref),
      ...plan.basisRefs,
      ...plan.sourceRefs,
    ]),
    writes: [`definition:${materialized.definitionRef}:${materialized.definition.revision}`,
      `receipt:${input.rootActionId}`],
    creates: [`definition:${materialized.definitionRef}:${materialized.definition.revision}`],
    visibilityPolicyId: plan.visibilityPolicyRef,
    secrecy: plan.visibilityPolicyRef === "visibility:public" ? "public" : "private",
  });
  const finalEvent = accumulator.events.at(-1)!;
  return {
    kind: "committed",
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: finalEvent.stateHashAfter,
    scopeProof: accumulator.scopeProof!,
    receipt: accumulator.state.receipts[input.rootActionId]!,
    mechanicalResult: {
      kind: "semanticDefinitionMaterialization",
      prospectiveRef: materialized.prospectiveRef,
      definitionRef: materialized.definitionRef,
      semanticKind: plan.semanticKind,
      revision: materialized.definition.revision,
    },
  };
}

function resolveWorldInteraction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  options?: AtomicStepOptions,
): StepResult {
  if (!hasExactKeys(input, ["actorCharacterId", "kind", "plan", "rootActionId"])
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId)
    || !isWorldInteractionResolutionPlan(input.plan)) {
    return rejected("invalidRulesInput", "World interaction input is not canonical.");
  }
  const accumulator: TransitionAccumulator = options?.accumulator ?? { state, events: [] };
  if (!options?.skipDuplicateCheck && input.rootActionId in accumulator.state.receipts) {
    return rejected("duplicateRootAction", "The world interaction RootAction already has a Receipt.");
  }
  const plan = input.plan;
  const validation = validatePlanAgainstState(profiles, accumulator.state, input.actorCharacterId, plan);
  if (validation !== undefined) return validation;
  const successValidation = validateBranchAgainstState(accumulator.state, plan, plan.branches.success);
  if (successValidation !== undefined) return successValidation;
  const failureValidation = validateBranchAgainstState(accumulator.state, plan, plan.branches.failure);
  if (failureValidation !== undefined) return failureValidation;

  if (plan.ruling.kind === "directSuccess") {
    appendAbilityInvocation(accumulator, profiles, input.rootActionId, plan);
    const costEffects = applyItemCosts(
      accumulator, profiles, input.rootActionId, plan.actorCharacterId, plan.costs, plan.interactionRef,
    );
    if (!Array.isArray(costEffects)) return costEffects;
    const branchEffects = applyBranchEffects(
      accumulator,
      profiles,
      input.rootActionId,
      plan,
      plan.branches.success,
    );
    costEffects.push(...branchEffects);
    return finalizeInteraction(
      accumulator,
      profiles,
      input.rootActionId,
      plan,
      "success",
      plan.branches.success,
      null,
      costEffects,
    );
  }

  const request: RandomnessRequest = {
    randomnessId: plan.ruling.randomnessId,
    resolutionId: plan.resolutionId,
    actorCharacterId: plan.actorCharacterId,
    purpose: "worldInteractionCheck",
    diceExpression: plan.ruling.check.mode === "normal"
      ? "1d20"
      : plan.ruling.check.mode === "advantage" ? "2d20kh1" : "2d20kl1",
    frozenCheck: structuredClone(plan.ruling.check),
  };
  const continuation: AuthorityContinuation = {
    kind: "roomAuthorityRandomness",
    continuationId: `continuation:${plan.resolutionId}`,
    capability: canonicalSha256({
      kind: "roomAuthorityRandomness",
      roomId: accumulator.state.roomId,
      runtimeEpochId: accumulator.state.runtimeEpochId,
      stateHash: hashWorldState(accumulator.state),
      rootActionId: input.rootActionId,
      request,
      resolutionPlanHash: worldInteractionPlanHash(plan),
    }),
  };
  if (continuation.continuationId in accumulator.state.internalContinuations) {
    return rejected("invalidRulesInput", "The world interaction resolution already has a continuation.");
  }
  appendTransition(accumulator, profiles, input.rootActionId, {
    eventType: "RandomnessRequested",
    resolutionId: plan.resolutionId,
    payload: {
      request,
      continuation,
      purpose: request.purpose,
      formula: request.diceExpression,
      resolutionPlan: structuredClone(plan),
    },
    reads: canonicalRefs([
      `entity:${plan.actorCharacterId}`,
      `scene:${plan.sceneRef}`,
      ...plan.readSet.map((binding) => binding.ref),
    ]),
    writes: [`continuation:${continuation.continuationId}`, `receipt:${input.rootActionId}`],
    creates: [`continuation:${continuation.continuationId}`],
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  });
  return {
    kind: "awaitingRandomness",
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: accumulator.events.at(-1)!.stateHashAfter,
    scopeProof: accumulator.scopeProof!,
    receipt: accumulator.state.receipts[input.rootActionId]!,
    randomnessRequest: request,
      continuation,
      mechanicalResult: {
        kind: "worldInteractionAwaitingRandomness",
        interactionRef: plan.interactionRef,
        costEffects: [],
      },
  };
}

/**
 * The world itself declined the action -- a missing prerequisite or a
 * world-law violation -- which is a first-class mechanical outcome, not an
 * error. Any attempt costs that were really spent still apply through the
 * ordinary item-cost transition path. `plan.basisRefs` is authority-only: it
 * feeds only this event's read scope and is never copied into the committed
 * payload, so a player can never receive an authority-only basis ref through
 * this outcome.
 */
function ruleWorldInteractionFeasibility(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  options?: AtomicStepOptions,
): StepResult {
  if (!hasExactKeys(input, ["actorCharacterId", "kind", "plan", "rootActionId"])
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId)
    || !isWorldInteractionFeasibilityRulingPlan(input.plan)) {
    return rejected("invalidRulesInput", "World interaction feasibility ruling input is not canonical.");
  }
  const accumulator: TransitionAccumulator = options?.accumulator ?? { state, events: [] };
  if (!options?.skipDuplicateCheck && input.rootActionId in accumulator.state.receipts) {
    return rejected("duplicateRootAction", "The world interaction feasibility RootAction already has a Receipt.");
  }
  const plan = input.plan;
  if (plan.actorCharacterId !== input.actorCharacterId) {
    return rejected(
      "invalidRulesInput",
      "The feasibility ruling actor binding does not match the RootAction actor.",
    );
  }
  const actor = accumulator.state.entities[input.actorCharacterId];
  if (actor?.tenureStatus !== "active") {
    return rejected("privateOrUnknownReference", "The world interaction feasibility actor is unavailable.");
  }

  const costEffects = applyItemCosts(
    accumulator,
    profiles,
    input.rootActionId,
    input.actorCharacterId,
    plan.costs,
    `worldInteractionFeasibility:${plan.rulingKind}`,
  );
  if (!Array.isArray(costEffects)) return costEffects;
  const appliedCosts = costEffects.filter(
    (effect): effect is Extract<AppliedWorldInteractionEffect, { kind: "itemCost" }> =>
      effect.kind === "itemCost",
  );

  const payload: WorldInteractionFeasibilityRuledPayload = {
    actorCharacterId: input.actorCharacterId,
    intent: plan.intent,
    method: plan.method,
    rulingKind: plan.rulingKind,
    publicBasis: plan.publicBasis,
    prerequisites: plan.prerequisites,
    nextActions: plan.nextActions,
    appliedCosts,
  };
  appendTransition(accumulator, profiles, input.rootActionId, {
    eventType: "WorldInteractionFeasibilityRuled",
    payload,
    reads: canonicalRefs([`entity:${input.actorCharacterId}`, ...plan.basisRefs]),
    writes: [`receipt:${input.rootActionId}`],
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
  });
  const finalEvent = accumulator.events.at(-1)!;
  return {
    kind: "committed",
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: finalEvent.stateHashAfter,
    scopeProof: accumulator.scopeProof!,
    receipt: accumulator.state.receipts[input.rootActionId]!,
    mechanicalResult: {
      kind: "worldInteractionFeasibilityRuled",
      rulingKind: plan.rulingKind,
      appliedCosts,
    },
  };
}

const MAX_ATOMIC_STEPS = 16;
const PROSPECTIVE_HANDLE_PATTERN = /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MATERIALIZATION_FORM_ID = "materialization.vnext-1";
const WORLD_INTERACTION_FORM_ID = "world-interaction.vnext-1";

type ProspectiveBinding = Readonly<{
  definitionRef: string;
  revisionOrHash: string;
  producerProposalRef: string;
  outcomeBinding: AtomicWorldInteractionOutcomeBinding;
}>;

type AtomicCompileResult = Readonly<
  | { kind: "accepted"; plan: AtomicWorldInteractionStepsPlan }
  | { kind: "rejected"; result: ReturnType<typeof rejected> }
>;

type AtomicExecutionResult = Readonly<
  | {
      kind: "accepted";
      accumulator: TransitionAccumulator;
      ledger: readonly Readonly<{
        proposalRef: string;
        outcomeBinding: AtomicWorldInteractionOutcomeBinding;
        status: "applied" | "skipped";
      }>[];
    }
  | { kind: "rejected"; result: StepResult }
>;

/** One server-private Rules input owns the complete ordered Bundle. It is
 * normalized first, then every reachable outcome is executed on a
 * discardable formal-reducer state before any live effect or random request.
 */
function applyAtomicWorldInteractionSteps(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (isNonEmptyString(input.rootActionId) && input.rootActionId in state.receipts) {
    return rejected("duplicateRootAction", "The atomic world-interaction RootAction already has a Receipt.");
  }
  const compiled = compileAtomicWorldInteractionPlan(input);
  if (compiled.kind === "rejected") return compiled.result;
  const plan = compiled.plan;
  const actor = state.entities[plan.actorCharacterId];
  if (actor?.tenureStatus !== "active") {
    return rejected("privateOrUnknownReference", "The atomic world-interaction actor is unavailable.");
  }
  const preflight = preflightAtomicWorldInteractionPlan(profiles, state, plan);
  if (preflight !== undefined) return preflight;

  const checkPlan = atomicWorldInteractionCheckPlan(plan);
  if (checkPlan !== undefined) {
    return requestAtomicWorldInteractionRandomness(profiles, state, plan, checkPlan);
  }
  const executed = executeAtomicWorldInteractionBranch(
    profiles,
    transactionAccumulator(state),
    plan,
    "success",
    undefined,
  );
  if (executed.kind === "rejected") return executed.result;
  return finalizeAtomicWorldInteractionExecution(plan, "success", executed);
}

function compileAtomicWorldInteractionPlan(input: JsonRecord): AtomicCompileResult {
  if (!hasExactKeys(input, [
    "actorCharacterId", "bundleHash", "contextHash", "kind", "rootActionId", "sharedRuling", "steps",
  ])
    || input.kind !== "applyAtomicWorldInteractionSteps"
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId)
    || !isSha256(input.bundleHash)
    || !isSha256(input.contextHash)
    || (input.sharedRuling !== "directSuccess" && input.sharedRuling !== "check")
    || !Array.isArray(input.steps)
    || input.steps.length < 2
    || input.steps.length > MAX_ATOMIC_STEPS) {
    return atomicCompileRejected("Atomic world-interaction step input is not canonical.");
  }

  const checkProposalRefs = input.steps.flatMap((raw) =>
    isRecord(raw)
      && isNonEmptyString(raw.proposalRef)
      && isRecord(raw.rulesInput)
      && raw.rulesInput.kind === "resolveWorldInteraction"
      && isRecord(raw.rulesInput.plan)
      && isRecord(raw.rulesInput.plan.ruling)
      && raw.rulesInput.plan.ruling.kind === "check"
      ? [raw.proposalRef]
      : []);
  if ((input.sharedRuling === "check" && checkProposalRefs.length !== 1)
    || (input.sharedRuling === "directSuccess" && checkProposalRefs.length !== 0)) {
    return atomicCompileRejected("An atomic Bundle must contain exactly one shared mechanical check.");
  }
  const sharedCheckProposalRef = checkProposalRefs[0];

  const seenProposalRefs = new Set<string>();
  const bindings = new Map<string, ProspectiveBinding>();
  const normalizedSteps: AtomicWorldInteractionStep[] = [];
  for (const raw of input.steps) {
    if (!isRecord(raw)
      || !hasExactKeys(raw, [
        "consumes", "dependsOn", "formId", "outcomeBinding", "produces", "proposalRef",
        "rulesInput", "ruling",
      ])
      || (raw.formId !== MATERIALIZATION_FORM_ID && raw.formId !== WORLD_INTERACTION_FORM_ID)
      || !isNonEmptyString(raw.proposalRef)
      || seenProposalRefs.has(raw.proposalRef)
      || raw.ruling !== input.sharedRuling
      || !isOutcomeBinding(raw.outcomeBinding)
      || !isAtomicReferences(raw.consumes)
      || !isAtomicProducedReferences(raw.produces)
      || !Array.isArray(raw.dependsOn)
      || new Set(raw.dependsOn).size !== raw.dependsOn.length
      || !raw.dependsOn.every((dependency): dependency is string =>
        typeof dependency === "string" && seenProposalRefs.has(dependency))
      || !isRecord(raw.rulesInput)) {
      return atomicCompileRejected("An atomic Bundle step is not canonical or is out of dependency order.");
    }

    const prospectiveConsumes = raw.consumes
      .filter((entry): entry is Extract<AtomicWorldInteractionReference, { kind: "prospective" }> =>
        entry.kind === "prospective");
    const expectedDependencies = new Set<string>();
    for (const consume of prospectiveConsumes) {
      const producer = bindings.get(consume.handle);
      if (producer === undefined) {
        return atomicCompileRejected(`An atomic step consumes an unproduced handle: ${consume.handle}`);
      }
      if (!(producer.outcomeBinding === "always"
        || producer.outcomeBinding === raw.outcomeBinding)) {
        return atomicCompileRejected(`A prospective producer does not dominate its consumer: ${consume.handle}`);
      }
      expectedDependencies.add(producer.producerProposalRef);
    }
    if (sharedCheckProposalRef !== undefined
      && raw.outcomeBinding !== "always"
      && raw.proposalRef !== sharedCheckProposalRef) {
      expectedDependencies.add(sharedCheckProposalRef);
    }
    if (expectedDependencies.size !== raw.dependsOn.length
      || raw.dependsOn.some((dependency) => !expectedDependencies.has(dependency))) {
      return atomicCompileRejected("The server-derived atomic dependencies do not match typed consumes.");
    }

    const resolved = resolveAtomicRulesInput(
      raw.rulesInput,
      bindings,
      new Set(prospectiveConsumes.map(({ handle }) => handle)),
    );
    if (resolved.kind === "rejected") return resolved;
    const rulesInput = resolved.rulesInput;
    if (!atomicRulesInputMatchesStep(
      rulesInput,
      String(input.rootActionId),
      String(input.actorCharacterId),
      String(input.bundleHash),
      String(input.contextHash),
      raw.formId,
    )) {
      return atomicCompileRejected("An atomic step does not match its frozen Form, actor, or context.");
    }

    const produces = raw.produces.map((produced) => ({ ...produced }));
    if (rulesInput.kind === "materializeSemanticDefinition") {
      if (produces.length !== 1
        || produces[0]?.handle !== rulesInput.plan.handle
        || produces[0]?.kind !== "semanticDefinition"
        || produces[0]?.outcomeBinding !== raw.outcomeBinding
        || bindings.has(rulesInput.plan.handle)) {
        return atomicCompileRejected("A materialization step must be the unique typed producer of its handle.");
      }
      const materialized = materializedSemanticDefinition(String(input.rootActionId), rulesInput.plan);
      bindings.set(rulesInput.plan.handle, {
        definitionRef: materialized.definitionRef,
        revisionOrHash: materialized.definition.definitionHash,
        producerProposalRef: raw.proposalRef,
        outcomeBinding: raw.outcomeBinding,
      });
    } else if (produces.length !== 0) {
      return atomicCompileRejected("Only semantic materialization can produce a prospective reference here.");
    }

    normalizedSteps.push({
      formId: raw.formId,
      proposalRef: raw.proposalRef,
      ruling: input.sharedRuling,
      rulesInput,
      dependsOn: [...raw.dependsOn],
      consumes: raw.consumes.map((reference) => ({ ...reference })),
      produces,
      outcomeBinding: raw.outcomeBinding,
    });
    seenProposalRefs.add(raw.proposalRef);
  }

  const plan: AtomicWorldInteractionStepsPlan = {
    schema: ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA,
    rootActionId: String(input.rootActionId),
    actorCharacterId: String(input.actorCharacterId),
    bundleHash: input.bundleHash,
    contextHash: input.contextHash,
    sharedRuling: input.sharedRuling,
    steps: normalizedSteps,
  };
  if (!isAtomicWorldInteractionStepsPlan(plan)) {
    return atomicCompileRejected(
      "The atomic Bundle does not contain exactly one shared check, or its producer graph is invalid.",
    );
  }
  return { kind: "accepted", plan };
}

/** Validates the persisted raw Rules input through the same compiler used by
 * execution, including prospective-reference resolution and child bindings. */
export function isCanonicalAtomicWorldInteractionStepsInput(
  value: unknown,
): value is JsonRecord {
  return isRecord(value) && compileAtomicWorldInteractionPlan(value).kind === "accepted";
}

function resolveAtomicRulesInput(
  raw: JsonRecord,
  bindings: ReadonlyMap<string, ProspectiveBinding>,
  declaredHandles: ReadonlySet<string>,
): Readonly<{ kind: "accepted"; rulesInput: AtomicWorldInteractionRulesInput }>
  | Extract<AtomicCompileResult, { kind: "rejected" }> {
  if (!hasExactKeys(raw, ["actorCharacterId", "kind", "plan", "rootActionId"])
    || !isRecord(raw.plan)) {
    return atomicCompileRejected("An atomic child Rules input is not canonical.");
  }
  const prospectiveAuthorityRefs = new Set(
    [...bindings.values()].map((binding) => binding.definitionRef),
  );
  if (!Array.isArray(raw.plan.readSet)
    || raw.plan.readSet.some((entry) => isRecord(entry)
      && typeof entry.ref === "string"
      && (PROSPECTIVE_HANDLE_PATTERN.test(entry.ref)
        || prospectiveAuthorityRefs.has(entry.ref)))) {
    return atomicCompileRejected("Prospective references cannot masquerade as an initial read-set member.");
  }
  const usedHandles = new Set<string>();
  let unresolvedHandle: string | undefined;
  const transformed = substituteTypedReferences(raw.plan, undefined, (handle) => {
    const binding = bindings.get(handle);
    if (binding === undefined) {
      unresolvedHandle ??= handle;
      return undefined;
    }
    usedHandles.add(handle);
    return binding.definitionRef;
  }) as JsonRecord;
  if (unresolvedHandle !== undefined) {
    return atomicCompileRejected(`An atomic step references an unproduced handle: ${unresolvedHandle}`);
  }
  const forbiddenProspectiveField = remainingProspectiveAuthorityField(transformed);
  if (forbiddenProspectiveField !== undefined) {
    return atomicCompileRejected(
      `A prospective handle cannot occupy the authority field ${forbiddenProspectiveField}.`,
    );
  }
  if (usedHandles.size !== declaredHandles.size
    || [...declaredHandles].some((handle) => !usedHandles.has(handle))) {
    return atomicCompileRejected("Typed prospective consumes do not match the step's actual reference fields.");
  }
  if (!Array.isArray(transformed.readSet)) {
    return atomicCompileRejected("An atomic child read set is not canonical.");
  }
  const readSetByRef = new Map<string, { ref: string; revisionOrHash: string }>();
  for (const entry of transformed.readSet) {
    if (!isRecord(entry)
      || !hasExactKeys(entry, ["ref", "revisionOrHash"])
      || !isNonEmptyString(entry.ref)
      || !isNonEmptyString(entry.revisionOrHash)) {
      return atomicCompileRejected("An atomic child read set is not canonical.");
    }
    const prior = readSetByRef.get(entry.ref);
    if (prior !== undefined && prior.revisionOrHash !== entry.revisionOrHash) {
      return atomicCompileRejected("An atomic child read set binds one ref to two versions.");
    }
    readSetByRef.set(entry.ref, { ref: entry.ref, revisionOrHash: entry.revisionOrHash });
  }
  for (const handle of usedHandles) {
    const binding = bindings.get(handle)!;
    readSetByRef.set(binding.definitionRef, {
      ref: binding.definitionRef,
      revisionOrHash: binding.revisionOrHash,
    });
  }
  transformed.readSet = [...readSetByRef.values()].sort((left, right) =>
    left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
  return {
    kind: "accepted",
    rulesInput: { ...raw, plan: transformed } as AtomicWorldInteractionRulesInput,
  };
}

const TYPED_SCALAR_REF_FIELDS = new Set([
  "abilityRef", "definitionRef", "entityRef", "entryRef", "factRef", "goalRef", "npcRef",
  "objectRef", "observerRef", "planRef", "relationRef", "sceneRef", "sourceDefinitionRef",
  "sourceRef", "subjectRef", "targetRef", "zoneRef",
]);
const TYPED_REF_ARRAY_FIELDS = new Set([
  "basisRefs", "causalBasisRefs", "costs", "directTargetRefs", "instrumentRefs",
  "mechanicDefinitionRefs", "sourceRefs", "targetRefs",
]);

/** A local handle that survives substitution in an authority-shaped field is
 * either an undeclared consumption or an attempt to choose an id, policy, or
 * template that only the server may bind. Narrative strings remain opaque. */
function remainingProspectiveAuthorityField(
  value: unknown,
  field?: string,
): string | undefined {
  if (typeof value === "string") {
    return field !== undefined
      && PROSPECTIVE_HANDLE_PATTERN.test(value)
      && (field === "ref"
        || field.endsWith("Ref")
        || field.endsWith("Refs")
        || field.endsWith("Id")
        || field.endsWith("Ids"))
      ? field
      : undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = remainingProspectiveAuthorityField(entry, field);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    const found = remainingProspectiveAuthorityField(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Only schema-defined reference slots are substituted. Narrative text is
 * deliberately opaque even if it happens to equal a prospective handle. */
function substituteTypedReferences(
  value: unknown,
  field: string | undefined,
  resolve: (handle: string) => string | undefined,
): unknown {
  if (typeof value === "string") {
    const typedSlot = field !== undefined
      && (TYPED_SCALAR_REF_FIELDS.has(field) || TYPED_REF_ARRAY_FIELDS.has(field));
    return typedSlot && PROSPECTIVE_HANDLE_PATTERN.test(value)
      ? resolve(value) ?? value
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => substituteTypedReferences(entry, field, resolve));
  }
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = substituteTypedReferences(child, key, resolve);
  }
  return result;
}

function atomicRulesInputMatchesStep(
  input: AtomicWorldInteractionRulesInput,
  rootActionId: string,
  actorCharacterId: string,
  bundleHash: string,
  contextHash: string,
  formId: string,
): boolean {
  if (input.rootActionId !== rootActionId
    || input.actorCharacterId !== actorCharacterId
    || input.plan.contextHash !== contextHash) return false;
  if (input.kind === "materializeSemanticDefinition") {
    return formId === MATERIALIZATION_FORM_ID
      && input.plan.bundleHash === bundleHash
      && isSemanticDefinitionMaterializationPlan(input.plan);
  }
  if (input.kind === "reviseSemanticDefinition") {
    return formId === MATERIALIZATION_FORM_ID && isSemanticDefinitionRevisionPlan(input.plan);
  }
  return formId === WORLD_INTERACTION_FORM_ID && isWorldInteractionResolutionPlan(input.plan);
}

function preflightAtomicWorldInteractionPlan(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  plan: AtomicWorldInteractionStepsPlan,
): StepResult | undefined {
  const checkPlan = atomicWorldInteractionCheckPlan(plan);
  const branches: readonly ("success" | "failure")[] = checkPlan === undefined
    ? ["success"]
    : (["success", "failure"] as const).filter((branch) =>
        representativeRolls(checkPlan, branch) !== undefined);
  for (const branch of branches) {
    const rolls = checkPlan === undefined ? undefined : representativeRolls(checkPlan, branch);
    const executed = executeAtomicWorldInteractionBranch(
      profiles,
      transactionAccumulator(state, true),
      plan,
      branch,
      rolls,
    );
    if (executed.kind === "rejected") return executed.result;
  }
  return undefined;
}

function executeAtomicWorldInteractionBranch(
  profiles: RuntimeProfileManifest,
  accumulator: TransitionAccumulator,
  plan: AtomicWorldInteractionStepsPlan,
  branch: "success" | "failure",
  rolls: readonly number[] | undefined,
): AtomicExecutionResult {
  const ledger: Array<{
    proposalRef: string;
    outcomeBinding: AtomicWorldInteractionOutcomeBinding;
    status: "applied" | "skipped";
  }> = [];
  for (const step of plan.steps) {
    const applies = step.outcomeBinding === "always"
      || (step.outcomeBinding === "onSuccess" ? branch === "success" : branch === "failure");
    if (!applies) {
      ledger.push({
        proposalRef: step.proposalRef,
        outcomeBinding: step.outcomeBinding,
        status: "skipped",
      });
      continue;
    }
    let result: StepResult;
    if (step.rulesInput.kind === "resolveWorldInteraction"
      && step.rulesInput.plan.ruling.kind === "check") {
      if (rolls === undefined) {
        return { kind: "rejected", result: rejected("invalidRulesInput", "Atomic check rolls are unavailable.") };
      }
      const continuationId = `continuation:${step.rulesInput.plan.resolutionId}`;
      if (!(continuationId in accumulator.state.internalContinuations)) {
        const opened = resolveWorldInteraction(
          profiles,
          accumulator.state,
          step.rulesInput,
          { accumulator, skipDuplicateCheck: true },
        );
        if (opened.kind !== "awaitingRandomness") {
          return { kind: "rejected", result: opened };
        }
      }
      result = settleCheckedWorldInteraction(
        profiles,
        accumulator,
        continuationId,
        rolls,
        step.rulesInput.plan,
      );
    } else {
      result = applyAtomicStep(profiles, accumulator, step.rulesInput);
    }
    if (result.kind !== "committed") return { kind: "rejected", result };
    ledger.push({
      proposalRef: step.proposalRef,
      outcomeBinding: step.outcomeBinding,
      status: "applied",
    });
  }
  appendTransition(accumulator, profiles, plan.rootActionId, {
    eventType: "AtomicWorldInteractionStepsResolved",
    payload: {
      actorCharacterId: plan.actorCharacterId,
      branch,
      checkResolutionId: atomicWorldInteractionCheckPlan(plan)?.resolutionId ?? null,
      steps: ledger,
    },
    reads: [`entity:${plan.actorCharacterId}`],
    writes: [`receipt:${plan.rootActionId}`],
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  });
  return { kind: "accepted", accumulator, ledger };
}

function applyAtomicStep(
  profiles: RuntimeProfileManifest,
  accumulator: TransitionAccumulator,
  rulesInput: AtomicWorldInteractionRulesInput,
): StepResult {
  const options: AtomicStepOptions = { accumulator, skipDuplicateCheck: true };
  if (rulesInput.kind === "materializeSemanticDefinition") {
    return materializeSemanticDefinition(profiles, accumulator.state, rulesInput, options);
  }
  if (rulesInput.kind === "reviseSemanticDefinition") {
    return reviseSemanticDefinition(profiles, accumulator.state, rulesInput, options);
  }
  return resolveWorldInteraction(profiles, accumulator.state, rulesInput, options);
}

function requestAtomicWorldInteractionRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  plan: AtomicWorldInteractionStepsPlan,
  checkPlan: WorldInteractionResolutionPlan,
): StepResult {
  if (checkPlan.ruling.kind !== "check") {
    return rejected("invalidRulesInput", "The atomic randomness plan has no shared check.");
  }
  const request = randomnessRequestForWorldInteraction(checkPlan);
  const continuation: AuthorityContinuation = {
    kind: "roomAuthorityRandomness",
    continuationId: `continuation:${checkPlan.resolutionId}`,
    capability: canonicalSha256({
      kind: "roomAuthorityRandomness",
      roomId: state.roomId,
      runtimeEpochId: state.runtimeEpochId,
      stateHash: hashWorldState(state),
      rootActionId: plan.rootActionId,
      request,
      resolutionPlanHash: atomicWorldInteractionStepsPlanHash(plan),
    }),
  };
  if (continuation.continuationId in state.internalContinuations) {
    return rejected("invalidRulesInput", "The atomic world-interaction check already has a continuation.");
  }
  const accumulator = transactionAccumulator(state);
  appendTransition(accumulator, profiles, plan.rootActionId, {
    eventType: "RandomnessRequested",
    resolutionId: checkPlan.resolutionId,
    payload: {
      request,
      continuation,
      purpose: request.purpose,
      formula: request.diceExpression,
      resolutionPlan: plan,
    },
    reads: canonicalRefs(plan.steps.flatMap((step) =>
      step.rulesInput.plan.readSet.map(({ ref }) => ref)
        .filter((ref) => authorityRevisionOrHash(state, ref) !== null))),
    writes: [`continuation:${continuation.continuationId}`, `receipt:${plan.rootActionId}`],
    creates: [`continuation:${continuation.continuationId}`],
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  });
  return {
    kind: "awaitingRandomness",
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: accumulator.events.at(-1)!.stateHashAfter,
    scopeProof: transactionScopeProof(accumulator),
    receipt: accumulator.state.receipts[plan.rootActionId]!,
    randomnessRequest: request,
    continuation,
    mechanicalResult: {
      kind: "atomicWorldInteractionAwaitingRandomness",
      proposalCount: plan.steps.length,
    },
  };
}

function fulfillAtomicWorldInteractionRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  rolls: readonly number[],
  plan: AtomicWorldInteractionStepsPlan,
): StepResult {
  const checkPlan = atomicWorldInteractionCheckPlan(plan);
  const stored = state.internalContinuations[continuationId];
  if (checkPlan === undefined
    || checkPlan.ruling.kind !== "check"
    || stored === undefined
    || stored.rootActionId !== plan.rootActionId
    || continuationId !== `continuation:${checkPlan.resolutionId}`
    || stored.request.purpose !== "worldInteractionCheck"
    || stored.request.actorCharacterId !== checkPlan.actorCharacterId
    || stored.request.resolutionId !== checkPlan.resolutionId
    || stored.request.randomnessId !== checkPlan.ruling.randomnessId
    || canonicalSha256(stored.request.frozenCheck) !== canonicalSha256(checkPlan.ruling.check)) {
    return rejected("invalidWorldState", "The atomic continuation changed its frozen shared check.");
  }
  const outcome = worldInteractionRollOutcome(checkPlan, rolls);
  if (outcome === undefined) {
    return rejected("invalidRulesInput", "The atomic world-interaction roll does not match its frozen request.");
  }
  const preflight = executeAtomicWorldInteractionBranch(
    profiles,
    transactionAccumulator(state, true),
    plan,
    outcome.branch,
    rolls,
  );
  if (preflight.kind === "rejected") return preflight.result;
  const executed = executeAtomicWorldInteractionBranch(
    profiles,
    transactionAccumulator(state),
    plan,
    outcome.branch,
    rolls,
  );
  if (executed.kind === "rejected") return executed.result;
  return finalizeAtomicWorldInteractionExecution(plan, outcome.branch, executed);
}

function finalizeAtomicWorldInteractionExecution(
  plan: AtomicWorldInteractionStepsPlan,
  branch: "success" | "failure",
  executed: Extract<AtomicExecutionResult, { kind: "accepted" }>,
): StepResult {
  const { accumulator, ledger } = executed;
  const scopeProof = transactionScopeProof(accumulator);
  const storedReceipt = accumulator.state.receipts[plan.rootActionId]!;
  return {
    kind: "committed",
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: accumulator.events.at(-1)!.stateHashAfter,
    scopeProof,
    receipt: {
      receiptId: storedReceipt.receiptId,
      rootActionId: storedReceipt.rootActionId,
      status: storedReceipt.status,
      branchId: storedReceipt.branchId,
      eventRange: { ...storedReceipt.eventRange },
      rulesetVersion: storedReceipt.rulesetVersion,
      eventSchemaVersion: storedReceipt.eventSchemaVersion,
      scopeProofHash: scopeProof.proofHash,
    },
    mechanicalResult: {
      kind: "atomicWorldInteractionSteps",
      branch,
      steps: ledger,
    },
  };
}

function randomnessRequestForWorldInteraction(plan: WorldInteractionResolutionPlan): RandomnessRequest {
  if (plan.ruling.kind !== "check") {
    throw new TypeError("world interaction randomness requires a check ruling");
  }
  return {
    randomnessId: plan.ruling.randomnessId,
    resolutionId: plan.resolutionId,
    actorCharacterId: plan.actorCharacterId,
    purpose: "worldInteractionCheck",
    diceExpression: plan.ruling.check.mode === "normal"
      ? "1d20"
      : plan.ruling.check.mode === "advantage" ? "2d20kh1" : "2d20kl1",
    frozenCheck: structuredClone(plan.ruling.check),
  };
}

function worldInteractionRollOutcome(
  plan: WorldInteractionResolutionPlan,
  rolls: readonly number[],
): Readonly<{ branch: "success" | "failure"; selectedRoll: number }> | undefined {
  if (plan.ruling.kind !== "check") return undefined;
  const expected = plan.ruling.check.mode === "normal" ? 1 : 2;
  if (rolls.length !== expected
    || !rolls.every((roll) => Number.isSafeInteger(roll) && roll >= 1 && roll <= 20)) return undefined;
  const selectedRoll = plan.ruling.check.mode === "advantage"
    ? Math.max(...rolls)
    : plan.ruling.check.mode === "disadvantage" ? Math.min(...rolls) : rolls[0]!;
  const total = selectedRoll + Number(plan.ruling.check.modifier);
  const succeeded = plan.ruling.resolutionKind === "attack"
    ? selectedRoll === 20 || (selectedRoll !== 1 && total >= Number(plan.ruling.check.dc))
    : total >= Number(plan.ruling.check.dc);
  return { branch: succeeded ? "success" : "failure", selectedRoll };
}

function representativeRolls(
  plan: WorldInteractionResolutionPlan,
  branch: "success" | "failure",
): readonly number[] | undefined {
  if (plan.ruling.kind !== "check") return undefined;
  for (let face = 1; face <= 20; face += 1) {
    const rolls = plan.ruling.check.mode === "normal" ? [face] : [face, face];
    if (worldInteractionRollOutcome(plan, rolls)?.branch === branch) return rolls;
  }
  return undefined;
}

function isOutcomeBinding(value: unknown): value is AtomicWorldInteractionOutcomeBinding {
  return value === "always" || value === "onSuccess" || value === "onFailure";
}

function isAtomicReferences(value: unknown): value is readonly AtomicWorldInteractionReference[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  const identities = new Set<string>();
  return value.every((entry) => {
    if (!isRecord(entry)) return false;
    const identity = entry.kind === "existing"
      && hasExactKeys(entry, ["kind", "ref"])
      && isNonEmptyString(entry.ref)
      && !PROSPECTIVE_HANDLE_PATTERN.test(entry.ref)
      ? `existing:${entry.ref}`
      : entry.kind === "prospective"
        && hasExactKeys(entry, ["handle", "kind"])
        && typeof entry.handle === "string"
        && PROSPECTIVE_HANDLE_PATTERN.test(entry.handle)
        ? `prospective:${entry.handle}`
        : undefined;
    if (identity === undefined || identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

function isAtomicProducedReferences(
  value: unknown,
): value is readonly AtomicWorldInteractionProducedReference[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  const handles = new Set<string>();
  return value.every((entry) => {
    if (!isRecord(entry)
      || !hasExactKeys(entry, ["handle", "kind", "outcomeBinding"])
      || typeof entry.handle !== "string"
      || !PROSPECTIVE_HANDLE_PATTERN.test(entry.handle)
      || handles.has(entry.handle)
      || !["semanticDefinition", "canonicalFact", "relation", "itemEntry"].includes(String(entry.kind))
      || !isOutcomeBinding(entry.outcomeBinding)) return false;
    handles.add(entry.handle);
    return true;
  });
}

function atomicCompileRejected(message: string): Extract<AtomicCompileResult, { kind: "rejected" }> {
  return { kind: "rejected", result: rejected("invalidRulesInput", message) };
}

function validatePlanAgainstState(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  plan: WorldInteractionResolutionPlan,
): ReturnType<typeof rejected> | undefined {
  const actor = state.entities[actorCharacterId];
  if (plan.actorCharacterId !== actorCharacterId
    || actor?.tenureStatus !== "active"
    || actor.sceneId !== plan.sceneRef
    || state.scenes[plan.sceneRef] === undefined) {
    return rejected("privateOrUnknownReference", "The world interaction actor or scene is unavailable.");
  }
  if (!authorityReadSetMatches(state, plan.readSet)) {
    return rejected("causalFrontierConflict", "The world interaction read set changed after prepare.");
  }
  if (![...plan.targetRefs, ...plan.directTargetRefs, ...plan.instrumentRefs, ...plan.basisRefs]
    .every((ref) => authorityRefExists(state, ref))) {
    return rejected("privateOrUnknownReference", "The world interaction cites an unavailable authority ref.");
  }
  if (!plan.directTargetRefs.every((ref) =>
    authorityRefBoundToScene(state, ref, plan.sceneRef)
    && authoritySpatialRefVisibleTo(state, ref, plan.sceneRef, actorCharacterId))) {
    return rejected(
      "privateOrUnknownReference",
      "A direct world-interaction target is not bound to the actor's frozen scene.",
    );
  }
  if (plan.instrumentRefs.some((ref) => {
    const entry = state.campaignRuntime.itemSystem.entries[ref];
    return entry !== undefined
      && (entry.disposition !== "held" || entry.holderRef !== actorCharacterId
        || entry.condition !== "usable");
  })) {
    return rejected("missingPrerequisite", "The actor does not control a cited interaction instrument.");
  }
  if (plan.abilityRef === null) {
    if (plan.costs.length !== 0) {
      return rejected("invalidRulesInput", "An interaction without an Ability cannot freeze Ability costs.");
    }
    if (plan.ruling.kind === "check") {
      const check = plan.ruling.check;
      const ability = proficiencyAbility(check.ability);
      const modifier = ability === undefined
        ? undefined
        : skillCheckModifier(profiles, actor, ability, check.skill);
      const kindMatchesSkill = check.kind === "skill"
        ? check.skill !== null
        : check.kind === "ability" && check.skill === null;
      if (plan.ruling.resolutionKind !== "abilityCheck"
        || !kindMatchesSkill
        || modifier === undefined
        || Number(check.modifier) !== modifier
        || check.costs.length !== 0) {
        return rejected(
          "invalidRulesInput",
          "The frozen world-interaction check does not match character proficiency authority.",
        );
      }
    }
  } else {
    const resolved = abilityAuthorityForPlan(state, plan);
    if (resolved.kind === "rejected") return resolved;
    const authority = resolved.authority;
    if (canonicalSha256(plan.costs) !== canonicalSha256(authority.costs)) {
      return rejected("invalidRulesInput", "The frozen world-interaction costs do not match Ability authority.");
    }
    if (plan.ruling.kind === "check"
      && (plan.ruling.resolutionKind !== "attack"
        || plan.ruling.check.ability !== authority.checkAbility
        || Number(plan.ruling.check.modifier) !== authority.checkModifier
        || canonicalSha256(plan.ruling.check.costs)
          !== canonicalSha256(authority.costs.map(({ entryRef }) => entryRef)))) {
      return rejected(
        "invalidRulesInput",
        "The frozen world-interaction check does not match Ability authority.",
      );
    }
  }
  for (const cost of plan.costs) {
    if (costUnavailable(state, actorCharacterId, cost)) {
      return rejected("insufficientResource", "A frozen world interaction item cost is unavailable.");
    }
  }
  return undefined;
}

function proficiencyAbility(value: string): ProficiencyAbility | undefined {
  return value === "strength" ? "str"
    : value === "dexterity" ? "dex"
      : value === "constitution" ? "con"
        : value === "intelligence" ? "int"
          : value === "wisdom" ? "wis"
            : value === "charisma" ? "cha"
              : undefined;
}

function abilityAuthorityForPlan(
  state: AuthoritativeWorldState,
  plan: WorldInteractionResolutionPlan,
): Readonly<{ kind: "accepted"; authority: WorldInteractionAbilityAuthority }>
  | ReturnType<typeof rejected> {
  if (plan.abilityRef === null) {
    throw new TypeError("world interaction has no Ability authority");
  }
  const resolved = worldInteractionAbilityAuthority({
    state,
    actorCharacterId: plan.actorCharacterId,
    sceneRef: plan.sceneRef,
    abilityRef: plan.abilityRef,
    directTargetRefs: plan.directTargetRefs,
    checkMode: plan.ruling.kind === "check" ? plan.ruling.check.mode : "normal",
  });
  return resolved.kind === "accepted"
    ? Object.freeze({ kind: "accepted", authority: resolved.authority })
    : rejected(resolved.code, resolved.message);
}

function registeredHazardTargets(
  state: AuthoritativeWorldState,
  sceneRef: string,
  effect: WorldInteractionRegisteredHazardEffect,
): readonly Readonly<{ targetRef: string; relationRefs: readonly string[] }>[] | undefined {
  const profile = WORLD_DAMAGE_PROFILE_REGISTRY[effect.damageProfileRef];
  const source = state.campaignRuntime.definitions[effect.sourceDefinitionRef];
  const zone = state.campaignRuntime.definitions[effect.zoneRef];
  if (profile.targetResolver !== "active-contains-relation"
    || !isStoredSemanticDefinition(source)
    || !isStoredSemanticDefinition(zone)
    || !authorityRefBoundToScene(state, effect.sourceDefinitionRef, sceneRef)
    || !authorityRefBoundToScene(state, effect.zoneRef, sceneRef)) return undefined;

  const relationsByTarget = new Map<string, string[]>();
  for (const [definitionRef, definition] of Object.entries(
    state.campaignRuntime.definitions,
  ).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (!isStoredSemanticDefinition(definition)
      || definition.semanticKind !== "worldRelation"
      || !isRecord(definition.content)
      || definition.content.kind !== "contains"
      || definition.content.relationRef !== definitionRef
      || definition.content.subjectRef !== effect.zoneRef
      || definition.content.state !== "active"
      || !isNonEmptyString(definition.content.objectRef)) continue;
    const targetRef = definition.content.objectRef;
    const target = state.entities[targetRef];
    if (target?.tenureStatus !== "active"
      || target.sceneId !== sceneRef
      || target.hitPoints === undefined) continue;
    const relationRefs = relationsByTarget.get(targetRef) ?? [];
    relationRefs.push(definitionRef);
    relationsByTarget.set(targetRef, relationRefs);
  }
  return [...relationsByTarget.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([targetRef, relationRefs]) => Object.freeze({
      targetRef,
      relationRefs: Object.freeze([...relationRefs].sort()),
    }));
}

function validateBranchAgainstState(
  state: AuthoritativeWorldState,
  plan: WorldInteractionResolutionPlan,
  branch: WorldInteractionBranch,
): ReturnType<typeof rejected> | undefined {
  const revised = new Set<string>();
  const readRefs = new Set(plan.readSet.map(({ ref }) => ref));
  for (const effect of branch.effects) {
    if (effect.kind === "registeredHazard") {
      const resolved = registeredHazardTargets(state, plan.sceneRef, effect);
      if (resolved === undefined
        || !readRefs.has(effect.sourceDefinitionRef)
        || !readRefs.has(effect.zoneRef)
        || resolved.some(({ relationRefs, targetRef }) =>
          !readRefs.has(targetRef) || relationRefs.some((relationRef) => !readRefs.has(relationRef)))) {
        return rejected(
          "causalFrontierConflict",
          "The registered hazard is not bound to its authoritative source, zone, and targets.",
        );
      }
      continue;
    }
    const next = effect.nextDefinition;
    if (revised.has(next.definitionId)) {
      return rejected("invalidRulesInput", "One interaction branch cannot revise a definition twice.");
    }
    revised.add(next.definitionId);
    const current = state.campaignRuntime.definitions[next.definitionId];
    if (!isStoredSemanticDefinition(current)
      || !semanticTransitionValid(current, next, effect)) {
      return rejected("causalFrontierConflict", "A frozen semantic effect no longer matches its base.");
    }
    if (effect.kind === "definitionRevision") {
      if (current.semanticKind !== "sceneFeature"
        || !authorityRefBoundToScene(state, current.definitionId, plan.sceneRef)) {
        return rejected(
          "invalidRulesInput",
          "A world interaction can revise only an environment object in its frozen scene.",
        );
      }
      continue;
    }
    if (!authorityRefBoundToScene(state, effect.subjectRef, plan.sceneRef)
      || !authorityRefBoundToScene(state, effect.objectRef, plan.sceneRef)) {
      return rejected(
        "invalidRulesInput",
        "A world interaction relation must bind two spatial nodes in its frozen scene.",
      );
    }
  }
  for (const evidence of branch.sensoryEvidence) {
    const observer = state.entities[evidence.observerRef];
    if (observer?.tenureStatus !== "active"
      || observer.sceneId !== plan.sceneRef
      || (evidence.subjectRef !== null && !authorityRefExists(state, evidence.subjectRef))
      || evidence.basisRefs.some((ref) => !authorityRefExists(state, ref))) {
      return rejected("privateOrUnknownReference", "Frozen sensory evidence cites unavailable authority.");
    }
  }
  for (const pressure of branch.pressures) {
    if ((pressure.sourceRef !== null && !authorityRefExists(state, pressure.sourceRef))
      || pressure.basisRefs.some((ref) => !authorityRefExists(state, ref))) {
      return rejected("privateOrUnknownReference", "Frozen pressure cites unavailable authority.");
    }
  }
  for (const opportunity of branch.opportunities) {
    if ((opportunity.targetRef !== null && !authorityRefExists(state, opportunity.targetRef))
      || opportunity.basisRefs.some((ref) => !authorityRefExists(state, ref))) {
      return rejected("privateOrUnknownReference", "Frozen opportunity cites unavailable authority.");
    }
  }
  return undefined;
}

function semanticTransitionValid(
  current: StoredSemanticDefinition,
  next: StoredSemanticDefinition,
  effect: Exclude<WorldInteractionEffect, { kind: "registeredHazard" }>,
): boolean {
  if (current.definitionId !== next.definitionId
    || current.semanticKind !== next.semanticKind
    || current.visibilityPolicyRef !== next.visibilityPolicyRef
    || current.templateRef !== next.templateRef
    || current.templateHash !== next.templateHash
    || next.revision !== (BigInt(current.revision) + 1n).toString()
    || semanticDefinitionSnapshot(next) === undefined) return false;
  if (effect.kind === "relationTransition") {
    const before = current.content;
    const after = next.content;
    return current.semanticKind === "worldRelation"
      && hasExactKeys(before as JsonRecord, ["kind", "objectRef", "relationRef", "state", "subjectRef"])
      && hasExactKeys(after as JsonRecord, ["kind", "objectRef", "relationRef", "state", "subjectRef"])
      && before.relationRef === effect.relationRef
      && before.kind === effect.relationKind
      && before.subjectRef === effect.subjectRef
      && before.objectRef === effect.objectRef
      && before.state === effect.fromState
      && after.relationRef === before.relationRef
      && after.kind === before.kind
      && after.subjectRef === before.subjectRef
      && after.objectRef === before.objectRef
      && after.state === effect.toState;
  }
  return genericSemanticChangesAreSparse(current.content, next.content, current.semanticKind);
}

function genericSemanticChangesAreSparse(
  before: Readonly<JsonRecord>,
  after: Readonly<JsonRecord>,
  kind: StoredSemanticDefinition["semanticKind"],
): boolean {
  const allowed = kind === "npc"
    ? new Set(["semantics.attitude", "semantics.goals", "semantics.plans"])
    : new Set([
        "description", "observableState", "affordances",
        "semantics.description", "semantics.observableState", "semantics.affordances",
      ]);
  const changed = changedPaths(before, after);
  return changed.length >= 1
    && changed.length <= 16
    && changed.every((path) => [...allowed].some((prefix) => path === prefix
      || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`)));
}

function changedPaths(before: unknown, after: unknown, path = ""): string[] {
  if (canonicalSha256(before) === canonicalSha256(after)) return [];
  if (Array.isArray(before) || Array.isArray(after)
    || !isRecord(before) || !isRecord(after)) return [path];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .flatMap((key) => changedPaths(before[key], after[key], path === "" ? key : `${path}.${key}`));
}

function appendAbilityInvocation(
  accumulator: TransitionAccumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: WorldInteractionResolutionPlan,
): void {
  if (plan.abilityRef === null) return;
  const resolved = abilityAuthorityForPlan(accumulator.state, plan);
  if (resolved.kind === "rejected") {
    throw new TypeError("world interaction Ability authority changed after preflight");
  }
  const authority = resolved.authority;
  appendTransition(accumulator, profiles, rootActionId, {
    eventType: "AbilityInvoked",
    resolutionId: plan.resolutionId,
    payload: {
      sourceEntityId: plan.actorCharacterId,
      abilityRef: plan.abilityRef,
      sourcePatch: structuredClone(authority.sourcePatch),
      mechanicalResult: {
        kind: "worldInteractionAbility",
        interactionRef: plan.interactionRef,
        targetRefs: [...plan.directTargetRefs],
        tacticalFeatureRefs: [...authority.tacticalFeatureRefs],
        rangeBand: authority.rangeBand,
      },
    },
    reads: canonicalRefs([
      `entity:${plan.actorCharacterId}`,
      `scene:${plan.sceneRef}`,
      `definition:${plan.abilityRef}`,
      ...plan.directTargetRefs,
    ]),
    writes: [`entity:${plan.actorCharacterId}`, `receipt:${rootActionId}`],
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
  });
}

/**
 * The one item-cost transition path for the vNext world-interaction family.
 * Every consumer that must charge a frozen item cost -- an executed
 * interaction or a refused one whose attempt still spent something -- goes
 * through this, so there is exactly one place that ever mutates an item
 * entry for these costs.
 */
function applyItemCosts(
  accumulator: TransitionAccumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actorCharacterId: string,
  costs: readonly WorldInteractionCost[],
  purpose: string,
): AppliedWorldInteractionEffect[] | ReturnType<typeof rejected> {
  const applied: AppliedWorldInteractionEffect[] = [];
  for (const cost of costs) {
    if (costUnavailable(accumulator.state, actorCharacterId, cost)) {
      return rejected("insufficientResource", "A frozen world interaction item cost is unavailable.");
    }
    const entry = accumulator.state.campaignRuntime.itemSystem.entries[cost.entryRef]!;
    const quantityBefore = entry.quantity;
    const chargesBefore = entry.charges?.current ?? null;
    const durabilityBefore = entry.durability?.current ?? null;
    const quantityAfter = quantityBefore - cost.quantity;
    const chargesAfter = chargesBefore === null ? null : chargesBefore - cost.charges;
    const durabilityAfter = durabilityBefore === null ? null : durabilityBefore - cost.durability;
    appendTransition(accumulator, profiles, rootActionId, {
      eventType: "ItemUsed",
      payload: {
        characterId: actorCharacterId,
        entryId: cost.entryRef,
        purpose,
        quantityBefore,
        quantityAfter,
        chargesBefore,
        chargesAfter,
        durabilityBefore,
        durabilityAfter,
      },
      reads: [`entity:${actorCharacterId}`, `item-entry:${cost.entryRef}`],
      writes: [`item-entry:${cost.entryRef}`, `entity:${actorCharacterId}`, `receipt:${rootActionId}`],
      visibilityPolicyId: entry.visibilityPolicyRef,
      secrecy: "private",
    });
    applied.push({
      kind: "itemCost",
      entryRef: cost.entryRef,
      quantityBefore,
      quantityAfter,
      chargesBefore,
      chargesAfter,
      durabilityBefore,
      durabilityAfter,
    });
  }
  return applied;
}

function applyBranchEffects(
  accumulator: TransitionAccumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: WorldInteractionResolutionPlan,
  branch: WorldInteractionBranch,
): AppliedWorldInteractionEffect[] {
  const applied: AppliedWorldInteractionEffect[] = [];
  for (const effect of branch.effects) {
    if (effect.kind === "registeredHazard") {
      const profile = WORLD_DAMAGE_PROFILE_REGISTRY[effect.damageProfileRef];
      const targets = registeredHazardTargets(accumulator.state, plan.sceneRef, effect);
      if (targets === undefined) {
        throw new TypeError("registered world-interaction hazard changed after preflight");
      }
      for (const target of targets) {
        applied.push(applyDamageEffect(accumulator, profiles, rootActionId, {
          sourceDefinitionRef: effect.sourceDefinitionRef,
          zoneRef: effect.zoneRef,
          relationRefs: target.relationRefs,
          targetRef: target.targetRef,
          amount: profile.amount,
          damageType: profile.damageType,
        }));
      }
      continue;
    }
    const current = accumulator.state.campaignRuntime.definitions[effect.nextDefinition.definitionId];
    if (!isStoredSemanticDefinition(current)
      || !semanticTransitionValid(current, effect.nextDefinition, effect)) {
      throw new TypeError("world interaction semantic branch changed after preflight");
    }
    const payload: EventPayloadByType["SemanticDefinitionRevised"] = {
      actorCharacterId: plan.actorCharacterId,
      definitionRef: current.definitionId,
      semanticKind: current.semanticKind,
      baseRevision: current.revision,
      baseHash: current.definitionHash,
      templateRef: current.templateRef,
      templateHash: current.templateHash,
      contextHash: plan.contextHash,
      basisRefs: [...plan.basisRefs],
      summary: effect.summary,
      nextDefinition: structuredClone(effect.nextDefinition),
    };
    appendTransition(accumulator, profiles, rootActionId, {
      eventType: "SemanticDefinitionRevised",
      payload,
      reads: canonicalRefs([
        `definition:${current.definitionId}:${current.revision}`,
        `template:${current.templateRef}:${current.templateHash}`,
        ...plan.basisRefs,
      ]),
      writes: [`definition:${current.definitionId}:${effect.nextDefinition.revision}`,
        `receipt:${rootActionId}`],
      visibilityPolicyId: current.visibilityPolicyRef,
      secrecy: current.visibilityPolicyRef === "visibility:public" ? "public" : "private",
    });
    if (effect.kind === "relationTransition") {
      applied.push({
        kind: "relationTransition",
        relationRef: effect.relationRef,
        relationKind: effect.relationKind,
        subjectRef: effect.subjectRef,
        objectRef: effect.objectRef,
        fromState: effect.fromState,
        toState: effect.toState,
        definitionRef: current.definitionId,
        fromRevision: current.revision,
        toRevision: effect.nextDefinition.revision,
        summary: effect.summary,
        visibilityPolicyRef: current.visibilityPolicyRef,
        basisRefs: [...plan.basisRefs],
      });
    } else {
      applied.push({
        kind: "definitionRevision",
        definitionRef: current.definitionId,
        semanticKind: current.semanticKind,
        fromRevision: current.revision,
        toRevision: effect.nextDefinition.revision,
        summary: effect.summary,
        visibilityPolicyRef: current.visibilityPolicyRef,
        basisRefs: [...plan.basisRefs],
      });
    }
  }
  return applied;
}

type ResolvedWorldDamageEffect = Readonly<{
  sourceDefinitionRef: string;
  zoneRef: string;
  relationRefs: readonly string[];
  targetRef: string;
  amount: number;
  damageType: string;
}>;

function applyDamageEffect(
  accumulator: TransitionAccumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  effect: ResolvedWorldDamageEffect,
): Extract<AppliedWorldInteractionEffect, { kind: "damage" }> {
  const target = accumulator.state.entities[effect.targetRef];
  if (target?.hitPoints === undefined || !authorityRefExists(accumulator.state, effect.sourceDefinitionRef)) {
    throw new TypeError("world interaction damage target or source is unavailable");
  }
  const hpBefore = target.hitPoints.current;
  const hpAfter = Math.max(0, hpBefore - effect.amount);
  appendTransition(accumulator, profiles, rootActionId, {
    eventType: "DamagePacketResolved",
    payload: {
      targetId: effect.targetRef,
      amount: effect.amount,
      damageType: effect.damageType,
      sourceDefinitionId: effect.sourceDefinitionRef,
    },
    reads: canonicalRefs([
      `entity:${effect.targetRef}`,
      `definition:${effect.sourceDefinitionRef}`,
      `definition:${effect.zoneRef}`,
      ...effect.relationRefs.map((relationRef) => `definition:${relationRef}`),
    ]),
    writes: [`receipt:${rootActionId}`],
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  });
  appendTransition(accumulator, profiles, rootActionId, {
    eventType: "HitPointsChanged",
    payload: {
      characterId: effect.targetRef,
      before: hpBefore,
      after: hpAfter,
      maximum: target.hitPoints.maximum,
      causeId: effect.sourceDefinitionRef,
    },
    reads: [`entity:${effect.targetRef}`],
    writes: [`entity:${effect.targetRef}`, `receipt:${rootActionId}`],
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
  });
  const died = hpAfter === 0;
  if (died) {
    appendTransition(accumulator, profiles, rootActionId, {
      eventType: "CreatureDied",
      payload: { characterId: effect.targetRef, causeId: effect.sourceDefinitionRef },
      reads: [`entity:${effect.targetRef}`],
      writes: [`entity:${effect.targetRef}`, `receipt:${rootActionId}`],
      visibilityPolicyId: "visibility:scene-observers",
      secrecy: "public",
    });
  }
  return {
    kind: "damage",
    sourceDefinitionRef: effect.sourceDefinitionRef,
    targetRef: effect.targetRef,
    amount: effect.amount,
    damageType: effect.damageType,
    hpBefore,
    hpAfter,
    died,
  };
}

function finalizeInteraction(
  accumulator: TransitionAccumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: WorldInteractionResolutionPlan,
  branchName: "success" | "failure",
  branch: WorldInteractionBranch,
  check: EventPayloadByType["WorldInteractionResolved"]["check"],
  appliedEffects: AppliedWorldInteractionEffect[],
): StepResult {
  branch.sensoryEvidence.forEach((evidence, index) => {
    const factId = sensoryEvidenceFactId(rootActionId, plan.resolutionId, branchName, index);
    const causalParentIds = canonicalRefs(evidence.basisRefs.filter((ref) =>
      accumulator.state.canonicalFacts[ref] !== undefined));
    appendTransition(accumulator, profiles, rootActionId, {
      eventType: "CanonicalFactDeclared",
      resolutionId: plan.resolutionId,
      payload: {
        fact: {
          id: factId,
          kind: "worldInteractionSensoryEvidence",
          subjectRefs: canonicalRefs([
            plan.sceneRef,
            evidence.observerRef,
            ...(evidence.subjectRef === null ? [] : [evidence.subjectRef]),
          ]),
          value: {
            schema: "zhuwei.world-interaction-sensory-fact/v1",
            observerRef: evidence.observerRef,
            subjectRef: evidence.subjectRef,
            sense: evidence.sense,
            evidence: evidence.evidence,
          },
          visibilityPolicyId: "visibility:hidden-until-evidence",
          source: "observedEvent",
          causalParentIds,
        },
      },
      reads: canonicalRefs([
        `entity:${evidence.observerRef}`,
        `scene:${plan.sceneRef}`,
        ...evidence.basisRefs,
      ]),
      writes: [`fact:${factId}`, `receipt:${rootActionId}`],
      creates: [`fact:${factId}`],
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
    });
    appendTransition(accumulator, profiles, rootActionId, {
      eventType: "SensoryEvidenceAcquired",
      resolutionId: plan.resolutionId,
      payload: {
        characterId: evidence.observerRef,
        factId,
        sense: evidence.sense,
        clarity: "full",
        publicEvidence: evidence.evidence,
      },
      reads: [`entity:${evidence.observerRef}`, `fact:${factId}`],
      writes: [`knowledge:${evidence.observerRef}`, `receipt:${rootActionId}`],
      creates: [`knowledge:${evidence.observerRef}:${factId}`],
      visibilityPolicyId: evidence.visibilityPolicyRef,
      secrecy: evidence.visibilityPolicyRef === "visibility:scene-observers" ? "public" : "private",
    });
  });
  const payload: EventPayloadByType["WorldInteractionResolved"] = {
    interactionRef: plan.interactionRef,
    resolutionId: plan.resolutionId,
    actorCharacterId: plan.actorCharacterId,
    sceneRef: plan.sceneRef,
    abilityRef: plan.abilityRef,
    targetRefs: [...plan.targetRefs],
    directTargetRefs: [...plan.directTargetRefs],
    instrumentRefs: [...plan.instrumentRefs],
    basisRefs: [...plan.basisRefs],
    contextHash: plan.contextHash,
    planHash: worldInteractionPlanHash(plan),
    rulingKind: plan.ruling.kind,
    branch: branchName,
    outcomeCode: branch.outcomeCode,
    summary: branch.summary,
    check,
    appliedEffects: structuredClone(appliedEffects),
    sensoryEvidence: structuredClone(branch.sensoryEvidence),
    pressures: structuredClone(branch.pressures),
    opportunities: structuredClone(branch.opportunities),
  };
  appendTransition(accumulator, profiles, rootActionId, {
    eventType: "WorldInteractionResolved",
    resolutionId: plan.resolutionId,
    payload,
    reads: canonicalRefs([
      `entity:${plan.actorCharacterId}`,
      `scene:${plan.sceneRef}`,
      ...(plan.ruling.kind === "check" ? [`continuation:${plan.resolutionId}`] : []),
      ...plan.basisRefs,
    ]),
    writes: [`receipt:${rootActionId}`],
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  });
  const finalEvent = accumulator.events.at(-1)!;
  return {
    kind: "committed",
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: finalEvent.stateHashAfter,
    scopeProof: accumulator.scopeProof!,
    receipt: accumulator.state.receipts[rootActionId]!,
    mechanicalResult: {
      kind: "worldInteraction",
      interactionRef: plan.interactionRef,
      branch: branchName,
      outcomeCode: branch.outcomeCode,
      appliedEffects: structuredClone(appliedEffects),
    },
  };
}

function sensoryEvidenceFactId(
  rootActionId: string,
  resolutionId: string,
  branch: "success" | "failure",
  index: number,
): string {
  return `fact:world-interaction:${canonicalSha256({
    rootActionId,
    resolutionId,
    branch,
    index,
  }).slice("sha256:".length, "sha256:".length + 32)}`;
}

function transitionAccumulator(state: AuthoritativeWorldState): TransitionAccumulator {
  return { state, events: [] };
}

function transactionAccumulator(
  state: AuthoritativeWorldState,
  candidate = false,
): TransitionAccumulator {
  return {
    source: state,
    state,
    events: [],
    candidate,
    transactionReads: new Set(),
    transactionWrites: new Set(),
    transactionCreates: new Set(),
    transactionCreatedAuthorityRefs: new Set(),
  };
}

function transactionScopeProof(accumulator: TransitionAccumulator): ScopeProof {
  const source = accumulator.source ?? accumulator.state;
  const creates = accumulator.transactionCreates ?? new Set<string>();
  const createdAuthorityRefs = accumulator.transactionCreatedAuthorityRefs ?? new Set<string>();
  const existedBeforeTransaction = (ref: string): boolean =>
    !creates.has(ref) && !createdAuthorityRefs.has(ref);
  return createScopeProof(
    source,
    [...(accumulator.transactionReads ?? [])].filter(existedBeforeTransaction),
    [...(accumulator.transactionWrites ?? [])].filter(existedBeforeTransaction),
    [...creates],
  );
}

function appendTransition<T extends keyof EventPayloadByType>(
  accumulator: TransitionAccumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  draft: {
    eventType: T;
    payload: EventPayloadByType[T];
    resolutionId?: string;
    reads: string[];
    writes: string[];
    creates?: string[];
    visibilityPolicyId?: string;
    secrecy?: EventEnvelope["secrecy"];
  },
): void {
  draft.reads.forEach((ref) => accumulator.transactionReads?.add(ref));
  draft.writes.forEach((ref) => accumulator.transactionWrites?.add(ref));
  (draft.creates ?? []).forEach((ref) => accumulator.transactionCreates?.add(ref));
  const scopeProof = createScopeProof(
    accumulator.state,
    canonicalRefs(draft.reads),
    canonicalRefs(draft.writes),
    canonicalRefs(draft.creates ?? []),
  );
  const transition = (accumulator.candidate === true
    ? createCandidateEventTransition
    : createEventTransition)(accumulator.state, profiles, {
    rootActionId,
    ...(draft.resolutionId === undefined ? {} : { resolutionId: draft.resolutionId }),
    eventType: draft.eventType,
    payload: draft.payload,
    scopeProof,
    visibilityPolicyId: draft.visibilityPolicyId ?? "visibility:scene-observers",
    secrecy: draft.secrecy ?? "public",
  });
  accumulator.events.push(transition.event);
  accumulator.state = transition.state;
  accumulator.scopeProof = scopeProof;
}

function revisionPayload(
  actorCharacterId: string,
  plan: SemanticDefinitionRevisionPlan,
  nextDefinition: StoredSemanticDefinition,
): EventPayloadByType["SemanticDefinitionRevised"] {
  return {
    actorCharacterId,
    definitionRef: plan.definitionRef,
    semanticKind: plan.semanticKind,
    baseRevision: plan.baseRevision,
    baseHash: plan.baseHash,
    templateRef: plan.templateRef,
    templateHash: plan.templateHash,
    contextHash: plan.contextHash,
    basisRefs: [...plan.basisRefs],
    summary: plan.summary,
    nextDefinition,
  };
}

function costUnavailable(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  cost: WorldInteractionCost,
): boolean {
  const entry = state.campaignRuntime.itemSystem.entries[cost.entryRef];
  return entry === undefined
    || entry.disposition !== "held"
    || entry.holderRef !== actorCharacterId
    || entry.condition !== "usable"
    || entry.quantity < cost.quantity
    || (cost.charges > 0 && (entry.charges === null || entry.charges.current < cost.charges))
    || (cost.durability > 0
      && (entry.durability === null || entry.durability.current < cost.durability));
}

function authorityRefExists(state: AuthoritativeWorldState, ref: string): boolean {
  return state.campaignRuntime.definitions[ref] !== undefined
    || state.campaignRuntime.itemSystem.entries[ref] !== undefined
    || state.campaignRuntime.itemSystem.definitions[ref] !== undefined
    || state.combatRuntime.definitions[ref] !== undefined
    || state.entities[ref] !== undefined
    || state.scenes[ref] !== undefined
    || state.canonicalFacts[ref] !== undefined
    || Object.values(state.knowledge).some((entries) => entries[ref] !== undefined);
}

function npcMayUseBasis(state: AuthoritativeWorldState, npcRef: string, ref: string): boolean {
  if (ref === npcRef || state.entities[npcRef]?.semanticDefinitionRef === ref) return true;
  if (state.knowledge[npcRef]?.[ref] !== undefined) return true;
  const fact = state.canonicalFacts[ref];
  return fact !== undefined
    && (fact.visibilityPolicyId === "visibility:public"
      || fact.visibilityPolicyId === "visibility:scene-observers");
}

function npcEntityRef(definition: StoredSemanticDefinition): string | undefined {
  const links = isRecord(definition.content.links) ? definition.content.links : undefined;
  return isNonEmptyString(links?.entityRef) ? links.entityRef : undefined;
}

function canonicalRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)].sort();
}

export function isWorldInteractionContinuationStateBinding(
  state: AuthoritativeWorldState,
  continuationId: string,
): boolean {
  const stored = state.internalContinuations[continuationId];
  if (stored === undefined) return false;
  const atomicPlan = isAtomicWorldInteractionStepsPlan(stored.resolutionPlan)
    ? stored.resolutionPlan
    : undefined;
  const plan = isWorldInteractionResolutionPlan(stored.resolutionPlan)
    ? stored.resolutionPlan
    : atomicPlan !== undefined
      ? atomicWorldInteractionCheckPlan(atomicPlan)
      : undefined;
  if (plan === undefined) return false;
  return stored.rootActionId in state.receipts
    && (atomicPlan === undefined || atomicPlan.rootActionId === stored.rootActionId)
    && stored.request.purpose === "worldInteractionCheck"
    && stored.request.actorCharacterId === plan.actorCharacterId
    && stored.request.resolutionId === plan.resolutionId
    && continuationId === `continuation:${plan.resolutionId}`
    && stored.continuation.continuationId === continuationId
    && isSha256(stored.continuation.capability);
}
