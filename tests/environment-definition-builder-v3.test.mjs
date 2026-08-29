import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import * as builderModule from "../app/_runtime/lib/rules/profiles/environment-definition-builder.ts";
import { compileEnvironmentFeature } from "../app/_runtime/lib/rules/profiles/environment.ts";

const { buildCustomEnvironmentFeatureDefinition } = builderModule;

function semantics(state, overrides = {}) {
  return {
    state,
    opaque: false,
    impassable: false,
    cover: "none",
    propagation: "passes",
    terrain: "normal",
    ...overrides,
  };
}

function fixture({
  slug,
  label,
  material,
  initialState,
  triggerState,
  debrisState,
  initialSemantics = {},
  triggerSemantics = {},
  debrisSemantics = { impassable: true, cover: "half", terrain: "rubble" },
  armorClass = 12,
  maximumDurability = 12,
  damageThreshold = 0,
  widthInches = 24,
  depthInches = 24,
  heightInches = 36,
  elevationInches = 0,
  areaRadiusInches = 60,
  areaPropagation = "straight",
  spreadBudgetInches,
  saveAbility = "dex",
  saveDc = 12,
  halfOnSuccess = false,
  damageFormula = "2d6",
  damageType = "bludgeoning",
  failureStatus = "prone",
}) {
  return {
    featureId: `feature:builder-fixtures:${slug}`,
    sceneId: "scene:builder-fixtures",
    label,
    material,
    centerXInches: 120,
    centerYInches: -48,
    elevationInches,
    widthInches,
    depthInches,
    heightInches,
    visibilityPolicyId: "visibility:scene-observers",
    armorClass,
    maximumDurability,
    damageThreshold,
    immuneDamageTypes: ["psychic", "poison"],
    initialState,
    states: [
      semantics(initialState, initialSemantics),
      semantics(triggerState, triggerSemantics),
      semantics(debrisState, debrisSemantics),
    ],
    damageTransitions: [{
      fromState: initialState,
      remainingDurabilityAtOrBelow: 0,
      toState: triggerState,
    }],
    hazardTransitions: [{ fromState: triggerState, toState: debrisState }],
    hazardTriggerState: triggerState,
    hazardResolvedState: debrisState,
    areaOriginElevationInches: 0,
    areaRadiusInches,
    areaPropagation,
    ...(spreadBudgetInches === undefined ? {} : { spreadBudgetInches }),
    saveAbility,
    saveDc,
    halfOnSuccess,
    damageFormula,
    damageType,
    failureStatus,
  };
}

const CUSTOM_OBJECT_FIXTURES = [
  fixture({
    slug: "chandelier",
    label: "旧铜吊灯",
    material: "铜链、木架与蜡烛",
    initialState: "suspended",
    triggerState: "falling",
    debrisState: "debris",
    elevationInches: 120,
    heightInches: 24,
    armorClass: 10,
    maximumDurability: 10,
    areaRadiusInches: 120,
  }),
  fixture({
    slug: "oil-barrel",
    label: "渗油木桶",
    material: "浸油橡木与铁箍",
    initialState: "sealed",
    triggerState: "rupturing",
    debrisState: "burning-debris",
    initialSemantics: { impassable: true, cover: "half" },
    debrisSemantics: { impassable: true, cover: "half", terrain: "rubble" },
    armorClass: 11,
    maximumDurability: 8,
    areaPropagation: "aroundCorners",
    spreadBudgetInches: 120,
    damageFormula: "3d6",
    damageType: "fire",
    halfOnSuccess: true,
  }),
  fixture({
    slug: "bookshelf",
    label: "满载书架",
    material: "干燥松木与羊皮书卷",
    initialState: "upright",
    triggerState: "collapsing",
    debrisState: "scattered",
    initialSemantics: {
      opaque: true,
      impassable: true,
      cover: "threeQuarters",
      propagation: "blocks",
    },
    debrisSemantics: { impassable: true, cover: "half", terrain: "rubble" },
  }),
  fixture({
    slug: "stone-column",
    label: "裂纹石柱",
    material: "风化花岗岩",
    initialState: "standing",
    triggerState: "toppling",
    debrisState: "rubble",
    initialSemantics: {
      opaque: true,
      impassable: true,
      cover: "full",
      propagation: "blocks",
    },
    armorClass: 17,
    maximumDurability: 40,
    damageThreshold: 5,
    widthInches: 36,
    depthInches: 36,
    heightInches: 144,
    damageFormula: "4d8",
  }),
  fixture({
    slug: "drawbridge",
    label: "腐朽吊桥",
    material: "麻绳与潮湿木板",
    initialState: "spanning",
    triggerState: "giving-way",
    debrisState: "gap",
    debrisSemantics: { impassable: true, propagation: "passes", terrain: "rubble" },
    maximumDurability: 20,
    widthInches: 120,
    depthInches: 240,
    damageFormula: "4d6",
  }),
  fixture({
    slug: "brazier",
    label: "炽热火盆",
    material: "铸铁与燃烧木炭",
    initialState: "upright",
    triggerState: "overturning",
    debrisState: "embers",
    initialSemantics: { impassable: true, cover: "half" },
    debrisSemantics: { impassable: false, terrain: "rubble" },
    damageFormula: "2d8",
    damageType: "fire",
  }),
  fixture({
    slug: "portcullis",
    label: "生锈闸门",
    material: "锻铁",
    initialState: "barred",
    triggerState: "giving-way",
    debrisState: "wreckage",
    initialSemantics: { impassable: true, cover: "threeQuarters" },
    debrisSemantics: { impassable: true, cover: "half", terrain: "rubble" },
    armorClass: 19,
    maximumDurability: 50,
    damageThreshold: 8,
    widthInches: 120,
    heightInches: 144,
  }),
  fixture({
    slug: "makeshift-cover",
    label: "临时掩体",
    material: "桌板、箱笼与绳索",
    initialState: "braced",
    triggerState: "collapsing",
    debrisState: "scattered",
    initialSemantics: { opaque: true, impassable: true, cover: "half" },
    debrisSemantics: { impassable: false, cover: "none", terrain: "rubble" },
    maximumDurability: 6,
    heightInches: 42,
  }),
  fixture({
    slug: "breakable-floor",
    label: "朽坏地板",
    material: "虫蛀木梁与薄木板",
    initialState: "supporting",
    triggerState: "collapsing",
    debrisState: "breached",
    debrisSemantics: { impassable: true, propagation: "passes", terrain: "rubble" },
    widthInches: 120,
    depthInches: 120,
    heightInches: 12,
    damageFormula: "3d6",
  }),
  fixture({
    slug: "breakable-stairs",
    label: "断裂楼梯",
    material: "开裂橡木",
    initialState: "usable",
    triggerState: "collapsing",
    debrisState: "broken",
    debrisSemantics: { impassable: true, cover: "half", terrain: "rubble" },
    widthInches: 60,
    depthInches: 180,
    heightInches: 120,
  }),
  fixture({
    slug: "environment-blockage",
    label: "坍塌通道阻断",
    material: "碎石、泥土与断木",
    initialState: "blocking",
    triggerState: "breaking",
    debrisState: "cleared",
    initialSemantics: {
      opaque: true,
      impassable: true,
      cover: "full",
      propagation: "blocks",
      terrain: "rubble",
    },
    debrisSemantics: { impassable: false, cover: "half", terrain: "rubble" },
    armorClass: 14,
    maximumDurability: 35,
    damageThreshold: 4,
    widthInches: 120,
    heightInches: 96,
  }),
];

test("one open builder compiles every required custom object without a product archetype registry", () => {
  assert.deepEqual(Object.keys(builderModule), ["buildCustomEnvironmentFeatureDefinition"]);
  assert.equal(CUSTOM_OBJECT_FIXTURES.length, 11);

  const hashes = [];
  for (const input of CUSTOM_OBJECT_FIXTURES) {
    assert.equal(Object.hasOwn(input, "archetypeId"), false);
    const definition = buildCustomEnvironmentFeatureDefinition(input);
    const compiled = compileEnvironmentFeature(definition);
    assert.equal(compiled.ok, true, `${input.label}: ${JSON.stringify(compiled)}`);
    if (!compiled.ok) continue;
    assert.equal(definition.featureId, input.featureId);
    assert.equal(definition.sceneId, input.sceneId);
    assert.equal(definition.label, input.label);
    assert.equal(definition.destructible.armorClass, String(input.armorClass));
    assert.equal(definition.destructible.maximumDurability, String(input.maximumDurability));
    assert.equal(definition.destructible.damageThreshold, String(input.damageThreshold));
    assert.equal(definition.areaEffect.shape.radiusInches, String(input.areaRadiusInches));
    assert.match(definition.destructible.definitionId, new RegExp(encodeURIComponent(input.material)));
    assert.equal(JSON.stringify(definition).includes("targetEntity"), false);
    hashes.push(compiled.artifact.featureDefinitionHash);
  }
  assert.equal(new Set(hashes).size, CUSTOM_OBJECT_FIXTURES.length);
});

test("custom definition identity and hash are stable under unordered finite input", () => {
  const input = structuredClone(CUSTOM_OBJECT_FIXTURES[1]);
  const reordered = structuredClone(input);
  reordered.states.reverse();
  reordered.immuneDamageTypes.reverse();
  const first = buildCustomEnvironmentFeatureDefinition(input);
  const second = buildCustomEnvironmentFeatureDefinition(reordered);
  assert.deepEqual(second, first);
  assert.equal(canonicalSha256(second), canonicalSha256(first));

  const changedMaterial = structuredClone(input);
  changedMaterial.material = "陶罐、灯油与铜箍";
  const changed = buildCustomEnvironmentFeatureDefinition(changedMaterial);
  assert.equal(changed.featureId, first.featureId);
  assert.notEqual(changed.destructible.definitionId, first.destructible.definitionId);
  assert.notEqual(canonicalSha256(changed), canonicalSha256(first));

  const novel = fixture({
    slug: "crystal-lattice",
    label: "共振晶格",
    material: "天然石英与银丝",
    initialState: "resonating",
    triggerState: "shattering",
    debrisState: "shards",
    initialSemantics: { opaque: true, impassable: true, cover: "half" },
    damageFormula: "3d8",
    damageType: "thunder",
  });
  assert.equal(compileEnvironmentFeature(buildCustomEnvironmentFeatureDefinition(novel)).ok, true);
});

test("builder rejects target authority, non-integral geometry, and invalid or unbounded graphs", () => {
  const base = structuredClone(CUSTOM_OBJECT_FIXTURES[0]);

  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition({ ...base, targetEntityIds: ["character:forged"] }),
    /targetEntityIds:unknown/,
  );
  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition({ ...base, widthInches: 25 }),
    /widthInches:must-be-even/,
  );
  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition({ ...base, centerXInches: Number.NaN }),
    /centerXInches/,
  );
  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition({ ...base, damageType: "untyped" }),
    /damageType/,
  );
  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition({
      ...base,
      damageTransitions: [{
        ...base.damageTransitions[0],
        remainingDurabilityAtOrBelow: base.maximumDurability + 1,
      }],
    }),
    /remainingDurabilityAtOrBelow/,
  );
  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition({
      ...base,
      states: Array.from({ length: 17 }, (_, index) => semantics(`state-${index}`)),
    }),
    /states:bounded/,
  );
  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition({
      ...base,
      states: [base.states[0], base.states[0], base.states[2]],
    }),
    /states:duplicate/,
  );
  const aroundCornersWithoutBudget = { ...base, areaPropagation: "aroundCorners" };
  delete aroundCornersWithoutBudget.spreadBudgetInches;
  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition(aroundCornersWithoutBudget),
    /spreadBudgetInches/,
  );
  assert.throws(
    () => buildCustomEnvironmentFeatureDefinition({
      ...base,
      material: "e\u0301tain",
    }),
    /material/,
  );
});
