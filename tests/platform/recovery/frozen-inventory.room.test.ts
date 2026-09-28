import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import fixtures from "../../support/fixtures/frozen-inventory-legacy-events.json";
import { canonicalSha256 } from "../../../app/_runtime/lib/rules/profiles/canonical";
import type { AuthoritativeWorldState, EventEnvelope, RuntimeGenesis } from "../../../app/_runtime/lib/rules";
import type { VersionedRulesRuntime } from "../../../app/_runtime/lib/rules/v2-runtime";
import type { AuthoritativeRoomStore, AuthorityProposalRecoveryRow } from "../../../app/_runtime/lib/room/authority-store";
import type { AuthorityCommitRecovery } from "../../../app/_runtime/lib/room/authority-commit-recovery";

type Principal = { principal: { id: string; sessionVersion: number } };
type Internals = {
  rulesRuntime: VersionedRulesRuntime;
  authorityStore: AuthoritativeRoomStore;
  authorityRecoveryCheckpoint?: (name: string) => void;
  commitAuthoritative(context: Principal, id: string, source: {
    kind: "recovery"; row: AuthorityProposalRecoveryRow;
  } | { kind: "canonicalInput"; input: Record<string, unknown>; proposalHash: string }): Promise<unknown>;
};
type Fixture = {
  name: string; genesis: RuntimeGenesis; setupEvents: EventEnvelope[];
  rawRecovery: { recovery: AuthorityCommitRecovery; proposalHash: string; recoveryHash: string;
    pendingEventsHash: string; pendingStateHash: string };
};
type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
const cases = fixtures.cases as unknown as Fixture[];

// SPEC 0016 §9.2: these raw admissions and expected event hashes were produced
// by 67c29ce, before current policy existed. Exercise real Room SQLite, eviction,
// replay and commit through the gap before the first random-request transaction.
for (const [index, f] of cases.entries()) {
  const saved = f.rawRecovery, raw = saved.recovery.rulesInput;
  const root = String(raw.rootActionId), actor = String(raw.actorCharacterId);
  function contextFor(state: AuthoritativeWorldState): Principal {
    const seat = state.seats[state.characterControls[actor].seatId];
    return { principal: { id: seat.principalId, sessionVersion: state.principals[seat.principalId].sessionVersion } };
  }
  async function seed(stub: Stub, policy?: "physical-acquisition-v1", fresh = false) {
    return runInDurableObject(stub, instance => {
      const target = instance as unknown as Internals;
      const restored = target.rulesRuntime.replay(f.genesis, f.setupEvents);
      expect(restored.kind, JSON.stringify(restored)).toBe("replayed");
      if (restored.kind !== "replayed") throw new Error("Historical fixture cannot replay");
      const state = restored.state as AuthoritativeWorldState;
      target.authorityStore.transaction(() => {
        target.authorityStore.createRoom({ roomId: f.genesis.roomId, moduleId: "black-oak-will",
          profiles: f.genesis.profiles, genesis: f.genesis, state,
          members: Object.values(state.principals).map(p => ({ principalId: p.id,
            role: p.id === state.multiplayerRuntime.hostPrincipalId ? "host" : "player" })), characters: [] });
        target.authorityStore.appendEvents(f.setupEvents);
        target.authorityStore.insertSubmission({ submissionId: "submission:raw-only-recovery",
          principalId: contextFor(state).principal.id, payloadHash: saved.proposalHash, inputKind: "intent",
          rootActionId: root, preparedActionId: root, characterId: actor,
          sceneScope: `scene:${state.entities[actor].sceneId}`, preparedScopeVersion: 0,
          prepared: { kind: "prepared", preparedActionId: root, rootActionId: root } });
        if (!fresh) target.authorityStore.saveProposalRecovery({ preparedActionId: root,
          proposalHash: saved.proposalHash, recoveryHash: saved.recoveryHash,
          recovery: policy === undefined ? saved.recovery : { ...saved.recovery, inventoryAdmissionPolicy: policy } });
      });
      return contextFor(state);
    });
  }
  async function snapshot(stub: Stub) {
    return runInDurableObject(stub, instance => {
      const store = (instance as unknown as Internals).authorityStore;
      return { row: store.proposalRecovery(root), batch: store.randomnessBatch(root), eventCount: store.events().length };
    });
  }
  it(`old raw recovery survives repeated request checkpoints: ${f.name}`, async () => {
    const stub = env.VNEXT_ROOMS.getByName(`inventory-raw-only-${index}`);
    const context = await seed(stub), before = await snapshot(stub);
    expect(before.batch).toBeUndefined();
    expect(before.eventCount).toBe(f.setupEvents.length);
    expect(JSON.parse(before.row!.recovery_json)).toEqual(saved.recovery);
    for (const checkpoint of ["beforeRandomnessRequestCommit", "afterRandomnessRequestCommit"]) {
      await evictDurableObject(stub);
      await runInDurableObject(stub, async instance => {
        const target = instance as unknown as Internals, row = target.authorityStore.proposalRecovery(root)!;
        target.authorityRecoveryCheckpoint = name => { if (name === checkpoint) throw new Error(`test-crash:${checkpoint}`); };
        await expect(target.commitAuthoritative(context, root, { kind: "recovery", row })).rejects.toThrow(`test-crash:${checkpoint}`);
      });
      const after = await snapshot(stub);
      expect(after.row).toEqual(before.row);
      expect(after.row!.recovery_hash).toBe(saved.recoveryHash);
      expect(Object.hasOwn(JSON.parse(after.row!.recovery_json), "inventoryAdmissionPolicy")).toBe(false);
      if (checkpoint === "beforeRandomnessRequestCommit") {
        expect(after.batch).toBeUndefined();
        expect(after.eventCount).toBe(f.setupEvents.length);
      } else {
        expect(after.batch!.status).toBe("requestCommitted");
        expect(canonicalSha256(JSON.parse(after.batch!.request_events_json))).toBe(saved.pendingEventsHash);
      }
    }
  });
  it(`current recovery policy rejects the same invalid acquisition: ${f.name}`, async () => {
    const stub = env.VNEXT_ROOMS.getByName(`inventory-current-policy-${index}`);
    const context = await seed(stub, "physical-acquisition-v1"), before = await snapshot(stub);
    await evictDurableObject(stub);
    await runInDurableObject(stub, async instance => {
      const target = instance as unknown as Internals, row = target.authorityStore.proposalRecovery(root)!;
      const result = await target.commitAuthoritative(context, root, { kind: "recovery", row });
      expect(result, JSON.stringify(result)).toMatchObject({ kind: "rejected",
        explanation: f.name.startsWith("concealed") ? "concealment:target-acquisition-requires-on-success"
          : "inventory:physical-check-required-for-foreign-holder" });
    });
    expect(await snapshot(stub)).toEqual(before);
  });
  if (f.name.startsWith("concealed")) it("new admission journals the current policy before its Rules events", async () => {
    const stub = env.VNEXT_ROOMS.getByName("inventory-fresh-journal-policy");
    const context = await seed(stub, undefined, true), input = structuredClone(raw);
    const steps = input.steps as Array<{ proposalRef: string; dependsOn: string[]; outcomeBinding: string; rulesInput: { kind: string } }>;
    const check = steps.find(step => step.rulesInput.kind === "resolveWorldInteraction")!;
    const acquisition = steps.find(step => step.rulesInput.kind === "inventoryOperation")!;
    acquisition.outcomeBinding = "onSuccess";
    acquisition.dependsOn = [check.proposalRef];
    input.steps = [check, acquisition];
    const proposalHash = canonicalSha256(input);
    await runInDurableObject(stub, async instance => {
      const target = instance as unknown as Internals;
      target.authorityRecoveryCheckpoint = name => { if (name === "beforeRandomnessRequestCommit") throw new Error("test-crash:fresh"); };
      await expect(target.commitAuthoritative(context, root, { kind: "canonicalInput", input, proposalHash })).rejects.toThrow("test-crash:fresh");
    });
    const before = await snapshot(stub);
    expect(JSON.parse(before.row!.recovery_json)).toMatchObject({ inventoryAdmissionPolicy: "physical-acquisition-v1", rulesInput: input });
    expect(before.batch).toBeUndefined();
    await evictDurableObject(stub);
    await runInDurableObject(stub, async instance => {
      const target = instance as unknown as Internals, row = target.authorityStore.proposalRecovery(root)!;
      target.authorityRecoveryCheckpoint = name => { if (name === "afterRandomnessRequestCommit") throw new Error("test-crash:fresh-resumed"); };
      await expect(target.commitAuthoritative(context, root, { kind: "recovery", row })).rejects.toThrow("test-crash:fresh-resumed");
    });
    const after = await snapshot(stub);
    expect(after.row).toEqual(before.row);
    expect(after.batch!.status).toBe("requestCommitted");
    const events = JSON.parse(after.batch!.request_events_json);
    expect(events.find((event: EventEnvelope) => event.eventType === "RandomnessRequested")
      .payload.resolutionPlan.inventoryPolicy).toBe("physical-acquisition-v1");
  });
}
