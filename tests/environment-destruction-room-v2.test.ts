import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import { compileAbilityDefinition } from "../app/_runtime/lib/rules/profiles/ability-compiler";
import { entityCanTargetTacticalFeature } from "../app/_runtime/lib/rules/profiles/combat-geometry";
import { replay } from "../app/_runtime/lib/rules";
import { productionActionPlanProposal } from "./helpers/authoritative-proposal";

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
  principal: Object.freeze({ id: "principal:destruction-room:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:destruction-room:bob", sessionVersion: 1 }),
});
const SEAT_ID = "feature:shrine:stone-seat";
const DOOR_ID = "feature:yard:cellar-door";
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
      level: 20,
      scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      proficiency: 6,
      hp: { current: 180, max: 180, temp: 0 },
      ac: 17,
      speed: 30,
      equipped: { armor: "chain", main: "warhammer" },
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
        throw new Error("closed environment damage must not ask KP to reconstruct mechanics");
      },
      async narrate() {
        return { body: "环境承受了这次打击。", agencyClaims: [] };
      },
    },
  };
}

function environmentAbility(submissionId: string, featureId: string, abilityRef: string) {
  return {
    kind: "environmentAbility" as const,
    submissionId,
    featureId,
    abilityRef,
  };
}

function warhammerAbility(observation: unknown) {
  const readModel = record(record(observation, "ability observation").readModel, "ability read model");
  const controlled = record(readModel.controlledCharacter, "controlled character");
  const combat = record(controlled.combat, "controlled combat");
  const abilityRefs = list(combat.abilityRefs, "controlled ability refs");
  const definitions = record(combat.definitions, "controlled definitions");
  const match = Object.entries(definitions)
    .map(([abilityRef, definition]) => ({ abilityRef, definition: record(definition, "ability definition") }))
    .find(({ definition }) => definition.mechanicalKey === "weapon:warhammer");
  expect(match, "equipped warhammer AbilityDefinition").toBeDefined();
  expect(abilityRefs).toContain(match!.abilityRef);
  expect(definitions).toHaveProperty(match!.abilityRef);
  const compiled = compileAbilityDefinition(match!.definition);
  expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
  if (!compiled.ok) throw new Error("warhammer AbilityDefinition did not compile");
  return { ...match!, artifact: compiled.artifact };
}

function tacticalFeature(value: unknown, featureId: string): JsonRecord {
  const readModel = record(record(value, "observation").readModel, "read model");
  const tactical = record(readModel.tacticalProjection, "tactical projection");
  const feature = list(tactical.knownFeatures, "known features")
    .map((entry) => record(entry, "known feature"))
    .find((entry) => entry.id === featureId);
  expect(feature, `known feature ${featureId}`).toBeDefined();
  return feature!;
}

function expectPublicFeatureMechanicsSafe(feature: JsonRecord) {
  expect(feature).not.toHaveProperty("armorClass");
  expect(feature).not.toHaveProperty("damageThreshold");
  expect(feature).not.toHaveProperty("immuneDamageTypes");
  expect(feature).not.toHaveProperty("stateGraph");
}

async function initialize(
  name: string,
  sceneId: "shrine" | "yard",
  bobSceneId?: "shrine" | "yard" | "wake",
) {
  const room = authority(name);
  const initialized = record(await room.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      ...(bobSceneId === undefined ? [] : [{ principalId: BOB.principal.id, role: "player" as const }]),
    ],
    characters: [
      character(`character:${name}:alice`, ALICE.principal.id, sceneId),
      ...(bobSceneId === undefined
        ? []
        : [character(`character:${name}:bob`, BOB.principal.id, bobSceneId)]),
    ],
  }), "environment Room initialization");
  expect(initialized.created, JSON.stringify(initialized)).toBe(true);
  return {
    room,
    capabilities: record(initialized.serviceCapabilities, "service capabilities"),
  };
}

function encounterProposal(rootActionId: string, sceneId: "shrine" | "yard") {
  const encounterId = `encounter:${rootActionId}`;
  const enemyId = `enemy:${rootActionId}:sentinel`;
  const position = sceneId === "shrine"
    ? { x: "240", y: "-240", elevation: "0" }
    : { x: "300", y: "-240", elevation: "0" };
  return {
    encounterId,
    enemyId,
    proposal: productionActionPlanProposal(rootActionId, {
      operation: "startCombat",
      encounterRef: encounterId,
      targetEntityRefs: [enemyId],
    }, {
      kind: "highRiskFeasible",
      goal: "与显形的环境哨兵进入遭遇",
      method: "按权威先攻开始遭遇",
      dynamicMaterializations: [{
        kind: "enemy",
        factRef: `fact:${rootActionId}:sentinel-appears`,
        causalBasisRefs: [],
        visibilityPolicyRef: "visibility:scene-observers",
        definition: {
          entityId: enemyId,
          entityKind: "npc",
          name: "环境哨兵",
          position,
          footprint: { width: "60", depth: "60", height: "60" },
          stats: { str: "10", dex: "10", con: "10", int: "8", wis: "10", cha: "8" },
          proficiencyBonus: "2",
          armorClass: "10",
          hitPoints: { current: "10", maximum: "10", temporary: "0" },
          speedInches: { walk: "360" },
          resources: {},
          deathPolicy: "defeatedAtZero",
          abilities: [{
            definitionId: `ability:${rootActionId}:sentinel-strike`,
            revision: "1",
            rulesBasis: "srd5.1-2014",
            activation: { kind: "attack", actionGrant: "attack" },
            target: { kind: "creature", count: "1", reachInches: "60", requiresSight: true },
            attack: { ability: "str", proficiency: true },
            damage: [{ type: "bludgeoning", formula: "1d4" }],
          }],
        },
      }],
    }),
  };
}

async function activeEncounter(room: Authority, principal: typeof ALICE, encounterId: string) {
  const observation = record(await room.observe(principal), "encounter observation");
  const readModel = record(observation.readModel, "encounter read model");
  return record(record(readModel.encounters, "encounters")[encounterId], "active encounter");
}

async function commitPlan(
  room: Authority,
  submissionId: string,
  text: string,
  mechanicalProposal: JsonRecord,
  options: JsonRecord = {},
) {
  const prepared = record(await room.prepare(ALICE, {
    kind: "intent",
    submissionId,
    text,
  }), `${text} prepare`);
  const proposal = productionActionPlanProposal(
    String(prepared.rootActionId),
    mechanicalProposal as never,
    {
      goal: text,
      method: text,
      ...options,
    } as never,
  );
  return record(await room.commit(
    ALICE,
    String(prepared.preparedActionId),
    proposal,
  ), `${text} commit`);
}

async function endNpcTurn(room: Authority, encounterId: string, enemyId: string, sequence: number) {
  const outcome = await commitPlan(
    room,
    `submission:destruction:npc-turn:${sequence}`,
    "观察哨兵结束当前回合",
    {
      operation: "resolveDirectConsequences",
      duration: { unit: "second", value: 1 },
      frozenCosts: [],
      success: [],
      failure: [],
    },
    {
      npcActions: [{
        npcId: enemyId,
        goal: "结束当前回合",
        method: "没有采取其他行动",
        knowledgeRefs: [],
        mechanicalProposal: { operation: "endCombatTurn", encounterRef: encounterId },
      }],
    },
  );
  expect(outcome.kind, JSON.stringify(outcome)).toBe("committed");
}

async function openEncounter(
  room: Authority,
  name: string,
  sceneId: "shrine" | "yard",
  actorId: string,
) {
  const prepared = record(await room.prepare(ALICE, {
    kind: "intent",
    submissionId: `submission:${name}:encounter`,
    text: "我警觉地面对显形的环境哨兵。",
  }), "encounter prepare");
  const encounter = encounterProposal(String(prepared.rootActionId), sceneId);
  let opened = record(await runInDurableObject(room as never, async (instance) => {
    const target = instance as unknown as {
      authorityRoll(sides: number): number;
      commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
    };
    const originalRoll = target.authorityRoll;
    const openingInitiativeFaces = [20, 1] as const;
    let rollIndex = 0;
    target.authorityRoll = (sides: number) => {
      expect(sides, "opening initiative die").toBe(20);
      const face = openingInitiativeFaces[rollIndex];
      if (face === undefined) throw new Error("opening encounter requested unexpected extra randomness");
      rollIndex += 1;
      return face;
    };
    try {
      const result = await target.commit(
        ALICE,
        String(prepared.preparedActionId),
        structuredClone(encounter.proposal),
      );
      expect(rollIndex, "opening initiative roll count").toBe(openingInitiativeFaces.length);
      return result;
    } finally {
      target.authorityRoll = originalRoll;
    }
  }), "encounter commit");
  if (opened.kind === "awaitingInput") {
    const pending = record(opened.pending, "initiative tie pending");
    const answer = record(await room.prepare(ALICE, {
      kind: "answer",
      submissionId: `submission:${name}:initiative-tie`,
      pendingInputId: String(pending.pendingInputId),
      answer: { orderedEntityIds: list(pending.orderedEntityIds, "tie order") },
    }), "initiative tie prepare");
    opened = record(await room.commit(ALICE, String(answer.preparedActionId), {
      kind: "authenticatedPendingAnswer",
      rootActionId: String(answer.rootActionId),
    }), "initiative tie commit");
  }
  expect(opened.kind, JSON.stringify(opened)).toBe("committed");
  expect((await activeEncounter(room, ALICE, encounter.encounterId)).activeEntityId).toBe(actorId);
  return encounter;
}

async function rotateBackToActor(
  room: Authority,
  encounterId: string,
  enemyId: string,
  actorId: string,
  sequence: number,
) {
  const ended = await commitPlan(
    room,
    `submission:destruction:player-turn:${sequence}`,
    "结束当前角色回合",
    { operation: "endCombatTurn", encounterRef: encounterId },
  );
  expect(ended.kind, JSON.stringify(ended)).toBe("committed");
  expect((await activeEncounter(room, ALICE, encounterId)).activeEntityId).toBe(enemyId);
  await endNpcTurn(room, encounterId, enemyId, sequence);
  expect((await activeEncounter(room, ALICE, encounterId)).activeEntityId).toBe(actorId);
}

async function archive(room: Authority, capability: unknown): Promise<JsonRecord> {
  const exported = record(await room.exportAuthoritativeArchive(capability), "archive export");
  return record(exported.archive, "archive");
}

function replayedState(value: JsonRecord): JsonRecord {
  const result = record(replay(value.signedGenesis as never, value.events as never), "archive replay");
  expect(result.kind).toBe("replayed");
  return record(result.state, "replayed state");
}

function canTargetFeature(
  state: JsonRecord,
  sceneId: string,
  actorId: string,
  featureId: string,
  rangeInches: string,
) {
  const combat = record(state.combatRuntime, "targeting combat runtime");
  const entities = record(combat.entities, "targeting combat entities");
  const scenes = record(combat.scenes, "targeting combat scenes");
  const scene = record(scenes[sceneId], "targeting combat scene");
  const geometry = record(scene.geometry, "targeting geometry");
  const feature = list(geometry.obstacles, "targeting obstacles")
    .map((entry) => record(entry, "targeting feature"))
    .find((entry) => entry.featureId === featureId);
  expect(feature, `targeting feature ${featureId}`).toBeDefined();
  return entityCanTargetTacticalFeature(
    scene,
    record(entities[actorId], "targeting actor"),
    feature!,
    rangeInches,
  );
}

describe.sequential("SPEC 0014 Room destructible environment vertical", () => {
  let seatArchive: JsonRecord | undefined;
  let seatDestroyedProjection: JsonRecord | undefined;
  let seatRecoveryCapability: unknown;
  let seatAbilityEvidence: ReturnType<typeof warhammerAbility> | undefined;
  const seatCommittedSubmissions: string[] = [];
  let seatActorId: string | undefined;
  let seatSource: Awaited<ReturnType<typeof initialize>> | undefined;
  let seatEncounter: Awaited<ReturnType<typeof openEncounter>> | undefined;
  let seatProposed: { value: number } | undefined;
  let seatAttemptIndex = 0;
  let seatStatesSeen: string[] = [];
  let closedDoorArchive: JsonRecord | undefined;
  let closedDoorProjection: JsonRecord | undefined;
  let closedDoorRecoveryCapability: unknown;

  async function advanceSeatOneAuthorityTurn(): Promise<JsonRecord> {
    expect(seatSource, "seat Room").toBeDefined();
    expect(seatEncounter, "seat encounter").toBeDefined();
    expect(seatProposed, "seat KP counter").toBeDefined();
    expect(seatAbilityEvidence, "seat ability").toBeDefined();
    expect(seatActorId, "seat actor").toBeDefined();
    if (seatSource === undefined || seatEncounter === undefined || seatProposed === undefined
      || seatAbilityEvidence === undefined || seatActorId === undefined) {
      throw new Error("seat authority fixture was not produced");
    }
    let projected = tacticalFeature(await seatSource.room.observe(ALICE), SEAT_ID);
    if (projected.state === "destroyed") return projected;
    if (seatAttemptIndex > 0 && seatAttemptIndex % 4 === 0) {
      await rotateBackToActor(
        seatSource.room,
        seatEncounter.encounterId,
        seatEncounter.enemyId,
        seatActorId,
        seatAttemptIndex,
      );
    }
    const availableStrikes = seatAttemptIndex % 4 === 0 ? 4 : 4 - (seatAttemptIndex % 4);
    for (let offset = 0; offset < availableStrikes && projected.state !== "destroyed"; offset += 1) {
      const index = seatAttemptIndex + 1;
      const submission = index === 1 ? "first" : `strike-${index}`;
      const outcome = record(await handleRoomAction(
        context(ALICE, seatSource.room, seatProposed),
        environmentAbility(
          `submission:destruction:seat:${submission}`,
          SEAT_ID,
          seatAbilityEvidence.abilityRef,
        ) as never,
      ), `damage outcome ${index}`);
      expect(outcome).toMatchObject({
        kind: "committed",
        receipt: {
          status: "committed",
          randomnessCommitments: [expect.any(Object), expect.any(Object)],
        },
      });
      seatCommittedSubmissions.push(submission);
      seatAttemptIndex = index;
      projected = tacticalFeature(await seatSource.room.observe(ALICE), SEAT_ID);
      seatStatesSeen.push(String(projected.state));
    }
    return projected;
  }

  it("opens an actor-first encounter without replacing attack or damage randomness", async () => {
    const name = "environment-destruction-room-v2-seat";
    const source = await initialize(name, "shrine");
    const proposed = { value: 0 };
    const aliceId = `character:${name}:alice`;
    const aliceAbility = warhammerAbility(await source.room.observe(ALICE));
    expect(aliceAbility.definition).toMatchObject({
      mechanicalKey: "weapon:warhammer",
      target: { kind: "creatureOrEnvironmentFeature" },
      attack: { ability: "str", proficiency: true },
      damage: [{ type: "bludgeoning", formula: "1d8+3" }],
    });

    const initialProjection = tacticalFeature(await source.room.observe(ALICE), SEAT_ID);
    expect(initialProjection).toMatchObject({
      state: "intact",
      durability: { current: "12", maximum: "12" },
      terrain: "normal",
      impassable: true,
      opaque: true,
    });
    expectPublicFeatureMechanicsSafe(initialProjection);

    const encounter = await openEncounter(source.room, name, "shrine", aliceId);
    expect(proposed.value).toBe(0);
    seatSource = source;
    seatEncounter = encounter;
    seatProposed = proposed;
    seatAbilityEvidence = aliceAbility;
    seatActorId = aliceId;
    seatStatesSeen = ["intact"];
  });

  for (let authorityTurn = 1; authorityTurn <= 4; authorityTurn += 1) {
    it(`advances at most one real authority turn of environment strikes (${authorityTurn}/4)`, async () => {
      const projected = await advanceSeatOneAuthorityTurn();
      expect(["intact", "damaged", "destroyed"]).toContain(projected.state);
      expectPublicFeatureMechanicsSafe(projected);
    });
  }

  it("closes the bounded intact → damaged → destroyed chain and exports it", async () => {
    expect(seatSource, "completed seat Room").toBeDefined();
    expect(seatProposed, "completed seat KP counter").toBeDefined();
    if (seatSource === undefined || seatProposed === undefined) {
      throw new Error("completed seat fixture was not produced");
    }
    const destroyed = tacticalFeature(await seatSource.room.observe(ALICE), SEAT_ID);
    expect(seatProposed.value).toBe(0);
    expect(destroyed).toMatchObject({
      state: "destroyed",
      durability: { current: "0", maximum: "12" },
      terrain: "rubble",
      impassable: false,
      opaque: false,
      cover: "none",
      propagation: "passes",
    });
    expect(seatCommittedSubmissions.length).toBeGreaterThan(1);
    expect(seatCommittedSubmissions.length).toBeLessThanOrEqual(16);
    expect(seatStatesSeen).toContain("damaged");
    expectPublicFeatureMechanicsSafe(destroyed);

    const finalArchive = await archive(seatSource.room, seatSource.capabilities.archiveExport);
    seatArchive = finalArchive;
    seatDestroyedProjection = destroyed;
    seatRecoveryCapability = seatSource.capabilities.disasterRecovery;
  });

  it("replays the frozen environment attack events and restores the rubble projection in a fresh DO", async () => {
    expect(seatArchive, "destroyed seat archive from the preceding authority test").toBeDefined();
    expect(seatDestroyedProjection, "destroyed seat projection from the preceding authority test").toBeDefined();
    expect(seatAbilityEvidence, "warhammer compiler evidence from the preceding authority test").toBeDefined();
    expect(seatActorId, "seat actor from the preceding authority test").toBeDefined();
    if (seatArchive === undefined || seatDestroyedProjection === undefined
      || seatAbilityEvidence === undefined || seatActorId === undefined) {
      throw new Error("destroyed seat fixture was not produced");
    }
    const finalArchive = seatArchive;
    const aliceAbility = seatAbilityEvidence;
    const events = list(finalArchive.events, "archive events").map((entry) => record(entry, "archive event"));
    for (const submission of seatCommittedSubmissions) {
      const rootActionId = `root-action:submission:destruction:seat:${submission}`;
      const rootEvents = events.filter((event) => event.rootActionId === rootActionId);
      expect(rootEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
        "RandomnessRequested",
        "AbilityInvoked",
        "EnvironmentFeatureDamaged",
      ]));
      const damagedEvent = rootEvents.find((event) => event.eventType === "EnvironmentFeatureDamaged");
      expect(damagedEvent).toMatchObject({
        visibilityPolicyId: "visibility:room-authority-only",
        secrecy: "internal",
      });
      expect(rootEvents.find((event) => event.eventType === "AbilityInvoked")).toMatchObject({
        visibilityPolicyId: "visibility:room-authority-only",
        secrecy: "internal",
      });
      expect(record(damagedEvent?.payload, "environment damage payload")).toMatchObject({
        abilityRef: aliceAbility.abilityRef,
        abilityDefinitionHash: aliceAbility.artifact.definitionHash,
        compiledHash: aliceAbility.artifact.compiledHash,
        damageType: "bludgeoning",
        rangeInches: "60",
        featureId: SEAT_ID,
        definitionId: expect.stringContaining(SEAT_ID),
        durabilityBefore: expect.stringMatching(/^\d+$/),
        durabilityAfter: expect.stringMatching(/^\d+$/),
        damageThreshold: "0",
        rolledDamage: expect.stringMatching(/^([4-9]|1[01])$/),
        armorClass: "11",
        attackRolls: [expect.any(Number)],
        selectedAttackRoll: expect.any(Number),
        attackBonus: "9",
        attackTotal: expect.stringMatching(/^\d+$/),
        hit: expect.any(Boolean),
        fromState: expect.any(String),
        toState: expect.any(String),
      });
    }
    const finalState = replayedState(finalArchive);
    expect(canTargetFeature(finalState, "shrine", seatActorId, SEAT_ID, "60")).toBe(true);
    const restored = authority("environment-destruction-room-v2-seat-restored");
    await expect(restored.restoreAuthoritativeArchive(
      seatRecoveryCapability,
      structuredClone(seatArchive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(tacticalFeature(await restored.observe(ALICE), SEAT_ID)).toEqual(seatDestroyedProjection);
  });

  for (const initial of ["closed", "open"] as const) {
    it(`destroys the same portal from ${initial} through the Room authority`, async () => {
      const proposed = { value: 0 };
      const name = `environment-destruction-room-v2-door-${initial}`;
      const source = await initialize(name, "yard");
      const ability = warhammerAbility(await source.room.observe(ALICE));
      const actorId = `character:${name}:alice`;
      if (initial === "open") {
        await expect(handleRoomAction(
          context(ALICE, source.room, proposed),
          {
            kind: "environmentInteract",
            submissionId: `submission:destruction:door:${initial}:open`,
            featureId: DOOR_ID,
            intent: "open",
          } as never,
        )).resolves.toMatchObject({ kind: "committed" });
      }
      const encounter = await openEncounter(source.room, name, "yard", actorId);
      let projected = tacticalFeature(await source.room.observe(ALICE), DOOR_ID);
      let attempts = 0;
      for (let index = 1; projected.state !== "destroyed" && index <= 4; index += 1) {
        attempts = index;
        await expect(handleRoomAction(
          context(ALICE, source.room, proposed),
          environmentAbility(
            `submission:destruction:door:${initial}:strike:${index}`,
            DOOR_ID,
            ability.abilityRef,
          ) as never,
        )).resolves.toMatchObject({
          kind: "committed",
          receipt: { randomnessCommitments: [expect.any(Object), expect.any(Object)] },
        });
        projected = tacticalFeature(await source.room.observe(ALICE), DOOR_ID);
        if (projected.state !== "destroyed" && index % 4 === 0 && index < 4) {
          await rotateBackToActor(
            source.room,
            encounter.encounterId,
            encounter.enemyId,
            actorId,
            index,
          );
        }
      }
      expect(tacticalFeature(await source.room.observe(ALICE), DOOR_ID)).toMatchObject({
        state: "destroyed",
        durability: { current: "0", maximum: "4" },
        terrain: "rubble",
        impassable: false,
        opaque: false,
        cover: "none",
        propagation: "passes",
      });
      expectPublicFeatureMechanicsSafe(projected);
      expect(attempts).toBeGreaterThan(0);
      expect(attempts).toBeLessThanOrEqual(4);
      expect(proposed.value).toBe(0);

      if (initial === "closed") {
        closedDoorArchive = await archive(source.room, source.capabilities.archiveExport);
        closedDoorProjection = projected;
        closedDoorRecoveryCapability = source.capabilities.disasterRecovery;
      }
    });
  }

  it("restores a destroyed closed portal and its mechanics in a fresh DO", async () => {
    expect(closedDoorArchive, "destroyed closed-door archive").toBeDefined();
    expect(closedDoorProjection, "destroyed closed-door projection").toBeDefined();
    if (closedDoorArchive === undefined || closedDoorProjection === undefined) {
      throw new Error("destroyed closed-door fixture was not produced");
    }
    const restored = authority("environment-destruction-room-v2-door-closed-restored");
    await expect(restored.restoreAuthoritativeArchive(
      closedDoorRecoveryCapability,
      structuredClone(closedDoorArchive),
    )).resolves.toMatchObject({ kind: "restored", projectionIntegrity: "verified" });
    expect(tacticalFeature(await restored.observe(ALICE), DOOR_ID)).toEqual(closedDoorProjection);
  });

  it("deduplicates one real environment strike and rejects a reused submission with a new target", async () => {
    const proposed = { value: 0 };
    const name = "environment-destruction-room-v2-idempotency";
    const source = await initialize(name, "shrine");
    const actorId = `character:${name}:alice`;
    const ability = warhammerAbility(await source.room.observe(ALICE));
    await openEncounter(source.room, name, "shrine", actorId);
    const input = environmentAbility(
      "submission:destruction:idempotency:first",
      SEAT_ID,
      ability.abilityRef,
    );
    const first = record(await handleRoomAction(context(ALICE, source.room, proposed), input as never), "first strike");
    const firstReceipt = structuredClone(record(first.receipt, "first receipt"));
    const repeated = record(await handleRoomAction(
      context(ALICE, source.room, proposed),
      structuredClone(input) as never,
    ), "repeated strike");
    expect(repeated.receipt).toEqual(firstReceipt);
    expect(await handleRoomAction(
      context(ALICE, source.room, proposed),
      { ...input, featureId: DOOR_ID } as never,
    )).toMatchObject({ kind: "rejected", code: "idempotencyPayloadMismatch" });
    expect(proposed.value).toBe(0);
  });

  it("keeps the public environment ability input and secret-reference boundary closed", async () => {
    const proposed = { value: 0 };
    const boundary = await initialize("environment-destruction-room-v2-boundary", "yard", "wake");
    const boundaryObservation = await boundary.room.observe(ALICE);
    const boundaryAbility = warhammerAbility(boundaryObservation);
    expect(JSON.stringify(boundaryObservation)).not.toContain(HIDDEN_DOOR_ID);
    const forged = await handleRoomAction(
      context(ALICE, boundary.room, proposed),
      {
        ...environmentAbility("submission:destruction:forged", DOOR_ID, boundaryAbility.abilityRef),
        state: "destroyed",
        toState: "destroyed",
        damage: "999",
        threshold: "0",
        dice: "100d100",
        faces: [100],
        props: { impassable: false },
        patch: { path: "combatRuntime.scenes.yard.geometry" },
        visibility: "public",
        targetIds: [DOOR_ID],
      } as never,
    );
    expect(forged).toMatchObject({ kind: "rejected", code: "validation" });

    const hidden = await handleRoomAction(
      context(ALICE, boundary.room, proposed),
      environmentAbility("submission:destruction:hidden", HIDDEN_DOOR_ID, boundaryAbility.abilityRef) as never,
    );
    const unknown = await handleRoomAction(
      context(ALICE, boundary.room, proposed),
      environmentAbility(
        "submission:destruction:unknown",
        "feature:yard:not-there",
        boundaryAbility.abilityRef,
      ) as never,
    );
    const wrongScene = await handleRoomAction(
      context(BOB, boundary.room, proposed),
      environmentAbility(
        "submission:destruction:wrong-scene",
        DOOR_ID,
        warhammerAbility(await boundary.room.observe(BOB)).abilityRef,
      ) as never,
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

    const legacy = authority("environment-destruction-room-v2-legacy");
    await expect(legacy.initializeAuthoritative({
      roomId: "environment-destruction-room-v2-legacy",
      moduleId: "black-oak-will",
      moduleVersion: "legacy-anchor-v2",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [character("character:destruction-room:legacy", ALICE.principal.id, "yard")],
    })).resolves.toMatchObject({ created: true });
    const legacyAbility = warhammerAbility(await legacy.observe(ALICE));
    await expect(handleRoomAction(
      context(ALICE, legacy, proposed),
      environmentAbility("submission:destruction:legacy", DOOR_ID, legacyAbility.abilityRef) as never,
    )).resolves.toEqual(unknown);
    expect(proposed.value).toBe(0);
  });
});
