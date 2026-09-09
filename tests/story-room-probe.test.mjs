import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import test from "node:test";
import { createStoryProbeBudget, createStoryProbeEvidenceDirectory, parseStoryProbeOptions,
  storyProbeDryRun, validateStoryProbeRequest, freezeStoryProbeSources, compareStoryProbeSources } from "../tools/run-story-room-probe.mjs";
import { createSubmitKpProposalBundleModelInput } from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { VNEXT_KP_PROFILE } from "../app/_runtime/lib/kp/vnext/runtime-policy.ts";
import { STORY_ROOM_PROBE_LIMITS } from "./fixtures/story-live-room-cases.mjs";

test("default is configuration-only dry-run; unimplemented cases cannot enable live calls", () => {
  const options = parseStoryProbeOptions([]), report = storyProbeDryRun(options);
  assert.equal(options.live, false); assert.equal(report.realProviderCalls, 0); assert.equal(report.workerRuns, 0);
  assert.deepEqual(report.cases.map(value => [value.caseId, value.implemented]), [
    ["short-local-conflict", true], ["new-npc-investigation", false], ["long-personal", false],
  ]);
  for (const caseId of ["new-npc-investigation", "long-personal"]) {
    assert.equal(storyProbeDryRun(parseStoryProbeOptions(["--case", caseId])).runnable, false);
    assert.throws(() => parseStoryProbeOptions(["--live", "--case", caseId]), { code: "PROBE_CASE_NOT_IMPLEMENTED" });
  }
  const custom = "我今晚留在居酒屋协助莉安核对日常经营的问题。";
  assert.equal(parseStoryProbeOptions(["--action", custom]).selected.text, custom);
  assert.throws(() => parseStoryProbeOptions(["--action", " "]), { code: "PROBE_ACTION_INVALID" });
  assert.equal(parseStoryProbeOptions(["--preflight"]).live, false);
  assert.equal(parseStoryProbeOptions(["--preflight"]).preflight, true);
});

test("CLI accepts lower budgets and rejects raised ceilings, ambiguity and unknown flags", () => {
  const limits = parseStoryProbeOptions(["--live", "--max-calls", "1", "--max-input-tokens", "90000", "--max-output-tokens", "4000", "--call-timeout-ms", "1000"]);
  assert.equal(limits.maxCalls, 1); assert.equal(limits.callTimeoutMs, 1000);
  for (const args of [["--max-calls", "11"], ["--max-input-tokens", "960001"], ["--max-output-tokens", "64001"],
    ["--call-timeout-ms", "45001"], ["--max-calls", "0"], ["--max-calls", "1.5"], ["--max-calls", "1e1"]]) {
    assert.throws(() => parseStoryProbeOptions(args), { code: "PROBE_BUDGET_INVALID" });
  }
  assert.throws(() => parseStoryProbeOptions(["--live", "--dry-run"]), { code: "PROBE_MODE_CONFLICT" });
  assert.throws(() => parseStoryProbeOptions(["--preflight", "--live"]), { code: "PROBE_MODE_CONFLICT" });
  assert.throws(() => parseStoryProbeOptions(["--live", "--live"]), { code: "PROBE_OPTION_DUPLICATE" });
  assert.throws(() => parseStoryProbeOptions(["--env-file", "anything"]), { code: "PROBE_OPTION_INVALID" });
});

test("routing validates the actual strict surface and refuses JSON downgrade", () => {
  const input = createSubmitKpProposalBundleModelInput("Local transport contract check; never sent to a provider.");
  const value = { transportKind: "strict", model: VNEXT_KP_PROFILE.modelId, input };
  const strict = validateStoryProbeRequest(value);
  assert.equal(strict.transportKind, "strict"); assert.equal(strict.body.stream, false);
  assert.equal(strict.body.max_tokens, input.max_completion_tokens);
  assert.throws(() => validateStoryProbeRequest({ ...value, transportKind: "ordinary-json" }), { code: "PROBE_TRANSPORT_MISMATCH" });
  assert.throws(() => validateStoryProbeRequest({ ...value, input: { ...input, response_format: { type: "json_object" } } }),
    { code: "strict_tool_configuration_invalid" });
  const ordinary = validateStoryProbeRequest({ transportKind: "ordinary-json", model: VNEXT_KP_PROFILE.modelId,
    input: { response_format: { type: "json_object" }, max_completion_tokens: 800,
      messages: [{ role: "user", content: "Local transport validation only." }] } });
  assert.equal(ordinary.body.max_tokens, 800); assert.equal(ordinary.body.tools, undefined);
  assert.throws(() => validateStoryProbeRequest({ transportKind: "ordinary-json", model: VNEXT_KP_PROFILE.modelId,
    input: { max_completion_tokens: 800, tools: [] } }), { code: "PROBE_ORDINARY_SURFACE_INVALID" });
});

// Synthetic telemetry below exercises only the pure budget gate. It is not a
// draft, review, Proposal or narration response and never enters the Room test.
test("physical call and token reservations gate before any provider dispatch", () => {
  const budget = createStoryProbeBudget({ ...STORY_ROOM_PROBE_LIMITS, maxCalls: 1 });
  const call = budget.reserve('{"request":"one"}', 1000, "strict");
  assert.equal(budget.snapshot().realProviderCalls, 0);
  budget.dispatched(call); budget.settle(call, { usage: { prompt_tokens: 10, completion_tokens: 20 } });
  assert.equal(budget.snapshot().realProviderCalls, 1);
  assert.throws(() => budget.reserve("two", 1000, "strict"), { code: "PROBE_BUDGET_EXHAUSTED" });
  assert.equal(budget.snapshot().realProviderCalls, 1);
  for (const overrides of [{ maxInputTokens: 1 }, { maxOutputTokens: 1 }]) {
    const limited = createStoryProbeBudget({ ...STORY_ROOM_PROBE_LIMITS, ...overrides });
    assert.throws(() => limited.reserve("input", 100, "ordinary-json"), { code: "PROBE_BUDGET_EXHAUSTED" });
    assert.equal(limited.snapshot().realProviderCalls, 0);
  }
});

test("unknown usage preserves held dimensions and prevents another model sample", () => {
  const budget = createStoryProbeBudget(), call = budget.reserve("input", 1000, "strict");
  budget.dispatched(call);
  assert.throws(() => budget.settle(call, { usage: { prompt_tokens: 10 } }), { code: "PROBE_PROVIDER_USAGE_UNKNOWN" });
  const saved = budget.snapshot();
  assert.equal(saved.measuredInputTokens, 10); assert.equal(saved.heldInputTokens, 0);
  assert.equal(saved.heldOutputTokens, 1000); assert.equal(saved.incompleteUsageCalls, 1); assert.equal(saved.usageComplete, false);
  assert.throws(() => budget.reserve("next", 100, "strict"), { code: "PROBE_PROVIDER_USAGE_UNKNOWN" });
  assert.equal(budget.snapshot().realProviderCalls, 1);
});

test("timeouts and underestimated reservations retain evidence and latch a stop", () => {
  const budget = createStoryProbeBudget(), call = budget.reserve("input", 1000, "strict");
  budget.dispatched(call); budget.failed(call, "PROBE_PROVIDER_TIMEOUT");
  assert.equal(budget.snapshot().heldOutputTokens, 1000);
  assert.equal(budget.snapshot().calls[0].status, "unknown");
  assert.throws(() => budget.reserve("next", 100, "strict"), { code: "PROBE_PROVIDER_TIMEOUT" });
  const under = createStoryProbeBudget(), second = under.reserve("input", 10, "strict");
  under.dispatched(second);
  assert.throws(() => under.settle(second, { usage: { prompt_tokens: 10, completion_tokens: 11 } }),
    { code: "PROBE_PROVIDER_RESERVATION_EXCEEDED" });
});

test("the retry phase rejects even an attempted provider call with zero new dispatches", () => {
  const budget = createStoryProbeBudget(), call = budget.reserve("input", 1000, "strict");
  budget.dispatched(call); budget.settle(call, { usage: { prompt_tokens: 10, completion_tokens: 20 } });
  const first = budget.snapshot(); budget.sealRetry();
  assert.throws(() => budget.reserve("identical request", 1000, "strict"), { code: "PROBE_RETRY_ATTEMPTED_PROVIDER_CALL" });
  assert.equal(budget.snapshot().realProviderCalls, first.realProviderCalls);
  assert.deepEqual(budget.snapshot().calls, first.calls);
});

test("evidence directories are private temporary artifacts", async () => {
  const directory = await createStoryProbeEvidenceDirectory();
  try { assert.equal((await stat(directory)).mode & 0o777, 0o700); }
  finally { await rm(directory, { recursive: true }); }
});

test("source manifest freezes runtime and uncommitted harness files and identifies drift", async () => {
  const before = await freezeStoryProbeSources();
  for (const path of ["app/_runtime/lib/room/server.ts", "app/api/game/route.ts", "app/api/auth/register/route.ts",
    "db/schema.ts", "worker/index.ts", "tests/story-live-room.test.mts", "tests/fixtures/story-live-room.config.mjs",
    "tests/fixtures/story-live-room.wrangler.jsonc", "tools/run-story-room-probe.mjs"]) {
    assert.ok(before.files.some(file => file.path === path && /^sha256:[a-f0-9]{64}$/u.test(file.sha)), path);
  }
  assert.ok(before.files.some(file => file.path.startsWith("drizzle/")));
  assert.equal(compareStoryProbeSources(before, before).unchanged, true);
  const first = before.files[0], changed = { ...before, manifestSha: "different", files: before.files.map(file =>
    file.path === first.path ? { ...file, sha: "different" } : file) };
  assert.deepEqual(compareStoryProbeSources(before, changed).changed, [first.path]);
  assert.equal(compareStoryProbeSources(before, changed).unchanged, false);
});
