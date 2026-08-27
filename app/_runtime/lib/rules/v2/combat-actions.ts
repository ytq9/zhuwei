import { canonicalSha256 } from "../profiles/canonical";
import { compileAbilityDefinition } from "../profiles/ability-compiler";
import type { RuntimeProfileManifest } from "../profiles/types";
import {
  COMBAT_ROUND_MICROS,
  combatMomentOffsetMicros,
  encounterEntryLimitDiagnostic,
} from "../profiles/fiction-time";
import { freezeTriggerBatch, orderTriggerEntityIds } from "../profiles/trigger-ordering";
import {
  analyzeCombatMovement,
  canonicalAreaShape,
  canonicalCombatDirection,
  canonicalCombatPoint,
  canonicalizeCombatPath,
  coverLevel,
  entitiesAffectedByArea,
  entitiesWithinRange,
  entityCanTargetTacticalFeature,
  entityOccupanciesOverlap,
  entityWithinPointRange,
  freezeAreaOrigin,
  pathLengthMilliInches,
} from "../profiles/combat-geometry";
import {
  combatAttackBonus,
  resolveCombatAttackRoll,
} from "../profiles/attack-resolution";
import { createEventTransition, createScopeProof } from "./events";
import type {
  AuthoritativeWorldState,
  CombatRandomnessRequest,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  PublicReceipt,
  ScopeProof,
  StepResult,
} from "./model";
import { rejected } from "./results";
import { hasExactKeys, hasOnlyKeys, isNonEmptyString, isRecord } from "./validation";
import { resolveCombatDamage } from "./damage";
import { continueCompoundRoot, isContinuedCompoundRoot } from "./internal-compound";
import { characterTimelineId, sceneTimelineId } from "./timeline";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import {
  controlledEnvironmentPlayer,
  publicDamageableFeature,
} from "./environment";

type Draft = {
  eventType: EventType;
  payload: EventPayloadByType[EventType];
  resolutionId?: string;
  visibilityPolicyId?: string;
  secrecy?: EventEnvelope["secrecy"];
};

type DiceSpec = {
  purposeKey: string;
  dice: Array<{ count: string; sides: string }>;
  frozenParameters: JsonRecord;
};

function sequence(
  kind: "committed" | "awaitingInput" | "awaitingRandomness",
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
      ["combat:authoritative-state"],
      [`combat:authoritative-state`, `receipt:${rootActionId}`],
      [],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      ...(draft.resolutionId === undefined ? {} : { resolutionId: draft.resolutionId }),
      eventType: draft.eventType,
      payload: draft.payload,
      scopeProof,
      visibilityPolicyId: draft.visibilityPolicyId ?? "visibility:combat-observers",
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

function rootAction(state: AuthoritativeWorldState, input: JsonRecord): string | undefined {
  const value = input.rootActionId;
  return isNonEmptyString(value)
    && (!(value in state.receipts) || isContinuedCompoundRoot(input, value))
    ? value
    : undefined;
}

function combatEntity(state: AuthoritativeWorldState, id: unknown): JsonRecord | undefined {
  return isNonEmptyString(id) ? state.combatRuntime.entities[id] : undefined;
}

function abilityModifier(entity: JsonRecord, ability: string): number {
  const stats = entity.stats;
  if (!isRecord(stats)) return 0;
  const score = Number(stats[ability]);
  return Number.isInteger(score) ? Math.floor((score - 10) / 2) : 0;
}

function randomRequest(resolutionId: string, index: number, spec: DiceSpec): CombatRandomnessRequest {
  const core = {
    randomnessId: `randomness:${resolutionId}:${index + 1}`,
    resolutionId,
    purposeKey: spec.purposeKey,
    diceExpression: spec.dice.map((term) => `${term.count}d${term.sides}`).join("+"),
    dice: structuredClone(spec.dice),
    frozenParameters: structuredClone(spec.frozenParameters),
  };
  return { ...core, requestHash: canonicalSha256(core) };
}

function awaitRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  operation: JsonRecord,
  specs: DiceSpec[],
  prefix: Draft[] = [],
): StepResult {
  const phaseHash = canonicalSha256({ operation, specs }).slice("sha256:".length, "sha256:".length + 24);
  const resolutionId = `resolution:${rootActionId}:${phaseHash}`;
  const requests = specs.map((spec, index) => randomRequest(resolutionId, index, spec));
  const continuationCapability = `continuation:${canonicalSha256({
    roomId: state.roomId,
    runtimeEpochId: state.runtimeEpochId,
    rootActionId,
    resolutionId,
    requests,
  }).slice("sha256:".length)}`;
  const resolution = {
    resolutionId,
    rootActionId,
    continuationCapability,
    randomnessRequests: requests,
    operation: structuredClone(operation),
  };
  return sequence("awaitingRandomness", profiles, state, rootActionId, [
    ...prefix,
    {
      eventType: "RandomnessRequested",
      payload: { resolution },
      resolutionId,
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
    },
  ], {
    resolutionId,
    continuationCapability,
    randomnessRequests: requests,
  });
}

function isStartEncounter(input: JsonRecord): boolean {
  return hasOnlyKeys(input, [
    "battlefieldFactIds",
    "dynamicEntities",
    "encounterId",
    "hostilities",
    "initiativeGroups",
    "kind",
    "participantEntityIds",
    "proposalAttemptId",
    "rootActionId",
    "sceneId",
  ], ["surprisedEntityIds"])
    && input.kind === "startEncounter"
    && [input.rootActionId, input.proposalAttemptId, input.encounterId, input.sceneId].every(isNonEmptyString)
    && Array.isArray(input.participantEntityIds)
    && Array.isArray(input.dynamicEntities)
    && Array.isArray(input.initiativeGroups)
    && Array.isArray(input.hostilities)
    && Array.isArray(input.battlefieldFactIds)
    && (input.surprisedEntityIds === undefined || Array.isArray(input.surprisedEntityIds));
}

const CREATURE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
] as const;

function canonicalIntegerString(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "string"
    && /^-?(0|[1-9][0-9]*)$/.test(value)
    && Number.isSafeInteger(Number(value))
    && Number(value) >= minimum
    && Number(value) <= maximum;
}

function canonicalPoint(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["elevation", "x", "y"])
    && [value.x, value.y, value.elevation]
      .every((entry) => canonicalIntegerString(entry, -1_000_000, 1_000_000));
}

function canonicalFormula(value: unknown): boolean {
  const parsed = parseFormula(value);
  return parsed !== undefined
    && parsed.count <= 100
    && parsed.sides <= 100
    && Math.abs(parsed.modifier) <= 1_000;
}

function canonicalActivation(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return false;
  switch (value.kind) {
    case "attack":
      return hasExactKeys(value, ["actionGrant", "kind"]) && value.actionGrant === "attack";
    case "action":
    case "bonusAction":
    case "reaction":
      return hasExactKeys(value, ["kind"]);
    case "actionSpell":
      return hasOnlyKeys(value, ["kind", "spellLevel"], ["castingTimeMicros", "ritual"])
        && canonicalIntegerString(value.spellLevel, 0, 9)
        && (value.castingTimeMicros === undefined
          || canonicalIntegerString(value.castingTimeMicros, 1, Number.MAX_SAFE_INTEGER))
        && (value.ritual === undefined || typeof value.ritual === "boolean");
    case "bonusActionSpell":
    case "reactionSpell":
      return hasExactKeys(value, ["kind", "spellLevel"])
        && canonicalIntegerString(value.spellLevel, 0, 9);
    case "free":
      return hasOnlyKeys(value, ["kind"], ["timing"])
        && (value.timing === undefined || value.timing === "ownTurn");
    case "useObject":
      return hasExactKeys(value, ["actionGrant", "kind"])
        && value.actionGrant === "normalAction";
    default:
      return false;
  }
}

function canonicalTarget(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return false;
  if (value.kind === "creature" || value.kind === "creatureOrEnvironmentFeature") {
    if (!hasOnlyKeys(value, ["count", "kind"], [
      "rangeInches",
      "rangeLongInches",
      "rangeNormalInches",
      "reachInches",
      "requiresSight",
      "selfOnly",
    ]) || !canonicalIntegerString(value.count, 1, 100)) return false;
    const distances = ["rangeInches", "rangeLongInches", "rangeNormalInches", "reachInches"]
      .filter((key) => value[key] !== undefined);
    if (distances.length === 0
      || distances.some((key) => !canonicalIntegerString(value[key], 0, 1_000_000))
      || !(value.requiresSight === undefined || typeof value.requiresSight === "boolean")
      || !(value.selfOnly === undefined || typeof value.selfOnly === "boolean")) return false;
    if (value.rangeNormalInches !== undefined && value.rangeLongInches !== undefined
      && Number(value.rangeLongInches) < Number(value.rangeNormalInches)) return false;
    return true;
  }
  if (value.kind === "area") {
    if (!hasOnlyKeys(value, ["kind", "shape"], ["rangeInches"])
      || canonicalAreaShape(value.shape) === undefined) return false;
    return value.rangeInches === undefined
      || canonicalIntegerString(value.rangeInches, 0, 1_000_000);
  }
  return false;
}

function targetsCreature(definition: JsonRecord): boolean {
  return isRecord(definition.target)
    && (definition.target.kind === "creature"
      || definition.target.kind === "creatureOrEnvironmentFeature");
}

function canonicalCosts(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 24) return false;
  return value.every((cost) => {
    if (!isRecord(cost) || !isNonEmptyString(cost.kind)) return false;
    if (cost.kind === "spellSlot") {
      return hasExactKeys(cost, ["amount", "kind", "level"])
        && canonicalIntegerString(cost.level, 1, 9)
        && canonicalIntegerString(cost.amount, 1, 100);
    }
    return ["classResource", "item", "itemCharge"].includes(cost.kind)
      && hasExactKeys(cost, ["amount", "kind", "resourceId"])
      && isNonEmptyString(cost.resourceId)
      && canonicalIntegerString(cost.amount, 1, 100);
  });
}

function canonicalAbilityDefinition(value: unknown): value is JsonRecord {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["activation", "definitionId", "revision", "rulesBasis"], [
      "attack",
      "costs",
      "damage",
      "effect",
      "grants",
      "healing",
      "temporaryHitPoints",
      "mechanicalKey",
      "save",
      "sourceSpellId",
      "target",
    ])
    || !isNonEmptyString(value.definitionId)
    || !isNonEmptyString(value.revision)
    || value.rulesBasis !== "srd5.1-2014"
    || !canonicalActivation(value.activation)
    || !canonicalCosts(value.costs)
    || !(value.mechanicalKey === undefined || isNonEmptyString(value.mechanicalKey))
    || !(value.sourceSpellId === undefined || isNonEmptyString(value.sourceSpellId))) return false;

  if (value.target !== undefined && !canonicalTarget(value.target)) return false;
  const selfContainedReactionEffect = isRecord(value.effect)
    && ["shield", "counterspell"].includes(String(value.effect.kind));
  if ([value.attack, value.save, value.damage, value.healing, value.temporaryHitPoints, value.effect]
    .some((entry) => entry !== undefined) && value.target === undefined
    && !selfContainedReactionEffect) return false;
  if (value.attack !== undefined) {
    if (!isRecord(value.attack)) return false;
    const weaponAttack = hasExactKeys(value.attack, ["ability", "proficiency"])
      && (CREATURE_ABILITIES as readonly unknown[]).includes(value.attack.ability)
      && typeof value.attack.proficiency === "boolean";
    const spellAttack = hasExactKeys(value.attack, ["kind"])
      && value.attack.kind === "spellAttack";
    if (!weaponAttack && !spellAttack) return false;
  }
  if (value.save !== undefined) {
    if (!isRecord(value.save)
      || !hasOnlyKeys(value.save, ["ability", "halfOnSuccess"], ["dc", "onSuccess"])
      || !(CREATURE_ABILITIES as readonly unknown[]).includes(value.save.ability)
      || typeof value.save.halfOnSuccess !== "boolean"
      || !(value.save.dc === undefined || canonicalIntegerString(value.save.dc, 0, 30))
      || !(value.save.onSuccess === undefined || ["half", "none"].includes(String(value.save.onSuccess)))) {
      return false;
    }
  }
  if (value.damage !== undefined) {
    if (!Array.isArray(value.damage) || value.damage.length === 0 || value.damage.length > 24
      || !value.damage.every((component) => isRecord(component)
        && hasOnlyKeys(component, ["formula", "type"], ["sharedAcrossTargets"])
        && (DAMAGE_TYPES as readonly unknown[]).includes(component.type)
        && canonicalFormula(component.formula)
        && (component.sharedAcrossTargets === undefined
          || typeof component.sharedAcrossTargets === "boolean"))) return false;
  }
  if (value.healing !== undefined
    && (!isRecord(value.healing)
      || !hasExactKeys(value.healing, ["formula"])
      || !canonicalFormula(value.healing.formula))) return false;
  if (value.temporaryHitPoints !== undefined
    && (!isRecord(value.temporaryHitPoints)
      || !hasExactKeys(value.temporaryHitPoints, ["formula"])
      || !canonicalFormula(value.temporaryHitPoints.formula))) return false;
  if (value.effect !== undefined) {
    if (!isRecord(value.effect) || !isNonEmptyString(value.effect.kind)) return false;
    if (value.effect.kind === "concentration") {
      if (!hasExactKeys(value.effect, ["durationMicros", "kind"])
        || !(value.effect.durationMicros === null
          || canonicalIntegerString(value.effect.durationMicros, 1, Number.MAX_SAFE_INTEGER))) return false;
    } else if (value.effect.kind === "shield") {
      if (!hasExactKeys(value.effect, ["armorClassBonus", "duration", "kind", "magicMissileImmunity"])
        || value.effect.duration !== "untilOwnNextTurnStart"
        || value.effect.armorClassBonus !== "5"
        || value.effect.magicMissileImmunity !== true) return false;
    } else if (value.effect.kind === "counterspell") {
      if (!hasExactKeys(value.effect, ["kind", "rangeInches"])
        || value.effect.rangeInches !== "720") return false;
    } else {
      return false;
    }
  }
  if (value.grants !== undefined
    && (!Array.isArray(value.grants)
      || !value.grants.every((grant) => isRecord(grant)
        && hasExactKeys(grant, ["count", "kind"])
        && grant.kind === "normalAction"
        && canonicalIntegerString(grant.count, 1, 100)))) return false;

  return value.attack !== undefined
    || value.save !== undefined
    || value.damage !== undefined
    || value.healing !== undefined
    || value.temporaryHitPoints !== undefined
    || value.effect !== undefined
    || value.grants !== undefined;
}

function canonicalResourcePool(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((pool) => isRecord(pool)
    && hasExactKeys(pool, ["current", "maximum"])
    && canonicalIntegerString(pool.current, 0, 1_000_000)
    && canonicalIntegerString(pool.maximum, 0, 1_000_000)
    && Number(pool.current) <= Number(pool.maximum));
}

function canonicalDamageDefenses(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, [], ["immune", "resistant", "vulnerable"])) return false;
  const categories = ["immune", "resistant", "vulnerable"]
    .map((key) => value[key])
    .filter((entry) => entry !== undefined);
  return categories.every((entry) => Array.isArray(entry)
    && entry.length === new Set(entry).size
    && entry.every((type) => (DAMAGE_TYPES as readonly unknown[]).includes(type)));
}

function canonicalDynamicCombatant(value: unknown): value is JsonRecord {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "abilities",
      "armorClass",
      "deathPolicy",
      "entityId",
      "entityKind",
      "footprint",
      "hitPoints",
      "name",
      "position",
      "proficiencyBonus",
      "speedInches",
      "stats",
    ], ["attacksPerAttackAction", "damageDefenses", "resources", "sizeCategory", "spellcasting"])
    || !isNonEmptyString(value.entityId)
    || value.entityKind !== "npc"
    || !isNonEmptyString(value.name)
    || !canonicalPoint(value.position)
    || !isRecord(value.footprint)
    || !hasExactKeys(value.footprint, ["depth", "height", "width"])
    || ![value.footprint.depth, value.footprint.height, value.footprint.width]
      .every((entry) => canonicalIntegerString(entry, 1, 100_000))
    || !isRecord(value.stats)
    || !hasExactKeys(value.stats, CREATURE_ABILITIES)
    || !CREATURE_ABILITIES.every((ability) =>
      canonicalIntegerString((value.stats as JsonRecord)[ability], 1, 30))
    || !canonicalIntegerString(value.proficiencyBonus, 2, 9)
    || !canonicalIntegerString(value.armorClass, 1, 30)
    || !isRecord(value.hitPoints)
    || !hasExactKeys(value.hitPoints, ["current", "maximum", "temporary"])
    || !canonicalIntegerString(value.hitPoints.current, 0, 1_000_000)
    || !canonicalIntegerString(value.hitPoints.maximum, 1, 1_000_000)
    || !canonicalIntegerString(value.hitPoints.temporary, 0, 1_000_000)
    || Number(value.hitPoints.current) > Number(value.hitPoints.maximum)
    || !isRecord(value.speedInches)
    || Object.keys(value.speedInches).length === 0
    || !hasOnlyKeys(value.speedInches, [], ["burrow", "climb", "fly", "swim", "walk"])
    || !Object.values(value.speedInches).every((entry) => canonicalIntegerString(entry, 0, 1_000_000))
    || !["deadAtZero", "deathSaves", "defeatedAtZero"].includes(String(value.deathPolicy))
    || !(value.sizeCategory === undefined
      || ["tiny", "small", "medium", "large", "huge", "gargantuan"].includes(String(value.sizeCategory)))
    || !canonicalResourcePool(value.resources ?? {})
    || !canonicalDamageDefenses(value.damageDefenses)
    || !(value.attacksPerAttackAction === undefined
      || canonicalIntegerString(value.attacksPerAttackAction, 1, 100))
    || !Array.isArray(value.abilities)
    || value.abilities.length > 24
    || !value.abilities.every(canonicalAbilityDefinition)) return false;
  if (value.spellcasting !== undefined) {
    if (!isRecord(value.spellcasting)
      || !hasExactKeys(value.spellcasting, ["ability", "spellAttackBonus", "spellSaveDc"])
      || !(CREATURE_ABILITIES as readonly unknown[]).includes(value.spellcasting.ability)
      || !canonicalIntegerString(value.spellcasting.spellAttackBonus, -30, 30)
      || !canonicalIntegerString(value.spellcasting.spellSaveDc, 0, 30)) return false;
  }
  const abilityIds = value.abilities.map((ability) => String((ability as JsonRecord).definitionId));
  return abilityIds.length === new Set(abilityIds).size;
}

function startEncounter(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!isStartEncounter(input)) return rejected("invalidRulesInput", "Encounter proposal is not canonical.");
  const root = rootAction(state, input);
  if (root === undefined || String(input.encounterId) in state.combatRuntime.encounters) {
    return rejected("duplicateRootAction", "Encounter root action is missing or already committed.");
  }
  const sceneId = input.sceneId as string;
  if (!(sceneId in state.combatRuntime.scenes)) return rejected("privateOrUnknownReference", "Encounter scene is unavailable.");

  const drafts: Draft[] = [];
  const dynamicIds: string[] = [];
  const dynamicAbilityIds = new Set<string>();
  if ((input.dynamicEntities as unknown[]).length > 24) {
    return rejected("invalidRulesInput", "Encounter has too many dynamic combatants.");
  }
  for (const raw of input.dynamicEntities as unknown[]) {
    if (!canonicalDynamicCombatant(raw)) {
      return rejected("invalidRulesInput", "Dynamic combatant is malformed.");
    }
    const dynamicEntityId = raw.entityId as string;
    const dynamicEntityName = raw.name as string;
    const dynamicAbilities = raw.abilities as JsonRecord[];
    if (dynamicEntityId in state.combatRuntime.entities || dynamicIds.includes(dynamicEntityId)) {
      return rejected("duplicateRootAction", "Dynamic combatant already exists.");
    }
    const establishedEntity = state.entities[dynamicEntityId];
    if (establishedEntity !== undefined && (
      establishedEntity.kind !== "npc"
      || establishedEntity.tenureStatus !== "active"
      || establishedEntity.sceneId !== sceneId
      || establishedEntity.name !== dynamicEntityName
    )) {
      return rejected(
        "privateOrUnknownReference",
        "A combat materialization cannot overwrite an established NPC identity or location.",
      );
    }
    dynamicIds.push(dynamicEntityId);
    const abilityRefs: string[] = [];
    for (const ability of dynamicAbilities) {
      const definitionId = ability.definitionId as string;
      if (definitionId in state.combatRuntime.definitions
        || dynamicAbilityIds.has(definitionId)) {
        return rejected("invalidRulesInput", "Dynamic AbilityDefinition already exists or is duplicated.");
      }
      abilityRefs.push(definitionId);
      dynamicAbilityIds.add(definitionId);
      const compiled = compileAbilityDefinition(ability);
      if (!compiled.ok) {
        return rejected(compiled.code, compiled.publicMessage, compiled.diagnostics.map((diagnostic) => ({
          code: compiled.code,
          message: diagnostic.reason,
          path: diagnostic.path,
          source: "SPEC 0013",
          visibility: "public",
        })));
      }
      drafts.push({
        eventType: "DefinitionRegistered",
        payload: structuredClone(compiled.artifact),
        visibilityPolicyId: "visibility:room-authority-only",
        secrecy: "internal",
      });
    }
    const entityCore = Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== "abilities"),
    );
    drafts.push({
      eventType: "EntityMaterialized",
      payload: {
        entity: {
          ...structuredClone(entityCore),
          id: raw.entityId,
          kind: "npc",
          sceneId,
          abilityRefs,
          conditions: {},
          concentration: null,
          lifeState: "alive",
          deathSaves: { successes: 0, failures: 0 },
          movement: { spentMilliInches: "0" },
        },
      },
    });
  }

  const requestedParticipantIds = input.participantEntityIds as unknown[];
  if (!requestedParticipantIds.every(isNonEmptyString)
    || requestedParticipantIds.length !== new Set(requestedParticipantIds).size) {
    return rejected("invalidRulesInput", "Encounter participants are not canonical.");
  }
  const participantEntityIds = [...new Set([
    ...(requestedParticipantIds as string[]),
    ...dynamicIds,
  ])];
  if (participantEntityIds.length < 2 || participantEntityIds.some((entityId) => {
    const entity = state.combatRuntime.entities[entityId]
      ?? (input.dynamicEntities as JsonRecord[]).find((entry) => entry.entityId === entityId);
    return entity === undefined || (isNonEmptyString(entity.sceneId) && entity.sceneId !== sceneId);
  })) {
    return rejected("privateOrUnknownReference", "Encounter participant is unavailable in this scene.");
  }
  const surprisedEntityIds = input.surprisedEntityIds ?? [];
  if (!Array.isArray(surprisedEntityIds)
    || !surprisedEntityIds.every(isNonEmptyString)
    || surprisedEntityIds.length !== new Set(surprisedEntityIds).size
    || surprisedEntityIds.some((id) => !participantEntityIds.includes(id))) {
    return rejected("invalidRulesInput", "Surprise must be frozen independently for canonical participants.");
  }

  const rawGroups = input.initiativeGroups as unknown[];
  const groupEntryIds = new Set<string>();
  const groupedEntityIds: string[] = [];
  const groupLimitDiagnostic = encounterEntryLimitDiagnostic(rawGroups.length);
  if (rawGroups.length === 0) {
    return rejected("invalidRulesInput", "Initiative groups are not canonical.");
  }
  if (groupLimitDiagnostic !== undefined) {
    return rejected("invalidRulesInput", groupLimitDiagnostic);
  }
  for (const rawGroup of rawGroups) {
    if (!isRecord(rawGroup)
      || !hasExactKeys(rawGroup, ["combatantEntityIds", "entryId"])
      || !isNonEmptyString(rawGroup.entryId)
      || groupEntryIds.has(rawGroup.entryId)
      || !Array.isArray(rawGroup.combatantEntityIds)
      || rawGroup.combatantEntityIds.length === 0
      || !rawGroup.combatantEntityIds.every(isNonEmptyString)
      || rawGroup.combatantEntityIds.length !== new Set(rawGroup.combatantEntityIds).size) {
      return rejected("invalidRulesInput", "Initiative group is malformed.");
    }
    groupEntryIds.add(rawGroup.entryId);
    groupedEntityIds.push(...rawGroup.combatantEntityIds);
  }
  if (groupedEntityIds.length !== participantEntityIds.length
    || groupedEntityIds.length !== new Set(groupedEntityIds).size
    || participantEntityIds.some((entityId) => !groupedEntityIds.includes(entityId))) {
    return rejected("invalidRulesInput", "Every encounter participant must have exactly one initiative group.");
  }

  const rawHostilities = input.hostilities as unknown[];
  if (rawHostilities.length === 0 || rawHostilities.length > 100
    || rawHostilities.some((hostility) => {
      if (!isRecord(hostility)
        || !hasExactKeys(hostility, ["fromEntityIds", "toEntityIds"])
        || !Array.isArray(hostility.fromEntityIds)
        || !Array.isArray(hostility.toEntityIds)) return true;
      const from = hostility.fromEntityIds;
      const to = hostility.toEntityIds;
      return from.length === 0
        || to.length === 0
        || !from.every(isNonEmptyString)
        || !to.every(isNonEmptyString)
        || from.length !== new Set(from).size
        || to.length !== new Set(to).size
        || [...from, ...to].some((entityId) => !participantEntityIds.includes(entityId))
        || from.some((entityId) => to.includes(entityId));
    })) {
    return rejected("invalidRulesInput", "Encounter hostilities are not canonical.");
  }
  const battlefieldFactIds = input.battlefieldFactIds as unknown[];
  if (battlefieldFactIds.length > 100
    || !battlefieldFactIds.every(isNonEmptyString)
    || battlefieldFactIds.length !== new Set(battlefieldFactIds).size) {
    return rejected("invalidRulesInput", "Encounter battlefield facts are not canonical.");
  }

  const groups: JsonRecord[] = [];
  const specs: DiceSpec[] = [];
  for (const group of input.initiativeGroups as unknown[]) {
    if (!isRecord(group) || !isNonEmptyString(group.entryId)
      || !Array.isArray(group.combatantEntityIds) || group.combatantEntityIds.length === 0
      || !group.combatantEntityIds.every(isNonEmptyString)) {
      return rejected("invalidRulesInput", "Initiative group is malformed.");
    }
    const firstId = group.combatantEntityIds[0] as string;
    const rawDynamic = (input.dynamicEntities as JsonRecord[]).find((entry) => entry.entityId === firstId);
    const entity = state.combatRuntime.entities[firstId] ?? rawDynamic;
    if (entity === undefined) return rejected("privateOrUnknownReference", "Initiative combatant is unavailable.");
    const modifier = abilityModifier(entity, "dex");
    const purposeKey = group.combatantEntityIds.length === 1
      ? `initiative:${firstId}`
      : `initiative:group:${group.entryId}`;
    groups.push({
      entryId: group.entryId,
      combatantEntityIds: [...group.combatantEntityIds],
      modifier,
      purposeKey,
    });
    specs.push({
      purposeKey,
      dice: [{ count: "1", sides: "20" }],
      frozenParameters: {
        encounterId: input.encounterId,
        entryId: group.entryId,
        combatantEntityIds: [...group.combatantEntityIds],
        modifier,
      },
    });
  }
  drafts.push({
    eventType: "EncounterStarted",
    payload: {
      encounter: {
        encounterId: input.encounterId,
        sceneId,
        status: "starting",
        participantEntityIds,
        initiativeGroups: structuredClone(input.initiativeGroups),
        hostilities: structuredClone(input.hostilities),
        battlefieldFactIds: structuredClone(input.battlefieldFactIds),
        surprisedEntityIds: structuredClone(surprisedEntityIds),
        initiative: { entries: [], ordered: false },
        round: 0,
        turnCursor: -1,
        activeEntityId: null,
        roundClosed: true,
      },
    },
  });
  for (const group of groups) {
    drafts.push({
      eventType: "InitiativeRequested",
      payload: {
        encounterId: input.encounterId,
        entryId: group.entryId,
        combatantEntityIds: group.combatantEntityIds,
      },
    });
  }
  return awaitRandomness(profiles, state, root, {
    kind: "establishInitiative",
    encounterId: input.encounterId,
    groups,
  }, specs, drafts);
}

type AuthorityFaces = Map<string, number[]>;

type ParsedFormula = { count: number; sides: number; modifier: number };

function parseFormula(value: unknown): ParsedFormula | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(value);
  if (match === null) return undefined;
  const parsed = { count: Number(match[1]), sides: Number(match[2]), modifier: Number(match[3] ?? 0) };
  return parsed.count > 0 && parsed.sides > 1 ? parsed : undefined;
}

function formulaSpec(purposeKey: string, formula: string, frozenParameters: JsonRecord): DiceSpec {
  const parsed = parseFormula(formula);
  if (parsed === undefined) throw new TypeError("Ability formula is not canonical");
  return {
    purposeKey,
    dice: [{ count: String(parsed.count), sides: String(parsed.sides) }],
    frozenParameters: { ...structuredClone(frozenParameters), formula, modifier: parsed.modifier },
  };
}

function formulaTotal(faces: AuthorityFaces, purposeKey: string, formula: string): number {
  const parsed = parseFormula(formula);
  const rolled = faces.get(purposeKey);
  if (parsed === undefined || rolled === undefined || rolled.length !== parsed.count) {
    throw new TypeError("Authoritative formula faces are unavailable");
  }
  return rolled.reduce((sum, face) => sum + face, 0) + parsed.modifier;
}

function entityId(entity: JsonRecord): string {
  const id = isNonEmptyString(entity.id) ? entity.id : entity.entityId;
  if (!isNonEmptyString(id)) throw new TypeError("combat entity lacks id");
  return id;
}

function hostileCandidates(state: AuthoritativeWorldState, sourceId: string): string[] {
  const encounter = Object.values(state.combatRuntime.encounters).find((candidate) =>
    candidate.status !== "concluded"
    && Array.isArray(candidate.participantEntityIds)
    && candidate.participantEntityIds.includes(sourceId));
  if (encounter === undefined || !Array.isArray(encounter.hostilities)) return [];
  return [...new Set(encounter.hostilities.flatMap((relation) =>
    isRecord(relation)
      && Array.isArray(relation.fromEntityIds)
      && relation.fromEntityIds.includes(sourceId)
      && Array.isArray(relation.toEntityIds)
      ? relation.toEntityIds.filter(isNonEmptyString)
      : []))].sort();
}

function changeEncounterHostility(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "encounterId",
    "kind",
    "reason",
    "rootActionId",
    "sourceEntityId",
    "targetEntityIds",
  ])
    || ![input.encounterId, input.reason, input.rootActionId, input.sourceEntityId]
      .every(isNonEmptyString)
    || !Array.isArray(input.targetEntityIds)
    || !input.targetEntityIds.every(isNonEmptyString)
    || input.targetEntityIds.length !== new Set(input.targetEntityIds).size) {
    return rejected("invalidRulesInput", "Encounter hostility change is not canonical.");
  }
  const root = rootAction(state, input);
  const encounter = state.combatRuntime.encounters[String(input.encounterId)];
  const participants = Array.isArray(encounter?.participantEntityIds)
    ? encounter.participantEntityIds.filter(isNonEmptyString)
    : [];
  if (root === undefined || encounter === undefined || encounter.status === "concluded") {
    return rejected("privateOrUnknownReference", "Encounter is unavailable.");
  }
  if (!participants.includes(String(input.sourceEntityId))
    || input.targetEntityIds.some((targetEntityId) =>
      targetEntityId === input.sourceEntityId || !participants.includes(targetEntityId))) {
    return rejected("privateOrUnknownReference", "Hostility participants are unavailable.");
  }
  if (Object.keys(state.combatRuntime.pendingInputs).length > 0
    || Object.keys(state.combatRuntime.randomnessResolutions).length > 0) {
    return rejected("pendingInputUnresolved", "Hostility cannot change during an unresolved combat phase.");
  }
  const previousTargetEntityIds = hostileCandidates(state, String(input.sourceEntityId));
  const targetEntityIds = [...input.targetEntityIds].sort();
  if (previousTargetEntityIds.length === targetEntityIds.length
    && previousTargetEntityIds.every((targetEntityId, index) =>
      targetEntityId === targetEntityIds[index])) {
    return rejected("invalidRulesInput", "Encounter hostility already has the requested value.");
  }
  return sequence("committed", profiles, state, root, [{
    eventType: "HostilityChanged",
    payload: {
      encounterId: input.encounterId,
      sourceEntityId: input.sourceEntityId,
      previousTargetEntityIds,
      targetEntityIds,
      reason: input.reason,
    },
  }]);
}

function creatureRangeLimit(target: JsonRecord): number | undefined {
  for (const key of ["rangeLongInches", "rangeInches", "rangeNormalInches", "reachInches"] as const) {
    if (target[key] === undefined) continue;
    const value = Number(target[key]);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  return undefined;
}

function creatureTargetInRange(source: JsonRecord, target: JsonRecord, definition: JsonRecord): boolean {
  if (source.sceneId !== target.sceneId || target.lifeState === "dead" || !isRecord(definition.target)) {
    return false;
  }
  const limit = creatureRangeLimit(definition.target);
  return limit === undefined || entitiesWithinRange(source, target, String(limit));
}

function legalCreatureCandidates(
  state: AuthoritativeWorldState,
  source: JsonRecord,
  definition: JsonRecord,
): string[] {
  const sourceId = entityId(source);
  if (isRecord(definition.target) && definition.target.selfOnly === true) {
    return creatureTargetInRange(source, source, definition) ? [sourceId] : [];
  }
  const encounter = activeEncounter(state, sourceId);
  const healing = isRecord(definition.healing)
    || isRecord(definition.temporaryHitPoints)
    || definition.mechanicalKey === "stabilize";
  const candidateIds = encounter === undefined
    ? Object.keys(state.combatRuntime.entities)
    : healing
      ? [sourceId, ...(encounter.participantEntityIds as unknown[] ?? []).filter(isNonEmptyString)]
      : hostileCandidates(state, sourceId);
  return [...new Set(candidateIds)]
    .filter((candidateId) => {
      const target = state.combatRuntime.entities[candidateId];
      if (target === undefined || !creatureTargetInRange(source, target, definition)) return false;
      if (candidateId === sourceId) return true;
      return spatialRecordVisibleTo(state, target, sourceId)
        && targetCover(state, source, target) !== "full";
    });
}

function activeEncounter(state: AuthoritativeWorldState, sourceId: string): JsonRecord | undefined {
  return Object.values(state.combatRuntime.encounters).find((encounter) => encounter.status !== "concluded"
    && Array.isArray(encounter.participantEntityIds) && encounter.participantEntityIds.includes(sourceId));
}

function currentGroupAllows(encounter: JsonRecord, sourceId: string): boolean {
  return encounter.activeEntityId === sourceId;
}

function hasteActionAllows(definition: JsonRecord, abilityRef: string): boolean {
  const activation = definition.activation;
  if (!isRecord(activation)) return false;
  if (activation.kind === "attack") {
    return abilityRef !== "action:shove"
      && abilityRef !== "action:grapple"
      && isRecord(definition.attack);
  }
  return ["action:dash", "action:disengage", "action:hide", "action:use-object"].includes(abilityRef)
    || ["dash", "disengage", "hide", "use-object"].includes(String(definition.mechanicalKey));
}

function consumeTurnGrant(
  source: JsonRecord,
  definition: JsonRecord,
  abilityRef: string,
  preferredGrant?: unknown,
): JsonRecord | undefined {
  const patch = structuredClone(source);
  const turn = isRecord(patch.turn) ? patch.turn : {
    action: "1",
    bonusAction: "1",
    reaction: "1",
    attacksRemaining: "0",
    hasteAction: "0",
    bonusActionSpellCast: false,
    leveledActionSpell: false,
    leveledBonusActionSpell: false,
  };
  patch.turn = turn;
  const activation = definition.activation;
  if (!isRecord(activation)
    || !(preferredGrant === undefined || preferredGrant === "normal" || preferredGrant === "haste")) return undefined;
  if (abilityRef === "action:shove" || abilityRef === "action:grapple" || activation.kind === "attack") {
    const remaining = Number(turn.attacksRemaining ?? 0);
    const normalActions = Number(turn.action ?? 0);
    const hasteActions = Number(turn.hasteAction ?? 0);
    if (preferredGrant === "haste") {
      if (hasteActions <= 0 || !hasteActionAllows(definition, abilityRef)) return undefined;
      turn.hasteAction = String(hasteActions - 1);
    } else if (remaining > 0) {
      turn.attacksRemaining = String(remaining - 1);
    } else if (normalActions > 0) {
      turn.action = String(normalActions - 1);
      turn.attacksRemaining = String(Math.max(0, Number(source.attacksPerAttackAction ?? 1) - 1));
    } else if (hasteActions > 0 && hasteActionAllows(definition, abilityRef)) {
      turn.hasteAction = String(hasteActions - 1);
    } else return undefined;
  } else if (activation.kind === "action" || activation.kind === "actionSpell" || activation.kind === "useObject") {
    const normalActions = Number(turn.action ?? 0);
    const hasteActions = Number(turn.hasteAction ?? 0);
    if (preferredGrant !== "haste" && normalActions > 0) {
      turn.action = String(normalActions - 1);
    } else if (activation.kind !== "actionSpell"
      && hasteActions > 0
      && hasteActionAllows(definition, abilityRef)) {
      turn.hasteAction = String(hasteActions - 1);
    } else return undefined;
    if (activation.kind === "actionSpell" && Number(activation.spellLevel) > 0) {
      turn.leveledActionSpell = true;
    }
  } else if (activation.kind === "bonusActionSpell") {
    if (Number(turn.bonusAction ?? 0) <= 0) return undefined;
    turn.bonusAction = String(Number(turn.bonusAction) - 1);
    turn.bonusActionSpellCast = true;
    if (Number(activation.spellLevel) > 0) turn.leveledBonusActionSpell = true;
  } else if (activation.kind === "bonusAction") {
    if (Number(turn.bonusAction ?? 0) <= 0) return undefined;
    turn.bonusAction = String(Number(turn.bonusAction) - 1);
  } else if (activation.kind === "reaction" || activation.kind === "reactionSpell") {
    if (Number(turn.reaction ?? 0) <= 0) return undefined;
    turn.reaction = String(Number(turn.reaction) - 1);
  } else if (activation.kind === "free") {
    // An explicitly registered free activation consumes no turn grant.
  } else if (activation.kind === "nonCombatHazard" && source.kind === "environment") {
    // Environment hazards use their frozen trigger and never borrow a creature action.
  } else {
    return undefined;
  }
  return patch;
}

function spendCosts(sourcePatch: JsonRecord, definition: JsonRecord): Array<{ resourceId: string; amount: number; after: string }> | undefined {
  if (!Array.isArray(definition.costs)) return [];
  const resources = sourcePatch.resources;
  if (!isRecord(resources)) return undefined;
  const spent: Array<{ resourceId: string; amount: number; after: string }> = [];
  for (const cost of definition.costs) {
    if (!isRecord(cost)) return undefined;
    const resourceIdValue = cost.kind === "spellSlot" ? `spellSlot:${cost.level}` : cost.resourceId;
    const resourceId = isNonEmptyString(resourceIdValue) ? resourceIdValue : undefined;
    const amount = Number(cost.amount);
    if (resourceId === undefined) return undefined;
    const record = resources[resourceId];
    if (!isRecord(record) || !Number.isSafeInteger(amount) || amount <= 0 || Number(record.current) < amount) return undefined;
    record.current = String(Number(record.current) - amount);
    spent.push({ resourceId, amount, after: String(record.current) });
  }
  return spent;
}

function appendTransitions(prefix: StepResult, next: StepResult): StepResult {
  if (prefix.kind === "rejected" || prefix.kind === "initialized") return prefix;
  if (next.kind === "rejected" || next.kind === "initialized") {
    throw new TypeError("a committed combat continuation cannot be rejected or reinitialized");
  }
  const mechanicalResult = next.mechanicalResult ?? prefix.mechanicalResult;
  return {
    ...next,
    events: [...prefix.events, ...next.events],
    ...(mechanicalResult === undefined ? {} : { mechanicalResult }),
  };
}

function afterDrafts(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  drafts: Draft[],
  resume: (nextState: AuthoritativeWorldState) => StepResult,
): StepResult {
  if (drafts.length === 0) return resume(state);
  const prefix = sequence("committed", profiles, state, rootActionId, drafts);
  if (prefix.kind !== "committed") throw new TypeError("combat prefix did not commit");
  return appendTransitions(prefix, resume(prefix.state));
}

function afterDraftsOptional(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  drafts: Draft[],
  resume: (nextState: AuthoritativeWorldState) => StepResult | undefined,
): StepResult {
  const prefix = sequence("committed", profiles, state, rootActionId, drafts);
  if (prefix.kind !== "committed") throw new TypeError("combat prefix did not commit");
  const next = resume(prefix.state);
  return next === undefined ? prefix : appendTransitions(prefix, next);
}

function activationKind(definition: JsonRecord): string | undefined {
  return isRecord(definition.activation) && isNonEmptyString(definition.activation.kind)
    ? definition.activation.kind
    : undefined;
}

function isSpellDefinition(definition: JsonRecord): boolean {
  return ["actionSpell", "bonusActionSpell", "reactionSpell"].includes(String(activationKind(definition)));
}

function definitionSpellLevel(definition: JsonRecord): number {
  return isRecord(definition.activation) && canonicalIntegerString(definition.activation.spellLevel, 0, 9)
    ? Number(definition.activation.spellLevel)
    : 0;
}

function abilityRefs(entity: JsonRecord): string[] {
  return Array.isArray(entity.abilityRefs) ? entity.abilityRefs.filter(isNonEmptyString) : [];
}

function definitionHasMechanicalKey(definition: JsonRecord | undefined, key: string): boolean {
  return definition?.mechanicalKey === key
    || (key === "shield" && definition?.definitionId === "spell:shield")
    || (key === "counterspell" && String(definition?.definitionId).endsWith("counterspell"))
    || (key === "magic-missile" && String(definition?.definitionId).endsWith("magic-missile"));
}

function reactionSpellRefs(
  state: AuthoritativeWorldState,
  entity: JsonRecord,
  mechanicalKey: "shield" | "counterspell",
): string[] {
  return abilityRefs(entity).filter((abilityRef) => {
    const definition = state.combatRuntime.definitions[abilityRef];
    if (definition === undefined || activationKind(definition) !== "reactionSpell"
      || !definitionHasMechanicalKey(definition, mechanicalKey)) return false;
    const minimumLevel = definitionSpellLevel(definition);
    return isRecord(entity.resources) && Object.entries(entity.resources).some(([resourceId, pool]) => {
      const match = /^spellSlot:([1-9])$/.exec(resourceId);
      return match !== null && Number(match[1]) >= minimumLevel
        && isRecord(pool) && Number(pool.current) > 0;
    });
  }).sort();
}

function reactionAvailable(entity: JsonRecord): boolean {
  return entity.lifeState !== "dead" && !incapacitated(entity)
    && (!isRecord(entity.turn) || Number(entity.turn.reaction ?? 1) > 0);
}

function shieldEffects(state: AuthoritativeWorldState, targetId: string): JsonRecord[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect) => effect.kind === "shield" && effect.targetEntityId === targetId);
}

function effectiveArmorClass(state: AuthoritativeWorldState, target: JsonRecord): number {
  const base = Number(target.armorClass ?? 10);
  const shieldBonus = shieldEffects(state, entityId(target))
    .reduce((maximum, effect) => Math.max(maximum, Number(effect.armorClassBonus ?? 0)), 0);
  return base + shieldBonus;
}

function magicMissileImmune(state: AuthoritativeWorldState, targetId: string): boolean {
  return shieldEffects(state, targetId).some((effect) => effect.magicMissileImmunity === true);
}

function canSeeWithinCounterspellRange(
  state: AuthoritativeWorldState,
  reactor: JsonRecord,
  caster: JsonRecord,
): boolean {
  return reactor.sceneId === caster.sceneId
    && !condition(reactor, "blinded")
    && !condition(caster, "invisible")
    && entitiesWithinRange(reactor, caster, "720")
    && targetCover(state, reactor, caster) !== "full";
}

function triggerOrder(
  state: AuthoritativeWorldState,
  causationEntityId: string,
  candidateIds: string[],
): string[] {
  const encounter = activeEncounter(state, causationEntityId);
  const order = Array.isArray(encounter?.turnOrderEntityIds)
    ? encounter.turnOrderEntityIds.filter(isNonEmptyString)
    : [];
  const orderingEntities = Object.fromEntries(
    Object.entries(state.combatRuntime.entities).map(([id, entity]) => [id, {
      entityId: id,
      entityOrdinal: isNonEmptyString(state.entities[id]?.entityOrdinal)
        ? state.entities[id].entityOrdinal
        : isNonEmptyString(entity.entityOrdinal) ? entity.entityOrdinal : "0",
      kind: isNonEmptyString(entity.kind) ? entity.kind : state.entities[id]?.kind,
    }]),
  );
  return orderTriggerEntityIds(
    causationEntityId,
    candidateIds,
    orderingEntities,
    order,
    isNonEmptyString(encounter?.activeEntityId)
      ? encounter.activeEntityId
      : causationEntityId,
  );
}

function counterspellCandidates(
  state: AuthoritativeWorldState,
  caster: JsonRecord,
): Array<{ controllerEntityId: string; abilityRefs: string[] }> {
  const candidates = Object.values(state.combatRuntime.entities).flatMap((entity) => {
    if (entityId(entity) === entityId(caster) || !reactionAvailable(entity)) return [];
    const refs = reactionSpellRefs(state, entity, "counterspell");
    return refs.length === 0 || !canSeeWithinCounterspellRange(state, entity, caster)
      ? []
      : [{ controllerEntityId: entityId(entity), abilityRefs: refs }];
  });
  const orderedIds = triggerOrder(state, entityId(caster), candidates.map(({ controllerEntityId }) => controllerEntityId));
  return [...candidates].sort((left, right) => {
    const leftEnvironment = state.combatRuntime.entities[left.controllerEntityId]?.kind === "environment";
    const rightEnvironment = state.combatRuntime.entities[right.controllerEntityId]?.kind === "environment";
    if (leftEnvironment && rightEnvironment) {
      return String(left.abilityRefs[0]).localeCompare(String(right.abilityRefs[0]))
        || left.controllerEntityId.localeCompare(right.controllerEntityId);
    }
    return orderedIds.indexOf(left.controllerEntityId) - orderedIds.indexOf(right.controllerEntityId);
  });
}

function spendReactionSpell(
  state: AuthoritativeWorldState,
  source: JsonRecord,
  abilityRef: string,
  slotLevelValue: unknown,
): { sourcePatch: JsonRecord; spent: { resourceId: string; amount: number; after: string }; definition: JsonRecord; slotLevel: number } | undefined {
  const definition = state.combatRuntime.definitions[abilityRef];
  const slotLevel = Number(slotLevelValue);
  if (definition === undefined || activationKind(definition) !== "reactionSpell"
    || !abilityRefs(source).includes(abilityRef)
    || !Number.isSafeInteger(slotLevel) || slotLevel < Math.max(1, definitionSpellLevel(definition)) || slotLevel > 9
    || !reactionAvailable(source)) return undefined;
  const sourcePatch = structuredClone(source);
  const turn = isRecord(sourcePatch.turn)
    ? sourcePatch.turn
    : { action: "1", bonusAction: "1", reaction: "1", attacksRemaining: "1", leveledBonusActionSpell: false };
  if (Number(turn.reaction ?? 0) <= 0 || !isRecord(sourcePatch.resources)) return undefined;
  const resourceId = `spellSlot:${slotLevel}`;
  const pool = sourcePatch.resources[resourceId];
  if (!isRecord(pool) || Number(pool.current) <= 0) return undefined;
  turn.reaction = "0";
  sourcePatch.turn = turn;
  pool.current = String(Number(pool.current) - 1);
  return {
    sourcePatch,
    spent: { resourceId, amount: 1, after: String(pool.current) },
    definition,
    slotLevel,
  };
}

type AttackMode = {
  mode: "normal" | "advantage" | "disadvantage";
  advantageReasons: string[];
  disadvantageReasons: string[];
};

function condition(entity: JsonRecord, id: string): boolean {
  return isRecord(entity.conditions) && entity.conditions[id] === true;
}

function incapacitated(entity: JsonRecord): boolean {
  return entity.lifeState === "dead"
    || ["incapacitated", "paralyzed", "stunned", "unconscious"]
      .some((id) => condition(entity, id));
}

function attackMode(
  state: AuthoritativeWorldState,
  source: JsonRecord,
  target: JsonRecord,
  definition: JsonRecord,
): AttackMode {
  const targetDefinition = isRecord(definition.target) ? definition.target : {};
  const ranged = ["rangeInches", "rangeNormalInches", "rangeLongInches"]
    .some((key) => targetDefinition[key] !== undefined);
  const meleeWithinFiveFeet = !ranged
    && canonicalIntegerString(targetDefinition.reachInches, 0, 1_000_000)
    && entitiesWithinRange(source, target, String(targetDefinition.reachInches));
  const advantageReasons: string[] = [];
  const disadvantageReasons: string[] = [];

  if (condition(target, "prone")) {
    (meleeWithinFiveFeet ? advantageReasons : disadvantageReasons).push("targetProne2014");
  }
  if (["blinded", "paralyzed", "restrained", "stunned", "unconscious", "squeezing"]
    .some((id) => condition(target, id))) advantageReasons.push("targetCondition2014");
  if (["blinded", "poisoned", "restrained", "squeezing"]
    .some((id) => condition(source, id))) disadvantageReasons.push("sourceCondition2014");
  if (condition(target, "invisible")) disadvantageReasons.push("targetUnseen2014");

  const normalRange = Number(targetDefinition.rangeNormalInches);
  const longRange = Number(targetDefinition.rangeLongInches);
  if (ranged && Number.isFinite(normalRange) && Number.isFinite(longRange)
    && !entitiesWithinRange(source, target, String(targetDefinition.rangeNormalInches))
    && entitiesWithinRange(source, target, String(targetDefinition.rangeLongInches))) {
    disadvantageReasons.push("longRange2014");
  }
  if (ranged && !condition(source, "invisible")) {
    const adjacentHostile = hostileCandidates(state, entityId(source)).some((hostileId) => {
      const hostile = state.combatRuntime.entities[hostileId];
      return hostile !== undefined
        && hostile.sceneId === source.sceneId
        && !incapacitated(hostile)
        && !condition(hostile, "blinded")
        && entitiesWithinRange(source, hostile, "60");
    });
    if (adjacentHostile) disadvantageReasons.push("hostileWithinFiveFeet2014");
  }

  const advantage = advantageReasons.length > 0;
  const disadvantage = disadvantageReasons.length > 0;
  return {
    mode: advantage === disadvantage ? "normal" : advantage ? "advantage" : "disadvantage",
    advantageReasons: [...new Set(advantageReasons)].sort(),
    disadvantageReasons: [...new Set(disadvantageReasons)].sort(),
  };
}

function attackBonus(source: JsonRecord, definition: JsonRecord): number {
  return combatAttackBonus(source, definition);
}

function targetCover(state: AuthoritativeWorldState, source: JsonRecord, target: JsonRecord) {
  if (!isRecord(source.position) || !isRecord(source.footprint)
    || !isRecord(target.position) || !isRecord(target.footprint)) return "none" as const;
  const scene = state.combatRuntime.scenes[String(source.sceneId)];
  return coverLevel(
    isRecord(scene) ? scene : undefined,
    source,
    target,
    Object.values(state.combatRuntime.entities),
  );
}

function attackDice(mode: "normal" | "advantage" | "disadvantage"): Array<{ count: string; sides: string }> {
  return [{ count: mode === "normal" ? "1" : "2", sides: "20" }];
}

function selectedD20(rolls: number[], mode: string): number {
  if (rolls.length === 0) throw new TypeError("d20 faces missing");
  return mode === "advantage" ? Math.max(...rolls) : mode === "disadvantage" ? Math.min(...rolls) : rolls[0];
}

function savingThrowMode(target: JsonRecord, ability: string): "normal" | "disadvantage" {
  return ability === "dex" && ["restrained", "squeezing"].some((id) => condition(target, id))
    ? "disadvantage"
    : "normal";
}

function purposeStem(abilityRef: string): string {
  return abilityRef.startsWith("ability:alice-") ? abilityRef.slice("ability:".length) : abilityRef;
}

function saveStem(abilityRef: string): string {
  if (abilityRef === "spell:shatter" || abilityRef.includes(":spell:shatter:")) return "shatter";
  if (abilityRef === "ability:ash-brute-cinder-burst") return "cinder-burst";
  return abilityRef;
}

function concentrationPurpose(abilityRef: string, definition: JsonRecord, targetId: string): string {
  return isRecord(definition.target) && definition.target.kind === "area"
    ? `save:concentration:area:${abilityRef}:${targetId}`
    : `save:concentration:${targetId}`;
}

function damageDice(definition: JsonRecord): Array<{ count: string; sides: string }> {
  if (!Array.isArray(definition.damage)) return [];
  return definition.damage.map((component) => {
    if (!isRecord(component)) throw new TypeError("damage component is malformed");
    const parsed = parseFormula(component.formula);
    if (parsed === undefined) throw new TypeError("damage formula is malformed");
    return { count: String(parsed.count), sides: String(parsed.sides) };
  });
}

function rolledDamageComponents(
  definition: JsonRecord,
  faces: AuthorityFaces,
  purposeKey: string,
): Array<{ type: string; rolled: number }> {
  if (!Array.isArray(definition.damage)) return [];
  const tape = [...(faces.get(purposeKey) ?? [])];
  return definition.damage.map((component) => {
    if (!isRecord(component) || !isNonEmptyString(component.type)) throw new TypeError("damage component is malformed");
    const parsed = parseFormula(component.formula);
    if (parsed === undefined || tape.length < parsed.count) throw new TypeError("damage faces are incomplete");
    const subtotal = tape.splice(0, parsed.count).reduce((sum, face) => sum + face, 0) + parsed.modifier;
    return { type: component.type, rolled: subtotal };
  });
}

function publicPending(pending: JsonRecord): JsonRecord {
  const result: JsonRecord = {
    pendingInputId: pending.pendingInputId,
    kind: pending.kind,
    choiceKind: pending.choiceKind,
  };
  for (const key of [
    "controllerEntityId",
    "controllerEntityIds",
    "orderedEntityIds",
    "candidateEntityIds",
    "candidateAbilityRefs",
    "reactionKind",
    "triggerKind",
    "targetEntityId",
    "triggerBatchId",
    "triggerBatchHash",
    "parentTriggerBatchId",
    "orderedTriggerInstanceIds",
  ]) {
    if (pending[key] !== undefined) result[key] = structuredClone(pending[key]);
  }
  return result;
}

function openTargetPending(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  root: string,
  source: JsonRecord,
  abilityRef: string,
  definition: JsonRecord,
  parameters: JsonRecord,
): StepResult {
  const sourceId = entityId(source);
  const pending = {
    pendingInputId: `pending:${root}:target`,
    rootActionId: root,
    kind: source.kind === "player" ? "playerChoice" : "kpDecision",
    choiceKind: "target",
    controllerEntityId: sourceId,
    candidateEntityIds: legalCreatureCandidates(state, source, definition),
    operation: { kind: "invokeAbility", sourceEntityId: sourceId, abilityRef, parameters },
  };
  return sequence("awaitingInput", profiles, state, root, [{
    eventType: "CombatPendingOpened",
    payload: { pending },
    secrecy: "private",
  }], { pending: publicPending(pending) });
}

function directAbility(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  root: string,
  source: JsonRecord,
  abilityRef: string,
  definition: JsonRecord,
): StepResult | undefined {
  const activation = definition.activation;
  if (!isRecord(activation)) return undefined;
  if (activation.kind !== "free") return undefined;
  const sourcePatch = consumeTurnGrant(source, definition, abilityRef);
  if (sourcePatch === undefined) return rejected("invalidRulesInput", "The action grant is unavailable.");
  const spent = spendCosts(sourcePatch, definition);
  if (spent === undefined) return rejected("insufficientResource", "Ability resource is unavailable.");
  const drafts: Draft[] = spent.map((cost) => ({
    eventType: "ResourceSpent",
    payload: { entityId: entityId(source), resourceId: cost.resourceId, amount: cost.amount, resourceAfter: cost.after },
  }));
  if (abilityRef === "ability:action-surge" || definition.mechanicalKey === "action-surge") {
    const turn = sourcePatch.turn as JsonRecord;
    turn.action = String(Number(turn.action ?? 0) + 1);
  }
  const mechanicalResult: JsonRecord = { abilityRef, activation: activation.kind };
  drafts.push({
    eventType: "AbilityInvoked",
    payload: { sourceEntityId: entityId(source), abilityRef, mechanicalResult, sourcePatch },
  });
  return sequence("committed", profiles, state, root, drafts, { mechanicalResult });
}

function areaTargets(
  state: AuthoritativeWorldState,
  sourceId: string,
  origin: JsonRecord,
  shape: JsonRecord,
  direction?: JsonRecord,
): string[] {
  const source = combatEntity(state, sourceId);
  const candidates = hostileCandidates(state, sourceId)
    .map((id) => state.combatRuntime.entities[id])
    .filter((entity): entity is JsonRecord => entity !== undefined);
  const scene = source === undefined ? undefined : state.combatRuntime.scenes[String(source.sceneId)];
  return entitiesAffectedByArea(
    candidates,
    isRecord(scene) ? scene : undefined,
    origin,
    shape,
    direction,
  );
}

function builtinSpecialMeleeDefinition(abilityRef: string): JsonRecord | undefined {
  if (abilityRef === "action:stabilize") {
    return {
      definitionId: abilityRef,
      revision: "1",
      rulesBasis: "srd5.1-2014",
      mechanicalKey: "stabilize",
      activation: { kind: "action" },
      target: { kind: "creature", count: "1", reachInches: "60" },
    };
  }
  if (abilityRef !== "action:shove" && abilityRef !== "action:grapple") return undefined;
  return {
    definitionId: abilityRef,
    revision: "1",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "attack", actionGrant: "attack" },
    target: { kind: "creature", count: "1", reachInches: "60" },
  };
}

function beginMedicineStabilization(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  source: JsonRecord,
  target: JsonRecord,
  definition: JsonRecord,
  sourcePatch: JsonRecord,
  spent: JsonRecord[],
): StepResult {
  if (target.lifeState === "dead"
    || target.deathPolicy !== "deathSaves"
    || !isRecord(target.hitPoints)
    || Number(target.hitPoints.current) !== 0
    || (isRecord(target.conditions) && target.conditions.stable === true)) {
    return rejected("invalidRulesInput", "Medicine can stabilize only an unstable creature at 0 hit points.");
  }
  const modifier = abilityModifier(source, "wis")
    + (Array.isArray(source.proficientSkills) && source.proficientSkills.includes("medicine")
      ? Number(source.proficiencyBonus ?? 0)
      : 0);
  const purposeKey = `check:medicine:${entityId(source)}`;
  return awaitRandomness(profiles, state, rootActionId, {
    kind: "resolveMedicineStabilization",
    sourceEntityId: entityId(source),
    targetEntityId: entityId(target),
    abilityRef: "action:stabilize",
    definition,
    sourcePatch,
    spent,
    purposeKey,
    dc: 10,
    modifier,
  }, [{
    purposeKey,
    dice: [{ count: "1", sides: "20" }],
    frozenParameters: {
      sourceEntityId: entityId(source),
      targetEntityId: entityId(target),
      ability: "wis",
      skill: "medicine",
      dc: 10,
      modifier,
    },
  }]);
}

function beginSpecialMeleeContest(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  root: string,
  source: JsonRecord,
  abilityRef: string,
  definition: JsonRecord,
  parameters: JsonRecord,
  sourcePatch: JsonRecord,
  spent: JsonRecord[],
  options: { prefix?: Draft[]; reactionContext?: JsonRecord } = {},
): StepResult {
  const target = combatEntity(state, parameters.targetEntityId);
  const defenderContestAbility = parameters.defenderContestAbility;
  if (target === undefined
    || (defenderContestAbility !== "athletics" && defenderContestAbility !== "acrobatics")) {
    return rejected("invalidRulesInput", "Special melee contest parameters are incomplete.");
  }
  const footprintRank = (entity: JsonRecord) => {
    if (!isRecord(entity.footprint)) return undefined;
    const largest = Math.max(Number(entity.footprint.width), Number(entity.footprint.depth));
    if (!Number.isFinite(largest) || largest <= 0) return undefined;
    if (largest <= 30) return 0;
    if (largest <= 60) return 1;
    if (largest <= 120) return 2;
    if (largest <= 180) return 3;
    return 4;
  };
  const sourceRank = footprintRank(source);
  const targetRank = footprintRank(target);
  if (sourceRank === undefined || targetRank === undefined || targetRank > sourceRank + 1) {
    return rejected("invalidRulesInput", "The target is too large for this 2014 special melee attack.");
  }
  const contestKind = abilityRef === "action:grapple" ? "grapple" : "shove";
  const defenderAbility = defenderContestAbility === "acrobatics" ? "dex" : "str";
  return awaitRandomness(profiles, state, root, {
    kind: "resolveCombatAbility",
    resolutionKind: contestKind,
    sourceEntityId: entityId(source),
    targetEntityIds: [entityId(target)],
    abilityRef,
    definition,
    sourcePatch,
    spent,
    ...(options.reactionContext === undefined
      ? {}
      : { reactionContext: structuredClone(options.reactionContext) }),
  }, [
    { purposeKey: `check:${contestKind}:${entityId(source)}`, dice: [{ count: "1", sides: "20" }], frozenParameters: { ability: "athletics", entityId: entityId(source), modifier: abilityModifier(source, "str") + Number(source.proficiencyBonus ?? 0), outcome: contestKind } },
    { purposeKey: `check:${contestKind}:${entityId(target)}`, dice: [{ count: "1", sides: "20" }], frozenParameters: { ability: defenderContestAbility, entityId: entityId(target), modifier: abilityModifier(target, defenderAbility) + Number(target.proficiencyBonus ?? 0), tieWinner: entityId(target) } },
  ], options.prefix ?? []);
}

const RITUAL_CASTING_EXTENSION_MICROS = 600_000_000n;

function isLongSpellcastingRequest(definition: JsonRecord, parameters: JsonRecord): boolean {
  const activation = definition.activation;
  if (!isRecord(activation) || activation.kind !== "actionSpell"
    || !canonicalIntegerString(activation.castingTimeMicros, 1, Number.MAX_SAFE_INTEGER)) {
    return false;
  }
  return BigInt(String(activation.castingTimeMicros)) > COMBAT_ROUND_MICROS
    || parameters.ritual === true;
}

function costsAvailableAtLongSpellStart(
  source: JsonRecord,
  definition: JsonRecord,
  ritual: boolean,
): boolean {
  const probe = structuredClone(source);
  const costs = Array.isArray(definition.costs)
    ? definition.costs.filter((cost) => !ritual || !isRecord(cost) || cost.kind !== "spellSlot")
    : [];
  return spendCosts(probe, { ...definition, costs }) !== undefined;
}

function startLongSpellcasting(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  root: string,
  source: JsonRecord,
  abilityRef: string,
  definition: JsonRecord,
  parameters: JsonRecord,
  encounter: JsonRecord | undefined,
): StepResult {
  const activation = definition.activation;
  if (!isRecord(activation)
    || activation.kind !== "actionSpell"
    || !canonicalIntegerString(activation.castingTimeMicros, 1, Number.MAX_SAFE_INTEGER)
    || !(parameters.ritual === undefined || typeof parameters.ritual === "boolean")) {
    return rejected("invalidRulesInput", "Long-spell casting parameters are not canonical.");
  }
  const ritual = parameters.ritual === true;
  if (ritual && activation.ritual !== true) {
    return rejected("invalidRulesInput", "This spell cannot be cast as a 2014 ritual.");
  }
  if (Object.values(state.campaignRuntime.activities).some((activity) =>
    activity.status === "active" && activity.characterId === entityId(source))) {
    return rejected("invalidRulesInput", "The caster already has an active Activity.");
  }
  if (!costsAvailableAtLongSpellStart(source, definition, ritual)) {
    return rejected("insufficientResource", "Long-spell completion costs are unavailable.");
  }
  const sourcePatch = consumeTurnGrant(source, definition, abilityRef);
  if (sourcePatch === undefined) {
    return rejected("invalidRulesInput", "The normal action grant is unavailable for long spellcasting.");
  }
  sourcePatch.concentration = null;
  const baseDurationMicros = BigInt(String(activation.castingTimeMicros));
  const intendedDurationMicros = baseDurationMicros
    + (ritual ? RITUAL_CASTING_EXTENSION_MICROS : 0n);
  const activityId = `activity:long-spell:${root}`;
  const requiredActionRounds = encounter === undefined
    ? 1
    : Number((intendedDurationMicros + COMBAT_ROUND_MICROS - 1n) / COMBAT_ROUND_MICROS);
  const targetEntityIds = isNonEmptyString(parameters.targetEntityId)
    ? [String(parameters.targetEntityId)]
    : [];
  const completion = {
    kind: "longSpellcasting",
    activityId,
    sourceEntityId: entityId(source),
    abilityRef,
    definition: structuredClone(definition),
    parameters: structuredClone(parameters),
    targetEntityIds,
    ritual,
    requiredActionRounds,
  };
  const concentration = {
    kind: "longSpellcasting",
    activityId,
    abilityRef,
    ritual,
    requiredActionRounds,
    investedActionRounds: 1,
    ...(encounter === undefined
      ? {}
      : {
          encounterId: encounter.encounterId,
          lastInvestedRound: Number(encounter.round),
        }),
  };
  const prefix: Draft[] = isRecord(source.concentration)
    ? [{
        eventType: "ConcentrationEnded",
        payload: { entityId: entityId(source), reason: "replacedByLongSpellcasting" },
      }]
    : [];
  const mechanicalResult = {
    kind: "longSpellcastingStarted",
    activityId,
    abilityRef,
    ritual,
    intendedDurationMicros: intendedDurationMicros.toString(),
    investedActionRounds: 1,
    requiredActionRounds,
  };
  return sequence("committed", profiles, state, root, [
    ...prefix,
    {
      eventType: "ActivityStarted",
      payload: {
        activityId,
        characterId: entityId(source),
        activityKind: "longSpellcasting",
        intendedDurationMicros: intendedDurationMicros.toString(),
        completion,
      },
    },
    {
      eventType: "AbilityInvoked",
      payload: { sourceEntityId: entityId(source), abilityRef, mechanicalResult, sourcePatch },
    },
    {
      eventType: "ConcentrationStarted",
      payload: { entityId: entityId(source), concentration },
    },
  ], { mechanicalResult });
}

function continueLongSpellcasting(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["activityId", "encounterId", "kind", "rootActionId", "sourceEntityId"])
    || ![input.activityId, input.encounterId, input.rootActionId, input.sourceEntityId]
      .every(isNonEmptyString)) {
    return rejected("invalidRulesInput", "Long-spell continuation input is not canonical.");
  }
  const root = rootAction(state, input);
  const encounter = state.combatRuntime.encounters[String(input.encounterId)];
  const source = combatEntity(state, input.sourceEntityId);
  const activity = state.campaignRuntime.activities[String(input.activityId)];
  const concentration = source?.concentration;
  if (root === undefined
    || encounter === undefined
    || source === undefined
    || activity?.status !== "active"
    || activity.activityKind !== "longSpellcasting"
    || !currentGroupAllows(encounter, entityId(source))
    || !isRecord(concentration)
    || concentration.kind !== "longSpellcasting"
    || concentration.activityId !== input.activityId
    || concentration.encounterId !== input.encounterId
    || concentration.lastInvestedRound === encounter.round) {
    return rejected("privateOrUnknownReference", "Long-spell continuation is unavailable for this turn.");
  }
  const completion = activity.completion;
  const definition = isRecord(completion) && isRecord(completion.definition)
    ? completion.definition
    : undefined;
  if (definition === undefined) {
    return rejected("invalidWorldState", "Frozen long-spell definition is unavailable.");
  }
  const sourcePatch = consumeTurnGrant(source, definition, String(concentration.abilityRef));
  if (sourcePatch === undefined || !isRecord(sourcePatch.concentration)) {
    return rejected("invalidRulesInput", "The normal action grant is unavailable for long spellcasting.");
  }
  sourcePatch.concentration.investedActionRounds = Number(concentration.investedActionRounds) + 1;
  sourcePatch.concentration.lastInvestedRound = Number(encounter.round);
  const mechanicalResult = {
    kind: "longSpellcastingContinued",
    activityId: input.activityId,
    abilityRef: concentration.abilityRef,
    investedActionRounds: sourcePatch.concentration.investedActionRounds,
    requiredActionRounds: concentration.requiredActionRounds,
  };
  return sequence("committed", profiles, state, root, [{
    eventType: "AbilityInvoked",
    payload: {
      sourceEntityId: entityId(source),
      abilityRef: concentration.abilityRef,
      mechanicalResult,
      sourcePatch,
    },
  }], { mechanicalResult });
}

function invokeAbility(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["abilityRef", "kind", "parameters", "rootActionId", "sourceEntityId"])
    || ![input.rootActionId, input.sourceEntityId, input.abilityRef].every(isNonEmptyString)
    || !isRecord(input.parameters)) return rejected("invalidRulesInput", "Ability invocation is not canonical.");
  const root = rootAction(state, input);
  const source = combatEntity(state, input.sourceEntityId);
  if (root === undefined || source === undefined || source.lifeState === "dead") {
    return rejected("privateOrUnknownReference", "Ability source is unavailable.");
  }
  const abilityRef = input.abilityRef as string;
  const definition = builtinSpecialMeleeDefinition(abilityRef)
    ?? state.combatRuntime.definitions[abilityRef];
  if (definition === undefined || definition.rulesBasis !== "srd5.1-2014") {
    return rejected("privateOrUnknownReference", "AbilityDefinition is unavailable.");
  }
  if (activationKind(definition) === "reaction" || activationKind(definition) === "reactionSpell") {
    return rejected("invalidRulesInput", "A reaction ability can only be used from its frozen reaction window.");
  }
  const encounter = activeEncounter(state, entityId(source));
  if (encounter !== undefined && !currentGroupAllows(encounter, entityId(source))) {
    return rejected("invalidRulesInput", "Combatant does not hold the current initiative turn.");
  }
  if (targetsCreature(definition)
    && !isNonEmptyString(input.parameters.targetEntityId)) {
    return openTargetPending(profiles, state, root, source, abilityRef, definition, input.parameters);
  }
  if (targetsCreature(definition)) {
    const targetEntityId = String(input.parameters.targetEntityId);
    if (!legalCreatureCandidates(state, source, definition).includes(targetEntityId)) {
      return rejected("privateOrUnknownReference", "Ability target is unavailable.");
    }
  }
  if (isLongSpellcastingRequest(definition, input.parameters)) {
    return startLongSpellcasting(
      profiles,
      state,
      root,
      source,
      abilityRef,
      definition,
      input.parameters,
      encounter,
    );
  }
  const direct = directAbility(profiles, state, root, source, abilityRef, definition);
  if (direct !== undefined) return direct;

  const activation = definition.activation;
  if (!isRecord(activation)) return rejected("invalidRulesInput", "Ability activation is malformed.");
  if (activation.kind === "actionSpell" && Number(activation.spellLevel) > 0
    && isRecord(source.turn)
    && (source.turn.bonusActionSpellCast === true || source.turn.leveledBonusActionSpell === true)) {
    return rejected("bonusActionSpellRestriction2014", "A bonus-action leveled spell limits the same turn to cantrips with a casting time of one action.");
  }
  if (activation.kind === "bonusActionSpell"
    && isRecord(source.turn)
    && source.turn.leveledActionSpell === true) {
    return rejected("bonusActionSpellRestriction2014", "A bonus-action spell cannot follow a leveled spell cast with an action on the same turn.");
  }
  const sourcePatch = consumeTurnGrant(source, definition, abilityRef, input.parameters.actionGrant);
  if (sourcePatch === undefined) return rejected("invalidRulesInput", "The action grant is unavailable.");
  const spent = spendCosts(sourcePatch, definition);
  if (spent === undefined) return rejected("insufficientResource", "Ability resource is unavailable.");

  if (abilityRef === "action:shove" || abilityRef === "action:grapple") {
    return beginSpecialMeleeContest(
      profiles,
      state,
      root,
      source,
      abilityRef,
      definition,
      input.parameters,
      sourcePatch,
      spent,
    );
  }
  if (abilityRef === "action:stabilize") {
    const target = combatEntity(state, input.parameters.targetEntityId);
    return target === undefined
      ? rejected("privateOrUnknownReference", "Medicine target is unavailable.")
      : beginMedicineStabilization(
          profiles,
          state,
          root,
          source,
          target,
          definition,
          sourcePatch,
          spent,
        );
  }

  if (isRecord(definition.healing) && isNonEmptyString(definition.healing.formula)) {
    return awaitRandomness(profiles, state, root, {
      kind: "resolveCombatAbility",
      resolutionKind: "healing",
      sourceEntityId: entityId(source),
      targetEntityIds: [String(input.parameters.targetEntityId)],
      abilityRef,
      definition,
      sourcePatch,
      spent,
    }, [formulaSpec(`healing:${abilityRef}`, definition.healing.formula, {
      sourceEntityId: entityId(source), targetEntityId: input.parameters.targetEntityId, spent,
    })]);
  }

  if (isRecord(definition.temporaryHitPoints)
    && isNonEmptyString(definition.temporaryHitPoints.formula)) {
    return awaitRandomness(profiles, state, root, {
      kind: "resolveCombatAbility",
      resolutionKind: "temporaryHitPoints",
      sourceEntityId: entityId(source),
      targetEntityIds: [String(input.parameters.targetEntityId)],
      abilityRef,
      definition,
      sourcePatch,
      spent,
    }, [formulaSpec(`temporary-hit-points:${abilityRef}`, definition.temporaryHitPoints.formula, {
      sourceEntityId: entityId(source), targetEntityId: input.parameters.targetEntityId, spent,
    })]);
  }

  const specs: DiceSpec[] = [];
  let targetIds: string[] = [];
  const mechanical: JsonRecord = {};
  let deferDamageForShield = false;
  if (isRecord(definition.target) && definition.target.kind === "area") {
    const origin = input.parameters.areaOrigin;
    if (!isRecord(origin) || !isRecord(definition.target.shape)
      || input.parameters.targetIds !== undefined
      || input.parameters.affectedEntityIds !== undefined) {
      return rejected("invalidRulesInput", "Area invocation is incomplete.");
    }
    const parsedOrigin = canonicalCombatPoint(origin);
    const sourceOrigin = canonicalCombatPoint(source.position);
    const originInRange = definition.target.rangeInches === undefined
      ? parsedOrigin !== undefined && sourceOrigin !== undefined
        && parsedOrigin.x === sourceOrigin.x
        && parsedOrigin.y === sourceOrigin.y
        && parsedOrigin.elevation === sourceOrigin.elevation
      : canonicalIntegerString(definition.target.rangeInches, 0, 1_000_000)
        && entityWithinPointRange(source, origin, String(definition.target.rangeInches));
    if (!originInRange) {
      return rejected("privateOrUnknownReference", "Area origin is unavailable.");
    }
    const directional = ["cube", "cone", "line"].includes(String(definition.target.shape.kind));
    const direction = directional ? canonicalCombatDirection(input.parameters.areaDirection) : undefined;
    if ((directional && direction === undefined)
      || (!directional && input.parameters.areaDirection !== undefined)) {
      return rejected("invalidRulesInput", "Area direction is not canonical for this shape.");
    }
    const scene = state.combatRuntime.scenes[String(source.sceneId)];
    const frozenOrigin = freezeAreaOrigin(isRecord(scene) ? scene : undefined, source, origin);
    if (parsedOrigin === undefined || sourceOrigin === undefined || frozenOrigin === undefined) {
      return rejected("invalidRulesInput", "Area origin is not canonical.");
    }
    try {
      targetIds = areaTargets(
        state,
        entityId(source),
        frozenOrigin as JsonRecord,
        definition.target.shape,
        direction,
      );
    } catch (error) {
      return rejected(
        error instanceof TypeError && error.message === "geometryContinuationRequired"
          ? "unsupportedOperation"
          : "invalidRulesInput",
        "The authoritative area geometry could not be completed for this proposal.",
      );
    }
    mechanical.area = {
      origin: structuredClone(frozenOrigin),
      shape: structuredClone(definition.target.shape),
      ...(direction === undefined ? {} : { direction }),
      affectedEntityIds: targetIds,
    };
    if (isRecord(definition.save)) {
      for (const targetId of targetIds) {
        const target = state.combatRuntime.entities[targetId];
        const ability = String(definition.save.ability);
        const mode = savingThrowMode(target, ability);
        const dc = Number(definition.save.dc ?? (isRecord(source.spellcasting) ? source.spellcasting.spellSaveDc : 10));
        specs.push({
          purposeKey: `save:${saveStem(abilityRef)}:${targetId}`,
          dice: attackDice(mode),
          frozenParameters: { targetEntityId: targetId, ability, dc, modifier: abilityModifier(target, ability), mode, halfOnSuccess: definition.save.halfOnSuccess === true },
        });
      }
    }
    if (Array.isArray(definition.damage) && definition.damage.length > 0) {
      specs.push({
        purposeKey: `damage:${purposeStem(abilityRef)}`,
        dice: damageDice(definition),
        frozenParameters: { targetEntityIds: targetIds, components: structuredClone(definition.damage), sharedAcrossTargets: true },
      });
    }
  } else {
    const target = combatEntity(state, input.parameters.targetEntityId);
    if (target === undefined) return rejected("privateOrUnknownReference", "Ability target is unavailable.");
    targetIds = [entityId(target)];
    if (isRecord(definition.attack)) {
      const attack = attackMode(state, source, target, definition);
      const mode = attack.mode;
      const cover = targetCover(state, source, target);
      const baseArmorClass = Number(target.armorClass ?? 10);
      const activeArmorClass = effectiveArmorClass(state, target);
      const coverBonus = cover === "half" ? 2 : cover === "threeQuarters" ? 5 : 0;
      mechanical.attack = {
        ...attack,
        cover,
        baseArmorClass,
        activeArmorClass,
        effectiveArmorClass: activeArmorClass + coverBonus,
      };
      deferDamageForShield = shieldEffects(state, entityId(target)).length === 0
        && reactionAvailable(target)
        && reactionSpellRefs(state, target, "shield").length > 0;
      specs.push({
        purposeKey: `attack:${purposeStem(abilityRef)}`,
        dice: attackDice(mode),
        frozenParameters: {
          sourceEntityId: entityId(source),
          targetEntityId: entityId(target),
          ...attack,
          attackBonus: attackBonus(source, definition),
          cover,
          baseArmorClass,
          activeArmorClass,
          effectiveArmorClass: activeArmorClass + coverBonus,
        },
      });
    }
    if (isRecord(definition.save)) {
      const ability = String(definition.save.ability);
      const mode = savingThrowMode(target, ability);
      const dc = Number(definition.save.dc ?? (isRecord(source.spellcasting) ? source.spellcasting.spellSaveDc : 10));
      specs.push({ purposeKey: `save:${saveStem(abilityRef)}:${entityId(target)}`, dice: attackDice(mode), frozenParameters: { targetEntityId: entityId(target), ability, dc, modifier: abilityModifier(target, ability), mode, halfOnSuccess: definition.save.halfOnSuccess === true } });
    }
    if (!deferDamageForShield && Array.isArray(definition.damage) && definition.damage.length > 0) {
      specs.push({ purposeKey: `damage:${purposeStem(abilityRef)}`, dice: damageDice(definition), frozenParameters: { targetEntityIds: targetIds, components: structuredClone(definition.damage) } });
    }
  }
  const operation = {
    kind: "resolveCombatAbility",
    resolutionKind: "ability",
    sourceEntityId: entityId(source),
    targetEntityIds: targetIds,
    abilityRef,
    definition,
    sourcePatch,
    spent,
    mechanical,
    encounterId: encounter?.encounterId ?? null,
    deferDamageForShield,
  };
  if (isSpellDefinition(definition)) {
    const slotLevel = Number(input.parameters.slotLevel ?? definitionSpellLevel(definition));
    const frame = {
      castId: `cast:${root}:0`,
      rootActionId: root,
      sourceEntityId: entityId(source),
      abilityRef,
      spellLevel: definitionSpellLevel(definition),
      slotLevel: Number.isSafeInteger(slotLevel) ? slotLevel : definitionSpellLevel(definition),
      depth: 0,
      effect: {
        kind: "ability",
        definition: structuredClone(definition),
        targetEntityIds: structuredClone(targetIds),
        parameters: structuredClone(input.parameters),
        mechanical: structuredClone(mechanical),
        specs: structuredClone(specs),
        encounterId: encounter?.encounterId ?? null,
        deferDamageForShield,
      },
      onPrevented: { kind: "stop" },
    };
    return beginSpellFrame(profiles, state, frame, sourcePatch, spent);
  }
  if (specs.length === 0) return rejected("unsupportedOperation", "Ability has no executable 2014 mechanic.");
  return awaitRandomness(profiles, state, root, operation, specs);
}

function invokeEnvironmentAbility(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "abilityRef",
    "actorCharacterId",
    "controllerPrincipalId",
    "featureId",
    "kind",
    "rootActionId",
  ])
    || ![
      input.abilityRef,
      input.actorCharacterId,
      input.controllerPrincipalId,
      input.featureId,
      input.rootActionId,
    ].every(isNonEmptyString)) {
    return rejected("invalidRulesInput", "Environment ability invocation is not canonical.");
  }
  const root = rootAction(state, input);
  if (root === undefined) {
    return rejected("duplicateRootAction", "The environment ability root action is already used.");
  }
  if (!controlledEnvironmentPlayer(state, input.controllerPrincipalId, input.actorCharacterId)) {
    return rejected("viewerUnauthorized", "The environment ability controller is unavailable.");
  }
  const actorCharacterId = input.actorCharacterId as string;
  const source = combatEntity(state, actorCharacterId);
  const feature = publicDamageableFeature(state, actorCharacterId, String(input.featureId));
  if (source === undefined
    || feature === undefined
    || source.lifeState === "dead"
    || !Array.isArray(source.abilityRefs)
    || !source.abilityRefs.includes(input.abilityRef)) {
    return rejected("privateOrUnknownReference", "Environment ability source or target is unavailable.");
  }
  const definition = state.combatRuntime.definitions[String(input.abilityRef)];
  const compiled = compileAbilityDefinition(definition);
  const target = isRecord(definition?.target) ? definition.target : undefined;
  const components = Array.isArray(definition?.damage)
    ? definition.damage.filter(isRecord)
    : [];
  if (definition === undefined
    || !compiled.ok
    || target?.kind !== "creatureOrEnvironmentFeature"
    || components.length !== 1
    || !isNonEmptyString(components[0].formula)
    || !isNonEmptyString(components[0].type)
    || feature.durability === undefined
    || feature.stateGraph?.durability === undefined
    || feature.stateGraph.damageTransitions === undefined
    || feature.durability.current === "0") {
    return rejected("privateOrUnknownReference", "Environment ability source or target is unavailable.");
  }
  const encounter = activeEncounter(state, actorCharacterId);
  if (encounter === undefined || !currentGroupAllows(encounter, actorCharacterId)) {
    return rejected("invalidRulesInput", "Combatant does not hold the current initiative turn.");
  }
  const rangeInches = [target.reachInches, target.rangeInches, target.rangeNormalInches]
    .find(isNonEmptyString);
  const scene = state.combatRuntime.scenes[String(source.sceneId)];
  if (rangeInches === undefined
    || !entityCanTargetTacticalFeature(scene, source, feature, rangeInches)) {
    return rejected("privateOrUnknownReference", "Environment ability source or target is unavailable.");
  }
  const sourcePatch = consumeTurnGrant(source, definition, String(input.abilityRef));
  if (sourcePatch === undefined) {
    return rejected("invalidRulesInput", "The attack action grant is unavailable.");
  }
  const spent = spendCosts(sourcePatch, definition);
  if (spent === undefined) return rejected("insufficientResource", "Ability resource is unavailable.");

  const graph = structuredClone(feature.stateGraph);
  const purposeKey = `damage:environment:${String(input.abilityRef)}:${String(input.featureId)}`;
  const operation = {
    kind: "resolveEnvironmentAbility",
    sourceEntityId: actorCharacterId,
    featureId: input.featureId,
    abilityRef: input.abilityRef,
    definition: structuredClone(definition),
    abilityDefinitionHash: compiled.artifact.definitionHash,
    compiledHash: compiled.artifact.compiledHash,
    environmentDefinition: graph,
    environmentDefinitionHash: canonicalSha256(graph),
    definitionId: graph.definitionId,
    sceneId: source.sceneId,
    fromState: feature.state,
    durabilityBefore: feature.durability.current,
    damageThreshold: feature.durability.damageThreshold,
    immuneDamageTypes: [...feature.durability.immuneDamageTypes],
    damageType: components[0].type,
    damageFormula: components[0].formula,
    armorClass: feature.durability.armorClass,
    rangeInches,
    sourcePatch,
    spent,
    purposeKey,
  };
  return awaitRandomness(profiles, state, root, operation, [
    formulaSpec(purposeKey, components[0].formula, {
      sourceEntityId: actorCharacterId,
      featureId: input.featureId,
      abilityRef: input.abilityRef,
      abilityDefinitionHash: compiled.artifact.definitionHash,
      compiledHash: compiled.artifact.compiledHash,
      environmentDefinitionHash: operation.environmentDefinitionHash,
      environmentDefinition: graph,
      fromState: feature.state,
      durabilityBefore: feature.durability.current,
      damageThreshold: feature.durability.damageThreshold,
      immuneDamageTypes: [...feature.durability.immuneDamageTypes],
      damageType: components[0].type,
      armorClass: feature.durability.armorClass,
      rangeInches,
    }),
    {
      purposeKey: `attack:environment:${String(input.abilityRef)}:${String(input.featureId)}`,
      dice: attackDice("normal"),
      frozenParameters: {
        sourceEntityId: actorCharacterId,
        featureId: input.featureId,
        abilityRef: input.abilityRef,
        mode: "normal",
        attackBonus: attackBonus(source, definition),
        armorClass: feature.durability.armorClass,
        rangeInches,
      },
    },
  ].sort((left, right) => left.purposeKey.localeCompare(right.purposeKey)));
}

function resolveEnvironmentAbilityRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation)
    || operation.kind !== "resolveEnvironmentAbility"
    || ![
      operation.sourceEntityId,
      operation.featureId,
      operation.abilityRef,
      operation.abilityDefinitionHash,
      operation.compiledHash,
      operation.environmentDefinitionHash,
      operation.definitionId,
      operation.sceneId,
      operation.fromState,
      operation.durabilityBefore,
      operation.damageThreshold,
      operation.damageType,
      operation.damageFormula,
      operation.armorClass,
      operation.rangeInches,
      operation.purposeKey,
    ].every(isNonEmptyString)
    || !isRecord(operation.definition)
    || !isRecord(operation.environmentDefinition)
    || !Array.isArray(operation.immuneDamageTypes)
    || !operation.immuneDamageTypes.every(isNonEmptyString)) {
    return rejected("invalidRulesInput", "Environment ability continuation is malformed.");
  }
  const source = combatEntity(state, operation.sourceEntityId);
  const definition = state.combatRuntime.definitions[String(operation.abilityRef)];
  const feature = publicDamageableFeature(
    state,
    String(operation.sourceEntityId),
    String(operation.featureId),
  );
  const compiled = compileAbilityDefinition(definition);
  const durability = feature?.durability;
  const immuneDamageTypes = operation.immuneDamageTypes.filter(isNonEmptyString);
  if (source === undefined
    || definition === undefined
    || !compiled.ok
    || !Array.isArray(source.abilityRefs)
    || !source.abilityRefs.includes(operation.abilityRef)
    || canonicalSha256(definition) !== canonicalSha256(operation.definition)
    || compiled.artifact.definitionHash !== operation.abilityDefinitionHash
    || compiled.artifact.compiledHash !== operation.compiledHash
    || feature === undefined
    || durability === undefined
    || feature.state !== operation.fromState
    || durability.current !== operation.durabilityBefore
    || durability.armorClass !== operation.armorClass
    || durability.damageThreshold !== operation.damageThreshold
    || JSON.stringify(durability.immuneDamageTypes) !== JSON.stringify(immuneDamageTypes)
    || canonicalSha256(feature.stateGraph) !== operation.environmentDefinitionHash
    || canonicalSha256(operation.environmentDefinition) !== operation.environmentDefinitionHash
    || !entityCanTargetTacticalFeature(
      state.combatRuntime.scenes[String(source.sceneId)],
      source,
      feature,
      String(operation.rangeInches),
    )) {
    return rejected("privateOrUnknownReference", "Environment ability continuation is unavailable.");
  }
  const attackRolls = faces.get(
    `attack:environment:${String(operation.abilityRef)}:${String(operation.featureId)}`,
  ) ?? [];
  const attack = resolveCombatAttackRoll(
    source,
    definition,
    Number(operation.armorClass),
    attackRolls,
    "normal",
  );
  const rolledDamage = formulaTotal(
    faces,
    String(operation.purposeKey),
    String(operation.damageFormula),
  );
  const immune = immuneDamageTypes.includes(String(operation.damageType));
  const appliedDamage = !attack.hit || immune || rolledDamage < Number(operation.damageThreshold)
    ? 0
    : rolledDamage;
  const durabilityAfter = Math.max(0, Number(operation.durabilityBefore) - appliedDamage);
  const damageTransition = feature.stateGraph!.damageTransitions!.find((candidate) =>
    candidate.fromState === operation.fromState
    && durabilityAfter <= Number(candidate.remainingDurabilityAtOrBelow));
  const toState = damageTransition?.toState ?? String(operation.fromState);
  const semantics = feature.stateGraph!.states.find((candidate) => candidate.state === toState);
  if (semantics === undefined) {
    return rejected("invalidWorldState", "Environment damage state transition is unavailable.");
  }
  const mechanicalResult = {
    kind: "environmentFeatureDamaged",
    sourceEntityId: operation.sourceEntityId,
    featureId: operation.featureId,
    abilityRef: operation.abilityRef,
    damageType: operation.damageType,
    attack: { mode: "normal", rolls: attackRolls, armorClass: operation.armorClass, ...attack },
    rolledDamage,
    appliedDamage,
    durabilityBefore: operation.durabilityBefore,
    durabilityAfter: String(durabilityAfter),
    fromState: operation.fromState,
    toState,
  };
  const drafts = resourceAndInvocationDrafts(operation, mechanicalResult).map((draft) =>
    draft.eventType === "AbilityInvoked"
      ? {
          ...draft,
          visibilityPolicyId: "visibility:room-authority-only",
          secrecy: "internal" as const,
        }
      : draft);
  drafts.push({
    eventType: "EnvironmentFeatureDamaged",
    payload: {
      actorCharacterId: String(operation.sourceEntityId),
      sceneId: String(operation.sceneId),
      featureId: String(operation.featureId),
      definitionId: String(operation.definitionId),
      environmentDefinition: structuredClone(operation.environmentDefinition),
      environmentDefinitionHash: operation.environmentDefinitionHash as `sha256:${string}`,
      abilityRef: String(operation.abilityRef),
      abilityDefinition: structuredClone(operation.definition),
      abilityDefinitionHash: operation.abilityDefinitionHash as `sha256:${string}`,
      compiledHash: operation.compiledHash as `sha256:${string}`,
      armorClass: String(operation.armorClass),
      attackRolls: [...attackRolls],
      selectedAttackRoll: attack.selected,
      attackBonus: String(attack.attackBonus),
      attackTotal: String(attack.total),
      hit: attack.hit,
      damageType: String(operation.damageType),
      rangeInches: String(operation.rangeInches),
      damageThreshold: String(operation.damageThreshold),
      immuneDamageTypes: [...operation.immuneDamageTypes] as string[],
      rolledDamage: String(rolledDamage),
      appliedDamage: String(appliedDamage),
      durabilityBefore: String(operation.durabilityBefore),
      durabilityAfter: String(durabilityAfter),
      fromState: String(operation.fromState),
      toState,
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
  });
  return sequence(
    "committed",
    profiles,
    state,
    String(resolution.rootActionId),
    drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })),
    { mechanicalResult },
  );
}

function resourceAndInvocationDrafts(operation: JsonRecord, mechanicalResult: JsonRecord): Draft[] {
  if (!isRecord(operation.sourcePatch) || !Array.isArray(operation.spent)
    || !isNonEmptyString(operation.sourceEntityId) || !isNonEmptyString(operation.abilityRef)) {
    throw new TypeError("combat resolution source is malformed");
  }
  const drafts: Draft[] = [];
  if (operation.costsCommitted !== true) {
    for (const cost of operation.spent) {
      if (!isRecord(cost)) throw new TypeError("combat resource cost is malformed");
      drafts.push({ eventType: "ResourceSpent", payload: {
        entityId: operation.sourceEntityId,
        resourceId: cost.resourceId,
        amount: cost.amount,
        resourceAfter: cost.after,
      } });
    }
  }
  if (operation.invocationCommitted !== true) {
    drafts.push({ eventType: "AbilityInvoked", payload: {
      sourceEntityId: operation.sourceEntityId,
      abilityRef: operation.abilityRef,
      mechanicalResult,
      sourcePatch: structuredClone(operation.sourcePatch),
    } });
  }
  return drafts;
}

function applyDownedState(target: JsonRecord, amount: number, criticalHit = false, beforeCurrent?: number): {
  patch: JsonRecord;
  died: boolean;
} {
  const patch = structuredClone(target);
  if (!isRecord(patch.hitPoints)) throw new TypeError("damage target lacks hit points");
  const before = beforeCurrent ?? Number(target.hitPoints && isRecord(target.hitPoints) ? target.hitPoints.current : 0);
  const after = Number(patch.hitPoints.current);
  let died = false;
  if (after === 0) {
    const conditions = { ...(isRecord(patch.conditions) ? patch.conditions : {}) };
    delete conditions.stable;
    patch.conditions = { ...conditions, unconscious: true, prone: true };
    const maximum = Number(patch.hitPoints.maximum);
    const massiveDamage = before > 0 && amount - before >= maximum;
    if (patch.deathPolicy === "deadAtZero" || massiveDamage) {
      patch.lifeState = "dead";
      died = true;
    } else if (before === 0 && amount > 0) {
      const saves = isRecord(patch.deathSaves) ? patch.deathSaves : { successes: 0, failures: 0 };
      saves.failures = Number(saves.failures ?? 0) + (criticalHit ? 2 : 1);
      patch.deathSaves = saves;
      if (Number(saves.failures) >= 3) {
        patch.lifeState = "dead";
        died = true;
      }
    }
    if (!died) patch.lifeState = "unconscious";
  }
  return { patch, died };
}

function damageDraft(
  target: JsonRecord,
  rolled: Array<{ type: string; rolled: number }>,
  encounterId: unknown,
  sourceDefinitionId: string,
  criticalHit = false,
): { draft: Draft; resolution: ReturnType<typeof resolveCombatDamage>; died: boolean } {
  const resolution = resolveCombatDamage(target, rolled);
  const beforeCurrent = isRecord(target.hitPoints) ? Number(target.hitPoints.current) : 0;
  const temporaryBefore = isRecord(target.hitPoints) ? Number(target.hitPoints.temporary ?? 0) : 0;
  const hitPointDamage = Math.max(0, resolution.totalApplied - temporaryBefore);
  const downed = applyDownedState(resolution.targetPatch, hitPointDamage, criticalHit, beforeCurrent);
  resolution.targetPatch = downed.patch;
  return {
    draft: {
      eventType: "DamagePacketResolved",
      payload: {
        encounterId: isNonEmptyString(encounterId) ? encounterId : null,
        pipelineProfileId: "damage-death-srd51-2014-v1",
        sourceDefinitionId,
        targetEntityId: entityId(target),
        components: resolution.components,
        totalApplied: resolution.totalApplied,
        targetPatch: resolution.targetPatch,
      },
    },
    resolution,
    died: downed.died,
  };
}

function beginStableRecoverySchedule(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  targetEntityIds: string[],
  prefix: Draft[],
): StepResult {
  const targets = [...new Set(targetEntityIds)].filter((targetEntityId) => {
    const target = combatEntity(state, targetEntityId);
    return target !== undefined && target.lifeState !== "dead" && isRecord(target.hitPoints);
  });
  if (targets.length === 0) return sequence("committed", profiles, state, rootActionId, prefix);
  return awaitRandomness(profiles, state, rootActionId, {
    kind: "scheduleStableRecovery",
    targetEntityIds: targets,
  }, targets.map((targetEntityId) => ({
    purposeKey: `stable-recovery:${targetEntityId}`,
    dice: [{ count: "1", sides: "4" }],
    frozenParameters: {
      targetEntityId,
      recoveryHitPoints: 1,
      hourMicros: "3600000000",
    },
  })), prefix);
}

function interruptStableRecoveryDrafts(
  state: AuthoritativeWorldState,
  targetEntityId: string,
  cause: JsonRecord,
): Draft[] {
  return Object.values(state.campaignRuntime.activities)
    .filter((activity) => activity.status === "active"
      && activity.activityKind === "stableRecovery2014"
      && activity.characterId === targetEntityId)
    .sort((left, right) => String(left.activityId).localeCompare(String(right.activityId)))
    .map((activity) => ({
      eventType: "ActivityInterrupted",
      payload: {
        activityId: String(activity.activityId),
        cause: structuredClone(cause),
      },
    }));
}

function resolveStableRecoverySchedule(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation)
    || operation.kind !== "scheduleStableRecovery"
    || !Array.isArray(operation.targetEntityIds)
    || !operation.targetEntityIds.every(isNonEmptyString)) {
    return rejected("invalidRulesInput", "Stable-recovery continuation is malformed.");
  }
  const drafts: Draft[] = [];
  for (const targetEntityId of operation.targetEntityIds) {
    const target = combatEntity(state, targetEntityId);
    const hours = faces.get(`stable-recovery:${targetEntityId}`)?.[0];
    if (target === undefined || target.lifeState === "dead"
      || !isRecord(target.hitPoints) || Number(target.hitPoints.current) !== 0
      || hours === undefined || hours < 1 || hours > 4) {
      return rejected("privateOrUnknownReference", "Stable-recovery target is unavailable.");
    }
    const activityId = `activity:stable-recovery:${targetEntityId}:${String(resolution.resolutionId)}`;
    drafts.push({
      eventType: "ActivityStarted",
      payload: {
        activityId,
        activityKind: "stableRecovery2014",
        characterId: targetEntityId,
        intendedDurationMicros: String(hours * 3_600_000_000),
        completion: { kind: "stableRecovery2014", entityId: targetEntityId },
      },
      resolutionId: String(resolution.resolutionId),
    });
  }
  return sequence("committed", profiles, state, String(resolution.rootActionId), drafts, {
    mechanicalResult: {
      kind: "stableRecoveryScheduled",
      targetEntityIds: structuredClone(operation.targetEntityIds),
    },
  });
}

function resolveMedicineStabilization(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation)
    || operation.kind !== "resolveMedicineStabilization"
    || ![operation.sourceEntityId, operation.targetEntityId, operation.abilityRef, operation.purposeKey]
      .every(isNonEmptyString)
    || !isRecord(operation.definition)
    || !isRecord(operation.sourcePatch)
    || !Array.isArray(operation.spent)
    || operation.dc !== 10
    || !Number.isSafeInteger(operation.modifier)) {
    return rejected("invalidRulesInput", "Medicine continuation is malformed.");
  }
  const target = combatEntity(state, operation.targetEntityId);
  const roll = faces.get(String(operation.purposeKey))?.[0];
  if (target === undefined || target.lifeState === "dead"
    || !isRecord(target.hitPoints) || Number(target.hitPoints.current) !== 0
    || roll === undefined) {
    return rejected("privateOrUnknownReference", "Medicine continuation target is unavailable.");
  }
  const total = roll + Number(operation.modifier);
  const succeeded = total >= 10;
  const mechanicalResult = {
    medicine: {
      targetEntityId: operation.targetEntityId,
      ability: "wis",
      skill: "medicine",
      dc: 10,
      modifier: operation.modifier,
      roll,
      total,
      succeeded,
    },
  };
  const drafts = resourceAndInvocationDrafts(operation, mechanicalResult);
  if (!succeeded) {
    return sequence(
      "committed",
      profiles,
      state,
      String(resolution.rootActionId),
      drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })),
      { mechanicalResult },
    );
  }
  const patch = structuredClone(target);
  patch.lifeState = "unconscious";
  patch.deathSaves = { successes: 0, failures: 0 };
  patch.conditions = {
    ...(isRecord(patch.conditions) ? patch.conditions : {}),
    stable: true,
    unconscious: true,
    prone: true,
  };
  drafts.push({
    eventType: "DeathSaveResolved",
    payload: {
      entityId: operation.targetEntityId,
      roll,
      natural: roll,
      successes: 0,
      failures: 0,
      entityPatch: patch,
    },
    resolutionId: String(resolution.resolutionId),
  });
  return beginStableRecoverySchedule(
    profiles,
    state,
    String(resolution.rootActionId),
    [String(operation.targetEntityId)],
    drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })),
  );
}

function continueAfterDamageConcentration(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  drafts: Draft[],
  checks: JsonRecord[],
  mechanicalResult: JsonRecord,
  afterDamageSpellFrame?: JsonRecord,
): StepResult {
  if (checks.length === 0) {
    return sequence("committed", profiles, state, rootActionId, drafts, { mechanicalResult });
  }
  return awaitRandomness(profiles, state, rootActionId, {
    kind: "resolveDamageConcentration",
    checks: structuredClone(checks),
    mechanicalResult: structuredClone(mechanicalResult),
    ...(afterDamageSpellFrame === undefined
      ? {}
      : { afterDamageSpellFrame: structuredClone(afterDamageSpellFrame) }),
  }, checks.map((check) => ({
    purposeKey: String(check.purposeKey),
    dice: [{ count: "1", sides: "20" }],
    frozenParameters: {
      targetEntityId: check.targetEntityId,
      ability: "con",
      dc: check.dc,
      modifier: check.modifier,
      damageTaken: check.damageTaken,
      sourceAbilityRef: check.sourceAbilityRef,
    },
  })), drafts);
}

function resolveDamageConcentration(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation)
    || operation.kind !== "resolveDamageConcentration"
    || !Array.isArray(operation.checks)
    || !isRecord(operation.mechanicalResult)) {
    return rejected("invalidRulesInput", "Damage-concentration continuation is malformed.");
  }
  const concentrationResults: Record<string, JsonRecord> = {};
  const drafts: Draft[] = [];
  for (const check of operation.checks) {
    if (!isRecord(check)
      || ![check.targetEntityId, check.purposeKey, check.sourceAbilityRef].every(isNonEmptyString)
      || !Number.isSafeInteger(check.dc)
      || !Number.isSafeInteger(check.modifier)
      || !Number.isSafeInteger(check.damageTaken)) {
      return rejected("invalidRulesInput", "Damage-concentration check is malformed.");
    }
    const target = combatEntity(state, check.targetEntityId);
    const roll = faces.get(String(check.purposeKey))?.[0];
    if (target === undefined || !isRecord(target.concentration) || roll === undefined) {
      return rejected("privateOrUnknownReference", "Damage-concentration target is unavailable.");
    }
    const total = roll + Number(check.modifier);
    const succeeded = total >= Number(check.dc);
    concentrationResults[String(check.targetEntityId)] = {
      roll,
      modifier: check.modifier,
      total,
      dc: check.dc,
      damageTaken: check.damageTaken,
      succeeded,
    };
    drafts.push({
      eventType: "ConcentrationTested",
      payload: {
        entityId: check.targetEntityId,
        causeFactId: check.sourceAbilityRef,
        dc: check.dc,
        modifier: check.modifier,
        roll,
        total,
        succeeded,
      },
      resolutionId: String(resolution.resolutionId),
    });
    if (!succeeded) drafts.push({
      eventType: "ConcentrationEnded",
      payload: { entityId: check.targetEntityId, reason: "failedDamageSave" },
      resolutionId: String(resolution.resolutionId),
    });
  }
  if (isRecord(operation.afterDamageSpellFrame)) {
    drafts.push(spellEventDraft(
      "SpellResolved",
      operation.afterDamageSpellFrame,
      { kind: "ability", succeeded: true },
    ));
  }
  return sequence("committed", profiles, state, String(resolution.rootActionId), drafts, {
    mechanicalResult: {
      ...structuredClone(operation.mechanicalResult),
      concentration: concentrationResults,
    },
  });
}

function spellCastSummary(frame: JsonRecord): JsonRecord {
  return {
    castId: frame.castId,
    sourceEntityId: frame.sourceEntityId,
    abilityRef: frame.abilityRef,
    spellLevel: frame.spellLevel,
    slotLevel: frame.slotLevel,
    depth: frame.depth,
  };
}

function spellEventDraft(
  eventType: "SpellResolved" | "SpellCountered",
  frame: JsonRecord,
  extra: JsonRecord,
): Draft {
  return eventType === "SpellResolved"
    ? {
        eventType,
        payload: {
          castId: frame.castId,
          sourceEntityId: frame.sourceEntityId,
          abilityRef: frame.abilityRef,
          outcome: structuredClone(extra),
        },
      }
    : {
        eventType,
        payload: {
          castId: frame.castId,
          sourceEntityId: frame.sourceEntityId,
          abilityRef: frame.abilityRef,
          counteredByCastId: extra.counteredByCastId,
        },
      };
}

function continuationAfterCounterCandidate(pending: JsonRecord): JsonRecord {
  const nextIndex = Number(pending.reactionIndex) + 1;
  return Array.isArray(pending.reactionQueue) && nextIndex < pending.reactionQueue.length
    ? {
        kind: "counterspellQueue",
        spellFrame: structuredClone(pending.spellFrame),
        reactionQueue: structuredClone(pending.reactionQueue),
        reactionIndex: nextIndex,
      }
    : { kind: "resolveSpell", spellFrame: structuredClone(pending.spellFrame) };
}

function executeSpellContinuation(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  continuation: JsonRecord,
  prefix: Draft[],
): StepResult {
  if (continuation.kind === "stop") {
    if (prefix.length === 0) throw new TypeError("stopped spell continuation lacks a committed event");
    return sequence("committed", profiles, state, rootActionId, prefix);
  }
  if (continuation.kind === "resolveSpell" && isRecord(continuation.spellFrame)) {
    return afterDrafts(profiles, state, rootActionId, prefix, (nextState) =>
      resolveSpellFrame(profiles, nextState, continuation.spellFrame as JsonRecord));
  }
  if (continuation.kind === "counterspellQueue"
    && isRecord(continuation.spellFrame)
    && Array.isArray(continuation.reactionQueue)
    && Number.isSafeInteger(continuation.reactionIndex)) {
    return afterDrafts(profiles, state, rootActionId, prefix, (nextState) =>
      openCounterspellWindow(
        profiles,
        nextState,
        continuation.spellFrame as JsonRecord,
        continuation.reactionQueue as JsonRecord[],
        Number(continuation.reactionIndex),
      ));
  }
  if (continuation.kind === "postAttackDamage"
    && isRecord(continuation.operation)
    && isRecord(continuation.mechanicalResult)) {
    return afterDrafts(profiles, state, rootActionId, prefix, (nextState) =>
      requestPostAttackDamage(
        profiles,
        nextState,
        rootActionId,
        continuation.operation as JsonRecord,
        continuation.mechanicalResult as JsonRecord,
      ));
  }
  if (continuation.kind === "resolveMagicMissile" && isRecord(continuation.spellFrame)) {
    return afterDrafts(profiles, state, rootActionId, prefix, (nextState) =>
      resolveSpellAbilityEffect(profiles, nextState, continuation.spellFrame as JsonRecord));
  }
  throw new TypeError("spell continuation is malformed");
}

function openCounterspellWindow(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  frame: JsonRecord,
  frozenQueue?: JsonRecord[],
  reactionIndex = 0,
): StepResult {
  const caster = combatEntity(state, frame.sourceEntityId);
  if (caster === undefined) {
    return executeSpellContinuation(
      profiles,
      state,
      String(frame.rootActionId),
      isRecord(frame.onPrevented) ? frame.onPrevented : { kind: "stop" },
      [spellEventDraft("SpellCountered", frame, { counteredByCastId: "cast:invalidated" })],
    );
  }
  const queue = frozenQueue ?? counterspellCandidates(state, caster).map((candidate, index) => ({
    triggerInstanceId: `trigger:${String(frame.castId)}:counterspell:${index + 1}`,
    ...candidate,
  }));
  if (Number(frame.depth ?? 0) >= 32 || reactionIndex >= queue.length) {
    return resolveSpellFrame(profiles, state, frame);
  }
  const candidate = queue[reactionIndex];
  if (!isRecord(candidate) || !isNonEmptyString(candidate.controllerEntityId)
    || !Array.isArray(candidate.abilityRefs)) throw new TypeError("counterspell queue is malformed");
  const candidateAbilityRefs = candidate.abilityRefs.filter(isNonEmptyString);
  const triggerBatch = freezeTriggerBatch(
    String(frame.rootActionId),
    { castId: frame.castId, event: "spellCastingStarted", sourceEntityId: frame.sourceEntityId },
    queue.map((entry) => ({
      triggerInstanceId: String(entry.triggerInstanceId),
      sourceEntityId: String(entry.controllerEntityId),
      sourceKind: state.combatRuntime.entities[String(entry.controllerEntityId)]?.kind as string | undefined,
      controllerEntityId: String(entry.controllerEntityId),
      definitionId: Array.isArray(entry.abilityRefs)
        ? String(entry.abilityRefs[0] ?? "counterspell")
        : "counterspell",
      timing: "spellCastingStarted",
      mandatory: false,
      secrecy: "private",
    })),
    triggerOrder(
      state,
      String(frame.sourceEntityId),
      queue.map((entry) => String(entry.controllerEntityId)),
    ),
  );
  const controller = combatEntity(state, candidate.controllerEntityId);
  const currentRefs = controller === undefined || !reactionAvailable(controller)
    || !canSeeWithinCounterspellRange(state, controller, caster)
    ? []
    : reactionSpellRefs(state, controller, "counterspell")
      .filter((abilityRef) => candidateAbilityRefs.includes(abilityRef));
  if (currentRefs.length === 0) {
    const pendingInputId = `pending:${String(frame.rootActionId)}:counterspell:${String(frame.castId)}:${reactionIndex + 1}`;
    const next = reactionIndex + 1 < queue.length
      ? { kind: "counterspellQueue", spellFrame: frame, reactionQueue: queue, reactionIndex: reactionIndex + 1 }
      : { kind: "resolveSpell", spellFrame: frame };
    return executeSpellContinuation(profiles, state, String(frame.rootActionId), next, [{
      eventType: "TriggerInvalidated",
      payload: {
        pendingInputId,
        triggerInstanceId: isNonEmptyString(candidate.triggerInstanceId)
          ? candidate.triggerInstanceId
          : `trigger:${String(frame.castId)}:counterspell:${reactionIndex + 1}`,
        reason: "counterspellNoLongerLegal",
      },
      secrecy: "private",
    }]);
  }
  const pending = {
    pendingInputId: `pending:${String(frame.rootActionId)}:counterspell:${String(frame.castId)}:${reactionIndex + 1}`,
    rootActionId: frame.rootActionId,
    kind: controller?.kind === "player" ? "playerChoice" : "kpDecision",
    choiceKind: "reaction",
    reactionKind: "counterspell",
    triggerKind: "spellCastingStarted",
    triggerInstanceId: candidate.triggerInstanceId,
    triggerBatchId: triggerBatch.triggerBatchId,
    triggerBatchHash: triggerBatch.triggerBatchHash,
    ...(isNonEmptyString(frame.parentTriggerBatchId)
      ? { parentTriggerBatchId: frame.parentTriggerBatchId }
      : {}),
    controllerEntityId: candidate.controllerEntityId,
    targetEntityId: frame.sourceEntityId,
    candidateAbilityRefs: currentRefs,
    reactionQueue: structuredClone(queue),
    reactionIndex,
    spellFrame: structuredClone(frame),
  };
  return sequence("awaitingInput", profiles, state, String(frame.rootActionId), [{
    eventType: "ReactionOpportunityOpened",
    payload: { pending },
    secrecy: "private",
  }], { pending: publicPending(pending) });
}

function resolveCounterspellAttempt(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  counterFrame: JsonRecord,
): StepResult {
  if (!isRecord(counterFrame.effect) || counterFrame.effect.kind !== "counterspell"
    || !isRecord(counterFrame.effect.targetCast)) throw new TypeError("counterspell frame is malformed");
  const targetCast = counterFrame.effect.targetCast;
  const targetLevel = Number(targetCast.spellLevel ?? 0);
  const slotLevel = Number(counterFrame.slotLevel ?? 0);
  if (targetLevel <= slotLevel) {
    const drafts: Draft[] = [
      spellEventDraft("SpellResolved", counterFrame, {
        kind: "counterspell2014",
        automatic: true,
        targetSpellLevel: targetLevel,
        slotLevel,
        succeeded: true,
      }),
      spellEventDraft("SpellCountered", targetCast, { counteredByCastId: counterFrame.castId }),
    ];
    const onPrevented = isRecord(targetCast.onPrevented) ? targetCast.onPrevented : { kind: "stop" };
    return executeSpellContinuation(profiles, state, String(counterFrame.rootActionId), onPrevented, drafts);
  }
  const caster = combatEntity(state, counterFrame.sourceEntityId);
  if (caster === undefined || !isRecord(caster.spellcasting) || !isNonEmptyString(caster.spellcasting.ability)) {
    throw new TypeError("counterspell caster lacks a spellcasting ability");
  }
  const ability = String(caster.spellcasting.ability);
  const dc = 10 + targetLevel;
  return awaitRandomness(profiles, state, String(counterFrame.rootActionId), {
    kind: "resolveCounterspellCheck",
    counterFrame: structuredClone(counterFrame),
  }, [{
    purposeKey: `check:counterspell:${entityId(caster)}`,
    dice: [{ count: "1", sides: "20" }],
    frozenParameters: {
      ability,
      modifier: abilityModifier(caster, ability),
      dc,
      targetSpellLevel: targetLevel,
      slotLevel,
      kind: "spellcastingAbilityCheck2014",
    },
  }]);
}

function resolveShieldSpell(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  frame: JsonRecord,
): StepResult {
  if (!isRecord(frame.effect) || frame.effect.kind !== "shield"
    || !isNonEmptyString(frame.effect.targetEntityId)
    || !isRecord(frame.effect.continuation)) throw new TypeError("shield frame is malformed");
  const target = combatEntity(state, frame.effect.targetEntityId);
  if (target === undefined) {
    return executeSpellContinuation(
      profiles,
      state,
      String(frame.rootActionId),
      isRecord(frame.onPrevented) ? frame.onPrevented : frame.effect.continuation,
      [spellEventDraft("SpellCountered", frame, { counteredByCastId: "cast:target-unavailable" })],
    );
  }
  const effect = {
    effectId: `effect:shield:${String(frame.castId)}`,
    kind: "shield",
    sourceAbilityRef: frame.abilityRef,
    sourceEntityId: frame.sourceEntityId,
    targetEntityId: frame.effect.targetEntityId,
    armorClassBonus: "5",
    magicMissileImmunity: true,
    expiresAt: combatPhaseExpiryAnchor(
      state,
      frame.effect.targetEntityId,
      "turnStart",
      String(frame.rootActionId),
    ),
  };
  const drafts: Draft[] = [
    { eventType: "EffectApplied", payload: { effect } },
    spellEventDraft("SpellResolved", frame, { kind: "shield2014", effectId: effect.effectId }),
  ];
  const continuation = frame.effect.continuation;
  if (continuation.kind === "postAttackDamage"
    && isRecord(continuation.mechanicalResult)) {
    const attack = continuation.mechanicalResult.attack;
    if (!isRecord(attack)) throw new TypeError("shield attack continuation is malformed");
    const selected = Number(attack.selected);
    const total = Number(attack.total);
    const coverBonus = attack.cover === "half" ? 2 : attack.cover === "threeQuarters" ? 5 : 0;
    const armorClass = effectiveArmorClass({
      ...state,
      combatRuntime: {
        ...state.combatRuntime,
        effects: { ...state.combatRuntime.effects, [effect.effectId]: effect },
      },
    }, target) + coverBonus;
    const hit = selected === 20 || (selected !== 1 && total >= armorClass);
    attack.effectiveArmorClass = armorClass;
    attack.hit = hit;
    attack.shieldApplied = true;
    if (!hit) {
      return sequence("committed", profiles, state, String(frame.rootActionId), drafts);
    }
  }
  if (continuation.kind === "resolveMagicMissile" && isRecord(continuation.spellFrame)) {
    drafts.push(spellEventDraft("SpellResolved", continuation.spellFrame, {
      kind: "magicMissile",
      immune: true,
      shieldEffectId: effect.effectId,
    }));
    return sequence("committed", profiles, state, String(frame.rootActionId), drafts);
  }
  return executeSpellContinuation(profiles, state, String(frame.rootActionId), continuation, drafts);
}

function resolveHeldReadySpell(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  frame: JsonRecord,
): StepResult {
  if (!isRecord(frame.effect) || frame.effect.kind !== "holdReadiedSpell"
    || !isRecord(frame.effect.ready)) throw new TypeError("readied spell frame is malformed");
  const ready = frame.effect.ready;
  const source = combatEntity(state, frame.sourceEntityId);
  if (source === undefined) throw new TypeError("readied spell caster is unavailable");
  return sequence("committed", profiles, state, String(frame.rootActionId), [
    {
      eventType: "ReadiedActionCreated",
      payload: { ready, sourcePatch: structuredClone(source) },
      secrecy: "private",
    },
    {
      eventType: "ConcentrationStarted",
      payload: {
        entityId: frame.sourceEntityId,
        concentration: { kind: "readiedSpell", effectId: ready.effectId },
      },
    },
    spellEventDraft("SpellResolved", frame, { kind: "heldForReadyTrigger", effectId: ready.effectId }),
  ]);
}

function resolveSpellFrame(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  frame: JsonRecord,
): StepResult {
  if (!isRecord(frame.effect)) throw new TypeError("spell frame lacks an effect continuation");
  switch (frame.effect.kind) {
    case "counterspell": return resolveCounterspellAttempt(profiles, state, frame);
    case "shield": return resolveShieldSpell(profiles, state, frame);
    case "holdReadiedSpell": return resolveHeldReadySpell(profiles, state, frame);
    case "ability": {
      if (definitionHasMechanicalKey(frame.effect.definition as JsonRecord, "magic-missile")
        && Array.isArray(frame.effect.targetEntityIds)
        && isNonEmptyString(frame.effect.targetEntityIds[0])) {
        const targetId = frame.effect.targetEntityIds[0];
        if (magicMissileImmune(state, targetId)) {
          return sequence("committed", profiles, state, String(frame.rootActionId), [
            spellEventDraft("SpellResolved", frame, { kind: "magicMissile", immune: true }),
          ]);
        }
        const target = combatEntity(state, targetId);
        const shieldRefs = target === undefined || !reactionAvailable(target)
          ? []
          : reactionSpellRefs(state, target, "shield");
        if (shieldRefs.length > 0) {
          return openShieldWindow(profiles, state, frame, targetId, shieldRefs, {
            kind: "resolveMagicMissile",
            spellFrame: structuredClone(frame),
          });
        }
      }
      return resolveSpellAbilityEffect(profiles, state, frame);
    }
    default: throw new TypeError("unsupported spell frame effect");
  }
}

function beginSpellFrame(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  frame: JsonRecord,
  sourcePatch: JsonRecord,
  spent: Array<{ resourceId: string; amount: number; after: string }>,
  prefix: Draft[] = [],
): StepResult {
  const drafts: Draft[] = [
    ...prefix,
    ...spent.map((cost): Draft => ({
      eventType: "ResourceSpent",
      payload: {
        entityId: frame.sourceEntityId,
        resourceId: cost.resourceId,
        amount: cost.amount,
        resourceAfter: cost.after,
      },
    })),
    {
      eventType: "SpellCastingStarted",
      payload: { cast: spellCastSummary(frame), sourcePatch: structuredClone(sourcePatch) },
    },
  ];
  return afterDrafts(profiles, state, String(frame.rootActionId), drafts, (nextState) =>
    openCounterspellWindow(profiles, nextState, frame));
}

function resolveSpellAbilityEffect(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  frame: JsonRecord,
): StepResult {
  if (!isRecord(frame.effect) || frame.effect.kind !== "ability"
    || !isRecord(frame.effect.definition) || !Array.isArray(frame.effect.targetEntityIds)
    || !isRecord(frame.effect.mechanical) || !Array.isArray(frame.effect.specs)) {
    throw new TypeError("spell ability frame is malformed");
  }
  if (frame.effect.specs.length === 0) {
    const source = combatEntity(state, frame.sourceEntityId);
    if (source === undefined) throw new TypeError("spell source is unavailable");
    const drafts: Draft[] = [{
      eventType: "AbilityInvoked",
      payload: {
        sourceEntityId: frame.sourceEntityId,
        abilityRef: frame.abilityRef,
        mechanicalResult: structuredClone(frame.effect.mechanical),
        sourcePatch: structuredClone(source),
      },
    }];
    const parameters = isRecord(frame.effect.parameters) ? frame.effect.parameters : {};
    if (isRecord(frame.effect.definition.effect)
      && frame.effect.definition.effect.kind === "concentration") {
      if (isRecord(source.concentration)) {
        drafts.push({
          eventType: "ConcentrationEnded",
          payload: { entityId: frame.sourceEntityId, reason: "replacedByNewConcentration" },
        });
      }
      drafts.push({
        eventType: "ConcentrationStarted",
        payload: {
          entityId: frame.sourceEntityId,
          concentration: {
            abilityRef: frame.abilityRef,
            targetEntityId: parameters.targetEntityId,
            durationMicros: frame.effect.definition.effect.durationMicros,
          },
        },
      });
    }
    drafts.push(spellEventDraft("SpellResolved", frame, { kind: "ability", succeeded: true }));
    return sequence("committed", profiles, state, String(frame.rootActionId), drafts);
  }
  return awaitRandomness(profiles, state, String(frame.rootActionId), {
    kind: "resolveSpellAbilityEffect",
    spellFrame: structuredClone(frame),
  }, frame.effect.specs as DiceSpec[]);
}

function endConcentration(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["kind", "rootActionId", "sourceEntityId"])
    || ![input.rootActionId, input.sourceEntityId].every(isNonEmptyString)) {
    return rejected("invalidRulesInput", "Concentration ending input is not canonical.");
  }
  const root = rootAction(state, input);
  const source = combatEntity(state, input.sourceEntityId);
  if (root === undefined || source === undefined || !isRecord(source.concentration)) {
    return rejected("privateOrUnknownReference", "Active concentration is unavailable.");
  }
  return sequence("committed", profiles, state, root, [{
    eventType: "ConcentrationEnded",
    payload: { entityId: input.sourceEntityId, reason: "voluntarilyEnded" },
  }]);
}

function testConcentration(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["causeFactId", "kind", "rootActionId", "sourceEntityId"])
    || ![input.causeFactId, input.rootActionId, input.sourceEntityId].every(isNonEmptyString)) {
    return rejected("invalidRulesInput", "Environmental concentration input is not canonical.");
  }
  const root = rootAction(state, input);
  const source = combatEntity(state, input.sourceEntityId);
  if (root === undefined || source === undefined || !isRecord(source.concentration)) {
    return rejected("privateOrUnknownReference", "Active concentration is unavailable.");
  }
  const modifier = abilityModifier(source, "con");
  const purposeKey = `save:concentration:environment:${String(input.sourceEntityId)}:${String(input.causeFactId)}`;
  return awaitRandomness(profiles, state, root, {
    kind: "resolveEnvironmentalConcentration",
    sourceEntityId: input.sourceEntityId,
    causeFactId: input.causeFactId,
    purposeKey,
    dc: 10,
    modifier,
  }, [{
    purposeKey,
    dice: [{ count: "1", sides: "20" }],
    frozenParameters: {
      sourceEntityId: input.sourceEntityId,
      causeFactId: input.causeFactId,
      ability: "con",
      dc: 10,
      modifier,
    },
  }]);
}

function resolveEnvironmentalConcentration(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation)
    || operation.kind !== "resolveEnvironmentalConcentration"
    || ![operation.sourceEntityId, operation.causeFactId, operation.purposeKey].every(isNonEmptyString)
    || operation.dc !== 10
    || !Number.isSafeInteger(operation.modifier)) {
    return rejected("invalidRulesInput", "Environmental concentration continuation is malformed.");
  }
  const source = combatEntity(state, operation.sourceEntityId);
  const roll = faces.get(String(operation.purposeKey))?.[0];
  if (source === undefined || !isRecord(source.concentration) || roll === undefined) {
    return rejected("privateOrUnknownReference", "Environmental concentration continuation is unavailable.");
  }
  const total = roll + Number(operation.modifier);
  const succeeded = total >= 10;
  const drafts: Draft[] = [{
    eventType: "ConcentrationTested",
    payload: {
      entityId: operation.sourceEntityId,
      causeFactId: operation.causeFactId,
      dc: 10,
      modifier: operation.modifier,
      roll,
      total,
      succeeded,
    },
    resolutionId: String(resolution.resolutionId),
  }];
  if (!succeeded) drafts.push({
    eventType: "ConcentrationEnded",
    payload: { entityId: operation.sourceEntityId, reason: "failedEnvironmentalSave" },
    resolutionId: String(resolution.resolutionId),
  });
  return sequence("committed", profiles, state, String(resolution.rootActionId), drafts, {
    mechanicalResult: {
      kind: "environmentalConcentrationSave",
      sourceEntityId: operation.sourceEntityId,
      causeFactId: operation.causeFactId,
      ability: "con",
      dc: 10,
      modifier: operation.modifier,
      roll,
      total,
      succeeded,
    },
  });
}

function openShieldWindow(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  ownerFrame: JsonRecord,
  targetEntityId: string,
  candidateAbilityRefs: string[],
  continuation: JsonRecord,
): StepResult {
  const target = combatEntity(state, targetEntityId);
  if (target === undefined) return executeSpellContinuation(
    profiles, state, String(ownerFrame.rootActionId), continuation, []);
  const pending = {
    pendingInputId: `pending:${String(ownerFrame.rootActionId)}:shield:${String(ownerFrame.castId ?? ownerFrame.abilityRef)}`,
    rootActionId: ownerFrame.rootActionId,
    kind: target.kind === "player" ? "playerChoice" : "kpDecision",
    choiceKind: "reaction",
    reactionKind: "shield",
    triggerKind: ownerFrame.effectKind === "attackHit" ? "attackHit" : "magicMissileTargeted",
    triggerInstanceId: `trigger:${String(ownerFrame.castId ?? ownerFrame.abilityRef)}:shield:${targetEntityId}`,
    controllerEntityId: targetEntityId,
    targetEntityId,
    candidateAbilityRefs,
    ownerFrame: structuredClone(ownerFrame),
    continuation: structuredClone(continuation),
  };
  return sequence("awaitingInput", profiles, state, String(ownerFrame.rootActionId), [{
    eventType: "ReactionOpportunityOpened",
    payload: { pending },
    secrecy: "private",
  }], { pending: publicPending(pending) });
}

function postAttackDiceSpecs(
  state: AuthoritativeWorldState,
  operation: JsonRecord,
): DiceSpec[] {
  if (!isRecord(operation.definition) || !Array.isArray(operation.targetEntityIds)
    || !isNonEmptyString(operation.abilityRef)) throw new TypeError("post-attack operation is malformed");
  const definition = operation.definition;
  const targetIds = operation.targetEntityIds.filter(isNonEmptyString);
  const specs: DiceSpec[] = [];
  if (Array.isArray(definition.damage) && definition.damage.length > 0) {
    specs.push({
      purposeKey: `damage:${purposeStem(String(operation.abilityRef))}`,
      dice: damageDice(definition),
      frozenParameters: {
        targetEntityIds: targetIds,
        components: structuredClone(definition.damage),
      },
    });
  }
  return specs;
}

function requestPostAttackDamage(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  operation: JsonRecord,
  mechanicalResult: JsonRecord,
): StepResult {
  const specs = postAttackDiceSpecs(state, operation);
  if (specs.length === 0) {
    return sequence("committed", profiles, state, rootActionId, [{
      eventType: "SpellResolved",
      payload: {
        castId: `attack-resolution:${rootActionId}`,
        sourceEntityId: operation.sourceEntityId,
        abilityRef: operation.abilityRef,
        outcome: { kind: "attack", hit: true, damage: false },
      },
    }], { mechanicalResult });
  }
  return awaitRandomness(profiles, state, rootActionId, {
    kind: "resolvePostAttackDamage",
    operation: structuredClone(operation),
    mechanicalResult: structuredClone(mechanicalResult),
  }, specs);
}

function resolvePostAttackDamageRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  if (!isRecord(resolution.operation)
    || resolution.operation.kind !== "resolvePostAttackDamage"
    || !isRecord(resolution.operation.operation)
    || !isRecord(resolution.operation.mechanicalResult)) {
    return rejected("invalidRulesInput", "Post-attack continuation is malformed.");
  }
  const stored = resolution.operation.operation;
  const source = combatEntity(state, stored.sourceEntityId);
  if (source === undefined) return rejected("privateOrUnknownReference", "Post-attack source is unavailable.");
  const adapted = {
    ...structuredClone(resolution),
    operation: {
      ...structuredClone(stored),
      kind: "resolveCombatAbility",
      sourcePatch: structuredClone(source),
      spent: [],
      costsCommitted: true,
      invocationCommitted: true,
      attackAlreadyResolved: true,
      mechanical: structuredClone(resolution.operation.mechanicalResult),
    },
  };
  return resolveCombatAbilityRandomness(profiles, state, adapted, faces);
}

function resolveSpellAbilityRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  if (!isRecord(resolution.operation)
    || resolution.operation.kind !== "resolveSpellAbilityEffect"
    || !isRecord(resolution.operation.spellFrame)) {
    return rejected("invalidRulesInput", "Spell continuation is malformed.");
  }
  const frame = resolution.operation.spellFrame;
  if (!isRecord(frame.effect) || frame.effect.kind !== "ability"
    || !isRecord(frame.effect.definition) || !Array.isArray(frame.effect.targetEntityIds)
    || !isRecord(frame.effect.mechanical)) {
    return rejected("invalidRulesInput", "Spell ability continuation is malformed.");
  }
  const source = combatEntity(state, frame.sourceEntityId);
  if (source === undefined) return rejected("privateOrUnknownReference", "Spell source is unavailable.");
  const adapted = {
    ...structuredClone(resolution),
    operation: {
      kind: "resolveCombatAbility",
      resolutionKind: "ability",
      sourceEntityId: frame.sourceEntityId,
      targetEntityIds: structuredClone(frame.effect.targetEntityIds),
      abilityRef: frame.abilityRef,
      definition: structuredClone(frame.effect.definition),
      sourcePatch: structuredClone(source),
      spent: [],
      costsCommitted: true,
      mechanical: structuredClone(frame.effect.mechanical),
      encounterId: frame.effect.encounterId ?? null,
      afterDamageSpellFrame: structuredClone(frame),
    },
  };
  const resolved = resolveCombatAbilityRandomness(profiles, state, adapted, faces);
  if (resolved.kind !== "committed") return resolved;
  const completed = sequence("committed", profiles, resolved.state, String(frame.rootActionId), [
    spellEventDraft("SpellResolved", frame, { kind: "ability", succeeded: true }),
  ]);
  return appendTransitions(resolved, completed);
}

function resolveCounterspellCheckRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  if (!isRecord(resolution.operation)
    || resolution.operation.kind !== "resolveCounterspellCheck"
    || !isRecord(resolution.operation.counterFrame)) {
    return rejected("invalidRulesInput", "Counterspell continuation is malformed.");
  }
  const frame = resolution.operation.counterFrame;
  if (!isRecord(frame.effect) || frame.effect.kind !== "counterspell"
    || !isRecord(frame.effect.targetCast)) {
    return rejected("invalidRulesInput", "Counterspell target continuation is malformed.");
  }
  const caster = combatEntity(state, frame.sourceEntityId);
  if (caster === undefined || !isRecord(caster.spellcasting)
    || !isNonEmptyString(caster.spellcasting.ability)) {
    return rejected("privateOrUnknownReference", "Counterspell caster is unavailable.");
  }
  const ability = String(caster.spellcasting.ability);
  const roll = faces.get(`check:counterspell:${entityId(caster)}`)?.[0];
  if (roll === undefined) return rejected("invalidRulesInput", "Counterspell ability-check face is unavailable.");
  const dc = 10 + Number(frame.effect.targetCast.spellLevel ?? 0);
  const total = roll + abilityModifier(caster, ability);
  const succeeded = total >= dc;
  const drafts: Draft[] = [spellEventDraft("SpellResolved", frame, {
    kind: "counterspell2014",
    automatic: false,
    ability,
    roll,
    modifier: abilityModifier(caster, ability),
    total,
    dc,
    succeeded,
  })];
  if (succeeded) {
    drafts.push(spellEventDraft("SpellCountered", frame.effect.targetCast, {
      counteredByCastId: frame.castId,
    }));
    const targetContinuation = isRecord(frame.effect.targetCast.onPrevented)
      ? frame.effect.targetCast.onPrevented
      : { kind: "stop" };
    return executeSpellContinuation(profiles, state, String(frame.rootActionId), targetContinuation, drafts);
  }
  const continuation = isRecord(frame.onPrevented)
    ? frame.onPrevented
    : { kind: "resolveSpell", spellFrame: frame.effect.targetCast };
  return executeSpellContinuation(profiles, state, String(frame.rootActionId), continuation, drafts);
}

function resolveCombatAbilityRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation) || operation.kind !== "resolveCombatAbility"
    || !isNonEmptyString(operation.sourceEntityId) || !isNonEmptyString(operation.abilityRef)
    || !isRecord(operation.definition) || !Array.isArray(operation.targetEntityIds)) {
    return rejected("invalidRulesInput", "Combat ability continuation is malformed.");
  }
  const root = String(resolution.rootActionId);
  const source = combatEntity(state, operation.sourceEntityId);
  if (source === undefined) return rejected("privateOrUnknownReference", "Combat ability source is unavailable.");

  if (operation.resolutionKind === "shove" || operation.resolutionKind === "grapple") {
    const targetId = String(operation.targetEntityIds[0]);
    const target = combatEntity(state, targetId);
    if (target === undefined || !Array.isArray(resolution.randomnessRequests)) {
      return rejected("privateOrUnknownReference", "Special melee contest target is unavailable.");
    }
    const contestKind = String(operation.resolutionKind);
    const targetPurpose = `check:${contestKind}:${targetId}`;
    const targetRequest = resolution.randomnessRequests.find((entry) =>
      isRecord(entry) && entry.purposeKey === targetPurpose);
    const frozen = isRecord(targetRequest) && isRecord(targetRequest.frozenParameters)
      ? targetRequest.frozenParameters
      : undefined;
    const defenderAbilityName = frozen?.ability === "acrobatics" ? "acrobatics" : "athletics";
    const defenderAbility = defenderAbilityName === "acrobatics" ? "dex" : "str";
    const sourceTotal = Number(faces.get(`check:${contestKind}:${operation.sourceEntityId}`)?.[0])
      + abilityModifier(source, "str") + Number(source.proficiencyBonus ?? 0);
    const targetTotal = Number(faces.get(targetPurpose)?.[0])
      + abilityModifier(target, defenderAbility) + Number(target.proficiencyBonus ?? 0);
    const winnerEntityId = sourceTotal > targetTotal ? String(operation.sourceEntityId) : targetId;
    const mechanicalResult = { contest: {
      kind: "opposedAbilityCheck2014",
      sourceAbility: "athletics",
      defenderAbility: defenderAbilityName,
      sourceTotal,
      targetTotal,
      winnerEntityId,
      tieWinnerEntityId: targetId,
    } };
    const drafts = resourceAndInvocationDrafts(operation, mechanicalResult);
    if (winnerEntityId === operation.sourceEntityId) {
      drafts.push({ eventType: "ConditionChanged", payload: {
        entityId: targetId,
        conditions: {
          ...(isRecord(target.conditions) ? target.conditions : {}),
          ...(contestKind === "grapple"
            ? { grappledBy: operation.sourceEntityId }
            : { prone: true }),
        },
      } });
    }
    const committed = sequence(
      "committed",
      profiles,
      state,
      root,
      drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })),
      { mechanicalResult },
    );
    if (committed.kind !== "committed"
      || !isRecord(operation.reactionContext)
      || operation.reactionContext.kind !== "readiedResponse"
      || !isRecord(operation.reactionContext.pending)) return committed;
    const continued = continueAfterReadyResponse(
      profiles,
      committed.state,
      operation.reactionContext.pending,
    );
    return continued === undefined ? committed : appendTransitions(committed, continued);
  }

  if (operation.resolutionKind === "healing") {
    const target = combatEntity(state, operation.targetEntityIds[0]);
    if (target === undefined || !isRecord(target.hitPoints) || !isRecord(operation.definition.healing)) {
      return rejected("privateOrUnknownReference", "Healing target is unavailable.");
    }
    const amount = formulaTotal(faces, `healing:${operation.abilityRef}`, String(operation.definition.healing.formula));
    const before = Number(target.hitPoints.current);
    const after = Math.min(Number(target.hitPoints.maximum), before + amount);
    const mechanicalResult = { healing: { rolled: amount, applied: after - before, before, after } };
    const drafts = resourceAndInvocationDrafts(operation, mechanicalResult);
    if (after > before) drafts.push(...interruptStableRecoveryDrafts(
      state,
      entityId(target),
      { kind: "healing", sourceDefinitionId: operation.abilityRef },
    ));
    drafts.push({ eventType: "HealingResolved", payload: { entityId: entityId(target), before: String(before), after: String(after) } });
    return sequence("committed", profiles, state, root, drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })), { mechanicalResult });
  }

  if (operation.resolutionKind === "temporaryHitPoints") {
    const target = combatEntity(state, operation.targetEntityIds[0]);
    if (target === undefined || !isRecord(target.hitPoints)
      || !isRecord(operation.definition.temporaryHitPoints)) {
      return rejected("privateOrUnknownReference", "Temporary-hit-point target is unavailable.");
    }
    const amount = formulaTotal(
      faces,
      `temporary-hit-points:${operation.abilityRef}`,
      String(operation.definition.temporaryHitPoints.formula),
    );
    const before = Number(target.hitPoints.temporary ?? 0);
    const after = Math.max(before, amount);
    const mechanicalResult = { temporaryHitPoints: { rolled: amount, before, after } };
    const drafts = resourceAndInvocationDrafts(operation, mechanicalResult);
    drafts.push({
      eventType: "TemporaryHitPointsGranted",
      payload: {
        entityId: entityId(target),
        sourceDefinitionId: String(operation.abilityRef),
        before: String(before),
        after: String(after),
      },
    });
    return sequence(
      "committed",
      profiles,
      state,
      root,
      drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })),
      { mechanicalResult },
    );
  }

  const definition = operation.definition;
  const targetIds = operation.targetEntityIds.filter(isNonEmptyString);
  const mechanicalResult = isRecord(operation.mechanical) ? structuredClone(operation.mechanical) : {};
  const drafts = resourceAndInvocationDrafts(operation, mechanicalResult);
  let attackHit = true;
  if (isRecord(mechanicalResult.attack)) {
    if (operation.attackAlreadyResolved === true) {
      attackHit = mechanicalResult.attack.hit === true;
    } else {
      const mode = String(mechanicalResult.attack.mode);
      const rolls = faces.get(`attack:${purposeStem(String(operation.abilityRef))}`) ?? [];
      const effectiveArmorClass = Number(mechanicalResult.attack.effectiveArmorClass);
      const attack = resolveCombatAttackRoll(
        source,
        definition,
        effectiveArmorClass,
        rolls,
        mode as "normal" | "advantage" | "disadvantage",
      );
      attackHit = attack.hit;
      mechanicalResult.attack = { ...mechanicalResult.attack, rolls, ...attack };
    }
  }
  if (operation.deferDamageForShield === true) {
    if (!attackHit) {
      return sequence(
        "committed",
        profiles,
        state,
        root,
        drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })),
        { mechanicalResult },
      );
    }
    const targetId = targetIds[0];
    const target = combatEntity(state, targetId);
    const shieldRefs = target === undefined || !reactionAvailable(target)
      ? []
      : reactionSpellRefs(state, target, "shield");
    const continuation = {
      kind: "postAttackDamage",
      operation: {
        ...structuredClone(operation),
        costsCommitted: true,
        invocationCommitted: true,
        attackAlreadyResolved: true,
        deferDamageForShield: false,
      },
      mechanicalResult: structuredClone(mechanicalResult),
    };
    const committedDrafts = drafts.map((draft) => ({
      ...draft,
      resolutionId: String(resolution.resolutionId),
    }));
    if (shieldRefs.length === 0) {
      return executeSpellContinuation(profiles, state, root, continuation, committedDrafts);
    }
    const ownerFrame = {
      castId: `attack:${root}`,
      rootActionId: root,
      sourceEntityId: operation.sourceEntityId,
      abilityRef: operation.abilityRef,
      effectKind: "attackHit",
    };
    return afterDrafts(profiles, state, root, committedDrafts, (nextState) =>
      openShieldWindow(profiles, nextState, ownerFrame, targetId, shieldRefs, continuation));
  }
  const saves: Record<string, JsonRecord> = {};
  if (isRecord(definition.save)) {
    for (const targetId of targetIds) {
      const target = combatEntity(state, targetId);
      if (target === undefined) continue;
      const ability = String(definition.save.ability);
      const mode = savingThrowMode(target, ability);
      const rolls = faces.get(`save:${saveStem(String(operation.abilityRef))}:${targetId}`) ?? [];
      const roll = selectedD20(rolls, mode);
      const dc = Number(definition.save.dc ?? (isRecord(source.spellcasting) ? source.spellcasting.spellSaveDc : 10));
      const total = roll + abilityModifier(target, ability);
      saves[targetId] = { ability, dc, mode, rolls, roll, total, success: total >= dc };
    }
    mechanicalResult.saves = saves;
  }

  const damageResults: Array<{ targetId: string; resolution: ReturnType<typeof resolveCombatDamage> }> = [];
  const concentrationChecks: JsonRecord[] = [];
  let knockOutPending: JsonRecord | undefined;
  if (attackHit && Array.isArray(definition.damage) && definition.damage.length > 0) {
    const baseRolled = rolledDamageComponents(definition, faces, `damage:${purposeStem(String(operation.abilityRef))}`);
    for (const targetId of targetIds) {
      const target = combatEntity(state, targetId);
      if (target === undefined) continue;
      const rolled = saves[targetId]?.success === true && isRecord(definition.save) && definition.save.halfOnSuccess === true
        ? baseRolled.map((component) => ({ ...component, rolled: Math.floor(component.rolled / 2) }))
        : baseRolled;
      const melee = isRecord(definition.target) && isNonEmptyString(definition.target.reachInches)
        && entitiesWithinRange(source, target, String(definition.target.reachInches));
      const criticalHit = isRecord(mechanicalResult.attack)
        && (Number(mechanicalResult.attack.selected) === 20
          || (melee && condition(target, "unconscious")));
      const damage = damageDraft(
        target,
        rolled,
        operation.encounterId,
        String(operation.abilityRef),
        criticalHit,
      );
      damageResults.push({ targetId, resolution: damage.resolution });
      const beforeCurrent = isRecord(target.hitPoints) ? Number(target.hitPoints.current) : 0;
      const afterCurrent = isRecord(damage.resolution.targetPatch.hitPoints)
        ? Number(damage.resolution.targetPatch.hitPoints.current)
        : beforeCurrent;
      const eligibleKnockOut = knockOutPending === undefined
        && isRecord(definition.attack)
        && melee
        && beforeCurrent > 0
        && afterCurrent === 0;
      if (eligibleKnockOut) {
        const knockOutPatch = structuredClone(damage.resolution.targetPatch);
        knockOutPatch.lifeState = "unconscious";
        knockOutPatch.deathSaves = { successes: 0, failures: 0 };
        knockOutPatch.conditions = {
          ...(isRecord(knockOutPatch.conditions) ? knockOutPatch.conditions : {}),
          stable: true,
          unconscious: true,
          prone: true,
        };
        const lethalPayload = structuredClone(damage.draft.payload);
        const knockOutPayload = {
          ...structuredClone(damage.draft.payload),
          targetPatch: knockOutPatch,
        };
        knockOutPending = {
          pendingInputId: `pending:${root}:knock-out:${targetId}`,
          rootActionId: root,
          kind: source.kind === "player" ? "playerChoice" : "kpDecision",
          choiceKind: "knockOut",
          controllerEntityId: entityId(source),
          targetEntityId: targetId,
          lethalDamagePayload: lethalPayload,
          knockOutDamagePayload: knockOutPayload,
          lethalCreatureDied: damage.died,
          concentrationWasActive: isRecord(target.concentration),
          ...(isRecord(operation.afterDamageSpellFrame)
            ? { afterDamageSpellFrame: structuredClone(operation.afterDamageSpellFrame) }
            : {}),
          mechanicalResult: structuredClone(mechanicalResult),
        };
      } else {
        if (damage.resolution.totalApplied > 0) drafts.push(...interruptStableRecoveryDrafts(
          state,
          targetId,
          { kind: "damage", sourceDefinitionId: operation.abilityRef },
        ));
        drafts.push(damage.draft);
        if (isRecord(target.concentration) && damage.resolution.totalApplied > 0) {
          if (afterCurrent === 0 || damage.died) {
            drafts.push({
              eventType: "ConcentrationEnded",
              payload: { entityId: targetId, reason: "incapacitatedByDamage" },
            });
          } else {
            concentrationChecks.push({
              targetEntityId: targetId,
              purposeKey: concentrationPurpose(String(operation.abilityRef), definition, targetId),
              sourceAbilityRef: operation.abilityRef,
              damageTaken: damage.resolution.totalApplied,
              dc: Math.max(10, Math.floor(damage.resolution.totalApplied / 2)),
              modifier: abilityModifier(target, "con"),
            });
          }
        }
        if (damage.died) drafts.push({ eventType: "CreatureDied", payload: { characterId: targetId, causeId: root } });
      }
    }
  }
  if (damageResults.length === 1) {
    mechanicalResult.damage = {
      components: damageResults[0].resolution.components,
      totalApplied: damageResults[0].resolution.totalApplied,
    };
  } else if (damageResults.length > 1) {
    mechanicalResult.damage = Object.fromEntries(damageResults.map(({ targetId, resolution: result }) => [targetId, {
      components: result.components,
      totalApplied: result.totalApplied,
    }]));
  }
  if (knockOutPending !== undefined) {
    knockOutPending.mechanicalResult = structuredClone(mechanicalResult);
    return sequence("awaitingInput", profiles, state, root, [
      ...drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })),
      {
        eventType: "CombatPendingOpened",
        payload: { pending: knockOutPending },
        resolutionId: String(resolution.resolutionId),
        secrecy: "private",
      },
    ], { pending: publicPending(knockOutPending), mechanicalResult });
  }
  return continueAfterDamageConcentration(
    profiles,
    state,
    root,
    drafts.map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })),
    concentrationChecks,
    mechanicalResult,
    isRecord(operation.afterDamageSpellFrame) ? operation.afterDamageSpellFrame : undefined,
  );
}

function movementPatch(
  source: JsonRecord,
  path: Array<{ x: string; y: string; elevation: string }>,
  distanceMilliInches = pathLengthMilliInches(path),
  squeezingAtEndpoint?: boolean,
): { patch: JsonRecord; distanceMilliInches: string } {
  const patch = structuredClone(source);
  patch.position = structuredClone(path[path.length - 1]);
  if (squeezingAtEndpoint !== undefined) {
    const conditions = isRecord(patch.conditions) ? patch.conditions : {};
    if (squeezingAtEndpoint) conditions.squeezing = true;
    else delete conditions.squeezing;
    patch.conditions = conditions;
  }
  const movement = isRecord(patch.movement) ? patch.movement : { spentMilliInches: "0" };
  movement.spentMilliInches = (BigInt(String(movement.spentMilliInches ?? "0")) + BigInt(distanceMilliInches)).toString();
  patch.movement = movement;
  return { patch, distanceMilliInches };
}

function movementSpeedInches(entity: JsonRecord, movementMode: string): unknown {
  if (isRecord(entity.conditions) && isNonEmptyString(entity.conditions.grappledBy)) return "0";
  return isRecord(entity.speedInches) ? entity.speedInches[movementMode] : undefined;
}

function movementContinuation(
  encounterId: unknown,
  movingEntityId: unknown,
  movementMode: unknown,
  remainingPath: unknown,
): JsonRecord | undefined {
  const path = canonicalizeCombatPath(remainingPath);
  if (![encounterId, movingEntityId, movementMode].every(isNonEmptyString)
    || path === undefined || path.length < 2) return undefined;
  return {
    kind: "movementContinuation",
    encounterId,
    movingEntityId,
    movementMode,
    remainingPath: path,
  };
}

function canonicalMovementContinuation(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, ["encounterId", "kind", "movementMode", "movingEntityId", "remainingPath"])
    && value.kind === "movementContinuation"
    && movementContinuation(
      value.encounterId,
      value.movingEntityId,
      value.movementMode,
      value.remainingPath,
    ) !== undefined;
}

function reactionCandidates(
  state: AuthoritativeWorldState,
  source: JsonRecord,
  path: Array<{ x: string; y: string; elevation: string }>,
): string[] {
  if (source.kind !== "npc" && source.entityKind !== "npc") return [];
  const start = { ...source, position: path[0] };
  const end = { ...source, position: path[path.length - 1] };
  return hostileCandidates(state, entityId(source)).filter((id) => {
    const reactor = combatEntity(state, id);
    return reactor?.kind === "player" && reactor.lifeState !== "dead"
      && (!isRecord(reactor.turn) || Number(reactor.turn.reaction ?? 1) > 0)
      && entitiesWithinRange(start, reactor, "60") && !entitiesWithinRange(end, reactor, "60");
  });
}

function canonicalEntityIdSequence(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && value.length === new Set(value).size;
}

function continueMovement(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  continuation: JsonRecord,
  excludedReactionEntityIds: ReadonlySet<string> = new Set(),
): StepResult | undefined {
  if (!canonicalMovementContinuation(continuation)) {
    throw new TypeError("movement continuation is malformed");
  }
  const source = combatEntity(state, continuation.movingEntityId);
  const encounter = state.combatRuntime.encounters[String(continuation.encounterId)];
  const path = canonicalizeCombatPath(continuation.remainingPath);
  if (source === undefined || source.lifeState === "dead" || encounter === undefined || path === undefined
    || !currentGroupAllows(encounter, entityId(source))
    || JSON.stringify(source.position) !== JSON.stringify(path[0])) return undefined;

  const movementMode = String(continuation.movementMode);
  const speed = movementSpeedInches(source, movementMode);
  const spentBefore = isRecord(source.movement)
    ? String(source.movement.spentMilliInches ?? "0")
    : "0";
  const remainingDistance = pathLengthMilliInches(path);
  if (!canonicalIntegerString(speed, 0, 1_000_000)
    || !canonicalIntegerString(spentBefore, 0, Number.MAX_SAFE_INTEGER)
    || BigInt(spentBefore) + BigInt(remainingDistance) > BigInt(String(speed)) * 1_000n) {
    return undefined;
  }

  const scene = state.combatRuntime.scenes[String(source.sceneId)];
  let segmentEndIndex = 1;
  let analyzed = analyzeCombatMovement(
    source,
    Object.values(state.combatRuntime.entities),
    isRecord(scene) ? scene : undefined,
    path.slice(0, segmentEndIndex + 1),
    new Set(hostileCandidates(state, entityId(source))),
  );
  while (!analyzed.ok && analyzed.code === "occupiedEndpoint" && segmentEndIndex < path.length - 1) {
    segmentEndIndex += 1;
    analyzed = analyzeCombatMovement(
      source,
      Object.values(state.combatRuntime.entities),
      isRecord(scene) ? scene : undefined,
      path.slice(0, segmentEndIndex + 1),
      new Set(hostileCandidates(state, entityId(source))),
    );
  }
  if (!analyzed.ok) return undefined;
  const moved = movementPatch(
    source,
    analyzed.path,
    analyzed.totalMilliInches,
    analyzed.squeezingAtEndpoint,
  );
  if (BigInt(spentBefore) + BigInt(moved.distanceMilliInches) > BigInt(String(speed)) * 1_000n) {
    return undefined;
  }

  const candidates = reactionCandidates(state, source, analyzed.path)
    .filter((candidateEntityId) => !excludedReactionEntityIds.has(candidateEntityId));
  if (candidates.length > 0) {
    const processedReactionEntityIds = [...excludedReactionEntityIds];
    const pending = {
      pendingInputId: `pending:${rootActionId}:reaction:${processedReactionEntityIds.length + 1}`,
      rootActionId,
      kind: "playerChoice",
      choiceKind: "reaction",
      controllerEntityId: candidates[0],
      candidateAbilityRefs: ["action:opportunity-attack"],
      reactionQueue: candidates,
      reactionIndex: 0,
      processedReactionEntityIds,
      movementContinuation: structuredClone(continuation),
    };
    return sequence("awaitingInput", profiles, state, rootActionId, [{
      eventType: "ReactionOffered",
      payload: { pending },
      secrecy: "private",
    }], { pending: publicPending(pending) });
  }

  const remaining = segmentEndIndex < path.length - 1
    ? movementContinuation(
        continuation.encounterId,
        continuation.movingEntityId,
        continuation.movementMode,
        path.slice(segmentEndIndex),
      )
    : undefined;
  const movementDraft: Draft = {
    eventType: "MovementSegmentCommitted",
    payload: {
      encounterId: continuation.encounterId,
      sourceEntityId: continuation.movingEntityId,
      path: analyzed.path,
      distanceMilliInches: moved.distanceMilliInches,
      movementAuthority: "activeTurn",
      movementMode: continuation.movementMode,
      entityPatch: moved.patch,
    },
  };
  return afterDraftsOptional(profiles, state, rootActionId, [movementDraft], (nextState) => {
    const readyQueue = readyEffectsForTrigger(
      nextState,
      "movementCommitted",
      String(continuation.movingEntityId),
    );
    if (readyQueue.length > 0) {
      return openReadyBatch(profiles, nextState, rootActionId, readyQueue, remaining);
    }
    return remaining === undefined
      ? undefined
      : continueMovement(profiles, nextState, rootActionId, remaining);
  });
}

function moveCombatant(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["encounterId", "kind", "movementMode", "path", "rootActionId", "sourceEntityId"])
    || ![input.encounterId, input.movementMode, input.rootActionId, input.sourceEntityId].every(isNonEmptyString)
    || !Array.isArray(input.path) || input.path.length < 2) return rejected("invalidRulesInput", "Combat movement is not canonical.");
  const root = rootAction(state, input); const source = combatEntity(state, input.sourceEntityId);
  const encounter = state.combatRuntime.encounters[String(input.encounterId)];
  const canonicalPath = canonicalizeCombatPath(input.path);
  if (root === undefined || source === undefined || encounter === undefined || canonicalPath === undefined) return rejected("privateOrUnknownReference", "Combat movement source is unavailable.");
  if (!currentGroupAllows(encounter, entityId(source))) {
    return rejected("invalidRulesInput", "Only the active initiative group may move this combatant.");
  }
  if (JSON.stringify(source.position) !== JSON.stringify(canonicalPath[0])) return rejected("invalidRulesInput", "Movement path does not start at the authoritative position.");
  const speed = movementSpeedInches(source, String(input.movementMode));
  const spentBefore = isRecord(source.movement)
    ? String(source.movement.spentMilliInches ?? "0")
    : "0";
  const directDistance = pathLengthMilliInches(canonicalPath);
  if (!canonicalIntegerString(speed, 0, 1_000_000)
    || !canonicalIntegerString(spentBefore, 0, Number.MAX_SAFE_INTEGER)
    || BigInt(spentBefore) + BigInt(directDistance) > BigInt(String(speed)) * 1_000n) {
    return rejected("invalidRulesInput", "The path exceeds the remaining movement for this movement mode.");
  }
  const scene = state.combatRuntime.scenes[String(source.sceneId)];
  const preflight = analyzeCombatMovement(
    source,
    Object.values(state.combatRuntime.entities),
    isRecord(scene) ? scene : undefined,
    canonicalPath,
    new Set(hostileCandidates(state, entityId(source))),
  );
  if (!preflight.ok) return rejected("privateOrUnknownReference", "The movement path is unavailable.");
  if (BigInt(spentBefore) + BigInt(preflight.totalMilliInches) > BigInt(String(speed)) * 1_000n) {
    return rejected("invalidRulesInput", "The path exceeds the remaining movement for this movement mode.");
  }
  const continuation = movementContinuation(
    input.encounterId,
    input.sourceEntityId,
    input.movementMode,
    canonicalPath,
  );
  if (continuation === undefined) return rejected("invalidRulesInput", "Combat movement is not canonical.");
  const result = continueMovement(profiles, state, root, continuation);
  return result ?? rejected("privateOrUnknownReference", "The movement path is unavailable.");
}

function canonicalReadyTrigger(value: unknown): value is JsonRecord {
  return isRecord(value)
    && hasExactKeys(value, ["event", "kind", "sourceEntityId"])
    && value.kind === "perceivable"
    && ["turnStarted", "movementCommitted", "spellCastingStarted"].includes(String(value.event))
    && isNonEmptyString(value.sourceEntityId);
}

function canonicalReadyResponse(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return false;
  if (value.kind === "move") {
    return hasExactKeys(value, ["kind", "movementMode", "path"])
      && isNonEmptyString(value.movementMode)
      && Array.isArray(value.path)
      && value.path.length >= 2
      && canonicalizeCombatPath(value.path) !== undefined;
  }
  return value.kind === "invokeAbility"
    && hasExactKeys(value, ["abilityRef", "kind", "parameters"])
    && isNonEmptyString(value.abilityRef)
    && isRecord(value.parameters);
}

function readyAction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["encounterId", "kind", "response", "rootActionId", "sourceEntityId", "trigger"])
    || ![input.encounterId, input.rootActionId, input.sourceEntityId].every(isNonEmptyString)
    || !canonicalReadyTrigger(input.trigger)
    || !canonicalReadyResponse(input.response)) {
    return rejected("invalidRulesInput", "Ready input is not canonical.");
  }
  const root = rootAction(state, input);
  const source = combatEntity(state, input.sourceEntityId);
  const encounter = state.combatRuntime.encounters[String(input.encounterId)];
  const triggerSource = combatEntity(state, input.trigger.sourceEntityId);
  if (root === undefined || source === undefined || encounter === undefined
    || triggerSource === undefined || !currentGroupAllows(encounter, entityId(source))) {
    return rejected("privateOrUnknownReference", "Ready source or perceptible trigger is unavailable.");
  }
  if (Object.values(state.combatRuntime.effects).some((effect) =>
    effect.kind === "readiedAction" && effect.sourceEntityId === entityId(source))) {
    return rejected("invalidRulesInput", "This combatant already has a readied response.");
  }
  const readyDefinition = {
    activation: { kind: "action" },
  };
  const sourcePatch = consumeTurnGrant(source, readyDefinition, "action:ready");
  if (sourcePatch === undefined) return rejected("invalidRulesInput", "The normal action grant is unavailable for Ready.");
  const ready = {
    effectId: `effect:ready:${root}`,
    kind: "readiedAction",
    sourceEntityId: entityId(source),
    encounterId: input.encounterId,
    trigger: structuredClone(input.trigger),
    response: structuredClone(input.response),
    createdRound: Number(encounter.round),
    expiresAt: combatPhaseExpiryAnchor(
      state,
      entityId(source),
      "turnStart",
      root,
    ),
    spellAlreadyCast: false,
  };
  if (input.response.kind !== "invokeAbility") {
    return sequence("committed", profiles, state, root, [{
      eventType: "ReadiedActionCreated",
      payload: { ready, sourcePatch },
      secrecy: "private",
    }]);
  }
  const abilityRef = String(input.response.abilityRef);
  const builtinDefinition = builtinSpecialMeleeDefinition(abilityRef);
  const definition = builtinDefinition ?? state.combatRuntime.definitions[abilityRef];
  if (definition === undefined
    || (builtinDefinition === undefined && !abilityRefs(source).includes(abilityRef))) {
    return rejected("privateOrUnknownReference", "Readied ability is unavailable.");
  }
  if (!isSpellDefinition(definition)) {
    ready.spellAlreadyCast = false;
    return sequence("committed", profiles, state, root, [{
      eventType: "ReadiedActionCreated",
      payload: { ready, sourcePatch },
      secrecy: "private",
    }]);
  }
  if (activationKind(definition) !== "actionSpell") {
    return rejected("invalidRulesInput", "Only a spell with a casting time of one action can be readied.");
  }
  const spent = spendCosts(sourcePatch, definition);
  if (spent === undefined) return rejected("insufficientResource", "The readied spell slot is unavailable.");
  ready.spellAlreadyCast = true;
  const responseParameters = isRecord(input.response.parameters) ? input.response.parameters : {};
  const frame = {
    castId: `cast:${root}:ready`,
    rootActionId: root,
    sourceEntityId: entityId(source),
    abilityRef,
    spellLevel: definitionSpellLevel(definition),
    slotLevel: Number(responseParameters.slotLevel ?? definitionSpellLevel(definition)),
    depth: 0,
    effect: { kind: "holdReadiedSpell", ready: structuredClone(ready) },
    onPrevented: { kind: "stop" },
  };
  const prefix: Draft[] = isRecord(source.concentration)
    ? [{ eventType: "ConcentrationEnded", payload: { entityId: entityId(source), reason: "replacedByReadiedSpell" } }]
    : [];
  return beginSpellFrame(profiles, state, frame, sourcePatch, spent, prefix);
}

function readyEffectsForTrigger(
  state: AuthoritativeWorldState,
  event: string,
  sourceEntityId: string,
): JsonRecord[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect) => effect.kind === "readiedAction"
      && isRecord(effect.trigger)
      && effect.trigger.kind === "perceivable"
      && effect.trigger.event === event
      && effect.trigger.sourceEntityId === sourceEntityId)
    .sort((left, right) => {
      const ordered = triggerOrder(state, sourceEntityId, [String(left.sourceEntityId), String(right.sourceEntityId)]);
      const difference = ordered.indexOf(String(left.sourceEntityId)) - ordered.indexOf(String(right.sourceEntityId));
      return difference || String(left.effectId).localeCompare(String(right.effectId));
    });
}

function readyBatch(
  state: AuthoritativeWorldState,
  rootActionId: string,
  queue: JsonRecord[],
) {
  const trigger = isRecord(queue[0]?.trigger) ? queue[0].trigger : {};
  const sourceEntityId = isNonEmptyString(trigger.sourceEntityId)
    ? trigger.sourceEntityId
    : String(queue[0]?.sourceEntityId ?? "unknown");
  const baseline = triggerOrder(
    state,
    sourceEntityId,
    queue.map((entry) => String(entry.sourceEntityId)),
  );
  return freezeTriggerBatch(
    rootActionId,
    { event: trigger.event ?? "perceivable", sourceEntityId },
    queue.map((entry) => ({
      triggerInstanceId: `trigger:${rootActionId}:ready:${String(entry.effectId)}`,
      sourceEntityId: String(entry.sourceEntityId),
      sourceKind: state.combatRuntime.entities[String(entry.sourceEntityId)]?.kind as string | undefined,
      controllerEntityId: String(entry.sourceEntityId),
      definitionId: isRecord(entry.response) && isNonEmptyString(entry.response.abilityRef)
        ? entry.response.abilityRef
        : "action:ready-move",
      timing: String(trigger.event ?? "perceivable"),
      mandatory: false,
      secrecy: "private",
    })),
    baseline,
  );
}

function readyResponseStillLegal(
  state: AuthoritativeWorldState,
  ready: JsonRecord,
  controller: JsonRecord | undefined,
): boolean {
  if (controller === undefined || !reactionAvailable(controller)
    || state.combatRuntime.effects[String(ready.effectId)] === undefined
    || !isRecord(ready.response)) return false;
  if (ready.response.kind !== "move") {
    if (ready.response.kind !== "invokeAbility"
      || !isNonEmptyString(ready.response.abilityRef)
      || !isRecord(ready.response.parameters)) return false;
    const builtinDefinition = builtinSpecialMeleeDefinition(ready.response.abilityRef);
    const definition = builtinDefinition
      ?? state.combatRuntime.definitions[ready.response.abilityRef];
    if (definition === undefined
      || (builtinDefinition === undefined && !abilityRefs(controller).includes(ready.response.abilityRef))) {
      return false;
    }
    if (builtinDefinition === undefined) return true;
    return isNonEmptyString(ready.response.parameters.targetEntityId)
      && legalCreatureCandidates(state, controller, definition)
        .includes(ready.response.parameters.targetEntityId)
      && ["athletics", "acrobatics"]
        .includes(String(ready.response.parameters.defenderContestAbility));
  }
  const path = canonicalizeCombatPath(ready.response.path);
  if (path === undefined || JSON.stringify(controller.position) !== JSON.stringify(path[0])) return false;
  const moved = movementPatch(controller, path);
  const speed = movementSpeedInches(controller, String(ready.response.movementMode));
  if (!canonicalIntegerString(speed, 0, 1_000_000)
    || BigInt(moved.distanceMilliInches) > BigInt(String(speed)) * 1_000n) return false;
  return !Object.values(state.combatRuntime.entities).some((other) =>
    entityId(other) !== entityId(controller)
    && other.lifeState !== "dead"
    && other.sceneId === controller.sceneId
    && isRecord(other.position)
    && isRecord(other.footprint)
    && entityOccupanciesOverlap(moved.patch, other));
}

function openReadyBatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  queue: JsonRecord[],
  movementContinuationValue?: JsonRecord,
): StepResult {
  const batch = readyBatch(state, rootActionId, queue);
  const controllerGroups = new Map<string, JsonRecord[]>();
  for (const ready of queue) {
    const entity = combatEntity(state, ready.sourceEntityId);
    const controllerKey = isNonEmptyString(entity?.controllerPrincipalId)
      ? entity.controllerPrincipalId
      : String(ready.sourceEntityId);
    controllerGroups.set(controllerKey, [...(controllerGroups.get(controllerKey) ?? []), ready]);
  }
  const ambiguous = [...controllerGroups.values()].find((entries) => entries.length > 1);
  if (ambiguous === undefined) {
    return openReadyWindow(profiles, state, rootActionId, queue, 0, movementContinuationValue);
  }
  const orderedTriggerInstanceIds = ambiguous.map((entry) =>
    `trigger:${rootActionId}:ready:${String(entry.effectId)}`);
  const controllerEntityId = String(ambiguous[0].sourceEntityId);
  const controller = combatEntity(state, controllerEntityId);
  const pending = {
    pendingInputId: `pending:${rootActionId}:trigger-order`,
    rootActionId,
    kind: controller?.kind === "player" ? "playerChoice" : "kpDecision",
    choiceKind: "triggerOrder",
    controllerEntityId,
    orderedTriggerInstanceIds,
    sameControllerTriggerInstanceIds: [...orderedTriggerInstanceIds],
    readyQueue: structuredClone(queue),
    triggerBatchId: batch.triggerBatchId,
    triggerBatchHash: batch.triggerBatchHash,
    ...(movementContinuationValue === undefined
      ? {}
      : { movementContinuation: structuredClone(movementContinuationValue) }),
  };
  return sequence("awaitingInput", profiles, state, rootActionId, [{
    eventType: "CombatPendingOpened",
    payload: { pending },
    secrecy: "private",
  }], { pending: publicPending(pending) });
}

function openReadyWindow(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  queue: JsonRecord[],
  index = 0,
  movementContinuationValue?: JsonRecord,
): StepResult {
  if (index >= queue.length) throw new TypeError("ready queue cannot open past its end");
  const ready = queue[index];
  const controller = combatEntity(state, ready.sourceEntityId);
  const batch = readyBatch(state, rootActionId, queue);
  if (!readyResponseStillLegal(state, ready, controller)) {
    const invalidated: Draft = {
      eventType: "TriggerInvalidated",
      payload: {
        pendingInputId: `pending:${rootActionId}:ready:${index + 1}`,
        triggerInstanceId: `trigger:${rootActionId}:ready:${String(ready.effectId)}`,
        reason: "readiedResponseNoLongerLegal",
      },
      secrecy: "private",
    };
    return afterDraftsOptional(profiles, state, rootActionId, [invalidated], (nextState) => {
      if (index + 1 < queue.length) {
        return openReadyWindow(
          profiles,
          nextState,
          rootActionId,
          queue,
          index + 1,
          movementContinuationValue,
        );
      }
      return movementContinuationValue === undefined
        ? undefined
        : continueMovement(profiles, nextState, rootActionId, movementContinuationValue);
    });
  }
  if (controller === undefined) throw new TypeError("legal ready trigger lacks a controller");
  const candidateAbilityRefs = isRecord(ready.response) && ready.response.kind === "invokeAbility"
    && isNonEmptyString(ready.response.abilityRef)
    ? [ready.response.abilityRef]
    : ["action:ready-move"];
  const pending = {
    pendingInputId: `pending:${rootActionId}:ready:${index + 1}`,
    rootActionId,
    kind: controller.kind === "player" ? "playerChoice" : "kpDecision",
    choiceKind: "reaction",
    reactionKind: "ready",
    triggerKind: isRecord(ready.trigger) ? ready.trigger.event : "perceivable",
    triggerInstanceId: `trigger:${rootActionId}:ready:${String(ready.effectId)}`,
    controllerEntityId: entityId(controller),
    targetEntityId: isRecord(ready.trigger) ? ready.trigger.sourceEntityId : undefined,
    candidateAbilityRefs,
    readyQueue: structuredClone(queue),
    reactionIndex: index,
    readyEffectId: ready.effectId,
    triggerBatchId: batch.triggerBatchId,
    triggerBatchHash: batch.triggerBatchHash,
    ...(movementContinuationValue === undefined
      ? {}
      : { movementContinuation: structuredClone(movementContinuationValue) }),
  };
  return sequence("awaitingInput", profiles, state, rootActionId, [
    {
      eventType: "ReadiedActionTriggered",
      payload: {
        effectId: ready.effectId,
        sourceEntityId: ready.sourceEntityId,
        triggerEvent: String(isRecord(ready.trigger) ? ready.trigger.event : "perceivable"),
      },
      secrecy: "private",
    },
    {
      eventType: "ReactionOpportunityOpened",
      payload: { pending },
      secrecy: "private",
    },
  ], { pending: publicPending(pending) });
}

function initiativePhaseEntries(encounter: JsonRecord): JsonRecord[] {
  const order = Array.isArray(encounter.turnOrderEntityIds)
    ? encounter.turnOrderEntityIds.filter(isNonEmptyString)
    : [];
  const entries = isRecord(encounter.initiative) && Array.isArray(encounter.initiative.entries)
    ? encounter.initiative.entries.filter(isRecord)
    : [];
  return [...entries].sort((left, right) => {
    const leftMembers = Array.isArray(left.combatantEntityIds)
      ? left.combatantEntityIds.filter(isNonEmptyString)
      : [];
    const rightMembers = Array.isArray(right.combatantEntityIds)
      ? right.combatantEntityIds.filter(isNonEmptyString)
      : [];
    const leftIndex = leftMembers.reduce((minimum, id) => {
      const index = order.indexOf(id);
      return index < 0 ? minimum : Math.min(minimum, index);
    }, Number.POSITIVE_INFINITY);
    const rightIndex = rightMembers.reduce((minimum, id) => {
      const index = order.indexOf(id);
      return index < 0 ? minimum : Math.min(minimum, index);
    }, Number.POSITIVE_INFINITY);
    return leftIndex - rightIndex || String(left.entryId).localeCompare(String(right.entryId));
  });
}

function initiativePhaseOrder(encounter: JsonRecord): {
  entries: JsonRecord[];
  initiativeOrderHash: string;
} {
  const entries = initiativePhaseEntries(encounter);
  return {
    entries,
    initiativeOrderHash: canonicalSha256(entries.map((entry) => ({
      entryId: String(entry.entryId),
      combatantEntityIds: Array.isArray(entry.combatantEntityIds)
        ? entry.combatantEntityIds.filter(isNonEmptyString)
        : [],
    }))),
  };
}

function phaseSlotForEntity(entries: JsonRecord[], targetEntityId: string): number {
  return entries.findIndex((entry) => Array.isArray(entry.combatantEntityIds)
    && entry.combatantEntityIds.includes(targetEntityId));
}

function combatPhaseExpiryAnchor(
  state: AuthoritativeWorldState,
  targetEntityId: string,
  edge: "turnStart" | "turnEnd",
  createdRootActionId: string,
): JsonRecord {
  const encounter = activeEncounter(state, targetEntityId);
  if (encounter === undefined) return { kind: edge, entityId: targetEntityId };
  const { entries, initiativeOrderHash } = initiativePhaseOrder(encounter);
  const slotIndex = phaseSlotForEntity(entries, targetEntityId);
  const currentSlot = phaseSlotForEntity(entries, String(encounter.activeEntityId));
  if (entries.length === 0 || slotIndex < 0 || currentSlot < 0) {
    return { kind: edge, entityId: targetEntityId };
  }
  const currentRound = Number(encounter.round);
  const currentEdge = isRecord(encounter.combatMoment) && encounter.combatMoment.edge === "turnEnd"
    ? "turnEnd"
    : "turnStart";
  const phaseRemainsInCurrentRound = encounter.roundClosed !== true
    && (slotIndex > currentSlot
      || (slotIndex === currentSlot && currentEdge === "turnStart" && edge === "turnEnd"));
  return {
    kind: edge,
    entityId: targetEntityId,
    targetRound: currentRound + (phaseRemainsInCurrentRound ? 0 : 1),
    initiativeOrderHash,
    slotIndex,
    entryCount: entries.length,
    createdAt: {
      rootActionId: createdRootActionId,
      roundIndex: currentRound,
      initiativeOrderHash,
      slotIndex: currentSlot,
      edge: currentEdge,
    },
  };
}

function phaseTaskOrder(left: JsonRecord, right: JsonRecord): number {
  const leftDue = BigInt(String(left.dueMicros));
  const rightDue = BigInt(String(right.dueMicros));
  return leftDue < rightDue ? -1 : leftDue > rightDue ? 1
    : Number(left.slotIndex) - Number(right.slotIndex)
      || (left.edge === right.edge ? 0 : left.edge === "turnStart" ? -1 : 1)
      || String(left.effectId).localeCompare(String(right.effectId));
}

function phaseTasksForConclusion(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  encounter: JsonRecord,
  closeInstantMicros: bigint,
): JsonRecord[] {
  const { entries, initiativeOrderHash } = initiativePhaseOrder(encounter);
  const entryCount = entries.length;
  if (entryCount === 0) return [];
  const currentRound = Number(encounter.round);
  const currentSlot = phaseSlotForEntity(entries, String(encounter.activeEntityId));
  const currentEdge = isRecord(encounter.combatMoment) && encounter.combatMoment.edge === "turnEnd"
    ? "turnEnd"
    : "turnStart";
  const participantIds = Array.isArray(encounter.participantEntityIds)
    ? encounter.participantEntityIds.filter(isNonEmptyString)
    : [];
  return Object.values(state.combatRuntime.effects).flatMap((effect): JsonRecord[] => {
    if (!isNonEmptyString(effect.effectId)
      || !isRecord(effect.expiresAt)
      || !["turnStart", "turnEnd"].includes(String(effect.expiresAt.kind))
      || !isNonEmptyString(effect.expiresAt.entityId)
      || !participantIds.includes(effect.expiresAt.entityId)) return [];
    const targetEntityId = effect.expiresAt.entityId as string;
    const edge = effect.expiresAt.kind as "turnStart" | "turnEnd";
    const savedSlot = Number(effect.expiresAt.slotIndex);
    const slotIndex = Number.isSafeInteger(savedSlot) && savedSlot >= 0 && savedSlot < entryCount
      ? savedSlot
      : phaseSlotForEntity(entries, targetEntityId);
    if (slotIndex < 0) return [];
    const savedTargetRound = Number(effect.expiresAt.targetRound);
    const phaseRemainsInCurrentRound = encounter.roundClosed !== true
      && currentSlot >= 0
      && (slotIndex > currentSlot
        || (slotIndex === currentSlot && currentEdge === "turnStart" && edge === "turnEnd"));
    const targetRound = Number.isSafeInteger(savedTargetRound) && savedTargetRound >= currentRound
      ? savedTargetRound
      : currentRound + (phaseRemainsInCurrentRound ? 0 : 1);
    const dueMicros = targetRound <= currentRound
      ? closeInstantMicros
      : closeInstantMicros
        + (BigInt(targetRound - currentRound - 1) * COMBAT_ROUND_MICROS)
        + combatMomentOffsetMicros(slotIndex, entryCount, edge);
    const taskCore = {
      effectId: effect.effectId as string,
      sourceEntityId: isNonEmptyString(effect.sourceEntityId)
        ? effect.sourceEntityId
        : targetEntityId,
      targetEntityId,
      dueMicros: dueMicros.toString(),
      targetRound,
      initiativeOrderHash: isNonEmptyString(effect.expiresAt.initiativeOrderHash)
        ? effect.expiresAt.initiativeOrderHash
        : initiativeOrderHash,
      slotIndex,
      entryCount,
      edge,
      effectKind: isNonEmptyString(effect.kind) ? effect.kind : "effect",
      timeProfile: structuredClone(profiles.fictionCombatTime),
    };
    return [{
      taskId: `phase-task:${canonicalSha256(taskCore).slice("sha256:".length)}`,
      ...taskCore,
    }];
  }).sort(phaseTaskOrder);
}

function phaseTaskExpiryDrafts(
  state: AuthoritativeWorldState,
  tasks: JsonRecord[],
): Draft[] {
  return [...tasks].sort(phaseTaskOrder).flatMap((task): Draft[] => {
    const effect = state.combatRuntime.effects[String(task.effectId)];
    if (effect === undefined) return [];
    if (effect.kind === "readiedAction") {
      return [
        {
          eventType: "ReadiedActionExpired",
          payload: {
            effectId: effect.effectId,
            sourceEntityId: effect.sourceEntityId,
            reason: "encounterPhaseDue",
          },
          secrecy: "private",
        },
        ...(effect.spellAlreadyCast === true
          ? [{
              eventType: "ConcentrationEnded" as const,
              payload: { entityId: effect.sourceEntityId, reason: "readiedSpellExpired" },
            }]
          : []),
      ];
    }
    return [{
      eventType: "EffectEnded",
      payload: {
        effectId: effect.effectId,
        targetEntityId: task.targetEntityId,
        reason: "encounterPhaseDue",
      },
    }];
  });
}

function readyExpiryDrafts(state: AuthoritativeWorldState, entityIdValue: string): Draft[] {
  return Object.values(state.combatRuntime.effects)
    .filter((effect) => effect.kind === "readiedAction"
      && isRecord(effect.expiresAt)
      && effect.expiresAt.kind === "turnStart"
      && effect.expiresAt.entityId === entityIdValue)
    .sort((left, right) => String(left.effectId).localeCompare(String(right.effectId)))
    .flatMap((effect): Draft[] => [
      {
        eventType: "ReadiedActionExpired",
        payload: {
          effectId: effect.effectId,
          sourceEntityId: effect.sourceEntityId,
          reason: "ownNextTurnStarted",
        },
        secrecy: "private",
      },
      ...(effect.spellAlreadyCast === true
        ? [{
            eventType: "ConcentrationEnded" as const,
            payload: { entityId: effect.sourceEntityId, reason: "readiedSpellExpired" },
          }]
        : []),
    ]);
}

function shieldExpiryDrafts(state: AuthoritativeWorldState, entityIdValue: string): Draft[] {
  return shieldEffects(state, entityIdValue)
    .sort((left, right) => String(left.effectId).localeCompare(String(right.effectId)))
    .map((effect) => ({
      eventType: "EffectEnded",
      payload: { effectId: effect.effectId, targetEntityId: entityIdValue, reason: "ownNextTurnStarted" },
    }));
}

function missedLongSpellcastingDrafts(
  state: AuthoritativeWorldState,
  encounter: JsonRecord,
  sourceEntityId: string,
): Draft[] {
  const source = combatEntity(state, sourceEntityId);
  const concentration = source?.concentration;
  if (!isRecord(concentration)
    || concentration.kind !== "longSpellcasting"
    || !isNonEmptyString(concentration.activityId)
    || concentration.lastInvestedRound === encounter.round
    || state.campaignRuntime.activities[concentration.activityId]?.status !== "active") {
    return [];
  }
  return [
    {
      eventType: "ActivityInterrupted",
      payload: {
        activityId: concentration.activityId,
        cause: {
          kind: "longSpellActionNotInvested",
          encounterId: encounter.encounterId,
          round: encounter.round,
          sourceEntityId,
        },
      },
    },
    {
      eventType: "ConcentrationEnded",
      payload: { entityId: sourceEntityId, reason: "longSpellActionNotInvested" },
    },
  ];
}

function endTurn(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["encounterId", "kind", "rootActionId", "sourceEntityId"])
    || ![input.encounterId, input.rootActionId, input.sourceEntityId].every(isNonEmptyString)) return rejected("invalidRulesInput", "End-turn input is not canonical.");
  if (Object.keys(state.combatRuntime.pendingInputs).length > 0) return rejected("pendingInputUnresolved", "A player or KP decision remains pending; reality-time absence cannot pass a turn.");
  const root = rootAction(state, input);
  const encounter = state.combatRuntime.encounters[String(input.encounterId)];
  if (root === undefined || encounter === undefined || !Array.isArray(encounter.turnOrderEntityIds)) return rejected("privateOrUnknownReference", "Encounter turn is unavailable.");
  const order = encounter.turnOrderEntityIds.filter(isNonEmptyString);
  const cursor = Number(encounter.turnCursor);
  if (order[cursor] !== input.sourceEntityId) return rejected("invalidRulesInput", "Only the authoritative active combatant can end this turn.");
  const drafts: Draft[] = [
    ...missedLongSpellcastingDrafts(state, encounter, String(input.sourceEntityId)),
    { eventType: "TurnEnded", payload: { encounterId: input.encounterId, sourceEntityId: input.sourceEntityId } },
  ];
  if (cursor + 1 < order.length) {
    const nextEntityId = order[cursor + 1];
    drafts.push(...readyExpiryDrafts(state, nextEntityId));
    drafts.push(...shieldExpiryDrafts(state, nextEntityId));
    drafts.push({ eventType: "TurnStarted", payload: { encounterId: input.encounterId, round: Number(encounter.round), sourceEntityId: nextEntityId } });
    const readyQueue = readyEffectsForTrigger(state, "turnStarted", nextEntityId)
      .filter((ready) => ready.sourceEntityId !== nextEntityId);
    if (readyQueue.length === 0) return sequence("committed", profiles, state, root, drafts);
    return afterDrafts(profiles, state, root, drafts, (nextState) =>
      openReadyBatch(
        profiles,
        nextState,
        root,
        readyEffectsForTrigger(nextState, "turnStarted", nextEntityId)
          .filter((ready) => ready.sourceEntityId !== nextEntityId),
      ));
  }
  drafts.push({ eventType: "RoundEnded", payload: { encounterId: input.encounterId, round: Number(encounter.round), fictionAdvanceMicros: COMBAT_ROUND_MICROS.toString() } });
  const deathSaveTargets = Object.values(state.combatRuntime.entities)
    .filter((entity) => entity.deathPolicy === "deathSaves"
      && entity.lifeState !== "dead"
      && (!isRecord(entity.conditions) || entity.conditions.stable !== true)
      && isRecord(entity.hitPoints)
      && Number(entity.hitPoints.current) === 0)
    .map(entityId);
  if (deathSaveTargets.length === 0) {
    drafts.push({ eventType: "RoundStarted", payload: { encounterId: input.encounterId, round: Number(encounter.round) + 1, turnOrderEntityIds: order } });
    const nextEntityId = order[0];
    drafts.push(...readyExpiryDrafts(state, nextEntityId));
    drafts.push(...shieldExpiryDrafts(state, nextEntityId));
    drafts.push({ eventType: "TurnStarted", payload: { encounterId: input.encounterId, round: Number(encounter.round) + 1, sourceEntityId: nextEntityId } });
    const readyQueue = readyEffectsForTrigger(state, "turnStarted", nextEntityId)
      .filter((ready) => ready.sourceEntityId !== nextEntityId);
    if (readyQueue.length === 0) return sequence("committed", profiles, state, root, drafts);
    return afterDrafts(profiles, state, root, drafts, (nextState) =>
      openReadyBatch(
        profiles,
        nextState,
        root,
        readyEffectsForTrigger(nextState, "turnStarted", nextEntityId)
          .filter((ready) => ready.sourceEntityId !== nextEntityId),
      ));
  }
  return awaitRandomness(profiles, state, root, {
    kind: "resolveDeathSavesAndRound",
    encounterId: input.encounterId,
    nextRound: Number(encounter.round) + 1,
    turnOrderEntityIds: order,
    targetEntityIds: deathSaveTargets,
  }, deathSaveTargets.map((targetId) => ({
    purposeKey: `death-save:${targetId}`,
    dice: [{ count: "1", sides: "20" }],
    frozenParameters: { targetEntityId: targetId, naturalOneFailures: 2, successThreshold: 10, deathFailureThreshold: 3 },
  })), drafts);
}

function resolveDeathSavesAndRound(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation) || operation.kind !== "resolveDeathSavesAndRound"
    || !isNonEmptyString(operation.encounterId) || !Array.isArray(operation.targetEntityIds)
    || !Array.isArray(operation.turnOrderEntityIds) || !Number.isSafeInteger(operation.nextRound)) return rejected("invalidRulesInput", "Death-save continuation is malformed.");
  const drafts: Draft[] = [];
  const newlyStableTargetIds: string[] = [];
  for (const targetId of operation.targetEntityIds.filter(isNonEmptyString)) {
    const target = combatEntity(state, targetId);
    const natural = faces.get(`death-save:${targetId}`)?.[0];
    if (target === undefined || natural === undefined) return rejected("privateOrUnknownReference", "Death-save target is unavailable.");
    const patch = structuredClone(target);
    const saves = isRecord(patch.deathSaves) ? patch.deathSaves : { successes: 0, failures: 0 };
    if (natural === 1) saves.failures = Number(saves.failures ?? 0) + 2;
    else if (natural === 20) {
      if (isRecord(patch.hitPoints)) patch.hitPoints.current = "1";
      const conditions = { ...(isRecord(patch.conditions) ? patch.conditions : {}) };
      delete conditions.unconscious;
      delete conditions.stable;
      patch.conditions = conditions;
      patch.lifeState = "alive";
      saves.successes = 0;
      saves.failures = 0;
    } else if (natural >= 10) saves.successes = Number(saves.successes ?? 0) + 1;
    else saves.failures = Number(saves.failures ?? 0) + 1;
    if (Number(saves.successes) >= 3) {
      patch.conditions = { ...(isRecord(patch.conditions) ? patch.conditions : {}), stable: true, unconscious: true };
      saves.successes = 0;
      saves.failures = 0;
      newlyStableTargetIds.push(targetId);
    }
    patch.deathSaves = saves;
    if (Number(saves.failures) >= 3) patch.lifeState = "dead";
    drafts.push({ eventType: "DeathSaveResolved", payload: { entityId: targetId, roll: natural, natural, successes: Number(saves.successes ?? 0), failures: Number(saves.failures ?? 0), entityPatch: patch }, resolutionId: String(resolution.resolutionId) });
    if (patch.lifeState === "dead") {
      if (isRecord(target.concentration)) drafts.push({
        eventType: "ConcentrationEnded",
        payload: { entityId: targetId, reason: "deathSaveFailures" },
        resolutionId: String(resolution.resolutionId),
      });
      drafts.push({ eventType: "CreatureDied", payload: { characterId: targetId, causeId: String(resolution.rootActionId) }, resolutionId: String(resolution.resolutionId) });
    }
  }
  drafts.push({ eventType: "RoundStarted", payload: { encounterId: operation.encounterId, round: operation.nextRound, turnOrderEntityIds: operation.turnOrderEntityIds }, resolutionId: String(resolution.resolutionId) });
  drafts.push({ eventType: "TurnStarted", payload: { encounterId: operation.encounterId, round: operation.nextRound, sourceEntityId: operation.turnOrderEntityIds[0] }, resolutionId: String(resolution.resolutionId) });
  return newlyStableTargetIds.length === 0
    ? sequence("committed", profiles, state, String(resolution.rootActionId), drafts)
    : beginStableRecoverySchedule(
        profiles,
        state,
        String(resolution.rootActionId),
        newlyStableTargetIds,
        drafts,
      );
}

function proposeEncounterConclusion(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["encounterId", "kind", "proposal", "rootActionId"])
    || ![input.encounterId, input.rootActionId].every(isNonEmptyString) || !isRecord(input.proposal)) return rejected("invalidRulesInput", "Encounter conclusion proposal is not canonical.");
  const root = rootAction(state, input); const encounter = state.combatRuntime.encounters[String(input.encounterId)];
  if (root === undefined || encounter === undefined || encounter.status === "concluded") return rejected("privateOrUnknownReference", "Encounter is unavailable.");
  if (Object.keys(state.combatRuntime.pendingInputs).length > 0
    || Object.keys(state.combatRuntime.randomnessResolutions).length > 0) {
    return rejected("pendingInputUnresolved", "Encounter conclusion cannot bypass an unresolved combat phase.");
  }
  const controllerEntityIds = (Array.isArray(encounter.participantEntityIds)
    ? encounter.participantEntityIds.filter(isNonEmptyString)
    : [])
    .map((participantEntityId) => combatEntity(state, participantEntityId))
    .filter((entity): entity is JsonRecord => entity?.kind === "player" && entity.lifeState !== "dead")
    .sort((left, right) => Number(left.entityOrdinal) - Number(right.entityOrdinal)
      || entityId(left).localeCompare(entityId(right)))
    .map(entityId);
  if (controllerEntityIds.length === 0) return rejected("privateOrUnknownReference", "No player can accept the encounter conclusion.");
  if (input.proposal.reason === "playersEscaped") {
    const escapedEntityIds = Array.isArray(input.proposal.escapedEntityIds)
      ? input.proposal.escapedEntityIds.filter(isNonEmptyString)
      : [];
    const factRefs = Array.isArray(input.proposal.factRefs)
      ? input.proposal.factRefs.filter(isNonEmptyString)
      : [];
    const escapedPlayersMatch = escapedEntityIds.length === controllerEntityIds.length
      && escapedEntityIds.length === new Set(escapedEntityIds).size
      && controllerEntityIds.every((controllerEntityId) => escapedEntityIds.includes(controllerEntityId));
    const matchingFactExists = factRefs.length > 0
      && factRefs.length === new Set(factRefs).size
      && factRefs.some((factRef) => {
        const fact = state.canonicalFacts[factRef];
        return fact?.kind === "encounterEscapeCompleted"
          && fact.subjectRefs.length === controllerEntityIds.length
          && controllerEntityIds.every((controllerEntityId) => fact.subjectRefs.includes(controllerEntityId))
          && isRecord(fact.value)
          && fact.value.encounterId === input.encounterId;
      });
    if (!escapedPlayersMatch || !matchingFactExists) {
      return rejected("privateOrUnknownReference", "Completed escape facts are unavailable.");
    }
  }
  const pending = {
    pendingInputId: `pending:${root}:encounter-conclusion`,
    rootActionId: root,
    kind: "playerChoice",
    choiceKind: "encounterConclusion",
    controllerEntityId: controllerEntityIds[0],
    controllerEntityIds,
    controllerIndex: 0,
    encounterId: input.encounterId,
    proposal: structuredClone(input.proposal),
  };
  return sequence("awaitingInput", profiles, state, root, [{ eventType: "EncounterConclusionProposed", payload: { pending, proposal: structuredClone(input.proposal) } }], { pending: publicPending(pending) });
}

function authorityFaces(state: AuthoritativeWorldState, input: JsonRecord): {
  resolution: JsonRecord;
  faces: AuthorityFaces;
} | undefined {
  if (!hasExactKeys(input, ["continuationCapability", "kind", "randomnessResults", "resolutionId", "responseId"])
    || input.kind !== "authoritativeRandomness"
    || ![input.resolutionId, input.responseId, input.continuationCapability].every(isNonEmptyString)
    || !Array.isArray(input.randomnessResults)) return undefined;
  const resolution = state.combatRuntime.randomnessResolutions[String(input.resolutionId)];
  if (resolution === undefined || resolution.continuationCapability !== input.continuationCapability
    || !Array.isArray(resolution.randomnessRequests)
    || resolution.randomnessRequests.length !== input.randomnessResults.length) return undefined;
  const faces = new Map<string, number[]>();
  for (const requestValue of resolution.randomnessRequests) {
    if (!isRecord(requestValue) || !isNonEmptyString(requestValue.randomnessId)
      || !isNonEmptyString(requestValue.purposeKey) || !Array.isArray(requestValue.dice)) return undefined;
    const result = (input.randomnessResults as unknown[]).find((entry) => isRecord(entry)
      && entry.randomnessId === requestValue.randomnessId);
    if (!isRecord(result)
      || !hasExactKeys(result, ["draws", "randomnessId", "requestHash"])
      || result.requestHash !== requestValue.requestHash
      || !Array.isArray(result.draws)
      || result.draws.length !== requestValue.dice.length) return undefined;
    const allFaces: number[] = [];
    for (let index = 0; index < result.draws.length; index++) {
      const draw = result.draws[index];
      const term = requestValue.dice[index];
      if (!isRecord(draw) || !isRecord(term) || !hasExactKeys(draw, ["faces", "sides"])
        || Number(draw.sides) !== Number(term.sides) || !Array.isArray(draw.faces)
        || draw.faces.length !== Number(term.count)
        || !draw.faces.every((face) => Number.isInteger(face) && Number(face) >= 1 && Number(face) <= Number(term.sides))) return undefined;
      allFaces.push(...draw.faces.map(Number));
    }
    faces.set(requestValue.purposeKey, allFaces);
  }
  return { resolution, faces };
}

function establishInitiative(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation) || operation.kind !== "establishInitiative"
    || !isNonEmptyString(operation.encounterId) || !Array.isArray(operation.groups)) {
    return rejected("invalidRulesInput", "Initiative continuation is malformed.");
  }
  const entries = operation.groups.map((raw) => {
    if (!isRecord(raw) || !isNonEmptyString(raw.entryId) || !isNonEmptyString(raw.purposeKey)
      || !Array.isArray(raw.combatantEntityIds) || !Number.isSafeInteger(raw.modifier)) {
      throw new TypeError("initiative group continuation is malformed");
    }
    const roll = faces.get(raw.purposeKey)?.[0];
    if (roll === undefined) throw new TypeError("initiative face is unavailable");
    return {
      entryId: raw.entryId,
      combatantEntityIds: [...raw.combatantEntityIds],
      roll,
      modifier: Number(raw.modifier),
      total: roll + Number(raw.modifier),
    };
  }).sort((left, right) => right.total - left.total);
  const playerTieIds = entries
    .filter((entry, _index, all) => all.some((other) => other !== entry && other.total === entry.total))
    .flatMap((entry) => entry.combatantEntityIds)
    .filter((id) => state.combatRuntime.entities[id]?.kind === "player");
  const pendingInputId = `pending:${resolution.rootActionId}:initiative-tie-order`;
  const tieControllerEntityId = [...playerTieIds].sort((left, right) =>
    Number(state.combatRuntime.entities[left]?.entityOrdinal ?? 0)
    - Number(state.combatRuntime.entities[right]?.entityOrdinal ?? 0))[0];
  const storedPending = {
    pendingInputId,
    rootActionId: resolution.rootActionId,
    kind: "playerChoice",
    choiceKind: "initiativeTieOrder",
    ...(tieControllerEntityId === undefined ? {} : { controllerEntityId: tieControllerEntityId }),
    controllerEntityIds: playerTieIds,
    orderedEntityIds: playerTieIds,
    encounterId: operation.encounterId,
  };
  const publicPending = {
    pendingInputId,
    kind: "playerChoice",
    choiceKind: "initiativeTieOrder",
    ...(tieControllerEntityId === undefined ? {} : { controllerEntityId: tieControllerEntityId }),
    controllerEntityIds: playerTieIds,
    orderedEntityIds: playerTieIds,
  };
  if (playerTieIds.length === 0) {
    const turnOrderEntityIds = entries.flatMap((entry) => entry.combatantEntityIds as string[]);
    return sequence("committed", profiles, state, String(resolution.rootActionId), [
      {
        eventType: "InitiativeEstablished",
        payload: { encounterId: operation.encounterId, entries, pending: storedPending },
        resolutionId: String(resolution.resolutionId),
      },
      {
        eventType: "InitiativeTieOrdered",
        payload: { encounterId: operation.encounterId, orderedEntityIds: [] },
        resolutionId: String(resolution.resolutionId),
      },
      {
        eventType: "CombatPendingClosed",
        payload: { pendingInputId },
        resolutionId: String(resolution.resolutionId),
        secrecy: "internal",
      },
      {
        eventType: "RoundStarted",
        payload: { encounterId: operation.encounterId, round: 1, turnOrderEntityIds },
        resolutionId: String(resolution.resolutionId),
      },
      {
        eventType: "TurnStarted",
        payload: {
          encounterId: operation.encounterId,
          round: 1,
          sourceEntityId: turnOrderEntityIds[0],
        },
        resolutionId: String(resolution.resolutionId),
      },
    ]);
  }
  return sequence("awaitingInput", profiles, state, String(resolution.rootActionId), [{
    eventType: "InitiativeEstablished",
    payload: { encounterId: operation.encounterId, entries, pending: storedPending },
    resolutionId: String(resolution.resolutionId),
  }], { pending: publicPending });
}

function fulfillRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  const authority = authorityFaces(state, input);
  if (authority === undefined) return rejected("privateOrUnknownReference", "Randomness continuation is unavailable.");
  const operation = authority.resolution.operation;
  if (!isRecord(operation)) return rejected("invalidRulesInput", "Randomness operation is malformed.");
  switch (operation.kind) {
    case "establishInitiative": return establishInitiative(profiles, state, authority.resolution, authority.faces);
    case "resolveCombatAbility": return resolveCombatAbilityRandomness(profiles, state, authority.resolution, authority.faces);
    case "resolveEnvironmentAbility": return resolveEnvironmentAbilityRandomness(
      profiles,
      state,
      authority.resolution,
      authority.faces,
    );
    case "resolveSpellAbilityEffect": return resolveSpellAbilityRandomness(profiles, state, authority.resolution, authority.faces);
    case "resolveCounterspellCheck": return resolveCounterspellCheckRandomness(profiles, state, authority.resolution, authority.faces);
    case "resolvePostAttackDamage": return resolvePostAttackDamageRandomness(profiles, state, authority.resolution, authority.faces);
    case "resolveEnvironmentalConcentration": return resolveEnvironmentalConcentration(profiles, state, authority.resolution, authority.faces);
    case "scheduleStableRecovery": return resolveStableRecoverySchedule(profiles, state, authority.resolution, authority.faces);
    case "resolveMedicineStabilization": return resolveMedicineStabilization(profiles, state, authority.resolution, authority.faces);
    case "resolveDamageConcentration": return resolveDamageConcentration(profiles, state, authority.resolution, authority.faces);
    case "resolveDeathSavesAndRound": return resolveDeathSavesAndRound(profiles, state, authority.resolution, authority.faces);
    case "resolveOpportunityAndMovement": return resolveOpportunityAndMovement(profiles, state, authority.resolution, authority.faces);
    default: return rejected("unsupportedOperation", "Randomness continuation operation is not supported.");
  }
}

function answerInitiativeTie(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  pending: JsonRecord,
): StepResult {
  if (!isRecord(input.answer) || !hasExactKeys(input.answer, ["orderedEntityIds"])
    || !Array.isArray(input.answer.orderedEntityIds)
    || !Array.isArray(pending.orderedEntityIds)
    || [...input.answer.orderedEntityIds].sort().join("\u0000") !== [...pending.orderedEntityIds].sort().join("\u0000")) {
    return rejected("invalidRulesInput", "Initiative tie response is not canonical.");
  }
  const encounter = state.combatRuntime.encounters[String(pending.encounterId)];
  if (encounter === undefined || !isRecord(encounter.initiative) || !Array.isArray(encounter.initiative.entries)) {
    return rejected("privateOrUnknownReference", "Initiative encounter is unavailable.");
  }
  const orderedPlayers = input.answer.orderedEntityIds as string[];
  const entries = [...encounter.initiative.entries] as JsonRecord[];
  entries.sort((left, right) => {
    const totalDifference = Number(right.total) - Number(left.total);
    if (totalDifference !== 0) return totalDifference;
    const leftId = Array.isArray(left.combatantEntityIds) ? left.combatantEntityIds[0] : "";
    const rightId = Array.isArray(right.combatantEntityIds) ? right.combatantEntityIds[0] : "";
    const leftChoice = orderedPlayers.indexOf(String(leftId));
    const rightChoice = orderedPlayers.indexOf(String(rightId));
    if (leftChoice >= 0 && rightChoice >= 0) return leftChoice - rightChoice;
    return String(left.entryId).localeCompare(String(right.entryId));
  });
  const turnOrderEntityIds = entries.flatMap((entry) => entry.combatantEntityIds as string[]);
  const first = turnOrderEntityIds[0];
  return sequence("committed", profiles, state, String(pending.rootActionId), [
    { eventType: "CombatPendingClosed", payload: { pendingInputId: pending.pendingInputId } },
    { eventType: "InitiativeTieOrdered", payload: { encounterId: pending.encounterId, orderedEntityIds: orderedPlayers } },
    { eventType: "RoundStarted", payload: { encounterId: pending.encounterId, round: 1, turnOrderEntityIds } },
    { eventType: "TurnStarted", payload: { encounterId: pending.encounterId, round: 1, sourceEntityId: first } },
  ]);
}

function closeCancelledPending(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (answer.kind !== "cancel") return rejected("invalidRulesInput", "Target choice requires an explicit target or cancel.");
  return sequence("committed", profiles, state, String(pending.rootActionId), [{
    eventType: "CombatPendingClosed",
    payload: { pendingInputId: pending.pendingInputId },
    secrecy: "private",
  }]);
}

function answerTargetPending(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (answer.kind === "cancel") return closeCancelledPending(profiles, state, pending, answer);
  if (
    !hasExactKeys(answer, ["kind", "targetEntityId"])
    || answer.kind !== "selectTarget"
    || !isNonEmptyString(answer.targetEntityId)
    || !Array.isArray(pending.candidateEntityIds)
    || !pending.candidateEntityIds.includes(answer.targetEntityId)
    || !isRecord(pending.operation)
    || pending.operation.kind !== "invokeAbility"
    || !isNonEmptyString(pending.operation.sourceEntityId)
    || !isNonEmptyString(pending.operation.abilityRef)
    || !isRecord(pending.operation.parameters)
  ) return rejected("invalidRulesInput", "Target choice is not one of the frozen candidates.");
  const rootActionId = String(pending.rootActionId);
  const closed = sequence("committed", profiles, state, rootActionId, [{
    eventType: "CombatPendingClosed",
    payload: { pendingInputId: pending.pendingInputId },
    secrecy: "private",
  }]);
  if (closed.kind !== "committed") return closed;
  const resumed = invokeAbility(profiles, closed.state, continueCompoundRoot({
    kind: "invokeAbility",
    rootActionId,
    sourceEntityId: pending.operation.sourceEntityId,
    abilityRef: pending.operation.abilityRef,
    parameters: {
      ...structuredClone(pending.operation.parameters),
      targetEntityId: answer.targetEntityId,
    },
  }, rootActionId));
  if (resumed.kind === "rejected") return resumed;
  if (resumed.kind === "initialized") {
    return rejected("invalidWorldState", "Target continuation unexpectedly initialized a new world.");
  }
  return { ...resumed, events: [...closed.events, ...resumed.events] };
}

function answerKnockOut(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (!hasExactKeys(answer, ["kind"])
    || !["dealLethalDamage", "knockOut"].includes(String(answer.kind))
    || !isNonEmptyString(pending.controllerEntityId)
    || !isNonEmptyString(pending.targetEntityId)
    || !isRecord(pending.lethalDamagePayload)
    || !isRecord(pending.knockOutDamagePayload)) {
    return rejected("invalidRulesInput", "Knock-out response is not canonical.");
  }
  const target = combatEntity(state, pending.targetEntityId);
  if (target === undefined) return rejected("privateOrUnknownReference", "Knock-out target is unavailable.");
  const knockedOut = answer.kind === "knockOut";
  const damagePayload = knockedOut
    ? pending.knockOutDamagePayload
    : pending.lethalDamagePayload;
  const drafts: Draft[] = [
    {
      eventType: "CombatPendingClosed",
      payload: { pendingInputId: pending.pendingInputId },
      secrecy: "private",
    },
    {
      eventType: "ReactionAnswered",
      payload: {
        pendingInputId: pending.pendingInputId,
        controllerEntityId: pending.controllerEntityId,
        answer: structuredClone(answer),
      },
      secrecy: "private",
    },
    { eventType: "DamagePacketResolved", payload: structuredClone(damagePayload) },
  ];
  if (pending.concentrationWasActive === true) {
    drafts.push({
      eventType: "ConcentrationEnded",
      payload: { entityId: pending.targetEntityId, reason: "incapacitatedByDamage" },
    });
  }
  if (!knockedOut && pending.lethalCreatureDied === true) {
    drafts.push({
      eventType: "CreatureDied",
      payload: { characterId: pending.targetEntityId, causeId: pending.rootActionId },
    });
  }
  if (isRecord(pending.afterDamageSpellFrame)) {
    drafts.push(spellEventDraft(
      "SpellResolved",
      pending.afterDamageSpellFrame,
      { kind: "ability", succeeded: true },
    ));
  }
  if (!knockedOut) {
    return sequence("committed", profiles, state, String(pending.rootActionId), drafts, {
      mechanicalResult: isRecord(pending.mechanicalResult)
        ? structuredClone(pending.mechanicalResult)
        : {},
    });
  }
  return beginStableRecoverySchedule(
    profiles,
    state,
    String(pending.rootActionId),
    [String(pending.targetEntityId)],
    drafts,
  );
}

function reactionAnswerPrefix(pending: JsonRecord, answer: JsonRecord): Draft[] {
  return [
    {
      eventType: "CombatPendingClosed",
      payload: { pendingInputId: pending.pendingInputId },
      secrecy: "private",
    },
    {
      eventType: "ReactionAnswered",
      payload: {
        pendingInputId: pending.pendingInputId,
        controllerEntityId: pending.controllerEntityId,
        answer: structuredClone(answer),
      },
      secrecy: "private",
    },
  ];
}

function answerCounterspellReaction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (!isRecord(pending.spellFrame) || !Array.isArray(pending.reactionQueue)
    || !Number.isSafeInteger(pending.reactionIndex)
    || !isNonEmptyString(pending.controllerEntityId)) {
    return rejected("invalidRulesInput", "Counterspell pending is malformed.");
  }
  const prefix = reactionAnswerPrefix(pending, answer);
  const afterFailure = continuationAfterCounterCandidate(pending);
  if (answer.kind === "decline") {
    return executeSpellContinuation(
      profiles,
      state,
      String(pending.rootActionId),
      afterFailure,
      prefix,
    );
  }
  if (!hasExactKeys(answer, ["abilityRef", "kind", "slotLevel"])
    || answer.kind !== "useReaction"
    || !isNonEmptyString(answer.abilityRef)
    || !canonicalIntegerString(answer.slotLevel, 1, 9)
    || !Array.isArray(pending.candidateAbilityRefs)
    || !pending.candidateAbilityRefs.includes(answer.abilityRef)) {
    return rejected("invalidRulesInput", "Counterspell answer is not canonical.");
  }
  const caster = combatEntity(state, pending.controllerEntityId);
  const spent = caster === undefined
    ? undefined
    : spendReactionSpell(state, caster, String(answer.abilityRef), answer.slotLevel);
  if (caster === undefined || spent === undefined
    || !definitionHasMechanicalKey(spent.definition, "counterspell")) {
    return rejected("invalidRulesInput", "Counterspell is no longer legal.");
  }
  const targetFrame = pending.spellFrame;
  const counterFrame = {
    castId: `cast:${String(pending.rootActionId)}:${Number(targetFrame.depth ?? 0) + 1}:${entityId(caster)}`,
    rootActionId: pending.rootActionId,
    sourceEntityId: entityId(caster),
    abilityRef: answer.abilityRef,
    spellLevel: definitionSpellLevel(spent.definition),
    slotLevel: spent.slotLevel,
    depth: Number(targetFrame.depth ?? 0) + 1,
    ...(isNonEmptyString(pending.triggerBatchId)
      ? { parentTriggerBatchId: pending.triggerBatchId }
      : {}),
    effect: {
      kind: "counterspell",
      targetCast: structuredClone(targetFrame),
    },
    onPrevented: structuredClone(afterFailure),
  };
  return beginSpellFrame(
    profiles,
    state,
    counterFrame,
    spent.sourcePatch,
    [spent.spent],
    prefix,
  );
}

function answerShieldReaction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (!isRecord(pending.ownerFrame) || !isRecord(pending.continuation)
    || !isNonEmptyString(pending.controllerEntityId)) {
    return rejected("invalidRulesInput", "Shield pending is malformed.");
  }
  const prefix = reactionAnswerPrefix(pending, answer);
  if (answer.kind === "decline") {
    return executeSpellContinuation(
      profiles,
      state,
      String(pending.rootActionId),
      pending.continuation,
      prefix,
    );
  }
  if (!hasExactKeys(answer, ["abilityRef", "kind", "slotLevel"])
    || answer.kind !== "useReaction"
    || !isNonEmptyString(answer.abilityRef)
    || !canonicalIntegerString(answer.slotLevel, 1, 9)
    || !Array.isArray(pending.candidateAbilityRefs)
    || !pending.candidateAbilityRefs.includes(answer.abilityRef)) {
    return rejected("invalidRulesInput", "Shield answer is not canonical.");
  }
  const caster = combatEntity(state, pending.controllerEntityId);
  const spent = caster === undefined
    ? undefined
    : spendReactionSpell(state, caster, String(answer.abilityRef), answer.slotLevel);
  if (caster === undefined || spent === undefined
    || !definitionHasMechanicalKey(spent.definition, "shield")) {
    return rejected("invalidRulesInput", "Shield is no longer legal.");
  }
  const ownerDepth = Number(pending.ownerFrame.depth ?? 0);
  const shieldFrame = {
    castId: `cast:${String(pending.rootActionId)}:${ownerDepth + 1}:${entityId(caster)}:shield`,
    rootActionId: pending.rootActionId,
    sourceEntityId: entityId(caster),
    abilityRef: answer.abilityRef,
    spellLevel: definitionSpellLevel(spent.definition),
    slotLevel: spent.slotLevel,
    depth: ownerDepth + 1,
    effect: {
      kind: "shield",
      targetEntityId: pending.controllerEntityId,
      continuation: structuredClone(pending.continuation),
    },
    onPrevented: structuredClone(pending.continuation),
  };
  return beginSpellFrame(
    profiles,
    state,
    shieldFrame,
    spent.sourcePatch,
    [spent.spent],
    prefix,
  );
}

function answerTriggerOrder(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (!hasExactKeys(answer, ["orderedTriggerInstanceIds"])
    || !Array.isArray(answer.orderedTriggerInstanceIds)
    || !Array.isArray(pending.sameControllerTriggerInstanceIds)
    || !Array.isArray(pending.readyQueue)
    || [...answer.orderedTriggerInstanceIds].sort().join("\0")
      !== [...pending.sameControllerTriggerInstanceIds].sort().join("\0")) {
    return rejected("invalidRulesInput", "Trigger ordering response is not canonical.");
  }
  const requested = answer.orderedTriggerInstanceIds.filter(isNonEmptyString);
  const selected = new Map(requested.map((triggerInstanceId) => [
    triggerInstanceId,
    (pending.readyQueue as JsonRecord[]).find((entry) =>
      `trigger:${String(pending.rootActionId)}:ready:${String(entry.effectId)}` === triggerInstanceId),
  ]));
  if ([...selected.values()].some((entry) => entry === undefined)) {
    return rejected("invalidRulesInput", "Trigger ordering references are unavailable.");
  }
  let selectedIndex = 0;
  const sameController = new Set(requested);
  const queue = (pending.readyQueue as JsonRecord[]).map((entry) => {
    const triggerInstanceId = `trigger:${String(pending.rootActionId)}:ready:${String(entry.effectId)}`;
    if (!sameController.has(triggerInstanceId)) return structuredClone(entry);
    const replacement = selected.get(requested[selectedIndex++]);
    if (replacement === undefined) throw new TypeError("ordered trigger disappeared");
    return structuredClone(replacement);
  });
  return afterDrafts(profiles, state, String(pending.rootActionId), [{
    eventType: "CombatPendingClosed",
    payload: { pendingInputId: pending.pendingInputId },
    secrecy: "private",
  }], (nextState) => openReadyWindow(
    profiles,
    nextState,
    String(pending.rootActionId),
    queue,
    0,
    isRecord(pending.movementContinuation) ? pending.movementContinuation : undefined,
  ));
}

function continueAfterReadyResponse(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
): StepResult | undefined {
  const queue = Array.isArray(pending.readyQueue)
    ? pending.readyQueue.filter(isRecord)
    : [];
  const nextIndex = Number(pending.reactionIndex) + 1;
  if (Number.isSafeInteger(nextIndex) && nextIndex < queue.length) {
    return openReadyWindow(
      profiles,
      state,
      String(pending.rootActionId),
      queue,
      nextIndex,
      isRecord(pending.movementContinuation) ? pending.movementContinuation : undefined,
    );
  }
  return canonicalMovementContinuation(pending.movementContinuation)
    ? continueMovement(profiles, state, String(pending.rootActionId), pending.movementContinuation)
    : undefined;
}

function finishReadyResponse(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  drafts: Draft[],
): StepResult {
  return afterDraftsOptional(
    profiles,
    state,
    String(pending.rootActionId),
    drafts,
    (nextState) => continueAfterReadyResponse(profiles, nextState, pending),
  );
}

function answerReadyReaction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (!isNonEmptyString(pending.readyEffectId)
    || !isNonEmptyString(pending.controllerEntityId)) {
    return rejected("invalidRulesInput", "Ready pending is malformed.");
  }
  const ready = state.combatRuntime.effects[pending.readyEffectId];
  const source = combatEntity(state, pending.controllerEntityId);
  if (ready === undefined || source === undefined || ready.kind !== "readiedAction") {
    return rejected("privateOrUnknownReference", "Readied response is unavailable.");
  }
  const prefix = reactionAnswerPrefix(pending, answer);
  const expiry: Draft[] = [{
    eventType: "ReadiedActionExpired",
    payload: {
      effectId: ready.effectId,
      sourceEntityId: ready.sourceEntityId,
      reason: answer.kind === "decline" ? "declined" : "used",
    },
    secrecy: "private",
  }];
  if (answer.kind === "decline") {
    if (ready.spellAlreadyCast === true) {
      expiry.push({
        eventType: "ConcentrationEnded",
        payload: { entityId: ready.sourceEntityId, reason: "readiedSpellDeclined" },
      });
    }
    return finishReadyResponse(profiles, state, pending, [...prefix, ...expiry]);
  }
  if (!hasExactKeys(answer, ["kind"]) || answer.kind !== "useReaction"
    || !reactionAvailable(source) || !isRecord(ready.response)) {
    return rejected("invalidRulesInput", "Ready answer is not canonical or no longer legal.");
  }
  const sourcePatch = structuredClone(source);
  const turn = isRecord(sourcePatch.turn)
    ? sourcePatch.turn
    : { action: "0", bonusAction: "0", reaction: "1", attacksRemaining: "0", leveledBonusActionSpell: false };
  turn.reaction = "0";
  sourcePatch.turn = turn;
  if (ready.response.kind === "move") {
    const path = canonicalizeCombatPath(ready.response.path);
    if (path === undefined || JSON.stringify(source.position) !== JSON.stringify(path[0])) {
      return rejected("invalidRulesInput", "The frozen readied path no longer starts at the authoritative position.");
    }
    const moved = movementPatch(sourcePatch, path);
    const speed = movementSpeedInches(source, String(ready.response.movementMode));
    if (!canonicalIntegerString(speed, 0, 1_000_000)
      || BigInt(moved.distanceMilliInches) > BigInt(String(speed)) * 1_000n) {
      return rejected("invalidRulesInput", "The frozen readied movement is no longer legal.");
    }
    const occupiedEndpoint = Object.values(state.combatRuntime.entities).some((other) =>
      entityId(other) !== entityId(source)
      && other.lifeState !== "dead"
      && other.sceneId === source.sceneId
      && isRecord(other.position)
      && isRecord(other.footprint)
      && entityOccupanciesOverlap(moved.patch, other));
    if (occupiedEndpoint) return rejected("privateOrUnknownReference", "The readied movement endpoint is unavailable.");
    return finishReadyResponse(profiles, state, pending, [
      ...prefix,
      ...expiry,
      {
        eventType: "MovementSegmentCommitted",
        payload: {
          encounterId: ready.encounterId,
          sourceEntityId: entityId(source),
          path,
          distanceMilliInches: moved.distanceMilliInches,
          movementAuthority: "readiedReaction",
          movementMode: ready.response.movementMode,
          entityPatch: moved.patch,
        },
      },
    ]);
  }
  if (ready.response.kind === "invokeAbility"
    && isNonEmptyString(ready.response.abilityRef)
    && isRecord(ready.response.parameters)) {
    const abilityRef = String(ready.response.abilityRef);
    const definition = builtinSpecialMeleeDefinition(abilityRef);
    if (definition === undefined
      || !isNonEmptyString(ready.response.parameters.targetEntityId)
      || !legalCreatureCandidates(state, source, definition)
        .includes(ready.response.parameters.targetEntityId)) {
      return rejected("invalidRulesInput", "The frozen readied ability is no longer legal.");
    }
    return beginSpecialMeleeContest(
      profiles,
      state,
      String(pending.rootActionId),
      source,
      abilityRef,
      definition,
      ready.response.parameters,
      sourcePatch,
      [],
      {
        prefix: [...prefix, ...expiry],
        reactionContext: {
          kind: "readiedResponse",
          pending: structuredClone(pending),
        },
      },
    );
  }
  return rejected("unsupportedOperation", "This readied response kind is not yet executable.");
}

function answerReaction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (pending.reactionKind === "counterspell") {
    return answerCounterspellReaction(profiles, state, pending, answer);
  }
  if (pending.reactionKind === "shield") {
    return answerShieldReaction(profiles, state, pending, answer);
  }
  if (pending.reactionKind === "ready") {
    return answerReadyReaction(profiles, state, pending, answer);
  }
  const movementContinuationValue = pending.movementContinuation;
  const processedReactionEntityIds = pending.processedReactionEntityIds === undefined
    ? []
    : pending.processedReactionEntityIds;
  if (!canonicalEntityIdSequence(pending.reactionQueue)
    || !canonicalEntityIdSequence(processedReactionEntityIds)
    || pending.reactionQueue.some((entityId) => processedReactionEntityIds.includes(entityId))
    || !Number.isSafeInteger(pending.reactionIndex)
    || Number(pending.reactionIndex) < 0
    || Number(pending.reactionIndex) >= pending.reactionQueue.length
    || !isNonEmptyString(pending.controllerEntityId)
    || pending.controllerEntityId !== pending.reactionQueue[Number(pending.reactionIndex)]
    || !canonicalMovementContinuation(movementContinuationValue)) {
    return rejected("invalidRulesInput", "Reaction pending is malformed.");
  }
  const reactionQueue = pending.reactionQueue;
  const processedThroughCurrent = [
    ...processedReactionEntityIds,
    ...reactionQueue.slice(0, Number(pending.reactionIndex) + 1),
  ];
  const movingEntityId = String(movementContinuationValue.movingEntityId);
  const prefix: Draft[] = [
    { eventType: "CombatPendingClosed", payload: { pendingInputId: pending.pendingInputId }, secrecy: "private" },
    { eventType: "ReactionAnswered", payload: { pendingInputId: pending.pendingInputId, controllerEntityId: pending.controllerEntityId, answer: structuredClone(answer) } },
  ];
  if (answer.kind === "decline") {
    const nextIndex = Number(pending.reactionIndex) + 1;
    const nextController = reactionQueue[nextIndex];
    if (isNonEmptyString(nextController)) {
      const nextPending = {
        ...structuredClone(pending),
        pendingInputId: `${String(pending.pendingInputId).replace(/:\d+$/, "")}:${processedReactionEntityIds.length + nextIndex + 1}`,
        controllerEntityId: nextController,
        reactionIndex: nextIndex,
      };
      prefix.push({ eventType: "ReactionOffered", payload: { pending: nextPending }, secrecy: "private" });
      return sequence("awaitingInput", profiles, state, String(pending.rootActionId), prefix, { pending: publicPending(nextPending) });
    }
    return afterDraftsOptional(
      profiles,
      state,
      String(pending.rootActionId),
      prefix,
      (nextState) => continueMovement(
        profiles,
        nextState,
        String(pending.rootActionId),
        movementContinuationValue,
        new Set(processedThroughCurrent),
      ),
    );
  }
  if (answer.kind !== "useReaction" || answer.abilityRef !== "action:opportunity-attack"
    || answer.targetEntityId !== movingEntityId) return rejected("invalidRulesInput", "Reaction answer is not canonical.");
  const reactor = combatEntity(state, pending.controllerEntityId);
  const target = combatEntity(state, movingEntityId);
  if (reactor === undefined || target === undefined) return rejected("privateOrUnknownReference", "Reaction combatant is unavailable.");
  const sourcePatch = structuredClone(reactor);
  const turn = isRecord(sourcePatch.turn) ? sourcePatch.turn : { action: "1", bonusAction: "1", reaction: "1", attacksRemaining: "1", leveledBonusActionSpell: false };
  if (Number(turn.reaction ?? 1) <= 0) return rejected("invalidRulesInput", "Reaction is already spent.");
  turn.reaction = "0"; sourcePatch.turn = turn;
  const definition = {
    definitionId: "action:opportunity-attack",
    rulesBasis: "srd5.1-2014",
    activation: { kind: "reaction" },
    target: { kind: "creature", reachInches: "60" },
    attack: { ability: "dex", proficiency: true },
    damage: [{ type: "bludgeoning", formula: "1d6" }],
  };
  return awaitRandomness(profiles, state, String(pending.rootActionId), {
    kind: "resolveOpportunityAndMovement",
    sourceEntityId: entityId(reactor),
    targetEntityId: entityId(target),
    definition,
    sourcePatch,
    movementContinuation: structuredClone(movementContinuationValue),
    processedReactionEntityIds: processedThroughCurrent,
  }, [
    { purposeKey: `attack:opportunity:${entityId(reactor)}`, dice: [{ count: "1", sides: "20" }], frozenParameters: { sourceEntityId: entityId(reactor), targetEntityId: entityId(target), mode: "normal", attackBonus: attackBonus(reactor, definition), armorClass: Number(target.armorClass) } },
    { purposeKey: `damage:opportunity:${entityId(reactor)}`, dice: [{ count: "1", sides: "6" }], frozenParameters: { targetEntityId: entityId(target), components: definition.damage } },
  ], prefix);
}

function resolveOpportunityAndMovement(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  resolution: JsonRecord,
  faces: AuthorityFaces,
): StepResult {
  const operation = resolution.operation;
  if (!isRecord(operation) || operation.kind !== "resolveOpportunityAndMovement"
    || !isNonEmptyString(operation.sourceEntityId) || !isNonEmptyString(operation.targetEntityId)
    || !isRecord(operation.definition) || !isRecord(operation.sourcePatch)
    || !canonicalEntityIdSequence(operation.processedReactionEntityIds)
    || !canonicalMovementContinuation(operation.movementContinuation)) {
    return rejected("invalidRulesInput", "Opportunity continuation is malformed.");
  }
  const source = combatEntity(state, operation.sourceEntityId); const target = combatEntity(state, operation.targetEntityId);
  if (source === undefined || target === undefined) return rejected("privateOrUnknownReference", "Opportunity combatant is unavailable.");
  const roll = faces.get(`attack:opportunity:${operation.sourceEntityId}`)?.[0];
  const total = Number(roll) + attackBonus(source, operation.definition);
  const hit = Number(roll) !== 1 && (Number(roll) === 20 || total >= Number(target.armorClass));
  const mechanicalResult: JsonRecord = { attack: { mode: "normal", roll, total, hit } };
  const drafts: Draft[] = [{ eventType: "AbilityInvoked", payload: { sourceEntityId: operation.sourceEntityId, abilityRef: "action:opportunity-attack", mechanicalResult, sourcePatch: operation.sourcePatch }, resolutionId: String(resolution.resolutionId) }];
  if (hit) {
    const damage = damageDraft(
      target,
      [{ type: "bludgeoning", rolled: Number(faces.get(`damage:opportunity:${operation.sourceEntityId}`)?.[0]) }],
      operation.movementContinuation.encounterId,
      "action:opportunity-attack",
      Number(roll) === 20,
    );
    if (damage.resolution.totalApplied > 0) drafts.push(...interruptStableRecoveryDrafts(
      state,
      entityId(target),
      { kind: "damage", sourceDefinitionId: "action:opportunity-attack" },
    ).map((draft) => ({ ...draft, resolutionId: String(resolution.resolutionId) })));
    drafts.push({ ...damage.draft, resolutionId: String(resolution.resolutionId) });
    mechanicalResult.damage = { components: damage.resolution.components, totalApplied: damage.resolution.totalApplied };
  }
  const committed = sequence(
    "committed",
    profiles,
    state,
    String(resolution.rootActionId),
    drafts,
    { mechanicalResult },
  );
  if (committed.kind !== "committed") return committed;
  const continued = continueMovement(
    profiles,
    committed.state,
    String(resolution.rootActionId),
    operation.movementContinuation,
    new Set(operation.processedReactionEntityIds),
  );
  return continued === undefined ? committed : appendTransitions(committed, continued);
}

function answerConclusion(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: JsonRecord,
  answer: JsonRecord,
): StepResult {
  if (!hasExactKeys(answer, ["kind"])
    || !["acceptEncounterConclusion", "rejectEncounterConclusion"].includes(String(answer.kind))) {
    return rejected("invalidRulesInput", "Encounter conclusion requires an explicit acceptance or rejection.");
  }
  const encounter = state.combatRuntime.encounters[String(pending.encounterId)];
  if (encounter === undefined) return rejected("privateOrUnknownReference", "Encounter is unavailable.");
  if (Object.keys(state.combatRuntime.randomnessResolutions).length > 0
    || Object.keys(state.combatRuntime.pendingInputs).some((pendingInputId) =>
      pendingInputId !== pending.pendingInputId)) {
    return rejected("pendingInputUnresolved", "Encounter conclusion cannot bypass an unresolved combat phase.");
  }
  const controllerEntityIds = Array.isArray(pending.controllerEntityIds)
    ? pending.controllerEntityIds.filter(isNonEmptyString)
    : [];
  const controllerIndex = Number(pending.controllerIndex);
  if (controllerEntityIds.length === 0
    || !Number.isSafeInteger(controllerIndex)
    || controllerIndex < 0
    || controllerIndex >= controllerEntityIds.length
    || controllerEntityIds[controllerIndex] !== pending.controllerEntityId) {
    return rejected("invalidRulesInput", "Encounter conclusion pending is malformed.");
  }
  const choiceDrafts: Draft[] = [
    { eventType: "CombatPendingClosed", payload: { pendingInputId: pending.pendingInputId } },
    {
      eventType: "ReactionAnswered",
      payload: {
        pendingInputId: pending.pendingInputId,
        controllerEntityId: pending.controllerEntityId,
        answer: structuredClone(answer),
      },
    },
  ];
  if (answer.kind === "rejectEncounterConclusion") {
    return sequence("committed", profiles, state, String(pending.rootActionId), choiceDrafts);
  }
  const nextControllerIndex = controllerIndex + 1;
  const nextControllerEntityId = controllerEntityIds[nextControllerIndex];
  if (nextControllerEntityId !== undefined) {
    const nextPending = {
      ...structuredClone(pending),
      pendingInputId: `pending:${pending.rootActionId}:encounter-conclusion:${nextControllerIndex + 1}`,
      controllerEntityId: nextControllerEntityId,
      controllerIndex: nextControllerIndex,
    };
    return sequence("awaitingInput", profiles, state, String(pending.rootActionId), [
      ...choiceDrafts,
      { eventType: "CombatPendingOpened", payload: { pending: nextPending }, secrecy: "private" },
    ], { pending: publicPending(nextPending) });
  }
  const advance = encounter.roundClosed === true ? "0" : COMBAT_ROUND_MICROS.toString();
  const timelineId = (() => {
    const candidate = isNonEmptyString(encounter.sceneId)
      ? sceneTimelineId(state, encounter.sceneId)
      : state.activeBranchId;
    return candidate in state.fictionTimelines ? candidate : state.activeBranchId;
  })();
  const closeInstantMicros = BigInt(state.fictionTimelines[timelineId].nowMicros) + BigInt(advance);
  const phaseTasks = phaseTasksForConclusion(profiles, state, encounter, closeInstantMicros);
  const immediateTasks = phaseTasks.filter((task) => BigInt(String(task.dueMicros)) <= closeInstantMicros);
  return sequence("committed", profiles, state, String(pending.rootActionId), [
    ...choiceDrafts,
    {
      eventType: "EncounterConcluded",
      payload: {
        encounterId: pending.encounterId,
        fictionAdvanceMicros: advance,
        phaseTasks,
        reason: isRecord(pending.proposal) && isNonEmptyString(pending.proposal.reason)
          ? pending.proposal.reason
          : "accepted",
      },
    },
    ...phaseTaskExpiryDrafts(state, immediateTasks),
  ]);
}

function answerPendingInput(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["answer", "kind", "pendingInputId", "responseId"])
    || ![input.pendingInputId, input.responseId].every(isNonEmptyString)
    || !isRecord(input.answer)) return rejected("invalidRulesInput", "Pending response is not canonical.");
  const pending = state.combatRuntime.pendingInputs[String(input.pendingInputId)];
  if (pending === undefined) return rejected("privateOrUnknownReference", "Pending input is unavailable.");
  switch (pending.choiceKind) {
    case "initiativeTieOrder": return answerInitiativeTie(profiles, state, input, pending);
    case "triggerOrder": return answerTriggerOrder(profiles, state, pending, input.answer);
    case "target": return answerTargetPending(profiles, state, pending, input.answer);
    case "knockOut": return answerKnockOut(profiles, state, pending, input.answer);
    case "reaction": return answerReaction(profiles, state, pending, input.answer);
    case "encounterConclusion": return answerConclusion(profiles, state, pending, input.answer);
    default: return rejected("unsupportedOperation", "Combat pending response kind is not supported.");
  }
}

const DUE_COMBAT_PHASE_BYPASS_KINDS = new Set([
  "authoritativeRandomness",
  "fulfillAuthoritativeRandomness",
  "fulfillAuthoritativeRandomnessBatch",
  "answerPendingInput",
  "applyServiceCorrection",
]);

function combatInputTimelineId(
  state: AuthoritativeWorldState,
  input: JsonRecord,
): string | undefined {
  const characterId = [
    input.characterId,
    input.actorCharacterId,
    input.sourceCharacterId,
    input.actingNpcId,
    input.sourceEntityId,
    input.leaderCharacterId,
  ].find((value) => isNonEmptyString(value) && value in state.entities);
  if (isNonEmptyString(characterId)) return characterTimelineId(state, characterId);
  const combatSourceId = [input.sourceEntityId, input.targetEntityId]
    .find((value) => isNonEmptyString(value) && value in state.combatRuntime.entities);
  const sceneId = isNonEmptyString(combatSourceId)
    ? state.combatRuntime.entities[combatSourceId]?.sceneId
    : undefined;
  if (!isNonEmptyString(sceneId)) return undefined;
  const timelineId = sceneTimelineId(state, sceneId);
  return timelineId in state.fictionTimelines ? timelineId : state.activeBranchId;
}

function longSpellCompletionCosts(
  sourcePatch: JsonRecord,
  definition: JsonRecord,
  ritual: boolean,
): Array<{ resourceId: string; amount: number; after: string }> | undefined {
  const costs = Array.isArray(definition.costs)
    ? definition.costs.filter((cost) => !ritual || !isRecord(cost) || cost.kind !== "spellSlot")
    : [];
  return spendCosts(sourcePatch, { ...definition, costs });
}

function settleDueLongSpellBeforeInput(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (DUE_COMBAT_PHASE_BYPASS_KINDS.has(String(input.kind))) return undefined;
  const inputTimeline = combatInputTimelineId(state, input);
  if (inputTimeline === undefined) return undefined;
  const nowMicros = BigInt(state.fictionTimelines[inputTimeline].nowMicros);
  const due = Object.values(state.campaignRuntime.activities)
    .filter((activity) => activity.status === "active"
      && activity.activityKind === "longSpellcasting"
      && isNonEmptyString(activity.activityId)
      && isNonEmptyString(activity.characterId)
      && characterTimelineId(state, activity.characterId) === inputTimeline
      && typeof activity.startedAtFictionMicros === "string"
      && typeof activity.intendedDurationMicros === "string"
      && BigInt(activity.startedAtFictionMicros) + BigInt(activity.intendedDurationMicros) <= nowMicros)
    .sort((left, right) => {
      const leftDue = BigInt(String(left.startedAtFictionMicros)) + BigInt(String(left.intendedDurationMicros));
      const rightDue = BigInt(String(right.startedAtFictionMicros)) + BigInt(String(right.intendedDurationMicros));
      return leftDue < rightDue ? -1 : leftDue > rightDue ? 1
        : String(left.activityId).localeCompare(String(right.activityId));
    })[0];
  if (due === undefined || !isRecord(due.completion)) return undefined;
  const source = combatEntity(state, due.characterId);
  const concentration = source?.concentration;
  const completion = due.completion;
  if (source === undefined
    || !isRecord(concentration)
    || concentration.kind !== "longSpellcasting"
    || concentration.activityId !== due.activityId
    || Number(concentration.investedActionRounds) < Number(concentration.requiredActionRounds)
    || completion.kind !== "longSpellcasting"
    || !isRecord(completion.definition)
    || !Array.isArray(completion.targetEntityIds)) {
    return undefined;
  }
  const dueMicros = (BigInt(String(due.startedAtFictionMicros))
    + BigInt(String(due.intendedDurationMicros))).toString();
  const rootActionId = `long-spell-due:${String(due.activityId)}:${dueMicros}`;
  if (rootActionId in state.receipts) return undefined;
  const sourcePatch = structuredClone(source);
  sourcePatch.concentration = null;
  const ritual = completion.ritual === true;
  const spent = longSpellCompletionCosts(sourcePatch, completion.definition, ritual);
  if (spent === undefined) {
    return rejected("insufficientResource", "Long-spell completion costs are unavailable.");
  }
  const spellLevel = definitionSpellLevel(completion.definition);
  const parameters = isRecord(completion.parameters) ? completion.parameters : {};
  const frame = {
    castId: `cast:${rootActionId}:0`,
    rootActionId,
    sourceEntityId: due.characterId,
    abilityRef: completion.abilityRef,
    spellLevel,
    slotLevel: Number(parameters.slotLevel ?? spellLevel),
    depth: 0,
    effect: {
      kind: "ability",
      definition: structuredClone(completion.definition),
      targetEntityIds: structuredClone(completion.targetEntityIds),
      parameters: structuredClone(parameters),
      mechanical: {
        longSpellcasting: true,
        ritual,
        activityId: due.activityId,
      },
      specs: [],
      encounterId: concentration.encounterId ?? null,
      deferDamageForShield: false,
    },
    onPrevented: { kind: "stop" },
  };
  const completionResult = afterDrafts(profiles, state, rootActionId, [
    { eventType: "ActivityCompleted", payload: { activityId: due.activityId } },
    {
      eventType: "ConcentrationEnded",
      payload: { entityId: due.characterId, reason: "longSpellCompleted" },
    },
  ], (nextState) => beginSpellFrame(profiles, nextState, frame, sourcePatch, spent));
  if (completionResult.kind === "rejected" || completionResult.kind === "initialized") {
    return completionResult;
  }
  return {
    ...completionResult,
    mechanicalResult: {
      kind: "dueLongSpellSettled",
      activityId: due.activityId,
      ritual,
      interruptedIntentKind: input.kind,
      retryOriginalIntent: true,
    },
  };
}

function settleDueCombatPhaseBeforeInput(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (DUE_COMBAT_PHASE_BYPASS_KINDS.has(String(input.kind))) return undefined;
  const inputTimeline = combatInputTimelineId(state, input);
  if (inputTimeline === undefined) return undefined;
  const nowMicros = BigInt(state.fictionTimelines[inputTimeline].nowMicros);
  const dueGroups = Object.values(state.combatRuntime.encounters).flatMap((encounter) => {
    if (encounter.status !== "concluded" || !Array.isArray(encounter.residualPhaseTasks)) return [];
    const encounterTimelineCandidate = isNonEmptyString(encounter.sceneId)
      ? sceneTimelineId(state, encounter.sceneId)
      : state.activeBranchId;
    const encounterTimeline = encounterTimelineCandidate in state.fictionTimelines
      ? encounterTimelineCandidate
      : state.activeBranchId;
    if (encounterTimeline !== inputTimeline) return [];
    const dueTasks = encounter.residualPhaseTasks
      .filter(isRecord)
      .filter((task) => typeof task.dueMicros === "string"
        && /^(0|[1-9][0-9]*)$/.test(task.dueMicros)
        && BigInt(task.dueMicros) <= nowMicros)
      .sort(phaseTaskOrder);
    if (dueTasks.length === 0) return [];
    const earliestDueMicros = String(dueTasks[0].dueMicros);
    return [{
      encounter,
      dueMicros: earliestDueMicros,
      tasks: dueTasks.filter((task) => task.dueMicros === earliestDueMicros),
    }];
  }).sort((left, right) => {
    const leftDue = BigInt(left.dueMicros);
    const rightDue = BigInt(right.dueMicros);
    return leftDue < rightDue ? -1 : leftDue > rightDue ? 1
      : String(left.encounter.encounterId).localeCompare(String(right.encounter.encounterId));
  });
  const due = dueGroups[0];
  if (due === undefined) return undefined;
  const rootActionId = `combat-phase-due:${String(due.encounter.encounterId)}:${due.dueMicros}`;
  if (rootActionId in state.receipts) return undefined;
  const drafts = phaseTaskExpiryDrafts(state, due.tasks);
  if (drafts.length === 0) return undefined;
  return sequence("committed", profiles, state, rootActionId, drafts, {
    mechanicalResult: {
      kind: "dueCombatPhaseTasksSettled",
      encounterId: due.encounter.encounterId,
      dueMicros: due.dueMicros,
      interruptedIntentKind: input.kind,
      retryOriginalIntent: true,
    },
  });
}

export function stepCombatWorld(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  const dueLongSpellResult = settleDueLongSpellBeforeInput(profiles, state, input);
  if (dueLongSpellResult !== undefined) return dueLongSpellResult;
  const duePhaseResult = settleDueCombatPhaseBeforeInput(profiles, state, input);
  if (duePhaseResult !== undefined) return duePhaseResult;
  switch (input.kind) {
    case "startEncounter": return startEncounter(profiles, state, input);
    case "changeEncounterHostility": return changeEncounterHostility(profiles, state, input);
    case "authoritativeRandomness": return fulfillRandomness(profiles, state, input);
    case "invokeAbility": return invokeAbility(profiles, state, input);
    case "invokeEnvironmentAbility": return invokeEnvironmentAbility(profiles, state, input);
    case "continueLongSpellcasting": return continueLongSpellcasting(profiles, state, input);
    case "endConcentration": return endConcentration(profiles, state, input);
    case "testConcentration": return testConcentration(profiles, state, input);
    case "readyAction": return readyAction(profiles, state, input);
    case "moveCombatant": return moveCombatant(profiles, state, input);
    case "endTurn": return endTurn(profiles, state, input);
    case "proposeEncounterConclusion": return proposeEncounterConclusion(profiles, state, input);
    case "answerPendingInput":
      return isNonEmptyString(input.pendingInputId)
        && input.pendingInputId in state.combatRuntime.pendingInputs
        ? answerPendingInput(profiles, state, input)
        : undefined;
    default: return undefined;
  }
}
