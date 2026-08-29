import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";

type JsonRecord = Record<string, unknown>;

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  deliveryPublicationStatus(query: { publishCapability: unknown }): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
  restoreAuthoritativeArchive(capability: unknown, archive: unknown): Promise<unknown>;
};

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:portal-room:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:portal-room:bob", sessionVersion: 1 }),
});
const PUBLIC_DOOR_ID = "feature:yard:cellar-door";
const HIDDEN_DOOR_ID = "feature:yard:hidden-passage";

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

function authority(name: string): Authority {
  return env.ROOMS.getByName(name) as unknown as Authority;
}

function character(characterId: string, controllerPrincipalId: string, sceneId: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name: characterId,
      sceneId,
      classId: "fighter",
      raceId: "human",
      subclassId: "champion",
      level: 3,
      scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      proficiency: 2,
      hp: { current: 24, max: 24, temp: 0 },
      ac: 17,
      speed: 30,
      equipped: { armor: "chain" },
      backpack: [],
    },
  };
}

function context(principal: typeof ALICE | typeof BOB, room: Authority, proposeCount: { value: number }) {
  return {
    principal,
    authority: room,
    kp: {
      async propose() {
        proposeCount.value += 1;
        throw new Error("closed portal interaction must not ask KP to reconstruct mechanics");
      },
      async narrate() {
        return { body: "通路状态已经改变。", agencyClaims: [] };
      },
    },
  };
}

function readModel(value: unknown): JsonRecord {
  return record(record(value, "Room observation").readModel, "Room read model");
}

function tacticalFeature(value: unknown, featureId = PUBLIC_DOOR_ID): JsonRecord {
  const tactical = record(readModel(value).tacticalProjection, "tactical projection");
  const feature = list(tactical.knownFeatures, "known tactical features")
    .map((entry) => record(entry, "known tactical feature"))
    .find((entry) => entry.id === featureId);
  expect(feature, `known feature ${featureId}`).toBeDefined();
  return feature!;
}

function portalAction(submissionId: string, intent: "open" | "close", featureId = PUBLIC_DOOR_ID) {
  return {
    kind: "environmentInteract" as const,
    submissionId,
    featureId,
    intent,
  };
}

async function initializeTactical(name: string) {
  const room = authority(name);
  const initialized = record(await room.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      { principalId: BOB.principal.id, role: "player" },
    ],
    characters: [
      character("character:portal-room:alice", ALICE.principal.id, "yard"),
      character("character:portal-room:bob", BOB.principal.id, "wake"),
    ],
  }), "tactical Room initialization");
  expect(initialized.created, JSON.stringify(initialized)).toBe(true);
  return {
    room,
    capabilities: record(initialized.serviceCapabilities, "service capabilities"),
  };
}

describe("SPEC 0014 Room portal finite-state vertical", () => {
  it("opens and closes one pinned door through Action/step/event/project and archive replay", async () => {
    const source = await initializeTactical("environment-portal-room-v2-source");
    const proposed = { value: 0 };
    expect(tacticalFeature(await source.room.observe(ALICE))).toMatchObject({
      state: "closed",
      opaque: true,
      impassable: true,
      cover: "full",
      propagation: "blocks",
    });

    const openInput = portalAction("submission:portal-room:open", "open");
    const opened = record(await handleRoomAction(
      context(ALICE, source.room, proposed),
      openInput as never,
    ), "open outcome");
    expect(opened).toMatchObject({
      kind: "committed",
      receipt: { status: "committed", eventRange: { first: expect.any(String) } },
    });
    expect(proposed.value).toBe(0);
    const openReceipt = structuredClone(record(opened.receipt, "open receipt"));
    const openedObservation = await source.room.observe(ALICE);
    expect(tacticalFeature(openedObservation)).toMatchObject({
      state: "open",
      opaque: false,
      impassable: false,
      cover: "none",
      propagation: "passes",
    });

    const duplicate = record(await handleRoomAction(
      context(ALICE, source.room, proposed),
      structuredClone(openInput) as never,
    ), "idempotent open outcome");
    expect(duplicate.receipt).toEqual(openReceipt);
    expect(proposed.value).toBe(0);
    await expect(handleRoomAction(
      context(ALICE, source.room, proposed),
      portalAction(openInput.submissionId, "close") as never,
    )).resolves.toMatchObject({ kind: "rejected", code: "idempotencyPayloadMismatch" });
    expect(tacticalFeature(await source.room.observe(ALICE))).toMatchObject({ state: "open" });

    const exportedOpen = record(await source.room.exportAuthoritativeArchive(
      source.capabilities.archiveExport,
    ), "open archive export");
    const openArchive = record(exportedOpen.archive, "open archive");
    const environmentEvent = list(openArchive.events, "open archive events")
      .map((entry) => record(entry, "open archive event"))
      .find((event) => event.eventType === "EnvironmentFeatureStateChanged");
    expect(environmentEvent).toBeDefined();
    expect(record(environmentEvent!.payload, "environment event payload")).toEqual({
      actorCharacterId: "character:portal-room:alice",
      definitionId: "environment-definition:feature:yard:cellar-door:open-closed-destroyed-v1",
      featureId: PUBLIC_DOOR_ID,
      fromState: "closed",
      intent: "open",
      sceneId: "yard",
      toState: "open",
    });

    const restoredOpen = authority("environment-portal-room-v2-restored-open");
    await expect(restoredOpen.restoreAuthoritativeArchive(
      source.capabilities.disasterRecovery,
      structuredClone(openArchive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(tacticalFeature(await restoredOpen.observe(ALICE)))
      .toEqual(tacticalFeature(openedObservation));

    await expect(handleRoomAction(
      context(ALICE, restoredOpen, proposed),
      portalAction("submission:portal-room:close", "close") as never,
    )).resolves.toMatchObject({ kind: "committed", receipt: { status: "committed" } });
    const closedProjection = tacticalFeature(await restoredOpen.observe(ALICE));
    expect(closedProjection).toMatchObject({
      state: "closed",
      opaque: true,
      impassable: true,
      cover: "full",
      propagation: "blocks",
    });

    const exportedClosed = record(await restoredOpen.exportAuthoritativeArchive(
      source.capabilities.archiveExport,
    ), "closed archive export");
    const restoredClosed = authority("environment-portal-room-v2-restored-closed");
    await expect(restoredClosed.restoreAuthoritativeArchive(
      source.capabilities.disasterRecovery,
      record(exportedClosed.archive, "closed archive"),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(tacticalFeature(await restoredClosed.observe(ALICE))).toEqual(closedProjection);
  });

  it("keeps the input closed and makes hidden, unknown, wrong-scene, and Legacy references indistinguishable", async () => {
    const tactical = await initializeTactical("environment-portal-room-v2-boundaries");
    const proposed = { value: 0 };
    const publicObservation = await tactical.room.observe(ALICE);
    expect(JSON.stringify(publicObservation)).not.toContain(HIDDEN_DOOR_ID);
    expect(JSON.stringify(publicObservation)).not.toContain("覆土暗门");
    expect(JSON.stringify(publicObservation)).not.toContain("stateGraph");
    expect(JSON.stringify(publicObservation)).not.toContain("environment-definition:");
    const invalidShape = await handleRoomAction(
      context(ALICE, tactical.room, proposed),
      {
        ...portalAction("submission:portal-room:forged-state", "open"),
        state: "open",
        props: { opaque: false },
        patch: { path: "combatRuntime.scenes.yard.geometry" },
        visibility: "public",
        command: { kind: "replaceWorldState" },
      } as never,
    );
    expect(invalidShape).toMatchObject({ kind: "rejected", code: "validation" });

    const exported = record(await tactical.room.exportAuthoritativeArchive(
      tactical.capabilities.archiveExport,
    ), "boundary archive export");
    const initialState = record(
      record(exported.archive, "boundary archive").signedGenesis,
      "signed genesis",
    ).initialState;
    const genesisCombat = record(record(initialState, "initial state").combatRuntime, "combat runtime");
    const yardGeometry = record(record(record(genesisCombat.scenes, "combat scenes").yard, "yard").geometry, "yard geometry");
    const yardFeatures = list(yardGeometry.obstacles, "yard obstacles")
      .map((entry) => record(entry, "yard feature"));
    const publicDoor = yardFeatures.find((feature) => feature.featureId === PUBLIC_DOOR_ID);
    expect(record(publicDoor?.stateGraph, "pinned public door state graph")).toEqual({
      definitionId: "environment-definition:feature:yard:cellar-door:open-closed-destroyed-v1",
      states: [
        {
          state: "closed",
          opaque: true,
          impassable: true,
          cover: "full",
          propagation: "blocks",
          terrain: "normal",
        },
        {
          state: "destroyed",
          opaque: false,
          impassable: false,
          cover: "none",
          propagation: "passes",
          terrain: "rubble",
        },
        {
          state: "open",
          opaque: false,
          impassable: false,
          cover: "none",
          propagation: "passes",
          terrain: "normal",
        },
      ],
      transitions: [
        { fromState: "closed", intent: "open", toState: "open" },
        { fromState: "open", intent: "close", toState: "closed" },
      ],
      durability: {
        maximum: "4",
        armorClass: "11",
        damageThreshold: "0",
        immuneDamageTypes: ["poison", "psychic"],
      },
      damageTransitions: [
        { fromState: "closed", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
        { fromState: "open", remainingDurabilityAtOrBelow: "0", toState: "destroyed" },
      ],
    });
    expect(yardFeatures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        featureId: HIDDEN_DOOR_ID,
        visibilityPolicyId: "visibility:hidden-until-evidence",
      }),
    ]));

    const hidden = await handleRoomAction(
      context(ALICE, tactical.room, proposed),
      portalAction("submission:portal-room:hidden", "open", HIDDEN_DOOR_ID) as never,
    );
    const unknown = await handleRoomAction(
      context(ALICE, tactical.room, proposed),
      portalAction("submission:portal-room:unknown", "open", "feature:yard:not-there") as never,
    );
    const wrongScene = await handleRoomAction(
      context(BOB, tactical.room, proposed),
      portalAction("submission:portal-room:wrong-scene", "open") as never,
    );
    expect(hidden).toEqual(unknown);
    expect(wrongScene).toEqual(unknown);
    expect(hidden).toEqual({
      kind: "rejected",
      code: "referenceUnavailable",
      explanation: "该对象当前不可用。",
      action: "notCommitted",
      narration: "notApplicable",
    });
    expect(proposed.value).toBe(0);

    const legacy = authority("environment-portal-room-v2-legacy");
    await expect(legacy.initializeAuthoritative({
      roomId: "environment-portal-room-v2-legacy",
      moduleId: "black-oak-will",
      moduleVersion: "legacy-anchor-v2",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character("character:portal-room:legacy", ALICE.principal.id, "yard")],
    })).resolves.toMatchObject({ created: true });
    await expect(handleRoomAction(
      context(ALICE, legacy, proposed),
      portalAction("submission:portal-room:legacy", "open") as never,
    )).resolves.toEqual(unknown);
  });
});
