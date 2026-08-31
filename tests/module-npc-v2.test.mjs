import assert from "node:assert/strict";
import test from "node:test";

import { entityOccupanciesOverlap } from "../app/_runtime/lib/rules/profiles/combat-geometry.ts";

import {
  authoritativeModuleProfile,
  moduleInitializationFixtures,
  moduleKpProjection,
  modulePublicCatalogEntry,
  verifyAuthoritativeModuleProfile,
} from "../app/_runtime/lib/module/authoritative.ts";

const MODULE_ID = "black-oak-will";

test("keeps product 0.4's single Module Bible byte-pinned and fails closed for retired versions", async () => {
  const profile = await authoritativeModuleProfile(MODULE_ID, "social-resolution-v1");
  assert.equal(profile.moduleId, MODULE_ID);
  assert.equal(profile.moduleVersion, "social-resolution-v1");
  assert.equal(profile.compatibleRulesetVersion, "dnd5e-2014-srd5.1-authoritative-v2");
  assert.deepEqual(profile.moduleRef, {
    profileId: "module:black-oak-will:social-resolution-v1",
    profileHash: "sha256:e04a553deb9808df6dc614e813fa503c6ff659cae2570e738969ac0e70fbc272",
  });
  assert.match(profile.moduleRef.profileHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await verifyAuthoritativeModuleProfile(profile), true);

  await assert.rejects(
    authoritativeModuleProfile("unknown-module"),
    /unknown authoritative module/i,
  );
  await assert.rejects(
    authoritativeModuleProfile("black-oak-will", "retired-module-version"),
    /unknown authoritative module version/i,
  );

  const tampered = structuredClone(profile);
  tampered.storyBible.coreTruth += " altered";
  assert.equal(await verifyAuthoritativeModuleProfile(tampered), false);
});

test("defaults product 0.4 rooms to the pinned social/tactical Module Bible with real geometry", async () => {
  const profile = await authoritativeModuleProfile(MODULE_ID);
  assert.equal(profile.moduleVersion, "social-resolution-v1");
  assert.deepEqual(profile.moduleRef, {
    profileId: "module:black-oak-will:social-resolution-v1",
    profileHash: "sha256:e04a553deb9808df6dc614e813fa503c6ff659cae2570e738969ac0e70fbc272",
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

test("maps the upstream module DSL into story anchors and open blanks, never an action whitelist", async () => {
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
