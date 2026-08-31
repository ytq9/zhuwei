import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  handleRoomAction,
  handleRoomCorrection,
} from "../app/_runtime/lib/room/action";
import { privateFormProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:correction-retry:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:correction-retry:bob", sessionVersion: 1 }),
});

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  commitCorrection(capability: unknown, request: unknown): Promise<unknown>;
  deliveryPublicationStatus(query: { publishCapability: unknown }): Promise<unknown>;
  beginDeliveryAudiencePublication(query: {
    publishCapability: unknown;
    audienceId: string;
  }): Promise<unknown>;
  failDeliveryAudiencePublication(capability: unknown, failure: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
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

function character(characterId: string, principalId: string) {
  return {
    characterId,
    controllerPrincipalId: principalId,
    staticCard: {
      name: characterId,
      sceneId: "wake",
      abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics"],
      resources: { resolve: 2 },
    },
  };
}

async function eventSnapshot(authority: Authority, archiveExport: unknown) {
  const exported = record(
    await authority.exportAuthoritativeArchive(archiveExport),
    "archive export",
  );
  return list(record(exported.archive, "archive").events, "archive events");
}

describe("O15/O16 correction delivery recovery", () => {
  it("reuses one correction plan across model failure and a published response loss", async () => {
    const roomId = `correction-delivery-retry-v2:${crypto.randomUUID()}`;
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character("character:correction-retry:alice", ALICE.principal.id),
        character("character:correction-retry:bob", BOB.principal.id),
      ],
    }), "initialization");
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");
    for (const [viewer, label] of [[ALICE, "Alice"], [BOB, "Bob"]] as const) {
      const opening = record(
        record(await authority.observe(viewer), `${label} opening observation`).delivery,
        `${label} opening delivery`,
      );
      expect(opening.kind).toBe("current");
      const openingFrame = record(opening.frame, `${label} opening frame`);
      await expect(authority.acknowledge(viewer, String(openingFrame.deliveryId)))
        .resolves.toMatchObject({ kind: "acknowledged", deliveryId: openingFrame.deliveryId });
    }

    const original = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        async propose(request) {
          return privateFormProposal(String(request.rootActionId), "ordinary-check.v1", {
            goal: "强行推开沉重石门",
            method: "肩撞石门",
            intendedOutcome: "沉重石门被推开",
            risk: "错误裁定会消耗一点决心",
            resolution: "check",
            ability: "str",
            skill: "athletics",
            dc: 1,
            mode: "normal",
            durationUnit: "second",
            durationValue: 1,
            successConsequence: "石门被推开。",
            failureConsequence: "石门没有打开，撞击声传了出去。",
            resourceRef: "resolve",
            resourceAmount: 1,
          }, "proposal:correction-retry:wrong-rule");
        },
        async narrate(request) {
          return { body: `旧分支:${String(request.audienceId)}` };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:correction-retry:wrong-rule",
      text: "我用肩膀撞开这扇石门。",
    }), "original outcome");
    expect(original).toMatchObject({
      kind: "committed",
      action: "committed",
      narration: "published",
    });
    const originalDelivery = record(
      record(await authority.observe(ALICE), "Alice original observation").delivery,
      "Alice original delivery",
    );
    expect(record(originalDelivery.frame, "Alice original frame").text)
      .toContain("旧分支:");
    const originalReceipt = record(original.receipt, "original receipt");
    const correctionRequest = {
      correctionId: "correction:delivery-retry:1",
      receiptId: String(originalReceipt.receiptId),
      errorKind: "rulesMisapplication",
      explanation: "这次裁定错误地消耗了角色资源，现以可审计分支恢复。",
    };

    let narrationCalls = 0;
    const modelFailed = record(await handleRoomCorrection({
      authority,
      kp: {
        async narrate() {
          narrationCalls += 1;
          throw new Error("simulated correction narration outage");
        },
      },
    }, capabilities.correction, correctionRequest), "model-failed correction");
    expect(modelFailed).toMatchObject({
      kind: "committed",
      correctionId: correctionRequest.correctionId,
      deliveryPending: true,
    });
    expect(narrationCalls).toBe(2);
    const aliceAfterCorrection = record(
      await authority.observe(ALICE),
      "Alice after correction",
    );
    expect(aliceAfterCorrection.delivery).toEqual({ kind: "none" });
    expect(JSON.stringify(aliceAfterCorrection.transcript)).toContain("旧分支:");
    const eventsAfterCorrection = await eventSnapshot(authority, capabilities.archiveExport);

    let publicationCalls = 0;
    let losePublishedResponse = true;
    const responseLosingAuthority = {
      commitCorrection: (capability: unknown, request: unknown) =>
        authority.commitCorrection(capability, request),
      deliveryPublicationStatus: (query: { publishCapability: unknown }) =>
        authority.deliveryPublicationStatus(query),
      beginDeliveryAudiencePublication: (query: {
        publishCapability: unknown;
        audienceId: string;
      }) => authority.beginDeliveryAudiencePublication(query),
      failDeliveryAudiencePublication: (capability: unknown, failure: unknown) =>
        authority.failDeliveryAudiencePublication(capability, failure),
      async publishDelivery(capability: unknown, publication: unknown) {
        publicationCalls += 1;
        const published = await authority.publishDelivery(capability, publication);
        if (losePublishedResponse) {
          losePublishedResponse = false;
          throw new Error("simulated response loss after correction publication");
        }
        return published;
      },
    };
    const responseLost = record(await handleRoomCorrection({
      authority: responseLosingAuthority,
      kp: {
        async narrate(request) {
          narrationCalls += 1;
          return {
            body: `更正后:${String(request.audienceId)}`,
          };
        },
      },
    }, capabilities.correction, correctionRequest), "response-lost correction retry");
    expect(responseLost).toMatchObject({ kind: "committed", deliveryPending: true });
    expect(publicationCalls).toBe(2);
    expect(narrationCalls).toBe(4);
    const aliceFrame = record(
      record(record(await authority.observe(ALICE), "Alice published correction").delivery, "delivery").frame,
      "Alice correction frame",
    );

    const recovered = record(await handleRoomCorrection({
      authority: responseLosingAuthority,
      kp: {
        async narrate() {
          throw new Error("published correction must not narrate again");
        },
      },
    }, capabilities.correction, correctionRequest), "published correction recovery");
    expect(recovered.kind).toBe("committed");
    expect(recovered).not.toHaveProperty("deliveryPending");
    expect(publicationCalls).toBe(2);
    expect(narrationCalls).toBe(4);
    expect(record(
      record(record(await authority.observe(ALICE), "Alice recovered correction").delivery, "delivery").frame,
      "recovered frame",
    )).toEqual(aliceFrame);
    expect(await eventSnapshot(authority, capabilities.archiveExport))
      .toEqual(eventsAfterCorrection);
  });
});
