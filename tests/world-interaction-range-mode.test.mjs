import assert from "node:assert/strict";
import test from "node:test";
import { worldInteractionAbilityAuthority } from "../app/_runtime/lib/rules/v2/world-interaction-mechanics.ts";
import { conditionAttack } from "../app/_runtime/lib/rules/v2/condition-mechanics.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";

const ACTOR = "character:range";
const SCENE = "scene:range";
const TARGET = "semantic:range-target";
const ABILITY = "ability:range";

function fixture(targetX, conditions = {}) {
  const feature = { featureId: "feature:range-target", kind: "barrier", label: "Target",
    state: "present", polygon: [
      { x: String(targetX - 5), y: "95" }, { x: String(targetX + 5), y: "95" },
      { x: String(targetX + 5), y: "105" }, { x: String(targetX - 5), y: "105" },
    ], elevation: "0", height: "10", opaque: false, impassable: false, cover: "none",
    propagation: "passes", terrain: "normal", visibilityPolicyId: "visibility:scene-observers" };
  const snapshot = createDefinitionSnapshot(TARGET, "1", { sceneRef: SCENE, label: "Target",
    description: "A visible target.", observableState: "ready", affordances: ["interact"],
    mechanicDefinitionRefs: [feature.featureId] });
  const definition = storedSemanticDefinition("sceneFeature", "visibility:scene-observers", snapshot,
    { templateRef: TARGET, templateHash: snapshot.definitionHash });
  return {
    entities: { [ACTOR]: { id: ACTOR, kind: "player", sceneId: SCENE, tenureStatus: "active" } },
    campaignRuntime: { definitions: { [TARGET]: definition }, itemSystem: { entries: {} } },
    combatRuntime: {
      entities: { [ACTOR]: { id: ACTOR, sceneId: SCENE, lifeState: "alive", conditions,
        abilityRefs: [ABILITY], stats: { dex: "14" }, proficiencyBonus: "2",
        position: { x: "100", y: "100", elevation: "0" },
        footprint: { width: "60", depth: "60", height: "60" } } },
      effects: {}, encounters: {},
      definitions: { [ABILITY]: { definitionId: ABILITY,
        attack: { ability: "dex", proficiency: true }, target: {
          kind: "creatureOrEnvironmentFeature", count: "1", rangeNormalInches: "120", rangeLongInches: "360",
        } } },
      scenes: { [SCENE]: { sceneId: SCENE, geometry: {
        schema: "zhuwei.tactical-geometry/v1", unit: "inch",
        boundary: { kind: "polygon", points: [
          { x: "0", y: "0" }, { x: "1000", y: "0" }, { x: "1000", y: "600" }, { x: "0", y: "600" },
        ] }, spawnPoints: [{ x: "100", y: "100", elevation: "0" }],
        obstacles: [feature], clearanceZones: [],
      } } },
    },
  };
}

function authority(state) {
  return worldInteractionAbilityAuthority({ state, actorCharacterId: ACTOR, sceneRef: SCENE,
    abilityRef: ABILITY, directTargetRefs: [TARGET] });
}

function mode(state, authorityValue) {
  return conditionAttack(state, ACTOR, TARGET, { withinFiveFeet: false, visibleFearSourceRefs: [],
    disadvantageReasons: authorityValue.checkDisadvantageReasons }).mode;
}

test("normal and long range return reasons for the same condition roll resolver", () => {
  for (const [targetX, rangeBand, expectedMode, reasons] of [
    [200, "normal", "normal", []],
    [400, "long", "disadvantage", ["longRange2014"]],
  ]) {
    const state = fixture(targetX);
    const resolved = authority(state);
    assert.equal(resolved.kind, "accepted", JSON.stringify(resolved));
    assert.equal(resolved.authority.rangeBand, rangeBand);
    assert.deepEqual(resolved.authority.checkDisadvantageReasons, reasons);
    assert.equal(mode(state, resolved.authority), expectedMode);
    assert.equal(resolved.authority.checkModifier, 4);
  }
});

test("long range combines once with condition advantage and multiple disadvantage sources", () => {
  for (const conditions of [{ invisible: true }, { invisible: true, poisoned: true, exhaustion: "3" }]) {
    const state = fixture(400, conditions);
    const before = structuredClone(state);
    const resolved = authority(state);
    assert.equal(resolved.kind, "accepted", JSON.stringify(resolved));
    assert.deepEqual(resolved.authority.checkDisadvantageReasons, ["longRange2014"]);
    assert.equal(mode(state, resolved.authority), "normal");
    assert.deepEqual(state, before);
  }
});

test("advantage does not permit an attack beyond the Ability long range", () => {
  const state = fixture(800, { invisible: true });
  const resolved = authority(state);
  assert.equal(resolved.kind, "rejected");
  assert.equal(resolved.code, "privateOrUnknownReference");
});
