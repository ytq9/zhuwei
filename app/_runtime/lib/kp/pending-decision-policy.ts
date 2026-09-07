import { canonicalJson, isRecord, ModelOutputValidationError } from "./authoritative-helpers";

export const NPC_PENDING_DECISION_TOOL_NAME = "answer_npc_pending_input";
export type NpcPendingDecisionRequest = {
  preparedActionId: string;
  rootActionId: string;
  capability: string;
  pending: Record<string, unknown>;
  projection: unknown;
};
export type NpcPendingDecision = {
  kind: "npcPendingDecision";
  capability: string;
  answer: Record<string, unknown>;
};

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function permutation(answer: unknown, candidates: unknown): boolean {
  return Array.isArray(answer) && Array.isArray(candidates)
    && answer.every((id) => typeof id === "string")
    && new Set(answer).size === answer.length
    && [...answer].sort().join("\0") === [...candidates].sort().join("\0");
}

/** Structural validation of the exact Rules-issued choice, not a mechanical adjudicator. */
export function npcPendingAnswerConforms(pending: unknown, answer: unknown): answer is Record<string, unknown> {
  if (!isRecord(pending) || !isRecord(answer)) return false;
  if (pending.choiceKind === "reaction" || pending.choiceKind === "knockOut") {
    return Array.isArray(pending.answerOptions) && pending.answerOptions.some((option) =>
      isRecord(option) && canonicalJson(option.answer) === canonicalJson(answer));
  }
  if (pending.choiceKind === "target") {
    if (exact(answer, ["kind"]) && answer.kind === "cancel") return true;
    const targets = exact(answer, ["kind", "targetEntityId"]) && answer.kind === "selectTarget"
      ? [answer.targetEntityId]
      : exact(answer, ["kind", "targetEntityIds"]) && answer.kind === "selectTargets"
        && Array.isArray(answer.targetEntityIds) ? answer.targetEntityIds : undefined;
    return targets !== undefined && targets.length > 0
      && targets.length <= Number(pending.maximumTargetCount ?? 1)
      && new Set(targets).size === targets.length && Array.isArray(pending.candidateEntityIds)
      && targets.every((id) => typeof id === "string" && (pending.candidateEntityIds as unknown[]).includes(id));
  }
  if (pending.choiceKind === "triggerOrder") return exact(answer, ["orderedTriggerInstanceIds"])
    && permutation(answer.orderedTriggerInstanceIds, pending.orderedTriggerInstanceIds);
  if (pending.choiceKind === "initiativeTieOrder") return exact(answer, ["orderedEntityIds"])
    && permutation(answer.orderedEntityIds, pending.orderedEntityIds);
  return false;
}

export function npcPendingDecisionModelInput(request: NpcPendingDecisionRequest): Record<string, unknown> {
  if (!isRecord(request) || !isRecord(request.pending) || !isRecord(request.projection)
    || !isRecord(request.projection.viewer) || request.projection.viewer.kind !== "npc"
    || request.projection.viewer.subjectId !== request.pending.npcId
    || typeof request.capability !== "string" || typeof request.pending.pendingInputId !== "string") {
    throw new ModelOutputValidationError();
  }
  const pending = request.pending;
  let answerSchema: Record<string, unknown>;
  const array = (values: unknown, max?: number) => ({ type: "array", uniqueItems: true,
    minItems: 1, ...(max === undefined ? {} : { maxItems: max }),
    items: { type: "string", enum: values } });
  const object = (properties: Record<string, unknown>) => ({ type: "object",
    additionalProperties: false, properties, required: Object.keys(properties) });
  if (Array.isArray(pending.answerOptions) && pending.answerOptions.length > 0) {
    answerSchema = { enum: pending.answerOptions.filter(isRecord).map((option) => option.answer) };
  } else if (pending.choiceKind === "target") {
    answerSchema = { anyOf: [
      object({ kind: { const: "cancel" } }),
      object({ kind: { const: "selectTarget" }, targetEntityId: { type: "string", enum: pending.candidateEntityIds } }),
      object({ kind: { const: "selectTargets" }, targetEntityIds: array(pending.candidateEntityIds, Number(pending.maximumTargetCount ?? 1)) }),
    ] };
  } else if (pending.choiceKind === "triggerOrder") {
    answerSchema = object({ orderedTriggerInstanceIds: array(pending.orderedTriggerInstanceIds) });
  } else if (pending.choiceKind === "initiativeTieOrder") {
    answerSchema = object({ orderedEntityIds: array(pending.orderedEntityIds) });
  } else throw new ModelOutputValidationError();
  return {
    messages: [
      { role: "system", content: "你扮演这一个 NPC。只能依据 npcViewer 中自己知道或感知的事实、目标和可用资源，回答当前规则已冻结的待选。选择明确合法答案；不得改写原行动、参数、已掷骰面或既有事实，不得读取其他角色秘密。只调用给定工具。" },
      { role: "user", content: canonicalJson({ pending, npcViewer: request.projection }) },
    ],
    tools: [{ type: "function", function: { name: NPC_PENDING_DECISION_TOOL_NAME,
      description: "回答当前 NPC 的一项权威待选。", parameters: object({ answer: answerSchema }) } }],
    tool_choice: "required", parallel_tool_calls: false, temperature: 0.1, max_completion_tokens: 1100,
  };
}

export function validateNpcPendingDecisionOutput(value: unknown, request: NpcPendingDecisionRequest): NpcPendingDecision {
  if (!isRecord(value) || !exact(value, ["answer"]) || !npcPendingAnswerConforms(request.pending, value.answer)) {
    throw new ModelOutputValidationError();
  }
  return { kind: "npcPendingDecision", capability: request.capability, answer: structuredClone(value.answer) };
}
