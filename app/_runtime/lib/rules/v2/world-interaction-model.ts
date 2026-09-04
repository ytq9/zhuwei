import { canonicalSha256 } from "../profiles/canonical";
import type { Sha256Ref } from "../profiles/types";
import type { FrozenCheck, JsonRecord } from "./model";
import {
  isSemanticDefinitionMaterializationPlan,
  isStoredSemanticDefinition,
  type SemanticDefinitionMaterializationPlan,
  type SemanticDefinitionKind,
  type SemanticDefinitionOperation,
  type StoredSemanticDefinition,
} from "./semantic-definitions";
import {
  isWorldDamageProfileRef,
  type WorldDamageProfileRef,
} from "../profiles/world-interaction-registry";

export const SEMANTIC_DEFINITION_REVISION_PLAN_SCHEMA =
  "zhuwei.semantic-definition-revision-plan/v1" as const;
export const WORLD_INTERACTION_RESOLUTION_PLAN_SCHEMA =
  "zhuwei.world-interaction-resolution-plan/v1" as const;
export const WORLD_INTERACTION_FEASIBILITY_RULING_PLAN_SCHEMA =
  "zhuwei.world-interaction-feasibility-ruling-plan/v1" as const;
export const ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA =
  "zhuwei.atomic-world-interaction-steps-plan/v1" as const;

export type VersionedAuthorityBinding = Readonly<{
  ref: string;
  revisionOrHash: string;
}>;

export type SemanticDefinitionRevisionPlan = Readonly<{
  schema: typeof SEMANTIC_DEFINITION_REVISION_PLAN_SCHEMA;
  definitionRef: string;
  semanticKind: SemanticDefinitionKind;
  baseRevision: string;
  baseHash: string;
  templateRef: string;
  templateHash: string;
  contextHash: Sha256Ref;
  readSet: readonly VersionedAuthorityBinding[];
  basisRefs: readonly string[];
  operations: readonly SemanticDefinitionOperation[];
  summary: string;
}>;

export type WorldInteractionCost = Readonly<{
  kind: "item";
  entryRef: string;
  quantity: number;
  charges: number;
  durability: number;
}>;

/**
 * What an attempt really spent before the world declined it.
 *
 * This is a wider union than `WorldInteractionCost` on purpose. An executed
 * interaction's costs must reconcile byte-for-byte against its frozen Ability,
 * and an Ability only ever freezes item costs -- so that path must never see a
 * shape it cannot reconcile. A refused attempt is the opposite case: it spends
 * whatever the trying itself burned, which is usually the minutes, sometimes a
 * charge of something, and sometimes the slot that was already committed
 * before the world said no. Two types rather than one is what keeps the
 * reconciled path unable to represent the unreconcilable.
 */
export type WorldInteractionAttemptCost =
  | WorldInteractionCost
  | Readonly<{ kind: "fictionTime"; durationMicros: string }>
  | Readonly<{ kind: "resource"; resourceId: string; amount: number }>;

export type WorldInteractionRelationEffect = Readonly<{
  kind: "relationTransition";
  relationRef: string;
  relationKind: "supports" | "attachedTo" | "contains" | "blocks" | "triggers";
  subjectRef: string;
  objectRef: string;
  fromState: "active" | "ended";
  toState: "active" | "ended";
  nextDefinition: StoredSemanticDefinition;
  summary: string;
}>;

export type WorldInteractionDefinitionEffect = Readonly<{
  kind: "definitionRevision";
  nextDefinition: StoredSemanticDefinition;
  summary: string;
}>;

/** The plan retains only a registered mechanic request. Rules resolves the
 * actual targets and numeric effect from authoritative relations/Geometry at
 * settlement; neither the KP nor Room lowering may freeze those results. */
export type WorldInteractionRegisteredHazardEffect = Readonly<{
  kind: "registeredHazard";
  sourceDefinitionRef: string;
  zoneRef: string;
  damageProfileRef: WorldDamageProfileRef;
}>;

export type WorldInteractionEffect =
  | WorldInteractionRelationEffect
  | WorldInteractionDefinitionEffect
  | WorldInteractionRegisteredHazardEffect;

export type WorldInteractionSensoryEvidence = Readonly<{
  observerRef: string;
  subjectRef: string | null;
  sense: "sight" | "hearing" | "smell" | "touch" | "taste" | "special";
  evidence: string;
  visibilityPolicyRef: string;
  basisRefs: readonly string[];
}>;

export type WorldInteractionPressure = Readonly<{
  description: string;
  sourceRef: string | null;
  visibilityPolicyRef: string;
  basisRefs: readonly string[];
}>;

export type WorldInteractionOpportunity = Readonly<{
  description: string;
  targetRef: string | null;
  actionHint: string | null;
  visibilityPolicyRef: string;
  basisRefs: readonly string[];
}>;

export type WorldInteractionBranch = Readonly<{
  outcomeCode: string;
  summary: string;
  effects: readonly WorldInteractionEffect[];
  sensoryEvidence: readonly WorldInteractionSensoryEvidence[];
  pressures: readonly WorldInteractionPressure[];
  opportunities: readonly WorldInteractionOpportunity[];
}>;

export type WorldInteractionResolutionPlan = Readonly<{
  schema: typeof WORLD_INTERACTION_RESOLUTION_PLAN_SCHEMA;
  resolutionId: string;
  interactionRef: string;
  actorCharacterId: string;
  sceneRef: string;
  abilityRef: string | null;
  contextHash: Sha256Ref;
  readSet: readonly VersionedAuthorityBinding[];
  targetRefs: readonly string[];
  directTargetRefs: readonly string[];
  instrumentRefs: readonly string[];
  basisRefs: readonly string[];
  intent: string;
  method: string;
  ruling:
    | Readonly<{ kind: "directSuccess" }>
    | Readonly<{
        kind: "check";
        resolutionKind: "abilityCheck" | "attack";
        randomnessId: string;
        check: FrozenCheck;
      }>;
  costs: readonly WorldInteractionCost[];
  branches: Readonly<{
    success: WorldInteractionBranch;
    failure: WorldInteractionBranch;
  }>;
}>;

export type AtomicWorldInteractionOutcomeBinding = "always" | "onSuccess" | "onFailure";

export type AtomicWorldInteractionReference = Readonly<
  | { kind: "existing"; ref: string }
  | { kind: "prospective"; handle: string }
>;

export type AtomicWorldInteractionProducedReference = Readonly<{
  handle: string;
  kind: "semanticDefinition" | "canonicalFact" | "relation" | "itemEntry";
  outcomeBinding: AtomicWorldInteractionOutcomeBinding;
}>;

export type AtomicWorldInteractionRulesInput = Readonly<
  | {
      kind: "materializeSemanticDefinition";
      rootActionId: string;
      actorCharacterId: string;
      plan: SemanticDefinitionMaterializationPlan;
    }
  | {
      kind: "reviseSemanticDefinition";
      rootActionId: string;
      actorCharacterId: string;
      plan: SemanticDefinitionRevisionPlan;
    }
  | {
      kind: "resolveWorldInteraction";
      rootActionId: string;
      actorCharacterId: string;
      plan: WorldInteractionResolutionPlan;
    }
>;

export type AtomicWorldInteractionStep = Readonly<{
  formId: "materialization.vnext-1" | "world-interaction.vnext-1";
  proposalRef: string;
  ruling: "directSuccess" | "check";
  rulesInput: AtomicWorldInteractionRulesInput;
  dependsOn: readonly string[];
  consumes: readonly AtomicWorldInteractionReference[];
  produces: readonly AtomicWorldInteractionProducedReference[];
  outcomeBinding: AtomicWorldInteractionOutcomeBinding;
}>;

/** Frozen, server-normalized plan persisted only in the Room authority
 * continuation while a single shared check is waiting for Room randomness. */
export type AtomicWorldInteractionStepsPlan = Readonly<{
  schema: typeof ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA;
  rootActionId: string;
  actorCharacterId: string;
  bundleHash: Sha256Ref;
  contextHash: Sha256Ref;
  sharedRuling: "directSuccess" | "check";
  steps: readonly AtomicWorldInteractionStep[];
}>;

export type AtomicWorldInteractionStepsResolvedPayload = Readonly<{
  actorCharacterId: string;
  branch: "success" | "failure";
  checkResolutionId: string | null;
  steps: readonly Readonly<{
    proposalRef: string;
    outcomeBinding: AtomicWorldInteractionOutcomeBinding;
    status: "applied" | "skipped";
  }>[];
}>;

/**
 * A refusal cites what is missing/violated in plain terms, never the private
 * evidentiary basis for the ruling: `ref` is a target the player can act on
 * (a tool, a door), not a canonical-fact citation.
 */
export type WorldInteractionFeasibilityPrerequisite = Readonly<{
  kind: "tool" | "knowledge" | "position" | "permission" | "condition";
  ref: string | null;
  description: string;
}>;

/** Player-visible next-action hint. Its KP-authored basisRefs are folded into
 * the plan's own authority-only basisRefs at Room-bridge lowering time and
 * never travel any further -- this shape has no basisRefs field to leak. */
export type WorldInteractionFeasibilityNextAction = Readonly<{
  description: string;
}>;

/**
 * Server-frozen ruling that the world declined an action. This is not an
 * error: it is a first-class mechanical outcome, and any attempt costs that
 * were actually spent while trying still apply through the ordinary
 * attempt-cost transition path. `basisRefs` is authority-only and is carried
 * only for the
 * commit's read scope -- it is never copied into the committed payload.
 */
export type WorldInteractionFeasibilityRulingPlan = Readonly<{
  schema: typeof WORLD_INTERACTION_FEASIBILITY_RULING_PLAN_SCHEMA;
  actorCharacterId: string;
  intent: string;
  method: string;
  rulingKind: "missingPrerequisite" | "worldLawViolation";
  publicBasis: string;
  prerequisites: readonly WorldInteractionFeasibilityPrerequisite[];
  nextActions: readonly WorldInteractionFeasibilityNextAction[];
  costs: readonly WorldInteractionAttemptCost[];
  basisRefs: readonly string[];
}>;

export type WorldInteractionFeasibilityRuledPayload = Readonly<{
  actorCharacterId: string;
  intent: string;
  method: string;
  rulingKind: "missingPrerequisite" | "worldLawViolation";
  publicBasis: string;
  prerequisites: readonly WorldInteractionFeasibilityPrerequisite[];
  nextActions: readonly WorldInteractionFeasibilityNextAction[];
  appliedCosts: readonly Extract<
    AppliedWorldInteractionEffect,
    { kind: "itemCost" | "fictionTimeCost" | "resourceCost" }
  >[];
}>;

export type AppliedWorldInteractionEffect =
  | Readonly<{
      kind: "relationTransition";
      relationRef: string;
      relationKind: WorldInteractionRelationEffect["relationKind"];
      subjectRef: string;
      objectRef: string;
      fromState: WorldInteractionRelationEffect["fromState"];
      toState: WorldInteractionRelationEffect["toState"];
      definitionRef: string;
      fromRevision: string;
      toRevision: string;
      summary: string;
      visibilityPolicyRef: string;
      basisRefs: readonly string[];
    }>
  | Readonly<{
      kind: "definitionRevision";
      definitionRef: string;
      semanticKind: SemanticDefinitionKind;
      fromRevision: string;
      toRevision: string;
      summary: string;
      visibilityPolicyRef: string;
      basisRefs: readonly string[];
    }>
  | Readonly<{
      kind: "itemCost";
      entryRef: string;
      quantityBefore: number;
      quantityAfter: number;
      chargesBefore: number | null;
      chargesAfter: number | null;
      durabilityBefore: number | null;
      durabilityAfter: number | null;
    }>
  | Readonly<{
      kind: "fictionTimeCost";
      durationMicros: string;
      /** Carried so replay can check the clock really moved, the way an item
       * cost is checked against the entry it left behind. */
      nowMicrosAfter: string;
    }>
  | Readonly<{
      kind: "resourceCost";
      resourceId: string;
      amountBefore: number;
      amountAfter: number;
    }>
  | Readonly<{
      kind: "damage";
      sourceDefinitionRef: string;
      targetRef: string;
      amount: number;
      damageType: string;
      hpBefore: number;
      hpAfter: number;
      died: boolean;
    }>;

export type SemanticDefinitionRevisedPayload = Readonly<{
  actorCharacterId: string;
  definitionRef: string;
  semanticKind: SemanticDefinitionKind;
  baseRevision: string;
  baseHash: string;
  templateRef: string;
  templateHash: string;
  contextHash: Sha256Ref;
  basisRefs: readonly string[];
  summary: string;
  nextDefinition: StoredSemanticDefinition;
}>;

export type WorldInteractionResolvedPayload = Readonly<{
  interactionRef: string;
  resolutionId: string;
  actorCharacterId: string;
  sceneRef: string;
  abilityRef: string | null;
  targetRefs: readonly string[];
  directTargetRefs: readonly string[];
  instrumentRefs: readonly string[];
  basisRefs: readonly string[];
  contextHash: Sha256Ref;
  planHash: Sha256Ref;
  rulingKind: "directSuccess" | "check";
  branch: "success" | "failure";
  outcomeCode: string;
  summary: string;
  check: null | Readonly<{
    resolutionKind: "abilityCheck" | "attack";
    randomnessId: string;
    rolls: readonly number[];
    selectedRoll: number;
    total: number;
    dc: number;
    succeeded: boolean;
  }>;
  appliedEffects: readonly AppliedWorldInteractionEffect[];
  sensoryEvidence: readonly WorldInteractionSensoryEvidence[];
  pressures: readonly WorldInteractionPressure[];
  opportunities: readonly WorldInteractionOpportunity[];
}>;

const SEMANTIC_KINDS = new Set<SemanticDefinitionKind>([
  "npc", "item", "worldFact", "sceneFeature", "worldRelation",
]);
const RELATION_KINDS = new Set([
  "supports", "attachedTo", "contains", "blocks", "triggers",
]);
const RELATION_STATES = new Set(["active", "ended"]);
const SENSES = new Set(["sight", "hearing", "smell", "touch", "taste", "special"]);

export function isSemanticDefinitionRevisionPlan(
  value: unknown,
): value is SemanticDefinitionRevisionPlan {
  return isRecord(value)
    && hasExactKeys(value, [
      "baseHash", "baseRevision", "basisRefs", "contextHash", "definitionRef",
      "operations", "readSet", "schema", "semanticKind", "summary", "templateHash", "templateRef",
    ])
    && value.schema === SEMANTIC_DEFINITION_REVISION_PLAN_SCHEMA
    && isRef(value.definitionRef)
    && SEMANTIC_KINDS.has(value.semanticKind as SemanticDefinitionKind)
    && isRevision(value.baseRevision)
    && isSha256(value.baseHash)
    && isRef(value.templateRef)
    && isSha256(value.templateHash)
    && isSha256(value.contextHash)
    && isCanonicalReadSet(value.readSet)
    && isCanonicalRefSet(value.basisRefs)
    && Array.isArray(value.operations)
    && value.operations.length >= 1
    && value.operations.length <= 32
    && value.operations.every(isSemanticOperationShape)
    && isText(value.summary);
}

export function isWorldInteractionResolutionPlan(
  value: unknown,
): value is WorldInteractionResolutionPlan {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "abilityRef", "actorCharacterId", "basisRefs", "branches", "contextHash", "costs",
      "directTargetRefs", "instrumentRefs", "intent", "interactionRef", "method", "readSet",
      "resolutionId", "ruling", "sceneRef", "schema", "targetRefs",
    ])
    || value.schema !== WORLD_INTERACTION_RESOLUTION_PLAN_SCHEMA
    || ![value.resolutionId, value.interactionRef, value.actorCharacterId, value.sceneRef]
      .every(isRef)
    || !(value.abilityRef === null || isRef(value.abilityRef))
    || !isSha256(value.contextHash)
    || !isCanonicalReadSet(value.readSet)
    || !isCanonicalRefSet(value.targetRefs, 1)
    || !isCanonicalRefSet(value.directTargetRefs, 1)
    || !isRefSubset(value.directTargetRefs, value.targetRefs)
    || !isCanonicalRefSet(value.instrumentRefs)
    || !isCanonicalRefSet(value.basisRefs, 1)
    || !isText(value.intent)
    || !isText(value.method)
    || !isRuling(value.ruling)
    || !Array.isArray(value.costs)
    || value.costs.length > 16
    || !value.costs.every(isCost)
    || new Set(value.costs.map((cost) => isRecord(cost) ? cost.entryRef : undefined)).size
      !== value.costs.length
    || !isRecord(value.branches)
    || !hasExactKeys(value.branches, ["failure", "success"])
    || !isBranch(value.branches.success)
    || !isBranch(value.branches.failure)) return false;
  return true;
}

export function isAtomicWorldInteractionStepsPlan(
  value: unknown,
): value is AtomicWorldInteractionStepsPlan {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "actorCharacterId", "bundleHash", "contextHash", "rootActionId", "schema", "sharedRuling", "steps",
    ])
    || value.schema !== ATOMIC_WORLD_INTERACTION_STEPS_PLAN_SCHEMA
    || !isRef(value.rootActionId)
    || !isRef(value.actorCharacterId)
    || !isSha256(value.bundleHash)
    || !isSha256(value.contextHash)
    || (value.sharedRuling !== "directSuccess" && value.sharedRuling !== "check")
    || !Array.isArray(value.steps)
    || value.steps.length < 2
    || value.steps.length > 16) return false;

  const checkProposalRefs = value.steps.flatMap((step) =>
    isRecord(step)
      && typeof step.proposalRef === "string"
      && isRecord(step.rulesInput)
      && step.rulesInput.kind === "resolveWorldInteraction"
      && isRecord(step.rulesInput.plan)
      && isRecord(step.rulesInput.plan.ruling)
      && step.rulesInput.plan.ruling.kind === "check"
      ? [step.proposalRef]
      : []);
  if ((value.sharedRuling === "check" && checkProposalRefs.length !== 1)
    || (value.sharedRuling === "directSuccess" && checkProposalRefs.length !== 0)) return false;
  const sharedCheckProposalRef = checkProposalRefs[0];

  const seen = new Set<string>();
  const producerByHandle = new Map<string, {
    proposalRef: string;
    outcomeBinding: AtomicWorldInteractionOutcomeBinding;
  }>();
  let checkedWorldInteractions = 0;
  for (const step of value.steps) {
    if (!isRecord(step)
      || !hasExactKeys(step, [
        "consumes", "dependsOn", "formId", "outcomeBinding", "produces", "proposalRef",
        "rulesInput", "ruling",
      ])
      || (step.formId !== "materialization.vnext-1"
        && step.formId !== "world-interaction.vnext-1")
      || !isRef(step.proposalRef)
      || seen.has(step.proposalRef)
      || step.ruling !== value.sharedRuling
      || !isAtomicOutcomeBinding(step.outcomeBinding)
      || !isAtomicConsumes(step.consumes)
      || !isAtomicProduces(step.produces)
      || !Array.isArray(step.dependsOn)
      || new Set(step.dependsOn).size !== step.dependsOn.length
      || !step.dependsOn.every((dependency) => typeof dependency === "string" && seen.has(dependency))
      || !isAtomicRulesInput(
        step.rulesInput,
        value.rootActionId,
        value.actorCharacterId,
        step.formId,
      )) return false;
    const rulesInput = step.rulesInput as AtomicWorldInteractionRulesInput;
    const plan = rulesInput.plan;
    if (plan.contextHash !== value.contextHash) return false;
    if (rulesInput.kind === "materializeSemanticDefinition") {
      if (rulesInput.plan.bundleHash !== value.bundleHash
        || step.produces.length !== 1
        || step.produces[0]?.handle !== rulesInput.plan.handle
        || step.produces[0]?.kind !== "semanticDefinition"
        || step.produces[0]?.outcomeBinding !== step.outcomeBinding) return false;
    } else if (step.produces.length !== 0) {
      return false;
    }
    for (const produced of step.produces) {
      if (producerByHandle.has(produced.handle)) return false;
      producerByHandle.set(produced.handle, {
        proposalRef: step.proposalRef,
        outcomeBinding: produced.outcomeBinding,
      });
    }
    if (rulesInput.kind === "resolveWorldInteraction"
      && rulesInput.plan.ruling.kind === "check") {
      checkedWorldInteractions += 1;
      if (step.outcomeBinding !== "always") return false;
    }
    seen.add(step.proposalRef);
  }
  for (const step of value.steps) {
    const expectedDependencies = new Set<string>();
    for (const consumed of step.consumes) {
      if (consumed.kind !== "prospective") continue;
      const producer = producerByHandle.get(consumed.handle);
      if (producer === undefined
        || !(producer.outcomeBinding === "always"
          || producer.outcomeBinding === step.outcomeBinding)) return false;
      expectedDependencies.add(producer.proposalRef);
    }
    if (sharedCheckProposalRef !== undefined
      && step.outcomeBinding !== "always"
      && step.proposalRef !== sharedCheckProposalRef) {
      expectedDependencies.add(sharedCheckProposalRef);
    }
    if (expectedDependencies.size !== step.dependsOn.length
      || step.dependsOn.some((dependency: string) => !expectedDependencies.has(dependency))) return false;
  }
  return value.sharedRuling === "check"
    ? checkedWorldInteractions === 1
    : checkedWorldInteractions === 0;
}

export function atomicWorldInteractionStepsPlanHash(
  plan: AtomicWorldInteractionStepsPlan,
): Sha256Ref {
  if (!isAtomicWorldInteractionStepsPlan(plan)) {
    throw new TypeError("atomic world-interaction steps plan is not canonical");
  }
  return canonicalSha256(plan);
}

export function atomicWorldInteractionCheckPlan(
  plan: AtomicWorldInteractionStepsPlan,
): WorldInteractionResolutionPlan | undefined {
  for (const step of plan.steps) {
    if (step.rulesInput.kind === "resolveWorldInteraction"
      && step.rulesInput.plan.ruling.kind === "check") return step.rulesInput.plan;
  }
  return undefined;
}

export function isAtomicWorldInteractionStepsResolvedPayload(
  value: unknown,
): value is AtomicWorldInteractionStepsResolvedPayload {
  if (!isRecord(value)
    || !hasExactKeys(value, ["actorCharacterId", "branch", "checkResolutionId", "steps"])
    || !isRef(value.actorCharacterId)
    || (value.branch !== "success" && value.branch !== "failure")
    || !(value.checkResolutionId === null || isRef(value.checkResolutionId))
    || !Array.isArray(value.steps)
    || value.steps.length < 2
    || value.steps.length > 16) return false;
  const refs = new Set<string>();
  return value.steps.every((step) => {
    if (!isRecord(step)
      || !hasExactKeys(step, ["outcomeBinding", "proposalRef", "status"])
      || !isRef(step.proposalRef)
      || refs.has(step.proposalRef)
      || !isAtomicOutcomeBinding(step.outcomeBinding)
      || (step.status !== "applied" && step.status !== "skipped")) return false;
    const shouldApply = step.outcomeBinding === "always"
      || (step.outcomeBinding === "onSuccess"
        ? value.branch === "success"
        : value.branch === "failure");
    if (step.status !== (shouldApply ? "applied" : "skipped")) return false;
    refs.add(step.proposalRef);
    return true;
  }) && (value.branch !== "failure" || value.checkResolutionId !== null);
}

function isAtomicRulesInput(
  value: unknown,
  rootActionId: string,
  actorCharacterId: string,
  formId: "materialization.vnext-1" | "world-interaction.vnext-1",
): value is AtomicWorldInteractionRulesInput {
  if (!isRecord(value)
    || !hasExactKeys(value, ["actorCharacterId", "kind", "plan", "rootActionId"])
    || value.rootActionId !== rootActionId
    || value.actorCharacterId !== actorCharacterId) return false;
  if (value.kind === "materializeSemanticDefinition") {
    return formId === "materialization.vnext-1"
      && isSemanticDefinitionMaterializationPlan(value.plan);
  }
  if (value.kind === "reviseSemanticDefinition") {
    return formId === "materialization.vnext-1"
      && isSemanticDefinitionRevisionPlan(value.plan);
  }
  return value.kind === "resolveWorldInteraction"
    && formId === "world-interaction.vnext-1"
    && isWorldInteractionResolutionPlan(value.plan);
}

function isAtomicOutcomeBinding(value: unknown): value is AtomicWorldInteractionOutcomeBinding {
  return value === "always" || value === "onSuccess" || value === "onFailure";
}

const ATOMIC_PROSPECTIVE_HANDLE = /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function isAtomicConsumes(value: unknown): value is readonly AtomicWorldInteractionReference[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  const identities = new Set<string>();
  return value.every((entry) => {
    if (!isRecord(entry)) return false;
    const identity = entry.kind === "existing"
      && hasExactKeys(entry, ["kind", "ref"])
      && isRef(entry.ref)
      && !ATOMIC_PROSPECTIVE_HANDLE.test(entry.ref)
      ? `existing:${entry.ref}`
      : entry.kind === "prospective"
        && hasExactKeys(entry, ["handle", "kind"])
        && typeof entry.handle === "string"
        && ATOMIC_PROSPECTIVE_HANDLE.test(entry.handle)
        ? `prospective:${entry.handle}`
        : undefined;
    if (identity === undefined || identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

function isAtomicProduces(
  value: unknown,
): value is readonly AtomicWorldInteractionProducedReference[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  const handles = new Set<string>();
  return value.every((entry) => {
    if (!isRecord(entry)
      || !hasExactKeys(entry, ["handle", "kind", "outcomeBinding"])
      || typeof entry.handle !== "string"
      || !ATOMIC_PROSPECTIVE_HANDLE.test(entry.handle)
      || handles.has(entry.handle)
      || !["semanticDefinition", "canonicalFact", "relation", "itemEntry"].includes(String(entry.kind))
      || !isAtomicOutcomeBinding(entry.outcomeBinding)) return false;
    handles.add(entry.handle);
    return true;
  });
}

export function worldInteractionPlanHash(plan: WorldInteractionResolutionPlan): Sha256Ref {
  if (!isWorldInteractionResolutionPlan(plan)) {
    throw new TypeError("world interaction resolution plan is not canonical");
  }
  return canonicalSha256(plan);
}

export function isSemanticDefinitionRevisedPayload(
  value: unknown,
): value is SemanticDefinitionRevisedPayload {
  return isRecord(value)
    && hasExactKeys(value, [
      "actorCharacterId", "baseHash", "baseRevision", "basisRefs", "contextHash",
      "definitionRef", "nextDefinition", "semanticKind", "summary", "templateHash", "templateRef",
    ])
    && isRef(value.actorCharacterId)
    && isRef(value.definitionRef)
    && SEMANTIC_KINDS.has(value.semanticKind as SemanticDefinitionKind)
    && isRevision(value.baseRevision)
    && isSha256(value.baseHash)
    && isRef(value.templateRef)
    && isSha256(value.templateHash)
    && isSha256(value.contextHash)
    && isCanonicalRefSet(value.basisRefs)
    && isText(value.summary)
    && isStoredSemanticDefinition(value.nextDefinition)
    && value.nextDefinition.definitionId === value.definitionRef
    && value.nextDefinition.semanticKind === value.semanticKind
    && value.nextDefinition.templateRef === value.templateRef
    && value.nextDefinition.templateHash === value.templateHash;
}

function isFeasibilityPrerequisite(
  value: unknown,
): value is WorldInteractionFeasibilityPrerequisite {
  return isRecord(value)
    && hasExactKeys(value, ["description", "kind", "ref"])
    && ["tool", "knowledge", "position", "permission", "condition"].includes(String(value.kind))
    && (value.ref === null || isRef(value.ref))
    && isText(value.description);
}

function isFeasibilityNextAction(
  value: unknown,
): value is WorldInteractionFeasibilityNextAction {
  return isRecord(value)
    && hasExactKeys(value, ["description"])
    && isText(value.description);
}

export function isWorldInteractionFeasibilityRulingPlan(
  value: unknown,
): value is WorldInteractionFeasibilityRulingPlan {
  return isRecord(value)
    && hasExactKeys(value, [
      "actorCharacterId", "basisRefs", "costs", "intent", "method", "nextActions",
      "prerequisites", "publicBasis", "rulingKind", "schema",
    ])
    && value.schema === WORLD_INTERACTION_FEASIBILITY_RULING_PLAN_SCHEMA
    && isRef(value.actorCharacterId)
    && isText(value.intent)
    && isText(value.method)
    && (value.rulingKind === "missingPrerequisite" || value.rulingKind === "worldLawViolation")
    && isText(value.publicBasis)
    && Array.isArray(value.prerequisites)
    && value.prerequisites.length <= 8
    && value.prerequisites.every(isFeasibilityPrerequisite)
    && Array.isArray(value.nextActions)
    && value.nextActions.length <= 8
    && value.nextActions.every(isFeasibilityNextAction)
    && Array.isArray(value.costs)
    && value.costs.length <= 16
    && value.costs.every(isAttemptCost)
    && new Set(value.costs.map(attemptCostIdentity)).size === value.costs.length
    && isCanonicalRefSet(value.basisRefs);
}

export function isWorldInteractionFeasibilityRuledPayload(
  value: unknown,
): value is WorldInteractionFeasibilityRuledPayload {
  return isRecord(value)
    && hasExactKeys(value, [
      "actorCharacterId", "appliedCosts", "intent", "method", "nextActions",
      "prerequisites", "publicBasis", "rulingKind",
    ])
    && isRef(value.actorCharacterId)
    && isText(value.intent)
    && isText(value.method)
    && (value.rulingKind === "missingPrerequisite" || value.rulingKind === "worldLawViolation")
    && isText(value.publicBasis)
    && Array.isArray(value.prerequisites)
    && value.prerequisites.length <= 8
    && value.prerequisites.every(isFeasibilityPrerequisite)
    && Array.isArray(value.nextActions)
    && value.nextActions.length <= 8
    && value.nextActions.every(isFeasibilityNextAction)
    && Array.isArray(value.appliedCosts)
    && value.appliedCosts.length <= 16
    && value.appliedCosts.every((effect) => isAppliedEffect(effect)
      && (effect.kind === "itemCost"
        || effect.kind === "fictionTimeCost"
        || effect.kind === "resourceCost"));
}

export function isWorldInteractionResolvedPayload(
  value: unknown,
): value is WorldInteractionResolvedPayload {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "abilityRef", "actorCharacterId", "appliedEffects", "basisRefs", "branch", "check",
      "contextHash", "directTargetRefs", "instrumentRefs", "interactionRef", "opportunities",
      "outcomeCode", "planHash", "pressures", "resolutionId", "rulingKind", "sceneRef",
      "sensoryEvidence", "summary", "targetRefs",
    ])
    || ![value.interactionRef, value.resolutionId, value.actorCharacterId, value.sceneRef]
      .every(isRef)
    || !(value.abilityRef === null || isRef(value.abilityRef))
    || !isCanonicalRefSet(value.targetRefs, 1)
    || !isCanonicalRefSet(value.directTargetRefs, 1)
    || !isRefSubset(value.directTargetRefs, value.targetRefs)
    || !isCanonicalRefSet(value.instrumentRefs)
    || !isCanonicalRefSet(value.basisRefs, 1)
    || !isSha256(value.contextHash)
    || !isSha256(value.planHash)
    || !["directSuccess", "check"].includes(String(value.rulingKind))
    || !["success", "failure"].includes(String(value.branch))
    || !isRef(value.outcomeCode)
    || !isText(value.summary)
    || !Array.isArray(value.appliedEffects)
    || value.appliedEffects.length > 64
    || !value.appliedEffects.every(isAppliedEffect)
    || !Array.isArray(value.sensoryEvidence)
    || !value.sensoryEvidence.every(isSensoryEvidence)
    || !Array.isArray(value.pressures)
    || !value.pressures.every(isPressure)
    || !Array.isArray(value.opportunities)
    || !value.opportunities.every(isOpportunity)) return false;
  if (value.rulingKind === "directSuccess") {
    return value.branch === "success" && value.check === null;
  }
  return isResolvedCheck(value.check)
    && value.branch === (value.check.succeeded ? "success" : "failure");
}

function isResolvedCheck(value: unknown): value is NonNullable<WorldInteractionResolvedPayload["check"]> {
  return isRecord(value)
    && hasExactKeys(value, [
      "dc", "randomnessId", "resolutionKind", "rolls", "selectedRoll", "succeeded", "total",
    ])
    && isRef(value.randomnessId)
    && (value.resolutionKind === "abilityCheck" || value.resolutionKind === "attack")
    && Array.isArray(value.rolls)
    && (value.rolls.length === 1 || value.rolls.length === 2)
    && value.rolls.every((roll) => Number.isSafeInteger(roll) && Number(roll) >= 1 && Number(roll) <= 20)
    && [value.selectedRoll, value.total, value.dc].every(Number.isSafeInteger)
    && value.rolls.includes(value.selectedRoll)
    && typeof value.succeeded === "boolean"
    && value.succeeded === resolvedCheckSucceeded(
      value.resolutionKind,
      Number(value.selectedRoll),
      Number(value.total),
      Number(value.dc),
    );
}

function resolvedCheckSucceeded(
  resolutionKind: "abilityCheck" | "attack",
  selectedRoll: number,
  total: number,
  dc: number,
): boolean {
  return resolutionKind === "attack"
    ? selectedRoll === 20 || (selectedRoll !== 1 && total >= dc)
    : total >= dc;
}

function isAppliedEffect(value: unknown): value is AppliedWorldInteractionEffect {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "itemCost") {
    return hasExactKeys(value, [
      "chargesAfter", "chargesBefore", "durabilityAfter", "durabilityBefore", "entryRef",
      "kind", "quantityAfter", "quantityBefore",
    ])
      && isRef(value.entryRef)
      && [value.quantityBefore, value.quantityAfter].every(isNonnegativeInteger)
      && nullableCountersValid(value.chargesBefore, value.chargesAfter)
      && nullableCountersValid(value.durabilityBefore, value.durabilityAfter);
  }
  if (value.kind === "fictionTimeCost") {
    return hasExactKeys(value, ["durationMicros", "kind", "nowMicrosAfter"])
      && typeof value.durationMicros === "string"
      && /^[1-9][0-9]*$/.test(value.durationMicros)
      && typeof value.nowMicrosAfter === "string"
      && /^(0|[1-9][0-9]*)$/.test(value.nowMicrosAfter);
  }
  if (value.kind === "resourceCost") {
    return hasExactKeys(value, ["amountAfter", "amountBefore", "kind", "resourceId"])
      && isRef(value.resourceId)
      && [value.amountBefore, value.amountAfter].every(isNonnegativeInteger)
      && Number(value.amountAfter) < Number(value.amountBefore);
  }
  if (value.kind === "damage") {
    return hasExactKeys(value, [
      "amount", "damageType", "died", "hpAfter", "hpBefore", "kind",
      "sourceDefinitionRef", "targetRef",
    ])
      && [value.sourceDefinitionRef, value.targetRef, value.damageType].every(isRef)
      && isPositiveInteger(value.amount)
      && [value.hpBefore, value.hpAfter].every(isNonnegativeInteger)
      && typeof value.died === "boolean";
  }
  if (value.kind === "definitionRevision") {
    return hasExactKeys(value, [
      "basisRefs", "definitionRef", "fromRevision", "kind", "semanticKind", "summary",
      "toRevision", "visibilityPolicyRef",
    ])
      && [value.definitionRef, value.visibilityPolicyRef].every(isRef)
      && SEMANTIC_KINDS.has(value.semanticKind as SemanticDefinitionKind)
      && [value.fromRevision, value.toRevision].every(isRevision)
      && isText(value.summary)
      && isCanonicalRefSet(value.basisRefs);
  }
  return value.kind === "relationTransition"
    && hasExactKeys(value, [
      "basisRefs", "definitionRef", "fromRevision", "fromState", "kind", "objectRef",
      "relationKind", "relationRef", "subjectRef", "summary", "toRevision", "toState",
      "visibilityPolicyRef",
    ])
    && [value.relationRef, value.subjectRef, value.objectRef, value.definitionRef,
      value.visibilityPolicyRef].every(isRef)
    && RELATION_KINDS.has(String(value.relationKind))
    && RELATION_STATES.has(String(value.fromState))
    && RELATION_STATES.has(String(value.toState))
    && value.fromState !== value.toState
    && [value.fromRevision, value.toRevision].every(isRevision)
    && isText(value.summary)
    && isCanonicalRefSet(value.basisRefs);
}

function nullableCountersValid(before: unknown, after: unknown): boolean {
  return before === null
    ? after === null
    : isNonnegativeInteger(before) && isNonnegativeInteger(after);
}

function isBranch(value: unknown): value is WorldInteractionBranch {
  return isRecord(value)
    && hasExactKeys(value, [
      "effects", "opportunities", "outcomeCode", "pressures", "sensoryEvidence", "summary",
    ])
    && isRef(value.outcomeCode)
    && isText(value.summary)
    && Array.isArray(value.effects)
    && value.effects.length <= 32
    && value.effects.every(isEffect)
    && Array.isArray(value.sensoryEvidence)
    && value.sensoryEvidence.length <= 32
    && value.sensoryEvidence.every(isSensoryEvidence)
    && Array.isArray(value.pressures)
    && value.pressures.length <= 16
    && value.pressures.every(isPressure)
    && Array.isArray(value.opportunities)
    && value.opportunities.length <= 16
    && value.opportunities.every(isOpportunity);
}

function isEffect(value: unknown): value is WorldInteractionEffect {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "registeredHazard") {
    return hasExactKeys(value, ["damageProfileRef", "kind", "sourceDefinitionRef", "zoneRef"])
      && [value.sourceDefinitionRef, value.zoneRef].every(isRef)
      && isWorldDamageProfileRef(value.damageProfileRef);
  }
  if (value.kind === "definitionRevision") {
    return hasExactKeys(value, ["kind", "nextDefinition", "summary"])
      && isStoredSemanticDefinition(value.nextDefinition)
      && isText(value.summary);
  }
  return value.kind === "relationTransition"
    && hasExactKeys(value, [
      "fromState", "kind", "nextDefinition", "objectRef", "relationKind", "relationRef",
      "subjectRef", "summary", "toState",
    ])
    && [value.relationRef, value.subjectRef, value.objectRef].every(isRef)
    && RELATION_KINDS.has(String(value.relationKind))
    && RELATION_STATES.has(String(value.fromState))
    && RELATION_STATES.has(String(value.toState))
    && value.fromState !== value.toState
    && isStoredSemanticDefinition(value.nextDefinition)
    && value.nextDefinition.semanticKind === "worldRelation"
    && value.nextDefinition.definitionId === value.relationRef
    && isText(value.summary);
}

function isSensoryEvidence(value: unknown): value is WorldInteractionSensoryEvidence {
  return isRecord(value)
    && hasExactKeys(value, [
      "basisRefs", "evidence", "observerRef", "sense", "subjectRef", "visibilityPolicyRef",
    ])
    && isRef(value.observerRef)
    && (value.subjectRef === null || isRef(value.subjectRef))
    && SENSES.has(String(value.sense))
    && isText(value.evidence)
    && isRef(value.visibilityPolicyRef)
    && isCanonicalRefSet(value.basisRefs, 1);
}

function isPressure(value: unknown): value is WorldInteractionPressure {
  return isRecord(value)
    && hasExactKeys(value, ["basisRefs", "description", "sourceRef", "visibilityPolicyRef"])
    && isText(value.description)
    && (value.sourceRef === null || isRef(value.sourceRef))
    && isRef(value.visibilityPolicyRef)
    && isCanonicalRefSet(value.basisRefs, 1);
}

function isOpportunity(value: unknown): value is WorldInteractionOpportunity {
  return isRecord(value)
    && hasExactKeys(value, [
      "actionHint", "basisRefs", "description", "targetRef", "visibilityPolicyRef",
    ])
    && isText(value.description)
    && (value.targetRef === null || isRef(value.targetRef))
    && (value.actionHint === null || isText(value.actionHint))
    && isRef(value.visibilityPolicyRef)
    && isCanonicalRefSet(value.basisRefs, 1);
}

export function isAttemptCost(value: unknown): value is WorldInteractionAttemptCost {
  if (!isRecord(value)) return false;
  if (value.kind === "item") return isCost(value);
  if (value.kind === "fictionTime") {
    return hasExactKeys(value, ["durationMicros", "kind"])
      && typeof value.durationMicros === "string"
      && /^[1-9][0-9]*$/.test(value.durationMicros);
  }
  return value.kind === "resource"
    && hasExactKeys(value, ["amount", "kind", "resourceId"])
    && isRef(value.resourceId)
    && isPositiveInteger(value.amount);
}

/**
 * One cost per thing spent. Splitting a single spend across two entries would
 * let the same minutes or the same slot be charged twice while each entry
 * looked legal on its own, so the identity is the thing, not the entry.
 */
export function attemptCostIdentity(cost: WorldInteractionAttemptCost): string {
  return cost.kind === "item"
    ? `item:${cost.entryRef}`
    : cost.kind === "resource"
      ? `resource:${cost.resourceId}`
      : "fictionTime";
}

export function isCost(value: unknown): value is WorldInteractionCost {
  return isRecord(value)
    && hasExactKeys(value, ["charges", "durability", "entryRef", "kind", "quantity"])
    && value.kind === "item"
    && isRef(value.entryRef)
    && [value.quantity, value.charges, value.durability].every(isNonnegativeInteger)
    && Number(value.quantity) + Number(value.charges) + Number(value.durability) > 0;
}

function isRuling(value: unknown): value is WorldInteractionResolutionPlan["ruling"] {
  if (!isRecord(value)) return false;
  if (value.kind === "directSuccess") return hasExactKeys(value, ["kind"]);
  return value.kind === "check"
    && hasExactKeys(value, ["check", "kind", "randomnessId", "resolutionKind"])
    && (value.resolutionKind === "abilityCheck" || value.resolutionKind === "attack")
    && isRef(value.randomnessId)
    && isFrozenCheck(value.check);
}

function isFrozenCheck(value: unknown): value is FrozenCheck {
  return isRecord(value)
    && hasExactKeys(value, [
      "ability", "costs", "dc", "failureOutcome", "goal", "kind", "method", "mode",
      "modifier", "risk", "skill", "successOutcome",
    ])
    && ["ability", "skill", "tool", "savingThrow"].includes(String(value.kind))
    && ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
      .includes(String(value.ability))
    && (value.skill === null || isRef(value.skill))
    && isUnsignedIntegerString(value.dc)
    && isSignedIntegerString(value.modifier)
    && ["normal", "advantage", "disadvantage"].includes(String(value.mode))
    && [value.goal, value.method, value.risk, value.successOutcome, value.failureOutcome]
      .every(isText)
    && isCanonicalRefSet(value.costs);
}

function isSemanticOperationShape(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.path) || !value.path.every(isRef)) return false;
  if (value.kind === "set") return hasExactKeys(value, ["kind", "path", "value"]);
  if (value.kind === "remove") return hasExactKeys(value, ["kind", "path"]);
  if (value.kind === "upsertByRef") {
    return hasExactKeys(value, ["entry", "kind", "path"]) && isRecord(value.entry);
  }
  return value.kind === "removeByRef"
    && hasExactKeys(value, ["kind", "path", "ref"])
    && isRef(value.ref);
}

function isCanonicalReadSet(value: unknown): value is readonly VersionedAuthorityBinding[] {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 128
    && value.every((entry) => isRecord(entry)
      && hasExactKeys(entry, ["ref", "revisionOrHash"])
      && isRef(entry.ref)
      && isRef(entry.revisionOrHash))
    && value.every((entry, index) => index === 0
      || String(value[index - 1].ref) < String(entry.ref));
}

function isCanonicalRefSet(value: unknown, minimum = 0): value is readonly string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= 128
    && value.every(isRef)
    && new Set(value).size === value.length
    && value.every((entry, index) => index === 0 || String(value[index - 1]) < String(entry));
}

function isRefSubset(subset: unknown, superset: unknown): boolean {
  return Array.isArray(subset)
    && Array.isArray(superset)
    && subset.every((ref) => superset.includes(ref));
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRef(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 4_000
    && value.trim() === value
    && value.normalize("NFC") === value;
}

function isText(value: unknown): value is string {
  return isRef(value);
}

function isSha256(value: unknown): value is Sha256Ref {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function isUnsignedIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function isSignedIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|-?[1-9][0-9]*)$/u.test(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
