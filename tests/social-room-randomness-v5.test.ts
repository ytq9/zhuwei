import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from
  "../app/_runtime/lib/rules/profiles/manifests";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown): Promise<unknown>;
  resumePlayerRandomness(context: unknown, randomnessId: string): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:social-room-v5:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:social-room-v5:bob", sessionVersion: 1 }),
});
const ACTOR_ID = "character:social-room-v5:alice";
const NPC_ID = "npc:black-oak-will:varo";

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

function privateSocialProposal(rootActionId: string, utterance: string) {
  const draft = {
    goal: "让对方暂时相信这项自述来由",
    method: "仅凭当面陈述争取有限信任",
    utterance,
    desiredResponse: JSON.stringify({
      schema: "zhuwei.social-intent-draft/v1",
      npcRef: NPC_ID,
      influenceGoal: "beBelieved",
      desiredBehavior: "暂时按玩家陈述的来由采取有限行动",
      addressedThreadRef: null,
      evidenceRefs: [],
      assertion: {
        subjectRef: ACTOR_ID,
        predicate: "affiliatedWith",
        polarity: "affirm",
        object: { referenceKind: "unresolvedLabel", label: "无名巡回庭" },
      },
    }),
    npcResponse: JSON.stringify({
      schema: "zhuwei.npc-response-draft/v1",
      mode: "reaction",
      reaction: "acknowledge",
    }),
    basisRefs: [NPC_ID],
    resolution: "check",
    durationUnit: "minute",
    durationValue: 1,
    risk: "失败会让对方维持或加强怀疑，但不会把自述变成世界事实。",
    ability: "cha",
    skill: "persuasion",
    dc: 15,
    mode: "normal",
    successConsequence: "对方按最终差值给出有限至充分回应。",
    failureConsequence: "对方维持或加强当前怀疑。",
  };
  const causalActionProgram = compileKpFormDraft("npc-exchange.v1", draft);
  return {
    kind: "privateFormProposal",
    formId: "npc-exchange.v1",
    draft,
    causalActionProgram,
    loweredCausalProgram: lowerCausalActionProgram(causalActionProgram),
    semanticFreezeHash: causalActionProgram.semanticHash,
    repairUsed: false,
    proposalAttemptId: `${rootActionId}:proposal:1`,
    modelInvocationReceipt: { task: "proposal", result: "success" },
    rootActionId,
  };
}

describe("V5 Room social player-roll recovery", () => {
  it("keeps one frozen roll across a crash, exact control transfer, and response-lost retry", async () => {
    const roomId = "social-room-randomness-v5-control-transfer";
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
      characters: [{
        characterId: ACTOR_ID,
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "wake",
          classId: "bard",
          raceId: "human",
          level: 3,
          scores: { str: 10, dex: 12, con: 12, int: 12, wis: 10, cha: 16 },
          proficiency: 2,
          skills: ["persuasion"],
          expertise: ["persuasion"],
          hp: { current: 18, max: 18, temp: 0 },
          ac: 13,
          speed: 30,
          equipped: { armor: "leather" },
          backpack: [],
        },
      }],
    }), "social room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const utterance = "我是无名巡回庭派来协助眼前事务的。";
    const prepared = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:social-room-v5:claim",
      text: utterance,
    }), "social intent prepare");
    expect(prepared.kind, JSON.stringify(prepared)).toBe("prepared");
    const offered = record(await authority.commit(
      ALICE,
      String(prepared.preparedActionId),
      privateSocialProposal(String(prepared.rootActionId), utterance),
    ), "social offer commit");
    expect(offered.kind, JSON.stringify(offered)).toBe("awaitingInput");
    const pending = record(offered.pending, "social pending input");

    const pressPrepared = record(await authority.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:social-room-v5:press",
      pendingInputId: String(pending.pendingInputId),
      answer: { choice: "press" },
      displayText: "坚持进行这次检定",
    }), "social press prepare");
    const awaitingRoll = record(await authority.commit(
      ALICE,
      String(pressPrepared.preparedActionId),
      {
        kind: "authenticatedPendingAnswer",
        rootActionId: String(pressPrepared.rootActionId),
      },
    ), "social press commit");
    expect(awaitingRoll.kind, JSON.stringify(awaitingRoll)).toBe("awaitingPlayerRoll");
    const pendingRoll = record(
      list(awaitingRoll.pendingPlayerRolls, "pending player rolls")[0],
      "pending player roll",
    );
    expect(pendingRoll).toMatchObject({
      characterId: ACTOR_ID,
      kind: "check",
      ability: "cha",
      skill: "persuasion",
      dice: "1d20",
    });
    const randomnessId = String(pendingRoll.id);

    let draws = 0;
    await expect(runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        authorityRecoveryCheckpoint?: (name: string) => void;
        resumePlayerRandomness(context: unknown, id: string): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = (sides) => {
        expect(sides).toBe(20);
        draws += 1;
        return 11;
      };
      target.authorityRecoveryCheckpoint = (name) => {
        if (name === "afterRandomnessCandidateCommit") {
          throw new Error("simulated-crash:social-v5-after-candidate");
        }
      };
      try {
        return await target.resumePlayerRandomness(ALICE, randomnessId);
      } finally {
        target.authorityRoll = originalRoll;
        delete target.authorityRecoveryCheckpoint;
      }
    })).rejects.toThrow("simulated-crash:social-v5-after-candidate");
    expect(draws).toBe(1);

    const candidateStatus = await runInDurableObject(
      authority as never,
      async (_instance, state) => state.storage.sql.exec<{
        status: string;
        candidates_json: string | null;
      }>(`
        SELECT status, candidates_json
        FROM authority_randomness_batches
        WHERE prepared_action_id = ?
      `, String(pressPrepared.preparedActionId)).toArray()[0],
    );
    expect(candidateStatus?.status).toBe("candidateCommitted");
    expect(candidateStatus?.candidates_json).toContain("11");

    await evictDurableObject(authority as never);
    const transferred = record(await authority.applyRoomAdministration(
      capabilities.roomAdministration,
      {
        commandId: "room-admin:social-v5:transfer-control",
        kind: "transferControl",
        characterId: ACTOR_ID,
        fromSeatId: `seat:${ALICE.principal.id}`,
        toSeatId: `seat:${BOB.principal.id}`,
      },
    ), "pending-roll control transfer");
    expect(transferred.kind, JSON.stringify(transferred)).toBe("committed");

    const aliceObservation = record(await authority.observe(ALICE), "former controller observation");
    expect(aliceObservation).toMatchObject({
      kind: "rejected",
      code: "viewerUnauthorized",
    });
    const bobObservation = record(await authority.observe(BOB), "new controller observation");
    expect(list(bobObservation.pendingPlayerRolls, "new controller rolls"))
      .toEqual([expect.objectContaining({ id: randomnessId, characterId: ACTOR_ID })]);

    let recoveryDraws = 0;
    const recovered = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        resumePlayerRandomness(context: unknown, id: string): Promise<unknown>;
      };
      const originalRoll = target.authorityRoll;
      target.authorityRoll = () => {
        recoveryDraws += 1;
        return 20;
      };
      try {
        return await target.resumePlayerRandomness(BOB, randomnessId);
      } finally {
        target.authorityRoll = originalRoll;
      }
    }), "transferred social roll recovery");
    expect(recovered.kind, JSON.stringify(recovered)).toBe("committed");
    expect(recoveryDraws).toBe(0);
    const mechanical = record(
      record(recovered.kpProjection, "recovered KP projection").mechanicalResult,
      "recovered mechanics",
    );
    expect(list(record(list(mechanical.randomness, "recovered randomness")[0], "draw").faces, "faces"))
      .toEqual([11]);

    const responseLostRetry = record(
      await authority.resumePlayerRandomness(BOB, randomnessId),
      "response-lost player-roll retry",
    );
    expect(responseLostRetry.kind).toBe("committed");
    expect(responseLostRetry.receipt).toEqual(recovered.receipt);
    expect(record(responseLostRetry.kpProjection, "retry KP projection").mechanicalResult)
      .toEqual(mechanical);

    const eventTypes = await runInDurableObject(
      authority as never,
      async (_instance, state) => state.storage.sql.exec<{ event_json: string }>(`
        SELECT event_json FROM authority_events
        ORDER BY length(event_seq), event_seq
      `).toArray().map(({ event_json }) =>
        String(record(JSON.parse(event_json), "archived event").eventType)),
    );
    expect(eventTypes.filter((eventType) => eventType === "DiceRolled")).toHaveLength(1);
    expect(eventTypes.filter((eventType) => eventType === "SocialCheckResolved"))
      .toHaveLength(1);
  }, 20_000);
});
