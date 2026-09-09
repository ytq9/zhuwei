import type { AuthoritativeWorldState, EventEnvelope } from "../../rules";
import { archiveSha256, canonicalJson } from "../archive";
import type { StoryTemporalBasis } from "../story-creation/contracts";
import type {
  StoryHistoricalCut, StoryHistoricalFact, StoryHistoricalKnowledge,
  StoryHistoryPreparation, StoryHistoryRejection,
} from "./contracts";
import { isRecord, rejected, sequence } from "./validation";

type TemporalPosition = "established" | "after" | "unresolved";

/** Compare only an expressly named timeline. A range crossing the cut and a
 * before-bound later than the cut do not establish on which side it occurred. */
function temporalPosition(basis: StoryTemporalBasis, state: AuthoritativeWorldState): TemporalPosition {
  const timeline = state.fictionTimelines[basis.start.timelineId];
  if (!timeline || !sequence(timeline.nowMicros)) return "unresolved";
  const cut = BigInt(timeline.nowMicros), start = BigInt(basis.start.micros);
  if (basis.kind === "at") return start <= cut ? "established" : "after";
  if (basis.kind === "before") return start <= cut ? "established" : "unresolved";
  if (basis.end === null || basis.end.timelineId !== basis.start.timelineId) return "unresolved";
  if (BigInt(basis.end.micros) <= cut) return "established";
  return start > cut ? "after" : "unresolved";
}

export function hasUnresolvedCut(state: AuthoritativeWorldState): boolean {
  return Object.keys(state.pendingInputs).length > 0
    || Object.keys(state.internalContinuations).length > 0
    || Object.keys(state.combatRuntime.pendingInputs).length > 0
    || Object.keys(state.combatRuntime.randomnessResolutions).length > 0
    || Object.keys(state.multiplayerRuntime.suspendedPendingInputs).length > 0
    || Object.values(state.receipts).some(receipt =>
      receipt.status === "awaitingInput" || receipt.status === "awaitingRandomness");
}

export async function describeHistoricalCut(
  state: AuthoritativeWorldState,
  head: { eventSeq: string; eventHash: `sha256:${string}`; stateHash: `sha256:${string}` },
  focusSceneId: string,
): Promise<StoryHistoricalCut | StoryHistoryRejection> {
  if (!state.scenes[focusSceneId] || hasUnresolvedCut(state)) return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
  const timelines = Object.entries(state.fictionTimelines)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([timelineId, timeline]) => ({ timelineId, micros: timeline.nowMicros }));
  if (timelines.length === 0 || timelines.some(point => !sequence(point.micros))) {
    return rejected("STORY_HISTORY_TIME_UNRESOLVED");
  }
  return {
    eventSeq: head.eventSeq, eventHash: head.eventHash, stateHash: head.stateHash,
    branchId: state.activeBranchId, focusSceneId, timelines,
    causalFrontiersHash: await archiveSha256(state.multiplayerRuntime.causalFrontiers),
  };
}

export function selectHistoricalSupplements(input: {
  preparations: readonly StoryHistoryPreparation[];
  events: readonly EventEnvelope[];
  sourceState: AuthoritativeWorldState;
  cutState: AuthoritativeWorldState;
  cutEventSeq: string;
}): { kind: "selected"; lateFacts: StoryHistoricalFact[] } | StoryHistoryRejection {
  const byEvent = new Map(input.events.map(event => [event.eventId, event]));
  const cutSeq = BigInt(input.cutEventSeq);
  const result: StoryHistoricalFact[] = [];
  const seenFacts = new Set<string>(), seenKnowledge = new Set<string>();
  for (const material of input.preparations) for (const binding of material.facts) {
    const candidate = material.preparation.facts.find(fact => fact.ref === binding.candidateRef)!;
    const factEvent = byEvent.get(binding.recordedByEventId);
    const fact = input.sourceState.canonicalFacts[binding.factRef];
    if (!factEvent || !fact || fact.validFromEventSeq !== factEvent.eventSeq
      || fact.branchId !== input.sourceState.activeBranchId || seenFacts.has(fact.id)) {
      return rejected("STORY_HISTORY_BINDING_INVALID");
    }
    seenFacts.add(fact.id);
    const existing = input.cutState.canonicalFacts[fact.id];
    const factIsLate = BigInt(factEvent.eventSeq) > cutSeq;
    if (!factIsLate && (!existing || canonicalJson(existing) !== canonicalJson(fact))) {
      return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
    }
    const occurrence = temporalPosition(candidate.occurrence, input.cutState);
    if (occurrence === "unresolved") return rejected("STORY_HISTORY_TIME_UNRESOLVED");
    if (occurrence === "after") continue;
    const knowledge: StoryHistoricalKnowledge[] = [];
    const candidateKnowledgeRefs = new Set<string>();
    for (const granted of binding.knowledge) {
      const item = candidate.knowledge.find(entry => entry.ref === granted.candidateRef);
      const event = byEvent.get(granted.recordedByEventId);
      const record = input.sourceState.knowledge[granted.holderRef]?.[granted.knowledgeRef];
      const key = `${granted.holderRef}\u0000${granted.knowledgeRef}`;
      if (!item || !event || !record || record.acquiredByEventId !== event.eventId
        || record.characterId !== granted.holderRef || record.knowledgeRef !== granted.knowledgeRef
        || candidateKnowledgeRefs.has(item.ref) || seenKnowledge.has(key)) {
        return rejected("STORY_HISTORY_BINDING_INVALID");
      }
      candidateKnowledgeRefs.add(item.ref); seenKnowledge.add(key);
      const position = temporalPosition(item.acquisition, input.cutState);
      if (position === "unresolved") return rejected("STORY_HISTORY_TIME_UNRESOLVED");
      if (position === "after" || BigInt(event.eventSeq) <= cutSeq) continue;
      if (!input.cutState.entities[granted.holderRef]) return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
      knowledge.push({ candidate: structuredClone(item), record: structuredClone(record), recordedBy: structuredClone(event) });
    }
    if (!factIsLate && knowledge.length === 0) continue;
    const definitions: StoryHistoricalFact["definitions"] = {};
    for (const ref of binding.definitionRefs) {
      const definition = input.sourceState.campaignRuntime.definitions[ref];
      if (!definition) return rejected("STORY_HISTORY_MATERIALS_MISSING");
      definitions[ref] = structuredClone(definition);
    }
    if (isRecord(fact.value) && typeof fact.value.definitionRef === "string"
      && !definitions[fact.value.definitionRef]
      && !input.cutState.campaignRuntime.definitions[fact.value.definitionRef]) {
      return rejected("STORY_HISTORY_MATERIALS_MISSING");
    }
    const { knowledge: _allKnowledge, ...factBody } = candidate;
    result.push({
      preparationHash: material.preparationHash, candidate: structuredClone(factBody),
      record: structuredClone(fact), recordedBy: structuredClone(factEvent), definitions,
      knowledge: knowledge.sort((left, right) =>
        `${left.record.characterId}\u0000${left.record.knowledgeRef}`
          .localeCompare(`${right.record.characterId}\u0000${right.record.knowledgeRef}`)),
    });
  }
  return { kind: "selected", lateFacts: result.sort((left, right) => left.record.id.localeCompare(right.record.id)) };
}
