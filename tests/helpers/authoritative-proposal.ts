import type {
  AdjudicationPrecedentProposal,
  DynamicMaterialization,
  KpProposalDraft,
  NpcActionProposal,
  ProposalRisk,
  SceneProposal,
  SemanticActionPlan,
} from "../../app/_runtime/lib/kp/authoritative-types";

export type ProductionProposalOptions = {
  kind?: KpProposalDraft["kind"];
  goal?: string;
  method?: string;
  risk?: ProposalRisk | null;
  publicBasisRefs?: string[];
  privateBasisRefs?: string[];
  adjudicationPrecedent?: AdjudicationPrecedentProposal | null;
  dynamicMaterializations?: DynamicMaterialization[];
  hiddenRealityCandidateSet?: KpProposalDraft["hiddenRealityCandidateSet"];
  npcActions?: NpcActionProposal[];
  scene?: SceneProposal;
  proposalAttemptId?: string;
};

export function productionActionPlanProposal(
  rootActionId: string,
  mechanicalProposal: SemanticActionPlan,
  options: ProductionProposalOptions = {},
) {
  const kind = options.kind ?? "directSuccess";
  const goal = options.goal ?? "完成玩家已经声明的行动";
  const method = options.method ?? "按玩家已经声明的做法行动";
  const risk = options.risk === undefined
    ? kind === "directSuccess"
      ? null
      : {
          warning: "成功与失败后果已经在骰前冻结。",
          successConsequences: ["行动成功并产生已冻结后果。"],
          failureConsequences: ["行动失败并产生已冻结后果。"],
          retryGate: ["methodChanged", "situationAdvanced"] as ProposalRisk["retryGate"],
        }
    : options.risk;
  return {
    kind,
    goal,
    method,
    publicBasisRefs: options.publicBasisRefs ?? [],
    privateBasisRefs: options.privateBasisRefs ?? [],
    adjudicationPrecedent: options.adjudicationPrecedent ?? null,
    risk,
    pendingInput: null,
    dynamicMaterializations: options.dynamicMaterializations ?? [],
    hiddenRealityCandidateSet: options.hiddenRealityCandidateSet ?? null,
    npcActions: options.npcActions ?? [],
    mechanicalProposal,
    scene: options.scene ?? {
      question: goal,
      pressure: kind === "directSuccess" ? "" : "成功与失败后果已经冻结。",
      opportunities: [],
      conclusionCandidate: null,
    },
    rootActionId,
    proposalAttemptId: options.proposalAttemptId ?? `proposal:${rootActionId}:1`,
  };
}

export function directConsequencesProposal(
  rootActionId: string,
  options: ProductionProposalOptions & {
    duration?: { unit: "round" | "second" | "minute" | "hour" | "day"; value: number };
    success?: SemanticActionPlan["success"];
  } = {},
) {
  return productionActionPlanProposal(rootActionId, {
    operation: "resolveDirectConsequences",
    duration: options.duration ?? { unit: "second", value: 1 },
    frozenCosts: [],
    success: options.success ?? [],
    failure: [],
  }, options);
}

export function noncombatCheckProposal(
  rootActionId: string,
  options: ProductionProposalOptions & {
    ability?: "str" | "dex" | "con" | "int" | "wis" | "cha";
    skill?: string | null;
    dc?: number;
    mode?: "normal" | "advantage" | "disadvantage";
    duration?: { unit: "round" | "second" | "minute" | "hour" | "day"; value: number };
    frozenCosts?: SemanticActionPlan["frozenCosts"];
    success?: SemanticActionPlan["success"];
    failure?: SemanticActionPlan["failure"];
  } = {},
) {
  return productionActionPlanProposal(rootActionId, {
    operation: "resolveNoncombatCheck",
    ability: options.ability ?? "str",
    skill: options.skill === undefined ? "athletics" : options.skill,
    dc: options.dc ?? 10,
    mode: options.mode ?? "normal",
    duration: options.duration ?? { unit: "second", value: 1 },
    frozenCosts: options.frozenCosts ?? [],
    success: options.success ?? [],
    failure: options.failure ?? [],
  }, {
    ...options,
    kind: options.kind ?? "checkRequired",
  });
}
