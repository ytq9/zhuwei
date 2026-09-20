import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleViewerNarrationRecovery } from "../../../app/_runtime/lib/room/action";

import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../../../app/_runtime/lib/rules/profiles/manifests";

type JsonRecord = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:viewer-recovery:alice", sessionVersion: 1 }),
});
const BOB = Object.freeze({
  principal: Object.freeze({ id: "principal:viewer-recovery:bob", sessionVersion: 1 }),
});
const CAROL = Object.freeze({
  principal: Object.freeze({ id: "principal:viewer-recovery:carol", sessionVersion: 1 }),
});
const ALICE_ID = "character:viewer-recovery:alice";
const BOB_ID = "character:viewer-recovery:bob";
const BOB_SUCCESSOR_ID = "character:viewer-recovery:bob-successor";
type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  deliveryPublicationStatus(query: unknown): Promise<unknown>;
  beginDeliveryAudiencePublication(query: unknown): Promise<unknown>;
  failDeliveryAudiencePublication(capability: unknown, failure: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  beginViewerNarrationRecovery(context: unknown, capability: string): Promise<unknown>;
  publishViewerNarrationRecovery(
    context: unknown,
    capability: string,
    publication: unknown,
  ): Promise<unknown>;
  failViewerNarrationRecovery(
    context: unknown,
    capability: string,
    failure: unknown,
  ): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string): Promise<unknown>;
};

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function character(characterId: string, controllerPrincipalId: string, name: string) {
  return {
    characterId,
    controllerPrincipalId,
    staticCard: {
      name,
      sceneId: "yard",
      classId: "fighter",
      raceId: "human",
      level: 1,
      scores: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      proficiency: 2,
      skills: ["athletics"],
      hp: { current: 12, max: 12, temp: 0 },
      ac: 14,
      speed: 30,
      equipped: { armor: "leather", main: "shortsword" },
      backpack: [],
    },
  };
}

function audience(plan: JsonRecord, characterId: string) {
  const match = (plan.audiences as unknown[])
    .map((entry) => record(entry, "frozen audience"))
    .find((entry) => entry.characterId === characterId);
  expect(match, `audience for ${characterId}`).toBeDefined();
  return match!;
}

async function commitBobRetirement(authority: Authority, suffix: string) {
  const prepared = record(await authority.prepare(BOB, {
    kind: "intent",
    submissionId: `submission:viewer-recovery:retire:${suffix}`,
    text: `我决定在第 ${suffix} 幕结束冒险者生涯。`,
  }), "prepared retirement action");
  expect(prepared.kind).toBe("prepared");
  const rootActionId = String(prepared.rootActionId);
  const committed = record(await authority.commit(
    BOB,
    String(prepared.preparedActionId),
    {
      kind: "authenticatedCampaignAction",
      action: "retireCharacter",
      rootActionId,
      continueAsNpc: false,
      reason: "玩家明确选择结束当前角色任期并等待创建继任角色",
    },
  ), "committed retirement action");
  expect(committed.kind, JSON.stringify(committed)).toBe("committed");
  return record(committed.deliveryPlan, "retirement delivery plan");
}

async function failBobAudience(authority: Authority, plan: JsonRecord) {
  expect((plan.audiences as unknown[]).map((entry) =>
    record(entry, "retirement frozen audience").characterId)).toEqual([BOB_ID]);
  const bob = audience(plan, BOB_ID);
  const begun = record(await authority.beginDeliveryAudiencePublication({
    publishCapability: plan.publishCapability,
    audienceId: bob.audienceId,
  }), "Bob retirement publication begin");
  await expect(authority.failDeliveryAudiencePublication(
    { publishCapability: plan.publishCapability },
    {
      audienceId: bob.audienceId,
      deliveryGeneration: begun.deliveryGeneration,
      errorCode: "NARRATION_PROVIDER_TIMEOUT",
      state: "retryableFailure",
    },
  )).resolves.toMatchObject({ kind: "retryableFailure" });
}

function currentBody(observation: JsonRecord) {
  const delivery = record(observation.delivery, "current delivery");
  expect(delivery.kind).toBe("current");
  return String(record(delivery.frame, "current frame").text);
}

describe("V3 viewer-local narration recovery", () => {
  it("lets the exact former-character ViewerKey recover a failed retirement narration", async () => {
    const roomId = "viewer-narration-recovery-v3-former-character";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    await expect(authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
        { principalId: CAROL.principal.id, role: "observer" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
    })).resolves.toMatchObject({ created: true });

    const plan = await commitBobRetirement(authority, "former");
    expect(audience(plan, BOB_ID)).toMatchObject({
      principalId: BOB.principal.id,
      seatId: `seat:${BOB.principal.id}`,
      characterId: BOB_ID,
    });
    await failBobAudience(authority, plan);
    await evictDurableObject(authority as never);

    const observation = record(await authority.observe(BOB), "former-character observation");
    expect(record(observation.readModel, "former-character read model")).toMatchObject({
      controlledCharacter: null,
      lifecycle: {
        kind: "successorRequired",
        defaultPredecessorCharacterId: BOB_ID,
      },
    });
    const recovery = record(observation.narrationRecovery, "former-character recovery");
    expect(recovery).toMatchObject({
      kind: "available",
      state: "retryableFailure",
    });
    const capability = String(recovery.capability);
    await expect(authority.beginViewerNarrationRecovery(CAROL, capability))
      .resolves.toMatchObject({ kind: "rejected", code: "narrationRecoveryUnavailable" });
    await expect(authority.beginViewerNarrationRecovery({
      principal: { id: BOB.principal.id, sessionVersion: 2 },
    }, capability)).resolves.toMatchObject({
      kind: "rejected",
      code: "narrationRecoveryUnavailable",
    });

    let proposalCalls = 0;
    const failedRecovery = await handleViewerNarrationRecovery({
      principal: BOB,
      authority,
      kp: {
        async propose() {
          proposalCalls += 1;
          throw new Error("former-character recovery must not propose mechanics");
        },
        async narrate(request) {
          expect(record(
            record(request.projection, "former recovery projection").actorAction,
            "former recovery actor action",
          )).toMatchObject({
            kind: "actorDisplay",
            actorCharacterId: BOB_ID,
            displayBody: "我决定在第 former 幕结束冒险者生涯。",
          });
          throw Object.assign(new Error("narration provider timed out"), {
            publicCode: "NARRATION_PROVIDER_TIMEOUT",
          });
        },
      },
    }, capability);
    expect(failedRecovery).toMatchObject({
      action: "committed",
      narration: "retryableFailure",
    });
    expect(record(
      record(await authority.observe(BOB), "former recovery retry observation")
        .narrationRecovery,
      "former recovery retry",
    )).toMatchObject({ capability, state: "retryableFailure" });

    const recovered = await handleViewerNarrationRecovery({
      principal: BOB,
      authority,
      kp: {
        async propose() {
          proposalCalls += 1;
          throw new Error("former-character recovery must not propose mechanics");
        },
        async narrate() {
          return { body: "博林收起行囊，正式结束了自己的冒险者生涯。" };
        },
      },
    }, capability);
    expect(recovered).toMatchObject({
      action: "committed",
      narration: "published",
    });
    expect(proposalCalls).toBe(0);
    const recoveredObservation = record(
      await authority.observe(BOB),
      "recovered former-character observation",
    );
    expect(currentBody(recoveredObservation))
      .toBe("博林收起行囊，正式结束了自己的冒险者生涯。");
    expect(recoveredObservation).not.toHaveProperty("narrationRecovery");
  });

  it("does not transfer a former-character recovery to a successor on the same seat", async () => {
    const roomId = "viewer-narration-recovery-v3-successor";
    const authority = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await authority.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      moduleVersion: "social-resolution-v1",
      runtimeProfiles: ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST,
      members: [
        { principalId: ALICE.principal.id, role: "host" },
        { principalId: BOB.principal.id, role: "player" },
      ],
      characters: [
        character(ALICE_ID, ALICE.principal.id, "阿莱莎"),
        character(BOB_ID, BOB.principal.id, "博林"),
      ],
    }), "successor room initialization");
    const administration = record(
      initialized.serviceCapabilities,
      "successor service capabilities",
    ).roomAdministration;
    const plan = await commitBobRetirement(authority, "successor");
    await failBobAudience(authority, plan);
    const before = record(await authority.observe(BOB), "former viewer before successor");
    const capability = String(record(
      before.narrationRecovery,
      "former recovery before successor",
    ).capability);
    const begun = record(
      await authority.beginViewerNarrationRecovery(BOB, capability),
      "former recovery begun before successor",
    );
    expect(begun.kind).toBe("pending");

    await expect(authority.applyRoomAdministration(administration, {
      commandId: "room-admin:viewer-recovery:introduce-successor",
      kind: "introduceSuccessor",
      principalId: BOB.principal.id,
      predecessorCharacterId: BOB_ID,
      character: character(BOB_SUCCESSOR_ID, BOB.principal.id, "博林的继任者"),
      worldEntry: "在博林退役后，以独立身份来到院子接过冒险席位。",
    })).resolves.toMatchObject({ kind: "committed" });

    const successorObservation = record(
      await authority.observe(BOB),
      "successor observation",
    );
    expect(record(successorObservation.readModel, "successor read model")).toMatchObject({
      controlledCharacter: { characterId: BOB_SUCCESSOR_ID },
    });
    expect(successorObservation).not.toHaveProperty("narrationRecovery");
    await expect(authority.beginViewerNarrationRecovery(BOB, capability))
      .resolves.toMatchObject({ kind: "rejected", code: "narrationRecoveryUnavailable" });
    await expect(authority.publishViewerNarrationRecovery(BOB, capability, {
      body: "继任者不得发布前任角色的冻结回复。",
      deliveryGeneration: begun.deliveryGeneration,
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "narrationRecoveryUnavailable",
    });
    await expect(authority.failViewerNarrationRecovery(BOB, capability, {
      deliveryGeneration: begun.deliveryGeneration,
      errorCode: "NARRATION_PROVIDER_TIMEOUT",
      state: "retryableFailure",
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "narrationRecoveryUnavailable",
    });
  });

});
