import {
  CAUSAL_ACTION_LANGUAGE_PROFILE,
  lowerCausalActionProgram,
  validateCausalActionProgram,
  type CausalActionProgram,
  type CausalValue,
  type LoweredCausalStep,
} from "../../kp/causal-action-program";
import { canonicalSha256 } from "../profiles/canonical";
import {
  CAUSAL_ACTION_INTERPRETER_PROFILE,
  causalActionInterpreterEnabled,
} from "../profiles/causal-action-interpreter";
import type { RuntimeProfileManifest } from "../profiles/types";
import {
  createEventTransition,
  createScopeProof,
  type TransitionDraft,
} from "./events";
import {
  causalActionDurationMicros,
  causalActionExpectedFrozenCheck,
  causalProgramFactValue,
  causalProgramFactRef,
  isCausalActionResolutionPlan,
  validateExecutableCausalActionProgram,
} from "./causal-model";
import type {
  AuthoritativeWorldState,
  AuthorityContinuation,
  CausalActionResolutionPlan,
  CharacterRecord,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  PublicReceipt,
  RandomnessRequest,
  ScopeProof,
  StepResult,
} from "./model";
import { rejected } from "./results";
import {
  stepCompoundActionPlan,
  storyWaitsForExplicitContinuation,
} from "./compound-actions";
import {
  hasExactKeys,
  hashWorldState,
  canonicalFactVisibleToCharacter,
  isNonEmptyString,
  isRecord,
} from "./validation";
import { continueCompoundRoot, isContinuedCompoundRoot } from "./internal-compound";

const CAUSAL_INPUT_KEYS = [
  "actionLanguageHash",
  "actionPlanVersion",
  "actorCharacterId",
  "causalActionProgram",
  "kind",
  "rootActionId",
] as const;

type Accumulator = {
  state: AuthoritativeWorldState;
  events: EventEnvelope[];
  receipt?: PublicReceipt;
  scopeProof?: ScopeProof;
};

type FrozenNodeResult = {
  nodeRef: string;
  primitive: string;
  resolution: "direct" | "check";
  succeeded: boolean;
  branch: "success" | "failure";
  skipped?: true;
  total?: number;
};

type CausalRandomnessResult = {
  continuation: AuthorityContinuation;
  rolls: number[];
};

function scalarString(value: CausalValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function scalarNumber(value: CausalValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function stringList(value: CausalValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function checkResolution(step: LoweredCausalStep): "direct" | "check" | undefined {
  return step.arguments.resolution === "direct" || step.arguments.resolution === "check"
    ? step.arguments.resolution
    : undefined;
}

function append<T extends EventType>(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  draft: Omit<TransitionDraft<T>, "scopeProof"> & {
    reads?: string[];
    writes?: string[];
    creates?: string[];
  },
): void {
  const scopeProof = createScopeProof(
    accumulator.state,
    draft.reads ?? [],
    draft.writes ?? [`receipt:${draft.rootActionId}`],
    draft.creates ?? [],
  );
  const transition = createEventTransition(accumulator.state, profiles, {
    rootActionId: draft.rootActionId,
    ...(draft.resolutionId === undefined ? {} : { resolutionId: draft.resolutionId }),
    eventType: draft.eventType,
    payload: draft.payload,
    scopeProof,
    visibilityPolicyId: draft.visibilityPolicyId,
    secrecy: draft.secrecy,
  });
  accumulator.events.push(transition.event);
  accumulator.state = transition.state;
  accumulator.receipt = transition.receipt;
  accumulator.scopeProof = scopeProof;
}

function finished(
  kind: "committed" | "awaitingInput" | "awaitingRandomness",
  accumulator: Accumulator,
  additions: JsonRecord = {},
): StepResult {
  const last = accumulator.events.at(-1);
  if (last === undefined || accumulator.receipt === undefined || accumulator.scopeProof === undefined) {
    return rejected("invalidWorldState", "Causal execution produced no canonical transition.");
  }
  return {
    kind,
    events: accumulator.events,
    state: accumulator.state,
    cache: accumulator.state,
    stateHash: last.stateHashAfter,
    scopeProof: accumulator.scopeProof,
    receipt: accumulator.receipt,
    ...additions,
  } as StepResult;
}

function programGoal(steps: readonly LoweredCausalStep[]): string {
  for (const step of steps) {
    const goal = scalarString(step.arguments.goal)
      ?? scalarString(step.arguments.intendedOutcome)
      ?? scalarString(step.arguments.question);
    if (goal !== undefined) return goal;
  }
  return "执行已冻结的因果行动程序";
}

function programMethod(steps: readonly LoweredCausalStep[]): string {
  for (const step of steps) {
    const method = scalarString(step.arguments.method);
    if (method !== undefined) return method;
  }
  return "按已冻结节点顺序结算";
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

function planFor(
  actor: CharacterRecord,
  program: CausalActionProgram,
  steps: readonly LoweredCausalStep[],
  rootActionId: string,
): CausalActionResolutionPlan | undefined {
  const terminal = steps.at(-1);
  if (terminal === undefined) return undefined;
  const duration = causalActionDurationMicros(terminal);
  if (duration === undefined) return undefined;
  return {
    schema: "zhuwei.causal-action-resolution-plan/v3",
    rootActionId,
    actorCharacterId: actor.id,
    sourceSceneId: actor.sceneId,
    languageRef: program.languageRef,
    languageHash: program.languageHash,
    programHash: program.semanticHash,
    program: structuredClone(program) as unknown as JsonRecord,
    checkNodeRefs: steps.flatMap((step) => checkResolution(step) === "check" ? [step.nodeRef] : []),
    durationMicros: duration,
    programFactRef: causalProgramFactRef(rootActionId, program.semanticHash),
  };
}

function appendProgramFact(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  program: CausalActionProgram,
): void {
  const factRef = causalProgramFactRef(rootActionId, program.semanticHash);
  append(accumulator, profiles, {
    rootActionId,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: actor.id,
      outcomeCode: "causal-program-frozen",
      fact: {
        id: factRef,
        kind: "causalActionProgram",
        subjectRefs: [actor.id],
        value: causalProgramFactValue(program),
        visibilityPolicyId: "visibility:room-authority-only",
        source: "characterAction",
      },
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [`entity:${actor.id}`],
    writes: [`fact:${factRef}`, `receipt:${rootActionId}`],
    creates: [`fact:${factRef}`],
  });
}

function appendFrozenCosts(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  actor: CharacterRecord,
  terminal: LoweredCausalStep,
): boolean {
  const resourceRef = scalarString(terminal.arguments.resourceRef);
  const resourceAmount = scalarNumber(terminal.arguments.resourceAmount);
  if (resourceRef !== undefined && resourceAmount !== undefined) {
    if ((actor.resources?.[resourceRef] ?? 0) < resourceAmount) return false;
    append(accumulator, profiles, {
      rootActionId,
      eventType: "ResourceReserved",
      payload: {
        characterId: actor.id,
        resourceId: resourceRef,
        amount: resourceAmount,
        purpose: programGoal([terminal]),
      },
      visibilityPolicyId: `visibility:character-controller:${actor.id}`,
      secrecy: "private",
      reads: [`entity:${actor.id}`, `resource:${actor.id}:${resourceRef}`],
      writes: [`resource:${actor.id}:${resourceRef}`, `receipt:${rootActionId}`],
    });
  }
  const artifactRef = scalarString(terminal.arguments.artifactRef);
  const artifactCount = scalarNumber(terminal.arguments.artifactCount);
  if (artifactRef !== undefined && artifactCount !== undefined) {
    const itemId = artifactRef.slice("item:".length);
    const item = accumulator.state.entities[actor.id]?.loadout?.backpack
      ?.find((entry) => entry.itemId === itemId);
    if (item === undefined || item.quantity < artifactCount) return false;
    append(accumulator, profiles, {
      rootActionId,
      eventType: "ItemUsed",
      payload: {
        characterId: actor.id,
        itemId,
        quantity: artifactCount,
        remaining: item.quantity - artifactCount,
        purpose: programGoal([terminal]),
      },
      visibilityPolicyId: `visibility:character-controller:${actor.id}`,
      secrecy: "private",
      reads: [`entity:${actor.id}`, `item:${actor.id}:${itemId}`],
      writes: [`item:${actor.id}:${itemId}`, `receipt:${rootActionId}`],
    });
  }
  return true;
}

function appendBranchEffect(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
  branch: "success" | "failure",
): void {
  const text = branchText(step, branch);
  if (text === undefined) return;
  const suffix = plan.programHash.slice("fnv1a64:".length);
  const knowledgeRef = `evidence:v3:${rootActionId}:${suffix}:${step.nodeRef}:${branch}`;
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "KnowledgeAcquired",
    payload: {
      characterId: plan.actorCharacterId,
      knowledgeRef,
      objectKind: "sensoryEvidence",
      layer: "full",
      content: text,
      causeFactId: plan.programFactRef,
      acquisition: {
        sense: "causalResolution",
        sceneId: plan.sourceSceneId,
        method: scalarString(step.arguments.method) ?? "resolveCausalNode",
      },
      visibility: "private",
    },
    visibilityPolicyId: `visibility:knowledge-holder:${plan.actorCharacterId}`,
    secrecy: "private",
    reads: [`entity:${plan.actorCharacterId}`, `fact:${plan.programFactRef}`],
    writes: [`knowledge:${plan.actorCharacterId}:${knowledgeRef}`, `receipt:${rootActionId}`],
    creates: [`knowledge:${plan.actorCharacterId}:${knowledgeRef}`],
  });
}

function appendDirectNode(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
  branch: "success" | "failure",
): void {
  const materialization = step.primitive === "materializeOpenFact" && branch === "success";
  const factRef = `fact:v3-materialization:${rootActionId}:${plan.programHash.slice("fnv1a64:".length)}:${step.nodeRef}`;
  const description = scalarString(step.arguments.proposedFact);
  const basisRefs = stringList(step.arguments.basisRefs);
  if (materialization) {
    const program = plan.program as unknown as CausalActionProgram;
    append(accumulator, profiles, {
      rootActionId,
      resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
      eventType: "DefinitionRegistered",
      payload: {
        definition: {
          definitionId: factRef,
          definitionVersion: "1",
          definitionKind: "materializedOpenFact",
          causalBasisRefs: basisRefs,
          visibilityPolicyRef: "visibility:scene-observers",
          definitionProfile: structuredClone(CAUSAL_ACTION_INTERPRETER_PROFILE),
          actionLanguage: {
            languageRef: plan.languageRef,
            languageHash: plan.languageHash,
            formRef: program.formRef,
            formHash: program.formHash,
          },
          content: { description },
        },
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: basisRefs.map((reference) => `fact:${reference}`),
      writes: [`definition:${factRef}`, `receipt:${rootActionId}`],
      creates: [`definition:${factRef}`],
    });
  }
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: plan.actorCharacterId,
      outcomeCode: `causal-node:${step.nodeRef}:${branch}`,
      fact: materialization
        ? {
            id: factRef,
            kind: "dynamicOpenFact",
            subjectRefs: [plan.actorCharacterId, plan.sourceSceneId].sort(),
            value: {
              description,
            },
            visibilityPolicyId: "visibility:scene-observers",
            source: "dynamicMaterialization",
          }
        : null,
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [
      `entity:${plan.actorCharacterId}`,
      `fact:${plan.programFactRef}`,
      ...basisRefs.map((reference) => `fact:${reference}`),
      ...(materialization ? [`definition:${factRef}`] : []),
    ],
    writes: [
      `receipt:${rootActionId}`,
      ...(materialization ? [`fact:${factRef}`] : []),
    ],
    creates: materialization ? [`fact:${factRef}`] : [],
  });
}

function appendMeaningfulFailure(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  step: LoweredCausalStep,
): void {
  append(accumulator, profiles, {
    rootActionId,
    resolutionId: `resolution:${rootActionId}:causal:${step.nodeRef}`,
    eventType: "MeaningfulFailureCommitted",
    payload: {
      characterId: plan.actorCharacterId,
      goalId: `goal:${rootActionId}:${step.nodeRef}`,
      methodFingerprint: scalarString(step.arguments.method) ?? step.nodeRef,
      factualCause: `resolution:${rootActionId}:causal:${step.nodeRef}:failed`,
      consequences: { effectKinds: branchText(step, "failure") === undefined ? [] : ["acquireEvidence"] },
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`entity:${plan.actorCharacterId}`, `fact:${plan.programFactRef}`],
    writes: [`failure:${rootActionId}:${step.nodeRef}`, `receipt:${rootActionId}`],
    creates: [`failure:${rootActionId}:${step.nodeRef}`],
  });
}

function settleProgram(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  rootActionId: string,
  plan: CausalActionResolutionPlan,
  randomness: ReadonlyMap<string, { rolls: number[]; request: RandomnessRequest; continuationId: string }>,
): StepResult {
  if (!isCausalActionResolutionPlan(plan) || plan.rootActionId !== rootActionId) {
    return rejected("invalidWorldState", "The frozen causal continuation is not canonical.");
  }
  const program = plan.program as unknown as CausalActionProgram;
  const steps = lowerCausalActionProgram(program).steps;
  const nodeResults: FrozenNodeResult[] = [];
  const sequenceSucceeded = new Map<number, boolean>();
  let allPriorSucceeded = true;
  for (const step of steps) {
    const resolution = checkResolution(step);
    if (resolution === undefined) {
      return rejected("invalidWorldState", "A frozen causal node lost its resolution mode.");
    }
    const skipped = step.prerequisiteSequences.some((sequence) =>
      sequenceSucceeded.get(sequence) !== true);
    let ownSucceeded = true;
    let total: number | undefined;
    if (resolution === "check") {
      const entry = randomness.get(step.nodeRef);
      if (entry === undefined || !isRecord(entry.request) || !("frozenCheck" in entry.request)) {
        return rejected("invalidRulesInput", "Every frozen causal check requires one authoritative result.");
      }
      const check = entry.request.frozenCheck;
      const expectedRollCount = check.mode === "normal" ? 1 : 2;
      if (
        entry.rolls.length !== expectedRollCount
        || entry.rolls.some((roll) => !Number.isInteger(roll) || roll < 1 || roll > 20)
      ) return rejected("invalidRulesInput", "A causal check result does not match its frozen dice.");
      const selectedRoll = check.mode === "advantage"
        ? Math.max(...entry.rolls)
        : check.mode === "disadvantage"
          ? Math.min(...entry.rolls)
          : entry.rolls[0];
      total = selectedRoll + Number(check.modifier);
      ownSucceeded = !skipped && total >= Number(check.dc);
      append(accumulator, profiles, {
        rootActionId,
        resolutionId: entry.request.resolutionId,
        eventType: "DiceRolled",
        payload: {
          randomnessId: entry.request.randomnessId,
          resolutionId: entry.request.resolutionId,
          formula: entry.request.diceExpression,
          faces: [...entry.rolls],
          selectedFace: selectedRoll,
          requestHash: canonicalSha256(entry.request),
          frozenParametersHash: canonicalSha256(plan),
        },
        visibilityPolicyId: "visibility:room-authority-only",
        secrecy: "internal",
        reads: [`continuation:${entry.continuationId}`],
        writes: [`receipt:${rootActionId}`],
      });
      append(accumulator, profiles, {
        rootActionId,
        resolutionId: entry.request.resolutionId,
        eventType: "ImprovisedCheckResolved",
        payload: {
          request: structuredClone(entry.request),
          rolls: [...entry.rolls],
          selectedRoll,
          total,
          succeeded: ownSucceeded,
          outcome: skipped
            ? "因冻结的先决阶段未成立，本阶段未执行。"
            : ownSucceeded ? check.successOutcome : check.failureOutcome,
        },
        visibilityPolicyId: `visibility:character-controller:${plan.actorCharacterId}`,
        secrecy: "private",
        reads: [`continuation:${entry.continuationId}`, `entity:${plan.actorCharacterId}`],
        writes: [`continuation:${entry.continuationId}`, `receipt:${rootActionId}`],
      });
    }

    const isJoin = step.primitive === "joinCausalBranches";
    const succeeded: boolean = !skipped
      && (isJoin ? allPriorSucceeded && ownSucceeded : ownSucceeded);
    const branch = succeeded ? "success" : "failure";
    if (skipped) {
      nodeResults.push({
        nodeRef: step.nodeRef,
        primitive: step.primitive,
        resolution,
        succeeded: false,
        branch: "failure",
        skipped: true,
        ...(total === undefined ? {} : { total }),
      });
      sequenceSucceeded.set(step.sequence, false);
      allPriorSucceeded = false;
      continue;
    }
    if (resolution === "direct"
      || (step.primitive === "materializeOpenFact" && branch === "success")) {
      appendDirectNode(accumulator, profiles, rootActionId, plan, step, branch);
    }
    appendBranchEffect(accumulator, profiles, rootActionId, plan, step, branch);
    if (!succeeded) appendMeaningfulFailure(accumulator, profiles, rootActionId, plan, step);
    nodeResults.push({
      nodeRef: step.nodeRef,
      primitive: step.primitive,
      resolution,
      succeeded,
      branch,
      ...(total === undefined ? {} : { total }),
    });
    sequenceSucceeded.set(step.sequence, succeeded);
    allPriorSucceeded &&= succeeded;
  }

  append(accumulator, profiles, {
    rootActionId,
    eventType: "FictionTimeAdvanced",
    payload: {
      durationMicros: plan.durationMicros,
      reason: programGoal(steps),
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`timeline:${accumulator.state.activeBranchId}`],
    writes: [`timeline:${accumulator.state.activeBranchId}`, `receipt:${rootActionId}`],
  });
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: plan.languageRef,
      languageHash: plan.languageHash,
      programHash: plan.programHash,
      formRef: program.formRef,
      succeeded: allPriorSucceeded,
      nodes: nodeResults,
    },
  });
}

function clarification(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
): StepResult {
  const node = program.nodes[0];
  const question = scalarString(node.arguments.question);
  if (question === undefined) return rejected("invalidRulesInput", "Clarification requires one question.");
  const pendingInputId = `pending-input:${input.rootActionId as string}`;
  const accumulator: Accumulator = { state, events: [] };
  const actor = state.entities[input.actorCharacterId as string]!;
  appendProgramFact(accumulator, profiles, input.rootActionId as string, actor, program);
  append(accumulator, profiles, {
    rootActionId: input.rootActionId as string,
    eventType: "ClarificationRequested",
    payload: {
      actorCharacterId: input.actorCharacterId as string,
      pendingInputId,
      question,
    },
    visibilityPolicyId: `visibility:character-controller:${input.actorCharacterId as string}`,
    secrecy: "private",
    reads: [
      `entity:${input.actorCharacterId as string}`,
      `fact:${causalProgramFactRef(input.rootActionId as string, program.semanticHash)}`,
    ],
    writes: [`pending:${pendingInputId}`, `receipt:${input.rootActionId as string}`],
    creates: [`pending:${pendingInputId}`],
  });
  return finished("awaitingInput", accumulator, {
    pending: { pendingInputId, kind: "clarification", question },
  });
}

function combat(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
): StepResult {
  const args = program.nodes[0].arguments;
  const rootActionId = input.rootActionId as string;
  const actor = state.entities[input.actorCharacterId as string]!;
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  const result = stepCompoundActionPlan(profiles, accumulator.state, continueCompoundRoot({
    kind: "resolveCompoundActionPlan",
    actionPlanVersion: "authoritative-kp-action-plan-v1",
    rootActionId: input.rootActionId,
    actorCharacterId: input.actorCharacterId,
    feasibilityKind: "highRiskFeasible",
    goal: args.goal,
    method: args.method,
    publicBasisRefs: stringList(args.basisRefs),
    privateBasisRefs: [],
    adjudicationPrecedent: null,
    risk: {
      warning: scalarString(args.risk) ?? "战斗行动将按已安装的 SRD 5.1 规则结算。",
      successConsequences: [scalarString(args.intendedOutcome) ?? "战斗行动成功。"],
      failureConsequences: [],
      retryGate: ["methodChanged", "factsChanged", "costAccepted"],
    },
    dynamicMaterializations: [],
    npcActions: [],
    scene: {
      question: scalarString(args.goal) ?? "这次战斗行动会如何改变局面？",
      pressure: scalarString(args.risk) ?? "",
      opportunities: stringList(args.contingencies),
      conclusionCandidate: null,
    },
    mechanicalProposal: {
      operation: "invokeCombatAction",
      abilityRef: args.abilityRef,
    },
  }, rootActionId));
  if (result === undefined) {
    return rejected("invalidWorldState", "The causal combat primitive has no registered Rules operation.");
  }
  if (result.kind === "rejected") return result;
  if (!("events" in result)) {
    return rejected("invalidWorldState", "The causal combat primitive returned no canonical transition.");
  }
  return {
    ...result,
    events: [...accumulator.events, ...result.events],
  };
}

function materializationBasisAvailable(
  state: AuthoritativeWorldState,
  actor: CharacterRecord,
  program: CausalActionProgram,
): boolean {
  if (program.formRef !== "materialization.v1") return true;
  const refs = stringList(program.nodes[0]?.arguments.basisRefs);
  return refs.length > 0 && refs.every((reference) => {
    const fact = state.canonicalFacts[reference];
    return fact !== undefined && canonicalFactVisibleToCharacter(state, fact, actor);
  });
}

function inWorldRefusal(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
): StepResult {
  const actor = state.entities[input.actorCharacterId as string]!;
  const node = program.nodes[0];
  const explanation = scalarString(node.arguments.reason)
    ?? scalarString(node.arguments.risk)
    ?? "已成立的世界事实中不存在可供这次行动使用的对象或因果条件。";
  const rootActionId = input.rootActionId as string;
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, rootActionId, actor, program);
  append(accumulator, profiles, {
    rootActionId,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: actor.id,
      outcomeCode: "in-world-refusal",
      fact: null,
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`entity:${actor.id}`, `fact:${causalProgramFactRef(rootActionId, program.semanticHash)}`],
    writes: [`receipt:${rootActionId}`],
  });
  const knowledgeRef = `evidence:v3:${rootActionId}:${program.semanticHash.slice("fnv1a64:".length)}:${node.nodeId}:failure`;
  append(accumulator, profiles, {
    rootActionId,
    eventType: "KnowledgeAcquired",
    payload: {
      characterId: actor.id,
      knowledgeRef,
      objectKind: "sensoryEvidence",
      layer: "full",
      content: explanation,
      causeFactId: causalProgramFactRef(rootActionId, program.semanticHash),
      acquisition: {
        sense: "causalResolution",
        sceneId: actor.sceneId,
        method: scalarString(node.arguments.method) ?? "resolveInWorldRefusal",
      },
      visibility: "private",
    },
    visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
    secrecy: "private",
    reads: [`entity:${actor.id}`, `fact:${causalProgramFactRef(rootActionId, program.semanticHash)}`],
    writes: [`knowledge:${actor.id}:${knowledgeRef}`, `receipt:${rootActionId}`],
    creates: [`knowledge:${actor.id}:${knowledgeRef}`],
  });
  const duration = causalActionDurationMicros({
    sequence: 1,
    nodeRef: node.nodeId,
    primitive: node.primitive,
    prerequisiteSequences: [],
    arguments: node.arguments,
  });
  if (duration !== undefined) {
    append(accumulator, profiles, {
      rootActionId,
      eventType: "FictionTimeAdvanced",
      payload: { durationMicros: duration, reason: explanation },
      visibilityPolicyId: "visibility:scene-observers",
      secrecy: "public",
      reads: [`timeline:${accumulator.state.activeBranchId}`],
      writes: [`timeline:${accumulator.state.activeBranchId}`, `receipt:${rootActionId}`],
    });
  }
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "causalActionProgram",
      languageRef: program.languageRef,
      languageHash: program.languageHash,
      programHash: program.semanticHash,
      formRef: program.formRef,
      succeeded: false,
      disposition: "inWorldRefusal",
      nodes: [{
        nodeRef: node.nodeId,
        primitive: node.primitive,
        resolution: "direct",
        succeeded: false,
        branch: "failure",
      }],
    },
  });
}

export function stepCausalActionProgram(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (
    input.kind !== "resolveCompoundActionPlan"
    || input.actionPlanVersion !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef
  ) return undefined;
  if (!causalActionInterpreterEnabled(profiles.extensions)) {
    return rejected("unsupportedOperation", "The pinned runtime manifest has no V3 causal action interpreter.");
  }
  if (
    !hasExactKeys(input, CAUSAL_INPUT_KEYS)
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.actorCharacterId)
    || (input.rootActionId in state.receipts
      && !isContinuedCompoundRoot(input, input.rootActionId))
    || input.actionLanguageHash !== CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash
    || !isRecord(input.causalActionProgram)
  ) return rejected("invalidRulesInput", "The V3 causal action input is not canonical.");
  const validation = validateCausalActionProgram(input.causalActionProgram);
  if (!validation.ok) {
    return rejected("invalidRulesInput", "The V3 causal action program failed its pinned language contract.");
  }
  const program = input.causalActionProgram as unknown as CausalActionProgram;
  if (
    input.actionPlanVersion !== program.languageRef
    || input.actionLanguageHash !== program.languageHash
    || !validateExecutableCausalActionProgram(program)
  ) return rejected("invalidRulesInput", "The V3 causal action program has no legal executable semantics.");
  const actor = state.entities[input.actorCharacterId];
  if (actor?.kind !== "player" || actor.tenureStatus !== "active") {
    return rejected("privateOrUnknownReference", "The causal action actor is unavailable.");
  }
  if (storyWaitsForExplicitContinuation(state)) {
    return rejected(
      "missingPrerequisite",
      "The current story is concluded; only an explicit epilogue choice or sequel may continue.",
    );
  }
  if (!materializationBasisAvailable(state, actor, program)) {
    return rejected(
      "privateOrUnknownReference",
      "The materialization basis is unavailable to the acting character.",
    );
  }

  const firstPrimitive = program.nodes[0].primitive;
  if (firstPrimitive === "requestClarification") return clarification(profiles, state, input, program);
  if (firstPrimitive === "refuseInWorld" || (
    firstPrimitive === "resolveEnvironmentalStunt"
    && program.nodes[0].arguments.featureDisposition === "explicitly-absent"
  )) {
    return inWorldRefusal(profiles, state, input, program);
  }
  if (firstPrimitive === "resolveCombatIntent") return combat(profiles, state, input, program);

  const lowered = lowerCausalActionProgram(program);
  const plan = planFor(actor, program, lowered.steps, input.rootActionId);
  if (plan === undefined || !isCausalActionResolutionPlan(plan)) {
    return rejected("invalidRulesInput", "The causal action duration or frozen continuation is invalid.");
  }
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, input.rootActionId, actor, program);
  const terminal = lowered.steps.at(-1)!;
  if (!appendFrozenCosts(accumulator, profiles, input.rootActionId, actor, terminal)) {
    return rejected("invalidRulesInput", "The frozen causal action cost is unavailable.");
  }

  const requests: RandomnessRequest[] = [];
  const continuations: AuthorityContinuation[] = [];
  for (const step of lowered.steps) {
    if (checkResolution(step) !== "check") continue;
    const check = causalActionExpectedFrozenCheck(profiles, actor, step);
    if (check === undefined) return rejected("invalidRulesInput", "A causal check is not a canonical SRD 5.1 check.");
    append(accumulator, profiles, {
      rootActionId: input.rootActionId,
      resolutionId: `resolution:${input.rootActionId}:causal:${step.nodeRef}`,
      eventType: "CheckFrozen",
      payload: {
        characterId: actor.id,
        checkKind: check.kind === "skill" ? "skill" : "ability",
        ability: check.ability,
        skill: check.skill,
        dc: Number(check.dc),
        mode: check.mode,
        success: { programHash: plan.programHash, nodeRef: step.nodeRef, consequence: check.successOutcome },
        failure: { programHash: plan.programHash, nodeRef: step.nodeRef, consequence: check.failureOutcome },
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: [`entity:${actor.id}`, `fact:${plan.programFactRef}`],
      writes: [`check:${input.rootActionId}:${step.nodeRef}`, `receipt:${input.rootActionId}`],
      creates: [`check:${input.rootActionId}:${step.nodeRef}`],
    });
    const request: RandomnessRequest = {
      randomnessId: `randomness:${input.rootActionId}:causal:${step.nodeRef}`,
      resolutionId: `resolution:${input.rootActionId}:causal:${step.nodeRef}`,
      actorCharacterId: actor.id,
      purpose: "improvisedCheck",
      diceExpression: check.mode === "normal" ? "1d20"
        : check.mode === "advantage" ? "2d20kh1" : "2d20kl1",
      frozenCheck: check,
    };
    const continuation: AuthorityContinuation = {
      kind: "roomAuthorityRandomness",
      continuationId: `continuation:${request.resolutionId}`,
      capability: canonicalSha256({
        kind: "roomAuthorityRandomness",
        roomId: accumulator.state.roomId,
        runtimeEpochId: accumulator.state.runtimeEpochId,
        stateHash: hashWorldState(accumulator.state),
        rootActionId: input.rootActionId,
        request,
        resolutionPlan: plan,
      }),
    };
    append(accumulator, profiles, {
      rootActionId: input.rootActionId,
      resolutionId: request.resolutionId,
      eventType: "RandomnessRequested",
      payload: {
        request,
        continuation,
        purpose: request.purpose,
        formula: request.diceExpression,
        resolutionPlan: plan,
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: [`entity:${actor.id}`, `fact:${plan.programFactRef}`],
      writes: [`continuation:${continuation.continuationId}`, `receipt:${input.rootActionId}`],
      creates: [`continuation:${continuation.continuationId}`],
    });
    requests.push(request);
    continuations.push(continuation);
  }
  if (requests.length === 0) {
    return settleProgram(accumulator, profiles, input.rootActionId, plan, new Map());
  }
  return finished("awaitingRandomness", accumulator, {
    randomnessRequest: requests[0],
    continuation: continuations[0],
    randomnessRequests: requests,
    continuations,
    mechanicalResult: {
      kind: "causalActionProgramPending",
      languageRef: plan.languageRef,
      languageHash: plan.languageHash,
      programHash: plan.programHash,
      checkNodeRefs: plan.checkNodeRefs,
    },
  });
}

function causalEntries(
  state: AuthoritativeWorldState,
  results: readonly CausalRandomnessResult[],
): Array<{
  continuation: AuthorityContinuation;
  rolls: number[];
  plan: CausalActionResolutionPlan;
  request: RandomnessRequest;
}> | undefined {
  const entries = results.flatMap((result) => {
    const stored = state.internalContinuations[result.continuation.continuationId];
    return stored !== undefined
      && stored.continuation.capability === result.continuation.capability
      && stored.resolutionPlan !== undefined
      && isCausalActionResolutionPlan(stored.resolutionPlan)
      ? [{
          continuation: result.continuation,
          rolls: result.rolls,
          plan: stored.resolutionPlan,
          request: stored.request,
        }]
      : [];
  });
  return entries.length === results.length ? entries : undefined;
}

export function fulfillCausalActionProgramRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  rolls: number[],
): StepResult | undefined {
  const stored = state.internalContinuations[continuationId];
  if (stored?.resolutionPlan === undefined || !isCausalActionResolutionPlan(stored.resolutionPlan)) {
    return undefined;
  }
  if (!causalActionInterpreterEnabled(profiles.extensions)) {
    return rejected("profileIntegrityMismatch", "The frozen V3 causal continuation is not enabled by this room manifest.");
  }
  if (stored.resolutionPlan.checkNodeRefs.length !== 1) {
    return rejected("invalidRulesInput", "A multi-check causal program requires its complete authoritative randomness batch.");
  }
  const nodeRef = stored.resolutionPlan.checkNodeRefs[0];
  return settleProgram(
    { state, events: [] },
    profiles,
    stored.rootActionId,
    stored.resolutionPlan,
    new Map([[nodeRef, { rolls, request: stored.request, continuationId }]]),
  );
}

export function fulfillCausalActionProgramRandomnessBatch(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  results: readonly CausalRandomnessResult[],
): StepResult | undefined {
  const entries = causalEntries(state, results);
  if (entries === undefined) return undefined;
  if (!causalActionInterpreterEnabled(profiles.extensions)) {
    return rejected("profileIntegrityMismatch", "The frozen V3 causal continuations are not enabled by this room manifest.");
  }
  if (entries.length === 0) return rejected("invalidRulesInput", "A causal randomness batch cannot be empty.");
  const plan = entries[0].plan;
  const rootActionId = state.internalContinuations[entries[0].continuation.continuationId]?.rootActionId;
  if (
    rootActionId === undefined
    || entries.some((entry) => canonicalSha256(entry.plan) !== canonicalSha256(plan))
    || entries.some((entry) =>
      state.internalContinuations[entry.continuation.continuationId]?.rootActionId !== rootActionId)
  ) return rejected("invalidRulesInput", "Causal randomness results do not share one frozen program and root.");

  const byNode = new Map<string, { rolls: number[]; request: RandomnessRequest; continuationId: string }>();
  for (const entry of entries) {
    const prefix = `resolution:${rootActionId}:causal:`;
    if (!entry.request.resolutionId.startsWith(prefix)) {
      return rejected("invalidRulesInput", "A causal randomness result is not bound to a frozen node.");
    }
    const nodeRef = entry.request.resolutionId.slice(prefix.length);
    if (byNode.has(nodeRef)) return rejected("invalidRulesInput", "A causal check result is duplicated.");
    byNode.set(nodeRef, {
      rolls: entry.rolls,
      request: entry.request,
      continuationId: entry.continuation.continuationId,
    });
  }
  if (
    byNode.size !== plan.checkNodeRefs.length
    || plan.checkNodeRefs.some((nodeRef) => !byNode.has(nodeRef))
  ) return rejected("invalidRulesInput", "The complete frozen causal check batch is required.");
  return settleProgram({ state, events: [] }, profiles, rootActionId, plan, byNode);
}
