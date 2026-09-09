import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative";
import { uniqueItemEntryRef } from "../app/_runtime/lib/rules/v2/item-authority-vnext";

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:opening:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:opening:bob", sessionVersion: 1 }),
});
const CAROL = Object.freeze({
  principal: Object.freeze({ id: "principal:opening:carol", sessionVersion: 1 }),
});

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, action: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string, acknowledgementId?: string): Promise<unknown>;
};

function record(value: unknown, label: string): Record<string, unknown> {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as Record<string, unknown>;
}

function character(characterId: string, controllerPrincipalId: string, sceneId: string, proficientSkills: string[] = []) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name: characterId,
      sceneId,
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills,
    },
  };
}

describe("authoritative room opening delivery", () => {
  it.each(["ROOMS", "VNEXT_ROOMS"] as const)("%s persists opening knowledge only for characters who experienced it", async (binding) => {
    const roomName = `authoritative-opening-${binding}-current-slot`;
    const durableStub = env[binding].getByName(roomName);
    const stub = durableStub as unknown as Authority;
    await expect(stub.initializeAuthoritative({
      roomId: roomName,
      moduleId: "black-oak-will",
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
        { principalId: CAROL.principal.id, role: "player" },
      ],
      characters: [
        character("character:opening:alice", ALICE.principal.id, "wake"),
        character("character:opening:bob", BOB.principal.id, "wake"),
        character("character:opening:carol", CAROL.principal.id, "cellar"),
      ],
    })).resolves.toMatchObject({ created: true });

    const moduleProfile = await authoritativeModuleProfile("black-oak-will");
    const opening = moduleProfile.storyBible.storyAnchors.locations
      .find((location) => location.sceneId === "wake")?.publicOpening;
    expect(opening).toEqual(expect.any(String));

    const alice = record(await stub.observe(ALICE, { channel: "realtime" }), "Alice observation");
    const bob = record(await stub.observe(BOB, { channel: "reconnect" }), "Bob observation");
    const carol = record(await stub.observe(CAROL, { channel: "history" }), "Carol observation");
    const aliceDelivery = record(alice.delivery, "Alice opening delivery");
    const aliceFrame = record(aliceDelivery.frame, "Alice opening frame");
    const bobDelivery = record(bob.delivery, "Bob opening delivery");
    const bobFrame = record(bobDelivery.frame, "Bob opening frame");

    expect(aliceDelivery.kind).toBe("current");
    expect(bobDelivery.kind).toBe("current");
    expect(aliceFrame.text).toBe(opening);
    expect(bobFrame.text).toBe(opening);
    expect(aliceFrame.deliveryId).not.toBe(bobFrame.deliveryId);
    expect(carol.delivery).toEqual({ kind: "none" });
    const knowledge = (observation: Record<string, unknown>) =>
      record(observation.readModel, "read model").knowledge as Array<Record<string, unknown>>;
    const aliceKnowledge = knowledge(alice);
    const bobKnowledge = knowledge(bob);
    const openingKnowledge = (records: Array<Record<string, unknown>>) => records.filter(entry =>
      typeof entry.content === "object" && entry.content !== null
      && (entry.content as Record<string, unknown>).schema === "zhuwei.module-opening-knowledge/v1");
    expect(openingKnowledge(aliceKnowledge)).toEqual([expect.objectContaining({
      objectKind: "sensoryEvidence", layer: "full", visibility: "private",
      content: expect.objectContaining({ description: opening, sceneId: "wake", moduleRef: moduleProfile.moduleRef }),
    })]);
    expect(openingKnowledge(bobKnowledge)).toEqual([expect.objectContaining({ content: openingKnowledge(aliceKnowledge)[0].content })]);
    expect(aliceKnowledge).toHaveLength(3);
    expect(aliceKnowledge).toContainEqual(expect.objectContaining({
      objectKind: "sourceClaim", content: expect.stringContaining("奈斯的血亲身份只是他的自称"),
    }));
    expect(knowledge(carol)).toEqual([]);
    for (const observation of [alice, bob, carol]) {
      expect(JSON.stringify(knowledge(observation))).not.toContain(moduleProfile.storyBible.coreTruth);
    }

    for (const observation of [alice, bob, carol]) {
      expect(JSON.stringify(observation)).not.toMatch(
        /narrationHistory|messageHistory|deliveryHistory|voiceHistory|transcriptHistory/,
      );
    }

    const deliveryId = String(aliceFrame.deliveryId);
    await expect(stub.acknowledge(ALICE, deliveryId, "ack:opening:alice"))
      .resolves.toMatchObject({ kind: "acknowledged", deliveryId });
    const afterAck = record(
      await stub.observe(ALICE, { channel: "history", referenceId: deliveryId }),
      "Alice after opening ACK",
    );
    expect(afterAck.delivery).toEqual({ kind: "none" });
    expect(knowledge(afterAck)).toEqual(aliceKnowledge);
    await evictDurableObject(durableStub);
    expect(knowledge(record(await stub.observe(ALICE), "Alice restored"))).toEqual(aliceKnowledge);
    expect(knowledge(record(await stub.observe(CAROL), "Carol restored"))).toEqual([]);
    expect(afterAck.transcript).toEqual([
      expect.objectContaining({
        messageId: deliveryId,
        kind: "kp",
        body: opening,
        sceneIds: ["wake"],
      }),
    ]);

    const bobDeliveryId = String(bobFrame.deliveryId);
    await expect(stub.acknowledge(BOB, bobDeliveryId, "ack:opening:bob"))
      .resolves.toMatchObject({ kind: "acknowledged", deliveryId: bobDeliveryId });
    const bobAfterAck = record(await stub.observe(BOB), "Bob after opening ACK");
    expect(bobAfterAck.transcript).toEqual([
      expect.objectContaining({
        messageId: bobDeliveryId,
        kind: "kp",
        body: opening,
        sceneIds: ["wake"],
      }),
    ]);
    expect(carol.transcript).toEqual([]);
  });

  it("normal vNext genesis persists prepared inventory and private role knowledge without reseeding after eviction", async () => {
    const roomName = "authoritative-prepared-opening";
    const durableStub = env.VNEXT_ROOMS.getByName(roomName);
    const stub = durableStub as unknown as Authority;
    const alice = character("character:opening:alice", ALICE.principal.id, "wake", ["religion"]);
    const input = { roomId: roomName, moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }, { principalId: BOB.principal.id, role: "player" },
        { principalId: CAROL.principal.id, role: "player" }],
      characters: [alice, character("character:opening:bob", BOB.principal.id, "wake"),
        character("character:opening:carol", CAROL.principal.id, "shrine")] };
    await expect(stub.initializeAuthoritative(input)).resolves.toMatchObject({ created: true });
    const snapshot = () => runInDurableObject(durableStub, instance => {
      const target = instance as unknown as { authoritativeReplay(): { genesis: unknown; state: unknown } };
      const { genesis, state } = target.authoritativeReplay();
      return structuredClone({ genesis, state });
    });
    const before = await snapshot();
    const state = record(before.state, "prepared state");
    const itemSystem = record(record(state.campaignRuntime, "campaign").itemSystem, "items");
    expect(Object.keys(record(itemSystem.definitions, "definitions"))).toHaveLength(10);
    expect(Object.keys(record(itemSystem.entries, "entries"))).toHaveLength(7);
    expect(record(itemSystem.entries, "entries")[uniqueItemEntryRef("fact:module:black-oak-will:copper-key")])
      .toMatchObject({ holderRef: "npc:black-oak-will:lian", quantity: 1 });
    expect(record(itemSystem.entries, "entries")[uniqueItemEntryRef("fact:module:black-oak-will:third-will")])
      .toMatchObject({ sceneRef: "shrine", disposition: "scene", quantity: 1 });
    expect(record(before.genesis, "genesis").initialDefinitionCatalogRef)
      .toMatchObject({ profileId: "definition-catalog:black-oak-will:opening-v1" });
    const aliceView = record(await stub.observe(ALICE), "Alice view");
    const bobView = record(await stub.observe(BOB), "Bob view");
    expect(JSON.stringify(record(aliceView.readModel, "Alice model").knowledge)).toContain("宗教知识");
    expect(JSON.stringify(record(bobView.readModel, "Bob model").knowledge)).not.toContain("宗教知识");
    for (const view of [aliceView, bobView]) {
      expect(JSON.stringify(view)).not.toMatch(/真印被我偷用|我后加了原件|第三份遗嘱，唯一原件/);
    }
    const prepared = record(await stub.prepare(CAROL, {
      kind: "intent", submissionId: "opening:inspect-journal", text: "我查看神龛旁的木盒，打开看看里面的纸页。",
    }), "discovery preparation");
    expect(prepared.kind).toBe("prepared");
    const context = record(prepared.requiredContext, "discovery context");
    expect(context.entries).toContainEqual(expect.objectContaining({
      kind: "known", entryRef: "fact:module:black-oak-will:journal-page",
    }));
    expect(context.entries).toContainEqual(expect.objectContaining({
      kind: "known", entryRef: "item-definition:module:black-oak-will:journal-page",
    }));
    await evictDurableObject(durableStub);
    await expect(stub.initializeAuthoritative(input)).resolves.toMatchObject({ created: false });
    expect(await snapshot()).toEqual(before);
  });
});
