// Shared deterministic setup; no test registration or real model calls.
import assert from "node:assert/strict";
import { prepareStory } from "../../../app/_runtime/lib/room/story-creation/index.ts";
import { hashStory, storyResponse } from "./story-creation.mjs";


function harness(fixture, options = {}) {
  let checkpoint = null;
  const calls = [], requests = [], ledger = new Map(), saves = [];
  const ports = {
    recipes: fixture.recipes, hash: hashStory,
    async invoke(request) {
      requests.push(structuredClone(request));
      const key = `${request.jobId}:${request.stage}`;
      if (ledger.has(key)) {
        const row = ledger.get(key);
        assert.equal(row.requestHash, hashStory(request), "saved stage cannot change exact request");
        return structuredClone(row.outcome);
      }
      calls.push(request.stage);
      assert.ok(calls.length <= 4, "one job never receives a fifth provider call");
      const response = options.response?.(request) ?? storyResponse(request.stage.endsWith("Review") || request.stage === "review"
        ? fixture.review : fixture.body, request.stage);
      const outcome = options.outcome?.(request) ?? { kind: "completed", response };
      ledger.set(key, { requestHash: hashStory(request), outcome: structuredClone(outcome) });
      return outcome;
    },
    async saveCheckpoint(expected, next) {
      if (expected !== (checkpoint?.revision ?? 0) || options.failSave?.(next, saves)) return { ok: false, code: "STORY_CHECKPOINT_CONFLICT" };
      assert.equal(next.revision, expected + 1);
      checkpoint = structuredClone(next); saves.push(structuredClone(next));
      return { ok: true, checkpoint: structuredClone(checkpoint) };
    },
  };
  return { ports, calls, requests, saves, ledger, get checkpoint() { return structuredClone(checkpoint); },
    run: () => prepareStory(fixture.request, fixture.context, structuredClone(checkpoint), ports) };
}

function rehash(context) {
  const { contextHash: _, ...body } = context;
  context.contextHash = hashStory(body);
}
export { harness, rehash };
