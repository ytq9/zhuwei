import {
  authorityRefBoundToScene,
  authoritySpatialRefVisibleTo,
  composeDefinition,
  itemEntryResourceId,
  semanticDefinitionSnapshot,
  storedSemanticDefinition,
  type AuthoritativeWorldState,
  type JsonRecord,
  type SemanticDefinitionOperation,
  type SemanticFieldPolicy,
  type StoredSemanticDefinition,
} from "../../rules/authority-read";
import {
  isWorldDamageProfileRef,
  type WorldDamageProfileRef,
} from "../../rules/profiles/world-interaction-registry";
import { combatAttackBonus } from "../../rules/profiles/attack-resolution";
import {
  canonicalClone,
  canonicalHash,
  compareCodeUnits,
  deepFreeze,
  isNonEmptyString,
  isPlainRecord,
} from "./canonical-json";
import {
  requiredContextAuthorityRefs,
  requiredContextReadRefs,
  requiredContextViewerRefs,
} from "./required-context-runtime";
import type { VNextRequiredContext } from "./required-context";

export const VNEXT_KP_PROPOSAL_SCHEMA = "zhuwei.kp-coarse-form-proposal/vnext-1" as const;
export const VNEXT_MATERIALIZATION_FORM_ID = "materialization.vnext-1" as const;
export const VNEXT_WORLD_INTERACTION_FORM_ID = "world-interaction.vnext-1" as const;

type CheckMode = "normal" | "advantage" | "disadvantage";
type Sense = "sight" | "hearing" | "smell" | "touch" | "taste" | "special";
type LoweredItemCost = Readonly<{
  kind: "item";
  entryRef: string;
  quantity: number;
  charges: number;
  durability: number;
}>;

const FROZEN_CHECK_ABILITIES = Object.freeze({
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
} as const);

const WORLD_RELATION_KINDS = new Set([
  "supports", "attachedTo", "contains", "blocks", "triggers",
]);

export type VNextSemanticRevisionProposal = Readonly<{
  schema: typeof VNEXT_KP_PROPOSAL_SCHEMA;
  kind: "vnextCoarseFormProposal";
  formId: typeof VNEXT_MATERIALIZATION_FORM_ID;
  proposalRef: string;
  contextHash: string;
  basisRefs: readonly string[];
  proposal: Readonly<{
    kind: "reviseSemanticDefinition";
    definitionRef: string;
    semanticKind: "npc";
    npcRef: string;
    baseRevision: string;
    baseHash: string;
    templateRef: string;
    templateHash: string;
    operations: readonly SemanticDefinitionOperation[];
    summary: string;
  }>;
}>;

export type WorldInteractionAdjudication =
  | Readonly<{
      kind: "directSuccess";
      risk: string;
      successOutcome: string;
      failureOutcome: string;
    }>
  | Readonly<{
      kind: "check";
      checkKind: "abilityCheck" | "attack";
      ability: "str" | "dex" | "con" | "int" | "wis" | "cha";
      skill: string | null;
      dc: number;
      mode: CheckMode;
      risk: string;
      successOutcome: string;
      failureOutcome: string;
    }>;

export type VNextWorldSemanticEffect =
  | Readonly<{
      kind: "relationTransition";
      relationRef: string;
      toState: "active" | "ended";
    }>
  | Readonly<{
      kind: "definitionRevision";
      definitionRef: string;
      operations: readonly SemanticDefinitionOperation[];
      summary: string;
    }>
  | Readonly<{
      kind: "registeredHazard";
      sourceDefinitionRef: string;
      zoneRef: string;
      damageProfileRef: WorldDamageProfileRef;
    }>;

export type VNextWorldInteractionBranchProposal = Readonly<{
  outcomeCode: string;
  summary: string;
  effects: readonly VNextWorldSemanticEffect[];
  sensoryEvidence: readonly Readonly<{
    observerRef: string;
    subjectRef: string | null;
    sense: Sense;
    evidence: string;
    basisRefs: readonly string[];
  }>[];
  pressures: readonly Readonly<{
    description: string;
    sourceRef: string | null;
    basisRefs: readonly string[];
  }>[];
  opportunities: readonly Readonly<{
    description: string;
    targetRef: string | null;
    actionHint: string | null;
    basisRefs: readonly string[];
  }>[];
}>;

export type VNextWorldInteractionProposal = Readonly<{
  schema: typeof VNEXT_KP_PROPOSAL_SCHEMA;
  kind: "vnextCoarseFormProposal";
  formId: typeof VNEXT_WORLD_INTERACTION_FORM_ID;
  proposalRef: string;
  contextHash: string;
  basisRefs: readonly string[];
  proposal: Readonly<{
    kind: "worldInteraction";
    sceneRef: string;
    targetRefs: readonly string[];
    directTargetRefs: readonly string[];
    instrumentRefs: readonly string[];
    abilityRef: string | null;
    intent: string;
    method: string;
    adjudication: WorldInteractionAdjudication;
    branches: Readonly<{
      success: VNextWorldInteractionBranchProposal;
      failure: VNextWorldInteractionBranchProposal;
    }>;
  }>;
}>;

export type VNextCoarseFormProposal =
  | VNextSemanticRevisionProposal
  | VNextWorldInteractionProposal;

export type VNextProposalValidationResult =
  | Readonly<{ kind: "accepted"; proposal: VNextCoarseFormProposal }>
  | Readonly<{ kind: "rejected"; code: "PROPOSAL_FORM_INVALID"; issues: readonly string[] }>;

export type VNextProposalLoweringResult =
  | Readonly<{ kind: "accepted"; rulesInput: JsonRecord }>
  | Readonly<{
      kind: "rejected";
      code:
        | "PROPOSAL_FORM_INVALID"
        | "PROPOSAL_REFERENCE_INVALID"
        | "DEFINITION_CONFLICT"
        | "CONTEXT_INSUFFICIENT";
      issues: readonly string[];
    }>;

export function validateVNextCoarseFormProposal(
  value: unknown,
): VNextProposalValidationResult {
  try {
    if (!isPlainRecord(value)
      || !exactKeys(value, [
        "schema", "kind", "formId", "proposalRef", "contextHash", "basisRefs", "proposal",
      ])
      || value.schema !== VNEXT_KP_PROPOSAL_SCHEMA
      || value.kind !== "vnextCoarseFormProposal"
      || !isRef(value.proposalRef)
      || !isHash(value.contextHash)
      || !isRefArray(value.basisRefs, 1)
      || !isPlainRecord(value.proposal)) {
      throw new TypeError("proposal:envelope-invalid");
    }
    if (value.formId === VNEXT_MATERIALIZATION_FORM_ID) {
      validateSemanticRevision(value.proposal);
    } else if (value.formId === VNEXT_WORLD_INTERACTION_FORM_ID) {
      validateWorldInteraction(value.proposal);
    } else {
      throw new TypeError("proposal:form-id-unsupported");
    }
    return Object.freeze({
      kind: "accepted",
      proposal: deepFreeze(canonicalClone(value)) as VNextCoarseFormProposal,
    });
  } catch (error) {
    return Object.freeze({
      kind: "rejected",
      code: "PROPOSAL_FORM_INVALID",
      issues: Object.freeze([issue(error)]),
    });
  }
}

export function lowerVNextCoarseFormProposal(input: Readonly<{
  value: unknown;
  requiredContext: VNextRequiredContext;
  state: AuthoritativeWorldState;
  rootActionId: string;
  actorCharacterId: string;
}>): VNextProposalLoweringResult {
  try {
    return lowerVNextCoarseFormProposalUnchecked(input);
  } catch {
    // The Room boundary supplies these values from trusted authority state,
    // but keep the exported lowering seam fail-closed if a malformed or stale
    // runtime value crosses it. Do not leak an implementation exception to a
    // public rejection or let a partial plan reach Rules.
    return rejected("PROPOSAL_FORM_INVALID", ["proposal:lowering-input-invalid"]);
  }
}

function lowerVNextCoarseFormProposalUnchecked(input: Readonly<{
  value: unknown;
  requiredContext: VNextRequiredContext;
  state: AuthoritativeWorldState;
  rootActionId: string;
  actorCharacterId: string;
}>): VNextProposalLoweringResult {
  const validated = validateVNextCoarseFormProposal(input.value);
  if (validated.kind === "rejected") return validated;
  const proposal = validated.proposal;
  if (proposal.contextHash !== input.requiredContext.binding.contextHash
    || input.requiredContext.binding.rootActionId !== input.rootActionId
    || input.requiredContext.intent.actorRef !== input.actorCharacterId) {
    return rejected("CONTEXT_INSUFFICIENT", ["proposal:context-binding-mismatch"]);
  }
  const authorityRefs = requiredContextAuthorityRefs(input.requiredContext);
  const readRefs = requiredContextReadRefs(input.requiredContext);
  const allBasis = uniqueRefs([
    ...proposal.basisRefs,
    ...(proposal.formId === VNEXT_WORLD_INTERACTION_FORM_ID
      ? branchBasisRefs(proposal.proposal.branches)
      : []),
  ]);
  if (allBasis.some((ref) => !authorityRefs.has(ref))) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["proposal:basis-ref-not-authorized"]);
  }
  if (allBasis.some((ref) => !readRefs.has(ref))) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["proposal:basis-ref-not-read-bound"]);
  }

  return proposal.formId === VNEXT_MATERIALIZATION_FORM_ID
    ? lowerSemanticRevision(proposal, input)
    : lowerWorldInteraction(proposal, input);
}

function lowerSemanticRevision(
  envelope: VNextSemanticRevisionProposal,
  input: Parameters<typeof lowerVNextCoarseFormProposal>[0],
): VNextProposalLoweringResult {
  const proposal = envelope.proposal;
  const stored = input.state.campaignRuntime.definitions[proposal.definitionRef];
  const snapshot = semanticDefinitionSnapshot(stored);
  if (snapshot === undefined
    || !isPlainRecord(stored)
    || stored.semanticKind !== "npc"
    || snapshot.revision !== proposal.baseRevision
    || snapshot.definitionHash !== proposal.baseHash
    || stored.templateRef !== proposal.templateRef
    || stored.templateHash !== proposal.templateHash
    || input.state.entities[proposal.npcRef]?.semanticDefinitionRef !== proposal.definitionRef) {
    return rejected("DEFINITION_CONFLICT", ["semantic-revision:base-or-template-binding-mismatch"]);
  }

  if (envelope.basisRefs.some((ref) => !npcMayUseBasis(
    input.state,
    input.requiredContext,
    proposal.npcRef,
    ref,
  ))) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["semantic-revision:npc-knowledge-basis-required"]);
  }
  const planReadSet = selectPlanReadSet(
    input.requiredContext,
    uniqueRefs([
      input.actorCharacterId,
      proposal.npcRef,
      proposal.definitionRef,
      ...envelope.basisRefs,
    ]),
    proposal.npcRef,
  );
  if (planReadSet.kind === "rejected") return planReadSet;
  return Object.freeze({
    kind: "accepted",
    rulesInput: {
      kind: "reviseSemanticDefinition",
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      plan: {
        schema: "zhuwei.semantic-definition-revision-plan/v1",
        definitionRef: proposal.definitionRef,
        semanticKind: proposal.semanticKind,
        baseRevision: proposal.baseRevision,
        baseHash: proposal.baseHash,
        templateRef: proposal.templateRef,
        templateHash: proposal.templateHash,
        contextHash: envelope.contextHash,
        readSet: planReadSet.readSet,
        basisRefs: [...envelope.basisRefs],
        operations: structuredClone(proposal.operations),
        summary: proposal.summary,
      },
    },
  });
}

function npcMayUseBasis(
  state: AuthoritativeWorldState,
  context: VNextRequiredContext,
  npcRef: string,
  basisRef: string,
): boolean {
  const explicitKnowledge = context.references.citations.npcKnowledge
    .find((entry) => entry.npcRef === npcRef)?.refs ?? [];
  if (explicitKnowledge.includes(basisRef)) return true;
  const npc = state.entities[npcRef];
  if (npc === undefined || npc.kind !== "npc") return false;
  if (basisRef === npc.sceneId) return true;
  const fact = state.canonicalFacts[basisRef];
  if (fact !== undefined) {
    // Mirror the shared authority predicate without accepting facts merely
    // because the player actor could see them.
    if (fact.visibilityPolicyId.startsWith("visibility:public")) return true;
    if (fact.visibilityPolicyId === "visibility:hidden-until-evidence") {
      return fact.id in (state.knowledge[npcRef] ?? {});
    }
    if (fact.visibilityPolicyId === "visibility:scene-observers") {
      return fact.subjectRefs.includes(npcRef)
        || fact.subjectRefs.includes(npc.sceneId)
        || (isPlainRecord(fact.value) && fact.value.sceneId === npc.sceneId);
    }
    return fact.visibilityPolicyId === `visibility:knowledge-holder:${npcRef}`;
  }
  const definition = state.campaignRuntime.definitions[basisRef];
  return isPlainRecord(definition)
    && (definition.visibilityPolicyRef === "visibility:public"
      || definition.visibilityPolicyRef === "visibility:scene-observers");
}

/** A bundle-local materialization handle, e.g. "prospective:abc123". Rules
 * substitutes these into the real definitionRef it derives when the atomic
 * multi-step compiler runs; here they are never a live authority ref, so the
 * authority/visibility/read-set checks below must not judge them as if they
 * were one -- Rules' own atomic compiler is the final gate for a handle that
 * was never actually produced or declared (see world-interactions.ts). */
const PROSPECTIVE_HANDLE_PATTERN = /^prospective:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function lowerWorldInteraction(
  envelope: VNextWorldInteractionProposal,
  input: Parameters<typeof lowerVNextCoarseFormProposal>[0],
): VNextProposalLoweringResult {
  const proposal = envelope.proposal;
  const actor = input.state.entities[input.actorCharacterId];
  if (actor === undefined || actor.sceneId !== proposal.sceneRef) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:actor-scene-mismatch"]);
  }
  const authorityRefs = requiredContextAuthorityRefs(input.requiredContext);
  const selectedRefs = [
    proposal.sceneRef,
    ...proposal.targetRefs,
    ...proposal.directTargetRefs,
    ...proposal.instrumentRefs,
    ...(proposal.abilityRef === null ? [] : [proposal.abilityRef]),
  ].filter((ref) => !PROSPECTIVE_HANDLE_PATTERN.test(ref));
  if (selectedRefs.some((ref) => !authorityRefs.has(ref))) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:selected-ref-not-authorized"]);
  }
  const viewerRefs = requiredContextViewerRefs(input.requiredContext);
  if (proposal.directTargetRefs
    .filter((ref) => !PROSPECTIVE_HANDLE_PATTERN.test(ref))
    .some((ref) =>
      !viewerRefs.has(ref)
      || !authoritySpatialRefVisibleTo(
        input.state,
        ref,
        proposal.sceneRef,
        input.actorCharacterId,
      ))) {
    return rejected(
      "PROPOSAL_REFERENCE_INVALID",
      ["world-interaction:direct-target-not-addressable"],
    );
  }

  for (const entryRef of proposal.instrumentRefs) {
    const entry = input.state.campaignRuntime.itemSystem.entries[entryRef];
    if (entry === undefined || entry.holderRef !== input.actorCharacterId
      || entry.disposition !== "held" || entry.condition !== "usable") {
      return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:instrument-unavailable"]);
    }
  }
  const ability = proposal.abilityRef === null
    ? undefined
    : input.state.combatRuntime.definitions[proposal.abilityRef];
  const combatActor = input.state.combatRuntime.entities[input.actorCharacterId];
  if (proposal.abilityRef !== null
    && (!isPlainRecord(ability)
      || !isPlainRecord(combatActor)
      || !Array.isArray(combatActor.abilityRefs)
      || !combatActor.abilityRefs.includes(proposal.abilityRef))) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:ability-unavailable"]);
  }
  if (proposal.adjudication.kind === "check"
    && proposal.adjudication.checkKind === "attack"
    && proposal.abilityRef === null) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:attack-ability-required"]);
  }
  if (proposal.adjudication.kind === "check"
    && proposal.adjudication.checkKind === "abilityCheck"
    && proposal.abilityRef !== null) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:ability-attack-required"]);
  }

  const costs = abilityCosts(ability, input.state, input.actorCharacterId);
  if (costs === undefined) {
    return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:ability-cost-unavailable"]);
  }
  const success = lowerBranch(
    proposal.branches.success,
    input.state,
    input.actorCharacterId,
    proposal.sceneRef,
  );
  if (success.kind === "rejected") return success;
  const failure = lowerBranch(
    proposal.branches.failure,
    input.state,
    input.actorCharacterId,
    proposal.sceneRef,
  );
  if (failure.kind === "rejected") return failure;
  const basisRefs = uniqueRefs([
    ...envelope.basisRefs,
    ...branchBasisRefs(proposal.branches),
  ]);
  const targetRefs = uniqueRefs(proposal.targetRefs);
  const directTargetRefs = uniqueRefs(proposal.directTargetRefs);
  const instrumentRefs = uniqueRefs(proposal.instrumentRefs);
  const dependencyRefs = uniqueRefs([
    input.actorCharacterId,
    proposal.sceneRef,
    ...targetRefs,
    ...directTargetRefs,
    ...instrumentRefs,
    ...(proposal.abilityRef === null ? [] : [proposal.abilityRef]),
    ...basisRefs,
    ...costs.map(({ entryRef }) => entryRef),
    ...success.dependencyRefs,
    ...failure.dependencyRefs,
    // A prospective handle names something this same atomic Bundle is about
    // to create; it cannot be a pre-existing read-set binding, and Rules
    // derives the transaction's committed read set for it separately (see
    // loweredTransactionReadSet in room-bridge.ts).
  ].filter((ref) => !PROSPECTIVE_HANDLE_PATTERN.test(ref)));
  const planReadSet = selectPlanReadSet(input.requiredContext, dependencyRefs);
  if (planReadSet.kind === "rejected") return planReadSet;
  const interactionHash = canonicalHash({
    proposalRef: envelope.proposalRef,
    contextHash: envelope.contextHash,
    actorCharacterId: input.actorCharacterId,
  }).slice("sha256:".length, "sha256:".length + 24);
  const check = proposal.adjudication.kind === "check"
    ? {
        kind: proposal.adjudication.checkKind === "abilityCheck"
          && proposal.adjudication.skill !== null
          ? "skill"
          : "ability",
        ability: FROZEN_CHECK_ABILITIES[proposal.adjudication.ability],
        skill: proposal.adjudication.skill,
        dc: String(proposal.adjudication.dc),
        modifier: String(mechanicalModifier(
          input.state,
          input.actorCharacterId,
          proposal.adjudication,
          ability,
        )),
        mode: proposal.adjudication.mode,
        goal: proposal.intent,
        method: proposal.method,
        risk: proposal.adjudication.risk,
        successOutcome: proposal.adjudication.successOutcome,
        failureOutcome: proposal.adjudication.failureOutcome,
        costs: costs.map(({ entryRef }) => entryRef).sort(compareCodeUnits),
      }
    : undefined;
  const ruling = proposal.adjudication.kind === "directSuccess"
    ? { kind: "directSuccess" as const }
    : {
        kind: "check" as const,
        resolutionKind: proposal.adjudication.checkKind,
        randomnessId: `randomness:world-interaction:${interactionHash}`,
        check: check!,
      };
  return Object.freeze({
    kind: "accepted",
    rulesInput: {
      kind: "resolveWorldInteraction",
      rootActionId: input.rootActionId,
      actorCharacterId: input.actorCharacterId,
      plan: {
        schema: "zhuwei.world-interaction-resolution-plan/v1",
        resolutionId: `resolution:world-interaction:${interactionHash}`,
        interactionRef: envelope.proposalRef,
        actorCharacterId: input.actorCharacterId,
        sceneRef: proposal.sceneRef,
        abilityRef: proposal.abilityRef,
        contextHash: envelope.contextHash,
        readSet: planReadSet.readSet,
        targetRefs,
        directTargetRefs,
        instrumentRefs,
        basisRefs,
        intent: proposal.intent,
        method: proposal.method,
        ruling,
        costs,
        branches: {
          success: success.branch,
          failure: failure.branch,
        },
      },
    },
  });
}

function lowerBranch(
  branch: VNextWorldInteractionBranchProposal,
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  sceneRef: string,
): { kind: "accepted"; branch: JsonRecord; dependencyRefs: readonly string[] }
  | Extract<VNextProposalLoweringResult, { kind: "rejected" }> {
  const effects: JsonRecord[] = [];
  const dependencyRefs: string[] = [];
  for (const effect of branch.effects) {
    if (effect.kind === "relationTransition") {
      const composed = composeSemanticNext(state, effect.relationRef, [{
        kind: "set",
        path: ["state"],
        value: effect.toState,
      }], [{ kind: "value", path: ["state"] }]);
      if (composed.kind === "rejected") return composed;
      const current = state.campaignRuntime.definitions[effect.relationRef];
      const fromState = isPlainRecord(current)
        && isPlainRecord(current.content)
        && (current.content.state === "active" || current.content.state === "ended")
        ? current.content.state
        : undefined;
      const relationKind = isPlainRecord(current)
        && isPlainRecord(current.content)
        && typeof current.content.kind === "string"
        && WORLD_RELATION_KINDS.has(current.content.kind)
        ? current.content.kind
        : undefined;
      const subjectRef = isPlainRecord(current)
        && isPlainRecord(current.content)
        && isRef(current.content.subjectRef)
        ? current.content.subjectRef
        : undefined;
      const objectRef = isPlainRecord(current)
        && isPlainRecord(current.content)
        && isRef(current.content.objectRef)
        ? current.content.objectRef
        : undefined;
      if (fromState === undefined || relationKind === undefined
        || subjectRef === undefined || objectRef === undefined) {
        return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:relation-state-invalid"]);
      }
      if (!authorityRefBoundToScene(state, subjectRef, sceneRef)
        || !authorityRefBoundToScene(state, objectRef, sceneRef)) {
        return rejected(
          "PROPOSAL_REFERENCE_INVALID",
          ["world-interaction:relation-endpoint-outside-scene"],
        );
      }
      effects.push({
        kind: "relationTransition",
        relationRef: effect.relationRef,
        relationKind,
        subjectRef,
        objectRef,
        fromState,
        toState: effect.toState,
        nextDefinition: composed.nextDefinition,
        summary: branch.summary,
      });
      dependencyRefs.push(effect.relationRef, subjectRef, objectRef);
      continue;
    }
    if (effect.kind === "definitionRevision") {
      const current = state.campaignRuntime.definitions[effect.definitionRef];
      if (!isPlainRecord(current)
        || current.semanticKind !== "sceneFeature"
        || !authorityRefBoundToScene(state, effect.definitionRef, sceneRef)) {
        return rejected(
          "PROPOSAL_REFERENCE_INVALID",
          ["world-interaction:definition-revision-outside-domain"],
        );
      }
      const composed = composeSemanticNext(
        state,
        effect.definitionRef,
        effect.operations,
        semanticWorldFieldPolicies(state.campaignRuntime.definitions[effect.definitionRef]),
      );
      if (composed.kind === "rejected") return composed;
      effects.push({
        kind: "definitionRevision",
        nextDefinition: composed.nextDefinition,
        summary: effect.summary,
      });
      dependencyRefs.push(effect.definitionRef);
      continue;
    }
    const hazardDependencies = authorityZoneDependencies(state, effect.zoneRef, sceneRef);
    if (!isWorldDamageProfileRef(effect.damageProfileRef)
      || !authorityRefBoundToScene(state, effect.sourceDefinitionRef, sceneRef)
      || !authorityRefBoundToScene(state, effect.zoneRef, sceneRef)) {
      return rejected("PROPOSAL_REFERENCE_INVALID", ["world-interaction:registered-hazard-unavailable"]);
    }
    dependencyRefs.push(
      effect.sourceDefinitionRef,
      effect.zoneRef,
      ...hazardDependencies.flatMap(({ relationRef, targetRef }) => [relationRef, targetRef]),
    );
    effects.push(structuredClone(effect));
  }
  return {
    kind: "accepted",
    branch: {
      outcomeCode: branch.outcomeCode,
      summary: branch.summary,
      effects,
      sensoryEvidence: branch.sensoryEvidence.map((evidence) => ({
        ...structuredClone(evidence),
        visibilityPolicyRef: evidence.observerRef === actorCharacterId
          ? `visibility:knowledge-holder:${actorCharacterId}`
          : "visibility:scene-observers",
      })),
      pressures: branch.pressures.map((pressure) => ({
        ...structuredClone(pressure),
        visibilityPolicyRef: "visibility:scene-observers",
      })),
      opportunities: branch.opportunities.map((opportunity) => ({
        ...structuredClone(opportunity),
        visibilityPolicyRef: "visibility:scene-observers",
      })),
    },
    dependencyRefs: uniqueRefs([
      ...dependencyRefs,
      ...branch.sensoryEvidence.flatMap(({ observerRef, subjectRef, basisRefs }) => [
        observerRef,
        ...(subjectRef === null ? [] : [subjectRef]),
        ...basisRefs,
      ]),
      ...branch.pressures.flatMap(({ sourceRef, basisRefs }) => [
        ...(sourceRef === null ? [] : [sourceRef]),
        ...basisRefs,
      ]),
      ...branch.opportunities.flatMap(({ targetRef, basisRefs }) => [
        ...(targetRef === null ? [] : [targetRef]),
        ...basisRefs,
      ]),
    ]),
  };
}

function composeSemanticNext(
  state: AuthoritativeWorldState,
  definitionRef: string,
  operations: readonly SemanticDefinitionOperation[],
  allowlist: readonly SemanticFieldPolicy[],
): { kind: "accepted"; nextDefinition: StoredSemanticDefinition }
  | Extract<VNextProposalLoweringResult, { kind: "rejected" }> {
  const stored = state.campaignRuntime.definitions[definitionRef];
  const snapshot = semanticDefinitionSnapshot(stored);
  if (snapshot === undefined || !isPlainRecord(stored)
    || !isNonEmptyString(stored.visibilityPolicyRef)
    || !isNonEmptyString(stored.semanticKind)
    || !isNonEmptyString(stored.templateRef)
    || !isHash(stored.templateHash)) {
    return rejected("DEFINITION_CONFLICT", ["world-interaction:semantic-definition-unavailable"]);
  }
  const result = composeDefinition({
    base: snapshot,
    expectedRevision: snapshot.revision,
    expectedHash: snapshot.definitionHash,
    allowlist,
    operations,
  });
  if (result.kind === "rejected") {
    return rejected(
      result.code === "DEFINITION_CONFLICT" ? "DEFINITION_CONFLICT" : "PROPOSAL_FORM_INVALID",
      result.issues,
    );
  }
  return {
    kind: "accepted",
    nextDefinition: storedSemanticDefinition(
      stored.semanticKind as Parameters<typeof storedSemanticDefinition>[0],
      stored.visibilityPolicyRef,
      result.snapshot,
      { templateRef: stored.templateRef, templateHash: stored.templateHash },
    ),
  };
}

function abilityCosts(
  ability: unknown,
  state: AuthoritativeWorldState,
  actorCharacterId: string,
): readonly LoweredItemCost[] | undefined {
  if (ability === undefined) return [];
  if (!isPlainRecord(ability) || (ability.costs !== undefined && !Array.isArray(ability.costs))) {
    return undefined;
  }
  const costs: LoweredItemCost[] = [];
  for (const cost of ability.costs ?? []) {
    if (!isPlainRecord(cost) || cost.kind !== "item"
      || !isRef(cost.resourceId)
      || !/^(?:0|[1-9][0-9]*)$/u.test(String(cost.amount))
      || (cost.chargeCost !== undefined
        && !/^(?:0|[1-9][0-9]*)$/u.test(String(cost.chargeCost)))
      || (cost.durabilityCost !== undefined
        && !/^(?:0|[1-9][0-9]*)$/u.test(String(cost.durabilityCost)))) return undefined;
    const entry = state.campaignRuntime.itemSystem.entries[cost.resourceId];
    if (entry === undefined || entry.holderRef !== actorCharacterId
      || itemEntryResourceId(entry.entryId) !== cost.resourceId) return undefined;
    const quantity = Number(cost.amount);
    const charges = cost.chargeCost === undefined ? 0 : Number(cost.chargeCost);
    const durability = cost.durabilityCost === undefined ? 0 : Number(cost.durabilityCost);
    if (quantity + charges + durability <= 0) return undefined;
    costs.push({
      kind: "item",
      entryRef: entry.entryId,
      quantity,
      charges,
      durability,
    });
  }
  return costs.sort((left, right) => compareCodeUnits(left.entryRef, right.entryRef));
}

function mechanicalModifier(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  adjudication: Extract<WorldInteractionAdjudication, { kind: "check" }>,
  abilityDefinition: unknown,
): number {
  if (adjudication.checkKind === "attack" && isPlainRecord(abilityDefinition)) {
    const source = state.combatRuntime.entities[actorCharacterId];
    return isPlainRecord(source) ? combatAttackBonus(source, abilityDefinition) : 0;
  }
  const actor = state.entities[actorCharacterId];
  const attack = isPlainRecord(abilityDefinition) && isPlainRecord(abilityDefinition.attack)
    ? abilityDefinition.attack
    : undefined;
  const ability = adjudication.checkKind === "attack"
    && attack !== undefined
    && typeof attack.ability === "string"
    ? attack.ability
    : adjudication.ability;
  const score = actor?.abilityScores?.[ability] ?? 10;
  let modifier = Math.floor((score - 10) / 2);
  const proficient = adjudication.checkKind === "attack"
    ? attack?.proficiency === true
    : adjudication.skill !== null
      && actor?.proficientSkills?.includes(adjudication.skill) === true;
  if (proficient) modifier += actor?.proficiencyBonus ?? 0;
  if (adjudication.checkKind === "abilityCheck"
    && adjudication.skill !== null
    && actor?.expertiseSkills?.includes(adjudication.skill) === true) {
    modifier += actor.proficiencyBonus ?? 0;
  }
  return modifier;
}

function authorityZoneDependencies(
  state: AuthoritativeWorldState,
  zoneRef: string,
  sceneRef: string,
): readonly Readonly<{ relationRef: string; targetRef: string }>[] {
  return Object.values(state.campaignRuntime.definitions).flatMap((definition) => {
    if (!isPlainRecord(definition)
      || definition.semanticKind !== "worldRelation"
      || !isPlainRecord(definition.content)
      || definition.content.kind !== "contains"
      || !isRef(definition.content.relationRef)
      || definition.content.subjectRef !== zoneRef
      || definition.content.state !== "active"
      || !isRef(definition.content.objectRef)
      || state.entities[definition.content.objectRef]?.sceneId !== sceneRef) return [];
    return [{
      relationRef: definition.content.relationRef,
      targetRef: definition.content.objectRef,
    }];
  }).sort((left, right) => compareCodeUnits(left.targetRef, right.targetRef));
}

function semanticWorldFieldPolicies(definition: unknown): readonly SemanticFieldPolicy[] {
  if (!isPlainRecord(definition) || !isPlainRecord(definition.content)) return [];
  return [
    { kind: "value", path: ["observableState"] },
    { kind: "value", path: ["affordances"] },
    { kind: "value", path: ["description"] },
    { kind: "value", path: ["semantics", "observableState"] },
    { kind: "value", path: ["semantics", "affordances"] },
    { kind: "value", path: ["semantics", "description"] },
  ];
}

function validateSemanticRevision(value: Record<string, unknown>): void {
  if (!exactKeys(value, [
    "kind", "definitionRef", "semanticKind", "npcRef", "baseRevision", "baseHash",
    "templateRef", "templateHash", "operations", "summary",
  ])
    || value.kind !== "reviseSemanticDefinition"
    || value.semanticKind !== "npc"
    || ![value.definitionRef, value.npcRef, value.baseRevision, value.baseHash,
      value.templateRef, value.templateHash].every(isRef)
    || !isBoundedText(value.summary, 2_000)
    || !isSemanticOperations(value.operations)) {
    throw new TypeError("proposal:semantic-revision-invalid");
  }
}

function validateWorldInteraction(value: Record<string, unknown>): void {
  if (!exactKeys(value, [
    "kind", "sceneRef", "targetRefs", "directTargetRefs", "instrumentRefs", "abilityRef",
    "intent", "method", "adjudication", "branches",
  ])
    || value.kind !== "worldInteraction"
    || !isRef(value.sceneRef)
    || !isRefArray(value.targetRefs, 1)
    || !isRefArray(value.directTargetRefs, 1)
    || !isRefSubset(value.directTargetRefs, value.targetRefs)
    || !isRefArray(value.instrumentRefs)
    || !(value.abilityRef === null || isRef(value.abilityRef))
    || !isBoundedText(value.intent, 4_000)
    || !isBoundedText(value.method, 4_000)
    || !isAdjudication(value.adjudication)
    || !isPlainRecord(value.branches)
    || !exactKeys(value.branches, ["success", "failure"])
    || !isBranch(value.branches.success)
    || !isBranch(value.branches.failure)) {
    throw new TypeError("proposal:world-interaction-invalid");
  }
}

function isAdjudication(value: unknown): value is WorldInteractionAdjudication {
  if (!isPlainRecord(value)) return false;
  if (value.kind === "directSuccess") {
    return exactKeys(value, ["kind", "risk", "successOutcome", "failureOutcome"])
      && [value.risk, value.successOutcome, value.failureOutcome]
        .every((entry) => isBoundedText(entry, 4_000));
  }
  return value.kind === "check"
    && exactKeys(value, [
      "kind", "checkKind", "ability", "skill", "dc", "mode", "risk",
      "successOutcome", "failureOutcome",
    ])
    && (value.checkKind === "abilityCheck" || value.checkKind === "attack")
    && ["str", "dex", "con", "int", "wis", "cha"].includes(String(value.ability))
    && (value.skill === null || isRef(value.skill))
    && Number.isSafeInteger(value.dc) && Number(value.dc) >= 1 && Number(value.dc) <= 40
    && ["normal", "advantage", "disadvantage"].includes(String(value.mode))
    && [value.risk, value.successOutcome, value.failureOutcome]
      .every((entry) => isBoundedText(entry, 4_000));
}

function isBranch(value: unknown): value is VNextWorldInteractionBranchProposal {
  if (!isPlainRecord(value)
    || !exactKeys(value, [
      "outcomeCode", "summary", "effects", "sensoryEvidence", "pressures", "opportunities",
    ])
    || !isRef(value.outcomeCode)
    || !isBoundedText(value.summary, 4_000)
    || !Array.isArray(value.effects) || value.effects.length > 16
    || !value.effects.every(isWorldEffect)
    || !Array.isArray(value.sensoryEvidence) || value.sensoryEvidence.length > 16
    || !value.sensoryEvidence.every(isSensoryEvidence)
    || !Array.isArray(value.pressures) || value.pressures.length > 8
    || !value.pressures.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["description", "sourceRef", "basisRefs"])
      && isBoundedText(entry.description, 2_000)
      && (entry.sourceRef === null || isRef(entry.sourceRef))
      && isRefArray(entry.basisRefs, 1))
    || !Array.isArray(value.opportunities) || value.opportunities.length > 8
    || !value.opportunities.every((entry) => isPlainRecord(entry)
      && exactKeys(entry, ["description", "targetRef", "actionHint", "basisRefs"])
      && isBoundedText(entry.description, 2_000)
      && (entry.targetRef === null || isRef(entry.targetRef))
      && (entry.actionHint === null || isBoundedText(entry.actionHint, 2_000))
      && isRefArray(entry.basisRefs, 1))) return false;
  return true;
}

function isWorldEffect(value: unknown): value is VNextWorldSemanticEffect {
  if (!isPlainRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "relationTransition") {
    return exactKeys(value, ["kind", "relationRef", "toState"])
      && isRef(value.relationRef)
      && (value.toState === "active" || value.toState === "ended");
  }
  if (value.kind === "definitionRevision") {
    return exactKeys(value, ["kind", "definitionRef", "operations", "summary"])
      && isRef(value.definitionRef)
      && isSemanticOperations(value.operations)
      && isBoundedText(value.summary, 2_000);
  }
  return value.kind === "registeredHazard"
    && exactKeys(value, ["kind", "sourceDefinitionRef", "zoneRef", "damageProfileRef"])
    && isRef(value.sourceDefinitionRef)
    && isRef(value.zoneRef)
    && isWorldDamageProfileRef(value.damageProfileRef);
}

function isSensoryEvidence(value: unknown): boolean {
  return isPlainRecord(value)
    && exactKeys(value, ["observerRef", "subjectRef", "sense", "evidence", "basisRefs"])
    && isRef(value.observerRef)
    && (value.subjectRef === null || isRef(value.subjectRef))
    && ["sight", "hearing", "smell", "touch", "taste", "special"].includes(String(value.sense))
    && isBoundedText(value.evidence, 2_000)
    && isRefArray(value.basisRefs, 1);
}

function isSemanticOperations(value: unknown): value is readonly SemanticDefinitionOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return false;
  return value.every((operation) => {
    if (!isPlainRecord(operation) || typeof operation.kind !== "string"
      || !Array.isArray(operation.path) || operation.path.length === 0
      || !operation.path.every(isRef)) return false;
    if (operation.kind === "set") return exactKeys(operation, ["kind", "path", "value"]);
    if (operation.kind === "remove") return exactKeys(operation, ["kind", "path"]);
    if (operation.kind === "upsertByRef") {
      return exactKeys(operation, ["kind", "path", "entry"])
        && isPlainRecord(operation.entry);
    }
    return operation.kind === "removeByRef"
      && exactKeys(operation, ["kind", "path", "ref"])
      && isRef(operation.ref);
  });
}

function branchBasisRefs(branches: VNextWorldInteractionProposal["proposal"]["branches"]): string[] {
  return [branches.success, branches.failure].flatMap((branch) => [
    ...branch.sensoryEvidence.flatMap(({ basisRefs }) => [...basisRefs]),
    ...branch.pressures.flatMap(({ basisRefs }) => [...basisRefs]),
    ...branch.opportunities.flatMap(({ basisRefs }) => [...basisRefs]),
  ]);
}

/** Exported so proposal-bundle.ts can build a materializeObject Rules plan's
 * readSet from the same frozen RequiredContext bindings, without duplicating
 * this lookup. */
export function selectPlanReadSet(
  context: VNextRequiredContext,
  dependencyRefs: readonly string[],
  npcRef?: string,
): Readonly<{
  kind: "accepted";
  readSet: readonly Readonly<{ ref: string; revisionOrHash: string }>[];
}> | Extract<VNextProposalLoweringResult, { kind: "rejected" }> {
  const byRef = new Map(context.entries.flatMap((entry) => entry.kind === "known"
    ? [[entry.entryRef, {
        ref: entry.entryRef,
        revisionOrHash: entry.revisionOrHash,
      }] as const]
    : []));
  const selected = new Map<string, Readonly<{ ref: string; revisionOrHash: string }>>();
  const missing: string[] = [];
  const npcKnowledgeRefs = npcRef === undefined
    ? new Set<string>()
    : new Set(context.references.citations.npcKnowledge
      .find((entry) => entry.npcRef === npcRef)?.refs ?? []);

  for (const dependencyRef of uniqueRefs(dependencyRefs)) {
    let binding = byRef.get(dependencyRef);
    if (binding === undefined) {
      binding = byRef.get(`knowledge:${context.intent.actorRef}:${dependencyRef}`)
        ?? byRef.get(`npc-knowledge:${context.intent.actorRef}:${dependencyRef}`);
    }
    if (binding === undefined && npcRef !== undefined && npcKnowledgeRefs.has(dependencyRef)) {
      binding = byRef.get(`knowledge:${npcRef}:${dependencyRef}`)
        ?? byRef.get(`npc-knowledge:${npcRef}:${dependencyRef}`);
    }
    if (binding === undefined) {
      missing.push(dependencyRef);
      continue;
    }
    selected.set(binding.ref, {
      ref: binding.ref,
      revisionOrHash: binding.revisionOrHash,
    });
  }
  if (missing.length > 0) {
    return rejected(
      "CONTEXT_INSUFFICIENT",
      missing.map((ref) => `proposal:dependency-not-read-bound:${ref}`),
    );
  }
  return Object.freeze({
    kind: "accepted",
    readSet: Object.freeze([...selected.values()].sort((left, right) =>
      compareCodeUnits(left.ref, right.ref))),
  });
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const sorted = [...expected].sort(compareCodeUnits);
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isRef(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 300 && value.normalize("NFC") === value;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isRefArray(value: unknown, minimum = 0): value is readonly string[] {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= 64
    && value.every(isRef)
    && value.length === new Set(value).size;
}

function isRefSubset(subset: unknown, superset: unknown): boolean {
  return Array.isArray(subset)
    && Array.isArray(superset)
    && subset.every((ref) => superset.includes(ref));
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return isNonEmptyString(value)
    && value.length <= maximum
    && value.normalize("NFC") === value;
}

function uniqueRefs(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function rejected(
  code: Extract<VNextProposalLoweringResult, { kind: "rejected" }>["code"],
  issues: readonly string[],
): Extract<VNextProposalLoweringResult, { kind: "rejected" }> {
  return Object.freeze({
    kind: "rejected",
    code,
    issues: Object.freeze([...issues].sort(compareCodeUnits)),
  });
}

function issue(error: unknown): string {
  return error instanceof Error ? error.message : "proposal:unknown-error";
}
