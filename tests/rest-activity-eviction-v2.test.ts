import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:rest-eviction:alice", sessionVersion: 1 }),
});

type RestAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

type Prepared = JsonRecord & {
  preparedActionId: string;
  rootActionId: string;
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

function prepared(value: unknown): Prepared {
  const outcome = record(value, "prepare outcome");
  expect(outcome).toMatchObject({
    kind: "prepared",
    preparedActionId: expect.any(String),
    rootActionId: expect.any(String),
  });
  return outcome as Prepared;
}

function proposal(
  action: Prepared,
  proposalAttemptId: string,
  mechanicalProposal: JsonRecord,
) {
  return {
    kind: "directSuccess",
    rootActionId: action.rootActionId,
    proposalAttemptId,
    goal: "按已经明确的虚构行动推进休整。",
    method: "只通过权威 Activity 记录开始、中断与完成。",
    publicBasisRefs: [],
    privateBasisRefs: [],
    risk: {
      warning: "只有连续满足冻结时长的休整才能恢复资源。",
      successConsequences: [],
      failureConsequences: [],
      retryGate: [],
    },
    pendingInput: null,
    dynamicMaterializations: [],
    npcActions: [],
    mechanicalProposal: structuredClone(mechanicalProposal),
    scene: {
      question: "休整是否继续？",
      pressure: "世界内的中断会终止当前尝试。",
      opportunities: [],
      conclusionCandidate: null,
    },
  };
}

async function prepareIntent(
  authority: RestAuthority,
  submissionId: string,
  characterId: string,
  text: string,
) {
  return prepared(await authority.prepare(ALICE, {
    kind: "intent",
    submissionId,
    characterId,
    text,
  }));
}

async function commitIntent(
  authority: RestAuthority,
  submissionId: string,
  characterId: string,
  text: string,
  mechanicalProposal: JsonRecord,
) {
  const action = await prepareIntent(authority, submissionId, characterId, text);
  const outcome = record(await authority.commit(
    ALICE,
    action.preparedActionId,
    proposal(action, `${submissionId}:proposal:1`, mechanicalProposal),
  ), `${submissionId} commit`);
  return { action, outcome };
}

function readModel(observation: unknown): JsonRecord {
  return record(record(observation, "observation").readModel, "read model");
}

function controlledCharacter(observation: unknown): JsonRecord {
  return record(readModel(observation).controlledCharacter, "controlled character");
}

describe("long-rest Activity across Room DO eviction", () => {
  it("interrupts a rebuilt long rest on one hour of travel before any recovery, then permits one restart", async () => {
    const roomId = "rest-activity-eviction-v2";
    const characterId = "character:rest-eviction:alice";
    const authority = env.ROOMS.getByName(roomId) as unknown as RestAuthority & DurableObjectStub;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "legacy-anchor-v1",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId,
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "长休驱逐角色",
          sceneId: "shrine",
          classId: "fighter",
          raceId: "human",
          subclassId: "champion",
          level: 3,
          scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
          proficiency: 2,
          skills: ["athletics"],
          cantrips: [],
          prepared: [],
          features: ["feature:second-wind", "feature:action-surge"],
          hp: { current: 4, max: 20, temp: 0 },
          ac: 16,
          speed: 30,
          resources: {
            hitDice: { max: 3, used: 2 },
            surge: { max: 1, used: 1 },
            slot1: { max: 2, used: 2 },
            resolve: 1,
          },
        },
      }],
    }), "room initialization");
    const archiveExport = record(initialized.serviceCapabilities, "service capabilities").archiveExport;
    const before = structuredClone(controlledCharacter(await authority.observe(ALICE)));

    const first = await commitIntent(
      authority,
      "submission:rest-eviction:first-start",
      characterId,
      "我开始连续八小时长休。",
      {
        operation: "resolveRest",
        restKind: "long",
        hitDiceToSpend: 0,
        arcaneRecoverySlotLevels: [],
      },
    );
    expect(first.outcome.kind, JSON.stringify(first.outcome)).toBe("committed");
    const firstActivityId = `activity:${first.action.rootActionId}`;

    await evictDurableObject(authority as never);

    const strenuousTravel = await commitIntent(
      authority,
      "submission:rest-eviction:strenuous-travel",
      characterId,
      "警报迫使我中断睡眠，连续赶路一小时到庭院。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "hour", value: 1 },
        frozenCosts: [],
        success: [{ kind: "moveEntity", sceneRef: "yard" }],
        failure: [],
      },
    );
    expect(strenuousTravel.outcome.kind, JSON.stringify(strenuousTravel.outcome)).toBe("committed");

    const afterTravel = readModel(await authority.observe(ALICE));
    const interruptedActivity = record(
      list(afterTravel.activities, "activities after strenuous travel")
        .find((entry) => record(entry, "activity after strenuous travel").activityId === firstActivityId),
      "rebuilt long-rest activity",
    );
    const afterTravelCharacter = record(afterTravel.controlledCharacter, "character after strenuous travel");
    expect(afterTravelCharacter.sceneId).toBe("yard");
    expect(afterTravelCharacter.hitPoints).toEqual(before.hitPoints);
    expect(afterTravelCharacter.resources).toEqual(before.resources);

    const restarted = await commitIntent(
      authority,
      "submission:rest-eviction:restart",
      characterId,
      "局势安全后，我重新开始一段完整八小时长休。",
      {
        operation: "resolveRest",
        restKind: "long",
        hitDiceToSpend: 0,
        arcaneRecoverySlotLevels: [],
      },
    );
    expect({
      rebuiltActivityStatus: interruptedActivity.status,
      restartOutcomeKind: restarted.outcome.kind,
    }).toEqual({
      rebuiltActivityStatus: "interrupted",
      restartOutcomeKind: "committed",
    });
    const restartedActivityId = `activity:${restarted.action.rootActionId}`;

    await commitIntent(
      authority,
      "submission:rest-eviction:elapsed-after-restart",
      characterId,
      "保持休息，直到重新开始后的连续八小时完整经过。",
      {
        operation: "resolveDirectConsequences",
        duration: { unit: "hour", value: 8 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
    );
    await evictDurableObject(authority as never);

    const completion = await prepareIntent(
      authority,
      "submission:rest-eviction:complete-restarted",
      characterId,
      "结算重新开始后已满足条件的长休。",
    );
    const completionProposal = proposal(
      completion,
      "submission:rest-eviction:complete-restarted:proposal:1",
      { operation: "completeActivity", activityRef: restartedActivityId },
    );
    const completed = record(await authority.commit(
      ALICE,
      completion.preparedActionId,
      completionProposal,
    ), "restarted rest completion");
    expect(completed.kind, JSON.stringify(completed)).toBe("committed");

    const retry = record(await authority.commit(
      ALICE,
      completion.preparedActionId,
      structuredClone(completionProposal),
    ), "idempotent completion retry");
    expect(record(retry.receipt, "retry receipt").receiptId)
      .toBe(record(completed.receipt, "completion receipt").receiptId);

    const after = controlledCharacter(await authority.observe(ALICE));
    expect(record(after.hitPoints, "post-rest hit points")).toMatchObject({ current: 20, maximum: 20 });
    expect(record(after.resources, "post-rest resources")).toMatchObject({
      hitDice: 2,
      surge: 1,
      slot1: 2,
      resolve: 1,
    });

    const exported = record(await authority.exportAuthoritativeArchive(
      archiveExport,
    ), "authoritative archive export");
    const events = list(record(exported.archive, "authoritative archive").events, "archive events")
      .map((event) => record(event, "archive event"));
    expect(events.filter((event) => event.eventType === "ActivityInterrupted")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "RestCompleted")).toHaveLength(1);
  });
});
