import assert from "node:assert/strict";
import test from "node:test";
import { createVNextModelCallScope } from "../app/_runtime/lib/kp/vnext/model-call-scope.ts";

const SECRET_REQUEST = "PRIVATE_REQUEST_CANARY", SECRET_RESPONSE = "PRIVATE_RESPONSE_CANARY";

test("one scope shares five reservations across concurrent player, NPC and narration bindings", async () => {
  const called = [], events = [];
  const scope = createVNextModelCallScope({ roomId: "room:probe", limit: "5", emit: event => events.push(event) });
  const bindings = Object.fromEntries(["player", "npc", "narration"].map(role => [role, scope.bind({
    async run(model, request, options) { called.push({ role, model, request, options }); return { value: SECRET_RESPONSE, role }; },
  })]));
  const request = { value: SECRET_REQUEST }, options = { signal: new AbortController().signal };
  const roles = ["player", "npc", "narration", "player", "npc"];
  const results = await Promise.all(roles.map(role => bindings[role].run(`model:${role}`, request, options)));
  assert.deepEqual(results.map(result => result.role), roles);
  await assert.rejects(bindings.narration.run("model:narration", request, options), {
    message: "LOCAL_MODEL_PROBE_LIMIT_EXHAUSTED", code: "localProbeBudgetExhausted",
  });
  assert.equal(called.length, 5, "the sixth call is rejected before any provider binding runs");
  for (const call of called) { assert.equal(call.request, request); assert.equal(call.options, options); }
  assert.deepEqual(events, roles.map((_, index) => ({ eventName: "kp.local.probe.call", roomId: "room:probe", limit: 5, ordinal: index + 1 })));
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|request|response/u);
});

test("no capture configuration performs no capture, and separate request scopes own independent budgets", async () => {
  let captures = 0;
  const events = [], response = { value: SECRET_RESPONSE };
  const unlimited = createVNextModelCallScope({ roomId: "room:no-local-probe", emit: event => events.push(event),
    fetch: async () => { captures += 1; throw new Error("capture must not run"); } });
  const binding = { async run() { return response; } };
  const wrapped = unlimited.bind(binding);
  for (let index = 0; index < 15; index += 1) assert.equal(await wrapped.run("model:test", { value: SECRET_REQUEST }), response);
  assert.equal(captures, 0); assert.deepEqual(events, []);
  const first = createVNextModelCallScope({ roomId: "room:shared", limit: "1", emit: () => {} }).bind(binding);
  const second = createVNextModelCallScope({ roomId: "room:shared", limit: "1", emit: () => {} }).bind(binding);
  await first.run("model:test", {});
  await assert.rejects(first.run("model:test", {}), { code: "localProbeBudgetExhausted" });
  assert.equal(await second.run("model:test", {}), response);
});

test("invalid limits fail at scope creation and failed provider attempts still consume exactly one slot", async () => {
  for (const limit of ["0", "13", "1.5", "unknown", "NaN", "Infinity", ""]) {
    assert.throws(() => createVNextModelCallScope({ roomId: "room:invalid", limit }), /LOCAL_MODEL_PROBE_LIMIT_INVALID/u);
  }
  for (const limit of ["1", "12"]) assert.doesNotThrow(() => createVNextModelCallScope({ roomId: "room:valid", limit }));
  let invoked = 0, captures = 0;
  const events = [], failure = new Error("PRIVATE_PROVIDER_ERROR");
  const scope = createVNextModelCallScope({ roomId: "room:provider-failure", limit: "1", captureUrl: "http://localhost:8787/capture",
    emit: event => events.push(event), fetch: async () => { captures += 1; return new Response(); } });
  const bound = scope.bind({ async run() { invoked += 1; throw failure; } });
  await assert.rejects(bound.run("model:test", { value: SECRET_REQUEST }), error => error === failure);
  await assert.rejects(bound.run("model:test", {}), { code: "localProbeBudgetExhausted" });
  assert.equal(invoked, 1); assert.equal(captures, 0);
  assert.deepEqual(events.map(event => event.ordinal), [1]);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|request|response/u);
});

test("explicit local capture keeps private bodies in its sink and emits metadata only", async () => {
  for (const captureUrl of ["http://127.0.0.1:8787/capture", "http://localhost:8788/capture"]) {
    const captures = [], events = [], request = { value: SECRET_REQUEST }, response = { value: SECRET_RESPONSE };
    let calls = 0;
    const bound = createVNextModelCallScope({ roomId: "room:local-capture", limit: "1", captureUrl,
      emit: event => events.push(event), fetch: async (url, init) => { captures.push({ url, init }); return new Response(); },
    }).bind({ async run() { calls += 1; return response; } });
    assert.equal(await bound.run("model:test", request), response);
    assert.equal(calls, 1); assert.equal(captures.length, 1);
    assert.equal(captures[0].url, captureUrl); assert.equal(captures[0].init.method, "POST");
    assert.deepEqual(captures[0].init.headers, { "content-type": "application/json" });
    assert.ok(captures[0].init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(captures[0].init.body), { roomId: "room:local-capture", model: "model:test", request, response });
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|request|response/u);
  }
});

test("non-loopback, credentialed, alternate-path and implicit-port capture URLs never receive model bodies", async () => {
  const captures = [];
  for (const captureUrl of ["https://127.0.0.1:8787/capture", "http://example.com:8787/capture", "http://localhost/capture",
    "http://localhost:8787/capture?mode=all", "http://localhost:8787/capture/", "http://localhost:8787/other",
    "http://127.0.0.1:8787@remote.invalid/capture", "http://user@localhost:8787/capture", "file:///capture"]) {
    const bound = createVNextModelCallScope({ roomId: "room:invalid-sink", captureUrl,
      fetch: async (...args) => { captures.push(args); return new Response(); },
    }).bind({ async run() { return { value: SECRET_RESPONSE }; } });
    await bound.run("model:test", { value: SECRET_REQUEST });
  }
  assert.deepEqual(captures, []);
});

test("local logging and capture failures cannot replace a successful provider result", async () => {
  const response = { value: SECRET_RESPONSE };
  let invoked = 0, captured = 0;
  const bound = createVNextModelCallScope({ roomId: "room:instrumentation-failure", limit: "1", captureUrl: "http://localhost:8787/capture",
    emit() { throw new Error("PRIVATE_LOG_FAILURE"); },
    fetch: async () => { captured += 1; throw new Error("PRIVATE_CAPTURE_FAILURE"); },
  }).bind({ async run() { invoked += 1; return response; } });
  assert.equal(await bound.run("model:test", { value: SECRET_REQUEST }), response);
  assert.equal(invoked, 1); assert.equal(captured, 1);
  await assert.rejects(bound.run("model:test", {}), { code: "localProbeBudgetExhausted" });
  assert.equal(invoked, 1); assert.equal(captured, 1);
});
