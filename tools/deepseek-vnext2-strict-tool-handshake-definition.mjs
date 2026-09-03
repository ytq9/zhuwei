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
  version: "kp-vnext2-proposal-handshake-prompts-v3",
  common: [
    "只调用 submit_kp_proposal_bundle 一次。",
    "只使用题面给出的冻结引用或本束 prospective handle。",
    "不得生成 rootActionId、角色 authority id、骰面、modifier、Receipt、事件或执行 DAG。",
    "当前候选填写面只允许 mode=adjudication、directSuccess、terminal none，以及 materializeObject/worldInteraction。",
    "directSuccess 的 branches.failure 必须使用 {kind:'none'} sentinel。",
    "directSuccess 下每个 proposal 的 outcomeBinding 都必须是 always。",
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
      cases: [WORLD_INTERACTION_PROMPT, MATERIALIZE_INTERACT_PROMPT],
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
