import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRoomAction, type RoomActionInput, type RoomAuthorityCapability } from "../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../app/_runtime/lib/kp/vnext/adapter";
import type { AuthoritativeKpAdapter } from "../app/_runtime/lib/kp/authoritative-types";
import type { VNextInvocationRequest, VNextInvocationStart, VNextInvocationCompletion } from "../app/_runtime/lib/room/vnext-proposal-invocation";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import { compileSheet } from "../app/_runtime/lib/dnd/compute";
import { canonicalSha256 } from "../app/_runtime/lib/rules/profiles/canonical";
import { compileStaticCharacterCombat } from "../app/_runtime/lib/rules/v2/character-abilities";
import { compileAbilityDefinition, isRegisteredAbilityRecord, registeredAbilityRecord } from "../app/_runtime/lib/rules/profiles/ability-compiler";
import { createEventTransition, createScopeProof } from "../app/_runtime/lib/rules/v2/events";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis, RuntimeProfileManifest,
  step as rulesStep, replay as rulesReplay } from "../app/_runtime/lib/rules";

type RecordValue = Record<string, unknown>;
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Internals = RoomAuthorityCapability & {
  authorityRoll(sides: number): number;
  authorityRecoveryCheckpoint?: (name: string) => void;
  authoritativeReplay(): { state: AuthoritativeWorldState; genesis: RuntimeGenesis; profiles: RuntimeProfileManifest };
  appendAuthorityTransition(state: AuthoritativeWorldState, events: EventEnvelope[]): void;
  beginVNextProposalInvocation(principal: typeof PRINCIPAL, id: string, input: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(principal: typeof PRINCIPAL, id: string, input: VNextInvocationCompletion): Promise<{ kind: string }>;
  authorityStore: { transaction<T>(fn: () => T): T; events(): EventEnvelope[]; pendingDueWork(): RecordValue[] };
  rulesRuntime: { step: typeof rulesStep; replay: typeof rulesReplay };
};
// Normal authenticated identities can contain substrings resembling dice. They
// must survive card compilation, later registration, and replay unchanged.
const PRINCIPAL = { principal: { id: "11111111-1111-4111-8111-12345d678901", sessionVersion: 1 } };
const ACTOR = `character:${PRINCIPAL.principal.id}`, ABILITY = "ability:registered:room-protocol";
const record = (value: unknown) => value as RecordValue;
type Capture = { requests: RecordValue[]; draws: number; narrationRequests?: RecordValue[]; crashAt?: string; wire?: RecordValue; rawArguments?: string; sides?: number[]; echoIntent?: boolean; failAfterSaveOrdinal?: number };

async function initialize(name: string, long = false): Promise<Stub> {
  const stub = env.VNEXT_ROOMS.getByName(name);
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: PRINCIPAL.principal.id, role: "host" }], characters: [{ characterId: ACTOR,
      controllerPrincipalId: PRINCIPAL.principal.id,
      staticCard: { name: "施法者", sceneId: "wake", level: 3, classId: "cleric", raceId: "human", subclassId: "knowledge",
        scores: { str: 10, dex: 14, con: 12, int: 12, wis: 16, cha: 10 }, proficiency: 2, skills: ["religion"],
        resources: { hitDice: { max: 3, used: 0 }, slot1: { max: 2, used: 0 } }, hp: { current: 10, max: 20, temp: 0 }, ac: 13, speed: 30, equipped: {}, backpack: [] } }],
    vNextSeed: { semanticDefinitions: [], itemDefinitions: [], itemEntries: [], entityDefinitionBindings: [] },
  } as never)).toMatchObject({ created: true });
  // Trusted registered fixture tests the KP interface and Room scheduling.
  // It does not prove production long/ritual catalog coverage.
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { state, profiles } = target.authoritativeReplay();
    const compiled = compileAbilityDefinition({ definitionId: ABILITY, revision: "1", rulesBasis: "srd5.1-2014",
      activation: { kind: "actionSpell", spellLevel: "1", ...(long ? { castingTimeMicros: "12000000", ritual: true } : {}) },
      target: { kind: "creature", count: "1", rangeInches: "600" }, costs: [{ kind: "spellSlot", level: "1", amount: "1" }], healing: { formula: "1d4+1" } });
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true); if (!compiled.ok) throw new Error("fixture did not compile");
    const combatEntity = structuredClone(state.combatRuntime.entities[ACTOR]);
    combatEntity.abilityRefs = [ABILITY]; combatEntity.resources = { "spellSlot:1": { current: "2", maximum: "2" } };
    delete combatEntity.turn;
    const seeded = createEventTransition(state, profiles, { rootActionId: "fixture:ability-catalog",
      eventType: "CharacterMechanicsSynchronized", payload: { characterId: ACTOR, combatEntity, definitions: [registeredAbilityRecord(compiled.artifact)] },
      scopeProof: createScopeProof(state, [], [`combat-entity:${ACTOR}`], []),
      visibilityPolicyId: `visibility:character-controller:${ACTOR}`, secrecy: "private" });
    target.authorityStore.transaction(() => target.appendAuthorityTransition(seeded.state, [seeded.event]));
  });
  return stub;
}
async function run(stub: Stub, input: RoomActionInput, c: Capture) {
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals;
    target.authorityRoll = sides => { if (c.sides === undefined) expect(sides).toBe(4); else c.sides.push(sides); c.draws++; return 2; };
    target.authorityRecoveryCheckpoint = name => { if (name === c.crashAt) { c.crashAt = undefined; throw new Error(`interrupted:${name}`); } };
  });
  const target = stub as unknown as Internals;
  const narrationAdapter = { async propose() { throw new Error("vNext proposal binding owns filling"); },
    async narrate(request: RecordValue) { c.narrationRequests?.push(structuredClone(request)); return { body: "权威行动已记录。" }; } } as unknown as AuthoritativeKpAdapter;
  const kp = createVNextKpAdapter({ narrationAdapter, journal: {
    begin: (id, request) => target.beginVNextProposalInvocation(PRINCIPAL, id, request),
    async complete(id, completion) {
      const saved = await target.completeVNextProposalInvocation(PRINCIPAL, id, completion);
      if (c.failAfterSaveOrdinal === completion.ordinal && completion.result.kind === "completed") {
        c.failAfterSaveOrdinal = undefined;
        throw Object.assign(new Error("simulated disconnect after durable response save"), { code: "modelTransient" });
      }
      return saved;
    },
  }, proposalBinding: { async run(_model, request) {
    c.requests.push(structuredClone(request)); if (c.wire === undefined) throw new Error("frozen proposal must be reused");
    const name = String(record(record((request.tools as RecordValue[])[0]).function).name);
    const value = name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME
      ? { requestedCapabilities: ["abilityOperation"] }
      : name === CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME ? { confirm: "server-plan", summaries: [] } : c.wire;
    if (c.echoIntent && name !== OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME && name !== CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME) {
      const context = JSON.parse(String(record((request.messages as RecordValue[])[1]).content)).requiredContext;
      record(record(value).decision).intent = structuredClone(context.intent);
    }
    const argumentsText = name !== OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME && name !== CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME
      ? c.rawArguments ?? JSON.stringify(value) : JSON.stringify(value);
    return { choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: argumentsText } }] } }] };
  } } });
  return handleRoomAction({ principal: PRINCIPAL, authority: target, kp }, input);
}
async function snapshot(stub: Stub) { return runInDurableObject(stub, instance => {
  const target = instance as unknown as Internals, { state, genesis } = target.authoritativeReplay();
  const events = target.authorityStore.events(), rebuilt = target.rulesRuntime.replay(genesis, events);
  expect(rebuilt.kind).toBe("replayed"); if (rebuilt.kind === "replayed") expect(rebuilt.state).toEqual(state);
  return { state: structuredClone(state), genesis: structuredClone(genesis), events: structuredClone(events), due: structuredClone(target.authorityStore.pendingDueWork()) };
}); }
function wire(castingMode = "normal") { return { decision: { kind: "abilityOperation", operation: {
  kind: "invoke", abilityRef: ABILITY, castingMode, target: { kind: "creatures", refs: [ACTOR] } } } }; }

it("normal Room filling saves native randomness and recovers the same submission without another model call, die, or slot", async () => {
  const stub = await initialize("vnext-native-ability-recovery"), input: RoomActionInput = {
    kind: "intent", submissionId: "submission:native-ability:recovery", text: "我用已经掌握的治疗法术为自己治疗。" };
  const c: Capture = { requests: [], narrationRequests: [], draws: 0, wire: wire(), crashAt: "afterRandomnessCandidateCommit" };
  expect(await run(stub, input, c)).toMatchObject({ kind: "retryableFailure", code: "authorityTransient" });
  expect(c.draws).toBe(1); expect(c.requests).toHaveLength(2);
  const first = await snapshot(stub); expect(first.events.filter(event => event.eventType === "HealingResolved")).toHaveLength(0);
  await evictDurableObject(stub); c.wire = undefined;
  const done = await run(stub, input, c); expect(done, JSON.stringify(done)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub);
  expect(after.state.combatRuntime.entities[ACTOR].hitPoints.current).toBe("13");
  expect(after.state.combatRuntime.entities[ACTOR].resources).toMatchObject({ "spellSlot:1": { current: "1", maximum: "2" } });
  expect(after.state.entities[ACTOR].resources?.slot1).toBe(1);
  expect(after.state.entities[ACTOR].resources).not.toHaveProperty("spellSlot:1");
  expect(after.state.entities[ACTOR].resourceMaximums?.slot1).toBe(2);
  expect(after.events.filter(event => event.eventType === "ResourceSpent")).toHaveLength(1);
  expect(after.events.filter(event => event.eventType === "HealingResolved")).toHaveLength(1);
  expect(c.requests).toHaveLength(2); expect(c.draws).toBe(1);
  await evictDurableObject(stub); expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(after.events); expect(c.draws).toBe(1); expect(c.requests).toHaveLength(2);
  expect((await snapshot(stub)).state).toEqual(after.state);
  expect(c.narrationRequests).toHaveLength(1);
  const frozenClaims = record(c.narrationRequests![0].renderableClaims).claims as RecordValue[];
  expect(frozenClaims.find(claim => claim.outcomeCode === "resourceChanged")?.summary).toMatch(/1 环法术位.*消耗.*1.*剩余.*1/u);
  expect(frozenClaims.find(claim => claim.outcomeCode === "healingCapacity")?.summary).toContain("13/20");
}, 30_000);


it("exact intent echo third-call response survives eviction and commits dice and resources once", async () => {
  const stub = await initialize("vnext-native-echo-confirmation-recovery"), input: RoomActionInput = {
    kind: "intent", submissionId: "submission:native-echo:recovery", text: "我对自己施放已掌握的治疗法术。" };
  const before = await snapshot(stub);
  const c: Capture = { requests: [], draws: 0, wire: wire(), echoIntent: true, failAfterSaveOrdinal: 3 };
  expect(await run(stub, input, c)).toMatchObject({ kind: "retryableFailure" });
  expect(c.requests).toHaveLength(3); expect(c.draws).toBe(0);
  expect((await snapshot(stub)).events).toEqual(before.events);
  const prompt = JSON.parse(String(record((c.requests[2].messages as RecordValue[])[1]).content));
  expect(prompt.allowedPaths).toEqual([["decision", "intent"]]);
  expect(prompt.repairPlan).toEqual([{ path: ["decision", "intent"], operation: "remove", reason: "exact-frozen-intent-echo" }]);
  expect(prompt.summaryPaths).toEqual([]);
  expect(prompt.diagnostics).toContainEqual(expect.objectContaining({ path: ["decision", "intent"], pathBase: "arguments",
    repair: expect.objectContaining({ allowed: true, changes: [expect.objectContaining({ path: ["decision", "intent"], operation: "remove" })] }) }));
  expect(JSON.parse(prompt.originalArguments).decision.intent.text).toBe(input.text);
  await evictDurableObject(stub); c.wire = undefined;
  const done = await run(stub, input, c); expect(done, JSON.stringify(done)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub);
  expect(after.state.combatRuntime.entities[ACTOR].hitPoints.current).toBe("13");
  expect(after.state.combatRuntime.entities[ACTOR].resources).toMatchObject({ "spellSlot:1": { current: "1", maximum: "2" } });
  expect(after.state.entities[ACTOR].resources?.slot1).toBe(1);
  expect(after.events.filter(event => event.eventType === "ResourceSpent")).toHaveLength(1);
  expect(after.events.filter(event => event.eventType === "HealingResolved")).toHaveLength(1);
  expect(c.requests).toHaveLength(3); expect(c.draws).toBe(1);
  await evictDurableObject(stub); expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(after.events); expect((await snapshot(stub)).state).toEqual(after.state);
  expect(c.requests).toHaveLength(3); expect(c.draws).toBe(1);
}, 30_000);


it("normal Room native ritual filling starts a real Activity and the existing due tail applies its saved healing once", async () => {
  const stub = await initialize("vnext-native-ability-ritual", true), c: Capture = { requests: [], draws: 0, wire: wire("ritual") };
  const input: RoomActionInput = { kind: "intent", submissionId: "submission:native-ability:ritual", text: "我以仪式方式对自己完成已经掌握的法术。" };
  const result = await run(stub, input, c); expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub), activity = Object.values(after.state.campaignRuntime.activities).find(value => value.activityKind === "longSpellcasting");
  expect(activity).toMatchObject({ status: "completed", intendedDurationMicros: "612000000" });
  expect(after.state.combatRuntime.entities[ACTOR].hitPoints.current).toBe("13");
  expect(after.state.combatRuntime.entities[ACTOR].resources).toMatchObject({ "spellSlot:1": { current: "2" } });
  expect(after.events.filter(event => event.eventType === "ResourceSpent")).toHaveLength(0);
  expect(after.events.filter(event => event.eventType === "HealingResolved")).toHaveLength(1);
  expect(after.due).toHaveLength(0); expect(c.requests).toHaveLength(2); expect(c.draws).toBe(1);
  c.wire = undefined; await evictDurableObject(stub); expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(after.events); expect(c.requests).toHaveLength(2); expect(c.draws).toBe(1);
}, 30_000);

it("selected native execution can use the third call only to confirm its proven JSON shell repair", async () => {
  const stub = await initialize("vnext-native-ability-repair"), draft = wire();
  const c: Capture = { requests: [], draws: 0, wire: draft, rawArguments: JSON.stringify(draft).slice(0, -1) };
  const input: RoomActionInput = { kind: "intent", submissionId: "submission:native-ability:repair", text: "我用已经掌握的治疗法术为自己治疗。" };
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  const after = await snapshot(stub);
  expect(after.state.combatRuntime.entities[ACTOR].hitPoints.current).toBe("13");
  expect(after.events.filter(event => event.eventType === "ResourceSpent")).toHaveLength(1);
  expect(c.requests).toHaveLength(3); expect(c.draws).toBe(1);
  expect(record(record((c.requests[2].tools as RecordValue[])[0]).function).name).toBe(CORRECT_KP_PROPOSAL_BUNDLE_TOOL_NAME);
  c.wire = undefined; await evictDurableObject(stub);
  expect(await run(stub, input, c)).toMatchObject({ kind: "committed" });
  expect((await snapshot(stub)).events).toEqual(after.events); expect(c.requests).toHaveLength(3); expect(c.draws).toBe(1);
}, 30_000);


for (const later of [false, true]) it(`production Room: compiled player card and noncombat spells leave the room ready for ${later ? "later materialization" : "joined character registration"}`, async () => {
  const roomId = `vnext-native-real-initial-catalog-${later}`, stub = env.ROOMS.getByName(roomId);
  const card = { ...compileSheet({ name: "旅行牧师", raceId: "human", classId: "cleric", subclassId: "knowledge", backgroundId: "acolyte",
    scores: { str: 8, dex: 14, con: 13, int: 12, wis: 15, cha: 10 }, extraSkillIds: ["history", "medicine", "persuasion"],
    cantrips: ["guidance", "sacred-flame", "thaumaturgy"], prepared: ["cure", "healing-word", "guiding-bolt", "detect-magic", "silence", "prayer"],
    spellbook: [], equipmentChoice: 0, appearance: "身着旅行斗篷，随身携带圣徽。", trait: "先观察再行动。", ideal: "尊重事实。", bond: "照顾同伴。", flaw: "有些谨慎。" }), sceneId: "wake" };
  expect(card.hp).toEqual({ current: 24, max: 24, temp: 0 }); expect(card.scores.wis).toBe(16);
  // No trusted mechanics event or test registration: this is the real card-to-Room
  // initialization consumer, while the table HTTP create/lock/start path is separate.
  const initialized = record(await stub.initializeAuthoritative({ roomId, moduleId: "black-oak-will",
    members: [{ principalId: PRINCIPAL.principal.id, role: "host" }],
    characters: [{ characterId: ACTOR, controllerPrincipalId: PRINCIPAL.principal.id, staticCard: card }],
    vNextSeed: { semanticDefinitions: [], itemDefinitions: [], itemEntries: [], entityDefinitionBindings: [] },
  } as never));
  expect(initialized).toMatchObject({ created: true });
  const initial = await snapshot(stub);
  const definitions = initial.state.combatRuntime.definitions;
  const oldSources = compileStaticCharacterCombat(initial.state.entities[ACTOR], card,
    initial.state.campaignRuntime.itemSystem, definitions);
  for (const [ref, source] of Object.entries(oldSources.definitions)) {
    expect(isRegisteredAbilityRecord(definitions[ref]), ref).toBe(true);
    expect(definitions[ref].definitionHash).toBe(canonicalSha256(source));
  }
  expect(initial.events.some(event => event.eventType === "CharacterMechanicsSynchronized")).toBe(false);
  const c: Capture = { requests: [], narrationRequests: [], draws: 0, sides: [] };
  for (const spellId of ["cure", "healing-word"]) {
    const ref = (initial.state.combatRuntime.entities[ACTOR].abilityRefs as string[])
      .find(ref => definitions[ref].sourceSpellId === spellId);
    expect(ref).toBeTypeOf("string");
    c.wire = { decision: { kind: "abilityOperation", operation: {
      kind: "invoke", abilityRef: ref, castingMode: "normal", target: { kind: "creatures", refs: [ACTOR] } } } };
    const result = await run(stub, { kind: "intent", submissionId: `submission:real-catalog:${spellId}`, text: `我对自己施放已经准备的${spellId}。` }, c);
    expect(result, JSON.stringify(result)).toMatchObject({ kind: "committed" });
    expect((await snapshot(stub)).state.combatRuntime.entities[ACTOR].turn).toBeUndefined();
    const frozenClaims = record(c.narrationRequests!.at(-1)!.renderableClaims).claims as RecordValue[];
    expect(frozenClaims.find(claim => claim.kind === "abilityEffectApplied")?.abilityName)
      .toBe(spellId === "cure" ? "治愈伤口" : "治愈真言");
    expect(frozenClaims.find(claim => claim.outcomeCode === "healed")?.summary).toContain("实际恢复了 0 点生命值");
    expect(frozenClaims.find(claim => claim.outcomeCode === "healingCapacity")?.summary).toContain("治疗前生命值已达到上限");
    expect(frozenClaims.find(claim => claim.outcomeCode === "resourceChanged")?.summary)
      .toContain(`1 环法术位的剩余数量为 ${spellId === "cure" ? 3 : 2}`);
  }
  const after = await snapshot(stub);
  expect(after.state.combatRuntime.entities[ACTOR].resources).toMatchObject({ "spellSlot:1": { current: "2", maximum: "4" } });
  expect(after.state.entities[ACTOR].resources?.slot1).toBe(2);
  expect(after.state.entities[ACTOR].resources).not.toHaveProperty("spellSlot:1");
  expect(after.state.entities[ACTOR].resourceMaximums?.slot1).toBe(4);
  const observed = record(record(await stub.observe(PRINCIPAL)).readModel);
  const controlled = record(observed.controlledCharacter);
  expect(controlled.resources).toMatchObject({ slot1: 2, slot2: 2 });
  expect(controlled.resources).not.toHaveProperty("spellSlot:1");
  expect(controlled.resourceMaximums).toMatchObject({ slot1: 4, slot2: 2 });
  expect(after.events.filter(event => event.eventType === "ResourceSpent")).toHaveLength(2);
  expect(after.events.filter(event => event.eventType === "HealingResolved")).toHaveLength(2);
  expect(after.events.filter(event => event.eventType === "SpellResolved")).toHaveLength(2);
  expect(c.draws).toBe(2); expect(c.sides).toEqual([8, 4]); expect(c.requests).toHaveLength(4);
  await evictDurableObject(stub); expect((await snapshot(stub)).events).toEqual(after.events);
  expect(Object.keys(after.state.internalContinuations)).toEqual([]);
  expect(Object.keys(after.state.combatRuntime.randomnessResolutions)).toEqual([]);
  const admin = stub as unknown as { applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown> };
  const capability = record(initialized.serviceCapabilities).roomAdministration;
  // Both direct new-character consumers freeze registrations before publishing
  // their mechanics snapshot; the subsequent event replay retains those records.
  {
    const principalId = `22222222-2222-4222-8222-${later ? "54321d678901" : "98765d432101"}`, characterId = `character:${principalId}`;
    const character = { characterId, controllerPrincipalId: principalId, staticCard: { ...card, name: `旅行牧师${later}` } };
    const joinedResult = await admin.applyRoomAdministration(capability, { kind: "grantSeat", commandId: `room-admin:real-catalog:join:${later}`,
      principal: { id: principalId, sessionVersion: 1 }, role: "player", ...(later ? {} : { character }) });
    expect(joinedResult, JSON.stringify({ later, joinedResult })).toMatchObject({ kind: "committed" });
    if (later) {
      const command = { kind: "materializeCharacter", commandId: "room-admin:real-catalog:materialize", principalId, seatId: `seat:${principalId}`, character };
      expect(await admin.applyRoomAdministration(capability, command)).toMatchObject({ kind: "committed" });
    }
    const joined = await snapshot(stub), entity = joined.state.combatRuntime.entities[characterId];
    const sources = compileStaticCharacterCombat(joined.state.entities[characterId], card,
      joined.state.campaignRuntime.itemSystem, joined.state.combatRuntime.definitions);
    for (const ref of entity.abilityRefs as string[]) {
      const registered = joined.state.combatRuntime.definitions[ref];
      expect(isRegisteredAbilityRecord(registered), ref).toBe(true);
      expect(registered.definitionHash).toBe(canonicalSha256(sources.definitions[ref]));
    }
    const characterIndex = joined.events.findIndex(event => event.eventType === "CharacterControlGranted"
      && record(event.payload).characterId === characterId);
    for (const source of record(joined.events[characterIndex].payload).definitions as RecordValue[]) {
      const registrationIndex = joined.events.findIndex(event => event.eventType === "DefinitionRegistered"
        && record(record(event.payload).definition).definitionId === source.definitionId);
      expect(registrationIndex).toBeGreaterThanOrEqual(0); expect(registrationIndex).toBeLessThan(characterIndex);
    }
  }
  if (!later) await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals;
    const { profiles } = target.authoritativeReplay();
    let state = structuredClone(after.state);
    const events = structuredClone(after.events);
    const step = (input: unknown) => {
      const result = target.rulesRuntime.step(profiles, state, input);
      expect(result.kind, JSON.stringify(result)).toBe("committed");
      if (result.kind !== "committed") throw new Error("resource recovery did not commit");
      state = result.state; events.push(...result.events); return result;
    };
    const started = step({ kind: "startRest", proposalId: "root:resource-recovery:start", characterId: ACTOR,
      restKind: "long", intendedDurationMicros: "28800000000", hitDiceToSpend: 0, arcaneRecoverySlotLevels: [] });
    const activityId = started.events.find(event => event.eventType === "RestStarted")!.payload.activityId;
    step({ kind: "resolveFreeAction", proposalId: "root:resource-recovery:elapsed", characterId: ACTOR,
      goal: "完成已经开始的长休", method: "安静休息八小时", feasibility: { kind: "directSuccess", publicBasis: "休息时间内没有打断。" },
      outcome: { publicResult: "八小时过去。", fictionTimeCostMicros: "28800000000" } });
    step({ kind: "completeActivity", proposalId: "root:resource-recovery:complete", activityId });
    expect(state.entities[ACTOR].resources?.slot1).toBe(4);
    expect(state.entities[ACTOR].resources).not.toHaveProperty("spellSlot:1");
    expect(state.entities[ACTOR].resourceMaximums?.slot1).toBe(4);
    expect(state.combatRuntime.entities[ACTOR].resources).toMatchObject({ "spellSlot:1": { current: "4", maximum: "4" } });
    const replay = target.rulesRuntime.replay(after.genesis, events);
    expect(replay.kind).toBe("replayed"); if (replay.kind === "replayed") expect(replay.state).toEqual(state);
  });
  const completed = await snapshot(stub); await evictDurableObject(stub);
  expect((await snapshot(stub)).state).toEqual(completed.state);
}, 30_000);
