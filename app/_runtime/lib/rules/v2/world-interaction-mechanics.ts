import { entityCanTargetTacticalFeature } from "../profiles/combat-geometry";
import { combatAttackBonus } from "../profiles/attack-resolution";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import {
  activeEncounter,
  consumeTurnGrant,
  currentGroupAllows,
} from "./combat-actions";
import {
  authorityRefBoundToScene,
  authoritySpatialRefVisibleTo,
} from "./authority-bindings";
import { currentTacticalFeature } from "./environment";
import { isStoredSemanticDefinition } from "./semantic-definitions";
import { spatialRecordVisibleTo } from "./spatial-visibility";
import { isRecord } from "./validation";
import type { WorldInteractionCost } from "./world-interaction-model";

export type WorldInteractionAbilityAuthority = Readonly<{
  sourcePatch: JsonRecord;
  abilityDefinition: JsonRecord;
  tacticalFeatureRefs: readonly string[];
  rangeBand: "normal" | "long";
  checkAbility: "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";
  checkModifier: number;
  costs: readonly WorldInteractionCost[];
}>;

export type WorldInteractionAbilityAuthorityResult =
  | Readonly<{ kind: "accepted"; authority: WorldInteractionAbilityAuthority }>
  | Readonly<{
      kind: "rejected";
      code: "invalidRulesInput" | "missingPrerequisite" | "privateOrUnknownReference";
      message: string;
    }>;

/**
 * Resolves only registered mechanical targeting. The KP still decides whether
 * the described material/approach can achieve the intended physical result
 * and freezes the adjudication/DC. Rules independently proves that the chosen
 * Ability can reach and see the semantic object's registered tactical feature,
 * and that an active combatant can pay the relevant turn grant.
 */
export function worldInteractionAbilityAuthority(input: Readonly<{
  state: AuthoritativeWorldState;
  actorCharacterId: string;
  sceneRef: string;
  abilityRef: string;
  directTargetRefs: readonly string[];
  checkMode: "normal" | "advantage" | "disadvantage";
}>): WorldInteractionAbilityAuthorityResult {
  const source = input.state.combatRuntime.entities[input.actorCharacterId];
  const abilityDefinition = input.state.combatRuntime.definitions[input.abilityRef];
  const target = isRecord(abilityDefinition?.target) ? abilityDefinition.target : undefined;
  if (!isRecord(source)
    || source.sceneId !== input.sceneRef
    || !isRecord(abilityDefinition)
    || !Array.isArray(source.abilityRefs)
    || !source.abilityRefs.includes(input.abilityRef)
    || target?.kind !== "creatureOrEnvironmentFeature") {
    return rejected(
      "missingPrerequisite",
      "The registered world-interaction Ability cannot target an environment feature.",
    );
  }
  const attack = isRecord(abilityDefinition.attack) ? abilityDefinition.attack : undefined;
  const checkAbility = attack?.kind === "spellAttack"
    && isRecord(source.spellcasting)
    ? attackAbility(source.spellcasting.ability)
    : attackAbility(attack?.ability);
  const costs = authoritativeItemCosts(input.state, input.actorCharacterId, abilityDefinition);
  if (checkAbility === undefined || costs === undefined) {
    return rejected(
      "missingPrerequisite",
      "The registered world-interaction Ability has no canonical attack or item-cost authority.",
    );
  }
  if (input.directTargetRefs.length === 0) {
    return rejected(
      "privateOrUnknownReference",
      "The registered world-interaction Ability requires a direct semantic target.",
    );
  }
  const targetCount = canonicalTargetCount(target.count);
  if (targetCount === undefined) {
    return rejected(
      "missingPrerequisite",
      "The registered world-interaction Ability has no canonical direct-target limit.",
    );
  }
  if (target.selfOnly === true || targetCount !== 1) {
    return rejected(
      "missingPrerequisite",
      "The registered Ability requires target mechanics outside this world-interaction Profile.",
    );
  }
  if (input.directTargetRefs.length > targetCount) {
    return rejected(
      "invalidRulesInput",
      "The world interaction exceeds the registered Ability direct-target limit.",
    );
  }

  const scene = input.state.combatRuntime.scenes[input.sceneRef];
  const featureRefsByDirectTarget = input.directTargetRefs.map((targetRef) => {
    const definition = input.state.campaignRuntime.definitions[targetRef];
    if (!authorityRefBoundToScene(input.state, targetRef, input.sceneRef)
      || !authoritySpatialRefVisibleTo(
        input.state,
        targetRef,
        input.sceneRef,
        input.actorCharacterId,
      )
      || !isStoredSemanticDefinition(definition)
      || !isRecord(definition.content)
      || !Array.isArray(definition.content.mechanicDefinitionRefs)) return [];
    return definition.content.mechanicDefinitionRefs
      .filter((ref): ref is string => typeof ref === "string")
      .filter((ref) => {
        const feature = currentTacticalFeature(input.state, input.actorCharacterId, ref);
        return feature !== undefined
          && spatialRecordVisibleTo(input.state, feature, input.actorCharacterId);
      });
  });
  if (featureRefsByDirectTarget.some((refs) => refs.length === 0)) {
    return rejected(
      "privateOrUnknownReference",
      "Every direct semantic target must resolve its own registered tactical feature.",
    );
  }
  const tacticalFeatureRefs = [...new Set(featureRefsByDirectTarget.flat())].sort();

  const normalRange = firstRange(target, ["rangeNormalInches", "rangeInches", "reachInches"]);
  const longRange = firstRange(target, ["rangeLongInches"]);
  if (normalRange === undefined) {
    return rejected(
      "missingPrerequisite",
      "The registered world-interaction Ability has no finite target range.",
    );
  }
  const features = tacticalFeatureRefs.map((featureRef) => currentTacticalFeature(
    input.state,
    input.actorCharacterId,
    featureRef,
  )!);
  const withinNormal = features.every((feature) =>
    entityCanTargetTacticalFeature(scene, source, feature, normalRange));
  const withinLong = withinNormal || (longRange !== undefined && features.every((feature) =>
    entityCanTargetTacticalFeature(scene, source, feature, longRange)));
  if (!withinLong) {
    return rejected(
      "privateOrUnknownReference",
      "The semantic target is outside the registered range or clear sight line.",
    );
  }
  const rangeBand = withinNormal ? "normal" : "long";
  if (rangeBand === "long" && input.checkMode !== "disadvantage") {
    return rejected(
      "invalidRulesInput",
      "A long-range world-interaction attack must freeze disadvantage.",
    );
  }

  const encounter = activeEncounter(input.state, input.actorCharacterId);
  let sourcePatch: JsonRecord;
  if (encounter === undefined) {
    sourcePatch = structuredClone(source);
  } else {
    if (!currentGroupAllows(encounter, input.actorCharacterId)) {
      return rejected(
        "invalidRulesInput",
        "The world-interaction actor does not hold the current initiative turn.",
      );
    }
    const consumed = consumeTurnGrant(source, abilityDefinition, input.abilityRef);
    if (consumed === undefined) {
      return rejected(
        "invalidRulesInput",
        "The registered action grant is unavailable for this world interaction.",
      );
    }
    sourcePatch = consumed;
  }

  return Object.freeze({
    kind: "accepted",
    authority: Object.freeze({
      sourcePatch: structuredClone(sourcePatch),
      abilityDefinition: structuredClone(abilityDefinition),
      tacticalFeatureRefs: Object.freeze(tacticalFeatureRefs),
      rangeBand,
      checkAbility,
      checkModifier: combatAttackBonus(source, abilityDefinition),
      costs: Object.freeze(costs),
    }),
  });
}

function authoritativeItemCosts(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  abilityDefinition: JsonRecord,
): WorldInteractionCost[] | undefined {
  if (abilityDefinition.costs === undefined) return [];
  if (!Array.isArray(abilityDefinition.costs)) return undefined;
  const costs: WorldInteractionCost[] = [];
  for (const value of abilityDefinition.costs) {
    if (!isRecord(value)
      || value.kind !== "item"
      || typeof value.resourceId !== "string"
      || !canonicalCounter(value.amount)
      || (value.chargeCost !== undefined && !canonicalCounter(value.chargeCost))
      || (value.durabilityCost !== undefined && !canonicalCounter(value.durabilityCost))) {
      return undefined;
    }
    const quantity = Number(value.amount);
    const charges = value.chargeCost === undefined ? 0 : Number(value.chargeCost);
    const durability = value.durabilityCost === undefined ? 0 : Number(value.durabilityCost);
    const entry = state.campaignRuntime.itemSystem.entries[value.resourceId];
    if (quantity + charges + durability <= 0
      || entry === undefined
      || entry.entryId !== value.resourceId
      || entry.disposition !== "held"
      || entry.holderRef !== actorCharacterId
      || entry.condition !== "usable") return undefined;
    costs.push({
      kind: "item",
      entryRef: entry.entryId,
      quantity,
      charges,
      durability,
    });
  }
  costs.sort((left, right) => left.entryRef.localeCompare(right.entryRef));
  if (costs.some((cost, index) => index > 0 && cost.entryRef === costs[index - 1]!.entryRef)) {
    return undefined;
  }
  return costs;
}

function canonicalCounter(value: unknown): boolean {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function canonicalTargetCount(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) && count <= 100 ? count : undefined;
}

function attackAbility(
  value: unknown,
): WorldInteractionAbilityAuthority["checkAbility"] | undefined {
  return value === "str" || value === "strength"
    ? "strength"
    : value === "dex" || value === "dexterity"
      ? "dexterity"
      : value === "con" || value === "constitution"
        ? "constitution"
        : value === "int" || value === "intelligence"
          ? "intelligence"
          : value === "wis" || value === "wisdom"
            ? "wisdom"
            : value === "cha" || value === "charisma" ? "charisma" : undefined;
}

function firstRange(
  target: JsonRecord,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = target[key];
    if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) return value;
  }
  return undefined;
}

function rejected(
  code: Extract<WorldInteractionAbilityAuthorityResult, { kind: "rejected" }>["code"],
  message: string,
): Extract<WorldInteractionAbilityAuthorityResult, { kind: "rejected" }> {
  return Object.freeze({ kind: "rejected", code, message });
}
