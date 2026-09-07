import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest, Sha256Ref } from "../profiles/types";
import { authorityKnowledgeCatalog, authorityReadSetMatches } from "./authority-bindings";
import { createEventTransition, createScopeProof } from "./events";
import type { AuthoritativeWorldState, EventEnvelope, JsonRecord, KnowledgeRecord, StepResult } from "./model";
import { rejected } from "./results";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";
import type { VersionedAuthorityBinding } from "./world-interaction-model";

export const KNOWLEDGE_REVIEW_PLAN_SCHEMA = "zhuwei.knowledge-review-plan/vnext-1" as const;
export type KnowledgeReviewScope = "allKnown" | "relevantKnown";
export type KnowledgeReviewPlan = Readonly<{
  schema: typeof KNOWLEDGE_REVIEW_PLAN_SCHEMA;
  contextHash: Sha256Ref;
  readSet: readonly VersionedAuthorityBinding[];
  inquiry: string;
  scope: KnowledgeReviewScope;
  knowledgeRefs: readonly string[];
}>;
export type KnowledgeReviewedPayload = Readonly<{
  characterId: string;
  contextHash: Sha256Ref;
  catalogHash: Sha256Ref;
  inquiry: string;
  scope: KnowledgeReviewScope;
  records: readonly KnowledgeRecord[];
}>;

function refsConform(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;
}
function scopeConform(value: unknown): value is KnowledgeReviewScope {
  return value === "allKnown" || value === "relevantKnown";
}
function jsonConform(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonConform);
  return isRecord(value) && Object.values(value).every(jsonConform);
}
export function heldKnowledgeRecordConform(value: unknown): value is KnowledgeRecord {
  return isRecord(value) && hasExactKeys(value, ["characterId", "knowledgeRef", "objectKind", "layer", "content",
    "visibility", "acquiredByEventId", "acquiredAtFictionMicros", "sourceCharacterId", "provenanceChain"])
    && isNonEmptyString(value.characterId) && isNonEmptyString(value.knowledgeRef)
    && ["sensoryEvidence", "sourceClaim", "characterInference", "canonicalFact"].includes(String(value.objectKind))
    && ["hint", "partial", "full"].includes(String(value.layer))
    && ["private", "shared", "publiclyObservable"].includes(String(value.visibility))
    && jsonConform(value.content) && isNonEmptyString(value.acquiredByEventId)
    && typeof value.acquiredAtFictionMicros === "string" && /^(0|[1-9][0-9]*)$/u.test(value.acquiredAtFictionMicros)
    && (value.sourceCharacterId === null || isNonEmptyString(value.sourceCharacterId))
    && Array.isArray(value.provenanceChain) && value.provenanceChain.every(isNonEmptyString);
}
export function knowledgeReviewContentConform(value: unknown): value is Pick<KnowledgeReviewedPayload, "characterId" | "inquiry" | "scope" | "records"> {
  return isRecord(value) && isNonEmptyString(value.characterId) && isNonEmptyString(value.inquiry)
    && scopeConform(value.scope) && Array.isArray(value.records)
    && value.records.every(record => heldKnowledgeRecordConform(record) && record.characterId === value.characterId)
    && new Set(value.records.map(record => record.knowledgeRef)).size === value.records.length;
}
export function isKnowledgeReviewedPayload(value: unknown): value is KnowledgeReviewedPayload {
  return isRecord(value) && hasExactKeys(value, ["characterId", "contextHash", "catalogHash", "inquiry", "scope", "records"])
    && isSha256(value.contextHash) && isSha256(value.catalogHash) && knowledgeReviewContentConform(value);
}
export function isKnowledgeReviewPlan(value: unknown): value is KnowledgeReviewPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "contextHash", "readSet", "inquiry", "scope", "knowledgeRefs"])
    && value.schema === KNOWLEDGE_REVIEW_PLAN_SCHEMA && isSha256(value.contextHash)
    && isNonEmptyString(value.inquiry) && scopeConform(value.scope) && refsConform(value.knowledgeRefs)
    && Array.isArray(value.readSet) && value.readSet.every(binding => isRecord(binding)
      && hasExactKeys(binding, ["ref", "revisionOrHash"]) && isNonEmptyString(binding.ref) && isNonEmptyString(binding.revisionOrHash))
    && new Set(value.readSet.map(binding => binding.ref)).size === value.readSet.length;
}

/** Read only the holder's record. A knowledge ref never licenses dereferencing
 * a canonical fact, source claim, speaker's knowledge or more complete layer. */
function selectedHeldKnowledge(state: AuthoritativeWorldState, characterId: string, refs: readonly string[]) {
  return refs.map(ref => state.knowledge[characterId]?.[ref]);
}
export function validateKnowledgeReviewedEvent(state: AuthoritativeWorldState, event: EventEnvelope): void {
  const payload = event.payload;
  if (!isKnowledgeReviewedPayload(payload) || event.secrecy !== "private"
    || event.visibilityPolicyId !== `visibility:knowledge-holder:${payload.characterId}`
    || state.entities[payload.characterId]?.kind !== "player" || state.entities[payload.characterId]?.tenureStatus !== "active"
    || state.characterControls[payload.characterId] === undefined) throw new TypeError("KNOWLEDGE_REVIEW_AUTHORITY_INVALID");
  const catalog = authorityKnowledgeCatalog(state, payload.characterId)!;
  const refs = payload.records.map(record => record.knowledgeRef);
  if (canonicalSha256(catalog) !== payload.catalogHash
    || canonicalSha256(refs) !== canonicalSha256([...refs].sort())
    || (payload.scope === "allKnown" && canonicalSha256(refs) !== canonicalSha256(catalog.records.map(record => record.knowledgeRef)))
    || selectedHeldKnowledge(state, payload.characterId, refs).some((record, index) => record === undefined
      || canonicalSha256(record) !== canonicalSha256(payload.records[index]))) throw new TypeError("KNOWLEDGE_REVIEW_RECORD_MISMATCH");
}

export function stepKnowledgeReview(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["kind", "rootActionId", "actorCharacterId", "plan"]) || input.kind !== "knowledgeReview"
    || !isNonEmptyString(input.rootActionId) || !isNonEmptyString(input.actorCharacterId) || !isKnowledgeReviewPlan(input.plan)) {
    return rejected("invalidRulesInput", "The knowledge review must be one closed read-only request.");
  }
  if (input.rootActionId in state.receipts) return rejected("duplicateRootAction", "The knowledge review already has a receipt.");
  const plan = input.plan;
  const catalogRef = `knowledge-catalog:${input.actorCharacterId}`;
  const catalog = authorityKnowledgeCatalog(state, input.actorCharacterId);
  const refs = [...plan.knowledgeRefs].sort();
  const byRef = new Map(plan.readSet.map(binding => [binding.ref, binding.revisionOrHash]));
  if (catalog === undefined || byRef.get(catalogRef) !== canonicalSha256(catalog)
    || !byRef.has(input.actorCharacterId) || !authorityReadSetMatches(state, plan.readSet)
    || refs.some(ref => !byRef.has(`knowledge:${input.actorCharacterId}:${ref}`))
    || (plan.scope === "allKnown" && canonicalSha256(refs) !== canonicalSha256(catalog.records.map(record => record.knowledgeRef)))) {
    return rejected("invalidRulesInput", "The complete held-knowledge catalog and selected records must match the frozen read set.");
  }
  const records = selectedHeldKnowledge(state, input.actorCharacterId, refs);
  if (records.some(record => !heldKnowledgeRecordConform(record))) return rejected("invalidRulesInput", "The selected held knowledge is unavailable.");
  const payload: KnowledgeReviewedPayload = { characterId: input.actorCharacterId, contextHash: plan.contextHash,
    catalogHash: canonicalSha256(catalog), inquiry: plan.inquiry, scope: plan.scope, records: structuredClone(records) as KnowledgeRecord[] };
  const scopeProof = createScopeProof(state, [ ...plan.readSet.map(binding => binding.ref), `receipt:${input.rootActionId}` ],
    [`receipt:${input.rootActionId}`], []);
  const transition = createEventTransition(state, profiles, { rootActionId: input.rootActionId, eventType: "KnowledgeReviewed",
    payload, scopeProof, secrecy: "private", visibilityPolicyId: `visibility:knowledge-holder:${input.actorCharacterId}` });
  return { kind: "committed", events: [transition.event], state: transition.state, cache: transition.state,
    stateHash: transition.event.stateHashAfter, scopeProof, receipt: transition.receipt,
    mechanicalResult: { kind: "knowledgeReview", characterId: input.actorCharacterId, recordCount: records.length } };
}
