import type { AuthoritativeWorldState, EventEnvelope } from "../../rules";
import { archiveSha256, canonicalJson, type AuthoritativeRoomArchive } from "../archive";
import type { StoryTemporalBasis } from "../story-creation/contracts";
import type {
  StoryHistoricalCut, StoryHistoricalFact, StoryHistoricalKnowledge,
  StoryHistoryPreparation, StoryHistoryRejection,
} from "./contracts";
import { isRecord, rejected, sequence } from "./validation";
import { storyDefinitionAvailable, storyMappedReference } from "../story-admission";
import { reviewedDefinitionEntry } from "../../kp/vnext/story-materialization";
import { isNpcMaterializedPayload } from "../../rules/v2/npc-materialization";
import { isSemanticDefinitionMaterializedPayload } from "../../rules/v2/semantic-definitions";
import { isStoryFactBody, isStoryKnowledgeBody } from "../../rules/v2/story-facts-admission";
import { isHistoricalOrigin } from "../../rules/v2/historical-world";
import { validateStoryGenesisMappings } from "../story-library";
import type { StoryLibraryMappings } from "../story-library-contracts";

type TemporalPosition = "established" | "after" | "unresolved";

function knowledgeSourceMatches(
  material: StoryHistoryPreparation, item: StoryHistoricalKnowledge["candidate"], record: StoryHistoricalKnowledge["record"],
): boolean {
  const ref = storyMappedReference(material.preparation, material.definitions, material.facts, item.sourceRef);
  return record.provenanceChain.includes(ref) || record.knowledgeRef === ref
    || record.sourceCharacterId === ref || record.sourceCharacterId === null && record.characterId === ref;
}

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

function currentTemporalBasis(basis: StoryTemporalBasis, body: unknown): StoryTemporalBasis {
  if (!isStoryFactBody(body) && !isStoryKnowledgeBody(body)) return basis;
  const actual = (ref: string) => body.bindings.find(value => value.ref === ref)?.authorityRef ?? ref;
  return { ...basis, start: { ...basis.start, timelineId: actual(basis.start.timelineId) },
    end: basis.end ? { ...basis.end, timelineId: actual(basis.end.timelineId) } : null,
    basisRefs: basis.basisRefs.map(actual) };
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
  genesis?: AuthoritativeRoomArchive["signedGenesis"];
}): { kind: "selected"; lateFacts: StoryHistoricalFact[]; preparations: StoryHistoryPreparation[] } | StoryHistoryRejection {
  const byEvent = new Map(input.events.map(event => [event.eventId, event]));
  const cutSeq = BigInt(input.cutEventSeq);
  const result: StoryHistoricalFact[] = [];
  const preparations: StoryHistoryPreparation[] = [];
  const seenFacts = new Set<string>(), seenKnowledge = new Set<string>();
  const baselines = new Map<string, StoryLibraryMappings>();
  for (const material of input.preparations) {
    const baseline = { definitions: material.definitions.filter(value => !byEvent.has(value.recordedByEventId)),
      facts: material.facts.filter(value => !byEvent.has(value.recordedByEventId)).map(value => ({ ...value,
        knowledge: value.knowledge.filter(known => !byEvent.has(known.recordedByEventId)) })) };
    if (baseline.definitions.length || baseline.facts.length) {
      if (!input.genesis || !isHistoricalOrigin(input.genesis.historicalOrigin)) return rejected("STORY_HISTORY_BINDING_INVALID");
      try { validateStoryGenesisMappings(material.preparation, baseline, input.genesis.initialState as AuthoritativeWorldState); }
      catch { return rejected("STORY_HISTORY_BINDING_INVALID"); }
    }
    baselines.set(material.preparationHash, baseline);
  }
  for (const material of input.preparations) {
    const baseline = baselines.get(material.preparationHash)!;
    const seenDefinitions = new Set<string>();
    for (const mapping of material.definitions) {
      const event = byEvent.get(mapping.recordedByEventId), source = reviewedDefinitionEntry(material.preparation, mapping.candidateRef);
      const payload: unknown = event?.payload;
      const matches = source.kind === "materializeNpc" ? event?.eventType === "NpcMaterialized"
        && isNpcMaterializedPayload(payload) && payload.plan.prospectiveRef === mapping.authorityRef
        && input.sourceState.entities[mapping.authorityRef]?.kind === "npc"
        : source.kind === "materializeObject" ? event?.eventType === "SemanticDefinitionMaterialized"
          && isSemanticDefinitionMaterializedPayload(payload) && payload.definitionRef === mapping.authorityRef
          : source.kind === "materializeItem" ? event?.eventType === "ItemMaterialized"
            && isRecord(payload) && isRecord(payload.entry) && payload.entry.entryId === mapping.authorityRef
            : source.kind === "materializeDefinition" && ["DefinitionRegistered", "ItemDefinitionRegistered"].includes(String(event?.eventType))
              && isRecord(payload) && isRecord(payload.definition) && payload.definition.definitionId === mapping.authorityRef;
      const inherited = baseline.definitions.some(value => canonicalJson(value) === canonicalJson(mapping));
      if ((!matches || !event) && !inherited || seenDefinitions.has(mapping.authorityRef)
        || mapping.definitionRefs.some(ref => !storyDefinitionAvailable(input.sourceState, ref))) return rejected("STORY_HISTORY_BINDING_INVALID");
      seenDefinitions.add(mapping.authorityRef);
    }
    const inheritedEvents = new Set([...baseline.definitions.map(value => value.recordedByEventId),
      ...baseline.facts.flatMap(value => [value.recordedByEventId, ...value.knowledge.map(known => known.recordedByEventId)])]);
    const retained = (eventId: string) => { const event = byEvent.get(eventId); return event !== undefined ? BigInt(event.eventSeq) <= cutSeq : inheritedEvents.has(eventId); };
    const definitions = material.definitions.filter(mapping => retained(mapping.recordedByEventId));
    const facts = material.facts.filter(mapping => retained(mapping.recordedByEventId)).map(mapping => ({ ...mapping,
      knowledge: mapping.knowledge.filter(known => retained(known.recordedByEventId)) }));
    if (BigInt(material.recordedAtEventSeq) <= cutSeq && (definitions.length > 0 || facts.length > 0)) {
      preparations.push(structuredClone({ ...material, definitions, facts }));
    }
  }
  for (const material of input.preparations) for (const binding of material.facts) {
    const candidate = material.preparation.facts.find(fact => fact.ref === binding.candidateRef)!;
    const factEvent = byEvent.get(binding.recordedByEventId);
    const fact = input.sourceState.canonicalFacts[binding.factRef];
    const baseline = baselines.get(material.preparationHash)!.facts.find(value => value.candidateRef === binding.candidateRef);
    if (!fact || (!factEvent ? !baseline || canonicalJson(input.genesis?.initialState.canonicalFacts[fact.id]) !== canonicalJson(fact)
      : fact.validFromEventSeq !== factEvent.eventSeq)
      || fact.branchId !== input.sourceState.activeBranchId || seenFacts.has(fact.id)) {
      return rejected("STORY_HISTORY_BINDING_INVALID");
    }
    seenFacts.add(fact.id);
    const existing = input.cutState.canonicalFacts[fact.id];
    const factIsLate = factEvent !== undefined && BigInt(factEvent.eventSeq) > cutSeq;
    if (!factIsLate && (!existing || canonicalJson(existing) !== canonicalJson(fact))) {
      return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
    }
    const occurrence = temporalPosition(currentTemporalBasis(candidate.occurrence, fact.value), input.cutState);
    if (occurrence === "unresolved") return rejected("STORY_HISTORY_TIME_UNRESOLVED");
    if (occurrence === "after") continue;
    const knowledge: StoryHistoricalKnowledge[] = [];
    const candidateKnowledgeRefs = new Set<string>();
    for (const granted of binding.knowledge) {
      const item = candidate.knowledge.find(entry => entry.ref === granted.candidateRef);
      const event = byEvent.get(granted.recordedByEventId);
      const record = input.sourceState.knowledge[granted.holderRef]?.[granted.knowledgeRef];
      const key = `${granted.holderRef}\u0000${granted.knowledgeRef}`;
      const inherited = baseline?.knowledge.some(value => canonicalJson(value) === canonicalJson(granted)) === true;
      if (!item || !record || (!event ? !inherited : record.acquiredByEventId !== event.eventId)
        || storyMappedReference(material.preparation, material.definitions, material.facts, item.holderRef) !== granted.holderRef || item.factRef !== candidate.ref
        || record.characterId !== granted.holderRef || record.knowledgeRef !== granted.knowledgeRef
        || record.objectKind !== ({ truth: "canonicalFact", sensoryEvidence: "sensoryEvidence",
          sourceClaim: "sourceClaim", inference: "characterInference" } as const)[item.layer]
        || !record.provenanceChain.includes(binding.factRef) || !knowledgeSourceMatches(material, item, record)
        || candidateKnowledgeRefs.has(item.ref) || seenKnowledge.has(key)) {
        return rejected("STORY_HISTORY_BINDING_INVALID");
      }
      candidateKnowledgeRefs.add(item.ref); seenKnowledge.add(key);
      const position = temporalPosition(currentTemporalBasis(item.acquisition, record.content), input.cutState);
      if (position === "unresolved") return rejected("STORY_HISTORY_TIME_UNRESOLVED");
      if (position === "after" || !event || BigInt(event.eventSeq) <= cutSeq) continue;
      if (!input.cutState.entities[granted.holderRef]) return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
      knowledge.push({ candidate: structuredClone(item), record: structuredClone(record), recordedBy: structuredClone(event) });
    }
    if (!factIsLate && knowledge.length === 0) continue;
    if (!factEvent) return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
    const definitions: StoryHistoricalFact["definitions"] = {};
    for (const ref of binding.definitionRefs) {
      const definition = input.sourceState.campaignRuntime.definitions[ref]
        ?? input.sourceState.combatRuntime.definitions[ref] ?? input.sourceState.campaignRuntime.itemSystem.definitions[ref];
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
  return { kind: "selected", lateFacts: result.sort((left, right) => left.record.id.localeCompare(right.record.id)), preparations };
}
