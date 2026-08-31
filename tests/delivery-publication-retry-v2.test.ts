import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import {
  observationProposal,
  privateFormProposal,
} from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:delivery-retry:alice", sessionVersion: 1 }),
});

const LOST_RESPONSE_BODY = "发布已经落盘，但这一响应在返回 Worker 前丢失。";
const SUPERSEDED_BODY = "这段旧回应在生成前已经被更新回应取代。";
const CURRENT_BODY = "更新回应已经成为这个观察者唯一的当前帧。";

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  deliveryPublicationStatus(query: { publishCapability: unknown }): Promise<unknown>;
  beginDeliveryAudiencePublication(query: {
    publishCapability: unknown;
    audienceId: string;
  }): Promise<unknown>;
  failDeliveryAudiencePublication(capability: unknown, failure: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function room(name: string): Authority {
  return env.ROOMS.getByName(name) as unknown as Authority;
}

async function initialized(name: string) {
  const authority = room(name);
  const initialized = record(await authority.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{
      characterId: "character:delivery-retry:alice",
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "wake",
        abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
        proficiencyBonus: 2,
        proficientSkills: ["athletics"],
        resources: { resolve: 2 },
      },
    }],
  }), "room initialization");
  expect(initialized).toMatchObject({ created: true });
  return { authority };
}

function deliveryPlan(value: unknown): JsonRecord {
  return record(record(value, "commit result").deliveryPlan, "delivery plan");
}

function currentFrame(observation: unknown) {
  const delivery = record(record(observation, "observation").delivery, "delivery");
  expect(delivery.kind).toBe("current");
  return record(delivery.frame, "current delivery frame");
}

describe("delivery publication recovery", () => {
  it("recognizes a persisted publication after response loss without repeating narration", async () => {
    const roomId = "delivery-publication-retry-v2-response-loss";
    const { authority } = await initialized(roomId);
    let publicationCalls = 0;
    let publicationStatusCalls = 0;
    let loseFirstPublicationResponse = true;
    const responseLosingAuthority: Authority = {
      initializeAuthoritative: (input) => authority.initializeAuthoritative(input),
      prepare: (context, input) => authority.prepare(context, input),
      commit: (context, preparedActionId, proposal) =>
        authority.commit(context, preparedActionId, proposal),
      observe: (context, query) => authority.observe(context, query),
      acknowledge: (context, deliveryId) => authority.acknowledge(context, deliveryId),
      exportAuthoritativeArchive: (capability) => authority.exportAuthoritativeArchive(capability),
      async deliveryPublicationStatus(query) {
        publicationStatusCalls += 1;
        return authority.deliveryPublicationStatus(query);
      },
      beginDeliveryAudiencePublication: (query) =>
        authority.beginDeliveryAudiencePublication(query),
      failDeliveryAudiencePublication: (capability, failure) =>
        authority.failDeliveryAudiencePublication(capability, failure),
      async publishDelivery(capability, publication) {
        publicationCalls += 1;
        const published = await authority.publishDelivery(capability, publication);
        if (loseFirstPublicationResponse) {
          loseFirstPublicationResponse = false;
          throw new Error("simulated response loss after atomic publication");
        }
        return published;
      },
    };
    const intent = {
      kind: "intent" as const,
      submissionId: "submission:delivery-retry:response-loss",
      text: "我用肩膀撞开档案室里卡住的木门。",
    };
    let proposeCalls = 0;
    let narrationCalls = 0;
    const kp = {
      async propose(request: JsonRecord) {
        proposeCalls += 1;
        return privateFormProposal(String(request.rootActionId), "observe.v1", {
          goal: "撞开卡住的木门",
          method: "用肩膀撞门",
          focus: "档案室里卡住的木门",
          desiredInformation: "木门是否能被肩撞打开",
          resolution: "check",
          ability: "str",
          skill: "athletics",
          dc: 12,
          mode: "normal",
          durationUnit: "second",
          durationValue: 1,
          risk: "撞门可能成功，也可能只制造声响。",
          successConsequence: "木门被撞开。",
          failureConsequence: "门没有打开，撞击声传了出去。",
        }, "proposal:delivery-retry:response-loss");
      },
      async narrate() {
        narrationCalls += 1;
        return { body: LOST_RESPONSE_BODY };
      },
    };

    const first = record(await handleRoomAction({
      principal: ALICE,
      authority: responseLosingAuthority,
      kp,
    }, intent), "first response-lost outcome");
    expect(first).toMatchObject({ kind: "committed", narration: "published" });
    expect(proposeCalls).toBe(1);
    expect(narrationCalls).toBe(1);
    expect(publicationCalls).toBe(1);
    expect(publicationStatusCalls).toBe(1);
    const firstFrame = currentFrame(await authority.observe(ALICE));
    expect(firstFrame.text).toBe(LOST_RESPONSE_BODY);
  });

  it("does not narrate or leak a plan that a newer current response superseded before narration", async () => {
    const roomId = "delivery-publication-retry-v2-superseded-before-narration";
    const { authority } = await initialized(roomId);
    let publicationStatusCalls = 0;
    let oldNarrationCalls = 0;
    let injectNewerResponse = true;
    let newerPublicationResult: unknown;
    const supersedingAuthority: Authority = {
      initializeAuthoritative: (input) => authority.initializeAuthoritative(input),
      prepare: (context, input) => authority.prepare(context, input),
      observe: (context, query) => authority.observe(context, query),
      acknowledge: (context, deliveryId) => authority.acknowledge(context, deliveryId),
      publishDelivery: (capability, publication) => authority.publishDelivery(capability, publication),
      exportAuthoritativeArchive: (capability) => authority.exportAuthoritativeArchive(capability),
      beginDeliveryAudiencePublication: (query) =>
        authority.beginDeliveryAudiencePublication(query),
      failDeliveryAudiencePublication: (capability, failure) =>
        authority.failDeliveryAudiencePublication(capability, failure),
      async deliveryPublicationStatus(query) {
        publicationStatusCalls += 1;
        return authority.deliveryPublicationStatus(query);
      },
      async commit(context, preparedActionId, proposal) {
        const committed = await authority.commit(context, preparedActionId, proposal);
        if (!injectNewerResponse) return committed;
        injectNewerResponse = false;

        const newerPrepared = record(await authority.prepare(ALICE, {
          kind: "intent",
          submissionId: "submission:delivery-retry:newer-response",
          text: "我停下来确认眼前最新发生的变化。",
        }), "newer prepared action");
        const newerCommitted = await authority.commit(
          ALICE,
          String(newerPrepared.preparedActionId),
          observationProposal(String(newerPrepared.rootActionId), {
            proposalAttemptId: "proposal:delivery-retry:newer-response",
            goal: "确认最新变化",
            method: "停下来观察",
            duration: { unit: "second", value: 1 },
          }),
        );
        const newerPlan = deliveryPlan(newerCommitted);
        const newerFrames = [];
        for (const entry of list(newerPlan.audiences, "delivery audiences")) {
          const audienceId = String(record(entry, "delivery audience").audienceId);
          const begun = record(await authority.beginDeliveryAudiencePublication({
            publishCapability: newerPlan.publishCapability,
            audienceId,
          }), "begun newer publication");
          newerFrames.push({
            audienceId,
            deliveryGeneration: begun.deliveryGeneration,
            narration: { body: CURRENT_BODY },
          });
        }
        newerPublicationResult = await authority.publishDelivery(
          { publishCapability: newerPlan.publishCapability },
          { frames: newerFrames },
        );
        return committed;
      },
    };
    const intent = {
      kind: "intent" as const,
      submissionId: "submission:delivery-retry:superseded-response",
      text: "我观察档案柜里刚刚露出的痕迹。",
    };
    const outcome = record(await handleRoomAction({
      principal: ALICE,
      authority: supersedingAuthority,
      kp: {
        async propose(request: JsonRecord) {
          return observationProposal(String(request.rootActionId), {
            proposalAttemptId: "proposal:delivery-retry:superseded-response",
            goal: "观察档案柜痕迹",
            method: "仔细观察",
            duration: { unit: "second", value: 1 },
          });
        },
        async narrate() {
          oldNarrationCalls += 1;
          return { body: SUPERSEDED_BODY };
        },
      },
    }, intent), "superseded action outcome");
    expect(outcome.kind).toBe("committed");
    const newerPublication = record(newerPublicationResult, "newer publication result");
    expect(newerPublication.kind, JSON.stringify(newerPublication)).toBe("published");
    expect(oldNarrationCalls).toBe(0);
    expect(publicationStatusCalls).toBeGreaterThanOrEqual(1);

    const beforeRetryFrame = currentFrame(await authority.observe(ALICE));
    expect(beforeRetryFrame.text).toBe(CURRENT_BODY);
    expect(JSON.stringify(await authority.observe(ALICE))).not.toContain(SUPERSEDED_BODY);

    publicationStatusCalls = 0;
    const receipt = record(outcome.receipt, "superseded action receipt");
    const retried = record(await handleRoomAction({
      principal: ALICE,
      authority: supersedingAuthority,
      kp: {
        async propose() {
          throw new Error("superseded retry must not propose again");
        },
        async narrate() {
          oldNarrationCalls += 1;
          throw new Error("superseded retry must not narrate again");
        },
      },
    }, {
      kind: "retry",
      submissionId: intent.submissionId,
      rootActionId: String(receipt.rootActionId),
    }), "superseded retry outcome");

    expect(retried.kind).toBe("rejected");
    expect(publicationStatusCalls).toBe(0);
    expect(oldNarrationCalls).toBe(0);
    expect(currentFrame(await authority.observe(ALICE))).toEqual(beforeRetryFrame);
    expect(JSON.stringify(await authority.observe(ALICE))).not.toContain(SUPERSEDED_BODY);
  });
});
