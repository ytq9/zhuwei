import { expect } from "vitest";
import { assertDailyActionAuthority, assertDailyWitnessAuthority } from "./daily-gameplay-authority.mjs";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json";
import { historyHttpDraft, historyHttpPost, httpRecord } from "./story-history-http";
import { RETRY_DECLINE_TEXT } from "../../../app/_runtime/lib/kp/vnext/retry-question";
import type { historyHttpAuthority, historyHttpSource, HttpRecord } from "./story-history-http";

export const dailyClericDraft = { ...historyHttpDraft, classId: "cleric", subclassId: "life", backgroundId: "acolyte",
  scores: { str: 12, dex: 10, con: 13, int: 8, wis: 15, cha: 14 },
  cantrips: ["sacred-flame"], prepared: ["cure"], spellbook: [] };
type Snapshot = NonNullable<Awaited<ReturnType<typeof historyHttpAuthority>>>;
/** A later player step: words for the table; words pressing again, sent
 * only while no question waits; or the answer to the KP's waiting question
 * (SPEC 0001 §19) in words or as a decline, sent only while one waits. */
type Step = Readonly<{ text: string }> | Readonly<{ press: string }> | Readonly<{ answer: string | Readonly<{ decline: true }> }>;
type Selection = { caseId: string; dailyGroup: string; text: string; nextText?: string; steps?: readonly Step[]; initialFixture?: string;
  customAction?: boolean; witnessAssertions?: { observerRef: string };
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
  const steps: Step[] = [{ text: selected.text }, ...(selected.nextText ? [{ text: selected.nextText }] : []), ...(selected.steps ?? [])];
  const texts = steps.map(step => "text" in step ? step.text : "press" in step ? step.press
    : typeof step.answer === "string" ? step.answer : RETRY_DECLINE_TEXT);
  const outcomes: unknown[] = [];
  let table = options.initialTable;
  for (const [index, text] of texts.entries()) {
    const prefix = `daily-step-${index + 1}`;
    const step = steps[index]!;
    // SPEC 0001 §19: an answer goes to the question the KP is waiting on. A
    // step whose earlier ruling left nothing to ask has no question to answer.
    const waiting = retryQuestionPending(table);
    if (("answer" in step && waiting === undefined) || ("press" in step && waiting !== undefined)) {
      const reason = "answer" in step ? "noQuestionWaiting" : "questionWaiting";
      outcomes.push({ step: index + 1, skipped: reason });
      await evidence(`${prefix}-skipped`, { reason });
      continue;
    }
    const request = "answer" in step
      ? { code: source.code, submissionId: crypto.randomUUID(), pendingInputId: String(waiting!.pendingInputId), text,
        ...(typeof step.answer === "string" ? {} : { answer: { decline: true } }) }
      : { code: source.code, submissionId: crypto.randomUUID(), text };
    await evidence(`${prefix}-request`, { command: "sendAction", data: request });
    const beforeDenial = await snapshot(), denialUsage = await bridge("/status");
    const denied = await historyHttpPost("sendAction", request);
    await evidence(`${prefix}-denials`, { anonymous: { status: denied.response.status, body: denied.body } });
    expect(denied.response.status).toBe(401);
    expect(await snapshot()).toEqual(beforeDenial);
    expect((await bridge("/status")).calls).toEqual(denialUsage.calls);

    const results: unknown[] = [], rollRetries: unknown[] = [];
    let command = "sendAction", data: HttpRecord = request;
    let completed: Awaited<ReturnType<typeof historyHttpPost>>;
    let afterAction = beforeDenial;
    // At most three real player confirmations; never answer an ambiguous
    // intention, reaction, or another character's pending decision by guessing.
    for (let rolls = 0; ; rolls++) {
      completed = await historyHttpPost(command, data, source.owner);
      table = (await historyHttpPost("fetchTable", source.code, source.owner)).body;
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
      expect(roll.userId).toBe(source.owner.userId);
      const next = { code: source.code, rollId: String(roll.id), submissionId: crypto.randomUUID() };
      const usage = await bridge("/status");
      const forged = await historyHttpPost("resolveRoll", { ...next, boostIds: ["forged-client-bonus"] }, source.owner);
      expect(forged.body.ok).toBe(false);
      expect(await snapshot()).toEqual(afterCommand);
      expect((await bridge("/status")).calls).toEqual(usage.calls);
      // Check the pending command retry before taking the next player step.
      const retry = await historyHttpPost(command, data, source.owner);
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
      expect(completed!.body.narration, JSON.stringify(completed!.body)).toBe("published");
    }
    expect(httpRecord(table.state).pendingRolls).toEqual([]);
    const messages = table.messages as HttpRecord[];
    const oldIds = new Set((options.initialTable.messages as HttpRecord[]).map(row => row.id));
    if (asked === undefined) expect(messages.some(row => row.kind === "narrate" && !oldIds.has(row.id)
      && typeof row.body === "string" && row.body.trim().length > 0), "new visible narration").toBe(true);
    const events = after.events.slice(initial.events.length);
    if (index === 0 && selected.actionAssertions) assertDailyActionAuthority({
      before: beforeDenial, after: afterAction, actor, contract: selected.actionAssertions,
    });
    if (index === 0 && !selected.actionAssertions && selected.witnessAssertions) assertDailyWitnessAuthority({
      before: beforeDenial, after: afterAction, actor, contract: selected.witnessAssertions,
    });
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
    const duplicate = await historyHttpPost(command, data, source.owner);
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
      stateSha: canonicalHash(after.state), events: events.map(row => row.eventType), retryExact: true,
      ...(covert === undefined ? {} : { concealment: { dc: covert.dc, ...(covert.concealment as HttpRecord) } }) });
    if (index < texts.length - 1) {
      const deliveryId = httpRecord(table.state).currentDeliveryId;
      if (typeof deliveryId === "string") {
        const ack = await historyHttpPost("acknowledgeDelivery", { code: source.code, deliveryId }, source.owner);
        expect(ack.body.ok).toBe(true);
      }
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
