import { isAbilityOperationPlan, stepAbilityOperation } from "./ability-operation";
import { npcActorPlanFormationIds, isNpcActorPlanFormationPlan, frozenNpcActorPlanFormationIssue, prepareFrozenNpcActorPlanFormation } from "./npc-plan-formation";
import { rebindFrozenSocialPrefix } from "./world-interaction-prefix";
import { dynamicMaterializationIssue, passageFactRef, locationSceneRef, passageTraversalMatches, dynamicPassageConform, passageActivityPayload } from "./dynamic-locations";
import { partyDepartureEvents } from "./multiplayer-actions";
import { isFrozenPlayerChoicePlan, isFrozenPlayerChoiceAnswerInput, frozenChoiceForRoot, frozenChoiceReadSet, frozenChoiceReadSetMatches,
  frozenChoicePublicOptions, selectedFrozenContinuation, type FrozenPlayerChoicePlan, type FrozenPlayerChoiceRecord,
  type FrozenPlayerChoiceRefusalCosts, isFrozenPlayerChoiceContinuationInput, type FrozenPlayerChoiceContinuationInput } from "./frozen-player-choice";
import { authoredWorldFactConform, worldFactConstraints, worldFactConstraintsRef, worldFactRef, worldFactPointer } from "./world-facts";
import { authoritativeNpcDecisionContext } from "./npc-decision-context";
import { extendSocialMaterializedContext, socialInteractionIssue, socialInteractionDrafts, socialDraftScope } from "./social-interaction";
import { heldKnowledgeRecord } from "./knowledge-records";
import { ATOMIC_ACCEPTED_COST_PURPOSE, worldInteractionItemCostPayload, worldInteractionResourceCostPayload } from "./world-interaction-costs";
import { characterInferencePayload, observationKnowledgeIssue } from "./character-inference";
import { publicExpressionConform } from "./public-expression";
import { worldInteractionConditionPermission, worldInteractionEffectiveCheck } from "./world-interaction-conditions";
import { authorityWorldInteractionTargetVisibleTo } from "./world-interaction-targets";
import { isNarrativeDetailPlan, narrativeDetailRef, narrativeSourceRefs, narrativeMaterializationIssue,
  narrativeBindingRef, unmaterializedNarrativeRefs, isNarrativeMaterializationRefs,
  narrativeDetailVisibleTo, narrativeMaterializedRef } from "./narrative-commitments";
import { canonicalFactVisibleToCharacter } from "./validation";
import { atomicNativeRandomness, atomicAuthorityBindingHash, atomicContinuationCanResume, type AtomicLedgerEntry, type AtomicNativeRandomness, type AtomicWorldContinuation, type WorldSettlementCursor } from "./atomic-world-input";
import { conditionFollowupDrafts } from "./condition-consequences";
import { planWorldEffect,planWorldEffectEnd,dueWorldEffectDrafts } from "./world-effects";
import { conditionDamageDefense,conditionActionPermission } from "./condition-mechanics";
import { isInventoryOperationPlan,stepInventoryOperation,createInventoryAdjudicationGrant } from "./inventory-operations";
import { stepCombatWorld, combatPendingAnswerOptions, openFrozenAttackReaction } from "./combat-actions";
import { authoredItemEntryRef,isAuthoredDefinitionMaterializationPlan,isAuthoredItemMaterializationPlan,materializedAuthoredDefinition,materializedAuthoredItem,validateAuthoredDefinitionSource,type AuthoredDefinitionMaterializationPlan,type AuthoredItemMaterializationPlan } from "./authored-materialization";
import { registeredAbilityRecord } from "../profiles/ability-compiler";
import { environmentHazardMechanics } from "./environment-hazards";
import { isItemDefinitionV1, itemUseBaseAbilityDefinition, compileItemEntryUseAbility, type ItemDefinitionV1 } from "./items";
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
  FrozenCheck,
  JsonRecord,
  RandomnessRequest,
  WorldInteractionRandomnessRequest,
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
import { resolveCreatureDamage } from "./damage";
import { hazardMechanics, hazardTarget, registeredHazardTargets, hazardDiceSpecs, hazardOccurrence, hazardDamageForTarget, hazardConcentrationDrafts } from "./world-interaction-hazards";
import { createWorldInteractionRandomness, worldInteractionFaces, worldInteractionDiceValid, type WorldInteractionDiceSpec } from "./world-interaction-randomness";
import {
  composeDefinition,
  createDefinitionSnapshot,
  isSemanticDefinitionMaterializationPlan,
  isStoredSemanticDefinition,
  materializedSemanticDefinition,
  semanticDefinitionMaterializedPayload,
  semanticDefinitionSnapshot,
  storedSemanticDefinition,
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
  atomicNarrativeMaterializerRefs,
  atomicStepNeedsNarrativeMaterialization,
  atomicWorldInteractionCheckPlan,
  atomicWorldInteractionStepsPlanHash,
  isAtomicWorldInteractionStepsPlan,
  isAtomicWorldInteractionExecutionCosts,
  isSemanticDefinitionRevisionPlan,
  isWorldInteractionFeasibilityRulingPlan,
  worldInteractionFeasibilityDependencyRefs,
  worldInteractionFeasibilityMechanicalRefs,
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
  type WorldInteractionAttemptCost,
  type WorldInteractionCost,
  type WorldInteractionEffect,
  type WorldInteractionFeasibilityRuledPayload,
  type WorldInteractionFeasibilityRulingPlan,
  type WorldInteractionRegisteredHazardEffect,
  type WorldInteractionResolutionPlan,
  worldInteractionPlanHash,
  worldInteractionFormId,
} from "./world-interaction-model";

const NPC_SEMANTIC_ALLOWLIST: readonly SemanticFieldPolicy[] = Object.freeze([
  Object.freeze({ kind: "value", path: Object.freeze(["semantics", "attitude"]) }),
  Object.freeze({ kind: "value", path: Object.freeze(["semantics", "publicExpression"]) }),
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
  worldCursor?: WorldSettlementCursor;
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
  if (input.kind === "formNpcActorPlan" && input.plan !== undefined) return rejected("invalidRulesInput", "actor-plan:formation-requires-the-atomic-authority-entry");
  if (input.kind === "answerPendingInput") {
    const stored = Object.values(state.atomicWorldInteractions ?? {}).find(entry =>
      entry.waiting.kind === "input" && entry.waiting.mirror.pendingInputId === input.pendingInputId);
    if (stored !== undefined && frozenChoiceForRoot(state, stored.rootActionId) !== undefined
      && !hasExactKeys(input, ["kind", "pendingInputId", "responseId", "answer"]))
      return rejected("invalidRulesInput", "A frozen native answer contains only its original input fields.");
    if (stored !== undefined) return frozenChoiceForRoot(state, stored.rootActionId) === undefined
      ? answerAtomicWorldInteractionInput(profiles, state, input, stored)
      : continueFrozenPlayerChoice(profiles, state, stored.rootActionId, {
        kind: "nativeAnswer", pendingInputId: input.pendingInputId, responseId: input.responseId, answer: input.answer,
      });
  }
  if (input.kind !== "reviseSemanticDefinition"
    && input.kind !== "openFrozenPlayerChoice"
    && input.kind !== "answerFrozenPlayerChoice"
    && input.kind !== "commitNarrativeDetail"
    && input.kind !== "resolveWorldInteraction"
    && input.kind !== "materializeSemanticDefinition"
    && input.kind !== "ruleWorldInteractionFeasibility"
    && input.kind !== "applyAtomicWorldInteractionSteps"
    && input.kind !== "inventoryOperation"
    && input.kind !== "materializeDefinition"
    && !(input.kind === "materializeItem" && isAuthoredItemMaterializationPlan(input.plan))) {
    return undefined;
  }
  if (!worldInteractionProfileEnabled(profiles.extensions)) {
    return rejected(
      "unsupportedOperation",
      "The pinned runtime does not enable vNext semantic revision or world interaction.",
    );
  }
  if(input.kind==="inventoryOperation")return stepInventoryOperation(profiles,state,input);
  if (input.kind === "openFrozenPlayerChoice") return openFrozenPlayerChoice(profiles, state, input);
  if (input.kind === "answerFrozenPlayerChoice") return answerFrozenPlayerChoice(profiles, state, input);
  if (input.kind === "commitNarrativeDetail") return commitNarrativeDetail(profiles, state, input);
  if(input.kind==="materializeDefinition"||input.kind==="materializeItem")return applyAuthoredMaterialization(profiles,state,input);
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
  const root = state.internalContinuations[continuationId]?.rootActionId;
  if (root !== undefined && frozenChoiceForRoot(state, root) !== undefined)
    return continueFrozenPlayerChoice(profiles, state, root, { kind: "randomness", continuationId, rolls: [...rolls] });
  return fulfillVNextWorldInteractionRandomnessInput(profiles, state, continuationId, rolls);
}

function fulfillVNextWorldInteractionRandomnessInput(
  profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, continuationId: string, rolls: readonly number[],
): StepResult | undefined {
  const stored = state.internalContinuations[continuationId];
  if (stored === undefined) return undefined;
  const atomic = Object.values(state.atomicWorldInteractions ?? {}).find(entry =>
    entry.waiting.kind === "randomness" && entry.waiting.continuationId === continuationId);
  if (atomic !== undefined) return fulfillAtomicInputRandomness(profiles, state, continuationId, rolls, atomic);
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
  profiles: RuntimeProfileManifest, accumulator: TransitionAccumulator,
  continuationId: string, rolls: readonly number[], plan: WorldInteractionResolutionPlan,
): StepResult {
  const stored = accumulator.state.internalContinuations[continuationId];
  if (stored !== undefined && accumulator.state.atomicWorldInteractions?.[stored.rootActionId] !== undefined)
    return rejected("privateOrUnknownReference", "The original world tape has already been consumed by its suspended candidate.");
  const effective = worldInteractionEffectiveCheck(accumulator.state,plan);
  if (effective.kind === "rejected") return effective;
  if (stored === undefined || stored.request.purpose !== "worldInteractionCheck"
    || stored.request.actorCharacterId !== plan.actorCharacterId
    || stored.request.resolutionId !== plan.resolutionId
    || canonicalSha256(stored.request.frozenCheck) !== canonicalSha256(effective.check)) {
    return rejected("invalidWorldState", "The world interaction continuation changed its frozen ruling.");
  }
  return executeSingleWorldInteraction(profiles, accumulator.state, stored.rootActionId, plan, stored.request, rolls);
}

function appendInteractionDice(
  profiles: RuntimeProfileManifest, accumulator: TransitionAccumulator, rootActionId: string,
  request: WorldInteractionRandomnessRequest, rolls: readonly number[], selectedRoll: number | null,
): void {
  appendTransition(accumulator, profiles, rootActionId, {
    eventType: "DiceRolled", resolutionId: request.resolutionId,
    payload: { randomnessId:request.randomnessId, resolutionId:request.resolutionId,
      formula:request.diceExpression, faces:[...rolls], selectedFace:selectedRoll,
      requestHash:request.requestHash, frozenParametersHash:canonicalSha256(request.frozenParameters) },
    reads:[`continuation:continuation:${request.resolutionId}`],writes:[`receipt:${rootActionId}`],
    visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal",
  });
}

function settleWorldInteraction(
  profiles: RuntimeProfileManifest, accumulator: TransitionAccumulator, rootActionId: string,
  plan: WorldInteractionResolutionPlan, request: WorldInteractionRandomnessRequest | null,
  rolls: readonly number[], frozenPlanHash: ReturnType<typeof worldInteractionPlanHash>,
): StepResult {
  if (accumulator.worldCursor === undefined) {
    const faces = request === null ? new Map<string,readonly number[]>() : worldInteractionFaces(request,rolls);
    if (faces === undefined) return rejected("invalidRulesInput", "World interaction faces do not match the frozen dice.");
    const validation = validatePlanAgainstState(profiles, accumulator.state, plan.actorCharacterId,plan,rootActionId);
    if(validation!==undefined)return validation;
    const effective = worldInteractionEffectiveCheck(accumulator.state,plan);
    if (effective.kind === "rejected") return effective;
    if (request !== null && canonicalSha256(request.frozenCheck) !== canonicalSha256(effective.check))
      return rejected("causalFrontierConflict", "The condition check differs from its frozen terms.");
    const count=effective.check===null?0:effective.check.mode==="normal"?1:2;
    const checkRolls=rolls.slice(0,count);
    const outcome=plan.ruling.kind === "check" ? worldInteractionRollOutcome(plan,checkRolls,effective.check!) : {branch:"success" as const,selectedRoll:null};
    if(outcome===undefined)return rejected("invalidRulesInput","The shared check faces are unavailable.");
    const branch=plan.branches[outcome.branch];
    const branchValidation=validateBranchAgainstState(accumulator.state,plan,branch);
    if(branchValidation!==undefined)return branchValidation;
    appendAbilityInvocation(accumulator,profiles,rootActionId,plan);
    const costs=applyItemCosts(accumulator,profiles,rootActionId,plan.actorCharacterId,plan.costs,plan.interactionRef);
    if(!Array.isArray(costs))return costs;
    accumulator.worldCursor = {
      branch:outcome.branch,effectIndex:0,targetIndex:0,targets:null,windowHandled:false,appliedEffects:costs,
      specs:request?.hazardRolls??hazardDiceSpecs(profiles,accumulator.state,plan,[outcome.branch]),
      faceEntries:[...faces].map(([key,values])=>[key,[...values]]),
      check:plan.ruling.kind==="check" ? {
        resolutionKind:plan.ruling.resolutionKind,randomnessId:plan.ruling.randomnessId,
        rolls:[...checkRolls],selectedRoll:outcome.selectedRoll!,
        total:outcome.selectedRoll!+Number(plan.ruling.check.modifier),dc:Number(plan.ruling.check.dc),succeeded:outcome.branch==="success",
      }:null,
    };
  }
  const cursor=accumulator.worldCursor;
  const pending=applyBranchEffects(accumulator,profiles,rootActionId,plan,plan.branches[cursor.branch],cursor);
  if (pending !== undefined) return pending;
  delete accumulator.worldCursor;
  return finalizeInteraction(accumulator,profiles,rootActionId,plan,cursor.branch,plan.branches[cursor.branch],cursor.check,cursor.appliedEffects,frozenPlanHash);
}

/** Diagnose only submitted content, before prospective refs resolve to private authority. */
function authoredSourceRejection(source: unknown, path: string): ReturnType<typeof rejected> | undefined {
  const validation = validateAuthoredDefinitionSource(source);
  if (validation.ok) return undefined;
  return rejected(validation.code, "The authored definition contains invalid or unsupported mechanics.", validation.diagnostics.map(diagnostic => ({
    code: validation.code, path: `${path}${diagnostic.path}`, message: diagnostic.reason,
    source: "SPEC 0013" as const, visibility: "public" as const,
  })));
}

function applyAuthoredMaterialization(profiles:RuntimeProfileManifest,state:AuthoritativeWorldState,input:JsonRecord,options?:AtomicStepOptions):StepResult {
  if (input.kind === "materializeDefinition" && isRecord(input.plan)) {
    const invalid = authoredSourceRejection(input.plan.source, "/plan");
    if (invalid !== undefined) return invalid;
  }
  if(!hasExactKeys(input,["kind","rootActionId","actorCharacterId","plan"])||!isNonEmptyString(input.rootActionId)||!isNonEmptyString(input.actorCharacterId)
    ||!(input.kind==="materializeDefinition"?isAuthoredDefinitionMaterializationPlan(input.plan):isAuthoredItemMaterializationPlan(input.plan)))return rejected("invalidRulesInput","Authored materialization input is not canonical.");
  const plan=input.plan as AuthoredDefinitionMaterializationPlan|AuthoredItemMaterializationPlan;
  const accumulator=options?.accumulator??transitionAccumulator(state);
  if(!options?.skipDuplicateCheck&&input.rootActionId in state.receipts)return rejected("duplicateRootAction","The materialization root already exists.");
  if(state.entities[input.actorCharacterId]?.tenureStatus!=="active"||!authorityReadSetMatches(state,plan.readSet))return rejected("causalFrontierConflict","The authoring actor or read set is unavailable.");
  if(![...plan.basisRefs,...plan.sourceRefs].every(ref=>authorityRefExists(state,ref)))return rejected("privateOrUnknownReference","A materialization basis or source is unavailable.");
  let materializedRef:string;
  let materializedKind:EventPayloadByType["AuthoredMaterializationResolved"]["kind"];
  if(input.kind==="materializeDefinition") {
    const materialized=materializedAuthoredDefinition(input.rootActionId,plan as AuthoredDefinitionMaterializationPlan);
    if(materialized===undefined)return rejected("invalidAbilityDefinition","The authored mechanics are not executable.");
    if(authorityRefExists(state,materialized.definitionRef))return rejected("invalidRulesInput","An authored identity already exists.");
    materializedRef=materialized.definitionRef;materializedKind=materialized.kind;
    const definition=materialized.definition;
    if(materialized.kind==="hazardDefinition") {
      if(environmentHazardMechanics(state.campaignRuntime.definitions,definition)===undefined)return rejected("privateOrUnknownReference","Hazard mechanics must be frozen before registration.");
      const content=(definition as JsonRecord).content as JsonRecord;
      const trigger=content.trigger as JsonRecord;
      if(!authorityRefExists(state,String(trigger.ref)))return rejected("privateOrUnknownReference","Hazard trigger authority is unavailable.");
    }
    if(materialized.kind==="itemDefinition") {
      if(!isItemDefinitionV1(definition))return rejected("invalidRulesInput","Item definition is not canonical.");
      const narrativeSources = narrativeSourceRefs(state, [...plan.basisRefs, ...plan.sourceRefs]);
      if (narrativeSources.some(ref => !plan.sourceRefs.includes(ref)
        || !plan.readSet.some(binding => binding.ref === ref))) {
        return rejected("causalFrontierConflict", "The item definition must retain its frozen narrative source.");
      }
      const narrativeIssue = narrativeMaterializationIssue(state, {
        sourceRefs: plan.sourceRefs, actorCharacterId: input.actorCharacterId,
        sceneRef: state.entities[input.actorCharacterId]!.sceneId,
        label: definition.content.label, description: definition.content.description,
        visibilityPolicyRef: plan.visibilityPolicyRef,
      });
      if (narrativeIssue !== undefined) return rejected("invalidRulesInput", narrativeIssue);
      if(definition.content.equippedAbilityRefs.some(ref=>state.combatRuntime.definitions[ref]===undefined)
        ||(definition.content.use!==null&&itemUseBaseAbilityDefinition(definition,state.combatRuntime.definitions)===undefined))return rejected("privateOrUnknownReference","Item mechanics must be registered before their definition.");
      appendTransition(accumulator,profiles,input.rootActionId,{eventType:"ItemDefinitionRegistered",payload:{definition},reads:[...plan.basisRefs,...plan.sourceRefs],writes:[`receipt:${input.rootActionId}`],creates:[`item-definition:${materialized.definitionRef}`],visibilityPolicyId:plan.visibilityPolicyRef,secrecy:"internal"});
    } else {
      appendTransition(accumulator,profiles,input.rootActionId,{eventType:"DefinitionRegistered",payload:materialized.artifact??{definition:definition as JsonRecord},reads:[...plan.basisRefs,...plan.sourceRefs],writes:[`receipt:${input.rootActionId}`],creates:[`definition:${materialized.definitionRef}`],visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"});
    }
    accumulator.transactionCreatedAuthorityRefs?.add(materialized.definitionRef);
  } else {
    const itemPlan=plan as AuthoredItemMaterializationPlan;
    const definition=state.campaignRuntime.itemSystem.definitions[itemPlan.definitionRef];
    if(definition===undefined||state.entities[input.actorCharacterId]?.sceneId!==itemPlan.sceneRef)return rejected("privateOrUnknownReference","Item definition or placement scene is unavailable.");
    const narrativeSources = narrativeSourceRefs(state, [...itemPlan.basisRefs, ...itemPlan.sourceRefs]);
    if (narrativeSources.some(ref => !itemPlan.sourceRefs.includes(ref)
      || !itemPlan.readSet.some(binding => binding.ref === ref))) {
      return rejected("causalFrontierConflict", "The narrative source must be frozen and bound before item materialization.");
    }
    const narrativeIssue = narrativeMaterializationIssue(state, {
      sourceRefs: itemPlan.sourceRefs, actorCharacterId: input.actorCharacterId,
      sceneRef: itemPlan.sceneRef, label: definition.content.label, description: definition.content.description,
      visibilityPolicyRef: itemPlan.visibilityPolicyRef,
    });
    if (narrativeIssue !== undefined) return rejected("invalidRulesInput", narrativeIssue);
    if (itemPlan.uniquenessBasisRef !== undefined && (state.canonicalFacts[itemPlan.uniquenessBasisRef] === undefined
      || !itemPlan.readSet.some(binding => binding.ref === itemPlan.uniquenessBasisRef)
      || state.vNextItemAuthority?.uniqueItems[itemPlan.uniquenessBasisRef] !== undefined)) {
      return rejected("invalidRulesInput", "The unique item source is unavailable or has already been materialized.");
    }
    const materialized=materializedAuthoredItem(input.rootActionId,itemPlan,definition);
    if(materialized===undefined||authorityRefExists(state,materialized.entryRef))return rejected("invalidRulesInput","Item quantity, placement, or identity is invalid.");
    materializedRef=materialized.entryRef;materializedKind="itemEntry";
    if(definition.content.use!==null) {
      const base=itemUseBaseAbilityDefinition(definition,state.combatRuntime.definitions);
      if(base===undefined)return rejected("privateOrUnknownReference","The item use mechanics are unavailable.");
      const ability=compileItemEntryUseAbility(definition,materialized.entryRef,base);
      appendTransition(accumulator,profiles,input.rootActionId,{eventType:"DefinitionRegistered",payload:ability,reads:[itemPlan.definitionRef],writes:[`receipt:${input.rootActionId}`],creates:[`definition:${ability.definition.definitionId}`],visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"});
      accumulator.transactionCreatedAuthorityRefs?.add(String(ability.definition.definitionId));
    }
    appendTransition(accumulator,profiles,input.rootActionId,{eventType:"ItemMaterialized",payload:{entry:materialized.entry},reads:[itemPlan.definitionRef,itemPlan.sceneRef],writes:[`receipt:${input.rootActionId}`],creates:[`item-entry:${materialized.entryRef}`],visibilityPolicyId:itemPlan.visibilityPolicyRef,secrecy:"internal"});
    for (const commitmentRef of narrativeSources) appendTransition(accumulator, profiles, input.rootActionId, {
      eventType: "NarrativeDetailMaterialized",
      payload: { actorCharacterId: input.actorCharacterId, commitmentRef, materializedRef: materialized.entryRef },
      reads: [commitmentRef, materialized.entryRef], writes: [`receipt:${input.rootActionId}`],
      creates: [`fact:narrative-binding:${commitmentRef}`], visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
    });
    if (itemPlan.uniquenessBasisRef !== undefined) appendTransition(accumulator,profiles,input.rootActionId,{
      eventType:"ItemUniquenessBound",payload:{basisRef:itemPlan.uniquenessBasisRef,entryRef:materialized.entryRef,definitionRef:itemPlan.definitionRef},
      reads:[itemPlan.uniquenessBasisRef,materialized.entryRef],writes:[`item-entry:${materialized.entryRef}`],
      visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"});
    accumulator.transactionCreatedAuthorityRefs?.add(materialized.entryRef);
  }
  appendTransition(accumulator,profiles,input.rootActionId,{eventType:"AuthoredMaterializationResolved",
    payload:{actorCharacterId:input.actorCharacterId,contextHash:plan.contextHash as `sha256:${string}`,kind:materializedKind,ref:materializedRef,summary:plan.summary},
    reads:[materializedRef],writes:[`receipt:${input.rootActionId}`],visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"});
  return {kind:"committed",events:accumulator.events,state:accumulator.state,cache:accumulator.state,stateHash:accumulator.events.at(-1)!.stateHashAfter,
    scopeProof:accumulator.scopeProof!,receipt:accumulator.state.receipts[input.rootActionId]!,mechanicalResult:{kind:input.kind,summary:plan.summary}};
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
  if (unmaterializedNarrativeRefs(accumulator.state, plan.basisRefs).length > 0) {
    return rejected("privateOrUnknownReference", "narrative:materialization-required-before-causal-use");
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
  const semantics = composed.snapshot.definition.semantics;
  if (isRecord(semantics) && semantics.publicExpression !== undefined && !publicExpressionConform(semantics.publicExpression)) {
    return rejected("invalidRulesInput", "NPC public expression must contain only voice and explicitly public attitude.");
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
function commitNarrativeDetail(
  profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord, options?: AtomicStepOptions,
): StepResult {
  if (!hasExactKeys(input, ["actorCharacterId", "kind", "plan", "rootActionId"])
    || !isNonEmptyString(input.rootActionId) || !isNonEmptyString(input.actorCharacterId)
    || !isNarrativeDetailPlan(input.plan)) return rejected("invalidRulesInput", "Narrative detail input is not canonical.");
  const accumulator = options?.accumulator ?? { state, events: [] } as TransitionAccumulator;
  if (!options?.skipDuplicateCheck && input.rootActionId in accumulator.state.receipts) return rejected("duplicateRootAction", "The narrative RootAction already has a Receipt.");
  const current = accumulator.state;
  const actor = current.entities[input.actorCharacterId];
  const plan = input.plan;
  if (actor?.tenureStatus !== "active" || actor.sceneId !== plan.sceneRef) return rejected("privateOrUnknownReference", "The narrative scene or actor is unavailable.");
  if (!authorityReadSetMatches(current, plan.readSet)) return rejected("causalFrontierConflict", "The narrative context changed after prepare.");
  const dependencies = [actor.id, plan.sceneRef, ...plan.basisRefs, ...plan.authorizationRefs];
  if (dependencies.some(ref => !plan.readSet.some(binding => binding.ref === ref) || !authorityRefExists(current, ref))
    || !plan.authorizationRefs.some(ref => ref.startsWith("profile-context:"))) return rejected("privateOrUnknownReference", "Narrative authority dependencies are not frozen.");
  const audienceCharacterIds = (plan.audience === "actorOnly" ? [actor.id] : Object.values(current.entities)
    .filter(character => character.tenureStatus === "active" && character.sceneId === actor.sceneId).map(character => character.id)).sort();
  const visibleBasis = (ref: string, viewerRef: string) => ref === plan.sceneRef
    || (current.canonicalFacts[ref] !== undefined
      ? canonicalFactVisibleToCharacter(current, current.canonicalFacts[ref], current.entities[viewerRef])
      : authoritySpatialRefVisibleTo(current, ref, plan.sceneRef, viewerRef));
  if (plan.basisRefs.some(ref => audienceCharacterIds.some(viewerRef => !visibleBasis(ref, viewerRef)))) {
    return rejected("privateOrUnknownReference", "Narrative detail cannot disclose an audience-inaccessible basis.");
  }
  const commitmentRef = narrativeDetailRef(input.rootActionId, plan.proposalRef);
  if (authorityRevisionOrHash(current, commitmentRef) !== null) return rejected("causalFrontierConflict", "The narrative detail identity already exists.");
  const payload: EventPayloadByType["NarrativeDetailCommitted"] = { actorCharacterId: actor.id, commitmentRef,
    proposalRef: plan.proposalRef, contextHash: plan.contextHash, detail: { schema: "zhuwei.narrative-detail/vnext-1",
      sceneRef: plan.sceneRef, label: plan.label, description: plan.description, audience: plan.audience,
      audienceCharacterIds, basisRefs: [...plan.basisRefs] } };
  appendTransition(accumulator, profiles, input.rootActionId, { eventType: "NarrativeDetailCommitted", payload,
    reads: canonicalRefs(dependencies), writes: [commitmentRef, `receipt:${input.rootActionId}`], creates: [commitmentRef],
    visibilityPolicyId: `visibility:narrative:${commitmentRef}`, secrecy: "private" });
  const finalEvent = accumulator.events.at(-1)!;
  return { kind: "committed", events: accumulator.events, state: accumulator.state, cache: accumulator.state,
    stateHash: finalEvent.stateHashAfter, scopeProof: accumulator.scopeProof!, receipt: accumulator.state.receipts[input.rootActionId]!,
    mechanicalResult: { kind: "narrativeDetailCommitment", commitmentRef } };
}

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
  const dynamicIssue = dynamicMaterializationIssue(accumulator.state, actor.id, plan.semanticKind,
    plan.content, plan.basisRefs, plan.readSet.map(binding => binding.ref));
  if (dynamicIssue !== undefined) return rejected("privateOrUnknownReference", dynamicIssue);
  if (plan.semanticKind === "worldFact") {
    const fact = plan.content.worldFact, frame = worldFactConstraints(accumulator.state, actor.sceneId);
    if (!authoredWorldFactConform(fact) || fact.consistency.judgment !== "compatible" || !frame || frame.missingParentRefs.length > 0
      || fact.subjectRefs.some(ref => !frame.subjectRefs.includes(ref) || accumulator.state.entities[ref]?.kind === "player")
      || !plan.readSet.some(read => read.ref === worldFactConstraintsRef(actor.sceneId) && read.revisionOrHash === canonicalSha256(frame))) {
      return rejected("privateOrUnknownReference", "world-fact:compatible-frozen-constraints-required");
    }
    for (const knowledge of fact.initialKnowledge) {
      const context = authoritativeNpcDecisionContext(accumulator.source ?? accumulator.state, profiles, knowledge.holderRef);
      const allowed = new Set([...(context?.records.map(r => r.ref) ?? []), ...(context?.knowledge.map(r => r.entryRef) ?? [])]);
      if (!context || !fact.subjectRefs.includes(knowledge.holderRef)
        || knowledge.acquisitionBasisRefs.some(ref => !allowed.has(ref))
        || [...plan.basisRefs, ...plan.sourceRefs].some(ref => ref !== actor.sceneId
          && !ref.startsWith("profile-context:") && !allowed.has(ref))
        || [...allowed].some(ref => !plan.readSet.some(read => read.ref === ref
          && read.revisionOrHash === authorityRevisionOrHash(accumulator.state, ref)))) {
        return rejected("privateOrUnknownReference", "world-fact:initial-knowledge-holder-basis-invalid");
      }
    }
  }
  const narrativeRefs = narrativeSourceRefs(accumulator.state, [...plan.basisRefs, ...plan.sourceRefs]);
  const narrativeIssue = narrativeMaterializationIssue(accumulator.state, { sourceRefs: narrativeRefs,
    actorCharacterId: input.actorCharacterId, sceneRef: String(plan.content.sceneRef), label: String(plan.content.label),
    description: String(plan.content.description), visibilityPolicyRef: plan.visibilityPolicyRef });
  if (narrativeIssue !== undefined || narrativeRefs.some(ref => !plan.sourceRefs.includes(ref)
    || !plan.readSet.some(binding => binding.ref === ref))) return rejected("invalidRulesInput", narrativeIssue ?? "narrative:source-binding-required");
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
    || (visibilityKind === "hiddenUntilEvidence" && plan.semanticKind !== "worldFact"
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
  const payload = semanticDefinitionMaterializedPayload(input.actorCharacterId, plan, materialized);
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
      `receipt:${input.rootActionId}`, ...(plan.semanticKind === "location" ? [`scene:${String(materialized.definition.content.sceneRef)}`] : [])],
    creates: [`definition:${materialized.definitionRef}:${materialized.definition.revision}`,
      ...(plan.semanticKind === "location" ? [`scene:${String(materialized.definition.content.sceneRef)}`] : [])],
    visibilityPolicyId: plan.visibilityPolicyRef,
    secrecy: plan.visibilityPolicyRef === "visibility:public" ? "public" : "private",
  });
  if (plan.semanticKind === "worldFact" && authoredWorldFactConform(plan.content.worldFact)) {
    const factId = worldFactRef(materialized.definitionRef), pointer = worldFactPointer(materialized.definition);
    accumulator.transactionCreatedAuthorityRefs?.add(factId);
    appendTransition(accumulator, profiles, input.rootActionId, {
      eventType: "CanonicalFactDeclared", payload: { fact: { id: factId, kind: "worldFact",
        subjectRefs: [...plan.content.worldFact.subjectRefs], value: pointer,
        visibilityPolicyId: plan.visibilityPolicyRef, source: "dynamicMaterialization",
        causalParentIds: plan.basisRefs.filter(ref => accumulator.state.canonicalFacts[ref] !== undefined) } },
      reads: [materialized.definitionRef], writes: [`fact:${factId}`, `receipt:${input.rootActionId}`], creates: [`fact:${factId}`],
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
    });
    for (const knowledge of plan.content.worldFact.initialKnowledge) {
      appendTransition(accumulator, profiles, input.rootActionId, {
        eventType: "KnowledgeAcquired", payload: { characterId: knowledge.holderRef, knowledgeRef: factId,
          causeFactId: factId, objectKind: "canonicalFact", layer: "full", content: pointer, visibility: "private",
          acquisition: { sense: "establishedExperience", sceneId: actor.sceneId, method: knowledge.acquisitionExplanation } },
        reads: [factId, ...knowledge.acquisitionBasisRefs],
        writes: [`knowledge:${knowledge.holderRef}:${factId}`, `receipt:${input.rootActionId}`],
        creates: [`knowledge:${knowledge.holderRef}:${factId}`],
        visibilityPolicyId: `visibility:knowledge-holder:${knowledge.holderRef}`, secrecy: "private",
      });
    }
  }
  if (plan.semanticKind === "passage" && dynamicPassageConform(plan.content.passage)) {
    const factId = passageFactRef(materialized.definitionRef);
    accumulator.transactionCreatedAuthorityRefs?.add(factId);
    appendTransition(accumulator, profiles, input.rootActionId, {
      eventType: "CanonicalFactDeclared", payload: { fact: { id: factId, kind: "passageExistence",
        subjectRefs: canonicalRefs([materialized.definitionRef,
          locationSceneRef(accumulator.state, plan.content.passage.fromLocationRef)!,
          locationSceneRef(accumulator.state, plan.content.passage.toLocationRef)!]),
        value: { passageRef: materialized.definitionRef }, visibilityPolicyId: "visibility:room-authority-only",
        source: "dynamicMaterialization", causalParentIds: plan.basisRefs.filter(ref => accumulator.state.canonicalFacts[ref] !== undefined) } },
      reads: [materialized.definitionRef], writes: [`fact:${factId}`, `receipt:${input.rootActionId}`], creates: [`fact:${factId}`],
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
    });
  }
  for (const commitmentRef of narrativeRefs) {
    const bindingRef = narrativeBindingRef(commitmentRef);
    appendTransition(accumulator, profiles, input.rootActionId, { eventType: "NarrativeDetailMaterialized",
      payload: { actorCharacterId: input.actorCharacterId, commitmentRef, materializedRef: materialized.definitionRef },
      reads: [commitmentRef, materialized.definitionRef], writes: [bindingRef, `receipt:${input.rootActionId}`], creates: [bindingRef],
      visibilityPolicyId: `visibility:narrative:${commitmentRef}`, secrecy: "private" });
  }
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
  const validation = validatePlanAgainstState(profiles, accumulator.state, input.actorCharacterId, plan, input.rootActionId);
  if (validation !== undefined) return validation;
  const successValidation = validateBranchAgainstState(accumulator.state, plan, plan.branches.success);
  if (successValidation !== undefined) return successValidation;
  const failureValidation = validateBranchAgainstState(accumulator.state, plan, plan.branches.failure);
  if (failureValidation !== undefined) return failureValidation;

  const request = randomnessRequestForWorldInteraction(profiles, accumulator.state, plan);
  if (request.dice.length === 0) {
    return executeSingleWorldInteraction(profiles,accumulator.state,input.rootActionId,plan,null,[]);
  }
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
 * ordinary attempt-cost transition path. `plan.basisRefs` is authority-only: it
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
  if (!authorityReadSetMatches(accumulator.state, plan.readSet)) {
    return rejected("causalFrontierConflict", "The feasibility ruling read set changed after prepare.");
  }
  const readRefs = new Set(plan.readSet.map(binding => binding.ref));
  const mechanicalRefs = new Set(worldInteractionFeasibilityMechanicalRefs(input.actorCharacterId, plan.costs));
  if (worldInteractionFeasibilityDependencyRefs(input.actorCharacterId, plan).some(ref =>
    !readRefs.has(ref) && (mechanicalRefs.has(ref)
      || (!readRefs.has(`knowledge:${input.actorCharacterId}:${ref}`)
        && !readRefs.has(`npc-knowledge:${input.actorCharacterId}:${ref}`))))) {
    return rejected("causalFrontierConflict", "The feasibility ruling is missing a frozen authority dependency.");
  }
  if (unmaterializedNarrativeRefs(accumulator.state, plan.basisRefs).length > 0) {
    return rejected("privateOrUnknownReference", "narrative:materialization-required-before-causal-use");
  }

  const permission = conditionActionPermission(accumulator.state, input.actorCharacterId, {kind:"action"});
  if (!permission.allowed) return rejected("missingPrerequisite", `The actor cannot attempt this interaction: ${[...permission.reasons,...permission.requiredContext].join(", ")}.`);
  const costEffects = applyAttemptCosts(
    accumulator,
    profiles,
    input.rootActionId,
    input.actorCharacterId,
    plan.costs,
    `worldInteractionFeasibility:${plan.rulingKind}`,
  );
  if (!Array.isArray(costEffects)) return costEffects;
  const appliedCosts = costEffects.filter(
    (effect): effect is Extract<
      AppliedWorldInteractionEffect,
      { kind: "itemCost" | "fictionTimeCost" | "resourceCost" }
    > =>
      effect.kind === "itemCost"
      || effect.kind === "fictionTimeCost"
      || effect.kind === "resourceCost",
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

function frozenChoiceAtomicInput(plan: AtomicWorldInteractionStepsPlan): JsonRecord {
  const { schema: _schema, ...input } = plan;
  return { kind: "applyAtomicWorldInteractionSteps", ...structuredClone(input) } as unknown as JsonRecord;
}

/** Both live opening and event replay use the original compiler/preflight.
 * No choice may conceal an illegal branch until after the player answers. */
export function frozenPlayerChoiceIssue(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  plan: FrozenPlayerChoicePlan, refusalCosts?: FrozenPlayerChoiceRefusalCosts): StepResult | undefined {
  if (plan.profilesHash !== canonicalSha256(profiles) || state.entities[plan.actorCharacterId]?.tenureStatus !== "active")
    return rejected("causalFrontierConflict", "The frozen choice actor or runtime profile is unavailable.");
  if (!authorityReadSetMatches(state, plan.readSet))
    return rejected("causalFrontierConflict", "The frozen choice basis changed before preparation.");
  for (const choice of plan.choices) {
    const next = choice.continuation;
    if (next.kind === "cancel") continue;
    if (next.kind === "inWorldRefusal") {
      const result = ruleWorldInteractionFeasibility(profiles, state, {
        kind: "ruleWorldInteractionFeasibility", rootActionId: plan.rootActionId, actorCharacterId: plan.actorCharacterId,
        plan: next.plan as unknown as JsonRecord,
      }, { accumulator: transactionAccumulator(state, true), skipDuplicateCheck: true });
      if (result.kind === "rejected") return result;
      if (refusalCosts !== undefined) {
        if (result.kind !== "committed") return rejected("invalidRulesInput", "The refusal did not complete its cost preflight.");
        const settled = result.events.findLast(event => event.eventType === "WorldInteractionFeasibilityRuled");
        if (settled === undefined) return rejected("invalidRulesInput", "The refusal did not produce its cost evidence.");
        refusalCosts[choice.choiceId] = structuredClone((settled.payload as EventPayloadByType["WorldInteractionFeasibilityRuled"]).appliedCosts);
      }
      continue;
    }
    const issue = preflightAtomicWorldInteractionPlan(profiles, state, next.plan);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function openFrozenPlayerChoice(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["kind", "rootActionId", "actorCharacterId", "plan"]) || !isFrozenPlayerChoicePlan(input.plan)
    || input.plan.rootActionId !== input.rootActionId || input.plan.actorCharacterId !== input.actorCharacterId)
    return rejected("invalidRulesInput", "The frozen player choice input is not canonical.");
  if (input.plan.pendingInputId in state.pendingInputs || input.plan.rootActionId in state.receipts
    || frozenChoiceForRoot(state, input.plan.rootActionId) !== undefined)
    return rejected("duplicateRootAction", "The frozen player choice already exists.");
  const choices: FrozenPlayerChoicePlan["choices"][number][] = [];
  for (const choice of input.plan.choices) {
    if (choice.continuation.kind !== "adjudication") { choices.push(choice); continue; }
    const compiled = compileAtomicWorldInteractionPlan(frozenChoiceAtomicInput(choice.continuation.plan), state, profiles);
    if (compiled.kind === "rejected") return compiled.result;
    choices.push({ ...choice, continuation: { kind: "adjudication", plan: compiled.plan } });
  }
  const plan: FrozenPlayerChoicePlan = { ...input.plan, choices };
  const refusalCosts: FrozenPlayerChoiceRefusalCosts = {};
  const issue = frozenPlayerChoiceIssue(profiles, state, plan, refusalCosts);
  if (issue !== undefined) return issue;
  const record: FrozenPlayerChoiceRecord = { plan, readSet: frozenChoiceReadSet(state, plan), selectedChoiceId: null, refusalCosts, inFlightInput: null };
  const accumulator = transactionAccumulator(state);
  appendTransition(accumulator, profiles, plan.rootActionId, {
    eventType: "FrozenPlayerChoicePrepared", payload: { record },
    reads: record.readSet.map(binding => binding.ref), writes: [`receipt:${plan.rootActionId}`],
    creates: [`frozen-choice:${plan.pendingInputId}`], visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
  }, false);
  const publicChoices = frozenChoicePublicOptions(plan);
  appendTransition(accumulator, profiles, plan.rootActionId, {
    eventType: "PlayerChoiceRequested", payload: { actorCharacterId: plan.actorCharacterId,
      pendingInputId: plan.pendingInputId, question: plan.question, choices: publicChoices },
    reads: [`entity:${plan.actorCharacterId}`], writes: [`pending:${plan.pendingInputId}`, `receipt:${plan.rootActionId}`],
    creates: [`pending:${plan.pendingInputId}`], visibilityPolicyId: `visibility:character-controller:${plan.actorCharacterId}`, secrecy: "private",
  }, false);
  return { kind: "awaitingInput", events: accumulator.events, state: accumulator.state, cache: accumulator.state,
    stateHash: accumulator.events.at(-1)!.stateHashAfter, scopeProof: transactionScopeProof(accumulator),
    receipt: accumulator.state.receipts[plan.rootActionId],
    pending: { kind: "playerChoice", pendingInputId: plan.pendingInputId, question: plan.question, choices: publicChoices } };
}

function answerFrozenPlayerChoice(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!isFrozenPlayerChoiceAnswerInput(input))
    return rejected("invalidRulesInput", "A frozen choice answer contains only the original choice identity.");
  const pendingId = String(input.pendingInputId), record = state.frozenPlayerChoices?.[pendingId];
  const pending = state.pendingInputs[pendingId];
  if (record === undefined || record.selectedChoiceId !== null || pending?.kind !== "playerChoice"
    || pending.controllerCharacterId !== input.controllerCharacterId || pending.rootActionId !== input.rootActionId
    || record.plan.actorCharacterId !== input.controllerCharacterId || record.plan.rootActionId !== input.rootActionId
    || state.receipts[pending.rootActionId]?.status !== "awaitingInput")
    return rejected("privateOrUnknownReference", "The frozen choice is unavailable to this controller.");
  const choice = record.plan.choices.find(choice => choice.choiceId === input.choiceId);
  if (choice === undefined) return rejected("invalidRulesInput", "The choice is not one of the frozen options.");
  if (record.plan.profilesHash !== canonicalSha256(profiles)
    || (choice.continuation.kind !== "cancel" && !frozenChoiceReadSetMatches(state, record)))
    return rejected("causalFrontierConflict", "The frozen choice dependencies changed before the answer.");
  const accumulator = transactionAccumulator(state);
  appendTransition(accumulator, profiles, pending.rootActionId, {
    eventType: "PendingInputAnswered", payload: { actorCharacterId: pending.controllerCharacterId,
      pendingInputId: pendingId, openedByEventId: pending.openedByEventId, answer: { choiceId: String(input.choiceId) } },
    reads: [...(choice.continuation.kind === "cancel" ? [] : record.readSet.map(binding => binding.ref)),
      `entity:${pending.controllerCharacterId}`, `pending:${pendingId}`, `receipt:${pending.rootActionId}`],
    writes: [`pending:${pendingId}`, `frozen-choice:${pendingId}`, `receipt:${pending.rootActionId}`],
    visibilityPolicyId: `visibility:character-controller:${pending.controllerCharacterId}`, secrecy: "private",
  }, false);
  const next = choice.continuation;
  if (next.kind === "cancel") return { kind: "committed", events: accumulator.events, state: accumulator.state, cache: accumulator.state,
    stateHash: accumulator.events.at(-1)!.stateHashAfter, scopeProof: transactionScopeProof(accumulator),
    receipt: accumulator.state.receipts[pending.rootActionId], mechanicalResult: { kind: "frozenPlayerChoiceCancelled" } };
  const result = next.kind === "adjudication"
    ? applyCompiledAtomicWorldInteractionPlan(profiles, accumulator.state, next.plan)
    : ruleWorldInteractionFeasibility(profiles, accumulator.state, { kind: "ruleWorldInteractionFeasibility",
      rootActionId: pending.rootActionId, actorCharacterId: pending.controllerCharacterId, plan: next.plan as unknown as JsonRecord }, { skipDuplicateCheck: true });
  if (result.kind !== "committed" && result.kind !== "awaitingInput" && result.kind !== "awaitingRandomness") return result;
  const before = transactionScopeProof(accumulator), after = result.scopeProof;
  return { ...result, events: [...accumulator.events, ...result.events], scopeProof: createScopeProof(state,
    [...before.reads, ...after.reads], [...before.writes, ...after.writes], [...before.creates, ...after.creates]) };
}

/** Records an already authorized continuation input before running the same
 * native executor. A cursor ending at the marker cannot submit another input.
 * Room commits the returned marker and suffix as one atomic event range. */
export function continueFrozenPlayerChoice(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  rootActionId: string, value: unknown): StepResult {
  const record = frozenChoiceForRoot(state, rootActionId);
  if (record === undefined || selectedFrozenContinuation(record)?.kind !== "adjudication"
    || record.inFlightInput !== null || !isFrozenPlayerChoiceContinuationInput(value))
    return rejected("invalidRulesInput", "The frozen continuation input is unavailable or already recorded.");
  if (record.plan.profilesHash !== canonicalSha256(profiles) || !frozenChoiceReadSetMatches(state, record))
    return rejected("causalFrontierConflict", "The frozen choice dependencies changed before continuation.");
  const input: FrozenPlayerChoiceContinuationInput = value;
  const atomic = state.atomicWorldInteractions?.[rootActionId];
  if (atomic !== undefined && !atomicContinuationCanResume(profiles, state, atomic))
    return rejected("causalFrontierConflict", "The authority changed before the frozen continuation input.");
  const accumulator = transactionAccumulator(state);
  appendTransition(accumulator, profiles, rootActionId, {
    eventType: "FrozenPlayerChoiceInputRecorded", payload: { input },
    reads: record.readSet.map(binding => binding.ref), writes: [`frozen-choice:${record.plan.pendingInputId}`],
    visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
  }, false);
  const next = accumulator.state;
  const result = input.kind === "randomness"
    ? fulfillVNextWorldInteractionRandomnessInput(profiles, next, input.continuationId, input.rolls)
    : next.atomicWorldInteractions?.[rootActionId] === undefined ? undefined
      : answerAtomicWorldInteractionInput(profiles, next, { kind: "answerPendingInput", pendingInputId: input.pendingInputId,
        responseId: input.responseId, answer: input.answer }, next.atomicWorldInteractions[rootActionId]);
  if (result === undefined) return rejected("invalidRulesInput", "The frozen continuation has no executable input.");
  if (result.kind !== "committed" && result.kind !== "awaitingInput" && result.kind !== "awaitingRandomness") return result;
  const before = transactionScopeProof(accumulator), after = result.scopeProof;
  return { ...result, events: [...accumulator.events, ...result.events], scopeProof: createScopeProof(state,
    [...before.reads, ...after.reads], [...before.writes, ...after.writes], [...before.creates, ...after.creates]) };
}

const PROSPECTIVE_HANDLE_PATTERN = /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MATERIALIZATION_FORM_ID = "materialization.vnext-1";
const WORLD_INTERACTION_FORM_ID = "world-interaction.vnext-1";

type ProspectiveBinding = Readonly<{
  definitionRef: string;
  revisionOrHash: string | null;
  producerProposalRef: string;
  outcomeBinding: AtomicWorldInteractionOutcomeBinding;
}>;

type AtomicCompileResult = Readonly<
  | { kind: "accepted"; plan: AtomicWorldInteractionStepsPlan }
  | { kind: "rejected"; result: ReturnType<typeof rejected> }
>;

type AtomicTape = { request: WorldInteractionRandomnessRequest; rolls: number[] };
type AtomicPaused = {
  kind: "paused";
  accumulator: TransitionAccumulator;
  ledger: AtomicLedgerEntry[];
  stepIndex: number;
  phase: number;
  waiting: Extract<StepResult, { kind: "awaitingInput" | "awaitingRandomness" }>;
};
type AtomicExecutionResult =
  | { kind: "accepted"; accumulator: TransitionAccumulator; ledger: AtomicLedgerEntry[] }
  | AtomicPaused
  | { kind: "rejected"; result: StepResult };

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
  const compiled = compileAtomicWorldInteractionPlan(input,state,profiles);
  if (compiled.kind === "rejected") return compiled.result;
  return applyCompiledAtomicWorldInteractionPlan(profiles, state, compiled.plan);
}

/** A private continuation has already passed its pending/controller/read-set
 * checks. It executes the saved compiled plan without reinterpreting handles
 * or bypassing duplicate guards on any public Rules input. */
function applyCompiledAtomicWorldInteractionPlan(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  plan: AtomicWorldInteractionStepsPlan): StepResult {
  if (Object.keys(state.atomicWorldInteractions ?? {}).length > 0)
    return rejected("causalFrontierConflict", "A suspended atomic action must settle before another Bundle starts.");
  if ((plan.narrativeMaterializationRefs ?? []).some(ref => !narrativeDetailVisibleTo(state, ref, plan.actorCharacterId)
    || narrativeMaterializedRef(state, ref) !== undefined)) {
    return rejected("causalFrontierConflict", "narrative:materialization-obligation-state-changed");
  }
  const actor = state.entities[plan.actorCharacterId];
  if (actor?.tenureStatus !== "active") {
    return rejected("privateOrUnknownReference", "The atomic world-interaction actor is unavailable.");
  }
  const specs = new Map<string,WorldInteractionDiceSpec>();
  const checkBinding: { check?: FrozenCheck | null } = {};
  const preflight = preflightAtomicWorldInteractionPlan(profiles, state, plan, specs, checkBinding);
  if (preflight !== undefined) return preflight;
  const checkPlan = atomicWorldInteractionCheckPlan(plan);
  const anchorPlan = checkPlan ?? plan.steps.find(step => step.rulesInput.kind === "resolveWorldInteraction")?.rulesInput.plan as WorldInteractionResolutionPlan | undefined;
  if (checkPlan !== undefined || specs.size > 0) {
    return requestAtomicWorldInteractionRandomness(profiles, state, plan, anchorPlan,[...specs.values()],checkBinding.check);
  }
  const executed = executeAtomicWorldInteractionBranch(
    profiles,
    transactionAccumulator(state, true),
    plan,
    "success",
    undefined,
  );
  if (executed.kind === "rejected") return executed.result;
  return finishAtomicExecution(profiles, state, plan, "success", executed, []);
}

function compileAtomicWorldInteractionPlan(input: JsonRecord,state?:AuthoritativeWorldState,profiles?:RuntimeProfileManifest): AtomicCompileResult {
  if (!hasExactKeys(input, [
    "actorCharacterId", "bundleHash", "contextHash", "kind", "rootActionId", "sharedRuling", "steps",
    ...(Object.hasOwn(input, "narrativeMaterializationRefs") ? ["narrativeMaterializationRefs"] : []),
    ...(Object.hasOwn(input, "executionCosts") ? ["executionCosts"] : []),
  ])
    || input.kind !== "applyAtomicWorldInteractionSteps"
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId)
    || !isSha256(input.bundleHash)
    || !isSha256(input.contextHash)
    || (Object.hasOwn(input, "narrativeMaterializationRefs") && !isNarrativeMaterializationRefs(input.narrativeMaterializationRefs))
    || (Object.hasOwn(input, "executionCosts") && !isAtomicWorldInteractionExecutionCosts(input.executionCosts))
    || (input.sharedRuling !== "directSuccess" && input.sharedRuling !== "check")
    || !Array.isArray(input.steps)
    || input.steps.length < 1
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
  const narrativeDependencies = atomicNarrativeMaterializerRefs(input.steps, (input.narrativeMaterializationRefs ?? []) as readonly string[]);
  if (narrativeDependencies === undefined) {
    return atomicCompileRejected("narrative:every-required-commitment-needs-one-unconditional-materializer");
  }

  const seenProposalRefs = new Set<string>();
  const bindings = new Map<string, ProspectiveBinding>();
  const normalizedSteps: AtomicWorldInteractionStep[] = [];
  const authoredItemDefinitions=new Map<string,ItemDefinitionV1>();
  for (const [stepIndex, raw] of input.steps.entries()) {
    if (!isRecord(raw)
      || !hasExactKeys(raw, [
        "consumes", "dependsOn", "formId", "outcomeBinding", "produces", "proposalRef",
        "rulesInput", "ruling",
      ])
      || (raw.formId !== MATERIALIZATION_FORM_ID && raw.formId !== WORLD_INTERACTION_FORM_ID && raw.formId !== "inventory-operation.vnext-1" && raw.formId !== "observe.vnext-1" && raw.formId !== "social.vnext-1" && raw.formId !== "objective-continuity.vnext-1" && raw.formId !== "combat.vnext-1")
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
    // The canonical-shape predicate has no authority state. Execution always
    // supplies it and checks every step before preflight can pause for a roll.
    if (state && raw.rulesInput.kind === "resolveWorldInteraction" && isWorldInteractionResolutionPlan(raw.rulesInput.plan)) {
      if (profiles && raw.rulesInput.plan.social) {
        const socialIssue = socialInteractionIssue(state, profiles, String(input.rootActionId), raw.rulesInput.plan, "source");
        if (socialIssue) return { kind: "rejected", result: rejected(socialIssue.includes("retry") ? "unchangedRetry" : "privateOrUnknownReference", socialIssue) };
      }
      const issue = observationKnowledgeIssue(state, raw.rulesInput.plan);
      if (issue) return { kind: "rejected", result: rejected("privateOrUnknownReference", issue) };
      if (raw.rulesInput.plan.observation && !authorityReadSetMatches(state, raw.rulesInput.plan.readSet)) {
        return { kind: "rejected", result: rejected("causalFrontierConflict", "The observation read set changed after prepare.") };
      }
    }
    if (raw.rulesInput.kind === "materializeDefinition" && isRecord(raw.rulesInput.plan)) {
      const invalid = authoredSourceRejection(raw.rulesInput.plan.source, `/steps/${stepIndex}/rulesInput/plan`);
      if (invalid !== undefined) return { kind: "rejected", result: invalid };
    }

    if (raw.rulesInput.kind === "formNpcActorPlan") {
      if (!isNpcActorPlanFormationPlan(raw.rulesInput.plan) || raw.consumes.some(ref => ref.kind === "prospective")) {
        return atomicCompileRejected("actor-plan:timer-formation-requires-existing-frozen-premises-no-prospective-consumers");
      }
      const ids = npcActorPlanFormationIds(input.rootActionId, raw.proposalRef);
      const formationPlan = raw.rulesInput.plan;
      if (Object.entries(ids).some(([key, id]) => formationPlan[key as keyof typeof ids] !== id)) {
        return atomicCompileRejected("actor-plan:identities-must-bind-the-frozen-root-and-proposal-slot");
      }
      if (state) {
        const issue = frozenNpcActorPlanFormationIssue(state, input.actorCharacterId, raw.rulesInput.plan);
        if (issue) return { kind: "rejected", result: rejected("privateOrUnknownReference", issue) };
      }
    }

    const prospectiveConsumes = raw.consumes
      .filter((entry): entry is Extract<AtomicWorldInteractionReference, { kind: "prospective" }> =>
        entry.kind === "prospective");
    const expectedDependencies = new Set<string>(atomicStepNeedsNarrativeMaterialization(raw.rulesInput.kind) ? narrativeDependencies : []);
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
      return atomicCompileRejected("The server-derived atomic dependencies do not match typed consumes and frozen narrative obligations.");
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

    if (rulesInput.kind === "materializeSemanticDefinition" && rulesInput.plan.semanticKind === "worldFact" && raw.outcomeBinding !== "always") {
      return atomicCompileRejected("world-fact:history-must-be-unconditional");
    }
    if (rulesInput.kind === "resolveWorldInteraction" && rulesInput.plan.social) {
      for (const branch of Object.values(rulesInput.plan.social.branches)) for (const evidence of branch.response.basis) {
        if (evidence.kind !== "materializedKnowledge") continue;
        const producer = normalizedSteps.find(step => step.rulesInput.kind === "materializeSemanticDefinition"
          && materializedSemanticDefinition(String(input.rootActionId), step.rulesInput.plan).definitionRef === evidence.definitionRef);
        if (!producer || producer.outcomeBinding !== "always" || producer.rulesInput.kind !== "materializeSemanticDefinition"
          || producer.rulesInput.plan.semanticKind !== "worldFact"
          || !prospectiveConsumes.some(consume => bindings.get(consume.handle)?.producerProposalRef === producer.proposalRef)
          || !authoredWorldFactConform(producer.rulesInput.plan.content.worldFact)
          || !producer.rulesInput.plan.content.worldFact.initialKnowledge.some(k => k.holderRef === evidence.holderRef)
          || evidence.holderRef !== rulesInput.plan.social.npcRef) return atomicCompileRejected("social:unconditional-knowledge-producer-required");
      }
    }
    const produces = raw.produces.map((produced) => ({ ...produced }));
    if(rulesInput.kind==="materializeDefinition"||rulesInput.kind==="materializeItem") {
      const produced=produces[0];
      const expectedKind=rulesInput.kind==="materializeItem"?"itemEntry":`${rulesInput.plan.source.kind}Definition`;
      if(produces.length!==1||produced?.handle!==rulesInput.plan.handle||produced?.kind!==expectedKind
        ||produced?.outcomeBinding!==raw.outcomeBinding||bindings.has(rulesInput.plan.handle))return atomicCompileRejected("Each authored materialization must uniquely produce its typed handle.");
      let ref:string, hash:string|null;
      if(rulesInput.kind==="materializeDefinition") {
        const value=materializedAuthoredDefinition(String(input.rootActionId),rulesInput.plan);
        if(value===undefined)return atomicCompileRejected("The authored definition cannot compile into registered mechanics.");
        ref=value.definitionRef;
        hash=value.artifact===undefined?value.definitionHash:canonicalSha256(registeredAbilityRecord(value.artifact));
        if(value.kind==="itemDefinition"&&isItemDefinitionV1(value.definition))authoredItemDefinitions.set(ref,value.definition);
      } else {
        const definition=authoredItemDefinitions.get(rulesInput.plan.definitionRef)??state?.campaignRuntime.itemSystem.definitions[rulesInput.plan.definitionRef];
        const value=definition===undefined?undefined:materializedAuthoredItem(String(input.rootActionId),rulesInput.plan,definition);
        if(state!==undefined&&value===undefined)return atomicCompileRejected("The materialized item has no valid definition or placement.");
        ref=value?.entryRef??authoredItemEntryRef(String(input.rootActionId),rulesInput.plan);
        hash=value?.entryHash??null;
      }
      bindings.set(rulesInput.plan.handle,{definitionRef:ref,revisionOrHash:hash,producerProposalRef:raw.proposalRef,outcomeBinding:raw.outcomeBinding});
    } else if (rulesInput.kind === "materializeSemanticDefinition") {
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
    ...(Object.hasOwn(input, "narrativeMaterializationRefs") ? { narrativeMaterializationRefs: input.narrativeMaterializationRefs as readonly string[] } : {}),
    ...(isAtomicWorldInteractionExecutionCosts(input.executionCosts) ? { executionCosts: structuredClone(input.executionCosts) } : {}),
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
  if (raw.kind === "resolveWorldInteraction" && !isWorldInteractionResolutionPlan(raw.plan)) {
    return atomicCompileRejected("The symbolic world-interaction plan is not canonical.");
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
  if (raw.kind === "resolveWorldInteraction") {
    // The symbolic input has already passed its closed shape and set-order
    // checks. Replacing a local handle with an authority ID can change sort
    // order; canonicalize only those sets, preserving evidence array indices.
    const plan = transformed as unknown as WorldInteractionResolutionPlan;
    const sets = [plan.basisRefs, plan.targetRefs, plan.directTargetRefs, plan.instrumentRefs,
      ...[plan.branches.success, plan.branches.failure].flatMap(branch => [
        ...branch.sensoryEvidence.map(entry => entry.basisRefs),
        ...branch.pressures.map(entry => entry.basisRefs),
        ...branch.opportunities.map(entry => entry.basisRefs),
      ])];
    for (const refs of sets) (refs as string[]).sort();
  }
  if (raw.kind === "materializeSemanticDefinition") {
    for (const field of ["basisRefs", "sourceRefs"]) if (Array.isArray(transformed[field])) (transformed[field] as string[]).sort();
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
    if(binding.revisionOrHash!==null)readSetByRef.set(binding.definitionRef, {
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
  "fromLocationRef", "toLocationRef",
  "abilityRef", "definitionRef", "entityRef", "entryRef", "factRef", "goalRef", "npcRef",
  "objectRef", "observerRef", "planRef", "relationRef", "sceneRef", "sourceDefinitionRef",
  "sourceRef", "subjectRef", "targetRef", "zoneRef", "hazardDefinitionRef", "mechanicsRef", "holderRef", "ownerRef", "targetCharacterRef", "ammunitionDefinitionRef", "resourceId",
]);
const TYPED_REF_ARRAY_FIELDS = new Set([
  "basisRefs", "causalBasisRefs", "costs", "directTargetRefs", "instrumentRefs",
  "mechanicDefinitionRefs", "sourceRefs", "targetRefs", "equippedAbilityRefs",
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
  if (input.kind === "formNpcActorPlan") return formId === "objective-continuity.vnext-1" && isNpcActorPlanFormationPlan(input.plan);
  if (input.kind === "performAbilityOperation") return formId === "combat.vnext-1" && isAbilityOperationPlan(input.plan);
  if (input.kind === "commitNarrativeDetail") return formId === MATERIALIZATION_FORM_ID && isNarrativeDetailPlan(input.plan);
  if(input.kind==="inventoryOperation")return formId==="inventory-operation.vnext-1"&&isInventoryOperationPlan(input.plan);
  if(input.kind==="materializeDefinition")return formId===MATERIALIZATION_FORM_ID&&input.plan.bundleHash===bundleHash&&isAuthoredDefinitionMaterializationPlan(input.plan);
  if(input.kind==="materializeItem")return formId===MATERIALIZATION_FORM_ID&&input.plan.bundleHash===bundleHash&&isAuthoredItemMaterializationPlan(input.plan);
  if (input.kind === "materializeSemanticDefinition") {
    return formId === MATERIALIZATION_FORM_ID
      && input.plan.bundleHash === bundleHash
      && isSemanticDefinitionMaterializationPlan(input.plan);
  }
  if (input.kind === "reviseSemanticDefinition") {
    return formId === MATERIALIZATION_FORM_ID && isSemanticDefinitionRevisionPlan(input.plan);
  }
  return isWorldInteractionResolutionPlan(input.plan) && formId === worldInteractionFormId(input.plan);
}

function preflightAtomicWorldInteractionPlan(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  plan: AtomicWorldInteractionStepsPlan,
  specs: Map<string,WorldInteractionDiceSpec> = new Map(),
  checkBinding: { check?: FrozenCheck | null } = {},
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
      rolls, undefined, specs, undefined, checkBinding,
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
  randomRequest?: WorldInteractionRandomnessRequest,
  collected?: Map<string,WorldInteractionDiceSpec>,
  cursor?: { stepIndex: number; phase: number; result: StepResult; ledger: AtomicLedgerEntry[]; tapes: AtomicTape[] },
  checkBinding?: { check?: FrozenCheck | null },
): AtomicExecutionResult {
  const ledger: AtomicLedgerEntry[] = cursor?.ledger ?? [];
  const tapes = cursor?.tapes ?? (randomRequest === undefined ? [] : [{ request: randomRequest, rolls: [...(rolls ?? [])] }]);
  if (cursor === undefined && plan.executionCosts !== undefined) {
    const { costs, readSet } = plan.executionCosts;
    const source = accumulator.source ?? accumulator.state;
    const refs = new Set(readSet.map(binding => binding.ref));
    if (!authorityReadSetMatches(source, readSet)
      || worldInteractionFeasibilityMechanicalRefs(plan.actorCharacterId, costs).some(ref => !refs.has(ref)))
      return { kind: "rejected", result: rejected("causalFrontierConflict", "The accepted execution costs lack unchanged frozen dependencies.") };
    const permission = conditionActionPermission(accumulator.state, plan.actorCharacterId, { kind: "action" });
    if (!permission.allowed) return { kind: "rejected", result: rejected("missingPrerequisite", "The actor cannot pay the accepted execution costs while unable to act.") };
    const paid = applyAttemptCosts(accumulator, profiles, plan.rootActionId, plan.actorCharacterId, costs, ATOMIC_ACCEPTED_COST_PURPOSE);
    if (!Array.isArray(paid)) return { kind: "rejected", result: paid };
  }
  for (let stepIndex = cursor?.stepIndex ?? 0; stepIndex < plan.steps.length; stepIndex++) {
    const originalStep = plan.steps[stepIndex];
    const step = structuredClone(originalStep);
    if (step.rulesInput.kind === "formNpcActorPlan") {
      const issue = frozenNpcActorPlanFormationIssue(accumulator.source ?? accumulator.state, plan.actorCharacterId, step.rulesInput.plan);
      if (issue) return { kind: "rejected", result: rejected("privateOrUnknownReference", issue) };
    }
    for (const binding of step.rulesInput.plan.readSet) {
      const sourceHash = authorityRevisionOrHash(accumulator.source ?? accumulator.state,binding.ref);
      if (sourceHash !== null && sourceHash !== binding.revisionOrHash)
        return {kind:"rejected",result:rejected("causalFrontierConflict","A transaction input changed before execution.")};
    }
    Object.assign(step.rulesInput,{plan: {...step.rulesInput.plan,readSet:step.rulesInput.plan.readSet.map(binding=>({
      ref:binding.ref,revisionOrHash:authorityRevisionOrHash(accumulator.state,binding.ref)??binding.revisionOrHash,
    }))} as typeof step.rulesInput.plan});
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
    if (step.rulesInput.kind === "resolveWorldInteraction" || step.rulesInput.kind === "inventoryOperation"
      || step.rulesInput.kind === "reviseSemanticDefinition") {
      if ((plan.narrativeMaterializationRefs ?? []).some(ref => narrativeMaterializedRef(accumulator.state, ref) === undefined)) {
        return { kind: "rejected", result: rejected("privateOrUnknownReference", "narrative:materialization-required-before-causal-use") };
      }
    }
    let result: StepResult;
    if (step.rulesInput.kind === "resolveWorldInteraction" && step.rulesInput.plan.social) {
      const definitionRefs = step.consumes.flatMap(consume => consume.kind !== "prospective" ? [] : plan.steps.flatMap(producer =>
        producer.outcomeBinding === "always" && producer.produces.some(p => p.handle === consume.handle)
          && producer.rulesInput.kind === "materializeSemanticDefinition" && producer.rulesInput.plan.semanticKind === "worldFact"
          ? [materializedSemanticDefinition(plan.rootActionId, producer.rulesInput.plan).definitionRef] : []));
      const rebound = originalStep.rulesInput.kind === "resolveWorldInteraction"
        ? rebindFrozenSocialPrefix(accumulator.state, profiles, plan, originalStep.rulesInput.plan, branch,
          String(BigInt(accumulator.state.version) + 1n), accumulator.source, collected) : undefined;
      const expanded = rebound && extendSocialMaterializedContext(accumulator.state, profiles, rebound, definitionRefs);
      if (!expanded) return { kind: "rejected", result: rejected("privateOrUnknownReference", "social:prefix-context-extension-invalid") };
      Object.assign(step.rulesInput, { plan: expanded });
    }
    if (step.rulesInput.kind === "resolveWorldInteraction") {
      const world = applyAtomicWorldStep(profiles,accumulator,step,originalStep,branch,rolls,randomRequest,tapes,collected,checkBinding,
        cursor?.stepIndex===stepIndex?{result:cursor.result,phase:cursor.phase}:undefined);
      if(world.kind==="paused")return {...world,accumulator,ledger,stepIndex};
      result=world.result;
    } else if (step.rulesInput.kind === "performAbilityOperation") {
      const initial = cursor?.stepIndex === stepIndex ? cursor.result : undefined;
      const ability = driveAtomicNativeResult(profiles, accumulator, step.rulesInput.rootActionId, step.proposalRef,
        initial ?? stepAbilityOperation(profiles, accumulator.state, step.rulesInput as unknown as JsonRecord, { continuedRoot: true }),
        tapes, collected, cursor?.stepIndex === stepIndex ? cursor.phase : 0);
      if (ability.kind === "paused") return { ...ability, accumulator, ledger, stepIndex };
      result = ability.result;
    } else if(step.rulesInput.kind === "inventoryOperation") {
      const initial = cursor?.stepIndex === stepIndex ? cursor.result : undefined;
      const inventory = applyAtomicInventoryStep(profiles, accumulator, step, tapes, collected, initial,
        cursor?.stepIndex === stepIndex ? cursor.phase : 0);
      if (inventory.kind === "paused") return { ...inventory, accumulator, ledger, stepIndex };
      result = inventory.result;
    } else {
      result = applyAtomicStep(profiles, accumulator, step.rulesInput);
    }
    if (result.kind !== "committed") {
      // The compiler retains Rules input order. This is a Rules command path,
      // never a model Proposal ordinal (lowering may reorder the draft).
      if (result.kind === "rejected" && result.rejection.diagnostics !== undefined) {
        result = { ...result, rejection: { ...result.rejection,
          diagnostics: result.rejection.diagnostics.map(diagnostic => ({ ...diagnostic,
            ...(diagnostic.path?.startsWith("/")
              ? { path: `/steps/${stepIndex}/rulesInput${diagnostic.path}` } : {}),
          })),
        } };
      }
      return { kind: "rejected", result };
    }
    ledger.push({
      proposalRef: step.proposalRef,
      outcomeBinding: step.outcomeBinding,
      status: "applied",
    });
  }
  if ((plan.narrativeMaterializationRefs ?? []).some(ref => narrativeMaterializedRef(accumulator.state, ref) === undefined)) {
    return { kind: "rejected", result: rejected("privateOrUnknownReference", "narrative:materialization-obligation-unfulfilled") };
  }
  if(plan.steps.length>1 || plan.steps.some(step => step.rulesInput.kind === "formNpcActorPlan") || plan.executionCosts !== undefined
    || Object.values(accumulator.state.internalContinuations).some(stored => stored.rootActionId === plan.rootActionId
      && isAtomicWorldInteractionStepsPlan(stored.resolutionPlan))
    || frozenChoiceForRoot(accumulator.state, plan.rootActionId) !== undefined)appendTransition(accumulator, profiles, plan.rootActionId, {
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

function applyAtomicWorldStep(
  profiles:RuntimeProfileManifest,accumulator:TransitionAccumulator,step:AtomicWorldInteractionStep,
  frozenStep:AtomicWorldInteractionStep,
  branch:"success"|"failure",rolls:readonly number[]|undefined,randomRequest:WorldInteractionRandomnessRequest|undefined,
  tapes:AtomicTape[],collected?:Map<string,WorldInteractionDiceSpec>,checkBinding?:{check?:FrozenCheck|null},
  resume?:{result:StepResult;phase:number},
):{kind:"settled";result:StepResult}|Pick<AtomicPaused,"kind"|"waiting"|"phase"> {
  if(step.rulesInput.kind!=="resolveWorldInteraction" || frozenStep.rulesInput.kind!=="resolveWorldInteraction")return {kind:"settled",result:rejected("invalidRulesInput","A world step was expected.")};
  const child=step.rulesInput.plan,rootActionId=step.rulesInput.rootActionId;
  // Candidate-prefix effects may change read-set hashes used for execution.
  // The settlement identity must still name the original frozen decision.
  const frozenPlanHash=worldInteractionPlanHash(frozenStep.rulesInput.plan);
  let request:WorldInteractionRandomnessRequest|undefined;
  let localRolls:number[]=[];
  if(accumulator.worldCursor===undefined) {

      const allowed = worldInteractionConditionPermission(accumulator.state, child);
      if (allowed !== undefined) return {kind:"settled",result:allowed};
      const effective = worldInteractionEffectiveCheck(accumulator.state, child);
      if (effective.kind === "rejected") return {kind:"settled",result:effective};
      if (child.ruling.kind === "check" && checkBinding !== undefined) {
        if (checkBinding.check !== undefined && canonicalSha256(checkBinding.check) !== canonicalSha256(effective.check))
          return {kind:"settled",result:rejected("invalidRulesInput","The shared check differs between reachable transaction prefixes.")};
        checkBinding.check = effective.check;
      }
      if (child.ruling.kind === "check" && randomRequest !== undefined
        && canonicalSha256(randomRequest.frozenCheck) !== canonicalSha256(effective.check))
        return {kind:"settled",result:rejected("causalFrontierConflict","The shared condition check changed from its frozen prefix.")};
      const specs=hazardDiceSpecs(profiles,accumulator.state,child,[child.ruling.kind==="check"?branch:"success"]);
      for(const spec of specs) {
        const prior=collected?.get(spec.purposeKey);
        if(prior!==undefined&&canonicalSha256(prior)!==canonicalSha256(spec))return {kind:"settled",result:rejected("invalidRulesInput","Dependent hazard randomness must be resolved by a dedicated mechanic.")};
        collected?.set(spec.purposeKey,spec);
      }
      request=randomnessRequestForWorldInteraction(profiles,accumulator.state,child,specs);
      const frozenFaces=randomRequest===undefined?undefined:worldInteractionFaces(randomRequest,rolls??[]);
      localRolls=child.ruling.kind==="check"
        ? collected !== undefined ? [...(representativeRolls(child,branch,effective.check!) ?? [])]
          : [...(rolls??[]).slice(0,request.frozenCheck?.mode==="normal"?1:2)] : [];
      for(const spec of specs) {
        const frozen=randomRequest?.hazardRolls.find(value=>value.purposeKey===spec.purposeKey);
        if(randomRequest!==undefined&&(frozen===undefined||canonicalSha256(frozen)!==canonicalSha256(spec)))return {kind:"settled",result:rejected("causalFrontierConflict","A frozen hazard target or mechanical parameter changed.")};
        const values=frozenFaces?.get(spec.purposeKey)??spec.dice.flatMap(die=>Array(Number(die.count)).fill(spec.purposeKey.includes(":save:")?Number(die.sides):1));
        localRolls.push(...values);
      }

  }
  let phase=resume?.phase??0;
  if(resume!==undefined) {
    const driven=driveAtomicNativeResult(profiles,accumulator,rootActionId,step.proposalRef,resume.result,tapes,collected,phase);
    if(driven.kind==="paused")return driven;
    if(driven.result.kind!=="committed")return driven;
    phase=driven.phase;
  }
  for(let window=0;window<64;window++) {
    const result=settleWorldInteraction(profiles,accumulator,rootActionId,child,
      request===undefined||request.dice.length===0?null:request,localRolls,frozenPlanHash);
    if(result.kind!=="awaitingInput"&&result.kind!=="awaitingRandomness")return {kind:"settled",result};
    const driven=driveAtomicNativeResult(profiles,accumulator,rootActionId,step.proposalRef,result,tapes,collected,phase);
    if(driven.kind==="paused")return driven;
    if(driven.result.kind!=="committed")return driven;
    phase=driven.phase;
  }
  return {kind:"settled",result:rejected("invalidRulesInput","The world interaction did not reach a finite settlement.")};
}

/** Existing Item/Ability reducers execute on the transaction's private state.
 * Their entropy comes from the same pre-frozen Room tape as the shared check. */
function applyAtomicInventoryStep(
  profiles: RuntimeProfileManifest, accumulator: TransitionAccumulator, step: AtomicWorldInteractionStep,
  tapes: AtomicTape[], collected?: Map<string,WorldInteractionDiceSpec>, initial?: StepResult, initialPhase = 0,
): { kind: "settled"; result: StepResult } | Pick<AtomicPaused, "kind" | "waiting" | "phase"> {
  const input = step.rulesInput;
  const fail = (result: StepResult) => ({ kind: "settled" as const, result });
  if (input.kind !== "inventoryOperation") return fail(rejected("invalidRulesInput", "An inventory step was expected."));
  const checkEvent = accumulator.events.find(event => event.eventType === "WorldInteractionResolved"
    && (event.payload as EventPayloadByType["WorldInteractionResolved"]).rulingKind === "check");
  const grant = step.outcomeBinding === "onSuccess" && checkEvent !== undefined
    ? createInventoryAdjudicationGrant(accumulator.state, checkEvent, { rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId, contextHash: input.plan.contextHash, outcomeBinding: "onSuccess" }) : undefined;
  let result = initial ?? stepInventoryOperation(profiles, accumulator.state, input, { continuedRoot: true,
    ...(grant === undefined ? {} : { adjudicationGrant: grant }) });
  return driveAtomicNativeResult(profiles, accumulator, input.rootActionId, step.proposalRef, result, tapes, collected, initialPhase);
}

function driveAtomicNativeResult(
  profiles: RuntimeProfileManifest, accumulator: TransitionAccumulator, rootActionId: string, proposalRef: string,
  initial: StepResult, tapes: AtomicTape[], collected?: Map<string,WorldInteractionDiceSpec>, initialPhase = 0,
): { kind: "settled"; result: StepResult; phase: number } | Pick<AtomicPaused, "kind" | "waiting" | "phase"> {
  let result = initial;
  const fail = (result: StepResult) => ({ kind: "settled" as const, result, phase: initialPhase });
  for (let phase = initialPhase; phase < 64; phase++) {
    if (result.kind !== "committed" && result.kind !== "awaitingRandomness" && result.kind !== "awaitingInput") return fail(result);
    // Import every native event into the private candidate, including the
    // pending frame. Never return that native state across Rules.step.
    for (const event of result.events) appendTransition(accumulator, profiles, rootActionId, {
      eventType: event.eventType, payload: event.payload, resolutionId: event.resolutionId ?? undefined,
      reads: result.scopeProof.reads, writes: result.scopeProof.writes, creates: result.scopeProof.creates,
      visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy,
    }, false);
    if (result.kind === "committed") return { ...fail({ ...result, state: accumulator.state, cache: accumulator.state }), phase };
    if (result.kind === "awaitingInput") return { kind: "paused", waiting: result, phase };
    if (!("randomnessRequests" in result)) return fail(rejected("invalidRulesInput", "An item Ability returned an unsupported continuation."));
    const waiting = result;
    const native = atomicNativeRandomness(waiting);
    if (native === undefined) return fail(rejected("invalidRulesInput", "Item randomness lacks frozen native terms."));
    const requests = native.randomnessRequests;
    const specs = requests.map(request => ({ purposeKey: `inventory:${proposalRef}:${phase}:${request.purposeKey}`,
      dice: request.dice, frozenParameters: request.frozenParameters }));
    const facesBySpec: number[][] = [];
    for (const spec of specs) {
      const prior = collected?.get(spec.purposeKey);
      if (prior !== undefined && canonicalSha256(prior) !== canonicalSha256(spec))
        return fail(rejected("invalidRulesInput", "Item randomness differs between reachable branches."));
      collected?.set(spec.purposeKey, spec);
      const tape = tapes.find(tape => tape.request.hazardRolls.some(value => value.purposeKey === spec.purposeKey));
      const frozen = tape?.request.hazardRolls.find(value => value.purposeKey === spec.purposeKey);
      if (frozen !== undefined && canonicalSha256(frozen) !== canonicalSha256(spec))
        return fail(rejected("causalFrontierConflict", "The frozen Item Ability randomness changed."));
      if (tape === undefined && collected === undefined) return { kind: "paused", waiting, phase };
      facesBySpec.push([...(tape === undefined ? spec.dice.flatMap(die => Array(Number(die.count)).fill(1))
        : worldInteractionFaces(tape.request, tape.rolls)!.get(spec.purposeKey)!)]);
    }
    result = fulfillAtomicNativeRandomness(profiles, accumulator.state, native, facesBySpec);
  }
  return fail(rejected("invalidRulesInput", "The Item Ability continuation did not reach a finite settlement."));
}

function fulfillAtomicNativeRandomness(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  waiting: AtomicNativeRandomness, facesBySpec: number[][]): StepResult {
  const randomnessResults = waiting.randomnessRequests.map((request, index) => {
    const faces = [...facesBySpec[index]];
    return { randomnessId: request.randomnessId, requestHash: request.requestHash,
      draws: request.dice.map(die => ({ sides: Number(die.sides), faces: faces.splice(0, Number(die.count)) })) };
  });
  return stepCombatWorld(profiles, state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
    responseId: `authority-response:${waiting.resolutionId}`, continuationCapability: waiting.continuationCapability,
    randomnessResults }) ?? rejected("invalidRulesInput", "The Item Ability continuation cannot execute.");
}

function applyAtomicStep(
  profiles: RuntimeProfileManifest,
  accumulator: TransitionAccumulator,
  rulesInput: AtomicWorldInteractionRulesInput,
): StepResult {
  const options: AtomicStepOptions = { accumulator, skipDuplicateCheck: true };
  if (rulesInput.kind === "formNpcActorPlan") {
    const issue = frozenNpcActorPlanFormationIssue(accumulator.state, rulesInput.actorCharacterId, rulesInput.plan);
    if (issue) return rejected("privateOrUnknownReference", issue);
    const prepared = prepareFrozenNpcActorPlanFormation(accumulator.state, rulesInput.plan);
    if (prepared.kind === "rejected") return prepared;
    for (const draft of prepared.drafts) appendTransition(accumulator, profiles, rulesInput.rootActionId,
      { ...draft, reads: draft.reads ?? [], writes: draft.writes ?? [] });
    return { kind: "committed", events: accumulator.events, state: accumulator.state, cache: accumulator.state,
      stateHash: accumulator.events.at(-1)!.stateHashAfter, scopeProof: transactionScopeProof(accumulator),
      receipt: accumulator.state.receipts[rulesInput.rootActionId]!, mechanicalResult: { kind: "npcActorPlanFormed" } };
  }
  if (rulesInput.kind === "commitNarrativeDetail") return commitNarrativeDetail(profiles, accumulator.state, rulesInput, options);
  if(rulesInput.kind==="materializeDefinition"||rulesInput.kind==="materializeItem")return applyAuthoredMaterialization(profiles,accumulator.state,rulesInput,options);
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
  checkPlan: WorldInteractionResolutionPlan | undefined,
  specs:readonly WorldInteractionDiceSpec[],
  frozenCheck?: FrozenCheck | null,
): StepResult {
  const resolutionId = checkPlan?.resolutionId ?? `resolution:atomic:${plan.rootActionId}`;
  const request = checkPlan === undefined ? createWorldInteractionRandomness({actorCharacterId:plan.actorCharacterId,
    resolutionId,randomnessId:`randomness:${resolutionId}`,check:null,specs})
    : randomnessRequestForWorldInteraction(profiles,state,checkPlan,specs,frozenCheck);
  const continuation: AuthorityContinuation = {
    kind: "roomAuthorityRandomness",
    continuationId: `continuation:${request.resolutionId}`,
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
    resolutionId: request.resolutionId,
    payload: {
      request,
      continuation,
      purpose: request.purpose,
      formula: request.diceExpression,
      resolutionPlan: plan,
    },
    reads: canonicalRefs([...(plan.executionCosts?.readSet.map(binding => binding.ref) ?? []), ...plan.steps.flatMap((step) =>
      step.rulesInput.plan.readSet.map(({ ref }) => ref)
        .filter((ref) => authorityRevisionOrHash(state, ref) !== null))]),
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
  profiles:RuntimeProfileManifest,state:AuthoritativeWorldState,continuationId:string,
  rolls:readonly number[],plan:AtomicWorldInteractionStepsPlan,
):StepResult {
  if (state.atomicWorldInteractions?.[plan.rootActionId] !== undefined)
    return rejected("privateOrUnknownReference", "The original atomic tape has already been consumed by its suspended candidate.");
  const checkPlan=atomicWorldInteractionCheckPlan(plan);
  const stored=state.internalContinuations[continuationId];
  if(stored===undefined||stored.rootActionId!==plan.rootActionId||stored.request.purpose!=="worldInteractionCheck")return rejected("invalidWorldState","The atomic continuation changed its frozen ruling.");
  const request=stored.request;
  if(!worldInteractionDiceValid(request.dice,rolls))return rejected("invalidRulesInput","The atomic faces do not match the frozen request.");
  const count=request.frozenCheck===null?0:(request.frozenCheck.mode==="normal"?1:2);
  const outcome=checkPlan===undefined?{branch:"success" as const,selectedRoll:null}:worldInteractionRollOutcome(checkPlan,rolls.slice(0,count),request.frozenCheck!);
  if(outcome===undefined)return rejected("invalidRulesInput","The shared check faces are unavailable.");
  const accumulator=transactionAccumulator(state, true);
  appendInteractionDice(profiles,accumulator,plan.rootActionId,request,rolls,outcome.selectedRoll);
  const executed=executeAtomicWorldInteractionBranch(profiles,accumulator,plan,outcome.branch,rolls,request);
  return finishAtomicExecution(profiles, state, plan, outcome.branch, executed, [{ request, rolls: [...rolls] }]);
}

function executeSingleWorldInteraction(profiles:RuntimeProfileManifest,state:AuthoritativeWorldState,rootActionId:string,
  worldPlan:WorldInteractionResolutionPlan,request:WorldInteractionRandomnessRequest|null,rolls:readonly number[]):StepResult {
  const ruling=worldPlan.ruling.kind;
  const plan:AtomicWorldInteractionStepsPlan={schema:ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA,
    rootActionId,actorCharacterId:worldPlan.actorCharacterId,bundleHash:canonicalSha256(worldPlan),contextHash:worldPlan.contextHash,
    sharedRuling:ruling,steps:[{proposalRef:`proposal:${rootActionId}`,formId:worldInteractionFormId(worldPlan),
      outcomeBinding:"always",ruling,consumes:[],produces:[],dependsOn:[],
      rulesInput:{kind:"resolveWorldInteraction",rootActionId,actorCharacterId:worldPlan.actorCharacterId,plan:worldPlan}}]};
  const count=request?.frozenCheck==null?0:request.frozenCheck.mode==="normal"?1:2;
  const outcome=worldPlan.ruling.kind==="check"?worldInteractionRollOutcome(worldPlan,rolls.slice(0,count),request!.frozenCheck!):{branch:"success" as const,selectedRoll:null};
  if(outcome===undefined)return rejected("invalidRulesInput","The frozen world interaction faces are unavailable.");
  const accumulator=transactionAccumulator(state,true);
  if(request!==null)appendInteractionDice(profiles,accumulator,rootActionId,request,rolls,outcome.selectedRoll);
  const executed=executeAtomicWorldInteractionBranch(profiles,accumulator,plan,outcome.branch,rolls,request??undefined);
  return finishAtomicExecution(profiles,state,plan,outcome.branch,executed,request===null?[]:[{request,rolls:[...rolls]}]);
}

function restoreAtomicAccumulator(stored: AtomicWorldContinuation): TransitionAccumulator {
  return {
    ...transactionAccumulator(structuredClone(stored.sourceState), true),
    state: structuredClone(stored.candidateState), events: structuredClone(stored.events),
    ...(stored.worldCursor === null ? {} : {worldCursor:structuredClone(stored.worldCursor)}),
    transactionReads: new Set(stored.scope.reads), transactionWrites: new Set(stored.scope.writes),
    transactionCreates: new Set(stored.scope.creates),
  };
}

function answerAtomicWorldInteractionInput(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  input: JsonRecord, stored: AtomicWorldContinuation): StepResult {
  if (!hasExactKeys(input, ["kind", "pendingInputId", "responseId", "answer"])
    || !isNonEmptyString(input.responseId) || !isRecord(input.answer) || stored.waiting.kind !== "input")
    return rejected("invalidRulesInput", "An atomic pending answer must use the native choice contract.");
  if (!atomicContinuationCanResume(profiles, state, stored))
    return rejected("causalFrontierConflict", "The authority changed while the atomic choice was pending.");
  const choices=stored.waiting.mirror.answerOptions;
  if(Array.isArray(choices)&&choices.length>0&&!choices.some(option=>isRecord(option)&&isRecord(option.answer)
    &&canonicalSha256(option.answer)===canonicalSha256(input.answer)))
    return rejected("invalidRulesInput","The answer is outside the controller's frozen visible choices.");
  const visibleTargets=stored.waiting.mirror.candidateEntityIds;
  const selectedTargets=Array.isArray(input.answer.targetEntityIds)?input.answer.targetEntityIds
    :isNonEmptyString(input.answer.targetEntityId)?[input.answer.targetEntityId]:[];
  if(Array.isArray(visibleTargets)&&selectedTargets.some(ref=>!visibleTargets.includes(ref)))
    return rejected("privateOrUnknownReference","The selected target is outside the controller's frozen visible choices.");
  const accumulator = restoreAtomicAccumulator(stored);
  const result = stepCombatWorld(profiles, accumulator.state, { ...input, pendingInputId: stored.waiting.nativePendingInputId });
  if (result === undefined) return rejected("invalidRulesInput", "The atomic native pending is unavailable.");
  const tapes = structuredClone(stored.tapes);
  const executed = executeAtomicWorldInteractionBranch(profiles, accumulator, stored.plan, stored.branch,
    tapes[0]?.rolls, tapes[0]?.request, undefined,
    { stepIndex: stored.stepIndex, phase: stored.phase, result, ledger: structuredClone(stored.ledger), tapes });
  return finishAtomicExecution(profiles, state, stored.plan, stored.branch, executed, tapes, stored.generation);
}

function fulfillAtomicInputRandomness(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  continuationId: string, rolls: readonly number[], stored: AtomicWorldContinuation): StepResult {
  if (stored.waiting.kind !== "randomness" || stored.waiting.continuationId !== continuationId
    || !atomicContinuationCanResume(profiles, state, stored))
    return rejected("causalFrontierConflict", "The authority changed while atomic randomness was pending.");
  const request = state.internalContinuations[continuationId]?.request;
  if (request?.purpose !== "worldInteractionCheck" || !worldInteractionDiceValid(request.dice, rolls))
    return rejected("invalidRulesInput", "The atomic continuation faces do not match its frozen request.");
  const accumulator = restoreAtomicAccumulator(stored);
  appendInteractionDice(profiles, accumulator, stored.rootActionId, request, rolls, null);
  const faceMap = worldInteractionFaces(request, rolls)!;
  const faces = request.hazardRolls.map(spec => [...faceMap.get(spec.purposeKey)!]);
  const result = fulfillAtomicNativeRandomness(profiles, accumulator.state, stored.waiting.native, faces);
  const tapes = [...structuredClone(stored.tapes), { request, rolls: [...rolls] }];
  const executed = executeAtomicWorldInteractionBranch(profiles, accumulator, stored.plan, stored.branch,
    tapes[0]?.rolls, tapes[0]?.request, undefined,
    { stepIndex: stored.stepIndex, phase: stored.phase + 1, result, ledger: structuredClone(stored.ledger), tapes });
  return finishAtomicExecution(profiles, state, stored.plan, stored.branch, executed, tapes, stored.generation);
}

function safeAtomicPending(state: AuthoritativeWorldState, candidate: AuthoritativeWorldState, native: JsonRecord, rootActionId: string,
  generation: number): JsonRecord | undefined {
  const controller = native.controllerEntityId;
  if (!isNonEmptyString(controller) || state.entities[controller] === undefined
    || !isNonEmptyString(native.choiceKind) || !["playerChoice", "kpDecision"].includes(String(native.kind))) return undefined;
  const mirror: JsonRecord = {
    pendingInputId: `pending:atomic:${canonicalSha256({ rootActionId, generation, nativeId: native.pendingInputId }).slice(7, 39)}`,
    rootActionId, kind: native.kind, choiceKind: native.choiceKind, controllerEntityId: controller,
  };
  for (const field of ["reactionKind", "triggerKind"] as const) {
    if (isNonEmptyString(native[field])) mirror[field] = native[field];
  }
  // The existing Viewer projector exposes a controller's held Ability refs.
  // Use that same candidate ownership for this minimal decision surface, but
  // leave candidate definitions, inventory and HP outside the public mirror.
  const choiceState = candidate;
  if (Array.isArray(native.candidateAbilityRefs)) {
    const active = choiceState.combatRuntime.entities[controller];
    const allowed = Array.isArray(active?.abilityRefs) ? active.abilityRefs : [];
    mirror.candidateAbilityRefs = native.candidateAbilityRefs.filter(ref =>
      typeof ref === "string" && allowed.includes(ref) && choiceState.combatRuntime.definitions[ref] !== undefined);
  }
  mirror.answerOptions = combatPendingAnswerOptions(candidate, {
    ...native,...(Array.isArray(mirror.candidateAbilityRefs)?{candidateAbilityRefs:mirror.candidateAbilityRefs}:{}),
  }).filter(option =>
    isRecord(option.answer) && (!isNonEmptyString(option.answer.targetEntityId)
      || authoritySpatialRefVisibleTo(choiceState, option.answer.targetEntityId, choiceState.entities[controller].sceneId, controller)));
  if (native.targetEntityId === controller) mirror.targetEntityId = controller;
  if (Array.isArray(native.candidateEntityIds)) {
    const candidates = native.candidateEntityIds.filter(ref => typeof ref === "string"
      && choiceState.entities[ref] !== undefined && authoritySpatialRefVisibleTo(choiceState, ref, choiceState.entities[controller].sceneId, controller));
    mirror.candidateEntityIds = candidates;
  }
  if (Number.isSafeInteger(native.maximumTargetCount)) mirror.maximumTargetCount = native.maximumTargetCount;
  return mirror;
}

function finishAtomicExecution(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  plan: AtomicWorldInteractionStepsPlan, branch: "success" | "failure", executed: AtomicExecutionResult,
  tapes: AtomicTape[], previousGeneration = 0): StepResult {
  if (executed.kind === "rejected") return executed.result;
  if (executed.kind === "paused") return suspendAtomicExecution(profiles, state, plan, branch, executed, tapes, previousGeneration + 1);
  // The full suffix has now passed the same reducers. Publish its event payloads
  // exactly once against current authority; never replace authority with a snapshot.
  const accumulator = transactionAccumulator(state);
  const scope = transactionScopeProof(executed.accumulator);
  const sourceEvents = new Map<string, { eventId: string; speakerId: string }>();
  for (const event of executed.accumulator.events) {
    let payload = event.payload;
    if (event.eventType === "KnowledgeAcquired") {
      const acquired = event.payload as EventPayloadByType["KnowledgeAcquired"];
      if ("items" in acquired) payload = { ...acquired, items: acquired.items.map(item => {
        const source = sourceEvents.get(item.knowledgeRef);
        if (!source) return item;
        if (acquired.sourceCharacterId !== source.speakerId || canonicalSha256([...item.provenanceChain].sort())
          !== canonicalSha256([item.knowledgeRef, source.eventId].sort())) throw new TypeError("atomic:source-provenance-not-derived");
        const actual = accumulator.state.knowledge[source.speakerId]?.[item.knowledgeRef];
        if (!actual || actual.objectKind !== item.objectKind || canonicalSha256(actual.content) !== canonicalSha256(item.content))
          throw new TypeError("atomic:source-record-not-committed");
        return { ...item, provenanceChain: [...actual.provenanceChain].sort() };
      }) };
    }
    appendTransition(accumulator, profiles, plan.rootActionId, {
      eventType: event.eventType, payload, resolutionId: event.resolutionId ?? undefined,
      reads: scope.reads, writes: scope.writes, creates: scope.creates,
      visibilityPolicyId: event.visibilityPolicyId, secrecy: event.secrecy,
    }, false);
    if (event.eventType === "SourceClaimCreated") {
      const source = event.payload as EventPayloadByType["SourceClaimCreated"];
      sourceEvents.set(source.claimId, { eventId: event.eventId, speakerId: source.speakerId });
    }
  }
  if (state.atomicWorldInteractions?.[plan.rootActionId] !== undefined) appendTransition(accumulator, profiles, plan.rootActionId, {
    eventType: "AtomicWorldInteractionResumed", payload: { rootActionId: plan.rootActionId },
    reads: [], writes: [`receipt:${plan.rootActionId}`], visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
  }, false);
  const finalized=finalizeAtomicWorldInteractionExecution(plan, branch, { ...executed, accumulator });
  if(plan.steps.length===1 && finalized.kind==="committed") {
    const event=accumulator.events.findLast(event=>event.eventType==="WorldInteractionResolved");
    if(event!==undefined) {
      const payload=event.payload as EventPayloadByType["WorldInteractionResolved"];
      return {...finalized,mechanicalResult:{kind:"worldInteraction",interactionRef:payload.interactionRef,
        branch:payload.branch,outcomeCode:payload.outcomeCode,appliedEffects:structuredClone(payload.appliedEffects)}};
    }
  }
  return finalized;
}

function suspendAtomicExecution(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState,
  plan: AtomicWorldInteractionStepsPlan, branch: "success" | "failure", executed: AtomicPaused,
  tapes: AtomicTape[], generation: number): StepResult {
  const accumulator = transactionAccumulator(state);
  let waiting: AtomicWorldContinuation["waiting"];
  let randomness: { request: WorldInteractionRandomnessRequest; continuation: AuthorityContinuation } | undefined;
  if (executed.waiting.kind === "awaitingInput") {
    const nativeId = executed.waiting.pending.pendingInputId;
    const native = executed.accumulator.state.combatRuntime.pendingInputs[nativeId];
    const mirror = native === undefined ? undefined : safeAtomicPending(state, executed.accumulator.state, native, plan.rootActionId, generation);
    if (mirror === undefined) return rejected("missingPrerequisite", "The atomic choice requires an established, authorized controller and visible choices.");
    waiting = { kind: "input", nativePendingInputId: nativeId, mirror };
  } else {
    if (!("randomnessRequests" in executed.waiting)) return rejected("invalidRulesInput", "Atomic randomness must use the native batch contract.");
    const native = atomicNativeRandomness(executed.waiting);
    if (native === undefined) return rejected("invalidRulesInput", "Atomic randomness lacks frozen native terms.");
    const proposalRef = plan.steps[executed.stepIndex].proposalRef;
    const resolutionId = `resolution:atomic-input:${canonicalSha256({ rootActionId: plan.rootActionId, generation, native }).slice(7,39)}`;
    const request = createWorldInteractionRandomness({ actorCharacterId: plan.actorCharacterId, resolutionId,
      randomnessId: `randomness:${resolutionId}`, check: null,
      specs: native.randomnessRequests.map(entry => ({ purposeKey: `inventory:${proposalRef}:${executed.phase}:${entry.purposeKey}`,
        dice: entry.dice, frozenParameters: entry.frozenParameters })),
    });
    const continuation: AuthorityContinuation = { kind: "roomAuthorityRandomness", continuationId: `continuation:${resolutionId}`,
      capability: canonicalSha256({ request, rootActionId: plan.rootActionId, stateHash: hashWorldState(state), generation }) };
    randomness = { request, continuation };
    // Keep the ordinary event shape: Room's randomness journal freezes and
    // authenticates this exact request before returning any choice-dependent faces.
    appendTransition(accumulator, profiles, plan.rootActionId, {
      eventType: "RandomnessRequested", resolutionId,
      payload: { request, continuation, purpose: request.purpose, formula: request.diceExpression },
      reads: [], writes: [`continuation:${continuation.continuationId}`], creates: [`continuation:${continuation.continuationId}`],
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
    }, false);
    waiting = { kind: "randomness", native, continuationId: continuation.continuationId };
  }
  const sourceState = structuredClone(executed.accumulator.source!);
  const candidateState = structuredClone(executed.accumulator.state);
  sourceState.atomicWorldInteractions = {};
  candidateState.atomicWorldInteractions = {};
  const continuation: AtomicWorldContinuation = {
    schema: "zhuwei.atomic-world-continuation/v1", rootActionId: plan.rootActionId, plan, branch,
    sourceState, candidateState, events: executed.accumulator.events, scope: transactionScopeProof(executed.accumulator),
    ledger: executed.ledger, stepIndex: executed.stepIndex, phase: executed.phase, tapes,
    worldCursor: executed.accumulator.worldCursor ?? null,
    generation, resumeAtEventSeq: (BigInt(accumulator.state.version) + 1n).toString(),
    profilesHash: canonicalSha256(profiles), authorityBindingHash: atomicAuthorityBindingHash(state), waiting,
  };
  appendTransition(accumulator, profiles, plan.rootActionId, {
    eventType: "AtomicWorldInteractionSuspended", payload: { continuation },
    reads: [], writes: [`receipt:${plan.rootActionId}`], visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
  }, false);
  const common = { events: accumulator.events, state: accumulator.state, cache: accumulator.state,
    stateHash: accumulator.events.at(-1)!.stateHashAfter, scopeProof: transactionScopeProof(accumulator),
    receipt: accumulator.state.receipts[plan.rootActionId]!,
    mechanicalResult: { kind: "atomicWorldInteractionSuspended", proposalCount: plan.steps.length } };
  return waiting.kind === "input"
    ? { ...common, kind: "awaitingInput", pending: structuredClone(waiting.mirror) as Extract<StepResult, { kind: "awaitingInput" }>["pending"] }
    : { ...common, kind: "awaitingRandomness", randomnessRequest: randomness!.request, continuation: randomness!.continuation };
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

function randomnessRequestForWorldInteraction(
  profiles:RuntimeProfileManifest, state: AuthoritativeWorldState, plan:WorldInteractionResolutionPlan,
  specs:readonly WorldInteractionDiceSpec[]=hazardDiceSpecs(profiles,state,plan),
  frozenCheck?: FrozenCheck | null,
): WorldInteractionRandomnessRequest {
  const effective = frozenCheck === undefined ? worldInteractionEffectiveCheck(state,plan) : {kind:"accepted" as const,check:frozenCheck};
  if (effective.kind === "rejected") throw new TypeError(effective.rejection.message);
  return createWorldInteractionRandomness({actorCharacterId:plan.actorCharacterId,resolutionId:plan.resolutionId,
    randomnessId:plan.ruling.kind==="check"?plan.ruling.randomnessId:`randomness:${plan.resolutionId}`,
    check:effective.check,specs});
}

function worldInteractionRollOutcome(
  plan: WorldInteractionResolutionPlan,
  rolls: readonly number[],
  frozenCheck?: FrozenCheck,
): Readonly<{ branch: "success" | "failure"; selectedRoll: number }> | undefined {
  if (plan.ruling.kind !== "check") return undefined;
  const check = frozenCheck ?? plan.ruling.check;
  const expected = check.mode === "normal" ? 1 : 2;
  if (rolls.length !== expected
    || !rolls.every((roll) => Number.isSafeInteger(roll) && roll >= 1 && roll <= 20)) return undefined;
  const selectedRoll = check.mode === "advantage"
    ? Math.max(...rolls)
    : check.mode === "disadvantage" ? Math.min(...rolls) : rolls[0]!;
  const total = selectedRoll + Number(plan.ruling.check.modifier);
  const succeeded = plan.ruling.resolutionKind === "attack"
    ? selectedRoll === 20 || (selectedRoll !== 1 && total >= Number(plan.ruling.check.dc))
    : total >= Number(plan.ruling.check.dc);
  return { branch: succeeded ? "success" : "failure", selectedRoll };
}

function representativeRolls(
  plan: WorldInteractionResolutionPlan,
  branch: "success" | "failure",
  frozenCheck?: FrozenCheck,
): readonly number[] | undefined {
  if (plan.ruling.kind !== "check") return undefined;
  for (let face = 1; face <= 20; face += 1) {
    const rolls = (frozenCheck ?? plan.ruling.check).mode === "normal" ? [face] : [face, face];
    if (worldInteractionRollOutcome(plan, rolls, frozenCheck)?.branch === branch) return rolls;
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
      || !["semanticDefinition", "canonicalFact", "relation", "itemEntry", "abilityDefinition", "hazardDefinition", "itemDefinition"].includes(String(entry.kind))
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
  rootActionId: string,
): ReturnType<typeof rejected> | undefined {
  const socialIssue = socialInteractionIssue(state, profiles, rootActionId, plan);
  if (socialIssue) return rejected(socialIssue.includes("retry") ? "unchangedRetry" : "privateOrUnknownReference", socialIssue);
  const knowledgeIssue = observationKnowledgeIssue(state, plan);
  if (knowledgeIssue) return rejected("privateOrUnknownReference", knowledgeIssue);
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
  if (plan.observation !== undefined || plan.directTargetRefs.includes(plan.sceneRef)) {
    const reads = new Set(plan.readSet.map(binding => binding.ref));
    const required = [actorCharacterId, plan.sceneRef, ...plan.targetRefs, ...plan.instrumentRefs, ...plan.basisRefs,
      ...[plan.branches.success, plan.branches.failure].flatMap(branch => [
        ...branch.sensoryEvidence.flatMap(entry => [entry.observerRef, ...entry.basisRefs, ...(entry.subjectRef === null ? [] : [entry.subjectRef])]),
        ...branch.pressures.flatMap(entry => [...entry.basisRefs, ...(entry.sourceRef === null ? [] : [entry.sourceRef])]),
        ...branch.opportunities.flatMap(entry => [...entry.basisRefs, ...(entry.targetRef === null ? [] : [entry.targetRef])]),
      ])];
    if (required.some(ref => !reads.has(ref))) {
      return rejected("causalFrontierConflict", "Observation requires the frozen scope and evidence read set.");
    }
  }
  if (unmaterializedNarrativeRefs(state, [
    ...plan.targetRefs, ...plan.directTargetRefs, ...plan.instrumentRefs, ...plan.basisRefs,
    ...[plan.branches.success, plan.branches.failure].flatMap(branch => [
      ...branch.sensoryEvidence.flatMap(entry => [...entry.basisRefs, ...(entry.subjectRef === null ? [] : [entry.subjectRef])]),
      ...branch.pressures.flatMap(entry => [...entry.basisRefs, ...(entry.sourceRef === null ? [] : [entry.sourceRef])]),
      ...branch.opportunities.flatMap(entry => [...entry.basisRefs, ...(entry.targetRef === null ? [] : [entry.targetRef])]),
    ]),
  ]).length > 0) return rejected("privateOrUnknownReference", "narrative:materialization-required-before-causal-use");
  const conditionPermission = worldInteractionConditionPermission(state, plan);
  if (conditionPermission !== undefined) return conditionPermission;
  const effective = worldInteractionEffectiveCheck(state, plan);
  if (effective.kind === "rejected") return effective;
  if (![...plan.targetRefs, ...plan.directTargetRefs, ...plan.instrumentRefs, ...plan.basisRefs]
    .every((ref) => authorityRefExists(state, ref))) {
    return rejected("privateOrUnknownReference", "The world interaction cites an unavailable authority ref.");
  }
  if (!plan.directTargetRefs.every((ref) =>
    authorityWorldInteractionTargetVisibleTo(state, ref, actorCharacterId, plan))) {
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
  });
  return resolved.kind === "accepted"
    ? Object.freeze({ kind: "accepted", authority: resolved.authority })
    : rejected(resolved.code, resolved.message);
}

function validateBranchAgainstState(
  state: AuthoritativeWorldState,
  plan: WorldInteractionResolutionPlan,
  branch: WorldInteractionBranch,
): ReturnType<typeof rejected> | undefined {
  const revised = new Set<string>();
  const readRefs = new Set(plan.readSet.map(({ ref }) => ref));
  if (branch.effects.filter(effect => effect.kind === "traversePassage").length > 1) return rejected("invalidRulesInput", "passage:one-traversal-per-outcome");
  for (const effect of branch.effects) {
    if (effect.kind === "traversePassage") {
      const binding = effect.passage;
      if (!passageTraversalMatches(state, [plan.actorCharacterId], binding) || binding.sourceSceneRef !== plan.sceneRef
        || !plan.directTargetRefs.includes(binding.passageRef)
        || [binding.passageRef, binding.sourceSceneRef, binding.destinationSceneRef, passageFactRef(binding.passageRef)].some(ref => !readRefs.has(ref))
        || Object.values(state.campaignRuntime.activities).some(activity => activity.characterId === plan.actorCharacterId && activity.status === "active")) {
        return rejected("privateOrUnknownReference", "passage:frozen-traversal-unavailable");
      }
      continue;
    }
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
      if (!["sceneFeature", "passage"].includes(current.semanticKind)
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
    // An observation target does not grant other hidden subjects. Ambient
    // evidence can name the scene (or no object); concrete subjects need their
    // own addressability for the observer, including same-bundle objects.
    if ((plan.observation !== undefined || plan.directTargetRefs.includes(plan.sceneRef))
      && evidence.subjectRef !== null
      && !authorityWorldInteractionTargetVisibleTo(state, evidence.subjectRef, evidence.observerRef, plan)) {
      return rejected("privateOrUnknownReference", "Observation evidence names an unaddressable subject.");
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
  effect: Exclude<WorldInteractionEffect, { kind: "registeredHazard" | "traversePassage" }>,
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
  return (next.semanticKind !== "passage" || ["open", "closed", "blocked"].includes(String(next.content.observableState)))
    && genericSemanticChangesAreSparse(current.content, next.content, current.semanticKind);
}

function genericSemanticChangesAreSparse(
  before: Readonly<JsonRecord>,
  after: Readonly<JsonRecord>,
  kind: StoredSemanticDefinition["semanticKind"],
): boolean {
  const allowed = kind === "npc"
    ? new Set(["semantics.attitude", "semantics.goals", "semantics.plans", "semantics.publicExpression"])
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
    const payload = worldInteractionItemCostPayload(accumulator.state, actorCharacterId, cost, purpose)!;
    const { quantityBefore, quantityAfter, chargesBefore, chargesAfter, durabilityBefore, durabilityAfter } = payload;
    appendTransition(accumulator, profiles, rootActionId, {
      eventType: "ItemUsed",
      payload,
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

/**
 * Charges what an attempt really spent before the world declined it.
 *
 * Item costs still go through the single item transition above, one at a time,
 * so the events keep the order the ruling declared and there remains exactly
 * one place that mutates an item entry. The other two kinds ride transitions
 * that already existed for the rest of the world -- time advances, a resource
 * is spent -- and the resource is checked here rather than left to the fold,
 * which throws: a spend the actor cannot afford is a refusal to make, not a
 * crash to raise.
 */
function applyAttemptCosts(
  accumulator: TransitionAccumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actorCharacterId: string,
  costs: readonly WorldInteractionAttemptCost[],
  purpose: string,
): AppliedWorldInteractionEffect[] | ReturnType<typeof rejected> {
  const applied: AppliedWorldInteractionEffect[] = [];
  for (const cost of costs) {
    if (cost.kind === "item") {
      const itemApplied = applyItemCosts(
        accumulator, profiles, rootActionId, actorCharacterId, [cost], purpose,
      );
      if (!Array.isArray(itemApplied)) return itemApplied;
      applied.push(...itemApplied);
      continue;
    }
    if (cost.kind === "fictionTime") {
      appendTransition(accumulator, profiles, rootActionId, {
        eventType: "FictionTimeAdvanced",
        payload: { durationMicros: cost.durationMicros, reason: purpose },
        reads: [`entity:${actorCharacterId}`],
        writes: [`receipt:${rootActionId}`],
        visibilityPolicyId: "visibility:scene-observers",
        secrecy: "public",
      });
      const advanced = accumulator.events.at(-1)!;
      const timeline = accumulator.state.fictionTimelines[advanced.fictionTimelineId];
      if (timeline === undefined) {
        return rejected(
          "invalidRulesInput",
          "The attempt cost advanced a fiction timeline that does not exist.",
        );
      }
      applied.push({
        kind: "fictionTimeCost",
        durationMicros: cost.durationMicros,
        nowMicrosAfter: timeline.nowMicros,
      });
      continue;
    }
    const available = accumulator.state.entities[actorCharacterId]?.resources?.[cost.resourceId];
    if (available === undefined || available < cost.amount) {
      return rejected(
        "insufficientResource",
        "A frozen world interaction attempt cost is unavailable.",
      );
    }
    appendTransition(accumulator, profiles, rootActionId, {
      eventType: "ResourceUsed",
      payload: worldInteractionResourceCostPayload(actorCharacterId, cost.resourceId, cost.amount, purpose),
      reads: [`entity:${actorCharacterId}`],
      writes: [`entity:${actorCharacterId}`, `receipt:${rootActionId}`],
      visibilityPolicyId: `visibility:character-controller:${actorCharacterId}`,
      secrecy: "private",
    });
    applied.push({
      kind: "resourceCost",
      resourceId: cost.resourceId,
      amountBefore: available,
      amountAfter: available - cost.amount,
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
  cursor: WorldSettlementCursor,
): StepResult | undefined {
  const applied = cursor.appliedEffects;
  const specs = cursor.specs, faces = new Map(cursor.faceEntries), branchName = cursor.branch;
  for (let index=cursor.effectIndex; index<branch.effects.length; index++) {
    const effect=branch.effects[index];
    cursor.effectIndex=index;
    if (effect.kind === "traversePassage") {
      const activityId = `activity:passage:${canonicalSha256({ rootActionId, resolutionId: plan.resolutionId, index }).slice(7, 39)}`;
      const payload = passageActivityPayload(accumulator.state, plan.actorCharacterId, activityId, effect.passage);
      for (const draft of partyDepartureEvents(accumulator.state, plan.actorCharacterId, "personalActivity")) {
        appendTransition(accumulator, profiles, rootActionId, { ...draft,
          reads: [`entity:${plan.actorCharacterId}`], writes: [`entity:${plan.actorCharacterId}`, `receipt:${rootActionId}`] });
      }
      appendTransition(accumulator, profiles, rootActionId, { eventType: "ActivityStarted", payload,
        reads: [effect.passage.passageRef, passageFactRef(effect.passage.passageRef), `entity:${plan.actorCharacterId}`],
        writes: [`activity:${activityId}`, `receipt:${rootActionId}`], creates: [`activity:${activityId}`] });
      applied.push({ kind: "passageTraversalStarted", activityId, passage: effect.passage });
      cursor.effectIndex=index+1;
      continue;
    }
    if (effect.kind === "registeredHazard") {
      const mechanics = hazardMechanics(accumulator.state,effect);
      const targets = cursor.targets ?? registeredHazardTargets(accumulator.state,plan.sceneRef,effect);
      if(mechanics===undefined||targets===undefined)throw new TypeError("registered hazard changed after preflight");
      const key=hazardOccurrence(plan,branchName,index);
      cursor.targets=targets.map(target=>({targetRef:target.targetRef,relationRefs:[...target.relationRefs]}));
      for(let targetIndex=cursor.targetIndex;targetIndex<targets.length;targetIndex++) {
        cursor.targetIndex=targetIndex;
        const target=targets[targetIndex];
        const outcome=hazardDamageForTarget(mechanics,key,target.targetRef,specs,faces,accumulator.state);
        if (mechanics.attack !== null && !cursor.windowHandled) {
          cursor.windowHandled=true;
          const pending=openFrozenAttackReaction(profiles,accumulator.state,{rootActionId,
            occurrenceId:`${key}:target:${target.targetRef}`,sourceRef:effect.sourceDefinitionRef,targetRef:target.targetRef,hit:outcome.hit});
          if (pending !== undefined) return pending;
        }
        if(outcome.components.some(component=>component.rolled>0)) {
          const damageApplied = applyDamageEffect(accumulator,profiles,rootActionId,{
            sourceDefinitionRef:effect.sourceDefinitionRef,zoneRef:effect.zoneRef,relationRefs:target.relationRefs,
            targetRef:target.targetRef,components:outcome.components,
          });
          applied.push(damageApplied);
          for (const draft of hazardConcentrationDrafts(accumulator.state, target.targetRef, key, specs, faces,
            damageApplied.amount, String(mechanics.definition.definitionId))) appendTransition(accumulator,profiles,rootActionId,{
              ...draft, reads:[`entity:${target.targetRef}`], writes:[`combat-entity:${target.targetRef}`,`receipt:${rootActionId}`],
            });
        }
        if(outcome.affected)for(const [effectIndex,abilityEffect] of mechanics.effects.entries()) {
          if(abilityEffect.kind==="endEffect") {
            const ending=planWorldEffectEnd(accumulator.state,{sourceDefinitionRef:String(mechanics.definition.definitionId),
              targetEntityId:target.targetRef,effect:abilityEffect});
            if(ending.kind==="rejected")throw new TypeError(ending.message);
            for(const draft of ending.drafts)appendTransition(accumulator,profiles,rootActionId,{...draft,
              reads:[`entity:${target.targetRef}`],writes:[`combat-entity:${target.targetRef}`,`receipt:${rootActionId}`]});
            continue;
          }
          const granting=planWorldEffect(accumulator.state,{rootActionId,sourceRef:effect.sourceDefinitionRef,
            sourceDefinitionRef:String(mechanics.definition.definitionId),targetEntityId:target.targetRef,
            effect:abilityEffect,index:effectIndex,occurrenceKey:key});
          if(granting.kind==="rejected")throw new TypeError(granting.message);
          if(granting.kind==="immune")continue;
          appendTransition(accumulator,profiles,rootActionId,{eventType:"EffectApplied",payload:{effect:granting.effectRecord},
            reads:[`entity:${target.targetRef}`],writes:[`combat-entity:${target.targetRef}`,`receipt:${rootActionId}`],
            creates:[`effect:${granting.effectRecord.effectId}`],visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"});
        }
        cursor.targetIndex=targetIndex+1;
        cursor.windowHandled=false;
      }
      cursor.targets=null;cursor.targetIndex=0;cursor.effectIndex=index+1;
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
    cursor.effectIndex=index+1;
  }
  return undefined;
}

type ResolvedWorldDamageEffect = Readonly<{
  sourceDefinitionRef:string;zoneRef:string;relationRefs:readonly string[];targetRef:string;
  components:Array<{type:string;rolled:number}>;
}>;

function applyDamageEffect(accumulator:TransitionAccumulator,profiles:RuntimeProfileManifest,rootActionId:string,effect:ResolvedWorldDamageEffect):Extract<AppliedWorldInteractionEffect,{kind:"damage"}> {
  const target=hazardTarget(accumulator.state,profiles,effect.targetRef);
  if(target===undefined)throw new TypeError("world interaction damage target is unavailable");
  const resolution=resolveCreatureDamage(target,effect.components,type=>conditionDamageDefense(accumulator.state,effect.targetRef,type));
  const hpBefore=Number((target.hitPoints as JsonRecord).current);
  const hpAfter=Number((resolution.targetPatch.hitPoints as JsonRecord).current);
  const packet={encounterId:null,pipelineProfileId:"damage-death-srd51-2014-v1",sourceDefinitionId:effect.sourceDefinitionRef,
    targetEntityId:effect.targetRef,components:resolution.components,totalApplied:resolution.totalApplied,targetPatch:resolution.targetPatch};
  appendTransition(accumulator,profiles,rootActionId,{eventType:"DamagePacketResolved",payload:packet,
    reads:canonicalRefs([`entity:${effect.targetRef}`,`definition:${effect.sourceDefinitionRef}`,`definition:${effect.zoneRef}`,...effect.relationRefs.map(ref=>`definition:${ref}`)]),
    writes:[`entity:${effect.targetRef}`,`receipt:${rootActionId}`],visibilityPolicyId:"visibility:room-authority-only",secrecy:"internal"});
  if(resolution.died)appendTransition(accumulator,profiles,rootActionId,{eventType:"CreatureDied",payload:{characterId:effect.targetRef,causeId:effect.sourceDefinitionRef},
    reads:[`entity:${effect.targetRef}`],writes:[`entity:${effect.targetRef}`,`receipt:${rootActionId}`],visibilityPolicyId:"visibility:scene-observers",secrecy:"public"});
  return {kind:"damage",sourceDefinitionRef:effect.sourceDefinitionRef,targetRef:effect.targetRef,
    amount:resolution.totalApplied,damageType:effect.components.length===1?effect.components[0]!.type:"mixed",hpBefore,hpAfter,died:resolution.died,
    hitPointDamage:resolution.hitPointDamage,damagePacketHash:canonicalSha256(packet)};
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
  frozenPlanHash: ReturnType<typeof worldInteractionPlanHash>,
): StepResult {
  if (plan.social) {
    const sourceEvents = new Map<string, string>();
    for (const draft of socialInteractionDrafts(accumulator.state, rootActionId, plan, branchName, ref => {
      const source = sourceEvents.get(ref);
      if (!source) throw new TypeError("social:source-not-committed");
      return source;
    })) {
      const scope = socialDraftScope(accumulator.state, draft, rootActionId);
      appendTransition(accumulator, profiles, rootActionId, { ...draft, resolutionId: plan.resolutionId,
        reads: plan.readSet.map(record => record.ref), ...scope });
      if (draft.eventType === "SourceClaimCreated") sourceEvents.set(draft.payload.claimId, accumulator.events.at(-1)!.eventId);
    }
  }
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
  for (const [index, inference] of (plan.observation?.inferences[branchName] ?? []).entries()) {
    const inferenceId = `inference:${canonicalSha256({ rootActionId, resolutionId: plan.resolutionId, branchName, index }).slice(7)}`;
    const evidenceRefs = inference.evidence.map(source => source.kind === "heldKnowledge" ? source.ref
      : sensoryEvidenceFactId(rootActionId, plan.resolutionId, branchName, source.index));
    const payload = characterInferencePayload(accumulator.state, { characterId: plan.actorCharacterId, inferenceId,
      evidenceRefs, conclusion: inference.conclusion, confidence: inference.confidence });
    if (!payload) return rejected("privateOrUnknownReference", "observation:inference-evidence-unavailable-at-commit");
    appendTransition(accumulator, profiles, rootActionId, { eventType: "CharacterInferenceFormed", resolutionId: plan.resolutionId,
      payload, reads: [`entity:${plan.actorCharacterId}`, ...evidenceRefs.map(ref => `knowledge:${plan.actorCharacterId}:${ref}`)],
      writes: [`knowledge:${plan.actorCharacterId}:${inferenceId}`, `receipt:${rootActionId}`],
      creates: [`knowledge:${plan.actorCharacterId}:${inferenceId}`], visibilityPolicyId: `visibility:knowledge-holder:${plan.actorCharacterId}`, secrecy: "private" });
  }
  const payload: EventPayloadByType["WorldInteractionResolved"] = {
    ...(plan.observation ? { observation: true as const } : {}),
    ...(plan.social ? { social: { plan } } : {}),
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
    // Social carries its verified expanded plan in this payload; its reducer
    // separately proves that expansion against the original frozen decision.
    planHash: plan.social ? worldInteractionPlanHash(plan) : frozenPlanHash,
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
    writes: [`receipt:${rootActionId}`, ...(plan.social ? [`continuity:conversationThreads:${plan.social.threadRef}`] : [])],
    ...(plan.social ? { creates: [`continuity:conversationThreads:${plan.social.threadRef}`] } : {}),
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
  deriveFollowups = true,
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
  for(const followup of deriveFollowups ? conditionFollowupDrafts(accumulator.state,transition.event) : []) {
    appendTransition(accumulator,profiles,rootActionId,{...followup,
      reads:["combat:authoritative-state"],writes:["combat:authoritative-state",`receipt:${rootActionId}`]});
  }
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
  return authorityRevisionOrHash(state, ref) !== null
    || state.campaignRuntime.definitions[ref] !== undefined
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
  if (heldKnowledgeRecord(state, npcRef, ref) !== undefined) return true;
  const holderPrefix = `knowledge:${npcRef}:`;
  if (ref.startsWith(holderPrefix) && heldKnowledgeRecord(state, npcRef, ref.slice(holderPrefix.length)) !== undefined) return true;
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
      ? atomicWorldInteractionCheckPlan(atomicPlan) ?? atomicPlan.steps.flatMap(step=>step.rulesInput.kind==="resolveWorldInteraction"?[step.rulesInput.plan]:[])[0]
      : undefined;
  if (plan === undefined && atomicPlan === undefined) return false;
  const resolutionId=plan?.resolutionId??`resolution:atomic:${atomicPlan!.rootActionId}`;
  return stored.rootActionId in state.receipts
    && (atomicPlan === undefined || atomicPlan.rootActionId === stored.rootActionId)
    && stored.request.purpose === "worldInteractionCheck"
    && stored.request.actorCharacterId === (plan?.actorCharacterId??atomicPlan!.actorCharacterId)
    && stored.request.resolutionId === resolutionId
    && continuationId === `continuation:${resolutionId}`
    && stored.continuation.continuationId === continuationId
    && isSha256(stored.continuation.capability);
}
