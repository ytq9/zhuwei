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

const HOST = Object.freeze({
  principal: Object.freeze({ id: "principal:tactical-spawn:host", sessionVersion: 1 }),
});

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

function position(value: unknown, label: string): JsonRecord {
  const result = record(value, label);
  expect(result).toEqual({
    x: expect.any(String),
    y: expect.any(String),
    elevation: expect.any(String),
  });
  return result;
}

function positionKey(value: JsonRecord): string {
  return `${String(value.x)}\u0000${String(value.y)}\u0000${String(value.elevation)}`;
}

function character(characterId: string, principalId: string) {
  return {
    characterId,
    controllerPrincipalId: principalId,
    staticCard: {
      name: characterId,
      sceneId: "wake",
      abilityScores: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: [],
    },
  };
}

function tacticalProjection(observation: unknown): JsonRecord {
  const readModel = record(record(observation, "observation").readModel, "read model");
  return record(readModel.tacticalProjection, "tactical projection");
}

describe("SPEC 0014 tactical dynamic character spawn allocation", () => {
  it("assigns module-pinned free spawns to joined characters, rejects exhaustion, and replays exactly", async () => {
    const roomId = "tactical-dynamic-character-room-v2";
    const source = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await source.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: HOST.principal.id, role: "host" }],
      characters: [character("character:tactical-spawn:host", HOST.principal.id)],
    }), "tactical room initialization");
    expect(initialized).toMatchObject({ created: true });
    const capabilities = record(initialized.serviceCapabilities, "service capabilities");

    const initialProjection = tacticalProjection(await source.observe(HOST));
    const occupiedPositions = new Set([
      positionKey(position(record(initialProjection.self, "initial self").position, "initial self position")),
      ...list(initialProjection.visibleEntities, "initial visible entities")
        .map((entry, index) => positionKey(position(
          record(entry, `initial visible entity ${index}`).position,
          `initial visible position ${index}`,
        ))),
    ]);
    const initialExport = record(
      await source.exportAuthoritativeArchive(capabilities.archiveExport),
      "initial archive export",
    );
    const initialArchive = record(initialExport.archive, "initial archive");
    const initialState = record(
      record(initialArchive.signedGenesis, "signed genesis").initialState,
      "initial state",
    );
    const wakeGeometry = record(
      record(
        record(initialState.combatRuntime, "combat runtime").scenes,
        "combat scenes",
      ).wake,
      "wake scene",
    ).geometry;
    const expectedFreeSpawns = list(
      record(wakeGeometry, "wake geometry").spawnPoints,
      "wake spawn points",
    )
      .map((entry, index) => position(entry, `wake spawn ${index}`))
      .filter((entry) => !occupiedPositions.has(positionKey(entry)));
    expect(expectedFreeSpawns.length).toBeGreaterThan(0);

    const joinedViewers: Array<{ principal: { id: string; sessionVersion: number } }> = [];
    for (const [index, expectedSpawn] of expectedFreeSpawns.entries()) {
      const principal = {
        principal: {
          id: `principal:tactical-spawn:joined:${index}`,
          sessionVersion: 1,
        },
      };
      joinedViewers.push(principal);
      const characterId = `character:tactical-spawn:joined:${index}`;
      await expect(source.applyRoomAdministration(capabilities.roomAdministration, {
        commandId: `room-admin:tactical-spawn:join:${index}`,
        kind: "grantSeat",
        principal: principal.principal,
        role: "player",
        character: character(characterId, principal.principal.id),
      })).resolves.toMatchObject({ kind: "committed" });
      expect(position(
        record(tacticalProjection(await source.observe(principal)).self, "joined self").position,
        "joined self position",
      )).toEqual(expectedSpawn);
    }

    const overflowPrincipal = {
      id: "principal:tactical-spawn:overflow",
      sessionVersion: 1,
    };
    await expect(source.applyRoomAdministration(capabilities.roomAdministration, {
      commandId: "room-admin:tactical-spawn:overflow",
      kind: "grantSeat",
      principal: overflowPrincipal,
      role: "player",
      character: character("character:tactical-spawn:overflow", overflowPrincipal.id),
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "spatialCapacityUnavailable",
    });

    const firstJoinedSourceProjection = tacticalProjection(await source.observe(joinedViewers[0]));
    const exported = record(
      await source.exportAuthoritativeArchive(capabilities.archiveExport),
      "joined archive export",
    );
    const archive = record(exported.archive, "joined archive");
    const restored = env.ROOMS.getByName(`${roomId}-restored`) as unknown as Authority;
    await expect(restored.restoreAuthoritativeArchive(
      capabilities.disasterRecovery,
      structuredClone(archive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(tacticalProjection(await restored.observe(joinedViewers[0])))
      .toEqual(firstJoinedSourceProjection);
  });
});
