import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { compileAbilityDefinition, registeredAbilityRecord } from "../app/_runtime/lib/rules/profiles/ability-compiler";
import { createEventTransition, createScopeProof } from "../app/_runtime/lib/rules/v2/events";
import { characterTimelineId } from "../app/_runtime/lib/rules/v2/timeline";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest,
  step as rulesStep, replay as rulesReplay } from "../app/_runtime/lib/rules";

type RecordValue = Record<string, unknown>;
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Internals = RoomAuthorityCapability & {
  authorityRoll(sides: number): number;
  authorityRecoveryCheckpoint?: (name: string) => void;
  authoritativeReplay(): { state: AuthoritativeWorldState; genesis: RuntimeGenesis; profiles: RuntimeProfileManifest };
  appendAuthorityTransition(state: AuthoritativeWorldState, events: EventEnvelope[]): void;
  authorityStore: {
    transaction<T>(fn: () => T): T;
    events(): EventEnvelope[];
    pendingDueWork(): RecordValue[];
    dueWorkByRoot(root: string): RecordValue | undefined;
    proposalRecovery(root: string): unknown;
  };
  rulesRuntime: { step: typeof rulesStep; replay: typeof rulesReplay };
  commitDueActivity(root: string): Promise<unknown>;
};
const ALICE = { principal: { id: "principal:sustained-room:alice", sessionVersion: 1 } };
const BOB = { principal: { id: "principal:sustained-room:bob", sessionVersion: 1 } };
const ACTOR = "character:sustained-room:alice", REACTOR = "character:sustained-room:bob";
const LONG_SPELL = "ability:sustained-room:duration", COUNTERSPELL = "ability:sustained-room:reaction";
function record(value: unknown): RecordValue { return value as RecordValue; }

async function initialize(name: string): Promise<Stub> {
  const stub = env.VNEXT_ROOMS.getByName(name);
  const character = (characterId: string, principal: typeof ALICE) => ({ characterId,
    controllerPrincipalId: principal.principal.id,
    staticCard: { name: characterId === ACTOR ? "施法者" : "反制者", sceneId: "wake", level: 5,
      classId: "wizard", raceId: "human", subclassId: "evocation", scores: { str: 10, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
      proficiency: 3, skills: ["arcana"], resources: { hitDice: { max: 5, used: 0 },
        [characterId === ACTOR ? "slot1" : "slot3"]: { max: 1, used: 0 } },
      hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } });
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }, { principalId: BOB.principal.id, role: "player" }],
    characters: [character(ACTOR, ALICE), character(REACTOR, BOB)],
    vNextSeed: { semanticDefinitions: [], itemDefinitions: [], itemEntries: [], entityDefinitionBindings: [] },
  } as never)).toMatchObject({ created: true });
  return stub;
}

// These registered mechanical definitions are trusted test fixtures. They are
// inserted through validated event transitions and the real Room journal, not
// claimed as KP authoring, catalog coverage, or a player-facing spell entrypoint.
async function seedAndBegin(stub: Stub) {
  return runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals;
    const definitions = [
      { characterId: ACTOR, definitionId: LONG_SPELL, level: "1", source: {
        definitionId: LONG_SPELL, revision: "1", rulesBasis: "srd5.1-2014",
        activation: { kind: "actionSpell", spellLevel: "1", castingTimeMicros: "12000000" },
        target: { kind: "creature", count: "1", rangeInches: "600", requiresSight: true },
        costs: [{ kind: "spellSlot", level: "1", amount: "1" }], damage: [{ type: "force", formula: "1d4" }],
      } },
      { characterId: REACTOR, definitionId: COUNTERSPELL, level: "3", source: {
        definitionId: COUNTERSPELL, revision: "1", rulesBasis: "srd5.1-2014",
        activation: { kind: "reactionSpell", spellLevel: "3" },
        costs: [{ kind: "spellSlot", level: "3", amount: "1" }], effect: { kind: "counterspell", rangeInches: "720" },
      } },
    ];
    for (const entry of definitions) {
      const compiled = compileAbilityDefinition(entry.source);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      if (!compiled.ok) throw new Error("registered test definition failed compilation");
      const { state, profiles } = target.authoritativeReplay();
      const combatEntity = structuredClone(state.combatRuntime.entities[entry.characterId]);
      combatEntity.abilityRefs = [entry.definitionId];
      combatEntity.resources = { [`spellSlot:${entry.level}`]: { current: "1", maximum: "1" } };
      combatEntity.spellcasting = { ability: "int", spellAttackBonus: "6", spellSaveDc: "14" };
      combatEntity.position = { x: entry.characterId === ACTOR ? "-180" : "-60", y: "-240", elevation: "0" };
      delete combatEntity.turn;
      const seeded = createEventTransition(state, profiles, { rootActionId: `fixture:mechanics:${entry.characterId}`,
        eventType: "CharacterMechanicsSynchronized", payload: { characterId: entry.characterId, combatEntity,
          definitions: [registeredAbilityRecord(compiled.artifact)] },
        scopeProof: createScopeProof(state, [], [`combat-entity:${entry.characterId}`], []),
        visibilityPolicyId: `visibility:character-controller:${entry.characterId}`, secrecy: "private" });
      target.authorityStore.transaction(() => target.appendAuthorityTransition(seeded.state, [seeded.event]));
    }
    const { state, profiles } = target.authoritativeReplay();
    const started = target.rulesRuntime.step(profiles, state, { kind: "invokeAbility", rootActionId: "fixture:begin-long-cast",
      sourceEntityId: ACTOR, abilityRef: LONG_SPELL, parameters: { targetEntityId: REACTOR } });
    expect(started.kind, JSON.stringify(started)).toBe("committed");
    if (started.kind !== "committed") throw new Error("test casting did not start");
    target.authorityStore.transaction(() => target.appendAuthorityTransition(started.state as AuthoritativeWorldState, started.events));
    const activity = Object.values((started.state as AuthoritativeWorldState).campaignRuntime.activities)
      .find(value => value.activityKind === "longSpellcasting")!;
    const due = target.authorityStore.pendingDueWork();
    expect(due).toHaveLength(1);
    return { activityId: String(activity.activityId), advanceRoot: String(due[0].child_root_action_id),
      completionRoot: `long-spell-due:${activity.activityId}:${BigInt(String(activity.startedAtFictionMicros)) + 12000000n}` };
  });
}

async function snapshot(stub: Stub, root: string) {
  return runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals;
    return { state: structuredClone(target.authoritativeReplay().state), events: structuredClone(target.authorityStore.events()),
      due: structuredClone(target.authorityStore.pendingDueWork()), work: structuredClone(target.authorityStore.dueWorkByRoot(root)),
      recovery: target.authorityStore.proposalRecovery(root) };
  });
}
async function settle(stub: Stub, root: string) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    target.authorityRoll = () => { throw new Error("this deterministic Counterspell fixture must not draw dice"); };
    return target.commitDueActivity(root);
  });
}

async function appendUnrelatedMechanicsSnapshot(stub: Stub) {
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { state, profiles } = target.authoritativeReplay();
    const combatEntity = structuredClone(state.combatRuntime.entities[REACTOR]);
    const appended = createEventTransition(state, profiles, { rootActionId: "fixture:unrelated-mechanics-snapshot",
      eventType: "CharacterMechanicsSynchronized", payload: { characterId: REACTOR, combatEntity,
        definitions: [state.combatRuntime.definitions[COUNTERSPELL]] },
      scopeProof: createScopeProof(state, [], [`combat-entity:${REACTOR}`], []),
      visibilityPolicyId: `visibility:character-controller:${REACTOR}`, secrecy: "private" });
    target.authorityStore.transaction(() => target.appendAuthorityTransition(appended.state, [appended.event]));
  });
}

it("durable long casting survives segmented due eviction and direct Counterspell without a randomness journal or repeated costs", async () => {
  const stub = await initialize("vnext-sustained-room-counterspell"), roots = await seedAndBegin(stub);
  const started = await snapshot(stub, roots.advanceRoot), timeline = characterTimelineId(started.state, ACTOR)!;
  expect(started.state.combatRuntime.entities[ACTOR].resources).toMatchObject({ "spellSlot:1": { current: "1" } });
  expect(started.events.filter(event => event.eventType === "ResourceSpent")).toHaveLength(0);
  await evictDurableObject(stub);
  expect(await settle(stub, roots.advanceRoot)).toMatchObject({ kind: "committed" });
  const advanced = await snapshot(stub, roots.completionRoot);
  expect(BigInt(advanced.state.fictionTimelines[timeline].nowMicros) - BigInt(started.state.fictionTimelines[timeline].nowMicros)).toBe(12000000n);
  expect(advanced.work).toMatchObject({ status: "pending" });
  expect(advanced.state.campaignRuntime.activities[roots.activityId].status).toBe("active");
  await evictDurableObject(stub);
  const awaiting = record(await settle(stub, roots.completionRoot));
  expect(awaiting, JSON.stringify(awaiting)).toMatchObject({ kind: "awaitingInput",
    pending: { kind: "combatChoice", reactionKind: "counterspell" } });
  const pending = record(awaiting.pending), first = await snapshot(stub, roots.completionRoot);
  expect(first.state.campaignRuntime.activities[roots.activityId].status).toBe("completed");
  expect(first.work).toMatchObject({ status: "pending" });
  expect(first.recovery).toBeUndefined();
  expect(first.state.combatRuntime.entities[ACTOR].resources).toMatchObject({ "spellSlot:1": { current: "0" } });
  expect(first.events.filter(event => event.eventType === "ResourceSpent" && record(event.payload).entityId === ACTOR)).toHaveLength(1);

  // An unrelated authoritative append must preserve the due obligation from
  // the live pending root even though ActivityCompleted removed its descriptor.
  await appendUnrelatedMechanicsSnapshot(stub);
  const afterAppend = await snapshot(stub, roots.completionRoot);
  expect(afterAppend.work, JSON.stringify({ receiptStatus: afterAppend.state.receipts[roots.completionRoot]?.status,
    pendingRoots: Object.values(afterAppend.state.pendingInputs).map(value => value.rootActionId),
    combatPendingRoots: Object.values(afterAppend.state.combatRuntime.pendingInputs).map(value => value.rootActionId) })).toMatchObject({ status: "pending" });
  await evictDurableObject(stub);
  const beforeRetry = await snapshot(stub, roots.completionRoot);
  const retried = await settle(stub, roots.completionRoot);
  expect(retried, JSON.stringify(retried)).toMatchObject({ kind: "awaitingInput", pending: { pendingInputId: pending.pendingInputId } });
  expect((await snapshot(stub, roots.completionRoot)).events).toEqual(beforeRetry.events);

  const prepared = record(await stub.prepare(BOB as never, { kind: "answer", submissionId: "submission:sustained-room:answer",
    pendingInputId: pending.pendingInputId, answer: { kind: "useReaction", abilityRef: COUNTERSPELL, slotLevel: "3" } } as never));
  expect(prepared, JSON.stringify(prepared)).toMatchObject({ kind: "prepared", rootActionId: roots.completionRoot, resolutionMode: "authorityDirect" });
  const answer = { kind: "authenticatedPendingAnswer", rootActionId: roots.completionRoot };
  const done = await stub.commit(BOB as never, String(prepared.preparedActionId), answer as never);
  expect(done, JSON.stringify(done)).toMatchObject({ kind: "committed",
    receipt: { rootActionId: roots.completionRoot, actorCharacterId: ACTOR } });
  const finished = await snapshot(stub, roots.completionRoot);
  expect(finished.work).toMatchObject({ status: "committed" });
  expect(finished.due).toHaveLength(0);
  expect(finished.state.combatRuntime.entities[REACTOR].hitPoints).toMatchObject({ current: "20" });
  expect(finished.state.combatRuntime.entities[REACTOR].resources).toMatchObject({ "spellSlot:3": { current: "0" } });
  expect(finished.events.filter(event => event.eventType === "ResourceSpent" && record(event.payload).entityId === ACTOR)).toHaveLength(1);
  expect(finished.events.filter(event => event.eventType === "ResourceSpent" && record(event.payload).entityId === REACTOR)).toHaveLength(1);
  expect(finished.events.filter(event => event.eventType === "SpellCountered")).toHaveLength(1);
  await evictDurableObject(stub);
  expect(await stub.commit(BOB as never, String(prepared.preparedActionId), answer as never)).toEqual(done);
  expect((await snapshot(stub, roots.completionRoot)).events).toEqual(finished.events);
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { genesis, state } = target.authoritativeReplay();
    const replayed = target.rulesRuntime.replay(genesis, target.authorityStore.events());
    expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
    if (replayed.kind === "replayed") expect(replayed.state).toEqual(state);
  });
}, 30_000);

it("declining Counterspell recovers the answer's automatic damage candidate after eviction without repeating the original due work", async () => {
  const stub = await initialize("vnext-sustained-room-decline"), roots = await seedAndBegin(stub);
  expect(await settle(stub, roots.advanceRoot)).toMatchObject({ kind: "committed" });
  const awaiting = record(await settle(stub, roots.completionRoot));
  expect(awaiting, JSON.stringify(awaiting)).toMatchObject({ kind: "awaitingInput", pending: { reactionKind: "counterspell" } });
  const pending = record(awaiting.pending);
  const prepared = record(await stub.prepare(BOB as never, { kind: "answer", submissionId: "submission:sustained-room:decline",
    pendingInputId: pending.pendingInputId, answer: { kind: "decline" } } as never));
  expect(prepared, JSON.stringify(prepared)).toMatchObject({ kind: "prepared", rootActionId: roots.completionRoot });
  let draws = 0;
  const installRollCounter = () => runInDurableObject(stub, instance => {
    (instance as unknown as Internals).authorityRoll = sides => {
      expect(sides).toBe(4);
      draws += 1;
      return 4;
    };
  });
  await installRollCounter();
  const answer = { kind: "authenticatedPendingAnswer", rootActionId: roots.completionRoot };
  await expect(runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    target.authorityRecoveryCheckpoint = name => {
      if (name === "afterRandomnessCandidateCommit") throw new Error("simulated-crash:sustained-damage-candidate");
    };
    return target.commit(BOB, String(prepared.preparedActionId), answer);
  })).rejects.toThrow("simulated-crash:sustained-damage-candidate");
  expect(draws).toBe(1);
  const saved = await snapshot(stub, roots.completionRoot);
  expect(saved.work).toMatchObject({ status: "pending" });
  expect(saved.recovery).toBeUndefined();
  expect(saved.state.receipts[roots.completionRoot].status).toBe("awaitingRandomness");
  expect(saved.state.combatRuntime.entities[REACTOR].hitPoints).toMatchObject({ current: "20" });
  const answerJournal = await runInDurableObject(stub, instance => (instance as unknown as Internals)
    .authorityStore.proposalRecovery(String(prepared.preparedActionId)));
  expect(answerJournal).toBeDefined();
  await appendUnrelatedMechanicsSnapshot(stub);
  const afterAppend = await snapshot(stub, roots.completionRoot);
  expect(afterAppend.work).toMatchObject({ status: "pending" });
  expect(afterAppend.events).toHaveLength(saved.events.length + 1);
  expect(afterAppend.state.receipts[roots.completionRoot].status).toBe("awaitingRandomness");
  expect(draws).toBe(1);
  // Existing combat dice are generated by authority. This branch exercises
  // their durable candidate recovery, without adding a player-roll gesture.
  const aliceView = record(await stub.observe(ALICE as never)), bobView = record(await stub.observe(BOB as never));
  expect(aliceView.pendingPlayerRolls).toEqual([]);
  expect(bobView.pendingPlayerRolls).toEqual([]);
  await evictDurableObject(stub);
  await installRollCounter();
  expect((await snapshot(stub, roots.completionRoot)).work).toMatchObject({ status: "pending" });
  const beforeRetry = await snapshot(stub, roots.completionRoot);
  const oldDueRetry = await runInDurableObject(stub, instance => (instance as unknown as Internals).commitDueActivity(roots.completionRoot));
  expect(oldDueRetry, JSON.stringify(oldDueRetry)).toMatchObject({ kind: "rejected", code: "pendingInputUnresolved" });
  expect((await snapshot(stub, roots.completionRoot)).events).toEqual(beforeRetry.events);
  expect(draws).toBe(1);
  const unauthorized = await stub.commit(ALICE as never, String(prepared.preparedActionId), answer as never);
  expect(unauthorized, JSON.stringify(unauthorized)).toMatchObject({ kind: "rejected" });
  expect(draws).toBe(1);
  const done = await stub.commit(BOB as never, String(prepared.preparedActionId), answer as never);
  expect(done, JSON.stringify(done)).toMatchObject({ kind: "committed",
    receipt: { rootActionId: roots.completionRoot, actorCharacterId: ACTOR } });
  expect(draws).toBe(1);
  const finished = await snapshot(stub, roots.completionRoot);
  expect(finished.work).toMatchObject({ status: "committed" });
  expect(finished.due).toHaveLength(0);
  expect(finished.state.combatRuntime.entities[REACTOR].hitPoints).toMatchObject({ current: "16" });
  expect(finished.state.combatRuntime.entities[REACTOR].resources).toMatchObject({ "spellSlot:3": { current: "1" } });
  expect(finished.state.combatRuntime.entities[ACTOR].resources).toMatchObject({ "spellSlot:1": { current: "0" } });
  expect(finished.events.filter(event => event.eventType === "ResourceSpent" && record(event.payload).entityId === ACTOR)).toHaveLength(1);
  expect(finished.events.filter(event => event.eventType === "ResourceSpent" && record(event.payload).entityId === REACTOR)).toHaveLength(0);
  expect(finished.events.filter(event => event.eventType === "DamagePacketResolved" && record(event.payload).targetEntityId === REACTOR)).toHaveLength(1);
  await evictDurableObject(stub);
  await installRollCounter();
  expect(await stub.commit(BOB as never, String(prepared.preparedActionId), answer as never)).toEqual(done);
  expect(draws).toBe(1);
  expect((await snapshot(stub, roots.completionRoot)).events).toEqual(finished.events);
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { genesis, state } = target.authoritativeReplay();
    const replayed = target.rulesRuntime.replay(genesis, target.authorityStore.events());
    expect(replayed.kind, JSON.stringify(replayed)).toBe("replayed");
    if (replayed.kind === "replayed") expect(replayed.state).toEqual(state);
  });
}, 30_000);
