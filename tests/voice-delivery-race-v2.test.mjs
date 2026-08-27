import assert from "node:assert/strict";
import test from "node:test";

import { synthesizeCurrentDeliveryNarration } from "../app/_runtime/lib/voice/current-delivery.ts";

function current(deliveryId, payloadHash, text = "只属于当前 ViewerKey 的回应") {
  return {
    readModel: { kind: "projected" },
    delivery: {
      kind: "current",
      frame: { deliveryId, payloadHash, text },
    },
  };
}

test("TTS discards generated audio when ACK, overwrite, or revocation invalidates the frame in flight", async () => {
  for (const invalidated of [
    { readModel: { kind: "projected" }, delivery: { kind: "none" } },
    current("delivery:newer", "sha256:newer", "更新的回应"),
    { kind: "rejected", code: "viewerUnauthorized" },
  ]) {
    let observation = current("delivery:private", "sha256:private");
    let release;
    const synthesisStarted = new Promise((resolve) => {
      release = resolve;
    });
    let allowSynthesis;
    const synthesisMayFinish = new Promise((resolve) => {
      allowSynthesis = resolve;
    });
    const queries = [];

    const pending = synthesizeCurrentDeliveryNarration({
      messageId: "delivery:private",
      observe: async (query) => {
        queries.push(query);
        return structuredClone(observation);
      },
      synthesize: async () => {
        release();
        await synthesisMayFinish;
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      },
    });

    await synthesisStarted;
    observation = invalidated;
    allowSynthesis();
    assert.deepEqual(await pending, { kind: "unavailable" });
    assert.deepEqual(queries, [
      { channel: "voice", referenceId: "delivery:private" },
      { channel: "voice", referenceId: "delivery:private" },
    ]);
  }
});

test("TTS returns bytes only while the same delivery and payload commitment remain current", async () => {
  const result = await synthesizeCurrentDeliveryNarration({
    messageId: "delivery:current",
    observe: async () => current("delivery:current", "sha256:current"),
    synthesize: async (text) => {
      assert.equal(text, "只属于当前 ViewerKey 的回应");
      return new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { "content-type": "audio/ogg; codecs=opus" },
      });
    },
  });

  assert.equal(result.kind, "audio");
  assert.deepEqual([...result.bytes], [7, 8, 9]);
  assert.equal(result.mime, "audio/ogg");
});
