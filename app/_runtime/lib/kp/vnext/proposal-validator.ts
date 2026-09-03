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

/**
 * Closed local validation is authoritative even when the Provider claims
 * strict decoding. Provider schema support proves transport compatibility;
 * this validator owns size, cross-field, dependency, and semantic invariants.
 */
export function validateVNextProposalBundle(
  value: unknown,
): VNextProposalBundleValidationResult {
  try {
    if (!isPlainRecord(value)
      || !exactKeys(value, [
        "adjudication", "basisRefs", "kind", "mode", "proposals", "schema", "terminal",
      ])
      || value.schema !== VNEXT2_PROPOSAL_BUNDLE_SCHEMA
      || value.kind !== "proposalBundle"
      || (value.mode !== "adjudication" && value.mode !== "terminal")
      || !isExistingRefArray(value.basisRefs)) {
      invalid("bundle:envelope-invalid");
    }

    let bundle: VNextProposalBundle;
    if (value.mode === "adjudication") {
      if (!isFeasibilityRuling(value.adjudication)
        || value.terminal !== null
        || !Array.isArray(value.proposals)
        || value.proposals.length < 1
        || value.proposals.length > MAX_PROPOSALS) {
        invalid("bundle:adjudication-shape-invalid");
      }
      const proposals = value.proposals.map(validateEntry);
      validateAdjudicationCrossFields(value.adjudication, proposals);
      const dependencyIssues = validateVNextProposalBundleDependencies(proposals);
      if (dependencyIssues.length > 0) {
        return rejected("BUNDLE_DEPENDENCY_INVALID", dependencyIssues);
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
      if (value.adjudication !== null
        || !isTerminalProposal(value.terminal, { proposalCount: 0 })
        || !Array.isArray(value.proposals)
        || value.proposals.length !== 0) {
        invalid("bundle:terminal-shape-invalid");
      }
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
    return rejected("PROPOSAL_BUNDLE_INVALID", [issue(error)]);
  }
}

function validateEntry(value: unknown): VNextProposalBundleEntry {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    invalid("bundle:entry-invalid");
  }
  const commonKeys = ["basisRefs", "consumes", "kind", "outcomeBinding", "produces"];
  if (!isTypedRefArray(value.basisRefs)
    || !isConsumes(value.consumes)
    || !isProduces(value.produces)
    || !isOutcomeBinding(value.outcomeBinding)) {
    invalid(`bundle:entry-common-invalid:${value.kind}`);
  }

  if (value.kind === "materializeObject") {
    if (!exactKeys(value, [
      ...commonKeys,
      "definition", "semanticKind", "summary", "templateHash", "templateRef",
      "visibilityPolicyRef",
    ])
      || (value.semanticKind !== "sceneFeature" && value.semanticKind !== "worldFact")
      || !isExistingRef(value.templateRef)
      || !isSha256(value.templateHash)
      || ![
        "visibility:public",
        "visibility:scene-observers",
        "visibility:hidden-until-evidence",
      ].includes(String(value.visibilityPolicyRef))
      || !isMaterializedDefinition(value.definition, value.semanticKind, value.visibilityPolicyRef)
      || !isText(value.summary, 2_000)
      || value.produces.length !== 1
      || value.produces[0]?.kind !== "semanticDefinition"
      || value.produces[0]?.outcomeBinding !== value.outcomeBinding) {
      invalid("bundle:materialization-invalid");
    }
    return value as VNextMaterializeObjectEntry;
  }

  if (value.kind === "reviseSemanticDefinition") {
    if (!exactKeys(value, [
      ...commonKeys,
      "baseHash", "baseRevision", "definitionRef", "npcRef", "operations",
      "semanticKind", "summary", "templateHash", "templateRef",
    ])
      || value.semanticKind !== "npc"
      || ![
        value.definitionRef,
        value.npcRef,
        value.baseRevision,
        value.templateRef,
      ].every(isExistingRef)
      || !isSha256(value.baseHash)
      || !isSha256(value.templateHash)
      || !isSemanticOperations(value.operations, "npc")
      || !isText(value.summary, 2_000)
      || value.produces.length !== 0) {
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
    || !isExistingRef(value.sceneRef)
    || !isTypedRefArray(value.targetRefs, 1)
    || !isTypedRefArray(value.directTargetRefs, 1)
    || !isSubset(value.directTargetRefs, value.targetRefs)
    || !isTypedRefArray(value.instrumentRefs)
    || !(value.abilityRef === null || isExistingRef(value.abilityRef))
    || !isText(value.intent, 4_000)
    || !isText(value.method, 4_000)
    || !isPlainRecord(value.branches)
    || !exactKeys(value.branches, ["failure", "success"])
    || !isBranch(value.branches.success)
    || !(value.branches.failure === null || isBranch(value.branches.failure))
    || value.produces.length !== 0) {
    invalid("bundle:world-interaction-invalid");
  }
  return value as VNextWorldInteractionEntry;
}

function validateAdjudicationCrossFields(
  ruling: VNextFeasibilityRuling,
  proposals: readonly VNextProposalBundleEntry[],
): void {
  const interactions = proposals.filter(
    (entry): entry is VNextWorldInteractionEntry => entry.kind === "worldInteraction",
  );
  if (ruling.kind === "directSuccess"
    || (ruling.kind === "highRisk" && ruling.check === null)) {
    if (proposals.some((entry) => entry.outcomeBinding !== "always")
      || interactions.some((entry) => entry.branches.failure !== null)) {
      invalid("bundle:non-random-outcome-binding-invalid");
    }
    return;
  }
  if (interactions.length !== 1
    || interactions[0]?.outcomeBinding !== "always"
    || interactions[0].branches.failure === null) {
    invalid("bundle:shared-check-shape-invalid");
  }
}

function isTerminalProposal(
  value: unknown,
  budget: { proposalCount: number },
): value is VNextClarificationTerminal | VNextInWorldRefusalTerminal {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "clarification") {
    if (!exactKeys(value, ["choices", "intent", "kind", "method", "question"])
      || !isText(value.intent, 4_000)
      || !isText(value.method, 4_000)
      || !isText(value.question, 2_000)
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
        || !isText(choice.label, 1_000)
        || !isText(choice.publicRisk, 2_000)
        || !isExistingRefArray(choice.basisRefs)
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
    && isText(value.intent, 4_000)
    && isText(value.method, 4_000)
    && isRefusalRuling(value.ruling);
}

function isClarificationContinuation(
  value: unknown,
  publicRisk: string,
  budget: { proposalCount: number },
): value is VNextClarificationContinuation {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "cancel") return exactKeys(value, ["kind"]);
  if (value.kind === "inWorldRefusal") {
    return exactKeys(value, ["basisRefs", "intent", "kind", "method", "ruling"])
      && isExistingRefArray(value.basisRefs)
      && isText(value.intent, 4_000)
      && isText(value.method, 4_000)
      && isRefusalRuling(value.ruling);
  }
  if (value.kind !== "adjudication"
    || !exactKeys(value, ["adjudication", "basisRefs", "kind", "proposals"])
    || !isExistingRefArray(value.basisRefs)
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
    return validateVNextProposalBundleDependencies(proposals).length === 0;
  } catch {
    return false;
  }
}

function isFeasibilityRuling(value: unknown): value is VNextFeasibilityRuling {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "directSuccess") {
    return exactKeys(value, ["kind", "risk", "successOutcome"])
      && isText(value.risk, 4_000)
      && isText(value.successOutcome, 4_000);
  }
  if (value.kind === "check") {
    const risk = value.risk;
    const successOutcome = value.successOutcome;
    const failureOutcome = value.failureOutcome;
    return exactKeys(value, [
      "ability", "checkKind", "dc", "failureOutcome", "kind", "mode", "risk",
      "skill", "successOutcome",
    ])
      && isCheckParameterValues(value)
      && isText(risk, 4_000)
      && isText(successOutcome, 4_000)
      && isText(failureOutcome, 4_000);
  }
  return value.kind === "highRisk"
    && exactKeys(value, [
      "acceptedCosts", "check", "confirmationQuestion", "failureOutcome", "kind",
      "risk", "successOutcome",
    ])
    && isText(value.risk, 4_000)
    && isText(value.confirmationQuestion, 2_000)
    && isText(value.successOutcome, 4_000)
    && isText(value.failureOutcome, 4_000)
    && (value.check === null || isCheckParameters(value.check))
    && isAttemptCosts(value.acceptedCosts);
}

function isRefusalRuling(value: unknown): boolean {
  return isPlainRecord(value)
    && (value.kind === "missingPrerequisite" || value.kind === "worldLawViolation")
    && exactKeys(value, ["attemptCosts", "kind", "nextActions", "prerequisites", "publicBasis"])
    && isText(value.publicBasis, 4_000)
    && Array.isArray(value.prerequisites)
    && value.prerequisites.length <= MAX_PREREQUISITES
    && value.prerequisites.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["description", "kind", "ref"])
      && ["tool", "knowledge", "position", "permission", "condition"]
        .includes(String(entry.kind))
      && (entry.ref === null || isExistingRef(entry.ref))
      && isText(entry.description, 2_000))
    && Array.isArray(value.nextActions)
    && value.nextActions.length <= MAX_NEXT_ACTIONS
    && value.nextActions.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["basisRefs", "description"])
      && isText(entry.description, 2_000)
      && isExistingRefArray(entry.basisRefs))
    && isAttemptCosts(value.attemptCosts);
}

function isCheckParameters(value: unknown): value is VNextCheckParameters {
  return isPlainRecord(value)
    && exactKeys(value, ["ability", "checkKind", "dc", "mode", "skill"])
    && isCheckParameterValues(value);
}

function isCheckParameterValues(value: Record<string, unknown>): boolean {
  return isPlainRecord(value)
    && ["abilityCheck", "attack"].includes(String(value.checkKind))
    && ["str", "dex", "con", "int", "wis", "cha"].includes(String(value.ability))
    && (value.skill === null || isExistingRef(value.skill))
    && Number.isSafeInteger(value.dc)
    && Number(value.dc) >= 1
    && Number(value.dc) <= 40
    && ["normal", "advantage", "disadvantage"].includes(String(value.mode));
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
        && isExistingRef(cost.entryRef)
        && [cost.quantity, cost.charges, cost.durability].every(isNonnegativeInteger)
        && Number(cost.quantity) + Number(cost.charges) + Number(cost.durability) > 0;
    }
    return cost.kind === "resource"
      && exactKeys(cost, ["amount", "kind", "resourceId"])
      && isExistingRef(cost.resourceId)
      && isPositiveInteger(cost.amount);
  });
}

function isMaterializedDefinition(
  value: unknown,
  semanticKind: unknown,
  visibilityPolicyRef: unknown,
): boolean {
  if (!isPlainRecord(value)
    || !exactKeys(value, [
      "affordances", "description", "label", "mechanicDefinitionRefs", "observableState",
      "sceneRef", "visibilityFactId",
    ])
    || !(value.sceneRef === null || isExistingRef(value.sceneRef))
    || !(value.visibilityFactId === null || isExistingRef(value.visibilityFactId))
    || !isText(value.label, 500)
    || !isText(value.description, 2_000)
    || !isText(value.observableState, 1_000)
    || !isTextArray(value.affordances, 16, 500)
    || !isExistingRefArray(value.mechanicDefinitionRefs)) return false;
  if (semanticKind === "sceneFeature" && value.sceneRef === null) return false;
  if (semanticKind === "worldFact" && value.sceneRef !== null) return false;
  if (semanticKind === "worldFact"
    && visibilityPolicyRef === "visibility:scene-observers") return false;
  if (visibilityPolicyRef === "visibility:hidden-until-evidence") {
    return value.visibilityFactId !== null;
  }
  return value.visibilityFactId === null;
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
          && pathEquals(operation.path, ["semantics", "attitude"])
          && isText(operation.value, 4_000)
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
    && isExistingRef(value.outcomeCode)
    && isText(value.summary, 4_000)
    && Array.isArray(value.effects)
    && value.effects.length <= MAX_EFFECTS
    && value.effects.every(isWorldEffect)
    && Array.isArray(value.sensoryEvidence)
    && value.sensoryEvidence.length <= MAX_EVIDENCE
    && value.sensoryEvidence.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["basisRefs", "evidence", "observerRef", "sense", "subjectRef"])
      && isExistingRef(entry.observerRef)
      && (entry.subjectRef === null || isTypedRef(entry.subjectRef))
      && ["sight", "hearing", "smell", "touch", "taste", "special"].includes(String(entry.sense))
      && isText(entry.evidence, 2_000)
      && isTypedRefArray(entry.basisRefs))
    && Array.isArray(value.pressures)
    && value.pressures.length <= MAX_PRESSURES
    && value.pressures.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["basisRefs", "description", "sourceRef"])
      && isText(entry.description, 2_000)
      && (entry.sourceRef === null || isTypedRef(entry.sourceRef))
      && isTypedRefArray(entry.basisRefs))
    && Array.isArray(value.opportunities)
    && value.opportunities.length <= MAX_OPPORTUNITIES
    && value.opportunities.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["actionHint", "basisRefs", "description", "targetRef"])
      && isText(entry.description, 2_000)
      && (entry.targetRef === null || isTypedRef(entry.targetRef))
      && (entry.actionHint === null || isText(entry.actionHint, 2_000))
      && isTypedRefArray(entry.basisRefs));
}

function isWorldEffect(value: unknown): value is VNextWorldSemanticEffect {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "relationTransition") {
    return exactKeys(value, ["kind", "relationRef", "toState"])
      && isTypedRef(value.relationRef)
      && (value.toState === "active" || value.toState === "ended");
  }
  if (value.kind === "definitionRevision") {
    return exactKeys(value, ["definitionRef", "kind", "operations", "summary"])
      && isTypedRef(value.definitionRef)
      && isSemanticOperations(value.operations, "world")
      && isText(value.summary, 2_000);
  }
  return value.kind === "registeredHazard"
    && exactKeys(value, ["damageProfileRef", "kind", "sourceDefinitionRef", "zoneRef"])
    && isTypedRef(value.sourceDefinitionRef)
    && isTypedRef(value.zoneRef)
    && value.damageProfileRef === "world-damage:falling-object:moderate";
}

function isConsumes(value: unknown): value is readonly VNextBundleReference[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) return false;
  const identities = new Set<string>();
  return value.every((entry) => {
    if (!isPlainRecord(entry)) return false;
    const identity = entry.kind === "existing"
      && exactKeys(entry, ["kind", "ref"])
      && isExistingRef(entry.ref)
      ? `existing:${entry.ref}`
      : entry.kind === "prospective"
        && exactKeys(entry, ["handle", "kind"])
        && isLocalHandle(entry.handle)
        ? `prospective:${entry.handle}`
        : undefined;
    if (identity === undefined || identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

function isProduces(value: unknown): value is readonly VNextBundleProducedReference[] {
  if (!Array.isArray(value) || value.length > 1) return false;
  return value.every((entry) => isPlainRecord(entry)
    && exactKeys(entry, ["handle", "kind", "outcomeBinding"])
    && isLocalHandle(entry.handle)
    && entry.kind === "semanticDefinition"
    && isOutcomeBinding(entry.outcomeBinding));
}

function isExistingRefArray(value: unknown, minimum = 0): value is readonly string[] {
  return isRefArray(value, minimum, isExistingRef);
}

function isTypedRefArray(value: unknown, minimum = 0): value is readonly string[] {
  return isRefArray(value, minimum, isTypedRef);
}

function isRefArray(
  value: unknown,
  minimum: number,
  predicate: (candidate: unknown) => candidate is string,
): value is readonly string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= MAX_REFS
    && value.every(predicate)
    && new Set(value).size === value.length;
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

function isOutcomeBinding(value: unknown): value is "always" | "onSuccess" | "onFailure" {
  return value === "always" || value === "onSuccess" || value === "onFailure";
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
  return actual.length === sorted.length
    && actual.every((key, index) => key === sorted[index]);
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
): Extract<VNextProposalBundleValidationResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    issues: Object.freeze([...new Set(issues)].sort(compareCodeUnits)),
  });
}
