import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { directConsequencesProposal } from "./helpers/authoritative-proposal";

type JsonRecord = Record<string, unknown>;

type RoomAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus(query: { publishCapability: unknown }): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:incremental:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:incremental:bob", sessionVersion: 1 }),
});
const BOB_PRIVATE_EVENT_SENTINEL = "BOB_PRIVATE_INCREMENTAL_EVENT_MUST_NOT_LEAK";

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

describe("SPEC 0010 continuous observer increments at Room observe", () => {
  it("projects one hash-bound continuous delta and collapses bad cursors or hashes to projectionIntegrity", async () => {
    const roomId = "observer-incremental-room-v2";
    const stub = authority(roomId);
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [
        { principalId: ALICE.principal.id, role: "player" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character("character:incremental:alice", ALICE.principal.id, "shrine"),
        character("character:incremental:bob", BOB.principal.id, "yard"),
      ],
    }), "initialization");
    expect(initialized).toMatchObject({ created: true });
    const administration = record(
      initialized.serviceCapabilities,
      "service capabilities",
    ).roomAdministration;

    const initial = record(await stub.observe(ALICE), "initial observation");
    const initialRead = record(initial.readModel, "initial read model");
    const fromEventSeq = String(initialRead.stateVersion);
    const fromProjectionHash = String(initialRead.projectionHash);

    await expect(stub.applyRoomAdministration(administration, {
      kind: "removeMember",
      commandId: "room-admin:incremental:remove-bob",
      principalId: BOB.principal.id,
      reason: BOB_PRIVATE_EVENT_SENTINEL,
    })).resolves.toMatchObject({ kind: "committed" });

    const current = record(await stub.observe(ALICE), "current snapshot");
    const currentRead = record(current.readModel, "current read model");
    const incremental = record(await stub.observe(ALICE, {
      sinceEventSeq: fromEventSeq,
    }), "incremental observation");
    const incrementalRead = record(incremental.readModel, "incremental read model");
    const delta = record(incrementalRead.incrementalDelta, "incremental delta");
    expect(delta.schema).toBe("zhuwei.observer-incremental-delta/v1");
    const from = record(delta.from, "delta from anchor");
    const to = record(delta.to, "delta to anchor");
    expect(from).toMatchObject({
      eventSeq: fromEventSeq,
      stateHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      eventHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      projectionHash: fromProjectionHash,
    });
    expect(to).toMatchObject({
      eventSeq: String(currentRead.stateVersion),
      stateHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      eventHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      projectionHash: currentRead.projectionHash,
    });
    expect(BigInt(String(to.eventSeq))).toBeGreaterThan(BigInt(String(from.eventSeq)));
    expect(list(delta.changes, "projected delta changes").length).toBeGreaterThan(0);
    expect(incrementalRead.stateVersion).toBe(currentRead.stateVersion);
    expect(incrementalRead.activeBranchId).toBe(currentRead.activeBranchId);

    const encoded = JSON.stringify(incremental);
    expect(encoded).not.toContain(BOB_PRIVATE_EVENT_SENTINEL);
    expect(encoded).not.toContain("eventType");
    expect(encoded).not.toContain("stateBeforeHash");
    expect(encoded).not.toContain("stateHashAfter");
    expect(encoded).not.toContain("previousEventHash");
    expect(encoded).not.toContain("payloadHash");

    const anchoredQuery = {
      sinceEventSeq: from.eventSeq,
      sinceStateHash: from.stateHash,
      sinceEventHash: from.eventHash,
      sinceProjectionHash: from.projectionHash,
    };
    await expect(stub.observe(ALICE, anchoredQuery)).resolves.toEqual(incremental);
    await evictDurableObject(stub as never);
    await expect(authority(roomId).observe(ALICE, structuredClone(anchoredQuery)))
      .resolves.toEqual(incremental);

    const badCases = [
      { label: "missing", query: { sinceEventSeq: null } },
      {
        label: "jumped",
        query: { sinceEventSeq: (BigInt(String(to.eventSeq)) + 1n).toString() },
      },
      {
        label: "wrong-start",
        query: {
          ...anchoredQuery,
          sinceStateHash: to.stateHash,
        },
      },
      {
        label: "tampered-hash",
        query: {
          ...anchoredQuery,
          sinceProjectionHash: `sha256:${"0".repeat(64)}`,
        },
      },
      {
        label: "tampered-event-hash",
        query: {
          ...anchoredQuery,
          sinceEventHash: `sha256:${"f".repeat(64)}`,
        },
      },
    ];
    for (const candidate of badCases) {
      const rejected = record(
        await stub.observe(ALICE, candidate.query),
        `${candidate.label} incremental rejection`,
      );
      expect(rejected).toEqual({
        kind: "retryableFailure",
        code: "projectionIntegrity",
      });
      const rejection = JSON.stringify(rejected);
      expect(rejection).not.toContain(BOB_PRIVATE_EVENT_SENTINEL);
    }
  });

  it("does not let lifecycle viewers or isolated hash anchors bypass incremental validation", async () => {
    const roomId = "observer-incremental-room-v2-lifecycle";
    const stub = authority(roomId);
    await expect(stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "player" }],
      characters: [{
        characterId: "character:incremental:lifecycle",
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "临界生命角色",
          sceneId: "wake",
          classId: "fighter",
          raceId: "human",
          subclassId: "champion",
          level: 3,
          scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
          proficiency: 2,
          skills: ["athletics"],
          hp: { current: 1, max: 18, temp: 0 },
          ac: 17,
          speed: 30,
          resources: { resolve: 2 },
          equipped: { armor: "chain" },
          backpack: [],
        },
      }],
    })).resolves.toMatchObject({ created: true });

    const before = record(await stub.observe(ALICE), "pre-lifecycle observation");
    const beforeRead = record(before.readModel, "pre-lifecycle read model");
    const fatal = record(await handleRoomAction({
      principal: ALICE,
      authority: stub,
      kp: {
        async propose(request) {
          return directConsequencesProposal(String(record(request, "fatal request").rootActionId), {
            proposalAttemptId: "proposal:incremental:lifecycle:fatal",
            goal: "结算已经冻结的致命冲击",
            method: "承受致命冲击",
            duration: { unit: "second", value: 1 },
            success: [{
              kind: "changeHitPoints",
              targetRef: "character:incremental:lifecycle",
              amount: -1,
            }],
          });
        },
        async narrate() {
          return { body: "角色倒下，等待选择继任者。", agencyClaims: [] };
        },
      },
    }, {
      kind: "intent",
      submissionId: "submission:incremental:lifecycle:fatal",
      text: "结算已经冻结的致命冲击。",
    }), "fatal outcome");
    expect(fatal).toMatchObject({
      kind: "committed",
      readModel: {
        controlledCharacter: null,
        lifecycle: { kind: "successorRequired" },
      },
    });

    const lifecycleDelta = record(await stub.observe(ALICE, {
      sinceEventSeq: beforeRead.stateVersion,
      sinceProjectionHash: beforeRead.projectionHash,
    }), "lifecycle incremental observation");
    expect(lifecycleDelta).toMatchObject({
      readModel: {
        controlledCharacter: null,
        lifecycle: { kind: "successorRequired" },
        incrementalDelta: {
          schema: "zhuwei.observer-incremental-delta/v1",
          from: {
            eventSeq: beforeRead.stateVersion,
            projectionHash: beforeRead.projectionHash,
          },
          to: { eventSeq: expect.any(String), projectionHash: expect.any(String) },
          changes: expect.any(Array),
        },
      },
    });
    expect(JSON.stringify(lifecycleDelta)).not.toContain("eventType");

    const malformed = { kind: "retryableFailure", code: "projectionIntegrity" };
    await expect(stub.observe(ALICE, { sinceEventSeq: null })).resolves.toEqual(malformed);
    await expect(stub.observe(ALICE, {
      sinceProjectionHash: beforeRead.projectionHash,
    })).resolves.toEqual(malformed);
    await expect(stub.observe(ALICE, {
      sinceStateHash: `sha256:${"0".repeat(64)}`,
    })).resolves.toEqual(malformed);
    await expect(stub.observe(ALICE, {
      sinceEventHash: `sha256:${"f".repeat(64)}`,
    })).resolves.toEqual(malformed);
  });
});
