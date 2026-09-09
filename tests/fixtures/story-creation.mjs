import { canonicalHash } from "../../app/_runtime/lib/kp/vnext/canonical-json.ts";
import { createStoryRecipes, STORY_CREATION_WORKFLOW_REF } from "../../app/_runtime/lib/room/story-creation/index.ts";

export const hashStory = canonicalHash;
const version = id => ({ id, version: "1", hash: hashStory({ id, version: "1" }) });
const material = (ref, kind, content, subjectRefs = [], availability = "known") => ({
  ref, kind, content, subjectRefs, availability, basisRefs: [],
});
const at = micros => ({ kind: "at", start: { timelineId: "timeline:local", micros }, end: null,
  basisRefs: ["fact:calendar"] });

/** Complete authored examples, not production fixtures for mechanics. The
 * NPC payload deliberately uses a declared fixture contract; host admission
 * tests must replace it with their real materializeNpc source vocabulary. */
export function storyFixture(kind = "conflict") {
  const investigation = kind === "investigation";
  const long = kind === "long";
  const recipes = createStoryRecipes(hashStory);
  const selected = recipes.filter(recipe => recipe.ref.id === (investigation
    ? "story.method.archive-investigation" : "story.method.local-conflict")
    || (investigation && recipe.ref.id === "story.focus.new-participant")
    || (long && recipe.ref.id === "story.scale.long"));
  const scene = investigation ? "scene:archive" : "scene:harbor";
  const npc = investigation ? "candidate:archivist" : "npc:boatman";
  const contextBody = {
    format: "zhuwei.story-context/v1", runtimeRef: version("fixture.runtime"), moduleRef: version("fixture.module"),
    materials: [
      material("anchor:requisition", "anchor", { text: "河港由市议会征用运输；命令须登记，船夫可提出异议。药物短缺与旧采购案已有联系。" }),
      material("boundary:table", "contentBoundary", { text: "不描写儿童伤害细节，个人决定由玩家作出。" }),
      material("open:local-history", "fact", { text: "允许补充未记载的地方运输经历、登记差错及新人物，不覆盖已知经历。" }, [scene], "open"),
      material("fact:calendar", "fact", { text: "当前本地虚构时刻为1000，征用登记发生于600。", timelineId: "timeline:local", micros: "1000" }, [scene]),
      material(scene, "location", { name: investigation ? "市政档案馆" : "东河码头", space: investigation ? "登记厅连接阅览室与有权限限制的库房。" : "装卸岸线、潮湿坡道和临时征用岗。" }, [scene]),
      material("npc:boatman", "npc", { name: "林舟", age: 38, background: "成年后在港口运药，未离开本地三十年。", goals: ["保住生计和船员工资"], currentPlace: scene }, ["npc:boatman"]),
      material("npc:clerk", "npc", { name: "周吏", goals: ["按合法征用令办事", "避免失职"], currentPlace: scene }, ["npc:clerk"]),
      material("knowledge:boatman-order", "knowledge", { holderRef: "npc:boatman", text: "自己昨日前来登记时看到船只被暂扣。" }, ["npc:boatman"]),
      material("knowledge:clerk-register", "knowledge", { holderRef: "npc:clerk", text: "原始登记卷由本人保管，盖章副本可能有誊录错误。" }, ["npc:clerk"]),
      material("record:ledger", "fact", { text: "未修改的原始登记卷。" }, [scene]),
      material("record:receipt", "fact", { text: "运输行独立保管的签收联。" }, [scene]),
      material("unknown:boatman-culprit", "knowledge", { holderRef: "npc:boatman", text: "林舟明确不知道谁修改了登记副本。", at: { timelineId: "timeline:local", micros: "800" } }, ["npc:boatman"], "explicitlyUnknown"),
      material("contract:materializeObject", "definition", { capability: "materializeObject", instructions: "Fixture contract for a physical scene object.",
        schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false } }),
      material("contract:materializeNpc", "definition", { capability: "materializeNpc", instructions: "Fixture contract only; never claim this is the production Rules NPC schema.",
        schema: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, capabilities: { type: "array", items: { type: "string" } },
          initialKnowledge: { type: "array", items: { type: "string" } }, resources: { type: "array", items: { type: "string" } } },
          required: ["name", "role", "capabilities", "initialKnowledge", "resources"], additionalProperties: false } }),
    ],
    readSet: [], timelines: [{ timelineId: "timeline:local", micros: "1000" }],
    supportedCapabilities: ["materializeObject", "materializeNpc"], missingRequiredRefs: [],
  };
  contextBody.readSet = contextBody.materials.map(entry => ({ kind: entry.kind === "npc" ? "entity" : entry.kind === "knowledge" ? "knowledge" : "fact",
    ref: entry.ref, revision: "1", hash: hashStory(entry) }));
  const context = { ...contextBody, contextHash: hashStory(contextBody) };
  const request = {
    format: "zhuwei.story-request/v1", jobId: `story:${kind}`, opportunityId: `opportunity:${kind}`,
    source: { roomId: "room:story", runtimeEpochId: "epoch:story", branchId: "branch:original", kind: "playerAction",
      sourceId: `action:${kind}`, budgetAccountId: "budget:root" },
    trigger: { kind: "developGoal", goal: investigation ? "追查登记副本为何与药品签收联不一致。" : "了解林舟的药船为何被征用，并寻找可行的处理办法。",
      basisRefs: ["anchor:requisition", "npc:boatman"] },
    scale: long ? "long" : "short", connection: investigation ? "mainStory" : "local",
    methods: [investigation ? "archive-investigation" : "local-conflict"], scope: { sceneIds: [scene], entityIds: ["npc:boatman", "npc:clerk"] },
    recipeRefs: selected.map(recipe => recipe.ref), workflowRef: STORY_CREATION_WORKFLOW_REF, budgetPolicyRef: version("story-budget.fixture"),
  };
  const factRef = "candidate:registration-fact", knowledgeRef = "candidate:witness-memory";
  const body = {
    title: investigation ? "被改动的登记副本" : "征用令下的药船",
    cause: investigation ? "库房中的誊录副本遗漏了豁免药品一栏，签收联与原始卷宗因此不一致。" : "军需运输占用了药船，码头吏员按副本拒绝放行，原卷上的药物豁免未被传达。",
    centralQuestion: investigation ? "如何证明副本遗漏并让有权者更正记录？" : "如何在征用与当地救济之间取得能履行的安排？",
    worldConnection: "既有征用制度、船夫生计与药物短缺在同一登记问题上发生冲突；主线联系可从采购记录继续调查。",
    existingFactRefs: ["anchor:requisition", "record:ledger", "record:receipt"],
    facts: [{ ref: factRef, layer: "worldTruth", content: "原始登记卷的药品豁免栏没有誊入此次使用的副本。",
      subjectRefs: [scene, npc, "npc:clerk"], occurrence: at("600"), basisRefs: ["open:local-history", "record:ledger"],
      creationBasis: "authorizedOpenSpace", knowledge: [{ ref: knowledgeRef, holderRef: npc, factRef, layer: "sensoryEvidence",
        content: "看到原卷有药品豁免栏，而使用中的副本没有。", sourceRef: "record:ledger", acquisition: at("700"),
        explanation: investigation ? "整理档案时比较原卷与当日抄件而看到差异；不知道谁造成了遗漏。" : "登记时偶然看到了两份表单的区别；不知道遗漏者身份。" }] }],
    participants: [{ ref: npc, identity: investigation ? "new" : "existing", label: investigation ? "许录" : "林舟",
      participationReason: investigation ? "保管原卷的新任档案员担心有人借错误记录索取利益。" : "自己的药船被扣，收入与受托运药都受到影响。",
      goal: investigation ? "让证据被按程序核查而不损毁档案。" : "保住船与合法运药机会。", concerns: ["越权行动会让申诉失去可信度。"],
      resources: investigation ? ["可申请调阅原始登记卷", "熟悉卷宗索引"] : ["熟悉航道", "仍有可用船员"],
      relationships: [{ otherRef: "npc:clerk", description: "需要负责征用的吏员接受可核查材料。", basisRefs: ["anchor:requisition"] }],
      knowledgeRefs: [knowledgeRef, ...(investigation ? [] : ["knowledge:boatman-order"])], nextIntention: "先请求重新核对原卷，失败再寻找有权接受异议的人。", voice: "说话具体，先讲亲眼看到的事情，再承认不知道的部分。" },
      { ref: "npc:clerk", identity: "existing", label: "周吏", participationReason: "承担执行征用与登记核验责任。", goal: "有据可查地完成征用。",
        concerns: ["没有文书依据不能擅自放船。"], resources: ["登记权限", "可以向上级申请修正"], relationships: [],
        knowledgeRefs: ["knowledge:clerk-register"], nextIntention: "等待可核验的原卷或运输凭据；没有新信息仍按当前命令办事。", voice: "措辞谨慎，反复区分有依据的事与传闻。" }],
    definitions: investigation ? [{ ref: npc, kind: "npc", capability: "materializeNpc", payload: { name: "许录", role: "档案员",
      capabilities: ["整理档案"], initialKnowledge: [], resources: ["登记索引"] }, dependsOn: [scene, "anchor:requisition"] }] : [],
    opportunities: [{ ref: "opportunity:hear-dispute", contact: investigation ? "查卷时档案员指出原卷与副本可以对照。" : "与熟识船夫交谈时得知船被暂扣，玩家可查看公开征用通知。",
      understandableStake: "能否按时运药，以及谁要承担合法程序中的时间和损失。", basisRefs: [npc, "anchor:requisition"] }],
    scenes: [{ ref: "scene-preparation:inspection", locationRef: scene, question: "是否能取得足以让吏员重核登记的材料？",
      space: investigation ? "阅览桌邻近值班席，原卷在需许可的库房，公开副本可当场查阅。" : "船泊在征用岗附近，公告可阅读，货物装卸需要许可。",
      interactables: [{ ref: npc, description: "可询问亲历、请求帮助或说明别的办法。", definitionRefs: investigation ? [npc] : [] },
        { ref: "record:receipt", description: "运输行签收联可向保管者申请核对。", definitionRefs: [] }],
      pressure: "只有虚构时间与已生效计划会推进征用，单纯思考或生成延迟不会使船离港。",
      exitConditions: ["证据已经足够且玩家决定处理方法。", "玩家离开或明确不再调查。"], participation: "一人核对文书时，其余玩家可接触当事人或提出自己的行动；私人发现分别投影。" }],
    evidence: [{ ref: "evidence:exemption", conclusion: "当前副本缺少药品豁免栏。", requiredForProgress: true,
      sources: [{ ref: "record:ledger", independenceBasis: "市政原卷独立保存原始字段。", access: "说明查询目的并取得值班员许可；公开索引可直接阅读。", basisRefs: ["record:ledger"] },
        { ref: "record:receipt", independenceBasis: "运输行在交货时另行保管签收联，不是当前副本的再抄件。", access: "向运输行保管者申请核验或请其当场证明。", basisRefs: ["record:receipt"] }],
      corroboration: "比较两个独立保管系统中的日期、批号和豁免字段。", failureAlternatives: "调卷未获许可可以找签收方作证，或先承担延迟再申请正式异议；无法证明也可以改谈替代运力。" }],
    developments: [{ ref: "development:clerk-review", actorRef: "npc:clerk", intention: "在收到可核验材料后向有权者请求重新审定。",
      trigger: "亲自取得并核验新材料后，按实际计划形成与到期合同处理。", basisRefs: ["npc:clerk", "anchor:requisition"],
      knowledgeRefs: ["knowledge:clerk-register"], observableTraces: ["真正执行后登记处会留下有日期和来源的核验记录。"],
      changeConditions: ["新信息不足、上级明确否决或可用运力改变时重新判断下一步。"], execution: "pendingWorldAdjudication" }],
    resolutions: [{ ref: "resolution:agreement", condition: "各方依据可验证事实接受并实际执行一种可行安排。", result: "以真实交付、放行或替代运力确认局部成果。",
      persistentConsequences: ["履行或未履行的承诺、人物知情与实际损失继续保存。"] },
      { ref: "resolution:lost-window", condition: "合法世界推进使机会消失，或者参与者真实停止追求当前目标。", result: "承认本次目标未完成，展示已发生的影响而不追加幕后黑手。",
        persistentConsequences: ["船只、药物与人物状态依实际事件保留；玩家日后返回面对同一世界。"] }],
    stages: long ? [{ ref: "stage:release", question: "本批药物能否合法离港？", result: "得到真实放行、替代运输或失败结论。", continuation: "从实际剩余资源与关系讨论下一批救济。", stoppingPoint: "本批去向已确定，允许停在尾声。" },
      { ref: "stage:relief", question: "后续救济能否形成不再依赖临时豁免的安排？", result: "实际完成长期协商，或承认持续方案失败。", continuation: "只有玩家选择继续且世界存在新问题时开启新的冒险。", stoppingPoint: "长期方案的现实结果已成立，展示回响并结束。" }] : [],
    notApplicable: [...(investigation ? [] : [{ path: "/definitions", reason: "本次复用现有人物、地点与文书，不准备新增机械定义。" }]),
      ...(long ? [] : [{ path: "/stages", reason: "这是局部完整短篇，结束依据由resolutions表达。" }])],
    hostingNotes: "根据人物当前状态取回准备，不执行预定场景顺序。公开信息先经固化与Viewer投影。放弃不是违约；已有承诺按实际依赖与知情产生后果，不能追收模型成本。",
  };
  const fixture = { request, context, body, recipes };
  return { ...fixture, review: storyReviewBody(fixture) };
}

export function storyReviewBody(fixture) {
  return {
    findings: [
      { category: "completeness", candidatePaths: ["/cause", "/scenes", "/resolutions"], explanation: "起因、可行动场景和局部收束均有具体材料。" },
      { category: "worldConsistency", candidatePaths: ["/facts", "/participants"], explanation: "补白属于登记经历的开放范围，没有改写既有制度与船夫年龄。" },
      { category: "knowledge", candidatePaths: ["/facts/0/knowledge", "/participants"], explanation: "亲见时间与取得时间可比较；看到登记差异不意味着知道造成差异的人。" },
      { category: "playability", candidatePaths: ["/evidence", "/opportunities"], explanation: "原卷与运输签收联有独立保管来源，失败后可以换取证方法或改谈运力。" },
      { category: "mechanics", candidatePaths: ["/definitions", "/developments"], explanation: "定义按所给fixture契约准备，计划保持待裁决；这里不声称实际Rules已接受。" },
      { category: "playerAgency", candidatePaths: ["/hostingNotes", "/resolutions"], explanation: "允许拒绝、协商、第三种办法和提前结束，不替玩家承诺或要求回主线。" },
    ].map(finding => ({ ...finding, verdict: "pass", constraintRefs: ["anchor:requisition", "unknown:boatman-culprit"], repairable: false })),
    recipeCriteria: fixture.request.recipeRefs.flatMap(ref => fixture.recipes.find(recipe => recipe.ref.id === ref.id).reviewCriteria
      .map(criterion => ({ recipeId: ref.id, criterion, verdict: "pass", explanation: `在局势、证据和收束材料中核对：${criterion}。` }))),
  };
}

export function storyResponse(body, stage = "draft") {
  const review = stage === "review" || stage === "revisionReview";
  const encoded = structuredClone(body);
  if (!review) {
    for (const definition of encoded.definitions ?? []) definition.payload = JSON.stringify(definition.payload);
    for (const fact of encoded.facts ?? []) {
      if (fact.occurrence?.end === null) fact.occurrence.end = { kind: "none" };
      for (const knowledge of fact.knowledge ?? []) if (knowledge.acquisition?.end === null) knowledge.acquisition.end = { kind: "none" };
    }
  }
  return { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null,
    tool_calls: [{ id: `call:${stage}`, type: "function", function: {
      name: review ? "review_story_preparation" : "submit_story_preparation", arguments: JSON.stringify(encoded),
    } }] } }], usage: { prompt_tokens: 100, completion_tokens: 200 } };
}
