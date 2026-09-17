// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { storyReviewAllowsRevision, storyReviewPassed } from "../../../app/_runtime/lib/room/story-creation/index.ts";
import { hashStory, storyFixture } from "../../support/fixtures/story-creation.mjs";
import { harness } from '../../support/fixtures/story-preparation-harness.mjs';


for (const kind of ["conflict", "investigation", "long"]) test(`${kind}: complete preparation and independent review use the same Interface`, async () => {
  const fixture = storyFixture(kind), original = structuredClone(fixture), h = harness(fixture);
  const result = await h.run();
  assert.equal(result.kind, "ready", JSON.stringify(result));
  assert.deepEqual(h.calls, ["draft", "review"]);
  assert.equal(result.preparation.requestHash, hashStory(fixture.request));
  assert.equal(result.review.preparationHash, hashStory(result.preparation));
  assert.equal(result.review.contextHash, fixture.context.contextHash);
  assert.equal(result.preparation.version, "1");
  assert.deepEqual(result.preparation.facts, fixture.body.facts);
  assert.ok(result.preparation.scenes[0].exitConditions.length > 0);
  assert.ok(result.preparation.resolutions.some(resolution => resolution.ref === "resolution:lost-window"));
  assert.ok(result.preparation.evidence[0].sources.length >= 2);
  assert.equal(result.preparation.developments[0].execution, "pendingWorldAdjudication");
  assert.deepEqual(fixture, original, "preparation must not mutate world materials, request, or recipes");
  assert.ok(Object.isFrozen(result.preparation.facts[0].knowledge[0]));
  assert.ok(storyReviewPassed(result.review));
  assert.equal(storyReviewAllowsRevision(result.review), false);
  assert.equal(h.saves[0].revision, 1);
  assert.ok(h.saves[1].draft && !h.saves[1].review, "draft is saved before a review call");
  const prompt = JSON.parse(h.requests[1].messages[1].content);
  assert.deepEqual(prompt.preparation, result.preparation, "independent reviewer sees the exact saved draft");
  assert.equal(h.requests[0].requestHash, hashStory(fixture.request));
  assert.ok(!Object.hasOwn(h.requests[0].schema.properties, "jobId"));
  assert.ok(!Object.hasOwn(h.requests[1].schema.properties, "preparationHash"));
  if (kind === "investigation") {
    const npc = result.preparation.participants.find(participant => participant.identity === "new");
    assert.ok(result.preparation.definitions.some(definition => definition.ref === npc.ref && definition.kind === "npc"));
    assert.equal(typeof result.preparation.definitions[0].payload, "object", "wire JSON is decoded without changing payload semantics");
  }
  if (kind === "long") assert.equal(new Set(result.preparation.stages.map(stage => stage.question)).size, 2);
});
