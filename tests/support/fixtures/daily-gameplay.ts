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
  | Readonly<{ command: "moveOnMap"; awayFrom: string; feet: number }>;
/** The answer to a Rules choice waiting for this player (a readied action
 * firing, a reaction), sent only while one of that kind waits. */
type ChoiceStep = Readonly<{ reactionKind?: string; choiceKind?: string; answer: Readonly<Record<string, unknown>> }>;
const SPATIAL_COMMANDS: readonly string[] = ["moveOnMap", "combatAbility"];
type Selection = { caseId: string; dailyGroup: string; text: string; nextText?: string; steps?: readonly Step[]; initialFixture?: string;
  /** Who each NPC-held case targets: the NPC the actor fights. */
  opponentRef?: string;
  /** The case opens in a fight with this NPC, set up before any step; its `text` is not sent. */
  startsInCombat?: { opponentRef: string; besideOpponent?: boolean };
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
    if (("answer" in step && waiting === undefined) || ("press" in step && waiting !== undefined) || ("choose" in step && choice === undefined)) {
      const reason = "answer" in step ? "noQuestionWaiting" : "choose" in step ? "noChoiceWaiting" : "questionWaiting";
      outcomes.push({ step: index + 1, skipped: reason });
      await evidence(`${prefix}-skipped`, { reason });
      continue;
    }
    const request: HttpRecord = "answer" in step
      ? { code: source.code, submissionId: crypto.randomUUID(), pendingInputId: String(waiting!.pendingInputId), text,
        ...(typeof step.answer === "string" ? {} : { answer: { decline: true } }) }
      : "choose" in step ? { code: source.code, submissionId: crypto.randomUUID(), pendingInputId: String(choice!.pendingInputId),
        text: optionLabel(choice!, step.choose.answer) ?? text, answer: structuredClone(step.choose.answer) }
      : "map" in step ? { code: source.code, submissionId: crypto.randomUUID(),
        ...("awayFrom" in step.map ? { path: walkAway(table, step.map.awayFrom, step.map.feet) } : structuredClone(step.map.data)),
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
      if (rolls >= 3 || pending.length !== 1) break;
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
    if (asked !== undefined) {
      expect(completed!.body.action, JSON.stringify(completed!.body)).toBe("awaitingInput");
      expect(after.events, "a question commits no event").toEqual(beforeDenial.events);
    } else {
      expect(completed!.body.action, JSON.stringify(completed!.body)).toBe("committed");
      // ADR 0091: a walk on the map outside combat is told by the map alone.
      if (!("map" in step)) expect(completed!.body.narration, JSON.stringify(completed!.body)).toBe("published");
      else expect(["published", "notApplicable"], JSON.stringify(completed!.body)).toContain(completed!.body.narration);
    }
    expect(httpRecord(table.state).pendingRolls).toEqual([]);
    const messages = table.messages as HttpRecord[];
    const oldIds = new Set((options.initialTable.messages as HttpRecord[]).map(row => row.id));
    if (asked === undefined && completed!.body.narration === "published") expect(messages.some(row => row.kind === "narrate" && !oldIds.has(row.id)
      && typeof row.body === "string" && row.body.trim().length > 0), "new visible narration").toBe(true);
    const events = after.events.slice(initial.events.length);
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
    const duplicate = await historyHttpPost(command, data, player);
    const repeated = await snapshot(), repeatedUsage = await bridge("/status");
    await evidence(`${prefix}-retry`, { pendingRetries: rollRetries, command, data,
      status: duplicate.response.status, body: duplicate.body, authority: repeated, usage: repeatedUsage });
    expect(duplicate.body).toEqual(completed!.body);
    expect(repeated).toEqual(after);
    expect(repeatedUsage.calls).toEqual(usage.calls);
    expect(repeatedUsage.stopCode).toBeNull();
    // SPEC 0005 §6.2 (ADR 0062): a covert check's frozen tiers and the records
    // cited for them, so batches can be compared for stability.
    const covert = (events as unknown as HttpRecord[]).map(row =>
      ((row.payload as HttpRecord | undefined)?.request as HttpRecord | undefined)?.frozenCheck as HttpRecord | undefined)
      .find(check => check !== undefined && check.concealment !== undefined);
    outcomes.push({ step: index + 1, command, action: completed!.body.action, narration: completed!.body.narration,
      ...(selected.dailyGroup === "retryQuestion" ? { asked: asked === undefined ? null : { pendingInputId: asked.pendingInputId, question: asked.question },
        answered: "answer" in step, precedents: Object.keys(after.state.campaignRuntime.adjudicationPrecedents).length } : {}),
      ...(selected.contest === undefined ? {} : { contest: (events as unknown as HttpRecord[])
        .filter(row => row.eventType === "WorldInteractionResolved").map(row => ({ rulingKind: (row.payload as HttpRecord).rulingKind,
          branch: (row.payload as HttpRecord).branch, opposition: ((row.payload as HttpRecord).check as HttpRecord | undefined)?.opposition ?? null })),
        walks: (events as unknown as HttpRecord[]).filter(row => row.eventType === "CharacterRepositioned").map(row => row.payload) }),
      ...(selected.approachTo === undefined ? {} : { approach: (events as unknown as HttpRecord[])
        .filter(row => row.eventType === "CharacterRepositioned").map(row => (row.payload as HttpRecord).toward) }),
      stateSha: canonicalHash(after.state), events: events.map(row => row.eventType), retryExact: true,
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

/** The Rules choice of this kind waiting for the player, with this answer among its options. */
function pendingChoice(table: HttpRecord, choose: ChoiceStep): HttpRecord | undefined {
  const pending = httpRecord(table.state).pendingInputs;
  return Array.isArray(pending) ? pending.map(httpRecord).find(entry =>
    (choose.reactionKind === undefined || entry.reactionKind === choose.reactionKind)
    && (choose.choiceKind === undefined || entry.choiceKind === choose.choiceKind)
    && Array.isArray(entry.answerOptions) && entry.answerOptions.map(httpRecord)
      .some(option => canonicalHash(option.answer ?? null) === canonicalHash(choose.answer))) : undefined;
}

function optionLabel(choice: HttpRecord, answer: Readonly<Record<string, unknown>>): string | undefined {
  const option = (choice.answerOptions as unknown[]).map(httpRecord).find(entry => canonicalHash(entry.answer ?? null) === canonicalHash(answer));
  return typeof option?.label === "string" && option.label.trim() ? option.label : undefined;
}

/** A straight walk of `feet` from where the table shows the actor, directly
 * away from `ref`; Rules judges whether it can be walked. */
function walkAway(table: HttpRecord, ref: string, feet: number): HttpRecord[] {
  const projection = tacticalOf(table);
  const self = httpRecord(httpRecord(projection.self).position);
  const other = (projection.visibleEntities as unknown[]).map(httpRecord).find(entity => entity.id === ref);
  if (other === undefined) throw new Error(`PROBE_WALK_AWAY_TARGET_NOT_VISIBLE:${ref}`);
  const from = httpRecord(other.position);
  const dx = Number(self.x) - Number(from.x), dy = Number(self.y) - Number(from.y), length = Math.hypot(dx, dy) || 1;
  const inches = feet * 12;
  const end = { x: String(Math.round(Number(self.x) + dx / length * inches)), y: String(Math.round(Number(self.y) + dy / length * inches)),
    elevation: String(self.elevation) };
  return [structuredClone(self), end];
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
