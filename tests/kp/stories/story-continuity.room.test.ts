import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { handleRoomAction, type RoomAuthorityCapability } from "../../../app/_runtime/lib/room/action";
import { createVNextKpAdapter } from "../../../app/_runtime/lib/kp/vnext/adapter";
import { OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME, encodeVNextStrictToolBundle } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import type { AuthoritativeKpAdapter } from "../../../app/_runtime/lib/kp/authoritative-types";
import { deriveAuthorityClaimsFromCommittedRange } from "../../../app/_runtime/lib/rules/v2/claims";

// SPEC 0009 §§1、8: the live KP/Room entrance must open an actual scene
// question. Calling the old Rules primitive directly misses this regression.
type Data = Record<string, any>;
const ALICE = { principal: { id: "principal:story-continuity:alice", sessionVersion: 1 } };
const ACTOR = "character:story-continuity:alice";
vi.spyOn(console, "info").mockImplementation(() => {});
const response = (name: string, value: unknown) => ({ choices: [{ finish_reason: "tool_calls", message: {
  tool_calls: [{ type: "function", function: { name, arguments: JSON.stringify(value) } }],
} }] });

const BOB = { principal: { id: "principal:story-continuity:bob", sessionVersion: 1 } };
const OTHER = "character:story-continuity:bob";
async function initialize(name: string, multiplayer = false) {
  const stub = env.VNEXT_ROOMS.getByName(name), people = multiplayer ? [[ALICE, ACTOR], [BOB, OTHER]] as const : [[ALICE, ACTOR]] as const;
  const initialized = await stub.initializeAuthoritative({ roomId: name, moduleId: "black-oak-will",
    members: people.map(([context], index) => ({ principalId: context.principal.id, role: index === 0 ? "host" : "player" })),
    characters: people.map(([context, characterId]) => ({ characterId, controllerPrincipalId: context.principal.id,
      staticCard: { name: characterId === ACTOR ? "阿莱莎" : "鲍勃", sceneId: "wake", level: 3, classId: "fighter", raceId: "human", subclassId: "champion",
        scores: { str: 16, dex: 12, con: 12, int: 10, wis: 12, cha: 10 }, proficiency: 2, skills: ["investigation"],
        resources: { hitDice: { max: 3, used: 0 } }, hp: { current: 20, max: 20, temp: 0 }, ac: 13, speed: 30,
        equipped: { main: "longsword" }, backpack: [] } })),
  } as never) as Data;
  expect(initialized).toMatchObject({ created: true });
  return { stub, capabilities: initialized.serviceCapabilities };
}
const entry = (operation: Data, basisRefs = ["wake"]) => ({ kind: "storyContinuity", basisRefs, consumes: [], produces: [], outcomeBinding: "always", operation });
const opening = (participants = [ACTOR]) => entry({ kind: "openScene", storyRef: { kind: "new" }, participantRefs: participants,
  title: "核对两份遗嘱", question: "这两份遗嘱的差异能否得到有依据的解释？" });
const observation = (evidence: string, observers = [ACTOR]) => ({
  kind: "observe", basisRefs: ["wake"], consumes: [], produces: [], outcomeBinding: "always", sceneRef: "wake",
  inquiry: "查看遗嘱上的字迹。", method: "留在原地看。", focusRefs: ["wake"], existingFactRefs: [],
  branches: { success: { outcomeCode: "outcome:observed", summary: "查看了遗嘱上的字迹。",
    sensoryEvidence: observers.map(observerRef => ({ observerRef, subjectRef: "wake", sense: "sight", evidence, basisRefs: ["wake"] })),
    characterInferences: [] }, failure: { kind: "none" } },
});
const bundle = (proposals: Data[]) => ({ mode: "adjudication", basisRefs: [...new Set(proposals.flatMap(p => p.basisRefs))], terminal: null,
  adjudication: { kind: "directSuccess", durationMicros: proposals.some(p => p.kind === "observe") ? "300000000" : "0",
    risk: "只按实际已知事实记录结果。", successOutcome: "核对眼前的事实。" }, proposals });
const state = (target: Data) => target.authoritativeReplay().state as Data;
const story = (target: Data) => Object.values(state(target).campaignRuntime.stories)[0] as Data;
const evidenceRefs = (target: Data, actor = ACTOR) => Object.values(state(target).knowledge[actor] ?? {})
  .filter((k: any) => k.objectKind === "sensoryEvidence" && state(target).canonicalFacts[k.knowledgeRef]).map((k: any) => k.knowledgeRef) as string[];

async function scenario<T>(stub: ReturnType<typeof env.VNEXT_ROOMS.getByName>, body: (act: (id: string, text: string, proposals: Data[], context?: typeof ALICE) => Promise<Data>, target: Data, calls: Data) => Promise<T>) {
  return runInDurableObject(stub, async instance => {
    const target = instance as unknown as Data;
    const calls: Data = { proposals: [], narrations: [], diagnostics: [] };
    const project = target.rulesRuntime.project.bind(target.rulesRuntime);
    target.rulesRuntime.project = (...args: unknown[]) => {
      const value = project(...args);
      if (value.kind === "rejected") {
        calls.diagnostics.push(value);
        const range = (args[3] as Data)?.committedRange, world = args[1] as Data;
        if (range) try { deriveAuthorityClaimsFromCommittedRange({ ...range, state: world,
          receipt: Object.values(world.receipts).find((r: any) => r.receiptId === range.receiptId) } as never); }
        catch (error) { calls.diagnostics.push(String(error)); }
      }
      return value;
    };
    const authority = Object.fromEntries(["prepare", "commit", "observe", "acknowledge", "publishDelivery",
      "deliveryPublicationStatus", "beginDeliveryAudiencePublication", "failDeliveryAudiencePublication",
      "beginViewerNarrationRecovery", "publishViewerNarrationRecovery", "failViewerNarrationRecovery"]
      .map(name => [name, (...args: unknown[]) => target[name](...args)])) as unknown as RoomAuthorityCapability;
    const act = async (id: string, text: string, proposals: Data[], context = ALICE) => {
      const narrationAdapter = { async narrate(request: Data) { calls.narrations.push(structuredClone(request)); return { body: "核对有了结果。" }; },
        async propose() { throw new Error("unused"); } } as unknown as AuthoritativeKpAdapter;
      const kp = createVNextKpAdapter({ narrationAdapter,
        journal: { begin: (key, request) => target.beginVNextProposalInvocation(context, key, request),
          complete: (key, completion) => target.completeVNextProposalInvocation(context, key, completion) },
        proposalBinding: { async run(_model: string, value: unknown) {
          const request = value as Data, name = String(request.tools[0].function.name); calls.proposals.push(request);
          return response(name, name === OFFER_KP_PROPOSAL_BUNDLE_TOOL_NAME
            ? { requestedCapabilities: [...new Set(proposals.map(p => p.kind))] }
            : encodeVNextStrictToolBundle(bundle(proposals) as never));
        } } });
      const result = await handleRoomAction({ principal: context, authority, kp }, { kind: "intent", submissionId: id, text }) as Data;
      return result;
    };
    return body(act, target, calls);
  });
}
const assertKind = (result: Data, expected: string, calls: Data) => expect(result.kind, JSON.stringify({ result, diagnostics: calls.diagnostics,
  last: calls.proposals.at(-1)?.messages.at(-1)?.content })).toBe(expected);

it("SPEC 0009 §1: opening a question composes with the actual observation, time and knowledge in one Room action", async () => {
  const { stub } = await initialize("story-continuity-open-room");
  await scenario(stub, async (act, target, calls) => {
    const result = await act("story-open", "我核对两份遗嘱。", [opening(), observation("两份遗嘱的签名字迹不同。")]);
    assertKind(result, "committed", calls);
    expect(Object.values(state(target).campaignRuntime.sceneQuestions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ question: "这两份遗嘱的差异能否得到有依据的解释？", status: "open" }),
    ]));
    expect(evidenceRefs(target)).not.toHaveLength(0);
    expect(calls.proposals).toHaveLength(2);
    expect(calls.narrations).toHaveLength(1);
    expect(calls.narrations[0].renderableClaims.claims).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "objectiveContinuity", transition: "opened" })]));
    expect(target.authorityStore.events().some((event: Data) => event.eventType === "FictionTimeAdvanced")).toBe(true);
  });
}, 30_000);

for (const [outcome, fact, intent] of [
  ["success", "复核发现两份字迹出自同一个人，伪造者已经承认。", "差异已经解释清楚了，我结束调查。"],
  ["failure", "纸张被不可恢复地烧成灰烬，原件已经不存在。", "原件永远找不回来了，这次调查到此结束。"],
  ["abandoned", "两份遗嘱仍在桌上，调查尚无结论。", "我明确放弃调查这两份遗嘱。"],
] as const) it(`SPEC 0009 §8: ${outcome} reaches concluded through Room, preserves the world and survives eviction`, async () => {
  const { stub } = await initialize(`story-continuity-${outcome}-room`);
  const id = await scenario(stub, async (act, target, calls) => {
    assertKind(await act("open", "我查看两份遗嘱。", [opening(), observation(fact)]), "committed", calls);
    const storyId = story(target).storyId, before = structuredClone(state(target));
    const close = entry({ kind: "concludeStory", storyRef: storyId, outcome, unresolvedRefs: [], consequenceRefs: [], description: fact }, evidenceRefs(target));
    const result = await act("close", intent, [close]);
    assertKind(result, "concluded", calls);
    expect(story(target).status).toBe("concluded");
    expect(story(target).conclusions[ACTOR]).toMatchObject({ resolution: outcome, playerIntent: intent });
    expect(state(target).entities[ACTOR].hitPoints).toEqual(before.entities[ACTOR].hitPoints);
    expect(state(target).campaignRuntime.itemSystem).toEqual(before.campaignRuntime.itemSystem);
    const eventsBeforeRetry = target.authorityStore.events().length;
    assertKind(await act("close", intent, [close]), "concluded", calls);
    expect(target.authorityStore.events()).toHaveLength(eventsBeforeRetry);
    expect(calls.narrations.flatMap((n: Data) => n.renderableClaims.claims)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "storyContinuity", transition: "concluded", summary: fact }),
    ]));
    return storyId;
  });
  await evictDurableObject(stub);
  const read = await stub.observe(ALICE) as Data;
  expect(read.readModel.stories).toEqual(expect.arrayContaining([expect.objectContaining({ storyId: id, status: "concluded" })]));
}, 30_000);

it("SPEC 0009 §§8、9: a participant may conclude a shared story and private evidence never leaks to the other viewer", async () => {
  const { stub } = await initialize("story-continuity-private-room", true);
  await scenario(stub, async (act, target, calls) => {
    assertKind(await act("open", "我和鲍勃一起核对遗嘱。", [opening([ACTOR, OTHER]), observation("PRIVATE_CONCLUSION_CANARY")]), "committed", calls);
    assertKind(await act("close", "我结束我的这次调查。", [entry({ kind: "concludeStory", storyRef: story(target).storyId,
      outcome: "success", unresolvedRefs: [], consequenceRefs: [], description: "PRIVATE_CONCLUSION_CANARY" }, evidenceRefs(target))]), "concluded", calls);
    expect(JSON.stringify(await target.observe(BOB))).not.toContain("PRIVATE_CONCLUSION_CANARY");
    expect(JSON.stringify(await target.observe(ALICE))).toContain("PRIVATE_CONCLUSION_CANARY");
  });
});

it("SPEC 0009 §8: abandoning a shared conflict stops only the declaring player's participation", async () => {
  const { stub } = await initialize("story-continuity-shared-room", true);
  await scenario(stub, async (act, target, calls) => {
    assertKind(await act("open", "我们核对遗嘱。", [opening([ACTOR, OTHER])]), "committed", calls);
    const storyId = story(target).storyId;
    assertKind(await act("leave", "我放弃调查，鲍勃可以继续。", [entry({ kind: "concludeStory", storyRef: storyId,
      outcome: "abandoned", unresolvedRefs: [], consequenceRefs: [], description: "阿莱莎放弃了这次调查。" })]), "concluded", calls);
    expect(story(target).status).toBe("open");
    expect(story(target).conclusions).not.toHaveProperty(OTHER);
    // The next participant can end the same story; no creator-only restriction.
    assertKind(await act("bob-leave", "我也放弃调查。", [entry({ kind: "concludeStory", storyRef: storyId,
      outcome: "abandoned", unresolvedRefs: [], consequenceRefs: [], description: "鲍勃放弃了这次调查。" })], BOB), "concluded", calls);
    expect(story(target).status).toBe("concluded");
  });
});

it("SPEC 0009 §8: pending mechanics block only the affected story, and unknown or stale bases never commit", async () => {
  const { stub } = await initialize("story-continuity-pending-room", true);
  await scenario(stub, async (act, target, calls) => {
    assertKind(await act("open", "我开始核对遗嘱。", [opening()]), "committed", calls);
    const { stepStoryContinuity, storyContinuityReadRefs, STORY_CONTINUITY_PLAN_SCHEMA } = await import("../../../app/_runtime/lib/rules/v2/story-continuity");
    const { authorityRevisionOrHash } = await import("../../../app/_runtime/lib/rules/authority-read");
    const source = structuredClone(state(target)), profiles = target.authoritativeReplay().profiles;
    const operation = { kind: "concludeStory", storyRef: story(target).storyId, outcome: "abandoned", unresolvedRefs: [], consequenceRefs: [], description: "阿莱莎放弃调查。" } as const;
    const makeInput = (world: Data) => ({ kind: "storyContinuity", rootActionId: "root:pending-story", actorCharacterId: ACTOR,
      plan: { schema: STORY_CONTINUITY_PLAN_SCHEMA, contextHash: `sha256:${"a".repeat(64)}`, basisRefs: ["wake"], playerIntent: "我放弃调查。", operation,
        readSet: storyContinuityReadRefs(world as never, ACTOR, ["wake"], operation)!.map(ref => ({ ref, revisionOrHash: authorityRevisionOrHash(world as never, ref) })) } });
    for (const mutate of [
      (world: Data) => { world.campaignRuntime.activities["activity:pending"] = { activityId: "activity:pending", characterId: ACTOR, status: "active", activityKind: "actionExecution" }; },
      (world: Data) => { world.pendingInputs["private:pending"] = { controllerCharacterId: ACTOR, rootActionId: "another-act" }; },
      (world: Data) => { world.combatRuntime.encounters["encounter:pending"] = { status: "active", participantEntityIds: [ACTOR], encounterId: "encounter:pending", round: "1", activeEntityId: ACTOR }; },
      (world: Data) => { world.internalContinuations["roll:pending"] = { rootActionId: "another-act", resolutionPlan: { actorCharacterId: ACTOR } }; },
    ]) {
      const pending = structuredClone(source); mutate(pending);
      expect(stepStoryContinuity(profiles, pending as never, makeInput(pending))).toMatchObject({ kind: "rejected", rejection: { message: "story-continuity:pending-mechanics" } });
    }
    const unrelated = structuredClone(source);
    unrelated.campaignRuntime.activities["activity:other"] = { characterId: OTHER, status: "active", activityKind: "rest" };
    // Validation admits this independently; the plain fixture is never folded as a real Activity.
    const { storyContinuityIssues } = await import("../../../app/_runtime/lib/rules/v2/story-continuity");
    expect(storyContinuityIssues(unrelated as never, ACTOR, ["wake"], operation)).toEqual([]);
    // Another player's independent story can open after this plan froze.
    // It changes the catalog, not any dependency of Alice's conclusion.
    const { createEventTransition } = await import("../../../app/_runtime/lib/rules/v2/events");
    const frozen = makeInput(source);
    const otherStory = createEventTransition(source as never, profiles, { rootActionId: "root:independent-story", eventType: "SceneQuestionOpened",
      payload: { sceneQuestionId: "question:other", storyId: "story:other", sceneId: "wake", title: "另一段调查", question: "另一件事能否查清？",
        participantCharacterIds: [OTHER], basisRefs: ["wake"] }, visibilityPolicyId: "visibility:scene-question:question:other", secrecy: "private" });
    expect(stepStoryContinuity(profiles, otherStory.state, frozen).kind).toBe("committed");
    const stale = makeInput(source); source.scenes.wake.name = "Changed after freezing";
    expect(stepStoryContinuity(profiles, source as never, stale)).toMatchObject({ kind: "rejected", rejection: { code: "causalFrontierConflict" } });
    expect(storyContinuityIssues(state(target) as never, ACTOR, ["manuscript:future-win"], operation)).toEqual(expect.arrayContaining([
      expect.objectContaining({ constraint: "story-continuity:established-basis-required" }),
    ]));
  });
});

it("SPEC 0009 §§1、8: archive restoration preserves the conclusion and its exact participant memory", async () => {
  const { stub, capabilities } = await initialize("story-continuity-archive-room");
  const saved = await scenario(stub, async (act, target, calls) => {
    assertKind(await act("open", "我调查遗嘱。", [opening()]), "committed", calls);
    assertKind(await act("close", "我放弃调查。", [entry({ kind: "concludeStory", storyRef: story(target).storyId, outcome: "abandoned",
      unresolvedRefs: [], consequenceRefs: [], description: "阿莱莎放弃了调查。" })]), "concluded", calls);
    expect(Object.values(state(target).knowledge[ACTOR])).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "核对两份遗嘱：阿莱莎放弃了调查。" }),
    ]));
    return structuredClone(state(target));
  });
  const exported = await stub.exportAuthoritativeArchive(capabilities.archiveExport) as Data;
  expect(exported.kind).toBe("exported");
  const restored = env.VNEXT_ROOMS.getByName("story-continuity-archive-restored");
  expect(await restored.restoreAuthoritativeArchive(capabilities.disasterRecovery, exported.storyArchive)).toMatchObject({ kind: "restored" });
  await runInDurableObject(restored, async instance => expect(state(instance as unknown as Data)).toEqual(saved));
});
