import { createAuthoredProbeFixture, freezeAuthoredProbeContext, PROBE_ACTOR, PROBE_TARGET, PROBE_SCENE } from "../../tools/lib/vnext-authored-probe-fixture.mjs";
import { canonicalHash } from "../../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { authorityRevisionOrHash } from "../../app/_runtime/lib/rules/v2/authority-bindings.ts";
import { createStoryRecipes, STORY_CREATION_WORKFLOW_REF } from "../../app/_runtime/lib/room/story-creation/index.ts";

export const ACTOR = PROBE_ACTOR, OTHER = PROBE_TARGET, HARBOR = PROBE_SCENE;
export const ARCHIVE = "scene:story:archive", REMOTE = "scene:story:unrelated";
export const BOATMAN = "npc:story:boatman", CLERK = "npc:story:clerk", ARCHIVIST = "npc:story:archivist", DECEASED = "npc:story:late-clerk";
const ref = id => ({ id, version: "1", hash: canonicalHash({ id }) });
const held = (characterId, knowledgeRef, content) => ({ characterId, knowledgeRef, kind: "sourceClaim", layer: "partial", content,
  visibility: "private", provenanceChain: ["genesis:story-memory"] });
export const fact = (state, id, subjectRefs, value = { text: "已存在的事实。" }, causalParentIds = []) => ({
  id, kind: "historicalFact", subjectRefs, value, visibilityPolicyId: "visibility:room-authority-only", source: "moduleAnchor",
  branchId: state.activeBranchId, validFromEventSeq: "0", causalParentIds,
});

/** Uses the existing Rules initialization and actual RequiredContext freezer.
 * Later mutations are isolated authoritative snapshot fixtures, not world writes. */
export function storyContextFixture(kind = "conflict") {
  const f = createAuthoredProbeFixture(`story-context:${kind}`, {
    additionalScenes: [{ id: ARCHIVE, name: "市政档案馆" }, { id: REMOTE, name: "无关远地" }],
    npcCharacters: [{ id: BOATMAN, name: "林舟" }, { id: CLERK, name: "周吏" },
      { id: ARCHIVIST, name: "许录", mechanical: false }, { id: DECEASED, name: "已故文吏", mechanical: false }],
    characterScenes: { [ARCHIVIST]: ARCHIVE, [DECEASED]: ARCHIVE },
    initialKnowledge: [held(BOATMAN, "knowledge:order", "船夫亲眼见到药船被扣。"),
      held(CLERK, "knowledge:register", "吏员保管征用登记。"), held(ARCHIVIST, "knowledge:source-claim", "听说登记副本被改动，尚未经证实。"),
      held(DECEASED, "knowledge:old-duty", "生前参与了旧登记。"), held(OTHER, "knowledge:private-player", "OTHER_PLAYER_PRIVATE_CANARY")],
  });
  const state = structuredClone(f.state);
  state.entities[DECEASED].tenureStatus = "retired";
  const profile = structuredClone(f.moduleProfile);
  profile.storyBible.coreTruth = "药船征用须遵循登记制度；原卷与运输行签收联由不同机构保管。";
  profile.storyBible.contentBoundary = { tone: "现实利益与调查", failureMeans: "按真实行动结算后果", bannedPatterns: ["不替玩家作出承诺"] };
  profile.storyBible.importantNpcs = [BOATMAN, CLERK, ARCHIVIST, DECEASED].map(id => ({
    entityId: id, sourceNpcId: id, name: state.entities[id].name, publicFace: "本地从业者", goal: "保留有依据的处境。",
    behavioralConstraints: { hostileIf: "伤害当事人", canBePersuaded: "提供可信新材料" }, initialKnowledge: ["角色在起始设定中的知识。"],
    declaredUnknowns: ["起初不知道是谁改动了副本。"], mechanicalAnchor: "普通本地人", voice: "承认所知的范围。", exampleLines: [], startSceneId: state.entities[id].sceneId,
  }));
  profile.storyBible.openBlanks = ["允许补充地方制度执行与未记载经历，不覆盖既有事实。"];
  const { moduleRef, ...profileBody } = profile;
  profile.moduleRef = { profileId: moduleRef.profileId, profileHash: canonicalHash({ ...profileBody, moduleRef: { profileId: moduleRef.profileId } }) };
  state.campaignRuntime.campaign.moduleRef = structuredClone(profile.moduleRef);
  for (const chapter of Object.values(state.campaignRuntime.chapters)) chapter.moduleRef = structuredClone(profile.moduleRef);
  state.canonicalFacts["fact:story:permit"] = fact(state, "fact:story:permit", [BOATMAN, CLERK], { text: "药船可依据原始登记申请豁免。", occurrence: "征用之前" });
  state.canonicalFacts["fact:story:old-register"] = fact(state, "fact:story:old-register", [DECEASED], { text: "已故文吏曾负责原卷。" });
  state.canonicalFacts["fact:story:archive-dispute"] = fact(state, "fact:story:archive-dispute", [ARCHIVIST], { text: "有人声称誊本有误。", truthStatus: "unresolved" }, ["fact:story:old-register"]);
  state.campaignRuntime.relationships["relationship:story:work"] = { subjectIds: [BOATMAN, CLERK], change: "曾一起核对登记", basisFactIds: ["fact:story:permit"] };
  state.campaignRuntime.promises["promise:story:old"] = { promisorId: DECEASED, promiseeId: ARCHIVIST, content: "协助查卷", status: "breached", breachCause: "死亡" };
  state.campaignRuntime.npcPlans["plan:story:clerk"] = { actorRef: CLERK, npcId: CLERK, goal: "核对原卷", status: "scheduled",
    trace: { factRef: "fact:future:must-not-be-loaded", description: "将来执行后才可能出现的痕迹。" } };
  state.campaignRuntime.factions["faction:story:transport"] = { memberRefs: [BOATMAN], name: "运输行", resourceRefs: [] };
  state.campaignRuntime.factionPlans["plan:story:transport"] = { actorRef: "faction:story:transport", goal: "提出异议", status: "scheduled" };
  state.campaignRuntime.sourceClaims["knowledge:source-claim"] = { claimId: "knowledge:source-claim", speakerId: ARCHIVIST,
    content: "档案员转述了尚未经证实的誊本传闻。", truthStatus: "unresolved" };
  state.canonicalFacts["fact:story:absence"] = { ...fact(state, "fact:story:absence", [HARBOR]), kind: "localAbsence",
    value: { scopeRef: HARBOR, scopeRevisionOrHash: authorityRevisionOrHash(state, HARBOR), status: "active",
      selector: { kind: "exactRef", ref: "feature:story:second-gangway" }, basisRefs: [HARBOR] } };
  const source = { ...f, state, moduleProfile: profile };
  const requiredContext = freezeAuthoredProbeContext(source, state, { rootActionId: f.rootActionId,
    intentText: kind === "conflict" ? "我想帮助林舟处理药船征用争议。" : "我准备追查登记副本差异与已故文吏的旧经历。",
    focusRefs: [BOATMAN, CLERK] }).context;
  const recipe = createStoryRecipes(canonicalHash).find(recipe => recipe.ref.id === (kind === "conflict"
    ? "story.method.local-conflict" : "story.method.archive-investigation"));
  const request = { format: "zhuwei.story-request/v1", jobId: `story:${kind}`, opportunityId: `opportunity:${kind}`,
    source: { roomId: state.roomId, runtimeEpochId: state.runtimeEpochId, branchId: state.activeBranchId,
      kind: "playerAction", sourceId: f.rootActionId, budgetAccountId: `budget:${f.rootActionId}` },
    trigger: { kind: "developGoal", goal: requiredContext.intent.text, basisRefs: [BOATMAN] },
    scale: "short", connection: kind === "conflict" ? "local" : "mainStory", methods: [kind],
    scope: { sceneIds: [kind === "conflict" ? HARBOR : ARCHIVE], entityIds: kind === "conflict" ? [BOATMAN, CLERK] : [ARCHIVIST, DECEASED] },
    recipeRefs: [recipe.ref], workflowRef: STORY_CREATION_WORKFLOW_REF, budgetPolicyRef: ref("budget:story-context") };
  // This test-only declaration is explicit; production consumers supply their
  // real producer payload schema from the registered filling surface.
  const capabilityDescriptions = [{ capability: "fixtureMaterializeObject", instructions: "Fixture payload contract, not a world fact.",
    schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false } }];
  return { ...source, requiredContext, request, capabilityDescriptions, maxUnits: 300_000 };
}

export function refreshTrigger(input) {
  const context = structuredClone(input.requiredContext);
  const { contextHash: _old, ...binding } = context.binding;
  binding.stateHash = canonicalHash(input.state);
  binding.baseEventSeq = input.state.version;
  context.binding = { ...binding, contextHash: canonicalHash({ ...context, binding }) };
  return { ...input, requiredContext: context };
}
