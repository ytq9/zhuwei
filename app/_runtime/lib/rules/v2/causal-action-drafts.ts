import {
  lowerCausalActionProgram,
  type CausalActionProgram,
  type CausalValue,
  type LoweredCausalStep,
} from "../../kp/causal-action-program";
import type { GearSlot } from "../../dnd/gear";
import {
  isCanonicalTacticalGeometry,
  type CanonicalTacticalGeometry,
} from "../profiles/tactical-geometry";
import { isGearSlot } from "./character-gear";
import { HEALING_POTION_ITEM_DEFINITION_ID } from "./items";
import type { JsonRecord } from "./model";
import {
  hasExactKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";

export function scalarString(value: CausalValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function scalarNumber(value: CausalValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export function stringList(value: CausalValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

export const CHARACTER_PREMISE_METHOD = "establishCharacterPremise" as const;
export const DYNAMIC_NPC_MATERIALIZATION_METHOD = "materializeDynamicNpc" as const;
const ACTOR_PLAN_FORMATION_METHOD = "formActorPlan" as const;
const HIDDEN_REALITY_MATERIALIZATION_METHOD = "materializeHiddenReality" as const;
const NONCOMBAT_CONTEST_METHOD = "resolveNoncombatContest" as const;
const ADJUDICATION_PRECEDENT_METHOD = "recordAdjudicationPrecedent" as const;
const CAMPAIGN_LIFECYCLE_METHOD = "advanceCampaignLifecycle" as const;
const NPC_MECHANICAL_ENCOUNTER_METHOD = "materializeNpcMechanicalEncounter" as const;
const ITEM_MATERIALIZATION_METHOD = "materializeItem" as const;
const NARRATIVE_ITEM_MATERIALIZATION_METHOD = "materializeNarrativeItem" as const;
const SCENE_ITEM_ACQUISITION_METHOD = "acquireSceneItem" as const;
const DYNAMIC_PASSAGE_MOVE_METHOD = "materializePassageAndMove" as const;
const OBSERVE_EXISTING_FACT_METHOD = "observeExistingFact" as const;
export const OBSERVE_ITEM_INFORMATION_METHOD = "observeItemInformation" as const;
export const ITEM_TRANSFER_METHOD = "transferItem" as const;
const NPC_GEAR_CHANGE_METHOD = "changeNpcGear" as const;
const NPC_ITEM_STATE_CHANGE_METHOD = "changeNpcItemState" as const;
const WORLD_CONSEQUENCE_METHOD = "commitWorldConsequences" as const;
const ABILITY_DEFINITION_REGISTRATION_METHOD = "registerAbilityDefinition" as const;
const FACTION_DEFINITION_REGISTRATION_METHOD = "registerFactionDefinition" as const;
export const CHARACTER_PREMISE_PREDICATES = [
  "arrivalPurpose",
  "priorKnowledge",
  "priorRelationship",
  "obligation",
  "affiliation",
  "identityBackground",
] as const;
export const PREMISE_ENTITY_KINDS = [
  "person",
  "organization",
  "place",
  "object",
  "event",
  "task",
] as const;

export function dynamicDefinitionKind(
  entityKind: typeof PREMISE_ENTITY_KINDS[number],
): "npc" | "organization" | "location" | "item" | "opportunity" {
  if (entityKind === "person") return "npc";
  if (entityKind === "organization") return "organization";
  if (entityKind === "place") return "location";
  if (entityKind === "object") return "item";
  return "opportunity";
}

export function premiseAssertionPredicate(relationKind: string):
"affiliatedWith" | "intends" | "locatedAt" | "relatedTo" {
  if (relationKind === "affiliatedWith") return "affiliatedWith";
  if (relationKind === "boundFor" || relationKind === "seeksOrAssists") return "intends";
  if (relationKind === "originatedFrom") return "locatedAt";
  return "relatedTo";
}

export type CharacterPremiseDraft = {
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

export type DynamicNpcMaterializationDraft = {
  schema: "zhuwei.dynamic-npc-materialization-draft/v2";
  definitionRef: string;
  entityRef: string;
  sourceFactRefs: string[];
  initialKnowledgeFactRefs: string[];
  sceneRef: string;
};

type ActorPlanMaterializationDraft = {
  schema: "zhuwei.actor-plan-draft/v1";
  npcRef: string;
  factionRef: string | null;
  planId: string;
  goal: string;
  premiseRefs: string[];
  nextStep: string;
  resourceRefs: string[];
  activity: {
    activityId: string;
    activityKind: string;
    intendedDurationMicros: string;
  };
  due: { kind: "activityCompletion" } | null;
  trigger:
    | { kind: "committedEvent"; eventRef: string }
    | { kind: "knowledgeAcquired"; knowledgeRef: string }
    | null;
  trace: {
    factRef: string;
    description: string;
    visibilityPolicyRef: "visibility:scene-observers";
  };
  alternateTarget: {
    targetRef: string;
    reason: string;
  };
};

export type ActorPlanCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "actorPlan"; draft: ActorPlanMaterializationDraft; step: LoweredCausalStep };

export const HIDDEN_REALITY_KINDS = [
  "fact",
  "location",
  "passage",
  "hazard",
  "opportunity",
] as const;

export type HiddenRealityCandidate = {
  candidateId: string;
  hiddenWeight: number;
  kind: typeof HIDDEN_REALITY_KINDS[number];
  factRef: string;
  causalBasisRefs: string[];
  visibilityPolicyRef: string;
  definition: JsonRecord;
};

type HiddenRealityMaterializationDraft = {
  schema: "zhuwei.hidden-reality-candidate-set-draft/v1";
  candidateSetId: string;
  candidates: HiddenRealityCandidate[];
};

export type HiddenRealityCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "hiddenReality";
      draft: HiddenRealityMaterializationDraft;
      step: LoweredCausalStep;
    };

const CONTEST_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const CONTEST_MODES = ["normal", "advantage", "disadvantage"] as const;

type NoncombatContestMaterializationDraft = {
  schema: "zhuwei.noncombat-contest-draft/v1";
  defenderRef: string;
  initiatorAbility: typeof CONTEST_ABILITIES[number];
  initiatorSkill: string | null;
  defenderAbility: typeof CONTEST_ABILITIES[number];
  defenderSkill: string | null;
  mode: typeof CONTEST_MODES[number];
  tieResult: "statusQuo";
};

export type NoncombatContestCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "contest";
      draft: NoncombatContestMaterializationDraft;
      step: LoweredCausalStep;
    };

export type AdjudicationPrecedentMaterializationDraft = {
  schema: "zhuwei.adjudication-precedent-draft/v1";
  action: "record" | "supersede";
  publicRuleBasis: string[];
  publicBasisRefs: string[];
  privateBasisRefs: string[];
  applicabilityScope: {
    kind: "scene" | "campaign" | "module" | "room";
    ref: string;
  };
  supersededPrecedentId?: string;
  materialDifferences?: string[];
};

export type AdjudicationPrecedentCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "precedent";
      draft: AdjudicationPrecedentMaterializationDraft;
      step: LoweredCausalStep;
    };

type ChapterActivityTransitionDraft = {
  activityId: string;
  disposition: "continue" | "summarize" | "interrupt" | "complete";
};

type CampaignLifecycleMaterializationDraft =
  | {
      schema: "zhuwei.campaign-lifecycle-draft/v1";
      action: "raiseEndingCandidate";
      endingCandidateRef: string;
      basisRefs: string[];
      unresolvedRefs: string[];
    }
  | {
      schema: "zhuwei.campaign-lifecycle-draft/v1";
      action: "concludeStory";
      endingCandidateRef: string;
      storyRef: string;
      outcome: string;
      consequenceRefs: string[];
    }
  | {
      schema: "zhuwei.campaign-lifecycle-draft/v1";
      action: "transitionChapter";
      chapterRef: string;
      storyAnchorRefs: string[];
      sceneQuestion: string;
      activityTransitions: ChapterActivityTransitionDraft[];
    }
  | {
      schema: "zhuwei.campaign-lifecycle-draft/v1";
      action: "commitMeaningfulFailure";
      precedentRef: string;
      basisRefs: string[];
      consequenceRefs: string[];
      newOptions: Array<{ optionId: string; summary: string }>;
    }
  | {
      schema: "zhuwei.campaign-lifecycle-draft/v1";
      action: "retryFailedAction";
      precedentRef: string;
      changeKind:
        | "methodChanged"
        | "factsChanged"
        | "costAccepted"
        | "positionChanged"
        | "materialAssistance"
        | "situationAdvanced"
        | null;
      evidenceRefs: string[];
    };

export type CampaignLifecycleCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "lifecycle";
      draft: CampaignLifecycleMaterializationDraft;
      step: LoweredCausalStep;
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
  ownershipDisposition: "preserve" | "transferToRecipient";
};

type ItemMaterializationDraft = {
  schema: "zhuwei.item-materialization-draft/v1";
  definitionRef: typeof HEALING_POTION_ITEM_DEFINITION_ID;
  quantity: number;
};

export type ItemMaterializationCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "item"; draft: ItemMaterializationDraft; step: LoweredCausalStep };

export type NarrativeItemMaterializationDraft = {
  schema: "zhuwei.narrative-item-draft/v1";
  action: "materializeInScene" | "materializeAndAcquire";
  entryRef: string;
  definitionRef: string;
  name: string;
  description: string;
  causalBasisRefs: string[];
};

export type NarrativeItemMaterializationCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "narrativeItem";
      draft: NarrativeItemMaterializationDraft;
      step: LoweredCausalStep;
    };

type SceneItemAcquisitionDraft = {
  schema: "zhuwei.scene-item-acquisition-draft/v1";
  itemRef: string;
};

export type SceneItemAcquisitionCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "sceneItemAcquisition";
      draft: SceneItemAcquisitionDraft;
      step: LoweredCausalStep;
    };

type WorldConsequence =
  | { kind: "spendResource"; resourceRef: string; amount: number }
  | { kind: "acquireKnowledge"; knowledgeRef: string; content: string }
  | {
      kind: "updateRelationship";
      relationshipRef: string;
      counterpartyRefs: string[];
      change: string;
    }
  | {
      kind: "recordPromise";
      promiseRef: string;
      counterpartyRef: string;
      content: string;
      condition: string;
    }
  | {
      kind: "recordDebt";
      debtRef: string;
      counterpartyRef: string;
      obligation: string;
      condition: string;
    };

type WorldConsequenceMaterializationDraft = {
  schema: "zhuwei.world-consequence-draft/v1";
  factRef: string;
  summary: string;
  consequences: WorldConsequence[];
};

export type WorldConsequenceCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "worldConsequences";
      draft: WorldConsequenceMaterializationDraft;
      step: LoweredCausalStep;
    };

type AbilityDefinitionRegistrationDraft = {
  schema: "zhuwei.ability-definition-draft/v1";
  definition: JsonRecord;
  causalBasisRefs: string[];
};

type FactionDefinitionRegistrationDraft = {
  schema: "zhuwei.faction-definition-draft/v1";
  factionRef: string;
  name: string;
  goal: string;
  memberRefs: string[];
  resourceRefs: string[];
  causalBasisRefs: string[];
};

export type DefinitionRegistrationCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "abilityDefinition";
      draft: AbilityDefinitionRegistrationDraft;
      step: LoweredCausalStep;
    }
  | {
      kind: "factionDefinition";
      draft: FactionDefinitionRegistrationDraft;
      step: LoweredCausalStep;
    };

type DynamicPassageMoveDraft = {
  schema: "zhuwei.dynamic-passage-move-draft/v1";
  locationRef: string;
  destinationSceneRef: string;
  destinationName: string;
  passageRef: string;
  traversal: string;
  geometry: CanonicalTacticalGeometry;
};

export type DynamicPassageMoveCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "passageMove"; draft: DynamicPassageMoveDraft; step: LoweredCausalStep };

type ObservedFactAcquisitionDraft = {
  schema: "zhuwei.observed-fact-acquisition-draft/v1";
  factRef: string;
  observedContent: string;
};

export type ObservedFactAcquisitionCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "observedFact"; draft: ObservedFactAcquisitionDraft; step: LoweredCausalStep };

type ItemInformationObservationDraft = {
  schema: "zhuwei.item-information-observation-draft/v1";
  itemRef: string;
  sourceRef: string;
  information:
    | {
        kind: "sensoryEvidence";
        sense: "visual" | "auditory" | "olfactory" | "tactile" | "other";
        content: string;
      }
    | {
        kind: "sourceClaim";
        semanticContent: string;
        sourceBasis: string | null;
        motive: string | null;
        formedAtFictionMicros: string | null;
      };
};

export type ItemInformationObservationCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
      kind: "itemInformation";
      draft: ItemInformationObservationDraft;
      step: LoweredCausalStep;
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
  action: "break" | "repair" | "destroy";
  causeFactRef: string;
};

export type NpcMechanicalCausalDraft =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "encounter"; draft: NpcMechanicalEncounterDraft; step: LoweredCausalStep }
  | { kind: "transfer"; draft: ItemTransferDraft; step: LoweredCausalStep }
  | { kind: "gear"; draft: NpcGearChangeDraft; step: LoweredCausalStep }
  | { kind: "itemState"; draft: NpcItemStateChangeDraft; step: LoweredCausalStep };

export type PremisePolicySlot = {
  slotRef: string;
  relationKind: string;
  minimum: number;
  maximum: number;
  allowedExistingKinds: typeof PREMISE_ENTITY_KINDS[number][];
  allowedOpenArchetypeRefs: string[];
};

export type PremisePolicy = {
  policyRef: string;
  predicate: CharacterPremiseDraft["predicate"];
  scope: "characterBackstory";
  minimumBindings: number;
  maximumBindings: number;
  allowedAnchorRefs: string[];
  slots: PremisePolicySlot[];
  statementTemplateRef: string;
};

export type PremiseArchetype = {
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

export function characterPremiseDraft(step: LoweredCausalStep): CharacterPremiseDraft | undefined {
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

export function dynamicNpcMaterializationDraft(
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

export function boundedReferenceList(
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

function stableItemReference(
  value: unknown,
  prefix: "item-entry:" | "item-definition:",
): value is string {
  return boundedPremiseText(value, 240)
    && value.trim() === value
    && value.normalize("NFC") === value
    && value.startsWith(prefix)
    && value.length > prefix.length;
}

function stableItemInformationReference(value: unknown): value is string {
  const prefix = "fact:item-information:";
  return boundedPremiseText(value, 300)
    && value.trim() === value
    && value.normalize("NFC") === value
    && value.startsWith(prefix)
    && value.length > prefix.length;
}

function boundedCanonicalItemText(value: unknown, maximum: number): value is string {
  return boundedPremiseText(value, maximum)
    && value.trim() === value
    && value.normalize("NFC") === value;
}

function parseActorPlanMaterializationDraft(
  value: unknown,
): ActorPlanMaterializationDraft | undefined {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "activity",
      "alternateTarget",
      "due",
      "factionRef",
      "goal",
      "nextStep",
      "npcRef",
      "planId",
      "premiseRefs",
      "resourceRefs",
      "schema",
      "trace",
      "trigger",
    ])
    || value.schema !== "zhuwei.actor-plan-draft/v1"
    || !(value.factionRef === null
      || (isNonEmptyString(value.factionRef) && value.factionRef.length <= 240))
    || ![value.npcRef, value.planId, value.goal, value.nextStep].every((entry) =>
      isNonEmptyString(entry) && entry.length <= 480)
    || !isRecord(value.activity)
    || !hasExactKeys(value.activity, ["activityId", "activityKind", "intendedDurationMicros"])
    || ![value.activity.activityId, value.activity.activityKind].every((entry) =>
      isNonEmptyString(entry) && entry.length <= 240)
    || typeof value.activity.intendedDurationMicros !== "string"
    || !/^[1-9][0-9]*$/u.test(value.activity.intendedDurationMicros)
    || !isRecord(value.trace)
    || !hasExactKeys(value.trace, ["description", "factRef", "visibilityPolicyRef"])
    || ![value.trace.factRef, value.trace.description].every((entry) =>
      isNonEmptyString(entry) && entry.length <= 480)
    || value.trace.visibilityPolicyRef !== "visibility:scene-observers"
    || !isRecord(value.alternateTarget)
    || !hasExactKeys(value.alternateTarget, ["reason", "targetRef"])
    || ![value.alternateTarget.reason, value.alternateTarget.targetRef].every((entry) =>
      isNonEmptyString(entry) && entry.length <= 480)) return undefined;

  const premiseRefs = boundedReferenceList(value.premiseRefs, 40);
  const resourceRefs = boundedReferenceList(value.resourceRefs, 40);
  if (premiseRefs === undefined || premiseRefs.length === 0 || resourceRefs === undefined) {
    return undefined;
  }

  const due = value.due === null
    ? null
    : isRecord(value.due)
      && hasExactKeys(value.due, ["kind"])
      && value.due.kind === "activityCompletion"
      ? { kind: "activityCompletion" as const }
      : undefined;
  let trigger: ActorPlanMaterializationDraft["trigger"] | undefined;
  if (value.trigger === null) {
    trigger = null;
  } else if (isRecord(value.trigger)
    && value.trigger.kind === "knowledgeAcquired"
    && hasExactKeys(value.trigger, ["kind", "knowledgeRef"])
    && isNonEmptyString(value.trigger.knowledgeRef)
    && value.trigger.knowledgeRef.length <= 240) {
    trigger = { kind: "knowledgeAcquired", knowledgeRef: value.trigger.knowledgeRef };
  } else if (isRecord(value.trigger)
    && value.trigger.kind === "committedEvent"
    && hasExactKeys(value.trigger, ["eventRef", "kind"])
    && isNonEmptyString(value.trigger.eventRef)
    && value.trigger.eventRef.length <= 240) {
    trigger = { kind: "committedEvent", eventRef: value.trigger.eventRef };
  }
  if (due === undefined || trigger === undefined || ((due === null) === (trigger === null))) {
    return undefined;
  }

  return {
    schema: "zhuwei.actor-plan-draft/v1",
    npcRef: value.npcRef as string,
    factionRef: value.factionRef as string | null,
    planId: value.planId as string,
    goal: value.goal as string,
    premiseRefs,
    nextStep: value.nextStep as string,
    resourceRefs,
    activity: {
      activityId: value.activity.activityId as string,
      activityKind: value.activity.activityKind as string,
      intendedDurationMicros: value.activity.intendedDurationMicros,
    },
    due,
    trigger,
    trace: {
      factRef: value.trace.factRef as string,
      description: value.trace.description as string,
      visibilityPolicyRef: "visibility:scene-observers",
    },
    alternateTarget: {
      targetRef: value.alternateTarget.targetRef as string,
      reason: value.alternateTarget.reason as string,
    },
  };
}

export function actorPlanCausalDraft(program: CausalActionProgram): ActorPlanCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 4_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== ACTOR_PLAN_FORMATION_METHOD
    && schema !== "zhuwei.actor-plan-draft/v1") return { kind: "none" };
  const draft = parseActorPlanMaterializationDraft(value);
  return step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || method !== ACTOR_PLAN_FORMATION_METHOD
    || draft === undefined
    ? { kind: "invalid" }
    : { kind: "actorPlan", step, draft };
}

function hiddenRealityDefinitionContainsAuthorityField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hiddenRealityDefinitionContainsAuthorityField);
  }
  if (!isRecord(value)) return false;
  const forbidden = new Set([
    "actorCharacterId",
    "principalId",
    "rootActionId",
    "eventId",
    "eventSeq",
    "eventType",
    "state",
    "stateHash",
    "rolls",
    "selectedFace",
    "runtimeManifestRef",
    "rulesetVersion",
  ]);
  return Object.entries(value).some(([key, entry]) =>
    forbidden.has(key) || hiddenRealityDefinitionContainsAuthorityField(entry));
}

export function hiddenRealityCausalDraft(program: CausalActionProgram): HiddenRealityCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 8_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== HIDDEN_REALITY_MATERIALIZATION_METHOD
    && schema !== "zhuwei.hidden-reality-candidate-set-draft/v1") return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || method !== HIDDEN_REALITY_MATERIALIZATION_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, ["candidateSetId", "candidates", "schema"])
    || value.schema !== "zhuwei.hidden-reality-candidate-set-draft/v1"
    || !boundedPremiseText(value.candidateSetId, 240)
    || !Array.isArray(value.candidates)
    || value.candidates.length < 2
    || value.candidates.length > 12) return { kind: "invalid" };

  let totalWeight = 0;
  const candidates: HiddenRealityCandidate[] = [];
  for (const candidate of value.candidates) {
    if (!isRecord(candidate)
      || !hasExactKeys(candidate, [
        "candidateId",
        "causalBasisRefs",
        "definition",
        "factRef",
        "hiddenWeight",
        "kind",
        "visibilityPolicyRef",
      ])
      || !boundedPremiseText(candidate.candidateId, 240)
      || !boundedPremiseText(candidate.factRef, 240)
      || !(HIDDEN_REALITY_KINDS as readonly unknown[]).includes(candidate.kind)
      || !Number.isSafeInteger(candidate.hiddenWeight)
      || Number(candidate.hiddenWeight) < 1
      || !boundedPremiseText(candidate.visibilityPolicyRef, 240)
      || !isRecord(candidate.definition)
      || hiddenRealityDefinitionContainsAuthorityField(candidate.definition)) {
      return { kind: "invalid" };
    }
    const causalBasisRefs = boundedReferenceList(candidate.causalBasisRefs, 24);
    if (causalBasisRefs === undefined) return { kind: "invalid" };
    totalWeight += Number(candidate.hiddenWeight);
    if (!Number.isSafeInteger(totalWeight) || totalWeight > 1_000_000) {
      return { kind: "invalid" };
    }
    candidates.push({
      candidateId: candidate.candidateId,
      hiddenWeight: Number(candidate.hiddenWeight),
      kind: candidate.kind as HiddenRealityCandidate["kind"],
      factRef: candidate.factRef,
      causalBasisRefs,
      visibilityPolicyRef: candidate.visibilityPolicyRef,
      definition: structuredClone(candidate.definition),
    });
  }
  if (new Set(candidates.map(({ candidateId }) => candidateId)).size !== candidates.length
    || new Set(candidates.map(({ factRef }) => factRef)).size !== candidates.length) {
    return { kind: "invalid" };
  }
  return {
    kind: "hiddenReality",
    step,
    draft: {
      schema: "zhuwei.hidden-reality-candidate-set-draft/v1",
      candidateSetId: value.candidateSetId,
      candidates,
    },
  };
}

export function noncombatContestCausalDraft(program: CausalActionProgram): NoncombatContestCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 2_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== NONCOMBAT_CONTEST_METHOD
    && schema !== "zhuwei.noncombat-contest-draft/v1") return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || method !== NONCOMBAT_CONTEST_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, [
      "defenderAbility",
      "defenderRef",
      "defenderSkill",
      "initiatorAbility",
      "initiatorSkill",
      "mode",
      "schema",
      "tieResult",
    ])
    || value.schema !== "zhuwei.noncombat-contest-draft/v1"
    || !boundedPremiseText(value.defenderRef, 240)
    || !(CONTEST_ABILITIES as readonly unknown[]).includes(value.initiatorAbility)
    || !(CONTEST_ABILITIES as readonly unknown[]).includes(value.defenderAbility)
    || !(value.initiatorSkill === null || boundedPremiseText(value.initiatorSkill, 120))
    || !(value.defenderSkill === null || boundedPremiseText(value.defenderSkill, 120))
    || !(CONTEST_MODES as readonly unknown[]).includes(value.mode)
    || value.tieResult !== "statusQuo") return { kind: "invalid" };
  return {
    kind: "contest",
    step,
    draft: {
      schema: "zhuwei.noncombat-contest-draft/v1",
      defenderRef: value.defenderRef,
      initiatorAbility: value.initiatorAbility as NoncombatContestMaterializationDraft["initiatorAbility"],
      initiatorSkill: value.initiatorSkill as string | null,
      defenderAbility: value.defenderAbility as NoncombatContestMaterializationDraft["defenderAbility"],
      defenderSkill: value.defenderSkill as string | null,
      mode: value.mode as NoncombatContestMaterializationDraft["mode"],
      tieResult: "statusQuo",
    },
  };
}

function boundedTextList(value: unknown, maximumEntries: number, maximumLength: number): string[] | undefined {
  return Array.isArray(value)
    && value.length <= maximumEntries
    && value.every((entry) => boundedPremiseText(entry, maximumLength))
    && value.length === new Set(value).size
    ? [...value]
    : undefined;
}

export function adjudicationPrecedentCausalDraft(
  program: CausalActionProgram,
): AdjudicationPrecedentCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 4_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== ADJUDICATION_PRECEDENT_METHOD
    && schema !== "zhuwei.adjudication-precedent-draft/v1") return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "check"
    || method !== ADJUDICATION_PRECEDENT_METHOD
    || !isRecord(value)
    || value.schema !== "zhuwei.adjudication-precedent-draft/v1"
    || !(value.action === "record" || value.action === "supersede")
    || !isRecord(value.applicabilityScope)
    || !hasExactKeys(value.applicabilityScope, ["kind", "ref"])
    || !["scene", "campaign", "module", "room"].includes(String(value.applicabilityScope.kind))
    || !boundedPremiseText(value.applicabilityScope.ref, 240)) return { kind: "invalid" };
  const publicRuleBasis = boundedTextList(value.publicRuleBasis, 12, 800);
  const publicBasisRefs = boundedReferenceList(value.publicBasisRefs, 24);
  const privateBasisRefs = boundedReferenceList(value.privateBasisRefs, 24);
  if (publicRuleBasis === undefined
    || publicRuleBasis.length === 0
    || publicBasisRefs === undefined
    || privateBasisRefs === undefined) return { kind: "invalid" };
  if (value.action === "record") {
    if (!hasExactKeys(value, [
      "action",
      "applicabilityScope",
      "privateBasisRefs",
      "publicBasisRefs",
      "publicRuleBasis",
      "schema",
    ])) return { kind: "invalid" };
    return {
      kind: "precedent",
      step,
      draft: {
        schema: "zhuwei.adjudication-precedent-draft/v1",
        action: "record",
        publicRuleBasis,
        publicBasisRefs,
        privateBasisRefs,
        applicabilityScope: {
          kind: value.applicabilityScope.kind as AdjudicationPrecedentMaterializationDraft["applicabilityScope"]["kind"],
          ref: value.applicabilityScope.ref,
        },
      },
    };
  }
  const materialDifferences = boundedTextList(value.materialDifferences, 12, 800);
  if (!hasExactKeys(value, [
    "action",
    "applicabilityScope",
    "materialDifferences",
    "privateBasisRefs",
    "publicBasisRefs",
    "publicRuleBasis",
    "schema",
    "supersededPrecedentId",
  ])
    || !boundedPremiseText(value.supersededPrecedentId, 240)
    || materialDifferences === undefined
    || materialDifferences.length === 0) return { kind: "invalid" };
  return {
    kind: "precedent",
    step,
    draft: {
      schema: "zhuwei.adjudication-precedent-draft/v1",
      action: "supersede",
      publicRuleBasis,
      publicBasisRefs,
      privateBasisRefs,
      applicabilityScope: {
        kind: value.applicabilityScope.kind as AdjudicationPrecedentMaterializationDraft["applicabilityScope"]["kind"],
        ref: value.applicabilityScope.ref,
      },
      supersededPrecedentId: value.supersededPrecedentId,
      materialDifferences,
    },
  };
}

export function campaignLifecycleCausalDraft(program: CausalActionProgram): CampaignLifecycleCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 8_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== CAMPAIGN_LIFECYCLE_METHOD
    && schema !== "zhuwei.campaign-lifecycle-draft/v1") return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || method === undefined
    || !isRecord(value)
    || value.schema !== "zhuwei.campaign-lifecycle-draft/v1"
    || !isNonEmptyString(value.action)) return { kind: "invalid" };

  if (value.action === "raiseEndingCandidate") {
    const basisRefs = boundedReferenceList(value.basisRefs, 40);
    const unresolvedRefs = boundedReferenceList(value.unresolvedRefs, 40);
    if (!hasExactKeys(value, [
      "action", "basisRefs", "endingCandidateRef", "schema", "unresolvedRefs",
    ])
      || step.arguments.resolution !== "direct"
      || !boundedPremiseText(value.endingCandidateRef, 240)
      || basisRefs === undefined
      || basisRefs.length === 0
      || unresolvedRefs === undefined) return { kind: "invalid" };
    return {
      kind: "lifecycle",
      step,
      draft: {
        schema: "zhuwei.campaign-lifecycle-draft/v1",
        action: "raiseEndingCandidate",
        endingCandidateRef: value.endingCandidateRef,
        basisRefs,
        unresolvedRefs,
      },
    };
  }
  if (value.action === "concludeStory") {
    const consequenceRefs = boundedTextList(value.consequenceRefs, 40, 800);
    if (!hasExactKeys(value, [
      "action", "consequenceRefs", "endingCandidateRef", "outcome", "schema", "storyRef",
    ])
      || step.arguments.resolution !== "direct"
      || ![
        value.endingCandidateRef,
        value.outcome,
        value.storyRef,
      ].every((entry) => boundedPremiseText(entry, 480))
      || consequenceRefs === undefined) return { kind: "invalid" };
    return {
      kind: "lifecycle",
      step,
      draft: {
        schema: "zhuwei.campaign-lifecycle-draft/v1",
        action: "concludeStory",
        endingCandidateRef: value.endingCandidateRef as string,
        storyRef: value.storyRef as string,
        outcome: value.outcome as string,
        consequenceRefs,
      },
    };
  }
  if (value.action === "transitionChapter") {
    const storyAnchorRefs = boundedReferenceList(value.storyAnchorRefs, 40);
    if (!hasExactKeys(value, [
      "action",
      "activityTransitions",
      "chapterRef",
      "sceneQuestion",
      "schema",
      "storyAnchorRefs",
    ])
      || step.arguments.resolution !== "direct"
      || !boundedPremiseText(value.chapterRef, 240)
      || !boundedPremiseText(value.sceneQuestion, 800)
      || storyAnchorRefs === undefined
      || !Array.isArray(value.activityTransitions)
      || value.activityTransitions.length > 40) return { kind: "invalid" };
    const activityTransitions: ChapterActivityTransitionDraft[] = [];
    for (const transition of value.activityTransitions) {
      if (!isRecord(transition)
        || !hasExactKeys(transition, ["activityId", "disposition"])
        || !boundedPremiseText(transition.activityId, 240)
        || !["continue", "summarize", "interrupt", "complete"].includes(
          String(transition.disposition),
        )) return { kind: "invalid" };
      activityTransitions.push({
        activityId: transition.activityId,
        disposition: transition.disposition as ChapterActivityTransitionDraft["disposition"],
      });
    }
    activityTransitions.sort((left, right) => left.activityId.localeCompare(right.activityId));
    if (new Set(activityTransitions.map(({ activityId }) => activityId)).size
      !== activityTransitions.length) return { kind: "invalid" };
    return {
      kind: "lifecycle",
      step,
      draft: {
        schema: "zhuwei.campaign-lifecycle-draft/v1",
        action: "transitionChapter",
        chapterRef: value.chapterRef,
        storyAnchorRefs,
        sceneQuestion: value.sceneQuestion,
        activityTransitions,
      },
    };
  }
  if (value.action === "retryFailedAction") {
    const evidenceRefs = boundedReferenceList(value.evidenceRefs, 40);
    const changeKinds = [
      "methodChanged",
      "factsChanged",
      "costAccepted",
      "positionChanged",
      "materialAssistance",
      "situationAdvanced",
    ];
    if (!hasExactKeys(value, [
      "action", "changeKind", "evidenceRefs", "precedentRef", "schema",
    ])
      || step.arguments.resolution !== "check"
      || !boundedPremiseText(value.precedentRef, 240)
      || !(value.changeKind === null || changeKinds.includes(String(value.changeKind)))
      || evidenceRefs === undefined
      || (value.changeKind === null && evidenceRefs.length !== 0)
      || (value.changeKind !== null
        && value.changeKind !== "methodChanged"
        && evidenceRefs.length === 0)) return { kind: "invalid" };
    return {
      kind: "lifecycle",
      step,
      draft: {
        schema: "zhuwei.campaign-lifecycle-draft/v1",
        action: "retryFailedAction",
        precedentRef: value.precedentRef,
        changeKind: value.changeKind as Extract<
          CampaignLifecycleMaterializationDraft,
          { action: "retryFailedAction" }
        >["changeKind"],
        evidenceRefs,
      },
    };
  }
  if (value.action !== "commitMeaningfulFailure") return { kind: "invalid" };
  const basisRefs = boundedReferenceList(value.basisRefs, 40);
  const consequenceRefs = boundedTextList(value.consequenceRefs, 40, 800);
  if (!hasExactKeys(value, [
    "action", "basisRefs", "consequenceRefs", "newOptions", "precedentRef", "schema",
  ])
    || step.arguments.resolution !== "direct"
    || !boundedPremiseText(value.precedentRef, 240)
    || basisRefs === undefined
    || basisRefs.length === 0
    || consequenceRefs === undefined
    || !Array.isArray(value.newOptions)
    || value.newOptions.length < 1
    || value.newOptions.length > 12) return { kind: "invalid" };
  const newOptions: Array<{ optionId: string; summary: string }> = [];
  for (const option of value.newOptions) {
    if (!isRecord(option)
      || !hasExactKeys(option, ["optionId", "summary"])
      || !boundedPremiseText(option.optionId, 240)
      || !boundedPremiseText(option.summary, 800)) return { kind: "invalid" };
    newOptions.push({ optionId: option.optionId, summary: option.summary });
  }
  if (new Set(newOptions.map(({ optionId }) => optionId)).size !== newOptions.length) {
    return { kind: "invalid" };
  }
  return {
    kind: "lifecycle",
    step,
    draft: {
      schema: "zhuwei.campaign-lifecycle-draft/v1",
      action: "commitMeaningfulFailure",
      precedentRef: value.precedentRef,
      basisRefs,
      consequenceRefs,
      newOptions,
    },
  };
}

export function observedFactAcquisitionCausalDraft(
  program: CausalActionProgram,
): ObservedFactAcquisitionCausalDraft {
  if (program.formRef !== "observe.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.desiredInformation);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 1_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== OBSERVE_EXISTING_FACT_METHOD
    && schema !== "zhuwei.observed-fact-acquisition-draft/v1") return { kind: "none" };
  if (step.primitive !== "inspectFiction"
    || step.arguments.resolution !== "direct"
    || method !== OBSERVE_EXISTING_FACT_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, ["factRef", "observedContent", "schema"])
    || value.schema !== "zhuwei.observed-fact-acquisition-draft/v1"
    || !boundedPremiseText(value.factRef, 240)
    || !boundedPremiseText(value.observedContent, 4_000)
    || step.arguments.focus !== value.factRef) return { kind: "invalid" };
  return {
    kind: "observedFact",
    step,
    draft: {
      schema: value.schema,
      factRef: value.factRef,
      observedContent: value.observedContent,
    },
  };
}

export function itemInformationObservationCausalDraft(
  program: CausalActionProgram,
): ItemInformationObservationCausalDraft {
  if (program.formRef !== "observe.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.desiredInformation);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 8_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== OBSERVE_ITEM_INFORMATION_METHOD
    && schema !== "zhuwei.item-information-observation-draft/v1") return { kind: "none" };
  if (step.primitive !== "inspectFiction"
    || step.arguments.resolution !== "direct"
    || method !== OBSERVE_ITEM_INFORMATION_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, ["information", "itemRef", "schema", "sourceRef"])
    || value.schema !== "zhuwei.item-information-observation-draft/v1"
    || !boundedPremiseText(value.itemRef, 300)
    || !stableItemInformationReference(value.sourceRef)
    || step.arguments.focus !== value.itemRef
    || !isRecord(value.information)) return { kind: "invalid" };
  const information = value.information;
  if (information.kind === "sensoryEvidence") {
    if (!hasExactKeys(information, ["content", "kind", "sense"])
      || !["visual", "auditory", "olfactory", "tactile", "other"]
        .includes(String(information.sense))
      || !boundedPremiseText(information.content, 4_000)) return { kind: "invalid" };
    return {
      kind: "itemInformation",
      step,
      draft: {
        schema: value.schema,
        itemRef: value.itemRef,
        sourceRef: value.sourceRef,
        information: {
          kind: "sensoryEvidence",
          sense: information.sense as Extract<
            ItemInformationObservationDraft["information"],
            { kind: "sensoryEvidence" }
          >["sense"],
          content: information.content,
        },
      },
    };
  }
  if (information.kind !== "sourceClaim"
    || !hasExactKeys(information, [
      "formedAtFictionMicros",
      "kind",
      "motive",
      "semanticContent",
      "sourceBasis",
    ])
    || !boundedPremiseText(information.semanticContent, 4_000)
    || !(information.sourceBasis === null
      || boundedPremiseText(information.sourceBasis, 2_000))
    || !(information.motive === null || boundedPremiseText(information.motive, 2_000))
    || !(information.formedAtFictionMicros === null
      || (typeof information.formedAtFictionMicros === "string"
        && /^(?:0|[1-9][0-9]*)$/u.test(information.formedAtFictionMicros)))) {
    return { kind: "invalid" };
  }
  return {
    kind: "itemInformation",
    step,
    draft: {
      schema: value.schema,
      itemRef: value.itemRef,
      sourceRef: value.sourceRef,
      information: {
        kind: "sourceClaim",
        semanticContent: information.semanticContent,
        sourceBasis: information.sourceBasis,
        motive: information.motive,
        formedAtFictionMicros: information.formedAtFictionMicros,
      },
    },
  };
}

export function itemMaterializationCausalDraft(
  program: CausalActionProgram,
): ItemMaterializationCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 1_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== ITEM_MATERIALIZATION_METHOD
    && schema !== "zhuwei.item-materialization-draft/v1") return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || method !== ITEM_MATERIALIZATION_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, ["definitionRef", "quantity", "schema"])
    || value.schema !== "zhuwei.item-materialization-draft/v1"
    || value.definitionRef !== HEALING_POTION_ITEM_DEFINITION_ID
    || !Number.isSafeInteger(value.quantity)
    || Number(value.quantity) < 1
    || Number(value.quantity) > 1_000_000) return { kind: "invalid" };
  return {
    kind: "item",
    step,
    draft: {
      schema: value.schema,
      definitionRef: value.definitionRef,
      quantity: Number(value.quantity),
    },
  };
}

export function narrativeItemMaterializationCausalDraft(
  program: CausalActionProgram,
): NarrativeItemMaterializationCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 8_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== NARRATIVE_ITEM_MATERIALIZATION_METHOD
    && schema !== "zhuwei.narrative-item-draft/v1") return { kind: "none" };
  const canonicalCausalBasisRefs = isRecord(value)
    ? boundedReferenceList(value.causalBasisRefs, 24)
    : undefined;
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || method !== NARRATIVE_ITEM_MATERIALIZATION_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, [
      "action",
      "causalBasisRefs",
      "definitionRef",
      "description",
      "entryRef",
      "name",
      "schema",
    ])
    || value.schema !== "zhuwei.narrative-item-draft/v1"
    || !["materializeInScene", "materializeAndAcquire"].includes(String(value.action))
    || !stableItemReference(value.entryRef, "item-entry:")
    || !stableItemReference(value.definitionRef, "item-definition:")
    || !boundedCanonicalItemText(value.name, 300)
    || !boundedCanonicalItemText(value.description, 4_000)
    || canonicalCausalBasisRefs === undefined
    || canonicalCausalBasisRefs.some((reference) =>
      reference.trim() !== reference || reference.normalize("NFC") !== reference)) {
    return { kind: "invalid" };
  }
  return {
    kind: "narrativeItem",
    step,
    draft: {
      schema: value.schema,
      action: value.action as NarrativeItemMaterializationDraft["action"],
      entryRef: value.entryRef,
      definitionRef: value.definitionRef,
      name: value.name,
      description: value.description,
      causalBasisRefs: [...value.causalBasisRefs as string[]],
    },
  };
}

export function sceneItemAcquisitionCausalDraft(
  program: CausalActionProgram,
): SceneItemAcquisitionCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 1_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== SCENE_ITEM_ACQUISITION_METHOD
    && schema !== "zhuwei.scene-item-acquisition-draft/v1") return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || method !== SCENE_ITEM_ACQUISITION_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, ["itemRef", "schema"])
    || value.schema !== "zhuwei.scene-item-acquisition-draft/v1"
    || !stableItemReference(value.itemRef, "item-entry:")) return { kind: "invalid" };
  return {
    kind: "sceneItemAcquisition",
    step,
    draft: {
      schema: value.schema,
      itemRef: value.itemRef,
    },
  };
}

export function worldConsequenceCausalDraft(
  program: CausalActionProgram,
): WorldConsequenceCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 8_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== WORLD_CONSEQUENCE_METHOD
    && schema !== "zhuwei.world-consequence-draft/v1") return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || method !== WORLD_CONSEQUENCE_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, ["consequences", "factRef", "schema", "summary"])
    || value.schema !== "zhuwei.world-consequence-draft/v1"
    || !boundedPremiseText(value.factRef, 240)
    || !value.factRef.startsWith("fact:")
    || !boundedPremiseText(value.summary, 4_000)
    || !Array.isArray(value.consequences)
    || value.consequences.length < 1
    || value.consequences.length > 12) return { kind: "invalid" };

  const consequences: WorldConsequence[] = [];
  const identityRefs = new Set<string>();
  for (const candidate of value.consequences) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.kind)) return { kind: "invalid" };
    if (candidate.kind === "spendResource") {
      if (!hasExactKeys(candidate, ["amount", "kind", "resourceRef"])
        || !boundedPremiseText(candidate.resourceRef, 240)
        || !Number.isSafeInteger(candidate.amount)
        || Number(candidate.amount) < 1) return { kind: "invalid" };
      const identity = `resource:${candidate.resourceRef}`;
      if (identityRefs.has(identity)) return { kind: "invalid" };
      identityRefs.add(identity);
      consequences.push({
        kind: "spendResource",
        resourceRef: candidate.resourceRef,
        amount: Number(candidate.amount),
      });
      continue;
    }
    if (candidate.kind === "acquireKnowledge") {
      if (!hasExactKeys(candidate, ["content", "kind", "knowledgeRef"])
        || !boundedPremiseText(candidate.knowledgeRef, 240)
        || !boundedPremiseText(candidate.content, 4_000)) return { kind: "invalid" };
      const identity = `knowledge:${candidate.knowledgeRef}`;
      if (identityRefs.has(identity)) return { kind: "invalid" };
      identityRefs.add(identity);
      consequences.push({
        kind: "acquireKnowledge",
        knowledgeRef: candidate.knowledgeRef,
        content: candidate.content,
      });
      continue;
    }
    if (candidate.kind === "updateRelationship") {
      const counterpartyRefs = boundedReferenceList(candidate.counterpartyRefs, 8);
      if (!hasExactKeys(candidate, [
        "change", "counterpartyRefs", "kind", "relationshipRef",
      ])
        || !boundedPremiseText(candidate.relationshipRef, 240)
        || !boundedPremiseText(candidate.change, 4_000)
        || counterpartyRefs === undefined
        || counterpartyRefs.length < 1) return { kind: "invalid" };
      const identity = `relationship:${candidate.relationshipRef}`;
      if (identityRefs.has(identity)) return { kind: "invalid" };
      identityRefs.add(identity);
      consequences.push({
        kind: "updateRelationship",
        relationshipRef: candidate.relationshipRef,
        counterpartyRefs,
        change: candidate.change,
      });
      continue;
    }
    if (candidate.kind === "recordPromise") {
      if (!hasExactKeys(candidate, [
        "condition", "content", "counterpartyRef", "kind", "promiseRef",
      ])
        || !boundedPremiseText(candidate.promiseRef, 240)
        || !boundedPremiseText(candidate.counterpartyRef, 240)
        || !boundedPremiseText(candidate.content, 4_000)
        || !boundedPremiseText(candidate.condition, 4_000)) return { kind: "invalid" };
      const identity = `promise:${String(candidate.promiseRef)}`;
      if (identityRefs.has(identity)) return { kind: "invalid" };
      identityRefs.add(identity);
      consequences.push({
        kind: "recordPromise",
        promiseRef: candidate.promiseRef as string,
        counterpartyRef: candidate.counterpartyRef as string,
        content: candidate.content as string,
        condition: candidate.condition as string,
      });
      continue;
    }
    if (candidate.kind === "recordDebt") {
      if (!hasExactKeys(candidate, [
        "condition", "counterpartyRef", "debtRef", "kind", "obligation",
      ])
        || !boundedPremiseText(candidate.debtRef, 240)
        || !boundedPremiseText(candidate.counterpartyRef, 240)
        || !boundedPremiseText(candidate.obligation, 4_000)
        || !boundedPremiseText(candidate.condition, 4_000)) return { kind: "invalid" };
      const identity = `debt:${String(candidate.debtRef)}`;
      if (identityRefs.has(identity)) return { kind: "invalid" };
      identityRefs.add(identity);
      consequences.push({
        kind: "recordDebt",
        debtRef: candidate.debtRef as string,
        counterpartyRef: candidate.counterpartyRef as string,
        obligation: candidate.obligation as string,
        condition: candidate.condition as string,
      });
      continue;
    }
    return { kind: "invalid" };
  }
  return {
    kind: "worldConsequences",
    step,
    draft: {
      schema: "zhuwei.world-consequence-draft/v1",
      factRef: value.factRef,
      summary: value.summary,
      consequences,
    },
  };
}

const DEFINITION_REGISTRATION_AUTHORITY_FIELDS = new Set([
  "actor",
  "actorcharacterid",
  "actorid",
  "artifact",
  "compiledartifact",
  "compiledgraph",
  "compiledhash",
  "compilerprofile",
  "definitionhash",
  "event",
  "eventid",
  "eventpayload",
  "events",
  "eventtype",
  "graph",
  "hash",
  "mechanicgraph",
  "mechanicops",
  "principal",
  "principalid",
  "referenceclosure",
  "rootactionid",
  "state",
  "statehash",
  "statepatch",
]);

function definitionRegistrationContainsAuthorityField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(definitionRegistrationContainsAuthorityField);
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => {
    const normalized = key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
    return DEFINITION_REGISTRATION_AUTHORITY_FIELDS.has(normalized)
      || definitionRegistrationContainsAuthorityField(entry);
  });
}

export function definitionRegistrationCausalDraft(
  program: CausalActionProgram,
): DefinitionRegistrationCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 65_536
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  const reservedMethod = method === ABILITY_DEFINITION_REGISTRATION_METHOD
    || method === FACTION_DEFINITION_REGISTRATION_METHOD;
  const reservedSchema = schema === "zhuwei.ability-definition-draft/v1"
    || schema === "zhuwei.faction-definition-draft/v1";
  if (!reservedMethod && !reservedSchema) return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || !isRecord(value)) return { kind: "invalid" };

  if (method === ABILITY_DEFINITION_REGISTRATION_METHOD
    && schema === "zhuwei.ability-definition-draft/v1") {
    if (!hasExactKeys(value, ["definition", "schema"])
      || !isRecord(value.definition)
      || definitionRegistrationContainsAuthorityField(value.definition)) {
      return { kind: "invalid" };
    }
    const causalBasisRefs = value.definition.causalBasisRefs === undefined
      ? []
      : boundedReferenceList(value.definition.causalBasisRefs, 24);
    if (causalBasisRefs === undefined) return { kind: "invalid" };
    return {
      kind: "abilityDefinition",
      step,
      draft: {
        schema: "zhuwei.ability-definition-draft/v1",
        definition: structuredClone(value.definition),
        causalBasisRefs,
      },
    };
  }

  if (method === FACTION_DEFINITION_REGISTRATION_METHOD
    && schema === "zhuwei.faction-definition-draft/v1") {
    if (!hasExactKeys(value, [
      "causalBasisRefs",
      "factionRef",
      "goal",
      "memberRefs",
      "name",
      "resourceRefs",
      "schema",
    ])
      || !boundedPremiseText(value.factionRef, 240)
      || !value.factionRef.startsWith("faction:")
      || !boundedPremiseText(value.name, 240)
      || !boundedPremiseText(value.goal, 4_000)) return { kind: "invalid" };
    const memberRefs = boundedReferenceList(value.memberRefs, 24);
    const resourceRefs = boundedReferenceList(value.resourceRefs, 40);
    const causalBasisRefs = boundedReferenceList(value.causalBasisRefs, 24);
    if (memberRefs === undefined
      || memberRefs.length < 1
      || resourceRefs === undefined
      || resourceRefs.length < 1
      || causalBasisRefs === undefined
      || causalBasisRefs.length < 1) return { kind: "invalid" };
    return {
      kind: "factionDefinition",
      step,
      draft: {
        schema: "zhuwei.faction-definition-draft/v1",
        factionRef: value.factionRef,
        name: value.name,
        goal: value.goal,
        memberRefs,
        resourceRefs,
        causalBasisRefs,
      },
    };
  }
  return { kind: "invalid" };
}

export function dynamicPassageMoveCausalDraft(
  program: CausalActionProgram,
): DynamicPassageMoveCausalDraft {
  if (program.formRef !== "materialization.v1") return { kind: "none" };
  const step = lowerCausalActionProgram(program).steps[0];
  if (step === undefined) return { kind: "none" };
  const method = scalarString(step.arguments.method);
  const serialized = scalarString(step.arguments.proposedFact);
  let value: unknown;
  try {
    value = serialized === undefined || serialized.length > 4_000
      ? undefined
      : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  const schema = isRecord(value) && isNonEmptyString(value.schema) ? value.schema : undefined;
  if (method !== DYNAMIC_PASSAGE_MOVE_METHOD
    && schema !== "zhuwei.dynamic-passage-move-draft/v1") return { kind: "none" };
  if (step.primitive !== "materializeOpenFact"
    || step.arguments.resolution !== "direct"
    || method !== DYNAMIC_PASSAGE_MOVE_METHOD
    || !isRecord(value)
    || !hasExactKeys(value, [
      "destinationName",
      "destinationSceneRef",
      "geometry",
      "locationRef",
      "passageRef",
      "schema",
      "traversal",
    ])
    || value.schema !== "zhuwei.dynamic-passage-move-draft/v1"
    || !boundedPremiseText(value.locationRef, 240)
    || !value.locationRef.startsWith("location:")
    || !boundedPremiseText(value.destinationSceneRef, 240)
    || !value.destinationSceneRef.startsWith("scene:")
    || !boundedPremiseText(value.destinationName, 240)
    || !boundedPremiseText(value.passageRef, 240)
    || !value.passageRef.startsWith("passage:")
    || !boundedPremiseText(value.traversal, 800)
    || !isCanonicalTacticalGeometry(value.geometry)
    || new Set([
      value.locationRef,
      value.destinationSceneRef,
      value.passageRef,
    ]).size !== 3) return { kind: "invalid" };
  return {
    kind: "passageMove",
    step,
    draft: {
      schema: value.schema,
      locationRef: value.locationRef,
      destinationSceneRef: value.destinationSceneRef,
      destinationName: value.destinationName,
      passageRef: value.passageRef,
      traversal: value.traversal,
      geometry: structuredClone(value.geometry),
    },
  };
}

export function npcMechanicalCausalDraft(program: CausalActionProgram): NpcMechanicalCausalDraft {
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
    if (!hasExactKeys(value, [
        "itemRef",
        "ownershipDisposition",
        "quantity",
        "schema",
        "toCharacterRef",
      ])
      || !isNonEmptyString(value.toCharacterRef)
      || !isNonEmptyString(value.itemRef)
      || !["preserve", "transferToRecipient"].includes(String(value.ownershipDisposition))
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
        ownershipDisposition: value.ownershipDisposition as ItemTransferDraft["ownershipDisposition"],
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
    && ["break", "repair", "destroy"].includes(String(value.action))) {
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
