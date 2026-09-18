import type { PartyCommand } from "../../../app/_runtime/lib/room/party-action";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { compileKpFormDraft, lowerCausalActionProgram } from "../../../app/_runtime/lib/kp/causal-action-program";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({ principal: Object.freeze({ id: "principal:delivery:alice", sessionVersion: 1 }) });
const BOB = Object.freeze({ principal: Object.freeze({ id: "principal:delivery:bob", sessionVersion: 1 }) });
const CAROL = Object.freeze({ principal: Object.freeze({ id: "principal:delivery:carol", sessionVersion: 1 }) });
const DAVE = Object.freeze({ principal: Object.freeze({ id: "principal:delivery:dave", sessionVersion: 1 }) });

const SHARED_ARCHIVE_BASIS = "fact:delivery:shared-archive-context";

type DeliveryAuthority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  applyRoomAdministration(capability: unknown, command: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  beginDeliveryAudiencePublication(query: unknown): Promise<unknown>;
  publishDelivery(capability: unknown, publication: unknown): Promise<unknown>;
  observe(context: unknown, query?: unknown): Promise<unknown>;
  acknowledge(context: unknown, deliveryId: string, acknowledgementId?: string): Promise<unknown>;
};

function record(value: unknown, label: string): RecordValue {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as RecordValue;
}

function authority(name: string): DeliveryAuthority {
  return env.ROOMS.getByName(name) as unknown as DeliveryAuthority;
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

function privateFormProposal(
  rootActionId: string,
  formId: "clarification.v1" | "materialization.v1" | "observe.v1" | "ordinary-check.v1",
  draft: RecordValue,
) {
  const causalActionProgram = compileKpFormDraft(formId, draft);
  return {
    kind: "privateFormProposal",
    formId,
    draft: structuredClone(draft),
    causalActionProgram,
    loweredCausalProgram: lowerCausalActionProgram(causalActionProgram),
    semanticFreezeHash: causalActionProgram.semanticHash,
    repairUsed: false,
    proposalAttemptId: `${rootActionId}:proposal:1`,
    modelInvocationReceipt: { task: "proposal", result: "success" },
    rootActionId,
  };
}

async function initialized(name: string) {
  return (await initializedWithAdministration(name)).stub;
}

async function initializedWithAdministration(name: string) {
  const stub = authority(name);
  const result = record(await stub.initializeAuthoritative({
    roomId: name,
    moduleId: "black-oak-will",
    moduleVersion: "social-resolution-v1",
    members: [
      { principalId: ALICE.principal.id, role: "player" },
      { principalId: BOB.principal.id, role: "player" },
      { principalId: CAROL.principal.id, role: "player" },
      { principalId: DAVE.principal.id, role: "player" },
    ],
    characters: [
      character("character:delivery:alice", ALICE.principal.id, "wake"),
      character("character:delivery:bob", BOB.principal.id, "wake"),
      character("character:delivery:carol", CAROL.principal.id, "yard"),
      character("character:delivery:dave", DAVE.principal.id, "shrine"),
    ],
    fixtureFacts: [{
      factRef: SHARED_ARCHIVE_BASIS,
      kind: "establishedCommunicationChannel",
      participants: ["character:delivery:alice", "character:delivery:bob"],
    }],
  }), "delivery room initialization");
  expect(result).toMatchObject({ created: true });
  const capabilities = record(result.serviceCapabilities, "delivery room service capabilities");
  expect(capabilities.roomAdministration).toBeDefined();
  for (const principal of [ALICE, BOB, CAROL, DAVE]) {
    const opening = record(await stub.observe(principal), "opening delivery observation");
    const delivery = record(opening.delivery, "opening delivery");
    if (delivery.kind !== "current") continue;
    const deliveryId = String(record(delivery.frame, "opening delivery frame").deliveryId);
    await expect(stub.acknowledge(
      principal,
      deliveryId,
      `ack:opening:${principal.principal.id}`,
    )).resolves.toMatchObject({ kind: "acknowledged", deliveryId });
  }
  return { stub, administration: capabilities.roomAdministration };
}

async function commitPartyCommand(stub: DeliveryAuthority, submissionId: string, command: PartyCommand, displayText: string) {
  const prepared = record(await stub.prepare(ALICE, { kind: "party", submissionId, command, displayText }), "party preparation");
  expect(prepared).toMatchObject({ kind: "prepared", resolutionMode: "authorityDirect" });
  const committed = record(await stub.commit(ALICE, String(prepared.preparedActionId), {
    kind: "authenticatedPartyAction", rootActionId: prepared.rootActionId,
  }), "party commit");
  expect(committed.kind, JSON.stringify(committed)).toBe("committed");
  return { committed, plan: record(committed.deliveryPlan, "party delivery plan") };
}

function audiences(plan: RecordValue) {
  return plan.audiences as Array<RecordValue>;
}

describe("observer-specific single-slot delivery", () => {

  it("freezes movement deltas for departure and arrival observers but not a third scene", async () => {
    const stub = await initialized("observer-delivery-v2-movement-delta");
    const { plan } = await commitPartyCommand(
      stub,
      "submission:delivery:movement",
      {
        action: "moveIndividually",
        destinationSceneId: "yard",
        fictionTimeCostMicros: "60000000",
      },
      "我离开档案室，沿走廊走进院子。",
    );

    const byCharacter = Object.fromEntries(audiences(plan).map((entry) => [entry.characterId, entry]));
    expect(Object.keys(byCharacter).sort()).toEqual([
      "character:delivery:alice",
      "character:delivery:bob",
      "character:delivery:carol",
    ]);
    expect(byCharacter["character:delivery:bob"].kpProjection).toMatchObject({
      committedDelta: {
        changes: expect.arrayContaining([{
          kind: "characterDeparted",
          characterId: "character:delivery:alice",
          sceneId: "wake",
        }]),
      },
    });
    expect(byCharacter["character:delivery:carol"].kpProjection).toMatchObject({
      committedDelta: {
        changes: expect.arrayContaining([{
          kind: "characterArrived",
          characterId: "character:delivery:alice",
          sceneId: "yard",
        }]),
      },
    });
    expect(JSON.stringify(plan)).not.toContain("character:delivery:dave");
  });

});
