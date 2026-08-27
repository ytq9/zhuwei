import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import {
  directConsequencesProposal,
  noncombatCheckProposal,
} from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:retry:alice", sessionVersion: 1 }),
});
const MALLORY = Object.freeze({
  principal: Object.freeze({ id: "principal:retry:mallory", sessionVersion: 1 }),
});

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

describe("authoritative Room explicit retry recovery", () => {
  it("reauthenticates and resumes the same prepared action or committed Receipt without advancing state", async () => {
    const roomId = "authoritative-v2-explicit-retry";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    await expect(authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId: "character:retry:alice",
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "wake",
          abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
          proficiencyBonus: 2,
          proficientSkills: [],
        },
      }],
    })).resolves.toMatchObject({ created: true });

    const submissionId = "submission:retry:recover";
    const prepared = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId,
      characterId: "character:retry:alice",
      text: "我停下来确认门闩是否已经松开。",
    }), "initial prepare");
    expect(prepared).toMatchObject({
      kind: "prepared",
      preparedActionId: expect.any(String),
      rootActionId: expect.any(String),
    });

    const before = record(await authority.observe(ALICE), "before retry");
    const beforeRead = record(before.readModel, "before retry read model");
    const retry = {
      kind: "retry",
      submissionId,
      rootActionId: prepared.rootActionId,
    };
    await expect(authority.prepare(MALLORY, structuredClone(retry))).resolves.toMatchObject({
      kind: "rejected",
    });
    await expect(authority.prepare(ALICE, {
      ...retry,
      rootActionId: "root-action:not-the-original",
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "retryReferenceMismatch",
    });

    const resumed = record(await authority.prepare(ALICE, structuredClone(retry)), "resumed prepare");
    expect(resumed).toEqual(prepared);
    const afterResume = record(await authority.observe(ALICE), "after prepared retry");
    expect(record(afterResume.readModel, "after prepared retry read model").fictionTime)
      .toEqual(beforeRead.fictionTime);

    const committed = record(await authority.commit(
      ALICE,
      String(prepared.preparedActionId),
      directConsequencesProposal(String(prepared.rootActionId), {
        proposalAttemptId: "proposal:retry:recover:1",
        goal: "确认门闩是否已经松开",
        method: "观察门闩的当前位置",
        duration: { unit: "second", value: 1 },
      }),
    ), "commit after retry");
    expect(committed.kind).toBe("committed");
    const receipt = record(committed.receipt, "committed receipt");

    const completedRetry = record(
      await authority.prepare(ALICE, structuredClone(retry)),
      "completed retry",
    );
    expect(completedRetry).toMatchObject({ kind: "committed" });
    expect(completedRetry.receipt).toEqual(receipt);
    const afterCompletedRetry = record(await authority.observe(ALICE), "after completed retry");
    expect(record(afterCompletedRetry.readModel, "completed retry read model").fictionTime)
      .toEqual(record(committed.kpProjection, "committed KP projection").fictionTime);
  });

  it("keeps the original prepared action after a model failure without advancing state", async () => {
    const roomId = "authoritative-v2-explicit-retry-model-failure";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId: "character:retry:model-failure",
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "wake",
          abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
          proficiencyBonus: 2,
          proficientSkills: [],
        },
      }],
    });
    const intent = {
      kind: "intent" as const,
      submissionId: "submission:retry:model-failure",
      characterId: "character:retry:model-failure",
      text: "我检查门闩。",
    };
    const before = record(await authority.observe(ALICE), "before model failure");
    let proposalCalls = 0;
    const outcome = await handleRoomAction({
      principal: ALICE,
      authority: authority as never,
      kp: {
        async propose() {
          proposalCalls += 1;
          throw Object.assign(new Error("simulated model capacity failure"), { retryAfter: 2 });
        },
        async narrate() {
          throw new Error("narration must not run");
        },
      },
    }, intent);
    expect(outcome).toMatchObject({ kind: "retryableFailure", code: "modelTransient" });
    expect(proposalCalls).toBe(1);

    const prepared = record(await authority.prepare(ALICE, structuredClone(intent)), "prepared after model failure");
    const retry = record(await authority.prepare(ALICE, {
      kind: "retry",
      submissionId: intent.submissionId,
      rootActionId: prepared.rootActionId,
    }), "retry after model failure");
    expect(retry).toEqual(prepared);
    const after = record(await authority.observe(ALICE), "after model failure");
    expect(after.readModel).toEqual(before.readModel);
  });

  it("resumes frozen randomness after eviction, publishes once, and never changes the die", async () => {
    const roomId = "authoritative-v2-explicit-retry-randomness";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId: "character:retry:randomness",
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "yard",
          abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
          proficiencyBonus: 2,
          proficientSkills: ["athletics"],
        },
      }],
    }), "randomness room initialization");
    const archiveExport = record(
      initialized.serviceCapabilities,
      "randomness room service capabilities",
    ).archiveExport;
    const submissionId = "submission:retry:randomness";
    const prepared = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId,
      characterId: "character:retry:randomness",
      text: "我用肩膀撞开卡住的木门。",
    }), "randomness prepare");
    const proposal = noncombatCheckProposal(String(prepared.rootActionId), {
      proposalAttemptId: "proposal:retry:randomness:1",
      goal: "撞开卡住的木门",
      method: "用肩膀撞开卡住的木门",
      risk: {
        warning: "门可能被撞开，失败会耗时并发出声响。",
        successConsequences: ["木门被撞开。"],
        failureConsequences: ["木门没有打开，撞击声传了出去。"],
        retryGate: ["methodChanged", "situationAdvanced"],
      },
      ability: "str",
      skill: "athletics",
      dc: 10,
      mode: "normal",
      duration: { unit: "second", value: 1 },
    });
    const harnessStub = authority as never;
    await expect(runInDurableObject(harnessStub, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name: string) => {
        if (name === "beforeRandomnessRequestCommit") {
          throw new Error("simulated-crash:beforeRandomnessRequestCommit");
        }
      };
      return target.commit(ALICE, String(prepared.preparedActionId), structuredClone(proposal));
    })).rejects.toThrow("simulated-crash:beforeRandomnessRequestCommit");
    await evictDurableObject(harnessStub);

    let proposalCalls = 0;
    let narrationCalls = 0;
    const retryInput = {
      kind: "retry" as const,
      submissionId,
      rootActionId: String(prepared.rootActionId),
    };
    const recoveryContext = {
      principal: ALICE,
      authority: authority as never,
      kp: {
        async propose() {
          proposalCalls += 1;
          throw new Error("KP must not be reinvoked for a frozen proposal");
        },
        async narrate() {
          narrationCalls += 1;
          return {
            body: "木门在撞击下猛然洞开，回声沿着院墙散去。",
            agencyClaims: [],
          };
        },
      },
    };
    const recovered = await handleRoomAction(recoveryContext, retryInput);
    expect(recovered.kind).toBe("committed");
    expect(proposalCalls).toBe(0);
    expect(narrationCalls).toBe(1);
    const firstObservation = record(await authority.observe(ALICE), "first recovery observation");
    const firstFrame = record(
      record(firstObservation.delivery, "first recovery delivery").frame,
      "first recovery frame",
    );
    const archiveAfterFirstRecovery = record(
      record(
        await authority.exportAuthoritativeArchive(archiveExport),
        "archive export after first recovery",
      ).archive,
      "archive after first recovery",
    );

    const recoveredAgain = await handleRoomAction(recoveryContext, structuredClone(retryInput));
    expect(recoveredAgain.kind).toBe("committed");
    expect(proposalCalls).toBe(0);
    expect(narrationCalls).toBe(1);
    expect(recoveredAgain.receipt).toEqual(recovered.receipt);
    expect(recoveredAgain.delivery).toEqual(recovered.delivery);
    const repeatedObservation = record(await authority.observe(ALICE), "repeated recovery observation");
    expect(record(
      record(repeatedObservation.delivery, "repeated recovery delivery").frame,
      "repeated recovery frame",
    )).toEqual(firstFrame);
    expect(record(
      record(
        await authority.exportAuthoritativeArchive(archiveExport),
        "archive export after repeated recovery",
      ).archive,
      "archive after repeated recovery",
    )).toEqual(archiveAfterFirstRecovery);

    const committed = record(await authority.prepare(ALICE, structuredClone(retryInput)), "recovered commit");
    const repeated = record(await authority.prepare(ALICE, structuredClone(retryInput)), "repeated recovery");
    expect(repeated.receipt).toEqual(committed.receipt);
    const mechanics = record(record(committed.kpProjection, "recovery projection").mechanicalResult, "mechanics");
    expect(record(record(repeated.kpProjection, "repeat projection").mechanicalResult, "repeat mechanics").randomness)
      .toEqual(mechanics.randomness);
  });
});
