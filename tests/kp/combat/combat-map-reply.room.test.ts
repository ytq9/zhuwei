import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { handleRoomAction, handleViewerNarrationRecovery, type RoomActionInput, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import { NPC_COMBAT_TURN_TOOL_NAME } from "../../../app/_runtime/lib/kp/npc-combat-turn";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";

// SPEC 0014 §4 (ADR 0104): a player's structured act on the combat map commits
// first; each observer's reply is then written from the claims Rules derives
// for that observer and reviewed, as an NPC's combat turn is (ADR 0101). A
// reply that cannot be written leaves the act in effect, and the player can
// retry the reply.
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:combat-reply:alice", sessionVersion: 1 } };
const ACTOR = "character:combat-reply:alice", NAES = "npc:black-oak-will:naes", HALL = "wake";
vi.spyOn(console, "info").mockImplementation(() => {});
const toolResult = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }] } }] });

const BOB = { principal: { id: "principal:combat-reply:bob", sessionVersion: 1 } };
const WATCHER = "character:combat-reply:bob";

/** The actor, with what it holds in hand; and, if asked, a second player in
 * the hall who watches the fight without taking part. */
async function initialize(name: string, options: { equipped?: Record<string, string>; watcher?: true } = {}) {
  const stub = env.VNEXT_ROOMS.getByName(name);
  const card = (characterName: string, equipped: Record<string, string>) => ({ name: characterName, sceneId: HALL, level: 3, classId: "fighter",
    raceId: "human", subclassId: "champion", scores: { str: 16, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2,
    skills: ["athletics"], resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30, equipped, backpack: [] });
  expect(await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: [{ principalId: ALICE.principal.id, role: "host" }, ...(options.watcher ? [{ principalId: BOB.principal.id, role: "player" }] : [])],
    characters: [{ characterId: ACTOR, controllerPrincipalId: ALICE.principal.id, staticCard: card("1", options.equipped ?? {}) },
      ...(options.watcher ? [{ characterId: WATCHER, controllerPrincipalId: BOB.principal.id, staticCard: card("2", {}) }] : [])],
  } as never)).toMatchObject({ created: true });
  return stub;
}

type Narrate = (request: Data) => Data;
type Calls = { narrations: Data[]; decisions: number };

/** Everything runs on the Room instance itself: its authority methods with a
 * model transport, the production action layer, and dice that land on `face`
 * (a smaller die on its highest face). `narrate` stands in for the reviewed
 * reply writer. */
async function scenario<T>(stub: Stub, body: (act: (input: RoomActionInput, narrate?: Narrate) => Promise<Data>, target: Data,
  calls: Calls, retry: (capability: string, narrate?: Narrate) => Promise<Data>) => Promise<T>, face = 20) {
  return runInDurableObject(stub, async (instance) => {
    const target = instance as unknown as Data;
    target.authorityRoll = (sides: number) => Math.min(face, sides);
    const calls: Calls = { narrations: [], decisions: 0 };
    const context = (narrate: Narrate) => {
      const scope = createVNextModelCallScope({ roomId: "combat-reply-room-test", limit: "12", emit() {} });
      const transport = new ActorPlanTransportCapability(scope.bind({ async run(_model, request) {
        const tool = (request as Data).tools?.[0]?.function?.name;
        if (tool !== NPC_COMBAT_TURN_TOOL_NAME) throw new Error(`unexpected model call ${String(tool)}`);
        calls.decisions += 1;
        // Naes dodges and ends its turn.
        return toolResult(NPC_COMBAT_TURN_TOOL_NAME, { steps: [{ kind: "basic", action: "dodge" }, { kind: "endTurn" }] });
      } }));
      const authority = { prepare: (principal: unknown, action: unknown) => target.prepare(principal, action, transport),
        commit: (principal: unknown, id: string, value: unknown) => target.commit(principal, id, value, transport),
        resumePlayerRandomness: (principal: unknown, id: string) => target.resumePlayerRandomness(principal, id, transport),
        observe: (...args: unknown[]) => target.observe(...args), acknowledge: (...args: unknown[]) => target.acknowledge(...args),
        publishDelivery: (...args: unknown[]) => target.publishDelivery(...args),
        deliveryPublicationStatus: (...args: unknown[]) => target.deliveryPublicationStatus(...args),
        beginDeliveryAudiencePublication: (...args: unknown[]) => target.beginDeliveryAudiencePublication(...args),
        failDeliveryAudiencePublication: (...args: unknown[]) => target.failDeliveryAudiencePublication(...args),
        beginViewerNarrationRecovery: (...args: unknown[]) => target.beginViewerNarrationRecovery(...args),
        publishViewerNarrationRecovery: (...args: unknown[]) => target.publishViewerNarrationRecovery(...args),
        failViewerNarrationRecovery: (...args: unknown[]) => target.failViewerNarrationRecovery(...args),
      } as RoomAuthorityCapability;
      // Each request records whether its act was already in the world when
      // the reply was asked for: a combat-map act commits first (ADR 0104).
      const narrationAdapter = { async narrate(request: Data) {
        const committed = target.authoritativeReplay().state.receipts[request.rootActionId]?.status === "committed";
        calls.narrations.push({ ...structuredClone(request), committedBeforeReply: committed });
        return narrate(request);
      },
        async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
      const kp = createVNextKpAdapter({ narrationAdapter, journal: {
        begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
      }, proposalBinding: scope.bind({ async run() { throw new Error("no proposal call"); } }) });
      return { principal: ALICE, authority, kp };
    };
    const written: Narrate = () => ({ body: "战斗还在继续。" });
    const act = async (input: RoomActionInput, narrate = written) => {
      let outcome = await handleRoomAction(context(narrate), input) as Data;
      // The player rolls its own dice, as at the table.
      for (let rolls = 0; outcome.kind === "awaitingPlayerRoll" && rolls < 4; rolls++) {
        const pending = (await target.observe(ALICE) as Data).pendingPlayerRolls as Data[];
        outcome = await handleRoomAction(context(narrate), { kind: "roll", submissionId: `${input.submissionId}:roll:${rolls}`,
          randomnessId: String(pending[0].id) } as RoomActionInput) as Data;
      }
      return outcome;
    };
    const retry = async (capability: string, narrate = written) =>
      await handleViewerNarrationRecovery(context(narrate), capability) as Data;
    return body(act, target, calls, retry);
  });
}

/** Test precondition, stored as Room events: an encounter the actor opens
 * against Naes, the actor first. Naes may start wounded and, as an important
 * NPC may (SPEC 0012 §12.2), make death saves at 0 HP. */
function startEncounterWithNaes(target: Data, naesOptions: { hitPointsCurrent?: string; deathSaves?: true } = {}) {
  const replay = target.authoritativeReplay();
  const naes = replay.state.combatRuntime.entities[NAES], naesEntity = replay.state.entities[NAES];
  const social = naesEntity.socialMechanics ?? {};
  const scores = naesEntity.abilityScores ?? social.abilityScores ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  let result = target.rulesRuntime.step(replay.profiles, replay.state, { kind: "startEncounter", rootActionId: "root:combat-reply-fixture",
    proposalAttemptId: "proposal:combat-reply-fixture", encounterId: "encounter:combat-reply", sceneId: HALL, participantEntityIds: [ACTOR],
    dynamicEntities: [{ entityId: NAES, name: naesEntity.name, placement: { position: structuredClone(naes.position) },
      ...(naesOptions.hitPointsCurrent === undefined ? {} : { initialState: { hitPointsCurrent: naesOptions.hitPointsCurrent } }),
      mechanics: { kind: "bespokeDefinition", definition: {
        definitionId: "npc-template:combat-reply:naes", revision: "1", definitionKind: "npcMechanicalTemplate",
        rulesBasis: "srd5.1-2014", causalBasisRefs: [naesEntity.semanticDefinitionRef], visibilityPolicyRef: "visibility:scene-observers",
        content: { schema: "zhuwei.npc-mechanical-template/v1", label: naesEntity.name, footprint: structuredClone(naes.footprint),
          stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
          proficiencyBonus: String(naesEntity.proficiencyBonus ?? social.proficiencyBonus ?? 2),
          armorClass: "11", armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: "11", shieldBonus: "0" },
          hitPointsMaximum: "30", speedInches: { walk: "360" }, resourceMaximums: {}, deathPolicy: naesOptions.deathSaves ? "deathSaves" : "deadAtZero",
          intrinsicAbilities: [], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } }],
    battlefieldFactIds: [], initiativeGroups: [ACTOR, NAES].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
    hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [NAES] }, { fromEntityIds: [NAES], toEntityIds: [ACTOR] }] });
  const events: unknown[] = [];
  let draw = 0;
  while (result.kind === "awaitingRandomness") {
    events.push(...result.events);
    const waiting = result;
    result = target.rulesRuntime.step(replay.profiles, waiting.state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
      responseId: `authority:combat-reply:${draw}`, continuationCapability: waiting.continuationCapability,
      randomnessResults: waiting.randomnessRequests.map((request: Data) => ({ randomnessId: request.randomnessId, requestHash: request.requestHash,
        draws: request.dice.map((term: Data) => ({ sides: Number(term.sides),
          faces: Array.from({ length: Number(term.count) }, () => ++draw === 1 ? 20 : 1) })) })) });
  }
  expect(result.kind, JSON.stringify(result).slice(0, 1500)).toBe("committed");
  events.push(...result.events);
  target.authorityStore.appendEvents(events); target.authorityStore.updateState(result.state); target.authorityStore.syncAuthorityIndex(result.state);
}

const view = async (target: Data) => { const observed = await target.observe(ALICE) as Data; return observed.readModel ?? observed; };
const state = (target: Data) => structuredClone(target.authoritativeReplay().state) as Data;
const claimsOf = (request: Data) => (request.renderableClaims?.claims ?? []) as Data[];
const brief = (claims: Data[]) => JSON.stringify(claims.map(claim => [claim.kind, claim.outcomeCode ?? claim.abilityName, claim.summary ?? claim.effect?.summary,
  claim.check, claim.actorRef ?? claim.sourceRef, claim.targetRefs]));

/** The actor's unarmed strike, its one registered attack with empty hands. */
const strikeOf = (target: Data) => (state(target).combatRuntime.entities[ACTOR].abilityRefs as string[])
  .find(ref => ref.includes("unarmed-strike"))!;
/** The actor's attack with the weapon in its main hand. */
const weaponOf = (target: Data) => (state(target).combatRuntime.entities[ACTOR].abilityRefs as string[])
  .find(ref => ref.includes(":weapon:"))!;
/** The purposes of the dice Rules asked for under one root. */
const dicePurposes = (target: Data, root: string) => (target.authorityStore.events() as Data[])
  .filter(event => event.rootActionId === root && event.eventType === "RandomnessRequested")
  .flatMap(event => (event.payload.resolution.randomnessRequests as Data[]).map(request => String(request.purposeKey)));

it("a map move in combat commits first and is told from the move's claims", async () => {
  const stub = await initialize("combat-reply-move-room");
  await scenario(stub, async (act, target, calls) => {
    startEncounterWithNaes(target);
    const start = await view(target);
    const from = start.tacticalProjection.self.position;
    const to = { x: String(BigInt(from.x) + 120n), y: from.y, elevation: from.elevation };
    const moved = await act({ kind: "movement", submissionId: "reply-move", movementMode: "walk",
      spatialRevision: start.tacticalProjection.spatialRevision, path: [from, to] } as RoomActionInput);
    expect([moved.kind, moved.action, moved.narration], JSON.stringify(moved).slice(0, 800)).toEqual(["committed", "committed", "published"]);
    expect(state(target).combatRuntime.entities[ACTOR].position).toEqual(to);
    const replies = calls.narrations.filter(request => request.rootActionId === "combat-act:reply-move");
    expect(replies, JSON.stringify(calls.narrations.map(request => request.rootActionId))).toHaveLength(1);
    const [reply] = replies;
    // Written after commit, from the actor's own frozen claims, under the
    // reviewed plain-text policy an NPC's turn uses.
    expect([reply.committedBeforeReply, reply.narrationInputMode, reply.narrationPolicy]).toEqual([true, "frozenRenderableClaims-vnext-1", "plainText-v1"]);
    expect(reply.renderableClaims.schema).toBe("zhuwei.renderable-claims/vnext-1");
    const move = claimsOf(reply).find(claim => claim.outcomeCode === "movedInCombat");
    expect(move, brief(claimsOf(reply))).toMatchObject({ kind: "mechanicalOutcome", actorRef: ACTOR, summary: "该角色移动了约 10 尺。" });
  });
}, 60_000);

it("a map attack on Naes is told with how the attack came out and the damage it did", async () => {
  const stub = await initialize("combat-reply-attack-room");
  await scenario(stub, async (act, target, calls) => {
    const approached = await act({ kind: "mapMove", submissionId: "reply-approach", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
    expect(approached.kind).toBe("committed");
    startEncounterWithNaes(target);
    const hitPoints = state(target).combatRuntime.entities[NAES].hitPoints.current;
    const attacked = await act({ kind: "combatAbility", submissionId: "reply-attack", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      abilityRef: strikeOf(target), target: { kind: "creatures", refs: [NAES] } } as RoomActionInput);
    expect([attacked.kind, attacked.narration], JSON.stringify(attacked).slice(0, 800)).toEqual(["committed", "published"]);
    const after = state(target).combatRuntime.entities[NAES].hitPoints.current;
    expect(Number(after)).toBeLessThan(Number(hitPoints));
    const [reply] = calls.narrations.filter(request => request.rootActionId === "combat-act:reply-attack");
    expect(reply?.committedBeforeReply).toBe(true);
    const claims = claimsOf(reply);
    // The d20 landed on 20: a critical hit on Naes, with its total, and the
    // damage Naes took in public words.
    expect(claims.find(claim => claim.outcomeCode === "criticalHit"), brief(claims)).toMatchObject({ kind: "mechanicalOutcome",
      actorRef: ACTOR, targetRefs: [NAES], check: { kind: "attack", result: "success", total: 25 } });
    const damage = claims.find(claim => claim.outcomeCode === "damageApplied");
    expect(damage, brief(claims)).toMatchObject({ targetRefs: [NAES], summary: `目标承受了 ${Number(hitPoints) - Number(after)} 点钝击伤害。` });
    // SPEC 0012 §9.1 (ADR 0113), SRD 5.1 Unarmed Strike: 1 + Strength modifier
    // (16: +3), proficient (+2, so 20 + 5); no damage dice to roll or to
    // double on the critical.
    expect(Number(hitPoints) - Number(after)).toBe(4);
    expect(dicePurposes(target, "combat-act:reply-attack").filter(purpose => purpose.startsWith("damage:"))).toEqual([]);
    const strike = state(target).combatRuntime.definitions[strikeOf(target)];
    expect([strike.mechanicalKey, strike.damage, strike.attack]).toEqual(["unarmed-strike",
      [{ type: "bludgeoning", formula: "1+3" }], { ability: "str", proficiency: true }]);
    expect(claims.find(claim => claim.kind === "abilityEffectApplied")?.abilityName, brief(claims)).toBe("徒手攻击");
    expect(claims.find(claim => claim.kind === "abilityEffectApplied")?.effect.summary).toBe("出手攻击。");
  });
}, 60_000);

// SPEC 0016 §8.2 (ADR 0113): round 174's attack with a weapon was told as
// "该能力". The weapon is named by the item, as each Viewer sees it: the
// actor and a player watching from the hall read the same name.
it("a weapon attack is told by the weapon's name, to the actor and to a player who watches", async () => {
  const stub = await initialize("combat-reply-weapon-room", { equipped: { main: "longsword" }, watcher: true });
  await scenario(stub, async (act, target, calls) => {
    const approached = await act({ kind: "mapMove", submissionId: "weapon-approach", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
    expect(approached.kind).toBe("committed");
    startEncounterWithNaes(target);
    const seen = await view(target);
    // The action bar's name for the attack is the held item's.
    const entry = (seen.controlledCharacter.inventory.entries as Data[]).find(item => item.equippedSlot === "main")!;
    expect(entry.name).toBe("长剑");
    // Who holds what stays the holder's: the watcher's projection does not list the sword.
    const watcherItems = (((await target.observe(BOB)) as Data).readModel.visibleItems ?? []) as Data[];
    expect(watcherItems.some(item => item.itemEntryId === entry.entryId)).toBe(false);
    const attacked = await act({ kind: "combatAbility", submissionId: "weapon-attack", spatialRevision: seen.tacticalProjection.spatialRevision,
      abilityRef: weaponOf(target), target: { kind: "creatures", refs: [NAES] } } as RoomActionInput);
    expect([attacked.kind, attacked.narration], JSON.stringify(attacked).slice(0, 800)).toEqual(["committed", "published"]);
    const replies = calls.narrations.filter(request => request.rootActionId === "combat-act:weapon-attack");
    const actorReply = replies.find(request => String(request.viewerKey).endsWith(ACTOR));
    const watcherReply = replies.find(request => String(request.viewerKey).endsWith(WATCHER));
    for (const reply of [actorReply, watcherReply]) {
      const claims = claimsOf(reply ?? {});
      const strike = claims.find(claim => claim.kind === "abilityEffectApplied" && claim.sourceRef === ACTOR);
      expect(strike, brief(claims)).toMatchObject({ abilityRef: weaponOf(target), abilityName: "长剑" });
      expect(strike!.narrationFacts).toContain("能力 长剑");
      expect(claims.find(claim => claim.outcomeCode === "criticalHit"), brief(claims)).toMatchObject({ actorRef: ACTOR, targetRefs: [NAES] });
      expect(JSON.stringify(claims)).not.toContain("该能力");
    }
  });
}, 60_000);

// SPEC 0012 §12.1 (ADR 0113): a blow that drops a creature who makes death
// saves leaves it dying; the bar then offers first aid on it, and a DC 10
// Wisdom (Medicine) check from the map stabilizes it, told to the actor.
it("a blow drops Naes to 0 HP and dying; next turn the actor's first aid from the map stabilizes him", async () => {
  const stub = await initialize("combat-reply-stabilize-room");
  await scenario(stub, async (act, target, calls) => {
    const approached = await act({ kind: "mapMove", submissionId: "aid-approach", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
    expect(approached.kind).toBe("committed");
    startEncounterWithNaes(target, { hitPointsCurrent: "1", deathSaves: true });
    // The d20 shows 15: 15 + 5 hits armour class 11, and the strike's 4 drops him.
    let attacked = await act({ kind: "combatAbility", submissionId: "aid-attack", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      abilityRef: strikeOf(target), target: { kind: "creatures", refs: [NAES] } } as RoomActionInput);
    // SPEC 0012 §12.3: the melee blow that drops him asks the actor whether to knock him out; it deals lethal damage.
    const knockOut = ((await view(target)).pendingInputs as Data[]).find(entry => entry.choiceKind === "knockOut");
    expect(knockOut, JSON.stringify(attacked).slice(0, 800)).toBeDefined();
    expect([attacked.kind, attacked.action, attacked.narration], JSON.stringify(attacked).slice(0, 800)).toEqual(["awaitingInput", "awaitingInput", "notApplicable"]);
    expect(dicePurposes(target, "combat-act:aid-attack").some(purpose => purpose.startsWith("attack:"))).toBe(true);
    const eventsBefore = (target.authorityStore.events() as Data[]).length;
    // The attack itself is in the world while the choice waits.
    expect((target.authorityStore.events() as Data[]).filter(event => event.eventType === "AbilityInvoked"
      && event.payload.abilityRef === strikeOf(target)).map(event => event.payload.mechanicalResult.attack.hit)).toEqual([true]);
    attacked = await act({ kind: "answer", submissionId: "aid-lethal", pendingInputId: knockOut!.pendingInputId,
      answer: { kind: "dealLethalDamage" } } as RoomActionInput);
    expect(attacked.kind, JSON.stringify(attacked).slice(0, 800)).toBe("committed");
    // The damage lands with the answer, and the blow is told once, whole, after it.
    const answerEvents = (target.authorityStore.events() as Data[]).slice(eventsBefore);
    expect(answerEvents.filter(event => event.eventType === "DamagePacketResolved" && event.payload.targetEntityId === NAES
      && event.payload.sourceDefinitionId === strikeOf(target)).map(event => event.payload.totalApplied)).toEqual([4]);
    const strikeReplies = calls.narrations.filter(request => request.rootActionId === "combat-act:aid-attack");
    expect(strikeReplies).toHaveLength(1);
    const strikeClaims = claimsOf(strikeReplies[0]);
    expect(strikeClaims.find(claim => claim.kind === "abilityEffectApplied")?.abilityName, brief(strikeClaims)).toBe("徒手攻击");
    expect(strikeClaims.find(claim => claim.outcomeCode === "attackHit")?.check, brief(strikeClaims)).toEqual({ kind: "attack", result: "success", total: 20 });
    expect(strikeClaims.find(claim => claim.outcomeCode === "damageApplied")?.summary, brief(strikeClaims)).toBe("目标承受了 4 点钝击伤害。目标倒下，失去了意识。");
    const dropped = state(target).combatRuntime.entities[NAES];
    expect([dropped.hitPoints.current, dropped.lifeState, dropped.conditions?.stable]).toEqual(["0", "unconscious", undefined]);
    // Dying beside her: the bar offers first aid on him.
    expect((await view(target)).combatControls.offers.stabilize).toEqual({ targetRefs: [NAES] });

    // Her action is spent; Naes's turn comes (he can only make his death save) and goes.
    const ended = await act({ kind: "combatEndTurn", submissionId: "aid-end" } as RoomActionInput);
    expect(ended.kind, JSON.stringify(ended).slice(0, 800)).toBe("committed");
    expect(calls.decisions).toBe(0);
    expect(state(target).combatRuntime.encounters["encounter:combat-reply"].activeEntityId).toBe(ACTOR);
    expect((await view(target)).combatControls.offers.stabilize).toEqual({ targetRefs: [NAES] });

    // Medicine: 15 + 1 (Wisdom 12) against DC 10.
    const aided = await act({ kind: "combatAbility", submissionId: "aid-stabilize", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      abilityRef: "action:stabilize", target: { kind: "creatures", refs: [NAES] } } as RoomActionInput);
    expect([aided.kind, aided.narration], JSON.stringify(aided).slice(0, 800)).toEqual(["committed", "published"]);
    const stable = state(target).combatRuntime.entities[NAES];
    expect([stable.hitPoints.current, stable.lifeState, stable.conditions?.stable]).toEqual(["0", "unconscious", true]);
    expect((await view(target)).combatControls.offers.stabilize).toBeNull();
    const claims = claimsOf(calls.narrations.find(request => request.rootActionId === "combat-act:aid-stabilize")!);
    expect(claims.find(claim => claim.kind === "abilityEffectApplied"), brief(claims)).toMatchObject({ abilityRef: "action:stabilize",
      abilityName: "急救", sourceRef: ACTOR, targetRefs: [NAES], effect: { summary: "俯身为倒下的伤者急救。" } });
    expect(claims.find(claim => claim.outcomeCode === "stabilized"), brief(claims)).toMatchObject({ actorRef: ACTOR, targetRefs: [NAES],
      check: { kind: "abilityCheck", result: "success", total: 16, dc: 10 } });
    expect(claims.find(claim => claim.outcomeCode === "deathSave")?.summary, brief(claims)).toBe("目标的伤势稳定了下来，仍然昏迷。");
  }, 15);
}, 60_000);

it("a missed attack aimed at a point tells the miss and names no one", async () => {
  const stub = await initialize("combat-reply-miss-room");
  await scenario(stub, async (act, target, calls) => {
    const approached = await act({ kind: "mapMove", submissionId: "miss-approach", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
    expect(approached.kind).toBe("committed");
    startEncounterWithNaes(target);
    const naesAt = state(target).combatRuntime.entities[NAES].position;
    const seen = await view(target);
    const aimed = await act({ kind: "combatAbility", submissionId: "miss-aimed", spatialRevision: seen.tacticalProjection.spatialRevision,
      abilityRef: strikeOf(target), target: { kind: "point", position: { x: naesAt.x, y: naesAt.y, elevation: seen.tacticalProjection.self.position.elevation } } } as RoomActionInput);
    expect([aimed.kind, aimed.narration], JSON.stringify(aimed).slice(0, 800)).toEqual(["committed", "published"]);
    const claims = claimsOf(calls.narrations.find(request => request.rootActionId === "combat-act:miss-aimed")!);
    // Both d20 land on 1: the aimed blow misses, and its claim names no creature.
    const outcome = claims.find(claim => claim.outcomeCode === "attackMissed");
    expect(outcome, brief(claims)).toMatchObject({ actorRef: ACTOR, summary: "朝瞄准的位置出手，落空了。", check: { kind: "attack", result: "failure" } });
    expect(outcome!.targetRefs).toBeUndefined();
    expect(JSON.stringify(claims)).not.toContain(NAES);
  }, 1);
}, 60_000);

it("a reply that cannot be written leaves the move in effect, and retrying the reply publishes it", async () => {
  const stub = await initialize("combat-reply-retry-room");
  await scenario(stub, async (act, target, calls, retry) => {
    startEncounterWithNaes(target);
    const start = await view(target);
    const from = start.tacticalProjection.self.position;
    const to = { x: from.x, y: String(BigInt(from.y) + 120n), elevation: from.elevation };
    const moved = await act({ kind: "movement", submissionId: "retry-move", movementMode: "walk",
      spatialRevision: start.tacticalProjection.spatialRevision, path: [from, to] } as RoomActionInput, () => { throw new Error("provider unavailable"); });
    // The move is in the world; only its reply is owed.
    expect([moved.kind, moved.action, moved.narration], JSON.stringify(moved).slice(0, 800)).toEqual(["committed", "committed", "retryableFailure"]);
    expect(state(target).combatRuntime.entities[ACTOR].position).toEqual(to);
    expect(state(target).receipts["combat-act:retry-move"]?.status).toBe("committed");
    const owed = (await target.observe(ALICE) as Data).narrationRecovery as Data;
    expect(owed, JSON.stringify(owed)).toMatchObject({ kind: "available", action: "committed", state: "retryableFailure", canRetry: true });
    const retried = await retry(String(owed.capability));
    expect([retried.action, retried.narration], JSON.stringify(retried).slice(0, 800)).toEqual(["committed", "published"]);
    const replies = calls.narrations.filter(request => request.rootActionId === "combat-act:retry-move");
    expect(replies).toHaveLength(2);
    // The retry tells the same frozen claims.
    expect(replies[1].renderableClaims.claimsHash).toBe(replies[0].renderableClaims.claimsHash);
    expect((await target.observe(ALICE) as Data).narrationRecovery).toBeUndefined();
    expect(state(target).combatRuntime.entities[ACTOR].position).toEqual(to);
  });
}, 60_000);

it("claims that cannot be derived leave the attack in effect, and the retried reply derives them again", async () => {
  const stub = await initialize("combat-reply-owed-room");
  await scenario(stub, async (act, target, calls, retry) => {
    const approached = await act({ kind: "mapMove", submissionId: "owed-approach", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
      destination: { kind: "nextTo", ref: NAES } } as RoomActionInput);
    expect(approached.kind).toBe("committed");
    startEncounterWithNaes(target);
    const hitPoints = Number(state(target).combatRuntime.entities[NAES].hitPoints.current);
    // The attack's Viewer projection fails while it commits.
    const original = target.rulesRuntime;
    target.rulesRuntime = { ...original, project: (profiles: unknown, world: unknown, viewer: unknown, query?: Data) =>
      String(query?.committedRange?.receiptId ?? "").includes("combat-act:owed-attack")
        ? { kind: "rejected", rejection: { code: "projectionIntegrity", message: "claims unavailable in this test" } }
        : original.project(profiles, world, viewer, query) };
    let attacked: Data;
    try {
      attacked = await act({ kind: "combatAbility", submissionId: "owed-attack", spatialRevision: (await view(target)).tacticalProjection.spatialRevision,
        abilityRef: strikeOf(target), target: { kind: "creatures", refs: [NAES] } } as RoomActionInput);
    } finally { target.rulesRuntime = original; }
    // The blow landed and stands; only the reply is owed, and no reply was written.
    expect([attacked.kind, attacked.action, attacked.narration], JSON.stringify(attacked).slice(0, 800)).toEqual(["committed", "committed", "retryableFailure"]);
    expect(Number(state(target).combatRuntime.entities[NAES].hitPoints.current)).toBeLessThan(hitPoints);
    expect(calls.narrations.filter(request => request.rootActionId === "combat-act:owed-attack")).toEqual([]);
    const owed = (await target.observe(ALICE) as Data).narrationRecovery as Data;
    expect(owed, JSON.stringify(owed)).toMatchObject({ kind: "available", action: "committed", state: "retryableFailure", canRetry: true });
    const retried = await retry(String(owed.capability));
    expect([retried.action, retried.narration], JSON.stringify(retried).slice(0, 800)).toEqual(["committed", "published"]);
    const [reply] = calls.narrations.filter(request => request.rootActionId === "combat-act:owed-attack");
    expect([reply?.narrationInputMode, reply?.narrationPolicy]).toEqual(["frozenRenderableClaims-vnext-1", "plainText-v1"]);
    expect(claimsOf(reply).map(claim => claim.outcomeCode), brief(claimsOf(reply))).toEqual(expect.arrayContaining(["criticalHit", "damageApplied"]));
    expect((await target.observe(ALICE) as Data).narrationRecovery).toBeUndefined();
  });
}, 60_000);

it("ending the turn hands it to Naes, and Naes's turn is told after it commits", async () => {
  const stub = await initialize("combat-reply-end-room");
  await scenario(stub, async (act, target, calls) => {
    startEncounterWithNaes(target);
    const ended = await act({ kind: "combatEndTurn", submissionId: "reply-end" } as RoomActionInput);
    expect([ended.kind, ended.narration], JSON.stringify(ended).slice(0, 800)).toEqual(["committed", "published"]);
    expect(calls.decisions).toBe(1);
    // Naes dodged and ended its turn; it is the actor's turn again.
    expect(state(target).combatRuntime.encounters["encounter:combat-reply"].activeEntityId).toBe(ACTOR);
    // ADR 0109: the reply that only hands the turn to Naes is the server's
    // fixed sentence; no model writes or reviews it.
    expect(calls.narrations.find(request => request.rootActionId === "combat-act:reply-end")).toBeUndefined();
    const told = [...target.ctx.storage.sql.exec("SELECT body FROM authority_experienced_messages WHERE kind = 'kp' AND receipt_id LIKE 'receipt:combat-act:reply-end:%'")]
      .map((row: Data) => row.body);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^现在轮到奈斯.*行动。$/u);
    const naes = calls.narrations.filter(request => String(request.rootActionId).startsWith("npc-turn:"));
    expect(naes, JSON.stringify(calls.narrations.map(request => request.rootActionId))).toHaveLength(1);
    expect([naes[0].committedBeforeReply, naes[0].narrationInputMode, naes[0].narrationPolicy]).toEqual([true, "frozenRenderableClaims-vnext-1", "plainText-v1"]);
    const dodge = claimsOf(naes[0]).find(claim => claim.kind === "abilityEffectApplied" && claim.sourceRef === NAES);
    // A built-in action keeps the rules' own name for the Viewer.
    expect(dodge, brief(claimsOf(naes[0]))).toMatchObject({ abilityRef: "action:dodge", abilityName: "闪避" });
    expect(dodge!.narrationFacts).toContain("能力 闪避");
  });
}, 60_000);
