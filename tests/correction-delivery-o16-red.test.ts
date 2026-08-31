import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { noncombatCheckProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

type CorrectionDeliveryAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  commitCorrection(capability: unknown, request: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:o16:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:o16:bob", sessionVersion: 1 }),
});
const CAROL = Object.freeze({
  principal: Object.freeze({ id: "principal:o16:carol", sessionVersion: 1 }),
});

const ALICE_CHARACTER = "character:o16:alice";
const BOB_CHARACTER = "character:o16:bob";
const CAROL_CHARACTER = "character:o16:carol";
const WRONG_BRANCH_SECRET = "错误分支的秘密依据：银钥匙藏在钟罩下";
const EXPERIENCED_OLD_BODY = "O16_OLD_BODY_MUST_REMAIN_VIEWER_SCOPED";
const REPLACEMENT_BODY = "O16_REPLACEMENT_BODY";

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

function character(characterId: string, controllerPrincipalId: string, sceneId: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name: characterId,
      sceneId,
      abilityScores: { str: 14, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics"],
      resources: { resolve: 1 },
    },
  };
}

function observationReadModel(value: unknown, label: string): JsonRecord {
  return record(record(value, label).readModel, `${label} read model`);
}

function projectedReceipt(readModel: JsonRecord, receiptId: string): JsonRecord {
  const match = list(readModel.receipts, "projected receipts")
    .map((entry) => record(entry, "projected receipt"))
    .find((entry) => entry.receiptId === receiptId);
  expect(match, `receipt ${receiptId} must remain auditable`).toBeDefined();
  return match!;
}

describe("SPEC 0010 O16 correction replacement delivery", () => {
  it("invalidates the old slot and Receipt atomically, then freezes and publishes a secret-safe frame for the new active branch", async () => {
    const roomId = "room:o16:correction-replacement-delivery";
    const authority = env.ROOMS.getByName(roomId) as unknown as CorrectionDeliveryAuthority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
        { principalId: CAROL.principal.id, role: "player" },
      ],
      characters: [
        character(ALICE_CHARACTER, ALICE.principal.id, "archive"),
        character(BOB_CHARACTER, BOB.principal.id, "archive"),
        character(CAROL_CHARACTER, CAROL.principal.id, "yard"),
      ],
    }), "authoritative initialization");
    expect(initialized.created).toBe(true);
    const correctionCapability = record(
      initialized.serviceCapabilities,
      "service capabilities",
    ).correction;
    expect(correctionCapability).toBeDefined();

    const original = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        propose: async (request: JsonRecord) => noncombatCheckProposal(
          String(request.rootActionId),
          {
            proposalAttemptId: "proposal:o16:wrong-branch:1",
            goal: "撞开内门并确认钟罩下的痕迹",
            method: "用肩膀撞开内门，进入密室检查钟罩",
            dc: 1,
            duration: { unit: "second", value: 1 },
            dynamicMaterializations: [{
              kind: "location",
              factRef: "fact:o16:secret-vault",
              causalBasisRefs: [],
              visibilityPolicyRef: "visibility:room-authority-only",
              definition: { sceneId: "vault", name: "密室" },
            }],
            success: [
              { kind: "moveEntity", sceneRef: "vault" },
              { kind: "changeResource", resourceRef: "resolve", amount: -1 },
              {
                kind: "acquireKnowledge",
                knowledgeRef: "knowledge:o16:wrong-branch-secret",
                value: WRONG_BRANCH_SECRET,
                definitionRef: "fact:o16:secret-vault",
              },
            ],
            failure: [],
          },
        ),
        narrate: async (request: JsonRecord) => ({
          text: `${EXPERIENCED_OLD_BODY}:${String(request.audienceId)}`,
          agencyClaims: [],
        }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:o16:wrong-branch:1",
      text: "我撞开内门，进入密室检查钟罩。",
    }), "original Room Action outcome");
    expect(original.kind, JSON.stringify(original)).toBe("committed");
    const originalReceipt = record(original.receipt, "original Receipt");
    const originalReceiptId = String(originalReceipt.receiptId);
    const originalBranchId = String(originalReceipt.activeBranchId);

    const beforeAlice = record(await authority.observe(ALICE), "Alice before correction");
    const beforeBob = record(await authority.observe(BOB), "Bob before correction");
    const beforeCarol = record(await authority.observe(CAROL), "Carol before correction");
    expect(JSON.stringify(beforeAlice.delivery)).toContain(EXPERIENCED_OLD_BODY);
    expect(JSON.stringify(beforeBob.delivery)).toContain(EXPERIENCED_OLD_BODY);
    expect(beforeCarol.delivery).toEqual({ kind: "none" });
    expect(JSON.stringify(beforeAlice.readModel)).toContain(WRONG_BRANCH_SECRET);
    expect(JSON.stringify(beforeBob)).not.toContain(WRONG_BRANCH_SECRET);
    expect(JSON.stringify(beforeCarol)).not.toContain(WRONG_BRANCH_SECRET);

    const correctionId = "correction:o16:wrong-branch:1";
    const corrected = record(await authority.commitCorrection(
      correctionCapability,
      {
        correctionId,
        receiptId: originalReceiptId,
        errorKind: "rulesMisapplication",
        explanation: "该检定采用了错误规则，且已经改变位置、资源与私人知识。",
      },
    ), "causal correction outcome");
    expect(corrected).toMatchObject({
      kind: "committed",
      correctionId,
      strategy: "causalBranch",
      activeBranchId: expect.any(String),
      receipt: {
        receiptId: expect.any(String),
        status: "committed",
      },
    });
    expect(corrected.activeBranchId).not.toBe(originalBranchId);

    // The correction commit itself is the atomic boundary: no replacement
    // narration has been generated yet. The invalid branch can no longer be
    // observed as current truth, while narration already experienced by each
    // frozen viewer remains in that viewer's transcript.
    const invalidatedAlice = record(await authority.observe(ALICE), "Alice after correction commit");
    const invalidatedBob = record(await authority.observe(BOB), "Bob after correction commit");
    const invalidatedCarol = record(await authority.observe(CAROL), "Carol after correction commit");
    for (const observation of [invalidatedAlice, invalidatedBob, invalidatedCarol]) {
      expect(observation.delivery).toEqual({ kind: "none" });
      expect(JSON.stringify(observation)).not.toContain(WRONG_BRANCH_SECRET);
    }
    expect(JSON.stringify(invalidatedAlice.transcript)).toContain(EXPERIENCED_OLD_BODY);
    expect(JSON.stringify(invalidatedBob.transcript)).toContain(EXPERIENCED_OLD_BODY);
    expect(JSON.stringify(invalidatedCarol.transcript)).not.toContain(EXPERIENCED_OLD_BODY);
    const correctedAliceReadModel = observationReadModel(
      invalidatedAlice,
      "Alice after correction commit",
    );
    expect(projectedReceipt(correctedAliceReadModel, originalReceiptId).status)
      .toBe("superseded");
    expect(correctedAliceReadModel.activeBranchId).toBe(corrected.activeBranchId);

    // RED: commitCorrection currently stops after invalidating the old branch.
    // O16 requires this same commit to freeze the replacement publication
    // binding, so Room Action can narrate outside the transaction without
    // recomputing Audience or visibility.
    const replacementPlan = record(
      corrected.deliveryPlan,
      "replacement DeliveryPlan frozen by correction commit",
    );
    expect(replacementPlan).toMatchObject({
      publishCapability: expect.any(String),
      rootActionId: record(corrected.receipt, "correction Receipt").rootActionId,
      receiptId: record(corrected.receipt, "correction Receipt").receiptId,
      activeBranchId: corrected.activeBranchId,
      eventRange: expect.any(Object),
      audiences: expect.any(Array),
    });
    const replacementAudiences = list(
      replacementPlan.audiences,
      "replacement audiences",
    ).map((entry) => record(entry, "replacement audience"));
    expect(replacementAudiences.map((entry) => entry.characterId).sort()).toEqual([
      ALICE_CHARACTER,
      BOB_CHARACTER,
    ]);
    for (const audience of replacementAudiences) {
      const kpProjection = record(audience.kpProjection, "replacement KP projection");
      expect(kpProjection.activeBranchId)
        .toBe(corrected.activeBranchId);
      expect(JSON.stringify(kpProjection)).not.toContain(WRONG_BRANCH_SECRET);
      expect(JSON.stringify(kpProjection.experiencedTranscript))
        .toContain(EXPERIENCED_OLD_BODY);
      const otherCharacterId = audience.characterId === ALICE_CHARACTER
        ? BOB_CHARACTER
        : ALICE_CHARACTER;
      expect(JSON.stringify(kpProjection.experiencedTranscript))
        .not.toContain(otherCharacterId);
      const currentProjection = { ...kpProjection };
      delete currentProjection.experiencedTranscript;
      expect(JSON.stringify(currentProjection)).not.toContain(EXPERIENCED_OLD_BODY);
    }

    const replacementFrames = replacementAudiences.map((audience) => ({
      audienceId: audience.audienceId,
      narration: {
        text: `${REPLACEMENT_BODY}:${String(audience.characterId)}`,
        agencyClaims: [],
      },
    }));
    await expect(authority.publishDelivery(
      { publishCapability: replacementPlan.publishCapability },
      { frames: replacementFrames },
    )).resolves.toMatchObject({ kind: "published" });

    const afterAlice = record(await authority.observe(ALICE), "Alice replacement delivery");
    const afterBob = record(await authority.observe(BOB), "Bob replacement delivery");
    const afterCarol = record(await authority.observe(CAROL), "Carol after replacement delivery");
    expect(afterAlice.delivery).toMatchObject({
      kind: "current",
      frame: {
        activeBranchId: corrected.activeBranchId,
        text: `${REPLACEMENT_BODY}:${ALICE_CHARACTER}`,
      },
    });
    expect(afterBob.delivery).toMatchObject({
      kind: "current",
      frame: {
        activeBranchId: corrected.activeBranchId,
        text: `${REPLACEMENT_BODY}:${BOB_CHARACTER}`,
      },
    });
    expect(afterCarol.delivery).toEqual({ kind: "none" });
    for (const observation of [afterAlice, afterBob, afterCarol]) {
      expect(JSON.stringify(observation)).not.toContain(WRONG_BRANCH_SECRET);
    }
    expect(JSON.stringify(afterAlice.transcript)).toContain(EXPERIENCED_OLD_BODY);
    expect(JSON.stringify(afterBob.transcript)).toContain(EXPERIENCED_OLD_BODY);
    expect(JSON.stringify(afterCarol.transcript)).not.toContain(EXPERIENCED_OLD_BODY);

    for (const [viewer, observation, characterId] of [
      [ALICE, afterAlice, ALICE_CHARACTER],
      [BOB, afterBob, BOB_CHARACTER],
    ] as const) {
      const frame = record(record(observation.delivery, "replacement delivery").frame, "replacement frame");
      await expect(authority.acknowledge(viewer, String(frame.deliveryId)))
        .resolves.toMatchObject({ kind: "acknowledged", deliveryId: frame.deliveryId });
      const acknowledged = record(await authority.observe(viewer), "acknowledged correction view");
      expect(acknowledged.delivery).toEqual({ kind: "none" });
      const kpBodies = list(acknowledged.transcript, "acknowledged transcript")
        .map((entry) => record(entry, "acknowledged transcript entry"))
        .filter((entry) => entry.kind === "kp")
        .map((entry) => String(entry.body));
      expect(kpBodies).toHaveLength(2);
      expect(kpBodies[0]).toContain(EXPERIENCED_OLD_BODY);
      expect(kpBodies[1]).toBe(`${REPLACEMENT_BODY}:${characterId}`);
    }
  });
});
