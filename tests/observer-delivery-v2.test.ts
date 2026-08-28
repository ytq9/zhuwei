import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { narrationModelInput } from "../app/_runtime/lib/kp/authoritative-policy";
import { projectAuthoritativeTableObservation } from "../app/_runtime/lib/table/authoritative";
import {
  directConsequencesProposal,
  noncombatCheckProposal,
} from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({ principal: Object.freeze({ id: "principal:delivery:alice", sessionVersion: 1 }) });
const BOB = Object.freeze({ principal: Object.freeze({ id: "principal:delivery:bob", sessionVersion: 1 }) });
const CAROL = Object.freeze({ principal: Object.freeze({ id: "principal:delivery:carol", sessionVersion: 1 }) });
const DAVE = Object.freeze({ principal: Object.freeze({ id: "principal:delivery:dave", sessionVersion: 1 }) });

const PRIVATE_CLUE = "private-clue:the-seal-was-replaced-at-midnight";

type DeliveryAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string, acknowledgementId?: string): Promise<unknown>;
};

function record(value: unknown, label: string): RecordValue {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as RecordValue;
}

function authority(name: string): DeliveryAuthority {
  return env.ROOMS.getByName(name) as unknown as DeliveryAuthority;
}

function character(characterId: string, controllerPrincipalId: string, sceneId: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name: characterId,
      sceneId,
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: [],
    },
  };
}

async function initialized(name: string) {
  return (await initializedWithAdministration(name)).stub;
}

async function initializedWithAdministration(name: string) {
  const stub = authority(name);
  const result = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    moduleVersion: "legacy-anchor-v1",
    members: [
      { principalId: ALICE.principal.id, role: "player" },
      { principalId: BOB.principal.id, role: "player" },
      { principalId: CAROL.principal.id, role: "player" },
      { principalId: DAVE.principal.id, role: "player" },
    ],
    characters: [
      character("character:delivery:alice", ALICE.principal.id, "archive"),
      character("character:delivery:bob", BOB.principal.id, "archive"),
      character("character:delivery:carol", CAROL.principal.id, "yard"),
      character("character:delivery:dave", DAVE.principal.id, "chapel"),
    ],
  }), "delivery room initialization");
  expect(result).toMatchObject({ created: true });
  const capabilities = record(result.serviceCapabilities, "delivery room service capabilities");
  expect(capabilities.roomAdministration).toBeDefined();
  return { stub, administration: capabilities.roomAdministration };
}

async function commitProposal(
  stub: DeliveryAuthority,
  submissionId: string,
  proposal: (rootActionId: string) => unknown,
  text = "我按已经声明的方式行动。",
) {
  const prepared = record(await stub.prepare(ALICE, {
    kind: "intent",
    submissionId,
    characterId: "character:delivery:alice",
    text,
  }), "prepared action");
  expect(prepared.kind).toBe("prepared");
  const mechanicalProposal = proposal(String(prepared.rootActionId));
  const committed = record(await stub.commit(
    ALICE,
    String(prepared.preparedActionId),
    mechanicalProposal,
  ), "commit result");
  expect(committed.kind, JSON.stringify(committed)).toBe("committed");
  const plan = record(committed.deliveryPlan, "frozen delivery plan");
  return { prepared, mechanicalProposal, committed, plan };
}

async function committedResult(stub: DeliveryAuthority, submissionId: string, publicResult: string) {
  const prepared = record(await stub.prepare(ALICE, {
    kind: "intent",
    submissionId,
    characterId: "character:delivery:alice",
    text: "我轻轻推开档案柜，观察里面留下了什么。",
  }), "prepared action");
  expect(prepared.kind).toBe("prepared");
  const committed = record(await stub.commit(
    ALICE,
    String(prepared.preparedActionId),
    directConsequencesProposal(String(prepared.rootActionId), {
      proposalAttemptId: `${submissionId}:proposal`,
      goal: "观察档案柜内留下的现场痕迹",
      method: "谨慎打开没有上锁的档案柜",
      duration: { unit: "second", value: 1 },
      dynamicMaterializations: [{
        kind: "fact",
        factRef: `fact:delivery:${submissionId.replace(/[^a-z0-9]+/gi, "-")}`,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:public",
        definition: { publicResult },
      }],
    }),
  ), "commit result");
  expect(committed.kind).toBe("committed");
  const plan = record(committed.deliveryPlan, "frozen delivery plan");
  expect(plan.publishCapability).toEqual(expect.any(String));
  expect(plan.audiences).toEqual(expect.any(Array));
  return { committed, plan };
}

function audiences(plan: RecordValue) {
  return plan.audiences as Array<RecordValue>;
}

async function publishForAudience(
  stub: DeliveryAuthority,
  plan: RecordValue,
  prefix: string,
) {
  const frames = audiences(plan).map((audience) => ({
    audienceId: audience.audienceId,
    narration: { text: `${prefix}:${String(audience.characterId)}`, agencyClaims: [] },
  }));
  const result = await stub.publishDelivery(
    { publishCapability: plan.publishCapability },
    { frames },
  );
  expect(result).toMatchObject({ kind: "published" });
  return frames;
}

describe("observer-specific single-slot delivery", () => {
  it("does not create a same-scene slot or side-channel for a private clue", async () => {
    const roomName = "observer-delivery-v2-private-clue";
    const stub = await initialized(roomName);
    const committed = await commitProposal(
      stub,
      "submission:delivery:private-clue",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        proposalAttemptId: "proposal:delivery:private-clue",
        goal: "独自确认印章的细小磨损",
        method: "把印章藏在掌心里观察只有自己能看见的细节",
        duration: { unit: "second", value: 1 },
        dynamicMaterializations: [{
          kind: "fact",
          factRef: "fact:delivery:private-clue-source",
          causalBasisRefs: [],
          visibilityPolicyRef: "visibility:knowledge-holder:character:delivery:alice",
          definition: { conclusion: PRIVATE_CLUE },
        }],
        success: [{
          kind: "acquireKnowledge",
          knowledgeRef: "knowledge:delivery:private-clue",
          value: PRIVATE_CLUE,
          definitionRef: "fact:delivery:private-clue-source",
        }],
      }),
      "我把印章藏在掌心里，独自确认它的磨损。",
    );

    expect(audiences(committed.plan).map((entry) => entry.characterId)).toEqual([
      "character:delivery:alice",
    ]);
    expect(JSON.stringify(committed.plan)).toContain(PRIVATE_CLUE);
    await publishForAudience(stub, committed.plan, "只给 Alice 的当前回应");

    const queries = [
      undefined,
      ...["realtime", "history", "reconnect", "error", "candidates", "voice", "transcript"]
        .map((channel) => ({ channel })),
      {
        channel: "voice",
        committedRange: {
          receiptId: `forged:${PRIVATE_CLUE}`,
          actorCharacterId: "character:delivery:alice",
          priorState: { hidden: PRIVATE_CLUE },
          events: [{ payload: { hidden: PRIVATE_CLUE } }],
        },
      },
    ];
    for (const viewer of [BOB, CAROL, DAVE]) {
      for (const query of queries) {
        const label = `${viewer.principal.id} ${String(query?.channel ?? "poll")}`;
        const observation = record(await authority(roomName).observe(viewer, query), label);
        expect(observation.delivery).toEqual({ kind: "none" });
        expect(JSON.stringify(observation)).not.toContain(PRIVATE_CLUE);
        expect(JSON.stringify(observation)).not.toContain("只给 Alice");

        const tableProjection = projectAuthoritativeTableObservation({
          userId: viewer.principal.id,
          members: [
            ALICE.principal.id,
            BOB.principal.id,
            CAROL.principal.id,
            DAVE.principal.id,
          ],
          locationLabels: {
            archive: "档案室",
            yard: "院子",
            chapel: "礼拜堂",
          },
          observation,
        });
        expect(tableProjection.messages).toEqual([]);
        expect(JSON.stringify(tableProjection)).not.toContain(PRIVATE_CLUE);
      }
    }

    for (const channel of [
      "realtime",
      "history",
      "reconnect",
      "error",
      "candidates",
      "voice",
      "transcript",
    ]) {
      const unauthorized = await authority(roomName).observe(
        { principal: { id: "principal:delivery:outsider", sessionVersion: 1 } },
        { channel },
      );
      expect(JSON.stringify(unauthorized)).not.toContain(PRIVATE_CLUE);
      expect(JSON.stringify(unauthorized)).not.toContain("只给 Alice");
    }
  });

  it("freezes movement deltas for departure and arrival observers but not a third scene", async () => {
    const stub = await initialized("observer-delivery-v2-movement-delta");
    const { plan } = await commitProposal(
      stub,
      "submission:delivery:movement",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        proposalAttemptId: "proposal:delivery:movement",
        goal: "从档案室走到院子",
        method: "沿走廊正常步行",
        duration: { unit: "minute", value: 1 },
        success: [{ kind: "moveEntity", sceneRef: "yard" }],
      }),
      "我离开档案室，沿走廊走进院子。",
    );

    const byCharacter = Object.fromEntries(audiences(plan).map((entry) => [entry.characterId, entry]));
    expect(Object.keys(byCharacter).sort()).toEqual([
      "character:delivery:alice",
      "character:delivery:bob",
      "character:delivery:carol",
    ]);
    expect(byCharacter["character:delivery:bob"].kpProjection).toMatchObject({
      committedDelta: {
        changes: expect.arrayContaining([{
          kind: "characterDeparted",
          characterId: "character:delivery:alice",
          sceneId: "archive",
        }]),
      },
    });
    expect(byCharacter["character:delivery:carol"].kpProjection).toMatchObject({
      committedDelta: {
        changes: expect.arrayContaining([{
          kind: "characterArrived",
          characterId: "character:delivery:alice",
          sceneId: "yard",
        }]),
      },
    });
    expect(JSON.stringify(plan)).not.toContain("character:delivery:dave");
  });

  it("grounds narration in per-viewer deltas so equal-state success and failure prompts differ", async () => {
    const successStub = await initialized("observer-delivery-v2-success-grounding");
    const failureStub = await initialized("observer-delivery-v2-failure-grounding");
    const check = (dc: number, label: string) => (rootActionId: string) => noncombatCheckProposal(rootActionId, {
      proposalAttemptId: `proposal:delivery:${label}`,
      goal: "判断同一扇门是否会卡住",
      method: "以相同力度推门",
      dc,
      duration: { unit: "second", value: 1 },
      success: [],
      failure: [],
      risk: {
        warning: "门轴状态不确定。",
        successConsequences: ["门轴顺畅转动。"],
        failureConsequences: ["门轴卡住，没有打开。"],
        retryGate: ["methodChanged"],
      },
      dynamicMaterializations: [{
        kind: "fact",
        factRef: "fact:delivery:door-hinge",
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:scene-observers",
        definition: { subject: "door-hinge", uncertainty: "whether-it-sticks" },
      }],
    });
    const success = await commitProposal(
      successStub,
      "submission:delivery:success-grounding",
      check(1, "success"),
    );
    const failure = await commitProposal(
      failureStub,
      "submission:delivery:failure-grounding",
      check(30, "failure"),
    );
    const actorProjection = (plan: RecordValue) => audiences(plan).find((entry) =>
      entry.characterId === "character:delivery:alice")?.kpProjection;
    const successInput = narrationModelInput({
      rootActionId: String(success.prepared.rootActionId),
      receipt: success.committed.receipt,
      projection: actorProjection(success.plan),
    });
    const failureInput = narrationModelInput({
      rootActionId: String(failure.prepared.rootActionId),
      receipt: failure.committed.receipt,
      projection: actorProjection(failure.plan),
    });
    const successPrompt = String((successInput.messages as Array<RecordValue>)[1].content);
    const failurePrompt = String((failureInput.messages as Array<RecordValue>)[1].content);

    expect(successPrompt).not.toEqual(failurePrompt);
    expect(successPrompt).toContain('"outcome":"success"');
    expect(failurePrompt).toContain('"outcome":"failure"');
    expect(successPrompt).toContain('"status":"committed"');
    expect(failurePrompt).toContain('"status":"committed"');
    expect(successPrompt).not.toMatch(/DiceRolled|CheckFrozen|frozenParametersHash|stateBeforeHash|payloadHash/);
    expect(failurePrompt).not.toMatch(/DiceRolled|CheckFrozen|frozenParametersHash|stateBeforeHash|payloadHash/);
  });

  it("rejects player-owned agency claims before publication without changing canonical state or Delivery", async () => {
    const stub = await initialized("observer-delivery-v2-player-agency-guard");
    const { plan } = await commitProposal(
      stub,
      "submission:delivery:player-agency-guard",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        proposalAttemptId: "proposal:delivery:player-agency-guard",
        goal: "打开没有上锁的档案柜",
        method: "拉动柜门把手",
        duration: { unit: "second", value: 1 },
      }),
      "我拉开没有上锁的档案柜。",
    );
    const before = record(await stub.observe(ALICE), "observation before malicious publication");
    expect(before.delivery).toEqual({ kind: "none" });
    const maliciousFrames = audiences(plan).map((audience) => ({
      audienceId: audience.audienceId,
      narration: {
        text: "你认定这些纸页就是凶手留下的，并决定立刻追出去。",
        agencyClaims: [{
          subjectKind: "playerCharacter",
          subjectRef: audience.characterId,
          claimKind: "thought",
          basisRefs: [audience.characterId],
        }],
      },
    }));

    await expect(stub.publishDelivery(
      { publishCapability: plan.publishCapability },
      { frames: maliciousFrames },
    )).resolves.toMatchObject({ kind: "rejected", code: "invalidPublication" });

    const afterRejected = record(await stub.observe(ALICE), "observation after malicious publication");
    expect(afterRejected).toEqual(before);
    await expect(stub.publishDelivery(
      { publishCapability: plan.publishCapability },
      {
        frames: audiences(plan).map((audience) => ({
          audienceId: audience.audienceId,
          narration: {
            text: "档案柜已经打开，冷风掀动里面的纸页。",
            agencyClaims: [],
          },
        })),
      },
    )).resolves.toMatchObject({ kind: "published" });
    expect(record(await stub.observe(ALICE), "observation after valid retry").delivery)
      .toMatchObject({ kind: "current" });
  });

  it("returns the same frozen delta and publication result on idempotent retries", async () => {
    const stub = await initialized("observer-delivery-v2-idempotent-delta");
    const first = await commitProposal(
      stub,
      "submission:delivery:idempotent-delta",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        proposalAttemptId: "proposal:delivery:idempotent-delta",
        goal: "确认桌面是否积灰",
        method: "用指尖划过桌面",
      }),
    );
    const retried = record(await stub.commit(
      ALICE,
      String(first.prepared.preparedActionId),
      first.mechanicalProposal,
    ), "idempotent commit retry");
    expect(retried).toEqual(first.committed);

    const frames = audiences(first.plan).map((audience) => ({
      audienceId: audience.audienceId,
      narration: { text: `幂等回应:${String(audience.characterId)}`, agencyClaims: [] },
    }));
    const publication = await stub.publishDelivery(
      { publishCapability: first.plan.publishCapability },
      { frames },
    );
    await expect(stub.publishDelivery(
      { publishCapability: first.plan.publishCapability },
      { frames },
    )).resolves.toEqual(publication);
  });

  it("freezes fictionally present audiences at commit and publishes only their individual projections", async () => {
    const stub = await initialized("observer-delivery-v2-audience");
    const { plan } = await committedResult(stub, "submission:delivery:audience", "柜中留有新近翻动的痕迹。");
    const characterIds = audiences(plan).map((entry) => entry.characterId).sort();
    expect(characterIds).toEqual([
      "character:delivery:alice",
      "character:delivery:bob",
    ]);
    expect(JSON.stringify(plan)).not.toContain("character:delivery:carol");

    await expect(stub.publishDelivery(
      { publishCapability: plan.publishCapability },
      {
        frames: [{
          audienceId: "audience:forged-carol",
          narration: { text: "不应送达", agencyClaims: [] },
        }],
      },
    )).resolves.toMatchObject({ kind: "rejected", code: "audienceMismatch" });

    const frames = await publishForAudience(stub, plan, "当前回应");
    const alice = record(await stub.observe(ALICE), "Alice observation");
    const bob = record(await stub.observe(BOB), "Bob observation");
    const carol = record(await stub.observe(CAROL), "Carol observation");
    expect(alice.delivery).toMatchObject({ kind: "current", frame: { deliveryId: expect.any(String) } });
    expect(bob.delivery).toMatchObject({ kind: "current", frame: { deliveryId: expect.any(String) } });
    expect(carol.delivery).toEqual({ kind: "none" });
    expect(JSON.stringify(alice.delivery)).toContain(String(frames.find((entry) =>
      audiences(plan).find((audience) => audience.audienceId === entry.audienceId)?.characterId
        === "character:delivery:alice")?.narration.text));
    expect(JSON.stringify(alice.delivery)).not.toContain("character:delivery:bob");
  });

  it("keeps only each viewer's experienced scene conversation across leaving and returning", async () => {
    const roomName = "observer-delivery-v2-experienced-return";
    const stub = await initialized(roomName);
    const first = await committedResult(
      stub,
      "submission:delivery:experienced:first",
      "档案柜里留有一张公开可见的便笺。",
    );
    const committedBeforePublication = record(
      await authority(roomName).observe(ALICE, { channel: "reconnect" }),
      "Alice after commit before narration publication",
    );
    const bystanderBeforePublication = record(
      await authority(roomName).observe(BOB, { channel: "reconnect" }),
      "Bob after Alice commit before narration publication",
    );
    expect(JSON.stringify(committedBeforePublication.transcript)).toContain(
      "我轻轻推开档案柜，观察里面留下了什么。",
    );
    expect(JSON.stringify(bystanderBeforePublication.transcript)).not.toContain(
      "我轻轻推开档案柜，观察里面留下了什么。",
    );
    expect(committedBeforePublication.transcript.map((message) => message.kind)).toEqual([
      "player",
    ]);
    await publishForAudience(stub, first.plan, "档案室亲历回应");

    const departed = await commitProposal(
      stub,
      "submission:delivery:experienced:depart",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        proposalAttemptId: "proposal:delivery:experienced:depart",
        goal: "从档案室走到院子",
        method: "沿走廊正常步行",
        duration: { unit: "minute", value: 1 },
        success: [{ kind: "moveEntity", sceneRef: "yard" }],
      }),
      "我离开档案室，沿走廊走进院子。",
    );
    const beforeDeparturePublication = record(
      await authority(roomName).observe(ALICE, { channel: "reconnect" }),
      "Alice after departure commit before narration publication",
    );
    expect(beforeDeparturePublication.transcript.map((message) => message.kind)).toEqual([
      "player",
      "kp",
      "player",
    ]);
    expect(JSON.stringify(beforeDeparturePublication.transcript)).toMatch(
      /我轻轻推开档案柜[^]*档案室亲历回应[^]*我离开档案室/,
    );
    await publishForAudience(stub, departed.plan, "离开档案室回应");

    const returned = await commitProposal(
      stub,
      "submission:delivery:experienced:return",
      (rootActionId) => directConsequencesProposal(rootActionId, {
        proposalAttemptId: "proposal:delivery:experienced:return",
        goal: "从院子回到档案室",
        method: "沿原路正常步行",
        duration: { unit: "minute", value: 1 },
        success: [{ kind: "moveEntity", sceneRef: "archive" }],
      }),
      "我从院子沿原路回到档案室。",
    );
    await publishForAudience(stub, returned.plan, "回到档案室回应");

    const aliceObservation = record(
      await authority(roomName).observe(ALICE, { channel: "reconnect" }),
      "Alice after returning",
    );
    const bobObservation = record(
      await authority(roomName).observe(BOB, { channel: "reconnect" }),
      "Bob after Alice returned",
    );
    const carolObservation = record(
      await authority(roomName).observe(CAROL, { channel: "reconnect" }),
      "Carol after Alice left the yard",
    );

    expect(JSON.stringify(aliceObservation.transcript)).toContain("档案室亲历回应");
    expect(JSON.stringify(aliceObservation.transcript)).toContain("我离开档案室");
    expect(JSON.stringify(aliceObservation.transcript)).toContain("离开档案室回应");
    expect(JSON.stringify(bobObservation.transcript)).toContain("档案室亲历回应");
    expect(JSON.stringify(carolObservation.transcript)).not.toContain("档案室亲历回应");
    expect(JSON.stringify(carolObservation.transcript)).not.toContain("我离开档案室");
    expect(JSON.stringify(carolObservation)).toContain("离开档案室回应");

    const aliceTable = projectAuthoritativeTableObservation({
      userId: ALICE.principal.id,
      members: [
        ALICE.principal.id,
        BOB.principal.id,
        CAROL.principal.id,
        DAVE.principal.id,
      ],
      locationLabels: { archive: "档案室", yard: "院子", chapel: "礼拜堂" },
      observation: aliceObservation,
    });
    expect(JSON.stringify(aliceTable.messages)).toContain("档案室亲历回应");
    expect(JSON.stringify(aliceTable.messages)).toContain("回到档案室回应");
    const yardHistory = aliceTable.locationThreads.find((thread) => thread.placeId === "yard");
    expect(yardHistory?.name).toBe("院子");
    expect(JSON.stringify(yardHistory?.messages)).toContain("离开档案室回应");
  });

  it("returns the same current frame after reconnect and keeps the experienced body after ACK", async () => {
    const roomName = "observer-delivery-v2-recovery";
    const stub = await initialized(roomName);
    const { plan } = await committedResult(stub, "submission:delivery:recovery", "一阵纸页摩擦声从柜后传来。");
    await publishForAudience(stub, plan, "断线前回应");

    const first = record(await stub.observe(ALICE), "first observation");
    const refreshed = record(await stub.observe(ALICE, { channel: "realtime" }), "refresh");
    const reacquired = authority(roomName);
    const reconnected = record(await reacquired.observe(ALICE, { channel: "reconnect" }), "reconnect");
    expect(refreshed.delivery).toEqual(first.delivery);
    expect(reconnected.delivery).toEqual(first.delivery);

    const delivery = record(first.delivery, "current delivery");
    const frame = record(delivery.frame, "delivery frame");
    const deliveryId = String(frame.deliveryId);
    const acknowledged = await reacquired.acknowledge(ALICE, deliveryId, "ack:delivery:recovery");
    expect(acknowledged).toMatchObject({ kind: "acknowledged", deliveryId });
    await expect(reacquired.acknowledge(ALICE, deliveryId, "ack:delivery:recovery"))
      .resolves.toEqual(acknowledged);

    const afterAck = record(await reacquired.observe(ALICE, { channel: "history", referenceId: deliveryId }), "after ACK");
    expect(afterAck.delivery).toEqual({ kind: "none" });
    expect(JSON.stringify(afterAck.transcript)).toContain("断线前回应");
  });

  it("supersedes the old body with one new slot and rejects an older narration that arrives late", async () => {
    const stub = await initialized("observer-delivery-v2-supersede");
    const older = await committedResult(stub, "submission:delivery:older", "较早结果");
    const newer = await committedResult(stub, "submission:delivery:newer", "较新结果");

    await publishForAudience(stub, newer.plan, "较新回应");
    const lateFrames = audiences(older.plan).map((audience) => ({
      audienceId: audience.audienceId,
      narration: { text: `迟到旧回应:${String(audience.characterId)}`, agencyClaims: [] },
    }));
    await expect(stub.publishDelivery(
      { publishCapability: older.plan.publishCapability },
      { frames: lateFrames },
    )).resolves.toMatchObject({ kind: "superseded" });

    const observed = record(await stub.observe(ALICE), "current slot");
    expect(JSON.stringify(observed.delivery)).toContain("较新回应");
    expect(JSON.stringify(observed)).not.toContain("迟到旧回应");
    expect(JSON.stringify(observed)).not.toContain("较早结果");
  });

  it("invalidates private slots on control transfer, voluntary departure, and host removal", async () => {
    const privatePlan = async (
      stub: DeliveryAuthority,
      actor: typeof ALICE | typeof BOB,
      characterId: string,
      submissionId: string,
      knowledgeRef: string,
      privateText: string,
    ) => {
      const prepared = record(await stub.prepare(actor, {
        kind: "intent",
        submissionId,
        characterId,
        text: "我遮住其他人的视线，独自辨认这项细节。",
      }), "private action prepared before authority change");
      const committed = record(await stub.commit(
        actor,
        String(prepared.preparedActionId),
        directConsequencesProposal(String(prepared.rootActionId), {
          proposalAttemptId: `${submissionId}:proposal`,
          goal: "独自确认一项只有当前角色可观察的细节",
          method: "遮住其他人的视线后仔细辨认",
          duration: { unit: "second", value: 1 },
          dynamicMaterializations: [{
            kind: "fact",
            factRef: `${knowledgeRef}:source`,
            causalBasisRefs: [],
            visibilityPolicyRef: `visibility:knowledge-holder:${characterId}`,
            definition: { conclusion: privateText },
          }],
          success: [{
            kind: "acquireKnowledge",
            knowledgeRef,
            value: privateText,
            definitionRef: `${knowledgeRef}:source`,
          }],
        }),
      ), "private action committed before authority change");
      expect(committed.kind, JSON.stringify(committed)).toBe("committed");
      const plan = record(committed.deliveryPlan, "private delivery plan before authority change");
      expect(audiences(plan).map((entry) => entry.characterId)).toEqual([characterId]);
      await publishForAudience(stub, plan, privateText);
      const before = record(await stub.observe(actor), "private delivery before authority change");
      const frame = record(record(before.delivery, "private delivery").frame, "private frame");
      return { plan, deliveryId: String(frame.deliveryId) };
    };

    {
      const roomName = "observer-delivery-v2-control-transfer";
      const { stub, administration } = await initializedWithAdministration(roomName);
      const privateText = "PRIVATE_TRANSFER_DELIVERY_SENTINEL";
      const current = await privatePlan(
        stub,
        ALICE,
        "character:delivery:alice",
        "submission:delivery:control-transfer",
        "knowledge:delivery:control-transfer",
        privateText,
      );
      const pendingQuestion = "你要拉警铃还是闸门？";
      const pendingPrepared = record(await stub.prepare(ALICE, {
        kind: "intent",
        submissionId: "submission:delivery:control-transfer-pending",
        text: "我检查两根外观相同的拉杆。",
      }), "pending prepared before control transfer");
      const pendingResult = record(await stub.commit(
        ALICE,
        String(pendingPrepared.preparedActionId),
        {
          kind: "directSuccess",
          rootActionId: pendingPrepared.rootActionId,
          proposalAttemptId: "proposal:delivery:control-transfer-pending",
          goal: "确认玩家要拉动哪一根拉杆",
          method: "先询问明确选择",
          publicBasisRefs: [],
          privateBasisRefs: [],
          risk: null,
          pendingInput: {
            kind: "clarification",
            prompt: pendingQuestion,
            choices: [
              { id: "alarm", label: "警铃", consequence: "拉响警铃。" },
              { id: "gate", label: "闸门", consequence: "触发闸门机构。" },
            ],
          },
          dynamicMaterializations: [],
          npcActions: [],
          mechanicalProposal: null,
          scene: {
            question: pendingQuestion,
            pressure: "",
            opportunities: [],
            conclusionCandidate: null,
          },
        },
      ), "pending committed before control transfer");
      expect(pendingResult.kind).toBe("awaitingInput");
      const pendingInputId = String(record(
        pendingResult.pending,
        "pending input before control transfer",
      ).pendingInputId);
      const originalPendingViewer = record(
        await stub.observe(ALICE),
        "original pending viewer before control transfer",
      );
      expect(JSON.stringify(originalPendingViewer.transcript)).toContain(pendingQuestion);

      await expect(stub.applyRoomAdministration(administration, {
        commandId: "room-admin:delivery:transfer-control",
        kind: "transferControl",
        characterId: "character:delivery:alice",
        fromSeatId: `seat:${ALICE.principal.id}`,
        toSeatId: `seat:${DAVE.principal.id}`,
      })).resolves.toMatchObject({ kind: "committed" });

      const oldController = record(
        await authority(roomName).observe(ALICE, { channel: "reconnect" }),
        "old controller after transfer",
      );
      const newController = record(
        await authority(roomName).observe(DAVE, { channel: "reconnect" }),
        "new controller after transfer",
      );
      expect(oldController).toMatchObject({ kind: "rejected", code: "viewerUnauthorized" });
      expect(newController.delivery).toEqual({ kind: "none" });
      expect(JSON.stringify(oldController)).not.toContain(privateText);
      expect(JSON.stringify(oldController)).not.toContain(current.deliveryId);
      expect(JSON.stringify(newController.delivery)).not.toContain(current.deliveryId);
      expect(JSON.stringify(newController.readModel)).toContain(privateText);
      expect(JSON.stringify(newController.transcript)).not.toContain(privateText);
      expect(JSON.stringify(newController.transcript)).not.toContain(pendingQuestion);
      await expect(stub.acknowledge(ALICE, current.deliveryId, "ack:after-transfer"))
        .resolves.toMatchObject({ kind: "rejected" });

      const answerPrepared = record(await stub.prepare(DAVE, {
        kind: "answer",
        submissionId: "submission:delivery:control-transfer-answer",
        pendingInputId,
        answer: { text: "alarm" },
        displayText: "我选择拉响警铃。",
      }), "new controller pending answer");
      expect(answerPrepared.kind).toBe("prepared");
      const answered = record(await stub.commit(
        DAVE,
        String(answerPrepared.preparedActionId),
        directConsequencesProposal(String(answerPrepared.rootActionId), {
          proposalAttemptId: "proposal:delivery:control-transfer-answer",
          goal: "拉响玩家明确选择的警铃",
          method: "按玩家回答拉动警铃拉杆",
          duration: { unit: "second", value: 1 },
        }),
      ), "new controller pending answer commit");
      expect(answered.kind, JSON.stringify(answered)).toBe("committed");
      const newControllerAfterAnswer = record(
        await stub.observe(DAVE, { channel: "reconnect" }),
        "new controller transcript after answering",
      );
      expect(JSON.stringify(newControllerAfterAnswer.transcript)).toContain(pendingQuestion);
      expect(JSON.stringify(newControllerAfterAnswer.transcript)).toContain("我选择拉响警铃。");
      expect(JSON.stringify(newControllerAfterAnswer.transcript)).not.toContain(privateText);
      await expect(stub.publishDelivery(
        { publishCapability: current.plan.publishCapability },
        { frames: audiences(current.plan).map((audience) => ({
          audienceId: audience.audienceId,
          narration: { text: `LATE_${privateText}`, agencyClaims: [] },
        })) },
      )).resolves.toMatchObject({ kind: "rejected" });
      const afterLate = record(await stub.observe(DAVE), "new controller after late narration");
      expect(afterLate.delivery).toEqual({ kind: "none" });
      expect(JSON.stringify(afterLate)).not.toContain(`LATE_${privateText}`);
    }

    for (const kind of ["departMember", "removeMember"] as const) {
      const roomName = `observer-delivery-v2-${kind}`;
      const { stub, administration } = await initializedWithAdministration(roomName);
      const privateText = `PRIVATE_${kind.toUpperCase()}_DELIVERY_SENTINEL`;
      const current = await privatePlan(
        stub,
        BOB,
        "character:delivery:bob",
        `submission:delivery:${kind}`,
        `knowledge:delivery:${kind}`,
        privateText,
      );

      await expect(stub.applyRoomAdministration(administration, {
        commandId: `room-admin:delivery:${kind}`,
        kind,
        principalId: BOB.principal.id,
        reason: kind === "departMember" ? "voluntaryDeparture" : "hostRemoved",
      })).resolves.toMatchObject({ kind: "committed" });

      const observed = await authority(roomName).observe(BOB, { channel: "reconnect" });
      expect(observed).toMatchObject({ kind: "rejected", code: "seatInactive" });
      expect(JSON.stringify(observed)).not.toContain(privateText);
      expect(JSON.stringify(observed)).not.toContain(current.deliveryId);
      await expect(stub.acknowledge(BOB, current.deliveryId, `ack:after:${kind}`))
        .resolves.toMatchObject({ kind: "rejected" });
      await expect(stub.publishDelivery(
        { publishCapability: current.plan.publishCapability },
        { frames: audiences(current.plan).map((audience) => ({
          audienceId: audience.audienceId,
          narration: { text: `LATE_${privateText}`, agencyClaims: [] },
        })) },
      )).resolves.toMatchObject({ kind: "rejected" });
    }
  });

  it("uses one projector for realtime/history/reconnect/error/candidates/voice/transcript without a cross-channel history bypass", async () => {
    const stub = await initialized("observer-delivery-v2-bypass");
    const { plan } = await committedResult(stub, "submission:delivery:bypass", "现场结构化结果");
    await publishForAudience(stub, plan, "单槽正文");

    const channels = ["realtime", "history", "reconnect", "error", "candidates", "voice", "transcript"];
    const observations = await Promise.all(channels.map((channel) => stub.observe(BOB, { channel })));
    const readModels = observations.map((entry) => record(entry, channelLabel(entry)).readModel);
    const transcripts = observations.map((entry) => record(entry, channelLabel(entry)).transcript);
    for (const readModel of readModels.slice(1)) expect(readModel).toEqual(readModels[0]);
    for (const transcript of transcripts.slice(1)) expect(transcript).toEqual(transcripts[0]);
    for (const observation of observations) {
      const encoded = JSON.stringify(observation);
      expect(encoded).not.toMatch(/messageHistory|narrationHistory|deliveryHistory|voiceHistory|transcriptHistory/);
    }
  });
});

function channelLabel(value: unknown) {
  return `observation ${typeof value}`;
}
