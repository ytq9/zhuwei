import {
  canonicalHash,
  compareCodeUnits,
  isNonEmptyString,
} from "./canonical-json";
import {
  lowerVNextCoarseFormProposal,
  selectPlanReadSet,
  VNEXT_KP_PROPOSAL_SCHEMA,
  VNEXT_MATERIALIZATION_FORM_ID,
  VNEXT_WORLD_INTERACTION_FORM_ID,
  type WorldInteractionAdjudication,
} from "./proposals";
import { validateAttemptCosts } from "./proposal-bundle";
import { deriveVNextProposalBundlePlan } from "./proposal-graph";
import { validateVNextProposalBundle } from "./proposal-validator";
import { requiredContextViewerRefs } from "./required-context-runtime";
import type { VNextRequiredContext } from "./required-context";
import {
  normalizedProspectiveRef,
  type AuthoritativeWorldState,
  type JsonRecord,
} from "../../rules/authority-read";
import {
  VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  VNEXT_CLARIFICATION_FORM_ID,
  VNEXT_IN_WORLD_REFUSAL_FORM_ID,
  VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA,
  type VNextCheckRuling,
  type VNextClarificationTerminal,
  type VNextDerivedBundleEntry,
  type VNextDerivedBundlePlan,
  type VNextDirectSuccessRuling,
  type VNextInWorldRefusalTerminal,
  type VNextMaterializeObjectEntry,
  type VNextProposalBundleEntry,
  type VNextRefusalRuling,
  type VNextWorldInteractionEntry,
} from "./proposal-schema";

const LOCAL_HANDLE_PATTERN = /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * The only command this module emits. It intentionally reuses the same
 * three shapes room-bridge.ts already knows how to turn into a Room
 * transaction for vnext-1 (`rulesStep`, `pendingClarification`,
 * `inWorldRefusal`) -- a `rulesStep` whose `rulesInput.kind` is
 * `applyAtomicWorldInteractionSteps` carries the whole atomic multi-entry
 * Bundle as one Rules transaction, exactly like vnext-1's `atomicRulesSteps`
 * command lowers today; there is no separate atomic command kind to add.
 */
export type VNext2ProposalBundleCommand =
  | Readonly<{
      kind: "rulesStep";
      rootActionId: string;
      actorCharacterId: string;
      formId:
        | typeof VNEXT_MATERIALIZATION_FORM_ID
        | typeof VNEXT_WORLD_INTERACTION_FORM_ID
        | typeof VNEXT2_PROPOSAL_BUNDLE_SCHEMA;
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
    }>;

export type VNext2ProposalBundleLoweringResult =
  | Readonly<{ kind: "accepted"; command: VNext2ProposalBundleCommand }>
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

export type VNext2ProposalBundleLoweringInput = Readonly<{
  value: unknown;
  requiredContext: VNextRequiredContext;
  state: AuthoritativeWorldState;
  rootActionId: string;
  actorCharacterId: string;
}>;

/** Wider than VNextProposalLoweringResult (proposals.ts): a single entry's
 * lowering can also fail on this module's own bundle-dependency or
 * unsupported-shape gates, not only the vnext-1 coarse-Form codes. */
type VNext2EntryLoweringResult =
  | Readonly<{ kind: "accepted"; rulesInput: JsonRecord }>
  | Readonly<{
      kind: "rejected";
      code:
        | "PROPOSAL_FORM_INVALID"
        | "PROPOSAL_REFERENCE_INVALID"
        | "DEFINITION_CONFLICT"
        | "CONTEXT_INSUFFICIENT"
        | "BUNDLE_DEPENDENCY_INVALID"
        | "BUNDLE_LOWERING_UNSUPPORTED";
      issues: readonly string[];
    }>;

/**
 * Lowers a validated vnext-2 ProposalBundle to the one Rules-consumable
 * command Room needs. This pass supports the `directSuccess` and `check`
 * shared adjudications, single or multi-entry (atomic when more than one
 * entry). Under a `check` the whole Bundle rides one mechanical roll: Rules
 * owns the dice, preflights both outcomes before any live effect, and binds
 * each conditional step to the branch it declared.
 *
 * A `highRisk` bundle is still rejected closed with
 * BUNDLE_LOWERING_UNSUPPORTED. It is pending by construction until Room
 * supplies a trusted confirmation carrying the accepted costs, and this
 * module has no seam to ask for one; lowering it anyway would spend an
 * attempt cost the player never agreed to.
 */
export function lowerVNext2ProposalBundle(
  input: VNext2ProposalBundleLoweringInput,
): VNext2ProposalBundleLoweringResult {
  try {
    const validated = validateVNextProposalBundle(input.value);
    if (validated.kind === "rejected") return validated;
    if (!isNonEmptyString(input.rootActionId)
      || !isNonEmptyString(input.actorCharacterId)
      || input.requiredContext.binding.rootActionId !== input.rootActionId
      || input.requiredContext.intent.actorRef !== input.actorCharacterId) {
      return rejected("CONTEXT_INSUFFICIENT", ["bundle2:context-binding-mismatch"]);
    }
    const bundle = validated.bundle;
    const contextHash = input.requiredContext.binding.contextHash;

    if (bundle.mode === "terminal") {
      return lowerTerminal(input, bundle.terminal, contextHash);
    }

    // mode === "adjudication"
    const ruling = bundle.adjudication;
    if (ruling.kind === "highRisk") {
      return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle2:high-risk-not-supported"]);
    }

    const planResult = deriveVNextProposalBundlePlan({
      bundle,
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      contextHash,
      // Nothing downstream of this call reads `plan.readSet` for validation
      // (it is carried into the frozen plan for provenance only); the
      // per-entry Rules plans below each derive and enforce their own real
      // read set through selectPlanReadSet.
      readSet: [],
    });
    if (planResult.kind === "rejected") {
      return rejected("BUNDLE_DEPENDENCY_INVALID", planResult.issues);
    }
    const plan = planResult.plan;
    // proposal-graph.ts selects the shared check owner from the ruling alone
    // (sharedCheckOwner returns null exactly when no check is required), so
    // the two must agree in both directions. A directSuccess plan that named
    // an owner -- or a check plan that named none -- means the graph
    // derivation diverged from the ruling gated above, and every
    // check-ownership dependency edge derived below would be wrong.
    if ((plan.sharedCheckEntryRef !== null) !== (ruling.kind === "check")) {
      return rejected("BUNDLE_DEPENDENCY_INVALID", [
        "bundle2:shared-check-owner-disagrees-with-ruling",
      ]);
    }

    if (plan.entries.length === 1) {
      const derivedEntry = plan.entries[0]!;
      const sourceEntry = bundle.proposals[derivedEntry.ordinal]!;
      // A lone worldInteraction can never legitimately reference a
      // prospective handle: nothing in a one-entry bundle could have
      // produced it. Mirrors the same closure vnext-1 draws in
      // lowerVNextProposalBundle before this ever reaches Rules.
      if (sourceEntry.kind === "worldInteraction"
        && [...sourceEntry.targetRefs, ...sourceEntry.directTargetRefs]
          .some((ref) => LOCAL_HANDLE_PATTERN.test(ref))) {
        return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle2:prospective-ref-requires-atomic-bundle"]);
      }
      // A one-entry check Bundle has exactly one candidate owner, and
      // sharedCheckOwner must have picked it. If it picked something else the
      // roll would be attributed to a step that is not the one being rolled
      // for, so refuse rather than resolve against the wrong interaction.
      if (ruling.kind === "check" && plan.sharedCheckEntryRef !== derivedEntry.entryRef) {
        return rejected("BUNDLE_DEPENDENCY_INVALID", [
          "bundle2:shared-check-owner-disagrees-with-ruling",
        ]);
      }
      const lowered = lowerExecutableEntry(input, sourceEntry, derivedEntry, plan, ruling);
      if (lowered.kind === "rejected") return lowered;
      return acceptedCommand({
        kind: "rulesStep",
        rootActionId: input.rootActionId,
        actorCharacterId: input.actorCharacterId,
        formId: derivedEntry.formId,
        proposalRef: derivedEntry.entryRef,
        ruling: ruling.kind,
        rulesInput: lowered.rulesInput,
      });
    }

    const entryByRef = new Map(plan.entries.map((entry) => [entry.entryRef, entry] as const));
    const steps: JsonRecord[] = [];
    for (const entryRef of plan.executionOrder) {
      const derivedEntry = entryByRef.get(entryRef);
      if (derivedEntry === undefined) {
        return rejected("BUNDLE_DEPENDENCY_INVALID", ["bundle2:execution-order-unbound"]);
      }
      const sourceEntry = bundle.proposals[derivedEntry.ordinal]!;
      const lowered = lowerExecutableEntry(input, sourceEntry, derivedEntry, plan, ruling);
      if (lowered.kind === "rejected") return lowered;
      steps.push({
        formId: derivedEntry.formId,
        proposalRef: entryRef,
        ruling: ruling.kind,
        rulesInput: lowered.rulesInput,
        dependsOn: dependsOnFor(derivedEntry, plan),
        consumes: derivedEntry.consumes.map((reference) => ({ ...reference })),
        produces: derivedEntry.produces.map((produced) => ({
          handle: produced.handle,
          kind: produced.kind,
          outcomeBinding: produced.outcomeBinding,
        })),
        outcomeBinding: derivedEntry.outcomeBinding,
      });
    }

    // Rules compiles this same invariant (world-interactions.ts requires
    // exactly one step whose `rulesInput.plan.ruling.kind` is `check` under a
    // `check` sharedRuling, and none under `directSuccess`). Checking the
    // steps we actually produced -- rather than trusting that the ruling and
    // the graph's owner implied it -- turns a silent lowering drift into a
    // named refusal here instead of an opaque "not canonical" from Rules.
    const loweredCheckRefs = steps.flatMap((step) => {
      const rulesInput = step.rulesInput as { kind?: unknown; plan?: unknown };
      const stepPlan = rulesInput.plan as { ruling?: { kind?: unknown } } | undefined;
      return rulesInput.kind === "resolveWorldInteraction"
        && stepPlan?.ruling?.kind === "check"
        ? [step.proposalRef as string]
        : [];
    });
    const expectedCheckRefs = plan.sharedCheckEntryRef === null ? [] : [plan.sharedCheckEntryRef];
    if (loweredCheckRefs.length !== expectedCheckRefs.length
      || loweredCheckRefs.some((ref, index) => ref !== expectedCheckRefs[index])) {
      return rejected("BUNDLE_DEPENDENCY_INVALID", [
        "bundle2:lowered-check-step-disagrees-with-owner",
      ]);
    }

    const bundleProposalRef = `proposal:${canonicalHash({
      schema: VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA,
      rootActionId: input.rootActionId,
      contextHash,
      referenceNamespaceHash: plan.referenceNamespaceHash,
      ordinal: -1,
      kind: "atomicBundle",
    }).slice("sha256:".length, "sha256:".length + 32)}`;

    return acceptedCommand({
      kind: "rulesStep",
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      formId: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
      proposalRef: bundleProposalRef,
      ruling: ruling.kind,
      rulesInput: {
        kind: "applyAtomicWorldInteractionSteps",
        rootActionId: input.rootActionId,
        actorCharacterId: input.actorCharacterId,
        // Must equal every child materialization step's own plan.bundleHash
        // (see lowerMaterializeObjectEntryV2 below) -- Rules' atomic
        // compiler checks the two for equality.
        bundleHash: plan.referenceNamespaceHash,
        contextHash,
        sharedRuling: ruling.kind,
        steps,
      },
    });
  } catch {
    return rejected("PROPOSAL_BUNDLE_INVALID", ["bundle2:lowering-input-invalid"]);
  }
}

function lowerTerminal(
  input: VNext2ProposalBundleLoweringInput,
  terminal: VNextClarificationTerminal | VNextInWorldRefusalTerminal,
  contextHash: string,
): VNext2ProposalBundleLoweringResult {
  const bundleHash = canonicalHash({
    schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
    kind: "proposalBundle",
    mode: "terminal",
    terminal,
  });
  const proposalRef = `proposal:${canonicalHash({
    schema: VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA,
    rootActionId: input.rootActionId,
    contextHash,
    referenceNamespaceHash: bundleHash,
    ordinal: 0,
    kind: "terminal",
  }).slice("sha256:".length, "sha256:".length + 32)}`;

  if (terminal.kind === "clarification") {
    const pendingInputId = `pending:vnext2:${canonicalHash({
      rootActionId: input.rootActionId,
      contextHash,
      proposalRef,
      question: terminal.question,
      choices: terminal.choices,
    }).slice("sha256:".length, "sha256:".length + 32)}`;
    return acceptedCommand({
      kind: "pendingClarification",
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      proposalRef,
      pendingInputId,
      question: terminal.question,
      choices: terminal.choices.map((choice) => ({
        choiceId: choice.choiceId,
        label: choice.label,
        publicRisk: choice.publicRisk,
        basisRefs: [...choice.basisRefs],
      })),
    });
  }

  // kind === "inWorldRefusal"
  const costValidation = validateAttemptCosts(
    { value: input.value, requiredContext: input.requiredContext, state: input.state,
      rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId },
    terminal.ruling.attemptCosts,
  );
  if (costValidation.length > 0) return rejected("COST_INVALID", costValidation);
  const viewerRefs = requiredContextViewerRefs(input.requiredContext);
  const hiddenPrerequisites = terminal.ruling.prerequisites
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
    proposalRef,
    formId: VNEXT_IN_WORLD_REFUSAL_FORM_ID,
    intent: terminal.intent,
    method: terminal.method,
    ruling: terminal.ruling,
    basisRefs: [],
  });
}

function lowerExecutableEntry(
  input: VNext2ProposalBundleLoweringInput,
  entry: VNextProposalBundleEntry,
  derivedEntry: VNextDerivedBundleEntry,
  plan: VNextDerivedBundlePlan,
  sharedRuling: VNextDirectSuccessRuling | VNextCheckRuling,
): VNext2EntryLoweringResult {
  if (entry.kind === "materializeObject") {
    return lowerMaterializeObjectEntryV2(input, entry, derivedEntry, plan);
  }
  if (entry.kind === "worldInteraction") {
    return lowerWorldInteractionEntryV2(input, entry, derivedEntry, plan, sharedRuling);
  }
  // reviseSemanticDefinition: never reachable through the live strict-tool
  // transport (SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA only offers materializeObject
  // and worldInteraction items) and not wired here -- fail closed rather
  // than guess a Rules mapping for a shape nothing can currently produce.
  return {
    kind: "rejected",
    code: "BUNDLE_LOWERING_UNSUPPORTED",
    issues: ["bundle2:revise-semantic-definition-not-supported"],
  };
}

/**
 * Lowers a materializeObject entry to a materializeSemanticDefinition Rules
 * input, mirroring lowerMaterializeObjectEntry in proposal-bundle.ts for
 * vnext-1. The explicit equality assertion below is the "agreement made
 * explicit" the task asked for: proposal-graph.ts's derived
 * `produces[].prospectiveRef` and Rules' own normalizedProspectiveRef are
 * not two independently-invented schemes that happen to agree -- they are
 * the identical function called with the identical three arguments
 * (rootActionId, referenceNamespaceHash, handle). Asserting it here makes a
 * future divergence between proposal-graph.ts and
 * rules/v2/semantic-definitions.ts fail closed instead of silently drifting.
 */
function lowerMaterializeObjectEntryV2(
  input: VNext2ProposalBundleLoweringInput,
  entry: VNextMaterializeObjectEntry,
  derivedEntry: VNextDerivedBundleEntry,
  plan: VNextDerivedBundlePlan,
): VNext2EntryLoweringResult {
  const produced = derivedEntry.produces;
  if (produced.length !== 1 || produced[0]?.kind !== "semanticDefinition") {
    return {
      kind: "rejected",
      code: "PROPOSAL_FORM_INVALID",
      issues: ["bundle2:materialize-object-requires-one-produced-handle"],
    };
  }
  const handle = produced[0].handle;
  const expectedProspectiveRef = normalizedProspectiveRef(
    input.rootActionId,
    plan.referenceNamespaceHash,
    handle,
  );
  if (expectedProspectiveRef !== produced[0].prospectiveRef) {
    return {
      kind: "rejected",
      code: "BUNDLE_DEPENDENCY_INVALID",
      issues: ["bundle2:prospective-ref-derivation-mismatch"],
    };
  }

  const dependencyRefs = [
    input.actorCharacterId,
    ...entry.basisRefs.filter((ref) => !LOCAL_HANDLE_PATTERN.test(ref)),
    ...(entry.definition.sceneRef === null ? [] : [entry.definition.sceneRef]),
    ...(entry.definition.visibilityFactId === null ? [] : [entry.definition.visibilityFactId]),
    ...entry.definition.mechanicDefinitionRefs,
  ];
  const planReadSet = selectPlanReadSet(input.requiredContext, dependencyRefs);
  if (planReadSet.kind === "rejected") return planReadSet;
  const content: JsonRecord = entry.semanticKind === "sceneFeature"
    ? {
        sceneRef: entry.definition.sceneRef,
        label: entry.definition.label,
        description: entry.definition.description,
        ...(entry.definition.mechanicDefinitionRefs.length > 0
          ? { mechanicDefinitionRefs: [...entry.definition.mechanicDefinitionRefs].sort() }
          : {}),
        observableState: entry.definition.observableState,
        affordances: [...entry.definition.affordances],
      }
    : {
        label: entry.definition.label,
        description: entry.definition.description,
        ...(entry.definition.visibilityFactId === null
          ? {}
          : { visibilityFactId: entry.definition.visibilityFactId }),
      };
  return {
    kind: "accepted",
    rulesInput: {
      kind: "materializeSemanticDefinition",
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      plan: {
        schema: "zhuwei.semantic-definition-materialization-plan/vnext-1",
        bundleHash: plan.referenceNamespaceHash,
        handle,
        semanticKind: entry.semanticKind,
        templateRef: entry.templateRef,
        templateHash: entry.templateHash,
        visibilityPolicyRef: entry.visibilityPolicyRef,
        contextHash: input.requiredContext.binding.contextHash,
        readSet: planReadSet.readSet,
        basisRefs: [...entry.basisRefs],
        sourceRefs: [],
        content,
        summary: entry.summary,
      },
    },
  };
}

/**
 * Lowers a worldInteraction entry by reusing the already-tested vnext-1
 * coarse-Form lowering (lowerVNextCoarseFormProposal), rather than
 * re-deriving ability costs, branch effects and read-set selection here.
 *
 * vnext-2 carries one shared ruling for the whole Bundle instead of a ruling
 * per entry, so that shared ruling is projected onto the per-entry vnext-1
 * envelope this seam expects. The two rulings project differently:
 *
 * - `check` projects field for field. The check parameters, risk and both
 *   outcome texts are the model's own, and the entry's failure branch is real
 *   and reachable -- the validator requires a check Bundle to carry exactly
 *   one worldInteraction with a non-null failure branch
 *   (`bundle:shared-check-shape-invalid`), so nothing is synthesized here.
 * - `directSuccess` has no failure to describe, so two fields must be
 *   synthesized to satisfy the reused envelope's stricter (vnext-1) shape.
 *   Both are structural, never narrative, and both are provably unread:
 *   `adjudication.failureOutcome` is never consulted on
 *   resolveWorldInteraction's directSuccess path (it builds a bare
 *   `{ kind: "directSuccess" }` ruling with no risk or outcome text at all),
 *   and the placeholder `branches.failure` exists only because the resolution
 *   plan type requires a non-null branch -- finalizeInteraction applies
 *   `branches.success` alone there, so it is never committed nor shown.
 */
function lowerWorldInteractionEntryV2(
  input: VNext2ProposalBundleLoweringInput,
  entry: VNextWorldInteractionEntry,
  derivedEntry: VNextDerivedBundleEntry,
  _plan: VNextDerivedBundlePlan,
  sharedRuling: VNextDirectSuccessRuling | VNextCheckRuling,
): VNext2EntryLoweringResult {
  if (derivedEntry.produces.length !== 0) {
    return {
      kind: "rejected",
      code: "PROPOSAL_FORM_INVALID",
      issues: ["bundle2:world-interaction-cannot-produce"],
    };
  }

  let adjudication: WorldInteractionAdjudication;
  let failureBranch: VNextWorldInteractionEntry["branches"]["success"];
  if (sharedRuling.kind === "check") {
    if (entry.branches.failure === null) {
      // Unreachable through validateVNextProposalBundle, which rejects this
      // shape upstream. Kept as a hard refusal because the alternative -- the
      // directSuccess placeholder below -- would quietly commit a no-op as the
      // player's failure outcome on a roll that really can fail.
      return {
        kind: "rejected",
        code: "PROPOSAL_FORM_INVALID",
        issues: ["bundle2:shared-check-requires-failure-branch"],
      };
    }
    adjudication = {
      kind: "check",
      checkKind: sharedRuling.checkKind,
      ability: sharedRuling.ability,
      skill: sharedRuling.skill,
      dc: sharedRuling.dc,
      mode: sharedRuling.mode,
      risk: sharedRuling.risk,
      successOutcome: sharedRuling.successOutcome,
      failureOutcome: sharedRuling.failureOutcome,
    };
    failureBranch = entry.branches.failure;
  } else {
    adjudication = {
      kind: "directSuccess",
      // The bundle's one shared adjudication carries the real risk text; each
      // entry itself has no per-entry ruling in vnext-2.
      risk: sharedRuling.risk,
      successOutcome: entry.branches.success.summary,
      failureOutcome: "此裁决不存在失败结果,此文本从不被读取或提交。",
    };
    failureBranch = entry.branches.failure ?? {
      outcomeCode: "outcome:vnext2-direct-success-no-failure-branch",
      summary: "此提案不会产生失败结果,该占位分支从不被应用。",
      effects: [],
      sensoryEvidence: [],
      pressures: [],
      opportunities: [],
    };
  }

  const envelope = {
    schema: VNEXT_KP_PROPOSAL_SCHEMA,
    kind: "vnextCoarseFormProposal",
    formId: VNEXT_WORLD_INTERACTION_FORM_ID,
    proposalRef: derivedEntry.entryRef,
    contextHash: input.requiredContext.binding.contextHash,
    basisRefs: entry.basisRefs,
    proposal: {
      kind: "worldInteraction",
      sceneRef: entry.sceneRef,
      targetRefs: entry.targetRefs,
      directTargetRefs: entry.directTargetRefs,
      instrumentRefs: entry.instrumentRefs,
      abilityRef: entry.abilityRef,
      intent: entry.intent,
      method: entry.method,
      adjudication,
      branches: {
        success: entry.branches.success,
        failure: failureBranch,
      },
    },
  };
  return lowerVNextCoarseFormProposal({
    value: envelope,
    requiredContext: input.requiredContext,
    state: input.state,
    rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId,
  });
}

function dependsOnFor(
  entry: VNextDerivedBundleEntry,
  plan: VNextDerivedBundlePlan,
): readonly string[] {
  const producerByHandle = new Map<string, string>();
  for (const candidate of plan.entries) {
    for (const produced of candidate.produces) producerByHandle.set(produced.handle, candidate.entryRef);
  }
  const deps = new Set<string>();
  for (const consume of entry.consumes) {
    if (consume.kind !== "prospective") continue;
    const producerRef = producerByHandle.get(consume.handle);
    if (producerRef !== undefined) deps.add(producerRef);
  }
  // A step bound to an outcome cannot be ordered before the roll that decides
  // that outcome, so the shared check owner is a real dependency edge and not
  // bookkeeping. Rules derives the identical edge independently
  // (compileAtomicWorldInteractionPlan adds sharedCheckProposalRef to every
  // conditional step's expected dependencies) and rejects the whole Bundle
  // when the two derivations disagree -- proposal-graph.ts already adds it
  // when it orders execution, and omitting it here made the emitted
  // `dependsOn` disagree with both.
  if (plan.sharedCheckEntryRef !== null
    && entry.outcomeBinding !== "always"
    && entry.entryRef !== plan.sharedCheckEntryRef) {
    deps.add(plan.sharedCheckEntryRef);
  }
  return [...deps].sort(compareCodeUnits);
}

function acceptedCommand(
  command: VNext2ProposalBundleCommand,
): VNext2ProposalBundleLoweringResult {
  return Object.freeze({ kind: "accepted", command });
}

function rejected(
  code: Extract<VNext2ProposalBundleLoweringResult, { kind: "rejected" }>["code"],
  issues: readonly string[],
): Extract<VNext2ProposalBundleLoweringResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    issues: Object.freeze([...new Set(issues)].sort(compareCodeUnits)),
  });
}
