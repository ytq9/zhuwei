import {
  CAUSAL_ACTION_LANGUAGE_PROFILE,
  kpFormBindingHash,
  lowerCausalActionProgram,
  validateCausalActionProgram,
  type CausalActionProgram,
  type CausalNode,
  type CausalValue,
  type LoweredCausalStep,
} from "../../kp/causal-action-program";
import { parseCompoundCompositionJson } from "../../kp/compound-composition";
import { KP_FORM_IDS, validateKpFormDraft, type KpFormId } from "../../kp/form-catalog";
import { canonicalSha256 } from "../profiles/canonical";
import { CAUSAL_ACTION_INTERPRETER_PROFILE } from "../profiles/causal-action-interpreter";
import type { RuntimeProfileManifest } from "../profiles/types";
import type {
  AuthoritativeWorldState,
  CausalActionResolutionPlan,
  CharacterRecord,
  FrozenCheck,
  InternalContinuationRecord,
} from "./model";
import { hasExactKeys, hashWorldState, isNonEmptyString, isRecord } from "./validation";
import { skillCheckModifier } from "./proficiency";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const MODES = ["normal", "advantage", "disadvantage"] as const;
const SKILLS = [
  "none", "acrobatics", "animal", "arcana", "athletics", "deception", "history",
  "insight", "intimidation", "investigation", "medicine", "nature", "perception",
  "performance", "persuasion", "religion", "sleight", "stealth", "survival",
] as const;
const DURATION_FACTORS = {
  round: 6_000_000n,
  second: 1_000_000n,
  minute: 60_000_000n,
  hour: 3_600_000_000n,
  day: 86_400_000_000n,
} as const;

const SINGLE_FORM_PRIMITIVE = Object.freeze({
  "clarification.v1": "requestClarification",
  "observe.v1": "inspectFiction",
  "npc-exchange.v1": "exchangeWithNpc",
  "ordinary-check.v1": "assessOrdinaryAction",
  "high-risk-action.v1": "assessHighRiskAction",
  "in-world-refusal.v1": "refuseInWorld",
  "materialization.v1": "materializeOpenFact",
  "combat-action.v1": "resolveCombatIntent",
  "environmental-stunt.v1": "resolveEnvironmentalStunt",
} as const);

function scalarString(value: CausalValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function scalarNumber(value: CausalValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function stringList(value: CausalValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

export function causalActionDurationMicros(step: LoweredCausalStep): string | undefined {
  const unit = scalarString(step.arguments.durationUnit);
  const value = scalarNumber(step.arguments.durationValue);
  if (unit === undefined || value === undefined || value <= 0 || !(unit in DURATION_FACTORS)) {
    return undefined;
  }
  return (BigInt(value) * DURATION_FACTORS[unit as keyof typeof DURATION_FACTORS]).toString();
}

function exactProgramTopology(program: CausalActionProgram): boolean {
  if (program.formRef === "compound.v1") {
    if (program.nodes.length < 2 || program.nodes.length > 8) return false;
    const final = program.nodes.at(-1);
    if (final?.primitive !== "joinCausalBranches") return false;
    if (program.resultNodeIds.length !== 1 || program.resultNodeIds[0] !== final.nodeId) return false;
    return program.nodes.every((node, index) => {
      const expectedPrimitive = index === program.nodes.length - 1
        ? "joinCausalBranches"
        : "assessCausalStage";
      const expectedDependencies = index === 0 ? [] : [program.nodes[index - 1].nodeId];
      return node.primitive === expectedPrimitive
        && node.dependsOn.length === expectedDependencies.length
        && node.dependsOn.every((dependency, dependencyIndex) =>
          dependency === expectedDependencies[dependencyIndex]);
    });
  }
  const expected = SINGLE_FORM_PRIMITIVE[program.formRef as keyof typeof SINGLE_FORM_PRIMITIVE];
  return expected !== undefined
    && program.nodes.length === 1
    && program.nodes[0].primitive === expected
    && program.nodes[0].dependsOn.length === 0
    && program.resultNodeIds.length === 1
    && program.resultNodeIds[0] === program.nodes[0].nodeId;
}

function validResolutionArguments(node: CausalNode): boolean {
  const args = node.arguments;
  if (!(args.resolution === "direct" || args.resolution === "check")) return false;
  const checkFields = [
    args.ability,
    args.skill,
    args.dc,
    args.mode,
    args.successConsequence,
    args.failureConsequence,
  ];
  if (args.resolution === "direct") {
    return checkFields.every((value) => value === undefined);
  }
  if (args.resolution === "check") {
    if (
      !(ABILITIES as readonly unknown[]).includes(args.ability)
      || !(SKILLS as readonly unknown[]).includes(args.skill)
      || !(MODES as readonly unknown[]).includes(args.mode)
      || !Number.isSafeInteger(args.dc)
      || Number(args.dc) < 0
      || Number(args.dc) > 30
      || !isNonEmptyString(args.successConsequence)
      || !isNonEmptyString(args.failureConsequence)
    ) return false;
  }
  return true;
}

function branchText(step: LoweredCausalStep, branch: "success" | "failure"): string | undefined {
  if (branch === "failure") {
    return scalarString(step.arguments.failureConsequence)
      ?? scalarString(step.arguments.risk)
      ?? scalarString(step.arguments.reason);
  }
  return scalarString(step.arguments.successConsequence)
    ?? scalarString(step.arguments.intendedOutcome)
    ?? scalarString(step.arguments.desiredInformation)
    ?? scalarString(step.arguments.npcResponse)
    ?? scalarString(step.arguments.proposedFact);
}

/** Recomputes the authoritative check from the actor and frozen program node.
 * This is shared by first execution and continuation recovery. */
export function causalActionExpectedFrozenCheck(
  profiles: RuntimeProfileManifest,
  actor: CharacterRecord,
  step: LoweredCausalStep,
): FrozenCheck | undefined {
  const ability = step.arguments.ability;
  const skillValue = scalarString(step.arguments.skill);
  const dc = scalarNumber(step.arguments.dc);
  const mode = step.arguments.mode;
  if (
    !(ABILITIES as readonly unknown[]).includes(ability)
    || !(SKILLS as readonly unknown[]).includes(skillValue)
    || skillValue === undefined
    || dc === undefined
    || !(MODES as readonly unknown[]).includes(mode)
  ) return undefined;
  const skill = skillValue === "none" ? null : skillValue;
  const modifier = skillCheckModifier(profiles, actor, ability as typeof ABILITIES[number], skill);
  const goal = scalarString(step.arguments.goal) ?? scalarString(step.arguments.intendedOutcome);
  const successOutcome = branchText(step, "success");
  const failureOutcome = branchText(step, "failure");
  if (modifier === undefined || goal === undefined || successOutcome === undefined || failureOutcome === undefined) {
    return undefined;
  }
  const abilityName = ({
    str: "strength",
    dex: "dexterity",
    con: "constitution",
    int: "intelligence",
    wis: "wisdom",
    cha: "charisma",
  } as const)[ability as typeof ABILITIES[number]];
  return {
    kind: skill === null ? "ability" : "skill",
    ability: abilityName,
    skill,
    dc: String(dc),
    modifier: String(modifier),
    mode: mode as FrozenCheck["mode"],
    goal,
    method: scalarString(step.arguments.method) ?? "按已冻结方法执行",
    risk: scalarString(step.arguments.risk) ?? "检定结果会选择已冻结的成功或失败后果。",
    successOutcome,
    failureOutcome,
    costs: [],
  };
}

function validDurationAndCosts(node: CausalNode): boolean {
  const args = node.arguments;
  const unit = scalarString(args.durationUnit);
  const value = scalarNumber(args.durationValue);
  if (unit === undefined || value === undefined || value <= 0 || !(unit in DURATION_FACTORS)) return false;
  const resourceRef = scalarString(args.resourceRef);
  const resourceAmount = scalarNumber(args.resourceAmount);
  if ((resourceRef === undefined) !== (resourceAmount === undefined)) return false;
  if (resourceAmount !== undefined && resourceAmount <= 0) return false;
  const itemRef = scalarString(args.itemRef);
  const itemCount = scalarNumber(args.itemCount);
  if ((itemRef === undefined) !== (itemCount === undefined)) return false;
  return itemRef === undefined
    || (itemCount !== undefined && itemCount > 0);
}

/** Rules-side semantic closure shared by first execution and frozen-plan
 * recovery. A caller can recompute the public structural hash, so neither
 * replay nor settlement may rely on the KP-side structural validator alone. */
export function validateExecutableCausalActionProgram(program: CausalActionProgram): boolean {
  if (!exactProgramTopology(program)) return false;
  if (program.formRef !== "compound.v1") {
    const node = program.nodes[0];
    if (node === undefined || !validateKpFormDraft(program.formRef, node.arguments).ok) return false;
  }
  for (const [index, node] of program.nodes.entries()) {
    if (node.primitive === "requestClarification") {
      if (!isNonEmptyString(node.arguments.question)
        || !Array.isArray(node.arguments.choices)
        || node.arguments.choices.length === 0
        || node.arguments.choices.some((choice) => !isNonEmptyString(choice))) return false;
      continue;
    }
    if (node.primitive === "refuseInWorld") {
      if (!isNonEmptyString(node.arguments.reason) || !validDurationAndCosts(node)) return false;
      continue;
    }
    if (node.primitive === "resolveCombatIntent") {
      if (!isNonEmptyString(node.arguments.abilityRef)) return false;
      continue;
    }
    if (node.primitive === "resolveEnvironmentalStunt") {
      if (node.arguments.featureDisposition !== "explicitly-absent") return false;
      continue;
    }
    if (!validResolutionArguments(node)) return false;
    if (program.formRef === "compound.v1") {
      if (node.primitive === "assessCausalStage" && (
        !isNonEmptyString(node.arguments.goal)
        || !isNonEmptyString(node.arguments.method)
        || !isNonEmptyString(node.arguments.intendedOutcome)
      )) return false;
      if (node.primitive === "joinCausalBranches"
        && (!isNonEmptyString(node.arguments.intendedOutcome)
          || parseCompoundCompositionJson(node.arguments.compositionJson) === undefined)) {
        return false;
      }
    }
    const isTerminal = index === program.nodes.length - 1;
    if ((program.formRef !== "compound.v1" || isTerminal) && !validDurationAndCosts(node)) return false;
    for (const listKey of ["basisRefs", "alternatives"] as const) {
      const value = node.arguments[listKey];
      if (value !== undefined && (
        !Array.isArray(value)
        || stringList(value).length === 0
        || stringList(value).length !== value.length
      )) return false;
    }
  }
  return true;
}

/** Validates the full V3 environment Form that is executed by the specialized
 * environment profile rather than by the generic causal interpreter. */
export function validateSpecializedEnvironmentalCausalActionProgram(
  value: unknown,
): value is CausalActionProgram {
  if (!isRecord(value)) return false;
  const validation = validateCausalActionProgram(value);
  if (!validation.ok) return false;
  const program = value as unknown as CausalActionProgram;
  const node = program.nodes[0];
  return program.formRef === "environmental-stunt.v1"
    && exactProgramTopology(program)
    && node !== undefined
    && validateKpFormDraft("environmental-stunt.v1", node.arguments).ok
    && ["reuse-existing", "reasonable-open-blank"].includes(
      String(node.arguments.featureDisposition),
    );
}

export function isCausalActionResolutionPlan(
  value: unknown,
): value is CausalActionResolutionPlan {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "actorCharacterId",
      "checkNodeRefs",
      "durationMicros",
      "languageHash",
      "languageRef",
      "program",
      "programFactRef",
      "programHash",
      "rootActionId",
      "schema",
      "sourceSceneId",
    ])
    || value.schema !== "zhuwei.causal-action-resolution-plan/v4"
    || !isNonEmptyString(value.actorCharacterId)
    || !isNonEmptyString(value.sourceSceneId)
    || !isNonEmptyString(value.languageRef)
    || !isNonEmptyString(value.languageHash)
    || !isNonEmptyString(value.programHash)
    || !isNonEmptyString(value.programFactRef)
    || !isNonEmptyString(value.rootActionId)
    || !/^fnv1a64:[0-9a-f]{16}$/u.test(String(value.programHash))
    || !/^[1-9][0-9]*$/u.test(String(value.durationMicros))
    || !Array.isArray(value.checkNodeRefs)
    || value.checkNodeRefs.some((nodeRef) => !isNonEmptyString(nodeRef))
    || new Set(value.checkNodeRefs).size !== value.checkNodeRefs.length
    || !isRecord(value.program)
  ) return false;

  const validation = validateCausalActionProgram(value.program);
  if (!validation.ok) return false;
  const program = value.program as unknown as CausalActionProgram;
  if (
    !validateExecutableCausalActionProgram(program)
    || value.languageRef !== program.languageRef
    || value.languageHash !== program.languageHash
    || value.programHash !== program.semanticHash
    || value.programFactRef !== causalProgramFactRef(value.rootActionId, program.semanticHash)
  ) return false;

  let lowered;
  try {
    lowered = lowerCausalActionProgram(program);
  } catch {
    return false;
  }
  const terminal = lowered.steps.at(-1);
  if (terminal === undefined || causalActionDurationMicros(terminal) !== value.durationMicros) {
    return false;
  }
  const checkNodeRefs = lowered.steps.flatMap((step) =>
    step.arguments.resolution === "check" ? [step.nodeRef] : []);
  const frozenCheckNodeRefs = value.checkNodeRefs as string[];
  return checkNodeRefs.length === frozenCheckNodeRefs.length
    && checkNodeRefs.every((nodeRef, index) => nodeRef === frozenCheckNodeRefs[index]);
}

export function causalProgramFactRef(rootActionId: string, programHash: string): string {
  return `fact:v3-causal-program:${rootActionId}:${programHash.slice("fnv1a64:".length)}`;
}

export function causalProgramFactValue(program: CausalActionProgram) {
  return Object.freeze({
    interpreterProfile: Object.freeze({ ...CAUSAL_ACTION_INTERPRETER_PROFILE }),
    languageRef: program.languageRef,
    languageHash: program.languageHash,
    formRef: program.formRef,
    formHash: program.formHash,
    programHash: program.semanticHash,
    basisRefs: Object.freeze([...new Set(program.nodes.flatMap((node) =>
      stringList(node.arguments.basisRefs)))].sort()),
  });
}

export function isCausalProgramFactValue(value: unknown): boolean {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "basisRefs",
      "formHash",
      "formRef",
      "interpreterProfile",
      "languageHash",
      "languageRef",
      "programHash",
    ])
    || !isRecord(value.interpreterProfile)
    || !hasExactKeys(value.interpreterProfile, ["profileHash", "profileId"])
    || value.interpreterProfile.profileId !== CAUSAL_ACTION_INTERPRETER_PROFILE.profileId
    || value.interpreterProfile.profileHash !== CAUSAL_ACTION_INTERPRETER_PROFILE.profileHash
    || value.languageRef !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
    || value.languageHash !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash
    || !isNonEmptyString(value.formRef)
    || !(KP_FORM_IDS as readonly unknown[]).includes(value.formRef)
    || value.formHash !== kpFormBindingHash(value.formRef as KpFormId)
    || !/^fnv1a64:[0-9a-f]{16}$/u.test(String(value.programHash))
    || !Array.isArray(value.basisRefs)
    || value.basisRefs.some((reference) => !isNonEmptyString(reference))
  ) return false;
  return true;
}

export function isCurrentCausalResolutionMarker(value: unknown): boolean {
  if (isRecord(value) && value.schema === "zhuwei.social-resolution-plan/v1") return false;
  return isRecord(value) && (
    value.schema === "zhuwei.causal-action-resolution-plan/v4"
    || value.languageRef === CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
    || (isRecord(value.program)
      && value.program.languageRef === CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef)
  );
}

function causalContinuationBindingCore(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  requestValue: unknown,
  continuationValue: unknown,
  planValue: unknown,
): boolean {
  if (
    !isCausalActionResolutionPlan(planValue)
    || planValue.rootActionId !== rootActionId
    || !isRecord(requestValue)
    || !isRecord(continuationValue)
    || requestValue.purpose !== "improvisedCheck"
    || !isNonEmptyString(requestValue.resolutionId)
  ) return false;
  const actor = state.entities[planValue.actorCharacterId];
  if (
    actor?.kind !== "player"
    || actor.tenureStatus !== "active"
    || actor.sceneId !== planValue.sourceSceneId
  ) return false;
  const fact = state.canonicalFacts[planValue.programFactRef];
  const program = planValue.program as unknown as CausalActionProgram;
  if (
    fact?.kind !== "causalActionProgram"
    || fact.source !== "characterAction"
    || fact.subjectRefs.length !== 1
    || fact.subjectRefs[0] !== actor.id
    || !isRecord(fact.value)
    || canonicalSha256(fact.value) !== canonicalSha256(causalProgramFactValue(program))
  ) return false;
  let steps: readonly LoweredCausalStep[];
  try {
    steps = lowerCausalActionProgram(program).steps;
  } catch {
    return false;
  }
  const step = steps.find((candidate) =>
    requestValue.resolutionId === `resolution:${rootActionId}:causal:${candidate.nodeRef}`);
  if (step === undefined || step.arguments.resolution !== "check") return false;
  const check = causalActionExpectedFrozenCheck(profiles, actor, step);
  if (check === undefined) return false;
  const expectedRequest = {
    randomnessId: `randomness:${rootActionId}:causal:${step.nodeRef}`,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    actorCharacterId: actor.id,
    purpose: "improvisedCheck",
    diceExpression: check.mode === "normal" ? "1d20"
      : check.mode === "advantage" ? "2d20kh1" : "2d20kl1",
    frozenCheck: check,
  };
  const expectedContinuationId = `continuation:${expectedRequest.resolutionId}`;
  return planValue.checkNodeRefs.includes(step.nodeRef)
    && continuationValue.kind === "roomAuthorityRandomness"
    && continuationValue.continuationId === expectedContinuationId
    && canonicalSha256(requestValue) === canonicalSha256(expectedRequest);
}

/** Validates a causal RandomnessRequested payload against its exact prior
 * state, including the capability commitment. */
export function isCausalRandomnessEventBinding(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  payload: unknown,
): boolean {
  if (!isRecord(payload)
    || !("resolutionPlan" in payload)
    || !causalContinuationBindingCore(
      profiles,
      state,
      rootActionId,
      payload.request,
      payload.continuation,
      payload.resolutionPlan,
    )
    || !isRecord(payload.continuation)) return false;
  return payload.continuation.capability === canonicalSha256({
    kind: "roomAuthorityRandomness",
    roomId: state.roomId,
    runtimeEpochId: state.runtimeEpochId,
    stateHash: hashWorldState(state),
    rootActionId,
    request: payload.request,
    resolutionPlan: payload.resolutionPlan,
  });
}

/** Validates the cross-field binding retained in a materialized pending state.
 * The historical basis hash is verified at event creation/replay; all fields
 * that remain derivable are rechecked before step/project/recovery. */
export function isCausalContinuationStateBinding(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  stored: InternalContinuationRecord,
): boolean {
  return stored.continuation.continuationId === continuationId
    && causalContinuationBindingCore(
      profiles,
      state,
      stored.rootActionId,
      stored.request,
      stored.continuation,
      stored.resolutionPlan,
    );
}
