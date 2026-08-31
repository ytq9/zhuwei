import assert from "node:assert/strict";
import test from "node:test";

import {
  KP_FORM_CATALOG_REGISTRATION,
  KP_FORM_IDS,
  buildKpFormToolParameters,
  canonicalKpFormCatalogHash,
  formCatalogRegistrationMatchesCanonicalDocument,
  isForbiddenModelField,
  kpFormIdForToolName,
  kpFormToolName,
  modelFormDescriptors,
  selectAllowedKpForms,
  validateKpFormDraft,
} from "../app/_runtime/lib/kp/form-catalog.ts";
import {
  CAUSAL_ACTION_LANGUAGE_PROFILE,
  CAUSAL_PRIMITIVES,
  compileKpFormDraft,
  kpFormBindingHash,
  lowerCausalActionProgram,
  stableStructuralHash,
  validateCausalActionProgram,
} from "../app/_runtime/lib/kp/causal-action-program.ts";
import {
  buildContextPack,
  createRequiredContext,
} from "../app/_runtime/lib/kp/context-pack.ts";
import {
  buildStaticRetrievalIndex,
  chineseBigrams,
  createDeterministicFtsAdapter,
  createStaticRetrievalRequest,
  rehydrateStaticContext,
  retrieveStaticReferences,
} from "../app/_runtime/lib/kp/static-retrieval.ts";
import {
  CONTEXT_PLANNER_VALIDATION_GATES,
  createContextPlannerRoleValidationEvidence,
  createDeterministicPlannerAdapter,
  createDisabledPlannerAdapter,
  createModelPlannerAdapter,
  createModelProfileRegistry,
  runContextPlanner,
  validatedProfilesForRole,
} from "../app/_runtime/lib/kp/model-registry.ts";
import {
  CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION,
  CONTEXT_PLANNER_TOOL_NAME,
} from "../app/_runtime/lib/kp/context-planner-policy.ts";
import {
  privateFormProposalModelInput,
  privateFormRepairModelInput,
} from "../app/_runtime/lib/kp/private-form-policy.ts";

const EXACT_FORM_IDS = [
  "clarification.v1",
  "observe.v1",
  "npc-exchange.v1",
  "ordinary-check.v1",
  "high-risk-action.v1",
  "in-world-refusal.v1",
  "materialization.v1",
  "combat-action.v1",
  "environmental-stunt.v1",
  "compound.v1",
];

const VALID_FORM_DRAFTS = Object.freeze({
  "clarification.v1": {
    goal: "确定玩家想保护证物还是追赶逃犯",
    question: "你优先保护证物，还是追赶逃犯？",
    choices: ["保护证物", "追赶逃犯"],
  },
  "observe.v1": {
    goal: "找出钟架最近被移动的痕迹",
    method: "检查泥地和金属底座",
    focus: "钟架周边",
    desiredInformation: "移动方向与大致时间",
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  },
  "npc-exchange.v1": {
    goal: "让守卫暂时离开回廊",
    method: "以失火风险说服他检查厨房",
    utterance: "厨房有焦味，你最好立刻看看。",
    desiredResponse: "守卫前往厨房核实",
    npcResponse: "守卫皱眉嗅了嗅空气，转身快步走向厨房。",
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  },
  "ordinary-check.v1": {
    goal: "安静移开木箱",
    method: "垫上雨披后缓慢拖动",
    intendedOutcome: "露出木箱后的门",
    risk: "雨披可能撕裂并发出声音",
    resolution: "check",
    ability: "str",
    skill: "athletics",
    dc: 12,
    mode: "normal",
    durationUnit: "minute",
    durationValue: 1,
    successConsequence: "木箱被无声移开，暗门显露。",
    failureConsequence: "木箱摩擦石地，惊动邻近守卫。",
  },
  "high-risk-action.v1": {
    goal: "穿过正在坍塌的吊桥",
    method: "抓住主索快速荡到对面",
    intendedOutcome: "在桥面断裂前抵达对岸",
    risk: "失手会跌入峡谷",
    stakes: "同伴将失去撤离路线",
    resolution: "check",
    ability: "dex",
    skill: "acrobatics",
    dc: 17,
    mode: "normal",
    durationUnit: "round",
    durationValue: 1,
    successConsequence: "角色在断裂前抵达对岸。",
    failureConsequence: "角色坠落并承受峡谷危险。",
  },
  "in-world-refusal.v1": {
    goal: "徒手搬起整座城门",
    method: "仅凭双手从下方抬起城门",
    reason: "城门重量远超凡人力量",
    alternatives: ["寻找绞盘", "破坏门轴"],
    durationUnit: "round",
    durationValue: 1,
  },
  "materialization.v1": {
    goal: "寻找可阻断追兵的物件",
    method: "检查仓库日常装卸设施",
    proposedFact: "门边有一辆空载手推车",
    basisRefs: ["scene:working-warehouse"],
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 1,
  },
  "combat-action.v1": {
    goal: "迫使持弩者离开射击位置",
    method: "压低身形冲向掩体并进行压制",
    intendedOutcome: "为同伴创造通过门口的机会",
    combatApproach: "压制与移动",
    abilityRef: "ability:combat:shove",
  },
  "environmental-stunt.v1": {
    goal: "让吊灯坠落阻断追兵",
    method: "射断悬挂吊灯的锁链",
    featureDescription: "大厅中央的重型铁制吊灯",
    intendedOutcome: "吊灯坠落并形成残骸障碍",
    featureDisposition: "reasonable-open-blank",
    basisRefs: ["scene:grand-hall"],
    effectMode: "area-hazard",
    activation: "attack",
    attackApproach: "ranged",
    abilityRef: "ability:combat:longbow",
    material: "锻铁与玻璃",
    centerXInches: 600,
    centerYInches: 480,
    elevationInches: 720,
    widthInches: 120,
    depthInches: 120,
    heightInches: 48,
    objectAc: 19,
    objectHitPoints: 18,
    damageThreshold: 5,
    immuneDamageTypes: ["poison", "psychic"],
    initialPhase: "suspended",
    phaseNames: ["suspended", "falling", "debris"],
    phaseOpaque: [false, false, false],
    phaseImpassable: [false, false, true],
    phaseCover: ["none", "none", "half"],
    phaseEffectPropagation: ["passes", "passes", "passes"],
    phaseTerrain: ["normal", "normal", "rubble"],
    damageFromPhases: ["suspended"],
    damageRemainingAtOrBelow: [0],
    damageToPhases: ["falling"],
    hazardFromPhases: ["falling"],
    hazardToPhases: ["debris"],
    hazardTriggerPhase: "falling",
    hazardResolvedPhase: "debris",
    trigger: "悬挂锁链被破坏",
    areaOriginElevationInches: 0,
    areaRadiusInches: 180,
    propagation: "straight",
    saveAbility: "dex",
    saveDc: 14,
    halfOnSuccess: false,
    damage: "2d10",
    damageType: "bludgeoning",
    condition: "prone",
    debrisOutcome: "该区域成为困难地形",
  },
  "compound.v1": {
    goal: "无声移动钟架后伪造巡检痕迹",
    method: "分阶段利用雨披、木杆和旧封条",
    stages: [
      { goal: "隔绝摩擦", method: "把雨披铺在底座下", intendedOutcome: "拖动时不接触石地", resolution: "direct" },
      { goal: "移动钟架", method: "以木杆缓慢撬动", intendedOutcome: "钟架抵达墙根", resolution: "direct" },
      { goal: "掩盖行动", method: "在原位放置旧封条", intendedOutcome: "留下可解释痕迹", resolution: "direct" },
    ],
    intendedOutcome: "钟架被移动且短时间不引起怀疑",
    resolution: "direct",
    durationUnit: "minute",
    durationValue: 10,
  },
});

test("private catalog has exactly ten forms and exposes only deterministic 3-6 allowlists", () => {
  assert.deepEqual(KP_FORM_IDS, EXACT_FORM_IDS);
  assert.equal(KP_FORM_CATALOG_REGISTRATION.formCount, 10);
  assert.equal(
    KP_FORM_CATALOG_REGISTRATION.catalogHash,
    canonicalKpFormCatalogHash(),
  );
  assert.equal(formCatalogRegistrationMatchesCanonicalDocument(), true);

  const cases = [
    {},
    { interaction: "observe", preferredCount: 3 },
    { interaction: "npc-exchange", risk: "high", preferredCount: 4 },
    { interaction: "combat", mayUseEnvironment: true, preferredCount: 6 },
    { serverSelectedForm: "clarification.v1", mayNeedRefusal: true, preferredCount: 5 },
  ];
  for (const signals of cases) {
    const first = selectAllowedKpForms(signals);
    const second = selectAllowedKpForms({ ...signals });
    assert.deepEqual(first, second);
    assert.ok(first.length >= 3 && first.length <= 6);
    assert.equal(new Set(first).size, first.length);
    assert.ok(first.includes("compound.v1"));

    const descriptors = modelFormDescriptors(first);
    assert.equal(descriptors.length, first.length);
    assert.equal(Object.hasOwn(descriptors[0], "catalogHash"), false);
    for (const key of recursiveKeys(descriptors)) assert.equal(isForbiddenModelField(key), false, key);
    const toolNames = first.map(kpFormToolName);
    assert.equal(new Set(toolNames).size, first.length);
    for (const [index, formId] of first.entries()) {
      assert.equal(kpFormIdForToolName(toolNames[index]), formId);
      const parameters = buildKpFormToolParameters(formId);
      for (const key of recursiveKeys(parameters)) {
        assert.equal(isForbiddenModelField(key), false, key);
      }
      assert.equal(recursiveKeys(parameters).includes("oneOf"), false);
      assert.equal(recursiveKeys(parameters).includes("formId"), false);
      assert.equal(recursiveKeys(parameters).includes("draft"), false);
      assert.equal(validateKpFormDraft(formId, VALID_FORM_DRAFTS[formId]).ok, true);
    }
    const notAllowed = EXACT_FORM_IDS.find((formId) => !first.includes(formId));
    if (notAllowed !== undefined) {
      assert.equal(toolNames.includes(kpFormToolName(notAllowed)), false);
    }
  }

  const forbiddenDraft = {
    ...VALID_FORM_DRAFTS["ordinary-check.v1"],
    actorRef: "character:alice",
    detail: { actualTargetIds: ["npc:hidden"] },
  };
  const validation = validateKpFormDraft("ordinary-check.v1", forbiddenDraft);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes("actorRef:authority-field-forbidden")));
  assert.ok(validation.errors.some((error) => error.includes("actualTargetIds:authority-field-forbidden")));
  assert.equal(validateKpFormDraft("ordinary-check.v1", {
    ...VALID_FORM_DRAFTS["ordinary-check.v1"],
    risk: { description: "open object is not part of the closed form" },
  }).ok, false);

  const stateOnly = structuredClone(VALID_FORM_DRAFTS["environmental-stunt.v1"]);
  stateOnly.effectMode = "state-only";
  stateOnly.activation = "direct";
  delete stateOnly.attackApproach;
  delete stateOnly.abilityRef;
  stateOnly.stuntFromPhases = [stateOnly.initialPhase];
  stateOnly.stuntToPhases = ["debris"];
  for (const field of [
    "hazardFromPhases", "hazardToPhases", "hazardTriggerPhase", "hazardResolvedPhase",
    "areaOriginElevationInches", "areaRadiusInches", "propagation", "spreadBudgetInches",
    "saveAbility", "saveDc", "halfOnSuccess", "damage", "damageType", "condition",
    "debrisOutcome",
  ]) delete stateOnly[field];
  assert.equal(validateKpFormDraft("environmental-stunt.v1", stateOnly).ok, true);
  assert.equal(validateKpFormDraft("environmental-stunt.v1", {
    ...stateOnly,
    saveDc: 13,
  }).errors.includes("saveDc:state-only-forbidden"), true);
  const incompleteHazard = structuredClone(VALID_FORM_DRAFTS["environmental-stunt.v1"]);
  delete incompleteHazard.damage;
  assert.equal(validateKpFormDraft("environmental-stunt.v1", incompleteHazard).errors
    .includes("damage:area-hazard-required"), true);
  const baselessOpenBlank = structuredClone(VALID_FORM_DRAFTS["environmental-stunt.v1"]);
  delete baselessOpenBlank.basisRefs;
  assert.equal(validateKpFormDraft("environmental-stunt.v1", baselessOpenBlank).errors
    .includes("basisRefs:environment-required"), true);
  assert.throws(() => modelFormDescriptors(["observe.v1", "ordinary-check.v1"]), /ALLOWLIST_SIZE/);
});

test("environment proposal policy asks KP for arbitrary content and an explicit mechanical mode", () => {
  const input = privateFormProposalModelInput({
    request: { rootActionId: "root:custom-environment", attempt: 1 },
    allowedForms: [
      "ordinary-check.v1",
      "environmental-stunt.v1",
      "compound.v1",
    ],
    contextPack: { required: { originalIntent: "把眼前的结构改造成一道障碍" } },
  });
  const policy = input.messages[0].content;
  assert.match(policy, /没有任何按对象名称、关键词、家族或原型分派的预设内容/u);
  assert.match(policy, /自行定义对象内容/u);
  assert.match(policy, /state-only 只改变环境状态、地形、掩护或通行/u);
  assert.match(policy, /area-hazard 才继续冻结触发、区域、豁免、伤害和残骸机械/u);
  assert.match(policy, /不得按玩家措辞、对象标签、能力名称或别名猜测机械引用/u);
  assert.doesNotMatch(policy, /吊灯|油桶/u);
});

test("private Form policy keeps player premise questions direct while preserving KP open-world authority", () => {
  const input = privateFormProposalModelInput({
    request: { rootActionId: "root:character-premise", attempt: 1 },
    allowedForms: ["observe.v1", "materialization.v1", "compound.v1"],
    contextPack: { required: { intent: { text: "我是来做什么的" } } },
  });
  const policy = input.messages[0].content;
  assert.match(policy, /你仍然拥有叙事权威/u);
  assert.match(policy, /合理开放留白中，可以即时创作/u);
  assert.match(policy, /不得替玩家决定当前目标、思想或情绪，也不得要求无意义检定/u);
  assert.match(policy, /materialization\.v1 的 direct/u);
  assert.match(policy, /method 精确填 establishCharacterPremise/u);
  assert.match(policy, /zhuwei\.character-premise-draft\/v2/u);
  assert.match(policy, /角色前提只是允许的来源之一，不是专用 NPC 通道/u);
  assert.match(policy, /旧通用 dynamic:npc 定义/u);
  assert.match(policy, /不按名称、职业、语言或任何示例关键词触发/u);
});

test("product 0.4 private materialization exposes only the current typed NPC and item protocols", () => {
  const allowedForms = ["observe.v1", "materialization.v1", "compound.v1"];
  const currentParameters = buildKpFormToolParameters("materialization.v1");
  const currentRepairParameters = buildKpFormToolParameters("materialization.v1");
  assert.equal(proposedFactSchema(currentParameters).maxLength, 8_000);
  assert.equal(proposedFactSchema(currentRepairParameters).maxLength, 8_000);

  const descriptor = modelFormDescriptors(allowedForms)
    .find(({ id }) => id === "materialization.v1");
  assert.match(descriptor.purpose, /exact typed JSON drafts/u);
  assert.match(descriptor.purpose, /healing-potion materialization/u);

  const v5Proposal = privateFormProposalModelInput({
    request: { rootActionId: "root:v5-materialization", attempt: 1 },
    allowedForms,
    contextPack: { required: {} },
  });
  assert.equal(v5Proposal.max_completion_tokens, 4_000);
  assert.equal(
    proposedFactSchema(v5Proposal.tools.find((tool) =>
      tool.function.name === kpFormToolName("materialization.v1")).function.parameters).maxLength,
    8_000,
  );
  const policy = v5Proposal.messages[0].content;
  for (const method of [
    "materializeItem",
    "materializeNpcMechanicalEncounter",
    "transferItem",
    "changeNpcGear",
    "changeNpcItemState",
  ]) {
    assert.match(policy, new RegExp(`method 精确填 ${method}`, "u"));
  }
  for (const schema of [
    "zhuwei.item-materialization-draft/v1",
    "zhuwei.npc-mechanical-encounter-draft/v1",
    "zhuwei.item-transfer-draft/v1",
    "zhuwei.npc-gear-change-draft/v1",
    "zhuwei.npc-item-state-change-draft/v1",
  ]) assert.match(policy, new RegExp(schema.replace("/", "\\/"), "u"));
  assert.match(policy, /收到物品只改变双方权威背包，不会自动装备/u);
  assert.match(policy, /item-definition:srd51:healing-potion:1/u);
  assert.match(policy, /不得提交物品名称、说明、规则来源、能力、治疗骰式、目标、actor、entryId/u);
  assert.match(policy, /当前闭合 Form 不提交显式资源或物品成本/u);
  assert.match(policy, /不得提交 AC、abilityRefs/u);
  assert.match(policy, /zhuwei\.item-definition\/v1/u);
  assert.match(policy, /content\.equipment\.weapon/u);
  assert.match(policy, /ammunitionDefinitionRef 必须为 null/u);
  assert.match(policy, /自定义物品来源 kind 精确为 itemDefinition/u);
  assert.match(policy, /causeFactRef/u);
  assert.match(policy, /zhuwei\.npc-mechanical-item-state-cause\/v1/u);
  assert.match(policy, /encounter 尚未 concluded 时不得提交 transferItem/u);
  assert.match(policy, /encounter 尚未 concluded 时不得提交 changeNpcGear/u);
  assert.match(policy, /当前协议不接受没有明确场景归属的 lose/u);
  assert.doesNotMatch(policy, /在 compound 的 dynamicMaterializations 中/u);

  const v5Repair = privateFormRepairModelInput({
    rootActionRef: "root:v5-materialization",
    originalForm: "materialization.v1",
    selectedForm: "materialization.v1",
    rejectedDraft: VALID_FORM_DRAFTS["materialization.v1"],
    errors: ["proposedFact:schema-invalid"],
    finiteReferences: {
      basisRefs: ["scene:working-warehouse"],
      abilityRefs: [],
      resourceRefs: [],
      itemRefs: [],
    },
    semanticFreezeHash: "fnv1a64:0000000000000000",
  });
  assert.equal(v5Repair.max_completion_tokens, 4_000);
  assert.equal(
    proposedFactSchema(v5Repair.tools[0].function.parameters).maxLength,
    8_000,
  );
  const repairPolicy = v5Repair.messages[0].content;
  for (const schema of [
    "zhuwei.item-materialization-draft/v1",
    "zhuwei.npc-mechanical-encounter-draft/v1",
    "zhuwei.item-transfer-draft/v1",
    "zhuwei.npc-gear-change-draft/v1",
    "zhuwei.npc-item-state-change-draft/v1",
  ]) assert.match(repairPolicy, new RegExp(schema.replace("/", "\\/"), "u"));
  assert.match(repairPolicy, /intrinsicAbilities、itemDefinitions、itemDefinitionRefs、initialLoadout/u);
  assert.match(repairPolicy, /itemDefinitions 必须直接使用 zhuwei\.item-definition\/v1/u);
  assert.match(repairPolicy, /definitionRef 精确为 item-definition:srd51:healing-potion:1/u);
  assert.match(repairPolicy, /causeFactRef/u);
});

test("new action language compiles every form into a closed, stable, bounded DAG", () => {
  assert.equal(CAUSAL_ACTION_LANGUAGE_PROFILE.languageVersion, "causal-action-program-v4.0");
  assert.equal(Object.hasOwn(CAUSAL_ACTION_LANGUAGE_PROFILE, "legacyActionPlanVersion"), false);
  assert.equal(new Set(CAUSAL_PRIMITIVES).size, CAUSAL_PRIMITIVES.length);

  for (const formId of EXACT_FORM_IDS) {
    const first = compileKpFormDraft(formId, VALID_FORM_DRAFTS[formId]);
    const second = compileKpFormDraft(formId, structuredClone(VALID_FORM_DRAFTS[formId]));
    assert.deepEqual(first, second, formId);
    assert.match(first.semanticHash, /^fnv1a64:[0-9a-f]{16}$/u);
    assert.equal(validateCausalActionProgram(first).ok, true, formId);
    assert.ok(first.nodes.length <= 16);
    assert.ok(validateCausalActionProgram(first).maxDepth <= 8);
    const lowered = lowerCausalActionProgram(first);
    assert.equal(lowered.programHash, first.semanticHash);
    assert.deepEqual(lowered, lowerCausalActionProgram(second));
  }
  assert.equal(stableStructuralHash({ b: 2, a: 1 }), stableStructuralHash({ a: 1, b: 2 }));

  const compound = compileKpFormDraft("compound.v1", VALID_FORM_DRAFTS["compound.v1"]);
  const cycleNodes = compound.nodes.map((node, index) => index === 0
    ? { ...node, dependsOn: [compound.nodes.at(-1).nodeId] }
    : { ...node });
  const cycle = rehashProgram(compound, { nodes: cycleNodes });
  assert.ok(validateCausalActionProgram(cycle).errors.includes("graph:cycle"));

  const tooDeep = makeProgram(9, (index) => index === 0 ? [] : [`n${String(index).padStart(2, "0")}`]);
  assert.ok(validateCausalActionProgram(tooDeep).errors.includes("graph:depth-exceeded"));
  const tooWide = makeProgram(17, () => []);
  assert.ok(validateCausalActionProgram(tooWide).errors.includes("nodes:limit-exceeded"));

  const ordinary = compileKpFormDraft("ordinary-check.v1", VALID_FORM_DRAFTS["ordinary-check.v1"]);
  const unknownPrimitive = rehashProgram(ordinary, {
    nodes: [{ ...ordinary.nodes[0], primitive: "executeArbitraryCode" }],
  });
  assert.ok(validateCausalActionProgram(unknownPrimitive).errors.some((error) => error.endsWith("primitive:unknown")));
  const authorityField = rehashProgram(ordinary, {
    nodes: [{ ...ordinary.nodes[0], arguments: { ...ordinary.nodes[0].arguments, actualTargetIds: ["npc:hidden"] } }],
  });
  assert.ok(validateCausalActionProgram(authorityField).errors.some((error) => error.includes("authority-field-forbidden")));
  for (const forbidden of ["actor", "principal", "audience", "dice", "state", "event", "patch", "scope", "script"]) {
    const injected = validateKpFormDraft("ordinary-check.v1", {
      ...VALID_FORM_DRAFTS["ordinary-check.v1"],
      [forbidden]: "forbidden",
    });
    assert.equal(injected.ok, false, forbidden);
  }

  assert.throws(() => compileKpFormDraft("compound.v1", {
    ...VALID_FORM_DRAFTS["compound.v1"],
    stages: Array.from({ length: 8 }, (_, index) => ({
      goal: `stage ${index}`,
      method: "bounded method",
      intendedOutcome: "bounded outcome",
      resolution: "direct",
    })),
  }), /DEPTH_EXCEEDED/);
});

test("context pack preserves required authority, keeps the latest 8-12 dialogue, and trims optional first", () => {
  const dialogue = Array.from({ length: 14 }, (_, index) => ({
    messageRef: `message:${index + 1}`,
    speakerRef: index % 2 === 0 ? "character:alice" : "npc:warden",
    body: `亲历对话 ${index + 1}`,
    fictionalTimeRef: `fiction:${index + 1}`,
  }));
  const required = requiredContext(dialogue, 10);
  assert.equal(required.recentDialogue.length, 10);
  assert.equal(required.recentDialogue[0].messageRef, "message:5");
  assert.equal(required.recentDialogue.at(-1).messageRef, "message:14");
  assert.equal(required.sceneDynamics.lockedDoor, true);
  assert.throws(() => requiredContext(dialogue, 7), /RECENT_DIALOGUE_LIMIT_INVALID/);
  assert.throws(() => requiredContext(dialogue, 13), /RECENT_DIALOGUE_LIMIT_INVALID/);

  const retrieved = [
    retrievedChunk("rules:object-damage", 20, "对象伤害规则"),
    retrievedChunk("module:hall-chandelier", 10, "大厅吊灯定义"),
  ];
  const optional = [
    { ref: "voice:gothic", kind: "voice", body: "阴郁克制".repeat(100), priority: 100 },
    { ref: "background:minor", kind: "secondary-background", body: "次要背景".repeat(150), priority: 1 },
  ];
  const full = buildContextPack({ required, retrieved, optional, maxUnits: 100_000 });
  const trimmed = buildContextPack({
    required,
    retrieved,
    optional,
    maxUnits: full.budget.usedUnits - 100,
  });
  assert.strictEqual(trimmed.required, required);
  assert.deepEqual(trimmed.budget.droppedOptionalRefs, ["background:minor"]);
  assert.deepEqual(trimmed.budget.droppedRetrievedRefs, []);
  assert.deepEqual(trimmed.retrieved.chunks.map((chunk) => chunk.sourceRef), [
    "rules:object-damage",
    "module:hall-chandelier",
  ]);
  assert.ok(trimmed.budget.usedUnits <= trimmed.budget.maxUnits);
  assert.throws(() => buildContextPack({ required, retrieved: [], optional: [], maxUnits: 1 }), /REQUIRED_BUDGET/);
});

test("context pack budgets a retrieved dependency group atomically", () => {
  const required = requiredContext([], 10);
  const root = {
    ...retrievedChunk("source:root", 20, "根命中".repeat(200)),
    dependencyRefs: ["source:truth"],
  };
  const truth = retrievedChunk("source:truth", 20, "约束真相".repeat(200));
  const oneChunk = buildContextPack({
    required,
    retrieved: [root],
    optional: [],
    maxUnits: 100_000,
  });
  const trimmed = buildContextPack({
    required,
    retrieved: [root, truth],
    optional: [],
    maxUnits: oneChunk.budget.usedUnits,
  });
  assert.deepEqual(trimmed.retrieved.chunks, []);
  assert.deepEqual(trimmed.budget.droppedRetrievedRefs, ["source:root", "source:truth"]);
});

test("static retrieval indexes Chinese aliases/bigrams, merges exact and FTS refs, then re-reads authority", () => {
  const chunks = staticChunks();
  const index = buildStaticRetrievalIndex(chunks);
  assert.deepEqual(index, buildStaticRetrievalIndex(structuredClone(chunks)));
  assert.ok(chineseBigrams("黑橡树").includes("黑橡"));
  assert.ok(chineseBigrams("黑橡树").includes("橡树"));
  assert.throws(() => buildStaticRetrievalIndex([
    { sourceKind: "dynamic-room", sourceRef: "room:active:position", body: "当前战术位置" },
  ]), /DYNAMIC_SOURCE_FORBIDDEN/);

  const request = createStaticRetrievalRequest({
    structuralRefs: ["scene:great-hall"],
    exactAliases: ["黑橡树"],
    queryText: "射断锁链让吊灯坠落",
    plannerQueryTerms: ["对象伤害"],
    limit: 8,
  });
  const hits = retrieveStaticReferences(index, request, createDeterministicFtsAdapter(index));
  assert.equal(hits[0].sourceRef, "module:great-hall:chandelier");
  assert.ok(hits[0].routes.includes("structural"));
  assert.ok(hits[0].routes.includes("fts"));
  assert.ok(hits.some((hit) => hit.sourceRef === "story:black-oak:truth" && hit.routes.includes("alias")));
  assert.equal(Object.hasOwn(hits[0], "body"), false);
  for (const field of [
    "sourceRef",
    "sourceHash",
    "sourceSpan",
    "profileRef",
    "sensitivity",
    "dependencyRefs",
    "purpose",
  ]) assert.equal(Object.hasOwn(hits[0], field), true, field);

  const byRef = new Map(chunks.map((chunk) => [chunk.sourceRef, chunk]));
  let reads = 0;
  const hydrated = rehydrateStaticContext(hits, (sourceRef) => {
    reads += 1;
    return byRef.get(sourceRef);
  }, {
    allowedProfileRefs: ["module:black-oak-v3", "rules:srd5.1-v2"],
    allowKpOnly: true,
  });
  assert.equal(reads, hits.length);
  assert.equal(hydrated.length, hits.length);
  assert.ok(hydrated.every((chunk) => chunk.body.length > 0));

  const first = hits[0];
  const authoritative = byRef.get(first.sourceRef);
  assert.throws(() => rehydrateStaticContext([first], () => ({
    ...authoritative,
    sourceHash: "sha256:stale",
  }), { allowedProfileRefs: [authoritative.profileRef], allowKpOnly: true }), /SOURCE_HASH_MISMATCH/);
  assert.throws(() => rehydrateStaticContext([first], () => authoritative, {
    allowedProfileRefs: ["profile:not-allowed"],
    allowKpOnly: true,
  }), /PROFILE_MISMATCH/);
  assert.throws(() => rehydrateStaticContext([first], () => ({
    ...authoritative,
    sourceSpan: { start: authoritative.sourceSpan.start + 1, end: authoritative.sourceSpan.end },
  }), { allowedProfileRefs: [authoritative.profileRef], allowKpOnly: true }), /SOURCE_SPAN_MISMATCH/);
  assert.throws(() => rehydrateStaticContext([first], () => ({
    ...authoritative,
    sensitivity: authoritative.sensitivity === "public" ? "kp-only" : "public",
  }), { allowedProfileRefs: [authoritative.profileRef], allowKpOnly: true }), /SENSITIVITY_MISMATCH/);

  const secretHit = hits.find((hit) => hit.sensitivity === "kp-only");
  assert.ok(secretHit);
  assert.throws(() => rehydrateStaticContext([secretHit], (sourceRef) => byRef.get(sourceRef), {
    allowedProfileRefs: [secretHit.profileRef],
    allowKpOnly: false,
  }), /SENSITIVITY_FORBIDDEN/);
});

test("static retrieval closes and authorizes dependency groups before applying its result limit", () => {
  const root = {
    sourceKind: "static",
    sourceRef: "module:clue",
    sourceHash: "sha256:clue-v1",
    sourceSpan: { start: 0, end: 12 },
    profileRef: "module:pinned-v1",
    sensitivity: "public",
    dependencyRefs: ["story:core-truth"],
    purpose: "module",
    body: "门框上的刻痕指向旧誓约。",
    aliases: ["门框刻痕"],
    structuralRefs: ["clue:door-mark"],
  };
  const truth = {
    sourceKind: "static",
    sourceRef: "story:core-truth",
    sourceHash: "sha256:truth-v1",
    sourceSpan: { start: 0, end: 12 },
    profileRef: "module:pinned-v1",
    sensitivity: "kp-only",
    dependencyRefs: ["module:pinned-v1"],
    purpose: "story-bible",
    body: "旧誓约的封印其实已经被伪造。",
    aliases: [],
    structuralRefs: [],
  };
  const chunks = [root, truth];
  const index = buildStaticRetrievalIndex(chunks);
  const request = createStaticRetrievalRequest({ structuralRefs: ["clue:door-mark"], limit: 2 });
  const hits = retrieveStaticReferences(index, request, createDeterministicFtsAdapter(index));
  assert.deepEqual(hits.map((hit) => hit.sourceRef), ["module:clue", "story:core-truth"]);
  assert.ok(hits[1].routes.includes("dependency"));
  assert.deepEqual(
    retrieveStaticReferences(
      index,
      createStaticRetrievalRequest({ structuralRefs: ["clue:door-mark"], limit: 1 }),
      createDeterministicFtsAdapter(index),
    ),
    [],
  );

  const byRef = new Map(chunks.map((chunk) => [chunk.sourceRef, chunk]));
  const hydrated = rehydrateStaticContext(hits, (sourceRef) => byRef.get(sourceRef), {
    allowedProfileRefs: ["module:pinned-v1"],
    allowKpOnly: true,
  });
  assert.deepEqual(hydrated.map((chunk) => chunk.sourceRef), ["module:clue", "story:core-truth"]);
  assert.throws(() => rehydrateStaticContext(hits, (sourceRef) => byRef.get(sourceRef), {
    allowedProfileRefs: ["module:pinned-v1"],
    allowKpOnly: false,
  }), /SENSITIVITY_FORBIDDEN/);
  assert.throws(() => rehydrateStaticContext(hits, (sourceRef) => sourceRef === truth.sourceRef
    ? { ...truth, sourceHash: "sha256:forged" }
    : byRef.get(sourceRef), {
    allowedProfileRefs: ["module:pinned-v1"],
    allowKpOnly: true,
  }), /SOURCE_HASH_MISMATCH/);

  const missingRoot = { ...root, dependencyRefs: ["story:missing"] };
  const missingIndex = buildStaticRetrievalIndex([missingRoot]);
  const missingHits = retrieveStaticReferences(
    missingIndex,
    createStaticRetrievalRequest({ structuralRefs: ["clue:door-mark"], limit: 2 }),
    createDeterministicFtsAdapter(missingIndex),
  );
  assert.throws(() => rehydrateStaticContext(missingHits, () => missingRoot, {
    allowedProfileRefs: ["module:pinned-v1"],
    allowKpOnly: true,
  }), /DEPENDENCY_UNRESOLVED/);
});

test("role registry exposes only validated Planner profiles and all Planner failures fall back without switching KP", async () => {
  const registry = createModelProfileRegistry(modelProfiles());
  assert.match(registry.registryHash, /^fnv1a64:/u);
  assert.deepEqual(validatedProfilesForRole(registry, "context-planner").map((profile) => profile.profileRef), [
    "planner:model:validated",
  ]);
  assert.deepEqual(validatedProfilesForRole(registry, "primary-kp").map((profile) => profile.profileRef), [
    "kp:primary:pinned",
  ]);
  assert.throws(() => createModelPlannerAdapter({
    registry,
    profileRef: "kp:primary:pinned",
    invoke: () => { throw new Error("must not invoke"); },
  }), /ROLE_FORBIDDEN/);
  assert.throws(() => createModelPlannerAdapter({
    registry,
    profileRef: "planner:model:pending",
    invoke: () => { throw new Error("must not invoke"); },
  }), /NOT_VALIDATED/);

  const plannerInput = {
    rootActionRef: "root:action:001",
    allowedFormIds: selectAllowedKpForms({
      interaction: "combat",
      mayUseEnvironment: true,
      preferredCount: 5,
    }),
    structuralRefs: ["scene:great-hall", "feature:chandelier"],
    baseQueryTerms: ["吊灯", "对象伤害"],
  };
  const disabled = await runContextPlanner({
    registry,
    pinnedPrimaryKpProfileRef: "kp:primary:pinned",
    adapter: createDisabledPlannerAdapter(),
    plannerInput,
  });
  assert.equal(disabled.receipt.status, "disabled");
  assert.equal(disabled.receipt.fallbackUsed, false);
  assert.equal(disabled.receipt.plannerProfileRef, "context-planner-disabled-v1");
  assert.equal(disabled.pinnedPrimaryKpProfileRef, "kp:primary:pinned");
  assert.deepEqual(disabled.suggestion.orderedFormIds, plannerInput.allowedFormIds);
  assert.deepEqual(disabled.suggestion.queryTerms, []);

  const model = createModelPlannerAdapter({
    registry,
    profileRef: "planner:model:validated",
    invoke: () => plannerToolResponse({
      orderedFormIds: [...plannerInput.allowedFormIds].reverse(),
      queryTerms: ["锁链", "坠落", "对象伤害"],
    }),
  });
  const modeled = await runContextPlanner({
    registry,
    pinnedPrimaryKpProfileRef: "kp:primary:pinned",
    adapter: model,
    plannerInput,
  });
  assert.equal(modeled.receipt.status, "suggested");
  assert.equal(modeled.receipt.fallbackUsed, false);
  assert.deepEqual(Object.keys(modeled.suggestion).sort(), ["orderedFormIds", "queryTerms"]);

  const failedModel = createModelPlannerAdapter({
    registry,
    profileRef: "planner:model:validated",
    invoke: async () => { throw new Error("provider timeout"); },
  });
  const failed = await runContextPlanner({
    registry,
    pinnedPrimaryKpProfileRef: "kp:primary:pinned",
    adapter: failedModel,
    plannerInput,
    deterministicFallback: createDeterministicPlannerAdapter(),
  });
  assert.equal(failed.receipt.status, "fallback");
  assert.equal(failed.receipt.failureCode, "PLANNER_FAILED");
  assert.equal(failed.pinnedPrimaryKpProfileRef, "kp:primary:pinned");
  assert.deepEqual(new Set(failed.suggestion.orderedFormIds), new Set(plannerInput.allowedFormIds));
  assert.ok(failed.suggestion.orderedFormIds.includes("compound.v1"));

  const invalidModel = createModelPlannerAdapter({
    registry,
    profileRef: "planner:model:validated",
    invoke: () => plannerToolResponse({
      orderedFormIds: plannerInput.allowedFormIds,
      queryTerms: ["吊灯"],
      dc: 20,
    }),
  });
  const invalid = await runContextPlanner({
    registry,
    pinnedPrimaryKpProfileRef: "kp:primary:pinned",
    adapter: invalidModel,
    plannerInput,
  });
  assert.equal(invalid.receipt.failureCode, "PLANNER_OUTPUT_INVALID");
  assert.equal(invalid.pinnedPrimaryKpProfileRef, "kp:primary:pinned");
});

function proposedFactSchema(parameters) {
  assert.equal(parameters.type, "object");
  assert.equal(parameters.additionalProperties, false);
  return parameters.properties.proposedFact;
}

function recursiveKeys(value) {
  if (Array.isArray(value)) return value.flatMap(recursiveKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...recursiveKeys(child)]);
}

function rehashProgram(program, changes) {
  const changed = { ...program, ...changes };
  if (changes.formRef !== undefined && changes.formHash === undefined) {
    changed.formHash = kpFormBindingHash(changes.formRef);
  }
  const semanticSource = {
    languageRef: changed.languageRef,
    languageHash: changed.languageHash,
    formRef: changed.formRef,
    formHash: changed.formHash,
    nodes: changed.nodes,
    resultNodeIds: changed.resultNodeIds,
  };
  return { ...changed, semanticHash: stableStructuralHash(semanticSource) };
}

function makeProgram(nodeCount, dependencies) {
  const ordinary = compileKpFormDraft("ordinary-check.v1", VALID_FORM_DRAFTS["ordinary-check.v1"]);
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    nodeId: `n${String(index + 1).padStart(2, "0")}`,
    primitive: "assessCausalStage",
    dependsOn: dependencies(index),
    arguments: {},
  }));
  return rehashProgram(ordinary, {
    formRef: "compound.v1",
    nodes,
    resultNodeIds: [nodes.at(-1).nodeId],
  });
}

function requiredContext(recentDialogue, recentDialogueLimit) {
  return createRequiredContext({
    intent: { submissionRef: "submission:001", text: "射断吊灯锁链，阻住追兵。" },
    trustedControl: {
      characterRef: "character:alice",
      controllerRef: "user:alice",
      controlProofRef: "seat-proof:001",
    },
    sceneDynamics: { sceneRef: "scene:great-hall", lockedDoor: true },
    mechanics: {
      encounter: { active: true },
      turn: { ordinal: 3 },
      actionEconomy: { actionAvailable: true },
      position: { zoneRef: "zone:balcony" },
      hp: { current: 17, maximum: 24 },
      resources: { arrows: 9 },
      conditions: [],
    },
    npcViews: [{ npcRef: "npc:warden", knowledgeRefs: ["claim:heard-bell"], planRefs: ["plan:patrol"] }],
    temporal: { pendingRefs: [], activityRefs: [], fictionalTime: { minute: 12 } },
    established: {
      factRefs: ["fact:chandelier-visible"],
      precedentRefs: [],
      dynamicDefinitionRefs: ["feature:chandelier:001"],
    },
    bindings: {
      rulesRef: "rules:srd5.1-v2",
      geometryRef: "geometry:v1",
      moduleRef: "module:black-oak-v3",
      eventRef: "event:v2",
    },
    truthConstraintRefs: ["truth-constraint:hall-is-occupied"],
    contentBoundaries: ["boundary:no-graphic-gore"],
    recentDialogue,
    recentDialogueLimit,
  });
}

function retrievedChunk(sourceRef, relevance, body) {
  return {
    sourceRef,
    sourceHash: `sha256:${sourceRef}`,
    sourceSpan: { start: 0, end: body.length },
    profileRef: sourceRef.startsWith("rules:") ? "rules:srd5.1-v2" : "module:black-oak-v3",
    sensitivity: "public",
    dependencyRefs: [],
    purpose: sourceRef.startsWith("rules:") ? "rules" : "module",
    body,
    relevance,
  };
}

function staticChunks() {
  return [
    {
      sourceKind: "static",
      sourceRef: "module:great-hall:chandelier",
      sourceHash: "sha256:chandelier-v1",
      sourceSpan: { start: 120, end: 260 },
      profileRef: "module:black-oak-v3",
      sensitivity: "public",
      dependencyRefs: ["module:black-oak-v3"],
      purpose: "environment",
      body: "大厅中央悬挂一盏重型铁制吊灯，以旧锁链固定；锁链断裂后吊灯会坠落。",
      aliases: ["吊灯", "大厅灯架"],
      structuralRefs: ["scene:great-hall", "feature:chandelier"],
    },
    {
      sourceKind: "static",
      sourceRef: "rules:object-damage",
      sourceHash: "sha256:object-damage-v1",
      sourceSpan: { start: 900, end: 1060 },
      profileRef: "rules:srd5.1-v2",
      sensitivity: "public",
      dependencyRefs: ["rules:srd5.1-v2"],
      purpose: "rules",
      body: "对象拥有由材质决定的护甲等级与生命值；攻击可能损坏或摧毁对象。",
      aliases: ["对象伤害", "物体破坏"],
      structuralRefs: ["rule:object-damage"],
    },
    {
      sourceKind: "static",
      sourceRef: "story:black-oak:truth",
      sourceHash: "sha256:black-oak-truth-v1",
      sourceSpan: { start: 20, end: 90 },
      profileRef: "module:black-oak-v3",
      sensitivity: "kp-only",
      dependencyRefs: ["module:black-oak-v3"],
      purpose: "story-bible",
      body: "黑橡树旧誓约的印记曾被摄政者伪造。",
      aliases: ["黑橡树", "旧誓约"],
      structuralRefs: ["truth:black-oak-oath"],
    },
  ];
}

function modelProfiles() {
  const validatedPlanner = {
    profileRef: "planner:model:validated",
    provider: "test-planner",
    modelId: "planner-model",
    modelRevision: "2026-08-20",
    supportedRoles: ["context-planner"],
    validationSuiteVersion: CONTEXT_PLANNER_ROLE_VALIDATION_SUITE_VERSION,
    validationStatus: "passed",
    structuredOutputMode: "strict-tool",
    contextWindowTokens: 32_000,
    latencyTier: "low",
    costTier: "low",
  };
  validatedPlanner.roleValidation = createContextPlannerRoleValidationEvidence({
    profile: validatedPlanner,
    executionMode: "offline-fixture",
    validatedAt: "2026-08-29T00:00:00.000Z",
    caseCount: 5,
    liveProviderCalls: 0,
    latencyMs: { p50: 1, p95: 2, budget: 8_000 },
    gates: Object.fromEntries(CONTEXT_PLANNER_VALIDATION_GATES.map((gate) => [gate, true])),
  });
  return [
    {
      profileRef: "kp:primary:pinned",
      provider: "workers-ai",
      modelId: "primary-kp-model",
      modelRevision: "2026-08-01",
      supportedRoles: ["primary-kp", "narration"],
      validationSuiteVersion: "kp-role-suite-v3",
      validationStatus: "passed",
      structuredOutputMode: "strict-tool",
      contextWindowTokens: 128_000,
      latencyTier: "standard",
      costTier: "standard",
    },
    validatedPlanner,
    {
      profileRef: "planner:model:pending",
      provider: "workers-ai",
      modelId: "unvalidated-planner-model",
      modelRevision: "2026-08-21",
      supportedRoles: ["context-planner"],
      validationSuiteVersion: "planner-role-suite-v1",
      validationStatus: "pending",
      structuredOutputMode: "strict-json-schema",
      contextWindowTokens: 32_000,
      latencyTier: "low",
      costTier: "low",
    },
  ];
}

function plannerToolResponse(argumentsValue) {
  return {
    choices: [{
      message: {
        tool_calls: [{
          type: "function",
          function: {
            name: CONTEXT_PLANNER_TOOL_NAME,
            arguments: JSON.stringify(argumentsValue),
          },
        }],
      },
    }],
  };
}
