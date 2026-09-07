import { isActionDurationMicros } from "./action-duration";
import { isAbilityOperation, ABILITY_OPERATION_SOURCE_SCHEMA } from "../../rules/v2/ability-operation";
import { npcActorPlanFormationSourceConform, type NpcActorPlanFormationShapeDiagnostic } from "../../rules/v2/npc-plan-formation";
import { isTimePassageDuration } from "../../rules/v2/time-passage";
import { vnextEntryProducerContract } from "./proposal-producer-contract";
import { diagnosticActual, diagnosticsFromIssues, proposalDiagnostic, type ProposalDiagnostic } from "./proposal-diagnostics";
import { authoredWorldFactConform } from "../../rules/v2/world-facts";
import { dynamicPassageConform } from "../../rules/v2/dynamic-locations";
import { isCanonicalTacticalGeometry, type SpatialShapeDiagnostic } from "../../rules/profiles/tactical-geometry";
import { socialBranchConform, socialRetryChangeConform, type SocialShapeDiagnostic } from "../../rules/v2/social-interaction";
import { observationInferenceConform } from "../../rules/v2/character-inference";
import { vnextSharedCheckOwnerOrdinal } from "./proposal-check-owner";
import { publicExpressionConform } from "../../rules/v2/public-expression";
import { validateAuthoredDefinitionSource, matchesAuthoredSourceSchema, AUTHORED_ITEM_OWNERSHIP_SCHEMA, type AuthoredSourceDiagnostic } from "../../rules/v2/authored-materialization";
import { isInventoryOperationSource, authoredReferenceSlots, isAuthoredExecutionArea } from "./authored-proposal-contract";
import {
  canonicalClone,
  compareCodeUnits,
  deepFreeze,
  isPlainRecord,
} from "./canonical-json";
import { validateVNextProposalBundleDependencies } from "./proposal-graph";
import {
  VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  type VNextAttemptCost,
  type VNextBundleProducedReference,
  type VNextBundleReference,
  type VNextCheckParameters,
  type VNextClarificationContinuation,
  type VNextKnowledgeReviewTerminal,
  type VNextPassTimeTerminal,
  type VNextAbilityOperationTerminal,
  type VNextClarificationTerminal,
  type VNextFeasibilityRuling,
  type VNextInWorldRefusalTerminal,
  type VNextMaterializeObjectEntry,
  type VNextProposalBundle,
  type VNextProposalBundleEntry,
  type VNextProposalBundleValidationResult,
  type VNextSemanticDefinitionOperation,
  type VNextWorldInteractionBranchProposal,
  type VNextWorldInteractionEntry,
  type VNextWorldSemanticEffect,
} from "./proposal-schema";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LOCAL_HANDLE_PATTERN = /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LOCAL_CHOICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const MAX_PROPOSALS = 16;
const MAX_REFS = 64;
const MAX_OPERATIONS = 16;
const MAX_EFFECTS = 16;
const MAX_EVIDENCE = 16;
const MAX_PRESSURES = 8;
const MAX_OPPORTUNITIES = 8;
const MAX_CHOICES = 6;
const MAX_PREREQUISITES = 8;
const MAX_NEXT_ACTIONS = 8;
const PROPOSAL_ENTRY_KINDS = Object.freeze(Object.keys({
  commitNarrativeDetail: true,
  formActorPlan: true,
  social: true,
  observe: true,
  materializeObject: true,
  materializeDefinition: true,
  materializeItem: true,
  inventoryOperation: true,
  reviseSemanticDefinition: true,
  worldInteraction: true,
} satisfies Record<VNextProposalBundleEntry["kind"], true>));

/**
 * Closed local validation is authoritative even when the Provider claims
 * strict decoding. Provider schema support proves transport compatibility;
 * this validator owns size, cross-field, dependency, and semantic invariants.
 */
export function validateVNextProposalBundle(
  value: unknown,
): VNextProposalBundleValidationResult {
  try {
    if (!isPlainRecord(value)) return rejected("PROPOSAL_BUNDLE_INVALID", ["bundle:envelope-invalid"],
      [proposalDiagnostic("TYPE_MISMATCH", "bundle:envelope-invalid", { path: [], expected: { type: "object" }, actual: diagnosticActual(value) })]);
    if (!exactKeys(value, [
        "adjudication", "basisRefs", "kind", "mode", "proposals", "schema", "terminal",
      ])
      || !enumField(value, "schema", [VNEXT2_PROPOSAL_BUNDLE_SCHEMA])
      || !enumField(value, "kind", ["proposalBundle"])
      || !enumField(value, "mode", ["adjudication", "terminal"])
      || !isExistingRefArray(value.basisRefs, 0, value, "basisRefs")) {
      invalid("bundle:envelope-invalid");
    }

    let bundle: VNextProposalBundle;
    if (value.mode === "adjudication") {
      if (!checkedField(value, "adjudication", isPlainRecord, { type: "object" }, "bundle:adjudication-shape-invalid")
        || !isFeasibilityRuling(value.adjudication)
        || !checkedField(value, "terminal", entry => entry === null, { type: "null" }, "bundle:adjudication-shape-invalid", "CONSTRAINT_CONFLICT")
        || !arrayField(value.proposals, value, "proposals", 1, MAX_PROPOSALS)) {
        invalid("bundle:adjudication-shape-invalid");
      }
      const proposals = value.proposals.map(validateEntry);
      validateAdjudicationCrossFields(value.adjudication, proposals);
      const dependencyDiagnostics: ProposalDiagnostic[] = [];
      const dependencyIssues = validateVNextProposalBundleDependencies(proposals, dependencyDiagnostics);
      if (dependencyIssues.length > 0) {
        return rejected("BUNDLE_DEPENDENCY_INVALID", dependencyIssues, dependencyDiagnostics);
      }
      bundle = canonicalClone({
        schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
        kind: "proposalBundle",
        mode: "adjudication",
        basisRefs: value.basisRefs,
        adjudication: value.adjudication,
        terminal: null,
        proposals,
      }) as VNextProposalBundle;
    } else {
      if (!checkedField(value, "adjudication", entry => entry === null, { type: "null" }, "bundle:terminal-shape-invalid", "CONSTRAINT_CONFLICT")
        || !checkedField(value, "terminal", isPlainRecord, { type: "object" }, "bundle:terminal-shape-invalid")
        || !isTerminalProposal(value.terminal, { proposalCount: 0 })
        || !arrayField(value.proposals, value, "proposals", 0, 0)) {
        invalid("bundle:terminal-shape-invalid");
      }
      if (["knowledgeReview", "passTime", "abilityOperation"].includes(value.terminal.kind) && value.basisRefs.length !== 0) invalid(value.terminal.kind === "knowledgeReview" ? "knowledge:terminal-basis-must-be-empty" : value.terminal.kind === "passTime" ? "time-passage:terminal-basis-must-be-empty" : "ability:terminal-basis-must-be-empty");
      bundle = canonicalClone({
        schema: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
        kind: "proposalBundle",
        mode: "terminal",
        basisRefs: value.basisRefs,
        adjudication: null,
        terminal: value.terminal,
        proposals: [],
      }) as VNextProposalBundle;
    }
    return Object.freeze({ kind: "accepted", bundle: deepFreeze(bundle) });
  } catch (error) {
    return rejected("PROPOSAL_BUNDLE_INVALID", error instanceof AuthoredSourceValidationError ? error.issues : [issue(error)],
      error instanceof FieldValidationError || error instanceof AuthoredSourceValidationError ? error.diagnostics(value) : undefined);
  }
}

function validateEntry(value: unknown, index: number, entries: readonly unknown[]): VNextProposalBundleEntry {
  if (!isPlainRecord(value)) throw new FieldValidationError(entries, [proposalDiagnostic("TYPE_MISMATCH", "bundle:entry-invalid", {
    path: [index], expected: { type: "object" }, actual: diagnosticActual(value),
  })]);
  enumField(value, "kind", PROPOSAL_ENTRY_KINDS);
  const commonKeys = ["basisRefs", "consumes", "kind", "outcomeBinding", "produces"];
  if (!isTypedRefArray(value.basisRefs, 0, value, "basisRefs")
    || !isConsumes(value.consumes, value)
    || !isProduces(value.produces, value)
    || !enumField(value, "outcomeBinding", ["always", "onSuccess", "onFailure"])) {
    invalid(`bundle:entry-common-invalid:${value.kind}`);
  }
  if (value.kind === "formActorPlan") {
    const { kind: _kind, basisRefs: _basisRefs, consumes: _consumes, produces: _produces, outcomeBinding: _outcomeBinding, ...source } = value;
    const details: NpcActorPlanFormationShapeDiagnostic[] = [];
    if (!npcActorPlanFormationSourceConform(source, details)) {
      throw new FieldValidationError(value, details.map(detail => {
        let actual: unknown = value;
        for (const part of detail.path) actual = actual !== null && typeof actual === "object"
          ? (actual as Record<string | number, unknown>)[part] : undefined;
        return proposalDiagnostic(detail.code, detail.constraint, { path: detail.path, expected: detail.expected, actual: diagnosticActual(actual) });
      }));
    }
    for (const key of ["npcRef", "factionRef", "alternateTargetRef"] as const) {
      if (typeof value[key] === "string" && value[key].startsWith("prospective:")) throw new FieldValidationError(value,
        [proposalDiagnostic("REFERENCE_UNAVAILABLE", "npc-plan:existing-frozen-reference-required", {
          path: [key], actual: diagnosticActual(value[key]), expected: { referenceKind: "existing" },
        })]);
    }
    for (const key of ["premiseRefs", "resourceRefs"] as const) source[key].forEach((ref, index) => {
      if (ref.startsWith("prospective:")) throw new FieldValidationError(value,
        [proposalDiagnostic("REFERENCE_UNAVAILABLE", "npc-plan:existing-frozen-reference-required", {
          path: [key, index], actual: diagnosticActual(ref), expected: { referenceKind: "existing" },
        })]);
    });
    if (!arrayField(value.basisRefs, value, "basisRefs", 0, 0) || !arrayField(value.consumes, value, "consumes", 0, 0)
      || !isProducerForEntry(value)) invalid("bundle:npc-plan-server-dependencies-required");
    return value as VNextProposalBundleEntry;
  }

  if (value.kind === "commitNarrativeDetail") {
    if (!exactKeys(value, [...commonKeys, "sceneRef", "label", "description", "audience"])
      || !refField(value.sceneRef, value, "sceneRef") || !textField(value.label, value, "label", 500) || !textField(value.description, value, "description", 2_000)
      || !enumField(value, "audience", ["sceneObservers", "actorOnly"]) || value.outcomeBinding !== "always"
      || !arrayField(value.consumes, value, "consumes", 0, 0) || !isProducerForEntry(value)) invalid("bundle:narrative-detail-invalid");
    return value as VNextProposalBundleEntry;
  }

  if (value.kind === "social") {
    if (!exactKeys(value, [...commonKeys, "sceneRef", "npcRef", "addressedThreadRef", "goal", "method", "communication", "audience", "retryChange", "branches"])
      || !refField(value.sceneRef, value, "sceneRef") || !refField(value.npcRef, value, "npcRef")
      || !(value.addressedThreadRef === null || refField(value.addressedThreadRef, value, "addressedThreadRef"))
      || !textField(value.goal, value, "goal", 4000) || !textField(value.method, value, "method", 4000) || !enumField(value, "communication", ["spokenConversation"])
      || !enumField(value, "audience", ["participants", "sceneListeners"])
      || !(value.retryChange === null || (rulesShapeField(value.retryChange, value, "retryChange", socialRetryChangeConform) && value.retryChange.kind !== "cost"))
      || !isProducerForEntry(value)
      || !objectField(value.branches, value, "branches") || !exactKeys(value.branches, ["success", "failure"])
      || !rulesShapeField(value.branches.success, value.branches, "success", socialBranchConform)
      || !(value.branches.failure === null || rulesShapeField(value.branches.failure, value.branches, "failure", socialBranchConform))) invalid("bundle:social-invalid");
    const knowledgeDiagnostics: ProposalDiagnostic[] = [];
    for (const branchName of ["success", "failure"] as const) {
      const branch = value.branches[branchName];
      if (!socialBranchConform(branch)) continue;
      branch.response.basis.forEach((source, basisIndex) => {
        // This is the model source contract. Lowering resolves the handle to
        // an authority definition; Rules validates that definition and holder.
        if (source.kind === "materializedKnowledge" && !isLocalHandle(source.definitionRef)) {
          knowledgeDiagnostics.push(proposalDiagnostic("REFERENCE_UNAVAILABLE", "social:materialized-knowledge-requires-bundle-producer", {
            path: ["branches", branchName, "response", "basis", basisIndex, "definitionRef"],
            expected: { referenceKind: "prospective-worldFact", origin: "same-bundle-always-producer" },
            actual: diagnosticActual(source.definitionRef),
            repair: { allowed: false, reason: "changing-knowledge-source-or-creating-world-fact-requires-a-decision" },
          }));
        }
      });
    }
    if (knowledgeDiagnostics.length > 0) throw new FieldValidationError(value, knowledgeDiagnostics);
    return value as VNextProposalBundleEntry;
  }

  if (value.kind === "observe") {
    const branchValid = (branch: unknown): boolean => isPlainRecord(branch)
      && exactKeys(branch, ["outcomeCode", "summary", "sensoryEvidence", "characterInferences"])
      && isBranchEvidence(branch)
      && arrayField(branch.characterInferences, branch, "characterInferences", 0, 16)
      && branch.characterInferences.every(observationInferenceConform);
    if (!exactKeys(value, [...commonKeys, "sceneRef", "focusRefs", "existingFactRefs", "inquiry", "method", "branches"])
      || !refField(value.sceneRef, value, "sceneRef") || !isTypedRefArray(value.focusRefs, 0, value, "focusRefs") || !isTypedRefArray(value.existingFactRefs, 0, value, "existingFactRefs")
      || !textField(value.inquiry, value, "inquiry", 4000) || !textField(value.method, value, "method", 4000) || !isProducerForEntry(value)
      || !objectField(value.branches, value, "branches") || !exactKeys(value.branches, ["success", "failure"])
      || !branchValid(value.branches.success) || !(value.branches.failure === null || branchValid(value.branches.failure))) invalid("bundle:observe-invalid");
    return value as VNextProposalBundleEntry;
  }

  if (value.kind === "materializeObject") {
    if (!exactKeys(value, [
      ...commonKeys,
      "definition", "semanticKind", "summary", "templateHash", "templateRef",
      "visibilityPolicyRef",
    ])
      || !enumField(value, "semanticKind", ["sceneFeature", "worldFact", "location", "passage"])
      || !refField(value.templateRef, value, "templateRef")
      || !checkedField(value, "templateHash", isSha256, { type: "string", pattern: SHA256_PATTERN.source })
      || !enumField(value, "visibilityPolicyRef", [
        "visibility:public", "visibility:scene-observers", "visibility:hidden-until-evidence", "visibility:narrative-audience",
      ])
      || !isMaterializedDefinition(value.definition, value)
      || !textField(value.summary, value, "summary", 2_000)
      || !isProducerForEntry(value)) {
      invalid("bundle:materialization-invalid");
    }
    return value as VNextMaterializeObjectEntry;
  }

  if (value.kind === "materializeDefinition" || value.kind === "materializeItem" || value.kind === "inventoryOperation") {
    const sourceValidation = value.kind === "materializeDefinition" ? validateAuthoredDefinitionSource(value.source) : undefined;
    if (sourceValidation !== undefined && !sourceValidation.ok) {
      throw new AuthoredSourceValidationError(value, sourceValidation.diagnostics, index);
    }
    const extra = value.kind === "materializeDefinition" ? ["source", "visibilityPolicyRef", "summary"]
      : value.kind === "materializeItem" ? ["definitionRef", "sceneRef", "quantity", "ownership", "visibilityPolicyRef", "summary", ...(value.uniquenessBasisRef === undefined ? [] : ["uniquenessBasisRef"])]
        : ["operation", "summary"];
    if (!exactKeys(value, [...commonKeys, ...extra]) || !textField(value.summary, value, "summary", 2000)) invalid("bundle:authored-entry-invalid");
    authoredReferenceSlots(value, (ref, parent, key) => { refField(ref, parent, key, true); });
    if (value.kind === "inventoryOperation") {
      if (!isProducerForEntry(value) || !authoredSchemaField(value, "operation", index,
        "bundle:inventory-operation-invalid", isInventoryOperationSource)) invalid("bundle:inventory-operation-invalid");
    } else {
      if (!enumField(value, "visibilityPolicyRef", ["visibility:public", "visibility:scene-observers", "visibility:hidden-until-evidence", "visibility:narrative-audience"])) invalid("bundle:authored-producer-invalid");
      if (value.kind === "materializeDefinition") {
        if (!sourceValidation?.ok || !isProducerForEntry(value)) invalid("bundle:authored-producer-kind-invalid");
      } else if (!isProducerForEntry(value) || !refField(value.definitionRef, value, "definitionRef", true) || !refField(value.sceneRef, value, "sceneRef", true)
        || !checkedField(value, "quantity", entry => Number.isSafeInteger(entry) && Number(entry) >= 1 && Number(entry) <= 1_000_000,
          { type: "integer", minimum: 1, maximum: 1_000_000 })
        || (value.uniquenessBasisRef !== undefined && (!refField(value.uniquenessBasisRef, value, "uniquenessBasisRef") || value.quantity !== 1))
        || !authoredSchemaField(value, "ownership", index, "bundle:item-materialization-invalid",
          (entry, diagnostics) => matchesAuthoredSourceSchema(entry, AUTHORED_ITEM_OWNERSHIP_SCHEMA, diagnostics))) invalid("bundle:item-materialization-invalid");
    }
    return value as VNextProposalBundleEntry;
  }

  if (value.kind === "reviseSemanticDefinition") {
    if (!exactKeys(value, [
      ...commonKeys,
      "baseHash", "baseRevision", "definitionRef", "npcRef", "operations",
      "semanticKind", "summary", "templateHash", "templateRef",
    ])
      || !enumField(value, "semanticKind", ["npc"])
      || ![
        value.definitionRef,
        value.npcRef,
        value.baseRevision,
        value.templateRef,
      ].every(isExistingRef)
      || !checkedField(value, "baseHash", isSha256, { type: "string", pattern: SHA256_PATTERN.source })
      || !checkedField(value, "templateHash", isSha256, { type: "string", pattern: SHA256_PATTERN.source })
      || !isSemanticOperations(value.operations, "npc")
      || !textField(value.summary, value, "summary", 2_000)
      || !isProducerForEntry(value)) {
      invalid("bundle:semantic-revision-invalid");
    }
    return value as VNextProposalBundleEntry;
  }

  if (value.kind !== "worldInteraction"
    || !exactKeys(value, [
      ...commonKeys,
      "abilityRef", "branches", "directTargetRefs", "instrumentRefs", "intent",
      "method", "sceneRef", "targetRefs",
    ])
    || !refField(value.sceneRef, value, "sceneRef")
    || !isTypedRefArray(value.targetRefs, 1, value, "targetRefs")
    || !isTypedRefArray(value.directTargetRefs, 1, value, "directTargetRefs")
    || !checkedField(value, "directTargetRefs", refs => isSubset(refs, value.targetRefs),
      { type: "array", subsetOf: "targetRefs" }, "direct-targets-must-be-targets", "CONSTRAINT_CONFLICT")
    || !isTypedRefArray(value.instrumentRefs, 0, value, "instrumentRefs")
    || !(value.abilityRef === null || refField(value.abilityRef, value, "abilityRef"))
    || !textField(value.intent, value, "intent", 4_000)
    || !textField(value.method, value, "method", 4_000)
    || !objectField(value.branches, value, "branches")
    || !exactKeys(value.branches, ["failure", "success"])
    || !isBranch(value.branches.success)
    || !(value.branches.failure === null || isBranch(value.branches.failure))
    || !isProducerForEntry(value)) {
    invalid("bundle:world-interaction-invalid");
  }
  return value as VNextWorldInteractionEntry;
}

function validateAdjudicationCrossFields(
  ruling: VNextFeasibilityRuling,
  proposals: readonly VNextProposalBundleEntry[],
): void {
  const interactions = proposals.filter(
    (entry): entry is VNextWorldInteractionEntry | Extract<VNextProposalBundleEntry, {kind:"observe"|"social"}> => entry.kind === "worldInteraction" || entry.kind === "observe" || entry.kind === "social",
  );
  if (ruling.kind === "directSuccess"
    || (ruling.kind === "highRisk" && ruling.check === null)) {
    const conditional = proposals.find((entry) => entry.outcomeBinding !== "always");
    if (conditional !== undefined) {
      throw new FieldValidationError(conditional, [proposalDiagnostic("CONSTRAINT_CONFLICT", "bundle:non-random-outcome-binding-invalid", {
        path: ["outcomeBinding"], expected: { ruling: ruling.kind, outcomeBinding: "always" }, actual: diagnosticActual(conditional.outcomeBinding),
      })]);
    }
    const failure = interactions.find((entry) => entry.branches.failure !== null);
    if (failure !== undefined) {
      throw new FieldValidationError(failure, [proposalDiagnostic("CONSTRAINT_CONFLICT", "bundle:non-random-outcome-binding-invalid", {
        path: ["branches", "failure"], expected: { ruling: ruling.kind, value: null }, actual: diagnosticActual(failure.branches.failure),
      })]);
    }
    return;
  }
  if (vnextSharedCheckOwnerOrdinal(proposals) === undefined) {
    throw new FieldValidationError(ruling, [proposalDiagnostic("CONSTRAINT_CONFLICT", "bundle:shared-check-shape-invalid", {
      expected: { successFailurePairs: 1, ownerOutcomeBinding: "always" },
      actual: { pairs: proposals.flatMap((entry, ordinal) => (entry.kind === "worldInteraction" || entry.kind === "observe" || entry.kind === "social")
        && entry.branches.failure !== null ? [{ ordinal, outcomeBinding: entry.outcomeBinding }] : []) },
    })]);
  }
}

function isTerminalProposal(
  value: unknown,
  budget: { proposalCount: number },
): value is VNextClarificationTerminal | VNextInWorldRefusalTerminal | VNextKnowledgeReviewTerminal | VNextPassTimeTerminal | VNextAbilityOperationTerminal {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "abilityOperation") return exactKeys(value, ["kind", "operation"])
    && abilityOperationField(value);
  if (value.kind === "passTime") {
    return exactKeys(value, ["kind", "durationMicros"])
      && checkedField(value, "durationMicros", isTimePassageDuration,
      { type: "string", pattern: "^[1-9][0-9]*$", maximum: String(Number.MAX_SAFE_INTEGER) }, "time-passage:positive-safe-duration-required");
  }
  if (value.kind === "knowledgeReview") {
    return exactKeys(value, ["kind", "inquiry", "scope", "knowledgeRefs"]) && textField(value.inquiry, value, "inquiry", 4_000)
      && isExistingRefArray(value.knowledgeRefs, 0, value, "knowledgeRefs")
      && (value.scope === "relevantKnown" || (value.scope === "allKnown" && value.knowledgeRefs.length === 0));
  }
  if (value.kind === "clarification") {
    if (!exactKeys(value, ["choices", "intent", "kind", "method", "question"])
      || !textField(value.intent, value, "intent", 4_000)
      || !textField(value.method, value, "method", 4_000)
      || !textField(value.question, value, "question", 2_000)
      || !Array.isArray(value.choices)
      || value.choices.length < 2
      || value.choices.length > MAX_CHOICES) return false;
    const choiceIds = new Set<string>();
    let executableChoiceCount = 0;
    const choicesValid = value.choices.every((choice) => {
      if (!isPlainRecord(choice)
        || !exactKeys(choice, [
          "basisRefs", "choiceId", "continuation", "label", "publicRisk",
        ])
        || typeof choice.choiceId !== "string"
        || !LOCAL_CHOICE_PATTERN.test(choice.choiceId)
        || choiceIds.has(choice.choiceId)
        || !textField(choice.label, choice, "label", 1_000)
        || !textField(choice.publicRisk, choice, "publicRisk", 2_000)
        || !isExistingRefArray(choice.basisRefs, 0, choice, "basisRefs")
        || !isClarificationContinuation(choice.continuation, choice.publicRisk, budget)) {
        return false;
      }
      choiceIds.add(choice.choiceId);
      if (choice.continuation.kind !== "cancel") executableChoiceCount += 1;
      return true;
    });
    return choicesValid && executableChoiceCount > 0;
  }
  return value.kind === "inWorldRefusal"
    && exactKeys(value, ["intent", "kind", "method", "ruling"])
    && textField(value.intent, value, "intent", 4_000)
    && textField(value.method, value, "method", 4_000)
    && isRefusalRuling(value.ruling);
}

function isClarificationContinuation(
  value: unknown,
  publicRisk: string,
  budget: { proposalCount: number },
): value is VNextClarificationContinuation {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "cancel") return exactKeys(value, ["kind"]);
  if (value.kind === "abilityOperation") {
    budget.proposalCount += 1;
    return budget.proposalCount <= MAX_PROPOSALS && exactKeys(value, ["kind", "basisRefs", "operation"])
      && arrayField(value.basisRefs, value, "basisRefs", 0, 0)
      && abilityOperationField(value);
  }
  if (value.kind === "inWorldRefusal") {
    return exactKeys(value, ["basisRefs", "intent", "kind", "method", "ruling"])
      && isExistingRefArray(value.basisRefs, 0, value, "basisRefs")
      && textField(value.intent, value, "intent", 4_000)
      && textField(value.method, value, "method", 4_000)
      && isRefusalRuling(value.ruling);
  }
  if (value.kind !== "adjudication"
    || !exactKeys(value, ["adjudication", "basisRefs", "kind", "proposals"])
    || !isExistingRefArray(value.basisRefs, 0, value, "basisRefs")
    || !isFeasibilityRuling(value.adjudication)
    || !Array.isArray(value.proposals)
    || value.proposals.length < 1
    || value.proposals.length > MAX_PROPOSALS) return false;
  budget.proposalCount += value.proposals.length;
  if (budget.proposalCount > MAX_PROPOSALS) return false;
  if (value.adjudication.kind === "highRisk"
    && value.adjudication.risk !== publicRisk) return false;
  try {
    const proposals = value.proposals.map(validateEntry);
    validateAdjudicationCrossFields(value.adjudication, proposals);
    const diagnostics: ProposalDiagnostic[] = [];
    const issues = validateVNextProposalBundleDependencies(proposals, diagnostics);
    if (issues.length > 0) throw new FieldValidationError(value, diagnostics);
    return true;
  } catch (error) {
    if (error instanceof FieldValidationError || error instanceof AuthoredSourceValidationError) throw error;
    return false;
  }
}

/** The whole action's frozen fictional duration: the exact microseconds of
 * one coarse tier. Whether zero is legal depends on the steps and is decided
 * at lowering and again by Rules, not here. */
function isActionDuration(value: unknown): value is string {
  return isActionDurationMicros(value);
}

function isFeasibilityRuling(value: unknown): value is VNextFeasibilityRuling {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "directSuccess") {
    return exactKeys(value, ["durationMicros", "kind", "risk", "successOutcome"])
      && textField(value.risk, value, "risk", 4_000)
      && textField(value.successOutcome, value, "successOutcome", 4_000)
      && isActionDuration(value.durationMicros);
  }
  if (value.kind === "check") {
    const risk = value.risk;
    const successOutcome = value.successOutcome;
    const failureOutcome = value.failureOutcome;
    return exactKeys(value, [
      "ability", "checkKind", "dc", "durationMicros", "failureOutcome", "kind", "mode", "risk",
      "skill", "successOutcome",
    ])
      && isCheckParameterValues(value)
      && textField(risk, value, "risk", 4_000)
      && textField(successOutcome, value, "successOutcome", 4_000)
      && textField(failureOutcome, value, "failureOutcome", 4_000)
      && isActionDuration(value.durationMicros);
  }
  return value.kind === "highRisk"
    && exactKeys(value, [
      "acceptedCosts", "check", "confirmationQuestion", "failureOutcome", "kind",
      "risk", "successOutcome",
    ])
    && textField(value.risk, value, "risk", 4_000)
    && textField(value.confirmationQuestion, value, "confirmationQuestion", 2_000)
    && textField(value.successOutcome, value, "successOutcome", 4_000)
    && textField(value.failureOutcome, value, "failureOutcome", 4_000)
    && (value.check === null || isCheckParameters(value.check))
    && isAttemptCosts(value.acceptedCosts);
}

function isRefusalRuling(value: unknown): boolean {
  return isPlainRecord(value)
    && (value.kind === "missingPrerequisite" || value.kind === "worldLawViolation")
    && exactKeys(value, ["attemptCosts", "kind", "nextActions", "prerequisites", "publicBasis"])
    && textField(value.publicBasis, value, "publicBasis", 4_000)
    && Array.isArray(value.prerequisites)
    && value.prerequisites.length <= MAX_PREREQUISITES
    && value.prerequisites.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["description", "kind", "ref"])
      && ["tool", "knowledge", "position", "permission", "condition"]
        .includes(String(entry.kind))
      && (entry.ref === null || refField(entry.ref, entry, "ref"))
      && textField(entry.description, entry, "description", 2_000))
    && Array.isArray(value.nextActions)
    && value.nextActions.length <= MAX_NEXT_ACTIONS
    && value.nextActions.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["basisRefs", "description"])
      && textField(entry.description, entry, "description", 2_000)
      && isExistingRefArray(entry.basisRefs, 0, entry, "basisRefs"))
    && isAttemptCosts(value.attemptCosts);
}

function isCheckParameters(value: unknown): value is VNextCheckParameters {
  return isPlainRecord(value)
    && exactKeys(value, ["ability", "checkKind", "dc", "mode", "skill"])
    && isCheckParameterValues(value);
}

function isCheckParameterValues(value: Record<string, unknown>): boolean {
  return isPlainRecord(value)
    && enumField(value, "checkKind", ["abilityCheck", "attack"])
    && enumField(value, "ability", ["str", "dex", "con", "int", "wis", "cha"])
    && (value.skill === null || refField(value.skill, value, "skill"))
    && checkedField(value, "dc", entry => Number.isSafeInteger(entry) && Number(entry) >= 1 && Number(entry) <= 40,
      { type: "integer", minimum: 1, maximum: 40 })
    && enumField(value, "mode", ["normal", "advantage", "disadvantage"]);
}

function isAttemptCosts(value: unknown): value is readonly VNextAttemptCost[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) return false;
  return value.every((cost) => {
    if (!isPlainRecord(cost) || typeof cost.kind !== "string") return false;
    if (cost.kind === "fictionTime") {
      return exactKeys(cost, ["durationMicros", "kind"])
        && typeof cost.durationMicros === "string"
        && /^[1-9][0-9]*$/u.test(cost.durationMicros)
        && Number.isSafeInteger(Number(cost.durationMicros));
    }
    if (cost.kind === "item") {
      return exactKeys(cost, ["charges", "durability", "entryRef", "kind", "quantity"])
        && refField(cost.entryRef, cost, "entryRef")
        && [cost.quantity, cost.charges, cost.durability].every(isNonnegativeInteger)
        && Number(cost.quantity) + Number(cost.charges) + Number(cost.durability) > 0;
    }
    return cost.kind === "resource"
      && exactKeys(cost, ["amount", "kind", "resourceId"])
      && refField(cost.resourceId, cost, "resourceId")
      && isPositiveInteger(cost.amount);
  });
}

function isMaterializedDefinition(
  value: unknown,
  parent: Record<string, unknown>,
): boolean {
  const { semanticKind, visibilityPolicyRef } = parent;
  if (!objectField(value, parent, "definition")
    || !exactKeys(value, [
      "affordances", "description", "label", "mechanicDefinitionRefs", "observableState",
      "sceneRef", "visibilityFactId", ...(semanticKind === "worldFact" ? ["worldFact"] : []),
      ...(semanticKind === "location" ? ["geometry"] : []), ...(semanticKind === "passage" ? ["passage"] : []),
    ])
    || !(value.sceneRef === null || refField(value.sceneRef, value, "sceneRef"))
    || !(value.visibilityFactId === null || refField(value.visibilityFactId, value, "visibilityFactId"))
    || !textField(value.label, value, "label", 500)
    || !textField(value.description, value, "description", 2_000)
    || !(value.observableState === null || textField(value.observableState, value, "observableState", 1_000))
    || !(value.affordances === null || checkedField(value, "affordances", entry => isTextArray(entry, 16, 500),
      { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 500 } }))
    || !isExistingRefArray(value.mechanicDefinitionRefs, 0, value, "mechanicDefinitionRefs")) return false;
  if (semanticKind === "sceneFeature" && value.sceneRef === null) return false;
  if (semanticKind === "worldFact" && value.sceneRef !== null) return false;
  if (semanticKind === "worldFact"
    && visibilityPolicyRef === "visibility:scene-observers") return false;
  if (semanticKind === "worldFact") return value.sceneRef === null && value.visibilityFactId === null && authoredWorldFactConform(value.worldFact);
  if (semanticKind === "location") return checkedField(value, "sceneRef", entry => entry !== null,
      { type: "string", referenceKind: "existing" }, "location:creation-scope-required", "CONSTRAINT_CONFLICT")
    && checkedField(value, "visibilityFactId", entry => entry === null, { type: "null" }, "location:visibility-fact-must-be-null", "CONSTRAINT_CONFLICT")
    && checkedField(parent, "visibilityPolicyRef", entry => entry === "visibility:scene-observers",
      { type: "string", const: "visibility:scene-observers" }, "location:scene-observer-policy-required", "CONSTRAINT_CONFLICT")
    && checkedField(value, "observableState", entry => entry === null, { type: "null" }, "location:observable-state-must-be-null", "CONSTRAINT_CONFLICT")
    && checkedField(value, "affordances", entry => entry === null, { type: "null" }, "location:affordances-must-be-null", "CONSTRAINT_CONFLICT")
    && checkedField(value, "mechanicDefinitionRefs", entry => Array.isArray(entry) && entry.length === 0,
      { type: "array", maxItems: 0 }, "location:mechanic-references-must-be-empty", "CONSTRAINT_CONFLICT")
    && rulesShapeField(value.geometry, value, "geometry", isCanonicalTacticalGeometry);
  if (semanticKind === "passage" && (!checkedField(value, "sceneRef", entry => entry !== null,
      { type: "string", referenceKind: "existing" }, "passage:creation-scope-required", "CONSTRAINT_CONFLICT")
    || !checkedField(value, "affordances", entry => entry === null, { type: "null" }, "passage:affordances-must-be-null", "CONSTRAINT_CONFLICT")
    || !checkedField(value, "mechanicDefinitionRefs", entry => Array.isArray(entry) && entry.length === 0,
      { type: "array", maxItems: 0 }, "passage:mechanic-references-must-be-empty", "CONSTRAINT_CONFLICT")
    || !enumField(value, "observableState", ["open", "closed", "blocked"])
    || !rulesShapeField(value.passage, value, "passage", dynamicPassageConform))) return false;
  if (visibilityPolicyRef === "visibility:hidden-until-evidence") {
    return checkedField(value, "visibilityFactId", entry => entry !== null, { type: "string", referenceKind: "existing" },
      "materialization:hidden-visibility-fact-required", "CONSTRAINT_CONFLICT");
  }
  return checkedField(value, "visibilityFactId", entry => entry === null, { type: "null" },
    "materialization:visibility-fact-must-be-null", "CONSTRAINT_CONFLICT");
}

function isSemanticOperations(
  value: unknown,
  domain: "npc" | "world",
): value is readonly VNextSemanticDefinitionOperation[] {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= MAX_OPERATIONS
    && value.every((operation) => {
      if (!isPlainRecord(operation)
        || !Array.isArray(operation.path)
        || operation.path.length < 1
        || operation.path.length > 8
        || !operation.path.every((entry) => isPathSegment(entry))) return false;
      if (operation.kind === "set") return domain === "npc"
        ? exactKeys(operation, ["kind", "path", "value"])
          && ((pathEquals(operation.path, ["semantics", "attitude"]) && textField(operation.value, operation, "value", 4_000))
            || (pathEquals(operation.path, ["semantics", "publicExpression"]) && publicExpressionConform(operation.value)))
        : exactKeys(operation, ["kind", "path", "value"])
          && worldSetValueMatches(operation.path, operation.value);
      if (domain !== "npc") return false;
      if (operation.kind === "upsertByRef") {
        return exactKeys(operation, ["entry", "kind", "path"])
          && isPlainRecord(operation.entry)
          && ((pathEquals(operation.path, ["semantics", "goals"])
              && exactKeys(operation.entry, ["description", "goalRef"])
              && isExistingRef(operation.entry.goalRef)
              && isText(operation.entry.description, 2_000))
            || (pathEquals(operation.path, ["semantics", "plans"])
              && exactKeys(operation.entry, ["description", "planRef"])
              && isExistingRef(operation.entry.planRef)
              && isText(operation.entry.description, 2_000)));
      }
      return operation.kind === "removeByRef"
        && exactKeys(operation, ["kind", "path", "ref"])
        && (pathEquals(operation.path, ["semantics", "goals"])
          || pathEquals(operation.path, ["semantics", "plans"]))
        && isExistingRef(operation.ref);
    });
}

function worldSetValueMatches(path: readonly string[], value: unknown): boolean {
  const valuePaths = [
    ["observableState"],
    ["description"],
    ["semantics", "observableState"],
    ["semantics", "description"],
  ];
  if (valuePaths.some((candidate) => pathEquals(path, candidate))) {
    return isText(value, 4_000);
  }
  return ([
    ["affordances"],
    ["semantics", "affordances"],
  ] as const).some((candidate) => pathEquals(path, candidate))
    && isTextArray(value, 16, 500);
}

function pathEquals(value: readonly string[], expected: readonly string[]): boolean {
  return value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function isBranch(value: unknown): value is VNextWorldInteractionBranchProposal {
  return isPlainRecord(value)
    && exactKeys(value, [
      "effects", "opportunities", "outcomeCode", "pressures", "sensoryEvidence", "summary",
    ])
    && isBranchEvidence(value)
    && arrayField(value.effects, value, "effects", 0, MAX_EFFECTS)
    && value.effects.every(isWorldEffect)
    && arrayField(value.pressures, value, "pressures", 0, MAX_PRESSURES)
    && value.pressures.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["basisRefs", "description", "sourceRef"])
      && textField(entry.description, entry, "description", 2_000)
      && (entry.sourceRef === null || refField(entry.sourceRef, entry, "sourceRef", true))
      && isTypedRefArray(entry.basisRefs, 0, entry, "basisRefs"))
    && arrayField(value.opportunities, value, "opportunities", 0, MAX_OPPORTUNITIES)
    && value.opportunities.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["actionHint", "basisRefs", "description", "targetRef"])
      && textField(entry.description, entry, "description", 2_000)
      && (entry.targetRef === null || refField(entry.targetRef, entry, "targetRef", true))
      && (entry.actionHint === null || textField(entry.actionHint, entry, "actionHint", 2_000))
      && isTypedRefArray(entry.basisRefs, 0, entry, "basisRefs"));
}

/** Observation and world interactions validate the same submitted evidence
 * objects; do not synthesize a branch whose diagnostic identity is lost. */
function isBranchEvidence(value: Record<string, unknown>): boolean {
  return refField(value.outcomeCode, value, "outcomeCode")
    && textField(value.summary, value, "summary", 4_000)
    && arrayField(value.sensoryEvidence, value, "sensoryEvidence", 0, MAX_EVIDENCE)
    && value.sensoryEvidence.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["basisRefs", "evidence", "observerRef", "sense", "subjectRef"])
      && refField(entry.observerRef, entry, "observerRef")
      && (entry.subjectRef === null || refField(entry.subjectRef, entry, "subjectRef", true))
      && enumField(entry, "sense", ["sight", "hearing", "smell", "touch", "taste", "special"])
      && textField(entry.evidence, entry, "evidence", 2_000)
      && isTypedRefArray(entry.basisRefs, 0, entry, "basisRefs"));
}

function isWorldEffect(value: unknown): value is VNextWorldSemanticEffect {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "traversePassage") return exactKeys(value, ["kind", "passageRef"])
    && refField(value.passageRef, value, "passageRef");
  if (value.kind === "relationTransition") {
    return exactKeys(value, ["kind", "relationRef", "toState"])
      && refField(value.relationRef, value, "relationRef", true)
      && enumField(value, "toState", ["active", "ended"]);
  }
  if (value.kind === "definitionRevision") {
    return exactKeys(value, ["definitionRef", "kind", "operations", "summary"])
      && refField(value.definitionRef, value, "definitionRef", true)
      && isSemanticOperations(value.operations, "world")
      && textField(value.summary, value, "summary", 2_000);
  }
  return value.kind === "registeredHazard"
    && exactKeys(value, ["damage", "kind", "sourceDefinitionRef", "zoneRef"])
    && refField(value.sourceDefinitionRef, value, "sourceDefinitionRef", true)
    && refField(value.zoneRef, value, "zoneRef", true)
    && isHazardDamage(value.damage);
}

/**
 * A hazard's damage comes either from a danger the runtime ships or from one
 * the KP froze during play under SPEC 0001 section 8. One closed choice, never
 * both, and never a shape with the other side's field left optional.
 */
function isHazardDamage(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.kind === "profile") {
    return exactKeys(value, ["damageProfileRef", "kind"])
      && value.damageProfileRef === "world-damage:falling-object:moderate";
  }
  return value.kind === "authored"
    && exactKeys(value, ["hazardDefinitionRef", "kind", ...(Object.hasOwn(value, "area") ? ["area"] : [])])
    && (!Object.hasOwn(value, "area") || checkedField(value, "area", isAuthoredExecutionArea,
      { type: "object", requirement: "authored-execution-area" }))
    && refField(value.hazardDefinitionRef, value, "hazardDefinitionRef", true);
}

function isConsumes(value: unknown, parent: Record<string, unknown>): value is readonly VNextBundleReference[] {
  if (!arrayField(value, parent, "consumes", 0, MAX_REFS)) return false;
  const identities = new Set<string>();
  return value.every((entry, index) => {
    if (!isPlainRecord(entry)) throw new FieldValidationError(value, [
      proposalDiagnostic("TYPE_MISMATCH", "dependency-reference-object", {
        path: [index], expected: { type: "object" }, actual: diagnosticActual(entry),
      }),
    ]);
    enumField(entry, "kind", ["existing", "prospective"]);
    const key = entry.kind === "existing" ? "ref" : "handle";
    exactKeys(entry, ["kind", key]);
    if (key === "ref") refField(entry.ref, entry, key);
    else checkedField(entry, key, isLocalHandle,
      { type: "string", pattern: LOCAL_HANDLE_PATTERN.source }, "reference-field-grammar");
    const identity = `${entry.kind}:${entry[key]}`;
    if (identities.has(identity)) throw new FieldValidationError(value, [
      proposalDiagnostic("VALUE_INVALID", "dependency-reference-unique", {
        path: [index], expected: { uniqueItems: true }, actual: { kind: entry.kind, [key]: entry[key] },
      }),
    ]);
    identities.add(identity);
    return true;
  });
}

function isProduces(value: unknown, parent: Record<string, unknown>): value is readonly VNextBundleProducedReference[] {
  if (!arrayField(value, parent, "produces", 0, 1)) return false;
  return value.every((entry, index) => {
    if (!isPlainRecord(entry)) throw new FieldValidationError(value, [
      proposalDiagnostic("TYPE_MISMATCH", "dependency-reference-object", {
        path: [index], expected: { type: "object" }, actual: diagnosticActual(entry),
      }),
    ]);
    return exactKeys(entry, ["handle", "kind", "outcomeBinding"])
      && checkedField(entry, "handle", isLocalHandle, { type: "string", pattern: LOCAL_HANDLE_PATTERN.source }, "reference-field-grammar")
      && enumField(entry, "kind", ["semanticDefinition", "abilityDefinition", "hazardDefinition", "itemDefinition", "itemEntry"])
      && enumField(entry, "outcomeBinding", ["always", "onSuccess", "onFailure"]);
  });
}

/** Entry-specific constraints use the already validated declarations. These
 * describe dependencies, so changing their count, kind or branch is a decision. */
function isProducerForEntry(value: Record<string, unknown>): boolean {
  const contract = vnextEntryProducerContract(value);
  if (!contract) return false;
  const { kind, count } = contract;
  const produces = value.produces as readonly VNextBundleProducedReference[];
  const details: ProposalDiagnostic[] = [];
  const repair = { allowed: false, reason: "changing-producer-declarations-requires-a-decision" } as const;
  if (produces.length !== count) details.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal-producer-count", {
    path: ["produces"], expected: { type: "array", minItems: count, maxItems: count }, actual: diagnosticActual(produces), repair,
  }));
  else if (kind !== null) {
    const producer = produces[0]!;
    if (producer.kind !== kind) details.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal-producer-kind", {
      path: ["produces", 0, "kind"], expected: { type: "string", enum: [kind] }, actual: diagnosticActual(producer.kind), repair,
    }));
    if (producer.outcomeBinding !== value.outcomeBinding) details.push(proposalDiagnostic("CONSTRAINT_CONFLICT", "proposal-producer-outcome-binding", {
      path: ["produces", 0, "outcomeBinding"], expected: { type: "string", enum: [value.outcomeBinding] }, actual: diagnosticActual(producer.outcomeBinding), repair,
    }));
  }
  if (details.length) throw new FieldValidationError(value, details);
  return true;
}

type RulesShapeDiagnostic = SocialShapeDiagnostic | SpatialShapeDiagnostic;

/** Rules owns source shape requirements; this adapter only locates their
 * diagnostics in the submitted tree and describes the submitted actual value. */
function rulesShapeField<T>(value: unknown, parent: Record<string, unknown>, key: string,
  conform: (value: unknown, diagnostics?: RulesShapeDiagnostic[]) => value is T): value is T {
  const details: RulesShapeDiagnostic[] = [];
  if (conform(value, details)) return true;
  if (details.length === 0) return false;
  throw new FieldValidationError(parent, details.map(detail => {
    let actual: unknown = parent[key];
    for (const part of detail.path) {
      actual = actual !== null && typeof actual === "object" ? (actual as Record<string | number, unknown>)[part] : undefined;
    }
    return proposalDiagnostic(detail.code, detail.constraint, { path: [key, ...detail.path],
      expected: detail.expected, actual: diagnosticActual(actual) });
  }));
}

function isExistingRefArray(value: unknown, minimum = 0,
  parent?: Record<string, unknown>, key?: string): value is readonly string[] {
  return isRefArray(value, minimum, isExistingRef, "existing", parent, key);
}

function isTypedRefArray(value: unknown, minimum = 0,
  parent?: Record<string, unknown>, key?: string): value is readonly string[] {
  return isRefArray(value, minimum, isTypedRef, "existing-or-prospective", parent, key);
}

function isRefArray(
  value: unknown,
  minimum: number,
  predicate: (candidate: unknown) => candidate is string,
  referenceKind: "existing" | "existing-or-prospective",
  parent?: Record<string, unknown>,
  key?: string,
): value is readonly string[] {
  const expected = { type: "array", minItems: minimum, maxItems: MAX_REFS, uniqueItems: true };
  if (!Array.isArray(value)) return parent !== undefined && key !== undefined
    ? checkedField(parent, key, Array.isArray, expected) : false;
  if (value.length < minimum || value.length > MAX_REFS) throw new FieldValidationError(value, [
    proposalDiagnostic("VALUE_INVALID", "reference-array-size", { expected, actual: diagnosticActual(value) }),
  ]);
  for (let index = 0; index < value.length; index += 1) {
    const ref = value[index];
    if (!predicate(ref)) throw new FieldValidationError(value, [proposalDiagnostic(
      typeof ref === "string" ? "VALUE_INVALID" : "TYPE_MISMATCH", "reference-field-grammar", {
        path: [index], expected: { type: "string", referenceKind }, actual: diagnosticActual(ref),
      })]);
    if (value.indexOf(ref) !== index) throw new FieldValidationError(value, [
      proposalDiagnostic("VALUE_INVALID", "reference-array-unique", { path: [index], expected: { uniqueItems: true }, actual: diagnosticActual(ref) }),
    ]);
  }
  return true;
}

function isTypedRef(value: unknown): value is string {
  return isExistingRef(value) || isLocalHandle(value);
}

function isExistingRef(value: unknown): value is string {
  return isText(value, 300)
    && value !== "none"
    && !/\s/u.test(value)
    && !value.startsWith("prospective:");
}

function isLocalHandle(value: unknown): value is string {
  return typeof value === "string" && LOCAL_HANDLE_PATTERN.test(value);
}

function isPathSegment(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value);
}

function isTextArray(value: unknown, maximumItems: number, maximumLength: number): boolean {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((entry) => isText(entry, maximumLength))
    && new Set(value).size === value.length;
}

function isText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && value.normalize("NFC") === value;
}

function isSha256(value: unknown): boolean {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isSubset(subset: unknown, superset: unknown): boolean {
  return Array.isArray(subset)
    && Array.isArray(superset)
    && subset.every((entry) => superset.includes(entry));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const sorted = [...expected].sort(compareCodeUnits);
  const missing = sorted.filter(key => !Object.hasOwn(value, key));
  const additional = actual.filter(key => !sorted.includes(key));
  if (missing.length || additional.length) throw new FieldValidationError(value, [
    ...missing.map(key => proposalDiagnostic("FIELD_MISSING", "required-field", { path: [key], expected: { required: true }, actual: { type: "missing" } })),
    ...additional.map(key => proposalDiagnostic("VALUE_INVALID", "closed-object-additional-field", { path: [key], expected: { allowedFields: sorted }, actual: diagnosticActual(value[key]) })),
  ]);
  return true;
}

/** Locate the existing schema matcher's relative diagnostics in this entry.
 * Semantic guard failures without structured evidence keep their original rejection. */
function authoredSchemaField(parent: Record<string, unknown>, key: string, index: number, constraint: string,
  conform: (value: unknown, diagnostics: AuthoredSourceDiagnostic[]) => boolean): boolean {
  const diagnostics: AuthoredSourceDiagnostic[] = [];
  if (conform(parent[key], diagnostics)) return true;
  if (diagnostics.length === 0) return false;
  throw new AuthoredSourceValidationError(parent, diagnostics.map(diagnostic => ({ ...diagnostic,
    path: `/${key}${diagnostic.path}` })), index, constraint);
}

/** Reuse the selected native source schema for precise field diagnostics; the
 * Rules canonical predicate retains its safe-integer and authority boundary. */
function abilityOperationField(parent: Record<string, unknown>): boolean {
  const diagnostics: AuthoredSourceDiagnostic[] = [];
  if (!matchesAuthoredSourceSchema(parent.operation, ABILITY_OPERATION_SOURCE_SCHEMA, diagnostics)) {
    throw new AuthoredSourceValidationError(parent, diagnostics.map(diagnostic => ({ ...diagnostic,
      path: `/operation${diagnostic.path}` })), undefined, "ability:operation-invalid");
  }
  return checkedField(parent, "operation", isAbilityOperation, { type: "object", ...ABILITY_OPERATION_SOURCE_SCHEMA }, "ability:complete-operation-required");
}

class AuthoredSourceValidationError extends TypeError {
  readonly issues: string[];
  constructor(readonly subject: Record<string, unknown>,
    readonly sourceDiagnostics: readonly AuthoredSourceDiagnostic[], index: number | undefined, constraint = "bundle:authored-source-invalid") {
    super(constraint);
    this.issues = sourceDiagnostics.map(diagnostic => `${constraint}:${index === undefined ? "" : `/proposals/${index}`}${diagnostic.path}: ${diagnostic.reason}`);
  }
  diagnostics(root: unknown): readonly ProposalDiagnostic[] {
    const details = this.sourceDiagnostics.map(diagnostic => {
      let value: unknown = this.subject;
      const path = diagnostic.path.split("/").slice(1).map(segment => {
        const decoded = segment.replaceAll("~1", "/").replaceAll("~0", "~");
        const key = Array.isArray(value) && /^(0|[1-9][0-9]*)$/u.test(decoded) ? Number(decoded) : decoded;
        value = value !== null && typeof value === "object" ? (value as Record<string | number, unknown>)[key] : undefined;
        return key;
      });
      return proposalDiagnostic(diagnostic.code ?? "CONSTRAINT_CONFLICT",
        diagnostic.reason, { path, actual: diagnosticActual(value),
          ...(diagnostic.expected === undefined ? {} : { expected: diagnostic.expected }) });
    });
    return new FieldValidationError(this.subject, details).diagnostics(root);
  }
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function issue(error: unknown): string {
  return error instanceof Error ? error.message : "bundle:unknown-error";
}

function rejected(
  code: Extract<VNextProposalBundleValidationResult, { kind: "rejected" }>["code"],
  issues: readonly string[],
  diagnostics: readonly ProposalDiagnostic[] = diagnosticsFromIssues(code, issues),
): Extract<VNextProposalBundleValidationResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    issues: Object.freeze([...new Set(issues)].sort(compareCodeUnits)),
    diagnostics: deepFreeze([...diagnostics]),
  });
}

/** Failed checks carry the object actually checked. The catch resolves its
 * identity in the original JSON tree, never guessing a path from value text. */
class FieldValidationError extends TypeError {
  constructor(readonly subject: object, readonly details: readonly ProposalDiagnostic[]) {
    super(details.map(detail => detail.constraint).join(","));
  }
  diagnostics(root: unknown): readonly ProposalDiagnostic[] {
    const matches: Array<readonly (string | number)[]> = [];
    const visit = (value: unknown, path: readonly (string | number)[], ancestors: ReadonlySet<object>) => {
      if (value === this.subject) matches.push(path);
      if (value === null || typeof value !== "object" || ancestors.has(value)) return;
      const next = new Set(ancestors); next.add(value);
      for (const [key, child] of Object.entries(value)) visit(child, [...path, Array.isArray(value) ? Number(key) : key], next);
    };
    visit(root, [], new Set());
    return this.details.map(({ path, ...detail }) => proposalDiagnostic(detail.code, detail.constraint,
      { ...detail, ...(matches.length === 1 ? { path: [...matches[0]!, ...(path ?? [])] } : {}) }));
  }
}

function checkedField(parent: Record<string, unknown> | readonly unknown[], key: string | number, predicate: (value: unknown) => boolean,
  expected: { type: string; [key: string]: unknown }, constraint = "field-contract",
  code?: ProposalDiagnostic["code"]): boolean {
  const value = (parent as Record<string | number, unknown>)[key];
  if (predicate(value)) return true;
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  throw new FieldValidationError(parent, [proposalDiagnostic(
    code ?? (!Object.hasOwn(parent, key) ? "FIELD_MISSING"
      : actualType !== expected.type && !(expected.type === "integer" && actualType === "number") ? "TYPE_MISMATCH" : "VALUE_INVALID"),
    constraint, { path: [key], expected, actual: diagnosticActual(value) })]);
}

function enumField(parent: Record<string, unknown>, key: string, alternatives: readonly string[]): boolean {
  return checkedField(parent, key, value => typeof value === "string" && alternatives.includes(value), { type: "string", enum: alternatives });
}

function arrayField(value: unknown, parent: Record<string, unknown>, key: string, minimum: number, maximum: number): value is unknown[] {
  return checkedField(parent, key, entry => Array.isArray(entry) && entry.length >= minimum && entry.length <= maximum,
    { type: "array", minItems: minimum, maxItems: maximum }, "array-field-contract");
}

function objectField(value: unknown, parent: Record<string, unknown>, key: string): value is Record<string, unknown> {
  return checkedField(parent, key, isPlainRecord, { type: "object" });
}

function refField(value: unknown, parent: Record<string, unknown> | readonly unknown[], key: string | number, typed = false): value is string {
  return checkedField(parent, key, typed ? isTypedRef : isExistingRef,
    { type: "string", referenceKind: typed ? "existing-or-prospective" : "existing" }, "reference-field-grammar");
}

function textField(value: unknown, parent: Record<string, unknown>, key: string, maximum: number): value is string {
  return checkedField(parent, key, entry => isText(entry, maximum),
    { type: "string", minLength: 1, maxLength: maximum, normalization: "NFC", whitespace: "trimmed" });
}
