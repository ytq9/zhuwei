import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:tactical-room:alice", sessionVersion: 1 }),
});
const ALICE_ID = "character:tactical-room:alice";
const OBSERVER_ID = "principal:tactical-room:observer";
const HIDDEN_NPC_ID = "npc:tactical-room:hidden-watch";
const HIDDEN_SENTINEL = "secret:tactical-room:hidden-watch-route";
const HIDDEN_REVISION_SENTINEL = "secret:tactical-room:observer-removal";

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

function tacticalProjection(readModelValue: unknown): JsonRecord {
  const readModel = record(readModelValue, "viewer read model");
  return record(readModel.tacticalProjection, "viewer tactical projection");
}

describe("SPEC 0014 authoritative tactical scene Room vertical", () => {
  it("persists non-empty scene geometry, projects only the viewer-safe tactical map, and restores it equivalently", async () => {
    const source = env.ROOMS.getByName("tactical-scene-room-source-v2") as unknown as Authority;
    const initialized = record(await source.initializeAuthoritative({
      roomId: "tactical-scene-room-source-v2",
      moduleId: "black-oak-will",
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: OBSERVER_ID, role: "observer" },
      ],
      characters: [{
        characterId: ALICE_ID,
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "wake",
          scores: { str: 10, dex: 12, con: 12, int: 14, wis: 12, cha: 10 },
          proficiency: 2,
          hp: { current: 20, max: 20, temp: 0 },
          equipped: {},
          backpack: [],
        },
      }],
      fixtureFacts: [{
        knowledgeRef: "knowledge:tactical-room:hidden-watch-route",
        holderEntityId: HIDDEN_NPC_ID,
        holderName: "暗处守望者",
        sceneId: "wake",
        content: { route: HIDDEN_SENTINEL },
      }],
    }), "authoritative tactical room initialization");
    expect(initialized.created, JSON.stringify(initialized)).toBe(true);
    const capabilities = record(initialized.serviceCapabilities, "Room service capabilities");

    const beforeNonSpatialChange = record(await source.observe(ALICE), "initial source observation");
    const beforeTactical = tacticalProjection(
      record(beforeNonSpatialChange.readModel, "initial source read model"),
    );
    await expect(source.applyRoomAdministration(capabilities.roomAdministration, {
      kind: "removeMember",
      commandId: "room-admin:tactical-remove-observer",
      principalId: OBSERVER_ID,
      reason: HIDDEN_REVISION_SENTINEL,
    })).resolves.toMatchObject({ kind: "committed" });

    const sourceObservation = record(await source.observe(ALICE), "source observation");
    const sourceReadModel = record(sourceObservation.readModel, "source read model");
    const sourceTactical = tacticalProjection(sourceReadModel);
    expect(sourceTactical).toEqual(beforeTactical);
    expect(sourceTactical.spatialRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(sourceObservation)).not.toContain(HIDDEN_SENTINEL);
    expect(JSON.stringify(sourceObservation)).not.toContain(HIDDEN_NPC_ID);
    expect(JSON.stringify(sourceObservation)).not.toContain(HIDDEN_REVISION_SENTINEL);

    const exported = record(
      await source.exportAuthoritativeArchive(capabilities.archiveExport),
      "authoritative tactical archive export",
    );
    expect(exported.kind).toBe("exported");
    const archive = record(exported.archive, "authoritative tactical archive");
    const genesis = record(archive.signedGenesis, "signed tactical genesis");
    const initialState = record(genesis.initialState, "tactical genesis state");
    const combatRuntime = record(initialState.combatRuntime, "tactical combat runtime");
    const scenes = record(combatRuntime.scenes, "tactical scenes");
    const wakeScene = record(scenes.wake, "wake tactical scene");
    const geometry = record(wakeScene.geometry, "wake authoritative geometry");

    // SPEC 0014 makes non-empty, replayable scene geometry the first production
    // invariant. A boundary plus at least one real feature prevents the current
    // empty-obstacle placeholder from masquerading as authoritative space.
    expect(geometry).toMatchObject({ unit: "inch" });
    expect(record(geometry.boundary, "wake scene boundary")).toMatchObject({
      kind: "polygon",
    });
    expect(list(geometry.obstacles, "wake scene obstacles").length).toBeGreaterThan(0);

    expect(sourceTactical).toMatchObject({
      schema: "zhuwei.tactical-projection/v1",
      scene: { id: "wake", gridInches: 60 },
      self: {
        id: ALICE_ID,
        position: { elevation: "0" },
        footprint: { height: "60" },
      },
    });
    expect(list(sourceTactical.knownFeatures, "known tactical features").length)
      .toBeGreaterThan(0);
    expect(record(sourceTactical.textualReadout, "same-source tactical readout"))
      .toHaveProperty("sceneId", "wake");
    expect(JSON.stringify(sourceTactical)).not.toContain(HIDDEN_SENTINEL);
    expect(JSON.stringify(sourceTactical)).not.toContain(HIDDEN_NPC_ID);

    const restored = env.ROOMS.getByName("tactical-scene-room-restored-v2") as unknown as Authority;
    await expect(restored.restoreAuthoritativeArchive(
      capabilities.disasterRecovery,
      structuredClone(archive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    const restoredObservation = record(await restored.observe(ALICE), "restored observation");
    const restoredTactical = tacticalProjection(
      record(restoredObservation.readModel, "restored read model"),
    );
    expect(restoredTactical).toEqual(sourceTactical);
    expect(JSON.stringify(restoredObservation)).not.toContain(HIDDEN_SENTINEL);
    expect(JSON.stringify(restoredObservation)).not.toContain(HIDDEN_NPC_ID);
  });
});
