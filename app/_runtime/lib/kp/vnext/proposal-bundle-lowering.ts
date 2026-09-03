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
  type VNextClarificationTerminal,
  type VNextDerivedBundleEntry,
  type VNextDerivedBundlePlan,
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
      ruling: "directSuccess";
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
 * command Room needs. This pass supports only the `directSuccess` shared
 * adjudication (single or multi-entry, atomic when more than one entry);
 * a bundle whose shared adjudication is `check` or `highRisk` is rejected
 * closed with BUNDLE_LOWERING_UNSUPPORTED -- see the module doc comment on
 * why that scope line was drawn here rather than guessed past.
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
    if (ruling.kind !== "directSuccess") {
      // The shared-check / highRisk paths need a dedicated confirmation and
      // shared-check-ownership consumer this pass does not build. Reject
      // closed with an accurate reason rather than half-lowering it -- see
      // section (c) of the report for why this line was drawn here.
      return rejected("BUNDLE_LOWERING_UNSUPPORTED", [
        ruling.kind === "check"
          ? "bundle2:shared-check-not-supported"
          : "bundle2:high-risk-not-supported",
      ]);
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
    if (plan.sharedCheckEntryRef !== null) {
      // A directSuccess adjudication can never legitimately produce a shared
      // check owner (sharedCheckOwner returns null whenever no check is
      // required); this can only mean the plan derivation diverged from the
      // ruling this function already gated on above.
      return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle2:shared-check-not-supported"]);
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
      const lowered = lowerExecutableEntry(input, sourceEntry, derivedEntry, plan, ruling.risk);
      if (lowered.kind === "rejected") return lowered;
      return acceptedCommand({
        kind: "rulesStep",
        rootActionId: input.rootActionId,
        actorCharacterId: input.actorCharacterId,
        formId: derivedEntry.formId,
        proposalRef: derivedEntry.entryRef,
        ruling: "directSuccess",
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
      const lowered = lowerExecutableEntry(input, sourceEntry, derivedEntry, plan, ruling.risk);
      if (lowered.kind === "rejected") return lowered;
      steps.push({
        formId: derivedEntry.formId,
        proposalRef: entryRef,
        ruling: "directSuccess",
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
      ruling: "directSuccess",
      rulesInput: {
        kind: "applyAtomicWorldInteractionSteps",
        rootActionId: input.rootActionId,
        actorCharacterId: input.actorCharacterId,
        // Must equal every child materialization step's own plan.bundleHash
        // (see lowerMaterializeObjectEntryV2 below) -- Rules' atomic
        // compiler checks the two for equality.
        bundleHash: plan.referenceNamespaceHash,
        contextHash,
        sharedRuling: "directSuccess",
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
  sharedRisk: string,
): VNext2EntryLoweringResult {
  if (entry.kind === "materializeObject") {
    return lowerMaterializeObjectEntryV2(input, entry, derivedEntry, plan);
  }
  if (entry.kind === "worldInteraction") {
    return lowerWorldInteractionEntryV2(input, entry, derivedEntry, plan, sharedRisk);
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
 * Two fields must be synthesized to satisfy that reused seam's stricter
 * (vnext-1) shape, and both are documented loudly rather than left implicit:
 *
 * - `adjudication.failureOutcome`: vnext-2's directSuccess ruling
 *   deliberately has no model-authored failure outcome text (a ruling that
 *   cannot fail should not require the model to invent one). The reused
 *   envelope's type still requires the field, but resolveWorldInteraction's
 *   directSuccess path never reads it -- see world-interactions.ts's
 *   `ruling.kind === "directSuccess"` branch, which builds a bare
 *   `{ kind: "directSuccess" }` ruling with no risk/outcome text at all.
 * - `branches.failure`: same reasoning, structural not narrative. A no-op
 *   placeholder branch (no effects, no evidence, no pressures, no
 *   opportunities) is supplied only because WorldInteractionResolutionPlan's
 *   type requires a non-null failure branch; it is provably unreachable
 *   under a directSuccess ruling (finalizeInteraction only ever applies
 *   plan.branches.success there) and is never committed or shown to anyone.
 */
function lowerWorldInteractionEntryV2(
  input: VNext2ProposalBundleLoweringInput,
  entry: VNextWorldInteractionEntry,
  derivedEntry: VNextDerivedBundleEntry,
  _plan: VNextDerivedBundlePlan,
  sharedRisk: string,
): VNext2EntryLoweringResult {
  if (derivedEntry.produces.length !== 0) {
    return {
      kind: "rejected",
      code: "PROPOSAL_FORM_INVALID",
      issues: ["bundle2:world-interaction-cannot-produce"],
    };
  }
  const adjudication: WorldInteractionAdjudication = {
    kind: "directSuccess",
    // The bundle's one shared adjudication carries the real risk text; each
    // entry itself has no per-entry ruling in vnext-2.
    risk: sharedRisk,
    successOutcome: entry.branches.success.summary,
    failureOutcome: "此裁决不存在失败结果,此文本从不被读取或提交。",
  };
  const failureBranch = entry.branches.failure ?? {
    outcomeCode: "outcome:vnext2-direct-success-no-failure-branch",
    summary: "此提案不会产生失败结果,该占位分支从不被应用。",
    effects: [],
    sensoryEvidence: [],
    pressures: [],
    opportunities: [],
  };
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
