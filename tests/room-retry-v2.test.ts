import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  compileKpFormDraft,
  lowerCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program";
import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests";

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

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function privateFormProposal(
  rootActionId: string,
  formId: "clarification.v1" | "observe.v1" | "ordinary-check.v1",
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
    proposalAttemptId: `${rootActionId}:proposal:1`,
    modelInvocationReceipt: { task: "proposal", result: "success" },
    rootActionId,
  };
}

function ordinaryCheckDraft(overrides: JsonRecord = {}): JsonRecord {
  return {
    goal: "安静移开木箱",
    method: "垫上雨披后缓慢拖动",
    intendedOutcome: "露出木箱后的门",
    risk: "雨披可能撕裂并发出声音",
    resolution: "check",
    ability: "str",
    skill: "athletics",
    dc: 12,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "木箱被无声移开，暗门显露。",
    failureConsequence: "木箱摩擦石地，惊动邻近守卫。",
    ...overrides,
  };
}

function v3Character(characterId: string) {
  return {
    characterId,
    controllerPrincipalId: ALICE.principal.id,
    staticCard: {
      name: "阿莱莎",
      sceneId: "yard",
      classId: "fighter",
      raceId: "human",
      level: 1,
      scores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      proficiency: 2,
      skills: ["athletics"],
      hp: { current: 12, max: 12, temp: 0 },
      ac: 14,
      speed: 30,
      equipped: { armor: "leather", main: "shortsword" },
      backpack: [],
      resources: { resolve: 2 },
    },
  };
}

describe("authoritative Room explicit retry recovery", () => {
  it("reauthenticates the same prepared action and rejects action retry after its Receipt commits", async () => {
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
      privateFormProposal(String(prepared.rootActionId), "observe.v1", {
        goal: "确认门闩是否已经松开",
        method: "观察门闩的当前位置",
        focus: "门闩",
        desiredInformation: "门闩是否已经松开",
        resolution: "direct",
        durationUnit: "second",
        durationValue: 1,
      }),
    ), "commit after retry");
    expect(committed.kind).toBe("committed");
    const receipt = record(committed.receipt, "committed receipt");

    const completedRetry = record(
      await authority.prepare(ALICE, structuredClone(retry)),
      "completed retry",
    );
    expect(completedRetry).toMatchObject({
      kind: "rejected",
      code: "viewerNarrationRecoveryRequired",
    });
    expect(completedRetry).not.toHaveProperty("receipt");
    const afterCompletedRetry = record(await authority.observe(ALICE), "after completed retry");
    const completedReadModel = record(afterCompletedRetry.readModel, "completed retry read model");
    expect(completedReadModel.fictionTime)
      .toEqual(record(committed.kpProjection, "committed KP projection").fictionTime);
    expect(list(completedReadModel.receipts, "completed receipts")).toEqual(
      expect.arrayContaining([expect.objectContaining({ receiptId: receipt.receiptId })]),
    );
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
    expect(outcome).toMatchObject({
      kind: "retryableFailure",
      code: "PROPOSAL_PROVIDER_TIMEOUT",
    });
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
    const proposal = privateFormProposal(
      String(prepared.rootActionId),
      "ordinary-check.v1",
      ordinaryCheckDraft({
      goal: "撞开卡住的木门",
      method: "用肩膀撞开卡住的木门",
      intendedOutcome: "木门被撞开",
      risk: "失败会耗时并发出声响",
      ability: "str",
      skill: "athletics",
      dc: 10,
      mode: "normal",
      durationUnit: "second",
      durationValue: 1,
      successConsequence: "木门被撞开。",
      failureConsequence: "木门没有打开，撞击声传了出去。",
    }),
    );
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
    expect(recoveredAgain).toMatchObject({
      kind: "rejected",
      code: "viewerNarrationRecoveryRequired",
    });
    expect(proposalCalls).toBe(0);
    expect(narrationCalls).toBe(1);
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

    const cachedCommit = record(await authority.commit(
      ALICE,
      String(prepared.preparedActionId),
      structuredClone(proposal),
    ), "cached mechanical commit");
    expect(cachedCommit).toMatchObject({ kind: "committed", receipt: recovered.receipt });
    const mechanics = record(
      record(cachedCommit.kpProjection, "cached recovery projection").mechanicalResult,
      "cached mechanics",
    );
    const randomness = record(list(mechanics.randomness, "cached randomness")[0], "cached die");
    const archivedDice = list(archiveAfterFirstRecovery.events, "recovery archive events")
      .map((event) => record(event, "recovery archive event"))
      .filter((event) => event.eventType === "DiceRolled");
    expect(archivedDice).toHaveLength(1);
    expect(record(archivedDice[0].payload, "archived die").faces).toEqual(randomness.faces);
  });

  it("recovers a V3 causal check after its request commit without replaying cost or accepting a changed program", async () => {
    const roomId = "authoritative-v3-causal-request-commit-recovery";
    const characterId = "character:retry:v3-causal";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [v3Character(characterId)],
    }), "V3 causal recovery initialization");
    const archiveExport = record(
      initialized.serviceCapabilities,
      "V3 causal recovery capabilities",
    ).archiveExport;
    const submissionId = "submission:retry:v3-causal";
    const prepared = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId,
      text: "我把雨披垫在木箱下，慢慢把它拖开。",
    }), "V3 causal recovery prepare");
    const rootActionId = String(prepared.rootActionId);
    const proposal = privateFormProposal(rootActionId, "ordinary-check.v1", ordinaryCheckDraft({
      resourceRef: "resolve",
      resourceAmount: 1,
    }));

    await expect(runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRoll = () => {
        throw new Error("a face must not be drawn before the causal request is durable");
      };
      target.authorityRecoveryCheckpoint = (name) => {
        if (name === "afterRandomnessRequestCommit") {
          throw new Error("simulated-crash:v3-causal-after-request");
        }
      };
      return target.commit(ALICE, String(prepared.preparedActionId), structuredClone(proposal));
    })).rejects.toThrow("simulated-crash:v3-causal-after-request");
    await evictDurableObject(authority as never);

    await expect(authority.exportAuthoritativeArchive(archiveExport)).resolves.toMatchObject({
      kind: "retryableFailure",
      code: "archiveSettlementPending",
    });

    const changedProposal = privateFormProposal(
      rootActionId,
      "ordinary-check.v1",
      ordinaryCheckDraft({
        dc: 13,
        resourceRef: "resolve",
        resourceAmount: 1,
      }),
    );
    await expect(runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRoll = () => {
        throw new Error("a changed causal program must fail before rolling");
      };
      return target.commit(
        ALICE,
        String(prepared.preparedActionId),
        structuredClone(changedProposal),
      );
    })).resolves.toMatchObject({ kind: "rejected", code: "idempotencyPayloadMismatch" });

    let rollCount = 0;
    const recovered = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRoll = (sides) => {
        expect(sides).toBe(20);
        rollCount += 1;
        return 20;
      };
      return target.commit(ALICE, String(prepared.preparedActionId), structuredClone(proposal));
    }), "recovered V3 causal outcome");
    expect(recovered.kind, JSON.stringify(recovered)).toBe("committed");
    expect(rollCount).toBe(1);

    const repeated = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRoll = () => {
        throw new Error("an idempotent causal retry must not reroll");
      };
      return target.commit(ALICE, String(prepared.preparedActionId), structuredClone(proposal));
    }), "repeated V3 causal outcome");
    expect(repeated.receipt).toEqual(recovered.receipt);

    const exported = record(await authority.exportAuthoritativeArchive(
      archiveExport,
    ), "V3 causal recovery archive export");
    const rootEvents = list(record(exported.archive, "V3 causal archive").events, "V3 causal events")
      .map((event) => record(event, "V3 causal event"))
      .filter((event) => event.rootActionId === rootActionId);
    for (const eventType of [
      "ResourceReserved",
      "RandomnessRequested",
      "DiceRolled",
      "ImprovisedCheckResolved",
    ]) {
      expect(rootEvents.filter((event) => event.eventType === eventType), eventType).toHaveLength(1);
    }
  }, 15_000);

  it("recovers a clarification answer that becomes a V3 check under the original root", async () => {
    const roomId = "authoritative-v3-clarification-causal-recovery";
    const characterId = "character:retry:v3-clarification";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [v3Character(characterId)],
    }), "V3 clarification recovery initialization");
    const archiveExport = record(
      initialized.serviceCapabilities,
      "V3 clarification recovery capabilities",
    ).archiveExport;
    const initialPrepared = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:retry:v3-clarification:question",
      text: "我检查这扇门。",
    }), "V3 clarification prepare");
    const rootActionId = String(initialPrepared.rootActionId);
    const opened = record(await authority.commit(
      ALICE,
      String(initialPrepared.preparedActionId),
      privateFormProposal(rootActionId, "clarification.v1", {
        goal: "确认玩家想检查门轴还是门锁",
        question: "你先检查门轴，还是门锁？",
        choices: ["门轴", "门锁"],
      }),
    ), "V3 clarification opening");
    expect(opened.kind, JSON.stringify(opened)).toBe("awaitingInput");
    const pendingInputId = String(record(opened.pending, "V3 clarification pending").pendingInputId);
    const answerPrepared = record(await authority.prepare(ALICE, {
      kind: "answer",
      submissionId: "submission:retry:v3-clarification:answer",
      pendingInputId,
      answer: { text: "先检查门轴" },
      displayText: "我先检查门轴。",
    }), "V3 clarification answer prepare");
    expect(answerPrepared.rootActionId).toBe(rootActionId);
    const answerProposal = privateFormProposal(
      rootActionId,
      "ordinary-check.v1",
      ordinaryCheckDraft({
        goal: "检查门轴是否刚被使用",
        method: "观察磨损并试推",
        intendedOutcome: "确认门轴最近是否转动过",
        successConsequence: "新鲜磨痕表明门轴刚被使用。",
        failureConsequence: "磨痕太杂，无法判断最近是否有人开门。",
      }),
    );

    await expect(runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRecoveryCheckpoint = (name) => {
        if (name === "afterRandomnessRequestCommit") {
          throw new Error("simulated-crash:v3-clarification-after-request");
        }
      };
      return target.commit(
        ALICE,
        String(answerPrepared.preparedActionId),
        structuredClone(answerProposal),
      );
    })).rejects.toThrow("simulated-crash:v3-clarification-after-request");
    await evictDurableObject(authority as never);

    let rollCount = 0;
    const recovered = record(await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        authorityRoll(sides: number): number;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
      };
      target.authorityRoll = (sides) => {
        expect(sides).toBe(20);
        rollCount += 1;
        return 20;
      };
      return target.commit(
        ALICE,
        String(answerPrepared.preparedActionId),
        structuredClone(answerProposal),
      );
    }), "recovered V3 clarification answer");
    expect(recovered.kind, JSON.stringify(recovered)).toBe("committed");
    expect(rollCount).toBe(1);
    const observation = record(await authority.observe(ALICE), "V3 clarification recovery observation");
    expect(record(observation.readModel, "V3 clarification recovery read model").pendingInputs)
      .toEqual([]);

    const exported = record(await authority.exportAuthoritativeArchive(
      archiveExport,
    ), "V3 clarification recovery archive export");
    const rootEvents = list(
      record(exported.archive, "V3 clarification archive").events,
      "V3 clarification events",
    ).map((event) => record(event, "V3 clarification event"))
      .filter((event) => event.rootActionId === rootActionId);
    expect(rootEvents.filter((event) => event.eventType === "ClarificationRequested")).toHaveLength(1);
    expect(rootEvents.filter((event) => event.eventType === "PendingInputAnswered")).toHaveLength(1);
    expect(rootEvents.filter((event) => event.eventType === "RandomnessRequested")).toHaveLength(1);
    expect(rootEvents.filter((event) => event.eventType === "DiceRolled")).toHaveLength(1);
  }, 15_000);

  it("keeps a committed Receipt authoritative when the archive alarm scheduler fails", async () => {
    const roomId = "authoritative-v2-archive-alarm-failure";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId: "character:retry:archive-alarm",
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
    const prepared = record(await authority.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:retry:archive-alarm",
      characterId: "character:retry:archive-alarm",
      text: "我确认门闩已经松开。",
    }), "archive alarm prepare");
    const proposal = privateFormProposal(String(prepared.rootActionId), "observe.v1", {
      goal: "确认门闩是否松开",
      method: "观察门闩位置",
      focus: "门闩",
      desiredInformation: "门闩是否已经松开",
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    });

    const result = await runInDurableObject(authority as never, async (instance) => {
      const target = instance as unknown as {
        scheduleExpiryAlarm(): Promise<void>;
        flushAuthoritativeD1ArchivePage(): Promise<void>;
        commit(context: unknown, preparedActionId: string, proposalValue: unknown): Promise<unknown>;
        authorityStore: {
          archiveProgress(): { pending?: boolean } | undefined;
          events(): unknown[];
        };
      };
      target.scheduleExpiryAlarm = async () => {
        throw new Error("injected archive alarm failure");
      };
      target.flushAuthoritativeD1ArchivePage = async () => {};

      const first = record(await target.commit(
        ALICE,
        String(prepared.preparedActionId),
        structuredClone(proposal),
      ), "first commit despite archive alarm failure");
      const eventCount = target.authorityStore.events().length;
      const repeated = record(await target.commit(
        ALICE,
        String(prepared.preparedActionId),
        structuredClone(proposal),
      ), "repeated commit despite archive alarm failure");
      return {
        first,
        repeated,
        eventCount,
        repeatedEventCount: target.authorityStore.events().length,
        archivePending: target.authorityStore.archiveProgress()?.pending,
      };
    });

    expect(result.first.kind).toBe("committed");
    expect(result.repeated.kind).toBe("committed");
    expect(result.repeated.receipt).toEqual(result.first.receipt);
    expect(result.repeatedEventCount).toBe(result.eventCount);
    expect(result.archivePending).toBe(true);
  });
});
