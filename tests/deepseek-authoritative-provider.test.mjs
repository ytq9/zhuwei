import assert from "node:assert/strict";
import test from "node:test";

test("the authoritative DeepSeek binding preserves tool calls and translates the token limit", async () => {
  const { createDeepSeekAuthoritativeBinding } = await import(
    "../app/_runtime/lib/kp/deepseek.ts"
  );
  const calls = [];
  const signal = new AbortController().signal;
  const binding = createDeepSeekAuthoritativeBinding({
    apiKey: "test-api-key",
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        choices: [{
          message: {
            tool_calls: [{
              type: "function",
              function: { name: "submit_kp_proposal", arguments: "{\"ok\":true}" },
            }],
          },
        }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const response = await binding.run("deepseek-v4-pro", {
    messages: [{ role: "user", content: "裁定这个行动" }],
    tools: [{
      type: "function",
      function: {
        name: "submit_kp_proposal",
        parameters: { type: "object", properties: {} },
      },
    }],
    tool_choice: "required",
    parallel_tool_calls: false,
    temperature: 0.2,
    max_completion_tokens: 2_000,
  }, { signal });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].init.signal, signal);
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-api-key");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "裁定这个行动" }],
    tools: [{
      type: "function",
      function: {
        name: "submit_kp_proposal",
        parameters: { type: "object", properties: {} },
      },
    }],
    tool_choice: "required",
    temperature: 0.2,
    max_tokens: 2_000,
    thinking: { type: "disabled" },
    stream: false,
  });
  assert.equal("max_completion_tokens" in body, false);
  assert.equal("parallel_tool_calls" in body, false);
  assert.deepEqual(response.usage, {
    prompt_tokens: 11,
    completion_tokens: 7,
    total_tokens: 18,
  });
});

test("the DeepSeek binding classifies balance exhaustion without exposing the response body", async () => {
  const [
    { createDeepSeekAuthoritativeBinding },
    { classifyModelError },
  ] = await Promise.all([
    import("../app/_runtime/lib/kp/deepseek.ts"),
    import("../app/_runtime/lib/kp/authoritative-helpers.ts"),
  ]);
  const binding = createDeepSeekAuthoritativeBinding({
    apiKey: "test-api-key",
    fetcher: async () => new Response("private upstream account detail", {
      status: 402,
      headers: { "retry-after": "12" },
    }),
  });

  await assert.rejects(
    binding.run("deepseek-v4-flash", { messages: [] }),
    (error) => {
      assert.equal(error.status, 402);
      assert.equal(error.code, "quota_exhausted");
      assert.equal(error.retryAfter, 12);
      assert.equal(classifyModelError(error), "quotaExhausted");
      assert.doesNotMatch(error.message, /private upstream account detail|test-api-key/);
      return true;
    },
  );
});

test("the DeepSeek binding preserves stable HTTP failure classes", async () => {
  const [
    { createDeepSeekAuthoritativeBinding },
    { classifyModelError },
  ] = await Promise.all([
    import("../app/_runtime/lib/kp/deepseek.ts"),
    import("../app/_runtime/lib/kp/authoritative-helpers.ts"),
  ]);
  for (const [status, expected] of [
    [429, "modelTransient"],
    [500, "modelTransient"],
    [503, "modelTransient"],
    [422, "modelPermanent"],
  ]) {
    const binding = createDeepSeekAuthoritativeBinding({
      apiKey: "test-api-key",
      fetcher: async () => new Response("private upstream detail", { status }),
    });
    await assert.rejects(
      binding.run("deepseek-v4-flash", { messages: [] }),
      (error) => {
        assert.equal(classifyModelError(error), expected);
        assert.doesNotMatch(error.message, /private upstream detail|test-api-key/);
        return true;
      },
    );
  }
});

test("a missing DeepSeek key fails inside the authoritative invocation boundary", async () => {
  const [
    { createDeepSeekAuthoritativeBinding },
    { createAuthoritativeKpAdapter, AuthoritativeKpModelError },
  ] = await Promise.all([
    import("../app/_runtime/lib/kp/deepseek.ts"),
    import("../app/_runtime/lib/kp/authoritative.ts"),
  ]);
  let fetched = false;
  const binding = createDeepSeekAuthoritativeBinding({
    apiKey: "  ",
    fetcher: async () => {
      fetched = true;
      throw new Error("must not fetch without a key");
    },
  });
  const adapter = createAuthoritativeKpAdapter({ ai: binding });

  await assert.rejects(
    adapter.propose({
      preparedActionId: "prepared:missing-key",
      rootActionId: "root:missing-key",
      attempt: 1,
      projection: {
        viewer: { kind: "kp" },
        room: { id: "room:test", rulesetVersion: "dnd5e-2014-v2" },
        world: { facts: [], actors: [], locations: [] },
      },
      action: { kind: "freeAction", text: "查看门上的刻痕" },
    }),
    (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError);
      assert.equal(error.code, "modelPermanent");
      assert.equal(error.modelInvocationReceipt.result, "modelPermanent");
      return true;
    },
  );
  assert.equal(fetched, false);
});

test("DeepSeek resource exhaustion in a 200 response stays retryable", async () => {
  const [
    { createDeepSeekAuthoritativeBinding },
    { createAuthoritativeKpAdapter, AuthoritativeKpModelError },
  ] = await Promise.all([
    import("../app/_runtime/lib/kp/deepseek.ts"),
    import("../app/_runtime/lib/kp/authoritative.ts"),
  ]);
  const binding = createDeepSeekAuthoritativeBinding({
    apiKey: "test-api-key",
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "insufficient_system_resource", message: {} }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const adapter = createAuthoritativeKpAdapter({ ai: binding });

  await assert.rejects(
    adapter.propose({
      preparedActionId: "prepared:resource-exhaustion",
      rootActionId: "root:resource-exhaustion",
      input: { kind: "intent", text: "查看门上的刻痕" },
      projection: { viewer: { kind: "kp" } },
      attempt: 1,
    }),
    (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError);
      assert.equal(error.code, "modelTransient");
      assert.equal(error.modelInvocationReceipt.result, "modelTransient");
      return true;
    },
  );
});

test("the authoritative timeout aborts the in-flight DeepSeek request", async () => {
  const [
    { createDeepSeekAuthoritativeBinding },
    { createAuthoritativeKpAdapter, AuthoritativeKpModelError },
  ] = await Promise.all([
    import("../app/_runtime/lib/kp/deepseek.ts"),
    import("../app/_runtime/lib/kp/authoritative.ts"),
  ]);
  let signalWasAborted = false;
  const binding = createDeepSeekAuthoritativeBinding({
    apiKey: "test-api-key",
    fetcher: async (_url, init) => await new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => {
        signalWasAborted = signal.aborted;
        const error = new Error("request aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  const adapter = createAuthoritativeKpAdapter({
    ai: binding,
    invocationTimeoutMs: 5,
  });

  await assert.rejects(
    adapter.propose({
      preparedActionId: "prepared:timeout",
      rootActionId: "root:timeout",
      input: { kind: "intent", text: "查看门上的刻痕" },
      projection: { viewer: { kind: "kp" } },
      attempt: 1,
    }),
    (error) => {
      assert.ok(error instanceof AuthoritativeKpModelError);
      assert.equal(error.code, "modelTransient");
      return true;
    },
  );
  assert.equal(signalWasAborted, true);
});
