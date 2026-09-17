// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { prepareStory } from "../../../app/_runtime/lib/room/story-creation/index.ts";
import { storyFixture } from "../../support/fixtures/story-creation.mjs";
import { harness } from '../../support/fixtures/story-preparation-harness.mjs';


test("a saved complete package survives recipe removal and resumes without invoking the provider", async () => {
  const f = storyFixture(), h = harness(f), first = await h.run();
  assert.equal(first.kind, "ready");
  h.ports.recipes = [];
  const resumed = await h.run();
  assert.deepEqual(resumed, first);
  assert.deepEqual(h.calls, ["draft", "review"]);
  assert.equal(h.requests.length, 2, "ready recovery does not even enter invoke");
});


test("lost checkpoint save recovers the exact persisted model response rather than regenerating the draft", async () => {
  const f = storyFixture(); let loseOnce = true;
  const h = harness(f, { failSave: next => { if (next.draft && loseOnce) { loseOnce = false; return true; } return false; } });
  const first = await h.run(); assert.equal(first.kind, "waiting"); assert.equal(first.code, "STORY_CHECKPOINT_CONFLICT");
  assert.deepEqual(h.calls, ["draft"]);
  const second = await h.run(); assert.equal(second.kind, "ready", JSON.stringify(second));
  assert.deepEqual(h.calls, ["draft", "review"]);
  assert.deepEqual(h.requests.map(request => request.stage), ["draft", "draft", "review"]);
});


test("waiting, unknown calls and budget failures never become an empty world or obtain another provider sample", async () => {
  for (const code of ["STORY_INVOCATION_PENDING", "STORY_INVOCATION_UNKNOWN", "STORY_BUDGET_EXHAUSTED"]) {
    const f = storyFixture(), h = harness(f, { outcome: () => ({ kind: "waiting", code }) });
    const first = await h.run(); assert.equal(first.kind, "waiting"); assert.equal(first.code, code);
    assert.equal(first.checkpoint.status, "preparing");
    const second = await h.run(); assert.deepEqual(second, first); assert.deepEqual(h.calls, ["draft"]);
  }
  const f = storyFixture(), h = harness(f, { outcome: () => ({ kind: "rejected", code: "STORY_PROVIDER_FAILED" }) });
  assert.equal((await h.run()).code, "STORY_PROVIDER_FAILED"); assert.equal((await h.run()).kind, "rejected"); assert.equal(h.calls.length, 1);
});


test("checkpoint forgery cannot skip the review or cross job identities", async () => {
  const f = storyFixture(), h = harness(f); const ready = await h.run();
  for (const mutate of [
    checkpoint => { checkpoint.jobId = "some-other-job"; },
    checkpoint => { delete checkpoint.review; },
    checkpoint => { checkpoint.draft.cause = "replaced after review"; },
    checkpoint => { checkpoint.draft.version = "2"; },
  ]) {
    const checkpoint = structuredClone(ready.checkpoint); mutate(checkpoint);
    const result = await prepareStory(f.request, f.context, checkpoint, h.ports);
    assert.equal(result.kind, "rejected"); assert.equal(result.code, "STORY_CHECKPOINT_CONFLICT");
  }
  assert.equal(h.calls.length, 2);
});
