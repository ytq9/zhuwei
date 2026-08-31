import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import { createEventTransition, createScopeProof } from "./events";
import type {
  AuthoritativeWorldState,
  AuthorityContinuation,
  CompoundActionCost,
  CompoundActionEffect,
  CompoundResolutionPlan,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  FrozenCheck,
  JsonRecord,
  PublicReceipt,
  RandomnessRequest,
  ScopeProof,
  StepResult,
} from "./model";
import { rejected } from "./results";
import { characterTimelineId, movementPlan } from "./timeline";
import { stepCampaignWorld } from "./campaign-actions";
import { stepCombatWorld } from "./combat-actions";
import { stepMultiplayerWorld } from "./multiplayer-actions";
import { isGearSlot } from "./character-gear";
import { continueCompoundRoot } from "./internal-compound";
import {
  hasExactKeys,
  hasOnlyKeys,
  hashWorldState,
  isNonEmptyString,
  isProfileRef,
  isRecord,
} from "./validation";
import { isCompoundResolutionPlan } from "./compound-model";
import { MAX_EXPERIENCE_AWARD } from "./character-progression";
import { characterProficiencyProfileEnabled } from "../profiles/character-proficiency";
import { npcMechanicsProfileEnabled } from "../profiles/npc-mechanics";
import {
  NPC_MECHANICAL_TEMPLATE_KIND,
  NPC_MECHANICAL_TEMPLATE_SCHEMA,
} from "./npc-mechanics";
import {
  savingThrowModifier as profiledSavingThrowModifier,
  skillCheckModifier,
} from "./proficiency";
import {
  actorPlanNpcIsAvailable,
  actorPlanPremiseIsAvailable,
  actorPlanPremiseScope,
  dueActorPlanChildRoot,
  earliestEligibleDueActorPlan,
} from "./actor-plans";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const MODES = ["normal", "advantage", "disadvantage"] as const;
const INHERITANCE_SCOPE_BY_KIND = {
  item: "transferPossession",
  knowledge: "acquireExactKnowledge",
  relationship: "establishDerivedRelationship",
  debt: "assumeDebtObligation",
  promise: "assumePromiseObligation",
} as const;
const INHERITANCE_SOURCE_KINDS = [
  "will",
  "explicitGift",
  "recovery",
  "publicRecord",
  "organizationGrant",
  "npcIntroduction",
  "knowledgePropagation",
] as const;
const SAVING_THROW_PROFICIENCIES: Record<string, readonly typeof ABILITIES[number][]> = {
  fighter: ["str", "con"],
  barbarian: ["str", "con"],
  rogue: ["dex", "int"],
  wizard: ["int", "wis"],
  cleric: ["wis", "cha"],
  ranger: ["str", "dex"],
};
const MATERIALIZATION_KINDS = [
  "fact",
  "location",
  "passage",
  "npc",
  "enemy",
  "item",
  "faction",
  "hazard",
  "opportunity",
  "ability",
] as const;
type Draft = {
  eventType: EventType;
  payload: EventPayloadByType[EventType];
  visibilityPolicyId?: string;
  secrecy?: EventEnvelope["secrecy"];
  resolutionId?: string;
  reads?: string[];
  writes?: string[];
  creates?: string[];
};

type DynamicMaterialization = {
  kind: typeof MATERIALIZATION_KINDS[number];
  factRef: string;
  causalBasisRefs: string[];
  visibilityPolicyRef: string;
  definition: JsonRecord;
};

function canonicalStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every(isNonEmptyString) || value.length !== new Set(value).size) {
    return undefined;
  }
  return [...value].sort();
}

function canonicalFailureOptions(value: unknown): Array<{ optionId: string; summary: string }> | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return undefined;
  const options: Array<{ optionId: string; summary: string }> = [];
  for (const entry of value) {
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, ["id", "summary"])
      || !isNonEmptyString(entry.id)
      || !isNonEmptyString(entry.summary)
    ) return undefined;
    options.push({ optionId: entry.id, summary: entry.summary });
  }
  if (new Set(options.map(({ optionId }) => optionId)).size !== options.length) return undefined;
  return options.sort((left, right) => left.optionId.localeCompare(right.optionId));
}

function durationMicros(value: unknown): string | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["unit", "value"])
    || !["round", "second", "minute", "hour", "day"].includes(String(value.unit))
    || !Number.isSafeInteger(value.value)
    || Number(value.value) <= 0
  ) return undefined;
  const factor = {
    round: 6_000_000n,
    second: 1_000_000n,
    minute: 60_000_000n,
    hour: 3_600_000_000n,
    day: 86_400_000_000n,
  }[value.unit as "round" | "second" | "minute" | "hour" | "day"];
  return (BigInt(Number(value.value)) * factor).toString();
}

function result(
  kind: "committed" | "awaitingRandomness",
  profiles: RuntimeProfileManifest,
  source: AuthoritativeWorldState,
  rootActionId: string,
  drafts: Draft[],
  additions: JsonRecord = {},
): StepResult {
  let state = source;
  const events: EventEnvelope[] = [];
  let receipt: PublicReceipt | undefined;
  let scopeProof: ScopeProof | undefined;
  for (const draft of drafts) {
    scopeProof = createScopeProof(
      state,
      draft.reads ?? [],
      draft.writes ?? [`receipt:${rootActionId}`],
      draft.creates ?? [],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      ...(draft.resolutionId === undefined ? {} : { resolutionId: draft.resolutionId }),
      eventType: draft.eventType,
      payload: draft.payload,
      scopeProof,
      visibilityPolicyId: draft.visibilityPolicyId ?? "visibility:public",
      secrecy: draft.secrecy ?? "public",
    });
    events.push(transition.event);
    state = transition.state;
    receipt = transition.receipt;
  }
  return {
    kind,
    events,
    state,
    cache: state,
    stateHash: events[events.length - 1].stateHashAfter,
    scopeProof: scopeProof!,
    receipt: receipt!,
    ...additions,
  } as StepResult;
}

function normalizeCosts(value: unknown): CompoundActionCost[] | undefined {
  if (!Array.isArray(value) || value.length > 24) return undefined;
  const costs: CompoundActionCost[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isNonEmptyString(item.kind)) return undefined;
    if (item.kind === "consumeResource") {
      if (
        !hasExactKeys(item, ["amount", "kind", "resourceRef"])
        || !isNonEmptyString(item.resourceRef)
        || !Number.isSafeInteger(item.amount)
        || Number(item.amount) <= 0
      ) return undefined;
      costs.push({ kind: "consumeResource", resourceRef: item.resourceRef, amount: Number(item.amount) });
      continue;
    }
    if (item.kind === "consumeItem") {
      if (
        !hasOnlyKeys(item, ["itemRef", "kind"], ["count"])
        || !isNonEmptyString(item.itemRef)
        || !(item.count === undefined || (Number.isSafeInteger(item.count) && Number(item.count) > 0))
      ) return undefined;
      costs.push({
        kind: "consumeItem",
        itemRef: item.itemRef,
        count: item.count === undefined ? 1 : Number(item.count),
      });
      continue;
    }
    if (item.kind === "fictionTime") {
      if (!hasExactKeys(item, ["duration", "kind"])) return undefined;
      const micros = durationMicros(item.duration);
      if (micros === undefined) return undefined;
      costs.push({ kind: "fictionTime", durationMicros: micros });
      continue;
    }
    return undefined;
  }
  return costs;
}

function normalizeEffects(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  primaryFactRef: string,
  materializedSceneIds: Set<string>,
  value: unknown,
): CompoundActionEffect[] | undefined {
  if (!Array.isArray(value) || value.length > 24) return undefined;
  const effects: CompoundActionEffect[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isNonEmptyString(item.kind)) return undefined;
    switch (item.kind) {
      case "acquireEvidence": {
        if (!hasOnlyKeys(item, ["evidenceRef", "kind"], ["definitionRef", "evidence"])) return undefined;
        const definitionRef = isNonEmptyString(item.definitionRef) ? item.definitionRef : primaryFactRef;
        if (!isNonEmptyString(item.evidenceRef) || !isNonEmptyString(definitionRef)) return undefined;
        effects.push({
          kind: "acquireEvidence",
          evidenceRef: item.evidenceRef,
          evidence: isNonEmptyString(item.evidence) ? item.evidence : item.evidenceRef,
          definitionRef,
        });
        break;
      }
      case "acquireKnowledge": {
        if (!hasOnlyKeys(item, ["kind", "knowledgeRef"], ["definitionRef", "value"])) return undefined;
        const definitionRef = isNonEmptyString(item.definitionRef) ? item.definitionRef : primaryFactRef;
        const primitive = item.value ?? item.knowledgeRef;
        if (
          !isNonEmptyString(item.knowledgeRef)
          || !isNonEmptyString(definitionRef)
          || !(primitive === null || ["string", "number", "boolean"].includes(typeof primitive))
          || (typeof primitive === "number" && !Number.isFinite(primitive))
        ) return undefined;
        effects.push({
          kind: "acquireKnowledge",
          knowledgeRef: item.knowledgeRef,
          value: primitive as string | number | boolean | null,
          definitionRef,
        });
        break;
      }
      case "changeResource": {
        if (!hasOnlyKeys(item, ["amount", "kind", "resourceRef"], ["targetRef"])) return undefined;
        const targetRef = isNonEmptyString(item.targetRef) ? item.targetRef : actorCharacterId;
        if (
          targetRef !== actorCharacterId
          || !isNonEmptyString(item.resourceRef)
          || !Number.isSafeInteger(item.amount)
          || Number(item.amount) >= 0
        ) return undefined;
        effects.push({
          kind: "changeResource",
          targetRef,
          resourceRef: item.resourceRef,
          amount: Number(item.amount),
        });
        break;
      }
      case "changeHitPoints": {
        if (!hasOnlyKeys(item, ["amount", "kind"], ["targetRef"])) return undefined;
        const targetRef = isNonEmptyString(item.targetRef) ? item.targetRef : actorCharacterId;
        if (
          targetRef !== actorCharacterId
          || !Number.isSafeInteger(item.amount)
          || Number(item.amount) === 0
        ) return undefined;
        effects.push({
          kind: "changeHitPoints",
          targetRef,
          amount: Number(item.amount),
        });
        break;
      }
      case "alertNpc": {
        if (!hasOnlyKeys(item, ["kind", "npcId"], ["status"])) return undefined;
        const npc = isNonEmptyString(item.npcId) ? state.entities[item.npcId] : undefined;
        if (npc?.kind !== "npc" || npc.tenureStatus !== "active") return undefined;
        effects.push({
          kind: "alertNpc",
          npcId: npc.id,
          status: isNonEmptyString(item.status) ? item.status : "alerted",
        });
        break;
      }
      case "moveEntity": {
        if (!hasOnlyKeys(item, ["kind", "sceneRef"], ["entityRef"])) return undefined;
        const entityRef = isNonEmptyString(item.entityRef) ? item.entityRef : actorCharacterId;
        if (
          entityRef !== actorCharacterId
          || !isNonEmptyString(item.sceneRef)
          || (!(item.sceneRef in state.scenes) && !materializedSceneIds.has(item.sceneRef))
        ) {
          return undefined;
        }
        effects.push({ kind: "moveEntity", entityRef, sceneRef: item.sceneRef });
        break;
      }
      case "advanceFictionTime": {
        if (!hasExactKeys(item, ["duration", "kind"])) return undefined;
        const micros = durationMicros(item.duration);
        if (micros === undefined) return undefined;
        effects.push({ kind: "advanceFictionTime", durationMicros: micros });
        break;
      }
      case "updateRelationship": {
        if (!hasOnlyKeys(
          item,
          ["kind", "recipientRefs", "relationshipRef", "value"],
          ["definitionRef"],
        )) return undefined;
        const recipientRefs = canonicalStrings(item.recipientRefs);
        const definitionRef = isNonEmptyString(item.definitionRef)
          ? item.definitionRef
          : primaryFactRef;
        const subjectRefs = recipientRefs === undefined
          ? undefined
          : [...new Set([actorCharacterId, ...recipientRefs])].sort();
        if (
          !isNonEmptyString(item.relationshipRef)
          || !isNonEmptyString(item.value)
          || !isNonEmptyString(definitionRef)
          || subjectRefs === undefined
          || subjectRefs.length < 2
        ) return undefined;
        effects.push({
          kind: "updateRelationship",
          relationshipRef: item.relationshipRef,
          subjectRefs,
          change: item.value,
          basisFactIds: [definitionRef],
        });
        break;
      }
      case "recordCommitment": {
        if (!hasExactKeys(item, ["commitmentRef", "kind", "status", "targetRef", "value"])
          || ![item.commitmentRef, item.status, item.targetRef, item.value].every(isNonEmptyString)) {
          return undefined;
        }
        effects.push({
          kind: "recordCommitment",
          commitmentRef: item.commitmentRef as string,
          promisorRef: actorCharacterId,
          promiseeRef: item.targetRef as string,
          content: item.value as string,
          condition: item.status as string,
        });
        break;
      }
      case "recordDebt": {
        if (!hasOnlyKeys(
          item,
          ["debtRef", "kind", "status", "targetRef", "value"],
          ["definitionRef"],
        ) || ![
          item.debtRef,
          item.status,
          item.targetRef,
          item.value,
        ].every(isNonEmptyString)) {
          return undefined;
        }
        const definitionRef = isNonEmptyString(item.definitionRef)
          ? item.definitionRef
          : primaryFactRef;
        effects.push({
          kind: "recordDebt",
          debtRef: item.debtRef as string,
          debtorRef: actorCharacterId,
          creditorRef: item.targetRef as string,
          obligation: item.value as string,
          condition: item.status as string,
          basisFactIds: [definitionRef],
        });
        break;
      }
      default:
        return undefined;
    }
  }
  if (effects.filter(({ kind }) => kind === "moveEntity").length > 1) return undefined;
  if (effects.filter(({ kind }) => kind === "changeHitPoints").length > 1) return undefined;
  return effects;
}

function abilityModifier(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  ability: typeof ABILITIES[number],
  skill: string | null,
): number | undefined {
  return skillCheckModifier(profiles, state.entities[actorCharacterId], ability, skill);
}

function savingThrowModifier(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  ability: typeof ABILITIES[number],
): number | undefined {
  const actor = state.entities[actorCharacterId];
  const score = actor?.abilityScores?.[ability];
  if (!Number.isSafeInteger(score)) return undefined;
  if (characterProficiencyProfileEnabled(profiles.extensions)) {
    return profiledSavingThrowModifier(profiles, actor, ability);
  }
  const base = Math.floor((Number(score) - 10) / 2);
  const proficient = SAVING_THROW_PROFICIENCIES[actor.classId ?? ""]?.includes(ability) ?? false;
  return base + (proficient ? actor.proficiencyBonus ?? 0 : 0);
}

function validateOutcomeEffects(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  sourceSceneId: string,
  materializedFactRefs: Set<string>,
  costs: CompoundActionCost[],
  effects: CompoundActionEffect[],
): boolean {
  const resourcesAfterCosts = { ...(state.entities[actorCharacterId].resources ?? {}) };
  const itemsAfterCosts = Object.fromEntries(
    Object.values(state.campaignRuntime.itemSystem.entries)
      .filter((entry) => entry.disposition === "held"
        && entry.holderRef === actorCharacterId
        && entry.condition === "usable")
      .map((entry) => [entry.entryId, entry.quantity]),
  );
  for (const cost of costs) {
    if (cost.kind === "consumeResource") {
      const available = resourcesAfterCosts[cost.resourceRef] ?? 0;
      if (available < cost.amount) return false;
      resourcesAfterCosts[cost.resourceRef] = available - cost.amount;
    }
    if (cost.kind === "consumeItem") {
      const available = Number(itemsAfterCosts[cost.itemRef] ?? 0);
      if (available < cost.count) return false;
      itemsAfterCosts[cost.itemRef] = available - cost.count;
    }
  }
  for (const effect of effects) {
    if (effect.kind === "acquireEvidence" || effect.kind === "acquireKnowledge") {
      if (
        !(effect.definitionRef in state.canonicalFacts)
        && !materializedFactRefs.has(effect.definitionRef)
      ) return false;
      const knowledgeRef = effect.kind === "acquireEvidence" ? effect.evidenceRef : effect.knowledgeRef;
      if (knowledgeRef in (state.knowledge[actorCharacterId] ?? {})) return false;
    }
    if (effect.kind === "changeResource") {
      const spend = Math.abs(effect.amount);
      const available = resourcesAfterCosts[effect.resourceRef] ?? 0;
      if (available < spend) return false;
      resourcesAfterCosts[effect.resourceRef] = available - spend;
    }
    if (effect.kind === "changeHitPoints") {
      const hitPoints = state.entities[effect.targetRef]?.hitPoints;
      if (hitPoints === undefined) return false;
      const after = Math.max(0, Math.min(hitPoints.maximum, hitPoints.current + effect.amount));
      if (after === hitPoints.current) return false;
    }
    if (effect.kind === "alertNpc") {
      const npc = state.entities[effect.npcId];
      if (npc?.sceneId !== sourceSceneId) return false;
      if (`knowledge:alert:${actorCharacterId}` in (state.knowledge[npc.id] ?? {})) return false;
    }
    if (effect.kind === "updateRelationship") {
      if (
        effect.subjectRefs.some((subjectRef) => !(subjectRef in state.entities))
        || effect.basisFactIds.some((factRef) =>
          !(factRef in state.canonicalFacts) && !materializedFactRefs.has(factRef))
      ) return false;
    }
    if (effect.kind === "recordCommitment") {
      if (
        effect.promisorRef !== actorCharacterId
        || !(effect.promiseeRef in state.entities)
        || state.entities[effect.promiseeRef].sceneId !== sourceSceneId
        || effect.commitmentRef in state.campaignRuntime.promises
      ) return false;
    }
    if (effect.kind === "recordDebt") {
      if (
        effect.debtorRef !== actorCharacterId
        || !(effect.creditorRef in state.entities)
        || effect.debtRef in state.campaignRuntime.debts
        || effect.basisFactIds.some((factRef) =>
          !(factRef in state.canonicalFacts) && !materializedFactRefs.has(factRef))
      ) return false;
    }
  }
  return true;
}

function checkRequest(
  state: AuthoritativeWorldState,
  rootActionId: string,
  actorCharacterId: string,
  frozenCheck: FrozenCheck,
  resolutionPlan: CompoundResolutionPlan,
  resolutionKey = "primary-check",
): { request: RandomnessRequest; continuation: AuthorityContinuation } {
  const diceExpression = frozenCheck.mode === "normal"
    ? "1d20"
    : frozenCheck.mode === "advantage"
      ? "2d20kh1"
      : "2d20kl1";
  const request: RandomnessRequest = {
    randomnessId: `randomness:${rootActionId}:${resolutionKey}`,
    resolutionId: `resolution:${rootActionId}:${resolutionKey}`,
    actorCharacterId,
    purpose: frozenCheck.kind === "savingThrow" ? "savingThrow" : "improvisedCheck",
    diceExpression,
    frozenCheck,
  };
  return {
    request,
    continuation: {
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
    },
  };
}

function mergeCompoundResult(prefix: StepResult, mechanical: StepResult): StepResult {
  if (prefix.kind === "rejected" || prefix.kind === "initialized" || prefix.kind === "awaitingRandomness") {
    return rejected("invalidWorldState", "ActorPlan lifecycle prefix did not commit canonically.");
  }
  if (mechanical.kind === "rejected" || mechanical.kind === "initialized") return mechanical;
  return {
    ...mechanical,
    events: [...prefix.events, ...mechanical.events],
  };
}

type SemanticCommand = {
  module: "campaign" | "combat" | "multiplayer" | "compound" | "compoundRandomness";
  input: JsonRecord;
};

const SEMANTIC_MECHANICAL_KEYS = [
  "ability",
  "abilityRef",
  "activityTransitions",
  "basisRefs",
  "activityRef",
  "arcaneRecoverySlotLevels",
  "amount",
  "campaignRef",
  "choice",
  "chapterRef",
  "continueAsNpc",
  "consequenceRefs",
  "dc",
  "destinationFeet",
  "destinationRef",
  "duration",
  "encounterRef",
  "endingCandidateRef",
  "experienceAmount",
  "failure",
  "frozenCosts",
  "hitDiceToSpend",
  "itemRef",
  "itemActivityId",
  "ownershipDisposition",
  "gearAction",
  "slot",
  "factionRef",
  "planRef",
  "knowledgeRef",
  "inheritanceAuthorization",
  "inheritanceAuthorizationRef",
  "inheritanceSourceFactRef",
  "inheritanceSourceKind",
  "lifecycleAction",
  "memberRefs",
  "mediumFactRef",
  "mode",
  "operation",
  "newOptions",
  "opposedAbility",
  "opposedSkill",
  "partyAction",
  "partyRef",
  "pendingInputRef",
  "reactionRef",
  "precedentRef",
  "publicClause",
  "recipientRefs",
  "resourceRef",
  "restKind",
  "saveAbility",
  "skill",
  "sourceEntityRef",
  "sequelStoryRef",
  "storyRef",
  "success",
  "targetEntityRef",
  "targetEntityRefs",
  "outcome",
  "unresolvedRefs",
] as const;

function npcCompoundRandomnessCommand(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  actorCharacterId: string,
  goal: string,
  method: string,
  primaryFactRef: string,
  materializations: DynamicMaterialization[],
  mechanical: JsonRecord,
  npcContext: { planId: string; knowledgeRefs: string[] },
): SemanticCommand | StepResult {
  const savingThrow = mechanical.operation === "resolveNoncombatSave";
  const canonicalFields = savingThrow
    ? hasExactKeys(mechanical, [
        "dc",
        "duration",
        "failure",
        "frozenCosts",
        "mode",
        "operation",
        "saveAbility",
        "success",
      ])
    : hasExactKeys(mechanical, [
        "ability",
        "dc",
        "duration",
        "failure",
        "frozenCosts",
        "mode",
        "operation",
        "skill",
        "success",
      ]);
  const ability = savingThrow ? mechanical.saveAbility : mechanical.ability;
  const skill = savingThrow ? null : mechanical.skill;
  const actor = state.entities[actorCharacterId];
  if (
    !canonicalFields
    || !(ABILITIES as readonly unknown[]).includes(ability)
    || !(skill === null || isNonEmptyString(skill))
    || !Number.isSafeInteger(mechanical.dc)
    || Number(mechanical.dc) < 0
    || Number(mechanical.dc) > 30
    || !(MODES as readonly unknown[]).includes(mechanical.mode)
    || !actorPlanNpcIsAvailable(actor)
  ) return rejected("invalidRulesInput", "NPC check/save must freeze a complete canonical resolution plan.");
  const duration = durationMicros(mechanical.duration);
  const costs = normalizeCosts(mechanical.frozenCosts);
  const materializedSceneIds = new Set(materializations.flatMap((entry) =>
    entry.kind === "location" && isNonEmptyString(entry.definition.sceneId)
      ? [entry.definition.sceneId]
      : []));
  const successEffects = normalizeEffects(
    state,
    actorCharacterId,
    primaryFactRef,
    materializedSceneIds,
    mechanical.success,
  );
  const failureEffects = normalizeEffects(
    state,
    actorCharacterId,
    primaryFactRef,
    materializedSceneIds,
    mechanical.failure,
  );
  const modifier = savingThrow
    ? savingThrowModifier(profiles, state, actorCharacterId, ability as typeof ABILITIES[number])
    : abilityModifier(profiles, state, actorCharacterId, ability as typeof ABILITIES[number], skill as string | null);
  const materializedFactRefs = new Set(materializations.map(({ factRef }) => factRef));
  if (
    duration === undefined
    || costs === undefined
    || successEffects === undefined
    || failureEffects === undefined
    || modifier === undefined
    || !validateOutcomeEffects(
      state,
      actorCharacterId,
      actor.sceneId,
      materializedFactRefs,
      costs,
      successEffects,
    )
    || !validateOutcomeEffects(
      state,
      actorCharacterId,
      actor.sceneId,
      materializedFactRefs,
      costs,
      failureEffects,
    )
  ) return rejected("invalidRulesInput", "NPC check/save has an unavailable frozen cost or effect.");
  const plan: CompoundResolutionPlan = {
    schema: "zhuwei.compound-resolution-plan/v1",
    actorCharacterId,
    goal,
    method,
    sourceSceneId: actor.sceneId,
    durationMicros: duration,
    primaryFactRef,
    frozenCosts: costs,
    successEffects,
    failureEffects,
  };
  const frozenCheck: FrozenCheck = {
    kind: savingThrow ? "savingThrow" : skill === null ? "ability" : "skill",
    ability: ({
      str: "strength",
      dex: "dexterity",
      con: "constitution",
      int: "intelligence",
      wis: "wisdom",
      cha: "charisma",
    } as const)[ability as typeof ABILITIES[number]],
    skill: skill as string | null,
    dc: String(mechanical.dc),
    modifier: String(modifier),
    mode: mechanical.mode as FrozenCheck["mode"],
    goal,
    method,
    risk: "NPC action uses only the knowledge frozen into its authoritative plan.",
    successOutcome: successEffects.map(({ kind }) => kind).join(";") || "NPC action succeeds with no additional effect.",
    failureOutcome: failureEffects.map(({ kind }) => kind).join(";") || "NPC action fails with no additional effect.",
    costs: costs.map((cost) => cost.kind === "consumeResource"
      ? `resource:${cost.resourceRef}:${cost.amount}`
      : cost.kind === "consumeItem"
        ? `item:${cost.itemRef}:${cost.count}`
        : `fictionTime:${cost.durationMicros}`).sort(),
  };
  return {
    module: "compoundRandomness",
    input: {
      rootActionId,
      resolutionKey: npcContext.planId,
      plan,
      frozenCheck,
    },
  };
}

const NPC_MECHANICAL_INSTANCE_SCHEMA = "zhuwei.npc-mechanical-instance/v1" as const;

function npcMechanicalTemplateContentFromFlat(value: JsonRecord): JsonRecord | undefined {
  if (!isNonEmptyString(value.entityId)
    || value.entityKind !== "npc"
    || !isNonEmptyString(value.name)
    || !isRecord(value.position)
    || !isRecord(value.footprint)
    || !isRecord(value.stats)
    || !isNonEmptyString(value.proficiencyBonus)
    || !isNonEmptyString(value.armorClass)
    || !isRecord(value.hitPoints)
    || !isNonEmptyString(value.hitPoints.maximum)
    || !isRecord(value.speedInches)
    || !isRecord(value.resources)
    || !isNonEmptyString(value.deathPolicy)
    || !Array.isArray(value.abilities)) return undefined;
  const resourceMaximums: JsonRecord = {};
  const resourcesCurrent: JsonRecord = {};
  for (const [resourceId, pool] of Object.entries(value.resources)) {
    if (!isRecord(pool) || !isNonEmptyString(pool.current) || !isNonEmptyString(pool.maximum)) {
      return undefined;
    }
    resourceMaximums[resourceId] = pool.maximum;
    resourcesCurrent[resourceId] = pool.current;
  }
  return {
    template: {
      schema: NPC_MECHANICAL_TEMPLATE_SCHEMA,
      label: value.name,
      stats: structuredClone(value.stats),
      proficiencyBonus: value.proficiencyBonus,
      armorClass: value.armorClass,
      armorClassModel: {
        kind: "higherOfBaseAndEquipment",
        baseArmorClass: value.armorClass,
        shieldBonus: "2",
      },
      hitPointsMaximum: value.hitPoints.maximum,
      footprint: structuredClone(value.footprint),
      speedInches: structuredClone(value.speedInches),
      resourceMaximums,
      deathPolicy: value.deathPolicy,
      intrinsicAbilities: structuredClone(value.abilities),
      itemDefinitions: [],
      itemDefinitionRefs: [],
      initialLoadout: { entries: [] },
      ...(value.attacksPerAttackAction === undefined
        ? {}
        : { attacksPerAttackAction: value.attacksPerAttackAction }),
      ...(value.damageDefenses === undefined
        ? {}
        : { damageDefenses: structuredClone(value.damageDefenses) }),
      ...(value.sizeCategory === undefined ? {} : { sizeCategory: value.sizeCategory }),
      ...(value.spellcasting === undefined
        ? {}
        : { spellcasting: structuredClone(value.spellcasting) }),
    },
    initialState: {
      hitPointsCurrent: value.hitPoints.current,
      temporaryHitPoints: value.hitPoints.temporary,
      resourcesCurrent,
    },
  };
}

function npcMechanicalTemplateFingerprint(content: JsonRecord): string {
  const intrinsicAbilities = Array.isArray(content.intrinsicAbilities)
    ? content.intrinsicAbilities.map((ability) => isRecord(ability)
      ? Object.fromEntries(Object.entries(ability).filter(([key]) => key !== "definitionId"))
      : ability)
    : [];
  return canonicalSha256({ ...structuredClone(content), intrinsicAbilities });
}

function npcMechanicalCombatEntries(
  materializations: DynamicMaterialization[],
): JsonRecord[] | undefined {
  const entries: JsonRecord[] = [];
  const sharedTemplateByFingerprint = new Map<string, string>();
  for (const materialization of materializations
    .filter((entry) => entry.kind === "npc" || entry.kind === "enemy")) {
    const definition = materialization.definition;
    if (definition.schema === NPC_MECHANICAL_INSTANCE_SCHEMA) {
      if (!hasOnlyKeys(definition, [
        "entityId",
        "entityKind",
        "mechanicalDefinitionRef",
        "name",
        "position",
        "schema",
      ], ["initialState"])
        || definition.entityKind !== "npc"
        || ![
          definition.entityId,
          definition.mechanicalDefinitionRef,
          definition.name,
        ].every(isNonEmptyString)
        || !isRecord(definition.position)
        || !(definition.initialState === undefined || isRecord(definition.initialState))) {
        return undefined;
      }
      entries.push({
        entityId: definition.entityId,
        name: definition.name,
        placement: { position: structuredClone(definition.position) },
        mechanics: {
          kind: "templateRef",
          definitionRef: definition.mechanicalDefinitionRef,
        },
        ...(definition.initialState === undefined
          ? {}
          : { initialState: structuredClone(definition.initialState) }),
      });
      continue;
    }
    const converted = npcMechanicalTemplateContentFromFlat(definition);
    if (converted === undefined
      || !isRecord(converted.template)
      || !isRecord(converted.initialState)) return undefined;
    const fingerprint = npcMechanicalTemplateFingerprint(converted.template);
    const existingDefinitionRef = sharedTemplateByFingerprint.get(fingerprint);
    const definitionRef = existingDefinitionRef
      ?? `npc-mechanics:${materialization.factRef}:1`;
    if (existingDefinitionRef === undefined) {
      sharedTemplateByFingerprint.set(fingerprint, definitionRef);
    }
    entries.push({
      entityId: definition.entityId,
      name: definition.name,
      placement: { position: structuredClone(definition.position) },
      mechanics: existingDefinitionRef === undefined
        ? {
            kind: "bespokeDefinition",
            definition: {
              definitionId: definitionRef,
              revision: "1",
              definitionKind: NPC_MECHANICAL_TEMPLATE_KIND,
              rulesBasis: "srd5.1-2014",
              causalBasisRefs: [...materialization.causalBasisRefs],
              visibilityPolicyRef: materialization.visibilityPolicyRef,
              content: structuredClone(converted.template),
            },
          }
        : { kind: "templateRef", definitionRef },
      initialState: structuredClone(converted.initialState),
    });
  }
  return entries;
}

function semanticCommand(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  actorCharacterId: string,
  goal: string,
  method: string,
  primaryFactRef: string,
  sceneQuestion: string,
  materializations: DynamicMaterialization[],
  mechanical: JsonRecord,
  npcContext?: { planId: string; knowledgeRefs: string[] },
): SemanticCommand | StepResult {
  if (!hasOnlyKeys(mechanical, ["operation"], SEMANTIC_MECHANICAL_KEYS.filter((key) => key !== "operation"))) {
    return rejected("invalidRulesInput", "The mechanical proposal has an unknown or authority-owned field.");
  }
  const operation = mechanical.operation;
  if (
    operation !== "changeNpcGear"
    && (Object.hasOwn(mechanical, "gearAction") || Object.hasOwn(mechanical, "slot"))
  ) {
    return rejected("invalidRulesInput", "Gear fields are reserved for the NPC gear operation.");
  }
  const mode = (MODES as readonly unknown[]).includes(mechanical.mode) ? mechanical.mode : "normal";
  const actor = state.entities[actorCharacterId];
  const target = isNonEmptyString(mechanical.targetEntityRef)
    ? state.entities[mechanical.targetEntityRef]
    : undefined;
  const targetRefs = canonicalStrings(mechanical.targetEntityRefs) ?? [];
  const recipients = canonicalStrings(mechanical.recipientRefs) ?? [];
  const members = canonicalStrings(mechanical.memberRefs) ?? [];
  const basisRefs = canonicalStrings(mechanical.basisRefs) ?? [];
  const unresolvedRefs = canonicalStrings(mechanical.unresolvedRefs) ?? [];
  const consequenceRefs = canonicalStrings(mechanical.consequenceRefs) ?? [];
  const micros = durationMicros(mechanical.duration);
  const ability = (ABILITIES as readonly unknown[]).includes(mechanical.ability)
    ? mechanical.ability as string
    : undefined;
  const opposedAbility = (ABILITIES as readonly unknown[]).includes(mechanical.opposedAbility)
    ? mechanical.opposedAbility as string
    : undefined;
  switch (operation) {
    case "resolveDirectConsequences": {
      const duration = micros;
      const costs = normalizeCosts(mechanical.frozenCosts);
      const materializedFactRefs = new Set(materializations.map(({ factRef }) => factRef));
      const materializedSceneIds = new Set(materializations.flatMap((entry) =>
        entry.kind === "location" && isNonEmptyString(entry.definition.sceneId)
          ? [entry.definition.sceneId]
          : []));
      const success = normalizeEffects(
        state,
        actorCharacterId,
        primaryFactRef,
        materializedSceneIds,
        mechanical.success,
      );
      if (
        duration === undefined
        || costs === undefined
        || costs.length !== 0
        || success === undefined
        || !Array.isArray(mechanical.failure)
        || mechanical.failure.length !== 0
        || !validateOutcomeEffects(
          state,
          actorCharacterId,
          actor?.sceneId ?? "",
          materializedFactRefs,
          costs,
          success,
        )
      ) return rejected("invalidRulesInput", "Direct consequences require a duration, legal typed effects, and no failure branch.");
      return {
        module: "compound",
        input: {
          kind: "resolveDirectConsequences",
          rootActionId,
          resolutionId: `resolution:${rootActionId}:direct`,
          plan: {
            schema: "zhuwei.compound-resolution-plan/v1",
            actorCharacterId,
            goal,
            method,
            sourceSceneId: actor?.sceneId,
            durationMicros: duration,
            primaryFactRef,
            frozenCosts: [],
            successEffects: success,
            failureEffects: [],
          },
        },
      };
    }
    case "commitMeaningfulFailure": {
      const newOptions = canonicalFailureOptions(mechanical.newOptions);
      if (
        !isNonEmptyString(mechanical.precedentRef)
        || micros === undefined
        || newOptions === undefined
        || basisRefs.length === 0
        || basisRefs.some((factRef) => !(factRef in state.canonicalFacts)
          && !materializations.some((entry) => entry.factRef === factRef))
      ) return rejected("invalidRulesInput", "Meaningful failure needs a precedent, frozen factual causes, time, and new options.");
      return {
        module: "campaign",
        input: {
          kind: "commitMeaningfulFailure",
          proposalId: rootActionId,
          characterId: actorCharacterId,
          goalId: mechanical.precedentRef,
          methodFingerprint: method,
          factualCause: basisRefs.join(";"),
          consequences: {
            fictionTimeCostMicros: micros,
            committedConsequences: consequenceRefs,
            newOptions,
          },
        },
      };
    }
    case "retryFailedAction": {
      return rejected(
        "invalidRulesInput",
        "Retry resolution must use the full frozen compound check path.",
      );
    }
    case "resolveNoncombatCheck":
      return npcContext === undefined
        ? rejected("invalidRulesInput", "Player checks must use the primary compound resolution path.")
        : npcCompoundRandomnessCommand(
            profiles,
            state,
            rootActionId,
            actorCharacterId,
            goal,
            method,
            primaryFactRef,
            materializations,
            mechanical,
            npcContext,
          );
    case "resolveNoncombatContest":
      if (npcContext !== undefined) {
        return rejected(
          "unsupportedOperation",
          "NPC contests require a registered frozen consequence protocol before they can join a compound transaction.",
        );
      }
      if (
        target === undefined
        || target.id === actorCharacterId
        || target.sceneId !== actor?.sceneId
        || ability === undefined
        || opposedAbility === undefined
        || !(mechanical.skill === null || isNonEmptyString(mechanical.skill))
        || !(mechanical.opposedSkill === null || isNonEmptyString(mechanical.opposedSkill))
      ) return rejected("invalidRulesInput", "The opposed check needs one present target and two frozen abilities.");
      return {
        module: "campaign",
        input: {
          kind: "resolveContest",
          proposalId: rootActionId,
          initiatorId: actorCharacterId,
          defenderId: target.id,
          initiatorCheck: { ability, skill: mechanical.skill, mode },
          defenderCheck: { ability: opposedAbility, skill: mechanical.opposedSkill, mode },
          tieResult: "statusQuo",
        },
      };
    case "resolveNoncombatSave":
      return npcContext === undefined
        ? rejected("invalidRulesInput", "Player saves must use the primary compound resolution path.")
        : npcCompoundRandomnessCommand(
            profiles,
            state,
            rootActionId,
            actorCharacterId,
            goal,
            method,
            primaryFactRef,
            materializations,
            mechanical,
            npcContext,
          );
    case "startActivity":
      if (micros === undefined) return rejected("invalidRulesInput", "An Activity must freeze a fictional duration.");
      {
        const materializedSceneIds = new Set(materializations.flatMap((entry) =>
          entry.kind === "location" && isNonEmptyString(entry.definition.sceneId)
            ? [entry.definition.sceneId]
            : []));
        const success = normalizeEffects(
          state,
          actorCharacterId,
          primaryFactRef,
          materializedSceneIds,
          mechanical.success,
        );
        const failure = normalizeEffects(
          state,
          actorCharacterId,
          primaryFactRef,
          materializedSceneIds,
          mechanical.failure,
        );
        if (success === undefined || failure === undefined
          || [...success, ...failure].some(({ kind }) => kind === "advanceFictionTime")) {
          return rejected(
            "invalidRulesInput",
            "Activity completion effects must be canonical; the frozen duration already owns its time advance.",
          );
        }
      return {
        module: "campaign",
        input: {
          kind: "startActivity",
          proposalId: rootActionId,
          activityId: isNonEmptyString(mechanical.activityRef)
            ? mechanical.activityRef
            : `activity:${rootActionId}`,
          characterId: actorCharacterId,
          activityKind: goal,
          intendedDurationMicros: micros,
          completion: {
            method,
            primaryFactRef,
            sourceSceneId: actor?.sceneId,
            success,
            failure,
          },
        },
      };
      }
    case "interruptActivity":
      if (!isNonEmptyString(mechanical.activityRef)) {
        return rejected("invalidRulesInput", "The interrupted Activity reference is missing.");
      }
      return {
        module: "campaign",
        input: {
          kind: "interruptActivity",
          proposalId: rootActionId,
          activityId: mechanical.activityRef,
          cause: { actorCharacterId, goal, method },
        },
      };
    case "completeActivity":
      if (!isNonEmptyString(mechanical.activityRef)) {
        return rejected("invalidRulesInput", "The completed Activity reference is missing.");
      }
      return {
        module: "campaign",
        input: { kind: "completeActivity", proposalId: rootActionId, activityId: mechanical.activityRef },
      };
    case "startCombat": {
      const dynamicEntities = npcMechanicsProfileEnabled(profiles.extensions)
        ? npcMechanicalCombatEntries(materializations)
        : materializations
          .filter((entry) => entry.kind === "npc" || entry.kind === "enemy")
          .map((entry) => structuredClone(entry.definition));
      if (dynamicEntities === undefined) {
        return rejected("invalidRulesInput", "Combat NPC materialization lacks a complete frozen definition.");
      }
      const dynamicEntityIds = new Set(dynamicEntities.flatMap((entry) =>
        isNonEmptyString(entry.entityId) ? [entry.entityId] : []));
      const alliedIds = [...new Set([actorCharacterId, ...members])];
      const participantIds = [...new Set([...alliedIds, ...targetRefs])];
      if (
        !isNonEmptyString(mechanical.encounterRef)
        || participantIds.length < 2
        || participantIds.some((id) => state.combatRuntime.entities[id] === undefined && !dynamicEntityIds.has(id))
      ) return rejected("invalidRulesInput", "Combat start needs an encounter and explicit present participants.");
      return {
        module: "combat",
        input: {
          kind: "startEncounter",
          rootActionId,
          proposalAttemptId: `proposal:${rootActionId}:combat-start`,
          encounterId: mechanical.encounterRef,
          sceneId: actor!.sceneId,
          participantEntityIds: participantIds,
          dynamicEntities,
          initiativeGroups: participantIds.map((entityId) => ({
            entryId: `initiative:${rootActionId}:${entityId}`,
            combatantEntityIds: [entityId],
          })),
          hostilities: targetRefs.flatMap((targetId) => [
            { fromEntityIds: alliedIds, toEntityIds: [targetId] },
            { fromEntityIds: [targetId], toEntityIds: alliedIds },
          ]),
          battlefieldFactIds: [primaryFactRef],
        },
      };
    }
    case "invokeCombatAction":
    case "resolveReaction": {
      const abilityRef = operation === "resolveReaction"
        ? mechanical.reactionRef ?? mechanical.abilityRef
        : mechanical.abilityRef;
      if (!isNonEmptyString(abilityRef)) {
        return rejected("invalidRulesInput", "Combat action must name an AbilityDefinition.");
      }
      return {
        module: "combat",
        input: {
          kind: "invokeAbility",
          rootActionId,
          sourceEntityId: actorCharacterId,
          abilityRef,
          parameters: {
            ...(isNonEmptyString(mechanical.targetEntityRef)
              ? { targetEntityId: mechanical.targetEntityRef }
              : {}),
            ...(targetRefs.length > 0 ? { targetEntityIds: targetRefs } : {}),
          },
        },
      };
    }
    case "moveCombatant": {
      const distanceInches = typeof mechanical.destinationFeet === "number"
        ? mechanical.destinationFeet * 12
        : Number.NaN;
      if (
        !isNonEmptyString(mechanical.encounterRef)
        || !["north", "south", "east", "west"].includes(String(mechanical.destinationRef))
        || !Number.isFinite(mechanical.destinationFeet)
        || Number(mechanical.destinationFeet) <= 0
        || !Number.isSafeInteger(distanceInches)
      ) return rejected("invalidRulesInput", "Combat movement must freeze a cardinal direction and a positive whole-inch distance.");
      const combatant = state.combatRuntime.entities[actorCharacterId];
      const position = isRecord(combatant?.position) ? combatant.position : undefined;
      if (position === undefined) return rejected("privateOrUnknownReference", "Combatant position is unavailable.");
      const end = {
        x: String(Number(position.x) + (mechanical.destinationRef === "east" ? distanceInches : mechanical.destinationRef === "west" ? -distanceInches : 0)),
        y: String(Number(position.y) + (mechanical.destinationRef === "south" ? distanceInches : mechanical.destinationRef === "north" ? -distanceInches : 0)),
        elevation: String(position.elevation),
      };
      return {
        module: "combat",
        input: {
          kind: "moveCombatant",
          rootActionId,
          encounterId: mechanical.encounterRef,
          sourceEntityId: actorCharacterId,
          movementMode: "walk",
          path: [structuredClone(position), end],
        },
      };
    }
    case "endCombatTurn":
      if (!isNonEmptyString(mechanical.encounterRef)) {
        return rejected("invalidRulesInput", "End turn must name the active encounter.");
      }
      return {
        module: "combat",
        input: {
          kind: "endTurn",
          rootActionId,
          encounterId: mechanical.encounterRef,
          sourceEntityId: actorCharacterId,
        },
      };
    case "proposeEncounterConclusion": {
      const encounter = isNonEmptyString(mechanical.encounterRef)
        ? state.combatRuntime.encounters[mechanical.encounterRef]
        : undefined;
      const participantIds = new Set(
        Array.isArray(encounter?.participantEntityIds)
          ? encounter.participantEntityIds.filter(isNonEmptyString)
          : [],
      );
      const materializedFactRefs = new Set(materializations.map(({ factRef }) => factRef));
      if (
        encounter === undefined
        || !isNonEmptyString(mechanical.outcome)
        || targetRefs.some((entityId) =>
          !participantIds.has(entityId) || state.combatRuntime.entities[entityId]?.kind !== "npc")
        || basisRefs.some((factRef) =>
          !(factRef in state.canonicalFacts) && !materializedFactRefs.has(factRef))
      ) return rejected("invalidRulesInput", "Encounter conclusion needs a present encounter and referenced participants/facts.");
      const escapedEntityIds = [...new Set([actorCharacterId, ...members])];
      return {
        module: "combat",
        input: {
          kind: "proposeEncounterConclusion",
          rootActionId,
          encounterId: mechanical.encounterRef,
          proposal: {
            reason: mechanical.outcome,
            ...(targetRefs.length === 0 ? {} : { npcEntityIds: targetRefs }),
            ...(basisRefs.length === 0 ? {} : { factRefs: basisRefs }),
            ...(mechanical.outcome === "playersEscaped" ? { escapedEntityIds } : {}),
          },
        },
      };
    }
    case "resolveRest": {
      if (!["short", "long"].includes(String(mechanical.restKind))) {
        return rejected("invalidRulesInput", "Rest kind must be short or long.");
      }
      const intendedDurationMicros = micros
        ?? (mechanical.restKind === "short" ? "3600000000" : "28800000000");
      return {
        module: "campaign",
        input: {
          kind: "startRest",
          proposalId: rootActionId,
          characterId: actorCharacterId,
          restKind: mechanical.restKind,
          intendedDurationMicros,
          hitDiceToSpend: mechanical.hitDiceToSpend ?? 0,
          arcaneRecoverySlotLevels: mechanical.arcaneRecoverySlotLevels ?? [],
          ...(members.length === 0 ? {} : { memberCharacterIds: members }),
        },
      };
    }
    case "changeResource":
      if (!isNonEmptyString(mechanical.resourceRef) || !Number.isSafeInteger(mechanical.amount) || Number(mechanical.amount) === 0) {
        return rejected("invalidRulesInput", "Resource change requires one non-zero integer delta.");
      }
      return {
        module: "campaign",
        input: {
          kind: "changeResource",
          proposalId: rootActionId,
          characterId: actorCharacterId,
          resourceId: mechanical.resourceRef,
          delta: Number(mechanical.amount),
          reason: goal,
        },
      };
    case "acquireItem": {
      if (!hasExactKeys(mechanical, ["amount", "itemRef", "operation"])
        || !isNonEmptyString(mechanical.itemRef)
        || !Number.isSafeInteger(mechanical.amount)
        || Number(mechanical.amount) <= 0) {
        return rejected("invalidRulesInput", "Item acquisition needs an exact entry and quantity.");
      }
      const existing = state.campaignRuntime.itemSystem.entries[mechanical.itemRef];
      const materialized = materializations.find((entry) =>
        entry.kind === "item" && entry.definition.itemEntryId === mechanical.itemRef);
      const sceneId = existing?.disposition === "scene" && isNonEmptyString(existing.sceneRef)
        ? existing.sceneRef
        : materialized === undefined
          ? undefined
          : materialized.definition.sceneRef;
      const availableQuantity = existing?.disposition === "scene"
        ? existing.quantity
        : materialized === undefined
          ? undefined
          : 1;
      if (sceneId !== actor?.sceneId || mechanical.amount !== availableQuantity) {
        return rejected("privateOrUnknownReference", "Item reference is unavailable.");
      }
      return {
        module: "campaign",
        input: {
          kind: "acquireItem",
          proposalId: rootActionId,
          characterId: actorCharacterId,
          itemId: mechanical.itemRef,
        },
      };
    }
    case "useItem":
      if (!hasExactKeys(mechanical, ["itemActivityId", "itemRef", "operation"])
        || !isNonEmptyString(mechanical.itemRef)
        || mechanical.itemActivityId !== "use") {
        return rejected("invalidRulesInput", "Item use needs one frozen item activity.");
      }
      return {
        module: "combat",
        input: {
          kind: "invokeItemActivity",
          rootActionId,
          sourceEntityId: actorCharacterId,
          itemEntryId: mechanical.itemRef,
          parameters: { targetEntityId: actorCharacterId },
        },
      };
    case "transferItem":
      if (
        !hasExactKeys(mechanical, [
          "amount",
          "itemRef",
          "operation",
          "ownershipDisposition",
          "targetEntityRef",
        ])
        || !isNonEmptyString(mechanical.itemRef)
        || !Number.isSafeInteger(mechanical.amount)
        || Number(mechanical.amount) <= 0
        || !["retain", "transfer"].includes(String(mechanical.ownershipDisposition))
        || target === undefined
        || target.id === actorCharacterId
        || target.sceneId !== actor?.sceneId
      ) return rejected("privateOrUnknownReference", "Item transfer references are unavailable.");
      return {
        module: "campaign",
        input: {
          kind: "transferItem",
          proposalId: rootActionId,
          fromCharacterId: actorCharacterId,
          toCharacterId: target.id,
          itemId: mechanical.itemRef,
          quantity: Number(mechanical.amount),
          method,
          ownershipDisposition: mechanical.ownershipDisposition === "transfer"
            ? "transferToRecipient"
            : "preserve",
        },
      };
    case "changeNpcGear": {
      const wear = mechanical.gearAction === "wear";
      if (
        npcContext === undefined
        || actor?.kind !== "npc"
        || !isGearSlot(mechanical.slot)
        || (wear
          ? !hasExactKeys(mechanical, ["gearAction", "itemRef", "operation", "slot"])
            || !isNonEmptyString(mechanical.itemRef)
          : mechanical.gearAction !== "stow"
            || !hasExactKeys(mechanical, ["gearAction", "operation", "slot"]))
      ) return rejected("invalidRulesInput", "NPC gear action is not canonical.");
      return {
        module: "multiplayer",
        input: {
          kind: "changeNpcGear",
          rootActionId,
          npcCharacterId: actorCharacterId,
          action: mechanical.gearAction,
          slot: mechanical.slot,
          ...(wear ? { itemId: mechanical.itemRef } : {}),
        },
      };
    }
    case "advanceFactionPlan": {
      const frozenBasisRefs = canonicalStrings(mechanical.basisRefs);
      const faction = isNonEmptyString(mechanical.factionRef)
        ? state.campaignRuntime.factions[mechanical.factionRef]
        : undefined;
      const materializedFaction = materializations.find((entry) =>
        entry.kind === "faction" && entry.definition.factionId === mechanical.factionRef);
      const memberRefs = faction?.memberRefs ?? materializedFaction?.definition.memberRefs;
      if (
        !hasOnlyKeys(mechanical, ["basisRefs", "factionRef", "operation"], ["planRef"])
        || npcContext === undefined
        || !isNonEmptyString(mechanical.factionRef)
        || !Array.isArray(memberRefs)
        || !memberRefs.includes(actorCharacterId)
        || frozenBasisRefs === undefined
        || frozenBasisRefs.length === 0
        || frozenBasisRefs.some((ref) =>
          !npcContext.knowledgeRefs.includes(ref)
          || !(ref in (state.knowledge[actorCharacterId] ?? {})))
        || (mechanical.planRef !== undefined && mechanical.planRef !== npcContext.planId)
      ) return rejected("npcKnowledgeInsufficient", "Faction plan exceeds the acting NPC's finite knowledge.");
      return {
        module: "campaign",
        input: {
          kind: "advanceFactionPlan",
          proposalId: rootActionId,
          factionId: mechanical.factionRef,
          planId: npcContext.planId,
          actingNpcId: actorCharacterId,
          causeFactIds: frozenBasisRefs,
          action: method,
        },
      };
    }
    case "changeKnowledge":
      if (!isNonEmptyString(mechanical.knowledgeRef)) {
        return rejected("invalidRulesInput", "Knowledge operation needs a knowledge reference.");
      }
      if (recipients.length > 0) {
        return {
          module: "campaign",
          input: {
            kind: "shareKnowledge",
            proposalId: rootActionId,
            senderCharacterId: actorCharacterId,
            recipientEntityIds: recipients,
            knowledgeRefs: [mechanical.knowledgeRef],
            medium: method,
            ...(isNonEmptyString(mechanical.mediumFactRef)
              ? { mediumFactId: mechanical.mediumFactRef }
              : {}),
            contentLayer: "full",
          },
        };
      }
      if (mechanical.knowledgeRef !== primaryFactRef && !(mechanical.knowledgeRef in state.canonicalFacts)) {
        return rejected("privateOrUnknownReference", "Acquired knowledge must reference a frozen canonical fact.");
      }
      return {
        module: "campaign",
        input: {
          kind: "acquireSensoryEvidence",
          proposalId: rootActionId,
          characterId: actorCharacterId,
          factId: mechanical.knowledgeRef,
          sense: "declaredAction",
          clarity: "full",
          publicEvidence: goal,
        },
      };
    case "changeParty": {
      const partyAction = mechanical.partyAction
        ?? (members.length > 0 ? "inviteMember" : "leave");
      switch (partyAction) {
        case "inviteMember":
          return members.length === 1
            ? {
                module: "multiplayer",
                input: {
                  kind: "invitePartyMember",
                  rootActionId,
                  inviterCharacterId: actorCharacterId,
                  invitedCharacterId: members[0],
                },
              }
            : rejected("invalidRulesInput", "A party invitation needs exactly one explicit member.");
        case "cancelInvitation":
          return isNonEmptyString(mechanical.pendingInputRef)
            ? {
                module: "multiplayer",
                input: {
                  kind: "cancelPartyInvitation",
                  rootActionId,
                  pendingInputId: mechanical.pendingInputRef,
                  inviterCharacterId: actorCharacterId,
                },
              }
            : rejected("invalidRulesInput", "Party invitation cancellation needs the projected pending input.");
        case "leave":
          return members.length === 0
            ? {
                module: "multiplayer",
                input: { kind: "leavePartyGroup", rootActionId, characterId: actorCharacterId },
              }
            : rejected("invalidRulesInput", "Leaving a party cannot name another member.");
        case "transferLeadership":
          return members.length === 1
            ? {
                module: "multiplayer",
                input: {
                  kind: "transferPartyLeadership",
                  rootActionId,
                  fromCharacterId: actorCharacterId,
                  toCharacterId: members[0],
                },
              }
            : rejected("invalidRulesInput", "Leadership transfer needs exactly one explicit member.");
        case "proposeMove":
          return isNonEmptyString(mechanical.destinationRef) && micros !== undefined
            ? {
                module: "multiplayer",
                input: {
                  kind: "proposePartyMove",
                  rootActionId,
                  leaderCharacterId: actorCharacterId,
                  destinationSceneId: mechanical.destinationRef,
                  fictionTimeCostMicros: micros,
                },
              }
            : rejected("invalidRulesInput", "Party movement needs a destination and frozen fictional duration.");
        case "moveIndividually":
          return isNonEmptyString(mechanical.destinationRef) && micros !== undefined
            ? {
                module: "multiplayer",
                input: {
                  kind: "moveIndividually",
                  rootActionId,
                  characterId: actorCharacterId,
                  destinationSceneId: mechanical.destinationRef,
                  fictionTimeCostMicros: micros,
                },
              }
            : rejected("invalidRulesInput", "Individual movement needs a destination and frozen fictional duration.");
        default:
          return rejected("invalidRulesInput", "Party change needs a registered action.");
      }
    }
    case "advanceCampaignLifecycle": {
      const campaignId = isNonEmptyString(mechanical.campaignRef)
        ? mechanical.campaignRef
        : isNonEmptyString(state.campaignRuntime.campaign?.campaignId)
          ? state.campaignRuntime.campaign.campaignId
          : undefined;
      switch (mechanical.lifecycleAction) {
        case "grantMilestone":
          if (campaignId === undefined) return rejected("invalidRulesInput", "Campaign reference is unavailable.");
          return {
            module: "campaign",
            input: {
              kind: "grantMilestone",
              proposalId: rootActionId,
              campaignId,
              characterId: actorCharacterId,
              sourceFactIds: [primaryFactRef],
            },
          };
        case "awardExperience":
          if (
            campaignId === undefined
            || !Number.isSafeInteger(mechanical.experienceAmount)
            || Number(mechanical.experienceAmount) <= 0
            || Number(mechanical.experienceAmount) > MAX_EXPERIENCE_AWARD
          ) return rejected("invalidRulesInput", "XP advancement needs a positive bounded experience award.");
          return {
            module: "campaign",
            input: {
              kind: "awardExperience",
              proposalId: rootActionId,
              campaignId,
              characterId: actorCharacterId,
              amount: Number(mechanical.experienceAmount),
              sourceFactIds: [primaryFactRef],
            },
          };
        case "concludeChapter":
          if (campaignId === undefined || !isNonEmptyString(mechanical.chapterRef)) {
            return rejected("invalidRulesInput", "Chapter conclusion needs campaign and chapter references.");
          }
          return {
            module: "campaign",
            input: {
              kind: "concludeChapter",
              proposalId: rootActionId,
              campaignId,
              chapterId: mechanical.chapterRef,
              reason: goal,
              continuityPolicy: "preserveAuthoritativeFacts",
            },
          };
        case "startChapter": {
          if (campaignId === undefined || !isNonEmptyString(mechanical.chapterRef)) {
            return rejected("invalidRulesInput", "Chapter start needs campaign and chapter references.");
          }
          const ordinal = String(Object.keys(state.campaignRuntime.chapters).length + 1);
          return {
            module: "campaign",
            input: {
              kind: "startChapter",
              proposalId: rootActionId,
              campaignId,
              chapterId: mechanical.chapterRef,
              ordinal,
              storyAnchorRefs: [primaryFactRef],
              sceneQuestion,
            },
          };
        }
        case "transitionChapter": {
          const fromChapterId = isNonEmptyString(state.campaignRuntime.campaign?.currentChapterId)
            ? state.campaignRuntime.campaign.currentChapterId
            : undefined;
          if (campaignId === undefined
            || fromChapterId === undefined
            || !isNonEmptyString(mechanical.chapterRef)
            || !(mechanical.activityTransitions === undefined
              || Array.isArray(mechanical.activityTransitions))) {
            return rejected("invalidRulesInput", "Atomic chapter transition needs current and next chapter references.");
          }
          const ordinal = String(Object.keys(state.campaignRuntime.chapters).length + 1);
          return {
            module: "campaign",
            input: {
              kind: "transitionChapter",
              proposalId: rootActionId,
              campaignId,
              fromChapterId,
              toChapterId: mechanical.chapterRef,
              ordinal,
              reason: goal,
              continuityPolicy: "preserveAuthoritativeFacts",
              storyAnchorRefs: [primaryFactRef],
              sceneQuestion,
              activityTransitions: structuredClone(mechanical.activityTransitions ?? []),
            },
          };
        }
        case "retireCharacter":
          return {
            module: "campaign",
            input: {
              kind: "retireCharacter",
              proposalId: rootActionId,
              characterId: actorCharacterId,
              reason: goal,
              continueAsNpc: mechanical.continueAsNpc === true,
            },
          };
        case "establishInheritanceSource": {
          const predecessorId = isNonEmptyString(mechanical.sourceEntityRef)
            ? mechanical.sourceEntityRef
            : undefined;
          const predecessor = predecessorId === undefined
            ? undefined
            : state.entities[predecessorId];
          const actorControl = state.characterControls[actorCharacterId];
          const authorization = isRecord(mechanical.inheritanceAuthorization)
            ? mechanical.inheritanceAuthorization
            : undefined;
          const authorizationKind = authorization?.kind;
          if (predecessor === undefined
            || actorControl === undefined
            || predecessor.lastControllerSeatId !== actorControl.seatId
            || !["dead", "retired", "missing", "npcTransitioned"].includes(predecessor.tenureStatus)
            || authorization === undefined
            || !hasExactKeys(authorization, [
              "authorizationId",
              "kind",
              "scope",
              "sourceRef",
              "targetRef",
            ])
            || ![
              authorization.authorizationId,
              authorization.sourceRef,
              authorization.targetRef,
            ].every(isNonEmptyString)
            || !Object.hasOwn(INHERITANCE_SCOPE_BY_KIND, authorizationKind as PropertyKey)
            || INHERITANCE_SCOPE_BY_KIND[
              authorizationKind as keyof typeof INHERITANCE_SCOPE_BY_KIND
            ] !== authorization.scope
            || !(INHERITANCE_SOURCE_KINDS as readonly unknown[])
              .includes(mechanical.inheritanceSourceKind)
            || !isNonEmptyString(mechanical.publicClause)) {
            return rejected("invalidRulesInput", "Inheritance source needs the authenticated successor's exact predecessor and one scoped authorization.");
          }
          return {
            module: "campaign",
            input: {
              kind: "establishInheritanceSource",
              proposalId: rootActionId,
              predecessorCharacterId: predecessor.id,
              successorCharacterId: actorCharacterId,
              source: {
                kind: mechanical.inheritanceSourceKind,
                publicClause: mechanical.publicClause,
                authorizations: [{
                  authorizationId: authorization.authorizationId,
                  subjectCharacterId: predecessor.id,
                  kind: authorization.kind,
                  sourceRef: authorization.sourceRef,
                  targetCharacterId: actorCharacterId,
                  targetRef: authorization.targetRef,
                  scope: authorization.scope,
                }],
              },
            },
          };
        }
        case "transferInheritance": {
          const predecessorId = isNonEmptyString(mechanical.sourceEntityRef)
            ? mechanical.sourceEntityRef
            : undefined;
          const predecessor = predecessorId === undefined
            ? undefined
            : state.entities[predecessorId];
          const actorControl = state.characterControls[actorCharacterId];
          if (predecessor === undefined
            || actorControl === undefined
            || predecessor.lastControllerSeatId !== actorControl.seatId
            || !isNonEmptyString(mechanical.inheritanceSourceFactRef)
            || !isNonEmptyString(mechanical.inheritanceAuthorizationRef)) {
            return rejected("inheritanceProvenanceRequired", "Inheritance transfer needs the authenticated successor's exact unconsumed source.");
          }
          return {
            module: "campaign",
            input: {
              kind: "transferInheritance",
              proposalId: rootActionId,
              predecessorCharacterId: predecessor.id,
              successorCharacterId: actorCharacterId,
              sourceFactId: mechanical.inheritanceSourceFactRef,
              authorizationId: mechanical.inheritanceAuthorizationRef,
            },
          };
        }
        case "raiseEndingCandidate":
          if (
            !isNonEmptyString(mechanical.endingCandidateRef)
            || basisRefs.length === 0
            || basisRefs.some((factRef) => !(factRef in state.canonicalFacts)
              && !materializations.some((entry) => entry.factRef === factRef))
          ) return rejected("invalidRulesInput", "Ending candidate needs explicit frozen basis facts.");
          return {
            module: "campaign",
            input: {
              kind: "raiseEndingCandidate",
              proposalId: rootActionId,
              endingCandidateId: mechanical.endingCandidateRef,
              basisFactIds: basisRefs,
              unresolvedConsequences: unresolvedRefs,
            },
          };
        case "concludeStory":
          if (
            !isNonEmptyString(mechanical.endingCandidateRef)
            || !isNonEmptyString(mechanical.storyRef)
            || !isNonEmptyString(mechanical.outcome)
          ) return rejected("invalidRulesInput", "Story conclusion needs an accepted ending, story reference, and outcome.");
          return {
            module: "campaign",
            input: {
              kind: "concludeStory",
              proposalId: rootActionId,
              storyId: mechanical.storyRef,
              endingCandidateId: mechanical.endingCandidateRef,
              outcome: mechanical.outcome,
              longTermConsequences: consequenceRefs,
            },
          };
        case "recordEpilogueChoice":
          if (!isNonEmptyString(mechanical.storyRef) || !isNonEmptyString(mechanical.choice)) {
            return rejected("invalidRulesInput", "Epilogue choice needs a concluded story and the player's explicit choice.");
          }
          return {
            module: "campaign",
            input: {
              kind: "recordEpilogueChoice",
              proposalId: rootActionId,
              characterId: actorCharacterId,
              storyId: mechanical.storyRef,
              choice: mechanical.choice,
            },
          };
        case "startSequel":
          if (
            !isNonEmptyString(mechanical.storyRef)
            || !isNonEmptyString(mechanical.sequelStoryRef)
            || !isNonEmptyString(mechanical.chapterRef)
          ) return rejected("invalidRulesInput", "Sequel start needs prior/new story, chapter, and frozen anchors.");
          return {
            module: "campaign",
            input: {
              kind: "startSequel",
              proposalId: rootActionId,
              priorStoryId: mechanical.storyRef,
              sequelStoryId: mechanical.sequelStoryRef,
              chapterId: mechanical.chapterRef,
              anchorFactIds: basisRefs,
              sceneQuestion,
            },
          };
        default:
          return rejected("invalidRulesInput", "Campaign lifecycle action needs an explicit registered transition.");
      }
    }
    default:
      return rejected("unsupportedOperation", "The requested semantic operation is not registered.");
  }
}

function runSemanticCommand(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  command: SemanticCommand,
): StepResult {
  const marked = continueCompoundRoot(command.input, String(command.input.rootActionId ?? command.input.proposalId));
  if (command.module === "compoundRandomness") {
    const rootActionId = command.input.rootActionId;
    const resolutionKey = command.input.resolutionKey;
    const plan = command.input.plan;
    const frozenCheck = command.input.frozenCheck;
    if (
      !isNonEmptyString(rootActionId)
      || !isNonEmptyString(resolutionKey)
      || !isCompoundResolutionPlan(plan)
      || !isRecord(frozenCheck)
      || !isNonEmptyString(frozenCheck.kind)
      || !isNonEmptyString(frozenCheck.ability)
      || !isNonEmptyString(frozenCheck.mode)
    ) return rejected("invalidWorldState", "NPC compound randomness command is not canonical.");
    const typedCheck = frozenCheck as unknown as FrozenCheck;
    const drafts: Draft[] = [{
      eventType: "CheckFrozen",
      payload: {
        characterId: plan.actorCharacterId,
        checkKind: typedCheck.kind,
        ability: typedCheck.ability,
        skill: typedCheck.skill,
        dc: Number(typedCheck.dc),
        mode: typedCheck.mode,
        success: { effects: structuredClone(plan.successEffects), consequences: [typedCheck.successOutcome] },
        failure: { effects: structuredClone(plan.failureEffects), consequences: [typedCheck.failureOutcome] },
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
    }];
    const actor = state.entities[plan.actorCharacterId];
    const remainingItems = Object.fromEntries(
      Object.values(state.campaignRuntime.itemSystem.entries)
        .filter((entry) => entry.disposition === "held"
          && entry.holderRef === plan.actorCharacterId
          && entry.condition === "usable")
        .map((entry) => [entry.entryId, entry.quantity]),
    );
    for (const cost of plan.frozenCosts) {
      if (cost.kind === "consumeResource") {
        if ((actor?.resources?.[cost.resourceRef] ?? 0) < cost.amount) {
          return rejected("insufficientResource", "NPC frozen resource cost is no longer available.");
        }
        drafts.push({
          eventType: "ResourceReserved",
          payload: {
            characterId: plan.actorCharacterId,
            resourceId: cost.resourceRef,
            amount: cost.amount,
            purpose: plan.goal,
          },
          visibilityPolicyId: `visibility:npc:${plan.actorCharacterId}`,
          secrecy: "internal",
        });
      }
      if (cost.kind === "consumeItem") {
        const entryId = cost.itemRef;
        const entry = state.campaignRuntime.itemSystem.entries[entryId];
        if (!Number.isSafeInteger(remainingItems[entryId])
          || remainingItems[entryId] < cost.count
          || entry === undefined) {
          return rejected("insufficientResource", "NPC frozen item cost is no longer available.");
        }
        const quantityBefore = remainingItems[entryId];
        remainingItems[entryId] -= cost.count;
        drafts.push({
          eventType: "ItemUsed",
          payload: {
            characterId: plan.actorCharacterId,
            entryId,
            purpose: plan.goal,
            quantityBefore,
            quantityAfter: remainingItems[entryId],
            chargesBefore: entry.charges?.current ?? null,
            chargesAfter: entry.charges?.current ?? null,
            durabilityBefore: entry.durability?.current ?? null,
            durabilityAfter: entry.durability?.current ?? null,
          },
          visibilityPolicyId: entry.visibilityPolicyRef,
          secrecy: entry.visibilityPolicyRef.startsWith("visibility:public") ? "public" : "internal",
        });
      }
    }
    const prefix = result("committed", profiles, state, rootActionId, drafts);
    if (prefix.kind === "rejected" || prefix.kind === "initialized") return prefix;
    const authority = checkRequest(
      prefix.state,
      rootActionId,
      plan.actorCharacterId,
      typedCheck,
      plan,
      resolutionKey,
    );
    const requested = result("awaitingRandomness", profiles, prefix.state, rootActionId, [{
      eventType: "RandomnessRequested",
      payload: {
        request: authority.request,
        continuation: authority.continuation,
        purpose: authority.request.purpose,
        formula: authority.request.diceExpression,
        resolutionPlan: plan,
      },
      resolutionId: authority.request.resolutionId,
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      writes: [`continuation:${authority.continuation.continuationId}`, `receipt:${rootActionId}`],
      creates: [`continuation:${authority.continuation.continuationId}`],
    }], {
      randomnessRequest: authority.request,
      continuation: authority.continuation,
      randomnessRequests: [authority.request],
      continuations: [authority.continuation],
    });
    if (requested.kind === "rejected" || requested.kind === "initialized") return requested;
    return { ...requested, events: [...prefix.events, ...requested.events] };
  }
  if (command.module === "compound") {
    const plan = command.input.plan;
    const rootActionId = command.input.rootActionId;
    const resolutionId = command.input.resolutionId;
    if (
      !isNonEmptyString(rootActionId)
      || !isNonEmptyString(resolutionId)
      || !isCompoundResolutionPlan(plan)
    ) return rejected("invalidWorldState", "Direct compound consequences are not canonical.");
    const drafts = consequenceDrafts(
      state,
      rootActionId,
      resolutionId,
      plan,
      true,
    );
    return drafts === undefined
      ? rejected("invalidRulesInput", "Direct compound consequences no longer form one legal transition.")
      : result("committed", profiles, state, rootActionId, drafts);
  }
  const outcome = command.module === "campaign"
    ? stepCampaignWorld(profiles, state, marked)
    : command.module === "combat"
      ? stepCombatWorld(profiles, state, marked)
      : stepMultiplayerWorld(profiles, state, marked);
  return outcome ?? rejected("unsupportedOperation", "The registered semantic operation has no Rules implementation.");
}

function resolveDueActorPlanMechanics(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (input.kind !== "resolveDueActorPlan" || input.mechanicalProposal === null) return undefined;
  const mechanical = isRecord(input.mechanicalProposal) ? input.mechanicalProposal : undefined;
  const affectedCharacterId = isNonEmptyString(input.affectedCharacterId)
    ? input.affectedCharacterId
    : undefined;
  const selected = affectedCharacterId === undefined
    ? undefined
    : earliestEligibleDueActorPlan(state, affectedCharacterId);
  const plan = selected?.plan;
  const premiseRefs = canonicalStrings(plan?.premiseRefs);
  const resourceRefs = canonicalStrings(plan?.resourceRefs);
  const trace = isRecord(plan?.trace) ? plan.trace : undefined;
  const planActivity = isRecord(plan?.activity) ? plan.activity : undefined;
  if (
    input.decision !== "execute"
    || mechanical === undefined
    || selected === undefined
    || plan === undefined
    || plan.planId !== input.planId
    || dueActorPlanChildRoot(plan) !== input.proposalId
    || premiseRefs === undefined
    || premiseRefs.length === 0
    || premiseRefs.some((reference) =>
      !actorPlanPremiseIsAvailable(state, selected.npcId, reference))
    || resourceRefs === undefined
    || !isNonEmptyString(plan.goal)
    || !isNonEmptyString(plan.nextStep)
    || !isNonEmptyString(trace?.factRef)
    || !isNonEmptyString(planActivity?.activityId)
  ) return rejected("invalidRulesInput", "Due ActorPlan mechanics exceed the frozen finite plan.");
  if (mechanical.operation === "advanceCampaignLifecycle") {
    return rejected(
      "privateOrUnknownReference",
      "A finite due ActorPlan cannot exercise campaign lifecycle authority.",
    );
  }

  const mechanicalBasisRefs = mechanical.basisRefs === undefined
    ? []
    : canonicalStrings(mechanical.basisRefs);
  const frozenCosts = Array.isArray(mechanical.frozenCosts)
    ? mechanical.frozenCosts
    : [];
  const costRefs = frozenCosts.flatMap((cost) => {
    if (!isRecord(cost)) return [];
    if (cost.kind === "consumeResource" && isNonEmptyString(cost.resourceRef)) {
      return [cost.resourceRef];
    }
    if (cost.kind === "consumeItem" && isNonEmptyString(cost.itemRef)) {
      return [cost.itemRef];
    }
    return [];
  });
  const directResourceRefs = [
    mechanical.resourceRef,
    mechanical.itemRef,
  ].filter(isNonEmptyString);
  const recipients = mechanical.recipientRefs === undefined
    ? []
    : canonicalStrings(mechanical.recipientRefs);
  const actor = state.entities[selected.npcId];
  const alternateTarget = isRecord(plan.alternateTarget) ? plan.alternateTarget : undefined;
  const frozenTargetRef = input.targetRef === undefined
    ? actor?.sceneId
    : isNonEmptyString(input.targetRef)
      && alternateTarget?.targetRef === input.targetRef
      && (input.targetRef in state.entities || input.targetRef in state.scenes)
      ? input.targetRef
      : undefined;
  const targetRefs = mechanical.targetEntityRefs === undefined
    ? []
    : canonicalStrings(mechanical.targetEntityRefs);
  const activity = state.campaignRuntime.activities[planActivity.activityId];
  const activityOperation = mechanical.operation === "interruptActivity"
    || mechanical.operation === "completeActivity";
  const knowledgeRefs = premiseRefs.filter((reference) =>
    reference in (state.knowledge[selected.npcId] ?? {}));
  const allowedKnowledgeRefs = new Set([trace.factRef, ...knowledgeRefs]);
  if (
    mechanicalBasisRefs === undefined
    || mechanicalBasisRefs.some((reference) => !premiseRefs.includes(reference))
    || costRefs.some((reference) => !resourceRefs.includes(reference))
    || directResourceRefs.some((reference) => !resourceRefs.includes(reference))
    || recipients === undefined
    || targetRefs === undefined
    || frozenTargetRef === undefined
    || (isNonEmptyString(mechanical.targetEntityRef)
      && mechanical.targetEntityRef !== frozenTargetRef)
    || targetRefs.some((reference) => reference !== frozenTargetRef)
    || (activityOperation && (
      mechanical.activityRef !== planActivity.activityId
      || activity?.status !== "active"
      || activity.characterId !== selected.npcId
    ))
    || (mechanical.operation === "changeKnowledge" && (
      !isNonEmptyString(mechanical.knowledgeRef)
      || !allowedKnowledgeRefs.has(mechanical.knowledgeRef)
      || recipients.some((reference) => reference !== frozenTargetRef)
    ))
  ) return rejected(
    "privateOrUnknownReference",
    "Due ActorPlan mechanics cite an unfrozen premise, resource, activity, knowledge, or recipient.",
  );
  if (!dueActorPlanOutcomeEffectsAreFrozen(
    mechanical,
    new Set([trace.factRef, ...premiseRefs, ...knowledgeRefs]),
    new Set(resourceRefs),
    frozenTargetRef,
  )) {
    return rejected(
      "privateOrUnknownReference",
      "Due ActorPlan consequences cite unfrozen knowledge or lifecycle targets.",
    );
  }

  const lifecycle = stepCampaignWorld(profiles, state, {
    ...structuredClone(input),
    mechanicalProposal: null,
  });
  if (lifecycle === undefined) {
    return rejected("invalidWorldState", "Due ActorPlan lifecycle is unavailable.");
  }
  if (lifecycle.kind !== "committed") return lifecycle;
  const actionEvent = lifecycle.events.find((event) =>
    event.eventType === "NpcActionCommitted" || event.eventType === "FactionActionCommitted");
  const actionPayload: JsonRecord | undefined = actionEvent === undefined
    ? undefined
    : actionEvent.payload as JsonRecord;
  const committedTargetRef = isNonEmptyString(actionPayload?.targetRef)
    ? actionPayload.targetRef
    : undefined;
  if (committedTargetRef !== frozenTargetRef) {
    return rejected("invalidWorldState", "Due ActorPlan lifecycle changed its frozen target.");
  }

  const command = semanticCommand(
    profiles,
    lifecycle.state,
    input.proposalId as string,
    selected.npcId,
    plan.goal,
    plan.nextStep,
    trace.factRef,
    plan.nextStep,
    [],
    mechanical,
    { planId: plan.planId as string, knowledgeRefs },
  );
  if (!("module" in command)) return command;
  return mergeCompoundResult(
    lifecycle,
    runSemanticCommand(profiles, lifecycle.state, command),
  );
}

export function storyWaitsForExplicitContinuation(state: AuthoritativeWorldState): boolean {
  const stories = Object.values(state.campaignRuntime.stories).filter(isRecord);
  return stories.some((entry) => entry.status === "concluded")
    && !stories.some((entry) => entry.status === "active");
}

function dueActorPlanOutcomeEffectsAreFrozen(
  mechanical: JsonRecord,
  allowedFactRefs: ReadonlySet<string>,
  frozenResourceRefs: ReadonlySet<string>,
  frozenTargetRef: string,
): boolean {
  for (const branch of [mechanical.success, mechanical.failure]) {
    if (branch === undefined) continue;
    if (!Array.isArray(branch)) return false;
    for (const value of branch) {
      if (!isRecord(value) || !isNonEmptyString(value.kind)) return false;
      if (isNonEmptyString(value.definitionRef)
        && !allowedFactRefs.has(value.definitionRef)) return false;
      if (value.kind === "acquireEvidence" || value.kind === "acquireKnowledge") {
        const definitionRef = isNonEmptyString(value.definitionRef)
          ? value.definitionRef
          : undefined;
        if (definitionRef !== undefined && !allowedFactRefs.has(definitionRef)) return false;
      }
      if (value.kind === "updateRelationship") {
        const recipientRefs = canonicalStrings(value.recipientRefs);
        if (recipientRefs === undefined
          || recipientRefs.length === 0
          || recipientRefs.some((reference) => reference !== frozenTargetRef)) return false;
      }
      if ((value.kind === "recordCommitment" || value.kind === "recordDebt")
        && value.targetRef !== frozenTargetRef) return false;
      if (value.kind === "alertNpc" && value.npcId !== frozenTargetRef) return false;
      if (value.kind === "changeResource"
        && (!isNonEmptyString(value.resourceRef)
          || !frozenResourceRefs.has(value.resourceRef))) return false;
      if (value.kind === "moveEntity" && value.sceneRef !== frozenTargetRef) return false;
    }
  }
  return true;
}

function formTypedNpcActorPlan(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (input.kind !== "formNpcActorPlan" || input.activity === undefined) return undefined;
  if (!hasExactKeys(input, [
    "activity",
    "alternateTarget",
    "due",
    "goal",
    "kind",
    "nextStep",
    "npcId",
    "planId",
    "premiseRefs",
    "proposalId",
    "resourceRefs",
    "trace",
    "trigger",
  ])) return rejected("invalidRulesInput", "ActorPlan formation input is not canonical.");

  const rootActionId = isNonEmptyString(input.proposalId) ? input.proposalId : undefined;
  const npc = isNonEmptyString(input.npcId) ? state.entities[input.npcId] : undefined;
  const planId = isNonEmptyString(input.planId) ? input.planId : undefined;
  const goal = isNonEmptyString(input.goal) ? input.goal : undefined;
  const nextStep = isNonEmptyString(input.nextStep) ? input.nextStep : undefined;
  const premiseRefs = canonicalStrings(input.premiseRefs);
  const resourceRefs = canonicalStrings(input.resourceRefs);
  const activity = isRecord(input.activity) ? input.activity : undefined;
  const trace = isRecord(input.trace) ? input.trace : undefined;
  const traceFactRef = isNonEmptyString(trace?.factRef) ? trace.factRef : undefined;
  const traceDescription = isNonEmptyString(trace?.description) ? trace.description : undefined;
  const traceVisibilityPolicyRef = isNonEmptyString(trace?.visibilityPolicyRef)
    ? trace.visibilityPolicyRef
    : undefined;
  const alternateTarget = isRecord(input.alternateTarget) ? input.alternateTarget : undefined;
  const alternateTargetRef = isNonEmptyString(alternateTarget?.targetRef)
    ? alternateTarget.targetRef
    : undefined;
  const alternateTargetReason = isNonEmptyString(alternateTarget?.reason)
    ? alternateTarget.reason
    : undefined;
  if (
    rootActionId === undefined
    || rootActionId in state.receipts
    || !actorPlanNpcIsAvailable(npc)
    || planId === undefined
    || goal === undefined
    || nextStep === undefined
    || [planId, goal, nextStep].some((value) => value.length > 480)
    || premiseRefs === undefined
    || premiseRefs.length === 0
    || resourceRefs === undefined
    || [premiseRefs, resourceRefs].some((refs) =>
      refs.length > 40 || refs.some((reference) => reference.length > 240))
    || premiseRefs.some((reference) => !actorPlanPremiseIsAvailable(state, npc.id, reference))
    || planId in state.campaignRuntime.npcPlans
    || activity === undefined
    || !hasExactKeys(activity, ["activityId", "activityKind", "intendedDurationMicros"])
    || !isNonEmptyString(activity.activityId)
    || !isNonEmptyString(activity.activityKind)
    || activity.activityKind === "stableRecovery2014"
    || typeof activity.intendedDurationMicros !== "string"
    || !/^[1-9][0-9]*$/u.test(activity.intendedDurationMicros)
    || activity.activityId in state.campaignRuntime.activities
    || Object.values(state.campaignRuntime.activities)
      .some((entry) => entry.status === "active" && entry.characterId === npc.id)
    || trace === undefined
    || !hasExactKeys(trace, ["description", "factRef", "visibilityPolicyRef"])
    || traceFactRef === undefined
    || traceDescription === undefined
    || traceVisibilityPolicyRef === undefined
    || traceFactRef in state.canonicalFacts
    || traceFactRef in state.campaignRuntime.definitions
    || alternateTarget === undefined
    || !hasExactKeys(alternateTarget, ["reason", "targetRef"])
    || alternateTargetReason === undefined
    || alternateTargetRef === undefined
    || (!(alternateTargetRef in state.scenes)
      && !(alternateTargetRef in state.entities))
  ) return rejected("invalidRulesInput", "ActorPlan fields exceed the current finite plan contract.");

  const availableResources = new Set(Object.keys(npc.resources ?? {}));
  for (const faction of Object.values(state.campaignRuntime.factions)) {
    if (!Array.isArray(faction.memberRefs) || !faction.memberRefs.includes(npc.id)) continue;
    if (isNonEmptyString(faction.factionId)) availableResources.add(faction.factionId);
    if (Array.isArray(faction.resourceRefs)) {
      for (const reference of faction.resourceRefs) {
        if (isNonEmptyString(reference)) availableResources.add(reference);
      }
    }
  }
  if (resourceRefs.some((reference) => !availableResources.has(reference))) {
    return rejected("privateOrUnknownReference", "ActorPlan resources are unavailable to the finite NPC.");
  }

  const timelineId = characterTimelineId(state, npc.id);
  let due: { kind: "fictionTime"; atFictionMicros: string } | null = null;
  if (input.due !== null) {
    if (
      !isRecord(input.due)
      || !hasExactKeys(input.due, ["atFictionMicros", "kind"])
      || input.due.kind !== "fictionTime"
      || typeof input.due.atFictionMicros !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(input.due.atFictionMicros)
      || timelineId === undefined
      || (BigInt(state.fictionTimelines[timelineId].nowMicros)
        + BigInt(activity.intendedDurationMicros)).toString() !== input.due.atFictionMicros
    ) return rejected("invalidRulesInput", "ActorPlan due time is not bound to its Activity duration.");
    due = { kind: "fictionTime", atFictionMicros: input.due.atFictionMicros };
  }

  let trigger: { kind: "committedEvent"; eventRef: string }
    | { kind: "knowledgeAcquired"; knowledgeRef: string }
    | null = null;
  if (input.trigger !== null) {
    if (!isRecord(input.trigger)) {
      return rejected("invalidRulesInput", "ActorPlan trigger is not canonical.");
    }
    const triggerInput = input.trigger;
    const knowledgeRef = isNonEmptyString(triggerInput.knowledgeRef)
      ? triggerInput.knowledgeRef
      : undefined;
    const eventRef = isNonEmptyString(triggerInput.eventRef) ? triggerInput.eventRef : undefined;
    if (
      triggerInput.kind === "knowledgeAcquired"
      && hasExactKeys(triggerInput, ["kind", "knowledgeRef"])
      && knowledgeRef !== undefined
      && premiseRefs.includes(knowledgeRef)
      && knowledgeRef in (state.knowledge[npc.id] ?? {})
    ) {
      trigger = { kind: "knowledgeAcquired", knowledgeRef };
    } else if (
      triggerInput.kind === "committedEvent"
      && hasExactKeys(triggerInput, ["eventRef", "kind"])
      && eventRef !== undefined
      && Object.values(state.knowledge[npc.id] ?? {}).some((knowledge) =>
        knowledge.acquiredByEventId === eventRef
        || knowledge.provenanceChain.includes(eventRef))
    ) {
      trigger = { kind: "committedEvent", eventRef };
    } else {
      return rejected("privateOrUnknownReference", "ActorPlan trigger is unavailable to the finite NPC.");
    }
  }
  if ((due === null) === (trigger === null)) {
    return rejected("invalidRulesInput", "ActorPlan requires exactly one due time or frozen trigger.");
  }

  const chapterId = isNonEmptyString(state.campaignRuntime.campaign?.currentChapterId)
    ? state.campaignRuntime.campaign.currentChapterId
    : undefined;
  const chapter = chapterId === undefined ? undefined : state.campaignRuntime.chapters[chapterId];
  if (chapterId === undefined || chapter?.status !== "active" || !isProfileRef(chapter.moduleRef)) {
    return rejected("invalidWorldState", "ActorPlan requires the Room's active pinned chapter.");
  }

  const payload: EventPayloadByType["NpcPlanFormed"] = {
    npcId: npc.id,
    planId,
    actorKind: "npc",
    actorRef: npc.id,
    decisionNpcId: npc.id,
    revision: "1",
    status: "scheduled",
    goal,
    premiseRefs,
    nextStep,
    resourceRefs,
    activity: {
      activityId: activity.activityId as string,
      activityKind: activity.activityKind as string,
      intendedDurationMicros: activity.intendedDurationMicros as string,
    },
    due,
    trigger,
    trace: {
      factRef: traceFactRef,
      description: traceDescription,
      visibilityPolicyRef: traceVisibilityPolicyRef,
    },
    alternateTarget: {
      targetRef: alternateTargetRef,
      reason: alternateTargetReason,
    },
    chapterId,
    moduleRef: structuredClone(chapter.moduleRef),
  };
  return result("committed", profiles, state, rootActionId, [{
    eventType: "NpcPlanFormed",
    payload,
    visibilityPolicyId: `visibility:npc:${npc.id}`,
    secrecy: "internal",
    reads: [...new Set([
      ...premiseRefs.flatMap((reference) => {
        const scope = actorPlanPremiseScope(state, npc.id, reference);
        return scope === undefined ? [] : [scope];
      }),
    ])],
    creates: [`npc-plan:${planId}`],
  }, {
    eventType: "ActivityStarted",
    payload: {
      activityId: activity.activityId as string,
      characterId: npc.id,
      activityKind: activity.activityKind as string,
      intendedDurationMicros: activity.intendedDurationMicros as string,
      completion: { kind: "actorPlan", planId },
    },
    visibilityPolicyId: `visibility:npc:${npc.id}`,
    secrecy: "internal",
    reads: [`npc-plan:${planId}`],
    creates: [`activity:${activity.activityId as string}`],
  }]);
}

export function stepActorPlanMechanics(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  return formTypedNpcActorPlan(profiles, state, input)
    ?? resolveDueActorPlanMechanics(profiles, state, input);
}
function consequenceDrafts(
  state: AuthoritativeWorldState,
  rootActionId: string,
  resolutionId: string,
  plan: CompoundResolutionPlan,
  succeeded: boolean,
): Draft[] | undefined {
  const effects = succeeded ? plan.successEffects : plan.failureEffects;
  const drafts: Draft[] = [];
  let movement: CompoundActionEffect & { kind: "moveEntity" } | undefined;
  let explicitTime: CompoundActionEffect & { kind: "advanceFictionTime" } | undefined;
  for (const effect of effects) {
    switch (effect.kind) {
      case "acquireEvidence":
      case "acquireKnowledge": {
        const knowledgeRef = effect.kind === "acquireEvidence" ? effect.evidenceRef : effect.knowledgeRef;
        const content = effect.kind === "acquireEvidence" ? effect.evidence : effect.value;
        drafts.push({
          eventType: "KnowledgeAcquired",
          payload: {
            characterId: plan.actorCharacterId,
            knowledgeRef,
            objectKind: effect.kind === "acquireEvidence" ? "sensoryEvidence" : "canonicalFact",
            layer: "full",
            content,
            causeFactId: effect.definitionRef,
            acquisition: {
              sense: effect.kind === "acquireEvidence" ? "inspection" : "understanding",
              sceneId: plan.sourceSceneId,
              method: plan.method,
            },
            visibility: "private",
          },
          resolutionId,
          visibilityPolicyId: `visibility:knowledge-holder:${plan.actorCharacterId}`,
          secrecy: "private",
        });
        break;
      }
      case "changeResource":
        drafts.push({
          eventType: "ResourceUsed",
          payload: {
            characterId: effect.targetRef,
            resourceId: effect.resourceRef,
            amount: Math.abs(effect.amount),
            purpose: plan.goal,
          },
          resolutionId,
          visibilityPolicyId: `visibility:character-controller:${effect.targetRef}`,
          secrecy: "private",
        });
        break;
      case "changeHitPoints": {
        const target = state.entities[effect.targetRef];
        const hitPoints = target?.hitPoints;
        if (hitPoints === undefined) return undefined;
        const after = Math.max(0, Math.min(hitPoints.maximum, hitPoints.current + effect.amount));
        if (after === hitPoints.current) return undefined;
        drafts.push({
          eventType: "HitPointsChanged",
          payload: {
            characterId: effect.targetRef,
            before: hitPoints.current,
            after,
            maximum: hitPoints.maximum,
            causeId: plan.primaryFactRef,
          },
          resolutionId,
          visibilityPolicyId: "visibility:scene-observers",
        });
        if (hitPoints.current > 0 && after === 0) {
          drafts.push({
            eventType: "CreatureDied",
            payload: {
              characterId: effect.targetRef,
              causeId: plan.primaryFactRef,
            },
            resolutionId,
            visibilityPolicyId: "visibility:scene-observers",
          });
        }
        break;
      }
      case "alertNpc": {
        const knowledgeRef = `knowledge:alert:${rootActionId}`;
        drafts.push({
          eventType: "KnowledgeAcquired",
          payload: {
            characterId: effect.npcId,
            knowledgeRef,
            objectKind: "sensoryEvidence",
            layer: "partial",
            content: { observedRootActionId: rootActionId, status: effect.status },
            causeFactId: plan.primaryFactRef,
            acquisition: {
              sense: "situationalAwareness",
              sceneId: plan.sourceSceneId,
              method: "observeCommittedOutcome",
            },
            visibility: "private",
          },
          resolutionId,
          visibilityPolicyId: `visibility:knowledge-holder:${effect.npcId}`,
          secrecy: "private",
        });
        break;
      }
      case "moveEntity":
        if (movement !== undefined) return undefined;
        movement = effect;
        break;
      case "advanceFictionTime":
        if (explicitTime !== undefined) return undefined;
        explicitTime = effect;
        break;
      case "updateRelationship":
        drafts.push({
          eventType: "RelationshipChanged",
          payload: {
            relationshipId: effect.relationshipRef,
            subjectIds: effect.subjectRefs,
            change: effect.change,
            basisFactIds: effect.basisFactIds,
          },
          resolutionId,
          visibilityPolicyId: "visibility:relationship-participants",
          secrecy: "private",
        });
        break;
      case "recordCommitment":
        drafts.push({
          eventType: "PromiseMade",
          payload: {
            promiseId: effect.commitmentRef,
            promisorId: effect.promisorRef,
            promiseeId: effect.promiseeRef,
            content: effect.content,
            condition: effect.condition,
          },
          resolutionId,
          visibilityPolicyId: "visibility:promise-participants",
          secrecy: "private",
        });
        break;
      case "recordDebt":
        drafts.push({
          eventType: "DebtIncurred",
          payload: {
            debtId: effect.debtRef,
            debtorId: effect.debtorRef,
            creditorId: effect.creditorRef,
            obligation: effect.obligation,
            condition: effect.condition,
            basisFactIds: effect.basisFactIds,
          },
          resolutionId,
          visibilityPolicyId: "visibility:debt-participants",
          secrecy: "private",
        });
        break;
    }
  }
  if (movement !== undefined && explicitTime !== undefined) return undefined;
  if (movement !== undefined) {
    const planForMove = movementPlan(state, [movement.entityRef], movement.sceneRef, plan.durationMicros);
    if (planForMove === undefined) return undefined;
    if (BigInt(plan.durationMicros) >= 3_600_000_000n) {
      const interruptedLongRests = Object.values(state.campaignRuntime.activities)
        .filter((activity) => activity.status === "active"
          && activity.characterId === movement.entityRef
          && activity.restKind === "long")
        .sort((left, right) => String(left.activityId).localeCompare(String(right.activityId)));
      for (const activity of interruptedLongRests) {
        drafts.push({
          eventType: "ActivityInterrupted",
          payload: {
            activityId: activity.activityId,
            cause: {
              kind: "longRestStrenuousTravel2014",
              durationMicros: plan.durationMicros,
              destinationSceneId: movement.sceneRef,
            },
          },
          resolutionId,
          visibilityPolicyId: "visibility:scene-observers",
          reads: [`activity:${activity.activityId}`],
          writes: [`activity:${activity.activityId}`],
        });
      }
    }
    drafts.push({
      eventType: "CharacterMoved",
      payload: {
        characterId: movement.entityRef,
        destinationSceneId: movement.sceneRef,
        ...planForMove,
      },
      resolutionId,
      visibilityPolicyId: "visibility:scene-observers",
      reads: [`entity:${movement.entityRef}`, `timeline:${planForMove.sourceTimelineId}`],
      writes: [`entity:${movement.entityRef}`, `timeline:${planForMove.destinationTimelineId}`],
    });
  } else {
    drafts.push({
      eventType: "FictionTimeAdvanced",
      payload: {
        durationMicros: explicitTime?.durationMicros ?? plan.durationMicros,
        reason: plan.goal,
      },
      resolutionId,
      visibilityPolicyId: "visibility:scene-observers",
    });
  }
  if (!succeeded) {
    drafts.push({
      eventType: "MeaningfulFailureCommitted",
      payload: {
        characterId: plan.actorCharacterId,
        goalId: `goal:${rootActionId}`,
        methodFingerprint: plan.method,
        factualCause: `resolution:${resolutionId}:failed`,
        consequences: {
          effectKinds: effects.map(({ kind }) => kind),
        },
      },
      resolutionId,
      visibilityPolicyId: "visibility:scene-observers",
    });
  }
  return drafts;
}

export function fulfillActorPlanRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  rolls: number[],
): StepResult | undefined {
  const stored = state.internalContinuations[continuationId];
  if (stored?.resolutionPlan === undefined) return undefined;
  if (!isCompoundResolutionPlan(stored.resolutionPlan)) {
    return undefined;
  }
  if (!stored.rootActionId.startsWith("actor-plan-due:")) {
    return rejected("invalidWorldState", "Only a current due ActorPlan may carry this resolution plan.");
  }
  if (
    stored.request.purpose === "restHitDice"
    || stored.request.purpose === "hiddenRealitySelection"
  ) {
    return rejected("invalidWorldState", "A due ActorPlan must resume a frozen d20 check.");
  }
  const expectedRollCount = stored.request.frozenCheck.mode === "normal" ? 1 : 2;
  if (rolls.length !== expectedRollCount) {
    return rejected("invalidRulesInput", "The authoritative roll count does not match the frozen request.");
  }
  const selectedRoll = stored.request.frozenCheck.mode === "advantage"
    ? Math.max(...rolls)
    : stored.request.frozenCheck.mode === "disadvantage"
      ? Math.min(...rolls)
      : rolls[0];
  const total = selectedRoll + Number(stored.request.frozenCheck.modifier);
  const succeeded = total >= Number(stored.request.frozenCheck.dc);
  const consequences = consequenceDrafts(
    state,
    stored.rootActionId,
    stored.request.resolutionId,
    stored.resolutionPlan,
    succeeded,
  );
  if (consequences === undefined) {
    return rejected("invalidRulesInput", "Frozen ActorPlan consequences no longer form one legal transition.");
  }
  const drafts: Draft[] = [
    {
      eventType: "DiceRolled",
      payload: {
        randomnessId: stored.request.randomnessId,
        resolutionId: stored.request.resolutionId,
        formula: stored.request.diceExpression,
        faces: [...rolls],
        selectedFace: selectedRoll,
        requestHash: canonicalSha256(stored.request),
        frozenParametersHash: canonicalSha256(stored.resolutionPlan),
      },
      resolutionId: stored.request.resolutionId,
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: [`continuation:${continuationId}`],
    },
    {
      eventType: "ImprovisedCheckResolved",
      payload: {
        request: structuredClone(stored.request),
        rolls: [...rolls],
        selectedRoll,
        total,
        succeeded,
        outcome: succeeded
          ? stored.request.frozenCheck.successOutcome
          : stored.request.frozenCheck.failureOutcome,
      },
      resolutionId: stored.request.resolutionId,
      visibilityPolicyId: `visibility:character-controller:${stored.request.actorCharacterId}`,
      secrecy: "private",
      writes: [`continuation:${continuationId}`, `receipt:${stored.rootActionId}`],
    },
    ...consequences,
  ];
  return result("committed", profiles, state, stored.rootActionId, drafts);
}
