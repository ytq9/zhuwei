import { stableStructuralHash } from "../app/_runtime/lib/kp/causal-action-program.ts";
import { DEEPSEEK_V4_FLASH_VNEXT2_STRICT_TOOL_CANDIDATE } from "../app/_runtime/lib/kp/model-registry.ts";
import { deriveVNextProposalBundlePlan } from "../app/_runtime/lib/kp/vnext/proposal-graph.ts";
import {
  SUBMIT_KP_PROPOSAL_BUNDLE_TOOL,
  createCorrectKpProposalBundleModelInput,
  createSubmitKpProposalBundleModelInput,
} from "../app/_runtime/lib/kp/vnext/proposal-schema.ts";
import {
  VNEXT_PROPOSAL_BUNDLE_PARSER_HASH,
  parseCorrectKpProposalBundleResponse,
  parseSubmitKpProposalBundleResponse,
} from "../app/_runtime/lib/kp/vnext/proposal-provider.ts";

export const VNEXT2_STRICT_TOOL_PROMPT_CONTRACT = Object.freeze({
  version: "kp-vnext2-proposal-handshake-prompts-v5",
  common: [
    "只调用 submit_kp_proposal_bundle 一次。",
    "只使用题面给出的冻结引用或本束 prospective handle。",
    "不得生成 rootActionId、角色 authority id、骰面、modifier、Receipt、事件或执行 DAG。",
    "当前候选填写面只允许 mode=adjudication、terminal none，以及 materializeObject/worldInteraction；"
      + "adjudication 只能是 directSuccess 或 checkKind=abilityCheck 的 check。",
    "directSuccess 的 branches.failure 必须使用 {kind:'none'} sentinel，且每个 proposal 的 outcomeBinding 都必须是 always。",
    "check 必须恰好有一个 worldInteraction，其 outcomeBinding=always 且 branches.failure 必须是真实分支；"
      + "只在成功时才发生的 proposal 用 outcomeBinding=onSuccess。",
    "check 不写 abilityRef：本填写面的 abilityRef 恒为 none。",
    "行动在既有事实下不可行时提交 mode=terminal 的 inWorldRefusal，"
      + "adjudication 使用 {kind:'none'}、proposals 为空数组；拒绝不携带任何检定字段，"
      + "不得用一个够不到的 DC 代替说明。",
  ],
  correction: [
    "只调用 correct_kp_proposal_bundle 一次。",
    "只返回题面 allowedPaths 中列出的摘要修正，不改变裁决、引用、效果或其他权威字段。",
  ],
});

const CORRECTION_BASE_HASH = `sha256:${"b".repeat(64)}`;
const CORRECTION_CONTEXT_HASH = `sha256:${"c".repeat(64)}`;

const WORLD_INTERACTION_PROMPT = `${VNEXT2_STRICT_TOOL_PROMPT_CONTRACT.common.join("\n")}
Provider dialect handshake；不要扩写故事。角色 character:alice 位于 scene:atrium，看见 sceneFeature:chain。
提交 mode=adjudication、bundle basisRefs=[]、directSuccess，且只有一个 worldInteraction：意图是检查链条，sceneRef=scene:atrium，targetRefs/directTargetRefs=[sceneFeature:chain]，无 instrument、abilityRef=none、basisRefs/consumes/produces 为空。成功分支 outcomeCode=outcome:chain-inspected，summary 简洁，effects/evidence/pressure/opportunity 均为空；terminal 使用 none。`;

const MATERIALIZE_INTERACT_PROMPT = `${VNEXT2_STRICT_TOOL_PROMPT_CONTRACT.common.join("\n")}
Provider dialect handshake；不要扩写故事。角色 character:alice 位于 scene:atrium，刚刚发现一个先前未定义但公开可见的壁龛。
提交 mode=adjudication、bundle basisRefs=[]、directSuccess，两项 proposal 严格按顺序：
1) materializeObject，semanticKind=sceneFeature，templateRef=template:handshake-scene-feature、templateHash=sha256:1111111111111111111111111111111111111111111111111111111111111111，产生唯一 handle prospective:alcove（semanticDefinition/always），sceneRef=scene:atrium、visibilityFactId=none、visibilityPolicyRef=visibility:scene-observers，给出短 label/description/observableState、affordances=[inspect]、mechanicDefinitionRefs=[]；materializeObject 的 basisRefs=[]、consumes=[]，outcomeBinding=always；
2) worldInteraction 显式 consumes prospective:alcove，并在 targetRefs/directTargetRefs 使用它，basisRefs=[]、produces=[]、outcomeBinding=always，意图是检查壁龛；无 instrument/ability，成功分支的 effects/sensoryEvidence/pressures/opportunities 全为空，failure 使用 none；terminal 使用 none。`;

const SHARED_CHECK_PROMPT = `${VNEXT2_STRICT_TOOL_PROMPT_CONTRACT.common.join("\n")}
Provider dialect handshake；不要扩写故事。角色 character:alice 位于 scene:atrium，面前 sceneFeature:chain 被一块卡死的石板压住，撬得开撬不开都有可能。
提交 mode=adjudication、bundle basisRefs=[]、terminal 使用 none，adjudication 使用 check：checkKind=abilityCheck、ability=str、skill=none、dc=13、mode=normal，risk/successOutcome/failureOutcome 各写一句短句。两项 proposal 严格按顺序：
1) worldInteraction，outcomeBinding=always，意图是撬开压住链条的石板，sceneRef=scene:atrium，targetRefs/directTargetRefs=[sceneFeature:chain]，无 instrument、abilityRef=none、basisRefs/consumes/produces 为空；success 与 failure 两个分支都要真实填写，outcomeCode 分别为 outcome:slab-pried 与 outcome:slab-stuck，summary 简洁，effects/sensoryEvidence/pressures/opportunities 均为空；
2) materializeObject，outcomeBinding=onSuccess，semanticKind=sceneFeature，templateRef=template:handshake-scene-feature、templateHash=sha256:1111111111111111111111111111111111111111111111111111111111111111，产生唯一 handle prospective:cache（semanticDefinition/onSuccess），sceneRef=scene:atrium、visibilityFactId=none、visibilityPolicyRef=visibility:scene-observers，给出短 label/description/observableState、affordances=[inspect]、mechanicDefinitionRefs=[]，basisRefs=[]、consumes=[]。`;

const IN_WORLD_REFUSAL_PROMPT = `${VNEXT2_STRICT_TOOL_PROMPT_CONTRACT.common.join("\n")}
Provider dialect handshake；不要扩写故事。角色 character:alice 在 scene:atrium，面前 sceneFeature:chain 所连的石门嵌在整块承重墙里，没有缝隙也没有把手。玩家说“我徒手把整扇石门拆下来”。
这在既有事实下不可行，且不是一个可以用高 DC 掩盖的检定。提交 mode=terminal、bundle basisRefs=[scene:atrium, sceneFeature:chain]、adjudication 使用 {kind:"none"}、proposals 为空数组。
terminal 使用 inWorldRefusal：intent 与 method 复述玩家的做法，ruling.kind=missingPrerequisite，publicBasis 用一句说明为什么当前方式不可行，prerequisites 给出 1-2 条真正缺少的前提（没有对应冻结引用时 ref 精确填 "none"），nextActions 给出 1-2 条玩家可以改走的路径，attemptCosts 为空数组。`;

const CORRECTION_PROMPT = `${VNEXT2_STRICT_TOOL_PROMPT_CONTRACT.correction.join("\n")}
Provider dialect handshake；allowedPaths 只有 ["proposals",0,"branches","success","summary"]。
返回恰好一个 change，path 必须逐段相同，value 使用“检查完成。”。`;

const INVALID_SCHEMA = structuredClone(SUBMIT_KP_PROPOSAL_BUNDLE_TOOL.function.parameters);
INVALID_SCHEMA.additionalProperties = true;

function invalidSchemaModelInput() {
  const input = createSubmitKpProposalBundleModelInput("invalid-schema-pre-generation-probe");
  return {
    ...input,
    tools: [{
      ...SUBMIT_KP_PROPOSAL_BUNDLE_TOOL,
      function: {
        ...SUBMIT_KP_PROPOSAL_BUNDLE_TOOL.function,
        parameters: INVALID_SCHEMA,
      },
    }],
  };
}

function assertWorldInteractionOnly(response) {
  const bundle = parseSubmitKpProposalBundleResponse(response);
  if (bundle.mode !== "adjudication"
    || bundle.terminal !== null
    || bundle.proposals.length !== 1
    || bundle.proposals[0]?.kind !== "worldInteraction") {
    throw new TypeError("VNEXT2_HANDSHAKE_WORLD_INTERACTION_SHAPE_INVALID");
  }
  return bundle;
}

function assertMaterializeThenInteract(response) {
  const bundle = parseSubmitKpProposalBundleResponse(response);
  if (bundle.mode !== "adjudication"
    || bundle.proposals.length !== 2
    || bundle.proposals[0]?.kind !== "materializeObject"
    || bundle.proposals[1]?.kind !== "worldInteraction") {
    throw new TypeError("VNEXT2_HANDSHAKE_MATERIALIZATION_SHAPE_INVALID");
  }
  const handle = bundle.proposals[0].produces[0]?.handle;
  if (handle === undefined
    || !bundle.proposals[1].consumes.some((entry) =>
      entry.kind === "prospective" && entry.handle === handle)) {
    throw new TypeError("VNEXT2_HANDSHAKE_PROSPECTIVE_EDGE_INVALID");
  }
  const graph = deriveVNextProposalBundlePlan({
    bundle,
    rootActionId: "root:strict-handshake",
    actorCharacterId: "character:alice",
    contextHash: `sha256:${"c".repeat(64)}`,
    readSet: [],
  });
  if (graph.kind !== "accepted"
    || graph.plan.executionOrder[0] !== graph.plan.entries[0]?.entryRef
    || graph.plan.executionOrder[1] !== graph.plan.entries[1]?.entryRef) {
    throw new TypeError("VNEXT2_HANDSHAKE_DERIVED_GRAPH_INVALID");
  }
  return bundle;
}

function assertSharedCheck(response) {
  const bundle = parseSubmitKpProposalBundleResponse(response);
  if (bundle.mode !== "adjudication"
    || bundle.terminal !== null
    || bundle.adjudication?.kind !== "check"
    || bundle.adjudication.checkKind !== "abilityCheck"
    || bundle.proposals.length !== 2) {
    throw new TypeError("VNEXT2_HANDSHAKE_SHARED_CHECK_SHAPE_INVALID");
  }
  const interactions = bundle.proposals.filter((entry) => entry.kind === "worldInteraction");
  const materializations = bundle.proposals.filter((entry) => entry.kind === "materializeObject");
  // A shared check is only meaningful if something actually rides the roll:
  // one interaction owns it, and the other entry happens on success alone.
  if (interactions.length !== 1
    || materializations.length !== 1
    || interactions[0].outcomeBinding !== "always"
    || interactions[0].branches.failure === null
    || materializations[0].outcomeBinding !== "onSuccess") {
    throw new TypeError("VNEXT2_HANDSHAKE_SHARED_CHECK_BINDING_INVALID");
  }
  const graph = deriveVNextProposalBundlePlan({
    bundle,
    rootActionId: "root:strict-handshake",
    actorCharacterId: "character:alice",
    contextHash: `sha256:${"c".repeat(64)}`,
    readSet: [],
  });
  if (graph.kind !== "accepted") {
    throw new TypeError("VNEXT2_HANDSHAKE_SHARED_CHECK_GRAPH_INVALID");
  }
  const owner = graph.plan.entries.find((entry) => entry.kind === "worldInteraction");
  if (owner === undefined
    || graph.plan.sharedCheckEntryRef === null
    || graph.plan.sharedCheckEntryRef !== owner.entryRef
    || graph.plan.executionOrder[0] !== owner.entryRef) {
    throw new TypeError("VNEXT2_HANDSHAKE_SHARED_CHECK_OWNER_INVALID");
  }
  return bundle;
}

function assertInWorldRefusal(response) {
  const bundle = parseSubmitKpProposalBundleResponse(response);
  if (bundle.mode !== "terminal"
    || bundle.adjudication !== null
    || bundle.proposals.length !== 0
    || bundle.terminal?.kind !== "inWorldRefusal") {
    throw new TypeError("VNEXT2_HANDSHAKE_REFUSAL_SHAPE_INVALID");
  }
  const ruling = bundle.terminal.ruling;
  if (ruling.kind !== "missingPrerequisite" && ruling.kind !== "worldLawViolation") {
    throw new TypeError("VNEXT2_HANDSHAKE_REFUSAL_RULING_INVALID");
  }
  // SPEC 0001 scenario B: a refusal has to name what is missing and leave a way
  // forward, instead of hiding behind a DC the player can never reach. The
  // shape cannot carry a DC at all, so this only checks the content is real.
  if (ruling.prerequisites.length === 0 || ruling.nextActions.length === 0) {
    throw new TypeError("VNEXT2_HANDSHAKE_REFUSAL_NOT_ACTIONABLE");
  }
  return bundle;
}

function assertSummaryCorrection(response) {
  const correction = parseCorrectKpProposalBundleResponse(response, {
    baseBundleHash: CORRECTION_BASE_HASH,
    contextHash: CORRECTION_CONTEXT_HASH,
  });
  if (correction.changes.length !== 1
    || JSON.stringify(correction.changes[0]?.path)
      !== JSON.stringify(["proposals", 0, "branches", "success", "summary"])
    || correction.changes[0]?.value !== "检查完成。") {
    throw new TypeError("VNEXT2_HANDSHAKE_CORRECTION_SHAPE_INVALID");
  }
  return correction;
}

export const strictToolHandshakeDefinition = Object.freeze({
  profile: DEEPSEEK_V4_FLASH_VNEXT2_STRICT_TOOL_CANDIDATE,
  contracts: Object.freeze([{
    contractId: "submit-proposal-bundle",
    promptHash: stableStructuralHash({
      contract: VNEXT2_STRICT_TOOL_PROMPT_CONTRACT,
      cases: [
        WORLD_INTERACTION_PROMPT,
        MATERIALIZE_INTERACT_PROMPT,
        SHARED_CHECK_PROMPT,
        IN_WORLD_REFUSAL_PROMPT,
      ],
    }),
    parserHash: VNEXT_PROPOSAL_BUNDLE_PARSER_HASH,
  }, {
    contractId: "correct-proposal-bundle",
    promptHash: stableStructuralHash({
      contract: VNEXT2_STRICT_TOOL_PROMPT_CONTRACT,
      cases: [CORRECTION_PROMPT],
    }),
    parserHash: VNEXT_PROPOSAL_BUNDLE_PARSER_HASH,
  }]),
  positiveCases: Object.freeze([{
    caseId: "world-interaction-only",
    contractId: "submit-proposal-bundle",
    capability: "world-interaction",
    modelInput: createSubmitKpProposalBundleModelInput(WORLD_INTERACTION_PROMPT),
    parse: assertWorldInteractionOnly,
  }, {
    caseId: "materialize-then-interact",
    contractId: "submit-proposal-bundle",
    capability: "materialization+world-interaction",
    modelInput: createSubmitKpProposalBundleModelInput(MATERIALIZE_INTERACT_PROMPT),
    parse: assertMaterializeThenInteract,
  }, {
    caseId: "shared-ability-check",
    contractId: "submit-proposal-bundle",
    capability: "shared-ability-check",
    modelInput: createSubmitKpProposalBundleModelInput(SHARED_CHECK_PROMPT),
    parse: assertSharedCheck,
  }, {
    caseId: "in-world-refusal",
    contractId: "submit-proposal-bundle",
    capability: "in-world-refusal",
    modelInput: createSubmitKpProposalBundleModelInput(IN_WORLD_REFUSAL_PROMPT),
    parse: assertInWorldRefusal,
  }, {
    caseId: "summary-only-correction",
    contractId: "correct-proposal-bundle",
    capability: "proposal-summary-correction",
    modelInput: createCorrectKpProposalBundleModelInput(CORRECTION_PROMPT),
    parse: assertSummaryCorrection,
  }]),
  invalidSchemaCase: Object.freeze({
    caseId: "provider-rejects-open-root-object",
    modelInput: invalidSchemaModelInput(),
  }),
});

export default strictToolHandshakeDefinition;
