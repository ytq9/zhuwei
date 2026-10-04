import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";

// SPEC 0004 §4, SPEC 0012 §6.3 (ADR 0097): Perception rolls against a hider
// are the server's. A map move outside an encounter brings them with no model
// call and no narration (ADR 0091); on the combat map the player rolls its own
// Stealth for Hide, and an NPC's turn start rolls Perception with no prompt.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:hiding:alice", sessionVersion: 1 } };
const ACTOR = "character:hiding:alice", NAES = "npc:black-oak-will:naes", LIAN = "npc:black-oak-will:lian", HALL = "wake";

async function initialize(name: string) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id,
      staticCard: { name: "1", sceneId: HALL, level: 3, classId: "rogue", raceId: "human", subclassId: "thief",
        scores: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["stealth"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
  } as never)).toMatchObject({ created: true });
  return stub;
}

const counts = { narrations: 0, proposals: 0 };
async function run(stub: Stub, input: RoomActionInput) {
  const target = stub as unknown as Data;
  const scope = createVNextModelCallScope({ roomId: "hiding-room-test", limit: "9", emit() {} });
  const authority = { prepare: (context: unknown, action: unknown) => target.prepare(context, action),
    commit: (context: unknown, id: string, value: unknown) => target.commit(context, id, value),
    observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
    publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
    deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
    beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
    failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
    resumePlayerRandomness: (...args: unknown[]) => target.resumePlayerRandomness(...args),
  } as RoomAuthorityCapability;
  const narrationAdapter = { async narrate() { counts.narrations += 1; return { body: "你压低身形。" }; },
    async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
  const kp = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
    complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
  }, proposalBinding: scope.bind({ async run() { counts.proposals += 1; throw new Error("no proposal call"); } }) });
  return handleRoomAction({ principal: ALICE, authority, kp }, input);
}

const view = async (stub: Stub) => { const observed = await (stub as unknown as Data).observe(ALICE) as Data; return observed.readModel ?? observed; };
const stored = (stub: Stub) => runInDurableObject(stub, (instance) => {
  const t = instance as unknown as Data;
  return { state: structuredClone(t.authoritativeReplay().state) as Data, events: structuredClone(t.authorityStore.events()) as Data[] };
});

/** Test precondition, stored as a Room event: the actor hides with a
 * Stealth total nobody can reach. */
async function hideActor(stub: Stub) {
  await runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    const replay = target.authoritativeReplay();
    const conditions = { ...(replay.state.combatRuntime.entities[ACTOR].conditions ?? {}), hidden: { stealthTotal: "40" } };
    const transition = createEventTransition(replay.state, replay.profiles, { rootActionId: "root:hiding-fixture", eventType: "ConditionChanged",
      payload: { entityId: ACTOR, conditions }, visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" });
    target.authorityStore.appendEvents([transition.event]);
    target.authorityStore.updateState(transition.state);
    target.authorityStore.syncAuthorityIndex(transition.state);
  });
}

/** Test precondition: an encounter the actor opens against Naes with the
 * actor first, through the public Rules input and stored as Room events. */
async function startEncounterWithNaes(stub: Stub) {
  await runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    const replay = target.authoritativeReplay();
    const naes = replay.state.combatRuntime.entities[NAES], naesEntity = replay.state.entities[NAES];
    const social = naesEntity.socialMechanics ?? {};
    const scores = naesEntity.abilityScores ?? social.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    let result = target.rulesRuntime.step(replay.profiles, replay.state, { kind: "startEncounter", rootActionId: "root:hiding-combat-fixture",
      proposalAttemptId: "proposal:hiding-combat-fixture", encounterId: "encounter:hiding", sceneId: HALL, participantEntityIds: [ACTOR],
      dynamicEntities: [{ entityId: NAES, name: naesEntity.name, placement: { position: structuredClone(naes.position) },
        mechanics: { kind: "bespokeDefinition", definition: {
          definitionId: "npc-template:hiding:naes", revision: "1", definitionKind: "npcMechanicalTemplate",
          rulesBasis: "srd5.1-2014", causalBasisRefs: [naesEntity.semanticDefinitionRef], visibilityPolicyRef: "visibility:scene-observers",
          content: { schema: "zhuwei.npc-mechanical-template/v1", label: naesEntity.name, footprint: structuredClone(naes.footprint),
            stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
            proficiencyBonus: String(naesEntity.proficiencyBonus ?? social.proficiencyBonus ?? 2),
            armorClass: "11", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "11", shieldBonus: "0" },
            hitPointsMaximum: "9", speedInches: { walk: "360" }, resourceMaximums: {}, deathPolicy: "deadAtZero",
            intrinsicAbilities: [], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } }],
      battlefieldFactIds: [], initiativeGroups: [ACTOR, NAES].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
      hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [NAES] }, { fromEntityIds: [NAES], toEntityIds: [ACTOR] }] });
    const events: unknown[] = [];
    let draw = 0;
    while (result.kind === "awaitingRandomness") {
      events.push(...result.events);
      const waiting = result;
      result = target.rulesRuntime.step(replay.profiles, waiting.state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
        responseId: `authority:hiding:${draw}`, continuationCapability: waiting.continuationCapability,
        randomnessResults: waiting.randomnessRequests.map((request: Data) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
          draws: request.dice.map((term: Data) => ({ sides: Number(term.sides),
            faces: Array.from({ length: Number(term.count) }, () => ++draw === 1 ? 20 : 1) })) })) });
    }
    expect(result.kind, JSON.stringify(result).slice(0, 1500)).toBe("committed");
    events.push(...result.events);
    target.authorityStore.appendEvents(events); target.authorityStore.updateState(result.state); target.authorityStore.syncAuthorityIndex(result.state);
  });
}

it("a hidden actor's map move outside an encounter brings the NPCs' Perception rolls, drawn by the server, with no model call or narration", async () => {
  const stub = await initialize("hiding-map-move-room");
  await hideActor(stub);
  counts.narrations = 0; counts.proposals = 0;
  const before = await stored(stub);
  const moved = await run(stub, { kind: "mapMove", submissionId: "hiding-map-move", spatialRevision: (await view(stub)).tacticalProjection.spatialRevision,
    destination: { kind: "nextTo", ref: LIAN } } as RoomActionInput);
  const after = await stored(stub);
  const added = after.events.slice(before.events.length);
  const detail = JSON.stringify({ moved, events: added.map(event => event.eventType) }).slice(0, 2000);
  // Nobody is asked to roll: the move commits at once.
  expect(moved.kind, detail).toBe("committed");
  expect(counts, "no model call and no narration").toEqual({ narrations: 0, proposals: 0 });
  expect(added.map(event => event.eventType), detail).toContain("CharacterRepositioned");
  const rolled = added.filter(event => event.eventType === "HiddenPerceptionRolled");
  expect(rolled.length, detail).toBeGreaterThan(0);
  expect(rolled.flatMap(event => event.payload.rolls.map((roll: Data) => roll.perceiverRef))).toContain(LIAN);
  expect(rolled.every(event => event.payload.foundByRef === null && event.visibilityPolicyId === "visibility:room-authority-only")).toBe(true);
  expect(after.state.combatRuntime.entities[ACTOR].conditions.hidden).toEqual({ stealthTotal: "40" });
  expect(after.state.combatRuntime.randomnessResolutions).toEqual({});
  const seen = await view(stub);
  expect(seen.tacticalProjection.self.position).toEqual(after.state.combatRuntime.entities[ACTOR].position);
}, 60_000);

it("Hide on the combat map asks the player for its Stealth roll; Naes's turn start then rolls Perception without asking anyone", async () => {
  const stub = await initialize("hiding-combat-room");
  const approached = await run(stub, { kind: "mapMove", submissionId: "hiding-approach", spatialRevision: (await view(stub)).tacticalProjection.spatialRevision,
    destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
  expect(approached.kind, JSON.stringify(approached).slice(0, 800)).toBe("committed");
  await startEncounterWithNaes(stub);
  const start = await view(stub);
  expect(start.tacticalProjection.encounter?.activeEntityId).toBe(ACTOR);
  // The bar offers Hide: Naes is someone to hide from.
  expect(start.combatControls.offers.hide).toBe(true);
  let hid: Data = await run(stub, { kind: "combatAbility", submissionId: "hiding-hide", spatialRevision: start.tacticalProjection.spatialRevision,
    abilityRef: "action:hide", target: { kind: "none" } } as RoomActionInput);
  expect(hid.kind, JSON.stringify(hid).slice(0, 1500)).toBe("awaitingPlayerRoll");
  const pendingRolls = (await (stub as unknown as Data).observe(ALICE) as Data).pendingPlayerRolls as Data[];
  expect(pendingRolls).toHaveLength(1);
  expect(pendingRolls[0]).toMatchObject({ characterId: ACTOR, kind: "check", ability: "dex", skill: "stealth", reason: "为「躲藏」进行检定" });
  hid = await run(stub, { kind: "roll", submissionId: "hiding-hide-roll", randomnessId: String(pendingRolls[0].id) } as RoomActionInput);
  expect(hid.kind, JSON.stringify(hid).slice(0, 1500)).toBe("committed");
  const hidden = await stored(stub);
  expect(hidden.state.combatRuntime.entities[ACTOR].conditions.hidden?.stealthTotal).toMatch(/^-?[0-9]+$/);
  expect((await view(stub)).combatControls.hidden).toBe(true);

  const ended = await run(stub, { kind: "combatEndTurn", submissionId: "hiding-end-turn" } as RoomActionInput);
  const after = await stored(stub);
  const added = after.events.slice(hidden.events.length);
  const detail = JSON.stringify({ ended, events: added.map(event => event.eventType) }).slice(0, 2000);
  expect(ended.kind, detail).toBe("committed");
  const types = added.map(event => event.eventType);
  expect(types.indexOf("TurnStarted"), detail).toBeLessThan(types.indexOf("HiddenPerceptionRolled"));
  const rolled = added.find(event => event.eventType === "HiddenPerceptionRolled");
  expect(rolled?.payload.rolls.map((roll: Data) => roll.perceiverRef)).toEqual([NAES]);
  expect(after.state.combatRuntime.encounters["encounter:hiding"].activeEntityId).toBe(NAES);
  expect(after.state.combatRuntime.randomnessResolutions).toEqual({});
}, 60_000);

// SPEC 0012 §8.1 (ADR 0099 decision 3): Ready from the map names its trigger
// and response; when the trigger comes the player is asked, and uses it with
// its reaction. ADR 0097 decision 4: an attack from the map may name a point.
it("Ready from the map holds a move for Naes's turn start, where the player is asked and uses it", async () => {
  const stub = await initialize("hiding-ready-room");
  const approached = await run(stub, { kind: "mapMove", submissionId: "ready-approach", spatialRevision: (await view(stub)).tacticalProjection.spatialRevision,
    destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
  expect(approached.kind, JSON.stringify(approached).slice(0, 800)).toBe("committed");
  await startEncounterWithNaes(stub);
  const start = await view(stub);
  expect(start.combatControls.offers.ready).toEqual({ triggerRefs: [NAES] });
  const from = start.tacticalProjection.self.position;
  const away = { x: from.x, y: String(BigInt(from.y) - 180n), elevation: from.elevation };
  const readied = await run(stub, { kind: "combatAbility", submissionId: "ready-move", spatialRevision: start.tacticalProjection.spatialRevision,
    abilityRef: "action:ready", target: { kind: "ready", trigger: { ref: NAES, event: "turnStarted" }, response: { kind: "move", path: [from, away] } } } as RoomActionInput);
  expect(readied.kind, JSON.stringify(readied).slice(0, 1500)).toBe("committed");
  const held = await stored(stub);
  const ready = Object.values(held.state.combatRuntime.effects).find((effect: any) => effect.kind === "readiedAction") as Data;
  expect(ready).toMatchObject({ sourceEntityId: ACTOR, trigger: { kind: "perceivable", event: "turnStarted", sourceEntityId: NAES },
    response: { kind: "move", movementMode: "walk", path: [from, away] } });
  expect((await view(stub)).combatControls.offers.ready, "one readied action at a time").toBeNull();
  // Only the Ready action takes a trigger and a response.
  const mismatched = await run(stub, { kind: "combatAbility", submissionId: "ready-mismatch", spatialRevision: (await view(stub)).tacticalProjection.spatialRevision,
    abilityRef: "action:dash", target: { kind: "ready", trigger: { ref: NAES, event: "turnStarted" }, response: { kind: "move", path: [from, away] } } } as RoomActionInput);
  expect(mismatched.kind).toBe("rejected");

  await run(stub, { kind: "combatEndTurn", submissionId: "ready-end-turn" } as RoomActionInput);
  const asked = await (stub as unknown as Data).observe(ALICE) as Data;
  const pendingInputs = ((asked.readModel ?? asked).pendingInputs ?? []) as Data[];
  const pending = pendingInputs.find(entry => entry.reactionKind === "ready");
  expect(pending, JSON.stringify(pendingInputs).slice(0, 1500)).toBeDefined();
  expect(pending!.answerOptions.map((option: Data) => option.answer)).toEqual([{ kind: "useReaction" }, { kind: "decline" }]);
  const used = await run(stub, { kind: "answer", submissionId: "ready-use", pendingInputId: pending!.pendingInputId, answer: { kind: "useReaction" } } as RoomActionInput);
  expect(used.kind, JSON.stringify(used).slice(0, 1500)).toBe("committed");
  const after = await stored(stub);
  expect(after.state.combatRuntime.entities[ACTOR].position).toEqual(away);
  expect(after.state.combatRuntime.entities[ACTOR].turn.reaction).toBe("0");
}, 60_000);

it("an attack from the map aimed at the square Naes stands in strikes Naes", async () => {
  const stub = await initialize("hiding-aim-room");
  const approached = await run(stub, { kind: "mapMove", submissionId: "aim-approach", spatialRevision: (await view(stub)).tacticalProjection.spatialRevision,
    destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
  expect(approached.kind, JSON.stringify(approached).slice(0, 800)).toBe("committed");
  await startEncounterWithNaes(stub);
  const start = await view(stub);
  const strike = Object.entries(start.combatControls.abilities as Data).find(([, usage]) => (usage as Data).attackRoll === true)?.[0];
  expect(strike, "the actor has an attack that can be aimed").toBeTypeOf("string");
  const naesAt = (await stored(stub)).state.combatRuntime.entities[NAES].position;
  let aimed: Data = await run(stub, { kind: "combatAbility", submissionId: "aim-at-naes", spatialRevision: start.tacticalProjection.spatialRevision,
    abilityRef: strike!, target: { kind: "point", position: { x: naesAt.x, y: naesAt.y, elevation: start.tacticalProjection.self.position.elevation } } } as RoomActionInput);
  for (let rolls = 0; aimed.kind === "awaitingPlayerRoll" && rolls < 3; rolls++) {
    const pendingRolls = (await (stub as unknown as Data).observe(ALICE) as Data).pendingPlayerRolls as Data[];
    aimed = await run(stub, { kind: "roll", submissionId: `aim-roll-${rolls}`, randomnessId: String(pendingRolls[0].id) } as RoomActionInput);
  }
  expect(aimed.kind, JSON.stringify(aimed).slice(0, 1500)).toBe("committed");
  const events = (await stored(stub)).events;
  const attack = events.find(event => event.eventType === "AbilityInvoked" && event.payload.sourceEntityId === ACTOR && event.payload.abilityRef === strike);
  expect(attack?.payload.mechanicalResult.attack.aimedPoint).toMatchObject({ x: naesAt.x, y: naesAt.y });
  // Naes is in plain sight: the aim adds no unseen-target disadvantage.
  const request = events.filter(event => event.eventType === "RandomnessRequested").flatMap(event =>
    event.payload.resolution?.randomnessRequests ?? []).find((entry: Data) => String(entry.purposeKey).startsWith("attack:"));
  expect(request?.frozenParameters.targetEntityId).toBe(NAES);
  expect(request?.frozenParameters.disadvantageReasons ?? []).not.toContain("unseenTarget2014");
}, 60_000);
