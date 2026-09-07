import { characterInferenceContentText } from "./character-inference";
import type { KnowledgeRecord } from "./model";
import type { KnowledgeReviewScope } from "./knowledge-review";
import { premiseAssertionPredicate } from "./causal-action-drafts";
import { hasExactKeys, hasOnlyKeys, isRecord, isNonEmptyString } from "./validation";

const PREMISE_RELATIONS: Readonly<Record<string, string>> = Object.freeze({
  requestedBy: "曾受托于", seeksOrAssists: "此行寻找或协助", boundFor: "此行前往", actsFor: "此行为之行事的对象是",
  previouslyKnewAbout: "此前知道", previouslyConnectedTo: "此前与之有联系的对象是",
  owesOrPromised: "欠有义务或作过承诺的对象是", obligationConcerns: "已有义务涉及",
  affiliatedWith: "所属组织是", sponsoredBy: "得到支持的来源是", originatedFrom: "出身于",
  trainedBy: "受教于", formerlyConnectedTo: "过去与之有联系的对象是",
});

const PREMISE_PREDICATE_RELATIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  arrivalPurpose: ["requestedBy", "seeksOrAssists", "boundFor", "actsFor"], priorKnowledge: ["previouslyKnewAbout"],
  priorRelationship: ["previouslyConnectedTo"], obligation: ["owesOrPromised", "obligationConcerns"],
  affiliation: ["affiliatedWith", "sponsoredBy"], identityBackground: ["originatedFrom", "trainedBy", "formerlyConnectedTo"],
});
function strings(value: unknown): boolean { return Array.isArray(value) && value.every(isNonEmptyString); }
function premiseConform(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, ["schema", "characterId", "predicate", "policyRef", "anchorRefs", "statementTemplateRef", "sourceRefs", "scope", "truthStatus", "origin", "bindings"])
    && value.schema === "zhuwei.character-premise/v2" && isNonEmptyString(value.characterId)
    && ["arrivalPurpose", "priorKnowledge", "priorRelationship", "obligation", "affiliation", "identityBackground"].includes(String(value.predicate))
    && isNonEmptyString(value.policyRef) && isNonEmptyString(value.statementTemplateRef) && strings(value.anchorRefs) && strings(value.sourceRefs)
    && value.scope === "characterBackstory" && value.truthStatus === "canonical"
    && ["kpOpenBlankWithinModuleAnchor", "derivedFromEstablishedSources"].includes(String(value.origin))
    && Array.isArray(value.bindings) && value.bindings.length > 0 && value.bindings.every(binding => isRecord(binding)
      && hasOnlyKeys(binding, ["slotRef", "relationKind", "referenceKind", "entityRef", "entityKind"], ["archetypeRef"])
      && isNonEmptyString(binding.slotRef) && isNonEmptyString(binding.relationKind) && PREMISE_RELATIONS[binding.relationKind] !== undefined
      && PREMISE_PREDICATE_RELATIONS[String(value.predicate)]?.includes(binding.relationKind)
      && isNonEmptyString(binding.entityRef) && ["person", "organization", "place", "object", "event", "task"].includes(String(binding.entityKind))
      && ((binding.referenceKind === "existing" && binding.archetypeRef === undefined)
        || (binding.referenceKind === "openArchetype" && isNonEmptyString(binding.archetypeRef))));
}
function assertionConform(value: Record<string, unknown>): boolean {
  return hasExactKeys(value, ["schema", "sourcePremiseFactRef", "relationKind", "assertion"])
    && value.schema === "zhuwei.typed-assertion-fact/v1" && isNonEmptyString(value.sourcePremiseFactRef)
    && isNonEmptyString(value.relationKind) && PREMISE_RELATIONS[value.relationKind] !== undefined
    && isRecord(value.assertion) && hasExactKeys(value.assertion, ["subjectRef", "predicate", "polarity", "object"])
    && isNonEmptyString(value.assertion.subjectRef) && value.assertion.predicate === premiseAssertionPredicate(value.relationKind)
    && ["affirm", "deny"].includes(String(value.assertion.polarity)) && isRecord(value.assertion.object)
    && hasExactKeys(value.assertion.object, ["referenceKind", "ref"]) && value.assertion.object.referenceKind === "existing"
    && isNonEmptyString(value.assertion.object.ref);
}

/** These refs can supply names only when the existing Viewer projection has
 * them. They are not additional spatial requirements on held knowledge. */
export function heldKnowledgeDisplayRefs(records: readonly KnowledgeRecord[]): string[] {
  return [...new Set(records.flatMap(record => {
    const value = record.content;
    if (!isRecord(value)) return [];
    if (premiseConform(value) && Array.isArray(value.bindings)) {
      return [String(value.characterId), ...value.bindings.flatMap(binding => isRecord(binding) && isNonEmptyString(binding.entityRef) ? [binding.entityRef] : [])];
    }
    if (assertionConform(value) && isRecord(value.assertion)) {
      const assertion = value.assertion;
      return [assertion.subjectRef, isRecord(assertion.object) ? assertion.object.ref : undefined].filter(isNonEmptyString);
    }
    return [];
  }))].sort();
}

function contentFacts(record: KnowledgeRecord, names: ReadonlyMap<string, string>): string[] {
  const value = record.content;
  const inference = characterInferenceContentText(value);
  if (record.objectKind === "characterInference" && inference !== undefined) return [inference];
  const name = (ref: unknown): string => {
    if (ref === record.characterId) return "该角色本人";
    if (!isNonEmptyString(ref) || !names.has(ref)) throw new TypeError("KNOWLEDGE_DISPLAY_NAME_UNAVAILABLE");
    return names.get(ref)!;
  };
  if (isRecord(value)) {
    if (value.schema === "zhuwei.module-opening-knowledge/v1" && hasExactKeys(value, ["schema", "moduleRef", "sceneId", "description"])
      && isRecord(value.moduleRef) && isNonEmptyString(value.sceneId) && isNonEmptyString(value.description)) return [value.description];
    if (premiseConform(value) && Array.isArray(value.bindings)) {
      return value.bindings.map(binding => {
        if (!isRecord(binding) || !isNonEmptyString(binding.relationKind) || !PREMISE_RELATIONS[binding.relationKind]) {
          throw new TypeError("KNOWLEDGE_PREMISE_EXPRESSION_UNAVAILABLE");
        }
        return `已有背景中的${name(value.characterId)}${PREMISE_RELATIONS[binding.relationKind]}${name(binding.entityRef)}`;
      });
    }
    if (assertionConform(value) && isRecord(value.assertion)) {
      const assertion = value.assertion;
      const relation = typeof value.relationKind === "string" ? PREMISE_RELATIONS[value.relationKind] : undefined;
      if (!relation || !isRecord(assertion.object) || !["affirm", "deny"].includes(String(assertion.polarity))) {
        throw new TypeError("KNOWLEDGE_ASSERTION_EXPRESSION_UNAVAILABLE");
      }
      return [`${name(assertion.subjectRef)}${assertion.polarity === "deny" ? "并非" : ""}${relation}${name(assertion.object.ref)}`];
    }
    if (Object.keys(value).length === 2 && (isNonEmptyString(value.observedActivityId) || isNonEmptyString(value.observedRootActionId))
      && isNonEmptyString(value.status)) {
      const status: Readonly<Record<string, string>> = { active: "进行中", completed: "已完成", interrupted: "已中断",
        committed: "已提交", awaitingInput: "等待回答", awaitingRandomness: "等待掷骰", concluded: "已结束" };
      return [`已有记录中的${value.observedActivityId ? "活动" : "行动"}当时的状态记为：${status[value.status] ?? value.status}`];
    }
  }
  // Unknown or malformed structured content stays in the held record. Its
  // expression must fail explicitly instead of silently omitting fields.
  if (value !== null && typeof value === "object") throw new TypeError("KNOWLEDGE_CONTENT_EXPRESSION_UNAVAILABLE");
  return [typeof value === "string" ? value.length > 0 ? value : '空字符串内容' : JSON.stringify(value)];
}

export function heldKnowledgeNarrationFacts(scope: KnowledgeReviewScope, records: readonly KnowledgeRecord[], names: ReadonlyMap<string, string>): string[] {
  if (records.length === 0) return [scope === "allKnown"
    ? "当前角色已持有的知识目录为空；这是已有知识回顾，没有进行新的观察或调查"
    : "已检查当前角色完整的已有知识目录，本次没有选到与问题相关的记录；这不证明世界中不存在答案"];
  return records.flatMap((record, index) => {
    const provenance = record.objectKind === "sourceClaim" ? "已有来源声称，尚未由这条记录证实"
      : record.objectKind === "characterInference" ? "已有推断，仍未确定"
      : record.objectKind === "sensoryEvidence" ? record.sourceCharacterId === null ? "已有感官记录" : "经转述获知的感官记录"
      : "已有事实记载";
    const layer = record.layer === "hint" ? "，目前仅有提示" : record.layer === "partial" ? "，目前只掌握部分内容" : "";
    return contentFacts(record, names).map(fact => `已有知识第${index + 1}项（${provenance}${layer}）：${fact}`);
  });
}

export function acquiredKnowledgeNarrationFacts(record: KnowledgeRecord, names: ReadonlyMap<string, string>): string[] {
  const reported = record.sourceCharacterId !== null;
  const provenance = record.objectKind === "sourceClaim" ? "来源主张，尚未由这条记录证实"
    : record.objectKind === "characterInference" ? `${reported ? "转述的" : ""}角色推断，仍未确定`
    : record.objectKind === "sensoryEvidence" ? reported ? "转述的感官记录，非本人当场感知" : "本次感官记录"
    : `${reported ? "转述的" : ""}事实记载`;
  const layer = record.layer === "hint" ? "，仅有提示" : record.layer === "partial" ? "，只掌握部分内容" : "";
  return contentFacts(record, names).map(fact => `本次取得的知识（${provenance}${layer}）：${fact}`);
}
