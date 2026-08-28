import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { directConsequencesProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:safety-room:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:safety-room:bob", sessionVersion: 1 }),
});
const ALICE_ID = "character:safety-room:alice";
const BOB_ID = "character:safety-room:bob";
const SAFETY_INVALIDATED_BODY = "SAFETY_INVALIDATED_BODY_MUST_NOT_ENTER_TRANSCRIPT";

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
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

function character(characterId: string, controllerPrincipalId: string, name: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name,
      sceneId: "wake",
      abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
      proficiencyBonus: 2,
      proficientSkills: ["perception"],
      hp: { current: 9, max: 12, temp: 0 },
      resources: { hitDice: { current: 2, maximum: 2 } },
    },
  };
}

async function initialize(roomId: string) {
  const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
  const initialized = record(await authority.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      { principalId: BOB.principal.id, role: "player" },
    ],
    characters: [
      character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
      character(BOB_ID, BOB.principal.id, "博林"),
    ],
  }), "initialization");
  expect(initialized.created, JSON.stringify(initialized)).toBe(true);
  return {
    authority,
    archiveExport: record(initialized.serviceCapabilities, "service capabilities").archiveExport,
  };
}

async function observation(authority: Authority, principal: typeof ALICE | typeof BOB) {
  const observed = record(await authority.observe(principal), "observation");
  return {
    observed,
    readModel: record(observed.readModel, "read model"),
    delivery: record(observed.delivery, "delivery"),
  };
}

function stableFictionAndMechanics(readModel: JsonRecord) {
  const controlled = record(readModel.controlledCharacter, "controlled character");
  return {
    fictionTime: structuredClone(readModel.fictionTime),
    hitPoints: structuredClone(controlled.hitPoints),
    resources: structuredClone(controlled.resources),
    spotlightLedger: structuredClone(readModel.spotlightLedger),
  };
}

function noKp(label: string) {
  return {
    propose: async () => { throw new Error(`${label} must not call KP propose`); },
    narrate: async () => { throw new Error(`${label} must not call KP narrate`); },
  };
}

describe("production safety pause authority path", () => {
  it("commits privately, freezes the world, survives eviction, and only the requester can adjust", async () => {
    const roomId = "safety-pause-room-v2-private-recovery";
    const initialized = await initialize(roomId);
    let { authority } = initialized;
    const { archiveExport } = initialized;

    const opening = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        propose: async (request: JsonRecord) => directConsequencesProposal(
          String(request.rootActionId),
          { duration: { unit: "second", value: 1 } },
        ),
        narrate: async ({ audienceId }: JsonRecord) => ({
          body: `${SAFETY_INVALIDATED_BODY}:${String(audienceId)}`,
          agencyClaims: [],
        }),
      },
    }, {
      kind: "intent",
      submissionId: "submission:safety-room:opening",
      text: "我在大厅确认周围状况。",
    }), "opening outcome");
    expect(opening.kind, JSON.stringify(opening)).toBe("committed");

    const beforeAlice = await observation(authority, ALICE);
    const beforeBob = await observation(authority, BOB);
    expect(beforeAlice.delivery.kind).toBe("current");
    expect(beforeBob.delivery.kind).toBe("current");
    const aliceStable = stableFictionAndMechanics(beforeAlice.readModel);
    const bobStable = stableFictionAndMechanics(beforeBob.readModel);

    const reasonRejected = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: noKp("invalid safety pause"),
    }, {
      kind: "safetyPause",
      submissionId: "submission:safety-room:reason-rejected",
      reason: "不得进入 transport、事件或状态",
    } as never), "reason rejection");
    expect(reasonRejected).toMatchObject({ kind: "rejected", code: "validation" });

    const paused = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: noKp("safety pause"),
    }, {
      kind: "safetyPause",
      submissionId: "submission:safety-room:pause",
    } as never), "pause outcome");
    expect(paused.kind, JSON.stringify(paused)).toBe("committed");
    const pauseReceipt = record(paused.receipt, "pause receipt");
    const pausedRead = record(paused.readModel, "paused read model");
    expect(pausedRead.safetyPresentation).toEqual({
      status: "paused",
      presentationAdjustment: null,
    });
    expect(record(paused.delivery, "paused delivery").kind).toBe("none");
    expect(stableFictionAndMechanics(pausedRead)).toEqual(aliceStable);

    const aliceDuringPause = await observation(authority, ALICE);
    expect(aliceDuringPause.delivery).toEqual({ kind: "none" });
    expect(JSON.stringify(aliceDuringPause.observed.transcript))
      .not.toContain(SAFETY_INVALIDATED_BODY);

    const bobDuringPause = await observation(authority, BOB);
    expect(bobDuringPause.readModel).not.toHaveProperty("safetyPresentation");
    expect(JSON.stringify(bobDuringPause.readModel)).not.toContain("SafetyPauseRequested");
    expect(JSON.stringify(bobDuringPause.readModel)).not.toContain("submission:safety-room:pause");
    expect(bobDuringPause.delivery).toEqual({ kind: "none" });
    expect(JSON.stringify(bobDuringPause.observed.transcript))
      .not.toContain(SAFETY_INVALIDATED_BODY);
    expect(stableFictionAndMechanics(bobDuringPause.readModel)).toEqual(bobStable);

    const blockedRevision = String(bobDuringPause.readModel.worldRevision);
    const blocked = record(await handleRoomAction({
      principal: BOB,
      authority,
      kp: noKp("blocked world action"),
    }, {
      kind: "intent",
      submissionId: "submission:safety-room:blocked-bob",
      text: "我尝试推进世界。",
    }), "blocked action");
    expect(blocked).toMatchObject({
      kind: "rejected",
      code: "presentationUnavailable",
      explanation: "当前呈现不可用，请保持在已提交的稳定状态。",
    });
    expect(String((await observation(authority, BOB)).readModel.worldRevision)).toBe(blockedRevision);

    await evictDurableObject(authority as never);
    authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const afterEviction = await observation(authority, ALICE);
    expect(afterEviction.readModel.safetyPresentation).toEqual({
      status: "paused",
      presentationAdjustment: null,
    });
    expect(afterEviction.delivery).toEqual({ kind: "none" });

    const duplicate = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: noKp("idempotent safety pause"),
    }, {
      kind: "safetyPause",
      submissionId: "submission:safety-room:pause",
    } as never), "duplicate pause outcome");
    expect(record(duplicate.receipt, "duplicate receipt").receiptId).toBe(pauseReceipt.receiptId);

    const bobCannotAdjust = record(await handleRoomAction({
      principal: BOB,
      authority,
      kp: noKp("unauthorized adjustment"),
    }, {
      kind: "safetyAdjust",
      submissionId: "submission:safety-room:bob-adjusts",
      presentationAdjustment: "fadeToBlack",
    } as never), "unauthorized adjustment");
    expect(bobCannotAdjust).toMatchObject({
      kind: "rejected",
      code: "presentationUnavailable",
      explanation: "当前呈现不可用，请保持在已提交的稳定状态。",
    });

    const adjusted = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: noKp("safety adjustment"),
    }, {
      kind: "safetyAdjust",
      submissionId: "submission:safety-room:adjust",
      presentationAdjustment: "fadeToBlack",
    } as never), "adjustment outcome");
    expect(adjusted.kind, JSON.stringify(adjusted)).toBe("committed");
    expect(record(adjusted.readModel, "adjusted read model").safetyPresentation).toEqual({
      status: "resumed",
      presentationAdjustment: "fadeToBlack",
    });
    expect(stableFictionAndMechanics(record(adjusted.readModel, "adjusted read model")))
      .toEqual(aliceStable);

    const exported = record(
      await authority.exportAuthoritativeArchive(archiveExport),
      "archive export",
    );
    const events = list(record(exported.archive, "archive").events, "events")
      .map((entry) => record(entry, "event"));
    const safetyEvents = events.filter((event) =>
      event.eventType === "SafetyPauseRequested"
        || event.eventType === "SafetyPresentationAdjusted");
    expect(safetyEvents.map((event) => event.eventType)).toEqual([
      "SafetyPauseRequested",
      "SafetyPresentationAdjusted",
    ]);
    expect(safetyEvents.every((event) => event.secrecy === "private")).toBe(true);
    expect(JSON.stringify(safetyEvents)).not.toContain("reason");
    expect(safetyEvents.filter((event) =>
      event.rootActionId === "root-action:submission:safety-room:pause")).toHaveLength(1);
  });

  it("supersedes an in-flight narration capability so sensitive text cannot arrive after pause", async () => {
    const roomId = "safety-pause-room-v2-inflight-publication";
    const { authority } = await initialize(roomId);
    let narrationStartedResolve!: () => void;
    let narrationRelease!: () => void;
    const narrationStarted = new Promise<void>((resolve) => { narrationStartedResolve = resolve; });
    const narrationGate = new Promise<void>((resolve) => { narrationRelease = resolve; });
    let narrationCalls = 0;

    const inFlightAction = handleRoomAction({
      principal: ALICE,
      authority,
      kp: {
        propose: async (request: JsonRecord) => directConsequencesProposal(
          String(request.rootActionId),
          { duration: { unit: "second", value: 1 } },
        ),
        narrate: async () => {
          narrationCalls += 1;
          narrationStartedResolve();
          await narrationGate;
          return {
            body: "这段敏感正文绝不能在安全暂停后到达任何 Viewer。",
            agencyClaims: [],
          };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:safety-room:inflight",
      text: "触发一段需要被安全暂停截断的叙述。",
    });
    await narrationStarted;

    const paused = record(await handleRoomAction({
      principal: ALICE,
      authority,
      kp: noKp("in-flight safety pause"),
    }, {
      kind: "safetyPause",
      submissionId: "submission:safety-room:inflight-pause",
    } as never), "in-flight pause outcome");
    expect(paused.kind, JSON.stringify(paused)).toBe("committed");
    narrationRelease();

    const original = record(await inFlightAction, "original in-flight outcome");
    expect(original.kind).toBe("committed");
    expect(original.deliveryPending).toBe(true);
    expect(narrationCalls).toBeGreaterThan(0);
    for (const principal of [ALICE, BOB]) {
      const observed = await observation(authority, principal);
      expect(observed.delivery).toEqual({ kind: "none" });
      expect(JSON.stringify(observed.observed)).not.toContain("这段敏感正文");
    }
  });
});
