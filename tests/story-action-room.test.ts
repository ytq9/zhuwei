import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../app/_runtime/lib/kp/vnext/proposal-schema";
import type { RoomActionInput } from "../app/_runtime/lib/room/action";
import { ALICE, ACTOR, LIAN, FACT, LATER_FACT, PRIVATE, record, initialize, run, snapshot, type Capture } from "./fixtures/story-action-room";

const CREATION_CALLS = [OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, "submit_story_preparation", "review_story_preparation", SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME];
const REUSE_CALLS = [OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME];
const intent = (submissionId: string): RoomActionInput => ({ kind: "intent", submissionId,
  text: "我想与莉安 lian、瓦罗 varo 一起核对临时征船登记和运输签收资料，主动调查目前的差异。" });
function committed(result: unknown, capture: Capture) {
  expect(result, JSON.stringify({ result, calls: capture.calls, providerError: capture.providerError, preparationFailure: capture.preparationFailure }))
    .toMatchObject({ kind: "committed" });
  expect(JSON.stringify(result)).not.toContain(PRIVATE);
}
function stored(value: Awaited<ReturnType<typeof snapshot>>) {
  if (value.archive.kind !== "available") throw new Error(JSON.stringify(value.archive));
  return value.archive.snapshot;
}

describe("story creation through the actual vNext Room boundary", () => {
  for (const newNpc of [false, true]) it(`${newNpc ? "new NPC investigation" : "existing NPC conflict"}: actual admission, later reuse and complete archive restore preserve the same story`, async () => {
    const suffix = newNpc ? "new-npc" : "existing-npc", f = await initialize(suffix), before = await snapshot(f.stub);
    const capture: Capture = { calls: [], newNpc, extraFact: true };
    const input = intent("submission:story:initial");
    const result = await run(f.stub, input, capture); committed(result, capture);
    expect(capture.calls).toEqual(CREATION_CALLS);
    const saved = await snapshot(f.stub);
    expect(saved.jobs).toHaveLength(1); expect(saved.library).toHaveLength(1);
    expect(saved.jobs[0].checkpoint?.status).toBe("ready");
    const holder = newNpc ? Object.keys(saved.state.entities).find(id => !before.state.entities[id] && saved.state.entities[id].kind === "npc")! : LIAN;
    expect(JSON.stringify(saved.state.knowledge[holder])).toContain(PRIVATE);
    expect(JSON.stringify(saved.state.knowledge[ACTOR])).not.toContain(PRIVATE);
    if (!newNpc) expect(saved.state.entities[LIAN]).toEqual(before.state.entities[LIAN]);
    expect(stored(saved).admissions).toHaveLength(1);
    expect(stored(saved).admissions[0].facts.map(value => value.candidateRef)).toEqual([FACT]);
    const manuscriptHash = canonicalHash(saved.library[0].artifact), originalUsage = saved.jobs[0].usage;
    await evictDurableObject(f.stub);
    expect(await run(f.stub, input, capture)).toEqual(result);
    expect((await snapshot(f.stub)).state).toEqual(saved.state);
    expect(capture.calls).toEqual(CREATION_CALLS);
    await expect(f.stub.exportAuthoritativeArchive(ALICE)).resolves.toMatchObject({ kind: "rejected", code: "archiveExportUnauthorized" });
    const exported = record(await f.stub.exportAuthoritativeArchive(f.capabilities.archiveExport));
    expect(exported.kind, JSON.stringify(exported)).toBe("exported");
    const envelope = record(exported.storyArchive);
    expect(record(envelope.storySnapshot).hostingArtifacts).toEqual(saved.library);

    const reuse: Capture = { calls: [], newNpc, reuse: saved.library[0].libraryRef, factRefs: [LATER_FACT] };
    const next = intent("submission:story:later-reuse"), laterResult = await run(f.stub, next, reuse); committed(laterResult, reuse);
    expect(reuse.calls).toEqual(REUSE_CALLS);
    const later = await snapshot(f.stub);
    expect(later.jobs).toHaveLength(1); expect(later.jobs[0].usage).toEqual(originalUsage);
    expect(canonicalHash(later.library[0].artifact)).toBe(manuscriptHash);
    expect(Object.keys(later.state.entities)).toEqual(Object.keys(saved.state.entities));
    expect(JSON.stringify(later.state.knowledge[holder])).toContain(`${PRIVATE}:后续核验`);
    expect(JSON.stringify(later.state.knowledge[ACTOR])).not.toContain(PRIVATE);
    const admissions = stored(later).admissions;
    expect(admissions).toHaveLength(2);
    expect(admissions.find(value => value.facts.some(fact => fact.candidateRef === LATER_FACT))?.definitions).toEqual([]);
    const beforeExport = canonicalHash(later.state);
    const restored = env.VNEXT_ROOMS.getByName(`story-action-room:restored:${suffix}`);
    await expect(restored.restoreAuthoritativeArchive(f.capabilities.disasterRecovery, envelope)).resolves.toMatchObject({ kind: "restored" });
    const recovered = await snapshot(restored);
    expect(recovered.state).toEqual(saved.state);
    expect(recovered.library).toEqual(saved.library);
    expect(stored(recovered)).toEqual(stored(saved));
    const resumed: Capture = { calls: [], newNpc, reuse: saved.library[0].libraryRef, factRefs: [LATER_FACT] };
    const resumedResult = await run(restored, next, resumed); committed(resumedResult, resumed);
    const advanced = await snapshot(restored);
    expect(resumed.calls).toEqual(REUSE_CALLS);
    expect(advanced.jobs[0].usage).toEqual(originalUsage);
    expect(canonicalHash(advanced.library[0].artifact)).toBe(manuscriptHash);
    expect(stored(advanced).admissions).toHaveLength(2);
    expect(JSON.stringify(advanced.state.knowledge[holder])).toContain(`${PRIVATE}:后续核验`);
    await evictDurableObject(restored);
    expect(await run(restored, next, resumed)).toEqual(resumedResult);
    expect(resumed.calls).toEqual(REUSE_CALLS);
    expect((await snapshot(restored)).state).toEqual(advanced.state);
    expect(canonicalHash((await snapshot(f.stub)).state)).toBe(beforeExport);
  });

  it("a new NPC admitted alone can gain the manuscript's facts and private knowledge on a later real action after eviction", async () => {
    const f = await initialize("split-npc"), before = await snapshot(f.stub);
    const first: Capture = { calls: [], newNpc: true, definitionsOnly: true };
    committed(await run(f.stub, intent("submission:story:npc-only"), first), first);
    const named = await snapshot(f.stub), receipt = stored(named).admissions[0];
    expect(first.calls).toEqual(CREATION_CALLS);
    expect(receipt.definitions).toHaveLength(1); expect(receipt.facts).toEqual([]);
    const holder = receipt.definitions[0].authorityRef;
    expect(before.state.entities[holder]).toBeUndefined();
    expect(named.state.entities[holder].kind).toBe("npc");
    expect(JSON.stringify(named.state.knowledge[holder] ?? {})).not.toContain(PRIVATE);
    await evictDurableObject(f.stub);
    const second: Capture = { calls: [], newNpc: true, reuse: named.library[0].libraryRef };
    const result = await run(f.stub, intent("submission:story:npc-memory"), second); committed(result, second);
    expect(second.calls).toEqual(REUSE_CALLS);
    const remembered = await snapshot(f.stub), receipts = stored(remembered).admissions;
    expect(receipts).toHaveLength(2);
    const acquired = receipts.find(value => value.facts.length > 0)!;
    expect(acquired.definitions).toEqual([]);
    expect(acquired.facts[0].knowledge[0].holderRef).toBe(holder);
    expect(JSON.stringify(remembered.state.knowledge[holder])).toContain(PRIVATE);
    expect(JSON.stringify(remembered.state.knowledge[ACTOR])).not.toContain(PRIVATE);
    expect(remembered.library).toEqual(named.library);
    expect(remembered.jobs[0].usage).toEqual(named.jobs[0].usage);
  });

  it("a draft with unknown provider outcome cannot create facts or resample on retry", async () => {
    const f = await initialize("unknown"), before = await snapshot(f.stub), capture: Capture = { calls: [], newNpc: false, failDraft: true };
    const input = intent("submission:story:unknown"), first = await run(f.stub, input, capture);
    expect(record(first).kind).not.toBe("committed");
    expect(record(first).code).toBe("STORY_INVOCATION_UNKNOWN");
    expect(capture.calls).toEqual([OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, "submit_story_preparation"]);
    const interrupted = await snapshot(f.stub);
    expect(interrupted.library).toEqual([]);
    expect(stored(interrupted).invocations.some(row => row.invocation.stage === "draft" && row.invocation.status === "unknown")).toBe(true);
    await evictDurableObject(f.stub);
    expect(await run(f.stub, input, capture)).toEqual(first);
    expect(capture.calls).toHaveLength(2);
    expect((await snapshot(f.stub)).state).toEqual(before.state);
    expect(stored(await snapshot(f.stub))).toEqual(stored(interrupted));
  });
});
