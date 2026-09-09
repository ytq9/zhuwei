import { atomicCompletionInput } from './fixtures/vnext-action-duration.mjs';
import { actDuration, withActDuration, soleStep } from './fixtures/vnext-action-duration.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import {
  isAuthoredDefinitionSource, materializedAuthoredDefinition, materializedAuthoredItem,
} from "../app/_runtime/lib/rules/v2/authored-materialization.ts";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../app/_runtime/lib/rules/v2/semantic-definitions.ts";
import { validateVNextProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-validator.ts";
import { lowerVNext2ProposalBundle } from "../app/_runtime/lib/kp/vnext/proposal-bundle-lowering.ts";
import { parseSubmitKpProposalBundleArguments } from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";
import { encodeVNextStrictToolBundle, VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { freezeAdjudicationContext } from "../app/_runtime/lib/kp/vnext/context/index.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { PROBE_MODULE_PROFILE } from "../tools/lib/vnext-authored-probe-fixture.mjs";

const HASH = `sha256:${"a".repeat(64)}`;
const ROOT = "root:authored";
const ACTOR = "character:author";
const SCENE = "scene:gallery";
const SOURCE = "definition:chain";
const ZONE = "definition:landing";
const A = "prospective:mechanics";
const H = "prospective:hazard";
const I = "prospective:item-definition";
const E = "prospective:item-entry";
function ability(overrides = {}) {
  return { label: "蒸汽喷流", description: "水管破裂，蒸汽灼烫并阻挡视线。", aliases: [], tags: [],
    activation: { kind: "nonCombatHazard" }, target: { kind: "creature", count: "2", rangeInches: "120", requiresSight: false },
    attack: null, save: { ability: "dex", dc: 15, halfOnSuccess: true },
    damage: [{ formula: "2d6", type: "fire", sharedAcrossTargets: true }, { formula: "1d4+2", type: "bludgeoning", sharedAcrossTargets: false }],
    effect: null, effects: [], healing: null, temporaryHitPoints: null, costs: [], grants: [], ...overrides };
}
function source(kind, content, handle, consumes = []) {
  return { kind: "materializeDefinition", basisRefs: [], consumes: consumes.map((handle) => ({ kind: "prospective", handle })),
    produces: [{ handle, kind: `${kind}Definition`, outcomeBinding: "always" }], outcomeBinding: "always",
    source: { kind, content }, visibilityPolicyRef: "visibility:hidden-until-evidence", summary: "危险或物品定义已确定。" };
}
function hazard() {
  return { schema: "zhuwei.environment-hazard-definition/v1", label: "损坏的蒸汽管",
    trigger: { kind: "disturbFeature", ref: SOURCE }, perceptibleSigns: ["持续的嘶嘶声"],
    disableMethods: ["关闭供汽阀门"], environmentalConsequences: ["蒸汽凝结在墙上"], mechanicsRef: A };
}
function item(overrides = {}) {
  return { schema: "zhuwei.item-definition-content/v1", label: "温暖药剂", description: "一小瓶药剂。", category: "consumable", aliases: [], tags: [],
    stackable: true, equipment: null, equippedAbilityRefs: [], use: { kind: "useObject", abilityRef: A, quantityCost: 1, chargeCost: 0, durabilityCost: 0 },
    chargesMaximum: null, durabilityMaximum: null, ...overrides };
}
function bundle(proposals) {
  return withActDuration({ schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication", basisRefs: [],
    adjudication: { kind: "directSuccess", durationMicros: actDuration(proposals), risk: "根据固化的机械结算。", successOutcome: "行动能够实施。" }, terminal: null, proposals });
}
function branch(effects = []) { return { outcomeCode: "outcome:triggered", summary: "危险触发。", effects, sensoryEvidence: [], pressures: [], opportunities: [] }; }
function interaction() {
  return { kind: "worldInteraction", basisRefs: [SOURCE], consumes: [{ kind: "prospective", handle: H }], produces: [], outcomeBinding: "always",
    sceneRef: SCENE, targetRefs: [SOURCE], directTargetRefs: [SOURCE], instrumentRefs: [], abilityRef: null, intent: "转动阀门", method: "伸手转动",
    branches: { success: branch([{ kind: "registeredHazard", sourceDefinitionRef: SOURCE, zoneRef: ZONE, damage: { kind: "authored", hazardDefinitionRef: H } }]), failure: null } };
}
function context(refs = [ACTOR, SCENE, SOURCE, ZONE], authority = state()) {
  const frozen = freezeAdjudicationContext({ state: authority, profiles: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
    moduleProfile: PROBE_MODULE_PROFILE,
    kpProjection: { kind: "projected", viewer: { kind: "kp" }, stateVersion: authority.version,
      activeBranchId: authority.activeBranchId, projectionHash: HASH, spatialEvidence: {} },
    replayHead: { eventSeq: "1", stateHash: HASH }, preparedActionId: "prepared:authored", rootActionId: ROOT,
    submissionRef: "submission:authored", actorCharacterId: ACTOR, intentText: "作者化机械定义。", focusRefs: refs, maxUnits: 16_000 });
  assert.equal(frozen.kind, "ready", JSON.stringify(frozen));
  return frozen.context;
}
function state() {
  const definitions = Object.fromEntries([SOURCE, ZONE].map((ref) => [ref, storedSemanticDefinition("sceneFeature", "visibility:public", createDefinitionSnapshot(ref, "1", {
    sceneRef: SCENE, label: ref, description: "有形场景物件", observableState: "intact", affordances: ["interact"],
  }))]));
  return { schema: "zhuwei.authoritative-world-state/v2", roomId: "room:authored", runtimeEpochId: "epoch:authored",
    version: "1", activeBranchId: "branch:authored",
    fictionTimelines: { "branch:authored": { branchId: "branch:authored", nowMicros: "0" } },
    multiplayerRuntime: { characterTimelineIds: {} }, scenes: { [SCENE]: { id: SCENE } }, canonicalFacts: {}, knowledge: {},
    entities: { [ACTOR]: { id: ACTOR, name: "创作测试角色", kind: "player", tenureStatus: "active", sceneId: SCENE } },
    campaignRuntime: { campaign: { campaignId: "campaign:authored", moduleRef: PROBE_MODULE_PROFILE.moduleRef },
      definitions, adjudicationPrecedents: {}, itemSystem: { entries: {}, definitions: {} } },
    combatRuntime: { definitions: {}, entities: {}, scenes: {}, effects: {} } };
}
function lower(value, refs, authority = state()) { return lowerVNext2ProposalBundle({ value, rootActionId: ROOT, actorCharacterId: ACTOR, requiredContext: context(refs, authority), state: authority }); }
function plan(entry, handle, extra = {}) {
  return { schema: "zhuwei.authored-definition-materialization-plan/vnext-1", bundleHash: HASH, contextHash: HASH, handle,
    basisRefs: [], sourceRefs: [], readSet: [{ ref: ACTOR, revisionOrHash: "1" }], visibilityPolicyRef: "visibility:hidden-until-evidence", summary: "固化", source: entry, causalBasisRefs: [], ...extra };
}
function accepted(value) { const result = validateVNextProposalBundle(value); assert.equal(result.kind, "accepted", JSON.stringify(result)); return result; }
function wire(value) {
  if (value === null) return { kind: "none" };
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, wire(child)]));
  return value;
}

test("one authoring vocabulary compiles mixed-save damage and fixed-attack timed conditions with Rules-derived identity", () => {
  const distinct = ability({ attack: { kind: "fixed", bonus: "7" }, save: null, damage: [],
    effects: [{ kind: "grantEffect", condition: "restrained", duration: { kind: "timed", durationMicros: "60000000" } }] });
  for (const content of [ability(), distinct]) {
    const source = { kind: "ability", content };
    assert.equal(isAuthoredDefinitionSource(source), true);
    const built = materializedAuthoredDefinition(ROOT, plan(source, A));
    assert.ok(built?.artifact);
    assert.equal(built.definition.definitionId, built.definitionRef);
    assert.equal(built.definition.revision, "1");
    assert.equal(built.definition.visibilityPolicyRef, "visibility:hidden-until-evidence");
    assert.deepEqual(materializedAuthoredDefinition(ROOT, plan(source, A)), built);
    assert.notEqual(materializedAuthoredDefinition(`${ROOT}:another`, plan(source, A)).definitionRef, built.definitionRef);
    assert.ok(built.artifact.mechanicGraph.operations.length > 0);
  }
  assert.equal(isAuthoredDefinitionSource({ kind: "ability", content: ability({ save: { ability: "str", dc: 55, halfOnSuccess: false }, effect: { kind: "fixedDamage", amount: 2_000_000, damageType: "force" } }) }), true);
});

test("strict model output creates Ability then hazard then invokes it without synthesizing candidate state", () => {
  const value = bundle([source("ability", ability(), A), source("hazard", hazard(), H, [A]), interaction()]);
  value.basisRefs = [SOURCE];
  value.proposals[2].consumes.unshift({ kind: "existing", ref: SOURCE });
  const { schema: _schema, kind: _kind, ...argumentsValue } = value;
  const decoded = parseSubmitKpProposalBundleArguments(encodeVNextStrictToolBundle(wire(argumentsValue)));
  assert.deepEqual(JSON.parse(JSON.stringify(decoded)), value);
  const before = state();
  const result = lowerVNext2ProposalBundle({ value: decoded, rootActionId: ROOT, actorCharacterId: ACTOR, requiredContext: context(), state: before });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.equal(atomicCompletionInput(result.command.rulesInput).kind, "applyAtomicWorldInteractionSteps");
  const steps = atomicCompletionInput(result.command.rulesInput).steps;
  assert.deepEqual(steps.map(({ rulesInput }) => rulesInput.kind), ["materializeDefinition", "materializeDefinition", "resolveWorldInteraction"]);
  assert.ok(steps.every(({ rulesInput }) => rulesInput.plan.readSet.every(({ ref }) => !ref.startsWith("prospective:"))));
  assert.equal(steps[2].rulesInput.plan.branches.success.effects[0].damage.hazardDefinitionRef, H);
  assert.deepEqual(before, state());
});

test("Ability, ItemDefinition, instance and inventory use share the same atomic dependency graph", () => {
  const recovery = ability({ activation: { kind: "useObject", actionGrant: "normalAction" }, save: null, damage: [], healing: { formula: "2d4+2" } });
  const instance = { kind: "materializeItem", basisRefs: [], consumes: [{ kind: "prospective", handle: I }], produces: [{ handle: E, kind: "itemEntry", outcomeBinding: "always" }],
    outcomeBinding: "always", definitionRef: I, sceneRef: SCENE, quantity: 2, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:public", summary: "药剂出现在台面上。" };
  const acquire = { kind: "inventoryOperation", basisRefs: [], consumes: [{ kind: "prospective", handle: E }], produces: [], outcomeBinding: "always",
    operation: { kind: "acquire", entryRef: E, quantity: 2 }, summary: "拿起药剂。" };
  const use = { ...acquire, operation: { kind: "use", entryRef: E, targetRefs: [ACTOR] }, summary: "饮用药剂。" };
  const value = bundle([source("ability", recovery, A), source("item", item(), I, [A]), instance, acquire, use]);
  accepted(value);
  const result = lower(value);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.deepEqual(atomicCompletionInput(result.command.rulesInput).steps.map(({ formId }) => formId), ["materialization.vnext-1", "materialization.vnext-1", "materialization.vnext-1", "inventory-operation.vnext-1", "inventory-operation.vnext-1"]);
  const abilityBuilt = materializedAuthoredDefinition(ROOT, plan({ kind: "ability", content: recovery }, A));
  const itemBuilt = materializedAuthoredDefinition(ROOT, plan({ kind: "item", content: item({ use: { ...item().use, abilityRef: abilityBuilt.definitionRef } }) }, I));
  const entryPlan = { ...plan(undefined, E), schema: "zhuwei.authored-item-materialization-plan/vnext-1", definitionRef: itemBuilt.definitionRef, sceneRef: SCENE,
    quantity: 2, ownership: { kind: "unowned", ownerRef: null } };
  delete entryPlan.source;
  delete entryPlan.causalBasisRefs;
  const first = materializedAuthoredItem(ROOT, entryPlan, itemBuilt.definition);
  const second = materializedAuthoredItem(ROOT, { ...entryPlan, handle: "prospective:second-bottle" }, itemBuilt.definition);
  assert.equal(first.entry.definitionRef, second.entry.definitionRef);
  assert.notEqual(first.entryRef, second.entryRef);
  assert.equal(first.entry.quantity, 2);
  assert.equal(first.entry.disposition, "scene");
});

test("authoring rejects authority injection, incomplete hazards, invalid item combinations and typed handle substitution", () => {
  for (const field of ["definitionId", "revision", "resolution", "compiledHash", "statePatch"]) {
    assert.equal(isAuthoredDefinitionSource({ kind: "ability", content: { ...ability(), [field]: "forged" } }), false, field);
  }
  assert.equal(isAuthoredDefinitionSource({ kind: "hazard", content: { ...hazard(), disableMethods: [] } }), false);
  assert.equal(isAuthoredDefinitionSource({ kind: "item", content: item({ stackable: true, chargesMaximum: 3 }) }), false);
  const wrong = bundle([source("item", item({ use: null }), A), source("hazard", hazard(), H, [A])]);
  const badType = validateVNextProposalBundle(wrong);
  assert.equal(badType.kind, "rejected");
  assert.ok(badType.issues.some((issue) => issue.includes("prospective-type-mismatch")));
  const missing = bundle([source("hazard", hazard(), H, [A])]);
  assert.equal(validateVNextProposalBundle(missing).kind, "rejected");
});

test("existing item definitions need no duplicate authoring and all inventory operations are closed", () => {
  const existing = "item-definition:rope";
  const authority = state();
  const definition = materializedAuthoredDefinition(ROOT, plan({ kind: "item", content: item({ use: null }) }, I)).definition;
  authority.campaignRuntime.itemSystem.definitions[existing] = { ...definition, definitionId: existing };
  const entry = { kind: "materializeItem", basisRefs: [], consumes: [{ kind: "existing", ref: existing }], produces: [{ handle: E, kind: "itemEntry", outcomeBinding: "always" }],
    outcomeBinding: "always", definitionRef: existing, sceneRef: SCENE, quantity: 1, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:public", summary: "找到一圈绳索。" };
  const result = lower(bundle([entry]), [ACTOR, SCENE, existing], authority);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.equal(soleStep(result.command).plan.definitionRef, existing);
  for (const operation of [
    { kind: "release", entryRef: E, quantity: 1, sceneRef: SCENE, releaseKind: "placement" },
    { kind: "transfer", entryRef: E, quantity: 1, targetCharacterRef: ACTOR, ownershipDisposition: "preserve" },
    { kind: "equip", entryRef: E, action: "stow", slot: "main" },
    { kind: "lifecycle", entryRef: E, action: "repair" },
  ]) accepted(bundle([entry, { kind: "inventoryOperation", basisRefs: [], consumes: [{ kind: "prospective", handle: E }], produces: [], outcomeBinding: "always", operation, summary: "操作物品。" }]));
});


test("typed dependency closure rejects cycles and conditional producer gaps while narrative stays opaque", () => {
  const cyclicAbility = ability({ costs: [{ kind: "item", resourceId: E, amount: "1" }] });
  const entry = { kind: "materializeItem", basisRefs: [], consumes: [{ kind: "prospective", handle: I }], produces: [{ handle: E, kind: "itemEntry", outcomeBinding: "always" }],
    outcomeBinding: "always", definitionRef: I, sceneRef: SCENE, quantity: 1, ownership: { kind: "unowned", ownerRef: null }, visibilityPolicyRef: "visibility:public", summary: "物品出现。" };
  const cycle = validateVNextProposalBundle(bundle([source("ability", cyclicAbility, A, [E]), source("item", item(), I, [A]), entry]));
  assert.equal(cycle.kind, "rejected");
  assert.ok(cycle.issues.includes("bundle:dependency-cycle"), JSON.stringify(cycle));
  const conditional = bundle([source("ability", ability(), A), source("hazard", hazard(), H, [A]), interaction()]);
  conditional.adjudication = { kind: "check", durationMicros: "300000000", checkKind: "abilityCheck", ability: "str", skill: null, dc: 15, mode: "normal", risk: "危险", successOutcome: "成功", failureOutcome: "失败" };
  conditional.proposals[1].outcomeBinding = "onSuccess";
  conditional.proposals[1].produces[0].outcomeBinding = "onSuccess";
  conditional.proposals[2].branches.failure = branch();
  const rejected = validateVNextProposalBundle(conditional);
  assert.equal(rejected.kind, "rejected");
  assert.ok(rejected.issues.some((issue) => issue.includes("condition-not-dominated")), JSON.stringify(rejected));
  const plain = bundle([source("ability", ability({ description: "prospective:not-a-reference" }), A)]);
  accepted(plain);
  plain.proposals[0].summary = "";
});


test("definition causal provenance retains canonical facts without treating actor or scene reads as facts", () => {
  const fact = "fact:replenished-supplies";
  const proposal = source("item", item({ use: null }), I);
  proposal.basisRefs = [ACTOR, SCENE, fact];
  const initial = state();
  initial.canonicalFacts = { [fact]: { id: fact, kind: "supplies", subjectRefs: [],
    branchId: initial.activeBranchId, visibilityPolicyId: "visibility:public", value: { replenished: true } } };
  const result = lowerVNext2ProposalBundle({ value: bundle([proposal]), rootActionId: ROOT, actorCharacterId: ACTOR,
    requiredContext: context([ACTOR, SCENE, fact], initial), state: initial });
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  const frozen = soleStep(result.command).plan;
  assert.deepEqual(frozen.causalBasisRefs, [fact]);
  assert.deepEqual(frozen.readSet.map(({ ref }) => ref).sort(), [ACTOR, SCENE, fact, "profile-context:module:authored-probe"].sort());
  const built = materializedAuthoredDefinition(ROOT, frozen);
  assert.deepEqual(built.definition.causalBasisRefs, [fact]);
});


test("Ability endEffect expresses removal by condition and optional frozen source without authority effect IDs", () => {
  for (const sourceRef of [null, SOURCE]) {
    const content = ability({ save: null, damage: [], effects: [{ kind: "endEffect", condition: "restrained", sourceRef }] });
    assert.equal(isAuthoredDefinitionSource({ kind: "ability", content }), true);
    const compiled = materializedAuthoredDefinition(ROOT, plan({ kind: "ability", content }, A));
    assert.ok(compiled.artifact.mechanicGraph.operations.some((operation) => operation.family === "Effect" && operation.input.kind === "endEffect"));
  }
  assert.equal(isAuthoredDefinitionSource({ kind: "ability", content: ability({ effects: [{ kind: "endEffect", condition: "restrained", sourceRef: null, effectId: "effect:forged" }] }) }), false);
});


test("inventory area use submits geometry and lets Rules choose affected targets", () => {
  const entryRef = "item-entry:area-device";
  const authority = state();
  const definition = materializedAuthoredDefinition(ROOT, plan({ kind: "item", content: item({ use: null }) }, I)).definition;
  authority.campaignRuntime.itemSystem.definitions[definition.definitionId] = definition;
  authority.campaignRuntime.itemSystem.entries[entryRef] = { schema: "zhuwei.item-entry/v1", entryId: entryRef,
    definitionRef: definition.definitionId, definitionRevision: "1", disposition: "held", holderRef: ACTOR,
    sceneRef: null, equippedSlot: null, quantity: 1, condition: "usable", charges: null, durability: null,
    visibilityPolicyRef: "visibility:public", ownership: { kind: "unowned", ownerRef: null } };
  const operation = { kind: "use", entryRef, targetRefs: [], area: { origin: { x: "100", y: "100", elevation: "0" }, direction: { x: "1", y: "0", elevation: "0" } } };
  const proposal = { kind: "inventoryOperation", basisRefs: [SCENE], consumes: [], produces: [], outcomeBinding: "always", operation, summary: "朝前方启动装置。" };
  const value = bundle([proposal]);
  const result = lower(value, [ACTOR, SCENE, entryRef], authority);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.deepEqual(soleStep(result.command).plan.operation.area, operation.area);
  proposal.operation.targetRefs = [ACTOR];
  assert.equal(validateVNextProposalBundle(value).kind, "rejected");
  proposal.operation.targetRefs = [];
  proposal.operation.area.direction.x = "0";
  assert.equal(validateVNextProposalBundle(value).kind, "rejected");
});


test("area hazards carry execution geometry independently of the frozen Ability area shape", () => {
  const sourceAbility = ability({ target: { kind: "area", rangeInches: "120", shape: { kind: "sphere", radiusInches: "60", propagation: "straight" } } });
  const trigger = interaction();
  trigger.branches.success.effects[0].damage.area = { origin: { x: "100", y: "100", elevation: "0" } };
  const value = bundle([source("ability", sourceAbility, A), source("hazard", hazard(), H, [A]), trigger]);
  const result = lower(value);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  assert.deepEqual(atomicCompletionInput(result.command.rulesInput).steps[2].rulesInput.plan.branches.success.effects[0].damage.area, trigger.branches.success.effects[0].damage.area);
  trigger.branches.success.effects[0].damage.area.affectedEntityIds = [ACTOR];
  assert.equal(validateVNextProposalBundle(value).kind, "rejected");
});

test("author-authored Item sets normalize presentation order before canonical registration without accepting duplicates",()=>{
  for(const content of [item({aliases:['z','a'],tags:['healing','consumable']}),
    item({category:'equipment',stackable:false,use:null,equipment:{allowedSlots:['off','main'],twoHanded:false,armor:null,weapon:null},equippedAbilityRefs:['ability:z','ability:a']})]) {
    const value={kind:'item',content};
    assert.equal(isAuthoredDefinitionSource(value),true);
    const result=materializedAuthoredDefinition(ROOT,plan(value,I));
    assert.ok(result);
    assert.deepEqual(result.definition.content.tags,[...content.tags].sort());
    assert.deepEqual(result.definition.content.equippedAbilityRefs,[...content.equippedAbilityRefs].sort());
    const duplicate=structuredClone(value);duplicate.content.tags=['same','same'];
    assert.equal(isAuthoredDefinitionSource(duplicate),false);
  }
});
