import { ACTOR_PLAN_DECISION_TOOL, ACTOR_PLAN_DECISION_TOOL_NAME, actorPlanDecisionModelInput,
  validateActorPlanDecisionOutput } from "../actor-plan-policy";
import { extractSingleToolCall } from "../authoritative-helpers";
import type { DueActorPlanDecisionRequest } from "../authoritative-types";
import { compactDeepSeekStrictToolSchema } from "../deepseek-strict-schema-compaction";
import { isPlainRecord, canonicalHash, parseJsonWithUniqueMembers } from "./canonical-json";

type Schema = Record<string, unknown>;
const source = ACTOR_PLAN_DECISION_TOOL.function.parameters as Schema;
const definitions = source.$def as Record<string, Schema>;
const none = { type: "object", properties: { kind: { type: "string", enum: ["none"] } },
  required: ["kind"], additionalProperties: false };
function resolve(schema: Schema): Schema {
  return typeof schema.$ref === "string" ? definitions[schema.$ref.split("/").at(-1)!] : schema;
}
function alternatives(schema: Schema): Schema[] {
  const node = resolve(schema);
  return Array.isArray(node.anyOf) ? node.anyOf.flatMap(branch => alternatives(branch as Schema)) : [node];
}
/** Representation conversion only. The existing ActorPlan validator remains
 * the sole owner of domain/reference/mechanical decisions. */
function strictSchema(schema: Schema): Schema {
  const node = resolve(schema);
  if (Array.isArray(node.anyOf)) return { anyOf: alternatives(node).map(strictSchema) };
  if (node.type === "null") return none;
  if (node.const !== undefined) return { type: typeof node.const, enum: [node.const] };
  if (Array.isArray(node.enum)) return { type: typeof node.enum[0], enum: node.enum };
  if (node.type === "object") {
    const required = node.required as string[] ?? [];
    const properties = Object.fromEntries(Object.entries(node.properties as Record<string, Schema>).map(([key, child]) => {
      const converted = strictSchema(child);
      return [key, required.includes(key) ? converted : { anyOf: [none, ...alternatives(converted)] }];
    }));
    return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (node.type === "array") return { type: "array", items: strictSchema(node.items as Schema) };
  return Object.fromEntries(Object.entries(node).filter(([key]) => ["type", "pattern", "minimum", "maximum", "description"].includes(key)));
}
const parameters = compactDeepSeekStrictToolSchema({ type: "object", properties: { decision: strictSchema(source) },
  required: ["decision"], additionalProperties: false });
export const VNEXT_ACTOR_PLAN_DECISION_TOOL = Object.freeze({ type: "function", function: {
  name: ACTOR_PLAN_DECISION_TOOL_NAME, description: ACTOR_PLAN_DECISION_TOOL.function.description,
  strict: true, parameters,
} });
export const VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH = canonicalHash({ tool: VNEXT_ACTOR_PLAN_DECISION_TOOL,
  contract: "vnext-actor-plan-due-decision-v1", parser: "unique-json-single-tool-v1",
  excludedControlPaths: ["projection.causalFrontier.eventHeadId"] });

export function vnextActorPlanDecisionInput(request: DueActorPlanDecisionRequest): Record<string, unknown> {
  const modelRequest = structuredClone(request);
  // Knowledge review appends a control event without changing the NPC's
  // knowledge or fiction. This global journal cursor is not a decision premise.
  const frontier = isPlainRecord(modelRequest.projection) ? modelRequest.projection.causalFrontier : undefined;
  if (isPlainRecord(frontier)) delete frontier.eventHeadId;
  const input = actorPlanDecisionModelInput(modelRequest);
  const messages = structuredClone(input.messages) as Record<string, unknown>[];
  messages[0].content = String(messages[0].content)
    + "\n工具参数根为 {decision: 决定对象}。所有无值位置使用 {kind: \"none\"}，不得填写 null。";
  return { ...input, messages, tools: [VNEXT_ACTOR_PLAN_DECISION_TOOL], max_completion_tokens: 4000 };
}
function isNone(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).length === 1 && value.kind === "none";
}
function branchFor(schema: Schema, value: unknown): Schema {
  const variants = alternatives(schema);
  if (variants.length === 1) return variants[0];
  const variant = variants.find(node => {
    if (node.type === "null") return isNone(value);
    if (node.const !== undefined) return value === node.const;
    if (Array.isArray(node.enum)) return node.enum.includes(value);
    if (node.type === "object") return isPlainRecord(value) && Object.entries(node.properties as Record<string, Schema>)
      .every(([key, child]) => child.const === undefined || value[key] === child.const);
    return typeof value === node.type;
  });
  if (variant === undefined) throw new TypeError("ACTOR_PLAN_DECISION_INVALID");
  return variant;
}
function decode(schema: Schema, value: unknown): unknown {
  const node = branchFor(schema, value);
  if (node.type === "null") {
    if (!isNone(value)) throw new TypeError("ACTOR_PLAN_DECISION_INVALID");
    return null;
  }
  if (node.type === "object" && isPlainRecord(value)) {
    const props = node.properties as Record<string, Schema>, required = node.required as string[] ?? [];
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (props[key] === undefined) return [[key, item]];
      if (!required.includes(key) && isNone(item)) return [];
      return [[key, decode(props[key], item)]];
    }));
  }
  if (node.type === "array" && Array.isArray(value)) return value.map(item => decode(node.items as Schema, item));
  return value;
}
export function parseVnextActorPlanDecision(response: unknown, request: DueActorPlanDecisionRequest) {
  const call = extractSingleToolCall(response);
  if (call.name !== ACTOR_PLAN_DECISION_TOOL_NAME || typeof call.arguments !== "string") {
    throw new TypeError("ACTOR_PLAN_DECISION_INVALID");
  }
  const envelope = parseJsonWithUniqueMembers(call.arguments);
  if (!isPlainRecord(envelope) || Object.keys(envelope).length !== 1 || !isPlainRecord(envelope.decision)) {
    throw new TypeError("ACTOR_PLAN_DECISION_INVALID");
  }
  return validateActorPlanDecisionOutput(decode(source, envelope.decision), request, { npcEquipment: true });
}
