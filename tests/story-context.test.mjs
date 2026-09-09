import assert from "node:assert/strict";
import test from "node:test";
import { buildRoomStoryContext, validateRoomStoryContext } from "../app/_runtime/lib/room/story-context.ts";
import { canonicalHash } from "../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { storyContextFixture, refreshTrigger, fact, BOATMAN, CLERK, ARCHIVIST, DECEASED, OTHER, HARBOR, ARCHIVE, REMOTE } from "./fixtures/story-context.mjs";

function ready(input) {
  const result = buildRoomStoryContext(input);
  assert.equal(result.kind, "ready", JSON.stringify(result));
  return result.context;
}
const entry = (context, ref) => context.materials.find(material => material.ref === ref);

test("A01/A02 use one complete authoring Interface for conflict and cross-scene historical investigation", () => {
  for (const variant of ["conflict", "investigation"]) {
    const input = storyContextFixture(variant), before = canonicalHash(input.state), context = ready(input);
    assert.equal(canonicalHash(input.state), before, "context construction has no world writes");
    assert.deepEqual(validateRoomStoryContext({ ...input, context }), { kind: "valid" });
    assert.deepEqual(ready(input), context, "same snapshot and intent produce identical context");
    assert.equal(Object.isFrozen(context.materials[0].content), true);
    assert.equal(entry(context, BOATMAN).kind, "npc");
    assert.equal(entry(context, BOATMAN).content.name, "林舟");
    assert.equal(entry(context, HARBOR).content.combatScene.geometry.schema, "zhuwei.tactical-geometry/v1");
    assert.equal(entry(context, `knowledge:${BOATMAN}:knowledge:order`).content.holderRef, BOATMAN);
    assert.equal(entry(context, `knowledge:${BOATMAN}:knowledge:order`).content.record.objectKind, "sourceClaim");
    assert.deepEqual(entry(context, `knowledge:${BOATMAN}:knowledge:order`).subjectRefs, [BOATMAN]);
    assert.equal(entry(context, `knowledge:${OTHER}:knowledge:private-player`), undefined);
    assert.doesNotMatch(JSON.stringify(context), /OTHER_PLAYER_PRIVATE_CANARY/);
    assert.ok(context.readSet.some(dep => dep.ref === `knowledge-catalog:${BOATMAN}`));
    assert.equal(context.readSet.length > 0, true);
    assert.deepEqual(input.requiredContext.binding.readSet, [], "ordinary empty read-set was not reused");
    assert.equal(entry(context, "story-context:capability:fixtureMaterializeObject").kind, "definition");
    assert.deepEqual(context.supportedCapabilities, ["fixtureMaterializeObject"]);
    const withCompanion = ready({ ...input, request: { ...input.request, scope: { ...input.request.scope,
      entityIds: [...input.request.scope.entityIds, OTHER] } } });
    assert.ok(entry(withCompanion, OTHER), "a visible companion identity is a valid story scope");
    assert.equal(entry(withCompanion, `knowledge:${OTHER}:knowledge:private-player`), undefined);
    if (variant === "investigation") {
      assert.equal(entry(context, DECEASED).content.entity.tenureStatus, "retired");
      assert.equal(entry(context, ARCHIVIST).content.entity.sceneId, ARCHIVE);
      assert.ok(entry(context, "fact:story:old-register"));
      assert.ok(entry(context, "continuity:promises:promise:story:old"));
      assert.equal(entry(context, "fact:story:archive-dispute").content.value.truthStatus, "unresolved");
      assert.equal(entry(context, "continuity:sourceClaims:knowledge:source-claim").content.truthStatus, "unresolved");
    } else {
      assert.ok(entry(context, "continuity:relationships:relationship:story:work"));
      assert.ok(entry(context, "continuity:npcPlans:plan:story:clerk"));
      assert.ok(entry(context, "continuity:factionPlans:plan:story:transport"), "typed faction alias reaches its offstage plan");
      assert.equal(entry(context, "fact:future:must-not-be-loaded"), undefined);
    }
  }
});

test("expired absence cannot become explicit NPC ignorance, and later knowledge preserves its own source", () => {
  const input = storyContextFixture();
  input.state.canonicalFacts["fact:story:absence"].value.scopeRevisionOrHash = "sha256:" + "0".repeat(64);
  input.state.knowledge[BOATMAN]["knowledge:later"] = { ...input.state.knowledge[BOATMAN]["knowledge:order"],
    knowledgeRef: "knowledge:later", acquiredAtFictionMicros: "20", acquiredByEventId: "event:later",
    sourceCharacterId: CLERK, content: "后来听周吏指出改动者，仍是周吏的主张。", provenanceChain: ["event:later"] };
  const context = ready(refreshTrigger(input));
  assert.equal(entry(context, "fact:story:absence").availability, "ambiguous");
  assert.equal(entry(context, `story-context:declared-unknown:${BOATMAN}:0`).availability, "explicitlyUnknown");
  const later = entry(context, `knowledge:${BOATMAN}:knowledge:later`);
  assert.equal(later.availability, "known");
  assert.equal(later.content.record.sourceCharacterId, CLERK);
  assert.equal(later.content.record.objectKind, "sourceClaim");
  assert.equal(later.content.acquisition.timelineId, null);
});

test("new relevant entity, fact, knowledge, relationship and promise members invalidate a saved context", () => {
  for (const kind of ["entity", "fact", "knowledge", "relationship", "promise"]) {
    const input = storyContextFixture(), context = ready(input), state = structuredClone(input.state);
    if (kind === "entity") state.entities["npc:story:new"] = { ...state.entities[BOATMAN], id: "npc:story:new", name: "新成员" };
    if (kind === "fact") state.canonicalFacts["fact:story:new"] = fact(state, "fact:story:new", [BOATMAN], { text: "新增且相关的旧历史约束。" });
    if (kind === "knowledge") state.knowledge[BOATMAN]["knowledge:new"] = { ...state.knowledge[BOATMAN]["knowledge:order"], knowledgeRef: "knowledge:new", content: "后来确实获知的新知识。" };
    if (kind === "relationship") state.campaignRuntime.relationships["relationship:new"] = { subjectIds: [BOATMAN, CLERK], change: "新矛盾" };
    if (kind === "promise") state.campaignRuntime.promises["promise:new"] = { promisorId: BOATMAN, promiseeId: CLERK, content: "新承诺", status: "active" };
    const result = validateRoomStoryContext({ ...input, state, context });
    assert.equal(result.kind, "conflict", kind);
    assert.ok(result.changedRefs.length > 0, kind);
  }
});

test("unrelated changes preserve validation, including after serialization and without an installed writing recipe", () => {
  const input = storyContextFixture(), context = JSON.parse(JSON.stringify(ready(input))), state = structuredClone(input.state);
  state.version = String(Number(state.version) + 20);
  state.entities["npc:unrelated"] = { ...state.entities[BOATMAN], id: "npc:unrelated", sceneId: REMOTE, name: "无关住客" };
  state.canonicalFacts["fact:unrelated"] = fact(state, "fact:unrelated", ["npc:unrelated"], { text: "无关历史改变。" });
  state.campaignRuntime.promises["promise:unrelated"] = { promisorId: "npc:unrelated", promiseeId: "npc:unrelated", content: "当地承诺" };
  assert.deepEqual(validateRoomStoryContext({ request: input.request, context, state, profiles: input.profiles, moduleProfile: input.moduleProfile }), { kind: "valid" });
});

test("explicit unknowns, scoped absence and unresolved historical time stay distinct from positive facts", () => {
  const input = storyContextFixture(), context = ready(input);
  const unknown = entry(context, `story-context:declared-unknown:${BOATMAN}:0`);
  assert.equal(unknown.availability, "explicitlyUnknown");
  assert.equal(unknown.content.holderRef, BOATMAN);
  assert.equal(entry(context, "fact:story:absence").availability, "scopedAbsent");
  assert.equal(entry(context, `story-context:open:${HARBOR}`).availability, "open");
  const knowledge = entry(context, `knowledge:${BOATMAN}:knowledge:order`);
  assert.equal(knowledge.content.acquisition.timelineId, null);
  assert.equal(knowledge.content.acquisition.status, "timelineUnresolved");
  assert.equal(knowledge.content.acquisition.micros, knowledge.content.record.acquiredAtFictionMicros);
  assert.equal(entry(context, "fact:story:permit").content.value.occurrence, "征用之前");
  assert.equal(entry(context, "fact:story:permit").content.occurrenceTime, undefined);
  const withoutGrant = storyContextFixture();
  withoutGrant.moduleProfile.storyBible.openBlanks = [];
  const { moduleRef, ...body } = withoutGrant.moduleProfile;
  withoutGrant.moduleProfile.moduleRef = { profileId: moduleRef.profileId, profileHash: canonicalHash({ ...body, moduleRef: { profileId: moduleRef.profileId } }) };
  withoutGrant.state.campaignRuntime.campaign.moduleRef = withoutGrant.moduleProfile.moduleRef;
  const closed = ready(refreshTrigger(withoutGrant));
  assert.equal(closed.materials.some(material => material.availability === "open"), false);
  assert.equal(closed.materials.some(material => material.ref.includes("search-miss")), false);
});

test("missing causal parents, foreign-holder records and invalid source authority block complete preparation", () => {
  for (const kind of ["parent", "holder", "room", "basis", "otherPlayer", "module"]) {
    let input = storyContextFixture();
    if (kind === "parent") input.state.canonicalFacts["fact:story:permit"].causalParentIds = ["fact:missing-parent"];
    if (kind === "holder") input.state.knowledge[BOATMAN]["knowledge:order"].characterId = CLERK;
    if (kind === "room") input.request.source.roomId = "room:foreign";
    if (kind === "basis") input.request.trigger.basisRefs = ["fact:unread-secret"];
    if (kind === "otherPlayer") input.request.trigger.basisRefs = [`knowledge:${OTHER}:knowledge:private-player`];
    if (kind === "module") input.moduleProfile.storyBible.coreTruth = "改写但没有新版本的核心真相。";
    input = refreshTrigger(input);
    const result = buildRoomStoryContext(input);
    assert.equal(result.kind, "blocked", kind);
    assert.equal("context" in result, false, "no partial context escapes");
  }
});

test("incomplete or forged dependencies cannot be repaired by changing a context hash", () => {
  const input = storyContextFixture(), frozen = ready(input);
  for (const tamper of ["dependency", "scope", "body", "schema"]) {
    const context = structuredClone(frozen), request = structuredClone(input.request);
    if (tamper === "dependency") context.readSet = context.readSet.filter(dep => dep.ref !== "story-context:scope-members");
    if (tamper === "scope") request.scope.entityIds = [];
    if (tamper === "body") entry(context, BOATMAN).content.name = "另一个人";
    if (tamper === "schema") context.materials.push({ ref: "forged:capability", kind: "fact", availability: "known", content: "伪造正文", subjectRefs: [], basisRefs: [] });
    const { contextHash: _old, ...body } = context;
    context.contextHash = canonicalHash(body);
    assert.equal(validateRoomStoryContext({ ...input, request, context }).kind, "conflict", tamper);
  }
});

test("context budget, invalid capability schema and ambiguity fail closed before any model call", () => {
  const input = storyContextFixture(), before = canonicalHash(input.state);
  assert.deepEqual(buildRoomStoryContext({ ...input, maxUnits: 1 }).code, "STORY_BUDGET_EXHAUSTED");
  assert.equal(buildRoomStoryContext({ ...input, capabilityDescriptions: [{ capability: "bad", schema: { type: "string" } }] }).code, "STORY_CAPABILITY_UNSUPPORTED");
  assert.equal(buildRoomStoryContext({ ...input, capabilityDescriptions: [...input.capabilityDescriptions, ...input.capabilityDescriptions] }).kind, "blocked");
  const ambiguous = structuredClone(input.requiredContext);
  ambiguous.entries.push({ kind: "ambiguous", entryRef: "ambiguity:story", obligation: "target", resolution: "clarificationRequired",
    candidates: [{ ref: BOATMAN, matchKind: "alias", score: 1, basisRefs: [BOATMAN] }], frontierExhausted: true, viewerSafe: true });
  assert.equal(buildRoomStoryContext(refreshTrigger({ ...input, requiredContext: ambiguous })).kind, "blocked");
  assert.equal(canonicalHash(input.state), before);
});
