import { PROMISE_DUE_TIERS, promiseDueDurationMicros, type PromiseDueTier } from "./promise-due";
import { promiseTermsConform, promiseTermsRefs, promiseChangeConform, promiseChangeIssue, promiseLifecycle,
  promiseChangeSnapshot, promiseChangeDescription, applyPromiseChange, type PromiseTerms, type PromiseChange } from "./promise-lifecycle";
import { npcWorkId } from "./npc-work";
import { worldFactRef, worldFactDefinition, worldFactPointer } from "./world-facts";
import { canonicalSha256 } from "../profiles/canonical";
import type { RuntimeProfileManifest } from "../profiles/types";
import type { AuthoritativeWorldState, EventEnvelope, EventPayloadByType, JsonRecord } from "./model";
import { authorityRevisionOrHash, authoritySpatialRefVisibleTo } from "./authority-bindings";
import { authoritativeNpcDecisionContext, npcDecisionContextConform, type NpcDecisionContext } from "./npc-decision-context";
import { socialCommitmentIssue, socialCommitmentPolicy, type SocialCommitmentEventType } from "./social-commitments";
import { socialMethodFingerprint, socialParticipantsCoPresent, socialUtteranceFingerprint } from "./social-primitives";
import { conditionMechanics } from "./condition-mechanics";
import { characterTimelineId } from "./timeline";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";
import type { AtomicWorldInteractionStepsPlan, WorldInteractionResolutionPlan } from "./world-interaction-model";
import { rebindFrozenSocialPrefix } from "./world-interaction-prefix";
import { domainStateBeforeAuditRange } from "./correction";

const socialPromiseId = (ref: string) => ref.startsWith("continuity:promises:") ? ref.slice("continuity:promises:".length) : ref;

export type SocialEvidence = Readonly<{ kind: "npcContext"; ref: string } | { kind: "playerExpression" }
  | { kind: "materializedKnowledge"; definitionRef: string; holderRef: string }>;
export type SocialResponse = Readonly<{
  kind: "speech" | "silence"; text: string; motive: string; basis: readonly SocialEvidence[];
}>;
export type SocialConsequence =
  | Readonly<{ kind: "relationship"; relationshipRef: string | null; change: string; basisFactRefs: readonly string[] }>
  | Readonly<{ kind: "promise"; content: string; condition: string; authorityRefs: readonly string[]; due: PromiseDueTier;
      terms: PromiseTerms; nextStep: string | null; promisor?: "actor" | "npc"; promiseeRef?: string }>
  | Readonly<{ kind: "promiseChange"; promiseRef: string; revision: string; expressionSource: "actor" | "npc";
      expressionQuote: string; change: PromiseChange; disclose: boolean }>
  | Readonly<{ kind: "debt"; obligation: string; condition: string; basisFactRefs: readonly string[] }>;
export type SocialInteractionBranch = Readonly<{
  outcomeCode: string; summary: string; response: SocialResponse; consequences: readonly SocialConsequence[];
}>;
export type SocialRetryChange = Readonly<{
  priorThreadRef: string; kind: "method" | "conditions" | "cost" | "situation";
  basisRefs: readonly string[]; explanation: string;
}>;
export type SocialInteractionPlan = Readonly<{
  schema: "zhuwei.social-interaction/vnext-1";
  npcRef: string; threadRef: string; addressedThreadRef: string | null;
  playerExpression: string; goal: string; communication: "spokenConversation";
  audience: "participants" | "sceneListeners";
  listeners: readonly string[];
  npcContext: NpcDecisionContext;
  retryChange: SocialRetryChange | null;
  branches: Readonly<{ success: SocialInteractionBranch; failure: SocialInteractionBranch }>;
}>;

const text = (value: unknown): value is string => isNonEmptyString(value) && value.length <= 4_000;
const refs = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 128
  && value.every(isNonEmptyString) && new Set(value).size === value.length;
/** Relative source-shape failures from the same predicates used by Rules.
 * Consumers obtain actual values from their own authorized source object. */
export type SocialShapeDiagnostic = Readonly<{
  code: "FIELD_MISSING" | "TYPE_MISMATCH" | "VALUE_INVALID" | "CONSTRAINT_CONFLICT";
  path: readonly (string | number)[];
  expected: Readonly<Record<string, unknown>>;
  constraint: string;
}>;
type SocialShapeValidator = (value: unknown, diagnostics?: SocialShapeDiagnostic[]) => boolean;

function socialShapeFailure(diagnostics: SocialShapeDiagnostic[] | undefined, code: SocialShapeDiagnostic["code"],
  path: SocialShapeDiagnostic["path"], expected: SocialShapeDiagnostic["expected"], constraint: string): false {
  diagnostics?.push({ code, path, expected, constraint });
  return false;
}
function socialShapeObject(value: unknown, diagnostics?: SocialShapeDiagnostic[]): value is JsonRecord {
  return isRecord(value) || socialShapeFailure(diagnostics, "TYPE_MISMATCH", [], { type: "object" }, "social:object-required");
}
function socialShapeKeys(value: JsonRecord, keys: readonly string[], diagnostics?: SocialShapeDiagnostic[]): boolean {
  if (hasExactKeys(value, keys)) return true;
  const actual = Object.keys(value);
  for (const key of keys) if (!actual.includes(key))
    socialShapeFailure(diagnostics, "FIELD_MISSING", [key], { required: true }, "social:field-required");
  for (const key of actual) if (!keys.includes(key))
    socialShapeFailure(diagnostics, "VALUE_INVALID", [key], { allowedFields: [...keys] }, "social:additional-field");
  return false;
}
function socialShapeField(value: JsonRecord, key: string, predicate: (entry: unknown) => boolean,
  expected: SocialShapeDiagnostic["expected"], diagnostics?: SocialShapeDiagnostic[],
  constraint = "social:field-contract", code: SocialShapeDiagnostic["code"] = "VALUE_INVALID"): boolean {
  if (predicate(value[key])) return true;
  const entry = value[key], type = entry === null ? "null" : Array.isArray(entry) ? "array" : typeof entry;
  return socialShapeFailure(diagnostics, !Object.hasOwn(value, key) ? "FIELD_MISSING"
    : type !== expected.type && !(expected.nullable === true && type === "null") ? "TYPE_MISMATCH" : code,
  [key], expected, constraint);
}
function socialShapeText(value: JsonRecord, key: string, diagnostics?: SocialShapeDiagnostic[]): boolean {
  return socialShapeField(value, key, text, { type: "string", minLength: 1, maxLength: 4_000, normalization: "NFC" }, diagnostics);
}
function socialShapeRef(value: JsonRecord, key: string, diagnostics?: SocialShapeDiagnostic[], nullable = false): boolean {
  return socialShapeField(value, key, entry => (nullable && entry === null) || isNonEmptyString(entry),
    { type: "string", minLength: 1, normalization: "NFC", ...(nullable ? { nullable: true } : {}) }, diagnostics, "social:reference-field");
}
function socialShapeEnum(value: JsonRecord, key: string, values: readonly string[], diagnostics?: SocialShapeDiagnostic[]): boolean {
  return socialShapeField(value, key, entry => typeof entry === "string" && values.includes(entry),
    { type: "string", enum: [...values] }, diagnostics);
}
function socialShapeArray(value: JsonRecord, key: string, minimum: number, maximum: number,
  diagnostics?: SocialShapeDiagnostic[]): boolean {
  return socialShapeField(value, key, entry => Array.isArray(entry) && entry.length >= minimum && entry.length <= maximum,
    { type: "array", minItems: minimum, maxItems: maximum }, diagnostics, "social:array-size");
}
function socialShapeChild(value: unknown, validate: SocialShapeValidator, path: SocialShapeDiagnostic["path"],
  diagnostics?: SocialShapeDiagnostic[]): boolean {
  if (diagnostics === undefined) return validate(value);
  const nested: SocialShapeDiagnostic[] = [];
  const conforms = validate(value, nested);
  diagnostics.push(...nested.map(detail => ({ ...detail, path: [...path, ...detail.path] })));
  return conforms;
}
function socialShapeUnique(identities: readonly unknown[], path: SocialShapeDiagnostic["path"], diagnostics?: SocialShapeDiagnostic[]): boolean {
  if (new Set(identities).size === identities.length) return true;
  const index = identities.findIndex((identity, ordinal) => identities.indexOf(identity) !== ordinal);
  return socialShapeFailure(diagnostics, "VALUE_INVALID", index < 0 ? path : [...path, index],
    { uniqueItems: true }, "social:array-unique");
}
function socialShapeRefs(value: JsonRecord, key: string, diagnostics?: SocialShapeDiagnostic[], minimum = 0): boolean {
  if (!socialShapeArray(value, key, minimum, 128, diagnostics)) return false;
  const entries = value[key] as unknown[];
  return entries.every((entry, index) => isNonEmptyString(entry) || socialShapeFailure(diagnostics,
    typeof entry === "string" ? "VALUE_INVALID" : "TYPE_MISMATCH", [key, index],
    { type: "string", minLength: 1, normalization: "NFC" }, "social:reference-field"))
    && socialShapeUnique(entries, [key], diagnostics);
}

export function socialEvidenceConform(value: unknown, diagnostics?: SocialShapeDiagnostic[]): value is SocialEvidence {
  if (!socialShapeObject(value, diagnostics)
    || !socialShapeEnum(value, "kind", ["playerExpression", "npcContext", "materializedKnowledge"], diagnostics)) return false;
  if (value.kind === "playerExpression") return socialShapeKeys(value, ["kind"], diagnostics);
  if (value.kind === "npcContext") return socialShapeKeys(value, ["kind", "ref"], diagnostics)
    && socialShapeRef(value, "ref", diagnostics);
  return socialShapeKeys(value, ["kind", "definitionRef", "holderRef"], diagnostics)
    && socialShapeRef(value, "definitionRef", diagnostics) && socialShapeRef(value, "holderRef", diagnostics);
}
export function socialConsequenceConform(value: unknown, diagnostics?: SocialShapeDiagnostic[]): value is SocialConsequence {
  if (!socialShapeObject(value, diagnostics)
    || !socialShapeEnum(value, "kind", ["relationship", "promise", "promiseChange", "debt"], diagnostics)) return false;
  if (value.kind === "relationship") return socialShapeKeys(value, ["kind", "relationshipRef", "change", "basisFactRefs"], diagnostics)
    && socialShapeRef(value, "relationshipRef", diagnostics, true) && socialShapeText(value, "change", diagnostics)
    && socialShapeRefs(value, "basisFactRefs", diagnostics);
  if (value.kind === "promiseChange") return socialShapeKeys(value, ["kind", "promiseRef", "revision", "expressionSource", "expressionQuote", "change", "disclose"], diagnostics)
    && [value.promiseRef, value.revision, value.expressionQuote].every(isNonEmptyString)
    && ["actor", "npc"].includes(String(value.expressionSource)) && promiseChangeConform(value.change) && typeof value.disclose === "boolean";
  if (value.kind === "promise") return socialShapeKeys(value, ["kind", "content", "condition", "authorityRefs", "due", "terms", "nextStep",
    ...["promisor", "promiseeRef"].filter(key => Object.hasOwn(value, key))], diagnostics)
    && socialShapeText(value, "content", diagnostics) && socialShapeText(value, "condition", diagnostics)
    && socialShapeRefs(value, "authorityRefs", diagnostics, 1)
    && socialShapeEnum(value, "due", [...PROMISE_DUE_TIERS], diagnostics)
    && socialShapeField(value, "terms", promiseTermsConform, { type: "object" }, diagnostics)
    && (value.promisor === undefined || ["actor", "npc"].includes(String(value.promisor)))
    && (value.promiseeRef === undefined || isNonEmptyString(value.promiseeRef))
    && (value.nextStep === null || socialShapeText(value, "nextStep", diagnostics));
  return socialShapeKeys(value, ["kind", "obligation", "condition", "basisFactRefs"], diagnostics)
    && socialShapeText(value, "obligation", diagnostics) && socialShapeText(value, "condition", diagnostics)
    && socialShapeRefs(value, "basisFactRefs", diagnostics, 1);
}
function socialResponseConform(value: unknown, diagnostics?: SocialShapeDiagnostic[]): value is SocialResponse {
  if (!socialShapeObject(value, diagnostics) || !socialShapeKeys(value, ["kind", "text", "motive", "basis"], diagnostics)
    || !socialShapeEnum(value, "kind", ["speech", "silence"], diagnostics)
    || !(value.kind === "speech" ? socialShapeText(value, "text", diagnostics)
      : socialShapeField(value, "text", entry => entry === "", { type: "string", const: "" }, diagnostics,
        "social:silence-text-empty", "CONSTRAINT_CONFLICT"))
    || !socialShapeText(value, "motive", diagnostics) || !socialShapeArray(value, "basis", 1, 128, diagnostics)) return false;
  const basis = value.basis as unknown[];
  return basis.every((entry, index) => socialShapeChild(entry, socialEvidenceConform, ["basis", index], diagnostics))
    && socialShapeUnique(basis.map(canonicalSha256), ["basis"], diagnostics);
}
export function socialBranchConform(value: unknown, diagnostics?: SocialShapeDiagnostic[]): value is SocialInteractionBranch {
  if (!socialShapeObject(value, diagnostics) || !socialShapeKeys(value, ["outcomeCode", "summary", "response", "consequences"], diagnostics)
    || !socialShapeText(value, "outcomeCode", diagnostics) || !socialShapeText(value, "summary", diagnostics)
    || !socialShapeChild(value.response, socialResponseConform, ["response"], diagnostics)
    || !socialShapeArray(value, "consequences", 0, 16, diagnostics)) return false;
  return (value.consequences as unknown[]).every((entry, index) => socialShapeChild(entry, socialConsequenceConform, ["consequences", index], diagnostics));
}
export function socialRetryChangeConform(value: unknown, diagnostics?: SocialShapeDiagnostic[]): value is SocialRetryChange {
  return socialShapeObject(value, diagnostics) && socialShapeKeys(value, ["priorThreadRef", "kind", "basisRefs", "explanation"], diagnostics)
    && socialShapeRef(value, "priorThreadRef", diagnostics) && socialShapeEnum(value, "kind", ["method", "conditions", "cost", "situation"], diagnostics)
    && socialShapeRefs(value, "basisRefs", diagnostics) && socialShapeText(value, "explanation", diagnostics);
}
export function socialInteractionPlanConform(value: unknown): value is SocialInteractionPlan {
  return isRecord(value) && hasExactKeys(value, ["schema", "npcRef", "threadRef", "addressedThreadRef", "playerExpression", "goal",
    "communication", "audience", "listeners", "npcContext", "retryChange", "branches"])
    && value.schema === "zhuwei.social-interaction/vnext-1" && isNonEmptyString(value.npcRef) && isNonEmptyString(value.threadRef)
    && (value.addressedThreadRef === null || isNonEmptyString(value.addressedThreadRef))
    && text(value.playerExpression) && text(value.goal) && value.communication === "spokenConversation"
    && (value.audience === "participants" || value.audience === "sceneListeners")
    && refs(value.listeners) && npcDecisionContextConform(value.npcContext) && value.npcContext.npcRef === value.npcRef
    && (value.retryChange === null || socialRetryChangeConform(value.retryChange))
    && isRecord(value.branches) && hasExactKeys(value.branches, ["success", "failure"])
    && socialBranchConform(value.branches.success) && socialBranchConform(value.branches.failure);
}
/** What an NPC's promise may be about: a record or knowledge of its own
 * frozen snapshot, something it can see from its scene, or the scene itself.
 * A definition, catalog or rule profile describes a kind of thing and cannot
 * be the subject of an obligation. Lowering pre-checks the same predicate with
 * the frozen snapshot so the KP gets the field, not just this code. */
export function socialPromiseSubjectAdmissible(state: AuthoritativeWorldState, npc: Readonly<{ id: string; sceneId: string }>,
  snapshotRefs: ReadonlySet<string>, ref: string): boolean {
  return snapshotRefs.has(ref) || ref === npc.sceneId || authoritySpatialRefVisibleTo(state, ref, npc.sceneId, npc.id);
}

export function socialThreadRef(root: string, resolutionId: string): string {
  return `conversation:${canonicalSha256({ root, resolutionId }).slice(7)}`;
}
export function socialClaimRef(root: string, resolutionId: string, branch: string, speaker: "actor" | "npc"): string {
  return `claim:social:${canonicalSha256({ root, resolutionId, branch, speaker }).slice(7)}`;
}
export function hasCommittedSocialExpression(state: AuthoritativeWorldState, event: EventEnvelope<"WorldInteractionResolved">): boolean {
  const audits = Object.values(state.correctionRuntime.audit).filter(audit => audit.rootActionId === event.rootActionId
    && audit.branchId === event.branchId && BigInt(audit.eventSeq) < BigInt(event.eventSeq));
  const lower = audits.filter(audit => audit.eventType === "WorldInteractionResolved")
    .reduce((seq, audit) => BigInt(audit.eventSeq) > seq ? BigInt(audit.eventSeq) : seq, 0n);
  return audits.some(audit => audit.eventType === "SourceClaimCreated" && audit.resolutionId !== undefined
    && BigInt(audit.eventSeq) > lower && ["success", "failure"].some(branch => {
      const ref = socialClaimRef(event.rootActionId, audit.resolutionId!, branch, "actor");
      const source = state.campaignRuntime.sourceClaims[ref];
      return source !== undefined && source.sourceBasis === "frozen-player-expression"
        && audit.payloadHash === canonicalSha256(source);
    }));
}

export function socialListeners(state: AuthoritativeWorldState, actorRef: string, npcRef: string,
  audience: SocialInteractionPlan["audience"]): string[] {
  const actor = state.entities[actorRef], npc = state.entities[npcRef];
  if (!actor || !npc) return [];
  return Object.values(state.entities).filter(entity => entity.tenureStatus === "active"
    && (audience === "sceneListeners" || entity.id === actorRef || entity.id === npcRef)
    && socialParticipantsCoPresent(state, actor, entity) && conditionMechanics(state, entity.id).canHear).map(entity => entity.id).sort();
}

export function socialInteractionIssue(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  root: string, plan: WorldInteractionResolutionPlan, phase: "source" | "execution" = "execution"): string | undefined {
  const social = plan.social;
  if (social === undefined) return undefined;
  if (!socialInteractionPlanConform(social)) return "social:plan-invalid";
  const actor = state.entities[plan.actorCharacterId], npc = state.entities[social.npcRef];
  if (!actor || npc?.kind !== "npc" || npc.tenureStatus !== "active" || !socialParticipantsCoPresent(state, actor, npc)
    || social.threadRef !== socialThreadRef(root, plan.resolutionId) || state.campaignRuntime.conversationThreads?.[social.threadRef]) return "social:participants-or-thread-unavailable";
  if (!conditionMechanics(state, actor.id).canSpeak || !conditionMechanics(state, npc.id).canHear
    || ([social.branches.success, social.branches.failure].some(branch => branch.response.kind === "speech")
      && (!conditionMechanics(state, npc.id).canSpeak || !conditionMechanics(state, actor.id).canHear))) return "social:communication-unavailable";
  if (canonicalSha256(social.listeners) !== canonicalSha256(socialListeners(state, actor.id, npc.id, social.audience))) return "social:listener-set-changed";
  const expected = authoritativeNpcDecisionContext(state, profiles, npc.id);
  // Projection metadata changes during continuation/replay. The exact domain
  // records, catalog and holder bindings are the decision's authority proof.
  const domain = (context: NpcDecisionContext) => ({ npcRef: context.npcRef, knowledgeCatalogRef: context.knowledgeCatalogRef,
    knowledge: context.knowledge, records: context.records });
  if (!expected || canonicalSha256(domain(social.npcContext)) !== canonicalSha256(domain(expected))) return "social:npc-context-changed-or-forged";
  const allowed = new Set([...expected.records.map(record => record.ref), ...expected.knowledge.map(record => record.entryRef)]);
  const reads = new Map(plan.readSet.map(record => [record.ref, record.revisionOrHash]));
  for (const ref of [actor.id, npc.id, `knowledge-catalog:${npc.id}`, `character-timeline:${actor.id}`, ...allowed]) {
    if (!reads.has(ref) || reads.get(ref) !== authorityRevisionOrHash(state, ref)) return "social:decision-read-not-frozen";
  }
  const addressed = social.addressedThreadRef === null ? undefined : state.campaignRuntime.conversationThreads?.[social.addressedThreadRef];
  if (social.addressedThreadRef !== null && (!addressed || addressed.actorCharacterId !== actor.id || addressed.npcCharacterId !== npc.id)) return "social:addressed-thread-unavailable";
  for (const branchName of ["success", "failure"] as const) {
    const branch = social.branches[branchName];
    if (branch.response.basis.some(source => source.kind === "npcContext" && !allowed.has(source.ref))) return "social:foreign-npc-basis";
    for (const source of branch.response.basis) if (source.kind === "materializedKnowledge") {
      if (source.holderRef !== npc.id) return "social:foreign-npc-basis";
      if (phase === "source") continue;
      const factId = worldFactRef(source.definitionRef), fact = state.canonicalFacts[factId];
      const definition = fact && worldFactDefinition(state, fact), held = state.knowledge[npc.id]?.[factId];
      if (!definition || !held || held.objectKind !== "canonicalFact" || held.layer !== "full"
        || canonicalSha256(held.content) !== canonicalSha256(worldFactPointer(definition))) return "social:materialized-knowledge-unavailable";
    }
    for (const [index, consequence] of branch.consequences.entries()) {
      if (consequence.kind === "promiseChange") {
        const source = consequence.expressionSource === "actor" ? actor.id : npc.id;
        const expression = consequence.expressionSource === "actor" ? social.playerExpression : branch.response.text;
        if (consequence.expressionQuote !== expression || (consequence.expressionSource === "npc" && branch.response.kind !== "speech")
          || !reads.has(consequence.promiseRef) || reads.get(consequence.promiseRef) !== authorityRevisionOrHash(state, consequence.promiseRef))
          return "social:promise-change-expression-or-version-unavailable";
        const issue = promiseChangeIssue(state, { promiseId: socialPromiseId(consequence.promiseRef), revision: consequence.revision,
          expressionRef: socialClaimRef(root, plan.resolutionId, branchName, consequence.expressionSource), change: consequence.change },
          { speakerId: source, semanticContent: expression });
        if (issue) return issue;
        continue;
      }
      // The NPC may commit its own conduct/obligation, not another person's.
      if (consequence.kind === "promise" && consequence.promisor === "actor") {
        if (consequence.content !== social.playerExpression || consequence.authorityRefs.length !== 1 || consequence.authorityRefs[0] !== actor.id
          || (actor.kind === "player" && consequence.nextStep !== null)) return "social:player-promise-intent-required";
      } else if (consequence.kind === "promise" && consequence.authorityRefs.some(ref => ref !== npc.id
        && ref !== npc.semanticDefinitionRef && !expected.records.some(record => record.ref === ref && ["self", "identity", "plan"].includes(record.kind)))) return "social:promise-authority-unavailable";
      if (consequence.kind === "promise" && consequence.promiseeRef !== undefined && !social.listeners.includes(consequence.promiseeRef))
        return "social:promise-recipient-unavailable";
      if (consequence.kind === "promise" && promiseTermsRefs(consequence.terms).some(ref =>
        !socialPromiseSubjectAdmissible(state, npc, allowed, ref)
        || !plan.readSet.some(binding => binding.ref === ref && binding.revisionOrHash === authorityRevisionOrHash(state, ref))))
        return "social:promise-terms-context-unavailable";
      if (consequence.kind !== "promise" && consequence.basisFactRefs.some(ref => !allowed.has(ref) || !Object.hasOwn(state.canonicalFacts, ref))) return "social:consequence-basis-unavailable";
      const event = socialConsequenceEvent(root, plan, branchName, index);
      if (socialCommitmentIssue(state, event.eventType, event.payload)) return "social:consequence-invalid";
    }
  }
  return socialRetryIssue(state, plan);
}

/** A validated unconditional prefix may add precisely the knowledge explicitly
 * consumed by this response. It cannot refresh an old NPC decision wholesale. */
export function extendSocialMaterializedContext(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  plan: WorldInteractionResolutionPlan, definitionRefs: readonly string[]): WorldInteractionResolutionPlan | undefined {
  const social = plan.social;
  if (!social) return plan;
  const sources = [...social.branches.success.response.basis, ...social.branches.failure.response.basis]
    .filter((source): source is Extract<SocialEvidence, { kind: "materializedKnowledge" }> => source.kind === "materializedKnowledge");
  if (!sources.length) return plan;
  if (sources.some(source => source.holderRef !== social.npcRef || !definitionRefs.includes(source.definitionRef))) return undefined;
  const factRefs = new Set(definitionRefs.map(worldFactRef));
  for (const ref of factRefs) {
    const fact = state.canonicalFacts[ref], definition = fact && worldFactDefinition(state, fact);
    const held = state.knowledge[social.npcRef]?.[ref];
    if (!definition || !held || held.objectKind !== "canonicalFact" || held.layer !== "full"
      || canonicalSha256(held.content) !== canonicalSha256(worldFactPointer(definition))) return undefined;
  }
  const next = authoritativeNpcDecisionContext(state, profiles, social.npcRef);
  if (!next) return undefined;
  const withoutAdded = (records: NpcDecisionContext["records"]) => records.filter(record => record.kind !== "knowledgeCatalog" && !factRefs.has(record.ref));
  if (canonicalSha256(withoutAdded(next.records)) !== canonicalSha256(withoutAdded(social.npcContext.records))
    || canonicalSha256(next.knowledge.filter(record => !factRefs.has(record.knowledgeRef))) !== canonicalSha256(social.npcContext.knowledge)
    || social.npcContext.knowledge.some(record => factRefs.has(record.knowledgeRef))) return undefined;
  const readSet = new Map(plan.readSet.map(binding => [binding.ref, binding]));
  for (const ref of [...definitionRefs, ...next.records.map(record => record.ref), ...next.knowledge.map(record => record.entryRef)]) {
    const revisionOrHash = authorityRevisionOrHash(state, ref);
    if (revisionOrHash === null) return undefined;
    readSet.set(ref, { ref, revisionOrHash });
  }
  return { ...plan, readSet: [...readSet.values()].sort((a,b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    social: { ...social, npcContext: next } };
}

type SocialDomainDraft = { eventType: SocialCommitmentEventType; payload: EventPayloadByType[SocialCommitmentEventType]; visibilityPolicyId: string; secrecy: "private" };
export function socialConsequenceEvent(root: string, plan: WorldInteractionResolutionPlan, branch: "success" | "failure", index: number): SocialDomainDraft {
  const social = plan.social!, effect = social.branches[branch].consequences[index];
  if (effect.kind === "promiseChange") throw new TypeError("A promise change is not a new social commitment.");
  const identity = canonicalSha256({ root, resolutionId: plan.resolutionId, branch, index }).slice(7);
  const eventType = effect.kind === "relationship" ? "RelationshipChanged" : effect.kind === "promise" ? "PromiseMade" : "DebtIncurred";
  const payload = effect.kind === "relationship"
    ? { relationshipId: effect.relationshipRef ?? `relationship:${identity}`, subjectIds: [plan.actorCharacterId, social.npcRef].sort(), change: effect.change, basisFactIds: [...effect.basisFactRefs].sort() }
    : effect.kind === "promise" ? { promiseId: `promise:${identity}`, promisorId: effect.promisor === "actor" ? plan.actorCharacterId : social.npcRef,
      promiseeId: effect.promiseeRef ?? (effect.promisor === "actor" ? social.npcRef : plan.actorCharacterId), content: effect.content, condition: effect.condition }
    : { debtId: `debt:${identity}`, debtorId: social.npcRef, creditorId: plan.actorCharacterId, obligation: effect.obligation, condition: effect.condition, basisFactIds: [...effect.basisFactRefs].sort() };
  return { eventType, payload, visibilityPolicyId: socialCommitmentPolicy(eventType), secrecy: "private" };
}

function socialMethod(plan: WorldInteractionResolutionPlan): string {
  return socialMethodFingerprint(plan.ruling.kind === "check" ? plan.ruling.check
    : { ability: "charisma", skill: null, method: plan.method });
}
export function socialRetryIssue(state: AuthoritativeWorldState, plan: WorldInteractionResolutionPlan): string | undefined {
  const social = plan.social!;
  if (plan.ruling.kind !== "check") return undefined;
  const prior = Object.values(state.campaignRuntime.conversationThreads ?? {}).filter(thread => thread.actorCharacterId === plan.actorCharacterId
    && thread.npcCharacterId === social.npcRef && thread.outcome === "failure"
    && (thread.threadRef === social.addressedThreadRef || thread.goalFingerprint === socialUtteranceFingerprint(social.goal)
      || thread.utteranceFingerprint === socialUtteranceFingerprint(social.playerExpression)))
    .sort((a, b) => BigInt(String(a.resolvedEventSeq ?? "0")) > BigInt(String(b.resolvedEventSeq ?? "0")) ? -1 : 1)[0];
  if (!prior) return social.retryChange === null ? undefined : "social:retry-prior-unavailable";
  const change = social.retryChange;
  if (!change || change.priorThreadRef !== prior.threadRef || social.addressedThreadRef !== prior.threadRef
    || !isRecord(prior.retryBaseline)) return "social:unchanged-retry";
  const baseline = prior.retryBaseline;
  if (change.kind === "method") return change.basisRefs.length === 0 && socialMethod(plan) !== baseline.methodFingerprint ? undefined : "social:unchanged-retry";
  if (change.kind === "cost") return "social:retry-cost-not-established";
  if (!Array.isArray(baseline.bindings) || change.basisRefs.length === 0) return "social:retry-context-insufficient";
  const old = new Map(baseline.bindings.filter(isRecord).map(binding => [binding.ref, binding.revisionOrHash]));
  return change.basisRefs.every(ref => old.has(ref) && ![plan.actorCharacterId, social.npcRef].includes(ref)
    && !ref.startsWith("character-timeline:") && !ref.startsWith("knowledge-catalog:")
    && authorityRevisionOrHash(state, ref) !== null && old.get(ref) !== authorityRevisionOrHash(state, ref)) ? undefined : "social:unchanged-retry";
}

export type SocialConversationRecord = JsonRecord & {
  schema: "zhuwei.social-conversation/vnext-1"; threadRef: string; rootActionId: string; resolutionId: string;
  actorCharacterId: string; npcCharacterId: string; claimRef: string; responseClaimRef: string | null;
  sourceSceneId: string; goal: string; method: string; outcome: "success" | "failure"; updatedByEventId: string;
};
export function socialConversationRecordConform(value: unknown): value is SocialConversationRecord {
  return isRecord(value) && hasExactKeys(value, ["schema", "threadRef", "rootActionId", "resolutionId", "resolvedEventSeq",
    "actorCharacterId", "npcCharacterId", "sourceSceneId", "playerExpression", "goal", "method", "addressedThreadRef",
    "goalFingerprint", "utteranceFingerprint", "outcome", "status", "claimRef", "responseClaimRef", "updatedByEventId", "retryBaseline"])
    && value.schema === "zhuwei.social-conversation/vnext-1"
    && [value.threadRef, value.rootActionId, value.resolutionId, value.actorCharacterId, value.npcCharacterId, value.sourceSceneId,
      value.playerExpression, value.goal, value.method, value.claimRef, value.updatedByEventId].every(isNonEmptyString)
    && value.actorCharacterId !== value.npcCharacterId && value.status === "resolved"
    && (value.outcome === "success" || value.outcome === "failure")
    && typeof value.resolvedEventSeq === "string" && /^[1-9][0-9]*$/u.test(value.resolvedEventSeq)
    && (value.addressedThreadRef === null || isNonEmptyString(value.addressedThreadRef))
    && (value.responseClaimRef === null || isNonEmptyString(value.responseClaimRef))
    && value.goalFingerprint === socialUtteranceFingerprint(String(value.goal))
    && value.utteranceFingerprint === socialUtteranceFingerprint(String(value.playerExpression))
    && isRecord(value.retryBaseline) && hasExactKeys(value.retryBaseline, ["methodFingerprint", "bindings", "fictionMicros"])
    && isNonEmptyString(value.retryBaseline.methodFingerprint)
    && typeof value.retryBaseline.fictionMicros === "string" && /^(0|[1-9][0-9]*)$/u.test(value.retryBaseline.fictionMicros)
    && Array.isArray(value.retryBaseline.bindings) && value.retryBaseline.bindings.every(binding => isRecord(binding)
      && hasExactKeys(binding, ["ref", "revisionOrHash"]) && isNonEmptyString(binding.ref)
      && (binding.revisionOrHash === null || isNonEmptyString(binding.revisionOrHash)))
    && new Set(value.retryBaseline.bindings.map(binding => binding.ref)).size === value.retryBaseline.bindings.length;
}
export function socialConversationRecord(state: AuthoritativeWorldState, event: EventEnvelope<"WorldInteractionResolved">): SocialConversationRecord {
  const plan = event.payload.social!.plan, social = plan.social!;
  return { schema: "zhuwei.social-conversation/vnext-1", threadRef: social.threadRef, rootActionId: event.rootActionId,
    resolutionId: plan.resolutionId, resolvedEventSeq: event.eventSeq, actorCharacterId: plan.actorCharacterId, npcCharacterId: social.npcRef,
    sourceSceneId: plan.sceneRef, playerExpression: social.playerExpression, goal: social.goal, method: plan.method,
    addressedThreadRef: social.addressedThreadRef, goalFingerprint: socialUtteranceFingerprint(social.goal),
    utteranceFingerprint: socialUtteranceFingerprint(social.playerExpression), outcome: event.payload.branch,
    status: "resolved", claimRef: socialClaimRef(event.rootActionId, plan.resolutionId, event.payload.branch, "actor"),
    responseClaimRef: social.branches[event.payload.branch].response.kind === "silence" ? null : socialClaimRef(event.rootActionId, plan.resolutionId, event.payload.branch, "npc"),
    updatedByEventId: event.eventId,
    retryBaseline: { methodFingerprint: socialMethod(plan), bindings: plan.readSet.map(binding => ({ ref: binding.ref,
      revisionOrHash: authorityRevisionOrHash(state, binding.ref) })), fictionMicros: state.fictionTimelines[characterTimelineId(state, plan.actorCharacterId)!].nowMicros } };
}

export type SocialInteractionDraft = SocialDomainDraft
  | { eventType: "PromiseChanged"; payload: EventPayloadByType["PromiseChanged"]; visibilityPolicyId: string; secrecy: "internal" }
  | { eventType: "CanonicalFactDeclared"; payload: EventPayloadByType["CanonicalFactDeclared"]; visibilityPolicyId: string; secrecy: "internal" }
  | { eventType: "NpcWorkProposed"; payload: EventPayloadByType["NpcWorkProposed"]; visibilityPolicyId: string; secrecy: "private" }
  | { eventType: "PromiseTermsEstablished"; payload: EventPayloadByType["PromiseTermsEstablished"]; visibilityPolicyId: string; secrecy: "internal" }
  | { eventType: "SourceClaimCreated"; payload: EventPayloadByType["SourceClaimCreated"]; visibilityPolicyId: string; secrecy: "private" }
  | { eventType: "KnowledgeAcquired"; payload: EventPayloadByType["KnowledgeAcquired"]; visibilityPolicyId: string; secrecy: "private" };

/** A generator lets both execution and fold bind each acquisition to the
 * actual source event that has just been appended/verified. */
export function* socialInteractionDrafts(state: AuthoritativeWorldState, root: string, plan: WorldInteractionResolutionPlan,
  branch: "success" | "failure", sourceEventId: (claimRef: string) => string): Generator<SocialInteractionDraft> {
  const social = plan.social!, response = social.branches[branch].response;
  const timelineId = characterTimelineId(state, plan.actorCharacterId)!;
  const speeches = [{ speaker: "actor" as const, speakerId: plan.actorCharacterId, content: social.playerExpression,
    sourceBasis: "frozen-player-expression", motive: "player-authored-intent" },
    ...(response.kind === "silence" ? [] : [{ speaker: "npc" as const, speakerId: social.npcRef, content: response.text,
      sourceBasis: JSON.stringify(response.basis), motive: response.motive }])];
  for (const speech of speeches) {
    const claimRef = socialClaimRef(root, plan.resolutionId, branch, speech.speaker);
    yield { eventType: "SourceClaimCreated", payload: { speakerId: speech.speakerId, claimId: claimRef,
      semanticContent: speech.content, sourceBasis: speech.sourceBasis, motive: speech.motive,
      formedAtFictionMicros: state.fictionTimelines[timelineId].nowMicros }, visibilityPolicyId: `visibility:knowledge-holder:${speech.speakerId}`, secrecy: "private" };
    for (const recipient of social.listeners.filter(ref => ref !== speech.speakerId)) {
      yield { eventType: "KnowledgeAcquired", payload: { characterId: recipient, sourceCharacterId: speech.speakerId,
        medium: "spokenConversation", contentLayer: "full", items: [{ knowledgeRef: claimRef, objectKind: "sourceClaim",
          content: speech.content, provenanceChain: [claimRef, sourceEventId(claimRef)].sort() }] },
        visibilityPolicyId: `visibility:knowledge-holder:${recipient}`, secrecy: "private" };
    }
  }
  for (let index = 0; index < social.branches[branch].consequences.length; index++) {
    const consequence = social.branches[branch].consequences[index];
    if (consequence.kind === "promiseChange") {
      const promise = structuredClone(state.campaignRuntime.promises[socialPromiseId(consequence.promiseRef)]);
      applyPromiseChange(promise, consequence.change, { eventId: root, at: state.fictionTimelines[promiseLifecycle(promise)!.timelineId].nowMicros,
        expressionRef: socialClaimRef(root, plan.resolutionId, branch, consequence.expressionSource) });
      yield { eventType: "PromiseChanged", payload: { promiseId: socialPromiseId(consequence.promiseRef), revision: consequence.revision,
        expressionRef: socialClaimRef(root, plan.resolutionId, branch, consequence.expressionSource), change: structuredClone(consequence.change) },
        visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" };
      if (consequence.change.accepted) {
        const factId = `promise-change:${root}:${plan.resolutionId}:${branch}:${index}`;
        yield { eventType: "CanonicalFactDeclared", payload: { fact: { id: factId, kind: "promiseTermsResult",
          subjectRefs: [String(promise.promisorId), String(promise.promiseeId)], value: promiseChangeSnapshot(promise, consequence.change),
          source: "mechanicalResolution", causalParentIds: [], visibilityPolicyId: "visibility:hidden-until-evidence" } },
          visibilityPolicyId: "visibility:hidden-until-evidence", secrecy: "internal" };
        if (consequence.disclose) for (const recipient of social.listeners) yield {
          eventType: "KnowledgeAcquired", payload: { characterId: recipient, knowledgeRef: factId, objectKind: "canonicalFact", layer: "full",
            content: promiseChangeDescription(promise, consequence.change), causeFactId: factId,
            acquisition: { sense: "hearing", sceneId: plan.sceneRef, method: "当面听到并理解此次约定的变更。" }, visibility: "private" },
          visibilityPolicyId: `visibility:knowledge-holder:${recipient}`, secrecy: "private" };
      }
      continue;
    }
    const draft = socialConsequenceEvent(root, plan, branch, index);
    yield draft;
    if (consequence.kind === "promise" && "promiseId" in draft.payload) {
      const duration = promiseDueDurationMicros(state, timelineId, consequence.due);
      const now = state.fictionTimelines[timelineId].nowMicros;
      yield { eventType: "PromiseTermsEstablished", payload: { promiseId: draft.payload.promiseId,
        originalExpressionRef: socialClaimRef(root, plan.resolutionId, branch, consequence.promisor === "actor" ? "actor" : "npc"), terms: structuredClone(consequence.terms),
        timelineId, fromFictionMicros: now, deadlineFictionMicros: duration === undefined ? null : (BigInt(now) + BigInt(duration)).toString() },
        visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal" };
      // An NPC action promise needs a decision even before it has selected a
      // method. Queue only that deliberation; no effect or duration is inferred.
      const requiresDecision = consequence.promisor !== "actor" && (consequence.terms.kind !== "ongoing"
        || consequence.terms.parts?.some(part => part.kind !== "ongoing"));
      if (consequence.nextStep !== null || requiresDecision) yield { eventType: "NpcWorkProposed", payload: {
        planId: npcWorkId(draft.payload.promiseId), promiseId: draft.payload.promiseId, npcId: draft.payload.promisorId,
        nextStep: consequence.nextStep ?? consequence.content },
        visibilityPolicyId: `visibility:knowledge-holder:${draft.payload.promisorId}`, secrecy: "private" };
    }
  }
}

export function socialDraftScope(state: AuthoritativeWorldState, draft: SocialInteractionDraft, root: string) {
  const payload = draft.payload as JsonRecord;
  const refs = draft.eventType === "SourceClaimCreated" ? [`claim:${payload.claimId}`, `knowledge:${payload.speakerId}:${payload.claimId}`]
    : draft.eventType === "NpcWorkProposed" ? [`npc-plan:${payload.planId}`]
    : draft.eventType === "KnowledgeAcquired" ? (Array.isArray(payload.items) ? payload.items as { knowledgeRef: string }[] : [{ knowledgeRef: String(payload.knowledgeRef) }]).map(item => `knowledge:${payload.characterId}:${item.knowledgeRef}`)
    : draft.eventType === "RelationshipChanged" ? [`relationship:${payload.relationshipId}`]
    : draft.eventType === "CanonicalFactDeclared" ? [`fact:${(payload.fact as JsonRecord).id}`]
    : ["PromiseMade", "PromiseTermsEstablished", "PromiseChanged"].includes(draft.eventType) ? [`promise:${payload.promiseId}`] : [`debt:${payload.debtId}`];
  const creates = ["PromiseTermsEstablished", "PromiseChanged"].includes(draft.eventType) || (draft.eventType === "RelationshipChanged" && state.campaignRuntime.relationships[String(payload.relationshipId)]) ? [] : refs;
  return { writes: [...refs, `receipt:${root}`], creates };
}

/** The ledger stores hashes rather than private payloads. Match the unique
 * first utterance, then each actual child event in order; no earlier sibling
 * or similarly named current record can stand in for this settlement. */
export function verifySocialSettlement(state: AuthoritativeWorldState, profiles: RuntimeProfileManifest,
  event: EventEnvelope<"WorldInteractionResolved">, frozenSourcePlan?: WorldInteractionResolutionPlan,
  frozenAtomicPlan?: AtomicWorldInteractionStepsPlan,
  candidate = false): string | Readonly<{ firstEventSeq: string; prefixProven: boolean }> {
  const plan = event.payload.social?.plan;
  if (!plan?.social) return "social:settlement-plan-missing";
  const audits = Object.values(state.correctionRuntime.audit).filter(entry => entry.branchId === event.branchId
    && BigInt(entry.eventSeq) < BigInt(event.eventSeq)).sort((a, b) => BigInt(a.eventSeq) < BigInt(b.eventSeq) ? -1 : 1);
  const prior = audits.filter(entry => entry.rootActionId === event.rootActionId && entry.eventType === "WorldInteractionResolved").at(-1);
  const lower = BigInt(prior?.eventSeq ?? "0");
  const firstDraft = socialInteractionDrafts(state, event.rootActionId, plan, event.payload.branch, () => { throw new TypeError("social:source-not-yet-matched"); }).next().value;
  if (!firstDraft) return "social:first-utterance-missing";
  const first = audits.filter(entry => BigInt(entry.eventSeq) > lower && entry.rootActionId === event.rootActionId
    && entry.eventType === firstDraft.eventType && entry.payloadHash === canonicalSha256(firstDraft.payload));
  if (first.length !== 1) return "social:first-utterance-not-committed";
  const suffix = audits.filter(entry => BigInt(entry.eventSeq) >= BigInt(first[0].eventSeq));
  if (suffix.some(entry => entry.rootActionId !== event.rootActionId)) return "social:non-atomic-domain-suffix";
  const before = domainStateBeforeAuditRange(state, first[0].eventSeq);
  let prefixProven = false;
  // The server's discardable candidate fold checks the complete social suffix
  // below but cannot certify uncommitted planning dice. Its return is never a
  // public prefix proof; every published fold calls this again without it.
  if (!candidate && frozenSourcePlan && (frozenAtomicPlan !== undefined
    || canonicalSha256(frozenSourcePlan) !== canonicalSha256(plan))) {
    const refs = [...new Set(Object.values(frozenSourcePlan.social?.branches ?? {}).flatMap(branch => branch.response.basis
      .flatMap(source => source.kind === "materializedKnowledge" ? [source.definitionRef] : [])))];
    const afterPrefix = frozenAtomicPlan === undefined ? undefined
      : rebindFrozenSocialPrefix(state, profiles, frozenAtomicPlan, frozenSourcePlan, event.payload.branch, first[0].eventSeq);
    if (frozenAtomicPlan !== undefined && afterPrefix === undefined) return "social:accepted-cost-prefix-not-proven";
    prefixProven = afterPrefix !== undefined;
    const expanded = extendSocialMaterializedContext(before, profiles, afterPrefix ?? frozenSourcePlan, refs);
    // The replay reconstruction has a different projection envelope/version.
    // Every domain record, holder hash, branch and read binding remains exact.
    const domainPlan = (p: WorldInteractionResolutionPlan) => ({ ...p, social: p.social && { ...p.social,
      npcContext: { ...p.social.npcContext, projectionHash: null } } });
    if ((!refs.length && afterPrefix === undefined) || !expanded || canonicalSha256(domainPlan(expanded)) !== canonicalSha256(domainPlan(plan))) return "social:frozen-source-plan-changed";
  }
  const issue = socialInteractionIssue(before, profiles, event.rootActionId, plan);
  if (issue) return issue;
  const sourceIds = new Map<string, string>();
  let index = 0;
  for (const draft of socialInteractionDrafts(before, event.rootActionId, plan, event.payload.branch, ref => {
    const id = sourceIds.get(ref); if (!id) throw new TypeError("social:source-not-committed"); return id;
  })) {
    const actual = suffix[index++];
    if (!actual || actual.eventType !== draft.eventType || actual.payloadHash !== canonicalSha256(draft.payload)) return "social:domain-events-do-not-match";
    if (draft.eventType === "SourceClaimCreated") sourceIds.set(draft.payload.claimId, actual.eventId);
  }
  return index === suffix.length ? { firstEventSeq: first[0].eventSeq, prefixProven } : "social:unexpected-domain-events";
}
