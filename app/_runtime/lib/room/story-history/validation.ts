import { archiveSha256 } from "../archive";
import type { StoryTemporalBasis } from "../story-creation/contracts";
import type {
  StoryExportRequest, StoryHistoricalBranchRequest, StoryHistoryFailureCode,
  StoryHistoryRejection, StoryHistorySource,
} from "./contracts";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
export const sequence = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
export const hash = (value: unknown): value is `sha256:${string}` =>
  typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
export function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}
export function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
}
export const rejected = (code: StoryHistoryFailureCode): StoryHistoryRejection => ({ kind: "rejected", code });

function access(value: unknown): boolean {
  return exact(value, ["principalId", "authorizationVersion"])
    && text(value.principalId) && text(value.authorizationVersion);
}
export function source(value: unknown): value is StoryHistorySource {
  return exact(value, ["roomId", "runtimeEpochId", "archiveHash", "branchId"])
    && text(value.roomId) && text(value.runtimeEpochId) && text(value.branchId) && hash(value.archiveHash);
}
export function exportRequest(value: unknown): value is StoryExportRequest {
  if (!isRecord(value) || !access(value.access) || !source(value.source)) return false;
  return value.kind === "system" ? exact(value, ["kind", "access", "source"])
    : value.kind === "viewer" && exact(value, ["kind", "access", "source", "characterId", "cursor"])
      && text(value.characterId) && (value.cursor === null || text(value.cursor));
}
export function branchRequest(value: unknown): value is StoryHistoricalBranchRequest {
  return exact(value, ["access", "source", "cut", "identity"])
    && access(value.access) && source(value.source)
    && exact(value.cut, ["eventSeq", "focusSceneId"])
    && sequence(value.cut.eventSeq) && text(value.cut.focusSceneId)
    && exact(value.identity, ["kind", "characterId", "sceneId", "originBasisRefs", "character"])
    && value.identity.kind === "newCharacter" && text(value.identity.characterId) && text(value.identity.sceneId)
    && uniqueStrings(value.identity.originBasisRefs) && value.identity.originBasisRefs.length > 0
    && isRecord(value.identity.character);
}
export function temporalBasis(value: unknown): value is StoryTemporalBasis {
  if (!exact(value, ["kind", "start", "end", "basisRefs"])
    || !uniqueStrings(value.basisRefs) || value.basisRefs.length === 0
    || !exact(value.start, ["timelineId", "micros"])
    || !text(value.start.timelineId) || !sequence(value.start.micros)) return false;
  if (value.kind === "at" || value.kind === "before") return value.end === null;
  return value.kind === "between" && exact(value.end, ["timelineId", "micros"])
    && text(value.end.timelineId) && sequence(value.end.micros)
    && value.start.timelineId === value.end.timelineId
    && BigInt(value.start.micros) <= BigInt(value.end.micros);
}

/** Stored preparation must be intact before any of its temporal statements can
 * be interpreted. Semantic consistency remains a trusted-host admission check. */
export async function validPreparation(
  value: unknown, head: string,
): Promise<boolean> {
  if (!exact(value, ["preparation", "preparationHash", "recordedAtEventSeq", "facts"])
    || !hash(value.preparationHash) || !sequence(value.recordedAtEventSeq)
    || BigInt(value.recordedAtEventSeq) > BigInt(head)
    || !exact(value.preparation, ["format", "jobId", "version", "requestHash", "contextHash", "recipeRefs",
      "title", "cause", "centralQuestion", "worldConnection", "existingFactRefs", "facts", "participants",
      "definitions", "opportunities", "scenes", "evidence", "developments", "resolutions", "stages", "notApplicable", "hostingNotes"])
    || value.preparation.format !== "zhuwei.story-preparation/v1"
    || !text(value.preparation.jobId) || !Array.isArray(value.preparation.facts)
    || !Array.isArray(value.facts)) return false;
  if (await archiveSha256(value.preparation) !== value.preparationHash) return false;
  const candidates = value.preparation.facts;
  if (!candidates.every(candidate => exact(candidate, ["ref", "layer", "content", "subjectRefs", "occurrence", "basisRefs", "creationBasis", "knowledge"])
    && text(candidate.ref)
    && ["worldTruth", "statement"].includes(String(candidate.layer)) && text(candidate.content)
    && uniqueStrings(candidate.subjectRefs) && candidate.subjectRefs.length > 0
    && temporalBasis(candidate.occurrence) && uniqueStrings(candidate.basisRefs)
    && ["existingEvidence", "authorizedOpenSpace"].includes(String(candidate.creationBasis))
    && Array.isArray(candidate.knowledge) && candidate.knowledge.every(entry =>
      exact(entry, ["ref", "holderRef", "factRef", "layer", "content", "sourceRef", "acquisition", "explanation"])
      && text(entry.ref) && text(entry.holderRef) && text(entry.factRef)
      && ["truth", "sensoryEvidence", "sourceClaim", "inference"].includes(String(entry.layer))
      && text(entry.content) && text(entry.sourceRef) && text(entry.explanation) && temporalBasis(entry.acquisition))
    && new Set(candidate.knowledge.map(entry => (entry as Record<string, unknown>).ref)).size === candidate.knowledge.length)
    || new Set(candidates.map(candidate => candidate.ref)).size !== candidates.length) return false;
  const candidateRefs = new Set(candidates.map(candidate => candidate.ref));
  return value.facts.every(binding => exact(binding, ["candidateRef", "factRef", "recordedByEventId", "definitionRefs", "knowledge"])
    && text(binding.candidateRef) && candidateRefs.has(binding.candidateRef)
    && text(binding.factRef) && text(binding.recordedByEventId) && uniqueStrings(binding.definitionRefs)
    && Array.isArray(binding.knowledge) && binding.knowledge.every(entry =>
      exact(entry, ["candidateRef", "holderRef", "knowledgeRef", "recordedByEventId"])
      && text(entry.candidateRef) && text(entry.holderRef) && text(entry.knowledgeRef) && text(entry.recordedByEventId)))
    && new Set(value.facts.map(binding => (binding as Record<string, unknown>).candidateRef)).size === value.facts.length;
}
