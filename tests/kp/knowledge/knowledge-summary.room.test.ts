import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { initialize, response, record, ALICE, ACTOR, LIAN, SCENE, type Json } from "../../support/fixtures/story-action-room";
import { handleRoomAction, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { ActorPlanTransportCapability } from "../../../app/_runtime/lib/room/actor-plan-transport";
import type { AuthoritativeRoomStore } from "../../../app/_runtime/lib/room/authority-store";
import type { StoryCreationStore } from "../../../app/_runtime/lib/room/story-creation-store";
import { createStoryExternalInvocationJournal } from "../../../app/_runtime/lib/room/story-external-invocation-journal";
import { KNOWLEDGE_SUMMARY_TOOL_NAME, type FrozenKnowledgeSummary } from "../../../app/_runtime/lib/room/knowledge-summary-host";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { createVNextModelCallScope } from "../../../app/_runtime/lib/kp/vnext/model-call-scope";
import { encodeVNextStrictToolBundle, OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
import type { VNextInvocationRequest, VNextInvocationStart, VNextInvocationCompletion } from "../../../app/_runtime/lib/room/vnext-proposal-invocation";
import type { AuthoritativeWorldState, RuntimeGenesis, RuntimeProfileManifest, EventEnvelope } from "../../../app/_runtime/lib/rules";
import { createEventTransition } from "../../../app/_runtime/lib/rules/v2/events";
import type { VersionedRulesRuntime } from "../../../app/_runtime/lib/rules/v2-runtime";
import { proposalModelContext } from "../../../app/_runtime/lib/kp/vnext/proposal-context";
import type { VNextRequiredContext } from "../../../app/_runtime/lib/kp/vnext/required-context";
import { roomStoryBudget } from "../../../app/_runtime/lib/room/story-runtime-policy";
import { validateStoryArchive, type StoryRoomArchive } from "../../../app/_runtime/lib/room/story-archive";
import { archiveSha256 } from "../../../app/_runtime/lib/room/archive";
import { canonicalHash } from "../../../app/_runtime/lib/kp/vnext/canonical-json";

type Stub = ReturnType<typeof env.VNEXT_ROOMS.getByName>;
type Internals = RoomAuthorityCapability & {
  authorityStore: AuthoritativeRoomStore; storyStore: StoryCreationStore; rulesRuntime: VersionedRulesRuntime;
  authoritativeReplay(): { state: AuthoritativeWorldState; profiles: RuntimeProfileManifest; genesis: RuntimeGenesis };
  appendAuthorityTransition(state: AuthoritativeWorldState, events: EventEnvelope[]): void;
  summarizeKnowledgeAfterAction(principal: typeof ALICE, completion: string | { kind: "roll"; randomnessId: string }, transport: ActorPlanTransportCapability): Promise<unknown>;
  beginVNextProposalInvocation(principal: typeof ALICE, id: string, request: VNextInvocationRequest): Promise<VNextInvocationStart>;
  completeVNextProposalInvocation(principal: typeof ALICE, id: string, response: VNextInvocationCompletion): Promise<{ kind: string }>;
};
const SUMMARY = "旧港来船与灯油记录交错，尚待核对最后一批货物。";
// Archive alarms can still emit routine telemetry during Worker teardown;
// these tests inspect the persisted journal, not the console transport.
vi.spyOn(console, "info").mockImplementation(() => {});

/** Seed previously acquired records through the actual event reducer and Room
 * append seam. All events replay after eviction and archive restoration. */
async function seed(stub: Stub) {
  await runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, replay = target.authoritativeReplay();
    let state = replay.state;
    const events: EventEnvelope[] = [];
    for (const holder of [ACTOR, LIAN]) {
      const cause = `fact:summary:past:${holder}`;
      const declared = createEventTransition(state, replay.profiles, { rootActionId: `root:summary:seed:${holder}`,
        eventType: "CanonicalFactDeclared", payload: { fact: { id: cause, kind: "pastRecord", subjectRefs: [SCENE, holder].sort(),
          value: "过去留下的记录。", visibilityPolicyId: `visibility:knowledge-holder:${holder}`, source: "observedEvent", causalParentIds: [] } },
        visibilityPolicyId: `visibility:knowledge-holder:${holder}`, secrecy: "private" });
      state = declared.state; events.push(declared.event);
      for (let i = 0; i < 70; i++) {
        const next = createEventTransition(state, replay.profiles, { rootActionId: `root:summary:seed:${holder}:${i}`,
          eventType: "KnowledgeAcquired", payload: { characterId: holder, knowledgeRef: `memory:summary:${holder}:${String(i).padStart(3, "0")}`,
            objectKind: "canonicalFact", layer: "full", content: `${holder === ACTOR ? "ACTOR_ONLY" : "NPC_SECRET"}_old_record_${i}`,
            causeFactId: cause, acquisition: { sense: "reading", sceneId: SCENE, method: "已经读过的旧记录" }, visibility: "private" },
          visibilityPolicyId: `visibility:knowledge-holder:${holder}`, secrecy: "private" });
        state = next.state; events.push(next.event);
      }
    }
    target.authorityStore.transaction(() => target.appendAuthorityTransition(state, events));
    expect(target.rulesRuntime.replay(replay.genesis, target.authorityStore.events()).kind).toBe("replayed");
  });
}

type Capture = { calls: string[]; order: string[]; requests: Json[]; unknown?: boolean; limit?: string };
const capture = (): Capture => ({ calls: [], order: [], requests: [] });
function model(c: Capture) {
  return { async run(_model: string, request: Json) {
    const name = String(record(record((request.tools as Json[])[0]).function).name);
    c.calls.push(name); c.order.push(name);
    if (name === KNOWLEDGE_SUMMARY_TOOL_NAME) {
      c.requests.push(structuredClone(request));
      expect(JSON.stringify(request)).not.toContain("NPC_SECRET");
      if (c.unknown) throw new Error("summary response lost after dispatch");
      return response(name, { summary: SUMMARY });
    }
    if (name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME) return response(name, { requestedCapabilities: ["inWorldRefusal"] });
    if (name !== SUBMIT_KP_PROPOSAL_BUNDLE_TOOL_NAME) throw new Error(`unexpected call ${name}`);
    return response(name, encodeVNextStrictToolBundle({ mode: "terminal", basisRefs: [SCENE], adjudication: null, proposals: [], terminal: {
      kind: "inWorldRefusal", intent: "核对手头记录。", method: "检查现有文件。", ruling: { kind: "missingPrerequisite",
        publicBasis: "仍缺少可供对照的原卷。", prerequisites: [{ kind: "knowledge", ref: "none", description: "可对照的原始卷宗" }],
        nextActions: [{ description: "寻找原卷", basisRefs: [SCENE] }], attemptCosts: [{ kind: "fictionTime", durationMicros: "60000000" }] } } }));
  } };
}
async function run(stub: Stub, submissionId: string, c: Capture) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    const scope = createVNextModelCallScope({ roomId: "summary", limit: c.limit, emit() {} });
    const ai = scope.bind(model(c)), transport = new ActorPlanTransportCapability(ai);
    const kp = createVNextKpAdapter({ proposalBinding: ai, journal: {
      begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
      complete: (id, response) => target.completeVNextProposalInvocation(ALICE, id, response),
    }, narrationAdapter: { async narrate() { c.order.push("required-narration"); return { body: "手头记录仍缺少原卷，你可以继续查找。" }; } } as AuthoritativeKpAdapter });
    const outcome = await handleRoomAction({ principal: ALICE, authority: target, kp },
      { kind: "intent", submissionId, text: "我花一分钟检查手头登记，确认还缺少什么材料。" });
    expect(outcome.narration, JSON.stringify(outcome)).toBe("published");
    const summary = await target.summarizeKnowledgeAfterAction(ALICE, submissionId, transport);
    return { outcome, summary };
  });
}
async function snapshot(stub: Stub) {
  return runInDurableObject(stub, instance => {
    const target = instance as unknown as Internals, { state } = target.authoritativeReplay();
    const archived = target.storyStore.archiveSnapshot({ roomId: state.roomId, runtimeEpochId: state.runtimeEpochId });
    if (archived.kind !== "available") throw new Error(archived.code);
    return { state, events: target.authorityStore.events(), summaries: target.authorityStore.knowledgeSummaryContexts(), story: archived.snapshot };
  });
}
async function readNext(stub: Stub, id: string) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Internals;
    const prepared = record(await target.prepare(ALICE, { kind: "intent", submissionId: id, text: "我问莉安这份记录还有什么缺项。" }));
    expect(prepared.kind, JSON.stringify(prepared)).toBe("prepared");
    return proposalModelContext(prepared.requiredContext as VNextRequiredContext);
  });
}

describe("SPEC 0016 §§4.3、4.5: journaled knowledge summaries", () => {
  for (const unknown of [false, true]) it(`${unknown ? "unknown" : "completed"} summary survives retry, eviction and full archive recovery without another sample`, async () => {
    const f = await initialize(`knowledge-summary-${unknown}`); await seed(f.stub);
    const c = capture(); c.unknown = unknown;
    const submission = `submission:knowledge-summary:${unknown}`, runResult = await run(f.stub, submission, c);
    expect(runResult.outcome.narration).toBe("published");
    expect(runResult.summary).toMatchObject({ kind: unknown ? "unavailable" : "completed" });
    expect(c.calls.filter(name => name === KNOWLEDGE_SUMMARY_TOOL_NAME)).toHaveLength(1);
    expect(c.order.indexOf(KNOWLEDGE_SUMMARY_TOOL_NAME)).toBeGreaterThan(c.order.indexOf("required-narration"));
    const saved = await snapshot(f.stub), calls = c.calls.length;
    expect(saved.summaries).toHaveLength(1);
    expect(saved.summaries[0].segment.sources).toHaveLength(32);
    await evictDurableObject(f.stub);
    await runInDurableObject(f.stub, async instance => {
      const target = instance as unknown as Internals;
      await target.summarizeKnowledgeAfterAction(ALICE, submission, new ActorPlanTransportCapability(model(c)));
    });
    expect(c.calls).toHaveLength(calls);
    const retried = await snapshot(f.stub);
    expect(retried.events).toEqual(saved.events); expect(retried.story).toEqual(saved.story);
    expect(JSON.stringify(await readNext(f.stub, `submission:summary:next:${unknown}`)).includes(SUMMARY)).toBe(!unknown);
    const exported = record(await f.stub.exportAuthoritativeArchive(f.capabilities.archiveExport));
    expect(exported.kind, JSON.stringify(exported)).toBe("exported");
    if (!unknown) for (const mismatch of ["holder", "segment"] as const) {
      const archive = structuredClone(exported.storyArchive) as StoryRoomArchive;
      const host = archive.hostBindings.find(row => row.kind === "knowledgeSummary")!;
      const stage = (host.payload.stages as unknown as Json[])[0];
      const row = archive.storySnapshot.invocations.find(row => row.invocation.invocationId === stage.invocationId)!;
      const external = row.externalBinding!;
      if (mismatch === "holder") {
        const messages = row.invocation.providerRequest.messages as Json[], input = JSON.parse(String(messages[1].content));
        input.holderRef = LIAN;
        input.records[0].text = "NPC_SECRET stolen context";
        messages[1].content = JSON.stringify(input);
        (external as Json).providerRequest = structuredClone(row.invocation.providerRequest);
      } else (external as Json).invocationKey = "knowledge-summary:ANOTHER-SOURCE-HASH";
      (row.invocation as unknown as Json).requestHash = canonicalHash(external);
      const source = external.source;
      (row as unknown as Json).invocationKey = canonicalHash({ source: canonicalHash({ roomId: source.roomId,
        epoch: source.runtimeEpochId, branch: source.branchId, kind: source.kind, sourceId: source.sourceId }), key: external.invocationKey });
      stage.requestHash = canonicalHash(row.invocation.providerRequest);
      (host as unknown as Json).payloadHash = canonicalHash(host.payload);
      const { snapshotHash: _snapshot, ...body } = archive.storySnapshot;
      (archive.storySnapshot as unknown as Json).snapshotHash = await archiveSha256(body);
      const { contentHash: _content, ...envelope } = archive;
      (archive as unknown as Json).contentHash = await archiveSha256(envelope);
      expect(await validateStoryArchive(archive), mismatch).toMatchObject({ kind: "rejected", code: "STORY_ARCHIVE_HOST_BINDING_INVALID" });
    }
    const restored = env.VNEXT_ROOMS.getByName(`knowledge-summary:restored:${unknown}`);
    expect(await restored.restoreAuthoritativeArchive(f.capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
    const recovered = await snapshot(restored);
    expect(recovered.events).toEqual(saved.events); expect(recovered.story).toEqual(saved.story);
    expect(recovered.summaries).toEqual(saved.summaries);
    expect(JSON.stringify(await readNext(restored, `submission:summary:restored:${unknown}`)).includes(SUMMARY)).toBe(!unknown);
    await runInDurableObject(restored, instance => {
      const target = instance as unknown as Internals;
      const frozen = recovered.summaries[0] as FrozenKnowledgeSummary;
      const invocation = recovered.story.invocations.find(row => row.externalBinding?.invocationKey === `knowledge-summary:${frozen.segment.sourceHash}`)!;
      const external = invocation.externalBinding!;
      const begun = createStoryExternalInvocationJournal(target.storyStore).begin({ ...external, budget: roomStoryBudget(external.source) });
      expect(begun.kind).not.toBe("ready");
    });
    expect(c.calls).toHaveLength(calls);
  });

  it("an exhausted request scope leaves the published action successful and permits only an unsent summary to resume", async () => {
    const f = await initialize("knowledge-summary-budget"); await seed(f.stub);
    const c = capture(); c.limit = "2";
    const submission = "submission:knowledge-summary:budget", result = await run(f.stub, submission, c);
    expect(result.outcome.narration).toBe("published");
    expect(result.summary).toMatchObject({ kind: "unavailable", code: "ACTOR_PLAN_DECISION_CALL_BUDGET_EXHAUSTED" });
    expect(c.calls).toHaveLength(2);
    const saved = await snapshot(f.stub);
    expect(saved.story.invocations.find(row => row.invocation.purpose === "context")?.invocation.status).toBe("notSent");
    await runInDurableObject(f.stub, async instance => {
      const target = instance as unknown as Internals, transport = new ActorPlanTransportCapability(model(c));
      expect(await target.summarizeKnowledgeAfterAction({ principal: { id: "another-principal", sessionVersion: 1 } }, submission, transport))
        .toMatchObject({ kind: "notApplicable" });
      expect(c.calls).toHaveLength(2);
      expect(await target.summarizeKnowledgeAfterAction(ALICE, submission, transport)).toMatchObject({ kind: "completed" });
      expect(await target.summarizeKnowledgeAfterAction(ALICE, submission, transport)).toMatchObject({ kind: "completed" });
    });
    expect(c.calls.filter(name => name === KNOWLEDGE_SUMMARY_TOOL_NAME)).toHaveLength(1);
    expect((await snapshot(f.stub)).events).toEqual(saved.events);
  });

  it("a published pending answer uses its initiating intent's directory exactly once", async () => {
    const f = await initialize("knowledge-summary-pending-answer"); await seed(f.stub);
    await runInDurableObject(f.stub, async instance => {
      const target = instance as unknown as Internals, replay = target.authoritativeReplay();
      const npc = replay.state.combatRuntime.entities[LIAN], events: EventEnvelope[] = [];
      const person = replay.state.entities[LIAN], scores = person.abilityScores ?? person.socialMechanics!.abilityScores;
      let started = target.rulesRuntime.step(replay.profiles, replay.state, { kind: "startEncounter", rootActionId: "root:summary:seed-encounter",
        proposalAttemptId: "proposal:summary:seed-encounter", encounterId: "encounter:summary:pending", sceneId: SCENE,
        participantEntityIds: [ACTOR], battlefieldFactIds: [],
        dynamicEntities: [{ entityId: LIAN, name: replay.state.entities[LIAN].name, placement: { position: npc.position },
          mechanics: { kind: "bespokeDefinition", definition: { definitionId: "npc-template:summary:lian", revision: "1",
            definitionKind: "npcMechanicalTemplate", rulesBasis: "srd5.1-2014", causalBasisRefs: [SCENE], visibilityPolicyRef: "visibility:scene-observers",
            content: { schema: "zhuwei.npc-mechanical-template/v1", label: person.name, footprint: npc.footprint,
              stats: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)])),
              proficiencyBonus: String(person.proficiencyBonus ?? person.socialMechanics!.proficiencyBonus),
              armorClass: String(person.loadout?.armorClass ?? 10), armorClassModel: { kind: "higherOfBaseAndEquipment", baseArmorClass: String(person.loadout?.armorClass ?? 10), shieldBonus: "0" },
              hitPointsMaximum: String(person.hitPoints?.maximum ?? 11), speedInches: { walk: String((person.loadout?.speedFeet ?? 30) * 12) }, resourceMaximums: {}, deathPolicy: "deadAtZero",
              intrinsicAbilities: [], itemDefinitions: [], itemDefinitionRefs: [], initialLoadout: { entries: [] } } } } }],
        initiativeGroups: [ACTOR, LIAN].map(id => ({ entryId: `initiative:${id}`, combatantEntityIds: [id] })),
        hostilities: [{ fromEntityIds: [ACTOR], toEntityIds: [LIAN] }, { fromEntityIds: [LIAN], toEntityIds: [ACTOR] }] } as never);
      if ("events" in started) events.push(...started.events);
      while (started.kind === "awaitingRandomness") {
        const waiting = started as unknown as Json;
        started = target.rulesRuntime.step(replay.profiles, started.state, { kind: "authoritativeRandomness", resolutionId: waiting.resolutionId,
          responseId: `answer:${String(waiting.resolutionId)}`, continuationCapability: waiting.continuationCapability,
          randomnessResults: (waiting.randomnessRequests as Json[]).map(request => ({ randomnessId: request.randomnessId,
            requestHash: request.requestHash, draws: (request.dice as Json[]).map(die => ({ sides: Number(die.sides),
              faces: Array(Number(die.count)).fill(String(request.purposeKey).includes(ACTOR) ? 20 : 1) })) })) } as never);
        if ("events" in started) events.push(...started.events);
      }
      expect(started.kind, JSON.stringify(started).slice(0, 1200)).toBe("committed");
      if (started.kind !== "committed") throw new Error("fixture encounter failed");
      target.authorityStore.transaction(() => target.appendAuthorityTransition(started.state as AuthoritativeWorldState, events));
      let summaryCalls = 0;
      const transport = new ActorPlanTransportCapability({ async run(_model, request) {
        expect(record(record((request.tools as Json[])[0]).function).name).toBe(KNOWLEDGE_SUMMARY_TOOL_NAME);
        summaryCalls += 1; return response(KNOWLEDGE_SUMMARY_TOOL_NAME, { summary: SUMMARY });
      } });
      const kp = createVNextKpAdapter({ proposalBinding: { async run(_model, request) {
        const name = String(record(record((request.tools as Json[])[0]).function).name);
        return response(name, name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME ? { requestedCapabilities: ["endCombat"] }
          : { decision: { kind: "endCombat", outcome: "conflictOver", stopFightingRefs: [], description: "双方停手，冲突已经结束。" } });
      } }, journal: { begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion) },
      narrationAdapter: { async narrate() { return { body: "战斗结束，你仍记得先前的记录。" }; } } as AuthoritativeKpAdapter });
      const original = "submission:summary:original-pending";
      const offered = await handleRoomAction({ principal: ALICE, authority: target, kp },
        { kind: "intent", submissionId: original, text: "双方停手，结束战斗。" });
      expect(offered.kind, JSON.stringify(offered)).toBe("awaitingInput");
      expect(await target.summarizeKnowledgeAfterAction(ALICE, original, transport)).toMatchObject({ kind: "notApplicable" });
      const pending = record(record(offered).pending);
      const answer = { kind: "answer" as const, submissionId: "submission:summary:pending-answer", pendingInputId: String(pending.pendingInputId),
        answer: { kind: "acceptEncounterConclusion" } };
      const done = await handleRoomAction({ principal: ALICE, authority: target, kp }, answer);
      expect(done, JSON.stringify(done)).toMatchObject({ kind: "committed", narration: "published" });
      const answerRow = target.authorityStore.submission(answer.submissionId)!;
      expect(JSON.parse(answerRow.prepared_json).requiredContext).toBeUndefined();
      expect(await target.summarizeKnowledgeAfterAction(ALICE, answer.submissionId, transport)).toMatchObject({ kind: "completed" });
      expect(await target.summarizeKnowledgeAfterAction(ALICE, answer.submissionId, transport)).toMatchObject({ kind: "completed" });
      expect(summaryCalls).toBe(1);
      expect(target.authorityStore.knowledgeSummaryContexts()[0].sourceRootActionId).toBe(target.authorityStore.submission(original)!.root_action_id);
    });
  });

  it("a finalized player roll reuses its authenticated original submission and model source", async () => {
    const f = await initialize("knowledge-summary-player-roll"); await seed(f.stub);
    await runInDurableObject(f.stub, async instance => {
      const target = instance as unknown as Internals & { authorityRoll(sides: number): number };
      let draw = 0, summaryCalls = 0;
      target.authorityRoll = sides => Math.min(sides, draw++ === 0 ? 20 : 1);
      const person = target.authoritativeReplay().state.entities[LIAN];
      const scope = createVNextModelCallScope({ roomId: "summary-roll", limit: "4", emit() {} });
      const ai = scope.bind({ async run(_model, request) {
        const name = String(record(record((request.tools as Json[])[0]).function).name);
        if (name === KNOWLEDGE_SUMMARY_TOOL_NAME) { summaryCalls += 1; return response(name, { summary: SUMMARY }); }
        return response(name, name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME ? { requestedCapabilities: ["startCombat"] }
          : { decision: { kind: "startCombat", participants: [ACTOR, LIAN].map(creatureRef => ({ creatureRef, surprise: { kind: "aware" } })),
            hostilities: [{ fromRefs: [ACTOR], toRefs: [LIAN] }, { fromRefs: [LIAN], toRefs: [ACTOR] }],
            combatStatistics: [{ npcRef: LIAN, armorClass: person.loadout?.armorClass ?? 10, speedFeet: person.loadout?.speedFeet ?? 30,
              hitPointsMaximum: person.hitPoints?.maximum ?? 11, deathPolicy: "deadAtZero",
              attacks: [{ kind: "meleeAttack", label: "短剑", ability: "str", reachFeet: 5, damage: "1d4", damageType: "piercing" }] }],
            description: "双方拔出武器，对峙开始。" } });
      } });
      const transport = new ActorPlanTransportCapability(ai);
      const kp = createVNextKpAdapter({ proposalBinding: ai, journal: {
        begin: (id, request) => target.beginVNextProposalInvocation(ALICE, id, request),
        complete: (id, completion) => target.completeVNextProposalInvocation(ALICE, id, completion),
      }, narrationAdapter: { async narrate() { return { body: "你先一步站稳，轮到你选择行动。" }; } } as AuthoritativeKpAdapter });
      const original = "submission:summary:before-roll";
      const waiting = await handleRoomAction({ principal: ALICE, authority: target, kp },
        { kind: "intent", submissionId: original, text: "我拔剑，与莉安对峙。" });
      expect(waiting.kind, JSON.stringify(waiting)).toBe("awaitingPlayerRoll");
      const rolls = record(await target.observe(ALICE)).pendingPlayerRolls as Json[];
      const completion = { kind: "roll" as const, randomnessId: String(rolls[0].id) };
      const rolled = await handleRoomAction({ principal: ALICE, authority: target, kp },
        { ...completion, submissionId: "submission:summary:roll-gesture" });
      expect(rolled, JSON.stringify(rolled)).toMatchObject({ kind: "committed", narration: "published" });
      expect(target.authorityStore.submission("submission:summary:roll-gesture")).toBeUndefined();
      expect(await target.summarizeKnowledgeAfterAction({ principal: { id: "foreign", sessionVersion: 1 } }, completion, transport))
        .toMatchObject({ kind: "notApplicable" });
      expect(summaryCalls).toBe(0);
      expect(await target.summarizeKnowledgeAfterAction(ALICE, completion, transport)).toMatchObject({ kind: "completed" });
      expect(await target.summarizeKnowledgeAfterAction(ALICE, completion, transport)).toMatchObject({ kind: "completed" });
      expect(summaryCalls).toBe(1);
      const contexts = target.authorityStore.knowledgeSummaryContexts();
      expect(contexts).toHaveLength(1);
      expect(contexts[0].sourceRootActionId).toBe(target.authorityStore.submission(original)!.root_action_id);
    });
  });
});
