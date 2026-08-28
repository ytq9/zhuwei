import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  directConsequencesProposal,
  noncombatCheckProposal,
} from "./helpers/authoritative-proposal";

const AUTHORITATIVE_RULESET_ID = "dnd5e-2014-srd5.1-authoritative-v2";
const AUTHORITATIVE_MANIFEST_ID = "runtime-srd51-2014-authoritative-v2";

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:bob", sessionVersion: 1 }),
});
const MALLORY = Object.freeze({
  principal: Object.freeze({ id: "principal:mallory", sessionVersion: 1 }),
});

type JsonRecord = Record<string, unknown>;

type AuthorityStub = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(authenticatedContext: unknown, actionInput: unknown): Promise<unknown>;
  commit(
    authenticatedContext: unknown,
    preparedActionId: string,
    mechanicalProposal: unknown,
  ): Promise<unknown>;
  observe(authenticatedContext: unknown): Promise<unknown>;
  acknowledge(authenticatedContext: unknown, deliveryId: string): Promise<unknown>;
  commitCorrection(correctionCapability: unknown, request: unknown): Promise<unknown>;
};

type PreparedAction = JsonRecord & {
  kind: "prepared";
  preparedActionId: string;
  rootActionId: string;
};

function asRecord(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function asPrepared(value: unknown): PreparedAction {
  const result = asRecord(value, "prepare outcome");
  expect(result).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return result as PreparedAction;
}

function roomStub(name: string): AuthorityStub {
  return env.ROOMS.getByName(name) as unknown as AuthorityStub;
}

function character(
  characterId: string,
  controllerPrincipalId: string,
  sceneId: "shrine" | "yard" = "shrine",
) {
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

async function authoritativeRoom(
  name: string,
  characters = [character("character:alice", ALICE.principal.id)],
) {
  const stub = roomStub(name);
  const principalIds = [...new Set([
    ...characters.map((entry) => entry.controllerPrincipalId),
    MALLORY.principal.id,
  ])];
  const initialized = await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    members: principalIds.map((principalId) => ({ principalId, role: "player" })),
    characters,
  });
  expect(initialized).toMatchObject({ created: true });
  return stub;
}

function intent(
  submissionId: string,
  characterId: string,
  text = "我稳步向前，花一点时间确认周围没有新的危险。",
) {
  return { kind: "intent", submissionId, characterId, text } as const;
}

function directSuccess(prepared: PreparedAction, proposalAttemptId: string) {
  return directConsequencesProposal(prepared.rootActionId, {
    proposalAttemptId,
    goal: "角色完成这项短暂行动",
    method: "谨慎观察并前进",
  });
}

function checkRequired(prepared: PreparedAction) {
  return noncombatCheckProposal(prepared.rootActionId, {
    proposalAttemptId: "proposal:force-door:1",
    goal: "撞开卡住的木门",
    method: "用肩膀撞开木门",
    risk: {
      warning: "门有可能被撞开，失败也会消耗时间并发出声响。",
      successConsequences: ["木门被撞开。"],
      failureConsequences: ["木门没有打开，撞击声传了出去。"],
      retryGate: ["methodChanged", "situationAdvanced"],
    },
  });
}

function receiptOf(outcome: unknown): JsonRecord {
  const result = asRecord(outcome, "commit outcome");
  return asRecord(result.receipt, "public receipt");
}

describe("Room Authority authoritative-v2 public contract", () => {
  it("selects the authoritative-v2 manifest itself and derives character control from the trusted session", async () => {
    const stub = await authoritativeRoom("authority-v2-trusted-control");
    const prepared = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:trusted", "character:alice"),
    ));
    expect(prepared.rootActionId).toEqual(expect.any(String));

    const observed = asRecord(await stub.observe(ALICE), "observation");
    const readModel = asRecord(observed.readModel, "viewer read model");
    expect(readModel).toMatchObject({
      runtimeProfiles: {
        manifest: { profileId: AUTHORITATIVE_MANIFEST_ID },
        ruleset: { profileId: AUTHORITATIVE_RULESET_ID },
      },
    });

    const denied = await stub.prepare(
      MALLORY,
      intent("submission:impersonation", "character:alice"),
    );
    expect(denied).toMatchObject({ kind: "rejected", code: "notController" });
  });

  it("reuses one submission for an identical payload and rejects a changed payload", async () => {
    const stub = await authoritativeRoom("authority-v2-submission-idempotency");
    const action = intent("submission:idempotent", "character:alice");
    const prepared = asPrepared(await stub.prepare(ALICE, action));
    const duplicate = asPrepared(await stub.prepare(ALICE, structuredClone(action)));
    expect(duplicate.preparedActionId).toBe(prepared.preparedActionId);
    expect(duplicate.rootActionId).toBe(prepared.rootActionId);

    const committed = asRecord(
      await stub.commit(ALICE, prepared.preparedActionId, directSuccess(prepared, "proposal:idempotent:1")),
      "commit outcome",
    );
    expect(committed.kind).toBe("committed");
    const originalReceipt = asRecord(committed.receipt, "public receipt");

    const completedRetry = asRecord(await stub.prepare(ALICE, structuredClone(action)), "retry");
    expect(completedRetry.kind).toBe("committed");
    expect(completedRetry.receipt).toEqual(originalReceipt);

    const changedPayload = await stub.prepare(
      ALICE,
      intent("submission:idempotent", "character:alice", "我改为立即砸碎门锁。"),
    );
    expect(changedPayload).toMatchObject({
      kind: "rejected",
      code: "idempotencyPayloadMismatch",
    });
  });

  it("commits a direct-success proposal and exposes only a public receipt through observe", async () => {
    const stub = await authoritativeRoom("authority-v2-direct-commit");
    const prepared = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:direct", "character:alice"),
    ));
    const committed = asRecord(
      await stub.commit(ALICE, prepared.preparedActionId, directSuccess(prepared, "proposal:direct:1")),
      "commit outcome",
    );
    expect(committed.kind).toBe("committed");
    const receipt = receiptOf(committed);
    expect(receipt).toMatchObject({
      rootActionId: prepared.rootActionId,
      status: "committed",
      receiptId: expect.any(String),
    });

    const observed = asRecord(await stub.observe(ALICE), "observation");
    const readModel = asRecord(observed.readModel, "viewer read model");
    expect(readModel.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ receiptId: receipt.receiptId, status: "committed" }),
    ]));
  });

  it("fulfills a check with DO-owned randomness and returns the same receipt and face on retry", async () => {
    const stub = await authoritativeRoom("authority-v2-randomness");
    const prepared = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:check", "character:alice", "我用肩膀撞开卡住的木门。"),
    ));
    const proposal = checkRequired(prepared);

    const first = asRecord(
      await stub.commit(ALICE, prepared.preparedActionId, proposal),
      "first check outcome",
    );
    expect(first.kind).toBe("committed");
    const firstReceipt = asRecord(first.receipt, "first public receipt");
    const firstProjection = asRecord(first.kpProjection, "first KP projection");
    const firstMechanicalResult = asRecord(
      firstProjection.mechanicalResult,
      "first mechanical result",
    );
    expect(firstMechanicalResult).toMatchObject({
      randomness: [{
        randomnessId: expect.any(String),
        faces: [expect.any(Number)],
      }],
    });
    const firstRandomness = structuredClone(firstMechanicalResult.randomness);
    const firstFace = asRecord(
      (firstRandomness as unknown[])[0],
      "authoritative randomness result",
    ).faces as number[];
    expect(firstFace[0]).toBeGreaterThanOrEqual(1);
    expect(firstFace[0]).toBeLessThanOrEqual(20);

    const retry = asRecord(
      await stub.commit(ALICE, prepared.preparedActionId, structuredClone(proposal)),
      "retried check outcome",
    );
    expect(retry.kind).toBe("committed");
    expect(retry.receipt).toEqual(firstReceipt);
    const retryProjection = asRecord(retry.kpProjection, "retry KP projection");
    const retryMechanicalResult = asRecord(
      retryProjection.mechanicalResult,
      "retry mechanical result",
    );
    expect(retryMechanicalResult.randomness).toEqual(firstRandomness);
  });

  it("rejects the later prepared action when an earlier commit changes the same relevant scope", async () => {
    const stub = await authoritativeRoom("authority-v2-related-scope");
    const first = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:related:first", "character:alice"),
    ));
    const second = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:related:second", "character:alice", "我紧接着继续向前。"),
    ));

    await expect(stub.commit(
      ALICE,
      first.preparedActionId,
      directSuccess(first, "proposal:related:first"),
    )).resolves.toMatchObject({ kind: "committed" });
    await expect(stub.commit(
      ALICE,
      second.preparedActionId,
      directSuccess(second, "proposal:related:second"),
    )).resolves.toMatchObject({ kind: "rejected", code: "scopeConflict" });
  });

  it("allows actions prepared together to commit when their Rules-derived scopes are unrelated", async () => {
    const stub = await authoritativeRoom("authority-v2-unrelated-scopes", [
      character("character:alice", ALICE.principal.id, "shrine"),
      character("character:bob", BOB.principal.id, "yard"),
    ]);
    const alicePrepared = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:unrelated:alice", "character:alice"),
    ));
    const bobPrepared = asPrepared(await stub.prepare(
      BOB,
      intent("submission:unrelated:bob", "character:bob"),
    ));

    await expect(stub.commit(
      ALICE,
      alicePrepared.preparedActionId,
      directSuccess(alicePrepared, "proposal:unrelated:alice"),
    )).resolves.toMatchObject({ kind: "committed" });
    await expect(stub.commit(
      BOB,
      bobPrepared.preparedActionId,
      directSuccess(bobPrepared, "proposal:unrelated:bob"),
    )).resolves.toMatchObject({ kind: "committed" });
  });

  it("recovers a pending input and its receipt when the same named stub is acquired again", async () => {
    const roomName = "authority-v2-pending-recovery";
    const stub = await authoritativeRoom(roomName);
    const prepared = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:pending", "character:alice", "我拉下那根拉杆。"),
    ));
    const awaiting = asRecord(await stub.commit(ALICE, prepared.preparedActionId, {
      kind: "directSuccess",
      rootActionId: prepared.rootActionId,
      proposalAttemptId: "proposal:pending:1",
      goal: "拉下眼前的一根拉杆",
      method: "伸手拉下玩家指向的拉杆",
      publicBasisRefs: [],
      privateBasisRefs: [],
      risk: null,
      pendingInput: {
        kind: "playerChoice",
        prompt: "你要拉左侧警铃拉杆，还是右侧闸门拉杆？",
        choices: [
          { id: "alarm", label: "左侧警铃", consequence: "警铃会被拉响。" },
          { id: "gate", label: "右侧闸门", consequence: "闸门机构会被触发。" },
        ],
      },
      dynamicMaterializations: [],
      npcActions: [],
      mechanicalProposal: null,
      scene: {
        question: "玩家究竟选择哪根拉杆？",
        pressure: "",
        opportunities: [],
        conclusionCandidate: null,
      },
    }), "awaiting-input outcome");
    expect(awaiting.kind).toBe("awaitingInput");
    const receipt = asRecord(awaiting.receipt, "awaiting public receipt");
    const pending = asRecord(awaiting.pending, "pending input");
    expect(pending).toMatchObject({
      pendingInputId: expect.any(String),
      kind: "playerChoice",
      controllerPrincipalId: ALICE.principal.id,
      choices: [
        { choiceId: "alarm", label: "左侧警铃", consequence: "警铃会被拉响。" },
        { choiceId: "gate", label: "右侧闸门", consequence: "闸门机构会被触发。" },
      ],
    });

    const restored = roomStub(roomName);
    const observed = asRecord(await restored.observe(ALICE), "restored observation");
    const readModel = asRecord(observed.readModel, "restored viewer read model");
    expect(JSON.stringify(observed.transcript)).toContain("我拉下那根拉杆。");
    expect(JSON.stringify(observed.transcript)).toContain(
      "你要拉左侧警铃拉杆，还是右侧闸门拉杆？",
    );
    expect(readModel.pendingInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ pendingInputId: pending.pendingInputId }),
    ]));
    expect(readModel.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ receiptId: receipt.receiptId }),
    ]));

    const answer = asPrepared(await restored.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:pending:answer",
      pendingInputId: pending.pendingInputId,
      answer: { choiceId: "gate" },
      displayText: "我选择右侧闸门拉杆。",
    }));
    expect(answer.rootActionId).toBe(prepared.rootActionId);
    await expect(restored.commit(
      ALICE,
      answer.preparedActionId,
      directSuccess(answer, "proposal:pending:answer"),
    )).resolves.toMatchObject({ kind: "committed" });
    const afterAnswer = asRecord(await restored.observe(ALICE), "answered observation");
    expect(asRecord(afterAnswer.readModel, "answered read model").pendingInputs).toEqual([]);
    expect(JSON.stringify(afterAnswer.transcript)).toContain("我选择右侧闸门拉杆。");
    expect(JSON.stringify(afterAnswer.transcript)).toMatch(
      /我拉下那根拉杆[^]*你要拉左侧警铃拉杆，还是右侧闸门拉杆[^]*我选择右侧闸门拉杆/,
    );
  });

  it("rejects a forged playerChoice candidate without closing the pending input", async () => {
    const stub = await authoritativeRoom("authority-v2-player-choice-forgery");
    const prepared = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:player-choice", "character:alice", "我拉下其中一根拉杆。"),
    ));
    const awaiting = asRecord(await stub.commit(ALICE, prepared.preparedActionId, {
      kind: "directSuccess",
      rootActionId: prepared.rootActionId,
      proposalAttemptId: "proposal:player-choice:1",
      goal: "选择一根拉杆",
      method: "亲手拉下明确选择的拉杆",
      publicBasisRefs: [],
      privateBasisRefs: [],
      risk: null,
      pendingInput: {
        kind: "playerChoice",
        prompt: "你选择警铃还是闸门？",
        choices: [
          { id: "alarm", label: "警铃", consequence: "警铃会通知守卫。" },
          { id: "gate", label: "闸门", consequence: "闸门会开始升起。" },
        ],
      },
      dynamicMaterializations: [],
      npcActions: [],
      mechanicalProposal: null,
      scene: {
        question: "玩家明确选择哪根拉杆？",
        pressure: "",
        opportunities: [],
        conclusionCandidate: null,
      },
    }), "player choice outcome");
    const pending = asRecord(awaiting.pending, "player choice pending");
    const forgedAnswer = asPrepared(await stub.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:player-choice:forged",
      pendingInputId: pending.pendingInputId,
      answer: { choiceId: "hidden-third-option" },
    }));
    await expect(stub.commit(
      ALICE,
      forgedAnswer.preparedActionId,
      directSuccess(forgedAnswer, "proposal:player-choice:forged"),
    )).resolves.toMatchObject({ kind: "rejected", code: "invalidRulesInput" });
    const observed = asRecord(await stub.observe(ALICE), "post-forgery observation");
    expect(asRecord(observed.readModel, "post-forgery read model").pendingInputs)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ pendingInputId: pending.pendingInputId, kind: "playerChoice" }),
      ]));
  });

  it("does not let an ordinary authenticated player execute a correction", async () => {
    const stub = await authoritativeRoom("authority-v2-correction-permission");
    const prepared = asPrepared(await stub.prepare(
      ALICE,
      intent("submission:correction-source", "character:alice"),
    ));
    const committed = await stub.commit(
      ALICE,
      prepared.preparedActionId,
      directSuccess(prepared, "proposal:correction-source"),
    );
    const receipt = receiptOf(committed);

    await expect(stub.commitCorrection(ALICE, {
      correctionId: "correction:ordinary-player",
      receiptId: receipt.receiptId,
      errorKind: "rulesMisapplication",
      explanation: "我认为这次裁决可能有误。",
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "correctionUnauthorized",
    });
  });
});
