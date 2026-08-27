import assert from "node:assert/strict";
import test from "node:test";

import { entityOccupanciesOverlap } from "../app/_runtime/lib/rules/profiles/combat-geometry.ts";

import {
  authoritativeModuleMigration,
  authoritativeModuleProfile,
  moduleInitializationFixtures,
  moduleKpProjection,
  modulePublicCatalogEntry,
  verifyAuthoritativeModuleMigration,
  verifyAuthoritativeModuleProfile,
} from "../app/_runtime/lib/module/authoritative.ts";

const MODULE_ID = "black-oak-will";

test("keeps the legacy-v1 Module Bible byte-pinned and fails closed for unknown module versions", async () => {
  const profile = await authoritativeModuleProfile(MODULE_ID, "legacy-anchor-v1");
  assert.equal(profile.moduleId, MODULE_ID);
  assert.equal(profile.moduleVersion, "legacy-anchor-v1");
  assert.equal(profile.compatibleRulesetVersion, "dnd5e-2014-srd5.1-authoritative-v2");
  assert.deepEqual(profile.moduleRef, {
    profileId: "module:black-oak-will:legacy-anchor-v1",
    profileHash: "sha256:198ad1c122a84abffc881cfb4b0c5f6bcb32cd2411acb07aceb33163694b37f9",
  });
  assert.match(profile.moduleRef.profileHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await verifyAuthoritativeModuleProfile(profile), true);

  await assert.rejects(
    authoritativeModuleProfile("unknown-module"),
    /unknown authoritative module/i,
  );
  await assert.rejects(
    authoritativeModuleProfile("black-oak-will", "legacy-anchor-v999"),
    /unknown authoritative module version/i,
  );

  const tampered = structuredClone(profile);
  tampered.storyBible.coreTruth += " altered";
  assert.equal(await verifyAuthoritativeModuleProfile(tampered), false);
});

test("defaults new rooms to the pinned tactical Module Bible with real geometry for every location", async () => {
  const profile = await authoritativeModuleProfile(MODULE_ID);
  assert.equal(profile.moduleVersion, "tactical-map-v1");
  assert.deepEqual(profile.moduleRef, {
    profileId: "module:black-oak-will:tactical-map-v1",
    profileHash: "sha256:df49e12260b590d339961c2a19b3ddc5f59741d2a8521d4d97dbf151d9177947",
  });
  assert.equal(await verifyAuthoritativeModuleProfile(profile), true);
  assert.equal(profile.storyBible.storyAnchors.locations.length, 8);
  for (const location of profile.storyBible.storyAnchors.locations) {
    assert.equal(location.tacticalGeometry?.schema, "zhuwei.tactical-geometry/v1");
    assert.equal(location.tacticalGeometry?.unit, "inch");
    assert.ok(location.tacticalGeometry?.boundary.points.length >= 3, location.sceneId);
    assert.ok(location.tacticalGeometry?.spawnPoints.length >= 1, location.sceneId);
    assert.ok(location.tacticalGeometry?.obstacles.length >= 1, location.sceneId);
    const geometry = location.tacticalGeometry;
    for (const [index, spawn] of geometry.spawnPoints.entries()) {
      const spawnedCharacter = {
        entityId: `spawn:${location.sceneId}:${index}`,
        sceneId: location.sceneId,
        position: spawn,
        footprint: { width: "60", depth: "60", height: "60" },
      };
      for (const obstacle of geometry.obstacles.filter((entry) => entry.impassable)) {
        const xs = obstacle.polygon.map(({ x }) => BigInt(x));
        const ys = obstacle.polygon.map(({ y }) => BigInt(y));
        const left = xs.reduce((minimum, value) => value < minimum ? value : minimum);
        const right = xs.reduce((maximum, value) => value > maximum ? value : maximum);
        const top = ys.reduce((minimum, value) => value < minimum ? value : minimum);
        const bottom = ys.reduce((maximum, value) => value > maximum ? value : maximum);
        assert.equal(
          entityOccupanciesOverlap(spawnedCharacter, {
            entityId: obstacle.featureId,
            sceneId: location.sceneId,
            position: {
              x: ((left + right) / 2n).toString(),
              y: ((top + bottom) / 2n).toString(),
              elevation: obstacle.elevation,
            },
            footprint: {
              width: (right - left).toString(),
              depth: (bottom - top).toString(),
              height: obstacle.height,
            },
          }),
          false,
          `${location.sceneId} spawn ${index} overlaps ${obstacle.featureId}`,
        );
      }
    }
  }
});

test("keeps two exact compatible module versions and only accepts the approved chapter migration", async () => {
  const first = await authoritativeModuleProfile(MODULE_ID, "legacy-anchor-v1");
  const second = await authoritativeModuleProfile(MODULE_ID, "legacy-anchor-v2");
  assert.equal(second.moduleId, first.moduleId);
  assert.equal(second.moduleVersion, "legacy-anchor-v2");
  assert.equal(second.compatibleRulesetVersion, first.compatibleRulesetVersion);
  assert.deepEqual(second.moduleRef, {
    profileId: "module:black-oak-will:legacy-anchor-v2",
    profileHash: "sha256:283e0b6dfd7bab0a27895e741b9b56a2c536ba02ef922d4a35ebe43227ce0a03",
  });
  assert.equal(await verifyAuthoritativeModuleProfile(second), true);

  const migration = await authoritativeModuleMigration(
    MODULE_ID,
    first.moduleVersion,
    second.moduleVersion,
  );
  assert.deepEqual(migration.fromModuleRef, first.moduleRef);
  assert.deepEqual(migration.toModuleRef, second.moduleRef);
  assert.equal(migration.chapterBoundaryOnly, true);
  assert.equal(migration.mappingPolicy, "preserveAuthoritativeRoomState");
  assert.deepEqual(migration.preservedState, [
    "activities",
    "artifacts",
    "canonicalFacts",
    "corrections",
    "debts",
    "dynamicDefinitions",
    "factionPlans",
    "knowledge",
    "npcPlans",
    "promises",
    "relationships",
    "threats",
  ]);
  assert.match(migration.migrationRef.profileHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await verifyAuthoritativeModuleMigration(migration), true);

  const tampered = structuredClone(migration);
  tampered.toModuleRef.profileHash = `sha256:${"0".repeat(64)}`;
  assert.equal(await verifyAuthoritativeModuleMigration(tampered), false);
  await assert.rejects(
    authoritativeModuleMigration(MODULE_ID, second.moduleVersion, first.moduleVersion),
    /unapproved authoritative module migration/i,
  );
});

test("adapts the legacy DSL into story anchors and open blanks, never an action whitelist", async () => {
  const profile = await authoritativeModuleProfile(MODULE_ID);
  const bible = profile.storyBible;

  assert.ok(bible.coreTruth.length > 100);
  assert.ok(bible.storyAnchors.chapters.length >= 2);
  assert.ok(bible.storyAnchors.locations.length >= 2);
  assert.ok(bible.storyAnchors.clues.length > 0);
  assert.ok(bible.importantNpcs.length > 0);
  assert.ok(bible.openBlanks.length > 0);
  assert.ok(bible.initialPressures.length > 0);
  assert.ok(bible.sequelSignals.length >= 2);
  assert.equal(profile.legacyAdapter.sourceRulesetVersion, "dnd5e-2014-srd5.1-v1");
  assert.equal(profile.legacyAdapter.mode, "storyAnchorsOnly");

  const encoded = JSON.stringify(profile);
  for (const forbiddenKey of [
    '"interactions"',
    '"npcPlans"',
    '"scheduledEvents"',
    '"endings"',
    '"worldState"',
    '"commandWhitelist"',
  ]) {
    assert.equal(encoded.includes(forbiddenKey), false, `${forbiddenKey} must not become v2 authority`);
  }
});

test("keeps core truth in the KP projection and removes it from the public catalog", async () => {
  const profile = await authoritativeModuleProfile(MODULE_ID);
  const kp = moduleKpProjection(profile);
  const catalog = modulePublicCatalogEntry(profile);

  assert.equal(kp.viewer.kind, "kp");
  assert.equal(kp.moduleRef.profileHash, profile.moduleRef.profileHash);
  assert.equal(kp.storyBible.coreTruth, profile.storyBible.coreTruth);
  assert.ok(kp.storyBible.importantNpcs.every((npc) => Array.isArray(npc.initialKnowledge)));

  const publicEncoded = JSON.stringify(catalog);
  assert.equal(publicEncoded.includes(profile.storyBible.coreTruth), false);
  assert.equal(publicEncoded.includes("initialKnowledge"), false);
  assert.equal(publicEncoded.includes("doesNotKnow"), false);
  assert.deepEqual(Object.keys(catalog).sort(), [
    "compatibleRulesetVersion",
    "moduleId",
    "moduleRef",
    "moduleVersion",
    "title",
    "tone",
  ]);
});

test("seeds each NPC with only its own finite knowledge and a stable starting scene", async () => {
  const profile = await authoritativeModuleProfile(MODULE_ID);
  const fixtures = moduleInitializationFixtures(profile);
  const npcIds = new Set(profile.storyBible.importantNpcs.map((npc) => npc.entityId));

  assert.ok(fixtures.length > 0);
  assert.ok(fixtures.every((fixture) => npcIds.has(fixture.holderEntityId)));
  assert.ok(fixtures.every((fixture) => fixture.knowledgeRef.startsWith(`${fixture.holderEntityId}:module-knowledge:`)));
  assert.ok(fixtures.every((fixture) => typeof fixture.content === "string" && fixture.content.length > 0));
  assert.ok(fixtures.every((fixture) => typeof fixture.sceneId === "string" && fixture.sceneId.length > 0));
  assert.ok(fixtures.every((fixture) => typeof fixture.holderName === "string" && fixture.holderName.length > 0));

  for (const npc of profile.storyBible.importantNpcs) {
    const own = fixtures.filter((fixture) => fixture.holderEntityId === npc.entityId);
    assert.deepEqual(own.map((fixture) => fixture.content), npc.initialKnowledge);
  }
});
