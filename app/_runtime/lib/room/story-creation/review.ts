import type { StoryContext, StoryContextMaterial, StoryCreationPorts, StoryFailureCode,
  StoryPreparation, StoryRecipe, StoryRecord, StoryRequest, StoryReview, StoryReviewFinding, StoryTemporalBasis } from "./contracts";
import { isRecord, StoryOutputError, validateStoredPreparation, validateStoredReview } from "./prompt";

export const STORY_REVIEW_CATEGORIES = ["completeness", "worldConsistency", "knowledge", "playability", "mechanics", "playerAgency"] as const;

/** Host-authored definition material, bound by Context/readSet. This describes
 * the actual payload fields of one capability, not a grant inferred from its
 * name. The host's normal capability parser and Rules remain authoritative. */
export type StoryCapabilityDescription = Readonly<{ capability: string; schema: StoryRecord; instructions?: string }>;
export function storyCapabilityDescription(material: StoryContextMaterial): StoryCapabilityDescription | undefined {
  const content = material.content;
  if (material.kind !== "definition" || material.availability !== "known" || !isRecord(content)
    || typeof content.capability !== "string" || !isRecord(content.schema)) return undefined;
  const schema = content.schema;
  if (schema.type !== "object" || !isRecord(schema.properties) || !Array.isArray(schema.required)
    || schema.additionalProperties !== false
    || schema.required.some(key => typeof key !== "string" || !Object.hasOwn(schema.properties as object, key))) return undefined;
  return content as unknown as StoryCapabilityDescription;
}

export function storyReviewPassed(review: StoryReview): boolean {
  return STORY_REVIEW_CATEGORIES.every(category => review.findings.some(finding => finding.category === category))
    && review.findings.every(finding => finding.verdict === "pass")
    && review.recipeCriteria.length > 0 && review.recipeCriteria.every(criterion => criterion.verdict === "pass");
}
export function storyReviewAllowsRevision(review: StoryReview): boolean {
  const blocked = review.findings.filter(finding => finding.verdict !== "pass");
  return blocked.length > 0 && blocked.every(finding => finding.repairable);
}

const issue = (path: string, explanation: string, category: StoryReviewFinding["category"] = "completeness",
  constraintRefs: readonly string[] = []): StoryReviewFinding => ({ category, verdict: "conflict", candidatePaths: [path],
    constraintRefs, explanation, repairable: false });
export type PreparationInspection = { kind: "valid" } | { kind: "invalid"; code: StoryFailureCode; findings: readonly StoryReviewFinding[] };

/** Structural preparation checks precede the paid independent review. They
 * prove identity/reference/time contracts, not the truth of natural language,
 * NPC intentions or entertainment value. The independent review and admission
 * authority must still inspect those distinct questions. */
export function inspectStoryPreparation(preparation: StoryPreparation, request: StoryRequest, context: StoryContext,
  hash: StoryCreationPorts["hash"]): PreparationInspection {
  const findings: StoryReviewFinding[] = [];
  let code: StoryFailureCode = "STORY_OUTPUT_INVALID";
  const add = (path: string, message: string, category?: StoryReviewFinding["category"], refs?: readonly string[]) => findings.push(issue(path, message, category, refs));
  try { validateStoredPreparation(preparation); } catch { return { kind: "invalid", code, findings: [issue("/", "准备字段不完整或包含未声明字段。") ] }; }
  if (preparation.jobId !== request.jobId || preparation.requestHash !== hash(request)
    || preparation.contextHash !== context.contextHash || hash(preparation.recipeRefs) !== hash(request.recipeRefs)) {
    return { kind: "invalid", code: "STORY_CHECKPOINT_CONFLICT", findings: [issue("/", "准备绑定不匹配。") ] };
  }
  const materials = new Map(context.materials.map(material => [material.ref, material]));
  const available = new Set(context.materials.filter(material => ["known", "open", "explicitlyUnknown", "scopedAbsent"].includes(material.availability)).map(material => material.ref));
  const existing = new Set(context.materials.filter(material => material.availability === "known").map(material => material.ref));
  const local = new Set<string>();
  const register = (ref: string, path: string) => {
    if (local.has(ref) || materials.has(ref)) { code = "STORY_IDENTITY_CONFLICT"; add(path, "新引用与既有人物/材料或同包生产者重复。", "worldConsistency", materials.has(ref) ? [ref] : []); }
    local.add(ref);
  };
  const groups = ["facts", "definitions", "opportunities", "scenes", "evidence", "developments", "resolutions", "stages"] as const;
  for (const group of groups) preparation[group].forEach((entry, index) => register(entry.ref, `/${group}/${index}/ref`));
  preparation.facts.forEach((fact, i) => fact.knowledge.forEach((entry, j) => register(entry.ref, `/facts/${i}/knowledge/${j}/ref`)));
  const all = new Set([...available, ...local]);
  const requireRefs = (refs: readonly string[], path: string, allowed = all) => {
    if (new Set(refs).size !== refs.length) add(path, "引用重复。");
    for (const ref of refs) if (!allowed.has(ref)) add(path, "引用缺少授权材料或本包生产者。", "worldConsistency", materials.has(ref) ? [ref] : []);
  };
  requireRefs(preparation.existingFactRefs, "/existingFactRefs", new Set(context.materials.filter(material => material.availability === "known"
    && ["fact", "anchor", "narrativeCommitment"].includes(material.kind)).map(material => material.ref)));

  const na = new Map(preparation.notApplicable.map(item => [item.path, item.reason]));
  const optional = ["facts", "participants", "definitions", "evidence", "developments", "stages"] as const;
  for (const [i, item] of preparation.notApplicable.entries()) {
    const field = optional.find(key => `/${key}` === item.path);
    if (!field || preparation[field].length > 0 || preparation.notApplicable.filter(other => other.path === item.path).length !== 1) {
      add(`/notApplicable/${i}`, "仅允许对确实为空的可不适用材料声明原因。");
    }
  }
  for (const field of optional) if (preparation[field].length === 0 && !na.has(`/${field}`)) add(`/${field}`, "该类准备为空时须解释不适用原因。");
  if (preparation.facts.length === 0 && preparation.existingFactRefs.length === 0) add("/facts", "核心真实局势须引用已有事实或准备明确的新事实。");
  if (request.scale === "long") {
    if (preparation.stages.length < 2) add("/stages", "长篇需要至少两个完整阶段。");
    if (new Set(preparation.stages.map(stage => stage.question.trim())).size !== preparation.stages.length
      || new Set(preparation.stages.map(stage => stage.result.trim())).size !== preparation.stages.length) add("/stages", "长篇阶段须有不同的问题与成果。");
  }

  const participants = new Map(preparation.participants.map(participant => [participant.ref, participant]));
  if (participants.size !== preparation.participants.length) { code = "STORY_IDENTITY_CONFLICT"; add("/participants", "同一人物不能在包内复制。"); }
  const defs = new Map(preparation.definitions.map(definition => [definition.ref, definition]));
  for (const [i, participant] of preparation.participants.entries()) {
    const path = `/participants/${i}`;
    if (participant.identity === "existing") {
      if (!existing.has(participant.ref) || materials.get(participant.ref)?.kind !== "npc") {
        code = "STORY_CONTEXT_INSUFFICIENT"; add(`${path}/ref`, "既有人物需要完整的授权NPC材料。", "worldConsistency", [participant.ref]);
      }
    } else {
      if (materials.has(participant.ref) || defs.get(participant.ref)?.kind !== "npc") {
        code = "STORY_IDENTITY_CONFLICT"; add(`${path}/ref`, "新人物需要同一ref的NPC定义，不能覆盖已有身份。");
      }
      if (context.materials.some(material => material.kind === "npc" && isRecord(material.content)
        && (material.content.label === participant.label || material.content.name === participant.label))) {
        code = "STORY_IDENTITY_CONFLICT"; add(`${path}/label`, "与既有人物同名时须先澄清身份，不能用新人物绕过连续性。", "worldConsistency");
      }
    }
    for (const [j, relationship] of participant.relationships.entries()) {
      requireRefs([relationship.otherRef], `${path}/relationships/${j}/otherRef`);
      requireRefs(relationship.basisRefs, `${path}/relationships/${j}/basisRefs`);
    }
    validateKnowledgeRefs(participant.ref, participant.knowledgeRefs, `${path}/knowledgeRefs`);
  }
  for (const [i, definition] of preparation.definitions.entries()) {
    const contracts = context.materials.map(storyCapabilityDescription).filter(contract => contract?.capability === definition.capability);
    if (!context.supportedCapabilities.includes(definition.capability) || contracts.length !== 1) {
      code = "STORY_CAPABILITY_UNSUPPORTED"; add(`/definitions/${i}/capability`, "能力不可用或缺少唯一的宿主payload契约。", "mechanics");
    } else {
      const schema = contracts[0]!.schema;
      const properties = schema.properties as StoryRecord;
      // Check declared root fields here; nested source semantics and complete
      // schema interpretation belong to the host's existing capability parser.
      if ((schema.required as string[]).some(key => !Object.hasOwn(definition.payload, key))
        || Object.keys(definition.payload).some(key => !Object.hasOwn(properties, key))) {
        add(`/definitions/${i}/payload`, "机械定义缺少宿主声明字段或包含未声明字段。", "mechanics");
      }
    }
    requireRefs(definition.dependsOn, `/definitions/${i}/dependsOn`);
  }
  const visiting = new Set<string>(), done = new Set<string>();
  function visit(ref: string): void {
    if (done.has(ref)) return;
    if (visiting.has(ref)) { add("/definitions", "机械定义相互依赖成环。"); return; }
    visiting.add(ref);
    for (const dependency of defs.get(ref)?.dependsOn ?? []) if (defs.has(dependency)) visit(dependency);
    visiting.delete(ref); done.add(ref);
  }
  for (const ref of defs.keys()) visit(ref);

  for (const [i, fact] of preparation.facts.entries()) {
    const path = `/facts/${i}`;
    requireRefs(fact.subjectRefs, `${path}/subjectRefs`);
    requireRefs(fact.basisRefs, `${path}/basisRefs`, available);
    if (fact.creationBasis === "authorizedOpenSpace" && !fact.basisRefs.some(ref => materials.get(ref)?.availability === "open")) {
      add(`${path}/creationBasis`, "补白需要明确的开放授权材料。", "worldConsistency", fact.basisRefs);
    }
    if (fact.creationBasis === "existingEvidence" && !fact.basisRefs.some(ref => existing.has(ref))) {
      add(`${path}/creationBasis`, "已有证据依据必须包含确实可用的材料。", "worldConsistency", fact.basisRefs);
    }
    checkTime(fact.occurrence, `${path}/occurrence`);
    const holders = new Set<string>();
    for (const [j, knowledge] of fact.knowledge.entries()) {
      const kp = `${path}/knowledge/${j}`;
      if (knowledge.factRef !== fact.ref) add(`${kp}/factRef`, "知情记录须指向所属同一事实。", "knowledge");
      if (!participants.has(knowledge.holderRef) || holders.has(knowledge.holderRef)) add(`${kp}/holderRef`, "知情者须为已准备的人物，且同一事实的知情者不能重复。", "knowledge");
      holders.add(knowledge.holderRef);
      requireRefs([knowledge.sourceRef], `${kp}/sourceRef`);
      checkTime(knowledge.acquisition, `${kp}/acquisition`);
      if (fact.layer === "statement" && knowledge.layer === "truth") add(`${kp}/layer`, "听闻主张不能直接成为主张内容为真的知识。", "knowledge");
      if (!timeCanFollow(fact.occurrence, knowledge.acquisition)) add(`${kp}/acquisition`, "知情取得必须有可比较且不早于发生的时间依据。", "knowledge", knowledge.acquisition.basisRefs);
    }
  }
  for (const [i, opportunity] of preparation.opportunities.entries()) requireRefs(opportunity.basisRefs, `/opportunities/${i}/basisRefs`);
  for (const [i, scene] of preparation.scenes.entries()) {
    const location = materials.get(scene.locationRef);
    if (!(location?.kind === "location" && location.availability === "known") && defs.get(scene.locationRef)?.kind !== "location") {
      add(`/scenes/${i}/locationRef`, "场景必须使用授权地点或完整新地点定义。");
    }
    for (const [j, interactable] of scene.interactables.entries()) {
      requireRefs([interactable.ref], `/scenes/${i}/interactables/${j}/ref`);
      requireRefs(interactable.definitionRefs, `/scenes/${i}/interactables/${j}/definitionRefs`, new Set([...defs.keys(), ...context.materials.filter(m => m.kind === "definition" && m.availability === "known").map(m => m.ref)]));
    }
  }
  for (const [i, evidence] of preparation.evidence.entries()) {
    if (new Set(evidence.sources.map(source => source.ref)).size !== evidence.sources.length
      || (evidence.requiredForProgress && evidence.sources.length < 2)) add(`/evidence/${i}/sources`, "必要结论必须有至少两个不同来源；独立性仍须语义审查。", "playability");
    for (const [j, source] of evidence.sources.entries()) {
      requireRefs([source.ref], `/evidence/${i}/sources/${j}/ref`);
      requireRefs(source.basisRefs, `/evidence/${i}/sources/${j}/basisRefs`);
    }
  }
  for (const [i, development] of preparation.developments.entries()) {
    if (!participants.has(development.actorRef)) add(`/developments/${i}/actorRef`, "发展意图必须属于已准备的具体人物。");
    requireRefs(development.basisRefs, `/developments/${i}/basisRefs`);
    validateKnowledgeRefs(development.actorRef, development.knowledgeRefs, `/developments/${i}/knowledgeRefs`);
  }
  return findings.length === 0 ? { kind: "valid" } : { kind: "invalid", code, findings };

  function validateKnowledgeRefs(holderRef: string, refs: readonly string[], path: string): void {
    requireRefs(refs, path);
    const own = new Set(preparation.facts.flatMap(fact => fact.knowledge.filter(known => known.holderRef === holderRef).map(known => known.ref)));
    for (const material of context.materials) if (material.kind === "knowledge" && material.availability === "known"
      && material.subjectRefs.includes(holderRef)
      && (!isRecord(material.content) || material.content.holderRef === undefined || material.content.holderRef === holderRef)) own.add(material.ref);
    for (const ref of refs) if (!own.has(ref)) add(path, "人物不能使用未经自身合法取得的知识。", "knowledge", materials.has(ref) ? [ref] : []);
  }
  function checkTime(time: StoryTemporalBasis, path: string): void {
    requireRefs(time.basisRefs, `${path}/basisRefs`, available);
    const current = context.timelines.find(point => point.timelineId === time.start.timelineId);
    const numeric = (value: string) => /^(0|[1-9][0-9]*)$/u.test(value);
    if (!current || !numeric(time.start.micros) || !numeric(current.micros) || time.basisRefs.length === 0) {
      add(path, "历史时间必须属于授权时间线且有精确依据。", "worldConsistency", time.basisRefs); return;
    }
    if (time.kind === "between") {
      if (!time.end || time.end.timelineId !== time.start.timelineId || !numeric(time.end.micros)
        || BigInt(time.end.micros) < BigInt(time.start.micros) || BigInt(time.end.micros) > BigInt(current.micros)) {
        add(path, "时间区间不成立或超前于当前虚构时间。", "worldConsistency", time.basisRefs);
      }
    } else if (time.end !== null) add(path, "at/before不能混入第二个时间点。", "worldConsistency", time.basisRefs);
    if (BigInt(time.start.micros) > BigInt(current.micros)) add(path, "事实或取得知识不能预写为未来已经发生。", "worldConsistency", time.basisRefs);
  }
}

function timeCanFollow(event: StoryTemporalBasis, acquisition: StoryTemporalBasis): boolean {
  if (event.start.timelineId !== acquisition.start.timelineId) return false;
  const end = event.kind === "between" ? event.end?.micros : event.start.micros;
  if (!end || !/^(0|[1-9][0-9]*)$/u.test(end) || !/^(0|[1-9][0-9]*)$/u.test(acquisition.start.micros)) return false;
  // A 'before' acquisition has no lower bound, so it cannot prove that the
  // holder learned a dated event afterwards. Ask for a supported at/between.
  return acquisition.kind !== "before" && BigInt(acquisition.start.micros) >= BigInt(end);
}

export function validateStoryReview(review: StoryReview, preparation: StoryPreparation, context: StoryContext,
  hash: StoryCreationPorts["hash"], recipes?: readonly StoryRecipe[]): void {
  validateStoredReview(review);
  if (review.preparationHash !== hash(preparation) || review.contextHash !== context.contextHash) throw new StoryOutputError("/review/binding");
  const refs = new Set(context.materials.map(material => material.ref));
  for (const finding of review.findings) {
    if (finding.candidatePaths.length === 0 || finding.candidatePaths.some(path => !resolvesPointer(preparation, path))
      || finding.constraintRefs.some(ref => !refs.has(ref))
      || (finding.category === "worldConsistency" || finding.category === "knowledge") && finding.constraintRefs.length === 0) throw new StoryOutputError("/review/findings");
  }
  if (STORY_REVIEW_CATEGORIES.some(category => !review.findings.some(finding => finding.category === category))) throw new StoryOutputError("/review/categories");
  const criteria = review.recipeCriteria.map(criterion => JSON.stringify([criterion.recipeId, criterion.criterion]));
  if (new Set(criteria).size !== criteria.length) throw new StoryOutputError("/review/recipeCriteria");
  if (recipes) {
    const expected = recipes.flatMap(recipe => recipe.reviewCriteria.map(criterion => JSON.stringify([recipe.ref.id, criterion])));
    if (expected.length !== criteria.length || expected.some(criterion => !criteria.includes(criterion))) throw new StoryOutputError("/review/recipeCriteria");
  } else {
    const ids = new Set(preparation.recipeRefs.map(ref => ref.id));
    if (review.recipeCriteria.some(criterion => !ids.has(criterion.recipeId))
      || [...ids].some(id => !review.recipeCriteria.some(criterion => criterion.recipeId === id))) throw new StoryOutputError("/review/recipeCriteria");
  }
  if (review.recipeCriteria.some(criterion => criterion.verdict !== "pass") && review.findings.every(finding => finding.verdict === "pass")) {
    throw new StoryOutputError("/review/unlocated-criterion");
  }
}

function resolvesPointer(value: unknown, path: string): boolean {
  if (!path.startsWith("/") || /~(?:[^01]|$)/u.test(path)) return false;
  let node: unknown = value;
  for (const part of path.slice(1).split("/").map(part => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if ((!isRecord(node) && !Array.isArray(node)) || !Object.hasOwn(node, part)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return true;
}
