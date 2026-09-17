// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { createStoryRecipes, STORY_CREATION_WORKFLOW, STORY_CREATION_WORKFLOW_REF } from "../../../app/_runtime/lib/room/story-creation/index.ts";
import { hashStory, storyFixture } from "../../support/fixtures/story-creation.mjs";
import { harness, rehash } from '../../support/fixtures/story-preparation-harness.mjs';


test("decisive missing/ambiguous context, hash tampering and missing capability contracts block before any call", async () => {
  for (const mutate of [
    f => { f.context.missingRequiredRefs = ["fact:necessary-history"]; rehash(f.context); },
    f => { f.context.materials.find(m => m.ref === "npc:boatman").availability = "ambiguous"; rehash(f.context); },
    f => { f.context.materials.find(m => m.kind === "contentBoundary").availability = "unavailable"; rehash(f.context); },
    f => { f.context.materials[0].content = "tampered without a new context hash"; },
  ]) {
    const f = storyFixture(); mutate(f); const h = harness(f), result = await h.run();
    assert.equal(result.code, "STORY_CONTEXT_INSUFFICIENT"); assert.equal(h.calls.length, 0);
  }
  const f = storyFixture("investigation");
  f.context.materials = f.context.materials.filter(m => m.ref !== "contract:materializeNpc"); rehash(f.context);
  const h = harness(f), result = await h.run();
  assert.equal(result.code, "STORY_CAPABILITY_UNSUPPORTED"); assert.equal(h.calls.length, 0);
});


test("the current workflow and recipe contents are exact immutable bindings; conflicts do not depend on load order", async () => {
  assert.equal(STORY_CREATION_WORKFLOW_REF.hash, hashStory(STORY_CREATION_WORKFLOW));
  assert.ok(Object.isFrozen(STORY_CREATION_WORKFLOW.schemas.preparation.properties.title));
  for (const mutate of [
    f => { f.request.workflowRef = { ...f.request.workflowRef, version: "999" }; },
    f => { f.request.workflowRef = { ...f.request.workflowRef, hash: hashStory("unknown-workflow") }; },
  ]) {
    const f = storyFixture(); mutate(f); const h = harness(f);
    assert.equal((await h.run()).code, "STORY_CAPABILITY_UNSUPPORTED"); assert.equal(h.calls.length, 0);
  }
  const changed = storyFixture(), h = harness(changed);
  h.ports.recipes = h.ports.recipes.map(recipe => recipe.ref.id === changed.request.recipeRefs[0].id ? { ...recipe, instructions: "silently changed" } : recipe);
  assert.equal((await h.run()).code, "STORY_RECIPE_UNAVAILABLE"); assert.equal(h.calls.length, 0);
  for (const reversed of [false, true]) {
    const f = storyFixture(); f.request.recipeRefs = f.recipes.filter(recipe => recipe.dimension === "method").map(recipe => recipe.ref);
    if (reversed) f.request.recipeRefs.reverse();
    const runner = harness(f); assert.equal((await runner.run()).code, "STORY_RECIPE_CONFLICT"); assert.equal(runner.calls.length, 0);
  }
  assert.deepEqual(createStoryRecipes(hashStory), storyFixture().recipes);
});


test("relevant changed context cannot reuse the old review, while an ordinary question requests no story", async () => {
  const f = storyFixture(), h = harness(f); assert.equal((await h.run()).kind, "ready");
  f.context.materials.find(material => material.ref === "npc:boatman").content = { name: "林舟", dead: true };
  rehash(f.context);
  const stale = await h.run(); assert.equal(stale.kind, "waiting"); assert.equal(stale.code, "STORY_CONTEXT_STALE"); assert.equal(h.calls.length, 2);
  const ordinary = storyFixture(); ordinary.request.trigger.kind = "ordinaryResponse";
  const plain = harness(ordinary), result = await plain.run();
  assert.equal(result.kind, "noStory"); assert.equal(plain.calls.length, 0); assert.deepEqual(await plain.run(), result);
});
