import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { npcMechanicalEncounterProposal } from "./helpers/authoritative-proposal";

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
  principal: Object.freeze({ id: "principal:tactical-movement:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:tactical-movement:bob", sessionVersion: 1 }),
});
const ALICE_ID = "character:tactical-movement:alice";
const BOB_ID = "character:tactical-movement:bob";
const SENTINEL_ID = "npc:tactical-movement:wake-sentinel";
const ENCOUNTER_ID = "encounter:tactical-movement:wake";
const ENCOUNTER_BASIS_REF = "fact:tactical-movement:hostile-standoff";
const HIDDEN_LEFT_BARRIER_ID = "feature:wake:hidden-side-wall-left";
const HIDDEN_RIGHT_BARRIER_ID = "feature:wake:hidden-side-wall-right";

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

function character(characterId: string, principalId: string, name: string) {
  return {
    characterId,
    controllerPrincipalId: principalId,
    staticCard: {
      name,
      sceneId: "wake",
      classId: "fighter",
      raceId: "human",
      subclassId: "champion",
      level: 3,
      abilityScores: characterId === ALICE_ID
        ? { str: 14, dex: 14, con: 14, int: 10, wis: 12, cha: 10 }
        : { str: 14, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: ["athletics"],
      hp: { current: 24, max: 24, temp: 0 },
      ac: 16,
      speed: 30,
      equipped: {},
      backpack: [],
    },
  };
}

function actionContext(
  principal: typeof ALICE | typeof BOB,
  room: Authority,
  propose: (request: JsonRecord) => Promise<unknown>,
) {
  return {
    principal,
    authority: room,
    kp: {
      propose,
      async narrate() {
        return { body: "双方进入交战位置。", agencyClaims: [] };
      },
    },
  };
}

function tacticalProjection(observation: unknown): JsonRecord {
  const readModel = record(record(observation, "Room observation").readModel, "Room read model");
  return record(readModel.tacticalProjection, "tactical projection");
}

async function initializeEncounter(roomId: string) {
  const room = authority(roomId);
  const initialized = record(await room.initializeAuthoritative({
    roomId,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      { principalId: BOB.principal.id, role: "player" },
    ],
    characters: [
      character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
      character(BOB_ID, BOB.principal.id, "博林"),
    ],
    fixtureFacts: [{
      factRef: ENCOUNTER_BASIS_REF,
      kind: "establishedCommunicationChannel",
      participants: [ALICE_ID, BOB_ID],
    }],
  }), "tactical movement Room initialization");
  expect(initialized.created, JSON.stringify(initialized)).toBe(true);

  const prepared = record(await room.prepare(ALICE, {
    kind: "intent",
    submissionId: "submission:tactical-movement:start-encounter",
    text: "我拔出武器，与博林和警戒傀儡进入交战。",
  }), "tactical encounter preparation");
  const proposal = npcMechanicalEncounterProposal(String(prepared.rootActionId), {
    encounterRef: ENCOUNTER_ID,
    sceneRef: "wake",
    causalBasisRefs: [ENCOUNTER_BASIS_REF],
    hostileEntityRefs: [BOB_ID, SENTINEL_ID],
    entries: [{
      entityId: SENTINEL_ID,
      name: "警戒傀儡",
      definition: {
        entityId: SENTINEL_ID,
        entityKind: "npc",
        name: "警戒傀儡",
        position: { x: "300", y: "240", elevation: "0" },
        footprint: { width: "60", depth: "60", height: "60" },
        stats: { str: "10", dex: "10", con: "10", int: "8", wis: "10", cha: "8" },
        proficiencyBonus: "2",
        armorClass: "10",
        hitPoints: { current: "10", maximum: "10", temporary: "0" },
        speedInches: { walk: "360" },
        resources: {},
        deathPolicy: "defeatedAtZero",
        abilities: [],
      },
    }],
  });
  let opened = record(await runInDurableObject(room as never, async (instance) => {
    const target = instance as unknown as {
      authorityRoll(sides: number): number;
      commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
    };
    const originalRoll = target.authorityRoll;
    const initiativeFaces = [20, 10, 1] as const;
    let rollIndex = 0;
    target.authorityRoll = (sides: number) => {
      expect(sides, "tactical opening initiative die").toBe(20);
      const face = initiativeFaces[rollIndex];
      if (face === undefined) throw new Error("tactical encounter requested unexpected extra randomness");
      rollIndex += 1;
      return face;
    };
    try {
      const result = await target.commit(
        ALICE,
        String(prepared.preparedActionId),
        structuredClone(proposal),
      );
      expect(rollIndex, "tactical opening initiative roll count").toBe(initiativeFaces.length);
      return result;
    } finally {
      target.authorityRoll = originalRoll;
    }
  }), "tactical encounter opening outcome");

  if (opened.kind === "awaitingInput") {
    const pending = record(opened.pending, "initiative tie pending");
    expect(pending.choiceKind, JSON.stringify(opened)).toBe("initiativeTieOrder");
    const orderedEntityIds = list(pending.orderedEntityIds, "initiative tie entities")
      .map((entityId) => String(entityId));
    const tiePrincipal = orderedEntityIds[0] === BOB_ID ? BOB : ALICE;
    opened = record(await handleRoomAction(
      actionContext(tiePrincipal, room, async () => {
        throw new Error("authenticated initiative answer must not call KP");
      }),
      {
        kind: "answer",
        submissionId: "submission:tactical-movement:initiative-tie",
        pendingInputId: String(pending.pendingInputId),
        answer: { orderedEntityIds },
      },
    ), "initiative tie answer outcome");
  }
  expect(opened.kind, JSON.stringify(opened)).toBe("committed");

  return {
    room,
    capabilities: record(initialized.serviceCapabilities, "Room service capabilities"),
  };
}

describe("SPEC 0014 TM05/TM10 tactical movement Room vertical", () => {
  it("accepts only the closed movement path intent after a real tactical encounter is established", async () => {
    const source = await initializeEncounter("tactical-movement-room-v2-action-algebra-red");
    const aliceBefore = tacticalProjection(await source.room.observe(ALICE));
    const publicEncounter = record(aliceBefore.encounter, "tactical encounter");
    const activeEntityId = String(publicEncounter.activeEntityId);
    expect([ALICE_ID, BOB_ID]).toContain(activeEntityId);
    const mover = activeEntityId === BOB_ID ? BOB : ALICE;
    const before = tacticalProjection(await source.room.observe(mover));
    const self = record(before.self, "tactical self");
    const start = record(self.position, "tactical self position");
    expect(self.id).toBe(activeEntityId);
    expect(start).toEqual({
      x: expect.stringMatching(/^-?(0|[1-9][0-9]*)$/),
      y: expect.stringMatching(/^-?(0|[1-9][0-9]*)$/),
      elevation: expect.stringMatching(/^-?(0|[1-9][0-9]*)$/),
    });
    expect(record(before.scene, "tactical scene")).toMatchObject({ id: "wake" });
    expect(before.spatialRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record(before.encounter, "tactical encounter")).toMatchObject({
      id: ENCOUNTER_ID,
      activeEntityId,
      participantEntityIds: expect.arrayContaining([ALICE_ID, BOB_ID]),
    });
    const destination = {
      x: String(start.x),
      y: (BigInt(String(start.y)) + 60n).toString(),
      elevation: String(start.elevation),
    };

    const input = {
      kind: "movement" as const,
      submissionId: "submission:tactical-movement:legal-short-path",
      movementMode: "walk" as const,
      spatialRevision: String(before.spatialRevision),
      path: [
        structuredClone(start),
        destination,
      ],
    };
    const directProposals = { count: 0 };
    const directContext = actionContext(mover, source.room, async () => {
      directProposals.count += 1;
      throw new Error("closed movement input must not ask KP to reconstruct Geometry");
    });

    const forged = await handleRoomAction(directContext, {
      ...input,
      actor: activeEntityId,
      sourceEntityId: activeEntityId,
      encounterId: ENCOUNTER_ID,
      distance: "60",
      positionPatch: destination,
      target: destination,
      state: { position: destination },
    } as never);
    expect(forged).toMatchObject({ kind: "rejected", code: "validation" });
    expect(directProposals.count).toBe(0);

    const moved = record(
      await handleRoomAction(directContext, input as never),
      "closed movement outcome",
    );
    expect(directProposals.count).toBe(0);
    expect(moved.kind, JSON.stringify(moved)).toBe("committed");
  });

  it("commits ordered movement segments, projects only the traversed prefix, restores it into a fresh DO, and deduplicates the receipt", async () => {
    const source = await initializeEncounter("tactical-movement-room-v2-segments-red");
    const aliceBefore = tacticalProjection(await source.room.observe(ALICE));
    const activeEntityId = String(record(aliceBefore.encounter, "tactical encounter").activeEntityId);
    const mover = activeEntityId === BOB_ID ? BOB : ALICE;
    const before = tacticalProjection(await source.room.observe(mover));
    const self = record(before.self, "tactical self");
    expect(self.id).toBe(activeEntityId);
    const start = record(self.position, "movement start");
    const waypoint = {
      x: String(start.x),
      y: (BigInt(String(start.y)) + 60n).toString(),
      elevation: String(start.elevation),
    };
    const destination = {
      x: (BigInt(String(start.x)) + 60n).toString(),
      y: (BigInt(String(start.y)) + 60n).toString(),
      elevation: String(start.elevation),
    };
    const input = {
      kind: "movement" as const,
      submissionId: "submission:tactical-movement:ordered-segments",
      movementMode: "walk" as const,
      spatialRevision: String(before.spatialRevision),
      path: [structuredClone(start), waypoint, destination],
    };
    const directProposals = { count: 0 };
    const context = actionContext(mover, source.room, async () => {
      directProposals.count += 1;
      throw new Error("closed movement must remain authority-direct");
    });

    const moved = record(await handleRoomAction(context, input as never), "movement outcome");
    expect(moved.kind, JSON.stringify(moved)).toBe("committed");
    expect(directProposals.count).toBe(0);
    const receipt = structuredClone(record(moved.receipt, "movement receipt"));
    const after = tacticalProjection(await source.room.observe(mover));
    expect(record(after.self, "moved tactical self").position).toEqual(destination);

    const firstExport = record(await source.room.exportAuthoritativeArchive(
      source.capabilities.archiveExport,
    ), "movement archive export");
    const firstArchive = record(firstExport.archive, "movement archive");
    const rootActionId = `root-action:${input.submissionId}`;
    const movementEvents = list(firstArchive.events, "movement archive events")
      .map((entry) => record(entry, "movement archive event"))
      .filter((event) => event.rootActionId === rootActionId);
    expect(movementEvents.map((event) => event.eventType)).toEqual([
      "MovementSegmentCommitted",
      "MovementSegmentCommitted",
    ]);
    expect(movementEvents.map((event) => record(event.payload, "movement payload").path))
      .toEqual([
        [structuredClone(start), waypoint],
        [waypoint, destination],
      ]);
    expect(movementEvents.map((event) => record(event.payload, "movement payload").distanceMilliInches))
      .toEqual(["60000", "60000"]);
    expect(movementEvents.map((event) => record(event.payload, "movement payload").movementMode))
      .toEqual(["walk", "walk"]);
    expect(movementEvents.map((event) => record(event.payload, "movement payload").movementAuthority))
      .toEqual(["activeTurn", "activeTurn"]);
    expect(BigInt(String(movementEvents[0].eventSeq)))
      .toBeLessThan(BigInt(String(movementEvents[1].eventSeq)));

    const duplicate = record(
      await handleRoomAction(context, structuredClone(input) as never),
      "duplicate movement outcome",
    );
    expect(duplicate.receipt).toEqual(receipt);
    expect(directProposals.count).toBe(0);
    const duplicateExport = record(await source.room.exportAuthoritativeArchive(
      source.capabilities.archiveExport,
    ), "duplicate movement archive export");
    const duplicateArchive = record(duplicateExport.archive, "duplicate movement archive");
    const duplicateMovementEvents = list(duplicateArchive.events, "duplicate archive events")
      .map((entry) => record(entry, "duplicate archive event"))
      .filter((event) => event.rootActionId === rootActionId);
    expect(duplicateMovementEvents).toEqual(movementEvents);

    const restored = authority("tactical-movement-room-v2-segments-restored");
    await expect(restored.restoreAuthoritativeArchive(
      source.capabilities.disasterRecovery,
      structuredClone(duplicateArchive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(tacticalProjection(await restored.observe(mover))).toEqual(after);
  }, 10_000);

  it("rejects speed, public obstacle, hidden obstacle, bad start and stale spatial revision without moving or revealing a hidden cause", async () => {
    const source = await initializeEncounter("tactical-movement-room-v2-failure-privacy-red");
    const aliceBefore = tacticalProjection(await source.room.observe(ALICE));
    const activeEntityId = String(record(aliceBefore.encounter, "tactical encounter").activeEntityId);
    const mover = activeEntityId === BOB_ID ? BOB : ALICE;
    const before = tacticalProjection(await source.room.observe(mover));
    const start = record(record(before.self, "tactical self").position, "movement start");
    expect(["-300", "-180"]).toContain(String(start.x));
    expect(start).toMatchObject({ y: "-240", elevation: "0" });
    expect(JSON.stringify(before)).not.toContain(HIDDEN_LEFT_BARRIER_ID);
    expect(JSON.stringify(before)).not.toContain(HIDDEN_RIGHT_BARRIER_ID);
    const proposals = { count: 0 };
    const context = actionContext(mover, source.room, async () => {
      proposals.count += 1;
      throw new Error("rejected movement must remain authority-direct");
    });
    const failureSubmissionIds: string[] = [];
    const attempt = async (
      label: string,
      submissionId: string,
      path: JsonRecord[],
      spatialRevision = String(before.spatialRevision),
      expectedCode = "movementUnavailable",
    ) => {
      failureSubmissionIds.push(submissionId);
      const outcome = record(await handleRoomAction(context, {
        kind: "movement",
        submissionId,
        movementMode: "walk",
        spatialRevision,
        path,
      } as never), label);
      expect(outcome, JSON.stringify(outcome)).toEqual({
        kind: "rejected",
        code: expectedCode,
        explanation: expectedCode === "spatialStateChanged"
          ? "战术空间已变化，请按当前视图重新选择路径。"
          : "该移动当前不可用。",
        action: "notCommitted",
        narration: "notApplicable",
      });
      expect(JSON.stringify(outcome)).not.toContain("feature:");
      expect(JSON.stringify(outcome)).not.toContain("obstacle");
      expect(JSON.stringify(outcome)).not.toContain("path");
      return outcome;
    };

    const overSpeed = await attempt(
      "over-speed movement rejection",
      "submission:tactical-movement:over-speed",
      [structuredClone(start), {
        x: String(start.x),
        y: (BigInt(String(start.y)) - 420n).toString(),
        elevation: String(start.elevation),
      }],
    );
    expect(record(tacticalProjection(await source.room.observe(mover)).self, "self after speed reject").position)
      .toEqual(start);

    const publicPath = [
      structuredClone(start),
      { x: "-120", y: "0", elevation: "0" },
    ];
    const publicBlocked = await attempt(
      "public obstacle movement rejection",
      "submission:tactical-movement:public-obstacle",
      publicPath,
    );
    expect(record(tacticalProjection(await source.room.observe(mover)).self, "self after public block").position)
      .toEqual(start);

    const hiddenBlocked = await attempt(
      "hidden obstacle movement rejection",
      "submission:tactical-movement:hidden-obstacle",
      [
        structuredClone(start),
        { x: String(start.x), y: "-330", elevation: String(start.elevation) },
      ],
    );
    expect(hiddenBlocked).toEqual(publicBlocked);
    expect(record(tacticalProjection(await source.room.observe(mover)).self, "self after hidden block").position)
      .toEqual(start);

    const forgedStart = {
      x: (BigInt(String(start.x)) + 60n).toString(),
      y: String(start.y),
      elevation: String(start.elevation),
    };
    await attempt(
      "bad movement start rejection",
      "submission:tactical-movement:bad-start",
      [forgedStart, {
        x: (BigInt(String(forgedStart.x)) + 60n).toString(),
        y: String(forgedStart.y),
        elevation: String(forgedStart.elevation),
      }],
    );
    expect(record(tacticalProjection(await source.room.observe(mover)).self, "self after bad start").position)
      .toEqual(start);

    const revisionAdvanceDestination = {
      x: (BigInt(String(start.x)) + 60n).toString(),
      y: String(start.y),
      elevation: String(start.elevation),
    };
    await expect(handleRoomAction(context, {
      kind: "movement",
      submissionId: "submission:tactical-movement:advance-revision",
      movementMode: "walk",
      spatialRevision: String(before.spatialRevision),
      path: [structuredClone(start), revisionAdvanceDestination],
    } as never)).resolves.toMatchObject({ kind: "committed" });
    const afterAdvance = tacticalProjection(await source.room.observe(mover));
    expect(afterAdvance.spatialRevision).not.toBe(before.spatialRevision);
    expect(record(afterAdvance.self, "advanced self").position).toEqual(revisionAdvanceDestination);

    await attempt(
      "stale tactical revision rejection",
      "submission:tactical-movement:stale-revision",
      [revisionAdvanceDestination, {
        x: (BigInt(revisionAdvanceDestination.x) + 60n).toString(),
        y: revisionAdvanceDestination.y,
        elevation: revisionAdvanceDestination.elevation,
      }],
      String(before.spatialRevision),
      "spatialStateChanged",
    );
    const finalProjection = tacticalProjection(await source.room.observe(mover));
    expect(record(finalProjection.self, "self after stale revision").position)
      .toEqual(revisionAdvanceDestination);
    expect(JSON.stringify(finalProjection)).not.toContain(HIDDEN_LEFT_BARRIER_ID);
    expect(JSON.stringify(finalProjection)).not.toContain(HIDDEN_RIGHT_BARRIER_ID);
    expect(proposals.count).toBe(0);

    const exported = record(await source.room.exportAuthoritativeArchive(
      source.capabilities.archiveExport,
    ), "failure privacy archive export");
    const archive = record(exported.archive, "failure privacy archive");
    const failureRoots = new Set(failureSubmissionIds.map((submissionId) =>
      `root-action:${submissionId}`));
    const failedMovementEvents = list(archive.events, "failure privacy archive events")
      .map((entry) => record(entry, "failure privacy archive event"))
      .filter((event) => failureRoots.has(String(event.rootActionId)))
      .filter((event) => event.eventType === "MovementSegmentCommitted");
    expect(failedMovementEvents).toEqual([]);
    expect(overSpeed).toEqual(publicBlocked);
  });

  it.skip("uses elevation and footprint height to change at least one real movement distance, legality, fall, or blocking result", async () => {
    // Enable only with a module-pinned elevated route; do not manufacture a
    // surface or treat elevation labels as mechanical evidence.
  });

  it.skip("commits only the traversed prefix when an opportunity attack or interruption pauses movement and returns control to the correct participant", async () => {
    // Drive the real Room pending seam and assert that no untraversed waypoint is
    // committed before the authenticated controller resolves the interruption.
  });
});
