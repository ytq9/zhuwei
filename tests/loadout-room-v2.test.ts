import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:loadout-room:alice", sessionVersion: 1 }),
});
const MALLORY = Object.freeze({
  principal: Object.freeze({ id: "principal:loadout-room:mallory", sessionVersion: 1 }),
});

type JsonRecord = Record<string, unknown>;
type AuthorityStub = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
};

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function stub(name: string): AuthorityStub {
  return env.ROOMS.getByName(name) as unknown as AuthorityStub;
}

async function initialize(name: string) {
  const authority = stub(name);
  await expect(authority.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    members: [
      { principalId: ALICE.principal.id, role: "host" },
      { principalId: MALLORY.principal.id, role: "player" },
    ],
    characters: [{
      characterId: "character:loadout-room:alice",
      controllerPrincipalId: ALICE.principal.id,
      staticCard: {
        name: "爱丽丝",
        sceneId: "wake",
        classId: "fighter",
        level: 3,
        scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
        proficiency: 2,
        hp: { current: 24, max: 24, temp: 0 },
        ac: 17,
        speed: 30,
        equipped: { armor: "chain" },
        backpack: [
          { itemId: "explorer-pack", qty: 2 },
          { itemId: "shield", qty: 1 },
        ],
      },
    }],
  })).resolves.toMatchObject({ created: true });
  return authority;
}

function loadoutFromObservation(value: unknown) {
  const observation = record(value, "observation");
  const readModel = record(observation.readModel, "read model");
  const character = record(readModel.controlledCharacter, "controlled character");
  return record(character.loadout, "authoritative loadout");
}

function inventoryEntriesFromObservation(value: unknown): JsonRecord[] {
  const observation = record(value, "observation");
  const readModel = record(observation.readModel, "read model");
  const character = record(readModel.controlledCharacter, "controlled character");
  const inventory = record(character.inventory, "authoritative inventory");
  expect(Array.isArray(inventory.entries)).toBe(true);
  return inventory.entries as JsonRecord[];
}

function entryIdByName(entries: JsonRecord[], name: string): string {
  const entry = entries.find((candidate) => candidate.kind === "identified" && candidate.name === name);
  expect(entry, `inventory entry ${name}`).toBeDefined();
  return String(entry!.entryId);
}

function entryIdsByName(entries: JsonRecord[], name: string): string[] {
  return entries
    .filter((candidate) => candidate.kind === "identified" && candidate.name === name)
    .map((candidate) => String(candidate.entryId))
    .sort();
}

describe("Room Action semantic gear authority", () => {
  it("preserves nonstackable entries while wear/stow uses normal prepare, commit, Receipt, and idempotency", async () => {
    const authority = await initialize("loadout-room-v2-semantic");
    const initialObservation = await authority.observe(ALICE);
    const initialEntries = inventoryEntriesFromObservation(initialObservation);
    const armorEntryId = entryIdByName(initialEntries, "链甲");
    const shieldEntryId = entryIdByName(initialEntries, "盾牌");
    const packEntryIds = entryIdsByName(initialEntries, "探险者套装");
    expect(packEntryIds).toHaveLength(2);
    let proposed = 0;
    const context = {
      principal: ALICE,
      authority,
      kp: {
        propose: async () => {
          proposed += 1;
          throw new Error("semantic gear must not ask KP to reconstruct mechanics");
        },
        narrate: async () => ({ text: "你把盾牌稳稳架在副手。", agencyClaims: [] }),
      },
    };
    const action = {
      kind: "gear" as const,
      submissionId: "submission:loadout-room:wear-shield",
      action: "wear" as const,
      slot: "off" as const,
      itemId: shieldEntryId,
    };
    const first = await handleRoomAction(context, action);
    expect(first).toMatchObject({ kind: "committed", receipt: { status: "committed" } });
    expect(proposed).toBe(0);

    const firstReceipt = record(first.receipt, "first receipt");
    const duplicate = await handleRoomAction(context, structuredClone(action));
    expect(duplicate).toMatchObject({ kind: "committed" });
    expect(duplicate.receipt).toEqual(firstReceipt);

    const loadout = loadoutFromObservation(await stub("loadout-room-v2-semantic").observe(ALICE));
    expect(loadout).toEqual({
      armorClass: 19,
      speedFeet: 30,
      equipped: { armor: armorEntryId, off: shieldEntryId },
      backpack: packEntryIds.map((itemId) => ({ itemId, quantity: 1 })),
    });
  });

  it("rejects an unauthorized principal and a client-supplied loadout snapshot", async () => {
    const authority = await initialize("loadout-room-v2-trusted-input");
    const initialEntries = inventoryEntriesFromObservation(await authority.observe(ALICE));
    const armorEntryId = entryIdByName(initialEntries, "链甲");
    const shieldEntryId = entryIdByName(initialEntries, "盾牌");
    const packEntryIds = entryIdsByName(initialEntries, "探险者套装");
    expect(packEntryIds).toHaveLength(2);
    const kp = {
      propose: async () => {
        throw new Error("rejected gear inputs must never reach KP");
      },
      narrate: async () => ({ text: "不会送达。", agencyClaims: [] }),
    };

    await expect(handleRoomAction({ principal: MALLORY, authority, kp }, {
      kind: "gear",
      submissionId: "submission:loadout-room:mallory",
      action: "stow",
      slot: "armor",
    })).resolves.toMatchObject({ kind: "rejected", code: "notController" });

    await expect(handleRoomAction({ principal: ALICE, authority, kp }, {
      kind: "gear",
      submissionId: "submission:loadout-room:forged-snapshot",
      action: "wear",
      slot: "off",
      itemId: shieldEntryId,
      characterId: "character:loadout-room:mallory",
      loadout: {
        armorClass: 99,
        speedFeet: 999,
        equipped: { off: shieldEntryId },
        backpack: [{ itemId: packEntryIds[0], quantity: 999 }],
      },
    } as never)).resolves.toMatchObject({ kind: "rejected", code: "validation" });

    const loadout = loadoutFromObservation(await authority.observe(ALICE));
    expect(loadout).toEqual({
      armorClass: 17,
      speedFeet: 30,
      equipped: { armor: armorEntryId },
      backpack: [
        ...packEntryIds.map((itemId) => ({ itemId, quantity: 1 })),
        { itemId: shieldEntryId, quantity: 1 },
      ],
    });
  });
});
