import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  synchronizeAuthoritativeGrowthStaticCard,
  synchronizeGrowthAfterAuthoritativeOutcome,
} from "../app/_runtime/lib/table/authoritative-growth";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:growth-d1:alice", sessionVersion: 1 }),
});

type GrowthAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

function record(value: unknown, label: string): RecordValue {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as RecordValue;
}

function prepared(value: unknown) {
  const outcome = record(value, "prepare outcome");
  expect(outcome).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return outcome as RecordValue & { preparedActionId: string; rootActionId: string };
}

function proposal(rootActionId: string) {
  return {
    kind: "directSuccess",
    rootActionId,
    proposalAttemptId: `${rootActionId}:proposal:1`,
    goal: "结算已完成章节的里程碑资格。",
    method: "只打开玩家自己的成长选择。",
    publicBasisRefs: [],
    privateBasisRefs: [],
    risk: {
      warning: "成长选择仍归角色控制者。",
      successConsequences: [],
      failureConsequences: [],
      retryGate: [],
    },
    pendingInput: null,
    dynamicMaterializations: [],
    npcActions: [],
    mechanicalProposal: {
      operation: "advanceCampaignLifecycle",
      lifecycleAction: "grantMilestone",
    },
    scene: {
      question: "成长后，这名角色如何继续？",
      pressure: "章节后果仍然保留。",
      opportunities: [],
      conclusionCandidate: null,
    },
  };
}

async function answerAdvancement(
  stub: GrowthAuthority,
  submissionId: string,
  pendingInputId: string,
) {
  const preparedOrCached = record(await stub.prepare(ALICE, {
    kind: "answer",
    submissionId,
    pendingInputId,
    answer: {
      classId: "rogue",
      newLevel: 4,
      hitPointMethod: "fixed2014",
      selectedFeatureIds: ["feature:ability-score-improvement"],
      abilityScoreIncreases: { dex: 2 },
    },
  }), "advancement prepare or cached outcome");
  if (preparedOrCached.kind !== "prepared") return preparedOrCached;
  const action = prepared(preparedOrCached);
  expect(action.resolutionMode).toBe("authorityDirect");
  return stub.commit(ALICE, action.preparedActionId, {
    kind: "authenticatedPendingAnswer",
    rootActionId: action.rootActionId,
  });
}

describe("authoritative advancement and D1 static-card boundary", () => {
  it("commits growth once across eviction even when the post-commit D1 mirror write fails", async () => {
    const roomId = "growth-d1-boundary-v2";
    const characterId = "character:growth-d1:alice";
    const stub = env.ROOMS.getByName(roomId) as unknown as GrowthAuthority & DurableObjectStub;
    const initialStaticCard = {
      name: "成长边界角色",
      sceneId: "shrine",
      classId: "rogue",
      raceId: "human",
      subclassId: "thief",
      level: 3,
      scores: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
      proficiency: 2,
      skills: ["stealth"],
      cantrips: [],
      prepared: [],
      features: ["feature:cunning-action", "feature:sneak-attack"],
      hp: { current: 999, max: 18, temp: 0 },
      ac: 14,
      speed: 30,
      resources: { hitDice: { max: 3, used: 1 }, resolve: 1 },
    };
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId,
        controllerPrincipalId: ALICE.principal.id,
        staticCard: { ...initialStaticCard, hp: { current: 7, max: 18, temp: 0 } },
      }],
    }), "growth room initialization");
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const milestoneAction = prepared(await stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:growth-d1:milestone",
      characterId,
      text: "这一章已经解决，我要由自己选择成长。",
    }));
    const milestone = record(await stub.commit(
      ALICE,
      milestoneAction.preparedActionId,
      proposal(milestoneAction.rootActionId),
    ), "milestone outcome");
    expect(milestone.kind).toBe("awaitingInput");
    const pendingInputId = String(record(milestone.pending, "advancement pending").pendingInputId);

    const advanced = record(await answerAdvancement(
      stub,
      "submission:growth-d1:choice",
      pendingInputId,
    ), "advancement outcome");
    expect(advanced.kind).toBe("committed");
    const observation = await stub.observe(ALICE);
    const writeStaticCard = vi.fn(async () => {
      throw new Error("SYNTHETIC_D1_STATIC_CARD_WRITE_FAILURE");
    });
    let failedSync: Awaited<ReturnType<typeof synchronizeAuthoritativeGrowthStaticCard>> | undefined;
    const preservedOutcome = await synchronizeGrowthAfterAuthoritativeOutcome({
      outcome: advanced,
      synchronize: async () => {
        failedSync = await synchronizeAuthoritativeGrowthStaticCard({
          currentStaticCard: initialStaticCard,
          observation,
          writeStaticCard,
        });
      },
    });
    expect(preservedOutcome).toEqual(advanced);
    expect(failedSync).toEqual({ kind: "failed" });
    expect(writeStaticCard).toHaveBeenCalledTimes(1);

    await evictDurableObject(stub as never);
    const retried = record(await answerAdvancement(
      stub,
      "submission:growth-d1:choice",
      pendingInputId,
    ), "retried advancement outcome");
    expect(retried).toEqual(advanced);
    const restoredObservation = record(await stub.observe(ALICE), "restored observation");
    expect(record(restoredObservation.readModel, "restored read model").controlledCharacter)
      .toMatchObject({
        characterId,
        level: 4,
        abilityScores: { dex: 18 },
        hitPoints: { current: 7, maximum: 24 },
      });

    let synchronizedCard: RecordValue | undefined;
    const recoveredSync = await synchronizeAuthoritativeGrowthStaticCard({
      currentStaticCard: initialStaticCard,
      observation: restoredObservation,
      writeStaticCard: async (card) => {
        synchronizedCard = structuredClone(card);
      },
    });
    expect(recoveredSync.kind).toBe("synchronized");
    expect(synchronizedCard).toMatchObject({
      level: 4,
      scores: { dex: 18 },
      hp: { current: 999, max: 24, temp: 0 },
      proficiency: 2,
      features: expect.arrayContaining(["feature:ability-score-improvement"]),
    });
    expect(record(synchronizedCard?.resources, "static resources")).toEqual(
      initialStaticCard.resources,
    );

    const exported = record(await stub.exportAuthoritativeArchive(
      capabilities.archiveExport,
    ), "growth archive export");
    const events = record(exported.archive, "growth archive").events as RecordValue[];
    expect(events.filter((event) => event.eventType === "CharacterAdvanced")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "CharacterMechanicsSynchronized"))
      .toHaveLength(1);
  });
});
