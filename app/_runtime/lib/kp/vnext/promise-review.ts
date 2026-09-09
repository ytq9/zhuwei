import { extractSingleToolCall } from "../authoritative-helpers";
import { canonicalHash, parseJsonWithUniqueMembers } from "./canonical-json";
import { promiseJudgmentConform, type PromiseReviewRequest } from "../../rules/v2/promise-lifecycle";

const parameters = { type: "object", additionalProperties: false, properties: {
  outcome: { type: "string", enum: ["unchanged", "progressed", "conditionMet", "conditionUnmet", "fulfilled", "breached", "released"] }, reason: { type: "string" },
  evidenceRefs: { type: "array", items: { type: "string" } }, remaining: { type: "boolean" },
  completedParts: { type: "array", items: { type: "string" } },
}, required: ["outcome", "reason", "evidenceRefs", "remaining", "completedParts"] };
export const PROMISE_REVIEW_TOOL = { type: "function", function: { name: "submit_promise_review", strict: true,
  description: "Review existing obligations against committed evidence; never create facts, actions or knowledge.", parameters } };
const batchTool = { type: "function", function: { name: "submit_promise_review_batch", strict: true,
  description: "Review every frozen obligation in this batch once; no omitted or duplicate identities.",
  parameters: { type: "object", additionalProperties: false, properties: { reviews: { type: "array", items: {
    type: "object", additionalProperties: false, properties: { promiseId: { type: "string" }, judgment: parameters }, required: ["promiseId", "judgment"] } } }, required: ["reviews"] } } };
const prompt = "你是主持履约复核，不是任何角色。只依据冻结原约、事实与实际动作裁定；期限不是工期。fulfilled须有真实结果证据，持续义务还须有覆盖主体与期间的权威依据。痕迹、自报成功、零条查询结果不能证明履约。技术故障和材料不足选unchanged，remaining=true。未按生效条款完成记breached并记录原因，是否责怪/处罚不是此次裁定。违约后仍欠履行则remaining=true。不能用另一时间线的未来事实。条件待满足须先核定conditionMet，需要知情则必须真实传递；窗口结束未触发用conditionUnmet并引用期间覆盖。分项真实完成用completedParts，尚有必需项用progressed。attempt按真实尝试评价，不能事后改成结果或降低原有结果要求。既往breached永久保留，补交不能洗掉历史。只返回一次工具调用；不产生动作、改约或角色知识。";
export const PROMISE_REVIEW_BINDING_HASH = canonicalHash({ tool: PROMISE_REVIEW_TOOL, batchTool, prompt, parser: "unique-members-v1" });
export function promiseReviewModelInput(frame: PromiseReviewRequest): Record<string, unknown> {
  if (JSON.stringify(frame).length > 160_000) throw new TypeError("PROMISE_REVIEW_CONTEXT_LIMIT");
  return { messages: [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify(frame) }],
    tools: [frame.schema === "zhuwei.promise-review-batch/vnext-1" ? batchTool : PROMISE_REVIEW_TOOL], tool_choice: "required", parallel_tool_calls: false, max_completion_tokens: 4000 };
}
export function parsePromiseReview(response: unknown, request?: PromiseReviewRequest) {
  const tool = extractSingleToolCall(response);
  if (request?.schema === "zhuwei.promise-review-batch/vnext-1") {
    if (tool.name !== batchTool.function.name || typeof tool.arguments !== "string") throw new TypeError("PROMISE_REVIEW_INVALID");
    const value = parseJsonWithUniqueMembers(tool.arguments) as { reviews?: Array<{ promiseId: string; judgment: unknown }> };
    if (!value || Object.keys(value).join() !== "reviews" || !Array.isArray(value.reviews)
      || value.reviews.length !== request.frames.length || new Set(value.reviews.map(r => r.promiseId)).size !== value.reviews.length
      || value.reviews.some(r => !r || Object.keys(r).sort().join() !== "judgment,promiseId" || !request.frames.some(f => f.promiseId === r.promiseId)
        || !promiseJudgmentConform(r.judgment))) throw new TypeError("PROMISE_REVIEW_INVALID");
    return value.reviews;
  }
  if (tool.name !== PROMISE_REVIEW_TOOL.function.name || typeof tool.arguments !== "string") throw new TypeError("PROMISE_REVIEW_INVALID");
  const value = parseJsonWithUniqueMembers(tool.arguments);
  if (!promiseJudgmentConform(value)) throw new TypeError("PROMISE_REVIEW_INVALID");
  return value;
}
