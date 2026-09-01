import {
  CAUSAL_ACTION_LANGUAGE_PROFILE,
  lowerCausalActionProgram,
  validateCausalActionProgram,
  type CausalActionProgram,
  type LoweredCausalStep,
} from "../../kp/causal-action-program";
import {
  parseCompoundCompositionJson,
  type CompoundActorPlanDraft,
  type CompoundCompositionDraft,
  type CompoundCompositionOperation,
  type CompoundWorldConsequenceDraft,
} from "../../kp/compound-composition";
import { canonicalSha256 } from "../profiles/canonical";
import {
  CAUSAL_ACTION_INTERPRETER_PROFILE,
  causalActionInterpreterEnabled,
} from "../profiles/causal-action-interpreter";
import type { RuntimeProfileManifest } from "../profiles/types";
import {
  CHARACTER_PREMISE_METHOD,
  CHARACTER_PREMISE_PREDICATES,
  DYNAMIC_NPC_MATERIALIZATION_METHOD,
  HIDDEN_REALITY_KINDS,
  ITEM_TRANSFER_METHOD,
  OBSERVE_ITEM_INFORMATION_METHOD,
  PREMISE_ENTITY_KINDS,
  actorPlanCausalDraft,
  adjudicationPrecedentCausalDraft,
  boundedReferenceList,
  campaignLifecycleCausalDraft,
  characterPremiseDraft,
  definitionRegistrationCausalDraft,
  dynamicDefinitionKind,
  dynamicNpcMaterializationDraft,
  dynamicPassageMoveCausalDraft,
  hiddenRealityCausalDraft,
  itemInformationObservationCausalDraft,
  itemMaterializationCausalDraft,
  narrativeItemMaterializationCausalDraft,
  noncombatContestCausalDraft,
  npcMechanicalCausalDraft,
  observedFactAcquisitionCausalDraft,
  premiseAssertionPredicate,
  scalarNumber,
  scalarString,
  sceneItemAcquisitionCausalDraft,
  stringList,
  worldConsequenceCausalDraft,
  type ActorPlanCausalDraft,
  type AdjudicationPrecedentCausalDraft,
  type AdjudicationPrecedentMaterializationDraft,
  type CampaignLifecycleCausalDraft,
  type CharacterPremiseDraft,
  type DefinitionRegistrationCausalDraft,
  type DynamicNpcMaterializationDraft,
  type DynamicPassageMoveCausalDraft,
  type HiddenRealityCandidate,
  type HiddenRealityCausalDraft,
  type ItemInformationObservationCausalDraft,
  type ItemMaterializationCausalDraft,
  type NarrativeItemMaterializationCausalDraft,
  type NarrativeItemMaterializationDraft,
  type NoncombatContestCausalDraft,
  type NpcMechanicalCausalDraft,
  type ObservedFactAcquisitionCausalDraft,
  type PremiseArchetype,
  type PremisePolicy,
  type PremisePolicySlot,
  type SceneItemAcquisitionCausalDraft,
  type WorldConsequenceCausalDraft,
} from "./causal-action-drafts";
import {
  createEventTransition,
  createScopeProof,
  type TransitionDraft,
} from "./events";
import {
  causalActionDurationMicros,
  causalActionExpectedFrozenCheck,
  causalProgramFactValue,
  causalProgramFactRef,
  isCausalActionResolutionPlan,
  validateExecutableCausalActionProgram,
} from "./causal-model";
import type {
  AdjudicationPrecedentPayload,
  AuthoritativeWorldState,
  AuthorityContinuation,
  CausalActionResolutionPlan,
  CharacterRecord,
  CompoundActionEffect,
  CompoundResolutionPlan,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  PublicReceipt,
  RandomnessRequest,
  ScopeProof,
  StepResult,
} from "./model";
import { needsKp, rejected } from "./results";
import {
  resolveDirectCompoundConsequences,
  stepActorPlanMechanics,
  storyWaitsForExplicitContinuation,
} from "./compound-actions";
import { stepCampaignWorld } from "./campaign-actions";
import { stepCombatWorld } from "./combat-actions";
import { resolveCausalEnvironmentTransition } from "./environment";
import { stepMultiplayerWorld } from "./multiplayer-actions";
import { npcMechanicalItemStateCauseAvailable } from "./multiplayer-events";
import {
  hasExactKeys,
  hashWorldState,
  canonicalFactVisibleToCharacter,
  isNonEmptyString,
  isRecord,
} from "./validation";
import { continueCompoundRoot, isContinuedCompoundRoot } from "./internal-compound";
import { stepSocialCausalAction } from "./social-actions";
import { characterTimelineId } from "./timeline";
import { actorPlanNpcIsAvailable, actorPlanPremiseIsAvailable } from "./actor-plans";
import { dynamicNpcSocialMechanics } from "./social-model";
import {
  DYNAMIC_NPC_DEFAULT_SOCIAL_ARCHETYPE_REF,
  socialResolutionProfileEnabled,
} from "../profiles/social-resolution";
import { npcMechanicsProfileEnabled } from "../profiles/npc-mechanics";
import {
  ITEM_DEFINITION_CONTENT_SCHEMA,
  ITEM_DEFINITION_SCHEMA,
  healingPotionItemDefinition,
  itemEntryMatchesDefinition,
  type ItemDefinitionV1,
} from "./items";
import { itemPolicyVisibleToViewer } from "./item-projection";

const CAUSAL_INPUT_KEYS = [
  "actionLanguageHash",
  "actionLanguageRef",
  "actorCharacterId",
  "causalActionProgram",
  "kind",
  "rootActionId",
] as const;
const SOCIAL_CAUSAL_INPUT_KEYS = [...CAUSAL_INPUT_KEYS, "trustedUtterance"] as const;

type Accumulator = {
  state: AuthoritativeWorldState;
  events: EventEnvelope[];
  receipt?: PublicReceipt;
  scopeProof?: ScopeProof;
  scopeBasis?: AuthoritativeWorldState;
};

function mergeAccumulatorScopeProof(accumulator: Accumulator, next: ScopeProof): void {
  accumulator.scopeBasis ??= accumulator.state;
  const createdScopes = new Set([
    ...(accumulator.scopeProof?.creates ?? []),
    ...next.creates,
  ]);
  accumulator.scopeProof = createScopeProof(
    accumulator.scopeBasis,
    [
      ...(accumulator.scopeProof?.reads ?? []),
      ...next.reads,
    ].filter((scope) => !createdScopes.has(scope)),
    [
      ...(accumulator.scopeProof?.writes ?? []),
      ...next.writes,
    ].filter((scope) => !createdScopes.has(scope)),
    [...createdScopes],
  );
}

type FrozenNodeResult = {
  nodeRef: string;
  primitive: string;
  resolution: "direct" | "check";
  succeeded: boolean;
  branch: "success" | "failure";
  skipped?: true;
  total?: number;
};

type CausalRandomnessResult = {
  continuation: AuthorityContinuation;
  rolls: number[];
};

function moduleAuthorityValue(
  state: AuthoritativeWorldState,
  reference: string,
  kind: string,
  schema: string,
): JsonRecord | undefined {
  const fact = state.canonicalFacts[reference];
  const campaign = state.campaignRuntime.campaign;
  const campaignRef = isRecord(campaign) && isRecord(campaign.moduleRef)
    ? campaign.moduleRef
    : undefined;
  const value = isRecord(fact?.value) ? fact.value : undefined;
  const valueModuleRef = isRecord(value?.moduleRef) ? value.moduleRef : undefined;
  return fact?.kind === kind
    && fact.source === "moduleAnchor"
    && fact.visibilityPolicyId === "visibility:room-authority-only"
    && value?.schema === schema
    && isNonEmptyString(campaignRef?.profileId)
    && isNonEmptyString(campaignRef?.profileHash)
    && isNonEmptyString(valueModuleRef?.profileId)
    && isNonEmptyString(valueModuleRef?.profileHash)
    && valueModuleRef?.profileId === campaignRef.profileId
    && valueModuleRef?.profileHash === campaignRef.profileHash
    ? value
    : undefined;
}

function premisePolicy(state: AuthoritativeWorldState, reference: string): PremisePolicy | undefined {
  const value = moduleAuthorityValue(
    state,
    reference,
    "modulePremisePolicy",
    "zhuwei.module-premise-policy/v1",
  );
  const policy = isRecord(value?.policy) ? value.policy : undefined;
  if (policy === undefined
    || !hasExactKeys(policy, [
      "allowedAnchorRefs", "maximumBindings", "minimumBindings", "policyRef", "predicate",
      "scope", "slots", "statementTemplateRef",
    ])
    || policy.policyRef !== reference
    || !(CHARACTER_PREMISE_PREDICATES as readonly unknown[]).includes(policy.predicate)
    || policy.scope !== "characterBackstory"
    || !Number.isSafeInteger(policy.minimumBindings)
    || !Number.isSafeInteger(policy.maximumBindings)
    || Number(policy.minimumBindings) < 1
    || Number(policy.maximumBindings) < Number(policy.minimumBindings)
    || Number(policy.maximumBindings) > 8
    || !Array.isArray(policy.allowedAnchorRefs)
    || policy.allowedAnchorRefs.length < 1
    || !policy.allowedAnchorRefs.every(isNonEmptyString)
    || !Array.isArray(policy.slots)
    || policy.slots.length < 1
    || !isNonEmptyString(policy.statementTemplateRef)) return undefined;
  const slots: PremisePolicySlot[] = [];
  for (const candidate of policy.slots) {
    if (!isRecord(candidate)
      || !hasExactKeys(candidate, [
        "allowedExistingKinds", "allowedOpenArchetypeRefs", "maximum", "minimum",
        "relationKind", "slotRef",
      ])
      || ![candidate.slotRef, candidate.relationKind].every(isNonEmptyString)
      || !Number.isSafeInteger(candidate.minimum)
      || !Number.isSafeInteger(candidate.maximum)
      || Number(candidate.minimum) < 0
      || Number(candidate.maximum) < Number(candidate.minimum)
      || Number(candidate.maximum) > 8
      || !Array.isArray(candidate.allowedExistingKinds)
      || !candidate.allowedExistingKinds.every((entry) =>
        (PREMISE_ENTITY_KINDS as readonly unknown[]).includes(entry))
      || !Array.isArray(candidate.allowedOpenArchetypeRefs)
      || !candidate.allowedOpenArchetypeRefs.every(isNonEmptyString)) return undefined;
    slots.push({
      slotRef: candidate.slotRef as string,
      relationKind: candidate.relationKind as string,
      minimum: Number(candidate.minimum),
      maximum: Number(candidate.maximum),
      allowedExistingKinds: [...candidate.allowedExistingKinds] as PremisePolicySlot["allowedExistingKinds"],
      allowedOpenArchetypeRefs: [...candidate.allowedOpenArchetypeRefs] as string[],
    });
  }
  if (new Set(slots.map(({ slotRef }) => slotRef)).size !== slots.length) return undefined;
  return {
    policyRef: reference,
    predicate: policy.predicate as PremisePolicy["predicate"],
    scope: "characterBackstory",
    minimumBindings: Number(policy.minimumBindings),
    maximumBindings: Number(policy.maximumBindings),
    allowedAnchorRefs: [...policy.allowedAnchorRefs] as string[],
    slots,
    statementTemplateRef: policy.statementTemplateRef as string,
  };
}

function premiseArchetype(
  state: AuthoritativeWorldState,
  reference: string,
): PremiseArchetype | undefined {
  const value = moduleAuthorityValue(
    state,
    reference,
    "modulePremiseArchetype",
    "zhuwei.module-premise-archetype/v1",
  );
  const archetype = isRecord(value?.archetype) ? value.archetype : undefined;
  if (archetype === undefined
    || !["archetypeRef", "displayTemplateRef", "entityKind", "semanticCategory"]
      .every((key) => Object.hasOwn(archetype, key))
    || Object.keys(archetype).some((key) => ![
      "archetypeRef", "displayTemplateRef", "entityKind", "semanticCategory", "socialArchetypeRef",
    ].includes(key))
    || archetype.archetypeRef !== reference
    || !(PREMISE_ENTITY_KINDS as readonly unknown[]).includes(archetype.entityKind)
    || ![archetype.semanticCategory, archetype.displayTemplateRef].every(isNonEmptyString)
    || (archetype.socialArchetypeRef !== undefined
      && (!isNonEmptyString(archetype.socialArchetypeRef)
        || dynamicNpcSocialMechanics(archetype.socialArchetypeRef) === undefined))
    || (archetype.entityKind === "person") !== isNonEmptyString(archetype.socialArchetypeRef)) {
    return undefined;
  }
  return {
    archetypeRef: reference,
    entityKind: archetype.entityKind as PremiseArchetype["entityKind"],
    semanticCategory: archetype.semanticCategory as string,
    displayTemplateRef: archetype.displayTemplateRef as string,
    ...(isNonEmptyString(archetype.socialArchetypeRef)
      ? { socialArchetypeRef: archetype.socialArchetypeRef }
      : {}),
  };
}

function moduleAnchorAvailable(state: AuthoritativeWorldState, reference: string): boolean {
  return moduleAuthorityValue(
    state,
    reference,
    "moduleAnchor",
    "zhuwei.module-anchor/v1",
  ) !== undefined;
}

function premiseSourceAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  reference: string,
): boolean {
  const fact = state.canonicalFacts[reference];
  return moduleAnchorAvailable(state, reference)
    || premisePolicy(state, reference) !== undefined
    || premiseArchetype(state, reference) !== undefined
    || state.knowledge[actor.id]?.[reference] !== undefined
    || (fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor));
}

function existingPremiseEntityKind(
  state: AuthoritativeWorldState,
  reference: string,
): typeof PREMISE_ENTITY_KINDS[number] | undefined {
  if (state.entities[reference] !== undefined) return "person";
  if (state.scenes[reference] !== undefined) return "place";
  const definition = state.campaignRuntime.definitions[reference];
  const content = isRecord(definition?.content) ? definition.content : undefined;
  if (content !== undefined
    && (PREMISE_ENTITY_KINDS as readonly unknown[]).includes(content.entityKind)) {
    return content.entityKind as typeof PREMISE_ENTITY_KINDS[number];
  }
  if (definition?.definitionKind === "npc") return "person";
  if (definition?.definitionKind === "organization" || definition?.definitionKind === "faction") {
    return "organization";
  }
  if (definition?.definitionKind === "location") return "place";
  if (definition?.definitionKind === "item") return "object";
  if (definition?.definitionKind === "opportunity") return "task";
  return undefined;
}

function materializableDynamicNpcDefinition(
  state: AuthoritativeWorldState,
  definitionRef: string,
  entityRef: string,
  sourceFactRefs: readonly string[],
): { name: string; socialArchetypeRef: string; sourceKind: "premise" | "generic" } | undefined {
  const definition = state.campaignRuntime.definitions[definitionRef];
  const content = isRecord(definition?.content) ? definition.content : undefined;
  if (definition?.definitionKind !== "npc" || content === undefined || !isNonEmptyString(content.name)) {
    return undefined;
  }
  const sourceFacts = sourceFactRefs.map((factRef) => state.canonicalFacts[factRef]);
  const premiseBound = sourceFacts.some((fact) => {
    const bindings = fact?.kind === "characterPremise"
      && isRecord(fact.value)
      && fact.value.schema === "zhuwei.character-premise/v2"
      && Array.isArray(fact.value.bindings)
      ? fact.value.bindings
      : [];
    return bindings.some((entry) => isRecord(entry)
      && entry.referenceKind === "openArchetype"
      && entry.entityRef === entityRef);
  });
  if (premiseBound
    && content.schema === "zhuwei.dynamic-npc-definition/v1"
    && content.entityId === entityRef
    && isNonEmptyString(content.premiseArchetypeRef)
    && premiseArchetype(state, content.premiseArchetypeRef) !== undefined
    && isNonEmptyString(content.socialArchetypeRef)
    && dynamicNpcSocialMechanics(content.socialArchetypeRef) !== undefined
    && content.status === "definedOffstage") {
    return {
      name: content.name,
      socialArchetypeRef: content.socialArchetypeRef,
      sourceKind: "premise",
    };
  }
  const genericBound = entityRef === definitionRef && sourceFacts.some((fact) =>
    fact?.kind === "dynamic:npc"
    && isRecord(fact.value)
    && fact.value.definitionRef === definitionRef
    && fact.value.kind === "npc");
  return genericBound ? {
    name: content.name,
    socialArchetypeRef: DYNAMIC_NPC_DEFAULT_SOCIAL_ARCHETYPE_REF,
    sourceKind: "generic",
  } : undefined;
}

function premiseExistingEntityAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  reference: string,
): boolean {
  const entity = state.entities[reference];
  const definition = state.campaignRuntime.definitions[reference];
  return premiseSourceAvailable(state, actor, reference)
    || (entity !== undefined && (entity.id === actor.id
      || (entity.sceneId === actor.sceneId
        && characterTimelineId(state, entity.id) !== undefined
        && characterTimelineId(state, entity.id) === characterTimelineId(state, actor.id))))
    || (reference === actor.sceneId && state.scenes[reference] !== undefined)
    || (definition !== undefined
      && (definition.visibilityPolicyRef === `visibility:knowledge-holder:${actor.id}`
        || definition.visibilityPolicyRef === `visibility:character-controller:${actor.id}`
        || state.knowledge[actor.id]?.[reference] !== undefined));
}

function checkResolution(step: LoweredCausalStep): "direct" | "check" | undefined {
  return step.arguments.resolution === "direct" || step.arguments.resolution === "check"
    ? step.arguments.resolution
    : undefined;
}

function append<T extends EventType>(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  draft: Omit<TransitionDraft<T>, "scopeProof"> & {
    reads?: string[];
    writes?: string[];
    creates?: string[];
  },
): void {
  const scopeProof = createScopeProof(
    accumulator.state,
    draft.reads ?? [],
    draft.writes ?? [`receipt:${draft.rootActionId}`],
    draft.creates ?? [],
  );
  mergeAccumulatorScopeProof(accumulator, scopeProof);
  const transition = createEventTransition(accumulator.state, profiles, {
    rootActionId: draft.rootActionId,
    ...(draft.resolutionId === undefined ? {} : { resolutionId: draft.resolutionId }),
    eventType: draft.eventType,
    payload: draft.payload,
    scopeProof,
    visibilityPolicyId: draft.visibilityPolicyId,
    secrecy: draft.secrecy,
  });
  accumulator.events.push(transition.event);
  accumulator.state = transition.state;
  accumulator.receipt = transition.receipt;
}

function finished(
  kind: "committed" | "concluded" | "awaitingInput" | "awaitingRandomness",
  accumulator: Accumulator,
  additions: JsonRecord = {},
): StepResult {
  const last = accumulator.events.at(-1);
  if (last === undefined || accumulator.receipt === undefined || accumulator.scopeProof === undefined) {
    return rejected("invalidWorldState", "Causal execution produced no canonical transition.");
  }
  return {
    kind,
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: last.stateHashAfter,
    scopeProof: accumulator.scopeProof,
    receipt: {
      ...accumulator.receipt,
      eventRange: {
        fromEventSeq: accumulator.events[0].eventSeq,
        toEventSeq: last.eventSeq,
      },
      scopeProofHash: accumulator.scopeProof.proofHash,
    },
    ...additions,
  } as StepResult;
}

function programGoal(steps: readonly LoweredCausalStep[]): string {
  for (const step of steps) {
    const goal = scalarString(step.arguments.goal)
      ?? scalarString(step.arguments.intendedOutcome)
      ?? scalarString(step.arguments.question);
    if (goal !== undefined) return goal;
  }
  return "执行已冻结的因果行动程序";
}

function programMethod(steps: readonly LoweredCausalStep[]): string {
  for (const step of steps) {
    const method = scalarString(step.arguments.method);
    if (method !== undefined) return method;
  }
  return "按已冻结节点顺序结算";
}

function branchText(step: LoweredCausalStep, branch: "success" | "failure"): string | undefined {
  if (branch === "failure") {
    return scalarString(step.arguments.failureConsequence)
      ?? scalarString(step.arguments.risk)
      ?? scalarString(step.arguments.reason);
  }
  return scalarString(step.arguments.successConsequence)
    ?? scalarString(step.arguments.intendedOutcome)
    ?? scalarString(step.arguments.desiredInformation)
    ?? scalarString(step.arguments.npcResponse)
    ?? scalarString(step.arguments.proposedFact);
}

function planFor(
  actor: CharacterRecord,
  program: CausalActionProgram,
  steps: readonly LoweredCausalStep[],
  rootActionId: string,
): CausalActionResolutionPlan | undefined {
  const terminal = steps.at(-1);
  if (terminal === undefined) return undefined;
  const duration = causalActionDurationMicros(terminal);
  if (duration === undefined) return undefined;
  return {
    schema: "zhuwei.causal-action-resolution-plan/v4",
    rootActionId,
    actorCharacterId: actor.id,
    sourceSceneId: actor.sceneId,
    languageRef: program.languageRef,
    languageHash: program.languageHash,
    programHash: program.semanticHash,
    program: structuredClone(program) as unknown as JsonRecord,
    checkNodeRefs: steps.flatMap((step) => checkResolution(step) === "check" ? [step.nodeRef] : []),
    durationMicros: duration,
    programFactRef: causalProgramFactRef(rootActionId, program.semanticHash),
  };
}

function appendProgramFact(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  program: CausalActionProgram,
): void {
  const factRef = causalProgramFactRef(rootActionId, program.semanticHash);
  append(accumulator, profiles, {
    rootActionId,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: actor.id,
      outcomeCode: "causal-program-frozen",
      fact: {
        id: factRef,
        kind: "causalActionProgram",
        subjectRefs: [actor.id],
        value: causalProgramFactValue(program),
        visibilityPolicyId: "visibility:room-authority-only",
        source: "characterAction",
      },
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [`entity:${actor.id}`],
    writes: [`fact:${factRef}`, `receipt:${rootActionId}`],
    creates: [`fact:${factRef}`],
  });
}

function actorHasActiveActivity(
  state: AuthoritativeWorldState,
  characterId: string,
): boolean {
  return Object.values(state.campaignRuntime.activities).some((activity) =>
    activity.status === "active" && activity.characterId === characterId);
}

function appendCompletedCausalActivity(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  step: LoweredCausalStep,
  durationMicros: string,
  activityKind: string,
  options?: Readonly<{
    additionalReads?: string[];
    publicReason?: string;
  }>,
): void {
  const activityId = `activity:causal:${rootActionId}:${step.nodeRef}`;
  append(accumulator, profiles, {
    rootActionId,
    eventType: "ActivityStarted",
    payload: {
      activityId,
      characterId: actor.id,
      activityKind,
      intendedDurationMicros: durationMicros,
      completion: {
        kind: "causalItemOperation",
        nodeRef: step.nodeRef,
        primitive: step.primitive,
      },
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`entity:${actor.id}`, ...(options?.additionalReads ?? [])],
    writes: [`activity:${activityId}`, `receipt:${rootActionId}`],
    creates: [`activity:${activityId}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    eventType: "FictionTimeAdvanced",
    payload: {
      durationMicros,
      reason: options?.publicReason ?? programGoal([step]),
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`activity:${activityId}`, `timeline:${accumulator.state.activeBranchId}`],
    writes: [
      `activity:${activityId}`,
      `timeline:${accumulator.state.activeBranchId}`,
      `receipt:${rootActionId}`,
    ],
  });
  append(accumulator, profiles, {
    rootActionId,
    eventType: "ActivityCompleted",
    payload: { activityId },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`activity:${activityId}`],
    writes: [`activity:${activityId}`, `receipt:${rootActionId}`],
  });
}

function appendFrozenCosts(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  terminal: LoweredCausalStep,
): boolean {
  const resourceRef = scalarString(terminal.arguments.resourceRef);
  const resourceAmount = scalarNumber(terminal.arguments.resourceAmount);
  if (resourceRef !== undefined && resourceAmount !== undefined) {
    if ((actor.resources?.[resourceRef] ?? 0) < resourceAmount) return false;
    append(accumulator, profiles, {
      rootActionId,
      eventType: "ResourceReserved",
      payload: {
        characterId: actor.id,
        resourceId: resourceRef,
        amount: resourceAmount,
        purpose: programGoal([terminal]),
      },
      visibilityPolicyId: `visibility:character-controller:${actor.id}`,
      secrecy: "private",
      reads: [`entity:${actor.id}`, `resource:${actor.id}:${resourceRef}`],
      writes: [`resource:${actor.id}:${resourceRef}`, `receipt:${rootActionId}`],
    });
  }
  const itemRef = scalarString(terminal.arguments.itemRef);
  const itemCount = scalarNumber(terminal.arguments.itemCount);
  if (itemRef !== undefined && itemCount !== undefined) {
    const entry = accumulator.state.campaignRuntime.itemSystem.entries[itemRef];
    if (entry?.disposition !== "held"
      || entry.holderRef !== actor.id
      || entry.condition !== "usable"
      || entry.quantity < itemCount) return false;
    append(accumulator, profiles, {
      rootActionId,
      eventType: "ItemUsed",
      payload: {
        characterId: actor.id,
        entryId: entry.entryId,
        purpose: programGoal([terminal]),
        quantityBefore: entry.quantity,
        quantityAfter: entry.quantity - itemCount,
        chargesBefore: entry.charges?.current ?? null,
        chargesAfter: entry.charges?.current ?? null,
        durabilityBefore: entry.durability?.current ?? null,
        durabilityAfter: entry.durability?.current ?? null,
      },
      visibilityPolicyId: entry.visibilityPolicyRef,
      secrecy: entry.visibilityPolicyRef.startsWith("visibility:public") ? "public" : "private",
      reads: [`entity:${actor.id}`, `item-entry:${entry.entryId}`],
      writes: [
        `entity:${actor.id}`,
        `combat-entity:${actor.id}`,
        `item-entry:${entry.entryId}`,
        `receipt:${rootActionId}`,
      ],
    });
  }
  return true;
}

type CompoundPhaseApplication =
  | { ok: true; advancesFictionTime: boolean }
  | { ok: false; result: StepResult };

function mergeCompoundOperationResult(
  accumulator: Accumulator,
  outcome: StepResult | undefined,
  unavailableMessage: string,
): StepResult | undefined {
  if (outcome === undefined) return rejected("invalidWorldState", unavailableMessage);
  if (outcome.kind === "rejected") return outcome;
  if (outcome.kind !== "committed" || !("events" in outcome)) {
    return rejected("invalidWorldState", unavailableMessage);
  }
  accumulator.events.push(...outcome.events);
  accumulator.state = outcome.state;
  accumulator.receipt = outcome.receipt;
  mergeAccumulatorScopeProof(accumulator, outcome.scopeProof);
  return undefined;
}

function compoundReferenceExists(
  state: AuthoritativeWorldState,
  reference: string,
): boolean {
  return reference in state.scenes
    || reference in state.entities
    || reference in state.canonicalFacts
    || reference in state.campaignRuntime.definitions
    || Object.values(state.knowledge).some((knowledge) => reference in knowledge);
}

function appendCompoundDynamicFact(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  operation: Extract<CompoundCompositionOperation, { kind: "declareDynamicFact" }>,
): StepResult | undefined {
  if (operation.factRef in accumulator.state.canonicalFacts
    || operation.factRef in accumulator.state.campaignRuntime.definitions
    || operation.subjectRefs.some((reference) =>
      !compoundReferenceExists(accumulator.state, reference))
    || operation.causalBasisRefs.some((reference) =>
      !compoundReferenceExists(accumulator.state, reference))) {
    return rejected(
      "privateOrUnknownReference",
      "The compound dynamic fact references are unavailable.",
    );
  }
  const visibilityPolicyRef = operation.disclosure === "public"
    ? "visibility:public"
    : "visibility:hidden-until-evidence";
  const definition = stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
    kind: "registerDynamicDefinition",
    proposalId: rootActionId,
    definition: {
      definitionId: operation.factRef,
      revision: "1",
      definitionKind: "compoundDynamicFact",
      rulesBasis: "zhuwei-product-ruling",
      causalBasisRefs: [...operation.causalBasisRefs],
      visibilityPolicyRef,
      content: {
        schema: "zhuwei.compound-dynamic-fact/v1",
        factKind: operation.factKind,
        subjectRefs: [...operation.subjectRefs],
        summary: operation.summary,
      },
    },
  }, rootActionId));
  const definitionError = mergeCompoundOperationResult(
    accumulator,
    definition,
    "The compound dynamic fact definition could not be registered.",
  );
  if (definitionError !== undefined) return definitionError;

  const publicCausalParents = operation.causalBasisRefs.filter((reference) => {
    const fact = accumulator.state.canonicalFacts[reference];
    return fact !== undefined
      && fact.visibilityPolicyId !== "visibility:hidden-until-evidence"
      && fact.visibilityPolicyId !== "visibility:room-authority-only";
  });
  const declared = stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
    kind: "declareCanonicalFact",
    proposalId: rootActionId,
    fact: {
      factId: operation.factRef,
      factKind: operation.factKind,
      subjectRefs: [...operation.subjectRefs],
      causalParentIds: publicCausalParents,
      source: "dynamicMaterialization",
      visibilityPolicy: operation.disclosure,
      value: {
        schema: "zhuwei.compound-dynamic-fact/v1",
        summary: operation.summary,
      },
    },
  }, rootActionId));
  return mergeCompoundOperationResult(
    accumulator,
    declared,
    "The compound dynamic fact could not be declared.",
  );
}

function compoundActorPlanSchedule(
  state: AuthoritativeWorldState,
  draft: CompoundActorPlanDraft,
): {
  due: { kind: "fictionTime"; atFictionMicros: string } | null;
  trigger:
    | { kind: "committedEvent"; eventRef: string }
    | { kind: "knowledgeAcquired"; knowledgeRef: string }
    | null;
} | undefined {
  if (draft.schedule.kind === "activityCompletion") {
    const timelineId = characterTimelineId(state, draft.npcRef);
    const timeline = timelineId === undefined ? undefined : state.fictionTimelines[timelineId];
    if (timeline === undefined) return undefined;
    return {
      due: {
        kind: "fictionTime",
        atFictionMicros: (
          BigInt(timeline.nowMicros) + BigInt(draft.activity.intendedDurationMicros)
        ).toString(),
      },
      trigger: null,
    };
  }
  if (draft.schedule.kind === "committedOccurrence") {
    return {
      due: null,
      trigger: { kind: "committedEvent", eventRef: draft.schedule.occurrenceRef },
    };
  }
  return {
    due: null,
    trigger: { kind: "knowledgeAcquired", knowledgeRef: draft.schedule.knowledgeRef },
  };
}

function applyCompoundActorPlan(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  operation: Extract<CompoundCompositionOperation, { kind: "formActorPlan" }>,
): StepResult | undefined {
  const npc = accumulator.state.entities[operation.draft.npcRef];
  if (!actorPlanNpcIsAvailable(npc)
    || npc.sceneId !== actor.sceneId
    || operation.basisRefs.some((reference) =>
      !compoundReferenceExists(accumulator.state, reference)
      && !actorPlanPremiseIsAvailable(accumulator.state, operation.draft.npcRef, reference))) {
    return rejected("privateOrUnknownReference", "The compound ActorPlan basis is unavailable.");
  }
  const schedule = compoundActorPlanSchedule(accumulator.state, operation.draft);
  if (schedule === undefined) {
    return rejected("privateOrUnknownReference", "The compound ActorPlan schedule is unavailable.");
  }
  const formed = stepActorPlanMechanics(profiles, accumulator.state, continueCompoundRoot({
    kind: "formNpcActorPlan",
    proposalId: rootActionId,
    npcId: operation.draft.npcRef,
    factionRef: operation.draft.factionRef,
    planId: operation.draft.planRef,
    goal: operation.draft.goal,
    premiseRefs: [...operation.draft.premiseRefs],
    nextStep: operation.draft.nextStep,
    resourceRefs: [...operation.draft.resourceRefs],
    activity: {
      activityId: operation.draft.activity.activityRef,
      activityKind: operation.draft.activity.activityKind,
      intendedDurationMicros: operation.draft.activity.intendedDurationMicros,
    },
    due: schedule.due,
    trigger: schedule.trigger,
    trace: {
      factRef: operation.draft.trace.factRef,
      description: operation.draft.trace.description,
      visibilityPolicyRef: "visibility:scene-observers",
    },
    alternateTarget: {
      targetRef: operation.draft.alternate.referenceRef,
      reason: operation.draft.alternate.reason,
    },
  }, rootActionId));
  return mergeCompoundOperationResult(
    accumulator,
    formed,
    "The compound ActorPlan could not be formed.",
  );
}

function compoundWorldEffectsAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  operation: Extract<CompoundCompositionOperation, { kind: "applyWorldEffects" }>,
): boolean {
  if (!operation.draft.factRef.startsWith("fact:")
    || operation.draft.factRef in state.canonicalFacts
    || operation.draft.factRef in state.campaignRuntime.definitions) return false;
  const counterparties = worldConsequenceCounterpartyRefs(operation.draft);
  const actorTimelineId = characterTimelineId(state, actor.id);
  if (actorTimelineId === undefined || counterparties.some((reference) => {
    const target = state.entities[reference];
    return reference === actor.id
      || target === undefined
      || target.tenureStatus !== "active"
      || target.sceneId !== actor.sceneId
      || characterTimelineId(state, reference) !== actorTimelineId;
  })) return false;
  const requiredRefs = new Set([actor.sceneId, ...counterparties]);
  return [...requiredRefs].every((reference) => operation.basisRefs.includes(reference))
    && operation.basisRefs.every((reference) => {
      if (requiredRefs.has(reference)) return true;
      const fact = state.canonicalFacts[reference];
      return fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor);
    });
}

function applyCompoundWorldEffects(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  plan: CausalActionResolutionPlan,
  operation: Extract<CompoundCompositionOperation, { kind: "applyWorldEffects" }>,
): StepResult | undefined {
  if (!compoundWorldEffectsAvailable(accumulator.state, actor, operation)) {
    return rejected(
      "privateOrUnknownReference",
      "The compound world-effect basis is unavailable.",
    );
  }
  const counterparties = worldConsequenceCounterpartyRefs(operation.draft);
  const factError = appendCompoundDynamicFact(accumulator, profiles, rootActionId, {
    kind: "declareDynamicFact",
    factRef: operation.draft.factRef,
    factKind: "worldConsequence",
    subjectRefs: [...new Set([actor.id, actor.sceneId, ...counterparties])].sort(),
    causalBasisRefs: [...operation.basisRefs],
    summary: operation.draft.summary,
    disclosure: "public",
  });
  if (factError !== undefined) return factError;
  const mechanical = resolveDirectCompoundConsequences(
    profiles,
    accumulator.state,
    rootActionId,
    `resolution:${rootActionId}:compound-world-effects`,
    {
      schema: "zhuwei.compound-resolution-plan/v1",
      actorCharacterId: actor.id,
      goal: programGoal(lowerCausalActionProgram(
        plan.program as unknown as CausalActionProgram,
      ).steps),
      method: programMethod(lowerCausalActionProgram(
        plan.program as unknown as CausalActionProgram,
      ).steps),
      sourceSceneId: actor.sceneId,
      durationMicros: plan.durationMicros,
      primaryFactRef: operation.draft.factRef,
      frozenCosts: [],
      successEffects: worldConsequenceEffects(actor, operation.draft),
      failureEffects: [],
    },
  );
  return mergeCompoundOperationResult(
    accumulator,
    mechanical,
    "The compound world effects could not be committed.",
  );
}

function applyCompoundOperation(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  plan: CausalActionResolutionPlan,
  operation: CompoundCompositionOperation,
  phase: "before" | "onSuccess" | "onFailure",
): StepResult | undefined {
  switch (operation.kind) {
    case "declareDynamicFact":
      return appendCompoundDynamicFact(accumulator, profiles, rootActionId, operation);
    case "formActorPlan":
      return applyCompoundActorPlan(accumulator, profiles, rootActionId, actor, operation);
    case "openSceneQuestion": {
      if (operation.sceneQuestionRef in accumulator.state.campaignRuntime.sceneQuestions) {
        return rejected("invalidRulesInput", "The compound SceneQuestion already exists.");
      }
      return mergeCompoundOperationResult(
        accumulator,
        stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
          kind: "openSceneQuestion",
          proposalId: rootActionId,
          sceneQuestionId: operation.sceneQuestionRef,
          question: operation.question,
        }, rootActionId)),
        "The compound SceneQuestion could not be opened.",
      );
    }
    case "startActivity":
      return mergeCompoundOperationResult(
        accumulator,
        stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
          kind: "startActivity",
          proposalId: rootActionId,
          activityId: operation.activityRef,
          activityKind: operation.activityKind,
          characterId: actor.id,
          intendedDurationMicros: operation.intendedDurationMicros,
          completion: {
            method: programMethod(lowerCausalActionProgram(
              plan.program as unknown as CausalActionProgram,
            ).steps),
            primaryFactRef: operation.primaryFactRef,
            sourceSceneId: actor.sceneId,
            success: [],
            failure: [],
          },
        }, rootActionId)),
        "The compound Activity could not be started.",
      );
    case "transitionEnvironment":
      return mergeCompoundOperationResult(
        accumulator,
        resolveCausalEnvironmentTransition(
          profiles,
          accumulator.state,
          rootActionId,
          actor.id,
          operation.featureRef,
          operation.intent,
        ),
        "The compound environment transition could not be committed.",
      );
    case "applyWorldEffects":
      return phase === "before"
        ? rejected(
            "invalidRulesInput",
            "Compound world effects must be bound to a success or failure branch.",
          )
        : applyCompoundWorldEffects(
            accumulator,
            profiles,
            rootActionId,
            actor,
            plan,
            operation,
          );
  }
}

function applyCompoundPhase(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  plan: CausalActionResolutionPlan,
  operations: readonly CompoundCompositionOperation[],
  phase: "before" | "onSuccess" | "onFailure",
): CompoundPhaseApplication {
  const worldEffectCount = operations.filter(({ kind }) => kind === "applyWorldEffects").length;
  if ((phase === "before" && worldEffectCount !== 0) || worldEffectCount > 1) {
    return {
      ok: false,
      result: rejected(
        "invalidRulesInput",
        "Each compound result branch may contain at most one world-effect operation.",
      ),
    };
  }
  for (const operation of operations) {
    const error = applyCompoundOperation(
      accumulator,
      profiles,
      rootActionId,
      actor,
      plan,
      operation,
      phase,
    );
    if (error !== undefined) return { ok: false, result: error };
  }
  return { ok: true, advancesFictionTime: worldEffectCount === 1 };
}

function compoundCompositionForProgram(
  program: CausalActionProgram,
): CompoundCompositionDraft | undefined {
  if (program.formRef !== "compound.v1") return undefined;
  const terminal = program.nodes.at(-1);
  return terminal?.primitive === "joinCausalBranches"
    ? parseCompoundCompositionJson(terminal.arguments.compositionJson)
    : undefined;
}

function appendBranchEffect(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
  branch: "success" | "failure",
): void {
  const text = branchText(step, branch);
  if (text === undefined) return;
  const suffix = plan.programHash.slice("fnv1a64:".length);
  const knowledgeRef = `evidence:v3:${rootActionId}:${suffix}:${step.nodeRef}:${branch}`;
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "KnowledgeAcquired",
    payload: {
      characterId: plan.actorCharacterId,
      knowledgeRef,
      objectKind: "sensoryEvidence",
      layer: "full",
      content: text,
      causeFactId: plan.programFactRef,
      acquisition: {
        sense: "causalResolution",
        sceneId: plan.sourceSceneId,
        method: scalarString(step.arguments.method) ?? "resolveCausalNode",
      },
      visibility: "private",
    },
    visibilityPolicyId: `visibility:knowledge-holder:${plan.actorCharacterId}`,
    secrecy: "private",
    reads: [`entity:${plan.actorCharacterId}`, `fact:${plan.programFactRef}`],
    writes: [`knowledge:${plan.actorCharacterId}:${knowledgeRef}`, `receipt:${rootActionId}`],
    creates: [`knowledge:${plan.actorCharacterId}:${knowledgeRef}`],
  });
}

function existingCharacterPremise(
  state: AuthoritativeWorldState,
  actorId: string,
  predicate: CharacterPremiseDraft["predicate"],
) {
  return Object.values(state.canonicalFacts).find((fact) =>
    fact.kind === "characterPremise"
    && fact.subjectRefs.length === 1
    && fact.subjectRefs[0] === actorId
    && isRecord(fact.value)
    && fact.value.schema === "zhuwei.character-premise/v2"
    && fact.value.characterId === actorId
    && fact.value.predicate === predicate);
}

function appendCharacterPremise(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
  draft: CharacterPremiseDraft,
): void {
  const actor = accumulator.state.entities[plan.actorCharacterId]!;
  const existing = existingCharacterPremise(accumulator.state, actor.id, draft.predicate);
  const basisRefs = [...new Set(stringList(step.arguments.basisRefs))].sort();
  const suffix = plan.programHash.slice("fnv1a64:".length);
  const factRef = `fact:character-premise:${rootActionId}:${suffix}:${step.nodeRef}`;
  let premiseValue: JsonRecord;
  let committedFactRef: string;

  if (existing !== undefined && isRecord(existing.value)) {
    premiseValue = structuredClone(existing.value);
    committedFactRef = existing.id;
  } else {
    const policy = premisePolicy(accumulator.state, draft.policyRef)!;
    const bindings = draft.bindings.map((binding, index) => {
      const slot = policy.slots.find((candidate) => candidate.slotRef === binding.slotRef)!;
      if (binding.referenceKind === "existing") {
        return {
          slotRef: slot.slotRef,
          relationKind: slot.relationKind,
          referenceKind: "existing",
          entityRef: binding.ref,
          entityKind: existingPremiseEntityKind(accumulator.state, binding.ref)!,
        };
      }
      const archetype = premiseArchetype(accumulator.state, binding.archetypeRef)!;
      const entityRef = `premise-entity:${rootActionId}:${suffix}:${step.nodeRef}:${String(index + 1).padStart(2, "0")}`;
      append(accumulator, profiles, {
        rootActionId,
        resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
        eventType: "DefinitionRegistered",
        payload: {
          definition: {
            definitionId: entityRef,
            definitionVersion: "1",
            definitionKind: dynamicDefinitionKind(archetype.entityKind),
            causalBasisRefs: basisRefs,
            visibilityPolicyRef: `visibility:knowledge-holder:${actor.id}`,
            definitionProfile: structuredClone(CAUSAL_ACTION_INTERPRETER_PROFILE),
            actionLanguage: {
              languageRef: plan.languageRef,
              languageHash: plan.languageHash,
              formRef: "materialization.v1",
              formHash: (plan.program as unknown as CausalActionProgram).formHash,
            },
            content: archetype.entityKind === "person"
              ? {
                  schema: "zhuwei.dynamic-npc-definition/v1",
                  entityId: entityRef,
                  name: binding.displayAlias,
                  displayAuthority: "aliasOnly",
                  premiseArchetypeRef: archetype.archetypeRef,
                  semanticCategory: archetype.semanticCategory,
                  relationKind: slot.relationKind,
                  socialArchetypeRef: archetype.socialArchetypeRef,
                  sourceKind: "characterPremiseOpenBlank",
                  status: "definedOffstage",
                }
              : {
                  schema: "zhuwei.dynamic-open-definition/v1",
                  entityRef,
                  entityKind: archetype.entityKind,
                  displayAlias: binding.displayAlias,
                  displayAuthority: "aliasOnly",
                  premiseArchetypeRef: archetype.archetypeRef,
                  semanticCategory: archetype.semanticCategory,
                  relationKind: slot.relationKind,
                  sourceKind: "characterPremiseOpenBlank",
                  status: "definedOffstage",
                },
          },
        },
        visibilityPolicyId: "visibility:room-authority-only",
        secrecy: "internal",
        reads: [`fact:${plan.programFactRef}`],
        writes: [`definition:${entityRef}`, `receipt:${rootActionId}`],
        creates: [`definition:${entityRef}`],
      });
      return {
        slotRef: slot.slotRef,
        relationKind: slot.relationKind,
        referenceKind: "openArchetype",
        entityRef,
        entityKind: archetype.entityKind,
        archetypeRef: archetype.archetypeRef,
      };
    });
    premiseValue = {
      schema: "zhuwei.character-premise/v2",
      characterId: actor.id,
      predicate: draft.predicate,
      policyRef: draft.policyRef,
      anchorRefs: [...draft.anchorRefs],
      statementTemplateRef: policy.statementTemplateRef,
      sourceRefs: basisRefs,
      scope: "characterBackstory",
      truthStatus: "canonical",
      origin: draft.bindings.some((binding) => binding.referenceKind === "openArchetype")
        ? "kpOpenBlankWithinModuleAnchor"
        : "derivedFromEstablishedSources",
      bindings,
    };
    committedFactRef = factRef;
  }

  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: actor.id,
      outcomeCode: existing === undefined
        ? `character-premise-established:${draft.predicate}`
        : `character-premise-recalled:${draft.predicate}`,
      fact: existing === undefined
        ? {
            id: committedFactRef,
            kind: "characterPremise",
            subjectRefs: [actor.id],
            value: premiseValue,
            visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
            source: "dynamicMaterialization",
          }
        : null,
    },
    visibilityPolicyId: `visibility:character-controller:${actor.id}`,
    secrecy: "private",
    reads: [`entity:${actor.id}`, `fact:${plan.programFactRef}`],
    writes: [`fact:${committedFactRef}`, `receipt:${rootActionId}`],
    creates: existing === undefined ? [`fact:${committedFactRef}`] : [],
  });
  if (existing === undefined && Array.isArray(premiseValue.bindings)) {
    premiseValue.bindings.filter(isRecord).forEach((binding, index) => {
      if (!isNonEmptyString(binding.entityRef)
        || !isNonEmptyString(binding.relationKind)) return;
      const assertionFactRef = `fact:typed-premise-assertion:${rootActionId}:${suffix}:${step.nodeRef}:${String(index + 1).padStart(2, "0")}`;
      append(accumulator, profiles, {
        rootActionId,
        resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
        eventType: "ImprovisedActionResolved",
        payload: {
          actorCharacterId: actor.id,
          outcomeCode: "typed-premise-assertion-established",
          fact: {
            id: assertionFactRef,
            kind: "typedAssertionFact",
            subjectRefs: [actor.id, binding.entityRef],
            value: {
              schema: "zhuwei.typed-assertion-fact/v1",
              sourcePremiseFactRef: committedFactRef,
              relationKind: binding.relationKind,
              assertion: {
                subjectRef: actor.id,
                predicate: premiseAssertionPredicate(binding.relationKind),
                polarity: "affirm",
                object: { referenceKind: "existing", ref: binding.entityRef },
              },
            },
            visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
            source: "dynamicMaterialization",
          },
        },
        visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
        secrecy: "private",
        reads: [`fact:${committedFactRef}`, `entity-or-definition:${binding.entityRef}`],
        writes: [`fact:${assertionFactRef}`, `receipt:${rootActionId}`],
        creates: [`fact:${assertionFactRef}`],
      });
    });
    premiseValue.bindings.filter(isRecord).forEach((binding, index) => {
      if (binding.referenceKind !== "openArchetype"
        || binding.entityKind !== "person"
        || !isNonEmptyString(binding.entityRef)
        || !isNonEmptyString(binding.slotRef)
        || !isNonEmptyString(binding.relationKind)) return;
      const grantRef = `fact:dynamic-entity-knowledge-grant:${rootActionId}:${suffix}:${step.nodeRef}:${String(index + 1).padStart(2, "0")}`;
      const assertionFactRef = `fact:typed-premise-assertion:${rootActionId}:${suffix}:${step.nodeRef}:${String(index + 1).padStart(2, "0")}`;
      append(accumulator, profiles, {
        rootActionId,
        resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
        eventType: "ImprovisedActionResolved",
        payload: {
          actorCharacterId: actor.id,
          outcomeCode: "dynamic-entity-knowledge-grant-established",
          fact: {
            id: grantRef,
            kind: "dynamicEntityKnowledgeGrant",
            subjectRefs: [actor.id, binding.entityRef],
            value: {
              schema: "zhuwei.dynamic-entity-knowledge-grant/v1",
              recipientEntityRef: binding.entityRef,
              sourcePremiseFactRef: committedFactRef,
              assertionFactRef,
              characterRef: actor.id,
              relationAtom: structuredClone(binding),
            },
            visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
            source: "dynamicMaterialization",
          },
        },
        visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
        secrecy: "private",
        reads: [`fact:${committedFactRef}`, `definition:${binding.entityRef}`],
        writes: [`fact:${grantRef}`, `receipt:${rootActionId}`],
        creates: [`fact:${grantRef}`],
      });
    });
  }
  const premiseAlreadyKnown = accumulator.state.knowledge[actor.id]?.[committedFactRef]
    !== undefined;
  if (!premiseAlreadyKnown) append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "KnowledgeAcquired",
    payload: {
      characterId: actor.id,
      knowledgeRef: committedFactRef,
      objectKind: "canonicalFact",
      layer: "full",
      content: premiseValue,
      causeFactId: committedFactRef,
      acquisition: {
        sense: "characterPremiseRecall",
        sceneId: plan.sourceSceneId,
        method: CHARACTER_PREMISE_METHOD,
      },
      visibility: "private",
    },
    visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
    secrecy: "private",
    reads: [`entity:${actor.id}`, `fact:${committedFactRef}`],
    writes: [`knowledge:${actor.id}:${committedFactRef}`, `receipt:${rootActionId}`],
    creates: [`knowledge:${actor.id}:${committedFactRef}`],
  });
}

function appendDynamicNpcMaterialization(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
  draft: DynamicNpcMaterializationDraft,
): void {
  const binding = materializableDynamicNpcDefinition(
    accumulator.state,
    draft.definitionRef,
    draft.entityRef,
    draft.sourceFactRefs,
  );
  if (binding === undefined) throw new TypeError("dynamic NPC definition is unavailable");
  const socialArchetypeRef = binding.socialArchetypeRef;
  const socialMechanics = dynamicNpcSocialMechanics(socialArchetypeRef)!;
  const sourceTimelineId = characterTimelineId(accumulator.state, plan.actorCharacterId)!;
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "DynamicEntityMaterialized",
    payload: {
      definitionId: draft.definitionRef,
      entityId: draft.entityRef,
      entityKind: "npc",
      sourceFactIds: [...draft.sourceFactRefs],
      initialKnowledgeFactIds: [...draft.initialKnowledgeFactRefs],
      sceneId: draft.sceneRef,
      sourceTimelineId,
      socialArchetypeRef,
      socialMechanicsHash: canonicalSha256(socialMechanics),
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [
      `entity:${plan.actorCharacterId}`,
      ...draft.sourceFactRefs.map((sourceFactRef) => `fact:${sourceFactRef}`),
      `definition:${draft.definitionRef}`,
      `scene:${draft.sceneRef}`,
    ],
    writes: [`entity:${draft.entityRef}`, `receipt:${rootActionId}`],
    creates: [`entity:${draft.entityRef}`],
  });
  for (const grantFactRef of draft.initialKnowledgeFactRefs) {
    const grantFact = accumulator.state.canonicalFacts[grantFactRef]!;
    const grantValue = isRecord(grantFact.value) ? grantFact.value : {};
    const assertionFactRef = grantValue.assertionFactRef as string;
    const assertionFact = accumulator.state.canonicalFacts[assertionFactRef]!;
    append(accumulator, profiles, {
      rootActionId,
      resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
      eventType: "KnowledgeAcquired",
      payload: {
        characterId: draft.entityRef,
        knowledgeRef: assertionFactRef,
        objectKind: "canonicalFact",
        layer: "full",
        content: structuredClone(assertionFact.value),
        causeFactId: assertionFactRef,
        acquisition: {
          sense: "dynamicEntityMaterialization",
          sceneId: draft.sceneRef,
          method: DYNAMIC_NPC_MATERIALIZATION_METHOD,
        },
        visibility: "private",
      },
      visibilityPolicyId: `visibility:knowledge-holder:${draft.entityRef}`,
      secrecy: "private",
      reads: [
        `entity:${draft.entityRef}`,
        `fact:${grantFactRef}`,
        `fact:${assertionFactRef}`,
      ],
      writes: [`knowledge:${draft.entityRef}:${assertionFactRef}`, `receipt:${rootActionId}`],
      creates: [`knowledge:${draft.entityRef}:${assertionFactRef}`],
    });
  }
}

function appendDirectNode(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
  branch: "success" | "failure",
): void {
  const precedent = adjudicationPrecedentCausalDraft(
    plan.program as unknown as CausalActionProgram,
  );
  if (precedent.kind === "precedent" && precedent.step.nodeRef === step.nodeRef) {
    return;
  }
  const lifecycle = campaignLifecycleCausalDraft(
    plan.program as unknown as CausalActionProgram,
  );
  if (lifecycle.kind === "lifecycle" && lifecycle.step.nodeRef === step.nodeRef) {
    return;
  }
  const premise = socialResolutionProfileEnabled(profiles.extensions)
    ? characterPremiseDraft(step)
    : undefined;
  const dynamicNpc = socialResolutionProfileEnabled(profiles.extensions)
    ? dynamicNpcMaterializationDraft(step)
    : undefined;
  if (dynamicNpc !== undefined && branch === "success") {
    appendDynamicNpcMaterialization(
      accumulator,
      profiles,
      rootActionId,
      plan,
      step,
      dynamicNpc,
    );
    return;
  }
  if (premise !== undefined && branch === "success") {
    appendCharacterPremise(accumulator, profiles, rootActionId, plan, step, premise);
    return;
  }
  const materialization = step.primitive === "materializeOpenFact" && branch === "success";
  const factRef = `fact:v3-materialization:${rootActionId}:${plan.programHash.slice("fnv1a64:".length)}:${step.nodeRef}`;
  const description = scalarString(step.arguments.proposedFact);
  const basisRefs = stringList(step.arguments.basisRefs);
  if (materialization) {
    const program = plan.program as unknown as CausalActionProgram;
    append(accumulator, profiles, {
      rootActionId,
      resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
      eventType: "DefinitionRegistered",
      payload: {
        definition: {
          definitionId: factRef,
          definitionVersion: "1",
          definitionKind: "materializedOpenFact",
          causalBasisRefs: basisRefs,
          visibilityPolicyRef: "visibility:scene-observers",
          definitionProfile: structuredClone(CAUSAL_ACTION_INTERPRETER_PROFILE),
          actionLanguage: {
            languageRef: plan.languageRef,
            languageHash: plan.languageHash,
            formRef: program.formRef,
            formHash: program.formHash,
          },
          content: { description },
        },
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: basisRefs.map((reference) => `fact:${reference}`),
      writes: [`definition:${factRef}`, `receipt:${rootActionId}`],
      creates: [`definition:${factRef}`],
    });
  }
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: plan.actorCharacterId,
      outcomeCode: `causal-node:${step.nodeRef}:${branch}`,
      fact: materialization
        ? {
            id: factRef,
            kind: "dynamicOpenFact",
            subjectRefs: [plan.actorCharacterId, plan.sourceSceneId].sort(),
            value: {
              description,
            },
            visibilityPolicyId: "visibility:scene-observers",
            source: "dynamicMaterialization",
          }
        : null,
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [
      `entity:${plan.actorCharacterId}`,
      `fact:${plan.programFactRef}`,
      ...basisRefs.map((reference) => `fact:${reference}`),
      ...(materialization ? [`definition:${factRef}`] : []),
    ],
    writes: [
      `receipt:${rootActionId}`,
      ...(materialization ? [`fact:${factRef}`] : []),
    ],
    creates: materialization ? [`fact:${factRef}`] : [],
  });
}

function appendAdjudicationPrecedent(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  parsed: Extract<AdjudicationPrecedentCausalDraft, { kind: "precedent" }>,
): void {
  const step = parsed.step;
  const durationUnitValue = scalarString(step.arguments.durationUnit);
  const durationUnit = ["round", "second", "minute", "hour", "day"].includes(
    String(durationUnitValue),
  )
    ? durationUnitValue as "round" | "second" | "minute" | "hour" | "day"
    : undefined;
  const durationValue = scalarNumber(step.arguments.durationValue);
  const ability = scalarString(step.arguments.ability) ?? null;
  const skill = scalarString(step.arguments.skill) ?? null;
  const dc = scalarNumber(step.arguments.dc) ?? null;
  const mechanics: AdjudicationPrecedentPayload["mechanics"] = {
    operation: "resolveNoncombatCheck",
    ability,
    skill,
    dc,
    duration: durationUnit === undefined || durationValue === undefined
      ? null
      : { unit: durationUnit, value: durationValue },
    outcomeRange: {
      success: branchText(step, "success") === undefined
        ? []
        : [branchText(step, "success")!],
      failure: branchText(step, "failure") === undefined
        ? []
        : [branchText(step, "failure")!],
    },
  };
  const precedentId = `precedent:${rootActionId}:${step.nodeRef}`;
  const common: AdjudicationPrecedentPayload = {
    precedentId,
    canonicalContextFingerprint: canonicalSha256({
      actorCharacterId: plan.actorCharacterId,
      sourceSceneId: plan.sourceSceneId,
      goal: programGoal([step]),
      method: programMethod([step]),
      publicBasisRefs: parsed.draft.publicBasisRefs,
      privateBasisRefs: parsed.draft.privateBasisRefs,
      mechanics,
      applicabilityScope: parsed.draft.applicabilityScope,
      rulesetProfile: profiles.ruleset,
      runtimeManifestProfile: profiles.manifest,
    }),
    publicExplanation: scalarString(step.arguments.risk)
      ?? `本次裁定使用 ${ability ?? "能力"}${dc === null ? "" : ` DC ${dc}`}。`,
    publicRuleBasis: [...parsed.draft.publicRuleBasis],
    publicBasisRefs: [...parsed.draft.publicBasisRefs],
    privateBasisRefs: [...parsed.draft.privateBasisRefs],
    mechanics,
    applicabilityScope: structuredClone(parsed.draft.applicabilityScope),
    rulesetProfile: structuredClone(profiles.ruleset),
    runtimeManifestProfile: structuredClone(profiles.manifest),
  };
  const sharedTransition = {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal" as const,
    reads: [
      `entity:${plan.actorCharacterId}`,
      ...parsed.draft.publicBasisRefs.map((reference) => `fact:${reference}`),
      ...parsed.draft.privateBasisRefs.map((reference) => `knowledge-or-fact:${reference}`),
      ...(parsed.draft.supersededPrecedentId === undefined
        ? []
        : [`precedent:${parsed.draft.supersededPrecedentId}`]),
    ],
    writes: [`precedent:${precedentId}`, `receipt:${rootActionId}`],
    creates: [`precedent:${precedentId}`],
  };
  if (parsed.draft.action === "supersede") {
    append(accumulator, profiles, {
      ...sharedTransition,
      eventType: "AdjudicationPrecedentSuperseded",
      payload: {
        ...common,
        supersededPrecedentId: parsed.draft.supersededPrecedentId!,
        materialDifferences: [...parsed.draft.materialDifferences!],
      },
    });
    return;
  }
  append(accumulator, profiles, {
    ...sharedTransition,
    eventType: "AdjudicationPrecedentRecorded",
    payload: common,
  });
}

function appendMeaningfulFailure(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
): void {
  const lifecycle = campaignLifecycleCausalDraft(
    plan.program as unknown as CausalActionProgram,
  );
  const retry = lifecycle.kind === "lifecycle"
      && lifecycle.draft.action === "retryFailedAction"
      && lifecycle.step.nodeRef === step.nodeRef
    ? lifecycle.draft
    : undefined;
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "MeaningfulFailureCommitted",
    payload: {
      characterId: plan.actorCharacterId,
      goalId: retry?.precedentRef ?? `goal:${rootActionId}:${step.nodeRef}`,
      methodFingerprint: programMethod([step]),
      factualCause: `resolution:${rootActionId}:causal:${step.nodeRef}:failed`,
      consequences: {
        effectKinds: branchText(step, "failure") === undefined ? [] : ["acquireEvidence"],
        ...(retry === undefined ? {} : {
          committedConsequences: branchText(step, "failure") === undefined
            ? []
            : [branchText(step, "failure")!],
          newOptions: [],
        }),
      },
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`entity:${plan.actorCharacterId}`, `fact:${plan.programFactRef}`],
    writes: [
      `failure:${retry?.precedentRef ?? `${rootActionId}:${step.nodeRef}`}`,
      `receipt:${rootActionId}`,
    ],
    creates: retry === undefined ? [`failure:${rootActionId}:${step.nodeRef}`] : [],
  });
}

function settleProgram(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  randomness: ReadonlyMap<string, { rolls: number[]; request: RandomnessRequest; continuationId: string }>,
): StepResult {
  if (!isCausalActionResolutionPlan(plan) || plan.rootActionId !== rootActionId) {
    return rejected("invalidWorldState", "The frozen causal continuation is not canonical.");
  }
  const program = plan.program as unknown as CausalActionProgram;
  const steps = lowerCausalActionProgram(program).steps;
  const composition = compoundCompositionForProgram(program);
  if (program.formRef === "compound.v1" && composition === undefined) {
    return rejected("invalidWorldState", "The frozen compound composition is no longer canonical.");
  }
  const adjudicationPrecedent = adjudicationPrecedentCausalDraft(program);
  if (adjudicationPrecedent.kind === "invalid") {
    return rejected("invalidWorldState", "The frozen adjudication precedent is no longer canonical.");
  }
  const nodeResults: FrozenNodeResult[] = [];
  const sequenceSucceeded = new Map<number, boolean>();
  let allPriorSucceeded = true;
  for (const step of steps) {
    const resolution = checkResolution(step);
    if (resolution === undefined) {
      return rejected("invalidWorldState", "A frozen causal node lost its resolution mode.");
    }
    const skipped = step.prerequisiteSequences.some((sequence) =>
      sequenceSucceeded.get(sequence) !== true);
    let ownSucceeded = true;
    let total: number | undefined;
    if (resolution === "check") {
      const entry = randomness.get(step.nodeRef);
      if (entry === undefined || !isRecord(entry.request) || !("frozenCheck" in entry.request)) {
        return rejected("invalidRulesInput", "Every frozen causal check requires one authoritative result.");
      }
      const check = entry.request.frozenCheck;
      const expectedRollCount = check.mode === "normal" ? 1 : 2;
      if (
        entry.rolls.length !== expectedRollCount
        || entry.rolls.some((roll) => !Number.isInteger(roll) || roll < 1 || roll > 20)
      ) return rejected("invalidRulesInput", "A causal check result does not match its frozen dice.");
      const selectedRoll = check.mode === "advantage"
        ? Math.max(...entry.rolls)
        : check.mode === "disadvantage"
          ? Math.min(...entry.rolls)
          : entry.rolls[0];
      total = selectedRoll + Number(check.modifier);
      ownSucceeded = !skipped && total >= Number(check.dc);
      append(accumulator, profiles, {
        rootActionId,
        resolutionId: entry.request.resolutionId,
        eventType: "DiceRolled",
        payload: {
          randomnessId: entry.request.randomnessId,
          resolutionId: entry.request.resolutionId,
          formula: entry.request.diceExpression,
          faces: [...entry.rolls],
          selectedFace: selectedRoll,
          requestHash: canonicalSha256(entry.request),
          frozenParametersHash: canonicalSha256(plan),
        },
        visibilityPolicyId: "visibility:room-authority-only",
        secrecy: "internal",
        reads: [`continuation:${entry.continuationId}`],
        writes: [`receipt:${rootActionId}`],
      });
      append(accumulator, profiles, {
        rootActionId,
        resolutionId: entry.request.resolutionId,
        eventType: "ImprovisedCheckResolved",
        payload: {
          request: structuredClone(entry.request),
          rolls: [...entry.rolls],
          selectedRoll,
          total,
          succeeded: ownSucceeded,
          outcome: skipped
            ? "因冻结的先决阶段未成立，本阶段未执行。"
            : ownSucceeded ? check.successOutcome : check.failureOutcome,
        },
        visibilityPolicyId: `visibility:character-controller:${plan.actorCharacterId}`,
        secrecy: "private",
        reads: [`continuation:${entry.continuationId}`, `entity:${plan.actorCharacterId}`],
        writes: [`continuation:${entry.continuationId}`, `receipt:${rootActionId}`],
      });
    }

    const isJoin = step.primitive === "joinCausalBranches";
    const succeeded: boolean = !skipped
      && (isJoin ? allPriorSucceeded && ownSucceeded : ownSucceeded);
    const branch = succeeded ? "success" : "failure";
    if (skipped) {
      nodeResults.push({
        nodeRef: step.nodeRef,
        primitive: step.primitive,
        resolution,
        succeeded: false,
        branch: "failure",
        skipped: true,
        ...(total === undefined ? {} : { total }),
      });
      sequenceSucceeded.set(step.sequence, false);
      allPriorSucceeded = false;
      continue;
    }
    if (resolution === "direct"
      || (step.primitive === "materializeOpenFact" && branch === "success")) {
      appendDirectNode(accumulator, profiles, rootActionId, plan, step, branch);
    }
    if (!(socialResolutionProfileEnabled(profiles.extensions)
      && characterPremiseDraft(step) !== undefined)) {
      appendBranchEffect(accumulator, profiles, rootActionId, plan, step, branch);
    }
    if (adjudicationPrecedent.kind === "precedent"
      && adjudicationPrecedent.step.nodeRef === step.nodeRef) {
      appendAdjudicationPrecedent(
        accumulator,
        profiles,
        rootActionId,
        plan,
        adjudicationPrecedent,
      );
    }
    if (!succeeded) appendMeaningfulFailure(accumulator, profiles, rootActionId, plan, step);
    nodeResults.push({
      nodeRef: step.nodeRef,
      primitive: step.primitive,
      resolution,
      succeeded,
      branch,
      ...(total === undefined ? {} : { total }),
    });
    sequenceSucceeded.set(step.sequence, succeeded);
    allPriorSucceeded &&= succeeded;
  }

  let compositionAdvancesFictionTime = false;
  if (composition !== undefined) {
    const actor = accumulator.state.entities[plan.actorCharacterId];
    if (actor?.kind !== "player" || actor.tenureStatus !== "active") {
      return rejected("privateOrUnknownReference", "The frozen compound actor is unavailable.");
    }
    const application = applyCompoundPhase(
      accumulator,
      profiles,
      rootActionId,
      actor,
      plan,
      allPriorSucceeded ? composition.onSuccess : composition.onFailure,
      allPriorSucceeded ? "onSuccess" : "onFailure",
    );
    if (!application.ok) return application.result;
    compositionAdvancesFictionTime = application.advancesFictionTime;
  }

  if (!compositionAdvancesFictionTime) {
    append(accumulator, profiles, {
      rootActionId,
      eventType: "FictionTimeAdvanced",
      payload: {
        durationMicros: plan.durationMicros,
        reason: programGoal(steps),
      },
      visibilityPolicyId: "visibility:scene-observers",
      secrecy: "public",
      reads: [`timeline:${accumulator.state.activeBranchId}`],
      writes: [`timeline:${accumulator.state.activeBranchId}`, `receipt:${rootActionId}`],
    });
  }
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: plan.languageRef,
      languageHash: plan.languageHash,
      programHash: plan.programHash,
      formRef: program.formRef,
      succeeded: allPriorSucceeded,
      nodes: nodeResults,
    },
  });
}

function clarification(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
): StepResult {
  const node = program.nodes[0];
  const question = scalarString(node.arguments.question);
  if (question === undefined) return rejected("invalidRulesInput", "Clarification requires one question.");
  const pendingInputId = `pending-input:${input.rootActionId as string}`;
  const accumulator: Accumulator = { state, events: [] };
  const actor = state.entities[input.actorCharacterId as string]!;
  appendProgramFact(accumulator, profiles, input.rootActionId as string, actor, program);
  append(accumulator, profiles, {
    rootActionId: input.rootActionId as string,
    eventType: "ClarificationRequested",
    payload: {
      actorCharacterId: input.actorCharacterId as string,
      pendingInputId,
      question,
    },
    visibilityPolicyId: `visibility:character-controller:${input.actorCharacterId as string}`,
    secrecy: "private",
    reads: [
      `entity:${input.actorCharacterId as string}`,
      `fact:${causalProgramFactRef(input.rootActionId as string, program.semanticHash)}`,
    ],
    writes: [`pending:${pendingInputId}`, `receipt:${input.rootActionId as string}`],
    creates: [`pending:${pendingInputId}`],
  });
  return finished("awaitingInput", accumulator, {
    pending: { pendingInputId, kind: "clarification", question },
  });
}

function combat(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
): StepResult {
  const args = program.nodes[0].arguments;
  const rootActionId = input.rootActionId as string;
  const actor = state.entities[input.actorCharacterId as string]!;
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  const result = stepCombatWorld(profiles, accumulator.state, continueCompoundRoot({
    kind: "invokeAbility",
    rootActionId,
    sourceEntityId: actor.id,
    abilityRef: args.abilityRef,
    parameters: {},
  }, rootActionId));
  if (result === undefined) {
    return rejected("invalidWorldState", "The causal combat primitive has no registered Rules operation.");
  }
  if (result.kind === "rejected") return result;
  if (!("events" in result)) {
    return rejected("invalidWorldState", "The causal combat primitive returned no canonical transition.");
  }
  return {
    ...result,
    events: [...accumulator.events, ...result.events],
  };
}

function actorPlanCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<ActorPlanCausalDraft, { kind: "actorPlan" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "ActorPlan formation needs one canonical duration.");
  }
  if (actorHasActiveActivity(state, actor.id)) {
    return rejected(
      "pendingInputUnresolved",
      "The character is already committed to an active Activity.",
    );
  }
  const npcTimelineId = characterTimelineId(state, parsed.draft.npcRef);
  const npcTimeline = npcTimelineId === undefined ? undefined : state.fictionTimelines[npcTimelineId];
  if (npcTimeline === undefined) {
    return rejected("privateOrUnknownReference", "The ActorPlan NPC timeline is unavailable.");
  }
  const due = parsed.draft.due === null
    ? null
    : {
        kind: "fictionTime" as const,
        atFictionMicros: (
          BigInt(npcTimeline.nowMicros)
          + BigInt(parsed.draft.activity.intendedDurationMicros)
        ).toString(),
      };
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen ActorPlan formation cost is unavailable.");
  }
  const formed = stepActorPlanMechanics(profiles, accumulator.state, continueCompoundRoot({
    kind: "formNpcActorPlan",
    proposalId: rootActionId,
    npcId: parsed.draft.npcRef,
    factionRef: parsed.draft.factionRef,
    planId: parsed.draft.planId,
    goal: parsed.draft.goal,
    premiseRefs: parsed.draft.premiseRefs,
    nextStep: parsed.draft.nextStep,
    resourceRefs: parsed.draft.resourceRefs,
    activity: parsed.draft.activity,
    due,
    trigger: parsed.draft.trigger,
    trace: parsed.draft.trace,
    alternateTarget: parsed.draft.alternateTarget,
  }, rootActionId));
  if (formed === undefined) {
    return rejected("invalidWorldState", "The current ActorPlan formation operation is unavailable.");
  }
  if (formed.kind === "rejected" || formed.kind === "initialized") return formed;
  if (formed.kind !== "committed") {
    return rejected("invalidWorldState", "ActorPlan formation did not commit atomically.");
  }
  accumulator.events.push(...formed.events);
  accumulator.state = formed.state;
  accumulator.receipt = formed.receipt;
  mergeAccumulatorScopeProof(accumulator, formed.scopeProof);
  appendCompletedCausalActivity(
    accumulator,
    profiles,
    rootActionId,
    actor,
    parsed.step,
    durationMicros,
    "actorPlanFormation",
  );
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: "actorPlanFormed",
    },
  });
}

function noncombatContestCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<NoncombatContestCausalDraft, { kind: "contest" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "The opposed check needs one canonical duration.");
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  append(accumulator, profiles, {
    rootActionId,
    eventType: "FictionTimeAdvanced",
    payload: {
      durationMicros,
      reason: programGoal([parsed.step]),
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`timeline:${accumulator.state.activeBranchId}`],
    writes: [`timeline:${accumulator.state.activeBranchId}`, `receipt:${rootActionId}`],
  });
  const mechanical = stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
    kind: "resolveContest",
    proposalId: rootActionId,
    initiatorId: actor.id,
    defenderId: parsed.draft.defenderRef,
    initiatorCheck: {
      ability: parsed.draft.initiatorAbility,
      skill: parsed.draft.initiatorSkill,
      mode: parsed.draft.mode,
    },
    defenderCheck: {
      ability: parsed.draft.defenderAbility,
      skill: parsed.draft.defenderSkill,
      mode: parsed.draft.mode,
    },
    tieResult: parsed.draft.tieResult,
  }, rootActionId));
  if (mechanical === undefined) {
    return rejected("invalidWorldState", "The opposed check has no registered Rules operation.");
  }
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  if (mechanical.kind !== "awaitingRandomness") {
    return rejected("invalidWorldState", "The opposed check did not freeze both authoritative dice.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  const {
    kind: _kind,
    events: _events,
    state: _state,
    cache: _cache,
    stateHash: _stateHash,
    scopeProof: _scopeProof,
    receipt: _receipt,
    ...additions
  } = mechanical;
  return finished("awaitingRandomness", accumulator, additions as JsonRecord);
}

function campaignLifecycleCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<CampaignLifecycleCausalDraft, { kind: "lifecycle" }>,
): StepResult {
  if (parsed.draft.action === "retryFailedAction") {
    return rejected("invalidRulesInput", "A failed-action retry must use the frozen check path.");
  }
  const rootActionId = input.rootActionId as string;
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  const draft = parsed.draft;
  let command: JsonRecord;
  if (draft.action === "raiseEndingCandidate") {
    command = {
      kind: "raiseEndingCandidate",
      proposalId: rootActionId,
      endingCandidateId: draft.endingCandidateRef,
      basisFactIds: [...draft.basisRefs],
      unresolvedConsequences: [...draft.unresolvedRefs],
    };
  } else if (draft.action === "concludeStory") {
    command = {
      kind: "concludeStory",
      proposalId: rootActionId,
      storyId: draft.storyRef,
      endingCandidateId: draft.endingCandidateRef,
      outcome: draft.outcome,
      longTermConsequences: [...draft.consequenceRefs],
    };
  } else if (draft.action === "transitionChapter") {
    const campaign = accumulator.state.campaignRuntime.campaign;
    const campaignId = isRecord(campaign) && isNonEmptyString(campaign.campaignId)
      ? campaign.campaignId
      : undefined;
    const fromChapterId = isRecord(campaign) && isNonEmptyString(campaign.currentChapterId)
      ? campaign.currentChapterId
      : undefined;
    const currentChapter = fromChapterId === undefined
      ? undefined
      : accumulator.state.campaignRuntime.chapters[fromChapterId];
    const currentOrdinal = isRecord(currentChapter)
      && typeof currentChapter.ordinal === "string"
      && /^(0|[1-9][0-9]*)$/u.test(currentChapter.ordinal)
      ? currentChapter.ordinal
      : undefined;
    if (campaignId === undefined || fromChapterId === undefined || currentOrdinal === undefined) {
      return rejected("invalidWorldState", "The active Campaign chapter cannot be derived canonically.");
    }
    command = {
      kind: "transitionChapter",
      proposalId: rootActionId,
      campaignId,
      fromChapterId,
      toChapterId: draft.chapterRef,
      ordinal: (BigInt(currentOrdinal) + 1n).toString(),
      reason: programMethod([parsed.step]),
      continuityPolicy: "preserveAuthoritativeFacts",
      storyAnchorRefs: [...draft.storyAnchorRefs],
      sceneQuestion: draft.sceneQuestion,
      activityTransitions: structuredClone(draft.activityTransitions),
    };
  } else {
    const durationMicros = causalActionDurationMicros(parsed.step);
    if (durationMicros === undefined) {
      return rejected("invalidRulesInput", "A meaningful failure needs one canonical duration.");
    }
    command = {
      kind: "commitMeaningfulFailure",
      proposalId: rootActionId,
      characterId: actor.id,
      goalId: draft.precedentRef,
      methodFingerprint: programMethod([parsed.step]),
      factualCause: draft.basisRefs.join(";"),
      consequences: {
        fictionTimeCostMicros: durationMicros,
        committedConsequences: [...draft.consequenceRefs],
        newOptions: structuredClone(draft.newOptions),
      },
    };
  }
  const mechanical = stepCampaignWorld(
    profiles,
    accumulator.state,
    continueCompoundRoot(command, rootActionId),
  );
  if (mechanical === undefined) {
    return rejected("invalidWorldState", "The Campaign lifecycle operation is unavailable.");
  }
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  if (mechanical.kind !== "committed" && mechanical.kind !== "concluded") {
    return rejected("invalidWorldState", "The Campaign lifecycle operation did not settle atomically.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  return finished(mechanical.kind, accumulator, {
    mechanicalResult: {
      kind: "campaignLifecycle",
      action: draft.action,
      ...(draft.action === "commitMeaningfulFailure"
        ? {
            meaningfulFailure: true,
            newOptions: structuredClone(draft.newOptions),
          }
        : {}),
    },
  });
}

function observedFactAcquisitionCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<ObservedFactAcquisitionCausalDraft, { kind: "observedFact" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  const fact = state.canonicalFacts[parsed.draft.factRef];
  const submittedBasisRefs = stringList(parsed.step.arguments.basisRefs);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "Fact observation needs one canonical duration.");
  }
  if (submittedBasisRefs.length !== 1
    || submittedBasisRefs[0] !== parsed.draft.factRef
    || fact === undefined
    || !canonicalFactVisibleToCharacter(state, fact, actor)) {
    return rejected("privateOrUnknownReference", "The observed fact is unavailable to the acting character.");
  }
  if (state.knowledge[actor.id]?.[parsed.draft.factRef] !== undefined) {
    return rejected("invalidWorldState", "The acting character already holds this exact fact evidence.");
  }
  if (actorHasActiveActivity(state, actor.id)) {
    return rejected(
      "pendingInputUnresolved",
      "The character is already committed to an active Activity.",
    );
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen observation cost is unavailable.");
  }
  appendCompletedCausalActivity(
    accumulator,
    profiles,
    rootActionId,
    actor,
    parsed.step,
    durationMicros,
    "observeExistingFact",
  );
  const mechanical = stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
    kind: "acquireSensoryEvidence",
    proposalId: rootActionId,
    characterId: actor.id,
    factId: parsed.draft.factRef,
    sense: "inspection",
    clarity: "full",
    publicEvidence: parsed.draft.observedContent,
  }, rootActionId));
  if (mechanical === undefined) {
    return rejected("invalidWorldState", "The fact-observation Rules operation is unavailable.");
  }
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  if (mechanical.kind !== "committed") {
    return rejected("invalidWorldState", "Fact observation did not commit atomically.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: "existingFactObserved",
    },
  });
}

function itemInformationObservationCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<ItemInformationObservationCausalDraft, { kind: "itemInformation" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  const submittedBasisRefs = stringList(parsed.step.arguments.basisRefs);
  const timelineId = characterTimelineId(state, actor.id);
  const nowMicros = timelineId === undefined
    ? undefined
    : state.fictionTimelines[timelineId]?.nowMicros;
  const itemSystem = state.campaignRuntime.itemSystem;
  const entry = itemSystem.entries[parsed.draft.itemRef];
  const definition = entry === undefined
    ? undefined
    : itemSystem.definitions[entry.definitionRef];
  const sceneAccessible = entry?.disposition === "scene"
    && entry.sceneRef === actor.sceneId
    && itemPolicyVisibleToViewer(
      entry.visibilityPolicyRef,
      { kind: actor.kind, characterId: actor.id },
      entry,
    );
  const heldByActor = entry?.disposition === "held" && entry.holderRef === actor.id;
  if (durationMicros === undefined || nowMicros === undefined) {
    return rejected("invalidRulesInput", "Item-information observation needs canonical Fiction Time.");
  }
  if (submittedBasisRefs.length !== 2
    || submittedBasisRefs[0] !== actor.sceneId
    || submittedBasisRefs[1] !== parsed.draft.itemRef
    || entry === undefined
    || definition === undefined
    || !itemEntryMatchesDefinition(entry, definition)
    || (!sceneAccessible && !heldByActor)) {
    return rejected(
      "privateOrUnknownReference",
      "The information-bearing world item is unavailable to the acting character.",
    );
  }
  if (parsed.draft.information.kind === "sourceClaim"
    && parsed.draft.information.formedAtFictionMicros !== null
    && BigInt(parsed.draft.information.formedAtFictionMicros) > BigInt(nowMicros)) {
    return rejected("invalidRulesInput", "An item source claim cannot be formed in the future.");
  }
  if (state.knowledge[actor.id]?.[parsed.draft.sourceRef] !== undefined) {
    return rejected("invalidWorldState", "The acting character already holds this item information.");
  }
  if (actorHasActiveActivity(state, actor.id)) {
    return rejected(
      "pendingInputUnresolved",
      "The character is already committed to an active Activity.",
    );
  }
  const sourceValue = {
    schema: "zhuwei.item-information-source/v1",
    itemRef: entry.entryId,
    definitionRef: entry.definitionRef,
    definitionRevision: entry.definitionRevision,
    information: structuredClone(parsed.draft.information),
  };
  const sourceFact = state.canonicalFacts[parsed.draft.sourceRef];
  if (sourceFact === undefined) {
    const identityAlreadyUsed = state.campaignRuntime.definitions[parsed.draft.sourceRef] !== undefined
      || state.combatRuntime.definitions[parsed.draft.sourceRef] !== undefined
      || state.campaignRuntime.sourceClaims[parsed.draft.sourceRef] !== undefined
      || Object.values(state.knowledge).some((entries) =>
        entries[parsed.draft.sourceRef] !== undefined);
    if (identityAlreadyUsed) {
      return rejected("invalidWorldState", "The item-information source identity is already in use.");
    }
  } else if (sourceFact.kind !== "itemInformationSource"
    || sourceFact.source !== "observedEvent"
    || sourceFact.visibilityPolicyId !== "visibility:room-authority-only"
    || sourceFact.subjectRefs.length !== 1
    || sourceFact.subjectRefs[0] !== entry.entryId
    || canonicalSha256(sourceFact.value) !== canonicalSha256(sourceValue)) {
    return rejected(
      "privateOrUnknownReference",
      "The frozen item-information source does not match this world item.",
    );
  }

  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen item-observation cost is unavailable.");
  }
  appendCompletedCausalActivity(
    accumulator,
    profiles,
    rootActionId,
    actor,
    parsed.step,
    durationMicros,
    "observeItemInformation",
    {
      additionalReads: [
        `scene:${actor.sceneId}`,
        `item-entry:${entry.entryId}`,
        `item-definition:${entry.definitionRef}`,
      ],
      publicReason: "观察物件",
    },
  );
  if (sourceFact === undefined) {
    append(accumulator, profiles, {
      rootActionId,
      resolutionId: `resolution:${rootActionId}:item-information-source`,
      eventType: "ImprovisedActionResolved",
      payload: {
        actorCharacterId: actor.id,
        outcomeCode: "item-information-source-frozen",
        fact: {
          id: parsed.draft.sourceRef,
          kind: "itemInformationSource",
          subjectRefs: [entry.entryId],
          value: sourceValue,
          visibilityPolicyId: "visibility:room-authority-only",
          source: "observedEvent",
        },
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: [
        `entity:${actor.id}`,
        `scene:${actor.sceneId}`,
        `item-entry:${entry.entryId}`,
        `item-definition:${entry.definitionRef}`,
      ],
      writes: [`fact:${parsed.draft.sourceRef}`, `receipt:${rootActionId}`],
      creates: [`fact:${parsed.draft.sourceRef}`],
    });
  }

  if (parsed.draft.information.kind === "sensoryEvidence") {
    const mechanical = stepCampaignWorld(
      profiles,
      accumulator.state,
      continueCompoundRoot({
        kind: "acquireSensoryEvidence",
        proposalId: rootActionId,
        characterId: actor.id,
        factId: parsed.draft.sourceRef,
        sense: parsed.draft.information.sense,
        clarity: "full",
        publicEvidence: parsed.draft.information.content,
      }, rootActionId),
    );
    if (mechanical === undefined) {
      return rejected("invalidWorldState", "The item-evidence Rules operation is unavailable.");
    }
    if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
    if (mechanical.kind !== "committed") {
      return rejected("invalidWorldState", "Item sensory evidence did not commit atomically.");
    }
    accumulator.events.push(...mechanical.events);
    accumulator.state = mechanical.state;
    accumulator.receipt = mechanical.receipt;
    mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  } else {
    append(accumulator, profiles, {
      rootActionId,
      resolutionId: `resolution:${rootActionId}:item-information-acquired`,
      eventType: "KnowledgeAcquired",
      payload: {
        characterId: actor.id,
        knowledgeRef: parsed.draft.sourceRef,
        objectKind: "sourceClaim",
        layer: "full",
        content: parsed.draft.information.semanticContent,
        causeFactId: parsed.draft.sourceRef,
        acquisition: {
          sense: "worldItemContact",
          sceneId: actor.sceneId,
          method: OBSERVE_ITEM_INFORMATION_METHOD,
        },
        visibility: "private",
      },
      visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
      secrecy: "private",
      reads: [
        `entity:${actor.id}`,
        `scene:${actor.sceneId}`,
        `item-entry:${entry.entryId}`,
        `item-definition:${entry.definitionRef}`,
        `fact:${parsed.draft.sourceRef}`,
      ],
      writes: [`knowledge:${actor.id}:${parsed.draft.sourceRef}`, `receipt:${rootActionId}`],
      creates: [`knowledge:${actor.id}:${parsed.draft.sourceRef}`],
    });
  }
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: "itemInformationObserved",
    },
  });
}

function itemMaterializationCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<ItemMaterializationCausalDraft, { kind: "item" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "Item materialization needs one canonical duration.");
  }
  if (actorHasActiveActivity(state, actor.id)) {
    return rejected(
      "pendingInputUnresolved",
      "The character is already committed to an active Activity.",
    );
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen item materialization cost is unavailable.");
  }
  appendCompletedCausalActivity(
    accumulator,
    profiles,
    rootActionId,
    actor,
    parsed.step,
    durationMicros,
    "itemMaterialization",
  );

  const entryId = `item-entry:materialized:${canonicalSha256({
    actorCharacterId: actor.id,
    definitionRef: parsed.draft.definitionRef,
    nodeRef: parsed.step.nodeRef,
    rootActionId,
  }).slice("sha256:".length)}`;
  const mechanical = stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
    kind: "materializeItem",
    proposalId: rootActionId,
    actorCharacterId: actor.id,
    definition: healingPotionItemDefinition(),
    entryId,
    quantity: parsed.draft.quantity,
    sceneId: actor.sceneId,
  }, rootActionId));
  if (mechanical === undefined) {
    return rejected(
      "invalidWorldState",
      "The item materialization primitive has no registered Rules operation.",
    );
  }
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  if (mechanical.kind !== "committed") {
    return rejected("invalidWorldState", "Item materialization did not commit atomically.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: "itemMaterialized",
    },
  });
}

function narrativeItemDefinition(
  draft: NarrativeItemMaterializationDraft,
): ItemDefinitionV1 {
  return {
    schema: ITEM_DEFINITION_SCHEMA,
    definitionKind: "item",
    definitionId: draft.definitionRef,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    causalBasisRefs: [...draft.causalBasisRefs].sort(),
    visibilityPolicyRef: "visibility:scene-observers",
    content: {
      schema: ITEM_DEFINITION_CONTENT_SCHEMA,
      label: draft.name,
      description: draft.description,
      category: "object",
      aliases: [],
      tags: [],
      stackable: false,
      equipment: null,
      equippedAbilityRefs: [],
      use: null,
      chargesMaximum: null,
      durabilityMaximum: null,
    },
  };
}

function narrativeItemMaterializationCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<NarrativeItemMaterializationCausalDraft, { kind: "narrativeItem" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "Narrative item materialization needs one canonical duration.");
  }
  if (actorHasActiveActivity(state, actor.id)) {
    return rejected(
      "pendingInputUnresolved",
      "The character is already committed to an active Activity.",
    );
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen narrative item cost is unavailable.");
  }
  appendCompletedCausalActivity(
    accumulator,
    profiles,
    rootActionId,
    actor,
    parsed.step,
    durationMicros,
    "narrativeItemMaterialization",
  );

  const definition = narrativeItemDefinition(parsed.draft);
  const command: JsonRecord = parsed.draft.action === "materializeInScene"
    ? {
        kind: "materializeSceneItem",
        proposalId: rootActionId,
        definition,
        entryId: parsed.draft.entryRef,
        quantity: 1,
        sceneId: actor.sceneId,
      }
    : {
        kind: "materializeItem",
        proposalId: rootActionId,
        actorCharacterId: actor.id,
        definition,
        entryId: parsed.draft.entryRef,
        quantity: 1,
        sceneId: actor.sceneId,
      };
  const mechanical = stepCampaignWorld(
    profiles,
    accumulator.state,
    continueCompoundRoot(command, rootActionId),
  );
  if (mechanical === undefined) {
    return rejected(
      "invalidWorldState",
      "The narrative item materialization Rules operation is unavailable.",
    );
  }
  if (mechanical.kind === "needsKp") return needsKp(state, mechanical.diagnostics);
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  if (mechanical.kind !== "committed") {
    return rejected("invalidWorldState", "Narrative item materialization did not commit atomically.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: parsed.draft.action === "materializeInScene"
        ? "narrativeItemMaterializedInScene"
        : "narrativeItemMaterializedAndAcquired",
    },
  });
}

function sceneItemAcquisitionCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<SceneItemAcquisitionCausalDraft, { kind: "sceneItemAcquisition" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "Scene item acquisition needs one canonical duration.");
  }
  if (actorHasActiveActivity(state, actor.id)) {
    return rejected(
      "pendingInputUnresolved",
      "The character is already committed to an active Activity.",
    );
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen scene item acquisition cost is unavailable.");
  }
  appendCompletedCausalActivity(
    accumulator,
    profiles,
    rootActionId,
    actor,
    parsed.step,
    durationMicros,
    "sceneItemAcquisition",
  );
  const mechanical = stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
    kind: "acquireItem",
    proposalId: rootActionId,
    characterId: actor.id,
    itemId: parsed.draft.itemRef,
  }, rootActionId));
  if (mechanical === undefined) {
    return rejected("invalidWorldState", "The scene item acquisition Rules operation is unavailable.");
  }
  if (mechanical.kind === "needsKp") return needsKp(state, mechanical.diagnostics);
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  if (mechanical.kind !== "committed") {
    return rejected("invalidWorldState", "Scene item acquisition did not commit atomically.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: "sceneItemAcquired",
    },
  });
}

function worldConsequenceEffects(
  actor: CharacterRecord,
  draft: CompoundWorldConsequenceDraft,
): CompoundActionEffect[] {
  return draft.consequences.map((consequence): CompoundActionEffect => {
    switch (consequence.kind) {
      case "spendResource":
        return {
          kind: "changeResource",
          targetRef: actor.id,
          resourceRef: consequence.resourceRef,
          amount: -consequence.amount,
        };
      case "acquireKnowledge":
        return {
          kind: "acquireKnowledge",
          knowledgeRef: consequence.knowledgeRef,
          value: consequence.content,
          definitionRef: draft.factRef,
        };
      case "updateRelationship":
        return {
          kind: "updateRelationship",
          relationshipRef: consequence.relationshipRef,
          subjectRefs: [...new Set([actor.id, ...consequence.counterpartyRefs])].sort(),
          change: consequence.change,
          basisFactIds: [draft.factRef],
        };
      case "recordPromise":
        return {
          kind: "recordCommitment",
          commitmentRef: consequence.promiseRef,
          promisorRef: actor.id,
          promiseeRef: consequence.counterpartyRef,
          content: consequence.content,
          condition: consequence.condition,
        };
      case "recordDebt":
        return {
          kind: "recordDebt",
          debtRef: consequence.debtRef,
          debtorRef: actor.id,
          creditorRef: consequence.counterpartyRef,
          obligation: consequence.obligation,
          condition: consequence.condition,
          basisFactIds: [draft.factRef],
        };
    }
  });
}

function worldConsequenceBasisScope(
  state: AuthoritativeWorldState,
  reference: string,
): string {
  if (state.scenes[reference] !== undefined) return `scene:${reference}`;
  if (state.entities[reference] !== undefined) return `entity:${reference}`;
  return `fact:${reference}`;
}

function worldConsequenceCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<WorldConsequenceCausalDraft, { kind: "worldConsequences" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "World consequences need one canonical duration.");
  }
  if (!worldConsequenceBasisAvailable(state, actor, parsed)) {
    return rejected(
      "privateOrUnknownReference",
      "A world-consequence subject or causal basis is unavailable to the acting character.",
    );
  }
  const basisRefs = stringList(parsed.step.arguments.basisRefs);
  const counterparties = worldConsequenceCounterpartyRefs(parsed.draft);
  const subjectRefs = [...new Set([actor.id, actor.sceneId, ...counterparties])].sort();
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:world-consequences`,
    eventType: "DefinitionRegistered",
    payload: {
      definition: {
        definitionId: parsed.draft.factRef,
        definitionVersion: "1",
        definitionKind: "materializedOpenFact",
        causalBasisRefs: [...basisRefs],
        visibilityPolicyRef: "visibility:scene-observers",
        definitionProfile: structuredClone(CAUSAL_ACTION_INTERPRETER_PROFILE),
        actionLanguage: {
          languageRef: program.languageRef,
          languageHash: program.languageHash,
          formRef: program.formRef,
          formHash: program.formHash,
        },
        content: {
          schema: "zhuwei.world-consequence-fact/v1",
          summary: parsed.draft.summary,
          consequenceKinds: parsed.draft.consequences.map(({ kind }) => kind),
        },
      },
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [
      `entity:${actor.id}`,
      `fact:${causalProgramFactRef(rootActionId, program.semanticHash)}`,
      ...basisRefs.map((reference) => worldConsequenceBasisScope(accumulator.state, reference)),
    ],
    writes: [`definition:${parsed.draft.factRef}`, `receipt:${rootActionId}`],
    creates: [`definition:${parsed.draft.factRef}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:world-consequences`,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: actor.id,
      outcomeCode: "world-consequences-materialized",
      fact: {
        id: parsed.draft.factRef,
        kind: "worldConsequence",
        subjectRefs,
        value: {
          schema: "zhuwei.world-consequence-fact/v1",
          summary: parsed.draft.summary,
        },
        visibilityPolicyId: "visibility:scene-observers",
        source: "dynamicMaterialization",
      },
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [
      `entity:${actor.id}`,
      `definition:${parsed.draft.factRef}`,
      ...basisRefs.map((reference) => worldConsequenceBasisScope(accumulator.state, reference)),
    ],
    writes: [`fact:${parsed.draft.factRef}`, `receipt:${rootActionId}`],
    creates: [`fact:${parsed.draft.factRef}`],
  });
  const plan: CompoundResolutionPlan = {
    schema: "zhuwei.compound-resolution-plan/v1",
    actorCharacterId: actor.id,
    goal: programGoal([parsed.step]),
    method: programMethod([parsed.step]),
    sourceSceneId: actor.sceneId,
    durationMicros,
    primaryFactRef: parsed.draft.factRef,
    frozenCosts: [],
    successEffects: worldConsequenceEffects(actor, parsed.draft),
    failureEffects: [],
  };
  const mechanical = resolveDirectCompoundConsequences(
    profiles,
    accumulator.state,
    rootActionId,
    `resolution:${rootActionId}:world-consequences`,
    plan,
  );
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  if (mechanical.kind !== "committed") {
    return rejected("invalidWorldState", "World consequences did not commit atomically.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: "worldConsequencesCommitted",
    },
  });
}

function definitionRegistrationCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<
    DefinitionRegistrationCausalDraft,
    { kind: "abilityDefinition" | "factionDefinition" }
  >,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "Definition registration needs one canonical duration.");
  }
  if (!definitionRegistrationBasisAvailable(state, actor, parsed)) {
    return rejected(
      "privateOrUnknownReference",
      "The definition subjects or causal basis are unavailable to the acting character.",
    );
  }
  if (actorHasActiveActivity(state, actor.id)) {
    return rejected(
      "pendingInputUnresolved",
      "The character is already committed to an active Activity.",
    );
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen definition-registration cost is unavailable.");
  }
  appendCompletedCausalActivity(
    accumulator,
    profiles,
    rootActionId,
    actor,
    parsed.step,
    durationMicros,
    parsed.kind === "abilityDefinition"
      ? "abilityDefinitionRegistration"
      : "factionDefinitionRegistration",
  );
  const definition: JsonRecord = parsed.kind === "abilityDefinition"
    ? structuredClone(parsed.draft.definition)
    : {
        definitionId: parsed.draft.factionRef,
        revision: "1",
        definitionKind: "faction",
        rulesBasis: "zhuwei-product-ruling",
        causalBasisRefs: [...parsed.draft.causalBasisRefs],
        visibilityPolicyRef: "visibility:room-authority-only",
        content: {
          schema: "zhuwei.faction-definition/v1",
          factionId: parsed.draft.factionRef,
          name: parsed.draft.name,
          goal: parsed.draft.goal,
          memberRefs: [...parsed.draft.memberRefs],
          resourceRefs: [...parsed.draft.resourceRefs],
        },
      };
  const mechanical = stepCampaignWorld(
    profiles,
    accumulator.state,
    continueCompoundRoot({
      kind: "registerDynamicDefinition",
      proposalId: rootActionId,
      definition,
    }, rootActionId),
  );
  if (mechanical === undefined) {
    return rejected("invalidWorldState", "The definition registration Rules operation is unavailable.");
  }
  if (mechanical.kind === "needsKp") return needsKp(state, mechanical.diagnostics);
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  if (mechanical.kind !== "committed") {
    return rejected("invalidWorldState", "Definition registration did not commit atomically.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: parsed.kind === "abilityDefinition"
        ? "abilityDefinitionRegistered"
        : "factionDefinitionRegistered",
    },
  });
}

function dynamicPassageMoveCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<DynamicPassageMoveCausalDraft, { kind: "passageMove" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "Dynamic passage movement needs one canonical duration.");
  }
  const draft = parsed.draft;
  const submittedBasisRefs = stringList(parsed.step.arguments.basisRefs);
  const causalBasisRefs = submittedBasisRefs
    .filter((reference) => reference !== actor.sceneId)
    .sort((left, right) => left.localeCompare(right));
  const resolutionId = `resolution:${rootActionId}:causal:${parsed.step.nodeRef}`;
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen passage movement cost is unavailable.");
  }
  append(accumulator, profiles, {
    rootActionId,
    resolutionId,
    eventType: "DefinitionRegistered",
    payload: {
      definition: {
        definitionId: draft.locationRef,
        definitionVersion: "1",
        definitionKind: "location",
        causalBasisRefs,
        visibilityPolicyRef: "visibility:scene-observers",
        content: {
          sceneId: draft.destinationSceneRef,
          name: draft.destinationName,
          geometry: structuredClone(draft.geometry),
        },
      },
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [
      `scene:${actor.sceneId}`,
      ...causalBasisRefs.map((factRef) => `fact:${factRef}`),
    ],
    writes: [`definition:${draft.locationRef}`, `receipt:${rootActionId}`],
    creates: [`definition:${draft.locationRef}`, `scene:${draft.destinationSceneRef}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId,
    eventType: "CanonicalFactDeclared",
    payload: {
      fact: {
        id: draft.locationRef,
        kind: "dynamic:location",
        subjectRefs: [actor.id, draft.destinationSceneRef].sort(),
        value: {
          definitionRef: draft.locationRef,
          kind: "location",
          sceneRef: draft.destinationSceneRef,
        },
        visibilityPolicyId: "visibility:scene-observers",
        source: "dynamicMaterialization",
        causalParentIds: causalBasisRefs,
      },
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [
      `definition:${draft.locationRef}`,
      ...causalBasisRefs.map((factRef) => `fact:${factRef}`),
    ],
    writes: [`fact:${draft.locationRef}`, `receipt:${rootActionId}`],
    creates: [`fact:${draft.locationRef}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId,
    eventType: "DefinitionRegistered",
    payload: {
      definition: {
        definitionId: draft.passageRef,
        definitionVersion: "1",
        definitionKind: "passage",
        causalBasisRefs,
        visibilityPolicyRef: "visibility:scene-observers",
        content: {
          passageId: draft.passageRef,
          fromSceneRef: actor.sceneId,
          toSceneRef: draft.destinationSceneRef,
          traversal: draft.traversal,
        },
      },
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [
      `scene:${actor.sceneId}`,
      `scene:${draft.destinationSceneRef}`,
      ...causalBasisRefs.map((factRef) => `fact:${factRef}`),
    ],
    writes: [`definition:${draft.passageRef}`, `receipt:${rootActionId}`],
    creates: [`definition:${draft.passageRef}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId,
    eventType: "CanonicalFactDeclared",
    payload: {
      fact: {
        id: draft.passageRef,
        kind: "dynamic:passage",
        subjectRefs: [actor.id, actor.sceneId, draft.destinationSceneRef].sort(),
        value: {
          definitionRef: draft.passageRef,
          kind: "passage",
          fromSceneRef: actor.sceneId,
          toSceneRef: draft.destinationSceneRef,
        },
        visibilityPolicyId: "visibility:scene-observers",
        source: "dynamicMaterialization",
        causalParentIds: causalBasisRefs,
      },
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [
      `definition:${draft.passageRef}`,
      ...causalBasisRefs.map((factRef) => `fact:${factRef}`),
    ],
    writes: [`fact:${draft.passageRef}`, `receipt:${rootActionId}`],
    creates: [`fact:${draft.passageRef}`],
  });
  const movement = stepMultiplayerWorld(profiles, accumulator.state, continueCompoundRoot({
    kind: "moveIndividually",
    rootActionId,
    characterId: actor.id,
    destinationSceneId: draft.destinationSceneRef,
    fictionTimeCostMicros: durationMicros,
  }, rootActionId));
  if (movement === undefined) {
    return rejected("invalidWorldState", "The individual movement operation is unavailable.");
  }
  if (movement.kind === "rejected" || movement.kind === "initialized") return movement;
  if (movement.kind !== "committed") {
    return rejected("invalidWorldState", "Dynamic passage movement did not commit atomically.");
  }
  accumulator.events.push(...movement.events);
  accumulator.state = movement.state;
  accumulator.receipt = movement.receipt;
  mergeAccumulatorScopeProof(accumulator, movement.scopeProof);
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: true,
      disposition: "dynamicPassageMaterializedAndMoved",
    },
  });
}

function npcMechanicalCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Exclude<NpcMechanicalCausalDraft, { kind: "none" | "invalid" }>,
): StepResult {
  if (!npcMechanicsProfileEnabled(profiles.extensions)) {
    return rejected(
      "unsupportedOperation",
      "The pinned room profile does not enable NPC mechanical materialization.",
    );
  }
  const rootActionId = input.rootActionId as string;
  const durationMicros = parsed.kind === "gear"
    ? undefined
    : causalActionDurationMicros(parsed.step);
  if (parsed.kind !== "gear" && durationMicros === undefined) {
    return rejected("invalidRulesInput", "NPC mechanical materialization needs one canonical duration.");
  }
  if (parsed.kind !== "encounter"
    && parsed.kind !== "gear"
    && actorHasActiveActivity(state, actor.id)) {
    return rejected(
      "pendingInputUnresolved",
      "The character is already committed to an active Activity.",
    );
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen causal materialization cost is unavailable.");
  }

  if (parsed.kind !== "encounter" && parsed.kind !== "gear") {
    appendCompletedCausalActivity(
      accumulator,
      profiles,
      rootActionId,
      actor,
      parsed.step,
      durationMicros!,
      parsed.kind === "transfer"
        ? "itemTransfer"
        : "npcItemLifecycleChange",
    );
  }

  let mechanical: StepResult | undefined;
  let disposition: string;
  if (parsed.kind === "encounter") {
    const battlefieldFactIds = [...new Set(
      stringList(parsed.step.arguments.basisRefs)
        .filter((reference) => reference in accumulator.state.canonicalFacts),
    )].sort((left, right) => left.localeCompare(right));
    const allies = [...new Set([actor.id, ...parsed.draft.alliedEntityRefs])].sort();
    const hostiles = [...parsed.draft.hostileEntityRefs].sort();
    if (hostiles.includes(actor.id)
      || allies.some((entityId) => hostiles.includes(entityId))) {
      return rejected("invalidRulesInput", "Encounter sides must be disjoint and keep the trusted actor allied.");
    }
    const participantEntityIds = [...new Set([...allies, ...hostiles])].sort();
    mechanical = stepCombatWorld(profiles, accumulator.state, continueCompoundRoot({
      kind: "startEncounter",
      rootActionId,
      proposalAttemptId: `proposal:${rootActionId}:causal`,
      encounterId: parsed.draft.encounterRef,
      sceneId: actor.sceneId,
      participantEntityIds,
      dynamicEntities: structuredClone(parsed.draft.entries),
      initiativeGroups: participantEntityIds.map((entityId) => ({
        entryId: `initiative:${parsed.draft.encounterRef}:${entityId}`,
        combatantEntityIds: [entityId],
      })),
      hostilities: [
        { fromEntityIds: allies, toEntityIds: hostiles },
        { fromEntityIds: hostiles, toEntityIds: allies },
      ],
      battlefieldFactIds,
      surprisedEntityIds: [],
    }, rootActionId));
    disposition = "npcMechanicalEncounterStarted";
  } else if (parsed.kind === "transfer") {
    mechanical = stepCampaignWorld(profiles, accumulator.state, continueCompoundRoot({
      kind: "transferItem",
      proposalId: rootActionId,
      fromCharacterId: actor.id,
      toCharacterId: parsed.draft.toCharacterRef,
      itemId: parsed.draft.itemRef,
      quantity: parsed.draft.quantity,
      method: ITEM_TRANSFER_METHOD,
      ownershipDisposition: parsed.draft.ownershipDisposition,
    }, rootActionId));
    disposition = "itemTransferred";
  } else if (parsed.kind === "gear") {
    const npc = accumulator.state.entities[parsed.draft.npcRef];
    if (npc?.kind !== "npc"
      || npc.tenureStatus !== "active"
      || npc.sceneId !== actor.sceneId) {
      return rejected("privateOrUnknownReference", "The NPC gear target is unavailable in this scene.");
    }
    mechanical = stepMultiplayerWorld(profiles, accumulator.state, continueCompoundRoot({
      kind: "changeNpcGear",
      rootActionId,
      npcCharacterId: parsed.draft.npcRef,
      action: parsed.draft.action,
      slot: parsed.draft.slot,
      ...(parsed.draft.action === "wear" ? { itemId: parsed.draft.itemRef } : {}),
    }, rootActionId));
    disposition = "npcGearChanged";
  } else {
    const npc = accumulator.state.entities[parsed.draft.npcRef];
    if (npc?.kind !== "npc"
      || npc.tenureStatus !== "active"
      || npc.sceneId !== actor.sceneId) {
      return rejected("privateOrUnknownReference", "The NPC item-state target is unavailable.");
    }
    mechanical = stepMultiplayerWorld(profiles, accumulator.state, continueCompoundRoot({
      kind: "changeNpcItemState",
      rootActionId,
      actorCharacterId: actor.id,
      npcCharacterId: parsed.draft.npcRef,
      itemId: parsed.draft.itemRef,
      action: parsed.draft.action,
      causeFactRef: parsed.draft.causeFactRef,
    }, rootActionId));
    disposition = "npcMechanicalItemStateChanged";
  }

  if (mechanical === undefined) {
    return rejected("invalidWorldState", "The registered NPC mechanical operation is unavailable.");
  }
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  const mechanicalResult = {
    kind: parsed.kind === "encounter" && mechanical.kind === "awaitingRandomness"
      ? "causalActionProgramPending"
      : "causalActionProgram",
    languageRef: program.languageRef,
    languageHash: program.languageHash,
    programHash: program.semanticHash,
    formRef: program.formRef,
    succeeded: true,
    disposition,
  };
  if (parsed.kind === "encounter") {
    return {
      ...mechanical,
      events: [...accumulator.events, ...mechanical.events],
      mechanicalResult,
    } as StepResult;
  }
  if (mechanical.kind !== "committed") {
    return rejected("invalidWorldState", "A direct inventory or gear operation did not commit atomically.");
  }
  accumulator.events.push(...mechanical.events);
  accumulator.state = mechanical.state;
  accumulator.receipt = mechanical.receipt;
  mergeAccumulatorScopeProof(accumulator, mechanical.scopeProof);
  return finished("committed", accumulator, { mechanicalResult });
}

function itemMaterializationBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<ItemMaterializationCausalDraft, { kind: "item" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const refs = [...new Set(submittedRefs)];
  if (refs.length !== submittedRefs.length
    || refs.length < 2
    || !refs.includes(actor.sceneId)
    || state.scenes[actor.sceneId] === undefined
    || state.campaignRuntime.itemSystem === undefined) return false;
  const causalRefs = refs.filter((reference) => reference !== actor.sceneId);
  return causalRefs.length > 0 && causalRefs.every((reference) => {
    const fact = state.canonicalFacts[reference];
    return fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor);
  });
}

function narrativeItemMaterializationBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<NarrativeItemMaterializationCausalDraft, { kind: "narrativeItem" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const requiredRefs = [actor.sceneId, ...parsed.draft.causalBasisRefs];
  if (submittedRefs.length !== requiredRefs.length
    || submittedRefs.length !== new Set(submittedRefs).size
    || submittedRefs.some((reference, index) => reference !== requiredRefs[index])
    || state.scenes[actor.sceneId] === undefined
    || state.campaignRuntime.itemSystem === undefined) return false;
  return parsed.draft.causalBasisRefs.every((reference) => {
    const fact = state.canonicalFacts[reference];
    return fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor);
  });
}

function sceneItemAcquisitionBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<SceneItemAcquisitionCausalDraft, { kind: "sceneItemAcquisition" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const entry = state.campaignRuntime.itemSystem?.entries[parsed.draft.itemRef];
  return submittedRefs.length === 2
    && submittedRefs[0] === actor.sceneId
    && submittedRefs[1] === parsed.draft.itemRef
    && submittedRefs[0] !== submittedRefs[1]
    && state.scenes[actor.sceneId] !== undefined
    && entry?.disposition === "scene"
    && entry.sceneRef === actor.sceneId;
}

function dynamicPassageMoveBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<DynamicPassageMoveCausalDraft, { kind: "passageMove" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const refs = [...new Set(submittedRefs)];
  const draft = parsed.draft;
  if (refs.length !== submittedRefs.length
    || refs.length < 1
    || !refs.includes(actor.sceneId)
    || state.scenes[actor.sceneId] === undefined
    || characterTimelineId(state, actor.id) === undefined
    || draft.destinationSceneRef === actor.sceneId
    || state.scenes[draft.destinationSceneRef] !== undefined
    || state.campaignRuntime.definitions[draft.locationRef] !== undefined
    || state.campaignRuntime.definitions[draft.passageRef] !== undefined
    || state.combatRuntime.definitions[draft.locationRef] !== undefined
    || state.combatRuntime.definitions[draft.passageRef] !== undefined
    || state.canonicalFacts[draft.locationRef] !== undefined
    || state.canonicalFacts[draft.passageRef] !== undefined) return false;
  return refs.every((reference) => {
    if (reference === actor.sceneId) return true;
    const fact = state.canonicalFacts[reference];
    return fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor);
  });
}

function npcMechanicalBasisAvailable(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Exclude<NpcMechanicalCausalDraft, { kind: "none" | "invalid" }>,
): boolean {
  const refs = [...new Set(stringList(parsed.step.arguments.basisRefs))];
  if (refs.length === 0 || refs.length !== stringList(parsed.step.arguments.basisRefs).length) {
    return false;
  }
  const requiredRefs = new Set<string>([actor.sceneId]);
  const allowedRefs = new Set<string>([actor.id, actor.sceneId]);
  const visibleFactRefs = Object.values(state.canonicalFacts)
    .filter((fact) => canonicalFactVisibleToCharacter(state, fact, actor))
    .map(({ id }) => id);
  for (const factRef of visibleFactRefs) allowedRefs.add(factRef);

  if (parsed.kind === "encounter") {
    const entryIds = new Set(parsed.draft.entries.map((entry) => entry.entityId as string));
    const localDefinitionRefs = new Set(parsed.draft.entries.flatMap((entry) => {
      const mechanics = isRecord(entry.mechanics) ? entry.mechanics : undefined;
      return mechanics?.kind === "bespokeDefinition"
        && isRecord(mechanics.definition)
        && isNonEmptyString(mechanics.definition.definitionId)
        ? [mechanics.definition.definitionId]
        : [];
    }));
    let createsNewEntity = false;
    for (const entityId of [
      ...parsed.draft.alliedEntityRefs,
      ...parsed.draft.hostileEntityRefs,
    ]) {
      if (entityId === actor.id) continue;
      const existing = state.entities[entityId] ?? state.combatRuntime.entities[entityId];
      if (existing !== undefined) {
        if (existing.sceneId !== actor.sceneId) return false;
        requiredRefs.add(entityId);
        allowedRefs.add(entityId);
      } else if (!entryIds.has(entityId)) {
        return false;
      }
    }
    for (const entry of parsed.draft.entries) {
      const entityId = entry.entityId as string;
      const existing = state.entities[entityId] ?? state.combatRuntime.entities[entityId];
      if (existing === undefined) {
        createsNewEntity = true;
      } else {
        if (existing.sceneId !== actor.sceneId) return false;
        requiredRefs.add(entityId);
        allowedRefs.add(entityId);
      }
      const mechanics = isRecord(entry.mechanics) ? entry.mechanics : undefined;
      if (mechanics?.kind === "templateRef" && isNonEmptyString(mechanics.definitionRef)) {
        if (state.combatRuntime.definitions[mechanics.definitionRef] === undefined) {
          if (!localDefinitionRefs.has(mechanics.definitionRef)) return false;
        } else {
          requiredRefs.add(mechanics.definitionRef);
          allowedRefs.add(mechanics.definitionRef);
        }
      } else if (mechanics?.kind === "bespokeDefinition" && isRecord(mechanics.definition)) {
        const causalBasisRefs = boundedReferenceList(mechanics.definition.causalBasisRefs, 24);
        if (causalBasisRefs === undefined) return false;
        for (const factRef of causalBasisRefs) {
          if (!visibleFactRefs.includes(factRef)) return false;
          requiredRefs.add(factRef);
        }
        const content = isRecord(mechanics.definition.content)
          ? mechanics.definition.content
          : undefined;
        const itemDefinitionRefs = boundedReferenceList(content?.itemDefinitionRefs, 24);
        if (itemDefinitionRefs === undefined) return false;
        for (const itemDefinitionRef of itemDefinitionRefs) {
          if (state.combatRuntime.definitions[itemDefinitionRef] === undefined) return false;
          requiredRefs.add(itemDefinitionRef);
          allowedRefs.add(itemDefinitionRef);
        }
        if (!Array.isArray(content?.itemDefinitions)
          || !content.itemDefinitions.every(isRecord)) return false;
        for (const itemDefinition of content.itemDefinitions) {
          const itemBasisRefs = boundedReferenceList(itemDefinition.causalBasisRefs, 24);
          if (itemBasisRefs === undefined) return false;
          for (const factRef of itemBasisRefs) {
            if (!visibleFactRefs.includes(factRef)) return false;
            requiredRefs.add(factRef);
          }
        }
      } else {
        return false;
      }
    }
    if (createsNewEntity && !refs.some((ref) => visibleFactRefs.includes(ref))) return false;
  } else if (parsed.kind === "transfer") {
    const target = state.entities[parsed.draft.toCharacterRef];
    const item = actor.loadout?.backpack.find(({ itemId }) => itemId === parsed.draft.itemRef);
    if (target === undefined
      || target.tenureStatus !== "active"
      || target.sceneId !== actor.sceneId
      || item === undefined) return false;
    requiredRefs.add(target.id);
    requiredRefs.add(item.itemId);
    allowedRefs.add(target.id);
    allowedRefs.add(item.itemId);
    const targetCombat = state.combatRuntime.entities[target.id];
    if (isRecord(targetCombat) && isNonEmptyString(targetCombat.mechanicalDefinitionRef)) {
      allowedRefs.add(targetCombat.mechanicalDefinitionRef);
    }
  } else {
    const npc = state.entities[parsed.draft.npcRef];
    const combat = state.combatRuntime.entities[parsed.draft.npcRef];
    if (npc?.kind !== "npc"
      || npc.tenureStatus !== "active"
      || npc.sceneId !== actor.sceneId
      || !isRecord(combat)
      || !isNonEmptyString(combat.mechanicalDefinitionRef)) return false;
    requiredRefs.add(npc.id);
    allowedRefs.add(npc.id);
    allowedRefs.add(combat.mechanicalDefinitionRef);
    if (parsed.kind === "gear" && parsed.draft.action === "wear") {
      const itemRef = parsed.draft.itemRef;
      const item = npc.loadout?.backpack.find(({ itemId }) => itemId === itemRef);
      if (item === undefined) return false;
      requiredRefs.add(item.itemId);
      allowedRefs.add(item.itemId);
    } else if (parsed.kind === "itemState") {
      const itemId = parsed.draft.itemRef;
      const itemInstanceAvailable =
        state.campaignRuntime.itemSystem.entries[itemId]?.disposition === "held"
        && state.campaignRuntime.itemSystem.entries[itemId]?.holderRef === npc.id;
      if (!itemInstanceAvailable
        || !visibleFactRefs.includes(parsed.draft.causeFactRef)
        || !npcMechanicalItemStateCauseAvailable(state, {
          actorCharacterId: actor.id,
          npcCharacterId: parsed.draft.npcRef,
          itemId: parsed.draft.itemRef,
          action: parsed.draft.action,
          causeFactRef: parsed.draft.causeFactRef,
        })) return false;
      requiredRefs.add(itemId);
      requiredRefs.add(parsed.draft.causeFactRef);
      allowedRefs.add(itemId);
    }
  }
  return [...requiredRefs].every((reference) => refs.includes(reference))
    && refs.every((reference) => allowedRefs.has(reference));
}

function actorPlanBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<ActorPlanCausalDraft, { kind: "actorPlan" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const refs = [...new Set(submittedRefs)];
  const npc = state.entities[parsed.draft.npcRef];
  if (refs.length !== submittedRefs.length
    || !actorPlanNpcIsAvailable(npc)
    || npc.sceneId !== actor.sceneId) return false;
  const triggerRef = parsed.draft.trigger === null
    ? undefined
    : parsed.draft.trigger.kind === "knowledgeAcquired"
      ? parsed.draft.trigger.knowledgeRef
      : parsed.draft.trigger.eventRef;
  const requiredRefs = new Set([
    actor.sceneId,
    parsed.draft.npcRef,
    ...(parsed.draft.factionRef === null ? [] : [parsed.draft.factionRef]),
    ...parsed.draft.premiseRefs,
    ...parsed.draft.resourceRefs,
    parsed.draft.alternateTarget.targetRef,
    ...(triggerRef === undefined ? [] : [triggerRef]),
  ]);
  return [...requiredRefs].every((reference) => refs.includes(reference))
    && refs.every((reference) => requiredRefs.has(reference));
}

function hiddenRealityBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<HiddenRealityCausalDraft, { kind: "hiddenReality" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const refs = [...new Set(submittedRefs)];
  const requiredRefs = new Set([
    actor.sceneId,
    ...parsed.draft.candidates.flatMap(({ causalBasisRefs }) => causalBasisRefs),
  ]);
  if (refs.length !== submittedRefs.length
    || refs.length !== requiredRefs.size
    || refs.some((reference) => !requiredRefs.has(reference))
    || [...requiredRefs].some((reference) => !refs.includes(reference))) return false;
  return state.scenes[actor.sceneId] !== undefined
    && parsed.draft.candidates.every((candidate) =>
      state.canonicalFacts[candidate.factRef] === undefined
      && state.campaignRuntime.definitions[candidate.factRef] === undefined
      && candidate.causalBasisRefs.every((factRef) => state.canonicalFacts[factRef] !== undefined)
      && candidate.visibilityPolicyRef.startsWith("visibility:"));
}

function noncombatContestBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<NoncombatContestCausalDraft, { kind: "contest" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const requiredRefs = [actor.sceneId, parsed.draft.defenderRef].sort();
  const defender = state.entities[parsed.draft.defenderRef];
  return submittedRefs.length === 2
    && new Set(submittedRefs).size === submittedRefs.length
    && [...submittedRefs].sort().every((reference, index) => reference === requiredRefs[index])
    && defender !== undefined
    && defender.id !== actor.id
    && defender.tenureStatus === "active"
    && defender.sceneId === actor.sceneId
    && characterTimelineId(state, defender.id) === characterTimelineId(state, actor.id);
}

function adjudicationPrecedentScopeAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  scope: AdjudicationPrecedentMaterializationDraft["applicabilityScope"],
): boolean {
  if (scope.kind === "scene") return scope.ref === actor.sceneId && state.scenes[scope.ref] !== undefined;
  if (scope.kind === "room") return scope.ref === state.roomId;
  if (scope.kind === "campaign") {
    return state.campaignRuntime.campaign?.campaignId === scope.ref;
  }
  const moduleRef = state.campaignRuntime.campaign?.moduleRef;
  return isRecord(moduleRef) && moduleRef.profileId === scope.ref;
}

function adjudicationPrecedentBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<AdjudicationPrecedentCausalDraft, { kind: "precedent" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const requiredRefs = new Set([
    actor.sceneId,
    ...parsed.draft.publicBasisRefs,
    ...parsed.draft.privateBasisRefs,
    ...(parsed.draft.supersededPrecedentId === undefined
      ? []
      : [parsed.draft.supersededPrecedentId]),
  ]);
  const privateKnowledgeAvailable = (reference: string) =>
    Object.values(state.knowledge).some((entries) => entries[reference] !== undefined);
  const prior = parsed.draft.supersededPrecedentId === undefined
    ? undefined
    : state.campaignRuntime.adjudicationPrecedents[parsed.draft.supersededPrecedentId];
  return submittedRefs.length === requiredRefs.size
    && new Set(submittedRefs).size === submittedRefs.length
    && submittedRefs.every((reference) => requiredRefs.has(reference))
    && [...requiredRefs].every((reference) => submittedRefs.includes(reference))
    && parsed.draft.publicBasisRefs.every((reference) => state.canonicalFacts[reference] !== undefined)
    && parsed.draft.privateBasisRefs.every((reference) =>
      state.canonicalFacts[reference] !== undefined || privateKnowledgeAvailable(reference))
    && adjudicationPrecedentScopeAvailable(state, actor, parsed.draft.applicabilityScope)
    && (parsed.draft.action === "record"
      ? parsed.draft.supersededPrecedentId === undefined
      : prior?.status === "active");
}

function lifecycleFactOrThreatAvailable(
  state: AuthoritativeWorldState,
  reference: string,
): boolean {
  return state.canonicalFacts[reference] !== undefined
    || state.campaignRuntime.unresolvedThreats.includes(reference);
}

function lifecycleOptionAvailable(
  state: AuthoritativeWorldState,
  reference: string,
): boolean {
  return lifecycleFactOrThreatAvailable(state, reference)
    || state.campaignRuntime.definitions[reference] !== undefined
    || state.entities[reference] !== undefined
    || state.scenes[reference] !== undefined;
}

function campaignLifecycleBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<CampaignLifecycleCausalDraft, { kind: "lifecycle" }>,
): boolean {
  const submittedRefs = stringList(parsed.step.arguments.basisRefs);
  const refs = [...new Set(submittedRefs)];
  if (refs.length !== submittedRefs.length || state.scenes[actor.sceneId] === undefined) {
    return false;
  }
  const requiredRefs = new Set<string>([actor.sceneId]);
  const draft = parsed.draft;
  if (draft.action === "raiseEndingCandidate") {
    if (state.campaignRuntime.endingCandidates[draft.endingCandidateRef] !== undefined
      || draft.basisRefs.some((reference) => state.canonicalFacts[reference] === undefined)
      || draft.unresolvedRefs.some((reference) =>
        !lifecycleFactOrThreatAvailable(state, reference))) return false;
    draft.basisRefs.forEach((reference) => requiredRefs.add(reference));
    draft.unresolvedRefs.forEach((reference) => requiredRefs.add(reference));
  } else if (draft.action === "concludeStory") {
    if (state.campaignRuntime.endingCandidates[draft.endingCandidateRef] === undefined
      || state.campaignRuntime.stories[draft.storyRef] !== undefined) return false;
    requiredRefs.add(draft.endingCandidateRef);
  } else if (draft.action === "transitionChapter") {
    const campaign = state.campaignRuntime.campaign;
    const currentChapterId = isRecord(campaign) && isNonEmptyString(campaign.currentChapterId)
      ? campaign.currentChapterId
      : undefined;
    if (currentChapterId === undefined
      || state.campaignRuntime.chapters[currentChapterId]?.status !== "active"
      || state.campaignRuntime.chapters[draft.chapterRef] !== undefined
      || draft.storyAnchorRefs.some((reference) =>
        !lifecycleFactOrThreatAvailable(state, reference))
      || draft.activityTransitions.some(({ activityId }) =>
        state.campaignRuntime.activities[activityId]?.status !== "active")) return false;
    draft.storyAnchorRefs.forEach((reference) => requiredRefs.add(reference));
    draft.activityTransitions.forEach(({ activityId }) => requiredRefs.add(activityId));
  } else if (draft.action === "commitMeaningfulFailure") {
    if (draft.basisRefs.some((reference) => state.canonicalFacts[reference] === undefined)
      || draft.newOptions.some(({ optionId }) => !lifecycleOptionAvailable(state, optionId))) {
      return false;
    }
    draft.basisRefs.forEach((reference) => requiredRefs.add(reference));
    draft.newOptions.forEach(({ optionId }) => requiredRefs.add(optionId));
  } else {
    const prior = state.campaignRuntime.meaningfulFailures[draft.precedentRef];
    if (prior?.characterId !== actor.id
      || draft.evidenceRefs.some((reference) => !lifecycleOptionAvailable(state, reference))) {
      return false;
    }
    draft.evidenceRefs.forEach((reference) => requiredRefs.add(reference));
  }
  return refs.length === requiredRefs.size
    && refs.every((reference) => requiredRefs.has(reference))
    && [...requiredRefs].every((reference) => refs.includes(reference));
}

function worldConsequenceCounterpartyRefs(
  draft: CompoundWorldConsequenceDraft,
): string[] {
  return [...new Set(draft.consequences.flatMap((consequence) => {
    if (consequence.kind === "updateRelationship") return consequence.counterpartyRefs;
    if (consequence.kind === "recordPromise" || consequence.kind === "recordDebt") {
      return [consequence.counterpartyRef];
    }
    return [];
  }))].sort();
}

function worldConsequenceBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<WorldConsequenceCausalDraft, { kind: "worldConsequences" }>,
): boolean {
  const refs = stringList(parsed.step.arguments.basisRefs);
  if (refs.length !== new Set(refs).size
    || state.canonicalFacts[parsed.draft.factRef] !== undefined
    || state.campaignRuntime.definitions[parsed.draft.factRef] !== undefined) return false;
  const counterparties = worldConsequenceCounterpartyRefs(parsed.draft);
  const actorTimelineId = characterTimelineId(state, actor.id);
  if (actorTimelineId === undefined
    || counterparties.some((reference) => {
      const target = state.entities[reference];
      return reference === actor.id
        || target === undefined
        || target.tenureStatus !== "active"
        || target.sceneId !== actor.sceneId
        || characterTimelineId(state, reference) !== actorTimelineId;
    })) return false;
  const requiredRefs = new Set([actor.sceneId, ...counterparties]);
  return [...requiredRefs].every((reference) => refs.includes(reference))
    && refs.every((reference) => {
      if (requiredRefs.has(reference)) return true;
      const fact = state.canonicalFacts[reference];
      return fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor);
    });
}

function definitionRegistrationBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  parsed: Extract<
    DefinitionRegistrationCausalDraft,
    { kind: "abilityDefinition" | "factionDefinition" }
  >,
): boolean {
  const refs = stringList(parsed.step.arguments.basisRefs);
  if (refs.length !== new Set(refs).size) return false;
  if (parsed.kind === "abilityDefinition") {
    const requiredRefs = new Set([actor.sceneId, ...parsed.draft.causalBasisRefs]);
    return refs.length === requiredRefs.size
      && refs.every((reference) => requiredRefs.has(reference))
      && parsed.draft.causalBasisRefs.every((reference) => {
        const fact = state.canonicalFacts[reference];
        return fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor);
      });
  }
  if (parsed.draft.memberRefs.some((memberRef) => {
    const member = state.entities[memberRef];
    return member?.kind !== "npc"
      || member.tenureStatus !== "active"
      || member.sceneId !== actor.sceneId;
  })) return false;
  if (parsed.draft.causalBasisRefs.some((reference) => {
    const heldByMember = parsed.draft.memberRefs.some((memberRef) =>
      state.knowledge[memberRef]?.[reference] !== undefined);
    const fact = state.canonicalFacts[reference];
    return !heldByMember
      && !(fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor));
  })) return false;
  const requiredRefs = new Set([
    actor.sceneId,
    ...parsed.draft.memberRefs,
    ...parsed.draft.causalBasisRefs,
  ]);
  return refs.length === requiredRefs.size
    && refs.every((reference) => requiredRefs.has(reference));
}

function materializationBasisAvailable(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  program: CausalActionProgram,
): boolean {
  if (program.formRef !== "materialization.v1") return true;
  const lowered = lowerCausalActionProgram(program).steps[0];
  if (lowered === undefined) return false;
  const refs = [...new Set(stringList(lowered.arguments.basisRefs))];
  const definitionRegistration = definitionRegistrationCausalDraft(program);
  if (definitionRegistration.kind === "invalid") return false;
  if (definitionRegistration.kind === "abilityDefinition"
    || definitionRegistration.kind === "factionDefinition") {
    return definitionRegistrationBasisAvailable(state, actor, definitionRegistration);
  }
  const worldConsequences = worldConsequenceCausalDraft(program);
  if (worldConsequences.kind === "invalid") return false;
  if (worldConsequences.kind === "worldConsequences") {
    return worldConsequenceBasisAvailable(state, actor, worldConsequences);
  }
  const actorPlan = actorPlanCausalDraft(program);
  if (actorPlan.kind === "invalid") return false;
  if (actorPlan.kind === "actorPlan") {
    return actorPlanBasisAvailable(state, actor, actorPlan);
  }
  const hiddenReality = hiddenRealityCausalDraft(program);
  if (hiddenReality.kind === "invalid") return false;
  if (hiddenReality.kind === "hiddenReality") {
    return hiddenRealityBasisAvailable(state, actor, hiddenReality);
  }
  const noncombatContest = noncombatContestCausalDraft(program);
  if (noncombatContest.kind === "invalid") return false;
  if (noncombatContest.kind === "contest") {
    return noncombatContestBasisAvailable(state, actor, noncombatContest);
  }
  const adjudicationPrecedent = adjudicationPrecedentCausalDraft(program);
  if (adjudicationPrecedent.kind === "invalid") return false;
  if (adjudicationPrecedent.kind === "precedent") {
    return adjudicationPrecedentBasisAvailable(state, actor, adjudicationPrecedent);
  }
  const campaignLifecycle = campaignLifecycleCausalDraft(program);
  if (campaignLifecycle.kind === "invalid") return false;
  if (campaignLifecycle.kind === "lifecycle") {
    return campaignLifecycleBasisAvailable(state, actor, campaignLifecycle);
  }
  const dynamicPassageMove = dynamicPassageMoveCausalDraft(program);
  if (dynamicPassageMove.kind === "invalid") return false;
  if (dynamicPassageMove.kind === "passageMove") {
    return dynamicPassageMoveBasisAvailable(state, actor, dynamicPassageMove);
  }
  const narrativeItemMaterialization = narrativeItemMaterializationCausalDraft(program);
  if (narrativeItemMaterialization.kind === "invalid") return false;
  if (narrativeItemMaterialization.kind === "narrativeItem") {
    return narrativeItemMaterializationBasisAvailable(
      state,
      actor,
      narrativeItemMaterialization,
    );
  }
  const sceneItemAcquisition = sceneItemAcquisitionCausalDraft(program);
  if (sceneItemAcquisition.kind === "invalid") return false;
  if (sceneItemAcquisition.kind === "sceneItemAcquisition") {
    return sceneItemAcquisitionBasisAvailable(state, actor, sceneItemAcquisition);
  }
  const itemMaterialization = itemMaterializationCausalDraft(program);
  if (itemMaterialization.kind === "invalid") return false;
  if (itemMaterialization.kind === "item") {
    return itemMaterializationBasisAvailable(state, actor, itemMaterialization);
  }
  const npcMechanical = npcMechanicalCausalDraft(program);
  if (npcMechanical.kind === "invalid") return false;
  if (npcMechanical.kind !== "none") {
    return npcMechanicsProfileEnabled(profiles.extensions)
      && npcMechanicalBasisAvailable(profiles, state, actor, npcMechanical);
  }
  const premise = socialResolutionProfileEnabled(profiles.extensions)
    ? characterPremiseDraft(lowered)
    : undefined;
  const dynamicNpc = socialResolutionProfileEnabled(profiles.extensions)
    ? dynamicNpcMaterializationDraft(lowered)
    : undefined;
  if (socialResolutionProfileEnabled(profiles.extensions)
    && lowered.arguments.method === CHARACTER_PREMISE_METHOD
    && premise === undefined) return false;
  if (socialResolutionProfileEnabled(profiles.extensions)
    && lowered.arguments.method === DYNAMIC_NPC_MATERIALIZATION_METHOD
    && dynamicNpc === undefined) return false;
  if (dynamicNpc !== undefined) {
    const definition = state.campaignRuntime.definitions[dynamicNpc.definitionRef];
    const content = isRecord(definition?.content) ? definition.content : undefined;
    const sourceFacts = dynamicNpc.sourceFactRefs.map((factRef) => state.canonicalFacts[factRef]);
    const definitionBinding = materializableDynamicNpcDefinition(
      state,
      dynamicNpc.definitionRef,
      dynamicNpc.entityRef,
      dynamicNpc.sourceFactRefs,
    );
    const initialKnowledgeAuthorized = dynamicNpc.initialKnowledgeFactRefs.every((factRef) => {
      const fact = state.canonicalFacts[factRef];
      const assertionFactRef = isRecord(fact?.value) ? fact.value.assertionFactRef : undefined;
      const assertionFact = isNonEmptyString(assertionFactRef)
        ? state.canonicalFacts[assertionFactRef]
        : undefined;
      return fact?.kind === "dynamicEntityKnowledgeGrant"
        && isRecord(fact.value)
        && fact.value.schema === "zhuwei.dynamic-entity-knowledge-grant/v1"
        && fact.value.recipientEntityRef === dynamicNpc.entityRef
        && assertionFact?.kind === "typedAssertionFact"
        && isRecord(assertionFact.value)
        && assertionFact.value.schema === "zhuwei.typed-assertion-fact/v1"
        && assertionFact.value.sourcePremiseFactRef === fact.value.sourcePremiseFactRef;
    });
    return dynamicNpc.sceneRef === actor.sceneId
      && state.scenes[dynamicNpc.sceneRef] !== undefined
      && characterTimelineId(state, actor.id) !== undefined
      && state.entities[dynamicNpc.entityRef] === undefined
      && refs.includes(dynamicNpc.definitionRef)
      && refs.includes(dynamicNpc.entityRef)
      && refs.includes(dynamicNpc.sceneRef)
      && dynamicNpc.sourceFactRefs.every((factRef) => refs.includes(factRef))
      && sourceFacts.every((fact) => fact !== undefined)
      && dynamicNpc.sourceFactRefs.every((factRef) =>
        premiseSourceAvailable(state, actor, factRef))
      && definitionBinding !== undefined
      && initialKnowledgeAuthorized
      && definition?.definitionKind === "npc"
      && content !== undefined;
  }
  if (premise !== undefined) {
    const policy = premisePolicy(state, premise.policyRef);
    if (policy === undefined
      || policy.predicate !== premise.predicate
      || premise.bindings.length < policy.minimumBindings
      || premise.bindings.length > policy.maximumBindings
      || !refs.includes(premise.policyRef)
      || premise.anchorRefs.some((anchorRef) =>
        !refs.includes(anchorRef)
        || !policy.allowedAnchorRefs.includes(anchorRef)
        || !moduleAnchorAvailable(state, anchorRef))) return false;
    const requiredRefs = new Set([premise.policyRef, ...premise.anchorRefs]);
    for (const slot of policy.slots) {
      const count = premise.bindings.filter((binding) => binding.slotRef === slot.slotRef).length;
      if (count < slot.minimum || count > slot.maximum) return false;
    }
    for (const binding of premise.bindings) {
      const slot = policy.slots.find((candidate) => candidate.slotRef === binding.slotRef);
      if (slot === undefined) return false;
      if (binding.referenceKind === "existing") {
        const entityKind = existingPremiseEntityKind(state, binding.ref);
        requiredRefs.add(binding.ref);
        if (entityKind === undefined
          || !slot.allowedExistingKinds.includes(entityKind)
          || !premiseExistingEntityAvailable(state, actor, binding.ref)) return false;
        continue;
      }
      const archetype = premiseArchetype(state, binding.archetypeRef);
      requiredRefs.add(binding.archetypeRef);
      if (archetype === undefined
        || !slot.allowedOpenArchetypeRefs.includes(binding.archetypeRef)) return false;
    }
    if ([...requiredRefs].some((reference) => !refs.includes(reference))) return false;
    const existing = existingCharacterPremise(state, actor.id, premise.predicate);
    if (existing !== undefined && !refs.includes(existing.id)) return false;
    return refs.every((reference) => requiredRefs.has(reference)
      || reference === existing?.id
      || premiseSourceAvailable(state, actor, reference));
  }
  return refs.length > 0 && refs.every((reference) => {
    const fact = state.canonicalFacts[reference];
    return fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor);
  });
}

function inWorldRefusal(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
): StepResult {
  const actor = state.entities[input.actorCharacterId as string]!;
  const node = program.nodes[0];
  const explanation = scalarString(node.arguments.reason)
    ?? scalarString(node.arguments.risk)
    ?? "已成立的世界事实中不存在可供这次行动使用的对象或因果条件。";
  const rootActionId = input.rootActionId as string;
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  append(accumulator, profiles, {
    rootActionId,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: actor.id,
      outcomeCode: "in-world-refusal",
      fact: null,
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`entity:${actor.id}`, `fact:${causalProgramFactRef(rootActionId, program.semanticHash)}`],
    writes: [`receipt:${rootActionId}`],
  });
  const knowledgeRef = `evidence:v3:${rootActionId}:${program.semanticHash.slice("fnv1a64:".length)}:${node.nodeId}:failure`;
  append(accumulator, profiles, {
    rootActionId,
    eventType: "KnowledgeAcquired",
    payload: {
      characterId: actor.id,
      knowledgeRef,
      objectKind: "sensoryEvidence",
      layer: "full",
      content: explanation,
      causeFactId: causalProgramFactRef(rootActionId, program.semanticHash),
      acquisition: {
        sense: "causalResolution",
        sceneId: actor.sceneId,
        method: scalarString(node.arguments.method) ?? "resolveInWorldRefusal",
      },
      visibility: "private",
    },
    visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
    secrecy: "private",
    reads: [`entity:${actor.id}`, `fact:${causalProgramFactRef(rootActionId, program.semanticHash)}`],
    writes: [`knowledge:${actor.id}:${knowledgeRef}`, `receipt:${rootActionId}`],
    creates: [`knowledge:${actor.id}:${knowledgeRef}`],
  });
  const duration = causalActionDurationMicros({
    sequence: 1,
    nodeRef: node.nodeId,
    primitive: node.primitive,
    prerequisiteSequences: [],
    arguments: node.arguments,
  });
  if (duration !== undefined) {
    append(accumulator, profiles, {
      rootActionId,
      eventType: "FictionTimeAdvanced",
      payload: { durationMicros: duration, reason: explanation },
      visibilityPolicyId: "visibility:scene-observers",
      secrecy: "public",
      reads: [`timeline:${accumulator.state.activeBranchId}`],
      writes: [`timeline:${accumulator.state.activeBranchId}`, `receipt:${rootActionId}`],
    });
  }
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: false,
      disposition: "inWorldRefusal",
      nodes: [{
        nodeRef: node.nodeId,
        primitive: node.primitive,
        resolution: "direct",
        succeeded: false,
        branch: "failure",
      }],
    },
  });
}

function hiddenRealityCausalResult(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
  parsed: Extract<HiddenRealityCausalDraft, { kind: "hiddenReality" }>,
): StepResult {
  const rootActionId = input.rootActionId as string;
  const plan = planFor(actor, program, [parsed.step], rootActionId);
  if (plan === undefined) {
    return rejected("invalidRulesInput", "Hidden reality requires one frozen fictional duration.");
  }
  const totalWeight = parsed.draft.candidates.reduce(
    (total, candidate) => total + candidate.hiddenWeight,
    0,
  );
  const frozenParameters = {
    candidateSetId: parsed.draft.candidateSetId,
    candidates: structuredClone(parsed.draft.candidates),
  };
  const requestCore = {
    randomnessId: `randomness:${rootActionId}:hidden-reality`,
    resolutionId: `resolution:${rootActionId}:hidden-reality`,
    actorCharacterId: actor.id,
    purpose: "hiddenRealitySelection" as const,
    purposeKey: `hidden-reality:${parsed.draft.candidateSetId}`,
    diceExpression: `1d${totalWeight}`,
    dice: [{ count: "1", sides: String(totalWeight) }],
    frozenParameters,
  };
  const request: RandomnessRequest = {
    ...requestCore,
    requestHash: canonicalSha256(requestCore),
  };
  const resolutionPlan = {
    kind: "hiddenRealitySelection" as const,
    candidateSetId: parsed.draft.candidateSetId,
    candidates: structuredClone(parsed.draft.candidates),
    actionPlan: {
      schema: "zhuwei.hidden-reality-causal-plan/v1",
      actorCharacterId: actor.id,
      sourceSceneId: actor.sceneId,
      programHash: program.semanticHash,
      programFactRef: plan.programFactRef,
      durationMicros: plan.durationMicros,
      goal: programGoal([parsed.step]),
      method: programMethod([parsed.step]),
    },
  };
  const continuation: AuthorityContinuation = {
    kind: "roomAuthorityRandomness",
    continuationId: `continuation:${request.resolutionId}`,
    capability: canonicalSha256({
      kind: "roomAuthorityRandomness",
      roomId: state.roomId,
      runtimeEpochId: state.runtimeEpochId,
      stateHash: hashWorldState(state),
      rootActionId,
      request,
      resolutionPlan,
    }),
  };
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: request.resolutionId,
    eventType: "HiddenRealityCandidatesFrozen",
    payload: {
      candidateSetId: parsed.draft.candidateSetId,
      candidates: structuredClone(parsed.draft.candidates),
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [
      `entity:${actor.id}`,
      ...parsed.draft.candidates.flatMap(({ causalBasisRefs }) =>
        causalBasisRefs.map((factRef) => `fact:${factRef}`)),
    ],
    writes: [`hidden-reality:${parsed.draft.candidateSetId}`, `receipt:${rootActionId}`],
    creates: [`hidden-reality:${parsed.draft.candidateSetId}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: request.resolutionId,
    eventType: "RandomnessRequested",
    payload: {
      request,
      continuation,
      purpose: request.purpose,
      formula: request.diceExpression,
      resolutionPlan,
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [`hidden-reality:${parsed.draft.candidateSetId}`],
    writes: [`continuation:${continuation.continuationId}`, `receipt:${rootActionId}`],
    creates: [`continuation:${continuation.continuationId}`],
  });
  return finished("awaitingRandomness", accumulator, {
    randomnessRequest: request,
    continuation,
    randomnessRequests: [request],
    continuations: [continuation],
  });
}

export function fulfillHiddenRealityRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  rolls: number[],
): StepResult | undefined {
  const stored = state.internalContinuations[continuationId];
  if (stored?.request.purpose !== "hiddenRealitySelection") return undefined;
  const resolutionPlanValue: unknown = stored.resolutionPlan;
  const resolutionPlan = isRecord(resolutionPlanValue) ? resolutionPlanValue : undefined;
  if (!isRecord(resolutionPlan)
    || !hasExactKeys(resolutionPlan, ["actionPlan", "candidateSetId", "candidates", "kind"])
    || resolutionPlan.kind !== "hiddenRealitySelection"
    || !isNonEmptyString(resolutionPlan.candidateSetId)
    || !Array.isArray(resolutionPlan.candidates)
    || resolutionPlan.candidates.length < 2
    || !isRecord(resolutionPlan.actionPlan)
    || !hasExactKeys(resolutionPlan.actionPlan, [
      "actorCharacterId",
      "durationMicros",
      "goal",
      "method",
      "programFactRef",
      "programHash",
      "schema",
      "sourceSceneId",
    ])
    || resolutionPlan.actionPlan.schema !== "zhuwei.hidden-reality-causal-plan/v1"
    || ![
      resolutionPlan.actionPlan.actorCharacterId,
      resolutionPlan.actionPlan.durationMicros,
      resolutionPlan.actionPlan.goal,
      resolutionPlan.actionPlan.method,
      resolutionPlan.actionPlan.programFactRef,
      resolutionPlan.actionPlan.programHash,
      resolutionPlan.actionPlan.sourceSceneId,
    ].every(isNonEmptyString)
    || !/^[1-9][0-9]*$/u.test(String(resolutionPlan.actionPlan.durationMicros))
    || rolls.length !== 1) {
    return rejected("invalidWorldState", "The frozen hidden-reality continuation is not canonical.");
  }
  const candidates: HiddenRealityCandidate[] = [];
  let maximumFace = 0;
  for (const value of resolutionPlan.candidates) {
    if (!isRecord(value)
      || !hasExactKeys(value, [
        "candidateId",
        "causalBasisRefs",
        "definition",
        "factRef",
        "hiddenWeight",
        "kind",
        "visibilityPolicyRef",
      ])
      || !isNonEmptyString(value.candidateId)
      || !isNonEmptyString(value.factRef)
      || !(HIDDEN_REALITY_KINDS as readonly unknown[]).includes(value.kind)
      || !Number.isSafeInteger(value.hiddenWeight)
      || Number(value.hiddenWeight) < 1
      || !isNonEmptyString(value.visibilityPolicyRef)
      || !isRecord(value.definition)) {
      return rejected("invalidWorldState", "The frozen hidden-reality candidates are not canonical.");
    }
    const causalBasisRefs = boundedReferenceList(value.causalBasisRefs, 24);
    if (causalBasisRefs === undefined) {
      return rejected("invalidWorldState", "The frozen hidden-reality basis is not canonical.");
    }
    maximumFace += Number(value.hiddenWeight);
    candidates.push({
      candidateId: value.candidateId,
      hiddenWeight: Number(value.hiddenWeight),
      kind: value.kind as HiddenRealityCandidate["kind"],
      factRef: value.factRef,
      causalBasisRefs,
      visibilityPolicyRef: value.visibilityPolicyRef,
      definition: structuredClone(value.definition),
    });
  }
  if (!Number.isSafeInteger(maximumFace)
    || maximumFace > 1_000_000
    || new Set(candidates.map(({ candidateId }) => candidateId)).size !== candidates.length
    || new Set(candidates.map(({ factRef }) => factRef)).size !== candidates.length
    || stored.request.diceExpression !== `1d${maximumFace}`
    || stored.request.dice[0]?.count !== "1"
    || stored.request.dice[0]?.sides !== String(maximumFace)
    || !isRecord(stored.request.frozenParameters)
    || canonicalSha256(stored.request.frozenParameters) !== canonicalSha256({
      candidateSetId: resolutionPlan.candidateSetId,
      candidates,
    })) {
    return rejected("invalidWorldState", "The hidden-reality request no longer matches its frozen candidates.");
  }
  const face = rolls[0];
  if (!Number.isSafeInteger(face) || face < 1 || face > maximumFace) {
    return rejected("invalidRulesInput", "The authoritative hidden-reality face is outside the frozen range.");
  }
  let cursor = 0;
  let selected: HiddenRealityCandidate | undefined;
  for (const candidate of candidates) {
    cursor += candidate.hiddenWeight;
    if (selected === undefined && face <= cursor) selected = candidate;
  }
  if (selected === undefined
    || state.canonicalFacts[selected.factRef] !== undefined
    || state.campaignRuntime.definitions[selected.factRef] !== undefined
    || selected.causalBasisRefs.some((factRef) => state.canonicalFacts[factRef] === undefined)) {
    return rejected("invalidWorldState", "The selected hidden reality can no longer be materialized.");
  }

  const actionPlan = resolutionPlan.actionPlan;
  const rootActionId = stored.rootActionId;
  const accumulator: Accumulator = { state, events: [] };
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: stored.request.resolutionId,
    eventType: "DiceRolled",
    payload: {
      randomnessId: stored.request.randomnessId,
      resolutionId: stored.request.resolutionId,
      formula: stored.request.diceExpression,
      faces: [face],
      selectedFace: face,
      requestHash: canonicalSha256(stored.request),
      frozenParametersHash: canonicalSha256(stored.request.frozenParameters),
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [`continuation:${continuationId}`],
    writes: [`receipt:${rootActionId}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: stored.request.resolutionId,
    eventType: "HiddenRealityMaterialized",
    payload: {
      candidateSetId: resolutionPlan.candidateSetId,
      candidateId: selected.candidateId,
      factRef: selected.factRef,
      selectedFace: face,
    },
    visibilityPolicyId: selected.visibilityPolicyRef,
    secrecy: selected.visibilityPolicyRef.startsWith("visibility:public") ? "public" : "internal",
    reads: [`continuation:${continuationId}`, `hidden-reality:${resolutionPlan.candidateSetId}`],
    writes: [`hidden-reality:${resolutionPlan.candidateSetId}`, `receipt:${rootActionId}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: stored.request.resolutionId,
    eventType: "DefinitionRegistered",
    payload: {
      definition: {
        definitionId: selected.factRef,
        definitionVersion: "1",
        definitionKind: selected.kind,
        causalBasisRefs: [...selected.causalBasisRefs],
        visibilityPolicyRef: selected.visibilityPolicyRef,
        content: structuredClone(selected.definition),
      },
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: selected.causalBasisRefs.map((factRef) => `fact:${factRef}`),
    writes: [`definition:${selected.factRef}`, `receipt:${rootActionId}`],
    creates: [`definition:${selected.factRef}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: stored.request.resolutionId,
    eventType: "CanonicalFactDeclared",
    payload: {
      fact: {
        id: selected.factRef,
        kind: `dynamic:${selected.kind}`,
        subjectRefs: [
          String(actionPlan.actorCharacterId),
          String(actionPlan.sourceSceneId),
        ].sort(),
        value: { definitionRef: selected.factRef, kind: selected.kind },
        visibilityPolicyId: selected.visibilityPolicyRef,
        source: "dynamicMaterialization",
        causalParentIds: [...selected.causalBasisRefs],
      },
    },
    visibilityPolicyId: selected.visibilityPolicyRef,
    secrecy: selected.visibilityPolicyRef.startsWith("visibility:public") ? "public" : "internal",
    reads: [`definition:${selected.factRef}`],
    writes: [`fact:${selected.factRef}`, `receipt:${rootActionId}`],
    creates: [`fact:${selected.factRef}`],
  });
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: stored.request.resolutionId,
    eventType: "FictionTimeAdvanced",
    payload: {
      durationMicros: String(actionPlan.durationMicros),
      reason: String(actionPlan.goal),
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`timeline:${accumulator.state.activeBranchId}`],
    writes: [`timeline:${accumulator.state.activeBranchId}`, `receipt:${rootActionId}`],
  });
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "hiddenRealitySelection",
      candidateSetId: resolutionPlan.candidateSetId,
      selectedFactRef: selected.factRef,
      selectedCandidateId: selected.candidateId,
    },
  });
}

export function stepCausalActionProgram(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (
    input.kind !== "executeCausalActionProgram"
    || input.actionLanguageRef !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
  ) return undefined;
  if (!causalActionInterpreterEnabled(profiles.extensions)) {
    return rejected("unsupportedOperation", "The pinned runtime manifest has no V3 causal action interpreter.");
  }
  if (
    !(hasExactKeys(input, CAUSAL_INPUT_KEYS)
      || (socialResolutionProfileEnabled(profiles.extensions)
        && hasExactKeys(input, SOCIAL_CAUSAL_INPUT_KEYS)))
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId)
    || (input.rootActionId in state.receipts
      && !isContinuedCompoundRoot(input, input.rootActionId))
    || input.actionLanguageHash !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash
    || !isRecord(input.causalActionProgram)
  ) return rejected("invalidRulesInput", "The V3 causal action input is not canonical.");
  const validation = validateCausalActionProgram(input.causalActionProgram);
  if (!validation.ok) {
    return rejected("invalidRulesInput", "The V3 causal action program failed its pinned language contract.");
  }
  const program = input.causalActionProgram as unknown as CausalActionProgram;
  if (
    input.actionLanguageRef !== program.languageRef
    || input.actionLanguageHash !== program.languageHash
    || !validateExecutableCausalActionProgram(program)
  ) return rejected("invalidRulesInput", "The V3 causal action program has no legal executable semantics.");
  if (socialResolutionProfileEnabled(profiles.extensions)
    && program.formRef === "npc-exchange.v1") {
    const utterance = program.nodes[0]?.arguments.utterance;
    if (!isNonEmptyString(input.trustedUtterance)
      || utterance !== input.trustedUtterance) {
      return rejected(
        "invalidRulesInput",
        "The NPC exchange must preserve the authenticated player's exact spoken words.",
      );
    }
  } else if (input.trustedUtterance !== undefined) {
    return rejected("invalidRulesInput", "Trusted utterance binding is available only to V5 NPC exchange.");
  }
  const actor = state.entities[input.actorCharacterId];
  if (actor?.kind !== "player" || actor.tenureStatus !== "active") {
    return rejected("privateOrUnknownReference", "The causal action actor is unavailable.");
  }
  if (storyWaitsForExplicitContinuation(state)) {
    return rejected(
      "missingPrerequisite",
      "The current story is concluded; only an explicit epilogue choice or sequel may continue.",
    );
  }
  const actorPlanDraft = actorPlanCausalDraft(program);
  const hiddenRealityDraft = hiddenRealityCausalDraft(program);
  const noncombatContestDraft = noncombatContestCausalDraft(program);
  const adjudicationPrecedentDraft = adjudicationPrecedentCausalDraft(program);
  const campaignLifecycleDraft = campaignLifecycleCausalDraft(program);
  const npcMechanicalDraft = npcMechanicalCausalDraft(program);
  const dynamicPassageMoveDraft = dynamicPassageMoveCausalDraft(program);
  const observedFactAcquisitionDraft = observedFactAcquisitionCausalDraft(program);
  const itemInformationObservationDraft = itemInformationObservationCausalDraft(program);
  const narrativeItemMaterializationDraft = narrativeItemMaterializationCausalDraft(program);
  const sceneItemAcquisitionDraft = sceneItemAcquisitionCausalDraft(program);
  const itemMaterializationDraft = itemMaterializationCausalDraft(program);
  const worldConsequenceDraft = worldConsequenceCausalDraft(program);
  const definitionRegistrationDraft = definitionRegistrationCausalDraft(program);
  if (actorPlanDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The ActorPlan materialization draft is not canonical.");
  }
  if (hiddenRealityDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The hidden-reality candidate set is not canonical.");
  }
  if (noncombatContestDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The opposed-check draft is not canonical.");
  }
  if (adjudicationPrecedentDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The adjudication-precedent draft is not canonical.");
  }
  if (campaignLifecycleDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The Campaign lifecycle draft is not canonical.");
  }
  if (dynamicPassageMoveDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The dynamic passage movement draft is not canonical.");
  }
  if (observedFactAcquisitionDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The observed-fact acquisition draft is not canonical.");
  }
  if (itemInformationObservationDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The item-information observation draft is not canonical.");
  }
  if (narrativeItemMaterializationDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The narrative-item materialization draft is not canonical.");
  }
  if (sceneItemAcquisitionDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The scene-item acquisition draft is not canonical.");
  }
  if (itemMaterializationDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The item materialization draft is not canonical.");
  }
  if (worldConsequenceDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The world-consequence draft is not canonical.");
  }
  if (definitionRegistrationDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The definition-registration draft is not canonical.");
  }
  if (npcMechanicalDraft.kind === "invalid") {
    return rejected("invalidRulesInput", "The NPC mechanical materialization draft is not canonical.");
  }
  if (npcMechanicalDraft.kind !== "none"
    && !npcMechanicsProfileEnabled(profiles.extensions)) {
    return rejected(
      "unsupportedOperation",
      "The pinned room profile does not enable NPC mechanical materialization.",
    );
  }
  if (!materializationBasisAvailable(profiles, state, actor, program)) {
    return rejected(
      "privateOrUnknownReference",
      "The materialization basis is unavailable to the acting character.",
    );
  }

  if (actorPlanDraft.kind === "actorPlan") {
    return actorPlanCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      actorPlanDraft,
    );
  }

  if (hiddenRealityDraft.kind === "hiddenReality") {
    return hiddenRealityCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      hiddenRealityDraft,
    );
  }

  if (noncombatContestDraft.kind === "contest") {
    return noncombatContestCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      noncombatContestDraft,
    );
  }

  if (campaignLifecycleDraft.kind === "lifecycle"
    && campaignLifecycleDraft.draft.action !== "retryFailedAction") {
    return campaignLifecycleCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      campaignLifecycleDraft,
    );
  }

  if (dynamicPassageMoveDraft.kind === "passageMove") {
    return dynamicPassageMoveCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      dynamicPassageMoveDraft,
    );
  }

  if (observedFactAcquisitionDraft.kind === "observedFact") {
    return observedFactAcquisitionCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      observedFactAcquisitionDraft,
    );
  }

  if (itemInformationObservationDraft.kind === "itemInformation") {
    return itemInformationObservationCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      itemInformationObservationDraft,
    );
  }

  if (narrativeItemMaterializationDraft.kind === "narrativeItem") {
    return narrativeItemMaterializationCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      narrativeItemMaterializationDraft,
    );
  }

  if (sceneItemAcquisitionDraft.kind === "sceneItemAcquisition") {
    return sceneItemAcquisitionCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      sceneItemAcquisitionDraft,
    );
  }

  if (itemMaterializationDraft.kind === "item") {
    return itemMaterializationCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      itemMaterializationDraft,
    );
  }

  if (worldConsequenceDraft.kind === "worldConsequences") {
    return worldConsequenceCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      worldConsequenceDraft,
    );
  }

  if (definitionRegistrationDraft.kind === "abilityDefinition"
    || definitionRegistrationDraft.kind === "factionDefinition") {
    return definitionRegistrationCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      definitionRegistrationDraft,
    );
  }

  if (npcMechanicalDraft.kind !== "none") {
    return npcMechanicalCausalResult(
      profiles,
      state,
      input,
      program,
      actor,
      npcMechanicalDraft,
    );
  }

  const social = stepSocialCausalAction(profiles, state, input, program, actor);
  if (social !== undefined) return social;

  const firstPrimitive = program.nodes[0].primitive;
  if (firstPrimitive === "requestClarification") return clarification(profiles, state, input, program);
  if (firstPrimitive === "refuseInWorld" || (
    firstPrimitive === "resolveEnvironmentalStunt"
    && program.nodes[0].arguments.featureDisposition === "explicitly-absent"
  )) {
    return inWorldRefusal(profiles, state, input, program);
  }
  if (firstPrimitive === "resolveCombatIntent") return combat(profiles, state, input, program);

  const lowered = lowerCausalActionProgram(program);
  const plan = planFor(actor, program, lowered.steps, input.rootActionId);
  if (plan === undefined || !isCausalActionResolutionPlan(plan)) {
    return rejected("invalidRulesInput", "The causal action duration or frozen continuation is invalid.");
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, input.rootActionId, actor, program);
  if (campaignLifecycleDraft.kind === "lifecycle"
    && campaignLifecycleDraft.draft.action === "retryFailedAction") {
    const draft = campaignLifecycleDraft.draft;
    const prior = state.campaignRuntime.meaningfulFailures[draft.precedentRef];
    const method = programMethod([campaignLifecycleDraft.step]);
    const methodChanged = prior?.methodFingerprint !== method;
    if (prior?.characterId !== actor.id) {
      return rejected("privateOrUnknownReference", "The prior failed action is unavailable.");
    }
    if (draft.changeKind === null) {
      return rejected(
        methodChanged ? "invalidRulesInput" : "unchangedRetry",
        methodChanged
          ? "A changed retry must identify its material change."
          : "An unchanged failed method cannot be rerolled.",
      );
    }
    if (draft.changeKind === "methodChanged" && !methodChanged) {
      return rejected("unchangedRetry", "The failed method has not materially changed.");
    }
    append(accumulator, profiles, {
      rootActionId: input.rootActionId,
      eventType: "RetryConditionChanged",
      payload: {
        characterId: actor.id,
        goalId: draft.precedentRef,
        change: draft.changeKind,
        evidence: draft.changeKind === "methodChanged"
          ? method
          : draft.evidenceRefs.join(";"),
      },
      visibilityPolicyId: "visibility:scene-observers",
      secrecy: "public",
      reads: [
        `failure:${draft.precedentRef}`,
        ...draft.evidenceRefs.map((reference) => `fact-or-world:${reference}`),
      ],
      writes: [`retry-change:${draft.precedentRef}`, `receipt:${input.rootActionId}`],
    });
  }
  const terminal = lowered.steps.at(-1)!;
  if (!appendFrozenCosts(accumulator, profiles, input.rootActionId, actor, terminal)) {
    return rejected("invalidRulesInput", "The frozen causal action cost is unavailable.");
  }

  const composition = compoundCompositionForProgram(program);
  if (program.formRef === "compound.v1" && composition === undefined) {
    return rejected("invalidRulesInput", "The compound composition is not canonical.");
  }
  if (composition !== undefined) {
    const currentActor = accumulator.state.entities[actor.id];
    if (currentActor?.kind !== "player" || currentActor.tenureStatus !== "active") {
      return rejected("privateOrUnknownReference", "The compound actor is unavailable.");
    }
    const before = applyCompoundPhase(
      accumulator,
      profiles,
      input.rootActionId,
      currentActor,
      plan,
      composition.before,
      "before",
    );
    if (!before.ok) return before.result;

    for (const [phase, operations] of [
      ["onSuccess", composition.onSuccess],
      ["onFailure", composition.onFailure],
    ] as const) {
      const probe: Accumulator = {
        state: structuredClone(accumulator.state),
        events: [],
      };
      const probeActor = probe.state.entities[actor.id];
      if (probeActor?.kind !== "player" || probeActor.tenureStatus !== "active") {
        return rejected("privateOrUnknownReference", "The compound actor is unavailable.");
      }
      const preflight = applyCompoundPhase(
        probe,
        profiles,
        input.rootActionId,
        probeActor,
        plan,
        operations,
        phase,
      );
      if (!preflight.ok) return preflight.result;
    }
  }

  const requests: RandomnessRequest[] = [];
  const continuations: AuthorityContinuation[] = [];
  for (const step of lowered.steps) {
    if (checkResolution(step) !== "check") continue;
    const check = causalActionExpectedFrozenCheck(profiles, actor, step);
    if (check === undefined) return rejected("invalidRulesInput", "A causal check is not a canonical SRD 5.1 check.");
    append(accumulator, profiles, {
      rootActionId: input.rootActionId,
      resolutionId: `resolution:${input.rootActionId}:causal:${step.nodeRef}`,
      eventType: "CheckFrozen",
      payload: {
        characterId: actor.id,
        checkKind: check.kind === "skill" ? "skill" : "ability",
        ability: check.ability,
        skill: check.skill,
        dc: Number(check.dc),
        mode: check.mode,
        success: { programHash: plan.programHash, nodeRef: step.nodeRef, consequence: check.successOutcome },
        failure: { programHash: plan.programHash, nodeRef: step.nodeRef, consequence: check.failureOutcome },
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: [`entity:${actor.id}`, `fact:${plan.programFactRef}`],
      writes: [`check:${input.rootActionId}:${step.nodeRef}`, `receipt:${input.rootActionId}`],
      creates: [`check:${input.rootActionId}:${step.nodeRef}`],
    });
    const request: RandomnessRequest = {
      randomnessId: `randomness:${input.rootActionId}:causal:${step.nodeRef}`,
      resolutionId: `resolution:${input.rootActionId}:causal:${step.nodeRef}`,
      actorCharacterId: actor.id,
      purpose: "improvisedCheck",
      diceExpression: check.mode === "normal" ? "1d20"
        : check.mode === "advantage" ? "2d20kh1" : "2d20kl1",
      frozenCheck: check,
    };
    const continuation: AuthorityContinuation = {
      kind: "roomAuthorityRandomness",
      continuationId: `continuation:${request.resolutionId}`,
      capability: canonicalSha256({
        kind: "roomAuthorityRandomness",
        roomId: accumulator.state.roomId,
        runtimeEpochId: accumulator.state.runtimeEpochId,
        stateHash: hashWorldState(accumulator.state),
        rootActionId: input.rootActionId,
        request,
        resolutionPlan: plan,
      }),
    };
    append(accumulator, profiles, {
      rootActionId: input.rootActionId,
      resolutionId: request.resolutionId,
      eventType: "RandomnessRequested",
      payload: {
        request,
        continuation,
        purpose: request.purpose,
        formula: request.diceExpression,
        resolutionPlan: plan,
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: [`entity:${actor.id}`, `fact:${plan.programFactRef}`],
      writes: [`continuation:${continuation.continuationId}`, `receipt:${input.rootActionId}`],
      creates: [`continuation:${continuation.continuationId}`],
    });
    requests.push(request);
    continuations.push(continuation);
  }
  if (requests.length === 0) {
    return settleProgram(accumulator, profiles, input.rootActionId, plan, new Map());
  }
  return finished("awaitingRandomness", accumulator, {
    randomnessRequest: requests[0],
    continuation: continuations[0],
    randomnessRequests: requests,
    continuations,
    mechanicalResult: {
      kind: "causalActionProgramPending",
      languageRef: plan.languageRef,
      languageHash: plan.languageHash,
      programHash: plan.programHash,
      checkNodeRefs: plan.checkNodeRefs,
    },
  });
}

function causalEntries(
  state: AuthoritativeWorldState,
  results: readonly CausalRandomnessResult[],
): Array<{
  continuation: AuthorityContinuation;
  rolls: number[];
  plan: CausalActionResolutionPlan;
  request: RandomnessRequest;
}> | undefined {
  const entries = results.flatMap((result) => {
    const stored = state.internalContinuations[result.continuation.continuationId];
    return stored !== undefined
      && stored.continuation.capability === result.continuation.capability
      && stored.resolutionPlan !== undefined
      && isCausalActionResolutionPlan(stored.resolutionPlan)
      ? [{
          continuation: result.continuation,
          rolls: result.rolls,
          plan: stored.resolutionPlan,
          request: stored.request,
        }]
      : [];
  });
  return entries.length === results.length ? entries : undefined;
}

export function fulfillCausalActionProgramRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  rolls: number[],
): StepResult | undefined {
  const stored = state.internalContinuations[continuationId];
  if (stored?.resolutionPlan === undefined || !isCausalActionResolutionPlan(stored.resolutionPlan)) {
    return undefined;
  }
  if (!causalActionInterpreterEnabled(profiles.extensions)) {
    return rejected("profileIntegrityMismatch", "The frozen V3 causal continuation is not enabled by this room manifest.");
  }
  if (stored.resolutionPlan.checkNodeRefs.length !== 1) {
    return rejected("invalidRulesInput", "A multi-check causal program requires its complete authoritative randomness batch.");
  }
  const nodeRef = stored.resolutionPlan.checkNodeRefs[0];
  return settleProgram(
    { state, events: [] },
    profiles,
    stored.rootActionId,
    stored.resolutionPlan,
    new Map([[nodeRef, { rolls, request: stored.request, continuationId }]]),
  );
}

export function fulfillCausalActionProgramRandomnessBatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  results: readonly CausalRandomnessResult[],
): StepResult | undefined {
  const entries = causalEntries(state, results);
  if (entries === undefined) return undefined;
  if (!causalActionInterpreterEnabled(profiles.extensions)) {
    return rejected("profileIntegrityMismatch", "The frozen V3 causal continuations are not enabled by this room manifest.");
  }
  if (entries.length === 0) return rejected("invalidRulesInput", "A causal randomness batch cannot be empty.");
  const plan = entries[0].plan;
  const rootActionId = state.internalContinuations[entries[0].continuation.continuationId]?.rootActionId;
  if (
    rootActionId === undefined
    || entries.some((entry) => canonicalSha256(entry.plan) !== canonicalSha256(plan))
    || entries.some((entry) =>
      state.internalContinuations[entry.continuation.continuationId]?.rootActionId !== rootActionId)
  ) return rejected("invalidRulesInput", "Causal randomness results do not share one frozen program and root.");

  const byNode = new Map<string, { rolls: number[]; request: RandomnessRequest; continuationId: string }>();
  for (const entry of entries) {
    const prefix = `resolution:${rootActionId}:causal:`;
    if (!entry.request.resolutionId.startsWith(prefix)) {
      return rejected("invalidRulesInput", "A causal randomness result is not bound to a frozen node.");
    }
    const nodeRef = entry.request.resolutionId.slice(prefix.length);
    if (byNode.has(nodeRef)) return rejected("invalidRulesInput", "A causal check result is duplicated.");
    byNode.set(nodeRef, {
      rolls: entry.rolls,
      request: entry.request,
      continuationId: entry.continuation.continuationId,
    });
  }
  if (
    byNode.size !== plan.checkNodeRefs.length
    || plan.checkNodeRefs.some((nodeRef) => !byNode.has(nodeRef))
  ) return rejected("invalidRulesInput", "The complete frozen causal check batch is required.");
  return settleProgram({ state, events: [] }, profiles, rootActionId, plan, byNode);
}
