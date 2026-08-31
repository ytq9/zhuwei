import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { privateFormProposal } from "./helpers/authoritative-proposal";

type R = Record<string, unknown>;
const ALICE = { principal: { id: "principal:hidden:alice", sessionVersion: 1 } };
const BOB = { principal: { id: "principal:hidden:bob", sessionVersion: 1 } };
function record(value: unknown): R { expect(value).toBeTypeOf("object"); return value as R; }

describe("HiddenReality Room randomness recovery and privacy", () => {
  it("reuses the frozen set and face after eviction while exposing only the selected reality", async () => {
    const roomId = "hidden-reality-room-recovery-v2";
    const stub = env.ROOMS.getByName(roomId) as unknown as {
      initializeAuthoritative(input: unknown): Promise<unknown>;
      prepare(context: unknown, input: unknown): Promise<unknown>;
      commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown>;
      observe(context: unknown, query?: unknown): Promise<unknown>;
      exportAuthoritativeArchive(capability: unknown): Promise<unknown>;
    };
    const initialized = record(await stub.initializeAuthoritative({
      roomId, moduleId: "black-oak-will",
      members: [{ principalId: ALICE.principal.id, role: "host" }, { principalId: BOB.principal.id, role: "player" }],
      characters: [{ characterId: "character:hidden:alice", controllerPrincipalId: ALICE.principal.id,
        staticCard: { name: "阿莱莎", sceneId: "wake", abilityScores: { str: 10, dex: 12, con: 12, int: 14, wis: 12, cha: 10 }, proficiencyBonus: 2 } }],
    }));
    const prepared = record(await stub.prepare(ALICE, { kind: "intent", submissionId: "submission:hidden:1",
      characterId: "character:hidden:alice", text: "我打开门，确认门后的真实情况。" }));
    const rootActionId = String(prepared.rootActionId);
    const proposal = privateFormProposal(rootActionId, "materialization.v1", {
      goal: "打开门并确认门后的现实",
      method: "materializeHiddenReality",
      proposedFact: JSON.stringify({
        schema: "zhuwei.hidden-reality-candidate-set-draft/v1",
        candidateSetId: "hidden-set:door:1",
        candidates: [
          { candidateId: "candidate:ash", hiddenWeight: 1, kind: "fact", factRef: "fact:hidden:ash-room",
            causalBasisRefs: [], visibilityPolicyRef: "visibility:scene-observers", definition: { name: "覆灰空室" } },
          { candidateId: "candidate:bell", hiddenWeight: 1, kind: "fact", factRef: "fact:hidden:bell-room",
            causalBasisRefs: [], visibilityPolicyRef: "visibility:scene-observers", definition: { name: "悬铃密室" } },
        ],
      }),
      basisRefs: ["wake"],
      resolution: "direct",
      durationUnit: "second",
      durationValue: 1,
    });
    await expect(runInDurableObject(stub as never, async (instance) => {
      const target = instance as unknown as { authorityRecoveryCheckpoint?: (name: string) => void;
        commit(context: unknown, preparedActionId: string, proposal: unknown): Promise<unknown> };
      target.authorityRecoveryCheckpoint = (name) => { if (name === "afterRandomnessCandidateCommit") throw new Error("hidden-crash"); };
      return target.commit(ALICE, String(prepared.preparedActionId), structuredClone(proposal));
    })).rejects.toThrow("hidden-crash");
    await evictDurableObject(stub as never);
    const recovered = record(await stub.commit(ALICE, String(prepared.preparedActionId), structuredClone(proposal)));
    expect(recovered.kind).toBe("committed");
    const repeated = record(await stub.commit(ALICE, String(prepared.preparedActionId), structuredClone(proposal)));
    expect(repeated.receipt).toEqual(recovered.receipt);

    const capabilities = record(initialized.serviceCapabilities);
    const exported = record(await stub.exportAuthoritativeArchive(capabilities.archiveExport));
    const archive = record(exported.archive);
    const events = (archive.events as R[]).filter((event) => event.rootActionId === rootActionId);
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "HiddenRealityCandidatesFrozen", "HiddenRealityMaterialized", "DefinitionRegistered",
    ]));
    expect(events.filter((event) => event.eventType === "HiddenRealityCandidatesFrozen")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "HiddenRealityMaterialized")).toHaveLength(1);
    expect(events.filter((event) => event.eventType === "DiceRolled")).toHaveLength(1);
    const commitment = record((record(recovered.receipt).randomnessCommitments as R[])[0]);
    expect(commitment.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record(repeated.receipt).randomnessCommitments).toEqual(record(recovered.receipt).randomnessCommitments);
    const selected = String(record(events.find((event) => event.eventType === "HiddenRealityMaterialized")!.payload).factRef);
    const unselected = selected.endsWith("ash-room") ? "fact:hidden:bell-room" : "fact:hidden:ash-room";
    const channelObservations = await Promise.all(["realtime", "reconnect", "history", "error", "candidates"].flatMap(
      (channel) => [stub.observe(ALICE, { channel, referenceId: unselected }), stub.observe(BOB, { channel, referenceId: unselected })],
    ));
    const playerSurface = JSON.stringify({ recovered, channelObservations });
    expect(playerSurface).toContain(selected);
    expect(playerSurface).not.toContain(unselected);
    expect(JSON.stringify(recovered.deliveryPlan ?? null)).not.toContain(unselected);
  });
});
