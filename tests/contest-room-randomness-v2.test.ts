import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { privateFormProposal } from "./helpers/authoritative-proposal";

type RecordValue = Record<string, unknown>;

const ALICE = Object.freeze({
  principal: Object.freeze({ id: "principal:contest-room:alice", sessionVersion: 1 }),
});

type Authority = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(context: unknown, input: unknown): Promise<unknown>;
  commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
  exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
};

function record(value: unknown, label: string): RecordValue {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as RecordValue;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

describe("Room DO authoritative contest randomness", () => {
  it("draws both contest dice in the DO, commits one result, and replays an idempotent receipt", async () => {
    const roomId = "contest-room-randomness-v2";
    const stub = env.ROOMS.getByName(roomId) as unknown as Authority;
    const initialized = record(await stub.initializeAuthoritative({
      roomId,
      moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }],
      characters: [{
        characterId: "character:contest-room:alice",
        controllerPrincipalId: ALICE.principal.id,
        staticCard: {
          name: "阿莱莎",
          sceneId: "yard",
          scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
          proficiency: 2,
          skills: ["athletics"],
          hp: { current: 20, max: 20, temp: 0 },
          ac: 15,
          speed: 30,
          resources: {},
          equipped: {},
          backpack: [],
        },
      }],
      fixtureFacts: [{
        knowledgeRef: "knowledge:warden-keeps-the-gate",
        holderEntityId: "npc:gate-warden",
        holderName: "守门人",
        sceneId: "yard",
        content: { privateGoal: "守住庭院大门" },
      }],
    }), "contest room initialization");
    const archiveCapability = record(initialized.serviceCapabilities, "service capabilities").archiveExport;
    const prepared = record(await stub.prepare(ALICE, {
      kind: "intent",
      submissionId: "submission:contest-room:arm-wrestle",
      characterId: "character:contest-room:alice",
      text: "我向守门人提出掰手腕，想公平较量力气。",
    }), "contest prepare");
    const proposal = privateFormProposal(String(prepared.rootActionId), "materialization.v1", {
      goal: "与守门人公平掰手腕",
      method: "resolveNoncombatContest",
      proposedFact: JSON.stringify({
        schema: "zhuwei.noncombat-contest-draft/v1",
        defenderRef: "npc:gate-warden",
        initiatorAbility: "str",
        initiatorSkill: "athletics",
        defenderAbility: "str",
        defenderSkill: "athletics",
        mode: "normal",
        tieResult: "statusQuo",
      }),
      basisRefs: ["yard", "npc:gate-warden"],
      resolution: "direct",
      durationUnit: "minute",
      durationValue: 1,
    });

    const committed = record(await stub.commit(
      ALICE,
      String(prepared.preparedActionId),
      proposal,
    ), "contest commit");
    expect(committed.kind).toBe("committed");
    const receipt = record(committed.receipt, "contest receipt");
    expect(list(receipt.randomnessCommitments, "contest commitments")).toHaveLength(2);
    const mechanics = record(record(committed.kpProjection, "KP projection").mechanicalResult, "mechanics");
    expect(list(mechanics.randomness, "contest dice")).toHaveLength(2);
    const resolution = record(mechanics.resolution, "contest resolution");
    expect(resolution.kind).toBe("contest");
    expect(new Set([resolution.initiatorId, resolution.defenderId])).toEqual(new Set([
      "character:contest-room:alice",
      "npc:gate-warden",
    ]));

    const retried = record(await stub.commit(
      ALICE,
      String(prepared.preparedActionId),
      structuredClone(proposal),
    ), "response-loss retry");
    expect(retried.receipt).toEqual(receipt);
    expect(record(retried.kpProjection, "retry projection").mechanicalResult).toEqual(mechanics);

    const exported = record(await stub.exportAuthoritativeArchive(archiveCapability), "archive export");
    const archive = record(exported.archive, "archive");
    const eventTypes = list(archive.events, "archive events")
      .map((event) => String(record(event, "event").eventType));
    expect(eventTypes.filter((kind) => kind === "RandomnessRequested")).toHaveLength(2);
    expect(eventTypes.filter((kind) => kind === "DiceRolled")).toHaveLength(2);
    expect(eventTypes.filter((kind) => kind === "ContestResolved")).toHaveLength(1);
  });
});
