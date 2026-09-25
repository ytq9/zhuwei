import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
    expect(from).toEqual({ eventSeq: fromEventSeq, projectionHash: fromProjectionHash });
    expect(to).toEqual({ eventSeq: String(currentRead.stateVersion), projectionHash: currentRead.projectionHash });
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
          sinceProjectionHash: to.projectionHash,
        },
      },
      {
        label: "tampered-hash",
        query: {
          ...anchoredQuery,
          sinceProjectionHash: `sha256:${"0".repeat(64)}`,
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

});
