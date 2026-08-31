import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:environment-zone:alice", sessionVersion: 1 }),
});
const ALICE_ID = "character:environment-zone:alice";

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function authority(name: string): Authority {
  return env.ROOMS.getByName(name) as unknown as Authority;
}

function readModel(observation: unknown): JsonRecord {
  return record(record(observation, "Room observation").readModel, "Room read model");
}

function tacticalProjection(observation: unknown): JsonRecord {
  return record(readModel(observation).tacticalProjection, "tactical projection");
}

function controlledAbilityDefinitions(observation: unknown): JsonRecord[] {
  const controlled = record(readModel(observation).controlledCharacter, "controlled character");
  const combat = record(controlled.combat, "controlled combat projection");
  return Object.values(record(combat.definitions, "controlled ability definitions"))
    .map((definition) => record(definition, "controlled ability definition"));
}

function roomActionContext(room: Authority, proposeCount: { value: number }) {
  return {
    principal: ALICE,
    authority: room,
    kp: {
      async propose() {
        proposeCount.value += 1;
        throw new Error("closed area ability input must not ask KP to reconstruct mechanics");
      },
      async narrate() {
        return { body: "浓雾覆盖了指定区域。", agencyClaims: [] };
      },
    },
  };
}

async function initializeTacticalRoom(roomId: string) {
  const room = authority(roomId);
  const initialized = record(await room.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{
      characterId: ALICE_ID,
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "阿莱莎",
        sceneId: "wake",
        classId: "ranger",
        raceId: "human",
        subclassId: "hunter",
        level: 3,
        abilityScores: { str: 8, dex: 14, con: 14, int: 12, wis: 18, cha: 10 },
        proficiencyBonus: 2,
        proficientSkills: ["survival"],
        hp: { current: 18, max: 18, temp: 0 },
        ac: 12,
        speed: 30,
        prepared: ["fog"],
        resources: { slot1: 2 },
        equipped: {},
        backpack: [],
      },
    }],
  }), "tactical zone Room initialization");
  expect(initialized.created, JSON.stringify(initialized)).toBe(true);
  return {
    room,
    capabilities: record(initialized.serviceCapabilities, "Room service capabilities"),
  };
}

function closedFogInput(abilityRef: string, position: JsonRecord) {
  return {
    kind: "ability" as const,
    submissionId: "submission:environment-zone:create-fog",
    abilityRef,
    parameters: {
      areaOrigin: {
        x: String(position.x),
        y: String(position.y),
        elevation: String(position.elevation),
      },
      slotLevel: "1",
    },
  };
}

describe("SPEC 0014 TM09 persistent environment zone Room vertical", () => {
  it("exposes the real SRD 2014 fog area concentration definition to its controlling player", async () => {
    const source = await initializeTacticalRoom("environment-zone-room-v2-definition-red");
    const observation = await source.room.observe(ALICE);

    // `fog` comes from the SRD 2014 catalog and must reach this public projection
    // through the production character compiler without an injected definition.
    const fog = controlledAbilityDefinitions(observation)
      .find((definition) => definition.mechanicalKey === "spell:fog");
    expect(fog, JSON.stringify(controlledAbilityDefinitions(observation))).toBeDefined();
    expect(fog).toMatchObject({
      revision: "1",
      rulesBasis: "srd5.1-2014",
      sourceSpellId: "fog",
      target: {
        kind: "area",
        rangeInches: "1440",
        shape: { kind: "sphere", radiusInches: "240", propagation: "straight" },
      },
      effect: { kind: "concentration", durationMicros: "3600000000" },
      effects: [{ tag: "heavily-obscured", kind: "area" }],
    });
  });

  it("rejects client-computed zone fields and safely defers the closed fog ability without calling KP or changing state", async () => {
    const source = await initializeTacticalRoom("environment-zone-room-v2-action-algebra-red");
    const observation = await source.room.observe(ALICE);
    const fog = controlledAbilityDefinitions(observation)
      .find((definition) => definition.mechanicalKey === "spell:fog");
    expect(fog).toBeDefined();

    const self = record(tacticalProjection(observation).self, "tactical self");
    const input = closedFogInput(
      String(fog!.definitionId),
      record(self.position, "tactical self position"),
    );
    const proposeCount = { value: 0 };
    const before = await source.room.observe(ALICE);

    const forged = await handleRoomAction(
      roomActionContext(source.room, proposeCount),
      {
        ...input,
        parameters: {
          ...input.parameters,
          targetIds: [ALICE_ID],
          affectedEntityIds: [ALICE_ID],
          zone: { id: "zone:forged" },
          duration: "forever",
          effect: { kind: "forged" },
          visibility: "public",
          geometry: { kind: "client-patch" },
          state: { active: true },
        },
      } as never,
    );
    expect(forged).toMatchObject({ kind: "rejected", code: "validation" });
    expect(proposeCount.value).toBe(0);

    const outcome = record(await handleRoomAction(
      roomActionContext(source.room, proposeCount),
      input as never,
    ), "closed area ability outcome");
    expect(proposeCount.value).toBe(0);
    expect(outcome).toEqual({
      kind: "rejected",
      code: "tacticalMapAbilityDeferred",
      explanation: "地图点选区域施法后续支持；请继续使用当前已有的战斗操作。",
      action: "notCommitted",
      narration: "notApplicable",
    });
    expect(await source.room.observe(ALICE)).toEqual(before);
    expect(tacticalProjection(before).knownZones).toEqual([]);
  });

  it.skip("creates one viewer-safe typed zone, restores it into a fresh DO, and deduplicates the submission without extra slot or randomness", async () => {
    // Enable after the closed `ability` action reaches Rules. Assert knownZones
    // id/sourceRef/geometry/start/expiry, one typed zone-created archive event,
    // fresh-DO projection equality, and identical receipt/resource/randomness on
    // duplicate submission. Archive export is service evidence only.
  });

  it.skip("keeps the zone before expiry, ends it exactly once at authoritative fiction time, and never revives it after reconnect, eviction, or replay", async () => {
    // Enable after zone creation is GREEN and use only the existing closed Room
    // fiction-time action. Projection must omit the zone immediately at expiry;
    // archive/retry/restore must contain exactly one causal end event.
  });

  it.skip("atomically removes a concentration zone through a real public concentration-end action and keeps it ended across retry and replay", async () => {
    // There is an internal Rules `endConcentration` command but no closed public
    // Room seam today. Do not manufacture the command or an event in this test.
  });
});
