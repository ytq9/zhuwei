import assert from "node:assert/strict";
import test from "node:test";

import { handleRoomAction } from "../app/_runtime/lib/room/action.ts";
import { INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE } from "../app/_runtime/lib/rules/profiles/manifests.ts";

const TRUSTED_PRINCIPAL = Object.freeze({
  id: "principal:alice",
  sessionVersion: 7,
});

const CLICKING_PRINCIPAL = Object.freeze({
  id: "principal:bob",
  sessionVersion: 3,
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

const DELIVERY_PUBLISH_CAPABILITY = "delivery-capability:open-door:2";

const DEFAULT_DELIVERY_PLAN = Object.freeze({
  deliveryProtocol: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
  publishCapability: DELIVERY_PUBLISH_CAPABILITY,
  rootActionId: PREPARED.rootActionId,
  receiptId: "receipt:open-door",
  audiences: Object.freeze([
    Object.freeze({
      audienceId: "audience:alice",
      principalId: TRUSTED_PRINCIPAL.id,
      narrationInputMode: "observerProjection-v1",
      kpProjection: ALICE_AUDIENCE_PROJECTION,
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
  delivery: Object.freeze({
    kind: "current",
    frame: DELIVERY,
    body: DELIVERY.body,
  }),
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
  resumeResults = [],
  proposals = [DIRECT_SUCCESS_PROPOSAL],
  commitResults = [COMMITTED_AUTHORITY_RESULT],
  narratives = [{
    body: DELIVERY.body,
  }],
  publicationResults = [{ kind: "published", deliveryIds: [DELIVERY.deliveryId] }],
  observed = OBSERVED_COMMITTED,
} = {}) {
  const trace = [];
  const resumeQueue = [...resumeResults];
  const proposalQueue = [...proposals];
  const commitQueue = [...commitResults];
  const narrativeQueue = [...narratives];
  const publicationQueue = [...publicationResults];
  const audiencePublications = new Map();

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
      return typeof prepareResult === "function"
        ? prepareResult(authenticatedContext, input)
        : prepareResult;
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

    async resumePlayerRandomness(authenticatedContext, randomnessId) {
      trace.push({
        boundary: "authority",
        operation: "resumePlayerRandomness",
        principalId: trustedPrincipalId(authenticatedContext),
        randomnessId,
      });
      return scriptedValue(resumeQueue, "authority.resumePlayerRandomness");
    },

    async publishDelivery(authenticatedContext, publication) {
      trace.push({
        boundary: "authority",
        operation: "publishDelivery",
        principalId: trustedPrincipalId(authenticatedContext),
        authorization: authenticatedContext,
        publication,
      });
      const result = scriptedValue(publicationQueue, "authority.publishDelivery");
      if (["published", "superseded"].includes(result.kind)) {
        for (const frame of publication.frames ?? []) {
          const current = audiencePublications.get(frame.audienceId);
          audiencePublications.set(frame.audienceId, {
            audienceId: frame.audienceId,
            deliveryGeneration: frame.deliveryGeneration ?? current?.deliveryGeneration ?? 0,
            state: result.kind,
          });
        }
      }
      return result;
    },

    async observe(authenticatedContext) {
      trace.push({
        boundary: "authority",
        operation: "observe",
        principalId: trustedPrincipalId(authenticatedContext),
      });
      if (observed instanceof Error) throw observed;
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

  Object.assign(authority, {
      async deliveryPublicationStatus({ publishCapability }) {
        trace.push({
          boundary: "authority",
          operation: "deliveryPublicationStatus",
          publishCapability,
        });
        const audiences = [...audiencePublications.values()];
        const terminal = audiences.length > 0 && audiences.every(({ state }) =>
          state === "published" || state === "superseded");
        return {
          kind: terminal
            ? audiences.every(({ state }) => state === "superseded") ? "superseded" : "published"
            : "open",
          audiences,
        };
      },

      async beginDeliveryAudiencePublication({ publishCapability, audienceId }) {
        trace.push({
          boundary: "authority",
          operation: "beginDeliveryAudiencePublication",
          publishCapability,
          audienceId,
        });
        const current = audiencePublications.get(audienceId);
        if (current?.state === "published" || current?.state === "superseded") {
          return { kind: current.state, audienceId, deliveryGeneration: current.deliveryGeneration };
        }
        const pending = {
          audienceId,
          deliveryGeneration: (current?.deliveryGeneration ?? 0) + 1,
          state: "pending",
        };
        audiencePublications.set(audienceId, pending);
        return { kind: "pending", audienceId, deliveryGeneration: pending.deliveryGeneration };
      },

      async failDeliveryAudiencePublication(authorization, failure) {
        trace.push({
          boundary: "authority",
          operation: "failDeliveryAudiencePublication",
          authorization,
          failure,
        });
        audiencePublications.set(failure.audienceId, {
          audienceId: failure.audienceId,
          deliveryGeneration: failure.deliveryGeneration,
          state: failure.state,
          errorCode: failure.errorCode,
        });
        return { kind: failure.state, ...failure };
      },
  });

  const kp = {
    async propose(request) {
      trace.push({ boundary: "kp", operation: "propose", request });
      return scriptedValue(proposalQueue, "kp.propose");
    },

    async decideDueActorPlan() {
      throw new Error("due ActorPlan decisions are not scripted by this harness");
    },

    async narrate(request) {
      trace.push({ boundary: "kp", operation: "narrate", request });
      return scriptedValue(narrativeQueue, "kp.narrate");
    },
  };

  return {
    context: { principal: TRUSTED_PRINCIPAL, authority, kp },
    authority,
    audiencePublications,
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
  assert.equal(typeof outcome.action, "string");
  assert.equal(typeof outcome.narration, "string");

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
    "authority.deliveryPublicationStatus",
    "authority.beginDeliveryAudiencePublication",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.deepEqual(outcome, {
    kind: "committed",
    receipt: COMMITTED_RECEIPT,
    readModel: PLAYER_READ_MODEL,
    delivery: OBSERVED_COMMITTED.delivery,
    audienceNarrations: [{
      audienceId: "audience:alice",
      deliveryGeneration: 1,
      state: "published",
    }],
    action: "committed",
    narration: "published",
  });

  const commit = calls(harness.trace, "authority", "commit")[0];
  assert.equal(commit.preparedActionId, PREPARED.preparedActionId);
  assert.equal(commit.rulesInput.rootActionId, PREPARED.rootActionId);
  assert.equal(
    calls(harness.trace, "kp", "propose")[0].request.proposalPurpose,
    "initialProposal",
  );
  const narration = calls(harness.trace, "kp", "narrate")[0];
  assert.equal(narration.request.rootActionId, PREPARED.rootActionId);
  assert.equal(narration.request.receipt, COMMITTED_RECEIPT);
  assert.equal(narration.request.projection, ALICE_AUDIENCE_PROJECTION);
  assert.equal(narration.request.deliveryGeneration, 1);
});

test("a player's roll gesture resumes the frozen intent after an NPC mechanical stage", async () => {
  const rollInput = Object.freeze({
    kind: "roll",
    submissionId: "submission:roll-player-save",
    randomnessId: "randomness:player-save",
  });
  const resumedPrepared = Object.freeze({
    ...PREPARED,
    phase: "playerIntent",
    resumedActionInput: INTENT,
    resumedPrincipalContext: { principal: TRUSTED_PRINCIPAL },
  });
  const harness = createHarness({
    resumeResults: [{ kind: "continue", prepared: resumedPrepared }],
  });

  const outcome = await handleRoomAction({
    ...harness.context,
    principal: CLICKING_PRINCIPAL,
  }, rollInput);

  assert.equal(outcome.kind, "committed");
  assert.deepEqual(operations(harness.trace), [
    "authority.resumePlayerRandomness",
    "authority.prepare",
    "kp.propose",
    "authority.commit",
    "authority.deliveryPublicationStatus",
    "authority.beginDeliveryAudiencePublication",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  assert.deepEqual(calls(harness.trace, "kp", "propose")[0].request.input, INTENT);
  assert.equal(
    calls(harness.trace, "kp", "propose")[0].request.proposalPurpose,
    "randomnessContinuation",
  );
  assert.deepEqual(calls(harness.trace, "authority", "prepare")[0].input, INTENT);
  assert.equal(
    calls(harness.trace, "authority", "prepare")[0].principalId,
    TRUSTED_PRINCIPAL.id,
  );
  assert.equal(calls(harness.trace, "authority", "resumePlayerRandomness")[0].randomnessId,
    rollInput.randomnessId);
  assert.equal(
    calls(harness.trace, "authority", "resumePlayerRandomness")[0].principalId,
    CLICKING_PRINCIPAL.id,
  );
  assert.equal(calls(harness.trace, "authority", "commit")[0].principalId,
    TRUSTED_PRINCIPAL.id);
});

test("a cached pending answer continuation re-prepares the exact original intent before KP", async () => {
  const answerInput = Object.freeze({
    kind: "answer",
    submissionId: "submission:cached-actor-plan-answer",
    pendingInputId: "pending:actor-plan:reaction",
    answer: Object.freeze({ kind: "declineReaction" }),
  });
  const resumedPrepared = Object.freeze({
    ...PREPARED,
    phase: "playerIntent",
    resumedActionInput: INTENT,
    resumedPrincipalContext: { principal: TRUSTED_PRINCIPAL },
  });
  const harness = createHarness({
    prepareResult: (_principal, input) => input.kind === "answer"
      ? { kind: "continue", prepared: resumedPrepared }
      : PREPARED,
  });

  const outcome = await handleRoomAction({
    ...harness.context,
    principal: CLICKING_PRINCIPAL,
  }, answerInput);

  assert.equal(outcome.kind, "committed");
  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "authority.prepare",
    "kp.propose",
    "authority.commit",
    "authority.deliveryPublicationStatus",
    "authority.beginDeliveryAudiencePublication",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  const prepareCalls = calls(harness.trace, "authority", "prepare");
  assert.equal(prepareCalls[0].principalId, CLICKING_PRINCIPAL.id);
  assert.deepEqual(prepareCalls[0].input, answerInput);
  assert.equal(prepareCalls[1].principalId, TRUSTED_PRINCIPAL.id);
  assert.deepEqual(prepareCalls[1].input, INTENT);
  assert.equal(calls(harness.trace, "kp", "propose")[0].request.input.kind, "intent");
  assert.equal(
    calls(harness.trace, "kp", "propose")[0].request.proposalPurpose,
    "clarificationContinuation",
  );
  assert.equal(calls(harness.trace, "authority", "commit")[0].principalId,
    TRUSTED_PRINCIPAL.id);
});

test("an explicit retry of a settled due stage re-prepares the exact original intent before KP", async () => {
  const retryInput = Object.freeze({
    kind: "retry",
    submissionId: INTENT.submissionId,
    rootActionId: PREPARED.rootActionId,
  });
  const resumedPrepared = Object.freeze({
    ...PREPARED,
    phase: "playerIntent",
    resumedActionInput: INTENT,
    resumedPrincipalContext: { principal: TRUSTED_PRINCIPAL },
  });
  const harness = createHarness({
    prepareResult: (_principal, input) => input.kind === "retry"
      ? resumedPrepared
      : PREPARED,
  });

  const outcome = await handleRoomAction(harness.context, retryInput);

  assert.equal(outcome.kind, "committed");
  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "authority.prepare",
    "kp.propose",
    "authority.commit",
    "authority.deliveryPublicationStatus",
    "authority.beginDeliveryAudiencePublication",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  const prepareCalls = calls(harness.trace, "authority", "prepare");
  assert.deepEqual(prepareCalls[0].input, retryInput);
  assert.deepEqual(prepareCalls[1].input, INTENT);
  assert.deepEqual(calls(harness.trace, "kp", "propose")[0].request.input, INTENT);
  assert.equal(
    calls(harness.trace, "kp", "propose")[0].request.proposalPurpose,
    "proposalRetry",
  );
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
    "authority.deliveryPublicationStatus",
    "authority.beginDeliveryAudiencePublication",
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

test("an item-entry activity bypasses KP mechanics and rejects client-supplied ability or target", async () => {
  const input = Object.freeze({
    kind: "itemActivity",
    submissionId: "submission:drink-potion",
    itemEntryId: "item-entry:potion:alice:1",
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
  assert.equal(calls(harness.trace, "kp", "propose").length, 0);
  assert.deepEqual(calls(harness.trace, "authority", "prepare")[0].input, input);
  assert.deepEqual(calls(harness.trace, "authority", "commit")[0].rulesInput, {
    kind: "authenticatedItemActivity",
    rootActionId: PREPARED.rootActionId,
  });

  const forged = await handleRoomAction(harness.context, {
    ...input,
    submissionId: "submission:drink-potion-forged",
    abilityRef: "ability:forged",
    targetEntityId: "character:someone-else",
  });
  assert.match(forged.kind, /rejected/);
  assert.equal(forged.code, "validation");
});

test("a committed delivery plan narrates each frozen audience projection and publishes with only the Room capability", async () => {
  const aliceNarration = Object.freeze({
    body: "门在你眼前打开，银钥匙落入视线。",
  });
  const bobNarration = Object.freeze({
    body: "庭院那头传来一声遥远的门轴轻响。",
  });
  const deliveryPlan = Object.freeze({
    deliveryProtocol: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
    publishCapability: DELIVERY_PUBLISH_CAPABILITY,
    rootActionId: PREPARED.rootActionId,
    receiptId: COMMITTED_RECEIPT.receiptId,
    audiences: Object.freeze([
      Object.freeze({
        audienceId: "audience:alice",
        principalId: TRUSTED_PRINCIPAL.id,
        narrationInputMode: "observerProjection-v1",
        kpProjection: ALICE_AUDIENCE_PROJECTION,
      }),
      Object.freeze({
        audienceId: "audience:bob",
        principalId: CLICKING_PRINCIPAL.id,
        narrationInputMode: "observerProjection-v1",
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
    publicationResults: [
      { kind: "published", deliveryIds: [DELIVERY.deliveryId] },
      { kind: "published", deliveryIds: ["delivery:open-door:bob"] },
    ],
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
    "authority.deliveryPublicationStatus",
    "authority.beginDeliveryAudiencePublication",
    "authority.beginDeliveryAudiencePublication",
    "kp.narrate",
    "kp.narrate",
    "authority.publishDelivery",
    "authority.publishDelivery",
    "authority.observe",
  ]);
  assert.deepEqual(calls(harness.trace, "authority", "prepare")[0].input, INTENT);

  const narrationCalls = calls(harness.trace, "kp", "narrate");
  assert.deepEqual(narrationCalls.map(({ request }) => request), [
    {
      rootActionId: PREPARED.rootActionId,
      narrationInputMode: "observerProjection-v1",
      receipt: COMMITTED_RECEIPT,
      audienceId: "audience:alice",
      projection: ALICE_AUDIENCE_PROJECTION,
      deliveryGeneration: 1,
    },
    {
      rootActionId: PREPARED.rootActionId,
      narrationInputMode: "observerProjection-v1",
      receipt: COMMITTED_RECEIPT,
      audienceId: "audience:bob",
      projection: BOB_AUDIENCE_PROJECTION,
      deliveryGeneration: 1,
    },
  ]);
  assert.ok(narrationCalls.every(({ request }) => request.audienceId !== forgedAudience.audienceId));
  assert.ok(!JSON.stringify(narrationCalls[0].request).includes(BOB_AUDIENCE_PROJECTION.projectionHash));
  assert.ok(!JSON.stringify(narrationCalls[1].request).includes(ALICE_AUDIENCE_PROJECTION.projectionHash));

  const publicationCalls = calls(harness.trace, "authority", "publishDelivery");
  assert.equal(publicationCalls.length, 2);
  assert.ok(publicationCalls.every(({ authorization, principalId }) => {
    assert.deepEqual(authorization, { publishCapability: DELIVERY_PUBLISH_CAPABILITY });
    assert.notEqual(authorization, TRUSTED_PRINCIPAL);
    return principalId === undefined;
  }));
  assert.deepEqual(publicationCalls.map(({ publication }) => publication), [
    {
      frames: [{
        audienceId: "audience:alice",
        deliveryGeneration: 1,
        narration: { body: aliceNarration.body },
      }],
    },
    {
      frames: [{
        audienceId: "audience:bob",
        deliveryGeneration: 1,
        narration: { body: bobNarration.body },
      }],
    },
  ]);
});

test("a persisted V5 plan without input modes keeps one audience failure isolated", async () => {
  const aliceNarration = Object.freeze({
    body: "门在爱丽丝面前打开，银钥匙落入她的视线。",
  });
  const bobRetryNarration = Object.freeze({
    body: "庭院里的鲍勃终于听见了远处门轴的轻响。",
  });
  const deliveryPlan = Object.freeze({
    deliveryProtocol: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
    publishCapability: DELIVERY_PUBLISH_CAPABILITY,
    rootActionId: PREPARED.rootActionId,
    receiptId: COMMITTED_RECEIPT.receiptId,
    audiences: Object.freeze([
      Object.freeze({
        audienceId: "audience:alice",
        principalId: TRUSTED_PRINCIPAL.id,
        kpProjection: ALICE_AUDIENCE_PROJECTION,
      }),
      Object.freeze({
        audienceId: "audience:bob",
        principalId: CLICKING_PRINCIPAL.id,
        kpProjection: BOB_AUDIENCE_PROJECTION,
      }),
    ]),
  });
  const harness = createHarness({
    prepareResult: (_context, input) => input.kind === "retry"
      ? { ...COMMITTED_AUTHORITY_RESULT, rootActionId: PREPARED.rootActionId, deliveryPlan }
      : PREPARED,
    commitResults: [{ ...COMMITTED_AUTHORITY_RESULT, deliveryPlan }],
    narratives: [
      aliceNarration,
      Object.assign(new Error("Bob narration model timeout"), { code: "modelTransient" }),
      bobRetryNarration,
    ],
    publicationResults: [
      { kind: "published", deliveryIds: [DELIVERY.deliveryId] },
      { kind: "published", deliveryIds: ["delivery:open-door:bob"] },
    ],
    observed: {
      readModel: PLAYER_READ_MODEL,
      delivery: {
        kind: "current",
        frame: { ...DELIVERY, receiptId: COMMITTED_RECEIPT.receiptId },
        body: aliceNarration.body,
      },
    },
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.equal(outcome.kind, "committed");
  assert.equal(outcome.action, "committed");
  assert.equal(outcome.narration, "published");
  assert.equal("deliveryPending" in outcome, false);
  assert.deepEqual(outcome.audienceNarrations, [
    {
      audienceId: "audience:alice",
      deliveryGeneration: 1,
      state: "published",
    },
    {
      audienceId: "audience:bob",
      deliveryGeneration: 1,
      state: "retryableFailure",
      errorCode: "NARRATION_PROVIDER_TIMEOUT",
    },
  ]);
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.equal(calls(harness.trace, "kp", "narrate").length, 2);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 1);
  assert.equal(calls(harness.trace, "authority", "failDeliveryAudiencePublication").length, 1);
  assert.equal(calls(harness.trace, "authority", "observe").length, 1);
  assert.equal(calls(harness.trace, "authority", "observe")[0].principalId, TRUSTED_PRINCIPAL.id);

  assert.equal(harness.authority.worldCommitCount, 1);
  assert.equal(calls(harness.trace, "kp", "propose").length, 1);
  assert.equal(calls(harness.trace, "authority", "commit").length, 1);
  assert.deepEqual(
    calls(harness.trace, "kp", "narrate").map(({ request }) => request.audienceId),
    ["audience:alice", "audience:bob"],
  );
  assert.deepEqual(
    calls(harness.trace, "authority", "publishDelivery")
      .flatMap(({ publication }) => publication.frames.map(({ audienceId }) => audienceId)),
    ["audience:alice"],
  );
});

test("a narration with fields beyond body is rejected before Room publication without repeating mechanics", async () => {
  const maliciousText = "你认定走廊绝对安全，并决定立刻独自冲进去。";
  const harness = createHarness({
    commitResults: [{
      ...COMMITTED_AUTHORITY_RESULT,
      deliveryPlan: DEFAULT_DELIVERY_PLAN,
    }],
    narratives: [{
      body: maliciousText,
      agencyClaims: [{
        subjectKind: "playerCharacter",
        subjectRef: "character:alice",
        claimKind: "thought",
        basisRefs: [ALICE_AUDIENCE_PROJECTION.projectionHash],
      }],
    }],
    observed: {
      readModel: PLAYER_READ_MODEL,
      delivery: { kind: "none" },
      narrationRecovery: {
        kind: "available",
        capability: DELIVERY_PUBLISH_CAPABILITY,
        state: "rejected",
      },
    },
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.deepEqual(outcome, {
    kind: "committed",
    receipt: COMMITTED_RECEIPT,
    readModel: PLAYER_READ_MODEL,
    delivery: { kind: "none" },
    deliveryPending: true,
    audienceNarrations: [{
      audienceId: "audience:alice",
      deliveryGeneration: 1,
      state: "rejected",
      errorCode: "NARRATION_BODY_INVALID",
    }],
    narrationFailureState: "rejected",
    narrationFailureCode: "NARRATION_BODY_INVALID",
    action: "committed",
    narration: "rejected",
  });
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.equal(calls(harness.trace, "authority", "commit").length, 1);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 0);
  assert.equal(calls(harness.trace, "authority", "observe").length, 1);
  assert.ok(!JSON.stringify(outcome).includes(maliciousText));
});

test("a delivery-plan publication failure never rolls back or repeats the committed world result", async () => {
  const aliceNarration = Object.freeze({
    body: "Alice sees only Alice's projection.",
  });
  const deliveryPlan = Object.freeze({
    deliveryProtocol: INDEPENDENT_BODY_DELIVERY_PROTOCOL_PROFILE,
    publishCapability: DELIVERY_PUBLISH_CAPABILITY,
    rootActionId: PREPARED.rootActionId,
    receiptId: COMMITTED_RECEIPT.receiptId,
    audiences: Object.freeze([
      Object.freeze({
        audienceId: "audience:alice",
        principalId: TRUSTED_PRINCIPAL.id,
        narrationInputMode: "observerProjection-v1",
        kpProjection: ALICE_AUDIENCE_PROJECTION,
      }),
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
    observed: {
      readModel: PLAYER_READ_MODEL,
      delivery: { kind: "none" },
      narrationRecovery: {
        kind: "available",
        capability: DELIVERY_PUBLISH_CAPABILITY,
        state: "retryableFailure",
      },
    },
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.equal(outcome.kind, "committed");
  assert.equal(outcome.deliveryPending, true);
  assert.deepEqual(outcome.delivery, { kind: "none" });
  assert.deepEqual(outcome.audienceNarrations, [{
    audienceId: "audience:alice",
    deliveryGeneration: 1,
    state: "retryableFailure",
    errorCode: "NARRATION_PUBLICATION_FAILED",
  }]);
  assert.equal(outcome.action, "committed");
  assert.equal(outcome.narration, "retryableFailure");
  assert.equal(outcome.narrationFailureCode, "NARRATION_PUBLICATION_FAILED");
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.equal(calls(harness.trace, "authority", "commit").length, 1);
  assert.equal(calls(harness.trace, "kp", "narrate").length, 1);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 1);
  assert.equal(calls(harness.trace, "authority", "observe").length, 1);
});

test("a post-commit observation failure keeps the action committed and only makes narration retryable", async () => {
  const harness = createHarness({
    observed: new Error("injected post-commit observe failure"),
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.equal(outcome.kind, "committed");
  assert.equal(outcome.action, "committed");
  assert.equal(outcome.narration, "retryableFailure");
  assert.equal(outcome.deliveryPending, true);
  assert.equal(outcome.narrationFailureCode, "NARRATION_PUBLICATION_FAILED");
  assert.equal(outcome.readModel, undefined);
  assert.deepEqual(outcome.receipt, COMMITTED_RECEIPT);
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.equal(calls(harness.trace, "kp", "propose").length, 1);
  assert.equal(calls(harness.trace, "authority", "commit").length, 1);
  assert.equal(calls(harness.trace, "kp", "narrate").length, 1);
  assert.equal(calls(harness.trace, "authority", "publishDelivery").length, 1);
  assert.equal(calls(harness.trace, "authority", "observe").length, 1);
});

test("a direct safety commit survives projection failure without inventing narration failure", async () => {
  const receipt = Object.freeze({
    ...COMMITTED_RECEIPT,
    receiptId: "receipt:safety-adjustment",
    resolutionDisposition: "committed",
  });
  const harness = createHarness({
    prepareResult: {
      ...PREPARED,
      resolutionMode: "authorityDirect",
    },
    proposals: [],
    commitResults: [{ kind: "committed", receipt }],
    narratives: [],
    observed: new Error("injected safety projection failure"),
  });

  const outcome = await handleRoomAction(harness.context, {
    kind: "safetyAdjust",
    submissionId: "submission:safety-adjustment",
    presentationAdjustment: "fadeToBlack",
  });

  assert.deepEqual(outcome, {
    kind: "committed",
    receipt,
    readModel: undefined,
    action: "committed",
    narration: "notApplicable",
  });
  assert.equal(harness.authority.worldCommitCount, 1);
  assert.deepEqual(operations(harness.trace), [
    "authority.prepare",
    "authority.commit",
    "authority.observe",
  ]);
});

test("an awaiting-input projection failure preserves the action axis and hides authority pending data", async () => {
  const secret = "AUTHORITY_ONLY_PENDING_SENTINEL";
  const receipt = Object.freeze({
    receiptId: "receipt:awaiting-hidden",
    rootActionId: PREPARED.rootActionId,
    status: "awaitingInput",
  });
  const harness = createHarness({
    prepareResult: {
      kind: "awaitingInput",
      receipt,
      pending: {
        pendingInputId: "pending:hidden",
        controllerPrincipalId: "principal:bob",
        internalCandidates: [secret],
      },
    },
    proposals: [],
    commitResults: [],
    narratives: [],
    observed: new Error("injected awaiting-input projection failure"),
  });

  const outcome = await handleRoomAction(harness.context, INTENT);

  assert.deepEqual(outcome, {
    kind: "awaitingInput",
    receipt,
    readModel: undefined,
    pending: { kind: "pending" },
    action: "awaitingInput",
    narration: "notApplicable",
  });
  assert.equal(JSON.stringify(outcome).includes(secret), false);
  assert.deepEqual(operations(harness.trace), ["authority.prepare", "authority.observe"]);
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
    action: "awaitingInput",
    narration: "notApplicable",
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
    "authority.deliveryPublicationStatus",
    "authority.beginDeliveryAudiencePublication",
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

  // The internal outcome additionally carries the Form, the repair state and
  // the raw Rules diagnostics for telemetry. This block is Room-internal: the
  // table layer projects a fixed key allowlist, so it never reaches a client
  // (asserted in kp-proposal-failure-telemetry-v3), and it is desensitized
  // into a closed vocabulary before it is logged.
  const { proposal, ...publicOutcome } = outcome;
  assert.deepEqual(publicOutcome, {
    kind: "needsKp",
    receipt: secondDiagnostic.receipt,
    code: "PROPOSAL_REPAIR_EXHAUSTED",
    action: "notCommitted",
    narration: "notApplicable",
  });
  assert.equal(proposal.repairUsed, undefined);
  assert.deepEqual(proposal.diagnostics, secondDiagnostic.diagnostics);
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
  assert.equal(outcome.code, "PROPOSAL_PROVIDER_TIMEOUT");
  assert.equal(outcome.action, "notCommitted");
  assert.equal(outcome.narration, "notApplicable");
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
        modelInvocationReceipt: {
          result: "modelPermanent",
          failureStage: "proposalSchema",
          responseHash: "sha256:private",
        },
      }),
      expected: {
        kind: "rejected",
        code: "PROPOSAL_FORM_INVALID",
        explanation: "权威 KP 模型配置或输出无效。",
        action: "notCommitted",
        narration: "notApplicable",
      },
    },
    {
      error: Object.assign(new Error(privateModelDetail), {
        code: "modelPermanent",
        publicCode: "CONTEXT_INSUFFICIENT",
      }),
      expected: {
        kind: "rejected",
        code: "CONTEXT_INSUFFICIENT",
        explanation: "权威 KP 模型配置或输出无效。",
        action: "notCommitted",
        narration: "notApplicable",
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
        action: "notCommitted",
        narration: "notApplicable",
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

test("the current viewer receives exact provider and grounding narration failure codes after commit", async () => {
  const cases = [
    {
      error: Object.assign(new Error("private provider transient detail"), {
        code: "modelTransient",
      }),
      state: "retryableFailure",
      code: "NARRATION_PROVIDER_TIMEOUT",
    },
    {
      error: new Error("private unclassified narration detail"),
      state: "retryableFailure",
      code: "NARRATION_PUBLICATION_FAILED",
    },
    {
      error: Object.assign(new Error("private grounding detail"), {
        publicCode: "NARRATION_GROUNDING_REJECTED",
      }),
      state: "rejected",
      code: "NARRATION_GROUNDING_REJECTED",
    },
  ];

  for (const { error, state, code } of cases) {
    const harness = createHarness({
      commitResults: [{
        ...COMMITTED_AUTHORITY_RESULT,
        deliveryPlan: DEFAULT_DELIVERY_PLAN,
      }],
      narratives: [error],
      observed: {
        readModel: PLAYER_READ_MODEL,
        delivery: { kind: "none" },
        narrationRecovery: {
          kind: "available",
          capability: DELIVERY_PUBLISH_CAPABILITY,
          state,
        },
      },
    });

    const outcome = await handleRoomAction(harness.context, INTENT);
    assert.equal(outcome.action, "committed");
    assert.equal(outcome.narration, state);
    assert.equal(outcome.narrationFailureCode, code);
    assert.equal(harness.authority.worldCommitCount, 1);
    assert.equal(calls(harness.trace, "kp", "propose").length, 1);
    assert.equal(calls(harness.trace, "authority", "commit").length, 1);
    assert.equal(calls(harness.trace, "kp", "narrate").length, 1);
  }
});

test("V3 proposal failure stages retain their exact public code and stable action semantics", async () => {
  const privateModelDetail = "PRIVATE_PROPOSAL_FAILURE_SENTINEL: hidden reference";
  const cases = [
    {
      error: Object.assign(new Error(privateModelDetail), {
        code: "modelPermanent",
        modelInvocationReceipt: {
          result: "modelPermanent",
          failureStage: "proposalReference",
        },
      }),
      expected: {
        kind: "rejected",
        code: "PROPOSAL_REFERENCE_INVALID",
        explanation: "权威 KP 模型配置或输出无效。",
        action: "notCommitted",
        narration: "notApplicable",
      },
    },
    ...["PROPOSAL_RULES_DIAGNOSTIC", "PROPOSAL_REPAIR_EXHAUSTED"].map((publicCode) => ({
      error: Object.assign(new Error(privateModelDetail), {
        code: "modelPermanent",
        publicCode,
      }),
      expected: {
        kind: "needsKp",
        code: publicCode,
        action: "notCommitted",
        narration: "notApplicable",
      },
    })),
  ];

  for (const { error, expected } of cases) {
    const harness = createHarness({ proposals: [error], commitResults: [], narratives: [] });
    const outcome = await handleRoomAction(harness.context, INTENT);
    assert.deepEqual(outcome, expected);
    assert.equal(JSON.stringify(outcome).includes(privateModelDetail), false);
    assert.equal(harness.authority.worldCommitCount, 0);
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
      action: "notCommitted",
      narration: "notApplicable",
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
