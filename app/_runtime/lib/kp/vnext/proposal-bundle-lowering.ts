import { NPC_MATERIALIZATION_PLAN_SCHEMA, npcMaterializationEntityRef } from "../../rules/v2/npc-materialization";
import { expandStorySelections, lowerStoryFactSelection, StoryMaterializationError, type StoryMaterialSelection } from "./story-materialization";
import { promiseTermsRefs } from "../../rules/v2/promise-lifecycle";
import { socialPromiseSubjectAdmissible } from "../../rules/v2/social-interaction";
import { ABILITY_OPERATION_PLAN_SCHEMA, ABILITY_OPERATION_FORM_ID, abilityOperationReadRefs } from "../../rules/v2/ability-operation";
import { NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA, npcActorPlanFormationIds,
  npcActorPlanFormationPremiseRef, npcActorPlanFormationResourceRefs, npcActorPlanFormationReadRefs,
  isNpcActorPlanFormationPlan } from "../../rules/v2/npc-plan-formation";
import { TIME_PASSAGE_PLAN_SCHEMA, timePassageStartReadRefs } from "../../rules/v2/time-passage";
import { activeEncounter } from "../../rules/v2/combat-encounters";
import { actionActivityCompletionRoot } from "../../rules/v2/activity-progress";
import { isItemAssemblyOperation } from "../../rules/v2/item-assembly-shapes";
import { itemAssemblyReadRefs } from "../../rules/v2/item-assemblies";
import type { RuntimeProfileManifest } from "../../rules/profiles/types";
import { FROZEN_PLAYER_CHOICE_SCHEMA, type FrozenPlayerChoicePlan } from "../../rules/v2/frozen-player-choice";
import { ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA, IN_WORLD_ACT_FORM_IDS, isAtomicWorldInteractionStepsPlan } from "../../rules/v2/world-interaction-model";
import { lowerFeasibilityPlan } from "./feasibility-lowering";
import { authoredWorldFactConform, worldFactConstraints, worldFactConstraintsRef } from "../../rules/v2/world-facts";
import { socialListeners, socialThreadRef, type SocialInteractionPlan } from "../../rules/v2/social-interaction";
import { npcDecisionContext, npcDecisionEvidenceRef, npcDecisionLoadedKnowledge } from "./context/npc-decision";
import { observationKnowledgeIssue } from "../../rules/v2/character-inference";
import type { WorldInteractionResolutionPlan } from "../../rules/v2/world-interaction-model";
import { KNOWLEDGE_REVIEW_PLAN_SCHEMA } from "../../rules/v2/knowledge-review";
import { authorityKnowledgeCatalog } from "../../rules/v2/authority-bindings";
import { authoredReferenceSlots } from "./authored-proposal-contract";
import { narrativeSourceRefs, narrativeMaterializationPolicy, narrativeMaterializationIssue,
  narrativeDetailVisibleTo, narrativeMaterializedRef,
  NARRATIVE_DETAIL_PLAN_SCHEMA } from "../../rules/v2/narrative-commitments";
import { materializationAuthorityBasis } from "./materialization-authority";
import { composeSemanticTemplate } from "../../rules/profiles/semantic-templates";
import { composeDefinition, isStoredSemanticDefinition, semanticDefinitionSnapshot, storedSemanticDefinition, type SemanticJsonRecord } from "../../rules/v2/semantic-definitions";
import { OBJECT_COMPLETION_FIELDS, objectCompletionOperations } from "../../rules/v2/object-completion";
import { SEMANTIC_DEFINITION_REVISION_PLAN_SCHEMA } from "../../rules/v2/world-interaction-model";
import {
  canonicalHash,
  isPlainRecord,
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
import { selectFeasibilityReadSet, validateAttemptCosts } from "./proposal-bundle";
import { deriveVNextProposalBundlePlan } from "./proposal-graph";
import { validateVNextProposalBundle } from "./proposal-validator";
import { diagnosticActual, proposalDiagnostic, type ProposalDiagnostic } from "./proposal-diagnostics";
import { socialResultArgumentDiagnostics } from "./proposal-filling-interface";
import { proposalItemEntryRefs, proposalNpcSourceChoices, proposalObservationSubjectRefs } from "./proposal-context";
import { requiredContextViewerRefs } from "./required-context-runtime";
import type { VNextRequiredContext } from "./required-context";
import {
  authorityRefBoundToScene,
  normalizedProspectiveRef,
  type AuthoritativeWorldState,
  type JsonRecord,
} from "../../rules/authority-read";
import {
  VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  VNEXT_INVENTORY_OPERATION_FORM_ID,
  VNEXT_OBSERVE_FORM_ID,
  VNEXT_SOCIAL_FORM_ID,
  VNEXT_OBJECTIVE_CONTINUITY_FORM_ID,
  type VNextFormActorPlanEntry,
  type VNextSocialEntry,
  type VNextObserveEntry,
  VNEXT_CLARIFICATION_FORM_ID,
  VNEXT_IN_WORLD_REFUSAL_FORM_ID,
  VNEXT_PROPOSAL_BUNDLE_PLAN_SCHEMA,
  type VNextCheckRuling,
  type VNextKnowledgeReviewTerminal,
  type VNextPassTimeTerminal,
  type VNextAbilityOperationTerminal,
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
        | typeof VNEXT_INVENTORY_OPERATION_FORM_ID
        | typeof VNEXT_OBSERVE_FORM_ID
        | typeof VNEXT_SOCIAL_FORM_ID
        | typeof VNEXT_OBJECTIVE_CONTINUITY_FORM_ID
        | typeof VNEXT2_PROPOSAL_BUNDLE_SCHEMA;
      proposalRef: string;
      ruling: "directSuccess" | "check";
      rulesInput: JsonRecord;
    }>
  | Readonly<{
      kind: "frozenPlayerChoice";
      rootActionId: string;
      actorCharacterId: string;
      proposalRef: string;
      plan: FrozenPlayerChoicePlan;
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
      contextHash: string;
      readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
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
      diagnostics?: readonly ProposalDiagnostic[];
    }>;

export type VNext2ProposalBundleLoweringInput = Readonly<{
  value: unknown;
  requiredContext: VNextRequiredContext;
  state: AuthoritativeWorldState;
  /** Trusted Room manifest; required when freezing player choices. */
  profiles?: RuntimeProfileManifest;
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
      diagnostics?: readonly ProposalDiagnostic[];
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
  const result = lowerBundle(input);
  return result.kind === "rejected" && result.diagnostics !== undefined
    ? { ...result, diagnostics: socialResultArgumentDiagnostics(input.value, result.diagnostics) } : result;
}

function lowerBundle(input: VNext2ProposalBundleLoweringInput,
  branch?: Readonly<{ derivationScope: string }>): VNext2ProposalBundleLoweringResult {
  try {
    const validated = validateVNextProposalBundle(input.value);
    if (validated.kind === "rejected") return validated;
    if (!isNonEmptyString(input.rootActionId)
      || !isNonEmptyString(input.actorCharacterId)
      || input.requiredContext.binding.rootActionId !== input.rootActionId
      || input.requiredContext.intent.actorRef !== input.actorCharacterId) {
      return rejected("CONTEXT_INSUFFICIENT", ["bundle2:context-binding-mismatch"]);
    }
    let bundle = validated.bundle;
    let storyMaterials: readonly StoryMaterialSelection[] = [];
    const hasStorySelections = bundle.mode === "adjudication" && bundle.proposals.some(entry => entry.kind === "materializeStory" || entry.kind === "admitStoryFacts");
    if (bundle.mode === "adjudication" && hasStorySelections) {
      const expansion = expandStorySelections(bundle, input.requiredContext);
      const checked = validateVNextProposalBundle(expansion.bundle);
      if (checked.kind === "rejected") return checked;
      bundle = checked.bundle;
      storyMaterials = expansion.materials;
    }
    const contextHash = input.requiredContext.binding.contextHash;
    const narrativeMaterializationRefs = input.requiredContext.intent.narrativeMaterializationRefs ?? [];
    if (narrativeMaterializationRefs.some(ref => !narrativeDetailVisibleTo(input.state, ref, input.actorCharacterId)
      || narrativeMaterializedRef(input.state, ref) !== undefined)) {
      return rejected("CONTEXT_INSUFFICIENT", ["narrative:materialization-obligation-state-changed"]);
    }

    if (bundle.mode === "terminal") {
      if (bundle.terminal.kind !== "knowledgeReview" && bundle.terminal.kind !== "passTime" && bundle.terminal.kind !== "clarification" && narrativeMaterializationRefs.length > 0) return rejected("PROPOSAL_REFERENCE_INVALID", ["narrative:materialization-required-before-terminal"]);
      return lowerTerminal(input, bundle.terminal, contextHash, bundle.basisRefs);
    }

    const mandatoryMaterializerOrdinals = new Set<number>();
    for (const ref of narrativeMaterializationRefs) {
      const sources = bundle.proposals.flatMap((entry, ordinal) =>
        (entry.kind === "materializeObject" || entry.kind === "materializeItem")
          && (entry.basisRefs.includes(ref) || entry.consumes.some(consume => consume.kind === "existing" && consume.ref === ref))
          ? [{ ordinal, outcomeBinding: entry.outcomeBinding }] : []);
      if (sources.length !== 1 || sources[0].outcomeBinding !== "always") {
        return rejected("PROPOSAL_REFERENCE_INVALID", ["narrative:every-required-commitment-needs-one-unconditional-materializer"]);
      }
      mandatoryMaterializerOrdinals.add(sources[0].ordinal);
    }

    // mode === "adjudication"
    const ruling = bundle.adjudication;
    if (ruling.kind === "highRisk") {
      return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["bundle2:high-risk-not-supported"]);
    }

    // Derive the child's identities before lowering any proposal or handle.
    // The authenticated parent context was checked above. Only this private
    // lowering view changes its execution root; model references stay intact.
    const activityRoot = ["player", "npc"].includes(input.state.entities[input.actorCharacterId]?.kind)
      && (ruling.kind === "directSuccess" || ruling.kind === "check") && ruling.durationMicros !== "0"
      ? input.rootActionId : undefined;
    if (activityRoot !== undefined) {
      const completionRoot = actionActivityCompletionRoot(activityRoot);
      input = { ...input, rootActionId: completionRoot, requiredContext: { ...input.requiredContext,
        binding: { ...input.requiredContext.binding, rootActionId: completionRoot } } };
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
      ...(branch === undefined ? {} : { derivationScope: branch.derivationScope }),
    });
    if (planResult.kind === "rejected") {
      return rejected("BUNDLE_DEPENDENCY_INVALID", planResult.issues, planResult.diagnostics);
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

    // A lone entry may skip the atomic Bundle only when the character does
    // nothing in the world: a bare Rules step has nowhere to spend the act's
    // frozen duration, so every in-world act -- a solo conversation included
    // -- takes the atomic path below and pays its time there.
    if (branch === undefined && !hasStorySelections && plan.entries.length === 1 && narrativeMaterializationRefs.length === 0
      && bundle.proposals[0]?.kind !== "formActorPlan" && !IN_WORLD_ACT_FORM_IDS.has(plan.entries[0]!.formId)) {
      if (ruling.durationMicros !== "0") return rejected("PROPOSAL_FORM_INVALID", ["bundle2:duration-forbidden-for-pure-authoring"]);
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
      const lowered = lowerExecutableEntry(input, sourceEntry, derivedEntry, plan, ruling, storyMaterials);
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
    let completedObjectState = input.state;
    for (const entryRef of plan.executionOrder) {
      const derivedEntry = entryByRef.get(entryRef);
      if (derivedEntry === undefined) {
        return rejected("BUNDLE_DEPENDENCY_INVALID", ["bundle2:execution-order-unbound"]);
      }
      const sourceEntry = bundle.proposals[derivedEntry.ordinal]!;
      // Compose later action effects from the same frozen authored prelude.
      // This is private compilation, not a state write: read sets still bind
      // the original RequiredContext and Rules revalidates every completion.
      const lowered = lowerExecutableEntry(IN_WORLD_ACT_FORM_IDS.has(derivedEntry.formId)
        ? { ...input, state: completedObjectState } : input, sourceEntry, derivedEntry, plan, ruling, storyMaterials);
      if (lowered.kind === "rejected") return lowered;
      if (sourceEntry.kind === "completeObject") {
        const prior = input.state.campaignRuntime.definitions[sourceEntry.definitionRef];
        if (!isStoredSemanticDefinition(prior)) return rejected("DEFINITION_CONFLICT", ["object-completion:base-unavailable"]);
        const composed = composeDefinition({ base: semanticDefinitionSnapshot(prior)!, expectedRevision: prior.revision,
          expectedHash: prior.definitionHash, allowlist: OBJECT_COMPLETION_FIELDS,
          operations: objectCompletionOperations(prior.content, sourceEntry.description, sourceEntry.observableState) });
        if (composed.kind === "rejected") return rejected("PROPOSAL_FORM_INVALID", composed.issues);
        const next = storedSemanticDefinition(prior.semanticKind, prior.visibilityPolicyRef, composed.snapshot,
          { templateRef: prior.templateRef, templateHash: prior.templateHash });
        completedObjectState = { ...completedObjectState, campaignRuntime: { ...completedObjectState.campaignRuntime,
          definitions: { ...completedObjectState.campaignRuntime.definitions, [sourceEntry.definitionRef]: next } } };
      }
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
    const mandatoryMaterializers = plan.entries.filter(entry => mandatoryMaterializerOrdinals.has(entry.ordinal)
      || entry.kind === "admitStoryFacts").map(entry => entry.entryRef);
    for (const step of steps) {
      const kind = (step.rulesInput as JsonRecord).kind;
      if (kind === "resolveWorldInteraction" || kind === "inventoryOperation" || kind === "reviseSemanticDefinition") {
        step.dependsOn = [...new Set([...(step.dependsOn as string[]), ...mandatoryMaterializers])];
      }
    }
    const orderedSteps: JsonRecord[] = [];
    const pendingSteps = [...steps];
    while (pendingSteps.length > 0) {
      const ready = pendingSteps.findIndex(step => (step.dependsOn as string[])
        .every(dependency => orderedSteps.some(prior => prior.proposalRef === dependency)));
      if (ready < 0) return rejected("BUNDLE_DEPENDENCY_INVALID", ["narrative:materialization-dependency-cycle"]);
      orderedSteps.push(pendingSteps.splice(ready, 1)[0]);
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

    // The shared ruling's duration is the act's own fictional time. It rides as
    // an execution cost so the existing cost emitter, suspension replay and
    // prefix accounting all see one FictionTimeAdvanced ahead of the results.
    // A bundle that only authors world content is not the character doing
    // anything and must say "0"; a bundle in which the character acts cannot.
    // Inside an active Encounter the turn economy already carries the act's
    // time and the clock moves only by rounds; a frozen tier there would jump
    // the scene clock mid-round and expire timed effects against the round
    // count. The KP says "none" in combat; the tier is never spent there.
    const inWorldAct = orderedSteps.some(step => IN_WORLD_ACT_FORM_IDS.has(String(step.formId)));
    const advances = ruling.durationMicros !== "0";
    const inEncounter = actorInActiveEncounter(input.state, input.actorCharacterId);
    if (inEncounter && advances) return rejected("PROPOSAL_FORM_INVALID", ["bundle2:duration-forbidden-in-encounter"]);
    if (!inEncounter && inWorldAct !== advances) return rejected("PROPOSAL_FORM_INVALID",
      [inWorldAct ? "bundle2:duration-required-for-in-world-act" : "bundle2:duration-forbidden-for-pure-authoring"]);
    let executionCosts: { costs: { kind: "fictionTime"; durationMicros: string }[]; readSet: readonly { ref: string; revisionOrHash: string }[] } | undefined;
    if (advances) {
      const read = selectPlanReadSet(input.requiredContext, [input.actorCharacterId, `character-timeline:${input.actorCharacterId}`]);
      if (read.kind === "rejected") return read;
      executionCosts = { costs: [{ kind: "fictionTime", durationMicros: ruling.durationMicros }], readSet: read.readSet };
    }

    const command: Extract<VNext2ProposalBundleCommand, { kind: "rulesStep" }> = {
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
        ...(narrativeMaterializationRefs.length === 0 ? {} : { narrativeMaterializationRefs: [...narrativeMaterializationRefs] }),
        ...(executionCosts === undefined ? {} : { executionCosts }),
        steps: orderedSteps,
      },
    };
    return acceptedCommand(activityRoot === undefined ? command : { ...command, rootActionId: activityRoot,
      rulesInput: { kind: "startActionActivity", rootActionId: activityRoot, actorCharacterId: input.actorCharacterId,
        completionInput: command.rulesInput } });
  } catch (error) {
    if (error instanceof StoryMaterializationError) return rejected("PROPOSAL_REFERENCE_INVALID", [error.issue]);
    return structuredLoweringFailure(error)
      ?? rejected("PROPOSAL_BUNDLE_INVALID", ["bundle2:lowering-input-invalid"]);
  }
}

function lowerTerminal(
  input: VNext2ProposalBundleLoweringInput,
  terminal: VNextClarificationTerminal | VNextInWorldRefusalTerminal | VNextKnowledgeReviewTerminal | VNextPassTimeTerminal | VNextAbilityOperationTerminal,
  contextHash: string,
  terminalBasisRefs: readonly string[],
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

  if (terminal.kind === "abilityOperation") {
    const refs = abilityOperationReadRefs(input.state, input.actorCharacterId, terminal.operation);
    if (refs === undefined) return rejected("PROPOSAL_REFERENCE_INVALID", ["ability:owned-operation-unavailable"]);
    const selected = selectPlanReadSet(input.requiredContext, refs);
    if (selected.kind === "rejected") return selected;
    const visible = requiredContextViewerRefs(input.requiredContext);
    if (terminal.operation.kind === "invoke" && terminal.operation.target.kind === "creatures"
      && terminal.operation.target.refs.some(ref => !visible.has(ref))) {
      return rejected("PROPOSAL_REFERENCE_INVALID", ["ability:target-not-in-frozen-viewer-context"]);
    }
    return acceptedCommand({ kind: "rulesStep", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
      formId: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, proposalRef, ruling: "directSuccess", rulesInput: {
        kind: "applyAtomicWorldInteractionSteps", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
        bundleHash, contextHash, sharedRuling: "directSuccess", steps: [{ formId: ABILITY_OPERATION_FORM_ID,
          proposalRef, ruling: "directSuccess", outcomeBinding: "always", consumes: [], produces: [], dependsOn: [],
          rulesInput: { kind: "performAbilityOperation", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
            plan: { schema: ABILITY_OPERATION_PLAN_SCHEMA, contextHash, readSet: selected.readSet, operation: structuredClone(terminal.operation) } } }],
      } });
  }
  if (terminal.kind === "passTime") {
    const refs = timePassageStartReadRefs(input.state, input.actorCharacterId);
    if (refs === undefined) return rejected("CONTEXT_INSUFFICIENT", ["time-passage:actor-context-unavailable"]);
    const selected = selectPlanReadSet(input.requiredContext, refs);
    if (selected.kind === "rejected") return selected;
    return acceptedCommand({ kind: "rulesStep", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
      formId: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, proposalRef, ruling: "directSuccess", rulesInput: {
        kind: "startTimePassage", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
        plan: { schema: TIME_PASSAGE_PLAN_SCHEMA, contextHash, readSet: selected.readSet,
          activityId: `activity:time-passage:${input.rootActionId}`, intendedDurationMicros: terminal.durationMicros,
          method: input.requiredContext.intent.text },
      } });
  }
  if (terminal.kind === "knowledgeReview") {
    const catalogRef = `knowledge-catalog:${input.actorCharacterId}`;
    const catalog = input.requiredContext.entries.find(entry => entry.kind === "known" && entry.entryRef === catalogRef);
    const expected = authorityKnowledgeCatalog(input.state, input.actorCharacterId);
    if (catalog?.kind !== "known" || expected === undefined || canonicalHash(expected) !== catalog.revisionOrHash
      || canonicalHash(catalog.value) !== catalog.revisionOrHash) return rejected("CONTEXT_INSUFFICIENT", ["knowledge:complete-held-catalog-not-frozen"]);
    const selected = terminal.scope === "allKnown" ? expected.records.map(record => record.knowledgeRef) : [...terminal.knowledgeRefs].sort();
    const records = selected.map(ref => expected.records.find(record => record.knowledgeRef === ref));
    if (records.some(record => record === undefined)) return rejected("PROPOSAL_REFERENCE_INVALID", ["knowledge:reference-not-held"]);
    for (const record of records) {
      const entry = input.requiredContext.entries.find(entry => entry.kind === "known" && entry.entryRef === record!.recordRef);
      if (entry?.kind !== "known" || entry.revisionOrHash !== record!.recordHash || canonicalHash(entry.value) !== record!.recordHash) {
        return rejected("CONTEXT_INSUFFICIENT", ["knowledge:selected-held-record-not-frozen"]);
      }
    }
    const selectedReadSet = selectPlanReadSet(input.requiredContext, [input.actorCharacterId, catalogRef, ...records.map(record => record!.recordRef)]);
    if (selectedReadSet.kind === "rejected") return selectedReadSet;
    return acceptedCommand({ kind: "rulesStep", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
      formId: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, proposalRef, ruling: "directSuccess", rulesInput: {
        kind: "knowledgeReview", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
        plan: { schema: KNOWLEDGE_REVIEW_PLAN_SCHEMA, contextHash, readSet: selectedReadSet.readSet,
          inquiry: terminal.inquiry, scope: terminal.scope, knowledgeRefs: selected },
      } });
  }
  if (terminal.kind === "clarification") {
    const pendingInputId = `pending:vnext2:${canonicalHash({
      rootActionId: input.rootActionId,
      contextHash,
      proposalRef,
      question: terminal.question,
      choices: terminal.choices,
    }).slice("sha256:".length, "sha256:".length + 32)}`;
    if (input.profiles === undefined) return rejected("CONTEXT_INSUFFICIENT", ["clarification:trusted-profiles-required"]);
    const outerHash = canonicalHash(input.value);
    const choices: FrozenPlayerChoicePlan["choices"][number][] = [];
    const basisRefs = new Set(terminalBasisRefs);
    for (const [choiceIndex, choice] of terminal.choices.entries()) {
      choice.basisRefs.forEach(ref => basisRefs.add(ref));
      const next = choice.continuation;
      if (next.kind === "cancel") {
        choices.push({ choiceId: choice.choiceId, label: choice.label, publicRisk: choice.publicRisk, continuation: next });
        continue;
      }
      next.basisRefs.forEach(ref => basisRefs.add(ref));
      const { kind, basisRefs: nextBasis, ...content } = next;
      const nested = kind === "adjudication"
        ? { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "adjudication",
            basisRefs: nextBasis, ...content, terminal: null }
        : { schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA, kind: "proposalBundle", mode: "terminal",
            basisRefs: nextBasis, adjudication: null, proposals: [], terminal: { kind, ...content } };
      const lowered = lowerBundle({ ...input, value: nested }, { derivationScope: `${outerHash}:${choice.choiceId}` });
      if (lowered.kind === "rejected") return { ...lowered,
        ...(lowered.diagnostics === undefined ? {} : { diagnostics: lowered.diagnostics.map(diagnostic => ({ ...diagnostic,
          ...(diagnostic.path === undefined ? {} : { path: ["terminal", "choices", choiceIndex, "continuation", ...diagnostic.path] }),
        })) }) };
      let continuation: FrozenPlayerChoicePlan["choices"][number]["continuation"];
      if (lowered.command.kind === "rulesStep" && ["applyAtomicWorldInteractionSteps", "startActionActivity"].includes(String(lowered.command.rulesInput.kind))) {
        const atomicInput = lowered.command.rulesInput.kind === "startActionActivity" ? lowered.command.rulesInput.completionInput as JsonRecord : lowered.command.rulesInput;
        const { kind: _commandKind, ...fields } = atomicInput;
        const plan = { schema: ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA, ...fields };
        if (!isAtomicWorldInteractionStepsPlan(plan)) return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["clarification:atomic-plan-invalid"]);
        continuation = { kind: "adjudication", plan };
      } else if (lowered.command.kind === "inWorldRefusal") {
        const plan = lowerFeasibilityPlan(lowered.command);
        if (plan === undefined) return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["clarification:refusal-cost-unsupported"]);
        continuation = { kind: "inWorldRefusal", plan };
      } else return rejected("BUNDLE_LOWERING_UNSUPPORTED", ["clarification:continuation-not-executable"]);
      choices.push({ choiceId: choice.choiceId, label: choice.label, publicRisk: choice.publicRisk, continuation });
    }
    const read = selectPlanReadSet(input.requiredContext, [input.actorCharacterId, ...basisRefs]);
    if (read.kind === "rejected") return read;
    return acceptedCommand({ kind: "frozenPlayerChoice", rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId, proposalRef, plan: {
        schema: FROZEN_PLAYER_CHOICE_SCHEMA, rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
        pendingInputId, contextHash, bundleHash: outerHash, profilesHash: canonicalHash(input.profiles),
        readSet: read.readSet, question: terminal.question, choices,
      } });
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
  const basisRefs = [...new Set([...terminalBasisRefs, ...terminal.ruling.nextActions.flatMap(action => action.basisRefs)])].sort(compareCodeUnits);
  const read = selectFeasibilityReadSet(input, basisRefs, terminal.ruling);
  if (read.kind === "rejected") return read;
  return acceptedCommand({
    kind: "inWorldRefusal",
    rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId,
    proposalRef,
    formId: VNEXT_IN_WORLD_REFUSAL_FORM_ID,
    intent: terminal.intent,
    method: terminal.method,
    ruling: terminal.ruling,
    basisRefs,
    contextHash,
    readSet: read.readSet,
  });
}

function lowerExecutableEntry(
  input: VNext2ProposalBundleLoweringInput,
  entry: VNextProposalBundleEntry,
  derivedEntry: VNextDerivedBundleEntry,
  plan: VNextDerivedBundlePlan,
  sharedRuling: VNextDirectSuccessRuling | VNextCheckRuling,
  storyMaterials: readonly StoryMaterialSelection[] = [],
): VNext2EntryLoweringResult {
  if (entry.kind === "materializeStory") return { kind: "rejected", code: "PROPOSAL_FORM_INVALID", issues: ["story:unexpanded-candidate-selector"] };
  if (entry.kind === "admitStoryFacts") return { kind: "accepted", rulesInput: lowerStoryFactSelection({
    context: input.requiredContext, state: input.state, rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
    entry, proposalRef: derivedEntry.entryRef, bundlePlan: plan, materials: storyMaterials }) };
  if (entry.kind === "formActorPlan") return lowerActorPlanFormationEntry(input, entry, derivedEntry);
  if (entry.kind === "completeObject") {
    const definition = input.state.campaignRuntime.definitions[entry.definitionRef];
    const sceneRef = input.state.entities[input.actorCharacterId]?.sceneId;
    const viewerRefs = new Set(requiredContextViewerRefs(input.requiredContext));
    if (!sceneRef || !isStoredSemanticDefinition(definition) || definition.semanticKind !== "sceneFeature"
      || !authorityRefBoundToScene(input.state, entry.definitionRef, sceneRef)
      || !viewerRefs.has(entry.definitionRef)) {
      return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: ["object-completion:visible-existing-scene-object-required"] };
    }
    const authority = materializationAuthorityBasis({ context: input.requiredContext, state: input.state,
      scopeRef: sceneRef, kind: "sceneFeature", createsInstance: false });
    if (authority.kind === "rejected") return authority;
    if (entry.basisRefs.some(ref => !viewerRefs.has(ref) && !authority.basisRefs.includes(ref))) {
      return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: ["object-completion:audience-inaccessible-basis"] };
    }
    const basisRefs = [...new Set([entry.definitionRef, ...entry.basisRefs, ...authority.basisRefs])].sort(compareCodeUnits);
    const selected = selectPlanReadSet(input.requiredContext, [input.actorCharacterId, ...basisRefs]);
    if (selected.kind === "rejected") return selected;
    return { kind: "accepted", rulesInput: { kind: "reviseSemanticDefinition", rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId, plan: { schema: SEMANTIC_DEFINITION_REVISION_PLAN_SCHEMA,
        semanticKind: "sceneFeature", definitionRef: entry.definitionRef, baseRevision: definition.revision,
        baseHash: definition.definitionHash, templateRef: definition.templateRef, templateHash: definition.templateHash,
        contextHash: input.requiredContext.binding.contextHash, basisRefs, readSet: selected.readSet,
        operations: objectCompletionOperations(definition.content, entry.description, entry.observableState), summary: entry.summary } } };
  }
  if (entry.kind === "commitNarrativeDetail") {
    const authority = materializationAuthorityBasis({ context: input.requiredContext, state: input.state,
      scopeRef: entry.sceneRef, kind: "sceneFeature" });
    if (authority.kind === "rejected") return authority;
    const viewerRefs = new Set(requiredContextViewerRefs(input.requiredContext));
    if (entry.sceneRef !== input.state.entities[input.actorCharacterId]?.sceneId
      || entry.basisRefs.some(ref => !viewerRefs.has(ref))) return {
        kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: ["narrative:visible-current-scene-basis-required"],
      };
    const selected = selectPlanReadSet(input.requiredContext, [input.actorCharacterId, entry.sceneRef, ...entry.basisRefs, ...authority.basisRefs]);
    if (selected.kind === "rejected") return selected;
    return { kind: "accepted", rulesInput: { kind: "commitNarrativeDetail", rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId, plan: { schema: NARRATIVE_DETAIL_PLAN_SCHEMA, proposalRef: derivedEntry.entryRef,
        contextHash: input.requiredContext.binding.contextHash, sceneRef: entry.sceneRef, label: entry.label, description: entry.description,
        audience: entry.audience, basisRefs: [...entry.basisRefs], authorizationRefs: authority.basisRefs, readSet: selected.readSet } } };
  }
  if (entry.kind === "materializeNpc") {
    const authority = materializationAuthorityBasis({ context: input.requiredContext, state: input.state,
      scopeRef: entry.sceneRef, kind: "npc" });
    if (authority.kind === "rejected") return authority;
    const produced = derivedEntry.produces[0];
    if (derivedEntry.produces.length !== 1 || produced?.kind !== "entity") return { kind: "rejected", code: "BUNDLE_DEPENDENCY_INVALID", issues: ["npc:one-entity-producer-required"] };
    const refs = [input.actorCharacterId, entry.sceneRef, `character-timeline:${input.actorCharacterId}`,
      ...entry.basisRefs, ...authority.basisRefs,
      ...entry.source.mechanicalTemplate.intrinsicAbilityRefs.filter(ref => !LOCAL_HANDLE_PATTERN.test(ref)),
      ...entry.source.mechanicalTemplate.itemDefinitionRefs.filter(ref => !LOCAL_HANDLE_PATTERN.test(ref))];
    const selected = selectPlanReadSet(input.requiredContext, refs);
    if (selected.kind === "rejected") return selected;
    return { kind: "accepted", rulesInput: { kind: "materializeNpc", rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId, plan: { schema: NPC_MATERIALIZATION_PLAN_SCHEMA,
        contextHash: input.requiredContext.binding.contextHash, prospectiveRef: npcMaterializationEntityRef(produced.prospectiveRef),
        sceneRef: entry.sceneRef, source: entry.source, basisRefs: [...new Set([...entry.basisRefs, entry.sceneRef])].sort(),
        authorizationRefs: authority.basisRefs, readSet: selected.readSet, visibilityPolicyRef: entry.visibilityPolicyRef } } };
  }
  if (entry.kind === "materializeObject") {
    return lowerMaterializeObjectEntryV2(input, entry, derivedEntry, plan);
  }
  if (entry.kind === "materializeDefinition" || entry.kind === "materializeItem" || entry.kind === "inventoryOperation") {
    return lowerAuthoredEntry(input, entry, plan);
  }
  if (entry.kind === "social") return sourceReferenceDiagnostics(lowerSocialEntry(input, entry, derivedEntry, plan, sharedRuling), entry, derivedEntry.ordinal);
  if (entry.kind === "observe") return sourceReferenceDiagnostics(lowerObserveEntry(input, entry, derivedEntry, plan, sharedRuling), entry, derivedEntry.ordinal);
  if (entry.kind === "worldInteraction") {
    return sourceReferenceDiagnostics(lowerWorldInteractionEntryV2(input, entry, derivedEntry, plan, sharedRuling), entry, derivedEntry.ordinal);
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

/** Map only the exact reference slots created by the lowering above back to
 * the validated draft. Other diagnostics already name their original source. */
function sourceReferenceDiagnostics(result: VNext2EntryLoweringResult,
  source: VNextWorldInteractionEntry | VNextObserveEntry | VNextSocialEntry,
  ordinal: number): VNext2EntryLoweringResult {
  if (result.kind !== "rejected" || result.diagnostics === undefined) return result;
  const diagnostics = result.diagnostics.flatMap(detail => {
    if (detail.constraint === "proposal:basis-ref-not-authorized" || detail.constraint === "proposal:basis-ref-not-read-bound") {
      // Coarse root bases include server-derived unions. Locate only explicit
      // typed source slots; never label a synthesized field as model input.
      const ref = isPlainRecord(detail.actual) ? detail.actual.value : undefined;
      const paths: (string | number)[][] = [];
      const collect = (refs: readonly string[], path: (string | number)[]) => {
        refs.forEach((value, index) => { if (value === ref) paths.push([...path, index]); });
      };
      collect(source.basisRefs, ["basisRefs"]);
      if (source.kind === "observe") collect(source.existingFactRefs, ["existingFactRefs"]);
      if (source.kind !== "social") for (const branchName of ["success", "failure"] as const) {
        const branch = source.branches[branchName];
        if (!branch) continue;
        branch.sensoryEvidence.forEach((item, index) => collect(item.basisRefs,
          ["branches", branchName, "sensoryEvidence", index, "basisRefs"]));
        if (source.kind === "worldInteraction") for (const field of ["pressures", "opportunities"] as const) {
          source.branches[branchName]?.[field].forEach((item, index) => collect(item.basisRefs,
            ["branches", branchName, field, index, "basisRefs"]));
        }
      }
      const { path: _derivedPath, ...unlocated } = detail;
      return paths.length ? paths.map(path => ({ ...detail, path: ["proposals", ordinal, ...path] })) : [unlocated];
    }
    if (detail.path?.[0] !== "proposal") return detail;
    let relative = detail.path.slice(1);
    if (relative[0] === "targetRefs" || relative[0] === "directTargetRefs") {
      if (source.kind === "observe") relative = source.focusRefs.length
        ? ["focusRefs", ...relative.slice(1)] : ["sceneRef"];
      if (source.kind === "social") relative = ["npcRef"];
    }
    return { ...detail, path: ["proposals", ordinal, ...relative] };
  });
  return { ...result, diagnostics: [...new Map(diagnostics.map(detail => [canonicalHash(detail), detail])).values()] };
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

  const authority = materializationAuthorityBasis({ context: input.requiredContext, state: input.state,
    scopeRef: entry.definition.sceneRef ?? input.state.entities[input.actorCharacterId]?.sceneId,
    kind: entry.semanticKind, templateRef: entry.templateRef });
  if (authority.kind === "rejected") return authority;
  const creationBasis = [...new Set([...entry.basisRefs, ...entry.consumes.flatMap(ref => ref.kind === "existing" ? [ref.ref] : []), ...authority.basisRefs,
    ...(entry.definition.passage ? [entry.definition.passage.fromLocationRef, entry.definition.passage.toLocationRef] : []),
  ])].sort(compareCodeUnits);
  const sourceRefs = narrativeSourceRefs(input.state, [...entry.basisRefs,
    ...entry.consumes.flatMap(reference => reference.kind === "existing" ? [reference.ref] : [])]);
  const visibilityPolicyRef = narrativeMaterializationPolicy(input.state, { sourceRefs,
    actorCharacterId: input.actorCharacterId, requestedPolicy: entry.visibilityPolicyRef });
  if (visibilityPolicyRef === undefined) return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: ["narrative:source-audience-required"] };
  const narrativeIssue = narrativeMaterializationIssue(input.state, { sourceRefs, actorCharacterId: input.actorCharacterId,
    sceneRef: entry.definition.sceneRef ?? "", label: entry.definition.label, description: entry.definition.description, visibilityPolicyRef });
  if (narrativeIssue !== undefined) return { kind: "rejected", code: "DEFINITION_CONFLICT", issues: [narrativeIssue] };
  const worldFact = entry.definition.worldFact;
  const factBindings: { ref: string; revisionOrHash: string }[] = [];
  if (entry.semanticKind === "worldFact") {
    if (!authoredWorldFactConform(worldFact) || entry.outcomeBinding !== "always"
      || worldFact.consistency.judgment !== "compatible") return { kind: "rejected", code: "DEFINITION_CONFLICT", issues: ["world-fact:compatible-unconditional-history-required"] };
    const sceneRef = input.state.entities[input.actorCharacterId].sceneId;
    const frame = worldFactConstraints(input.state, sceneRef);
    const profile = input.requiredContext.entries.find(e => e.kind === "known" && authority.basisRefs.includes(e.entryRef)
      && isPlainRecord(e.value) && Object.hasOwn(e.value, "factConstraints"));
    if (!frame || frame.missingParentRefs.length > 0 || profile?.kind !== "known" || !isPlainRecord(profile.value)
      || profile.value.factConstraintsHash !== canonicalHash(frame)
      || worldFact.subjectRefs.some(ref => !frame.subjectRefs.includes(ref) || input.state.entities[ref]?.kind === "player")) return { kind: "rejected", code: "CONTEXT_INSUFFICIENT", issues: ["world-fact:constraint-frame-unavailable-or-changed"] };
    factBindings.push({ ref: worldFactConstraintsRef(sceneRef), revisionOrHash: canonicalHash(frame) });
    for (const knowledge of worldFact.initialKnowledge) {
      const npc = npcDecisionContext(input.requiredContext.entries, knowledge.holderRef);
      const allowed = new Set([...(npc?.records.map(r => r.ref) ?? []), ...(npc ? npcDecisionLoadedKnowledge(npc).map(r => r.entryRef) : [])]);
      if (!npc || !worldFact.subjectRefs.includes(knowledge.holderRef)
        || knowledge.acquisitionBasisRefs.some(ref => !allowed.has(ref))
        || creationBasis.some(ref => !authority.basisRefs.includes(ref) && !allowed.has(ref))) return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: ["world-fact:initial-knowledge-holder-basis-invalid"] };
      factBindings.push(...npc.records.map(({ ref, revisionOrHash }) => ({ ref, revisionOrHash })),
        ...npc.knowledge.map(({ entryRef, revisionOrHash }) => ({ ref: entryRef, revisionOrHash })));
    }
  }
  const dependencyRefs = [
    input.actorCharacterId,
    ...sourceRefs,
    ...creationBasis.filter((ref) => !LOCAL_HANDLE_PATTERN.test(ref)),
    ...(entry.definition.sceneRef === null ? [] : [entry.definition.sceneRef]),
    ...(entry.definition.visibilityFactId === null ? [] : [entry.definition.visibilityFactId]),
    ...entry.definition.mechanicDefinitionRefs,
    ...(entry.definition.passage ? [entry.definition.passage.fromLocationRef, entry.definition.passage.toLocationRef] : []),
  ];
  const planReadSet = selectPlanReadSet(input.requiredContext, dependencyRefs.filter((ref) => !LOCAL_HANDLE_PATTERN.test(ref)));
  if (planReadSet.kind === "rejected") return planReadSet;
  const content: SemanticJsonRecord = entry.semanticKind === "sceneFeature"
    ? {
        sceneRef: entry.definition.sceneRef,
        label: entry.definition.label,
        description: entry.definition.description,
        ...(entry.definition.visibilityFactId === null ? {} : { visibilityFactId: entry.definition.visibilityFactId }),
        ...(entry.definition.mechanicDefinitionRefs.length > 0
          ? { mechanicDefinitionRefs: [...entry.definition.mechanicDefinitionRefs].sort() }
          : {}),
        ...(entry.definition.observableState === null ? {} : { observableState: entry.definition.observableState }),
        ...(entry.definition.affordances === null ? {} : { affordances: [...entry.definition.affordances] }),
      }
    : entry.semanticKind === "location" ? {
        scopeRef: entry.definition.sceneRef,
        label: entry.definition.label, description: entry.definition.description,
        geometry: entry.definition.geometry as unknown as SemanticJsonRecord,
      }
    : entry.semanticKind === "passage" ? {
        sceneRef: entry.definition.sceneRef,
        label: entry.definition.label, description: entry.definition.description,
        observableState: entry.definition.observableState,
        passage: entry.definition.passage as unknown as SemanticJsonRecord,
        ...(entry.definition.visibilityFactId === null ? {} : { visibilityFactId: entry.definition.visibilityFactId }),
      }
    : {
        label: entry.definition.label,
        description: entry.definition.description,
        worldFact: worldFact as unknown as SemanticJsonRecord,
      };
  const composed = composeSemanticTemplate({ semanticKind: entry.semanticKind,
    templateRef: entry.templateRef, templateHash: entry.templateHash, overrides: content });
  if (composed.kind !== "accepted") return composed;
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
        visibilityPolicyRef,
        contextHash: input.requiredContext.binding.contextHash,
        readSet: [...new Map([...planReadSet.readSet, ...factBindings].map(binding => [binding.ref, binding])).values()].sort((a,b) => compareCodeUnits(a.ref,b.ref)),
        basisRefs: creationBasis,
        sourceRefs,
        content: composed.content,
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
/** The NPC chooses the plan. The server only addresses its already frozen
 * premises, versions and identities; Rules owns every formation constraint. */
function lowerActorPlanFormationEntry(input: VNext2ProposalBundleLoweringInput,
  entry: VNextFormActorPlanEntry, derivedEntry: VNextDerivedBundleEntry): VNext2EntryLoweringResult {
  const context = npcDecisionContext(input.requiredContext.entries, entry.npcRef);
  const deny = (code: "CONTEXT_INSUFFICIENT" | "PROPOSAL_REFERENCE_INVALID", constraint: string,
    field: string, actual: unknown, expected?: unknown): VNext2EntryLoweringResult => ({
    kind: "rejected", code, issues: [constraint], diagnostics: [proposalDiagnostic("REFERENCE_UNAVAILABLE", constraint, {
      path: ["proposals", derivedEntry.ordinal, field], actual: diagnosticActual(actual), ...(expected === undefined ? {} : { expected }),
      repair: { allowed: false, reason: "npc-plan-decision-change-is-not-a-proven-representation-repair" },
    })],
  });
  if (!context) return deny("CONTEXT_INSUFFICIENT", "npc-plan:npc-decision-context-unavailable", "npcRef", entry.npcRef);
  const unloadedKnowledge = new Set(context.unloadedKnowledgeRefs ?? []);
  const unloadedPremise = (ref: string) => unloadedKnowledge.has(ref)
    || context.knowledge.some(record => record.knowledgeRef === ref && unloadedKnowledge.has(record.entryRef));
  const available = [...context.records.map(record => record.ref), ...npcDecisionLoadedKnowledge(context).map(record => record.entryRef)]
    .filter(ref => npcActorPlanFormationPremiseRef(context, ref) !== undefined).sort(compareCodeUnits);
  const premiseRefs: string[] = [];
  for (const [index, ref] of entry.premiseRefs.entries()) {
    // A premise the KP never read is not a premise it can form a plan on.
    const premise = unloadedPremise(ref) ? undefined : npcActorPlanFormationPremiseRef(context, ref);
    if (premise === undefined) return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: ["npc-plan:frozen-own-premise-required"],
      diagnostics: [proposalDiagnostic("REFERENCE_UNAVAILABLE", "npc-plan:frozen-own-premise-required", {
        path: ["proposals", derivedEntry.ordinal, "premiseRefs", index], actual: diagnosticActual(ref),
        expected: { npcRef: entry.npcRef, source: "loadedNpcDecisionContext", refs: available },
        repair: { allowed: false, reason: "npc-plan-premise-change-requires-a-decision" },
      })] };
    premiseRefs.push(premise);
  }
  // Bind the explicitly selected faction before deriving its resource closure.
  // A live authority record alone cannot grant new context to the model.
  if (entry.factionRef !== null) {
    const faction = context.records.find(record => record.ref === `continuity:factions:${entry.factionRef}`);
    if (faction === undefined) return deny("CONTEXT_INSUFFICIENT", "npc-plan:frozen-faction-required", "factionRef", entry.factionRef);
  }
  const resourceRefs = npcActorPlanFormationResourceRefs(input.state, entry.npcRef, entry.factionRef, entry.resourceRefs);
  if (!resourceRefs) return deny("PROPOSAL_REFERENCE_INVALID", "npc-plan:resource-or-faction-scope-invalid", "resourceRefs", entry.resourceRefs);
  const { kind: _kind, basisRefs: _basisRefs, consumes: _consumes, produces: _produces, outcomeBinding: _outcomeBinding, ...fields } = entry;
  const source = { ...fields, premiseRefs: [...new Set(premiseRefs)], resourceRefs: [...resourceRefs] };
  const refs = npcActorPlanFormationReadRefs(input.state, source);
  if (!refs) return deny("PROPOSAL_REFERENCE_INVALID", "npc-plan:formation-reference-invalid", "npcRef", entry.npcRef);
  const snapshotBindings = new Map([...context.records.map(({ ref, revisionOrHash }) => [ref, { ref, revisionOrHash }] as const),
    ...context.knowledge.map(({ entryRef: ref, revisionOrHash }) => [ref, { ref, revisionOrHash }] as const)]);
  const externalRefs = refs.filter(ref => !snapshotBindings.has(ref));
  const selected = selectPlanReadSet(input.requiredContext, externalRefs);
  if (selected.kind === "rejected") return selected;
  const readSet = [...selected.readSet, ...refs.flatMap(ref => snapshotBindings.has(ref) ? [snapshotBindings.get(ref)!] : [])]
    .sort((a, b) => compareCodeUnits(a.ref, b.ref));
  const plan = { schema: NPC_ACTOR_PLAN_FORMATION_PLAN_SCHEMA,
    contextHash: input.requiredContext.binding.contextHash, readSet,
    ...npcActorPlanFormationIds(input.rootActionId, derivedEntry.entryRef), source };
  if (!isNpcActorPlanFormationPlan(plan)) return { kind: "rejected", code: "PROPOSAL_FORM_INVALID", issues: ["npc-plan:lowered-shape-invalid"] };
  return { kind: "accepted", rulesInput: { kind: "formNpcActorPlan", rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId, plan: plan as unknown as JsonRecord } };
}

/** Every ref slot inside promise terms with its path relative to the terms
 * object, in the same order Rules reads them. */
function promiseSubjectSlots(terms: Readonly<{ subjectRefs: readonly string[]; delivery: Readonly<{ sourceRef: string | null; itemRef: string | null; destinationRef: string }> | null;
  parts?: readonly Readonly<{ subjectRefs: readonly string[]; delivery: Readonly<{ sourceRef: string | null; itemRef: string | null; destinationRef: string }> | null }>[];
  activation?: Readonly<{ subjectRefs: readonly string[] }> | null }>): readonly (readonly [readonly (string | number)[], string])[] {
  const slots: (readonly [readonly (string | number)[], string])[] = [];
  const delivery = (base: readonly (string | number)[], value: typeof terms.delivery) => {
    if (value === null || value === undefined) return;
    if (value.sourceRef !== null) slots.push([[...base, "delivery", "sourceRef"], value.sourceRef]);
    if (value.itemRef !== null) slots.push([[...base, "delivery", "itemRef"], value.itemRef]);
    slots.push([[...base, "delivery", "destinationRef"], value.destinationRef]);
  };
  terms.subjectRefs.forEach((ref, index) => slots.push([["subjectRefs", index], ref]));
  (terms.activation?.subjectRefs ?? []).forEach((ref, index) => slots.push([["activation", "subjectRefs", index], ref]));
  (terms.parts ?? []).forEach((part, partIndex) => {
    part.subjectRefs.forEach((ref, index) => slots.push([["parts", partIndex, "subjectRefs", index], ref]));
    delivery(["parts", partIndex], part.delivery);
  });
  delivery([], terms.delivery);
  return slots;
}

function lowerSocialEntry(input: VNext2ProposalBundleLoweringInput, entry: VNextSocialEntry,
  derivedEntry: VNextDerivedBundleEntry, bundlePlan: VNextDerivedBundlePlan,
  ruling: VNextDirectSuccessRuling | VNextCheckRuling): VNext2EntryLoweringResult {
  if (ruling.kind === "check" && bundlePlan.sharedCheckEntryRef === derivedEntry.entryRef && ruling.checkKind !== "abilityCheck") return {
    kind: "rejected", code: "PROPOSAL_FORM_INVALID", issues: ["social:attack-is-not-conversation"],
  };
  const context = npcDecisionContext(input.requiredContext.entries, entry.npcRef);
  if (!context) return { kind: "rejected", code: "CONTEXT_INSUFFICIENT", issues: ["social:npc-decision-context-unavailable"] };
  const invalidBasis: ProposalDiagnostic[] = [];
  // Only enumerate the already verified snapshot for this NPC. Neither the
  // state nor another NPC's loaded knowledge is a source of alternatives.
  const expected = { npcRef: entry.npcRef, source: "loadedNpcDecisionContext",
    refs: proposalNpcSourceChoices(input.requiredContext).find(choice => choice.npcRef === entry.npcRef)?.refs ?? [] };
  for (const branchName of ["success", "failure"] as const) {
    entry.branches[branchName]?.response.basis.forEach((evidence, basisIndex) => {
      if (evidence.kind !== "npcContext" || npcDecisionEvidenceRef(context, evidence.ref) !== undefined) return;
      invalidBasis.push(proposalDiagnostic("REFERENCE_UNAVAILABLE", "social:foreign-npc-basis", {
        path: ["proposals", derivedEntry.ordinal, "branches", branchName, "response", "basis", basisIndex, "ref"],
        expected, actual: diagnosticActual(evidence.ref),
        repair: { allowed: false, reason: "npc-knowledge-basis-change-is-not-a-proven-representation-repair" },
      }));
    });
  }
  if (invalidBasis.length > 0) return {
    kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: ["social:foreign-npc-basis"],
    diagnostics: Object.freeze(invalidBasis),
  };
  // A promise's subject must be something this NPC can bind itself to. Rules
  // enforces the same predicate at commit; checking it here names the exact
  // slot and the admissible refs, which a bare Rules code cannot.
  const npc = input.state.entities[entry.npcRef];
  const snapshotSubjectRefs = new Set([...context.records.map(record => record.ref),
    ...npcDecisionLoadedKnowledge(context).map(record => record.entryRef)]);
  const admissibleSubjects = npc === undefined ? [] : [...new Set([...snapshotSubjectRefs, npc.sceneId,
    ...proposalObservationSubjectRefs(input.requiredContext).filter(ref => socialPromiseSubjectAdmissible(input.state, npc, snapshotSubjectRefs, ref)),
    ...proposalItemEntryRefs(input.requiredContext).filter(ref => socialPromiseSubjectAdmissible(input.state, npc, snapshotSubjectRefs, ref))])].sort(compareCodeUnits);
  const invalidSubjects: ProposalDiagnostic[] = [];
  for (const branchName of ["success", "failure"] as const) {
    entry.branches[branchName]?.consequences.forEach((consequence, consequenceIndex) => {
      const terms = consequence.kind === "promise" ? consequence.terms
        : consequence.kind === "promiseChange" ? consequence.change.terms : undefined;
      if (terms === undefined || terms === null) return;
      const prefix: (string | number)[] = consequence.kind === "promise" ? ["terms"] : ["change", "terms"];
      for (const [tail, ref] of promiseSubjectSlots(terms)) {
        if (npc !== undefined && socialPromiseSubjectAdmissible(input.state, npc, snapshotSubjectRefs, ref)) continue;
        invalidSubjects.push(proposalDiagnostic("REFERENCE_UNAVAILABLE", "social:promise-terms-context-unavailable", {
          path: ["proposals", derivedEntry.ordinal, "branches", branchName, "consequences", consequenceIndex, ...prefix, ...tail],
          expected: { npcRef: entry.npcRef, source: "npcSnapshotRecordsVisibleObjectsOrScene", refs: admissibleSubjects },
          actual: diagnosticActual(ref),
          repair: { allowed: true, reason: "uncommitted-proposal-may-be-revised-once" },
        }));
      }
    });
  }
  if (invalidSubjects.length > 0) return {
    kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: ["social:promise-terms-context-unavailable"],
    diagnostics: Object.freeze(invalidSubjects),
  };
  const resolveBranch = (value: VNextSocialEntry["branches"]["success"]) => ({ ...value,
    response: { ...value.response, basis: value.response.basis.map(evidence => evidence.kind === "npcContext"
      ? { ...evidence, ref: npcDecisionEvidenceRef(context, evidence.ref)! } : evidence) } });
  const resolvedBranches = { success: resolveBranch(entry.branches.success),
    failure: entry.branches.failure ? resolveBranch(entry.branches.failure) : null };
  const branch = (value: VNextSocialEntry["branches"]["success"]) => ({ outcomeCode: value.outcomeCode, summary: value.summary,
    effects: [], sensoryEvidence: [], pressures: [], opportunities: [] });
  const lowered = lowerWorldInteractionEntryV2(input, {
    kind: "worldInteraction", basisRefs: [...new Set([input.actorCharacterId, entry.npcRef, entry.sceneRef, ...entry.basisRefs])],
    consumes: entry.consumes, produces: [], outcomeBinding: entry.outcomeBinding, sceneRef: entry.sceneRef,
    targetRefs: [entry.npcRef], directTargetRefs: [entry.npcRef], instrumentRefs: [], abilityRef: null,
    intent: input.requiredContext.intent.text, method: entry.method,
    branches: { success: branch(entry.branches.success), failure: entry.branches.failure ? branch(entry.branches.failure) : null },
  }, derivedEntry, bundlePlan, ruling);
  if (lowered.kind === "rejected") return lowered;
  const plan = lowered.rulesInput.plan as unknown as WorldInteractionResolutionPlan;
  const snapshotBindings = [...context.records.map(({ ref, revisionOrHash }) => ({ ref, revisionOrHash })),
    ...context.knowledge.map(({ entryRef, revisionOrHash }) => ({ ref: entryRef, revisionOrHash }))];
  const snapshotRefs = new Set(snapshotBindings.map(record => record.ref));
  const selected = selectPlanReadSet(input.requiredContext, [...plan.readSet.map(record => record.ref),
    `character-timeline:${input.actorCharacterId}`, ...(entry.retryChange?.basisRefs ?? []),
    ...[resolvedBranches.success, resolvedBranches.failure].flatMap(branch => branch?.consequences.flatMap(effect =>
      effect.kind === "promise" ? [...promiseTermsRefs(effect.terms), ...(effect.promiseeRef ? [effect.promiseeRef] : [])]
        : effect.kind === "promiseChange" ? [effect.promiseRef, ...(effect.change.terms ? promiseTermsRefs(effect.change.terms) : [])] : []) ?? [])].filter(ref => !snapshotRefs.has(ref)));
  if (selected.kind === "rejected") return selected;
  // The verified NPC snapshot also owns frozen version bindings for its
  // catalog and timeline; these need not be duplicated as top-level entries.
  const readSet = [...selected.readSet, ...snapshotBindings].sort((a, b) => compareCodeUnits(a.ref, b.ref));
  const social: SocialInteractionPlan = { schema: "zhuwei.social-interaction/vnext-1", npcRef: entry.npcRef,
    threadRef: socialThreadRef(input.rootActionId, plan.resolutionId), addressedThreadRef: entry.addressedThreadRef,
    playerExpression: input.requiredContext.intent.text, goal: entry.goal, communication: entry.communication, audience: entry.audience,
    listeners: socialListeners(input.state, input.actorCharacterId, entry.npcRef, entry.audience), npcContext: context,
    retryChange: entry.retryChange, branches: { success: resolvedBranches.success,
      failure: resolvedBranches.failure ?? { ...structuredClone(resolvedBranches.success), outcomeCode: plan.branches.failure.outcomeCode, summary: plan.branches.failure.summary } } };
  return { kind: "accepted", rulesInput: { ...lowered.rulesInput, plan: { ...plan, readSet, social } as unknown as JsonRecord } };
}

function lowerObserveEntry(input: VNext2ProposalBundleLoweringInput, entry: VNextObserveEntry,
  derivedEntry: VNextDerivedBundleEntry, bundlePlan: VNextDerivedBundlePlan,
  ruling: VNextDirectSuccessRuling | VNextCheckRuling): VNext2EntryLoweringResult {
  if (ruling.kind === "check" && bundlePlan.sharedCheckEntryRef === derivedEntry.entryRef && ruling.checkKind !== "abilityCheck") return {
    kind: "rejected", code: "PROPOSAL_FORM_INVALID", issues: ["observe:attack-is-not-observation"],
  };
  const branch = (value: VNextObserveEntry["branches"]["success"]) => ({
    outcomeCode: value.outcomeCode, summary: value.summary, sensoryEvidence: value.sensoryEvidence,
    effects: [], pressures: [], opportunities: [],
  });
  const lowered = lowerWorldInteractionEntryV2(input, {
    kind: "worldInteraction", basisRefs: [...new Set([input.actorCharacterId, entry.sceneRef, ...entry.basisRefs, ...entry.existingFactRefs])],
    consumes: entry.consumes, produces: [], outcomeBinding: entry.outcomeBinding, sceneRef: entry.sceneRef,
    targetRefs: entry.focusRefs.length ? entry.focusRefs : [entry.sceneRef],
    directTargetRefs: entry.focusRefs.length ? entry.focusRefs : [entry.sceneRef],
    instrumentRefs: [], abilityRef: null, intent: entry.inquiry, method: entry.method,
    branches: { success: branch(entry.branches.success), failure: entry.branches.failure ? branch(entry.branches.failure) : null },
  }, derivedEntry, bundlePlan, ruling);
  if (lowered.kind === "rejected") return lowered;
  const plan = lowered.rulesInput.plan as unknown as WorldInteractionResolutionPlan;
  const held = [...entry.branches.success.characterInferences, ...(entry.branches.failure?.characterInferences ?? [])]
    .flatMap(inference => inference.evidence.flatMap(source => source.kind === "heldKnowledge" ? [source.ref] : []));
  const recordRefs = held.map(ref => `knowledge:${input.actorCharacterId}:${ref}`);
  const selected = selectPlanReadSet(input.requiredContext, [...plan.readSet.map(record => record.ref),
    ...(held.length ? [`knowledge-catalog:${input.actorCharacterId}`, ...recordRefs] : [])]);
  if (selected.kind === "rejected") return selected;
  const observationPlan: WorldInteractionResolutionPlan = { ...plan, readSet: selected.readSet,
    observation: { inquiry: entry.inquiry, inferences: { success: entry.branches.success.characterInferences,
      failure: entry.branches.failure?.characterInferences ?? [] } } };
  const issue = observationKnowledgeIssue(input.state, observationPlan);
  if (issue) return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID", issues: [issue] };
  return { kind: "accepted", rulesInput: { ...lowered.rulesInput, plan: observationPlan as unknown as JsonRecord } };
}

function lowerWorldInteractionEntryV2(
  input: VNext2ProposalBundleLoweringInput,
  entry: VNextWorldInteractionEntry,
  derivedEntry: VNextDerivedBundleEntry,
  plan: VNextDerivedBundlePlan,
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
  if (sharedRuling.kind === "check" && plan.sharedCheckEntryRef === derivedEntry.entryRef) {
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
    prospectiveDefinitionKinds: Object.fromEntries(plan.entries.flatMap((candidate) => candidate.produces.map((produced) => [produced.handle, produced.kind]))),
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
  if (IN_WORLD_ACT_FORM_IDS.has(entry.formId)) {
    for (const candidate of plan.entries) if (candidate.kind === "completeObject") deps.add(candidate.entryRef);
  }
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

/** Lowering may run against a minimal authority snapshot; only a state that
 * actually carries Encounters can put the actor inside one. */
function actorInActiveEncounter(state: AuthoritativeWorldState, actorCharacterId: string): boolean {
  return isPlainRecord(state.combatRuntime) && isPlainRecord(state.combatRuntime.encounters)
    && activeEncounter(state, actorCharacterId) !== undefined;
}

function rejected(
  code: Extract<VNext2ProposalBundleLoweringResult, { kind: "rejected" }>["code"],
  issues: readonly string[],
  diagnostics?: readonly ProposalDiagnostic[],
): Extract<VNext2ProposalBundleLoweringResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    issues: Object.freeze([...new Set(issues)].sort(compareCodeUnits)),
    ...(diagnostics === undefined ? {} : { diagnostics: Object.freeze([...diagnostics]) }),
  });
}

/** Preserve structured failures from private collaborators through exception
 * wrappers. Unknown exception messages may contain state and stay private. */
function structuredLoweringFailure(error: unknown, depth = 0): Extract<VNext2ProposalBundleLoweringResult, { kind: "rejected" }> | undefined {
  if (depth > 8 || error === null || typeof error !== "object") return undefined;
  const detail = error as Record<string, unknown>;
  const nested = structuredLoweringFailure(detail.cause ?? detail.rejection, depth + 1);
  if (!Array.isArray(detail.issues) || !detail.issues.every(issue => typeof issue === "string") || detail.issues.length === 0) return nested;
  const code = ["PROPOSAL_BUNDLE_INVALID", "PROPOSAL_FORM_INVALID", "PROPOSAL_REFERENCE_INVALID", "DEFINITION_CONFLICT",
    "BUNDLE_DEPENDENCY_INVALID", "BUNDLE_LOWERING_UNSUPPORTED", "CONTEXT_INSUFFICIENT", "COST_INVALID"].includes(String(detail.code))
    ? detail.code as Extract<VNext2ProposalBundleLoweringResult, { kind: "rejected" }>["code"] : nested?.code ?? "PROPOSAL_BUNDLE_INVALID";
  const diagnostics = Array.isArray(detail.diagnostics) && detail.diagnostics.every(value => isPlainRecord(value)
    && typeof value.code === "string" && typeof value.constraint === "string" && isPlainRecord(value.repair)
    && typeof value.repair.allowed === "boolean" && typeof value.repair.reason === "string")
    ? detail.diagnostics as readonly ProposalDiagnostic[] : [];
  const preserved = [...diagnostics, ...(nested?.diagnostics ?? [])];
  return rejected(code, [...detail.issues, ...(nested?.issues ?? [])], preserved.length > 0 ? preserved : undefined);
}

function lowerAuthoredEntry(
  input: VNext2ProposalBundleLoweringInput,
  entry: Extract<VNextProposalBundleEntry, { kind: "materializeDefinition" | "materializeItem" | "inventoryOperation" }>,
  plan: VNextDerivedBundlePlan,
): VNext2EntryLoweringResult {
  if (entry.kind === "materializeItem" && entry.uniquenessBasisRef !== undefined
    && input.state.canonicalFacts[entry.uniquenessBasisRef] === undefined) return {
      kind: "rejected", code: "BUNDLE_DEPENDENCY_INVALID", issues: ["bundle2:unique-item-requires-existing-canonical-fact"],
    };
  if (entry.kind === "materializeDefinition" && entry.source.kind === "hazard") {
    const triggerRef = String((entry.source.content.trigger as { ref: string }).ref);
    const sceneRef = input.state.entities[input.actorCharacterId]?.sceneId;
    if (!LOCAL_HANDLE_PATTERN.test(triggerRef)
      && (sceneRef === undefined || !authorityRefBoundToScene(input.state, triggerRef, sceneRef))) {
      return { kind: "rejected", code: "CONTEXT_INSUFFICIENT", issues: ["materialization:trigger-outside-granted-scope"] };
    }
  }
  const authority = entry.kind === "inventoryOperation" ? undefined : materializationAuthorityBasis({
    context: input.requiredContext, state: input.state,
    scopeRef: entry.kind === "materializeItem" ? entry.sceneRef : input.state.entities[input.actorCharacterId]?.sceneId,
    kind: entry.kind === "materializeItem" ? "item" : entry.source.kind,
    ...(entry.kind === "materializeItem" ? { templateRef: entry.definitionRef }
      : { createsInstance: entry.source.kind === "hazard" }),
  });
  if (authority?.kind === "rejected") return authority;
  const sourceRefs = [...new Set([
    ...entry.basisRefs,
    ...entry.consumes.flatMap(consume => consume.kind === "existing" ? [consume.ref] : []),
  ])];
  const narrativeSources = narrativeSourceRefs(input.state, sourceRefs);
  const creationBasis = [...new Set([...entry.basisRefs, ...narrativeSources, ...(authority?.basisRefs ?? [])])];
  const dependencyRefs = [input.actorCharacterId, ...creationBasis, ...sourceRefs, ...authoredReferenceSlots(entry),
    ...(entry.kind === "inventoryOperation" && isItemAssemblyOperation(entry.operation)
      ? itemAssemblyReadRefs(input.state, input.actorCharacterId, entry.operation) : [])]
    .filter((ref) => !LOCAL_HANDLE_PATTERN.test(ref));
  const read = selectPlanReadSet(input.requiredContext, dependencyRefs);
  if (read.kind === "rejected") return read;
  const common = { contextHash: input.requiredContext.binding.contextHash, readSet: read.readSet, basisRefs: creationBasis, summary: entry.summary };
  if (entry.kind === "inventoryOperation") return { kind: "accepted", rulesInput: {
    kind: "inventoryOperation", rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
    plan: { schema: "zhuwei.inventory-operation-plan/vnext-1", ...common, operation: structuredClone(entry.operation) },
  } };
  const produced = entry.produces[0];
  if (!produced) return { kind: "rejected", code: "BUNDLE_DEPENDENCY_INVALID", issues: ["bundle2:authored-producer-missing"] };
  const visibilityPolicyRef = narrativeMaterializationPolicy(input.state, {
    sourceRefs: narrativeSources, actorCharacterId: input.actorCharacterId, requestedPolicy: entry.visibilityPolicyRef,
  });
  if (visibilityPolicyRef === undefined) return { kind: "rejected", code: "PROPOSAL_REFERENCE_INVALID",
    issues: ["narrative:materialization-audience-unavailable"] };
  const authoring = { ...common, bundleHash: plan.referenceNamespaceHash, handle: produced.handle,
    sourceRefs, visibilityPolicyRef };
  return { kind: "accepted", rulesInput: {
    kind: entry.kind, rootActionId: input.rootActionId, actorCharacterId: input.actorCharacterId,
    plan: entry.kind === "materializeDefinition"
      ? { ...authoring, schema: "zhuwei.authored-definition-materialization-plan/vnext-1", source: structuredClone(entry.source),
          causalBasisRefs: entry.basisRefs.filter((ref) => Object.hasOwn(input.state.canonicalFacts ?? {}, ref)) }
      : { ...authoring, schema: "zhuwei.authored-item-materialization-plan/vnext-1", definitionRef: entry.definitionRef,
          sceneRef: entry.sceneRef, quantity: entry.quantity, ownership: structuredClone(entry.ownership),
          ...(entry.uniquenessBasisRef === undefined ? {} : { uniquenessBasisRef: entry.uniquenessBasisRef }) },
  } };
}
