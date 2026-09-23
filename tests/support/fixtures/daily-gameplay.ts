import { expect } from "vitest";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json";
import { historyHttpDraft, historyHttpPost, httpRecord } from "./story-history-http";
import type { historyHttpAuthority, historyHttpSource, HttpRecord } from "./story-history-http";

export const dailyClericDraft = { ...historyHttpDraft, classId: "cleric", subclassId: "life", backgroundId: "acolyte",
  scores: { str: 12, dex: 10, con: 13, int: 8, wis: 15, cha: 14 },
  cantrips: ["sacred-flame"], prepared: ["cure"], spellbook: [] };
type Snapshot = NonNullable<Awaited<ReturnType<typeof historyHttpAuthority>>>;
type Selection = { caseId: string; dailyGroup: string; text: string; nextText?: string; initialFixture?: string;
  listenerForbidden?: readonly string[]; listenerRequired?: readonly string[] };

/** Real player commands only. Fixture data is established before genesis;
 * no model outcome, Rules result, die, or publication is fabricated here. */
export async function acceptDailyGameplay<S extends Snapshot>(options: {
  selected: Selection; source: Awaited<ReturnType<typeof historyHttpSource>>; initial: S;
  initialTable: HttpRecord; snapshot: () => Promise<S>; assertReplay: (snapshot: S) => Promise<void>;
  bridge: (path: string, value?: unknown) => Promise<HttpRecord>;
  evidence: (name: string, value: unknown) => Promise<unknown>;
}) {
  const { selected, source, initial, snapshot, assertReplay, bridge, evidence } = options;
  const actor = source.characters[0].characterId;
  const peer = source.characters[1]?.characterId;
  const texts = [selected.text, ...(selected.nextText ? [selected.nextText] : [])];
  const outcomes: unknown[] = [];
  let table = options.initialTable;
  for (const [index, text] of texts.entries()) {
    const prefix = `daily-step-${index + 1}`;
    const request = { code: source.code, submissionId: crypto.randomUUID(), text };
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
    // At most three real player confirmations; never answer an ambiguous
    // intention, reaction, or another character's pending decision by guessing.
    for (let rolls = 0; ; rolls++) {
      completed = await historyHttpPost(command, data, source.owner);
      table = (await historyHttpPost("fetchTable", source.code, source.owner)).body;
      const afterCommand = await snapshot();
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
    const after = await snapshot();
    await evidence(`${prefix}-result`, results);
    await evidence(`${prefix}-table`, table);
    await evidence(`${prefix}-authority`, after);
    expect(completed!.response.status).toBe(200);
    expect(completed!.body.action, JSON.stringify(completed!.body)).toBe("committed");
    expect(completed!.body.narration, JSON.stringify(completed!.body)).toBe("published");
    expect(httpRecord(table.state).pendingRolls).toEqual([]);
    const messages = table.messages as HttpRecord[];
    const oldIds = new Set((options.initialTable.messages as HttpRecord[]).map(row => row.id));
    expect(messages.some(row => row.kind === "narrate" && !oldIds.has(row.id)
      && typeof row.body === "string" && row.body.trim().length > 0), "new visible narration").toBe(true);
    const events = after.events.slice(initial.events.length);
    if (selected.dailyGroup === "listener") {
      const heard = JSON.stringify(after.state.knowledge["npc:black-oak-will:lian"]);
      for (const words of selected.listenerForbidden ?? []) expect(heard, `Lian must not hold "${words}"`).not.toContain(words);
      for (const words of selected.listenerRequired ?? []) expect(heard, `Lian holds "${words}"`).toContain(words);
    } else if (selected.dailyGroup === "witness") {
      // SPEC 0006 §4: the NPC present when the actor acts holds its own record.
      const lian = "npc:black-oak-will:lian";
      if (index === 0) expect(after.state.knowledge[lian], "Lian holds what she saw").not.toEqual(initial.state.knowledge[lian]);
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
    outcomes.push({ step: index + 1, command, action: completed!.body.action, narration: completed!.body.narration,
      stateSha: canonicalHash(after.state), events: events.map(row => row.eventType), retryExact: true });
    if (index < texts.length - 1) {
      const deliveryId = httpRecord(table.state).currentDeliveryId;
      if (typeof deliveryId === "string") {
        const ack = await historyHttpPost("acknowledgeDelivery", { code: source.code, deliveryId }, source.owner);
        expect(ack.body.ok).toBe(true);
      }
    }
  }
  await evidence("acceptance", { status: "passed", caseId: selected.caseId, group: selected.dailyGroup,
    initialFixture: selected.initialFixture ?? "Registered module and compiled initial character fixture.",
    outcomes, providerCalls: (await bridge("/status")).realProviderCalls,
    manualReviewRequired: "Passed means the recorded functional assertions passed. Separately inspect the saved prose for natural language, immersion and factual grounding.",
    notCovered: ["Browser interaction", "room creation and character wizard", "all spells or combat moves", "long-term narrative stability"] });
}
