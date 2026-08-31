import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { observationProposal } from "./helpers/authoritative-proposal";

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

async function commitObservation(
  authority: RestAuthority,
  submissionId: string,
  characterId: string,
  text: string,
  duration: { unit: "second" | "hour"; value: number },
) {
  const action = await prepareIntent(authority, submissionId, characterId, text);
  const proposal = observationProposal(action.rootActionId, {
    goal: text,
    method: text,
    duration,
    proposalAttemptId: `${submissionId}:proposal:1`,
  });
  const outcome = record(await authority.commit(
    ALICE,
    action.preparedActionId,
    proposal,
  ), `${submissionId} commit`);
  return { action, outcome, proposal };
}

async function commitRestStart(
  authority: RestAuthority,
  submissionId: string,
  restKind: "short" | "long",
  hitDiceToSpend = 0,
) {
  const action = prepared(await authority.prepare(ALICE, {
    kind: "restStart",
    submissionId,
    restKind,
    mode: "personal",
    hitDiceToSpend,
    arcaneRecoverySlotLevels: [],
  }));
  const proposal = {
    kind: "authenticatedRestStart",
    rootActionId: action.rootActionId,
  };
  const outcome = record(await authority.commit(
    ALICE,
    action.preparedActionId,
    proposal,
  ), `${submissionId} commit`);
  return { action, outcome, proposal };
}

async function commitRestInterrupt(
  authority: RestAuthority,
  submissionId: string,
) {
  const action = prepared(await authority.prepare(ALICE, {
    kind: "restInterrupt",
    submissionId,
  }));
  const proposal = {
    kind: "authenticatedRestInterrupt",
    rootActionId: action.rootActionId,
  };
  const outcome = record(await authority.commit(
    ALICE,
    action.preparedActionId,
    proposal,
  ), `${submissionId} commit`);
  return { action, outcome, proposal };
}

function readModel(observation: unknown): JsonRecord {
  return record(record(observation, "observation").readModel, "read model");
}

function controlledCharacter(observation: unknown): JsonRecord {
  return record(readModel(observation).controlledCharacter, "controlled character");
}

describe("long-rest Activity across Room DO eviction", () => {
  it("interrupts a rebuilt long rest before recovery, then completes one restarted rest when due", async () => {
    const roomId = "rest-activity-eviction-v2";
    const characterId = "character:rest-eviction:alice";
    const authority = env.ROOMS.getByName(roomId) as unknown as RestAuthority & DurableObjectStub;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
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

    const first = await commitRestStart(
      authority,
      "submission:rest-eviction:first-start",
      "long",
    );
    expect(first.outcome.kind, JSON.stringify(first.outcome)).toBe("committed");
    const firstActivityId = `activity:${first.action.rootActionId}`;

    await evictDurableObject(authority as never);

    const interruption = await commitRestInterrupt(
      authority,
      "submission:rest-eviction:interrupt",
    );
    expect(interruption.outcome.kind, JSON.stringify(interruption.outcome)).toBe("committed");

    const afterInterruption = readModel(await authority.observe(ALICE));
    const interruptedActivity = record(
      list(afterInterruption.activities, "activities after interruption")
        .find((entry) => record(entry, "activity after interruption").activityId === firstActivityId),
      "rebuilt long-rest activity",
    );
    const afterInterruptionCharacter = record(
      afterInterruption.controlledCharacter,
      "character after interruption",
    );
    expect(afterInterruptionCharacter.hitPoints).toEqual(before.hitPoints);
    expect(afterInterruptionCharacter.resources).toEqual(before.resources);

    const restarted = await commitRestStart(
      authority,
      "submission:rest-eviction:restart",
      "long",
    );
    expect({
      rebuiltActivityStatus: interruptedActivity.status,
      restartOutcomeKind: restarted.outcome.kind,
    }).toEqual({
      rebuiltActivityStatus: "interrupted",
      restartOutcomeKind: "committed",
    });
    const restartedActivityId = `activity:${restarted.action.rootActionId}`;

    const elapsed = await commitObservation(
      authority,
      "submission:rest-eviction:elapsed-after-restart",
      characterId,
      "保持休息，直到重新开始后的连续八小时完整经过。",
      { unit: "hour", value: 8 },
    );
    expect(elapsed.outcome.kind, JSON.stringify(elapsed.outcome)).toBe("committed");
    await evictDurableObject(authority as never);

    const completion = await prepareIntent(
      authority,
      "submission:rest-eviction:complete-restarted",
      characterId,
      "结算重新开始后已满足条件的长休。",
    );
    const completionProposal = observationProposal(completion.rootActionId, {
      goal: "确认重新开始后的长休已经到期并结算恢复。",
      method: "在当前地点确认休整结果。",
      duration: { unit: "second", value: 1 },
      proposalAttemptId: "submission:rest-eviction:complete-restarted:proposal:1",
    });
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
    const restCompleted = events.filter((event) => event.eventType === "RestCompleted");
    expect(restCompleted).toHaveLength(1);
    expect(restCompleted[0].rootActionId).toBe(
      `activity-due:${restartedActivityId}:28800000000`,
    );
  });
});
