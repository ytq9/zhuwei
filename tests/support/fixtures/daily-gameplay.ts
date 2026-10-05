import { expect } from "vitest";
import { assertDailyActionAuthority, assertDailyWitnessAuthority } from "./daily-gameplay-authority.mjs";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json";
import { historyHttpDraft, historyHttpPost, httpRecord } from "./story-history-http";
import { RETRY_DECLINE_TEXT } from "../../../app/_runtime/lib/kp/vnext/retry-question";
import type { historyHttpAuthority, historyHttpSource, HttpRecord } from "./story-history-http";
import { nextTo } from "../../../app/_runtime/lib/rules/v2/scene-approach";
import { authorityGeometryFeatureComposite } from "../../../app/_runtime/lib/rules/v2/authority-bindings";
import { rectangularFeatureEntity } from "../../../app/_runtime/lib/rules/profiles/combat-geometry";

export const dailyClericDraft = { ...historyHttpDraft, classId: "cleric", subclassId: "life", backgroundId: "acolyte",
  scores: { str: 12, dex: 10, con: 13, int: 8, wis: 15, cha: 14 },
  cantrips: ["sacred-flame"], prepared: ["cure"], spellbook: [] };
type Snapshot = NonNullable<Awaited<ReturnType<typeof historyHttpAuthority>>>;
/** A later player step: words for the table; words pressing again, sent
 * only while no question waits; or the answer to the KP's waiting question
 * (SPEC 0001 §19) in words or as a decline, sent only while one waits. */
type Step = Readonly<{ text: string }> | Readonly<{ press: string }> | Readonly<{ answer: string | Readonly<{ decline: true }> }>
  | Readonly<{ map: MapStep }> | Readonly<{ choose: ChoiceStep }> | Readonly<{ peer: string }>;
/** A player's choice on the map (ADR 0091): the table's own command, sent
 * against the spatial revision the table shows at that moment. A walk away
 * from someone is planned then, from where the table shows both. */
type MapStep = Readonly<{ command: "moveOnMap" | "combatAbility" | "endTurn"; data: Readonly<Record<string, unknown>> }>
  | Readonly<{ command: "moveOnMap"; awayFrom: string; feet: number }>
  /** ADR 0113: the attack with the weapon in the actor's main hand, as the
   * action bar offers it, at this creature. */
  | Readonly<{ command: "combatAbility"; weaponAttack: string }>
  /** ADR 0113: first aid on this creature, sent only while the bar offers it. */
  | Readonly<{ command: "combatAbility"; stabilize: string }>;
/** The answer to a Rules choice waiting for this player (a readied action
 * firing, a reaction), sent only while one of that kind waits. */
type ChoiceStep = Readonly<{ reactionKind?: string; choiceKind?: string; answer: Readonly<Record<string, unknown>> }>;
const SPATIAL_COMMANDS: readonly string[] = ["moveOnMap", "combatAbility"];
type Selection = { caseId: string; dailyGroup: string; text: string; nextText?: string; steps?: readonly Step[]; initialFixture?: string;
  /** Who each NPC-held case targets: the NPC the actor fights. */
  opponentRef?: string;
  /** The case opens in a fight with this NPC, set up before any step; its
   * `text` is not sent. `opponent` sets its first hit points and whether it
   * makes death saves. */
  startsInCombat?: { opponentRef: string; besideOpponent?: boolean;
    opponent?: { hitPointsMaximum?: number; hitPoints?: number; deathSaves?: boolean } };
  customAction?: boolean; witnessAssertions?: { observerRef: string }; approachTo?: string; jumpOver?: string;
  contest?: { opponentRef: string; carryTo: string; putDown?: boolean }; shove?: { opponentRef: string }; terrain?: { featureRef: string };
  actionAssertions?: { itemDefinitionRef: string; itemFactRef: string; observerRef: string; acquisition: string; sense?: string };
  listenerForbidden?: readonly string[]; listenerRequired?: readonly string[] };

/** Real player commands only. Fixture data is established before genesis;
 * no model outcome, Rules result, die, or publication is fabricated here. */
export async function acceptDailyGameplay<S extends Snapshot>(options: {
  selected: Selection; source: Awaited<ReturnType<typeof historyHttpSource>>; initial: S;
  initialTable: HttpRecord; snapshot: () => Promise<S>; assertReplay: (snapshot: S) => Promise<void>;
  /** Resolves once the Room alarm has no due work scheduled. */
  settle: () => Promise<void>;
  bridge: (path: string, value?: unknown) => Promise<HttpRecord>;
  evidence: (name: string, value: unknown) => Promise<unknown>;
}) {
  const { selected, source, initial, snapshot, assertReplay, bridge, evidence } = options;
  const actor = source.characters[0].characterId;
  const peer = source.characters[1]?.characterId;
  const steps: Step[] = [...(selected.startsInCombat ? [] : [{ text: selected.text }]), ...(selected.nextText ? [{ text: selected.nextText }] : []),
    ...(selected.steps ?? [])];
  const texts = steps.map(step => "text" in step ? step.text : "press" in step ? step.press : "peer" in step ? step.peer
    : "map" in step ? `[${step.map.command}]`
    : "choose" in step ? `[choose:${JSON.stringify(step.choose.answer)}]`
    : typeof step.answer === "string" ? step.answer : RETRY_DECLINE_TEXT);
  const outcomes: unknown[] = [];
  let table = options.initialTable;
  /** ADR 0113: the weapon attack a combatStrike case sends, as the action bar names it. */
  const strike: { abilityRef?: string; name?: string } = {};
  for (const [index, text] of texts.entries()) {
    const prefix = `daily-step-${index + 1}`;
    const step = steps[index]!;
    // A step the second player at the table takes, as that player.
    const player = "peer" in step ? source.peer! : source.owner;
    if ("peer" in step) table = (await historyHttpPost("fetchTable", source.code, player)).body;
    // SPEC 0001 §19: an answer goes to the question the KP is waiting on. A
    // step whose earlier ruling left nothing to ask has no question to answer.
    const waiting = retryQuestionPending(table);
    const choice = "choose" in step ? pendingChoice(table, step.choose) : undefined;
    // ADR 0113: first aid is sent only while the bar offers it on that creature.
    const aidNotOffered = "map" in step && "stabilize" in step.map && stabilizeOffer(table, step.map.stabilize) === undefined;
    if (("answer" in step && waiting === undefined) || ("press" in step && waiting !== undefined) || ("choose" in step && choice === undefined)
      || aidNotOffered) {
      const reason = "answer" in step ? "noQuestionWaiting" : "choose" in step ? "noChoiceWaiting" : aidNotOffered ? "firstAidNotOffered" : "questionWaiting";
      // SPEC 0012 §12.1 (ADR 0113): a creature dying beside the actor on its turn is offered first aid.
      if (aidNotOffered && "map" in step && "stabilize" in step.map) {
        expect(dyingOnActorsTurn(await snapshot(), actor, step.map.stabilize), "the bar offers first aid on the dying creature").toBe(false);
      }
      outcomes.push({ step: index + 1, skipped: reason });
      await evidence(`${prefix}-skipped`, { reason });
      continue;
    }
    if ("map" in step && "weaponAttack" in step.map) {
      const weapon = mainWeaponAttack(table);
      Object.assign(strike, { abilityRef: String(weapon.abilityRef), name: String(weapon.name) });
    }
    const request: HttpRecord = "answer" in step
      ? { code: source.code, submissionId: crypto.randomUUID(), pendingInputId: String(waiting!.pendingInputId), text,
        ...(typeof step.answer === "string" ? {} : { answer: { decline: true } }) }
      : "choose" in step ? { code: source.code, submissionId: crypto.randomUUID(), pendingInputId: String(choice!.pendingInputId),
        text: optionLabel(choice!, step.choose.answer) ?? text, answer: structuredClone(step.choose.answer) }
      : "map" in step ? { code: source.code, submissionId: crypto.randomUUID(),
        ...("awayFrom" in step.map ? { path: walkAway(table, step.map.awayFrom, step.map.feet) }
          : "weaponAttack" in step.map ? { abilityRef: strike.abilityRef, target: { kind: "creatures", refs: [step.map.weaponAttack] } }
          : "stabilize" in step.map ? { abilityRef: "action:stabilize", target: { kind: "creatures", refs: [step.map.stabilize] } }
          : structuredClone(step.map.data)),
        ...(SPATIAL_COMMANDS.includes(step.map.command) ? { spatialRevision: tacticalOf(table).spatialRevision } : {}) }
      : { code: source.code, submissionId: crypto.randomUUID(), text };
    const firstCommand = "map" in step ? step.map.command : "sendAction";
    await evidence(`${prefix}-request`, { command: firstCommand, data: request });
    const beforeDenial = await snapshot(), denialUsage = await bridge("/status");
    const denied = await historyHttpPost(firstCommand, request);
    await evidence(`${prefix}-denials`, { anonymous: { status: denied.response.status, body: denied.body } });
    expect(denied.response.status).toBe(401);
    expect(await snapshot()).toEqual(beforeDenial);
    expect((await bridge("/status")).calls).toEqual(denialUsage.calls);

    const results: unknown[] = [], rollRetries: unknown[] = [];
    let command = firstCommand, data: HttpRecord = request;
    let completed: Awaited<ReturnType<typeof historyHttpPost>>;
    let afterAction = beforeDenial;
    // At most three real player confirmations; never answer an ambiguous
    // intention, reaction, or another character's pending decision by guessing.
    for (let rolls = 0; ; rolls++) {
      completed = await historyHttpPost(command, data, player);
      table = (await historyHttpPost("fetchTable", source.code, player)).body;
      const afterCommand = await snapshot();
      afterAction = afterCommand;
      results.push({ command, data, httpStatus: completed.response.status, body: completed.body,
        table, authority: afterCommand });
      const awaitingRoll = completed.body.action === "awaitingInput"
        && httpRecord(completed.body.outcome).kind === "awaitingPlayerRoll";
      if (completed.response.status !== 200 || completed.body.narration === "rejected"
        || (completed.body.action !== "committed" && !awaitingRoll)) break;
      const pending = httpRecord(table.state).pendingRolls;
      if (!Array.isArray(pending) || pending.length === 0) break;
      if (rolls >= 3) break;
      // A weapon attack asks for its attack and damage rolls together (ADR
      // 0113); answer them in order only when all are this player's own.
      if (pending.length > 1 && pending.some(entry => httpRecord(entry).userId !== player.userId)) break;
      const roll = httpRecord(pending[0]);
      expect(roll.userId).toBe(player.userId);
      const next = { code: source.code, rollId: String(roll.id), submissionId: crypto.randomUUID() };
      const usage = await bridge("/status");
      const forged = await historyHttpPost("resolveRoll", { ...next, boostIds: ["forged-client-bonus"] }, player);
      expect(forged.body.ok).toBe(false);
      expect(await snapshot()).toEqual(afterCommand);
      expect((await bridge("/status")).calls).toEqual(usage.calls);
      // Check the pending command retry before taking the next player step.
      const retry = await historyHttpPost(command, data, player);
      rollRetries.push({ command, data, status: retry.response.status, body: retry.body,
        forgedBonus: forged.body });
      expect(retry.body).toEqual(completed.body);
      expect(await snapshot()).toEqual(afterCommand);
      expect((await bridge("/status")).calls).toEqual(usage.calls);
      command = "resolveRoll"; data = next;
    }
    // Work this step scheduled (an NPC carrying out a promise) is first tried
    // on the Room alarm; compare the retry below against the room after that.
    await options.settle();
    const after = await snapshot();
    await evidence(`${prefix}-result`, results);
    await evidence(`${prefix}-table`, table);
    await evidence(`${prefix}-authority`, after);
    expect(completed!.response.status).toBe(200);
    // SPEC 0001 §19: the KP's question waits with the unfrozen action and
    // commits nothing; every other step commits and publishes.
    const asked = selected.dailyGroup === "retryQuestion" && !("answer" in step) ? retryQuestionPending(table) : undefined;
    // SPEC 0012 §12.3: a melee blow that drops a creature asks the attacker
    // whether to knock it out; ending a turn with no foe left to fight, or a
    // surrender in words, asks whether to end the fight (ADR 0112). A later
    // `choose` step answers it.
    const ruled = asked === undefined && completed!.body.action === "awaitingInput" && ("map" in step || "text" in step)
      ? rulesChoicePending(table) : undefined;
    if (asked !== undefined) {
      expect(completed!.body.action, JSON.stringify(completed!.body)).toBe("awaitingInput");
      expect(after.events, "a question commits no event").toEqual(beforeDenial.events);
    } else if (ruled !== undefined) {
      expect(steps.slice(index + 1).some(next => "choose" in next && next.choose.choiceKind === ruled.choiceKind),
        `a later step answers the ${String(ruled.choiceKind)} choice`).toBe(true);
    } else {
      expect(completed!.body.action, JSON.stringify(completed!.body)).toBe("committed");
      // ADR 0091: a walk on the map outside combat is told by the map alone.
      // A combat-map act's reply still goes through the legacy narration,
      // which round 166 found rejecting its own drafts; that is recorded as a
      // finding (narrationRejected) rather than stopping the mechanics under test.
      // An answer to a Rules choice in the fight finishes that combat-map act, and is told the same way.
      if (!("map" in step) && !("choose" in step)) expect(completed!.body.narration, JSON.stringify(completed!.body)).toBe("published");
      else expect(["published", "notApplicable", "rejected"], JSON.stringify(completed!.body)).toContain(completed!.body.narration);
    }
    expect(httpRecord(table.state).pendingRolls).toEqual([]);
    const messages = table.messages as HttpRecord[];
    const oldIds = new Set((options.initialTable.messages as HttpRecord[]).map(row => row.id));
    if (asked === undefined && completed!.body.narration === "published") expect(messages.some(row => row.kind === "narrate" && !oldIds.has(row.id)
      && typeof row.body === "string" && row.body.trim().length > 0), "new visible narration").toBe(true);
    const events = after.events.slice(initial.events.length);
    let strikeNotes: HttpRecord | undefined;
    if (index === 0 && selected.actionAssertions) assertDailyActionAuthority({
      before: beforeDenial, after: afterAction, actor, contract: selected.actionAssertions,
    });
    if (index === 0 && !selected.actionAssertions && selected.witnessAssertions) assertDailyWitnessAuthority({
      before: beforeDenial, after: afterAction, actor, contract: selected.witnessAssertions,
    });
    if (index === 0 && selected.approachTo !== undefined) {
      // ADR 0087: the actor walked within the scene first and stands next to
      // the place the player named, whichever ref the KP wrote for it.
      const walks = (events as unknown as HttpRecord[]).filter(row => row.eventType === "CharacterRepositioned"
        && (row.payload as HttpRecord | undefined)?.characterId === actor);
      expect(walks.length, "the actor walked once").toBe(1);
      const path = (walks[0]!.payload as HttpRecord).path as HttpRecord[];
      const walker = after.state.combatRuntime.entities[actor] as HttpRecord;
      expect(walker.position, "the actor stands where the walk ended").toEqual(path[path.length - 1]);
      const feature = authorityGeometryFeatureComposite(after.state, selected.approachTo);
      const target = (after.state.combatRuntime.entities[selected.approachTo] as HttpRecord | undefined)
        ?? (feature === undefined ? undefined : rectangularFeatureEntity(feature.feature, feature.sceneRef));
      expect(target, "the named place is on the map").toBeDefined();
      expect(nextTo(walker, target!), `the actor ends next to ${selected.approachTo}`).toBe(true);
    }
    if (selected.dailyGroup === "listener") {
      const heard = JSON.stringify(after.state.knowledge["npc:black-oak-will:lian"]);
      for (const words of selected.listenerForbidden ?? []) expect(heard, `Lian must not hold "${words}"`).not.toContain(words);
      for (const words of selected.listenerRequired ?? []) expect(heard, `Lian holds "${words}"`).toContain(words);
    } else if (selected.dailyGroup === "interject") {
      // SPEC 0006 §7 (ADR 0110): a conversation said in front of everyone
      // gives at most two bystanders who heard it the chance to interject,
      // and each settles in the same request.
      const opened = events.filter(row => row.eventType === "NpcReactionOpened"
        && (row.payload as HttpRecord | undefined)?.trigger === "heardConversation");
      expect(opened.length, "a bystander who heard was given the chance to interject").toBeGreaterThan(0);
      expect(opened.length, "at most two bystanders").toBeLessThanOrEqual(2);
      const reactions = ((after.state.campaignRuntime as unknown as HttpRecord).npcReactions ?? {}) as Record<string, HttpRecord>;
      for (const row of opened) expect(reactions[String((row.payload as HttpRecord).reactionId)]?.status,
        "each chance settled in the same request").not.toBe("open");
    } else if (selected.dailyGroup === "npcMove") {
      // SPEC 0006 §7: the promise leaves the NPC in the hall with its own work
      // planned; the next request's NPC work takes it out for real.
      const errand = Object.values(after.state.campaignRuntime.npcPlans)
        .find(plan => plan.schema === "zhuwei.npc-work/vnext-1")?.npcId as string | undefined;
      expect(errand, "an NPC's promise planned its own work").toBeTypeOf("string");
      if (index === 0) {
        expect(after.state.entities[errand!].sceneId, "the NPC leaves only by its own later decision").toBe("wake");
      } else {
        const moved = events.filter(row => row.eventType === "CharacterMoved"
          && (row.payload as HttpRecord | undefined)?.characterId === errand);
        expect(moved.length, "the NPC's move committed").toBe(1);
        expect(after.state.entities[errand!].sceneId).not.toBe("wake");
        const present = httpRecord(table.state).present as HttpRecord[] | undefined;
        expect((present ?? []).map(row => row.id), "the hall no longer lists the NPC").not.toContain(errand);
      }
    } else if (selected.dailyGroup === "investigation") {
      expect(after.state.knowledge[actor]).not.toEqual(initial.state.knowledge[actor]);
      expect(after.state.campaignRuntime.itemSystem).toEqual(initial.state.campaignRuntime.itemSystem);
    } else if (selected.dailyGroup === "items") {
      const entry = after.state.campaignRuntime.itemSystem.entries["item-entry:daily:healing-potion"];
      if (index === 0) { expect(entry.quantity).toBe(1); expect(entry.holderRef).toBe(actor); }
      else {
        expect(entry.quantity).toBe(0); expect(entry.disposition).toBe("consumed");
        expect(after.state.entities[actor].hitPoints.current).toBeGreaterThan(1);
        expect(events.filter(row => row.eventType === "HealingResolved")).toHaveLength(1);
      }
    } else if (selected.dailyGroup === "spell") {
      expect(after.state.entities[actor].hitPoints.current).toBeGreaterThan(1);
      expect(after.state.entities[actor].resources?.slot1).toBe(Number(initial.state.entities[actor].resources?.slot1) - 1);
      expect(after.state.combatRuntime.entities[actor].resources["spellSlot:1"].current)
        .toBe(String(after.state.entities[actor].resources?.slot1));
      expect(events.filter(row => row.eventType === "HealingResolved")).toHaveLength(1);
      expect(events.filter(row => row.eventType === "SpellResolved")).toHaveLength(1);
    } else if (selected.dailyGroup === "combat") {
      // SPEC 0012: hostility opens a pending combat or an encounter, and the
      // attack is an AbilityInvoked whose mechanical result carries the attack
      // roll (`attack` for one target, `attacks` per target). There is no
      // separate attack event.
      expect(events.some(row => ["CombatPendingOpened", "EncounterStarted"].includes(row.eventType)), "encounter opened").toBe(true);
      const attackRecords = (row: HttpRecord): HttpRecord[] => {
        const mechanical = (row.payload as HttpRecord | undefined)?.mechanicalResult as HttpRecord | undefined;
        const perTarget = mechanical?.attacks as Record<string, unknown> | undefined;
        return [mechanical?.attack, ...Object.values(perTarget ?? {})].filter((value): value is HttpRecord =>
          value !== null && typeof value === "object" && typeof (value as HttpRecord).hit === "boolean");
      };
      const attacks = (events as unknown as HttpRecord[]).filter(row => row.eventType === "AbilityInvoked"
        && (row.payload as HttpRecord | undefined)?.sourceEntityId === actor && attackRecords(row).length > 0);
      expect(attacks.length, "attack resolved").toBeGreaterThan(0);
      if (attacks.some(row => attackRecords(row).some(attack => attack.hit === true))) {
        expect(events.some(row => row.eventType === "DamagePacketResolved"), "hit damage resolved").toBe(true);
      }
    } else if (selected.dailyGroup === "contest") {
      // ADR 0085: walking over is part of the intent and resistance is for a
      // check to settle, so the act is not ruled impossible.
      expect(events.some(row => row.eventType === "WorldInteractionFeasibilityRuled"), "a contested act is not ruled impossible").toBe(false);
      if (index === 0 && selected.contest !== undefined) {
        // ADR 0086: someone who resists is grabbed by a contest. ADR 0090: if
        // held, he comes along to where the actor carries him.
        const { opponentRef, carryTo } = selected.contest;
        const contested = (events as unknown as HttpRecord[]).filter(row => row.eventType === "WorldInteractionResolved"
          && ((row.payload as HttpRecord).check as HttpRecord | undefined)?.opposition !== undefined
          && (((row.payload as HttpRecord).check as HttpRecord).opposition as HttpRecord).opponentRef === opponentRef);
        expect(contested.length, "a contest against the one who resists").toBeGreaterThan(0);
        const entities = after.state.combatRuntime.entities as Record<string, HttpRecord>;
        const held = (entities[opponentRef].conditions as HttpRecord | undefined)?.grappledBy === actor;
        const won = (contested.at(-1)!.payload as HttpRecord).branch === "success";
        // Guidance v77: carried there, then let go by a release after the carry.
        if (selected.contest.putDown === true && won) expect(held, "put down after the carry").toBe(false);
        if (held || (selected.contest.putDown === true && won)) {
          const feature = authorityGeometryFeatureComposite(after.state, carryTo);
          const place = feature === undefined ? undefined : rectangularFeatureEntity(feature.feature, feature.sceneRef);
          expect(place !== undefined && nextTo(entities[actor], place), "the actor carried him to the place named").toBe(true);
          expect(nextTo(entities[opponentRef], entities[actor]), "the one held stops beside the actor").toBe(true);
        } else {
          expect(nextTo(entities[actor], entities[opponentRef]), "the actor at least walked up to him").toBe(true);
        }
      }
    } else if (selected.dailyGroup === "jump" && index === 0 && selected.jumpOver !== undefined) {
      // SPEC 0014 §4 (ADR 0092): the jump happens in state, not only in text.
      const jumps = (events as unknown as HttpRecord[]).filter(row => row.eventType === "CharacterJumped"
        && (row.payload as HttpRecord).characterId === actor && (row.payload as HttpRecord).featureId === selected.jumpOver);
      expect(jumps.length, "the actor jumped the feature named").toBe(1);
      const entities = after.state.combatRuntime.entities as Record<string, HttpRecord>;
      expect(entities[actor].position, "the actor stands where it landed").toEqual((jumps[0].payload as HttpRecord).to);
    } else if (selected.dailyGroup === "terrain" && index === texts.length - 1 && selected.terrain !== undefined) {
      // SPEC 0014 §4 (ADR 0098): the climb happens in state: the actor ends on
      // the far side of the feature, back on the ground, and climbed it in events.
      const { featureRef } = selected.terrain;
      const climbs = (events as unknown as HttpRecord[]).filter(row => /Climb/u.test(String(row.eventType))
        && (row.payload as HttpRecord).characterId === actor && (row.payload as HttpRecord).featureId === featureRef);
      expect(climbs.length, "the actor climbed the feature named").toBeGreaterThan(0);
      const feature = authorityGeometryFeatureComposite(after.state, featureRef);
      expect(feature, "the feature is on the map").toBeDefined();
      const xs = (feature!.feature.polygon as HttpRecord[]).map(point => BigInt(String(point.x)));
      const middle = (xs.reduce((low, x) => x < low ? x : low) + xs.reduce((high, x) => x > high ? x : high)) / 2n;
      const where = (state: HttpRecord) => httpRecord(httpRecord(httpRecord(state.combatRuntime).entities)[actor]).position as HttpRecord;
      const side = (state: HttpRecord) => BigInt(String(where(state).x)) < middle ? "west" : "east";
      expect(side(after.state as unknown as HttpRecord), "the actor ends on the far side").not.toBe(side(beforeDenial.state as unknown as HttpRecord));
      expect(where(after.state as unknown as HttpRecord).elevation, "back on the ground").toBe(where(beforeDenial.state as unknown as HttpRecord).elevation);
    } else if (selected.dailyGroup === "help" && peer !== undefined) {
      // SPEC 0004 §4 (ADR 0099): the owner's help waits on the second player,
      // whose next act rolls its checks with advantage and spends it.
      const entities = after.state.combatRuntime.entities as Record<string, HttpRecord>;
      const help = (entities[peer]!.conditions as HttpRecord | undefined)?.helped as HttpRecord[] | undefined;
      if (index === 0) {
        expect(help, "the help waits on the ally").toEqual([{ helperRef: actor, kind: "check" }]);
      } else {
        expect(help, "the ally's next act used it up").toBeUndefined();
        const checks = (events as unknown as HttpRecord[]).filter(row => row.eventType === "WorldInteractionResolved"
          && (row.payload as HttpRecord).actorCharacterId === peer).map(row => (row.payload as HttpRecord).check as HttpRecord | null)
          .filter((check): check is HttpRecord => check !== null && check !== undefined && check.opposition === undefined);
        for (const check of checks) expect((check.rolls as unknown[]).length, "a helped check rolls two d20").toBe(2);
      }
    } else if (selected.dailyGroup === "combatStart" && index === 0 && selected.opponentRef !== undefined) {
      // SPEC 0012 §§3、5 (ADR 0102): attacking Naes from play starts a fight
      // with both in it and initiative settled.
      const rows = events as unknown as HttpRecord[];
      const started = rows.find(row => row.eventType === "EncounterStarted");
      expect(started, "the fight started").toBeDefined();
      const participants = httpRecord(httpRecord(started!.payload).encounter).participantEntityIds as string[];
      expect(participants, "both take part").toEqual(expect.arrayContaining([actor, selected.opponentRef]));
      expect(rows.some(row => row.eventType === "InitiativeEstablished"), "initiative settled").toBe(true);
    } else if (selected.dailyGroup === "combatTurn" && index === 0) {
      // SPEC 0006 §§6、7 (ADR 0101): ending the turn hands it to the NPCs,
      // each of which plans its own.
      const planned = (events as unknown as HttpRecord[]).filter(row => row.eventType === "NpcCombatTurnPlanned");
      expect(planned.length, "an NPC planned its turn").toBeGreaterThan(0);
    } else if (selected.dailyGroup === "combatOpportunity" && index === 0 && selected.opponentRef !== undefined) {
      // SPEC 0012 §7.2: leaving the NPC's reach offers it an opportunity
      // attack, which it answers itself.
      const rows = events as unknown as HttpRecord[];
      const offered = rows.some(row => row.eventType === "ReactionOffered"
        && httpRecord(httpRecord(row.payload).pending).controllerEntityId === selected.opponentRef);
      const answered = rows.some(row => row.eventType === "ReactionAnswered" && httpRecord(row.payload).controllerEntityId === selected.opponentRef);
      expect([offered, answered], "the NPC was offered the opportunity attack and answered it").toEqual([true, true]);
    } else if (selected.dailyGroup === "combatStrike" && selected.opponentRef !== undefined) {
      strikeNotes = { ...assertCombatStrikeStep({ step, actor, opponentRef: selected.opponentRef, beforeStep: beforeDenial, after,
        opening: initial, strike, ruled }), ...assertConclusionStep({ step, opponentRef: selected.opponentRef, beforeStep: beforeDenial, after, ruled }) };
    } else if (selected.dailyGroup === "combatEnd" && selected.opponentRef !== undefined) {
      strikeNotes = assertConclusionStep({ step, opponentRef: selected.opponentRef, beforeStep: beforeDenial, after, ruled });
      // The surrender in words is put to the player as the end of the fight.
      if (index === 0) expect(strikeNotes?.conclusionAsked, "the KP ended the fight and Rules asked the player").toBeDefined();
    } else if (selected.dailyGroup === "combatHide" && index === 1) {
      // SPEC 0004 §4 (ADR 0097): at the start of its turn an opponent that
      // can see the hider rolls Perception against its Stealth total.
      const rolled = (events as unknown as HttpRecord[]).filter(row => row.eventType === "HiddenPerceptionRolled"
        && httpRecord(row.payload).hiderRef === actor);
      expect(rolled.length, "an NPC rolled Perception for the hidden actor").toBeGreaterThan(0);
    } else if (selected.dailyGroup === "hide" && index === 1) {
      // SPEC 0004 §4 (ADR 0097): speaking from hiding ends it for everyone.
      const entities = after.state.combatRuntime.entities as Record<string, HttpRecord>;
      expect((entities[actor].conditions as HttpRecord | undefined)?.hidden, "speaking ended the hiding").toBeUndefined();
    } else if (selected.dailyGroup === "shove" && index === 0 && selected.shove !== undefined) {
      // SPEC 0004 §4 (ADR 0092): a won shove-away moves the NPC 5 feet away, or
      // leaves it where it was when that spot is taken.
      const resolved = (events as unknown as HttpRecord[]).filter(row => row.eventType === "WorldInteractionResolved"
        && (((row.payload as HttpRecord).check as HttpRecord | undefined)?.opposition as HttpRecord | undefined)?.opponentRef === selected.shove!.opponentRef);
      expect(resolved.length, "a contest against the one shoved").toBe(1);
      if ((resolved[0].payload as HttpRecord).branch === "success") {
        const applied = ((resolved[0].payload as HttpRecord).appliedEffects as HttpRecord[]).filter(effect =>
          effect.kind === "pushedAway" || effect.kind === "pushBlocked");
        expect(applied.map(effect => effect.targetRef), "pushed, or blocked in place").toEqual([selected.shove.opponentRef]);
        if (applied[0].kind === "pushedAway") {
          const entities = after.state.combatRuntime.entities as Record<string, HttpRecord>;
          expect(entities[selected.shove.opponentRef].position, "the NPC stands where it was pushed").toEqual(applied[0].to);
        }
      }
    } else if (selected.dailyGroup === "prone" && index === 0) {
      const entities = after.state.combatRuntime.entities as Record<string, HttpRecord>;
      expect((entities[actor].conditions as HttpRecord | undefined)?.prone, "the actor lies on the floor").toBe(true);
    } else if (selected.dailyGroup === "hide" && index === 0) {
      // SPEC 0004 §4 (ADR 0097): the hide is a concealed Stealth check whose
      // total the actor keeps, unless an opponent's Perception roll after the
      // act found it at once.
      const rows = events as unknown as HttpRecord[];
      const hid = rows.flatMap(row => row.eventType === "WorldInteractionResolved"
        ? ((row.payload as HttpRecord).appliedEffects as HttpRecord[] | undefined ?? []).filter(effect => effect.kind === "hid") : []);
      expect(hid.length, "the hide was settled by Rules").toBe(1);
      const found = rows.some(row => row.eventType === "HiddenPerceptionRolled" && typeof (row.payload as HttpRecord).foundByRef === "string");
      const entities = after.state.combatRuntime.entities as Record<string, HttpRecord>;
      const hidden = (entities[actor].conditions as HttpRecord | undefined)?.hidden as HttpRecord | undefined;
      expect(hidden?.stealthTotal, "the state keeps the Stealth total unless the actor was found").toEqual(found ? undefined : hid[0].stealthTotal);
    } else if (selected.dailyGroup === "retryQuestion") {
      // SPEC 0001 §19 (ADR 0083): a ruling is asked about once, and a ruling
      // made by an action that answered a question is never asked about.
      const questions = retryQuestionsOf(after);
      expect(new Set(questions.map(entry => entry.ref)).size, "no ruling asked about twice").toBe(questions.length);
      const answeredRoots = questions.filter(entry => entry.answered).map(entry => entry.rootActionId);
      for (const entry of questions) {
        const ruling = Object.values(after.state.campaignRuntime.adjudicationPrecedents).find(record => record.precedentId === entry.ref)
          ?? Object.values(after.state.campaignRuntime.conversationThreads ?? {}).find(record => record.threadRef === entry.ref);
        const root = String((ruling as HttpRecord | undefined)?.rootActionId ?? "").replace(/^activity-result:/u, "");
        expect(answeredRoots.filter(answered => answered !== entry.rootActionId), "a ruling made on an answer is final").not.toContain(root);
      }
    } else if (selected.dailyGroup === "multiplayer") {
      expect(peer).toBeTypeOf("string");
      expect(after.state.knowledge[peer!]).toEqual(initial.state.knowledge[peer!]);
      const peerTable = await historyHttpPost("fetchTable", source.code, source.peer);
      await evidence(`${prefix}-peer`, peerTable.body);
      expect(peerTable.response.status).toBe(200);
      expect(JSON.stringify(peerTable.body)).not.toContain(text);
      const ownerNewBodies = messages.filter(row => row.kind === "narrate" && !oldIds.has(row.id)).map(row => row.body);
      for (const body of ownerNewBodies) expect(JSON.stringify(peerTable.body)).not.toContain(String(body));
    }
    await assertReplay(after);
    const usage = await bridge("/status");
    if (index === texts.length - 1) await bridge("/seal-retry", {});
    // A rejected reply is retried by resending the same submission, which
    // writes it again (more calls, new delivery records); there is nothing
    // exact to compare, so such a step is not resent.
    if (completed!.body.narration !== "rejected") {
      const duplicate = await historyHttpPost(command, data, player);
      const repeated = await snapshot(), repeatedUsage = await bridge("/status");
      await evidence(`${prefix}-retry`, { pendingRetries: rollRetries, command, data,
        status: duplicate.response.status, body: duplicate.body, authority: repeated, usage: repeatedUsage });
      expect(duplicate.body).toEqual(completed!.body);
      expect(repeated).toEqual(after);
      expect(repeatedUsage.calls).toEqual(usage.calls);
      expect(repeatedUsage.stopCode).toBeNull();
    }
    // SPEC 0005 §6.2 (ADR 0062): a covert check's frozen tiers and the records
    // cited for them, so batches can be compared for stability.
    const covert = (events as unknown as HttpRecord[]).map(row =>
      ((row.payload as HttpRecord | undefined)?.request as HttpRecord | undefined)?.frozenCheck as HttpRecord | undefined)
      .find(check => check !== undefined && check !== null && check.concealment !== undefined);
    outcomes.push({ step: index + 1, command, action: completed!.body.action, narration: completed!.body.narration,
      ...(completed!.body.narration === "rejected" ? { narrationRejected: true } : {}),
      ...(strikeNotes === undefined ? {} : { strike: strikeNotes }),
      ...(selected.dailyGroup === "retryQuestion" ? { asked: asked === undefined ? null : { pendingInputId: asked.pendingInputId, question: asked.question },
        answered: "answer" in step, precedents: Object.keys(after.state.campaignRuntime.adjudicationPrecedents).length } : {}),
      ...(selected.contest === undefined ? {} : { contest: (events as unknown as HttpRecord[])
        .filter(row => row.eventType === "WorldInteractionResolved").map(row => ({ rulingKind: (row.payload as HttpRecord).rulingKind,
          branch: (row.payload as HttpRecord).branch, opposition: ((row.payload as HttpRecord).check as HttpRecord | undefined)?.opposition ?? null })),
        walks: (events as unknown as HttpRecord[]).filter(row => row.eventType === "CharacterRepositioned").map(row => row.payload) }),
      ...(selected.approachTo === undefined ? {} : { approach: (events as unknown as HttpRecord[])
        .filter(row => row.eventType === "CharacterRepositioned").map(row => (row.payload as HttpRecord).toward) }),
      stateSha: canonicalHash(after.state), events: events.map(row => row.eventType), retryExact: completed!.body.narration !== "rejected",
      ...(covert === undefined ? {} : { concealment: { dc: covert.dc, ...(covert.concealment as HttpRecord) } }) });
    if (index < texts.length - 1) {
      const deliveryId = httpRecord(table.state).currentDeliveryId;
      if (typeof deliveryId === "string") {
        const ack = await historyHttpPost("acknowledgeDelivery", { code: source.code, deliveryId }, player);
        expect(ack.body.ok).toBe(true);
      }
      if ("peer" in step) table = (await historyHttpPost("fetchTable", source.code, source.owner)).body;
    }
  }
  const final = await snapshot();
  await evidence("acceptance", { status: "passed", caseId: selected.caseId, group: selected.dailyGroup,
    ...(selected.dailyGroup === "retryQuestion" ? { retryQuestions: retryQuestionsOf(final),
      precedents: Object.values(final.state.campaignRuntime.adjudicationPrecedents) } : {}),
    defaultActionAssertionsApplied: Boolean(selected.actionAssertions),
    witnessSourceAssertionsApplied: Boolean(selected.witnessAssertions), customAction: selected.customAction === true,
    initialFixture: selected.initialFixture ?? "Registered module and compiled initial character fixture.",
    outcomes, providerCalls: (await bridge("/status")).realProviderCalls,
    manualReviewRequired: "Passed means the recorded functional assertions passed. Separately inspect the saved prose for natural language, immersion and factual grounding.",
    notCovered: ["Browser interaction", "room creation and character wizard", "all spells or combat moves", "long-term narrative stability",
      ...(selected.customAction ? ["Custom action possession, evidence meaning and secret-content semantics; only declared case-level assertions apply"] : [])] });
}

/** The map the table shows its player. */
function tacticalOf(table: HttpRecord): HttpRecord {
  return httpRecord(httpRecord(httpRecord(table.state).authoritative).tacticalProjection);
}

/** The action bar the table shows its player (SPEC 0014 §8). */
function combatControlsOf(table: HttpRecord): HttpRecord {
  return httpRecord(httpRecord(httpRecord(table.state).authoritative).combatControls);
}

/** ADR 0113: the attack with the weapon in the actor's main hand, as the bar lists it. */
function mainWeaponAttack(table: HttpRecord): HttpRecord {
  const weapon = (combatControlsOf(table).abilities as unknown[]).map(httpRecord)
    .find(ability => ability.group === "attack" && String(ability.abilityRef).includes(":weapon:") && !String(ability.name).endsWith("（副手）"));
  if (weapon === undefined) throw new Error("PROBE_WEAPON_ATTACK_NOT_OFFERED");
  return weapon;
}

/** ADR 0113: first aid on `ref`, when the bar offers it. */
function stabilizeOffer(table: HttpRecord, ref: string): HttpRecord | undefined {
  const authoritative = httpRecord(httpRecord(table.state).authoritative);
  if (authoritative.combatControls === undefined || authoritative.combatControls === null) return undefined;
  return (combatControlsOf(table).basicActions as unknown[]).map(httpRecord).find(action => action.abilityRef === "action:stabilize"
    && (httpRecord(action.target).onlyRefs as unknown[] | undefined)?.includes(ref));
}

/** A Rules choice waiting for the player (a knock-out, a reaction). */
function rulesChoicePending(table: HttpRecord): HttpRecord | undefined {
  const pending = httpRecord(table.state).pendingInputs;
  return Array.isArray(pending) ? pending.map(httpRecord).find(entry => typeof entry.choiceKind === "string"
    && answerOptionsOf(entry) !== undefined) : undefined;
}

type StrikeSnapshot = Snapshot & { deliveryPlans?: HttpRecord[]; experiencedMessages?: HttpRecord[] };

/** SPEC 0012 §12.1: `ref` lies dying (0 HP, making death saves, not stable)
 * while it is the actor's turn. */
function dyingOnActorsTurn(snapshot: Snapshot, actor: string, ref: string): boolean {
  const target = snapshot.state.combatRuntime.entities[ref] as HttpRecord | undefined;
  const conditions = (target?.conditions ?? {}) as HttpRecord;
  return target !== undefined && target.lifeState !== "dead" && target.deathPolicy === "deathSaves"
    && String((target.hitPoints as HttpRecord | undefined)?.current) === "0" && conditions.stable !== true
    && Object.values(snapshot.state.combatRuntime.encounters).some(encounter => (encounter as HttpRecord).activeEntityId === actor);
}

/** What the actor's reply to `root` was written from (its frozen claims) and
 * the reply itself, when published. */
function actorReplyOf(snapshot: Snapshot, root: string, actor: string): { claims: HttpRecord[]; bodies: string[] } {
  const saved = snapshot as StrikeSnapshot;
  const claims = (saved.deliveryPlans ?? []).filter(row => row.root_action_id === root)
    .flatMap(row => (httpRecord(JSON.parse(String(row.plan_json))).audiences as unknown[]).map(httpRecord))
    .filter(audience => audience.characterId === actor)
    .flatMap(audience => (httpRecord(httpRecord(audience.kpProjection).renderableClaims).claims as unknown[]).map(httpRecord));
  const bodies = (saved.experiencedMessages ?? []).filter(row => row.kind === "kp" && String(row.receipt_id).startsWith(`receipt:${root}:`)
    && String(row.viewer_key).endsWith(actor)).map(row => String(row.body));
  return { claims, bodies };
}

/** SPEC 0012 §§6.3、12, SPEC 0016 §8.2 (ADR 0113): one step of a strike on
 * the opponent from the map. The weapon attack resolves with its roll and
 * total; once its root commits, a hit's damage has come off the opponent and
 * the actor's reply material names the weapon as the bar does; ending the
 * turn hands the fight to the opponent; first aid resolves a Medicine check
 * against DC 10 that stabilizes on a success. Returns what the step showed. */
function assertCombatStrikeStep(input: { step: Step; actor: string; opponentRef: string; beforeStep: Snapshot; after: Snapshot;
  opening: Snapshot; strike: { abilityRef?: string; name?: string }; ruled: HttpRecord | undefined }): HttpRecord {
  const { step, actor, opponentRef, beforeStep, after, opening, strike } = input;
  const rows = (snapshot: Snapshot, from: Snapshot) => snapshot.events.slice(from.events.length) as unknown as HttpRecord[];
  const stepEvents = rows(after, beforeStep), all = rows(after, opening);
  const body = (snapshot: Snapshot, ref: string) => snapshot.state.combatRuntime.entities[ref] as HttpRecord;
  const hitPoints = (snapshot: Snapshot, ref: string) => Number(httpRecord(body(snapshot, ref).hitPoints).current);
  const invokedBy = (list: HttpRecord[], abilityRef: string | undefined) => list.filter(row => row.eventType === "AbilityInvoked"
    && httpRecord(row.payload).sourceEntityId === actor && httpRecord(row.payload).abilityRef === abilityRef);
  const notes: HttpRecord = {};
  const weaponStep = "map" in step && "weaponAttack" in step.map;
  if (weaponStep) {
    const invoked = invokedBy(stepEvents, strike.abilityRef);
    expect(invoked.length, "the weapon attack resolved").toBe(1);
    const attack = httpRecord(httpRecord(httpRecord(invoked[0]!.payload).mechanicalResult).attack);
    expect([typeof attack.hit, typeof attack.total], "the attack roll has its result and total").toEqual(["boolean", "number"]);
    notes.attack = { hit: attack.hit, total: attack.total, roll: attack.selected ?? attack.roll };
  }
  // The strike's root commits in this step: with the attack, or with the
  // answer to the knock-out choice it opened.
  if ((weaponStep && !input.ruled) || ("choose" in step && step.choose.choiceKind === "knockOut")) {
    const invoked = invokedBy(all, strike.abilityRef)[0];
    expect(invoked, "the weapon attack resolved").toBeDefined();
    const attack = httpRecord(httpRecord(httpRecord(invoked!.payload).mechanicalResult).attack);
    if (attack.hit === true) {
      const packets = stepEvents.filter(row => row.eventType === "DamagePacketResolved" && httpRecord(row.payload).targetEntityId === opponentRef
        && httpRecord(row.payload).sourceDefinitionId === strike.abilityRef);
      expect(packets.length, "a hit's damage resolved").toBe(1);
      const dealt = Number(httpRecord(packets[0]!.payload).totalApplied);
      expect(hitPoints(after, opponentRef), "the damage came off the opponent's hit points")
        .toBe(Math.max(0, hitPoints(beforeStep, opponentRef) - dealt));
      notes.damage = dealt;
    }
    const reply = actorReplyOf(after, String(invoked!.rootActionId), actor);
    const told = reply.claims.find(claim => claim.kind === "abilityEffectApplied" && claim.sourceRef === actor && claim.abilityRef === strike.abilityRef);
    expect(told?.abilityName, "the reply material names the weapon as the bar does").toBe(strike.name);
    const outcome = reply.claims.find(claim => claim.actorRef === actor && ["attackHit", "criticalHit", "attackMissed"].includes(String(claim.outcomeCode)));
    expect(httpRecord(outcome?.check ?? {}).total, "the reply material has the attack's total").toBe(attack.total);
    expect(JSON.stringify(reply.claims)).not.toContain("该能力");
    for (const text of reply.bodies) expect(text, "the reply does not call the weapon 该能力").not.toContain("该能力");
    notes.replyMentionsWeapon = reply.bodies.length === 0 ? null : reply.bodies.some(text => text.includes(String(strike.name)));
    notes.opponent = { hitPoints: hitPoints(after, opponentRef), lifeState: body(after, opponentRef).lifeState };
  }
  // ADR 0112: with no foe left to fight, ending the turn first asks whether
  // to end the fight; declined, the turn ends as asked.
  const turnHandedOn = ("map" in step && step.map.command === "endTurn" && input.ruled?.choiceKind !== "encounterConclusion")
    || ("choose" in step && step.choose.answer.kind === "rejectEncounterConclusion");
  if (turnHandedOn) {
    // The fight goes on to the opponent's turn unless it died.
    if (body(after, opponentRef).lifeState !== "dead") {
      expect(stepEvents.some(row => row.eventType === "TurnStarted" && httpRecord(row.payload).sourceEntityId === opponentRef),
        "the fight went on to the opponent's turn").toBe(true);
    }
    notes.opponent = { hitPoints: hitPoints(after, opponentRef), lifeState: body(after, opponentRef).lifeState,
      stable: (body(after, opponentRef).conditions as HttpRecord | undefined)?.stable === true };
  }
  if ("map" in step && "stabilize" in step.map) {
    const invoked = invokedBy(stepEvents, "action:stabilize");
    expect(invoked.length, "first aid resolved").toBe(1);
    const medicine = httpRecord(httpRecord(httpRecord(invoked[0]!.payload).mechanicalResult).medicine);
    expect([medicine.targetEntityId, medicine.dc, typeof medicine.succeeded, typeof medicine.total])
      .toEqual([step.map.stabilize, 10, "boolean", "number"]);
    expect((body(after, step.map.stabilize).conditions as HttpRecord | undefined)?.stable === true, "a success stabilizes").toBe(medicine.succeeded);
    const reply = actorReplyOf(after, String(invoked[0]!.rootActionId), actor);
    expect(reply.claims.find(claim => claim.kind === "abilityEffectApplied" && claim.abilityRef === "action:stabilize")?.abilityName).toBe("急救");
    const outcome = reply.claims.find(claim => ["stabilized", "stabilizeFailed"].includes(String(claim.outcomeCode)));
    expect(httpRecord(outcome?.check ?? {}).total, "the reply material has the Medicine total").toBe(medicine.total);
    notes.firstAid = { succeeded: medicine.succeeded, total: medicine.total };
  }
  return notes;
}

/** ADR 0112: the play table answers whether to end the fight with its two
 * fixed buttons, which the choice itself does not list. */
const CONCLUSION_BUTTONS: readonly HttpRecord[] = [
  { label: "我接受当前遭遇的收束。", answer: { kind: "acceptEncounterConclusion" } },
  { label: "我拒绝当前遭遇的收束，继续采取合法行动。", answer: { kind: "rejectEncounterConclusion" } },
];

function answerOptionsOf(entry: HttpRecord): HttpRecord[] | undefined {
  return Array.isArray(entry.answerOptions) ? entry.answerOptions.map(httpRecord)
    : entry.choiceKind === "encounterConclusion" ? [...CONCLUSION_BUTTONS] : undefined;
}

/** The Rules choice of this kind waiting for the player, with this answer among its options. */
function pendingChoice(table: HttpRecord, choose: ChoiceStep): HttpRecord | undefined {
  const pending = httpRecord(table.state).pendingInputs;
  return Array.isArray(pending) ? pending.map(httpRecord).find(entry =>
    (choose.reactionKind === undefined || entry.reactionKind === choose.reactionKind)
    && (choose.choiceKind === undefined || entry.choiceKind === choose.choiceKind)
    && (answerOptionsOf(entry) ?? []).some(option => canonicalHash(option.answer ?? null) === canonicalHash(choose.answer))) : undefined;
}

function optionLabel(choice: HttpRecord, answer: Readonly<Record<string, unknown>>): string | undefined {
  const option = (answerOptionsOf(choice) ?? []).find(entry => canonicalHash(entry.answer ?? null) === canonicalHash(answer));
  return typeof option?.label === "string" && option.label.trim() ? option.label : undefined;
}

/** SPEC 0012 §13 (ADR 0112): the end of the fight put to the player, and what
 * the answer did: accepted, the encounter ends for the reason Rules proposed;
 * declined, no fight ends. Returns what the step showed. */
function assertConclusionStep(input: { step: Step; opponentRef: string; beforeStep: Snapshot; after: Snapshot;
  ruled: HttpRecord | undefined }): HttpRecord | undefined {
  const { step, beforeStep, after, ruled } = input;
  const stepEvents = after.events.slice(beforeStep.events.length) as unknown as HttpRecord[];
  if (ruled?.choiceKind === "encounterConclusion") {
    const proposed = stepEvents.find(row => row.eventType === "EncounterConclusionProposed");
    expect(proposed, "Rules put the end of the fight to the player").toBeDefined();
    return { conclusionAsked: httpRecord(httpRecord(proposed!.payload).proposal).reason ?? null, question: ruled.question };
  }
  if (!("choose" in step) || step.choose.choiceKind !== "encounterConclusion") return undefined;
  const concluded = stepEvents.find(row => row.eventType === "EncounterConcluded");
  const running = Object.values(after.state.combatRuntime.encounters).filter(encounter => (encounter as HttpRecord).status === "active");
  if (step.choose.answer.kind === "acceptEncounterConclusion") {
    expect(concluded, "accepted, the encounter ended").toBeDefined();
    expect(running.length, "no fight is running").toBe(0);
    return { concluded: httpRecord(concluded!.payload).reason };
  }
  expect([concluded, running.length], "declined, the fight goes on").toEqual([undefined, 1]);
  return { declined: true };
}

/** A straight walk of `feet` from where the table shows the actor, away from
 * `ref`: straight away first, then turned by 45° steps either side, the
 * first whose path the table shows clear of the walls, the solid features
 * and other creatures it knows of. Rules still judges the walk. */
function walkAway(table: HttpRecord, ref: string, feet: number): HttpRecord[] {
  const projection = tacticalOf(table);
  const self = httpRecord(httpRecord(projection.self).position);
  const entities = (projection.visibleEntities as unknown[]).map(httpRecord);
  const other = entities.find(entity => entity.id === ref);
  if (other === undefined) throw new Error(`PROBE_WALK_AWAY_TARGET_NOT_VISIBLE:${ref}`);
  const from = httpRecord(other.position);
  const sx = Number(self.x), sy = Number(self.y);
  const boxes = [
    ...(projection.knownFeatures as unknown[]).map(httpRecord).filter(feature => feature.impassable === true)
      .map(feature => (feature.polygon as HttpRecord[]).map(point => [Number(point.x), Number(point.y)])),
    ...entities.map(entity => {
      const x = Number(httpRecord(entity.position).x), y = Number(httpRecord(entity.position).y);
      return [[x - 30, y - 30], [x + 30, y + 30]];
    }),
  ].map(points => ({ x0: Math.min(...points.map(p => p[0]!)), x1: Math.max(...points.map(p => p[0]!)),
    y0: Math.min(...points.map(p => p[1]!)), y1: Math.max(...points.map(p => p[1]!)) }));
  const bounds = (httpRecord(projection.scene).boundary as HttpRecord).points as HttpRecord[];
  const bx0 = Math.min(...bounds.map(p => Number(p.x))), bx1 = Math.max(...bounds.map(p => Number(p.x)));
  const by0 = Math.min(...bounds.map(p => Number(p.y))), by1 = Math.max(...bounds.map(p => Number(p.y)));
  // The walker's own 5-foot square, kept an inch clear of everything.
  const clearAt = (x: number, y: number) => x - 30 >= bx0 && x + 30 <= bx1 && y - 30 >= by0 && y + 30 <= by1
    && boxes.every(box => x + 30 <= box.x0 || x - 30 >= box.x1 || y + 30 <= box.y0 || y - 30 >= box.y1);
  const away = Math.atan2(sy - Number(from.y), sx - Number(from.x)), inches = feet * 12;
  for (const turn of [0, 1, -1, 2, -2, 3, -3]) {
    const angle = away + turn * Math.PI / 4;
    const steps = Math.ceil(inches / 6);
    const points = Array.from({ length: steps }, (_, index) => [sx + Math.cos(angle) * inches * (index + 1) / steps,
      sy + Math.sin(angle) * inches * (index + 1) / steps]);
    if (!points.every(([x, y]) => clearAt(x!, y!))) continue;
    const end = points.at(-1)!;
    return [structuredClone(self), { x: String(Math.round(end[0]!)), y: String(Math.round(end[1]!)), elevation: String(self.elevation) }];
  }
  throw new Error(`PROBE_WALK_AWAY_NO_CLEAR_LINE:${ref}`);
}

/** The KP's question the table shows as waiting, if any (SPEC 0001 §19). */
function retryQuestionPending(table: HttpRecord): HttpRecord | undefined {
  const pending = httpRecord(table.state).pendingInputs;
  return Array.isArray(pending) ? pending.map(httpRecord).find(entry => entry.kind === "clarification"
    && typeof entry.pendingInputId === "string" && entry.pendingInputId.startsWith("retry-question:")) : undefined;
}

/** Every question the room's actions asked, from Room's prepared actions. */
function retryQuestionsOf(snapshot: Snapshot): { ref: string; question: string; answered: boolean; answer: string | null; rootActionId: string }[] {
  const rows = (snapshot as unknown as { privateSubmissions?: HttpRecord[] }).privateSubmissions ?? [];
  return rows.flatMap(row => {
    const prepared = typeof row.prepared_json === "string" ? httpRecord(JSON.parse(row.prepared_json)) : {};
    const question = prepared.retryQuestion === undefined ? undefined : httpRecord(prepared.retryQuestion);
    if (question === undefined || typeof question.ref !== "string") return [];
    const answer = question.answer === undefined ? undefined : httpRecord(question.answer);
    return [{ ref: question.ref, question: String(question.question), answered: answer !== undefined,
      answer: answer === undefined ? null : (answer.text as string | null), rootActionId: String(row.root_action_id) }];
  });
}
