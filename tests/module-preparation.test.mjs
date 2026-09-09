import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authoritativeModuleProfile, moduleAuthorityFactSeeds, moduleInitializationFixtures } from "../app/_runtime/lib/module/authoritative.ts";
import { modulePreparationSeeds, validateModulePreparation } from "../app/_runtime/lib/module/preparation.ts";
import { moduleNpcSemanticSeeds } from "../app/_runtime/lib/module/npc-semantics.ts";
import { projectInitializationFixtures } from "../app/_runtime/lib/room/proposal-adapter.ts";
import { createVersionedRulesRuntime } from "../app/_runtime/lib/rules/v2-runtime.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical.ts";
import { authorityRevisionOrHash } from "../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { heldKnowledgeNarrationFacts } from "../app/_runtime/lib/rules/v2/knowledge-expression.ts";

const catalog = JSON.parse(readFileSync(new URL("../app/_runtime/lib/module/black-oak-will-preparation.json", import.meta.url), "utf8"));
const profile = await authoritativeModuleProfile("black-oak-will");
const runtime = createVersionedRulesRuntime({
  registrations: [{ manifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, interpreterKind: "authoritative-v2" }],
  defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest,
});
const actor = (id, sceneId, skills = []) => ({ id, kind: "player", name: id, sceneId,
  tenureStatus: "active", classId: "fighter", level: 3,
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2, proficientSkills: skills,
  loadout: { armorClass: 10, speedFeet: 30, equipped: {}, backpack: [] } });

function initialize(players = [actor("alice", "wake", ["religion"]), actor("bob", "wake", ["investigation"]), actor("carol", "cellar")], extra = {}) {
  const preparation = modulePreparationSeeds(profile, players);
  const npcs = moduleNpcSemanticSeeds(profile);
  const fixtures = projectInitializationFixtures(moduleInitializationFixtures(profile), players.map(player => ({
    characterId: player.id, staticCard: { name: player.name, sceneId: player.sceneId },
  })));
  const input = {
    kind: "initializeAuthoritativeWorld", roomId: "room:module-preparation", runtimeEpochId: "epoch:module-preparation",
    moduleRef: profile.moduleRef, initialDefinitionCatalogRef: preparation.catalogRef,
    activeBranchId: "branch:module-preparation", fictionInstantMicros: "0",
    scenes: profile.storyBible.storyAnchors.locations.map(scene => ({ id: scene.sceneId, name: scene.name, geometry: scene.tacticalGeometry })),
    principals: players.map(player => ({ id: `principal:${player.id}`, sessionVersion: 1, role: "player" })),
    seats: players.map(player => ({ id: `seat:${player.id}`, principalId: `principal:${player.id}`, status: "active" })),
    characters: [...players, ...profile.storyBible.importantNpcs.map(npc => ({ id: npc.entityId, kind: "npc", name: npc.name,
      sceneId: npc.startSceneId, tenureStatus: "active", spatialVisibilityPolicyId: "visibility:scene-observers" }))],
    characterControls: players.map(player => ({ characterId: player.id, seatId: `seat:${player.id}` })),
    canonicalFacts: [...moduleAuthorityFactSeeds(profile), ...preparation.canonicalFacts],
    initialKnowledge: [...fixtures.initialKnowledge, ...preparation.initialKnowledge],
    vNextSeed: { semanticDefinitions: npcs.map(npc => npc.definition), entityDefinitionBindings: npcs.map(npc => npc.binding),
      itemDefinitions: preparation.itemDefinitions, itemEntries: preparation.itemEntries },
    ...extra,
  };
  const initialized = runtime.step(undefined, undefined, input);
  assert.equal(initialized.kind, "initialized", JSON.stringify(initialized));
  const replayed = runtime.replay(initialized.genesis, []);
  assert.equal(replayed.kind, "replayed", JSON.stringify(replayed));
  return { ...replayed, genesis: initialized.genesis, profiles: initialized.profiles, input, preparation };
}

function playerView(fixture, id) {
  const result = runtime.project(fixture.profiles, fixture.state, { kind: "player", characterId: id,
    principalId: `principal:${id}`, seatId: `seat:${id}`, sessionVersion: 1 });
  assert.equal(result.kind, "projected", JSON.stringify(result));
  return result;
}

test("prepares held keys, scene documents and concealed discoveries through the same catalog and Rules genesis", () => {
  const fixture = initialize();
  const system = fixture.state.campaignRuntime.itemSystem;
  assert.equal(catalog.items.length, 10);
  assert.equal(Object.keys(system.definitions).length, 10);
  for (const item of catalog.items) {
    assert.deepEqual(system.definitions[item.definition.definitionId], item.definition);
    const fact = fixture.state.canonicalFacts[item.fact.id];
    assert.equal(fact.visibilityPolicyId, "visibility:room-authority-only");
    if (item.materialization === "initial") {
      assert.ok(system.entries[item.entry.entryId]);
      assert.equal(system.entries[item.entry.entryId].quantity, 1);
      assert.equal(system.entries[item.entry.entryId].holderRef, item.entry.placement.holderRef ?? null);
    } else {
      assert.equal(system.entries[item.entry.entryId], undefined);
      assert.equal(fact.value.discovery.uniquenessBasisRef, fact.id);
    }
  }
  assert.deepEqual(fixture.genesis.initialDefinitionCatalogRef, fixture.preparation.catalogRef);
  const other = initialize();
  assert.deepEqual(other.state, fixture.state);
});

test("opening knowledge follows actual scene, training and NPC holder, and remains narratable", () => {
  const fixture = initialize();
  const knowledge = id => JSON.stringify(Object.values(fixture.state.knowledge[id]));
  assert.match(knowledge("alice"), /宗教知识/);
  assert.doesNotMatch(knowledge("alice"), /文书辨识训练|真印被我偷用|我后加了/);
  assert.match(knowledge("bob"), /文书辨识训练/);
  assert.doesNotMatch(knowledge("bob"), /宗教知识|真印被我偷用/);
  assert.equal(knowledge("carol"), "[]");
  const lian = "npc:black-oak-will:lian", naes = "npc:black-oak-will:naes";
  assert.match(knowledge(lian), /不知道藏处和完整正文/);
  assert.doesNotMatch(knowledge(lian), /真印被我偷用|我后加了原件/);
  assert.match(knowledge(naes), /真印被我偷用/);
  for (const records of Object.values(fixture.state.knowledge)) {
    assert.doesNotThrow(() => heldKnowledgeNarrationFacts("allKnown", Object.values(records), new Map()));
  }
  for (const id of ["alice", "bob", "carol"]) {
    const encoded = JSON.stringify(playerView(fixture, id));
    assert.doesNotMatch(encoded, /真印被我偷用|第三份遗嘱，唯一原件|准备发掘|第二份遗嘱是我伪造/);
  }
});

test("rejects duplicate identities, wrong profile, unknown holder and unresolved knowledge sources", () => {
  for (const mutate of [
    value => { value.items.push(structuredClone(value.items[0])); },
    value => { value.moduleRef.profileHash = `sha256:${"0".repeat(64)}`; },
    value => { value.items[0].entry.placement.holderRef = "npc:unknown"; },
    value => { value.knowledge[0].content.sourceRefs = ["unknown:source"]; },
    value => { value.items[0].fact.clueIds = ["unknown:clue"]; },
  ]) {
    const value = structuredClone(catalog); mutate(value);
    assert.throws(() => validateModulePreparation(value, profile));
  }
  const fixture = initialize();
  const duplicate = structuredClone(fixture.input);
  duplicate.vNextSeed.itemEntries.push(duplicate.vNextSeed.itemEntries[0]);
  assert.equal(runtime.step(undefined, undefined, duplicate).kind, "rejected");
});

test("a concealed prepared object materializes from its existing definition once and replays exactly", () => {
  const fixture = initialize([actor("alice", "shrine")]);
  const prepared = catalog.items.find(item => item.materialization === "onDiscovery" && item.fact.sceneId === "shrine");
  const refs = ["alice", "shrine", prepared.fact.id, prepared.definition.definitionId].sort();
  const input = root => ({ kind: "materializeItem", rootActionId: root, actorCharacterId: "alice", plan: {
    schema: "zhuwei.authored-item-materialization-plan/vnext-1", handle: "prospective:discovered-item",
    bundleHash: canonicalSha256({ root }), summary: "打开木盒后发现已经准备好的残页。",
    contextHash: canonicalSha256({ root }),
    readSet: refs.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(fixture.state, ref) })),
    basisRefs: [prepared.fact.id], sourceRefs: [prepared.fact.id],
    definitionRef: prepared.definition.definitionId, sceneRef: "shrine", quantity: 1,
    ownership: prepared.entry.ownership, visibilityPolicyRef: "visibility:scene-observers",
    uniquenessBasisRef: prepared.fact.id,
  } });
  const result = runtime.step(fixture.profiles, fixture.state, input("root:discovery"));
  assert.equal(result.kind, "committed", JSON.stringify(result));
  fixture.state = result.state;
  assert.ok(fixture.state.campaignRuntime.itemSystem.entries[prepared.entry.entryId]);
  assert.equal(Object.values(fixture.state.campaignRuntime.itemSystem.entries)
    .filter(entry => entry.definitionRef === prepared.definition.definitionId).length, 1);
  assert.equal(runtime.step(fixture.profiles, fixture.state, input("root:second-discovery")).kind, "rejected");
  const restored = runtime.replay(fixture.genesis, result.events);
  assert.equal(restored.kind, "replayed", JSON.stringify(restored));
  assert.deepEqual(restored.state, fixture.state);
  const initial = catalog.items.find(item => item.materialization === "initial" && item.fact.sceneId === "shrine");
  const duplicate = input("root:initial-duplicate");
  duplicate.plan.definitionRef = initial.definition.definitionId;
  duplicate.plan.basisRefs = duplicate.plan.sourceRefs = [initial.fact.id];
  duplicate.plan.uniquenessBasisRef = initial.fact.id;
  duplicate.plan.readSet = ["alice", "shrine", initial.fact.id, initial.definition.definitionId].sort()
    .map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(fixture.state, ref) }));
  assert.equal(runtime.step(fixture.profiles, fixture.state, duplicate).kind, "rejected");
});
