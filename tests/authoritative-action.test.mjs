import assert from "node:assert/strict";
import test from "node:test";

import { handleRoomAction } from "../app/_runtime/lib/room/action.ts";

const TRUSTED_PRINCIPAL = Object.freeze({
  id: "principal:alice",
  sessionVersion: 7,
});

const INTENT = Object.freeze({
  kind: "intent",
  submissionId: "submission:open-door",
  text: "我推开眼前普通且没有上锁的门。",
});

const PREPARED = Object.freeze({
  kind: "prepared",
  preparedActionId: "prepared:open-door",
  rootActionId: "root:open-door",
  kpProjection: Object.freeze({
    viewer: "kp",
    facts: Object.freeze(["the door is ordinary and unlocked"]),
  }),
});

const PLAYER_READ_MODEL = Object.freeze({
  viewerKey: "character:alice",
  projectionHash: "projection:alice:2",
  facts: Object.freeze(["门已经打开。"]),
});

const KP_COMMITTED_PROJECTION = Object.freeze({
  viewer: "kp",
  projectionHash: "projection:kp:2",
  committedResult: "the ordinary door opened",
});

const ALICE_AUDIENCE_PROJECTION = Object.freeze({
  viewer: "audience:alice",
  characterId: "character:alice",
  projectionHash: "projection:audience:alice:2",
  visibleResult: "Alice sees the opened door and the silver key beyond it.",
});

const BOB_AUDIENCE_PROJECTION = Object.freeze({
  viewer: "audience:bob",
  characterId: "character:bob",
  projectionHash: "projection:audience:bob:2",
  visibleResult: "Bob hears the distant hinge from the courtyard.",
});

const DELIVERY_PUBLISH_CAPABILITY = Object.freeze({
  capabilityId: "delivery-capability:open-door:2",
  opaqueProof: "room-authority-only",
});

const DEFAULT_DELIVERY_PLAN = Object.freeze({
  publishCapability: DELIVERY_PUBLISH_CAPABILITY,
  audiences: Object.freeze([
    Object.freeze({
      audienceId: "audience:alice",
      projection: ALICE_AUDIENCE_PROJECTION,
    }),
  ]),
});

const COMMITTED_RECEIPT = Object.freeze({
  receiptId: "receipt:open-door",
  rootActionId: PREPARED.rootActionId,
  status: "committed",
  eventRange: Object.freeze({ from: 41, to: 41 }),
  projectionHash: PLAYER_READ_MODEL.projectionHash,
});

const DELIVERY = Object.freeze({
  deliveryId: "delivery:open-door",
  viewerKey: PLAYER_READ_MODEL.viewerKey,
  body: "门轴轻响，门向里敞开。门后的走廊现在可以进入。你要怎么做？",
});

const DIRECT_SUCCESS_PROPOSAL = Object.freeze({
  kind: "directSuccess",
  proposalAttemptId: "proposal:open-door:1",
  rootActionId: PREPARED.rootActionId,
  goal: "推开眼前普通且没有上锁的门",
  method: "直接推门进入",
  publicBasisRefs: Object.freeze(["fact:ordinary-door-unlocked"]),
  privateBasisRefs: Object.freeze([]),
  risk: null,
  pendingInput: null,
  dynamicMaterializations: Object.freeze([]),
  npcActions: Object.freeze([]),
  mechanicalProposal: Object.freeze({
    operation: "resolveDirectConsequences",
    duration: Object.freeze({ unit: "second", value: 1 }),
    frozenCosts: Object.freeze([]),
    success: Object.freeze([]),
    failure: Object.freeze([]),
  }),
  scene: Object.freeze({
    question: "门打开后，玩家接下来做什么？",
    pressure: "",
    opportunities: Object.freeze([]),
    conclusionCandidate: null,
  }),
});

const COMMITTED_AUTHORITY_RESULT = Object.freeze({
  kind: "committed",
  receipt: COMMITTED_RECEIPT,
  kpProjection: KP_COMMITTED_PROJECTION,
  deliveryPlan: DEFAULT_DELIVERY_PLAN,
});

const OBSERVED_COMMITTED = Object.freeze({
  readModel: PLAYER_READ_MODEL,
  delivery: DELIVERY,
});

function trustedPrincipalId(authenticatedContext) {
  return authenticatedContext?.principal?.id ?? authenticatedContext?.id;
}

function scriptedValue(queue, boundary) {
  assert.ok(queue.length > 0, `${boundary} was called more often than scripted`);
  const value = queue.shift();
  if (value instanceof Error) throw value;
  return value;
}

function createHarness({
  prepareResult = PREPARED,
  proposals = [DIRECT_SUCCESS_PROPOSAL],
  commitResults = [COMMITTED_AUTHORITY_RESULT],
  narratives = [{ text: DELIVERY.body, agencyClaims: [] }],
  publicationResults = [{ kind: "published", deliveryIds: [DELIVERY.deliveryId] }],
  observed = OBSERVED_COMMITTED,
} = {}) {
  const trace = [];
  const proposalQueue = [...proposals];
  const commitQueue = [...commitResults];
  const narrativeQueue = [...narratives];
  const publicationQueue = [...publicationResults];

  const authority = {
    worldCommitCount: 0,

    async prepare(authenticatedContext, input) {
      trace.push({
        boundary: "authority",
        operation: "prepare",
        principalId: trustedPrincipalId(authenticatedContext),
        input,
      });
      if (prepareResult instanceof Error) throw prepareResult;
      return prepareResult;
    },

    async commit(authenticatedContext, preparedActionId, rulesInput) {
      trace.push({
        boundary: "authority",
        operation: "commit",
        principalId: trustedPrincipalId(authenticatedContext),
        preparedActionId,
        rulesInput,
      });
      const result = scriptedValue(commitQueue, "authority.commit");
      if (result.kind === "committed" || result.kind === "concluded") {
        authority.worldCommitCount += 1;
      }
      return result;
    },

    async publishDelivery(authenticatedContext, publication) {
      trace.push({
        boundary: "authority",
        operation: "publishDelivery",
        principalId: trustedPrincipalId(authenticatedContext),
        authorization: authenticatedContext,
        publication,
      });
      return scriptedValue(publicationQueue, "authority.publishDelivery");
    },

    async observe(authenticatedContext) {
      trace.push({
        boundary: "authority",
        operation: "observe",
        principalId: trustedPrincipalId(authenticatedContext),
      });
      return observed;
    },

    async acknowledge(authenticatedContext, deliveryId) {
      trace.push({
        boundary: "authority",
        operation: "acknowledge",
        principalId: trustedPrincipalId(authenticatedContext),
        deliveryId,
      });
      return { kind: "acknowledged", deliveryId };
    },
  };

  const kp = {
    async propose(request) {
      trace.push({ boundary: "kp", operation: "propose", request });
      return scriptedValue(proposalQueue, "kp.propose");
    },

    async narrate(request) {
      trace.push({ boundary: "kp", operation: "narrate", request });
      return scriptedValue(narrativeQueue, "kp.narrate");
    },
  };

  return {
    context: { principal: TRUSTED_PRINCIPAL, authority, kp },
    authority,
    trace,
  };
}

function operations(trace) {
  return trace.map(({ boundary, operation }) => `${boundary}.${operation}`);
}

function calls(trace, boundary, operation) {
  return trace.filter((entry) => entry.boundary === boundary && entry.operation === operation);
}

function diagnosticResult(attempt, receiptId = `receipt:diagnostic:${attempt}`) {
  return Object.freeze({
    kind: "mechanicalDiagnostic",
    receipt: Object.freeze({
      receiptId,
      rootActionId: PREPARED.rootActionId,
      status: "needsKp",
    }),
    diagnostics: Object.freeze([Object.freeze({
      code: "unsupported_mechanic",
      publicPath: "这个效果需要 KP 换一种可执行表达。",
      revisionHint: "replace the arbitrary script with a supported movement effect",
      secrecy: "kp",
    })]),
    kpProjection: PREPARED.kpProjection,
  });
}

function assertOutcomeShape(outcome) {
  assert.equal(typeof outcome, "object");
  assert.ok(outcome !== null);

  switch (outcome.kind) {
    case "committed":
    case "concluded":
      assert.ok(outcome.receipt);
      assert.ok(outcome.readModel);
      break;
    case "awaitingInput":
      assert.ok(outcome.receipt);
      assert.ok(outcome.readModel);
      assert.ok(outcome.pending);
      break;
    case "needsKp":
      assert.ok(outcome.receipt);
      break;
    case "retryableFailure":
      assert.equal(typeof outcome.code, "string");
      break;
    case "rejected":
      assert.equal(typeof outcome.code, "string");
      assert.equal(typeof outcome.explanation, "string");
      break;
    default:
      assert.fail(`unknown RoomActionOutcome kind: ${String(outcome.kind)}`);
  }
}

test("trusted context principal is used instead of a request-body actor", async () => {
  const harness = createHarness();
  const inputWithForgedActor = {
    ...INTENT,
    characterId: "character:mallory",
    actorId: "character:mallory",
    principalId: "principal:mallory",
  };

  const outcome = await handleRoomAction(harness.context, inputWithForgedActor);

  assert.equal(outcome.kind, "committed");
  const authorityCalls = calls(harness.trace, "authority", "prepare")
    .concat(calls(harness.trace, "authority", "commit"))
    .concat(calls(harness.trace, "authority", "observe"));
  assert.ok(authorityCalls.length > 0);
  assert.ok(authorityCalls.every((call) => call.principalId === TRUSTED_PRINCIPAL.id));
  assert.ok(authorityCalls.every((call) => call.principalId !== inputWithForgedActor.principalId));
  assert.ok(calls(harness.trace, "authority", "publishDelivery")
    .every((call) => call.principalId === undefined));
});

test("direct success commits before narration and publishes only the observer projection", async () => {
  const harness = createHarness();

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "kp.propose",
    "authority.commit",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.deepEqual(outcome, {
    kind: "committed",
    receipt: COMMITTED_RECEIPT,
    readModel: PLAYER_READ_MODEL,
    delivery: DELIVERY,
  });

  const commit = calls(harness.trace, "authority", "commit")[0];
  assert.equal(commit.preparedActionId, PREPARED.preparedActionId);
  assert.equal(commit.rulesInput.rootActionId, PREPARED.rootActionId);
  const narration = calls(harness.trace, "kp", "narrate")[0];
  assert.equal(narration.request.rootActionId, PREPARED.rootActionId);
  assert.equal(narration.request.receipt, COMMITTED_RECEIPT);
  assert.equal(narration.request.projection, ALICE_AUDIENCE_PROJECTION);
});

test("an authenticated combat or consent answer bypasses KP proposal and preserves the player's exact choice", async () => {
  const answer = Object.freeze({ kind: "cancel" });
  const input = Object.freeze({
    kind: "answer",
    submissionId: "submission:answer-target",
    pendingInputId: "pending:combat:target",
    answer,
  });
  const harness = createHarness({
    prepareResult: {
      ...PREPARED,
      resolutionMode: "authorityDirect",
    },
    proposals: [],
  });

  const outcome = await handleRoomAction(harness.context, input);

  assert.equal(outcome.kind, "committed");
  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "authority.commit",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  assert.equal(calls(harness.trace, "kp", "propose").length, 0);
  assert.deepEqual(calls(harness.trace, "authority", "commit")[0].rulesInput, {
    kind: "authenticatedPendingAnswer",
    rootActionId: PREPARED.rootActionId,
  });
  assert.deepEqual(calls(harness.trace, "authority", "prepare")[0].input.answer, answer);
});

test("a committed delivery plan narrates each frozen audience projection and publishes with only the Room capability", async () => {
  const aliceNarration = Object.freeze({
    text: "门在你眼前打开，银钥匙落入视线。",
    agencyClaims: Object.freeze([]),
  });
  const bobNarration = Object.freeze({
    body: "庭院那头传来一声遥远的门轴轻响。",
    tts: "远处传来门轴轻响。",
    decisionPrompt: "你要继续留在庭院，还是走近查看？",
    referencedProjectionRefs: Object.freeze(["fact:distant-hinge"]),
    agencyClaims: Object.freeze([]),
  });
  const deliveryPlan = Object.freeze({
    publishCapability: DELIVERY_PUBLISH_CAPABILITY,
    audiences: Object.freeze([
      Object.freeze({
        audienceId: "audience:alice",
        projection: ALICE_AUDIENCE_PROJECTION,
      }),
      Object.freeze({
        audienceId: "audience:bob",
        kpProjection: BOB_AUDIENCE_PROJECTION,
      }),
    ]),
  });
  const harness = createHarness({
    commitResults: [{
      ...COMMITTED_AUTHORITY_RESULT,
      deliveryPlan,
    }],
    narratives: [aliceNarration, bobNarration],
  });

  const forgedAudience = Object.freeze({
    audienceId: "audience:mallory",
    projection: Object.freeze({ leakedSecret: "not-authoritative" }),
  });
  const outcome = await handleRoomAction(harness.context, {
    ...INTENT,
    deliveryPlan: Object.freeze({
      publishCapability: "forged-request-capability",
      audiences: Object.freeze([forgedAudience]),
    }),
    audiences: Object.freeze([forgedAudience]),
  });

  assert.equal(outcome.kind, "committed");
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "kp.propose",
    "authority.commit",
    "kp.narrate",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  assert.deepEqual(calls(harness.trace, "authority", "prepare")[0].input, INTENT);

  const narrationCalls = calls(harness.trace, "kp", "narrate");
  assert.deepEqual(narrationCalls.map(({ request }) => request), [
    {
      rootActionId: PREPARED.rootActionId,
      receipt: COMMITTED_RECEIPT,
      audienceId: "audience:alice",
      projection: ALICE_AUDIENCE_PROJECTION,
    },
    {
      rootActionId: PREPARED.rootActionId,
      receipt: COMMITTED_RECEIPT,
      audienceId: "audience:bob",
      projection: BOB_AUDIENCE_PROJECTION,
    },
  ]);
  assert.ok(narrationCalls.every(({ request }) => request.audienceId !== forgedAudience.audienceId));
  assert.ok(!JSON.stringify(narrationCalls[0].request).includes(BOB_AUDIENCE_PROJECTION.projectionHash));
  assert.ok(!JSON.stringify(narrationCalls[1].request).includes(ALICE_AUDIENCE_PROJECTION.projectionHash));

  const publicationCall = calls(harness.trace, "authority", "publishDelivery")[0];
  assert.deepEqual(publicationCall.authorization, {
    publishCapability: DELIVERY_PUBLISH_CAPABILITY,
  });
  assert.notEqual(publicationCall.authorization, TRUSTED_PRINCIPAL);
  assert.equal(publicationCall.principalId, undefined);
  assert.deepEqual(publicationCall.publication, {
    frames: [
      { audienceId: "audience:alice", narration: aliceNarration },
      {
        audienceId: "audience:bob",
        narration: { text: bobNarration.body, agencyClaims: bobNarration.agencyClaims },
      },
    ],
  });
});

test("a partial per-audience narration failure keeps the commit and publishes no mixed or partial frames", async () => {
  const aliceNarration = Object.freeze({
    text: "alice-private-success-must-not-escape",
    agencyClaims: Object.freeze([]),
  });
  const deliveryPlan = Object.freeze({
    publishCapability: DELIVERY_PUBLISH_CAPABILITY,
    audiences: Object.freeze([
      Object.freeze({ audienceId: "audience:alice", projection: ALICE_AUDIENCE_PROJECTION }),
      Object.freeze({ audienceId: "audience:bob", projection: BOB_AUDIENCE_PROJECTION }),
    ]),
  });
  const harness = createHarness({
    commitResults: [{ ...COMMITTED_AUTHORITY_RESULT, deliveryPlan }],
    narratives: [aliceNarration, new Error("Bob narration model timeout")],
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.deepEqual(outcome, {
    kind: "committed",
    receipt: COMMITTED_RECEIPT,
    readModel: PLAYER_READ_MODEL,
    deliveryPending: true,
  });
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.equal(calls(harness.trace, "kp", "narrate").length, 2);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 0);
  assert.equal(calls(harness.trace, "authority", "observe").length, 1);
  assert.equal(calls(harness.trace, "authority", "observe")[0].principalId, TRUSTED_PRINCIPAL.id);
  assert.ok(!JSON.stringify(outcome).includes(aliceNarration.text));
});

test("a player-owned narration claim is rejected before Room publication without repeating mechanics", async () => {
  const maliciousText = "你认定走廊绝对安全，并决定立刻独自冲进去。";
  const harness = createHarness({
    narratives: [{
      body: maliciousText,
      agencyClaims: [{
        subjectKind: "playerCharacter",
        subjectRef: "character:alice",
        claimKind: "thought",
        basisRefs: [ALICE_AUDIENCE_PROJECTION.projectionHash],
      }],
    }],
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.deepEqual(outcome, {
    kind: "committed",
    receipt: COMMITTED_RECEIPT,
    readModel: PLAYER_READ_MODEL,
    deliveryPending: true,
  });
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.equal(calls(harness.trace, "authority", "commit").length, 1);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 0);
  assert.equal(calls(harness.trace, "authority", "observe").length, 1);
  assert.ok(!JSON.stringify(outcome).includes(maliciousText));
});

test("a delivery-plan publication failure never rolls back or repeats the committed world result", async () => {
  const aliceNarration = Object.freeze({
    text: "Alice sees only Alice's projection.",
    agencyClaims: Object.freeze([]),
  });
  const deliveryPlan = Object.freeze({
    publishCapability: DELIVERY_PUBLISH_CAPABILITY,
    audiences: Object.freeze([
      Object.freeze({ audienceId: "audience:alice", projection: ALICE_AUDIENCE_PROJECTION }),
    ]),
  });
  const harness = createHarness({
    commitResults: [{ ...COMMITTED_AUTHORITY_RESULT, deliveryPlan }],
    narratives: [aliceNarration],
    publicationResults: [Object.freeze({
      kind: "rejected",
      code: "audienceMismatch",
      explanation: "Room rejected a non-authoritative audience publication.",
    })],
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.equal(outcome.kind, "committed");
  assert.equal(outcome.deliveryPending, true);
  assert.equal("delivery" in outcome, false);
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.equal(calls(harness.trace, "authority", "commit").length, 1);
  assert.equal(calls(harness.trace, "kp", "narrate").length, 1);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 1);
  assert.equal(calls(harness.trace, "authority", "observe").length, 1);
});

test("major ambiguity becomes awaitingInput and is never answered by the system", async () => {
  const authorityPending = Object.freeze({
    pendingInputId: "pending:lever-choice",
    kind: "clarification",
    controllerPrincipalId: TRUSTED_PRINCIPAL.id,
    prompt: "你要拉左侧标着警铃的拉杆，还是右侧控制闸门的拉杆？",
  });
  const projectedPending = Object.freeze({
    pendingInputId: authorityPending.pendingInputId,
    rootActionId: PREPARED.rootActionId,
    kind: "clarification",
    question: authorityPending.prompt,
  });
  const receipt = Object.freeze({
    receiptId: "receipt:awaiting-clarification",
    rootActionId: PREPARED.rootActionId,
    status: "awaitingInput",
    pendingInputId: authorityPending.pendingInputId,
  });
  const projectedReadModel = Object.freeze({
    ...PLAYER_READ_MODEL,
    pendingInputs: Object.freeze([projectedPending]),
  });
  const harness = createHarness({
    proposals: [Object.freeze({
      kind: "clarification",
      rootActionId: PREPARED.rootActionId,
      proposalAttemptId: "proposal:clarification:1",
      pending: authorityPending,
    })],
    commitResults: [Object.freeze({ kind: "awaitingInput", receipt, pending: authorityPending })],
    narratives: [],
    observed: Object.freeze({ readModel: projectedReadModel }),
  });

  const outcome = await handleRoomAction(harness.context, {
    ...INTENT,
    submissionId: "submission:ambiguous-lever",
    text: "我拉下那根拉杆。",
  });

  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "kp.propose",
    "authority.commit",
    "authority.observe",
  ]);
  assert.deepEqual(outcome, {
    kind: "awaitingInput",
    receipt,
    readModel: projectedReadModel,
    pending: projectedPending,
  });
  assert.equal(harness.authority.worldCommitCount, 0);
  assert.equal(calls(harness.trace, "kp", "propose").length, 1);
  assert.equal(calls(harness.trace, "kp", "narrate").length, 0);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 0);
});

test("awaiting input returns only the viewer-projected pending choice", async () => {
  const pendingInputId = "pending:private-reaction";
  const secret = "PRIVATE_PENDING_CANDIDATE_SENTINEL";
  const rawPending = Object.freeze({
    pendingInputId,
    rootActionId: PREPARED.rootActionId,
    kind: "combatChoice",
    controllerPrincipalId: "principal:bob",
    internalCandidates: Object.freeze([secret, "reaction:hidden-counterspell"]),
    privateWindowState: secret,
  });
  const projectedPending = Object.freeze({
    pendingInputId,
    rootActionId: PREPARED.rootActionId,
    kind: "combatChoice",
    question: "你是否使用当前可见的反应？",
    choiceKind: "reaction",
    candidateAbilityRefs: Object.freeze(["reaction:visible-shield"]),
    targetEntityId: "character:alice",
  });
  const receipt = Object.freeze({
    receiptId: "receipt:private-reaction",
    rootActionId: PREPARED.rootActionId,
    status: "awaitingInput",
    pendingInputId,
  });
  const readModel = Object.freeze({
    ...PLAYER_READ_MODEL,
    pendingInputs: Object.freeze([projectedPending]),
  });
  const harness = createHarness({
    proposals: [{ kind: "clarification", rootActionId: PREPARED.rootActionId }],
    commitResults: [{ kind: "awaitingInput", receipt, pending: rawPending }],
    narratives: [],
    observed: { readModel },
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.equal(outcome.kind, "awaitingInput");
  assert.deepEqual(outcome.pending, projectedPending);
  assert.equal(JSON.stringify(outcome).includes(secret), false);
  assert.equal(JSON.stringify(outcome).includes("controllerPrincipalId"), false);
});

test("a mechanical diagnostic is revised by KP under the same root action", async () => {
  const diagnostic = diagnosticResult(1);
  const revisedProposal = Object.freeze({
    kind: "directSuccess",
    proposalAttemptId: "proposal:open-door:2",
    rootActionId: PREPARED.rootActionId,
    result: Object.freeze({ door: "open", method: "supported-force" }),
  });
  const harness = createHarness({
    proposals: [DIRECT_SUCCESS_PROPOSAL, revisedProposal],
    commitResults: [diagnostic, COMMITTED_AUTHORITY_RESULT],
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.equal(outcome.kind, "committed");
  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "kp.propose",
    "authority.commit",
    "kp.propose",
    "authority.commit",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  const proposalCalls = calls(harness.trace, "kp", "propose");
  assert.equal(proposalCalls[0].request.rootActionId, PREPARED.rootActionId);
  assert.equal(proposalCalls[1].request.rootActionId, PREPARED.rootActionId);
  assert.deepEqual(proposalCalls[1].request.diagnostics, diagnostic.diagnostics);
  const commitCalls = calls(harness.trace, "authority", "commit");
  assert.ok(commitCalls.every((call) => call.preparedActionId === PREPARED.preparedActionId));
  assert.ok(commitCalls.every((call) => call.rulesInput.rootActionId === PREPARED.rootActionId));
  assert.equal(harness.authority.worldCommitCount, 1);
});

test("two illegal proposals return needsKp without narration, delivery, or a half commit", async () => {
  const firstDiagnostic = diagnosticResult(1);
  const secondDiagnostic = diagnosticResult(2, "receipt:diagnostic:final");
  const revisedButIllegal = Object.freeze({
    kind: "mechanicalProposal",
    proposalAttemptId: "proposal:illegal:2",
    rootActionId: PREPARED.rootActionId,
    mechanic: "still-not-supported",
  });
  const harness = createHarness({
    proposals: [DIRECT_SUCCESS_PROPOSAL, revisedButIllegal],
    commitResults: [firstDiagnostic, secondDiagnostic],
    narratives: [],
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.deepEqual(outcome, {
    kind: "needsKp",
    receipt: secondDiagnostic.receipt,
  });
  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "kp.propose",
    "authority.commit",
    "kp.propose",
    "authority.commit",
  ]);
  assert.equal(harness.authority.worldCommitCount, 0);
  assert.equal(calls(harness.trace, "kp", "narrate").length, 0);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 0);
  assert.equal(calls(harness.trace, "authority", "observe").length, 0);
});

test("a transient model failure is retryable and cannot advance the world", async () => {
  const modelFailure = Object.assign(new Error("model capacity unavailable"), {
    code: "modelTransient",
    retryAfter: 3,
  });
  const harness = createHarness({ proposals: [modelFailure], commitResults: [], narratives: [] });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.equal(outcome.kind, "retryableFailure");
  assert.equal(outcome.code, "modelTransient");
  assert.equal(harness.authority.worldCommitCount, 0);
  assert.deepEqual(operations(harness.trace), ["authority.prepare", "kp.propose"]);
  assert.equal(calls(harness.trace, "authority", "commit").length, 0);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 0);
});

test("permanent and quota KP failures keep their stable outer classifications without leaking model details", async () => {
  const privateModelDetail = "PRIVATE_MODEL_FAILURE_SENTINEL: hidden module truth";
  const cases = [
    {
      error: Object.assign(new Error(privateModelDetail), {
        code: "modelPermanent",
        modelInvocationReceipt: { result: "modelPermanent", responseHash: "sha256:private" },
      }),
      expected: {
        kind: "rejected",
        code: "modelPermanent",
        explanation: "权威 KP 模型配置或输出无效。",
      },
    },
    {
      error: Object.assign(new Error(privateModelDetail), {
        code: "quotaExhausted",
        retryAfter: 17,
        modelInvocationReceipt: { result: "quotaExhausted", responseHash: "sha256:private" },
      }),
      expected: {
        kind: "retryableFailure",
        code: "quotaExhausted",
        retryAfter: 17,
      },
    },
  ];

  for (const { error, expected } of cases) {
    const harness = createHarness({ proposals: [error], commitResults: [], narratives: [] });
    const outcome = await handleRoomAction(harness.context, INTENT);

    assert.deepEqual(outcome, expected);
    assert.equal(JSON.stringify(outcome).includes(privateModelDetail), false);
    assert.equal(JSON.stringify(outcome).includes("responseHash"), false);
    assert.equal(harness.authority.worldCommitCount, 0);
    assert.deepEqual(operations(harness.trace), ["authority.prepare", "kp.propose"]);
  }
});

test("protected reference failures are indistinguishable and never expose internal explanations", async () => {
  const secret = "PRIVATE_REFERENCE_SENTINEL: hidden cellar exit";
  const failures = [
    {
      kind: "rejected",
      code: "privateOrUnknownReference",
      explanation: `The guessed target exists but is private: ${secret}`,
    },
    {
      kind: "rejected",
      code: "pendingInputUnauthorized",
      explanation: `The private reaction belongs to another viewer: ${secret}`,
    },
    {
      kind: "rejected",
      code: "pendingInputUnavailable",
      explanation: "No such pending input exists.",
    },
  ];

  const outcomes = [];
  for (const prepareResult of failures) {
    const harness = createHarness({
      prepareResult,
      proposals: [],
      commitResults: [],
      narratives: [],
    });
    outcomes.push(await handleRoomAction(harness.context, INTENT));
  }

  for (const outcome of outcomes) {
    assert.deepEqual(outcome, {
      kind: "rejected",
      code: "referenceUnavailable",
      explanation: "该对象当前不可用。",
    });
    assert.equal(JSON.stringify(outcome).includes(secret), false);
  }
});

test("Room Action exposes exactly the six specified outcome variants", async () => {
  const pending = Object.freeze({
    pendingInputId: "pending:shape",
    kind: "clarification",
    controllerPrincipalId: TRUSTED_PRINCIPAL.id,
  });
  const awaitingReceipt = Object.freeze({
    receiptId: "receipt:shape:awaiting",
    rootActionId: PREPARED.rootActionId,
    status: "awaitingInput",
  });
  const finalDiagnostic = diagnosticResult(2, "receipt:shape:needs-kp");
  const modelFailure = Object.assign(new Error("model timeout"), { code: "modelTransient" });
  const rejected = Object.freeze({
    kind: "rejected",
    code: "notController",
    explanation: "当前会话没有这个角色的控制权。",
  });
  const concludedReceipt = Object.freeze({
    ...COMMITTED_RECEIPT,
    receiptId: "receipt:concluded",
    status: "concluded",
  });

  const scenarios = [
    createHarness(),
    createHarness({
      proposals: [{ kind: "clarification", rootActionId: PREPARED.rootActionId, pending }],
      commitResults: [{ kind: "awaitingInput", receipt: awaitingReceipt, pending }],
      narratives: [],
      observed: { readModel: PLAYER_READ_MODEL },
    }),
    createHarness({
      proposals: [DIRECT_SUCCESS_PROPOSAL, { ...DIRECT_SUCCESS_PROPOSAL, proposalAttemptId: "proposal:2" }],
      commitResults: [diagnosticResult(1), finalDiagnostic],
      narratives: [],
    }),
    createHarness({ proposals: [modelFailure], commitResults: [], narratives: [] }),
    createHarness({ prepareResult: rejected, proposals: [], commitResults: [], narratives: [] }),
    createHarness({
      proposals: [{ kind: "conclude", rootActionId: PREPARED.rootActionId }],
      commitResults: [{
        kind: "concluded",
        receipt: concludedReceipt,
        kpProjection: KP_COMMITTED_PROJECTION,
        deliveryPlan: DEFAULT_DELIVERY_PLAN,
      }],
    }),
  ];
  const expectedKinds = [
    "committed",
    "awaitingInput",
    "needsKp",
    "retryableFailure",
    "rejected",
    "concluded",
  ];

  const outcomes = [];
  for (const harness of scenarios) {
    outcomes.push(await handleRoomAction(harness.context, INTENT));
  }

  assert.deepEqual(outcomes.map((outcome) => outcome.kind), expectedKinds);
  for (const outcome of outcomes) assertOutcomeShape(outcome);
});
