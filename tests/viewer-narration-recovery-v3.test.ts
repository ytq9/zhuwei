import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program";
import { handleViewerNarrationRecovery } from "../app/_runtime/lib/room/action";
import { bodyOnlyNarrationContext } from "../app/_runtime/lib/kp/narration-v3";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests";
import {
  buildAuthoritativeTableState,
  projectAuthoritativeTableObservation,
} from "../app/_runtime/lib/table/authoritative";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:viewer-recovery:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:viewer-recovery:bob", sessionVersion: 1 }),
});
const CAROL = Object.freeze({
  principal: Object.freeze({ id: "principal:viewer-recovery:carol", sessionVersion: 1 }),
});
const ALICE_ID = "character:viewer-recovery:alice";
const BOB_ID = "character:viewer-recovery:bob";
const BOB_SUCCESSOR_ID = "character:viewer-recovery:bob-successor";
const SHARED_YARD_BASIS = "fact:viewer-recovery:shared-yard-context";

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  deliveryPublicationStatus(query: unknown): Promise<unknown>;
  beginDeliveryAudiencePublication(query: unknown): Promise<unknown>;
  failDeliveryAudiencePublication(capability: unknown, failure: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  beginViewerNarrationRecovery(context: unknown, capability: string): Promise<unknown>;
  publishViewerNarrationRecovery(
    context: unknown,
    capability: string,
    publication: unknown,
  ): Promise<unknown>;
  failViewerNarrationRecovery(
    context: unknown,
    capability: string,
    failure: unknown,
  ): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
};

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function character(characterId: string, controllerPrincipalId: string, name: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name,
      sceneId: "yard",
      classId: "fighter",
      raceId: "human",
      level: 1,
      scores: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      proficiency: 2,
      skills: ["athletics"],
      hp: { current: 12, max: 12, temp: 0 },
      ac: 14,
      speed: 30,
      equipped: { armor: "leather", main: "shortsword" },
      backpack: [],
    },
  };
}

function audience(plan: JsonRecord, characterId: string) {
  const match = (plan.audiences as unknown[])
    .map((entry) => record(entry, "frozen audience"))
    .find((entry) => entry.characterId === characterId);
  expect(match, `audience for ${characterId}`).toBeDefined();
  return match!;
}

function privateFormProposal(
  rootActionId: string,
  formId: "materialization.v1" | "observe.v1",
  draft: JsonRecord,
) {
  const causalActionProgram = compileKpFormDraft(formId, draft);
  return {
    kind: "privateFormProposal",
    formId,
    draft: structuredClone(draft),
    causalActionProgram,
    loweredCausalProgram: lowerCausalActionProgram(causalActionProgram),
    semanticFreezeHash: causalActionProgram.semanticHash,
    repairUsed: false,
    proposalAttemptId: `proposal:${rootActionId}:1`,
    modelInvocationReceipt: { task: "proposal", result: "success" },
    rootActionId,
  };
}

function successfulKnowledgeRef(
  rootActionId: string,
  proposal: ReturnType<typeof privateFormProposal>,
) {
  const step = proposal.loweredCausalProgram.steps[0];
  if (step === undefined) throw new Error("current private Form produced no causal step");
  return [
    "evidence:v3",
    rootActionId,
    proposal.causalActionProgram.semanticHash.slice("fnv1a64:".length),
    step.nodeRef,
    "success",
  ].join(":");
}

async function commitVisibleChange(authority: Authority, suffix: string) {
  const prepared = record(await authority.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:viewer-recovery:${suffix}`,
    text: `我确认院子里第 ${suffix} 处刚刚发生的公开变化。`,
  }), "prepared visible action");
  expect(prepared.kind).toBe("prepared");
  const rootActionId = String(prepared.rootActionId);
  const committed = record(await authority.commit(
    ALICE,
    String(prepared.preparedActionId),
    privateFormProposal(rootActionId, "materialization.v1", {
      goal: "确认一处所有在场角色都能看见的变化",
      method: "在院子里共同确认已经显现的公开变化",
      proposedFact: `院子里的公开变化 ${suffix}`,
      basisRefs: [SHARED_YARD_BASIS],
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    }),
  ), "committed visible action");
  expect(committed.kind, JSON.stringify(committed)).toBe("committed");
  return record(committed.deliveryPlan, "independent delivery plan");
}

async function commitBobRetirement(authority: Authority, suffix: string) {
  const prepared = record(await authority.prepare(BOB, {
    kind: "intent",
    submissionId: `submission:viewer-recovery:retire:${suffix}`,
    text: `我决定在第 ${suffix} 幕结束冒险者生涯。`,
  }), "prepared retirement action");
  expect(prepared.kind).toBe("prepared");
  const rootActionId = String(prepared.rootActionId);
  const committed = record(await authority.commit(
    BOB,
    String(prepared.preparedActionId),
    {
      kind: "authenticatedCampaignAction",
      action: "retireCharacter",
      rootActionId,
      continueAsNpc: false,
      reason: "玩家明确选择结束当前角色任期并等待创建继任角色",
    },
  ), "committed retirement action");
  expect(committed.kind, JSON.stringify(committed)).toBe("committed");
  return record(committed.deliveryPlan, "retirement delivery plan");
}

async function publishAliceFailBob(authority: Authority, plan: JsonRecord, suffix: string) {
  const alice = audience(plan, ALICE_ID);
  const bob = audience(plan, BOB_ID);
  const aliceBegin = record(await authority.beginDeliveryAudiencePublication({
    publishCapability: plan.publishCapability,
    audienceId: alice.audienceId,
  }), "Alice publication begin");
  await expect(authority.publishDelivery(
    { publishCapability: plan.publishCapability },
    {
      frames: [{
        audienceId: alice.audienceId,
        deliveryGeneration: aliceBegin.deliveryGeneration,
        narration: { body: `Alice 已收到 ${suffix}` },
      }],
    },
  )).resolves.toMatchObject({ kind: "published" });
  const bobBegin = record(await authority.beginDeliveryAudiencePublication({
    publishCapability: plan.publishCapability,
    audienceId: bob.audienceId,
  }), "Bob publication begin");
  await expect(authority.failDeliveryAudiencePublication(
    { publishCapability: plan.publishCapability },
    {
      audienceId: bob.audienceId,
      deliveryGeneration: bobBegin.deliveryGeneration,
      errorCode: "NARRATION_PROVIDER_TIMEOUT",
      state: "retryableFailure",
    },
  )).resolves.toMatchObject({ kind: "retryableFailure" });
}

async function failBobAudience(authority: Authority, plan: JsonRecord) {
  expect((plan.audiences as unknown[]).map((entry) =>
    record(entry, "retirement frozen audience").characterId)).toEqual([BOB_ID]);
  const bob = audience(plan, BOB_ID);
  const begun = record(await authority.beginDeliveryAudiencePublication({
    publishCapability: plan.publishCapability,
    audienceId: bob.audienceId,
  }), "Bob retirement publication begin");
  await expect(authority.failDeliveryAudiencePublication(
    { publishCapability: plan.publishCapability },
    {
      audienceId: bob.audienceId,
      deliveryGeneration: begun.deliveryGeneration,
      errorCode: "NARRATION_PROVIDER_TIMEOUT",
      state: "retryableFailure",
    },
  )).resolves.toMatchObject({ kind: "retryableFailure" });
}

async function publishAudience(
  authority: Authority,
  plan: JsonRecord,
  characterId: string,
  body: string,
) {
  const binding = audience(plan, characterId);
  const begun = record(await authority.beginDeliveryAudiencePublication({
    publishCapability: plan.publishCapability,
    audienceId: binding.audienceId,
  }), `publication begin for ${characterId}`);
  await expect(authority.publishDelivery(
    { publishCapability: plan.publishCapability },
    {
      frames: [{
        audienceId: binding.audienceId,
        deliveryGeneration: begun.deliveryGeneration,
        narration: { body },
      }],
    },
  )).resolves.toMatchObject({ kind: "published" });
}

function currentBody(observation: JsonRecord) {
  const delivery = record(observation.delivery, "current delivery");
  expect(delivery.kind).toBe("current");
  return String(record(delivery.frame, "current frame").text);
}

describe("V3 viewer-local narration recovery", () => {
  it("withholds a newly committed clue until its grounded KP reply is delivered", async () => {
    const roomId = "viewer-narration-recovery-v3-clue-presentation";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character(ALICE_ID, ALICE.principal.id, "阿莱莎")],
    }), "clue-presentation room initialization");
    expect(initialized.created).toBe(true);

    const prepared = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:viewer-recovery:clue-presentation",
      text: "我仔细检查这枚印章的边缘。",
    }), "clue-presentation action prepared");
    const rootActionId = String(prepared.rootActionId);
    const clueText = "印章边缘有一道新鲜划痕。";
    const clueProposal = privateFormProposal(rootActionId, "observe.v1", {
      goal: "检查印章边缘",
      method: "近距离观察印章边缘",
      focus: "印章边缘的新鲜痕迹",
      desiredInformation: clueText,
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    });
    const knowledgeRef = successfulKnowledgeRef(rootActionId, clueProposal);
    const committed = record(await authority.commit(
      ALICE,
      String(prepared.preparedActionId),
      clueProposal,
    ), "clue-presentation action committed");
    expect(committed.kind).toBe("committed");
    const plan = record(committed.deliveryPlan, "clue-presentation delivery plan");
    const alice = audience(plan, ALICE_ID);
    const begun = record(await authority.beginDeliveryAudiencePublication({
      publishCapability: plan.publishCapability,
      audienceId: alice.audienceId,
    }), "clue-presentation publication begin");
    await expect(authority.failDeliveryAudiencePublication(
      { publishCapability: plan.publishCapability },
      {
        audienceId: alice.audienceId,
        deliveryGeneration: begun.deliveryGeneration,
        errorCode: "NARRATION_GROUNDING_REJECTED",
        state: "rejected",
      },
    )).resolves.toMatchObject({ kind: "rejected" });

    const failedObservation = record(
      await authority.observe(ALICE),
      "clue-presentation failed observation",
    );
    expect(failedObservation.narrationRecovery).toMatchObject({
      kind: "available",
      state: "rejected",
    });
    expect(failedObservation.presentationHold).toEqual({ knowledgeRefs: [knowledgeRef] });
    const failedTable = projectAuthoritativeTableObservation({
      userId: ALICE.principal.id,
      members: [ALICE.principal.id],
      locationLabels: { yard: "院子" },
      observation: failedObservation,
    });
    expect(failedTable.clues).toEqual([]);
    expect(JSON.stringify(failedTable)).not.toContain("presentationHold");

    const capability = String(record(
      failedObservation.narrationRecovery,
      "clue-presentation recovery",
    ).capability);
    await expect(handleViewerNarrationRecovery({
      principal: ALICE,
      authority,
      kp: {
        async propose() {
          throw new Error("narration recovery must not repeat mechanics");
        },
        async narrate() {
          return { body: "你确认印章边缘有一道新鲜划痕。" };
        },
      },
    }, capability)).resolves.toMatchObject({
      action: "committed",
      narration: "published",
    });

    const recoveredObservation = record(
      await authority.observe(ALICE),
      "clue-presentation recovered observation",
    );
    expect(recoveredObservation).not.toHaveProperty("narrationRecovery");
    expect(recoveredObservation).not.toHaveProperty("presentationHold");
    const recoveredTable = projectAuthoritativeTableObservation({
      userId: ALICE.principal.id,
      members: [ALICE.principal.id],
      locationLabels: { yard: "院子" },
      observation: recoveredObservation,
    });
    expect(recoveredTable.clues).toEqual([expect.objectContaining({
      id: knowledgeRef,
      text: clueText,
    })]);
  });

  it("lets only the failed ViewerKey recover after eviction without repeating mechanics", async () => {
    const roomId = "viewer-narration-recovery-v3-primary";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
        { principalId: CAROL.principal.id, role: "observer" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
      fixtureFacts: [{
        factRef: SHARED_YARD_BASIS,
        kind: "establishedCommunicationChannel",
        participants: [ALICE_ID, BOB_ID],
      }],
    }), "V3 room initialization");
    expect(initialized.created).toBe(true);

    const plan = await commitVisibleChange(authority, "one");
    const aliceFrozenProjection = record(
      audience(plan, ALICE_ID).kpProjection,
      "Alice frozen narration projection",
    );
    const bobFrozenProjection = record(
      audience(plan, BOB_ID).kpProjection,
      "Bob frozen narration projection",
    );
    expect(record(aliceFrozenProjection.actorAction, "Alice actor action")).toMatchObject({
      kind: "actorDisplay",
      actorCharacterId: ALICE_ID,
      displayBody: "我确认院子里第 one 处刚刚发生的公开变化。",
    });
    expect(record(bobFrozenProjection.actorAction, "Bob observer action")).toMatchObject({
      kind: "observerClaims",
      actorCharacterId: ALICE_ID,
      observableActionKinds: expect.any(Array),
    });
    expect(JSON.stringify(bobFrozenProjection))
      .not.toContain("我确认院子里第 one 处刚刚发生的公开变化。");
    const receipt = { status: "committed", rootActionId: plan.rootActionId };
    const aliceNarrationContext = bodyOnlyNarrationContext({
      rootActionId: String(plan.rootActionId),
      receipt,
      projection: aliceFrozenProjection,
    }, { socialResolution: true });
    const bobNarrationContext = bodyOnlyNarrationContext({
      rootActionId: String(plan.rootActionId),
      receipt,
      projection: bobFrozenProjection,
    }, { socialResolution: true });
    expect(record(aliceNarrationContext.actorAction, "Alice narration actor action"))
      .toHaveProperty("displayBody", "我确认院子里第 one 处刚刚发生的公开变化。");
    expect(aliceNarrationContext.recentDialogue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "player",
        body: "我确认院子里第 one 处刚刚发生的公开变化。",
      }),
    ]));
    expect(JSON.stringify(bobNarrationContext.actorAction))
      .not.toContain("我确认院子里第 one 处刚刚发生的公开变化。");
    expect(JSON.stringify(bobNarrationContext.recentDialogue))
      .not.toContain("我确认院子里第 one 处刚刚发生的公开变化。");
    await publishAliceFailBob(authority, plan, "第一条回复");
    await expect(authority.prepare(ALICE, {
      kind: "retry",
      submissionId: "submission:viewer-recovery:one",
      rootActionId: plan.rootActionId,
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "viewerNarrationRecoveryRequired",
    });
    await evictDurableObject(authority as never);

    const aliceObservation = record(await authority.observe(ALICE), "Alice observation");
    const bobObservation = record(await authority.observe(BOB), "Bob observation");
    expect(currentBody(aliceObservation)).toBe("Alice 已收到 第一条回复");
    expect(aliceObservation).not.toHaveProperty("narrationRecovery");
    const recovery = record(bobObservation.narrationRecovery, "Bob recovery");
    expect(recovery).toEqual({
      kind: "available",
      capability: expect.stringMatching(/^publish-capability:/u),
      state: "retryableFailure",
    });
    expect(Object.keys(recovery)).toEqual(["kind", "capability", "state"]);
    expect(JSON.stringify(recovery)).not.toMatch(/audience|projection|receipt|generation|alice/iu);
    const projected = projectAuthoritativeTableObservation({
      userId: BOB.principal.id,
      members: [ALICE.principal.id, BOB.principal.id, CAROL.principal.id],
      locationLabels: { yard: "院子" },
      observation: bobObservation,
    });
    expect(buildAuthoritativeTableState({
      rulesetVersion: "dnd5e-2014-srd5.1-authoritative-v2",
      projected,
    })?.narrationRecovery).toEqual(recovery);
    expect(JSON.stringify(projected.narrationRecovery))
      .not.toMatch(/audience|projection|receipt|generation|alice/iu);

    const capability = String(recovery.capability);
    await expect(authority.beginViewerNarrationRecovery(CAROL, capability))
      .resolves.toMatchObject({ kind: "rejected", code: "narrationRecoveryUnavailable" });
    await expect(authority.beginViewerNarrationRecovery({
      principal: { id: BOB.principal.id, sessionVersion: 2 },
    }, capability)).resolves.toMatchObject({
      kind: "rejected",
      code: "narrationRecoveryUnavailable",
    });

    let proposalCalls = 0;
    let narrationCalls = 0;
    const recovered = await handleViewerNarrationRecovery({
      principal: BOB,
      authority,
      kp: {
        async propose() {
          proposalCalls += 1;
          throw new Error("viewer narration recovery must not propose mechanics");
        },
        async narrate(request) {
          narrationCalls += 1;
          expect(request).not.toHaveProperty("audienceId");
          expect(request).toMatchObject({ deliveryGeneration: 2 });
          expect(record(
            record(request.projection, "recovery projection").actorAction,
            "recovery actor action",
          )).toMatchObject({ kind: "observerClaims", actorCharacterId: ALICE_ID });
          return { body: "Bob 只恢复了自己的第一条回复" };
        },
      },
    }, capability);
    expect(recovered).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    expect(proposalCalls).toBe(0);
    expect(narrationCalls).toBe(1);
    expect(currentBody(record(await authority.observe(BOB), "Bob recovered observation")))
      .toBe("Bob 只恢复了自己的第一条回复");
    expect(currentBody(record(await authority.observe(ALICE), "Alice stable observation")))
      .toBe("Alice 已收到 第一条回复");

    const responseLostRetry = await handleViewerNarrationRecovery({
      principal: BOB,
      authority,
      kp: {
        async propose() {
          throw new Error("response-lost retry must not propose");
        },
        async narrate() {
          throw new Error("a persisted publication must not narrate again");
        },
      },
    }, capability);
    expect(responseLostRetry).toMatchObject({
      action: "committed",
      narration: "published",
    });
    expect(narrationCalls).toBe(1);
  });

  it("lets the exact former-character ViewerKey recover a failed retirement narration", async () => {
    const roomId = "viewer-narration-recovery-v3-former-character";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    await expect(authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
        { principalId: CAROL.principal.id, role: "observer" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
    })).resolves.toMatchObject({ created: true });

    const plan = await commitBobRetirement(authority, "former");
    expect(audience(plan, BOB_ID)).toMatchObject({
      principalId: BOB.principal.id,
      seatId: `seat:${BOB.principal.id}`,
      characterId: BOB_ID,
    });
    await failBobAudience(authority, plan);
    await evictDurableObject(authority as never);

    const observation = record(await authority.observe(BOB), "former-character observation");
    expect(record(observation.readModel, "former-character read model")).toMatchObject({
      controlledCharacter: null,
      lifecycle: {
        kind: "successorRequired",
        defaultPredecessorCharacterId: BOB_ID,
      },
    });
    const recovery = record(observation.narrationRecovery, "former-character recovery");
    expect(recovery).toMatchObject({
      kind: "available",
      state: "retryableFailure",
    });
    const capability = String(recovery.capability);
    await expect(authority.beginViewerNarrationRecovery(CAROL, capability))
      .resolves.toMatchObject({ kind: "rejected", code: "narrationRecoveryUnavailable" });
    await expect(authority.beginViewerNarrationRecovery({
      principal: { id: BOB.principal.id, sessionVersion: 2 },
    }, capability)).resolves.toMatchObject({
      kind: "rejected",
      code: "narrationRecoveryUnavailable",
    });

    let proposalCalls = 0;
    const failedRecovery = await handleViewerNarrationRecovery({
      principal: BOB,
      authority,
      kp: {
        async propose() {
          proposalCalls += 1;
          throw new Error("former-character recovery must not propose mechanics");
        },
        async narrate(request) {
          expect(record(
            record(request.projection, "former recovery projection").actorAction,
            "former recovery actor action",
          )).toMatchObject({
            kind: "actorDisplay",
            actorCharacterId: BOB_ID,
            displayBody: "我决定在第 former 幕结束冒险者生涯。",
          });
          throw Object.assign(new Error("narration provider timed out"), {
            publicCode: "NARRATION_PROVIDER_TIMEOUT",
          });
        },
      },
    }, capability);
    expect(failedRecovery).toMatchObject({
      action: "committed",
      narration: "retryableFailure",
    });
    expect(record(
      record(await authority.observe(BOB), "former recovery retry observation")
        .narrationRecovery,
      "former recovery retry",
    )).toMatchObject({ capability, state: "retryableFailure" });

    const recovered = await handleViewerNarrationRecovery({
      principal: BOB,
      authority,
      kp: {
        async propose() {
          proposalCalls += 1;
          throw new Error("former-character recovery must not propose mechanics");
        },
        async narrate() {
          return { body: "博林收起行囊，正式结束了自己的冒险者生涯。" };
        },
      },
    }, capability);
    expect(recovered).toMatchObject({
      action: "committed",
      narration: "published",
    });
    expect(proposalCalls).toBe(0);
    const recoveredObservation = record(
      await authority.observe(BOB),
      "recovered former-character observation",
    );
    expect(currentBody(recoveredObservation))
      .toBe("博林收起行囊，正式结束了自己的冒险者生涯。");
    expect(recoveredObservation).not.toHaveProperty("narrationRecovery");
  });

  it("does not transfer a former-character recovery to a successor on the same seat", async () => {
    const roomId = "viewer-narration-recovery-v3-successor";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
    }), "successor room initialization");
    const administration = record(
      initialized.serviceCapabilities,
      "successor service capabilities",
    ).roomAdministration;
    const plan = await commitBobRetirement(authority, "successor");
    await failBobAudience(authority, plan);
    const before = record(await authority.observe(BOB), "former viewer before successor");
    const capability = String(record(
      before.narrationRecovery,
      "former recovery before successor",
    ).capability);
    const begun = record(
      await authority.beginViewerNarrationRecovery(BOB, capability),
      "former recovery begun before successor",
    );
    expect(begun.kind).toBe("pending");

    await expect(authority.applyRoomAdministration(administration, {
      commandId: "room-admin:viewer-recovery:introduce-successor",
      kind: "introduceSuccessor",
      principalId: BOB.principal.id,
      predecessorCharacterId: BOB_ID,
      character: character(BOB_SUCCESSOR_ID, BOB.principal.id, "博林的继任者"),
      worldEntry: "在博林退役后，以独立身份来到院子接过冒险席位。",
    })).resolves.toMatchObject({ kind: "committed" });

    const successorObservation = record(
      await authority.observe(BOB),
      "successor observation",
    );
    expect(record(successorObservation.readModel, "successor read model")).toMatchObject({
      controlledCharacter: { characterId: BOB_SUCCESSOR_ID },
    });
    expect(successorObservation).not.toHaveProperty("narrationRecovery");
    await expect(authority.beginViewerNarrationRecovery(BOB, capability))
      .resolves.toMatchObject({ kind: "rejected", code: "narrationRecoveryUnavailable" });
    await expect(authority.publishViewerNarrationRecovery(BOB, capability, {
      body: "继任者不得发布前任角色的冻结回复。",
      deliveryGeneration: begun.deliveryGeneration,
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "narrationRecoveryUnavailable",
    });
    await expect(authority.failViewerNarrationRecovery(BOB, capability, {
      deliveryGeneration: begun.deliveryGeneration,
      errorCode: "NARRATION_PROVIDER_TIMEOUT",
      state: "retryableFailure",
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "narrationRecoveryUnavailable",
    });
  });

  it("keeps a transferred character's unfinished recovery with the old ViewerKey", async () => {
    const roomId = "viewer-narration-recovery-v3-control-transfer";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
        { principalId: CAROL.principal.id, role: "player" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
      fixtureFacts: [{
        factRef: SHARED_YARD_BASIS,
        kind: "establishedCommunicationChannel",
        participants: [ALICE_ID, BOB_ID],
      }],
    }), "control-transfer room initialization");
    const administration = record(
      initialized.serviceCapabilities,
      "service capabilities",
    ).roomAdministration;
    const priorPlan = await commitVisibleChange(authority, "transfer-prior");
    await publishAudience(authority, priorPlan, ALICE_ID, "Alice 的转移前回复");
    await publishAudience(authority, priorPlan, BOB_ID, "Bob 的转移前既有回复");
    const plan = await commitVisibleChange(authority, "transfer");
    await publishAliceFailBob(authority, plan, "待转移回复");
    const before = record(await authority.observe(BOB), "Bob before transfer");
    const capability = String(record(before.narrationRecovery, "Bob recovery before transfer").capability);

    await expect(authority.applyRoomAdministration(administration, {
      commandId: "room-admin:viewer-recovery:transfer",
      kind: "transferControl",
      characterId: BOB_ID,
      fromSeatId: `seat:${BOB.principal.id}`,
      toSeatId: `seat:${CAROL.principal.id}`,
    })).resolves.toMatchObject({ kind: "committed" });
    await evictDurableObject(authority as never);
    const formerController = record(
      await authority.observe(BOB),
      "former controller recovery-only observation",
    );
    expect(formerController.readModel).toBeNull();
    expect(currentBody(formerController)).toBe("Bob 的转移前既有回复");
    expect(formerController.narrationRecovery).toEqual({
      kind: "available",
      capability,
      state: "retryableFailure",
    });
    const formerProjected = projectAuthoritativeTableObservation({
      userId: BOB.principal.id,
      members: [ALICE.principal.id, BOB.principal.id, CAROL.principal.id],
      locationLabels: { yard: "院子" },
      observation: formerController,
    });
    expect(formerProjected).toMatchObject({
      controlledCharacter: null,
      narrationRecovery: {
        kind: "available",
        capability,
        state: "retryableFailure",
      },
      places: {},
      placeNames: {},
      messages: [expect.objectContaining({ body: "Bob 的转移前既有回复" })],
    });
    expect(formerProjected).not.toHaveProperty("lifecycle");
    expect(formerProjected.stateVersion).toBeUndefined();
    expect(formerProjected.projectionHash).toBeUndefined();
    await expect(authority.beginViewerNarrationRecovery(CAROL, capability))
      .resolves.toMatchObject({ kind: "rejected", code: "narrationRecoveryUnavailable" });
    const newController = record(await authority.observe(CAROL), "new controller observation");
    expect(newController).not.toHaveProperty("narrationRecovery");

    let proposalCalls = 0;
    await expect(handleViewerNarrationRecovery({
      principal: BOB,
      authority,
      kp: {
        async propose() {
          proposalCalls += 1;
          throw new Error("former controller recovery must not propose mechanics");
        },
        async narrate(request) {
          expect(record(
            record(request.projection, "former controller projection").actorAction,
            "former controller actor action",
          )).toMatchObject({ kind: "observerClaims", actorCharacterId: ALICE_ID });
          return { body: "这条回复只送回博林原来的 ViewerKey。" };
        },
      },
    }, capability)).resolves.toMatchObject({
      action: "committed",
      narration: "published",
    });
    expect(proposalCalls).toBe(0);
    expect(record(
      record(await authority.observe(CAROL), "new controller stable view").delivery,
      "new controller delivery",
    )).toEqual({ kind: "none" });
  });
});
