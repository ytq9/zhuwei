import {
  canonicalClone,
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
  isNonEmptyString,
  isPlainRecord,
} from "./canonical-json";
import {
  lowerVNextCoarseFormProposal,
  selectPlanReadSet,
  VNEXT_KP_PROPOSAL_SCHEMA,
  VNEXT_MATERIALIZATION_FORM_ID,
  VNEXT_WORLD_INTERACTION_FORM_ID,
  type VNextProposalLoweringResult,
  type VNextWorldInteractionBranchProposal,
} from "./proposals";
import {
  requiredContextAuthorityRefs,
  requiredContextReadRefs,
  requiredContextViewerRefs,
} from "./required-context-runtime";
import type { VNextRequiredContext } from "./required-context";
import {
  itemEntryResourceId,
  type JsonRecord,
  type AuthoritativeWorldState,
} from "../../rules/authority-read";
import {
  isWorldDamageProfileRef,
  type WorldDamageProfileRef,
} from "../../rules/profiles/world-interaction-registry";

/**
 * The model-facing contract for a future multi-Form action.  Room supplies the
 * RootAction, actor, profile and context binding; none of those authority
 * identifiers are accepted from the model here.
 */
export const VNEXT_PROPOSAL_BUNDLE_SCHEMA =
  "zhuwei.kp-proposal-bundle/vnext-1" as const;
export const VNEXT_CLARIFICATION_FORM_ID = "clarification.vnext-1" as const;
export const VNEXT_IN_WORLD_REFUSAL_FORM_ID = "in-world-refusal.vnext-1" as const;

export const VNEXT_BUNDLE_FORM_IDS = Object.freeze([
  VNEXT_CLARIFICATION_FORM_ID,
  VNEXT_IN_WORLD_REFUSAL_FORM_ID,
  VNEXT_MATERIALIZATION_FORM_ID,
  VNEXT_WORLD_INTERACTION_FORM_ID,
] as const);

const MAX_BUNDLE_PROPOSALS = 16;
const MAX_REFS = 64;
const MAX_CHOICES = 4;
const MAX_PREREQUISITES = 8;
const MAX_NEXT_ACTIONS = 8;
const LOCAL_HANDLE_PATTERN = /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LOCAL_PROPOSAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/u;

export type VNextBundleFormId = typeof VNEXT_BUNDLE_FORM_IDS[number];
export type VNextOutcomeBinding = "always" | "onSuccess" | "onFailure";

export type VNextBundleReference = Readonly<
  | { kind: "existing"; ref: string }
  | { kind: "prospective"; handle: string }
>;

export type VNextBundleProducedReference = Readonly<{
  handle: string;
  kind: "semanticDefinition" | "canonicalFact" | "relation" | "itemEntry";
  outcomeBinding: VNextOutcomeBinding;
}>;

export type VNextAttemptCost = Readonly<
  | { kind: "fictionTime"; durationMicros: string }
  | {
      kind: "item";
      entryRef: string;
      quantity: number;
      charges: number;
      durability: number;
    }
  | { kind: "resource"; resourceId: string; amount: number }
>;

export type VNextCheckParameters = Readonly<{
  checkKind: "abilityCheck" | "attack";
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha";
  skill: string | null;
  dc: number;
  mode: "normal" | "advantage" | "disadvantage";
}>;

export type VNextDirectSuccessRuling = Readonly<{
  kind: "directSuccess";
  risk: string;
  successOutcome: string;
  failureOutcome: string;
}>;

export type VNextCheckRuling = VNextCheckParameters & Readonly<{
  kind: "check";
  risk: string;
  successOutcome: string;
  failureOutcome: string;
}>;

/**
 * High risk is deliberately not represented as a fake high DC check.  The
 * model can describe the possible check and the costs, but Room must supply a
 * separate trusted confirmation before any executable command can be made.
 */
export type VNextHighRiskRuling = Readonly<{
  kind: "highRisk";
  risk: string;
  confirmationQuestion: string;
  successOutcome: string;
  failureOutcome: string;
  check: VNextCheckParameters | null;
  acceptedCosts: readonly VNextAttemptCost[];
}>;

export type VNextPrerequisite = Readonly<{
  kind: "tool" | "knowledge" | "position" | "permission" | "condition";
  ref: string | null;
  description: string;
}>;

export type VNextNextAction = Readonly<{
  description: string;
  basisRefs: readonly string[];
}>;

export type VNextRefusalRuling = Readonly<{
  kind: "missingPrerequisite" | "worldLawViolation";
  publicBasis: string;
  prerequisites: readonly VNextPrerequisite[];
  nextActions: readonly VNextNextAction[];
  /** Costs that really occurred while trying, not costs for a hypothetical retry. */
  attemptCosts: readonly VNextAttemptCost[];
}>;

export type VNextFeasibilityRuling =
  | VNextDirectSuccessRuling
  | VNextCheckRuling
  | VNextHighRiskRuling
  | VNextRefusalRuling;

export type VNextClarificationChoice = Readonly<{
  choiceId: string;
  label: string;
  publicRisk: string;
  basisRefs: readonly string[];
}>;

export type VNextClarificationProposal = Readonly<{
  kind: "clarification";
  intent: string;
  method: string;
  question: string;
  choices: readonly VNextClarificationChoice[];
}>;

export type VNextInWorldRefusalProposal = Readonly<{
  kind: "inWorldRefusal";
  intent: string;
  method: string;
}>;

export type VNextBundleSemanticRevisionProposal = Readonly<{
  kind: "reviseSemanticDefinition";
  definitionRef: string;
  semanticKind: "npc";
  npcRef: string;
  baseRevision: string;
  baseHash: string;
  templateRef: string;
  templateHash: string;
  operations: readonly Readonly<Record<string, unknown>>[];
  summary: string;
}>;

/**
 * Creates a new scene object from a sparse semantic source, exactly like
 * VNextBundleSemanticRevisionProposal creates no mechanical state. Rules
 * derives the committed definitionRef and the bundle-local `produces` handle
 * this entry declares is how the rest of the Bundle may address it before it
 * exists -- see the `prospective:` handle convention on VNextBundleReference.
 */
export type VNextBundleMaterializedObjectDefinition = Readonly<{
  /** Required for sceneFeature; must be null for worldFact. */
  sceneRef: string | null;
  /** Required only by hidden-until-evidence visibility. */
  visibilityFactId: string | null;
  label: string;
  description: string;
  observableState: string;
  affordances: readonly string[];
  mechanicDefinitionRefs: readonly string[];
}>;

export type VNextBundleMaterializeObjectProposal = Readonly<{
  kind: "materializeObject";
  semanticKind: "sceneFeature" | "worldFact";
  templateRef: string;
  templateHash: string;
  visibilityPolicyRef: string;
  definition: VNextBundleMaterializedObjectDefinition;
  summary: string;
}>;

export type VNextBundleWorldInteractionProposal = Readonly<{
  kind: "worldInteraction";
  sceneRef: string;
  targetRefs: readonly string[];
  directTargetRefs: readonly string[];
  instrumentRefs: readonly string[];
  abilityRef: string | null;
  intent: string;
  method: string;
  branches: Readonly<{
    success: VNextWorldInteractionBranchProposal;
    failure: VNextWorldInteractionBranchProposal;
  }>;
}>;

export type VNextBundleFormProposal =
  | VNextClarificationProposal
  | VNextInWorldRefusalProposal
  | VNextBundleSemanticRevisionProposal
  | VNextBundleMaterializeObjectProposal
  | VNextBundleWorldInteractionProposal;

type VNextBundleEntryBase = Readonly<{
  proposalRef: string;
  basisRefs: readonly string[];
  consumes: readonly VNextBundleReference[];
  produces: readonly VNextBundleProducedReference[];
  outcomeBinding: VNextOutcomeBinding;
  ruling: VNextFeasibilityRuling;
}>;

export type VNextProposalBundleEntry = VNextBundleEntryBase & Readonly<{
  formId: VNextBundleFormId;
  proposal: VNextBundleFormProposal;
}>;

export type VNextProposalBundle = Readonly<{
  schema: typeof VNEXT_PROPOSAL_BUNDLE_SCHEMA;
  kind: "proposalBundle";
  proposals: readonly VNextProposalBundleEntry[];
}>;

export type VNextProposalBundleValidationResult =
  | Readonly<{ kind: "accepted"; bundle: VNextProposalBundle }>
  | Readonly<{
      kind: "rejected";
      code: "PROPOSAL_BUNDLE_INVALID" | "BUNDLE_DEPENDENCY_INVALID";
      issues: readonly string[];
    }>;

/**
 * The only command emitted by Bundle lowering.  Pending/refusal commands are
 * intentionally not shaped as Rules input: their Room/Rules event consumers
 * are a separate integration seam and must validate them before committing.
 */
export type VNextProposalBundleCommand =
  | Readonly<{
      kind: "rulesStep";
      rootActionId: string;
      actorCharacterId: string;
      formId: typeof VNEXT_MATERIALIZATION_FORM_ID | typeof VNEXT_WORLD_INTERACTION_FORM_ID;
      proposalRef: string;
      ruling: "directSuccess" | "check";
      rulesInput: JsonRecord;
    }>
  | Readonly<{
      kind: "pendingClarification";
      rootActionId: string;
      actorCharacterId: string;
      proposalRef: string;
      pendingInputId: string;
      question: string;
      choices: readonly Readonly<{
        choiceId: string;
        label: string;
        publicRisk: string;
        basisRefs: readonly string[];
      }>[];
    }>
  | Readonly<{
      kind: "inWorldRefusal";
      rootActionId: string;
      actorCharacterId: string;
      proposalRef: string;
      formId: typeof VNEXT_IN_WORLD_REFUSAL_FORM_ID;
      intent: string;
      method: string;
      ruling: VNextRefusalRuling;
      basisRefs: readonly string[];
    }>
  | Readonly<{
      /** A confirmed high-risk ruling awaits the dedicated Rules primitive. */
      kind: "highRiskConfirmed";
      rootActionId: string;
      actorCharacterId: string;
      proposalRef: string;
      formId: VNextBundleFormId;
      ruling: VNextHighRiskRuling;
      basisRefs: readonly string[];
      confirmationId: string;
    }>
  | Readonly<{
      /**
       * One atomic multi-Form execution derived from a bundle whose entries
       * form a produces/consumes dependency graph. `steps` is ordered so
       * every dependency precedes its dependents; each steps dependsOn
       * repeats that ordering by proposalRef. This command carries the
       * whole set for exactly one Rules transaction and one Receipt -- the
       * Room/Rules consumer that turns it into that single transaction is a
       * separate integration seam (task 4: bundleCommandToRoomLowering in
       * room-bridge.ts) and must validate every step before committing any
       * of them.
       */
      kind: "atomicRulesSteps";
      rootActionId: string;
      actorCharacterId: string;
      /** Hash of the canonical model-authored Bundle before server lowering. */
      bundleHash: string;
      /** Frozen RequiredContext hash shared by every lowered child plan. */
      contextHash: string;
      /** Every entry is bound to this one frozen adjudication result. */
      sharedRuling: "directSuccess" | "check";
      steps: readonly Readonly<{
        formId: typeof VNEXT_MATERIALIZATION_FORM_ID | typeof VNEXT_WORLD_INTERACTION_FORM_ID;
        proposalRef: string;
        ruling: "directSuccess" | "check";
        rulesInput: JsonRecord;
        dependsOn: readonly string[];
        consumes: readonly VNextBundleReference[];
        produces: readonly VNextBundleProducedReference[];
        outcomeBinding: VNextOutcomeBinding;
      }>[];
    }>;

/** One entry of atomicRulesSteps.steps on VNextProposalBundleCommand. */
export type VNextAtomicRulesStep =
  Extract<VNextProposalBundleCommand, { kind: "atomicRulesSteps" }>["steps"][number];

export type VNextHighRiskConfirmation = Readonly<{
  kind: "highRiskConfirmation";
  confirmationId: string;
  rootActionId: string;
  contextHash: string;
  proposalRef: string;
  rulingHash: string;
}>;

export type VNextProposalBundleLoweringInput = Readonly<{
  value: unknown;
  requiredContext: VNextRequiredContext;
  state: AuthoritativeWorldState;
  rootActionId: string;
  actorCharacterId: string;
  highRiskConfirmation?: VNextHighRiskConfirmation;
}>;

export type VNextProposalBundleLoweringResult =
  | Readonly<{ kind: "accepted"; command: VNextProposalBundleCommand }>
  | Readonly<{
      kind: "rejected";
      code:
        | "PROPOSAL_BUNDLE_INVALID"
        | "PROPOSAL_FORM_INVALID"
        | "PROPOSAL_REFERENCE_INVALID"
        | "DEFINITION_CONFLICT"
        | "BUNDLE_DEPENDENCY_INVALID"
        | "BUNDLE_LOWERING_UNSUPPORTED"
        | "CONTEXT_INSUFFICIENT"
        | "COST_INVALID";
      issues: readonly string[];
    }>;

/** Main seams for the parent Room integration.  No Room state is mutated here. */
export const VNEXT_PROPOSAL_BUNDLE_INTEGRATION_SEAMS = Object.freeze([
  "Room.prepare freezes RequiredContext and supplies rootActionId/actorCharacterId.",
  "Room calls lowerVNextProposalBundle before the first Rules random or cost.",
  "rulesStep.rulesInput is the only command currently accepted by the existing Rules step seam.",
  "pendingClarification must become a private PendingInput through the existing Rules/Room pending-input seam.",
  "inWorldRefusal must become a FeasibilityRuled plus optional validated attempt-cost transition through Rules step.",
  "highRiskConfirmed needs a dedicated high-risk confirmation/Rules primitive before execution.",
  "atomicRulesSteps.steps is the ordered atomic multi-Form execution; Room/Rules must turn it into exactly one Rules transaction and one Receipt (task 4 seam).",
  "After commit, the existing project(viewer, committedRange) to FrozenRenderableClaims seam owns narration.",
] as const);

export function validateVNextProposalBundle(
  value: unknown,
): VNextProposalBundleValidationResult {
  try {
    if (!isPlainRecord(value)
      || !exactKeys(value, ["schema", "kind", "proposals"])
      || value.schema !== VNEXT_PROPOSAL_BUNDLE_SCHEMA
      || value.kind !== "proposalBundle"
      || !Array.isArray(value.proposals)
      || value.proposals.length === 0
      || value.proposals.length > MAX_BUNDLE_PROPOSALS) {
      throw new TypeError("bundle:envelope-invalid");
    }
    const entries = value.proposals.map((entry) => validateEntry(entry));
    const refs = entries.map((entry) => entry.proposalRef);
    if (new Set(refs).size !== refs.length) throw new TypeError("bundle:proposal-ref-duplicate");
    if (entries.length > 1) {
      const sharedRulingHash = canonicalHash(entries[0]!.ruling);
      if (entries.some((entry) => canonicalHash(entry.ruling) !== sharedRulingHash)) {
        throw new TypeError("bundle:shared-ruling-mismatch");
      }
    }

    const producers = new Map<string, VNextBundleProducedReference>();
    for (const entry of entries) {
      for (const produced of entry.produces) {
        if (producers.has(produced.handle)) {
          throw new TypeError(`bundle:prospective-producer-duplicate:${produced.handle}`);
        }
        producers.set(produced.handle, produced);
      }
    }
    for (const entry of entries) {
      for (const consumed of entry.consumes) {
        if (consumed.kind !== "prospective") continue;
        const producer = producers.get(consumed.handle);
        if (producer === undefined) {
          throw new TypeError(`bundle:prospective-consumer-unbound:${consumed.handle}`);
        }
        if (!outcomeDominates(producer.outcomeBinding, entry.outcomeBinding)) {
          throw new TypeError(`bundle:prospective-condition-not-dominated:${consumed.handle}`);
        }
      }
    }
    assertAcyclicDependencies(entries, producers);

    const normalized = canonicalClone({
      schema: VNEXT_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle",
      proposals: entries,
    }) as VNextProposalBundle;
    return Object.freeze({ kind: "accepted", bundle: deepFreeze(normalized) });
  } catch (error) {
    const message = issue(error);
    return Object.freeze({
      kind: "rejected",
      code: isDependencyIssue(message) ? "BUNDLE_DEPENDENCY_INVALID" : "PROPOSAL_BUNDLE_INVALID",
      issues: Object.freeze([message]),
    });
  }
}

/**
 * Lowers only commands for which an existing consumer is known.  A pending
 * or refusal result is still a successful semantic lowering, but is returned
 * as a typed command and never as an invented Rules input.  A bundle of more
 * than one entry lowers only when every entry is independently executable;
 * see lowerAtomicMultiStep for the ordering and dependency rules.
 */
export function lowerVNextProposalBundle(
  input: VNextProposalBundleLoweringInput,
): VNextProposalBundleLoweringResult {
  try {
    const validated = validateVNextProposalBundle(input.value);
    if (validated.kind === "rejected") return validated;
    if (!isNonEmptyString(input.rootActionId)
      || !isNonEmptyString(input.actorCharacterId)
      || input.requiredContext.binding.rootActionId !== input.rootActionId
      || input.requiredContext.intent.actorRef !== input.actorCharacterId) {
      return rejected("CONTEXT_INSUFFICIENT", ["bundle:context-binding-mismatch"]);
    }
    const entries = validated.bundle.proposals;
    const authorityRefs = requiredContextAuthorityRefs(input.requiredContext);
    const readRefs = requiredContextReadRefs(input.requiredContext);
    for (const entry of entries) {
      // A `prospective:` handle names something this same Bundle is about to
      // materialize, never a pre-existing authority ref; it cannot appear in
      // RequiredContext and so is exempt from both checks below. Whether the
      // handle actually has a producer in this Bundle is validated above by
      // validateVNextProposalBundle and, defensively, by Rules' own atomic
      // compiler -- never by this authority/read-set gate.
      const refs = entryRefs(entry).filter((ref) => !isLocalHandle(ref));
      if (refs.some((ref) => !authorityRefs.has(ref))) {
        return rejected("PROPOSAL_REFERENCE_INVALID", ["bundle:ref-not-authorized"]);
      }
      if (refs.some((ref) => !readRefs.has(ref))) {
        return rejected("PROPOSAL_REFERENCE_INVALID", ["bundle:ref-not-read-bound"]);
      }
    }
    // A lone worldInteraction can never legitimately reference a prospective
    // handle: nothing in a one-entry bundle could ever have produced it, so
    // this closes the single-entry path off from the atomic-only convention
    // before it ever reaches Rules.
    if (entries.length === 1
      && entries[0]!.proposal.kind === "worldInteraction"
      && [...entries[0]!.proposal.targetRefs, ...entries[0]!.proposal.directTargetRefs]
        .some((ref) => isLocalHandle(ref))) {
      return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle:prospective-ref-requires-atomic-bundle"]);
    }
    const bundleHash = canonicalHash({
      schema: VNEXT_PROPOSAL_BUNDLE_SCHEMA,
      kind: "proposalBundle",
      proposals: entries,
    });

    return entries.length === 1
      ? lowerSingleEntry(input, entries[0]!, bundleHash)
      : lowerAtomicMultiStep(input, entries, bundleHash);
  } catch {
    return rejected("PROPOSAL_BUNDLE_INVALID", ["bundle:lowering-input-invalid"]);
  }
}

/** Lowers the single-entry bundle shape; unchanged in behaviour except for
 * the accepted-cost gate now applied on the highRisk path (see below). */
function lowerSingleEntry(
  input: VNextProposalBundleLoweringInput,
  entry: VNextProposalBundleEntry,
  bundleHash: string,
): VNextProposalBundleLoweringResult {
  if (entry.ruling.kind === "highRisk") {
    const confirmation = trustedHighRiskConfirmation(input, entry);
    if (confirmation === undefined) {
      return acceptedCommand(pendingClarificationCommand(input, entry));
    }
    // A confirmed high-risk ruling still spends real item/resource costs;
    // it must pass the same availability gate as an in-world refusal.
    const costValidation = validateAttemptCosts(input, entry.ruling.acceptedCosts);
    if (costValidation.length > 0) return rejected("COST_INVALID", costValidation);
    return acceptedCommand({
      kind: "highRiskConfirmed",
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      proposalRef: entry.proposalRef,
      formId: entry.formId,
      ruling: entry.ruling,
      basisRefs: [...entry.basisRefs],
      confirmationId: confirmation.confirmationId,
    });
  }
  if (entry.ruling.kind === "missingPrerequisite"
    || entry.ruling.kind === "worldLawViolation") {
    if (entry.formId !== VNEXT_IN_WORLD_REFUSAL_FORM_ID
      || entry.proposal.kind !== "inWorldRefusal") {
      return rejected("PROPOSAL_BUNDLE_INVALID", ["bundle:world-ruling-requires-refusal-form"]);
    }
    const costValidation = validateAttemptCosts(input, entry.ruling.attemptCosts);
    if (costValidation.length > 0) return rejected("COST_INVALID", costValidation);
    // A refusal is committed as a public, scene-observer-visible event, and
    // its prerequisites travel in that payload. Being authority-read-bound is
    // not enough to put a ref in front of players: a `knowledge` prerequisite
    // may well cite a fact the actor cannot see. Only refs this Viewer could
    // already cite may appear, and an invisible one fails the ruling closed
    // rather than being quietly dropped -- the description stays player-facing
    // text either way, so the KP can re-state the prerequisite without it.
    const viewerRefs = requiredContextViewerRefs(input.requiredContext);
    const hiddenPrerequisites = entry.ruling.prerequisites
      .flatMap(({ ref }) => (ref === null ? [] : [ref]))
      .filter((ref) => !viewerRefs.has(ref));
    if (hiddenPrerequisites.length > 0) {
      return rejected(
        "PROPOSAL_REFERENCE_INVALID",
        hiddenPrerequisites.map((ref) => `refusal:prerequisite-not-viewer-visible:${ref}`),
      );
    }
    return acceptedCommand({
      kind: "inWorldRefusal",
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      proposalRef: entry.proposalRef,
      formId: VNEXT_IN_WORLD_REFUSAL_FORM_ID,
      intent: entry.proposal.intent,
      method: entry.proposal.method,
      ruling: entry.ruling,
      basisRefs: [...entry.basisRefs],
    });
  }
  if (entry.formId === VNEXT_CLARIFICATION_FORM_ID) {
    if (entry.proposal.kind !== "clarification") {
      return rejected("PROPOSAL_BUNDLE_INVALID", ["bundle:clarification-payload-mismatch"]);
    }
    return acceptedCommand(pendingClarificationCommand(input, entry));
  }
  if (entry.formId !== VNEXT_MATERIALIZATION_FORM_ID
    && entry.formId !== VNEXT_WORLD_INTERACTION_FORM_ID) {
    return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle:form-consumer-unavailable"]);
  }
  if (entry.ruling.kind !== "directSuccess" && entry.ruling.kind !== "check") {
    return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle:ruling-consumer-unavailable"]);
  }
  const rulesInput = lowerExecutableEntry(input, entry, bundleHash);
  if (rulesInput.kind === "rejected") return rulesInput;
  return acceptedCommand({
    kind: "rulesStep",
    rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId,
    formId: entry.formId,
    proposalRef: entry.proposalRef,
    ruling: entry.ruling.kind,
    rulesInput: rulesInput.rulesInput,
  });
}

/**
 * Lowers a bundle of two or more entries to one ordered, atomic Rules step
 * set.  Every entry must independently be an executable directSuccess or
 * check ruling against a materialization or world-interaction Form; a
 * clarification, in-world refusal, or high-risk entry cannot be mixed into
 * this path because none of them can synchronously produce a Rules input
 * here.  Steps are ordered by the same produces/consumes dependency graph
 * assertAcyclicDependencies already proves acyclic during validation.
 */
function lowerAtomicMultiStep(
  input: VNextProposalBundleLoweringInput,
  entries: readonly VNextProposalBundleEntry[],
  bundleHash: string,
): VNextProposalBundleLoweringResult {
  const sharedRuling = entries[0]?.ruling;
  if (sharedRuling === undefined
    || entries.some((entry) => canonicalHash(entry.ruling) !== canonicalHash(sharedRuling))) {
    return rejected("BUNDLE_DEPENDENCY_INVALID", ["bundle:shared-ruling-mismatch"]);
  }
  for (const entry of entries) {
    if (entry.ruling.kind !== "directSuccess" && entry.ruling.kind !== "check") {
      return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle:atomic-step-ruling-unsupported"]);
    }
    if (entry.formId !== VNEXT_MATERIALIZATION_FORM_ID
      && entry.formId !== VNEXT_WORLD_INTERACTION_FORM_ID) {
      return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle:atomic-step-form-unsupported"]);
    }
  }

  const producers = new Map<string, VNextBundleProducedReference>();
  for (const entry of entries) {
    for (const produced of entry.produces) producers.set(produced.handle, produced);
  }

  let graph: ReturnType<typeof topologicalOrderOfEntries>;
  try {
    graph = topologicalOrderOfEntries(entries, producers);
  } catch {
    // validateVNextProposalBundle already proved this exact bundle acyclic
    // and fully bound; this can only mean the lowering input diverged from
    // the validated bundle it was derived from.
    return rejected("BUNDLE_DEPENDENCY_INVALID", ["bundle:dependency-cycle"]);
  }

  const steps: VNextAtomicRulesStep[] = [];
  for (const entry of graph.ordered) {
    const lowered = lowerExecutableEntry(input, entry, bundleHash);
    if (lowered.kind === "rejected") return lowered;
    const dependsOn = [
      ...new Set(graph.edges.get(entry.proposalRef) ?? []),
    ].sort(compareCodeUnits);
    steps.push({
      formId: entry.formId as typeof VNEXT_MATERIALIZATION_FORM_ID | typeof VNEXT_WORLD_INTERACTION_FORM_ID,
      proposalRef: entry.proposalRef,
      ruling: entry.ruling.kind as "directSuccess" | "check",
      rulesInput: lowered.rulesInput,
      dependsOn,
      consumes: entry.consumes.map((reference) => ({ ...reference })),
      produces: entry.produces.map((reference) => ({ ...reference })),
      outcomeBinding: entry.outcomeBinding,
    });
  }

  return acceptedCommand({
    kind: "atomicRulesSteps",
    rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId,
    bundleHash,
    contextHash: input.requiredContext.binding.contextHash,
    sharedRuling: sharedRuling.kind as "directSuccess" | "check",
    steps: Object.freeze(steps),
  });
}

function validateEntry(value: unknown): VNextProposalBundleEntry {
  if (!isPlainRecord(value)
    || !exactKeys(value, [
      "basisRefs", "consumes", "formId", "outcomeBinding", "proposal", "proposalRef", "produces", "ruling",
    ])
    || !isLocalProposalRef(value.proposalRef)
    || !isBundleFormId(value.formId)
    || !isRefArray(value.basisRefs, 1)
    || !isOutcomeBinding(value.outcomeBinding)
    || !isPlainRecord(value.proposal)
    || !isFeasibilityRuling(value.ruling)
    || !isConsumes(value.consumes)
    || !isProduces(value.produces)
    || !isFormProposal(value.formId, value.proposal, value.ruling)) {
    throw new TypeError("bundle:entry-invalid");
  }
  return {
    proposalRef: value.proposalRef,
    formId: value.formId,
    basisRefs: [...value.basisRefs],
    consumes: value.consumes.map((entry) => ({ ...entry })),
    produces: value.produces.map((entry) => ({ ...entry })),
    outcomeBinding: value.outcomeBinding,
    ruling: canonicalClone(value.ruling) as VNextFeasibilityRuling,
    proposal: canonicalClone(value.proposal) as VNextBundleFormProposal,
  } as VNextProposalBundleEntry;
}

function isFormProposal(
  formId: unknown,
  proposal: Record<string, unknown>,
  ruling: VNextFeasibilityRuling,
): proposal is Record<string, unknown> {
  if (formId === VNEXT_CLARIFICATION_FORM_ID) {
    return ruling.kind !== "directSuccess"
      && ruling.kind !== "missingPrerequisite"
      && ruling.kind !== "worldLawViolation"
      && exactKeys(proposal, ["kind", "intent", "method", "question", "choices"])
      && proposal.kind === "clarification"
      && isBoundedText(proposal.intent, 4_000)
      && isBoundedText(proposal.method, 4_000)
      && isBoundedText(proposal.question, 2_000)
      && isChoices(proposal.choices);
  }
  if (formId === VNEXT_IN_WORLD_REFUSAL_FORM_ID) {
    return (ruling.kind === "missingPrerequisite" || ruling.kind === "worldLawViolation")
      && exactKeys(proposal, ["kind", "intent", "method"])
      && proposal.kind === "inWorldRefusal"
      && isBoundedText(proposal.intent, 4_000)
      && isBoundedText(proposal.method, 4_000);
  }
  if (formId === VNEXT_MATERIALIZATION_FORM_ID) {
    if (ruling.kind === "missingPrerequisite" || ruling.kind === "worldLawViolation") return false;
    if (proposal.kind === "materializeObject") {
      return exactKeys(proposal, [
        "definition", "kind", "semanticKind", "summary", "templateHash", "templateRef",
        "visibilityPolicyRef",
      ])
        && (proposal.semanticKind === "sceneFeature" || proposal.semanticKind === "worldFact")
        && isRef(proposal.templateRef)
        && isRef(proposal.templateHash)
        && isRef(proposal.visibilityPolicyRef)
        && isBoundedText(proposal.summary, 2_000)
        && isMaterializedObjectDefinition(proposal.definition, proposal.semanticKind);
    }
    return exactKeys(proposal, [
      "baseHash", "baseRevision", "definitionRef", "kind", "npcRef", "operations",
      "summary", "templateHash", "templateRef", "semanticKind",
    ])
      && proposal.kind === "reviseSemanticDefinition"
      && proposal.semanticKind === "npc"
      && [proposal.definitionRef, proposal.npcRef, proposal.baseRevision, proposal.baseHash,
        proposal.templateRef, proposal.templateHash].every(isRef)
      && isBoundedText(proposal.summary, 2_000)
      && isSemanticOperations(proposal.operations);
  }
  if (formId !== VNEXT_WORLD_INTERACTION_FORM_ID) return false;
  return ruling.kind !== "missingPrerequisite"
    && ruling.kind !== "worldLawViolation"
    && exactKeys(proposal, [
      "abilityRef", "branches", "directTargetRefs", "instrumentRefs", "intent", "kind",
      "method", "sceneRef", "targetRefs",
    ])
    && proposal.kind === "worldInteraction"
    && isRef(proposal.sceneRef)
    // A target may be a bundle-local `prospective:` handle produced earlier
    // in the same atomic Bundle (see VNextBundleMaterializeObjectProposal);
    // lowerSingleEntry rejects one outside that context, since nothing could
    // ever have produced it there.
    && isRefOrHandleArray(proposal.targetRefs, 1)
    && isRefOrHandleArray(proposal.directTargetRefs, 1)
    && isRefSubset(proposal.directTargetRefs, proposal.targetRefs)
    && isRefArray(proposal.instrumentRefs)
    && (proposal.abilityRef === null || isRef(proposal.abilityRef))
    && isBoundedText(proposal.intent, 4_000)
    && isBoundedText(proposal.method, 4_000)
    && isBranches(proposal.branches);
}

function isFeasibilityRuling(value: unknown): value is VNextFeasibilityRuling {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "directSuccess") {
    return exactKeys(value, ["failureOutcome", "kind", "risk", "successOutcome"])
      && [value.risk, value.successOutcome, value.failureOutcome]
        .every((entry) => isBoundedText(entry, 4_000));
  }
  if (value.kind === "check") {
    return isCheckRuling(value);
  }
  if (value.kind === "highRisk") {
    return exactKeys(value, [
      "acceptedCosts", "check", "confirmationQuestion", "failureOutcome", "kind", "risk", "successOutcome",
    ])
      && isBoundedText(value.risk, 4_000)
      && isBoundedText(value.confirmationQuestion, 2_000)
      && isBoundedText(value.successOutcome, 4_000)
      && isBoundedText(value.failureOutcome, 4_000)
      && (value.check === null || isCheckParameters(value.check))
      && isAttemptCosts(value.acceptedCosts);
  }
  if (value.kind !== "missingPrerequisite" && value.kind !== "worldLawViolation") return false;
  return exactKeys(value, ["attemptCosts", "kind", "nextActions", "prerequisites", "publicBasis"])
    && isBoundedText(value.publicBasis, 4_000)
    && isPrerequisites(value.prerequisites)
    && isNextActions(value.nextActions)
    && isAttemptCosts(value.attemptCosts);
}

function isCheckRuling(value: Record<string, unknown>): value is VNextCheckRuling {
  const risk = value.risk;
  const successOutcome = value.successOutcome;
  const failureOutcome = value.failureOutcome;
  return exactKeys(value, [
    "ability", "checkKind", "dc", "failureOutcome", "kind", "mode", "risk", "skill", "successOutcome",
  ])
    && isCheckParameters({
      ability: value.ability,
      checkKind: value.checkKind,
      dc: value.dc,
      mode: value.mode,
      skill: value.skill,
    })
    && [risk, successOutcome, failureOutcome]
      .every((entry) => isBoundedText(entry, 4_000));
}

function isCheckParameters(value: unknown): value is VNextCheckParameters {
  return isPlainRecord(value)
    && exactKeys(value, ["ability", "checkKind", "dc", "mode", "skill"])
    && (value.checkKind === "abilityCheck" || value.checkKind === "attack")
    && ["str", "dex", "con", "int", "wis", "cha"].includes(String(value.ability))
    && (value.skill === null || isRef(value.skill))
    && Number.isSafeInteger(value.dc) && Number(value.dc) >= 1 && Number(value.dc) <= 40
    && ["normal", "advantage", "disadvantage"].includes(String(value.mode));
}

function isAttemptCosts(value: unknown): value is readonly VNextAttemptCost[] {
  return Array.isArray(value)
    && value.length <= MAX_REFS
    && value.every((entry) => {
      if (!isPlainRecord(entry) || typeof entry.kind !== "string") return false;
      if (entry.kind === "fictionTime") {
        return exactKeys(entry, ["durationMicros", "kind"])
          && isPositiveDecimal(entry.durationMicros);
      }
      if (entry.kind === "item") {
        return exactKeys(entry, ["charges", "durability", "entryRef", "kind", "quantity"])
          && isRef(entry.entryRef)
          && [entry.quantity, entry.charges, entry.durability].every(isNonnegativeInteger)
          && Number(entry.quantity) + Number(entry.charges) + Number(entry.durability) > 0;
      }
      return entry.kind === "resource"
        && exactKeys(entry, ["amount", "kind", "resourceId"])
        && isRef(entry.resourceId)
        && isPositiveInteger(entry.amount);
    });
}

function isPrerequisites(value: unknown): value is readonly VNextPrerequisite[] {
  return Array.isArray(value)
    && value.length <= MAX_PREREQUISITES
    && value.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["description", "kind", "ref"])
      && ["tool", "knowledge", "position", "permission", "condition"].includes(String(entry.kind))
      && (entry.ref === null || isRef(entry.ref))
      && isBoundedText(entry.description, 2_000));
}

function isNextActions(value: unknown): value is readonly VNextNextAction[] {
  return Array.isArray(value)
    && value.length <= MAX_NEXT_ACTIONS
    && value.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["basisRefs", "description"])
      && isBoundedText(entry.description, 2_000)
      && isRefArray(entry.basisRefs, 1));
}

function isChoices(value: unknown): value is readonly VNextClarificationChoice[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_CHOICES) return false;
  const ids = value.map((entry) => isPlainRecord(entry) ? entry.choiceId : undefined);
  return value.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["basisRefs", "choiceId", "label", "publicRisk"])
      && isLocalChoiceId(entry.choiceId)
      && isBoundedText(entry.label, 1_000)
      && isBoundedText(entry.publicRisk, 2_000)
      && isRefArray(entry.basisRefs, 1))
    && new Set(ids).size === ids.length;
}

function isConsumes(value: unknown): value is readonly VNextBundleReference[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) return false;
  const keys = value.map((entry) => {
    if (!isPlainRecord(entry)) return "";
    return entry.kind === "existing"
      ? `existing:${String(entry.ref)}`
      : entry.kind === "prospective"
        ? `prospective:${String(entry.handle)}`
        : `invalid:${String(entry.kind)}`;
  });
  return value.every((entry) => {
    if (!isPlainRecord(entry) || typeof entry.kind !== "string") return false;
    if (entry.kind === "existing") {
      return exactKeys(entry, ["kind", "ref"])
        && isRef(entry.ref)
        && !LOCAL_HANDLE_PATTERN.test(entry.ref);
    }
    return entry.kind === "prospective"
      && exactKeys(entry, ["handle", "kind"])
      && isLocalHandle(entry.handle);
  }) && new Set(keys).size === keys.length;
}

function assertAcyclicDependencies(
  entries: readonly VNextProposalBundleEntry[],
  producers: ReadonlyMap<string, VNextBundleProducedReference>,
): void {
  topologicalOrderOfEntries(entries, producers);
}

/**
 * Same dependency graph and cycle detection as assertAcyclicDependencies,
 * but returns entries ordered so each dependency precedes its dependents.
 * Used by the atomic multi-step lowering path; assertAcyclicDependencies
 * above is a thin wrapper so the two never drift apart.
 */
function topologicalOrderOfEntries(
  entries: readonly VNextProposalBundleEntry[],
  producers: ReadonlyMap<string, VNextBundleProducedReference>,
): Readonly<{
  ordered: readonly VNextProposalBundleEntry[];
  edges: ReadonlyMap<string, readonly string[]>;
}> {
  const byProposalRef = new Map(entries.map((entry) => [entry.proposalRef, entry]));
  const sharedCheckProposalRef = sharedCheckEntryRef(entries);
  const edges = new Map<string, readonly string[]>();
  for (const entry of entries) {
    const dependencies = new Set(entry.consumes
      .filter((consume): consume is Extract<VNextBundleReference, { kind: "prospective" }> =>
        consume.kind === "prospective")
      .map((consume) => {
        const producer = producers.get(consume.handle);
        if (producer === undefined) throw new TypeError("bundle:prospective-consumer-unbound");
        const producerEntry = entries.find((candidate) =>
          candidate.produces.some((produced) => produced.handle === producer.handle));
        if (producerEntry === undefined) throw new TypeError("bundle:prospective-producer-unbound");
        return producerEntry.proposalRef;
      }));
    if (sharedCheckProposalRef !== undefined
      && entry.outcomeBinding !== "always"
      && entry.proposalRef !== sharedCheckProposalRef) {
      dependencies.add(sharedCheckProposalRef);
    }
    edges.set(entry.proposalRef, [...dependencies].sort(compareCodeUnits));
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (proposalRef: string): void => {
    if (visiting.has(proposalRef)) throw new TypeError("bundle:dependency-cycle");
    if (visited.has(proposalRef)) return;
    visiting.add(proposalRef);
    for (const dependency of edges.get(proposalRef) ?? []) visit(dependency);
    visiting.delete(proposalRef);
    visited.add(proposalRef);
    order.push(proposalRef);
  };
  for (const proposalRef of byProposalRef.keys()) visit(proposalRef);
  return Object.freeze({
    ordered: order.map((proposalRef) => byProposalRef.get(proposalRef)!),
    edges,
  });
}

/** The one shared check is an implicit server-side predecessor of every
 * onSuccess/onFailure step. This keeps outcome-dependent continuity changes
 * after the mechanical result without exposing a model-authored DAG. */
function sharedCheckEntryRef(
  entries: readonly VNextProposalBundleEntry[],
): string | undefined {
  if (entries.length < 2 || entries[0]?.ruling.kind !== "check") return undefined;
  const candidates = entries.filter((entry) =>
    entry.formId === VNEXT_WORLD_INTERACTION_FORM_ID);
  if (candidates.length !== 1 || candidates[0]!.outcomeBinding !== "always") {
    throw new TypeError("bundle:shared-check-entry-invalid");
  }
  return candidates[0]!.proposalRef;
}

function isProduces(value: unknown): value is readonly VNextBundleProducedReference[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) return false;
  const handles = value.map((entry) => isPlainRecord(entry) ? entry.handle : undefined);
  return value.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["handle", "kind", "outcomeBinding"])
      && isLocalHandle(entry.handle)
      && ["semanticDefinition", "canonicalFact", "relation", "itemEntry"].includes(String(entry.kind))
      && isOutcomeBinding(entry.outcomeBinding))
    && new Set(handles).size === handles.length;
}

function isSemanticOperations(value: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 16
    && value.every((operation) => {
      if (!isPlainRecord(operation)
        || !Array.isArray(operation.path)
        || operation.path.length === 0
        || !operation.path.every(isRef)
        || typeof operation.kind !== "string") return false;
      if (operation.kind === "set") return exactKeys(operation, ["kind", "path", "value"]);
      if (operation.kind === "remove") return exactKeys(operation, ["kind", "path"]);
      if (operation.kind === "upsertByRef") {
        return exactKeys(operation, ["entry", "kind", "path"]) && isPlainRecord(operation.entry);
      }
      return operation.kind === "removeByRef"
        && exactKeys(operation, ["kind", "path", "ref"])
        && isRef(operation.ref);
    });
}

function isBranches(value: unknown): value is Readonly<{
  success: VNextWorldInteractionBranchProposal;
  failure: VNextWorldInteractionBranchProposal;
}> {
  return isPlainRecord(value)
    && exactKeys(value, ["failure", "success"])
    && isBranch(value.success)
    && isBranch(value.failure);
}

function isBranch(value: unknown): value is VNextWorldInteractionBranchProposal {
  if (!isPlainRecord(value)
    || !exactKeys(value, ["effects", "opportunities", "outcomeCode", "pressures", "sensoryEvidence", "summary"])
    || !isRef(value.outcomeCode)
    || !isBoundedText(value.summary, 4_000)
    || !Array.isArray(value.effects)
    || value.effects.length > 16
    || !Array.isArray(value.sensoryEvidence)
    || value.sensoryEvidence.length > 16
    || !Array.isArray(value.pressures)
    || value.pressures.length > 8
    || !Array.isArray(value.opportunities)
    || value.opportunities.length > 8
    || !value.effects.every(isWorldEffect)
    || !value.sensoryEvidence.every(isSensoryEvidence)
    || !value.pressures.every(isPressure)
    || !value.opportunities.every(isOpportunity)) return false;
  return true;
}

function isWorldEffect(value: unknown): value is VNextWorldInteractionBranchProposal["effects"][number] {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "relationTransition") {
    return exactKeys(value, ["kind", "relationRef", "toState"])
      && isRef(value.relationRef)
      && (value.toState === "active" || value.toState === "ended");
  }
  if (value.kind === "definitionRevision") {
    return exactKeys(value, ["definitionRef", "kind", "operations", "summary"])
      && isRef(value.definitionRef)
      && isSemanticOperations(value.operations)
      && isBoundedText(value.summary, 2_000);
  }
  return value.kind === "registeredHazard"
    && exactKeys(value, ["damageProfileRef", "kind", "sourceDefinitionRef", "zoneRef"])
    && isRef(value.sourceDefinitionRef)
    && isRef(value.zoneRef)
    && isWorldDamageProfileRef(value.damageProfileRef);
}

function isSensoryEvidence(
  value: unknown,
): value is VNextWorldInteractionBranchProposal["sensoryEvidence"][number] {
  return isPlainRecord(value)
    && exactKeys(value, ["basisRefs", "evidence", "observerRef", "sense", "subjectRef"])
    && isRef(value.observerRef)
    && (value.subjectRef === null || isRef(value.subjectRef))
    && ["sight", "hearing", "smell", "touch", "taste", "special"].includes(String(value.sense))
    && isBoundedText(value.evidence, 2_000)
    && isRefArray(value.basisRefs, 1);
}

function isPressure(
  value: unknown,
): value is VNextWorldInteractionBranchProposal["pressures"][number] {
  return isPlainRecord(value)
    && exactKeys(value, ["basisRefs", "description", "sourceRef"])
    && isBoundedText(value.description, 2_000)
    && (value.sourceRef === null || isRef(value.sourceRef))
    && isRefArray(value.basisRefs, 1);
}

function isOpportunity(
  value: unknown,
): value is VNextWorldInteractionBranchProposal["opportunities"][number] {
  return isPlainRecord(value)
    && exactKeys(value, ["actionHint", "basisRefs", "description", "targetRef"])
    && isBoundedText(value.description, 2_000)
    && (value.targetRef === null || isRef(value.targetRef))
    && (value.actionHint === null || isBoundedText(value.actionHint, 2_000))
    && isRefArray(value.basisRefs, 1);
}

function lowerExecutableEntry(
  input: VNextProposalBundleLoweringInput,
  entry: VNextProposalBundleEntry,
  bundleHash: string,
): VNextProposalLoweringResult {
  if (entry.ruling.kind !== "directSuccess" && entry.ruling.kind !== "check") {
    return {
      kind: "rejected",
      code: "PROPOSAL_FORM_INVALID",
      issues: ["bundle:executable-ruling-required"],
    };
  }
  // materializeObject creates a definition that does not exist yet, so it
  // cannot be revalidated against an existing stored definition the way
  // reviseSemanticDefinition and worldInteraction are below; it is lowered
  // directly to a materializeSemanticDefinition Rules input instead of
  // through the shared coarse-form envelope.
  if (entry.proposal.kind === "materializeObject") {
    return lowerMaterializeObjectEntry(input, entry, entry.proposal, bundleHash);
  }
  const oldEnvelope = {
    schema: VNEXT_KP_PROPOSAL_SCHEMA,
    kind: "vnextCoarseFormProposal",
    formId: entry.formId,
    proposalRef: entry.proposalRef,
    contextHash: input.requiredContext.binding.contextHash,
    basisRefs: entry.basisRefs,
    proposal: entry.formId === VNEXT_WORLD_INTERACTION_FORM_ID
      ? {
          ...entry.proposal,
          adjudication: toWorldAdjudication(entry.ruling),
        }
      : entry.proposal,
  };
  const lowered = lowerVNextCoarseFormProposal({
    value: oldEnvelope,
    requiredContext: input.requiredContext,
    state: input.state,
    rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId,
  });
  return lowered;
}

/**
 * Lowers a materializeObject entry to a materializeSemanticDefinition Rules
 * input. The entry's one `produces` reference supplies the bundle-local
 * handle; Rules alone derives the committed definitionRef from it (see
 * normalizedProspectiveRef/materializedSemanticDefinitionRef in
 * semantic-definitions.ts) -- this lowering never invents or guesses it.
 */
function lowerMaterializeObjectEntry(
  input: VNextProposalBundleLoweringInput,
  entry: VNextProposalBundleEntry,
  proposal: VNextBundleMaterializeObjectProposal,
  bundleHash: string,
): VNextProposalLoweringResult {
  const produced = entry.produces;
  if (produced.length !== 1 || produced[0]?.kind !== "semanticDefinition") {
    return {
      kind: "rejected",
      code: "PROPOSAL_FORM_INVALID",
      issues: ["bundle:materialize-object-requires-one-produced-handle"],
    };
  }
  const handle = produced[0].handle;
  const dependencyRefs = [
    input.actorCharacterId,
    ...entry.basisRefs,
    ...(proposal.definition.sceneRef === null ? [] : [proposal.definition.sceneRef]),
    ...(proposal.definition.visibilityFactId === null ? [] : [proposal.definition.visibilityFactId]),
    ...proposal.definition.mechanicDefinitionRefs,
  ];
  const planReadSet = selectPlanReadSet(input.requiredContext, dependencyRefs);
  if (planReadSet.kind === "rejected") return planReadSet;
  const content: JsonRecord = proposal.semanticKind === "sceneFeature"
    ? {
        sceneRef: proposal.definition.sceneRef,
        label: proposal.definition.label,
        description: proposal.definition.description,
        ...(proposal.definition.mechanicDefinitionRefs.length > 0
          ? { mechanicDefinitionRefs: [...proposal.definition.mechanicDefinitionRefs].sort() }
          : {}),
        observableState: proposal.definition.observableState,
        affordances: [...proposal.definition.affordances],
      }
    : {
        label: proposal.definition.label,
        description: proposal.definition.description,
        ...(proposal.definition.visibilityFactId === null
          ? {}
          : { visibilityFactId: proposal.definition.visibilityFactId }),
      };
  return {
    kind: "accepted",
    rulesInput: {
      kind: "materializeSemanticDefinition",
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      plan: {
        schema: "zhuwei.semantic-definition-materialization-plan/vnext-1",
        bundleHash,
        handle,
        semanticKind: proposal.semanticKind,
        templateRef: proposal.templateRef,
        templateHash: proposal.templateHash,
        visibilityPolicyRef: proposal.visibilityPolicyRef,
        contextHash: input.requiredContext.binding.contextHash,
        readSet: planReadSet.readSet,
        basisRefs: [...entry.basisRefs],
        sourceRefs: [],
        content,
        summary: proposal.summary,
      },
    },
  };
}

function toWorldAdjudication(
  ruling: VNextDirectSuccessRuling | VNextCheckRuling,
): JsonRecord {
  if (ruling.kind === "directSuccess") return {
    kind: "directSuccess",
    risk: ruling.risk,
    successOutcome: ruling.successOutcome,
    failureOutcome: ruling.failureOutcome,
  };
  return {
    kind: "check",
    checkKind: ruling.checkKind,
    ability: ruling.ability,
    skill: ruling.skill,
    dc: ruling.dc,
    mode: ruling.mode,
    risk: ruling.risk,
    successOutcome: ruling.successOutcome,
    failureOutcome: ruling.failureOutcome,
  };
}

function pendingClarificationCommand(
  input: VNextProposalBundleLoweringInput,
  entry: VNextProposalBundleEntry,
): VNextProposalBundleCommand {
  const choices = entry.proposal.kind === "clarification"
    ? entry.proposal.choices
    : entry.ruling.kind === "highRisk"
      ? [
          {
            choiceId: "accept-risk",
            label: "确认承担该风险并继续",
            publicRisk: entry.ruling.risk,
            basisRefs: [...entry.basisRefs],
          },
          {
            choiceId: "decline-risk",
            label: "暂不承担该风险",
            publicRisk: "暂不执行这项高风险做法。",
            basisRefs: [...entry.basisRefs],
          },
        ]
      : [];
  const question = entry.proposal.kind === "clarification"
    ? entry.proposal.question
    : entry.ruling.kind === "highRisk"
      ? entry.ruling.confirmationQuestion
      : "请明确这项行动的具体选择。";
  const pendingInputId = `pending:vnext:${canonicalHash({
    rootActionId: input.rootActionId,
    contextHash: input.requiredContext.binding.contextHash,
    proposalRef: entry.proposalRef,
    question,
    choices,
  }).slice("sha256:".length, "sha256:".length + 32)}`;
  return {
    kind: "pendingClarification",
    rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId,
    proposalRef: entry.proposalRef,
    pendingInputId,
    question,
    choices: choices.map((choice) => ({
      choiceId: choice.choiceId,
      label: choice.label,
      publicRisk: choice.publicRisk,
      basisRefs: [...choice.basisRefs],
    })),
  };
}

function trustedHighRiskConfirmation(
  input: VNextProposalBundleLoweringInput,
  entry: VNextProposalBundleEntry,
): VNextHighRiskConfirmation | undefined {
  const confirmation = input.highRiskConfirmation;
  if (confirmation === undefined
    || !isPlainRecord(confirmation)
    || !exactKeys(confirmation, [
      "confirmationId", "contextHash", "kind", "proposalRef", "rootActionId", "rulingHash",
    ])
    || confirmation.kind !== "highRiskConfirmation"
    || !isRef(confirmation.confirmationId)
    || confirmation.rootActionId !== input.rootActionId
    || confirmation.contextHash !== input.requiredContext.binding.contextHash
    || confirmation.proposalRef !== entry.proposalRef
    || !isSha256(confirmation.rulingHash)
    || confirmation.rulingHash !== canonicalHash(entry.ruling)) return undefined;
  return confirmation as VNextHighRiskConfirmation;
}

function validateAttemptCosts(
  input: VNextProposalBundleLoweringInput,
  costs: readonly VNextAttemptCost[],
): readonly string[] {
  const authorityRefs = requiredContextAuthorityRefs(input.requiredContext);
  const readRefs = requiredContextReadRefs(input.requiredContext);
  const issues: string[] = [];
  for (const cost of costs) {
    if (cost.kind === "fictionTime") continue;
    const ref = cost.kind === "item" ? cost.entryRef : cost.resourceId;
    if (!authorityRefs.has(ref) || !readRefs.has(ref)) {
      issues.push(`cost:not-read-bound:${ref}`);
      continue;
    }
    if (cost.kind === "item") {
      const entry = input.state.campaignRuntime.itemSystem.entries[cost.entryRef];
      if (!isPlainRecord(entry)
        || entry.holderRef !== input.actorCharacterId
        || entry.disposition !== "held"
        || entry.condition !== "usable"
        || itemEntryResourceId(entry.entryId) !== cost.entryRef
        || !isSufficientCounter(entry.quantity, cost.quantity)
        || !isSufficientNullableCounter(entry.charges, cost.charges)
        || !isSufficientNullableCounter(entry.durability, cost.durability)) {
        issues.push(`cost:item-unavailable:${cost.entryRef}`);
      }
    } else if ((input.state.entities[input.actorCharacterId]?.resources?.[cost.resourceId] ?? 0)
      < cost.amount) {
      issues.push(`cost:resource-unavailable:${cost.resourceId}`);
    }
  }
  return Object.freeze([...new Set(issues)].sort(compareCodeUnits));
}

function entryRefs(entry: VNextProposalBundleEntry): readonly string[] {
  const proposalRefs = entry.proposal.kind === "worldInteraction"
    ? [
        entry.proposal.sceneRef,
        ...entry.proposal.targetRefs,
        ...entry.proposal.directTargetRefs,
        ...entry.proposal.instrumentRefs,
        ...(entry.proposal.abilityRef === null ? [] : [entry.proposal.abilityRef]),
      ]
    : entry.proposal.kind === "reviseSemanticDefinition"
      ? [entry.proposal.definitionRef, entry.proposal.npcRef, entry.proposal.templateRef]
      : entry.proposal.kind === "materializeObject"
        // templateRef/templateHash are opaque KP-chosen provenance tags for a
        // definition that does not exist yet; unlike reviseSemanticDefinition
        // they name no existing authority ref and so are never checked here.
        // Rules is the final authority on this proposal's own new definition.
        ? [
            ...(entry.proposal.definition.sceneRef === null
              ? []
              : [entry.proposal.definition.sceneRef]),
            ...(entry.proposal.definition.visibilityFactId === null
              ? []
              : [entry.proposal.definition.visibilityFactId]),
            ...entry.proposal.definition.mechanicDefinitionRefs,
          ]
        : entry.proposal.kind === "inWorldRefusal"
          ? entry.ruling.kind === "missingPrerequisite" || entry.ruling.kind === "worldLawViolation"
            ? [
                ...entry.ruling.prerequisites.flatMap(({ ref }) => ref === null ? [] : [ref]),
                ...entry.ruling.nextActions.flatMap(({ basisRefs }) => [...basisRefs]),
              ]
            : []
          : entry.proposal.choices.flatMap(({ basisRefs }) => [...basisRefs]);
  return [...new Set([
    ...entry.basisRefs,
    ...entry.consumes.flatMap((consume) => consume.kind === "existing" ? [consume.ref] : []),
    ...proposalRefs,
    ...rulingRefs(entry.ruling),
  ])];
}

function rulingRefs(ruling: VNextFeasibilityRuling): readonly string[] {
  if (ruling.kind === "missingPrerequisite" || ruling.kind === "worldLawViolation") {
    return [
      ...ruling.prerequisites.flatMap(({ ref }) => ref === null ? [] : [ref]),
      ...ruling.nextActions.flatMap(({ basisRefs }) => [...basisRefs]),
      ...ruling.attemptCosts.flatMap((cost) => cost.kind === "fictionTime"
        ? []
        : [cost.kind === "item" ? cost.entryRef : cost.resourceId]),
    ];
  }
  if (ruling.kind === "highRisk") {
    return ruling.acceptedCosts.flatMap((cost) => cost.kind === "fictionTime"
      ? []
      : [cost.kind === "item" ? cost.entryRef : cost.resourceId]);
  }
  return [];
}

function outcomeDominates(
  producer: VNextOutcomeBinding,
  consumer: VNextOutcomeBinding,
): boolean {
  return producer === "always" || producer === consumer;
}

function acceptedCommand(command: VNextProposalBundleCommand): VNextProposalBundleLoweringResult {
  return Object.freeze({ kind: "accepted", command: deepFreeze(command) });
}

function rejected(
  code: Exclude<VNextProposalBundleLoweringResult, { kind: "accepted" }>["code"],
  issues: readonly string[],
): Extract<VNextProposalBundleLoweringResult, { kind: "rejected" }> {
  return Object.freeze({ kind: "rejected", code, issues: Object.freeze([...issues].sort(compareCodeUnits)) });
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const sorted = [...expected].sort(compareCodeUnits);
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isBundleFormId(value: unknown): value is VNextBundleFormId {
  return (VNEXT_BUNDLE_FORM_IDS as readonly string[]).includes(String(value));
}

function isOutcomeBinding(value: unknown): value is VNextOutcomeBinding {
  return value === "always" || value === "onSuccess" || value === "onFailure";
}

function isLocalProposalRef(value: unknown): value is string {
  return typeof value === "string"
    && LOCAL_PROPOSAL_PATTERN.test(value)
    && !LOCAL_HANDLE_PATTERN.test(value);
}

function isLocalHandle(value: unknown): value is string {
  return typeof value === "string" && LOCAL_HANDLE_PATTERN.test(value);
}

function isLocalChoiceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(value);
}

function isRef(value: unknown): value is string {
  return isNonEmptyString(value)
    && value.length <= 300
    && value.trim() === value
    && value.normalize("NFC") === value
    && !LOCAL_HANDLE_PATTERN.test(value);
}

function isRefArray(value: unknown, minimum = 0): value is readonly string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= MAX_REFS
    && value.every(isRef)
    && new Set(value).size === value.length;
}

/** Either an authority ref or a bundle-local `prospective:` handle. Used
 * only for the world-interaction target fields, which must be able to
 * address an object this same atomic Bundle is about to materialize. */
function isRefOrHandle(value: unknown): value is string {
  return isRef(value) || isLocalHandle(value);
}

function isRefOrHandleArray(value: unknown, minimum = 0): value is readonly string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= MAX_REFS
    && value.every(isRefOrHandle)
    && new Set(value).size === value.length;
}

function isTextArray(value: unknown, maximum: number, itemMaximum: number): boolean {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((entry) => isBoundedText(entry, itemMaximum));
}

function isMaterializedObjectDefinition(
  value: unknown,
  semanticKind: "sceneFeature" | "worldFact",
): value is VNextBundleMaterializedObjectDefinition {
  return isPlainRecord(value)
    && exactKeys(value, [
      "affordances", "description", "label", "mechanicDefinitionRefs", "observableState",
      "sceneRef", "visibilityFactId",
    ])
    && (semanticKind === "sceneFeature" ? isRef(value.sceneRef) : value.sceneRef === null)
    && (value.visibilityFactId === null || isRef(value.visibilityFactId))
    && isBoundedText(value.label, 300)
    && isBoundedText(value.description, 4_000)
    && isBoundedText(value.observableState, 2_000)
    && isTextArray(value.affordances, 16, 300)
    && isRefArray(value.mechanicDefinitionRefs);
}

function isRefSubset(subset: unknown, superset: unknown): boolean {
  return Array.isArray(subset)
    && Array.isArray(superset)
    && subset.every((ref) => superset.includes(ref));
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return isNonEmptyString(value)
    && value.length <= maximum
    && value.trim() === value
    && value.normalize("NFC") === value;
}

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === "string"
    && /^[1-9][0-9]*$/u.test(value)
    && Number.isSafeInteger(Number(value));
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isSufficientCounter(value: unknown, cost: number): boolean {
  return isNonnegativeInteger(value) && value >= cost;
}

function isSufficientNullableCounter(value: unknown, cost: number): boolean {
  return cost === 0 ? value === null || isNonnegativeInteger(value) : isNonnegativeInteger(value) && value >= cost;
}

function isSha256(value: unknown): boolean {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function issue(error: unknown): string {
  return error instanceof Error ? error.message : "bundle:unknown-error";
}

function isDependencyIssue(message: string): boolean {
  return message.startsWith("bundle:prospective-")
    || message.startsWith("bundle:prospective-condition-")
    || message === "bundle:dependency-cycle"
    || message === "bundle:shared-ruling-mismatch";
}
