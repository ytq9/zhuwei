import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { RULESET_VERSION } from "../app/_runtime/lib/rules/ruleset";

function player(id: string, sceneId = "shrine") {
  return {
    id,
    kind: "player" as const,
    name: id,
    sceneId,
    abilityScores: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    proficientSkills: ["athletics", "sleight"],
    expertiseSkills: [],
    capabilities: [],
    resources: {},
  };
}

async function room(name: string, players = [player("a")]) {
  const stub = env.ROOMS.getByName(name);
  await stub.initialize({
    roomId: name,
    moduleId: "black-oak-will",
    rulesetVersion: RULESET_VERSION,
    players,
  });
  return stub;
}

describe("RoomDurableObject", () => {
  it("fills authoritative spell dice inside the DO before deterministic step adjudication", async () => {
    const mage = {
      ...player("a"),
      abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
      spellLevels: { "magic-missile": 1 },
      spellActionCosts: { "magic-missile": "action" as const },
      spellcasting: {
        "magic-missile": {
          ability: "int" as const,
          castingModifier: 3,
          attackBonus: 5,
          saveDc: 13,
        },
      },
      hp: { current: 20, max: 20 },
      resources: { slot1: 1 },
      resourceRules: { slot1: { max: 1, recovery: "long" as const } },
    };
    const foe = {
      ...player("foe"),
      kind: "npc" as const,
      ac: 1,
      hp: { current: 20, max: 20 },
    };
    const stub = await room("spell-roll-room", [mage, foe]);
    const ticket = await stub.prepareTurn({ actorId: "a" });
    const result = await stub.commitTurn({
      ticketId: ticket.id,
      command: {
        id: "authoritative-magic-missile",
        actorId: "a",
        expectedVersion: ticket.stateVersion,
        kind: "castSpell",
        spellId: "magic-missile",
        targetIds: ["foe"],
      },
    });
    expect(result.decision.kind).toBe("committed");
    expect(result.decision.kind === "committed" && result.decision.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "SpellAttackResolved", spellId: "magic-missile", hit: true }),
        expect.objectContaining({ type: "EntityDamaged", entityId: "foe" }),
      ]),
    );
  });

  it("persists a ticketed command and returns the same result for an idempotent retry", async () => {
    const stub = await room("idempotent-room");
    const now = Date.now();
    const ticket = await stub.prepareTurn({ actorId: "a", nowMs: now });
    const input = {
      ticketId: ticket.id,
      nowMs: now + 100,
      command: {
        id: "take-will",
        actorId: "a",
        expectedVersion: ticket.stateVersion,
        kind: "interact" as const,
        interactionId: "retrieve-third-will",
      },
    };
    const first = await stub.commitTurn(input);
    expect(first.decision.kind).toBe("awaitingRoll");
    expect(first.idempotent).toBe(false);
    const retry = await stub.commitTurn(input);
    expect(retry).toEqual({ ...first, idempotent: true });
    const events = await stub.getEvents();
    expect(events.map((entry) => entry.type)).toEqual(["RollRequested", "CommandRecorded"]);
  });

  it("rejects the second concurrent ticket touching the same unique artifact", async () => {
    const stub = await room("artifact-conflict-room", [player("a"), player("b")]);
    const now = Date.now();
    const firstTicket = await stub.prepareTurn({ actorId: "a", nowMs: now });
    const secondTicket = await stub.prepareTurn({ actorId: "b", nowMs: now + 1 });
    const first = await stub.commitTurn({
      ticketId: firstTicket.id,
      nowMs: now + 100,
      command: {
        id: "a-takes-will",
        actorId: "a",
        expectedVersion: firstTicket.stateVersion,
        kind: "interact",
        interactionId: "retrieve-third-will",
      },
    });
    expect(first.decision.kind).toBe("awaitingRoll");
    const second = await stub.commitTurn({
      ticketId: secondTicket.id,
      nowMs: now + 101,
      command: {
        id: "b-takes-will",
        actorId: "b",
        expectedVersion: secondTicket.stateVersion,
        kind: "interact",
        interactionId: "retrieve-third-will",
      },
    });
    expect(second.decision.kind).toBe("rejected");
    expect(second.conflictedScope).toBe("artifact:artifact-third-will");
  });

  it("allows unrelated locations to commit from tickets prepared at the same state version", async () => {
    const stub = await room("parallel-location-room", [player("a", "shrine"), player("b", "yard")]);
    const now = Date.now();
    const aTicket = await stub.prepareTurn({ actorId: "a", nowMs: now });
    const bTicket = await stub.prepareTurn({ actorId: "b", nowMs: now + 1 });
    const a = await stub.commitTurn({
      ticketId: aTicket.id,
      nowMs: now + 10,
      command: {
        id: "a-moves-seat",
        actorId: "a",
        expectedVersion: aTicket.stateVersion,
        kind: "interact",
        interactionId: "move-stone-seat",
      },
    });
    expect(a.decision.kind).toBe("awaitingRoll");
    const b = await stub.commitTurn({
      ticketId: bTicket.id,
      nowMs: now + 11,
      command: {
        id: "b-breaks-door",
        actorId: "b",
        expectedVersion: bTicket.stateVersion,
        kind: "interact",
        interactionId: "force-cellar-door",
      },
    });
    expect(b.decision.kind).toBe("awaitingRoll");
    expect(b.conflictedScope).toBeUndefined();
  });

  it("clears the soft UX lease when interpretation fails and never commits a world event", async () => {
    const stub = await room("failed-ai-room");
    const now = Date.now();
    const ticket = await stub.prepareTurn({ actorId: "a", nowMs: now });
    expect((await stub.getSnapshot("a", now + 1)).ux[0]?.phase).toBe("interpreting");
    await stub.markInterpretationFailed(ticket.id);
    expect((await stub.getSnapshot("a", now + 2)).ux).toEqual([]);
    expect(await stub.getEvents()).toEqual([]);
  });

  it("rejects an expired ticket without changing state", async () => {
    const stub = await room("expired-ticket-room");
    const ticket = await stub.prepareTurn({ actorId: "a", nowMs: Date.now() });
    const result = await stub.commitTurn({
      ticketId: ticket.id,
      nowMs: ticket.expiresAt + 1,
      command: {
        id: "too-late",
        actorId: "a",
        expectedVersion: ticket.stateVersion,
        kind: "interact",
        interactionId: "retrieve-third-will",
      },
    });
    expect(result.decision.kind).toBe("rejected");
    expect(result.stateVersion).toBe(0);
    expect(await stub.getEvents()).toEqual([]);
  });

  it("never advances Fiction Time merely because real time passes", async () => {
    const stub = await room("offline-time-room");
    const now = Date.now();
    const first = await stub.getSnapshot("a", now);
    const later = await stub.getSnapshot("a", now + 7 * 24 * 60 * 60 * 1000);
    expect(later.projection.viewer.timeline).toEqual(first.projection.viewer.timeline);
    expect(later.projection.version).toBe(first.projection.version);
  });

  it("records loadout changes and consumes the free object interaction in combat", async () => {
    const stub = await room("loadout-room", [player("a"), { ...player("foe"), kind: "npc" as const }]);
    await stub.synchronizePlayerLoadout({
      playerId: "a",
      ac: 17,
      capabilities: ["equipment:shield"],
      attacks: [{
        id: "new-weapon",
        name: "战锤",
        attackBonus: 4,
        kind: "melee" as const,
        reachFeet: 5,
        damage: { count: 1, sides: 8, bonus: 2, damageType: "bludgeoning" },
      }],
    });
    let snapshot = await stub.getSnapshot("a");
    expect(snapshot.projection.viewer.ac).toBe(17);
    expect(snapshot.projection.viewer.attacks[0]?.id).toBe("new-weapon");
    const ticket = await stub.prepareTurn({ actorId: "a" });
    const started = await stub.commitTurn({
      ticketId: ticket.id,
      command: {
        id: "start-loadout-combat",
        actorId: "a",
        expectedVersion: ticket.stateVersion,
        kind: "startCombat",
        targetIds: ["foe"],
        initiativeRolls: { a: 18, foe: 8 },
      },
    });
    expect(started.decision.kind).toBe("committed");
    await stub.synchronizePlayerLoadout({
      playerId: "a",
      ac: 16,
      capabilities: [],
      attacks: snapshot.projection.viewer.attacks,
    });
    snapshot = await stub.getSnapshot("a");
    const combatant = snapshot.projection.combat?.order.find((entry) => entry.entityId === "a");
    expect(combatant?.economy.objectInteraction).toBe(false);
    const rejected = await stub.synchronizePlayerLoadout({
      playerId: "a",
      ac: 15,
      capabilities: [],
      attacks: snapshot.projection.viewer.attacks,
    });
    expect(rejected).toMatchObject({ ok: false, error: expect.stringMatching(/物件互动/) });
  });

  it("makes a departed player inactive and re-seats them without losing their timeline", async () => {
    const stub = await room("reseat-room");
    const before = await stub.getSnapshot("a");
    const departed = await stub.departPlayer("a");
    expect(departed.changed).toBe(true);
    expect((await stub.getEvents()).at(-1)?.type).toBe("EntityDeparted");
    const rejoined = await stub.upsertPlayer({ player: player("a") });
    expect(rejoined.rejoined).toBe(true);
    const after = await stub.getSnapshot("a");
    expect(after.projection.viewer.timeline.fictionSeconds).toBeGreaterThanOrEqual(
      before.projection.viewer.timeline.fictionSeconds,
    );
    await expect(stub.prepareTurn({ actorId: "a" })).resolves.toMatchObject({ actorId: "a" });
  });
});
