import {
  CAUSAL_ACTION_LANGUAGE_PROFILE,
  lowerCausalActionProgram,
  validateCausalActionProgram,
  type CausalActionProgram,
  type CausalValue,
  type LoweredCausalStep,
} from "../../kp/causal-action-program";
import { canonicalSha256 } from "../profiles/canonical";
import {
  CAUSAL_ACTION_INTERPRETER_PROFILE,
  causalActionInterpreterEnabled,
} from "../profiles/causal-action-interpreter";
import type { RuntimeProfileManifest } from "../profiles/types";
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
  AuthoritativeWorldState,
  AuthorityContinuation,
  CausalActionResolutionPlan,
  CharacterRecord,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  PublicReceipt,
  RandomnessRequest,
  ScopeProof,
  StepResult,
} from "./model";
import { rejected } from "./results";
import {
  stepCompoundActionPlan,
  storyWaitsForExplicitContinuation,
} from "./compound-actions";
import { stepCampaignWorld } from "./campaign-actions";
import { stepCombatWorld } from "./combat-actions";
import { stepMultiplayerWorld } from "./multiplayer-actions";
import { isGearSlot } from "./character-gear";
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
import { dynamicNpcSocialMechanics } from "./social-model";
import {
  DYNAMIC_NPC_DEFAULT_SOCIAL_ARCHETYPE_REF,
  socialResolutionProfileEnabled,
} from "../profiles/social-resolution";
import { npcMechanicsProfileEnabled } from "../profiles/npc-mechanics";
import type { GearSlot } from "../../dnd/gear";

const CAUSAL_INPUT_KEYS = [
  "actionLanguageHash",
  "actionPlanVersion",
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
};

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

function scalarString(value: CausalValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function scalarNumber(value: CausalValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function stringList(value: CausalValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

const CHARACTER_PREMISE_METHOD = "establishCharacterPremise" as const;
const DYNAMIC_NPC_MATERIALIZATION_METHOD = "materializeDynamicNpc" as const;
const NPC_MECHANICAL_ENCOUNTER_METHOD = "materializeNpcMechanicalEncounter" as const;
const ITEM_TRANSFER_METHOD = "transferItem" as const;
const NPC_GEAR_CHANGE_METHOD = "changeNpcGear" as const;
const NPC_ITEM_STATE_CHANGE_METHOD = "changeNpcItemState" as const;
const NPC_ITEM_STATE_CAUSE_SCHEMA = "zhuwei.npc-mechanical-item-state-cause/v1" as const;
const CHARACTER_PREMISE_PREDICATES = [
  "arrivalPurpose",
  "priorKnowledge",
  "priorRelationship",
  "obligation",
  "affiliation",
  "identityBackground",
] as const;
const PREMISE_ENTITY_KINDS = [
  "person",
  "organization",
  "place",
  "object",
  "event",
  "task",
] as const;

function dynamicDefinitionKind(
  entityKind: typeof PREMISE_ENTITY_KINDS[number],
): "npc" | "organization" | "location" | "item" | "opportunity" {
  if (entityKind === "person") return "npc";
  if (entityKind === "organization") return "organization";
  if (entityKind === "place") return "location";
  if (entityKind === "object") return "item";
  return "opportunity";
}

function premiseAssertionPredicate(relationKind: string):
"affiliatedWith" | "intends" | "locatedAt" | "relatedTo" {
  if (relationKind === "affiliatedWith") return "affiliatedWith";
  if (relationKind === "boundFor" || relationKind === "seeksOrAssists") return "intends";
  if (relationKind === "originatedFrom") return "locatedAt";
  return "relatedTo";
}

type CharacterPremiseDraft = {
  schema: "zhuwei.character-premise-draft/v2";
  policyRef: string;
  predicate: typeof CHARACTER_PREMISE_PREDICATES[number];
  anchorRefs: string[];
  bindings: Array<{
    slotRef: string;
    referenceKind: "existing";
    ref: string;
  } | {
    slotRef: string;
    referenceKind: "openArchetype";
    archetypeRef: string;
    displayAlias: string;
  }>;
};

type DynamicNpcMaterializationDraft = {
  schema: "zhuwei.dynamic-npc-materialization-draft/v2";
  definitionRef: string;
  entityRef: string;
  sourceFactRefs: string[];
  initialKnowledgeFactRefs: string[];
  sceneRef: string;
};

type NpcMechanicalEncounterDraft = {
  schema: "zhuwei.npc-mechanical-encounter-draft/v1";
  encounterRef: string;
  alliedEntityRefs: string[];
  hostileEntityRefs: string[];
  entries: JsonRecord[];
};

type ItemTransferDraft = {
  schema: "zhuwei.item-transfer-draft/v1";
  toCharacterRef: string;
  itemRef: string;
  quantity: number;
};

type NpcGearChangeDraft =
  | {
      schema: "zhuwei.npc-gear-change-draft/v1";
      npcRef: string;
      action: "wear";
      slot: GearSlot;
      itemRef: string;
    }
  | {
      schema: "zhuwei.npc-gear-change-draft/v1";
      npcRef: string;
      action: "stow";
      slot: GearSlot;
    };

type NpcItemStateChangeDraft = {
  schema: "zhuwei.npc-item-state-change-draft/v1";
  npcRef: string;
  itemRef: string;
  action: "break" | "repair" | "destroy" | "lose";
  causeFactRef: string;
};

type NpcMechanicalCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "encounter"; draft: NpcMechanicalEncounterDraft; step: LoweredCausalStep }
  | { kind: "transfer"; draft: ItemTransferDraft; step: LoweredCausalStep }
  | { kind: "gear"; draft: NpcGearChangeDraft; step: LoweredCausalStep }
  | { kind: "itemState"; draft: NpcItemStateChangeDraft; step: LoweredCausalStep };

type PremisePolicySlot = {
  slotRef: string;
  relationKind: string;
  minimum: number;
  maximum: number;
  allowedExistingKinds: typeof PREMISE_ENTITY_KINDS[number][];
  allowedOpenArchetypeRefs: string[];
};

type PremisePolicy = {
  policyRef: string;
  predicate: CharacterPremiseDraft["predicate"];
  scope: "characterBackstory";
  minimumBindings: number;
  maximumBindings: number;
  allowedAnchorRefs: string[];
  slots: PremisePolicySlot[];
  statementTemplateRef: string;
};

type PremiseArchetype = {
  archetypeRef: string;
  entityKind: typeof PREMISE_ENTITY_KINDS[number];
  semanticCategory: string;
  displayTemplateRef: string;
  socialArchetypeRef?: string;
};

function boundedPremiseText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum;
}

function characterPremiseDraft(step: LoweredCausalStep): CharacterPremiseDraft | undefined {
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.method !== CHARACTER_PREMISE_METHOD
    || step.arguments.resolution !== "direct") return undefined;
  const serialized = scalarString(step.arguments.proposedFact);
  if (serialized === undefined || serialized.length > 4_000) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (!isRecord(value)
    || !hasExactKeys(value, ["anchorRefs", "bindings", "policyRef", "predicate", "schema"])
    || value.schema !== "zhuwei.character-premise-draft/v2"
    || !boundedPremiseText(value.policyRef, 240)
    || !(CHARACTER_PREMISE_PREDICATES as readonly unknown[]).includes(value.predicate)
    || !Array.isArray(value.anchorRefs)
    || value.anchorRefs.length < 1
    || value.anchorRefs.length > 4
    || !value.anchorRefs.every((entry) => boundedPremiseText(entry, 240))
    || new Set(value.anchorRefs).size !== value.anchorRefs.length
    || !Array.isArray(value.bindings)
    || value.bindings.length < 1
    || value.bindings.length > 8) return undefined;
  const bindings: CharacterPremiseDraft["bindings"] = [];
  for (const candidate of value.bindings) {
    if (!isRecord(candidate) || !boundedPremiseText(candidate.slotRef, 80)) return undefined;
    if (candidate.referenceKind === "existing") {
      if (!hasExactKeys(candidate, ["ref", "referenceKind", "slotRef"])
        || !boundedPremiseText(candidate.ref, 240)) return undefined;
      bindings.push({
        slotRef: candidate.slotRef,
        referenceKind: "existing",
        ref: candidate.ref,
      });
      continue;
    }
    if (candidate.referenceKind !== "openArchetype"
      || !hasExactKeys(candidate, ["archetypeRef", "displayAlias", "referenceKind", "slotRef"])
      || !boundedPremiseText(candidate.archetypeRef, 240)
      || !boundedPremiseText(candidate.displayAlias, 120)) return undefined;
    bindings.push({
      slotRef: candidate.slotRef,
      referenceKind: "openArchetype",
      archetypeRef: candidate.archetypeRef,
      displayAlias: candidate.displayAlias,
    });
  }
  return {
    schema: "zhuwei.character-premise-draft/v2",
    policyRef: value.policyRef as string,
    predicate: value.predicate as CharacterPremiseDraft["predicate"],
    anchorRefs: [...value.anchorRefs as string[]].sort(),
    bindings,
  };
}

function dynamicNpcMaterializationDraft(
  step: LoweredCausalStep,
): DynamicNpcMaterializationDraft | undefined {
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.method !== DYNAMIC_NPC_MATERIALIZATION_METHOD
    || step.arguments.resolution !== "direct") return undefined;
  const serialized = scalarString(step.arguments.proposedFact);
  if (serialized === undefined || serialized.length > 4_000) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "definitionRef", "entityRef", "sceneRef", "schema", "sourceFactRefs",
      "initialKnowledgeFactRefs",
    ])
    || value.schema !== "zhuwei.dynamic-npc-materialization-draft/v2"
    || ![value.definitionRef, value.entityRef, value.sceneRef].every(isNonEmptyString)
    || !Array.isArray(value.sourceFactRefs)
    || value.sourceFactRefs.length < 1
    || value.sourceFactRefs.length > 8
    || !value.sourceFactRefs.every(isNonEmptyString)
    || new Set(value.sourceFactRefs).size !== value.sourceFactRefs.length
    || !Array.isArray(value.initialKnowledgeFactRefs)
    || value.initialKnowledgeFactRefs.length > 8
    || !value.initialKnowledgeFactRefs.every(isNonEmptyString)
    || new Set(value.initialKnowledgeFactRefs).size !== value.initialKnowledgeFactRefs.length
    || value.initialKnowledgeFactRefs.some((factRef) =>
      !(value.sourceFactRefs as unknown[]).includes(factRef))) return undefined;
  const sourceFactRefs = value.sourceFactRefs as string[];
  const initialKnowledgeFactRefs = value.initialKnowledgeFactRefs as string[];
  return {
    schema: value.schema,
    definitionRef: value.definitionRef as string,
    entityRef: value.entityRef as string,
    sourceFactRefs: [...sourceFactRefs].sort(),
    initialKnowledgeFactRefs: [...initialKnowledgeFactRefs].sort(),
    sceneRef: value.sceneRef as string,
  };
}

function boundedReferenceList(
  value: unknown,
  maximum: number,
): string[] | undefined {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((entry) => isNonEmptyString(entry) && entry.length <= 240)
    && value.length === new Set(value).size
    ? [...value].sort()
    : undefined;
}

function npcMechanicalCausalDraft(program: CausalActionProgram): NpcMechanicalCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 16_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  const reservedMethod = method === NPC_MECHANICAL_ENCOUNTER_METHOD
    || method === ITEM_TRANSFER_METHOD
    || method === NPC_GEAR_CHANGE_METHOD
    || method === NPC_ITEM_STATE_CHANGE_METHOD;
  const reservedSchema = schema === "zhuwei.npc-mechanical-encounter-draft/v1"
    || schema === "zhuwei.item-transfer-draft/v1"
    || schema === "zhuwei.npc-gear-change-draft/v1"
    || schema === "zhuwei.npc-item-state-change-draft/v1";
  if (!reservedMethod && !reservedSchema) return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || !isRecord(value)) return { kind: "invalid" };

  if (method === NPC_MECHANICAL_ENCOUNTER_METHOD
    && schema === "zhuwei.npc-mechanical-encounter-draft/v1") {
    if (!hasExactKeys(value, [
      "alliedEntityRefs", "encounterRef", "entries", "hostileEntityRefs", "schema",
    ])
      || !isNonEmptyString(value.encounterRef)
      || value.encounterRef.length > 240
      || !Array.isArray(value.entries)
      || value.entries.length < 1
      || value.entries.length > 24
      || !value.entries.every(isRecord)) return { kind: "invalid" };
    const alliedEntityRefs = boundedReferenceList(value.alliedEntityRefs, 24);
    const hostileEntityRefs = boundedReferenceList(value.hostileEntityRefs, 24);
    const entryIds = value.entries.map((entry) => entry.entityId);
    if (alliedEntityRefs === undefined
      || hostileEntityRefs === undefined
      || hostileEntityRefs.length === 0
      || !entryIds.every(isNonEmptyString)
      || entryIds.length !== new Set(entryIds).size
      || entryIds.some((entityId) =>
        alliedEntityRefs.includes(entityId) === hostileEntityRefs.includes(entityId))) {
      return { kind: "invalid" };
    }
    return {
      kind: "encounter",
      step,
      draft: {
        schema,
        encounterRef: value.encounterRef,
        alliedEntityRefs,
        hostileEntityRefs,
        entries: structuredClone(value.entries) as JsonRecord[],
      },
    };
  }

  if (method === ITEM_TRANSFER_METHOD && schema === "zhuwei.item-transfer-draft/v1") {
    if (!hasExactKeys(value, ["itemRef", "quantity", "schema", "toCharacterRef"])
      || !isNonEmptyString(value.toCharacterRef)
      || !isNonEmptyString(value.itemRef)
      || !Number.isSafeInteger(value.quantity)
      || Number(value.quantity) < 1
      || Number(value.quantity) > 1_000_000) return { kind: "invalid" };
    return {
      kind: "transfer",
      step,
      draft: {
        schema,
        toCharacterRef: value.toCharacterRef,
        itemRef: value.itemRef,
        quantity: Number(value.quantity),
      },
    };
  }

  if (method === NPC_GEAR_CHANGE_METHOD
    && schema === "zhuwei.npc-gear-change-draft/v1") {
    if (!isNonEmptyString(value.npcRef) || !isGearSlot(value.slot)) return { kind: "invalid" };
    if (value.action === "wear") {
      if (!hasExactKeys(value, ["action", "itemRef", "npcRef", "schema", "slot"])
        || !isNonEmptyString(value.itemRef)) return { kind: "invalid" };
      return {
        kind: "gear",
        step,
        draft: {
          schema,
          npcRef: value.npcRef,
          action: "wear",
          slot: value.slot,
          itemRef: value.itemRef,
        },
      };
    }
    if (value.action !== "stow"
      || !hasExactKeys(value, ["action", "npcRef", "schema", "slot"])) {
      return { kind: "invalid" };
    }
    return {
      kind: "gear",
      step,
      draft: {
        schema,
        npcRef: value.npcRef,
        action: "stow",
        slot: value.slot,
      },
    };
  }

  if (method === NPC_ITEM_STATE_CHANGE_METHOD
    && schema === "zhuwei.npc-item-state-change-draft/v1"
    && hasExactKeys(value, ["action", "causeFactRef", "itemRef", "npcRef", "schema"])
    && isNonEmptyString(value.npcRef)
    && isNonEmptyString(value.itemRef)
    && isNonEmptyString(value.causeFactRef)
    && ["break", "repair", "destroy", "lose"].includes(String(value.action))) {
    return {
      kind: "itemState",
      step,
      draft: {
        schema,
        npcRef: value.npcRef,
        itemRef: value.itemRef,
        action: value.action as NpcItemStateChangeDraft["action"],
        causeFactRef: value.causeFactRef,
      },
    };
  }

  return { kind: "invalid" };
}

function npcItemStateCauseMatches(
  fact: AuthoritativeWorldState["canonicalFacts"][string] | undefined,
  draft: NpcItemStateChangeDraft,
): boolean {
  if (fact?.kind !== "npcMechanicalItemStateCause"
    || fact.subjectRefs.length !== 2
    || !fact.subjectRefs.includes(draft.npcRef)
    || !fact.subjectRefs.includes(draft.itemRef)
    || !isRecord(fact.value)
    || !hasExactKeys(fact.value, ["action", "itemRef", "npcRef", "schema"])) return false;
  return fact.value.schema === NPC_ITEM_STATE_CAUSE_SCHEMA
    && fact.value.npcRef === draft.npcRef
    && fact.value.itemRef === draft.itemRef
    && fact.value.action === draft.action;
}

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
  accumulator.scopeProof = scopeProof;
}

function finished(
  kind: "committed" | "awaitingInput" | "awaitingRandomness",
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
    receipt: accumulator.receipt,
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
    schema: "zhuwei.causal-action-resolution-plan/v3",
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
  const artifactRef = scalarString(terminal.arguments.artifactRef);
  const artifactCount = scalarNumber(terminal.arguments.artifactCount);
  if (artifactRef !== undefined && artifactCount !== undefined) {
    const itemId = artifactRef.slice("item:".length);
    const item = accumulator.state.entities[actor.id]?.loadout?.backpack
      ?.find((entry) => entry.itemId === itemId);
    if (item === undefined || item.quantity < artifactCount) return false;
    append(accumulator, profiles, {
      rootActionId,
      eventType: "ItemUsed",
      payload: {
        characterId: actor.id,
        itemId,
        quantity: artifactCount,
        remaining: item.quantity - artifactCount,
        purpose: programGoal([terminal]),
      },
      visibilityPolicyId: `visibility:character-controller:${actor.id}`,
      secrecy: "private",
      reads: [`entity:${actor.id}`, `item:${actor.id}:${itemId}`],
      writes: [`item:${actor.id}:${itemId}`, `receipt:${rootActionId}`],
    });
  }
  return true;
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

function appendMeaningfulFailure(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
): void {
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "MeaningfulFailureCommitted",
    payload: {
      characterId: plan.actorCharacterId,
      goalId: `goal:${rootActionId}:${step.nodeRef}`,
      methodFingerprint: scalarString(step.arguments.method) ?? step.nodeRef,
      factualCause: `resolution:${rootActionId}:causal:${step.nodeRef}:failed`,
      consequences: { effectKinds: branchText(step, "failure") === undefined ? [] : ["acquireEvidence"] },
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`entity:${plan.actorCharacterId}`, `fact:${plan.programFactRef}`],
    writes: [`failure:${rootActionId}:${step.nodeRef}`, `receipt:${rootActionId}`],
    creates: [`failure:${rootActionId}:${step.nodeRef}`],
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
  const result = stepCompoundActionPlan(profiles, accumulator.state, continueCompoundRoot({
    kind: "resolveCompoundActionPlan",
    actionPlanVersion: "authoritative-kp-action-plan-v1",
    rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId,
    feasibilityKind: "highRiskFeasible",
    goal: args.goal,
    method: args.method,
    publicBasisRefs: stringList(args.basisRefs),
    privateBasisRefs: [],
    adjudicationPrecedent: null,
    risk: {
      warning: scalarString(args.risk) ?? "战斗行动将按已安装的 SRD 5.1 规则结算。",
      successConsequences: [scalarString(args.intendedOutcome) ?? "战斗行动成功。"],
      failureConsequences: [],
      retryGate: ["methodChanged", "factsChanged", "costAccepted"],
    },
    dynamicMaterializations: [],
    npcActions: [],
    scene: {
      question: scalarString(args.goal) ?? "这次战斗行动会如何改变局面？",
      pressure: scalarString(args.risk) ?? "",
      opportunities: stringList(args.contingencies),
      conclusionCandidate: null,
    },
    mechanicalProposal: {
      operation: "invokeCombatAction",
      abilityRef: args.abilityRef,
    },
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
  const durationMicros = causalActionDurationMicros(parsed.step);
  if (durationMicros === undefined) {
    return rejected("invalidRulesInput", "NPC mechanical materialization needs one canonical duration.");
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  if (!appendFrozenCosts(accumulator, profiles, rootActionId, actor, parsed.step)) {
    return rejected("insufficientResource", "The frozen causal materialization cost is unavailable.");
  }

  let mechanical: StepResult | undefined;
  let disposition: string;
  if (parsed.kind === "encounter") {
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
      battlefieldFactIds: [],
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
      npcCharacterId: parsed.draft.npcRef,
      itemId: parsed.draft.itemRef,
      action: parsed.draft.action,
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
  accumulator.scopeProof = mechanical.scopeProof;
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
  return finished("committed", accumulator, { mechanicalResult });
}

function npcMechanicalBasisAvailable(
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
      const instance = npc.loadout?.mechanicalItems?.[itemId];
      const cause = state.canonicalFacts[parsed.draft.causeFactRef];
      if (instance === undefined
        || !visibleFactRefs.includes(parsed.draft.causeFactRef)
        || !npcItemStateCauseMatches(cause, parsed.draft)) return false;
      requiredRefs.add(itemId);
      requiredRefs.add(parsed.draft.causeFactRef);
      allowedRefs.add(itemId);
    }
  }
  return [...requiredRefs].every((reference) => refs.includes(reference))
    && refs.every((reference) => allowedRefs.has(reference));
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
  const npcMechanical = npcMechanicalCausalDraft(program);
  if (npcMechanical.kind === "invalid") return false;
  if (npcMechanical.kind !== "none") {
    return npcMechanicsProfileEnabled(profiles.extensions)
      && npcMechanicalBasisAvailable(state, actor, npcMechanical);
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

export function stepCausalActionProgram(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (
    input.kind !== "resolveCompoundActionPlan"
    || input.actionPlanVersion !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
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
    input.actionPlanVersion !== program.languageRef
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
  const npcMechanicalDraft = npcMechanicalCausalDraft(program);
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
  const terminal = lowered.steps.at(-1)!;
  if (!appendFrozenCosts(accumulator, profiles, input.rootActionId, actor, terminal)) {
    return rejected("invalidRulesInput", "The frozen causal action cost is unavailable.");
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
