import { assertDailyActionAuthority, assertDailyWitnessAuthority } from "../../support/fixtures/daily-gameplay-authority.mjs";
import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import test from "node:test";
import { createStoryProbeBudget, createStoryProbeEvidenceDirectory, parseStoryProbeOptions,
  storyProbeDryRun, storyProbeArtifactNameAllowed, validateStoryProbeRequest, freezeStoryProbeSources, compareStoryProbeSources } from "../../../tools/run-story-room-probe.mjs";
import { createSubmitKpProposalBundleModelInput } from "../../../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import { VNEXT_KP_PROFILE } from "../../../app/_runtime/lib/kp/vnext/runtime-policy.ts";
import { STORY_ROOM_PROBE_LIMITS, selectStoryProbeCase } from "../../support/fixtures/story-live-room-cases.mjs";

test("default is configuration-only dry-run; unimplemented cases cannot enable live calls", () => {
  const options = parseStoryProbeOptions([]), report = storyProbeDryRun(options);
  assert.equal(options.live, false); assert.equal(report.realProviderCalls, 0); assert.equal(report.workerRuns, 0);
  assert.deepEqual(report.cases.map(value => [value.caseId, value.implemented]), [
    ["short-local-conflict", true], ["narration-recovery", true],
    ["daily-investigation", true], ["daily-witnessed", true], ["daily-spoken-intent", true], ["daily-hidden-act", true], ["daily-npc-leaves", true], ["daily-items", true], ["daily-spell", true], ["daily-combat", true], ["daily-multiplayer", true],
    ["retry-refusal", true], ["retry-refusal-decline", true], ["contested-carry", true], ["jump-tables", true], ["hide-tables", true], ["hide-then-speak", true], ["shove-away-varo", true], ["carry-put-down", true], ["prone-look", true], ["climb-ditch", true], ["climb-wall", true], ["help-ally", true], ["combat-npc-turn", true], ["combat-opportunity", true], ["combat-hide", true], ["approach-hearth", true], ["approach-whisper", true], ["retry-conversation", true],
    ["new-npc-investigation", false], ["long-personal", false],
  ]);
  assert.equal(report.faultInjection, null);
  assert.match(storyProbeDryRun(parseStoryProbeOptions(["--case", "narration-recovery"])).faultInjection, /synthetic/);
  assert.match(storyProbeDryRun(parseStoryProbeOptions(["--case", "daily-spell"])).initialFixture, /1 HP/);
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
  for (const args of [["--max-calls", "17"], ["--max-input-tokens", "960001"], ["--max-output-tokens", "64001"],
    ["--call-timeout-ms", "45001"], ["--max-calls", "0"], ["--max-calls", "1.5"], ["--max-calls", "1e1"]]) {
    assert.throws(() => parseStoryProbeOptions(args), { code: "PROBE_BUDGET_INVALID" });
  }
  assert.throws(() => parseStoryProbeOptions(["--live", "--dry-run"]), { code: "PROBE_MODE_CONFLICT" });
  assert.throws(() => parseStoryProbeOptions(["--preflight", "--live"]), { code: "PROBE_MODE_CONFLICT" });
  assert.throws(() => parseStoryProbeOptions(["--live", "--live"]), { code: "PROBE_OPTION_DUPLICATE" });
  assert.throws(() => parseStoryProbeOptions(["--env-file", "anything"]), { code: "PROBE_OPTION_INVALID" });
  // --dice presets the Room's authoritative faces in order; the run records them.
  const preset = parseStoryProbeOptions(["--live", "--case", "contested-carry", "--dice", "16,14"]);
  assert.deepEqual(preset.dice, [16, 14]);
  assert.deepEqual(storyProbeDryRun(preset).presetDice, [16, 14]);
  assert.equal(storyProbeDryRun(parseStoryProbeOptions([])).presetDice, null);
  for (const dice of ["0", "16,", "a,2", "1,2,3,4,5,6,7,8,9", "1000"]) {
    assert.throws(() => parseStoryProbeOptions(["--live", "--case", "contested-carry", "--dice", dice]), { code: "PROBE_DICE_INVALID" });
  }
  // Round 162-2 stopped after its assertions passed: the faces drawn could not be saved.
  for (const name of ["preset-dice", "acceptance", "daily-step-1-result"]) assert.equal(storyProbeArtifactNameAllowed(name), true, name);
  assert.equal(storyProbeArtifactNameAllowed("dice"), false);
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
  // The live plain-text narration policy sends prose requests without a format.
  assert.equal(validateStoryProbeRequest({ transportKind: "ordinary-json", model: VNEXT_KP_PROFILE.modelId,
    input: { max_completion_tokens: 800, messages: [{ role: "user", content: "x" }] } }).body.response_format, undefined);
  assert.throws(() => validateStoryProbeRequest({ transportKind: "ordinary-json", model: VNEXT_KP_PROFILE.modelId,
    input: { max_completion_tokens: 800, response_format: { type: "text-only" } } }), { code: "PROBE_ORDINARY_SURFACE_INVALID" });
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
    "db/schema.ts", "worker/index.ts", "tests/kp/stories/story-live-room.eval.mts", "tests/config/story-live.config.mjs",
    "tests/config/story-live.wrangler.jsonc", "tools/run-story-room-probe.mjs"]) {
    assert.ok(before.files.some(file => file.path === path && /^sha256:[a-f0-9]{64}$/u.test(file.sha)), path);
  }
  assert.ok(before.files.some(file => file.path.startsWith("drizzle/")));
  assert.equal(compareStoryProbeSources(before, before).unchanged, true);
  const first = before.files[0], changed = { ...before, manifestSha: "different", files: before.files.map(file =>
    file.path === first.path ? { ...file, sha: "different" } : file) };
  assert.deepEqual(compareStoryProbeSources(before, changed).changed, [first.path]);
  assert.equal(compareStoryProbeSources(before, changed).unchanged, false);
});

// SPEC 0001 §16, SPEC 0005 §6.2: audit the authority chain, including the two
// observed false passes (successful taking without inventory; unrelated talk).
test('default taking assertions are explicit and custom action text cannot inherit them', () => {
  for (const caseId of ['daily-witnessed', 'daily-hidden-act']) {
    const options = parseStoryProbeOptions(['--case', caseId]);
    assert.ok(options.selected.actionAssertions);
    assert.equal(storyProbeDryRun(options).defaultActionAssertionsApplied, true);
    assert.equal(selectStoryProbeCase(caseId, options.selected.text).actionAssertions, options.selected.actionAssertions);
    assert.equal(selectStoryProbeCase(caseId, '我只是问候莉安。').actionAssertions, undefined);
    assert.equal(parseStoryProbeOptions(['--case', caseId, '--action', '我只是问候莉安。']).selected.actionAssertions, undefined);
  }
});

test('custom listener actions drop text-specific assertions while witnessed actions keep source coverage', () => {
  for (const caseId of ['daily-spoken-intent', 'daily-hidden-act']) {
    const original = selectStoryProbeCase(caseId);
    assert.deepEqual(selectStoryProbeCase(caseId, original.text), original);
    const custom = selectStoryProbeCase(caseId, '我向莉安问候。');
    assert.equal(custom.listenerRequired, undefined);
    assert.equal(custom.listenerForbidden, undefined);
    assert.equal(custom.customAction, true);
    assert.deepEqual(parseStoryProbeOptions(['--case', caseId, '--action', custom.text]).selected, custom);
  }
  const options = parseStoryProbeOptions(['--case', 'daily-witnessed', '--action', '我当着莉安的面挥挥手。']);
  assert.equal(storyProbeDryRun(options).witnessSourceAssertionsApplied, true);
  assert.equal(storyProbeDryRun(options).defaultActionAssertionsApplied, false);
  const good = authoritySample();
  good.contract = options.selected.witnessAssertions;
  assertDailyWitnessAuthority(good);
  const itemSubject = structuredClone(good);
  itemSubject.after.state.canonicalFacts['fact:witness'].value.subjectRef = 'item:cup';
  itemSubject.after.events.find(e => e.eventType === 'WorldInteractionResolved').payload.sensoryEvidence[0].subjectRef = 'item:cup';
  assertDailyWitnessAuthority(itemSubject);
  for (const breakChain of [
    sample => { sample.after.events = sample.after.events.filter(e => e.eventType !== 'SensoryEvidenceAcquired'); },
    sample => { sample.after.events.find(e => e.eventType === 'SensoryEvidenceAcquired').rootActionId = 'another:root'; },
    sample => { sample.after.state.knowledge[good.contract.observerRef]['fact:witness'].acquiredByEventId = 'another:event'; },
    sample => { const fact = sample.after.state.canonicalFacts['fact:witness']; fact.value = { ...fact.value, subjectRef: 'another:subject' }; },
  ]) {
    const invalid = structuredClone(good); breakChain(invalid);
    assert.throws(() => assertDailyWitnessAuthority(invalid));
  }
});

function authoritySample(hidden = false, succeeded = false) {
  const contract = selectStoryProbeCase(hidden ? 'daily-hidden-act' : 'daily-witnessed').actionAssertions;
  const actor = 'actor:test', observer = contract.observerRef, factId = 'fact:witness', entryId = 'item:leaf';
  const item = { entryId, definitionRef: contract.itemDefinitionRef, quantity: 1, holderRef: null, disposition: 'scene' };
  const state = { campaignRuntime: { itemSystem: { entries: { [entryId]: item } } }, canonicalFacts: {}, knowledge: { [observer]: {} } };
  const before = { state, events: [] }, after = structuredClone(before);
  const record = { observerRef: observer, subjectRef: actor, sense: 'sight', evidence: '看见他抽出叶片。', basisRefs: [entryId] };
  const event = (eventType, payload, eventId) => ({ eventType, payload, eventId, rootActionId: 'root:take', resolutionId: 'resolution:take' });
  if (!hidden || succeeded) {
    after.state.campaignRuntime.itemSystem.entries[entryId] = { ...item, holderRef: actor, disposition: 'held' };
    after.events.push(event('InventoryOperationApplied', { actorCharacterId: actor,
      operation: { kind: 'acquire', entryRef: entryId, quantity: 1 }, targetEntryId: entryId }, 'event:take'));
  }
  after.events.push(event('WorldInteractionResolved', { actorCharacterId: actor, rulingKind: hidden ? 'check' : 'directSuccess',
    check: hidden ? { concealedFromRef: observer, succeeded } : null, sensoryEvidence: hidden ? [] : [record] }, 'event:resolved'));
  if (hidden) after.events.push(event('RandomnessRequested', { request: { resolutionId: 'resolution:take', frozenCheck: {
    concealment: { evidence: record.evidence, sense: record.sense } } } }, 'event:roll'));
  if (!hidden || !succeeded) {
    after.events.push(event('SensoryEvidenceAcquired', { characterId: observer, factId, sense: record.sense,
      publicEvidence: record.evidence }, 'event:evidence'));
    after.state.canonicalFacts[factId] = { kind: 'worldInteractionSensoryEvidence', value: record };
    after.state.knowledge[observer][factId] = { objectKind: 'sensoryEvidence', content: record.evidence,
      acquiredByEventId: 'event:evidence', provenanceChain: [factId, 'event:evidence'] };
  }
  return { before, after, actor, contract };
}

test('taking acceptance rejects missing possession, unrelated knowledge and broken provenance', () => {
  for (const hidden of [false, true]) {
    const good = authoritySample(hidden, true);
    assert.doesNotThrow(() => assertDailyActionAuthority(good));
    const noInventory = structuredClone(good);
    noInventory.after.events = noInventory.after.events.filter(e => e.eventType !== 'InventoryOperationApplied');
    assert.throws(() => assertDailyActionAuthority(noInventory), /real acquisition/);
    const notHeld = structuredClone(good);
    notHeld.after.state.campaignRuntime.itemSystem.entries['item:leaf'].holderRef = null;
    assert.throws(() => assertDailyActionAuthority(notHeld), /actually holds/);
  }
  for (const hidden of [false, true]) {
    const good = authoritySample(hidden, false);
    assert.doesNotThrow(() => assertDailyActionAuthority(good));
    const talkOnly = structuredClone(good);
    talkOnly.after.events = talkOnly.after.events.filter(e => e.eventType !== 'SensoryEvidenceAcquired');
    assert.throws(() => assertDailyActionAuthority(talkOnly), /not merely a conversation/);
    const wrongAction = structuredClone(good);
    wrongAction.after.events.find(e => e.eventType === 'SensoryEvidenceAcquired').resolutionId = 'resolution:talk';
    assert.throws(() => assertDailyActionAuthority(wrongAction), /not merely a conversation/);
    for (const change of [held => held.acquiredByEventId = 'event:old', held => held.provenanceChain = []]) {
      const broken = structuredClone(good);
      change(broken.after.state.knowledge[good.contract.observerRef]['fact:witness']);
      assert.throws(() => assertDailyActionAuthority(broken));
    }
  }
  const previous = authoritySample();
  previous.before.events = [...previous.after.events];
  assert.throws(() => assertDailyActionAuthority(previous), /real acquisition/);
});

test('a complete hearing chain cannot pass the public sight witness contract', () => {
  const sample = authoritySample();
  const record = sample.after.state.canonicalFacts['fact:witness'].value;
  record.sense = 'hearing';
  sample.after.events.find(e => e.eventType === 'SensoryEvidenceAcquired').payload.sense = 'hearing';
  assert.throws(() => assertDailyActionAuthority(sample), /not merely a conversation/);
});

test('failed concealed taking keeps the source in place and cannot create a held copy', () => {
  const good = authoritySample(true, false);
  assert.doesNotThrow(() => assertDailyActionAuthority(good));
  const taken = structuredClone(good);
  Object.assign(taken.after.state.campaignRuntime.itemSystem.entries['item:leaf'], { holderRef: taken.actor, disposition: 'held' });
  assert.throws(() => assertDailyActionAuthority(taken), /preserves source/);
  const copied = structuredClone(good);
  copied.after.state.campaignRuntime.itemSystem.entries['item:copy'] = {
    ...copied.before.state.campaignRuntime.itemSystem.entries['item:leaf'], entryId: 'item:copy', holderRef: copied.actor, disposition: 'held',
  };
  assert.throws(() => assertDailyActionAuthority(copied), /no held copy/);
});

test('concealed acceptance follows the frozen authored evidence source in a separate failure step', () => {
  const good = authoritySample(true, false), sourceId = 'resolution:primary-witness';
  const record = good.after.state.canonicalFacts['fact:witness'].value;
  const frozen = good.after.events.find(e => e.eventType === 'RandomnessRequested').payload.request.frozenCheck.concealment;
  frozen.evidencePolicy = { version: 'primary-failure-v1', primaryFailureSource: {
    resolutionId: sourceId, branch: 'success', evidenceIndex: 0,
  } };
  good.after.events.find(e => e.eventType === 'SensoryEvidenceAcquired').resolutionId = sourceId;
  good.after.events.push({ eventType: 'WorldInteractionResolved', eventId: 'event:primary-witness', rootActionId: 'root:take',
    resolutionId: sourceId, payload: { actorCharacterId: good.actor, rulingKind: 'directSuccess', branch: 'success',
      check: null, sensoryEvidence: [record] } });
  assert.doesNotThrow(() => assertDailyActionAuthority(good));
  frozen.evidencePolicy.primaryFailureSource.evidenceIndex = 1;
  assert.throws(() => assertDailyActionAuthority(good), /not merely a conversation/);
});
