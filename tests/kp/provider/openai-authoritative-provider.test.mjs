import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIAuthoritativeBinding, openAIRequestBody, assertOpenAIStrictToolModelInput } from "../../../app/_runtime/lib/kp/openai.ts";
import { kpRequestBody } from "../../../app/_runtime/lib/kp/model-request.ts";
import { classifyModelError } from "../../../app/_runtime/lib/kp/authoritative-helpers.ts";
import { diagnoseFailure } from "../../../app/_runtime/lib/platform/failure-diagnostics.ts";
import { DEFAULT_KP_MODEL, GPT_6_LUNA_MODEL } from "../../../app/_runtime/lib/kp/models.ts";
import { createVNextProposalOfferModelInput, createSubmitKpProposalBundleModelInput, createNpcReplySchema } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { NPC_REPLY_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/npc-reply.ts";
import { textNarrationModelInput, textNarrationReviewInput } from "../../../app/_runtime/lib/kp/narration-text.ts";
import { WORLD_STORY_SELECTION_TOOL } from "../../../app/_runtime/lib/room/story-world-event.ts";
import { transfer } from "../../support/fixtures/narration.mjs";

// SPEC 0011 §§1、3–4: provider translation keeps the same KP contract;
// errors retain their classification and cannot send to a different model.
const model = GPT_6_LUNA_MODEL;
const socialInput = createSubmitKpProposalBundleModelInput(
  "问问lian关于这片黑橡叶，她知道些什么吗", ["social"], undefined, undefined, undefined,
  [{ npcRef: "npc:lian", refs: ["npc-decision:lian"], factRefs: [] }],
);
// SPEC 0016 §7.3 (ADR 0073): what an NPC says and undertakes is asked of the
// NPC in its own call, so the tables that cite the facts it can see -- and the
// empty list when it sees none -- are in the reply's form, not the ruling's.
const replyInput = { messages: [{ role: "system", content: "问问lian关于这片黑橡叶，她知道些什么吗" }, { role: "user", content: "回答。" }],
  tools: [{ type: "function", function: { name: NPC_REPLY_TOOL_NAME, strict: true, description: "NPC本人的回答。",
    parameters: createNpcReplySchema(["result"], "npc:lian", { npcRef: "npc:lian", refs: ["npc-decision:lian"], factRefs: [] },
      { observationSubjectRefs: [], itemEntryRefs: [] }) } }],
  tool_choice: "required", parallel_tool_calls: false, max_completion_tokens: 3_000 };
const requests = [
  ["proposal selection", createVNextProposalOfferModelInput("查看眼前的场景。")],
  ["structured proposal", createSubmitKpProposalBundleModelInput("查看眼前的场景。", ["worldInteraction", "observe"])],
  ["social proposal without available NPC facts", socialInput],
  ["NPC reply without available NPC facts", replyInput],
  ["plain narration", textNarrationModelInput(transfer(), model)],
  ["narration review", textNarrationReviewInput(transfer(), "远行者将两面镜子交给药师。", model)],
  ["world story selection", { tools: [WORLD_STORY_SELECTION_TOOL], tool_choice: { type: "function", function: { name: WORLD_STORY_SELECTION_TOOL.function.name } }, max_completion_tokens: 1_000 }],
];
for (const [name, input] of requests) {
  test(`Luna serializes ${name} identically for its journal and transport`, async () => {
    const calls = [], signal = new AbortController().signal;
    const response = { choices: [{ message: { content: "测试正文" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
    const binding = createOpenAIAuthoritativeBinding({ apiKey: "test-key", fetcher: async (url, init) => {
      calls.push({ url, init }); return Response.json(response);
    } });
    const before = structuredClone(input), journal = kpRequestBody(model, input);
    assert.deepEqual(await binding.run(model, journal, { signal }), response);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(calls[0].init.signal, signal);
    assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
    assert.equal(calls[0].init.body, JSON.stringify(journal));
    assert.deepEqual(input, before);
    assert.equal(journal.model, model);
    assert.equal(journal.reasoning_effort, "none");
    assert.equal(journal.store, false);
    assert.equal(journal.stream, false);
    assert.equal(journal.max_completion_tokens, input.max_completion_tokens);
    assert.ok(!("thinking" in journal) && !("max_tokens" in journal));
    if (journal.tools) assert.doesNotThrow(() => assertOpenAIStrictToolModelInput(journal));
  });
}

test("OpenAI schema conversion only translates keywords and references, preserving domain strings", () => {
  const schema = { type: "object", additionalProperties: false,
    properties: { $def: { $ref: "#/$def/value", description: "field guidance" } }, required: ["$def"],
    $def: { value: { type: "string", description: "literal #/$def/value", enum: ["#/$def/value"] } } };
  const input = { tools: [{ type: "function", function: { name: "test", strict: true, parameters: schema } }], tool_choice: "required", max_tokens: 200 };
  const body = openAIRequestBody(model, input), result = body.tools[0].function.parameters;
  assert.deepEqual(result.properties, { $def: { description: "field guidance", anyOf: [{ $ref: "#/$defs/value" }] } });
  assert.deepEqual(result.$defs.value, schema.$def.value);
  assert.equal(body.max_completion_tokens, 200);
  assert.deepEqual(openAIRequestBody(model, body), body);
  assert.doesNotThrow(() => assertOpenAIStrictToolModelInput(body));
  assert.throws(() => kpRequestBody("unregistered-model", input), /MODEL_PROFILE_UNAVAILABLE/);
  const original = kpRequestBody(DEFAULT_KP_MODEL, input);
  assert.deepEqual(original.tools[0].function.parameters, schema);
  assert.equal(original.max_tokens, 200);
  assert.deepEqual(original.thinking, { type: "disabled" });
});

test("Luna preserves empty-only reference lists inline and in shared social definitions", () => {
  // SPEC 0011 §3: provider dialect adaptation must preserve the KP contract.
  // An impossible item pattern made Luna return HTTP 400 even for {refs:[]}.
  const empty = { type: "array", description: "Only [] is authorized; literal ^$a stays here.",
    items: { type: "string", pattern: "^$a", description: "Reference guidance" } };
  const boundedEmpty = { type: "array", description: empty.description,
    items: { type: "string", description: empty.items.description }, maxItems: 0 };
  const normal = { type: "array", items: { type: "string", enum: ["fact:visible", "^$a"] } };
  const schema = { type: "object", additionalProperties: false,
    properties: { refs: empty, normal, shared: { $ref: "#/$def/empty" } }, required: ["refs", "normal", "shared"],
    $def: { empty } };
  const input = { tools: [{ type: "function", function: { name: "validate_refs", strict: true, parameters: schema } }], tool_choice: "required" };
  const before = structuredClone(input), body = kpRequestBody(model, input);
  const result = body.tools[0].function.parameters;
  assert.deepEqual(result.properties.refs, boundedEmpty);
  assert.deepEqual(result.$defs.empty, boundedEmpty);
  assert.deepEqual(result.properties.normal, normal);
  assert.deepEqual(input, before);
  assert.deepEqual(kpRequestBody(DEFAULT_KP_MODEL, input).tools, input.tools);
  assert.doesNotThrow(() => assertOpenAIStrictToolModelInput(body));
  // Journal replay passes a serialized provider body back through the binding.
  assert.equal(JSON.stringify(openAIRequestBody(model, JSON.parse(JSON.stringify(body)))), JSON.stringify(body));

  const source = replyInput.tools[0].function.parameters;
  const emptyDefinitions = Object.entries(source.$def).filter(([, value]) =>
    value.type === "array" && value.items?.pattern === "^$a");
  assert.ok(emptyDefinitions.length > 0, "the actual reply form must exercise the empty fact-list case");
  const replyBody = kpRequestBody(model, replyInput);
  const wire = replyBody.tools[0].function.parameters;
  for (const [name, original] of emptyDefinitions) {
    assert.deepEqual(wire.$defs[name], { ...original, items: { type: "string" }, maxItems: 0 });
  }
  assert.doesNotThrow(() => assertOpenAIStrictToolModelInput(replyBody));
  assert.deepEqual(kpRequestBody(DEFAULT_KP_MODEL, replyInput).tools, replyInput.tools);
  // The ruling's own form still converts and validates.
  assert.doesNotThrow(() => assertOpenAIStrictToolModelInput(kpRequestBody(model, socialInput)));
  assert.deepEqual(kpRequestBody(DEFAULT_KP_MODEL, socialInput).tools, socialInput.tools);
});

test("OpenAI empty-list validation does not admit other array limits or malformed item constraints", async () => {
  let calls = 0;
  const binding = createOpenAIAuthoritativeBinding({ apiKey: "test-key", fetcher: async () => { calls++; throw new Error("unexpected fetch"); } });
  for (const refs of [
    { type: "array", items: { type: "string" }, maxItems: 1 },
    { type: "array", items: { type: "string" }, maxItems: 0, minItems: 1 },
    { type: "array", items: { type: "string", pattern: "^$a" }, maxItems: 1 },
    { type: "array", items: { type: "string", pattern: 42 }, maxItems: 0 },
  ]) {
    const input = { tools: [{ type: "function", function: { name: "validate_refs", strict: true,
      parameters: { type: "object", additionalProperties: false, properties: { refs }, required: ["refs"] } } }], tool_choice: "required" };
    await assert.rejects(binding.run(model, input), /strict-tool request is invalid/);
  }
  assert.equal(calls, 0);
});

test("invalid or mixed strict tools fail before fetch, with no downgrade", async () => {
  let calls = 0;
  const binding = createOpenAIAuthoritativeBinding({ apiKey: "test-key", fetcher: async () => { calls++; throw new Error("unexpected fetch"); } });
  const input = structuredClone(requests[0][1]);
  input.tools.push({ ...input.tools[0], function: { ...input.tools[0].function, strict: false } });
  await assert.rejects(binding.run(model, input), /strict-tool request is invalid/);
  assert.equal(calls, 0);
});

for (const [status, quota, classification] of [
  [401, false, "modelPermanent"], [403, false, "modelPermanent"], [404, false, "modelPermanent"],
  [429, false, "modelTransient"], [429, true, "quotaExhausted"], [500, false, "modelTransient"],
]) {
  test(`OpenAI ${status}${quota ? " quota" : ""} is classified without exposing the response or switching models`, async () => {
    const calls = [];
    const binding = createOpenAIAuthoritativeBinding({ apiKey: "test-key", fetcher: async (url, init) => {
      calls.push({ url, model: JSON.parse(init.body).model });
      return Response.json({ error: { code: quota ? "insufficient_quota" : "upstream_error", message: "PRIVATE_PROMPT_OR_KEY" } }, { status, headers: { "retry-after": "2" } });
    } });
    await assert.rejects(binding.run(model, { messages: [] }), error => {
      assert.equal(error.status, status);
      assert.equal(error.retryAfter, 2);
      assert.equal(classifyModelError(error), classification);
      if (quota) assert.equal(diagnoseFailure(error, "modelRequest").reason, "providerQuotaExhausted");
      assert.doesNotMatch(JSON.stringify(error) + error.message, /PRIVATE_PROMPT_OR_KEY|test-key/);
      return true;
    });
    assert.deepEqual(calls, [{ url: "https://api.openai.com/v1/chat/completions", model }]);
  });
}

test("a missing key refuses locally and an aborted request is never retried", async () => {
  let calls = 0;
  const missing = createOpenAIAuthoritativeBinding({ apiKey: " ", fetcher: async () => { calls++; } });
  await assert.rejects(missing.run(model, {}), error => error.status === 401);
  assert.equal(calls, 0);
  const signal = AbortSignal.abort();
  const aborted = createOpenAIAuthoritativeBinding({ apiKey: "test-key", fetcher: async (_url, init) => {
    calls++; assert.equal(init.signal, signal); throw new DOMException("aborted", "AbortError");
  } });
  await assert.rejects(aborted.run(model, {}, { signal }), error => classifyModelError(error) === "modelTransient");
  assert.equal(calls, 1);
});
