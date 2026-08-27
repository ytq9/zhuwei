import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { handleRoomAction } from "../app/_runtime/lib/room/action";
import {
  assertProposalProjectionBound,
  validateProposal,
} from "../app/_runtime/lib/kp/authoritative-helpers";
import {
  canonicalJson,
  validateAuthoritativeArchive,
} from "../app/_runtime/lib/room/archive";

type JsonRecord = Record<string, unknown>;
type Actor = "alice" | "bob";

type AuthorityRpc = {
  initializeAuthoritative(input: unknown): Promise<unknown>;
  prepare(authenticatedContext: unknown, input: unknown): Promise<unknown>;
  commit(authenticatedContext: unknown, preparedActionId: string, input: unknown): Promise<unknown>;
  observe(authenticatedContext: unknown, query?: unknown): Promise<unknown>;
  acknowledge(authenticatedContext: unknown, deliveryId: string): Promise<unknown>;
  publishDelivery(authenticatedContext: unknown, publication: unknown): Promise<unknown>;
  exportAuthoritativeArchive(archiveExportCapability: unknown): Promise<unknown>;
};

type AuthorityTransition = {
  interactionId: string;
  actor: Actor;
  input: JsonRecord;
  outcome: JsonRecord;
  before: Record<Actor, JsonRecord>;
  after: Record<Actor, JsonRecord>;
};

type ScriptEntry = {
  submissionId: string;
  proposal: (request: JsonRecord) => JsonRecord;
  actorKnowledgeMustContain?: string[];
  actorKnowledgeMustOmit?: string[];
  npcViewer?: { npcId: string; mustContain: string[]; mustOmit: string[] };
  failProposals?: number;
};

type Interaction = {
  id: string;
  actor: Actor;
  expected: "committed" | "awaitingInput" | "retryableFailure" | "rejected" | "concluded";
  input?: JsonRecord;
  reuseInputFrom?: string;
  answerPendingFrom?: string;
  answer?: unknown;
  opensPending?: string;
};

const ROOM_NAME = "kp-multiturn-eval-authoritative-v2";
const ALICE_ID = "character:alice";
const BOB_ID = "character:bob";
const WARDEN_ID = "npc:mill-warden";
const PRIVATE_KNOWLEDGE_REF = "knowledge:powder-ledger-route";
const PRIVATE_CLUE = "账册暗号指出火药从北墙排水沟运入。";
const BOB_PRIVATE_PLAN = "鲍勃准备独自绕到东门截住信使。";
const PROMISE_REF = "promise:alice-return-courier-ring";
const RELATIONSHIP_REF = "relationship:bob-warden-trust";
const DANGER_REF = "danger:unstable-cellar-arch";
const ENDING_CANDIDATE_REF = "ending:ash-leader-surrendered";

const AUTHENTICATED = Object.freeze({
  alice: Object.freeze({ principal: Object.freeze({ id: "principal:alice", sessionVersion: 1 }) }),
  bob: Object.freeze({ principal: Object.freeze({ id: "principal:bob", sessionVersion: 1 }) }),
});

const CHARACTER_BY_ACTOR = Object.freeze({ alice: ALICE_ID, bob: BOB_ID });

const SCORE_THRESHOLDS = Object.freeze({
  minimumInteractions: 24,
  minimumDimension: 1,
  minimumTotal: 18,
  maximumSpotlightDifference: 3,
});

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const AUTHORITY_OWNED_PLAYER_INPUT_KEYS = new Set([
  "actorId",
  "principalId",
  "profiles",
  "profileHash",
  "events",
  "eventLog",
  "state",
  "statePatch",
  "faces",
  "dieFaces",
  "randomnessResults",
]);
const LEGACY_ACTIVE_STATE_KEYS = new Set([
  "gameState",
  "gameStates",
  "game_states",
  "legacyActiveState",
  "legacyCombat",
  "legacyPendingInputs",
  "npc_flags",
  "npcFlags",
]);

function record(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function list(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as unknown[];
}

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

function containsDeepKey(value: unknown, forbidden: Set<string>): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsDeepKey(entry, forbidden));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => forbidden.has(key) || containsDeepKey(nested, forbidden),
  );
}

function assertProductionProposalShape(proposal: JsonRecord) {
  expect(containsDeepKey(proposal, new Set([
    "actorId",
    "principalId",
    "profiles",
    "profileHash",
    "events",
    "eventLog",
    "state",
    "statePatch",
    "faces",
    "dieFaces",
  ]))).toBe(false);
  expect([
    "directSuccess",
    "checkRequired",
    "highRiskFeasible",
    "missingPrerequisite",
    "worldLawViolation",
  ]).toContain(proposal.kind);
  expect(proposal.proposalAttemptId).toEqual(expect.any(String));
  expect(proposal.goal).toEqual(expect.any(String));
  expect(proposal.method).toEqual(expect.any(String));
  expect(Array.isArray(proposal.publicBasisRefs)).toBe(true);
  expect(Array.isArray(proposal.privateBasisRefs)).toBe(true);
  expect(proposal).toHaveProperty("risk");
  expect(proposal).toHaveProperty("pendingInput");
  expect(Array.isArray(proposal.dynamicMaterializations)).toBe(true);
  expect(Array.isArray(proposal.npcActions)).toBe(true);
  expect(proposal).toHaveProperty("mechanicalProposal");
  expect(proposal.scene).toEqual(expect.objectContaining({
    question: expect.any(String),
    pressure: expect.any(String),
    opportunities: expect.any(Array),
  }));
  expect([
    "clarification",
    "playerChoice",
    "resolveImprovisedAction",
    "resolveDynamicDanger",
    "resolveMeaningfulFailure",
    "rejectRepeatedAttempt",
    "raiseEndingCandidate",
    "concludeStory",
    "recordEpilogueChoice",
  ]).not.toContain(proposal.kind);
}

function proposalAttempt(id: string) {
  return `proposal:eval:${id}:1`;
}

type ProductionProposalOptions = {
  kind?: "directSuccess" | "checkRequired" | "highRiskFeasible" | "missingPrerequisite" | "worldLawViolation";
  goal: string;
  method: string;
  publicBasisRefs?: string[];
  privateBasisRefs?: string[];
  estimatedFictionTime?: JsonRecord;
  risk?: JsonRecord | null;
  pendingInput?: JsonRecord | null;
  dynamicMaterializations?: JsonRecord[];
  npcActions?: JsonRecord[];
  mechanicalProposal: JsonRecord | null;
  sceneQuestion?: string;
  pressure?: string;
  opportunities?: string[];
  conclusionCandidate?: string | null;
};

function frozenRisk(
  warning: string,
  successConsequences: string[],
  failureConsequences: string[] = [],
  retryGate: string[] = [],
): JsonRecord {
  return { warning, successConsequences, failureConsequences, retryGate };
}

function productionProposal(id: string, options: ProductionProposalOptions): JsonRecord {
  return {
    kind: options.kind ?? "directSuccess",
    proposalAttemptId: proposalAttempt(id),
    goal: options.goal,
    method: options.method,
    publicBasisRefs: options.publicBasisRefs ?? [],
    privateBasisRefs: options.privateBasisRefs ?? [],
    ...(options.estimatedFictionTime === undefined
      ? {}
      : { estimatedFictionTime: options.estimatedFictionTime }),
    risk: options.risk ?? frozenRisk(
      "行动的时间、可见后果与权限边界已在提交前冻结。",
      [options.goal],
    ),
    pendingInput: options.pendingInput ?? null,
    dynamicMaterializations: options.dynamicMaterializations ?? [],
    npcActions: options.npcActions ?? [],
    mechanicalProposal: options.mechanicalProposal,
    scene: {
      question: options.sceneQuestion ?? `这次行动如何改变当前场景：${options.goal}`,
      pressure: options.pressure ?? "世界会依据已提交的行动与虚构时间继续变化。",
      opportunities: options.opportunities ?? [],
      conclusionCandidate: options.conclusionCandidate ?? null,
    },
  };
}

function factMaterialization(
  factRef: string,
  name: string,
  visibilityPolicyRef = "visibility:scene-observers",
  kind: "fact" | "location" | "passage" | "npc" | "enemy" | "item" | "hazard" | "opportunity" = "fact",
  definition: JsonRecord = { name },
): JsonRecord {
  return {
    kind,
    factRef,
    causalBasisRefs: [],
    visibilityPolicyRef,
    definition,
  };
}

function durationFromMicros(value: unknown): JsonRecord {
  const micros = typeof value === "string" && /^[1-9][0-9]*$/.test(value)
    ? BigInt(value)
    : 60_000_000n;
  const units = [
    [86_400_000_000n, "day"],
    [3_600_000_000n, "hour"],
    [60_000_000n, "minute"],
    [1_000_000n, "second"],
  ] as const;
  for (const [factor, unit] of units) {
    if (micros % factor === 0n) return { unit, value: Number(micros / factor) };
  }
  return { unit: "round", value: 1 };
}

function pendingProposal(
  id: string,
  kind: "clarification" | "playerChoice",
  goal: string,
  method: string,
  prompt: string,
  choices: Array<{ id: string; label: string; consequence: string }>,
): JsonRecord {
  return productionProposal(id, {
    goal,
    method,
    risk: null,
    pendingInput: { kind, prompt, choices },
    mechanicalProposal: null,
    sceneQuestion: prompt,
    pressure: "没有玩家的明确回答，现实超时或断线都不会推进虚构时间。",
    opportunities: choices.map(({ label }) => label),
  });
}

function directProposal(id: string, method: string, outcome: JsonRecord): JsonRecord {
  const goal = typeof outcome.publicResult === "string" ? outcome.publicResult : method;
  const duration = durationFromMicros(outcome.durationMicros);
  const base = {
    goal,
    method,
    mechanicalProposal: {
      operation: "resolveDirectConsequences",
      duration,
      frozenCosts: [],
      success: [] as JsonRecord[],
      failure: [],
    },
  } satisfies ProductionProposalOptions;
  switch (outcome.kind) {
    case "observeScene":
    case "advanceFictionTime":
      return productionProposal(id, {
        ...base,
        privateBasisRefs: Array.isArray(outcome.knowledgeBasisRefs)
          ? outcome.knowledgeBasisRefs.filter((entry): entry is string => typeof entry === "string")
          : [],
      });
    case "acquireKnowledge": {
      const knowledgeRef = String(outcome.knowledgeRef);
      const sourceFactRef = String(outcome.sourceFactRef ?? `fact:source:${knowledgeRef}`);
      const destinationSceneId = typeof outcome.destinationSceneId === "string"
        ? outcome.destinationSceneId
        : undefined;
      return productionProposal(id, {
        ...base,
        dynamicMaterializations: [factMaterialization(
          sourceFactRef,
          goal,
          `visibility:knowledge-holder:${String(outcome.characterId)}`,
          sourceFactRef.startsWith("artifact:") ? "item" : "fact",
        )],
        mechanicalProposal: {
          ...base.mechanicalProposal,
          success: [
            {
              kind: "acquireKnowledge",
              knowledgeRef,
              value: outcome.content ?? goal,
              definitionRef: sourceFactRef,
            },
            ...(destinationSceneId === undefined
              ? []
              : [{ kind: "moveEntity", sceneRef: destinationSceneId }]),
          ],
        },
      });
    }
    case "changeRelationship": {
      const factRef = `fact:relationship-basis:${id}`;
      const subjectEntityIds = Array.isArray(outcome.subjectEntityIds)
        ? outcome.subjectEntityIds.filter((entry): entry is string => typeof entry === "string")
        : [];
      return productionProposal(id, {
        ...base,
        dynamicMaterializations: [factMaterialization(factRef, goal)],
        mechanicalProposal: {
          ...base.mechanicalProposal,
          success: [{
            kind: "updateRelationship",
            relationshipRef: outcome.relationshipRef,
            recipientRefs: subjectEntityIds.filter((subjectId) => subjectId !== BOB_ID),
            value: outcome.change,
            definitionRef: factRef,
          }],
        },
      });
    }
    case "makePromise": {
      const factRef = `fact:promise-basis:${id}`;
      return productionProposal(id, {
        ...base,
        dynamicMaterializations: [factMaterialization(factRef, goal)],
        mechanicalProposal: {
          ...base.mechanicalProposal,
          success: [{
            kind: "recordCommitment",
            commitmentRef: outcome.promiseRef,
            targetRef: outcome.promiseeEntityId,
            value: outcome.content,
            status: "明确承诺，直到完成或被权威更正",
          }],
        },
      });
    }
    case "moveAndObserve":
    case "moveCharacter": {
      const destinationSceneId = String(outcome.destinationSceneId);
      const locationFactRef = `fact:location:${destinationSceneId}`;
      return productionProposal(id, {
        ...base,
        dynamicMaterializations: outcome.existingScene === true
          ? []
          : [factMaterialization(
              locationFactRef,
              goal,
              "visibility:scene-observers",
              "location",
              { sceneId: destinationSceneId, name: goal },
            )],
        mechanicalProposal: {
          ...base.mechanicalProposal,
          success: [{ kind: "moveEntity", sceneRef: destinationSceneId }],
        },
      });
    }
    case "formCharacterPlan": {
      const planRef = String(outcome.planRef);
      return productionProposal(id, {
        ...base,
        dynamicMaterializations: [factMaterialization(
          planRef,
          "角色私下形成的计划",
          `visibility:knowledge-holder:${String(outcome.characterId)}`,
        )],
        mechanicalProposal: {
          ...base.mechanicalProposal,
          success: [{
            kind: "acquireKnowledge",
            knowledgeRef: planRef,
            value: outcome.content,
            definitionRef: planRef,
          }],
        },
      });
    }
    case "acceptEndingCandidate": {
      const factRef = `fact:ending-acceptance:${String(outcome.endingCandidateRef)}:${String(outcome.characterId)}`;
      return productionProposal(id, {
        ...base,
        dynamicMaterializations: [factMaterialization(factRef, goal, "visibility:public")],
      });
    }
    default:
      throw new Error(`unmapped direct evaluation outcome: ${String(outcome.kind)}`);
  }
}

function intent(id: string, actor: Actor, text: string): JsonRecord {
  return {
    kind: "intent",
    submissionId: `submission:eval:${id}`,
    characterId: CHARACTER_BY_ACTOR[actor],
    text,
  };
}

const SCRIPTS: ScriptEntry[] = [
  {
    submissionId: "submission:eval:01-vial-clarification",
    proposal: () => pendingProposal(
      "01",
      "clarification",
      "明确瓶子行动的目标与风险",
      "先确认玩家所说的‘扔过去’是检查还是引爆",
      "你是要先检查瓶中物，还是立刻把它砸向拱门？后者可能引爆现场。",
      [
        { id: "inspect", label: "先检查瓶子", consequence: "不引爆，先取得瓶口证据" },
        { id: "throw", label: "立刻掷向拱门", consequence: "接受可能引爆现场的高风险" },
      ],
    ),
  },
  {
    submissionId: "submission:eval:02-vial-answer",
    proposal: () => directProposal("02", "在原地谨慎检查瓶口残留物", {
      kind: "acquireKnowledge",
      characterId: ALICE_ID,
      knowledgeRef: PRIVATE_KNOWLEDGE_REF,
      knowledgeKind: "sensoryEvidence",
      visibility: "private",
      content: PRIVATE_CLUE,
      sourceFactRef: "fact:powder-residue-in-vial",
      publicResult: "你辨认出瓶口残留的火药粉，并看懂了账册暗号。",
    }),
  },
  {
    submissionId: "submission:eval:03-bob-orients",
    proposal: () => directProposal("03", "观察院门与守夜人的位置", {
      kind: "observeScene",
      sceneId: "yard",
      publicResult: "院门仍开着，守夜人沿固定路线巡逻。",
    }),
  },
  {
    submissionId: "submission:eval:04-chalk-check",
    proposal: () => productionProposal("04", {
      kind: "checkRequired",
      goal: "辨认墙上风化的交货日期",
      method: "结合火药残留辨认墙上的旧粉笔记号",
      privateBasisRefs: [PRIVATE_KNOWLEDGE_REF],
      risk: frozenRisk(
        "记号已经风化，成功与失败都会改变调查路线。",
        ["取得完整交货日期"],
        ["无法复原风化部分并消耗一分钟"],
        ["methodChanged", "factsChanged"],
      ),
      dynamicMaterializations: [factMaterialization(
        "fact:chalk-delivery-mark",
        "墙上风化的交货粉笔记号",
        "visibility:scene-observers",
      )],
      mechanicalProposal: {
        operation: "resolveNoncombatCheck",
        ability: "int",
        skill: "investigation",
        dc: 13,
        mode: "normal",
        duration: { unit: "minute", value: 1 },
        frozenCosts: [],
        success: [{
          kind: "acquireKnowledge",
          knowledgeRef: "knowledge:powder-delivery-date",
          value: "完整的交货日期",
          definitionRef: "fact:chalk-delivery-mark",
        }],
        failure: [],
      },
      sceneQuestion: "爱丽丝能否从风化记号中读出完整交货日期？",
      pressure: "巡逻脚步正在接近，反复刮擦会暴露位置。",
      opportunities: ["寻找账房副本", "询问曾在磨坊工作的人"],
    }),
    actorKnowledgeMustContain: [PRIVATE_KNOWLEDGE_REF],
  },
  {
    submissionId: "submission:eval:06-warden-talk",
    npcViewer: {
      npcId: WARDEN_ID,
      mustContain: ["knowledge:warden-closing-duty"],
      mustOmit: [PRIVATE_KNOWLEDGE_REF, PRIVATE_CLUE, BOB_PRIVATE_PLAN],
    },
    proposal: () => productionProposal("06", {
      goal: "从守夜人的有限知识取得东门闭门时间",
      method: "直接询问守夜人，并只采用他按职责知道的内容",
      dynamicMaterializations: [factMaterialization(
        "claim:warden-east-gate-closes-at-dusk",
        "守夜人关于东门闭门时间的有来源主张",
        `visibility:knowledge-holder:${BOB_ID}`,
      )],
      npcActions: [{
        npcId: WARDEN_ID,
        goal: "按职责说明闭门时间，但不猜测玩家的秘密计划",
        method: "说明东门会在日落时关闭",
        knowledgeRefs: ["knowledge:warden-closing-duty"],
        mechanicalProposal: null,
      }],
      mechanicalProposal: {
        operation: "resolveDirectConsequences",
        duration: { unit: "minute", value: 1 },
        frozenCosts: [],
        success: [{
          kind: "acquireKnowledge",
          knowledgeRef: "claim:warden-east-gate-closes-at-dusk",
          value: "守夜人说东门会在日落时关闭。",
          definitionRef: "claim:warden-east-gate-closes-at-dusk",
        }],
        failure: [],
      },
      sceneQuestion: "守夜人愿意按自己的职责知识回答到什么程度？",
      pressure: "日落正在临近。",
    }),
  },
  {
    submissionId: "submission:eval:07-courier-promise",
    proposal: () => directProposal("07", "明确答应把戒指交还给信使的妹妹", {
      kind: "makePromise",
      promiseRef: PROMISE_REF,
      promisorCharacterId: ALICE_ID,
      promiseeEntityId: "npc:wounded-courier",
      content: "把铜戒指交给信使的妹妹",
      publicResult: "信使听清承诺后把铜戒指交给了你。",
    }),
  },
  {
    submissionId: "submission:eval:08-bob-scouts",
    proposal: () => directProposal("08", "沿院墙侦察水泵房入口", {
      kind: "moveAndObserve",
      destinationSceneId: "yard-pump-house",
      durationMicros: "120000000",
      publicResult: "你到达水泵房外，发现屋顶有一条旧维修梯。",
    }),
  },
  {
    submissionId: "submission:eval:09-danger-warning",
    proposal: () => productionProposal("09", {
      goal: "确认拱顶的落灰与断裂声是否构成可行动的危险警告",
      method: "停在危险区外观察砖缝、梁木和承重方向",
      dynamicMaterializations: [factMaterialization(
        DANGER_REF,
        "松动的地窖拱顶",
        `visibility:knowledge-holder:${ALICE_ID}`,
        "hazard",
        {
          name: "松动的地窖拱顶",
          warningEvidence: ["砖缝持续落灰", "上方梁木发出短促断裂声"],
          trigger: "生物进入拱顶正下方",
          avoidOrMitigate: ["绕行", "用长杆支撑后快速通过"],
          save: { ability: "dex", dc: 14 },
          area: { kind: "line", lengthFeet: 15, widthFeet: 5 },
          damageFormula: "2d6 bludgeoning",
        },
      )],
      mechanicalProposal: {
        operation: "resolveDirectConsequences",
        duration: { unit: "minute", value: 1 },
        frozenCosts: [],
        success: [{
          kind: "acquireKnowledge",
          knowledgeRef: DANGER_REF,
          value: "落灰和梁木断裂声明确预示拱顶可能坍塌。",
          definitionRef: DANGER_REF,
        }],
        failure: [],
      },
      sceneQuestion: "爱丽丝能否在进入触发区前识别拱顶危险？",
      pressure: "砖缝仍在落灰，结构会随虚构时间恶化。",
      opportunities: ["绕行", "用长杆支撑后快速通过"],
    }),
  },
  {
    submissionId: "submission:eval:10-bob-listens",
    proposal: () => directProposal("10", "在水泵房外倾听另一地点的动静", {
      kind: "observeScene",
      sceneId: "yard-pump-house",
      publicResult: "你只听见水轮和院内脚步，听不到地窖里的低声交谈。",
    }),
    actorKnowledgeMustOmit: [PRIVATE_KNOWLEDGE_REF, PRIVATE_CLUE],
  },
  {
    submissionId: "submission:eval:11-cross-choice",
    proposal: () => pendingProposal(
      "11",
      "playerChoice",
      "选择如何穿过已经固化的松动拱顶危险",
      "冻结绕行或支撑后通过的明确代价",
      "你要绕行，还是消耗撬棍支撑拱顶后冒险通过？",
      [
        { id: "detour", label: "绕行", consequence: "更慢但不触发坍塌" },
        { id: "brace", label: "用撬棍支撑", consequence: "消耗工具并进行敏捷豁免" },
      ],
    ),
    actorKnowledgeMustContain: [DANGER_REF],
  },
  {
    submissionId: "submission:eval:12-arch-answer",
    proposal: () => productionProposal("12", {
      kind: "highRiskFeasible",
      goal: "用撬棍支撑后穿过松动拱顶",
      method: "按玩家明确选择的 brace 方法支撑并快速通过",
      privateBasisRefs: [DANGER_REF],
      dynamicMaterializations: [factMaterialization(
        "fact:location:cellar-beyond-arch",
        "松动拱顶后的地窖通道",
        "visibility:scene-observers",
        "location",
        { sceneId: "cellar-beyond-arch", name: "松动拱顶后的地窖通道" },
      )],
      risk: frozenRisk(
        "拱顶危险已先固化；本次敏捷豁免 DC 14 在权威骰面前冻结。",
        ["消耗撬棍，在落砖前穿过触发区"],
        ["消耗撬棍并受到 3 点钝击伤害，但仍被冲击带过拱顶，局面继续推进"],
        ["methodChanged", "positionChanged", "materialAssistance"],
      ),
      mechanicalProposal: {
        operation: "resolveNoncombatSave",
        saveAbility: "dex",
        dc: 14,
        mode: "advantage",
        duration: { unit: "round", value: 1 },
        frozenCosts: [{ kind: "consumeArtifact", artifactRef: "item:crowbar", count: 1 }],
        success: [{
          kind: "moveEntity",
          entityRef: ALICE_ID,
          sceneRef: "cellar-beyond-arch",
        }],
        failure: [
          {
            kind: "changeHitPoints",
            targetRef: ALICE_ID,
            amount: -3,
          },
          {
            kind: "moveEntity",
            entityRef: ALICE_ID,
            sceneRef: "cellar-beyond-arch",
          },
        ],
      },
      sceneQuestion: "爱丽丝能否在拱顶落砖前完成支撑并通过？",
      pressure: "支撑动作一旦开始，结构危险会立即结算。",
      opportunities: ["成功通过", "失败但局面仍向前推进"],
    }),
    actorKnowledgeMustContain: [DANGER_REF],
  },
  {
    submissionId: "submission:eval:13-bob-helps-warden",
    proposal: () => directProposal("13", "帮守夜人把卡住的院门抬回门轴", {
      kind: "changeRelationship",
      relationshipRef: RELATIONSHIP_REF,
      subjectEntityIds: [BOB_ID, WARDEN_ID],
      change: "trust+1",
      publicResult: "守夜人记住了你的帮助，态度明显缓和。",
    }),
  },
  {
    submissionId: "submission:eval:14-alice-ledger",
    proposal: () => directProposal("14", "按暗号寻找藏在排水沟后的账册", {
      kind: "acquireKnowledge",
      characterId: ALICE_ID,
      knowledgeRef: "knowledge:ledger-names",
      knowledgeKind: "documentEvidence",
      visibility: "private",
      sourceFactRef: "artifact:ash-ledger",
      content: "账册列出灰烬帮首领与两名收货人。",
      destinationSceneId: "yard",
      publicResult: "你独自读到了账册上的收货人姓名。",
    }),
    actorKnowledgeMustContain: [PRIVATE_KNOWLEDGE_REF],
  },
  {
    submissionId: "submission:eval:15-alice-shares",
    proposal: () => productionProposal("15", {
      goal: "通过已固化传声管把排水沟路线准确分享给鲍勃",
      method: "使用 fact:cellar-yard-speaking-tube 进行世界内交流",
      privateBasisRefs: [PRIVATE_KNOWLEDGE_REF],
      publicBasisRefs: ["fact:cellar-yard-speaking-tube"],
      mechanicalProposal: {
        operation: "changeKnowledge",
        knowledgeRef: PRIVATE_KNOWLEDGE_REF,
        mediumFactRef: "fact:cellar-yard-speaking-tube",
        recipientRefs: [BOB_ID],
      },
      sceneQuestion: "传声管能否把爱丽丝实际持有的线索传给指定接收者？",
      pressure: "只向指定接收者传播，不追溯泄露给缺席者。",
      opportunities: ["鲍勃可依据新知识行动"],
    }),
    actorKnowledgeMustContain: [PRIVATE_KNOWLEDGE_REF],
  },
  {
    submissionId: "submission:eval:16-bob-uses-shared",
    proposal: () => directProposal("16", "依据爱丽丝刚分享的排水沟路线寻找外侧出口", {
      kind: "observeScene",
      knowledgeBasisRefs: [PRIVATE_KNOWLEDGE_REF],
      publicResult: "你在院墙外找到了排水沟出口。",
    }),
    actorKnowledgeMustContain: [PRIVATE_KNOWLEDGE_REF],
  },
  {
    submissionId: "submission:eval:17-bob-private-plan",
    proposal: () => directProposal("17", "在无人能听见处形成绕东门截信使的个人计划", {
      kind: "formCharacterPlan",
      characterId: BOB_ID,
      planRef: "plan:bob-east-gate",
      visibility: "private",
      content: BOB_PRIVATE_PLAN,
      publicResult: "你记下了自己的东门绕行计划。",
    }),
  },
  {
    submissionId: "submission:eval:18-npc-patrol",
    npcViewer: {
      npcId: WARDEN_ID,
      mustContain: ["knowledge:warden-closing-duty", RELATIONSHIP_REF],
      mustOmit: [PRIVATE_KNOWLEDGE_REF, PRIVATE_CLUE, BOB_PRIVATE_PLAN, "plan:bob-east-gate"],
    },
    proposal: () => productionProposal("18", {
      goal: "观察守夜人依据有限知识继续例行关门巡逻",
      method: "只从守夜人的 NPC Viewer 形成下一行动，不读取玩家私人计划",
      npcActions: [{
        npcId: WARDEN_ID,
        goal: "继续例行关门巡逻，并对帮助过自己的鲍勃保持友善",
        method: "照常走向北侧门闩，不针对未知秘密路线布防",
        knowledgeRefs: ["knowledge:warden-closing-duty"],
        mechanicalProposal: null,
      }],
      mechanicalProposal: {
        operation: "resolveDirectConsequences",
        duration: { unit: "minute", value: 1 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
      sceneQuestion: "守夜人会怎样按自己的职责与已知关系继续行动？",
      pressure: "闭门时间仍在接近。",
      opportunities: ["观察巡逻路线", "在不泄露秘密计划的情况下交涉"],
    }),
  },
  {
    submissionId: "submission:eval:19-model-recovery",
    failProposals: 1,
    proposal: () => directProposal("19", "查看维修梯能否承重", {
      kind: "observeScene",
      publicResult: "维修梯虽然锈蚀，但仍能承受一个人的重量。",
    }),
  },
  {
    submissionId: "submission:eval:21-alice-waits",
    proposal: () => productionProposal("21", {
      goal: "等待十分钟并让到期的信使计划与吊桥后果真实落地",
      method: "守在地窖出口等待约定信号",
      estimatedFictionTime: { unit: "minute", value: 10 },
      dynamicMaterializations: [
        factMaterialization(
          "plan:ash-courier-departs-east-gate",
          "东门信使已经按计划离开",
          "visibility:public",
        ),
        factMaterialization(
          "fact:east-drawbridge-burned",
          "东门后的吊桥已经烧断",
          "visibility:public",
        ),
      ],
      mechanicalProposal: {
        operation: "resolveDirectConsequences",
        duration: { unit: "minute", value: 10 },
        frozenCosts: [],
        success: [],
        failure: [],
      },
      sceneQuestion: "等待期间哪些已到期世界计划会产生可观察后果？",
      pressure: "虚构时间推进会让信使离开并关闭旧追击路线。",
      opportunities: ["寻找屋顶路线", "沿河岸追踪"],
    }),
  },
  {
    submissionId: "submission:eval:22-meaningful-failure",
    proposal: () => productionProposal("22", {
      goal: "从东门追上已经离开的信使",
      method: "从东门直追已经离开的信使",
      kind: "missingPrerequisite",
      publicBasisRefs: ["plan:ash-courier-departs-east-gate", "fact:east-drawbridge-burned"],
      risk: frozenRisk(
        "信使已经离开且吊桥已毁；原方法会产生确定而有意义的失败。",
        [],
        ["东门追击路线关闭并消耗两分钟"],
        ["methodChanged", "positionChanged", "situationAdvanced"],
      ),
      mechanicalProposal: {
        operation: "commitMeaningfulFailure",
        precedentRef: "precedent:bob-catch-courier-via-east-gate",
        duration: { unit: "minute", value: 2 },
        basisRefs: ["plan:ash-courier-departs-east-gate", "fact:east-drawbridge-burned"],
        consequenceRefs: ["route:east-drawbridge"],
        newOptions: [
          { id: "roof", summary: "从维修梯上屋顶追踪烟迹" },
          { id: "river", summary: "沿河岸寻找信使的船" },
        ],
      },
      sceneQuestion: "吊桥毁坏后，失败如何改变追击局面并留下新选择？",
      pressure: "信使仍在远离磨坊。",
      opportunities: ["从维修梯上屋顶追踪烟迹", "沿河岸寻找信使的船"],
    }),
  },
  {
    submissionId: "submission:eval:23-unchanged-retry",
    proposal: () => productionProposal("23", {
      kind: "checkRequired",
      goal: "再次从同一东门路线追上信使",
      method: "从东门直追已经离开的信使",
      publicBasisRefs: ["fact:east-drawbridge-burned"],
      risk: frozenRisk(
        "方法、位置和事实都没有变化，Rules 必须依据既有先例拒绝原样重复。",
        [],
        ["重复尝试不产生事件、不掷骰也不推进虚构时间"],
        ["methodChanged", "factsChanged", "positionChanged"],
      ),
      mechanicalProposal: {
        operation: "retryFailedAction",
        precedentRef: "precedent:bob-catch-courier-via-east-gate",
      },
      sceneQuestion: "这次尝试是否提供了足以改变失败先例的新方法或事实？",
      pressure: "相同方法不能通过重掷改写已经提交的失败。",
      opportunities: ["改走屋顶", "寻找河岸路线"],
    }),
  },
  {
    submissionId: "submission:eval:24-roof-route",
    proposal: () => directProposal("24", "改走维修梯，从屋顶追踪烟迹", {
      kind: "moveAndObserve",
      methodChangedFromPrecedent: "precedent:bob-catch-courier-via-east-gate",
      destinationSceneId: "mill-roof",
      publicResult: "你从屋顶看见信使正沿河岸向北跑。",
    }),
  },
  {
    submissionId: "submission:eval:25-alice-regroups",
    proposal: () => directProposal("25", "从地窖出口返回院内会合", {
      kind: "moveCharacter",
      destinationSceneId: "mill-yard-final",
      durationMicros: "120000000",
      publicResult: "你回到院内，与鲍勃约定在磨坊正门会合。",
    }),
    actorKnowledgeMustContain: [PROMISE_REF, PRIVATE_KNOWLEDGE_REF],
  },
  {
    submissionId: "submission:eval:26-bob-regroups",
    proposal: () => directProposal("26", "放弃追远，带着新情报返回磨坊正门", {
      kind: "moveCharacter",
      destinationSceneId: "mill-yard-final",
      durationMicros: "600000000",
      existingScene: true,
      publicResult: "你返回正门，与爱丽丝重新会合。",
    }),
    actorKnowledgeMustContain: [RELATIONSHIP_REF, PRIVATE_KNOWLEDGE_REF],
  },
  {
    submissionId: "submission:eval:27-ending-candidate",
    proposal: () => productionProposal("27", {
      goal: "依据缴械、账册与火势受控事实提出真实收束候选",
      method: "用账册要求已经缴械的首领正式投降",
      dynamicMaterializations: [
        factMaterialization("fact:ash-leader-disarmed", "灰烬帮首领已经缴械", "visibility:public"),
        factMaterialization("fact:ash-ledger-secured", "灰烬帮账册已经由玩家控制", "visibility:public"),
        factMaterialization("fact:mill-fire-contained", "磨坊火势已经得到控制", "visibility:public"),
      ],
      mechanicalProposal: {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "raiseEndingCandidate",
        endingCandidateRef: ENDING_CANDIDATE_REF,
        basisRefs: ["fact:ash-leader-disarmed", "fact:ash-ledger-secured", "fact:mill-fire-contained"],
        unresolvedRefs: [PROMISE_REF],
      },
      sceneQuestion: "核心冲突是否已经具备可由玩家接受或拒绝的真实收束条件？",
      pressure: "首领已经缴械，但玩家仍拥有是否接受投降的决定权。",
      opportunities: ["接受投降", "依据既有事实继续合法行动"],
      conclusionCandidate: ENDING_CANDIDATE_REF,
    }),
  },
  {
    submissionId: "submission:eval:28-surrender-choice",
    proposal: () => pendingProposal(
      "28",
      "playerChoice",
      "决定是否接受已固化的投降收束候选",
      "把是否停止追击交还鲍勃本人",
      "鲍勃是否接受首领投降并停止追击？",
      [
        { id: "accept", label: "接受投降", consequence: "停止追击并允许核心冲突收束" },
        { id: "continue", label: "继续合法追击", consequence: "不接受当前收束，世界按合法行动继续" },
      ],
    ),
  },
  {
    submissionId: "submission:eval:29-surrender-answer",
    proposal: () => directProposal("29", "明确接受首领投降并停止追击", {
      kind: "acceptEndingCandidate",
      endingCandidateRef: ENDING_CANDIDATE_REF,
      characterId: BOB_ID,
      publicResult: "鲍勃接受投降，停止继续追击。",
    }),
  },
  {
    submissionId: "submission:eval:30-conclusion",
    proposal: () => productionProposal("30", {
      goal: "在双方接受投降后真实结束磨坊核心冲突",
      method: "确认收束候选并保留跨章节承诺、关系与知识",
      publicBasisRefs: ["fact:ash-leader-disarmed", "fact:ash-ledger-secured", "fact:mill-fire-contained"],
      mechanicalProposal: {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "concludeStory",
        endingCandidateRef: ENDING_CANDIDATE_REF,
        storyRef: "story:ash-leader-surrendered",
        outcome: "磨坊冲突真实收束；账册、承诺和关系继续存在。",
        consequenceRefs: [PROMISE_REF, RELATIONSHIP_REF, PRIVATE_KNOWLEDGE_REF],
      },
      sceneQuestion: "玩家接受投降后，磨坊冲突是否已经真实收束？",
      pressure: "收束不得自动抹去仍未履行的承诺或私人知识。",
      opportunities: ["选择个人尾声", "明确开始续篇", "结束本章"],
      conclusionCandidate: ENDING_CANDIDATE_REF,
    }),
    actorKnowledgeMustContain: [PROMISE_REF, PRIVATE_KNOWLEDGE_REF],
  },
  {
    submissionId: "submission:eval:31-epilogue",
    proposal: () => productionProposal("31", {
      goal: "记录鲍勃本人明确选择的个人尾声",
      method: "把守夜人的证词和账册一起交给镇议会，然后结束本章",
      mechanicalProposal: {
        operation: "advanceCampaignLifecycle",
        lifecycleAction: "recordEpilogueChoice",
        storyRef: "story:ash-leader-surrendered",
        choice: "把守夜人的证词和账册一起交给镇议会，然后结束本章。",
      },
      sceneQuestion: "鲍勃选择怎样结束自己的本章镜头？",
      pressure: "尾声只记录玩家选择，不自动制造幕后黑手或续篇。",
      opportunities: ["结束本章"],
      conclusionCandidate: ENDING_CANDIDATE_REF,
    }),
    actorKnowledgeMustContain: [RELATIONSHIP_REF, PRIVATE_KNOWLEDGE_REF],
  },
];

const INTERACTIONS: Interaction[] = [
  { id: "01", actor: "alice", expected: "awaitingInput", input: intent("01-vial-clarification", "alice", "我把瓶子扔过去。"), opensPending: "vial" },
  { id: "02", actor: "alice", expected: "committed", answerPendingFrom: "vial", answer: { choiceId: "inspect" } },
  { id: "03", actor: "bob", expected: "committed", input: intent("03-bob-orients", "bob", "我先观察院门和守夜人的位置。") },
  { id: "04", actor: "alice", expected: "committed", input: intent("04-chalk-check", "alice", "我结合瓶口火药粉辨认墙上的粉笔记号。") },
  { id: "05", actor: "alice", expected: "committed", reuseInputFrom: "04" },
  { id: "06", actor: "bob", expected: "committed", input: intent("06-warden-talk", "bob", "我问守夜人东门什么时候关闭。") },
  { id: "07", actor: "alice", expected: "committed", input: intent("07-courier-promise", "alice", "我答应信使，会把他的戒指交给妹妹。") },
  { id: "08", actor: "bob", expected: "committed", input: intent("08-bob-scouts", "bob", "我沿院墙侦察水泵房入口。") },
  { id: "09", actor: "alice", expected: "committed", input: intent("09-danger-warning", "alice", "我停下来检查地窖拱顶的落灰和断裂声。") },
  { id: "10", actor: "bob", expected: "committed", input: intent("10-bob-listens", "bob", "我在水泵房外仔细听另一边的动静。") },
  { id: "11", actor: "alice", expected: "awaitingInput", input: intent("11-cross-choice", "alice", "我想穿过这道松动的拱顶。"), opensPending: "arch" },
  { id: "12", actor: "alice", expected: "committed", answerPendingFrom: "arch", answer: { choiceId: "brace" } },
  { id: "13", actor: "bob", expected: "committed", input: intent("13-bob-helps-warden", "bob", "我帮守夜人把卡住的院门抬回门轴。") },
  { id: "14", actor: "alice", expected: "committed", input: intent("14-alice-ledger", "alice", "我按暗号寻找排水沟后的账册。") },
  { id: "15", actor: "alice", expected: "committed", input: intent("15-alice-shares", "alice", "我通过传声管把排水沟路线准确告诉鲍勃。") },
  { id: "16", actor: "bob", expected: "committed", input: intent("16-bob-uses-shared", "bob", "我依据爱丽丝分享的路线找外侧出口。") },
  { id: "17", actor: "bob", expected: "committed", input: intent("17-bob-private-plan", "bob", BOB_PRIVATE_PLAN) },
  { id: "18", actor: "alice", expected: "committed", input: intent("18-npc-patrol", "alice", "我观察守夜人接下来怎么行动。") },
  { id: "19", actor: "bob", expected: "retryableFailure", input: intent("19-model-recovery", "bob", "我查看维修梯能否承重。") },
  { id: "20", actor: "bob", expected: "committed", reuseInputFrom: "19" },
  { id: "21", actor: "alice", expected: "committed", input: intent("21-alice-waits", "alice", "我守在地窖出口等待约定信号。") },
  { id: "22", actor: "bob", expected: "committed", input: intent("22-meaningful-failure", "bob", "我从东门直追已经离开的信使。") },
  { id: "23", actor: "bob", expected: "rejected", input: intent("23-unchanged-retry", "bob", "我仍从同一位置、用同一方法冲过烧断的东门吊桥追信使。") },
  { id: "24", actor: "bob", expected: "committed", input: intent("24-roof-route", "bob", "我改走维修梯，从屋顶追踪烟迹。") },
  { id: "25", actor: "alice", expected: "committed", input: intent("25-alice-regroups", "alice", "我从地窖出口返回院内会合。") },
  { id: "26", actor: "bob", expected: "committed", input: intent("26-bob-regroups", "bob", "我带着情报返回磨坊正门和爱丽丝会合。") },
  { id: "27", actor: "alice", expected: "committed", input: intent("27-ending-candidate", "alice", "我用账册要求已经缴械的首领正式投降。") },
  { id: "28", actor: "bob", expected: "awaitingInput", input: intent("28-surrender-choice", "bob", "我回应首领的投降。"), opensPending: "surrender" },
  { id: "29", actor: "bob", expected: "committed", answerPendingFrom: "surrender", answer: { choiceId: "accept" } },
  { id: "30", actor: "alice", expected: "concluded", input: intent("30-conclusion", "alice", "我也接受投降，让磨坊冲突在这里收束。") },
  { id: "31", actor: "bob", expected: "committed", input: intent("31-epilogue", "bob", "我的尾声是把证词和账册交给镇议会，然后结束本章。") },
];

class ProjectionBoundScriptedKp {
  readonly proposalProjections: Array<{ submissionId: string; projection: unknown }> = [];
  readonly narrationAudits: Array<{
    rootActionId: string;
    projection: unknown;
    projectionHash: string;
    body: string;
  }> = [];
  readonly rootActionsBySubmission = new Map<string, Set<string>>();
  private readonly entries = new Map(SCRIPTS.map((entry) => [entry.submissionId, entry]));
  private readonly remainingFailures = new Map(
    SCRIPTS.filter((entry) => entry.failProposals).map(
      (entry) => [entry.submissionId, entry.failProposals ?? 0],
    ),
  );

  async propose(requestValue: unknown): Promise<unknown> {
    const request = record(requestValue, "KP proposal request");
    const input = record(request.input, "authenticated action passed to KP");
    const submissionId = String(input.submissionId);
    const entry = this.entries.get(submissionId);
    expect(entry, `no scripted production proposal for ${submissionId}`).toBeDefined();
    const rootActionId = String(request.rootActionId);
    const roots = this.rootActionsBySubmission.get(submissionId) ?? new Set<string>();
    roots.add(rootActionId);
    this.rootActionsBySubmission.set(submissionId, roots);

    const projection = record(request.projection, "KP-only prepared projection");
    expect(projection.viewer).toMatchObject({ kind: "kp" });
    expect(containsDeepKey(projection, new Set(["worldState", "rawEvents", "messages", "prompt"]))).toBe(false);
    this.proposalProjections.push({ submissionId, projection: structuredClone(projection) });

    const actorProjection = record(projection.actorProjection, "actor projection inside KP view");
    const actorSerialized = serialized(actorProjection);
    for (const required of entry?.actorKnowledgeMustContain ?? []) expect(actorSerialized).toContain(required);
    for (const forbidden of entry?.actorKnowledgeMustOmit ?? []) expect(actorSerialized).not.toContain(forbidden);

    if (entry?.npcViewer) {
      const npcViewers = record(projection.npcViewers, "separate NPC viewer map");
      const npcProjection = record(npcViewers[entry.npcViewer.npcId], "finite NPC projection");
      const npcSerialized = serialized(npcProjection);
      for (const required of entry.npcViewer.mustContain) expect(npcSerialized).toContain(required);
      for (const forbidden of entry.npcViewer.mustOmit) expect(npcSerialized).not.toContain(forbidden);
    }

    const failuresLeft = this.remainingFailures.get(submissionId) ?? 0;
    if (failuresLeft > 0) {
      this.remainingFailures.set(submissionId, failuresLeft - 1);
      throw Object.assign(new Error("scripted model capacity failure"), { retryAfter: 1 });
    }

    const proposal = entry!.proposal(request);
    assertProductionProposalShape(proposal);
    const { proposalAttemptId, ...draft } = proposal;
    const validated = validateProposal(draft);
    assertProposalProjectionBound(validated, projection);
    return { ...validated, proposalAttemptId };
  }

  async narrate(requestValue: unknown): Promise<unknown> {
    const request = record(requestValue, "post-commit narration request");
    const projection = record(request.projection, "post-commit audience projection");
    expect(projection.viewer).toMatchObject({ kind: "player", characterId: expect.any(String) });
    expect(projection.projectionHash).toEqual(expect.any(String));
    expect(containsDeepKey(projection, new Set([
      "kpViewer",
      "npcViewers",
      "worldState",
      "rawEvents",
      "messages",
      "narrationHistory",
      "prompt",
    ]))).toBe(false);

    const committedDelta = record(projection.committedDelta, "observer-safe committed delta");
    const changes = list(committedDelta.changes, "observer-safe committed changes").map(
      (entry) => record(entry, "observer-safe committed change"),
    );
    expect(changes.length).toBeGreaterThan(0);
    const narration = record(projection.narration, "projected narration material");
    expect(narration.committedDelta).toEqual(committedDelta);
    const decisionPrompt = String(narration.decisionPrompt);
    expect(decisionPrompt.length).toBeGreaterThan(0);
    const body = `${changes.map((entry) => String(entry.kind)).join(" ")} ${decisionPrompt}`;
    const rootActionId = String(request.rootActionId);
    this.narrationAudits.push({
      rootActionId,
      projection: structuredClone(projection),
      projectionHash: String(projection.projectionHash),
      body,
    });
    return {
      text: body,
      agencyClaims: [],
      projectionHash: projection.projectionHash,
      factRefs: changes.flatMap((entry) => typeof entry.factRef === "string" ? [entry.factRef] : []),
    };
  }
}

function roomStub(name: string): AuthorityRpc {
  return env.ROOMS.getByName(name) as unknown as AuthorityRpc;
}

function inputFor(
  interaction: Interaction,
  inputs: Map<string, JsonRecord>,
  pending: Map<string, JsonRecord>,
): JsonRecord {
  if (interaction.reuseInputFrom) {
    return structuredClone(record(inputs.get(interaction.reuseInputFrom), "reused intent"));
  }
  if (interaction.answerPendingFrom) {
    const pendingInput = record(pending.get(interaction.answerPendingFrom), "pending input to answer");
    return {
      kind: "answer",
      submissionId: `submission:eval:${interaction.id}-${interaction.answerPendingFrom}-answer`,
      pendingInputId: String(pendingInput.pendingInputId),
      answer: interaction.answer,
    };
  }
  return structuredClone(record(interaction.input, `interaction ${interaction.id} input`));
}

function readModel(observed: unknown): JsonRecord {
  return record(record(observed, "Room observation").readModel, "Viewer Read Model");
}

function worldFingerprint(model: JsonRecord): unknown {
  return {
    activeBranchId: model.activeBranchId,
    worldRevision: model.worldRevision,
    fictionTime: model.fictionTime,
    controlledCharacter: model.controlledCharacter,
  };
}

function receipt(outcome: JsonRecord): JsonRecord {
  return record(outcome.receipt, "Public Receipt");
}

function eventRange(outcome: JsonRecord): { from: number; to: number } {
  return record(receipt(outcome).eventRange, "receipt event range") as unknown as { from: number; to: number };
}

type DeterministicSingleAuthorityEvidence = {
  signals: string[];
  archiveValidated: boolean;
  eventHashChainValid: boolean;
  mutationsObserved: number;
  mutationsCoveredByReceipts: number;
  receiptsMatchedArchive: number;
  eventsCoveredByReceipts: number;
  projectionHashesAudited: number;
  activeD1Signals: number;
};

function plainRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function canonicalSequenceNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function publicEventRange(value: unknown): { from: number; to: number } | undefined {
  const range = plainRecord(value);
  if (range === undefined) return undefined;
  const from = Number(range.from ?? range.first ?? range.fromEventSeq);
  const to = Number(range.to ?? range.last ?? range.toEventSeq);
  return Number.isSafeInteger(from) && Number.isSafeInteger(to)
    ? { from, to }
    : undefined;
}

function transitionReceipt(outcome: JsonRecord): JsonRecord | undefined {
  return plainRecord(outcome.receipt);
}

function receiptIsCanonical(receiptValue: JsonRecord | undefined): receiptValue is JsonRecord {
  if (receiptValue === undefined) return false;
  const scopeVersions = plainRecord(receiptValue.scopeVersions);
  return typeof receiptValue.receiptId === "string"
    && receiptValue.receiptId.length > 0
    && typeof receiptValue.rootActionId === "string"
    && receiptValue.rootActionId.length > 0
    && typeof receiptValue.status === "string"
    && typeof receiptValue.runtimeEpochId === "string"
    && receiptValue.runtimeEpochId.length > 0
    && typeof receiptValue.activeBranchId === "string"
    && receiptValue.activeBranchId.length > 0
    && scopeVersions !== undefined
    && Object.keys(scopeVersions).length > 0
    && Object.values(scopeVersions).every((value) => canonicalSequenceNumber(value) !== undefined);
}

function projectedReceiptContains(readModel: JsonRecord, receiptValue: JsonRecord): boolean {
  return Array.isArray(readModel.receipts) && readModel.receipts.some((candidate) => {
    const projected = plainRecord(candidate);
    return projected?.receiptId === receiptValue.receiptId
      && projected.rootActionId === receiptValue.rootActionId
      && projected.status === receiptValue.status;
  });
}

function archiveReceiptContains(archive: JsonRecord, receiptValue: JsonRecord): boolean {
  const expectedRange = publicEventRange(receiptValue.eventRange);
  const expectedScopes = plainRecord(receiptValue.scopeVersions);
  return Array.isArray(archive.receiptRefs) && archive.receiptRefs.some((candidate) => {
    const archived = plainRecord(candidate);
    const archivedRange = publicEventRange(archived?.eventRange);
    const archivedScopes = plainRecord(archived?.scopeVersions);
    return archived?.receiptId === receiptValue.receiptId
      && archived.rootActionId === receiptValue.rootActionId
      && archived.status === receiptValue.status
      && archived.activeBranchId === receiptValue.activeBranchId
      && archivedScopes !== undefined
      && expectedScopes !== undefined
      && canonicalJson(archivedScopes) === canonicalJson(expectedScopes)
      && (expectedRange === undefined
        ? archived?.eventRange === null
        : archivedRange?.from === expectedRange.from && archivedRange.to === expectedRange.to);
  });
}

function archiveEventsBelongToReceipt(archive: JsonRecord, receiptValue: JsonRecord): boolean {
  const range = publicEventRange(receiptValue.eventRange);
  if (range === undefined || !Array.isArray(archive.events)) return false;
  const covered = archive.events.flatMap((candidate) => {
    const event = plainRecord(candidate);
    const eventSeq = canonicalSequenceNumber(event?.eventSeq);
    return event !== undefined
      && eventSeq !== undefined
      && eventSeq >= range.from
      && eventSeq <= range.to
      ? [event]
      : [];
  });
  return covered.length === range.to - range.from + 1
    && covered.every((event) => event.rootActionId === receiptValue.rootActionId);
}

function activeProjectionFingerprint(readModel: JsonRecord): string {
  const active = structuredClone(readModel);
  delete active.projectionHash;
  delete active.committedDelta;
  delete active.narration;
  return serialized(active);
}

function proveDeterministicSingleAuthority(input: {
  transitions: AuthorityTransition[];
  archive: JsonRecord;
  archiveValidated: boolean;
  finalReads: Record<Actor, JsonRecord>;
}): DeterministicSingleAuthorityEvidence {
  const signals = new Set<string>();
  let mutationsObserved = 0;
  let mutationsCoveredByReceipts = 0;
  let receiptsMatchedArchive = 0;
  let activeD1Signals = 0;
  let priorAfter: Record<Actor, JsonRecord> | undefined;

  for (const transition of input.transitions) {
    if (containsDeepKey(transition.input, AUTHORITY_OWNED_PLAYER_INPUT_KEYS)) {
      signals.add("authorityOwnedPlayerInput");
    }
    if (
      containsDeepKey(transition.before, LEGACY_ACTIVE_STATE_KEYS)
      || containsDeepKey(transition.after, LEGACY_ACTIVE_STATE_KEYS)
      || containsDeepKey(transition.outcome, LEGACY_ACTIVE_STATE_KEYS)
    ) {
      signals.add("legacyActiveStatePayload");
      activeD1Signals += 1;
    }
    if (priorAfter !== undefined && (["alice", "bob"] as const).some((actor) =>
      priorAfter?.[actor].stateVersion !== transition.before[actor].stateVersion
      || priorAfter?.[actor].projectionHash !== transition.before[actor].projectionHash
      || activeProjectionFingerprint(priorAfter[actor])
        !== activeProjectionFingerprint(transition.before[actor]))) {
      signals.add("transitionBoundaryDiverged");
      activeD1Signals += 1;
    }
    priorAfter = transition.after;

    const beforeAlice = canonicalSequenceNumber(transition.before.alice.stateVersion);
    const beforeBob = canonicalSequenceNumber(transition.before.bob.stateVersion);
    const afterAlice = canonicalSequenceNumber(transition.after.alice.stateVersion);
    const afterBob = canonicalSequenceNumber(transition.after.bob.stateVersion);
    if (
      beforeAlice === undefined
      || beforeBob === undefined
      || afterAlice === undefined
      || afterBob === undefined
    ) {
      signals.add("missingAuthoritativeProjection");
      continue;
    }
    if (beforeAlice !== beforeBob || afterAlice !== afterBob) {
      signals.add("viewerVersionDisagreement");
    }
    if (afterAlice < beforeAlice || afterBob < beforeBob) {
      signals.add("authoritativeVersionRegressed");
    }
    for (const actor of ["alice", "bob"] as const) {
      const before = transition.before[actor];
      const after = transition.after[actor];
      if (!SHA256_PATTERN.test(String(after.projectionHash ?? ""))) {
        signals.add("invalidProjectionHash");
      }
      if (
        afterAlice === beforeAlice
        && (
          after.projectionHash !== before.projectionHash
          || activeProjectionFingerprint(after) !== activeProjectionFingerprint(before)
        )
      ) {
        signals.add("activeProjectionChangedWithoutEvent");
        activeD1Signals += 1;
      }
    }

    const roomReceipt = transitionReceipt(transition.outcome);
    if (receiptIsCanonical(roomReceipt) && archiveReceiptContains(input.archive, roomReceipt)) {
      receiptsMatchedArchive += 1;
    } else if (roomReceipt !== undefined && publicEventRange(roomReceipt.eventRange) !== undefined) {
      signals.add("receiptMissingFromArchive");
    }

    if (afterAlice <= beforeAlice) continue;
    mutationsObserved += 1;
    const range = publicEventRange(roomReceipt?.eventRange);
    if (!receiptIsCanonical(roomReceipt) || range === undefined) {
      signals.add("versionAdvancedWithoutDoReceipt");
      continue;
    }
    if (
      range.to !== afterAlice
      || range.to <= beforeAlice
      || range.from !== beforeAlice + 1
      || range.from > range.to
    ) {
      signals.add("receiptDoesNotCoverMutation");
      continue;
    }
    if (!projectedReceiptContains(transition.after[transition.actor], roomReceipt)) {
      signals.add(`receiptMissingFromActorProjection:${transition.interactionId}`);
      continue;
    }
    if (!archiveReceiptContains(input.archive, roomReceipt)) {
      signals.add("receiptMissingFromArchive");
      continue;
    }
    if (!archiveEventsBelongToReceipt(input.archive, roomReceipt)) {
      signals.add("receiptEventRangeMismatch");
      continue;
    }
    mutationsCoveredByReceipts += 1;
  }

  if (!input.archiveValidated) signals.add("invalidAuthoritativeArchive");
  if (containsDeepKey(input.archive, LEGACY_ACTIVE_STATE_KEYS)) {
    signals.add("legacyActiveStatePayload");
    activeD1Signals += 1;
  }
  const events = Array.isArray(input.archive.events) ? input.archive.events : [];
  const eventHashChainValid = input.archiveValidated
    && events.length > 0
    && events.every((candidate, index) => {
      const event = plainRecord(candidate);
      const previous = index === 0 ? undefined : plainRecord(events[index - 1]);
      return event !== undefined
        && canonicalSequenceNumber(event.eventSeq) === index + 1
        && SHA256_PATTERN.test(String(event.payloadHash ?? ""))
        && SHA256_PATTERN.test(String(event.previousEventHash ?? ""))
        && SHA256_PATTERN.test(String(event.stateBeforeHash ?? ""))
        && SHA256_PATTERN.test(String(event.stateHashAfter ?? ""))
        && SHA256_PATTERN.test(String(event.eventHash ?? ""))
        && (previous === undefined || event.previousEventHash === previous.eventHash);
    });
  if (!eventHashChainValid) signals.add("invalidEventHashChain");
  const receiptRefs = Array.isArray(input.archive.receiptRefs)
    ? input.archive.receiptRefs.map(plainRecord).filter((entry): entry is JsonRecord => entry !== undefined)
    : [];
  const eventsCoveredByReceipts = events.filter((candidate) => {
    const event = plainRecord(candidate);
    const eventSeq = canonicalSequenceNumber(event?.eventSeq);
    return event !== undefined && eventSeq !== undefined && receiptRefs.some((reference) => {
      const range = publicEventRange(reference.eventRange);
      return range !== undefined
        && eventSeq >= range.from
        && eventSeq <= range.to
        && reference.rootActionId === event.rootActionId;
    });
  }).length;
  if (eventsCoveredByReceipts !== events.length) signals.add("archiveEventWithoutDoReceipt");

  const head = plainRecord(input.archive.head);
  const headVersion = canonicalSequenceNumber(head?.eventSeq);
  const finalVersions = (Object.keys(input.finalReads) as Actor[]).map(
    (actor) => canonicalSequenceNumber(input.finalReads[actor].stateVersion),
  );
  if (
    headVersion === undefined
    || finalVersions.some((version) => version === undefined || version !== headVersion)
  ) {
    signals.add("archiveHeadProjectionMismatch");
  }
  const audits = Array.isArray(input.archive.projectionAudits)
    ? input.archive.projectionAudits.map(plainRecord).filter((entry): entry is JsonRecord => entry !== undefined)
    : [];
  let projectionHashesAudited = 0;
  for (const actor of Object.keys(input.finalReads) as Actor[]) {
    const projectionHash = input.finalReads[actor].projectionHash;
    if (
      typeof projectionHash === "string"
      && SHA256_PATTERN.test(projectionHash)
      && audits.some((audit) =>
        canonicalSequenceNumber(audit.eventSeq) === headVersion
        && audit.projectionHash === projectionHash)
    ) {
      projectionHashesAudited += 1;
    } else {
      signals.add("projectionHashMissingFromArchiveAudit");
    }
  }

  return {
    signals: [...signals].sort(),
    archiveValidated: input.archiveValidated,
    eventHashChainValid,
    mutationsObserved,
    mutationsCoveredByReceipts,
    receiptsMatchedArchive,
    eventsCoveredByReceipts,
    projectionHashesAudited,
    activeD1Signals,
  };
}

function score(primary: boolean, partial = primary): number {
  if (primary) return 2;
  if (partial) return 1;
  return 0;
}

describe("24+ continuous KP responsibility evaluation", () => {
  it("keeps secrets, continuity, fairness, agency, mechanics, failure, spotlight, conclusion, recovery, and narration above threshold", async () => {
    expect(INTERACTIONS).toHaveLength(31);
    expect(INTERACTIONS.length).toBeGreaterThanOrEqual(SCORE_THRESHOLDS.minimumInteractions);

    const capturedConsole: unknown[][] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        capturedConsole.push(args);
      })
    );

    try {
      let authority = roomStub(ROOM_NAME);
      const initialized = await authority.initializeAuthoritative({
        roomId: ROOM_NAME,
        moduleId: "black-oak-will",
        moduleVersion: "legacy-anchor-v1",
        members: [
          { principalId: AUTHENTICATED.alice.principal.id, role: "player" },
          { principalId: AUTHENTICATED.bob.principal.id, role: "player" },
        ],
        characters: [
          {
            characterId: ALICE_ID,
            controllerPrincipalId: AUTHENTICATED.alice.principal.id,
            staticCard: {
              name: "爱丽丝",
              sceneId: "shrine",
              classId: "fighter",
              level: 1,
              hitPoints: { current: 10, maximum: 10 },
              abilityScores: { str: 10, dex: 14, con: 12, int: 14, wis: 12, cha: 10 },
              proficiencyBonus: 2,
              proficientSkills: ["investigation"],
              loadout: {
                armorClass: 14,
                speedFeet: 30,
                equipped: {},
                backpack: [{ itemId: "crowbar", quantity: 1 }],
              },
            },
          },
          {
            characterId: BOB_ID,
            controllerPrincipalId: AUTHENTICATED.bob.principal.id,
            staticCard: {
              name: "鲍勃",
              sceneId: "yard",
              abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 12, cha: 14 },
              proficiencyBonus: 2,
              proficientSkills: ["athletics", "persuasion"],
            },
          },
        ],
        fixtureFacts: [
          { factRef: "fact:cellar-yard-speaking-tube", kind: "establishedCommunicationChannel", participants: [ALICE_ID, BOB_ID] },
          { knowledgeRef: "knowledge:warden-closing-duty", holderEntityId: WARDEN_ID },
          {
            knowledgeRef: "knowledge:courier-ring-request",
            holderEntityId: "npc:wounded-courier",
            holderName: "受伤的信使",
            sceneId: "shrine",
          },
        ],
      });
      expect(initialized).toMatchObject({ created: true });
      const archiveExportCapability = record(
        record(initialized, "authoritative initialization").serviceCapabilities,
        "authoritative service capabilities",
      ).archiveExport;

      const kp = new ProjectionBoundScriptedKp();
      const inputs = new Map<string, JsonRecord>();
      const pending = new Map<string, JsonRecord>();
      const outcomes = new Map<string, JsonRecord>();
      const observations: Array<{ after: string; actor: Actor; readModel: JsonRecord }> = [];
      const authorityTransitions: AuthorityTransition[] = [];
      const preShareBobReads: JsonRecord[] = [];
      const spotlightDifferences: number[] = [];
      let alicePrivateNarration = "";
      let modelFailureBefore: unknown;
      let modelFailureAfter: unknown;
      let pendingReconnectStable = false;
      let previousAuthorityReads: Record<Actor, JsonRecord> = {
        alice: readModel(await authority.observe(AUTHENTICATED.alice)),
        bob: readModel(await authority.observe(AUTHENTICATED.bob)),
      };

      for (const interaction of INTERACTIONS) {
        const actionInput = inputFor(interaction, inputs, pending);
        inputs.set(interaction.id, structuredClone(actionInput));
        if (interaction.id === "19") {
          modelFailureBefore = worldFingerprint(readModel(await authority.observe(AUTHENTICATED.bob)));
        }

        const outcomeValue = await handleRoomAction({
          principal: AUTHENTICATED[interaction.actor],
          authority,
          kp,
        }, actionInput as never);
        const outcome = record(outcomeValue, `interaction ${interaction.id} outcome`);
        outcomes.set(interaction.id, structuredClone(outcome));
        expect(
          outcome.kind,
          `interaction ${interaction.id}: ${String(outcome.code ?? "no-code")} ${String(outcome.explanation ?? "no-explanation")}`,
        ).toBe(interaction.expected);

        if (interaction.opensPending) {
          const publicPending = record(outcome.pending, `${interaction.opensPending} pending`);
          expect(publicPending.selectedChoiceId).toBeUndefined();
          pending.set(interaction.opensPending, structuredClone(publicPending));

          const beforeReconnect = readModel(await authority.observe(AUTHENTICATED[interaction.actor]));
          authority = roomStub(ROOM_NAME);
          const afterReconnect = readModel(await authority.observe(AUTHENTICATED[interaction.actor], { channel: "reconnect" }));
          expect(afterReconnect.pendingInputs).toEqual(expect.arrayContaining([
            expect.objectContaining({ pendingInputId: publicPending.pendingInputId }),
          ]));
          expect(worldFingerprint(afterReconnect)).toEqual(worldFingerprint(beforeReconnect));
          pendingReconnectStable = true;
        }

        const aliceRead = readModel(await authority.observe(AUTHENTICATED.alice));
        const bobRead = readModel(await authority.observe(AUTHENTICATED.bob));
        authorityTransitions.push({
          interactionId: interaction.id,
          actor: interaction.actor,
          input: structuredClone(actionInput),
          outcome: structuredClone(outcome),
          before: structuredClone(previousAuthorityReads),
          after: { alice: structuredClone(aliceRead), bob: structuredClone(bobRead) },
        });
        previousAuthorityReads = {
          alice: structuredClone(aliceRead),
          bob: structuredClone(bobRead),
        };
        observations.push({ after: interaction.id, actor: "alice", readModel: structuredClone(aliceRead) });
        observations.push({ after: interaction.id, actor: "bob", readModel: structuredClone(bobRead) });

        if (Number(interaction.id) < 15) preShareBobReads.push(structuredClone(bobRead));
        if (interaction.id === "02") {
          alicePrivateNarration = String(record(outcome.delivery, "Alice private DeliveryFrame").body);
        }
        if (interaction.id === "19") {
          modelFailureAfter = worldFingerprint(bobRead);
          expect(modelFailureAfter).toEqual(modelFailureBefore);
        }

        const ledger = record(aliceRead.spotlightLedger, "spotlight ledger");
        const aliceLedger = record(ledger[ALICE_ID], "Alice spotlight ledger");
        const bobLedger = record(ledger[BOB_ID], "Bob spotlight ledger");
        const difference = Math.abs(Number(aliceLedger.decisionBeats) - Number(bobLedger.decisionBeats));
        spotlightDifferences.push(difference);
        expect(difference).toBeLessThanOrEqual(SCORE_THRESHOLDS.maximumSpotlightDifference);
      }

      expect(kp.rootActionsBySubmission.get("submission:eval:19-model-recovery")?.size).toBe(1);
      expect(pendingReconnectStable).toBe(true);

      const checkReceipt = receipt(record(outcomes.get("04"), "check outcome"));
      const retriedCheckReceipt = receipt(record(outcomes.get("05"), "idempotent check outcome"));
      expect(retriedCheckReceipt).toEqual(checkReceipt);
      const randomnessCommitments = list(checkReceipt.randomnessCommitments, "authoritative randomness commitments");
      expect(randomnessCommitments.length).toBeGreaterThan(0);
      expect(randomnessCommitments).toEqual(expect.arrayContaining([
        expect.objectContaining({
          randomnessId: expect.any(String),
          requestHash: expect.stringMatching(/^sha256:/),
          frozenParametersHash: expect.stringMatching(/^sha256:/),
        }),
      ]));

      const dangerMaterializedRange = eventRange(record(outcomes.get("09"), "danger materialization"));
      const dangerResolvedRange = eventRange(record(outcomes.get("12"), "danger resolution"));
      expect(dangerMaterializedRange.to).toBeLessThan(dangerResolvedRange.from);

      const failureOutcome = record(outcomes.get("22"), "meaningful failure outcome");
      const failureReceipt = receipt(failureOutcome);
      expect(failureReceipt).toMatchObject({
        meaningfulFailure: true,
        newOptions: expect.arrayContaining([
          expect.objectContaining({ optionId: "roof" }),
          expect.objectContaining({ optionId: "river" }),
        ]),
      });
      const beforeRejectedRetry = observations.find((entry) => entry.after === "22" && entry.actor === "bob")!.readModel;
      const afterRejectedRetry = observations.find((entry) => entry.after === "23" && entry.actor === "bob")!.readModel;
      expect(worldFingerprint(afterRejectedRetry)).toEqual(worldFingerprint(beforeRejectedRetry));
      expect(record(outcomes.get("23"), "unchanged retry")).toMatchObject({
        kind: "rejected",
        code: "unchangedRetry",
      });

      for (const projection of preShareBobReads) {
        expect(serialized(projection)).not.toContain(PRIVATE_KNOWLEDGE_REF);
        expect(serialized(projection)).not.toContain(PRIVATE_CLUE);
      }
      for (const channel of ["realtime", "history", "reconnect", "error", "candidates", "voice", "transcript"]) {
        const guessed = await authority.observe(AUTHENTICATED.bob, {
          channel,
          guessedKnowledgeRef: PRIVATE_KNOWLEDGE_REF,
        });
        const body = serialized(guessed);
        expect(body).toContain(PRIVATE_KNOWLEDGE_REF);
        expect(body).not.toContain(alicePrivateNarration);
        expect(body).not.toMatch(/narrationHistory|messageHistory|voiceHistory|transcriptHistory/);
      }
      const aliceFinal = readModel(await authority.observe(AUTHENTICATED.alice));
      const bobFinal = readModel(await authority.observe(AUTHENTICATED.bob));
      expect(serialized(aliceFinal)).toContain(PROMISE_REF);
      expect(serialized(aliceFinal)).toContain(PRIVATE_KNOWLEDGE_REF);
      expect(serialized(bobFinal)).toContain(RELATIONSHIP_REF);
      expect(serialized(bobFinal)).toContain(PRIVATE_KNOWLEDGE_REF);
      expect(serialized(aliceFinal)).not.toContain(BOB_PRIVATE_PLAN);
      expect(serialized(bobFinal)).not.toContain(alicePrivateNarration);

      const conclusion = record(outcomes.get("30"), "story conclusion");
      expect(conclusion.kind).toBe("concluded");
      const conclusionReceipt = receipt(conclusion);
      expect(aliceFinal.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          receiptId: conclusionReceipt.receiptId,
          rootActionId: conclusionReceipt.rootActionId,
          status: "concluded",
        }),
      ]));
      expect(eventRange(record(outcomes.get("27"), "ending candidate")).to).toBeLessThan(eventRange(conclusion).from);
      expect(bobFinal.story).toMatchObject({
        status: "concluded",
        endingCandidateRef: ENDING_CANDIDATE_REF,
        epilogue: expect.objectContaining({ characterId: BOB_ID }),
        sequel: null,
      });

      expect(kp.narrationAudits.length).toBeGreaterThanOrEqual(20);
      expect(kp.narrationAudits.every((audit) =>
        audit.body.length > 0
        && !audit.body.includes("我替你决定")
        && !audit.body.includes(BOB_PRIVATE_PLAN)
      )).toBe(true);

      const telemetry = serialized(capturedConsole);
      for (const forbidden of [PRIVATE_CLUE, BOB_PRIVATE_PLAN, alicePrivateNarration, "Cookie", "Authorization", "Prompt"]) {
        expect(telemetry).not.toContain(forbidden);
      }

      const maxSpotlightDifference = Math.max(...spotlightDifferences);
      const noSecretLeak = preShareBobReads.every((projection) =>
        !serialized(projection).includes(PRIVATE_KNOWLEDGE_REF)
        && !serialized(projection).includes(PRIVATE_CLUE)
      ) && !serialized(aliceFinal).includes(BOB_PRIVATE_PLAN);
      const continuityProved = [
        [aliceFinal, PROMISE_REF],
        [aliceFinal, PRIVATE_KNOWLEDGE_REF],
        [bobFinal, RELATIONSHIP_REF],
        [bobFinal, PRIVATE_KNOWLEDGE_REF],
      ].every(([projection, token]) => serialized(projection).includes(String(token)));
      const randomnessIsStable = serialized(checkReceipt) === serialized(retriedCheckReceipt)
        && randomnessCommitments.length > 0;
      const meaningfulFailureProved = failureReceipt.meaningfulFailure === true
        && record(outcomes.get("23"), "retry rejection").kind === "rejected";
      const conclusionProved = conclusion.kind === "concluded"
        && serialized(bobFinal.story).includes(ENDING_CANDIDATE_REF)
        && serialized(bobFinal.story).includes("epilogue");
      const recoveryProved = serialized(modelFailureBefore) === serialized(modelFailureAfter)
        && pendingReconnectStable
        && kp.rootActionsBySubmission.get("submission:eval:19-model-recovery")?.size === 1;
      const narrationProved = kp.narrationAudits.length >= 20
        && kp.narrationAudits.every((audit) =>
          record(audit.projection, "narration audit projection").viewer !== undefined
        );

      const exported = record(
        await authority.exportAuthoritativeArchive(archiveExportCapability),
        "authoritative archive export",
      );
      expect(exported.kind).toBe("exported");
      const archive = record(exported.archive, "authoritative archive");
      const archiveValidation = await validateAuthoritativeArchive(archive);
      const singleAuthorityEvidence = proveDeterministicSingleAuthority({
        transitions: authorityTransitions,
        archive,
        archiveValidated: archiveValidation.ok,
        finalReads: { alice: aliceFinal, bob: bobFinal },
      });
      expect(singleAuthorityEvidence.signals).toEqual([]);
      expect(singleAuthorityEvidence).toMatchObject({
        archiveValidated: true,
        eventHashChainValid: true,
        mutationsCoveredByReceipts: authorityTransitions.filter((transition) =>
          Number(transition.after.alice.stateVersion) > Number(transition.before.alice.stateVersion)).length,
        activeD1Signals: 0,
      });
      const transitionsWithCanonicalReceipts = authorityTransitions.filter((transition) =>
        receiptIsCanonical(transitionReceipt(transition.outcome)));
      expect(singleAuthorityEvidence.mutationsObserved).toBe(
        singleAuthorityEvidence.mutationsCoveredByReceipts,
      );
      expect(singleAuthorityEvidence.receiptsMatchedArchive).toBe(
        transitionsWithCanonicalReceipts.length,
      );
      expect(singleAuthorityEvidence.eventsCoveredByReceipts).toBe(
        list(archive.events, "hashed authoritative archive events").length,
      );
      expect(singleAuthorityEvidence.projectionHashesAudited).toBe(
        Object.keys({ alice: aliceFinal, bob: bobFinal }).length,
      );

      const parallelAuthorityTrace = structuredClone(authorityTransitions);
      const stableTransition = parallelAuthorityTrace.find((transition) =>
        transition.before.alice.stateVersion === transition.after.alice.stateVersion);
      expect(stableTransition).toBeDefined();
      const forgedActorProjection = stableTransition!.after[stableTransition!.actor];
      forgedActorProjection.controlledCharacter = {
        ...record(forgedActorProjection.controlledCharacter, "controlled character before forged D1 mutation"),
        sceneId: "legacy-d1:parallel-location",
      };
      const parallelAuthorityEvidence = proveDeterministicSingleAuthority({
        transitions: parallelAuthorityTrace,
        archive,
        archiveValidated: archiveValidation.ok,
        finalReads: { alice: aliceFinal, bob: bobFinal },
      });
      expect(parallelAuthorityEvidence.signals).toContain("activeProjectionChangedWithoutEvent");
      expect(parallelAuthorityEvidence.activeD1Signals).toBeGreaterThan(0);
      expect(parallelAuthorityEvidence.signals.length > 0).toBe(true);

      const scores = {
        secrets: score(noSecretLeak && !serialized(bobFinal).includes(alicePrivateNarration)),
        continuity: score(continuityProved),
        fairness: score(dangerMaterializedRange.to < dangerResolvedRange.from),
        agency: score(pending.size === 3 && pendingReconnectStable),
        mechanicalHonesty: score(randomnessIsStable),
        failure: score(meaningfulFailureProved),
        spotlight: score(maxSpotlightDifference <= SCORE_THRESHOLDS.maximumSpotlightDifference),
        conclusion: score(conclusionProved),
        recovery: score(recoveryProved),
        narration: score(narrationProved),
      };

      const hardGates = {
        secretLeak: !noSecretLeak,
        substitutedPlayerChoice: pending.size !== 3,
        postRollChange: !randomnessIsStable,
        duplicateRandomnessOrResource: !randomnessIsStable,
        secondAuthority: singleAuthorityEvidence.signals.length > 0,
        fakeConclusion: !conclusionProved,
      };
      expect(hardGates).toMatchObject({
        secretLeak: false,
        substitutedPlayerChoice: false,
        postRollChange: false,
        duplicateRandomnessOrResource: false,
        fakeConclusion: false,
      });
      expect(hardGates.secondAuthority).toBe(singleAuthorityEvidence.signals.length > 0);
      expect(Object.values(scores).every((value) => value >= SCORE_THRESHOLDS.minimumDimension)).toBe(true);
      expect(Object.values(scores).reduce((total, value) => total + value, 0)).toBeGreaterThanOrEqual(
        SCORE_THRESHOLDS.minimumTotal,
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }, 90_000);
});
