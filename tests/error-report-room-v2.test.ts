import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  handleRoomAction,
  handleRoomCorrection,
  type RoomActionInput,
} from "../app/_runtime/lib/room/action";
import { observationProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

type RoomAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus(query: { publishCapability: unknown }): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  commitCorrection(capability: unknown, request: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:error-report:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:error-report:bob", sessionVersion: 1 }),
});

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

function authority(name: string): RoomAuthority {
  return env.ROOMS.getByName(name) as unknown as RoomAuthority;
}

function character(characterId: string, controllerPrincipalId: string, sceneId: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name: characterId,
      sceneId,
      abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics"],
    },
  };
}

async function commitVisibleAction(
  stub: RoomAuthority,
  principal: unknown,
  submissionId: string,
): Promise<JsonRecord> {
  const prepared = record(await stub.prepare(principal, {
    kind: "intent",
    submissionId,
    text: "我仔细确认眼前的环境，然后继续。",
  }), `${submissionId} prepare`);
  expect(prepared.kind).toBe("prepared");
  const committed = record(await stub.commit(
    principal,
    String(prepared.preparedActionId),
    observationProposal(String(prepared.rootActionId), {
      proposalAttemptId: `proposal:${submissionId}`,
      goal: "确认当前环境",
      method: "在自己的位置谨慎观察",
      duration: { unit: "second", value: 1 },
    }),
  ), `${submissionId} commit`);
  expect(committed.kind).toBe("committed");
  return record(committed.receipt, `${submissionId} Receipt`);
}

function errorReport(input: JsonRecord): RoomActionInput {
  return input as unknown as RoomActionInput;
}

describe("SPEC 0011 restricted ErrorReport at the Room responsibility interface", () => {
  it("accepts only a visible Receipt reference, persists idempotency without changing the world, and leaves correction to the service capability", async () => {
    const roomId = "error-report-room-v2-responsibility";
    const stub = authority(roomId);
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [
        { principalId: ALICE.principal.id, role: "player" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character("character:error-report:alice", ALICE.principal.id, "shrine"),
        character("character:error-report:bob", BOB.principal.id, "yard"),
      ],
    }), "initialization");
    const correctionCapability = record(
      initialized.serviceCapabilities,
      "service capabilities",
    ).correction;

    const aliceReceipt = await commitVisibleAction(
      stub,
      ALICE,
      "submission:error-report:alice-source",
    );
    const bobReceipt = await commitVisibleAction(
      stub,
      BOB,
      "submission:error-report:bob-private-source",
    );
    const before = record(await stub.observe(ALICE), "Alice observation before report");
    const beforeRead = record(before.readModel, "Alice read model before report");
    expect(list(beforeRead.receipts, "Alice visible Receipts"))
      .toContainEqual(expect.objectContaining({ receiptId: aliceReceipt.receiptId }));
    expect(JSON.stringify(beforeRead)).not.toContain(String(bobReceipt.receiptId));

    const kpMustNotRun = {
      async propose() {
        throw new Error("ErrorReport must not call the KP proposal adapter");
      },
      async narrate() {
        throw new Error("ErrorReport must not create a Delivery");
      },
    };
    const report = errorReport({
      kind: "errorReport",
      submissionId: "submission:error-report:report-1",
      receiptId: aliceReceipt.receiptId,
      concern: "rules",
      explanation: "这份结果似乎错误地推进了虚构时间，请复核规则。",
    });
    const reported = record(await handleRoomAction({
      principal: ALICE,
      authority: stub,
      kp: kpMustNotRun,
    }, report), "ErrorReport outcome");
    expect(reported).toMatchObject({
      kind: "needsKp",
      code: "correctionRequired",
      receipt: { receiptId: aliceReceipt.receiptId },
    });
    expect(reported).not.toHaveProperty("correctionCapability");
    expect(reported).not.toHaveProperty("state");
    expect(reported).not.toHaveProperty("events");
    expect(reported).not.toHaveProperty("branchGraph");
    expect(JSON.stringify(reported)).not.toContain("错误地推进了虚构时间");

    const after = record(await stub.observe(ALICE), "Alice observation after report");
    expect(after.readModel).toEqual(before.readModel);
    expect(after.delivery).toEqual(before.delivery);

    const reacquired = authority(roomId);
    await expect(handleRoomAction({
      principal: ALICE,
      authority: reacquired,
      kp: kpMustNotRun,
    }, structuredClone(report))).resolves.toEqual(reported);
    await expect(handleRoomAction({
      principal: ALICE,
      authority: reacquired,
      kp: kpMustNotRun,
    }, errorReport({
      ...report,
      explanation: "同一个 submissionId 被换成另一份说明。",
    }))).resolves.toMatchObject({
      kind: "rejected",
      code: "idempotencyPayloadMismatch",
    });

    const privateReference = record(await handleRoomAction({
      principal: ALICE,
      authority: reacquired,
      kp: kpMustNotRun,
    }, errorReport({
      kind: "errorReport",
      submissionId: "submission:error-report:private-ref",
      receiptId: bobReceipt.receiptId,
      concern: "facts",
      explanation: "请复核这份我无权查看的对象。",
    })), "private Receipt report rejection");
    const unknownReference = record(await handleRoomAction({
      principal: ALICE,
      authority: reacquired,
      kp: kpMustNotRun,
    }, errorReport({
      kind: "errorReport",
      submissionId: "submission:error-report:unknown-ref",
      receiptId: "receipt:does-not-exist",
      concern: "facts",
      explanation: "请复核不存在的对象。",
    })), "unknown Receipt report rejection");
    expect(privateReference).toEqual({
      kind: "rejected",
      code: "referenceUnavailable",
      explanation: "该对象当前不可用。",
      action: "notCommitted",
      narration: "notApplicable",
    });
    expect(unknownReference).toEqual(privateReference);
    expect(JSON.stringify(privateReference)).not.toContain(String(bobReceipt.receiptId));

    await expect(handleRoomAction({
      principal: ALICE,
      authority: reacquired,
      kp: kpMustNotRun,
    }, errorReport({
      ...report,
      submissionId: "submission:error-report:forged-patch",
      statePatch: { fictionTime: "rewritten" },
      events: [{ eventType: "BranchActivated" }],
      mechanicOps: [{ kind: "spendResource" }],
      branchGraph: { active: "forged" },
      correctionCapability,
    }))).resolves.toMatchObject({ kind: "rejected", code: "validation" });

    await expect(reacquired.commitCorrection(ALICE, {
      correctionId: "correction:error-report:unauthorized",
      receiptId: aliceReceipt.receiptId,
      errorKind: "rulesMisapplication",
      explanation: "玩家不能直接执行更正。",
    })).resolves.toMatchObject({ kind: "rejected", code: "correctionUnauthorized" });

    const corrected = record(await handleRoomCorrection({
      authority: reacquired,
      kp: {
        async narrate() {
          return { body: "更正已由可信服务提交。" };
        },
      },
    }, correctionCapability, {
      correctionId: "correction:error-report:service",
      receiptId: aliceReceipt.receiptId,
      errorKind: "rulesMisapplication",
      explanation: "该行动不应推进虚构时间，现保留旧历史并授权更正。",
    }), "trusted correction outcome");
    expect(corrected).toMatchObject({
      kind: "committed",
      correctionId: "correction:error-report:service",
      receipt: { status: "committed" },
    });
  });
});
