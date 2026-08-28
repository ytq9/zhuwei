import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative";

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
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string, acknowledgementId?: string): Promise<unknown>;
};

function record(value: unknown, label: string): Record<string, unknown> {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as Record<string, unknown>;
}

function character(characterId: string, controllerPrincipalId: string, sceneId: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name: characterId,
      sceneId,
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      proficientSkills: [],
    },
  };
}

describe("authoritative room opening delivery", () => {
  it("publishes and retains the pinned opening only for characters who experienced it", async () => {
    const roomName = "authoritative-opening-v2-current-slot";
    const stub = env.ROOMS.getByName(roomName) as unknown as Authority;
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
});
