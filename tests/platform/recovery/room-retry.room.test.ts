import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../../../app/_runtime/lib/room/action";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/manifests";

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

});
