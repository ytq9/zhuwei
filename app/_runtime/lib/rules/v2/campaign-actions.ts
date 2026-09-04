import { canonicalSha256 } from "../profiles/canonical";
import {
  compileAbilityDefinition,
  frozenRegisteredAbilityOperation,
  isAbilityDefinitionCandidate,
  registeredAbilityRecord,
} from "../profiles/ability-compiler";
import type { RuntimeProfileManifest } from "../profiles/types";
import { resolveFixedDamage } from "./damage";
import { createEventTransition, createScopeProof } from "./events";
import type {
  AuthoritativeWorldState,
  AuthorityContinuation,
  CompoundActionEffect,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  FrozenCheck,
  InheritanceAuthorization,
  JsonRecord,
  PublicReceipt,
  RandomnessRequest,
  RestHitDiceRandomnessRequest,
  ScopeProof,
  StepResult,
} from "./model";
import { needsKp, rejected } from "./results";
import { canonicalControlledCharacter, partyDepartureEvents } from "./multiplayer-actions";
import {
  buildPlayerCombatEntity,
  planPlayerAbilityCatalog,
  compileStaticCharacterCombat,
  synchronizePlayerCombatEntity,
} from "./character-abilities";
import {
  advanceCharacter2014,
  advancementOptions,
  characterBuildSnapshot,
  classHitDie,
  experienceQualifiesForNextLevel,
  MAX_EXPERIENCE_AWARD,
} from "./character-progression";
import {
  canStartRest,
  canonicalRestRecoveryChoice,
  LONG_REST_MINIMUM_MICROS,
  LONG_REST_BENEFIT_INTERVAL_MICROS,
  resolveRestRecovery,
  SHORT_REST_MINIMUM_MICROS,
  type RestRecoveryChoice,
} from "./character-rest";
import { continueCompoundRoot, isContinuedCompoundRoot } from "./internal-compound";
import { characterTimelineId, completedActivityMovementPlan } from "./timeline";
import { allocateDynamicCombatantSpawn } from "./spatial-spawn";
import {
  savingThrowModifier,
  skillCheckModifier,
  type ProficiencyAbility,
} from "./proficiency";
import {
  actorPlanPremiseIsAvailable,
  actorPlanPremiseScope,
  actorPlanResourceScopes,
  actorPlanResourcesAreAvailable,
  dueActorPlanChildRoot,
  earliestEligibleDueActorPlan,
} from "./actor-plans";
import {
  campaignContinuityManifest,
  type ChapterActivityTransition,
} from "./campaign-continuity";
import {
  NPC_MECHANICAL_TEMPLATE_KIND,
} from "./npc-mechanics";
import {
  isEnvironmentHazardDefinition,
  isEnvironmentHazardDefinitionCandidate,
} from "./environment-hazards";
import {
  createInitialItemEntry,
  compileItemEntryUseAbility,
  isItemDefinitionV1,
  isItemSystemStateV1,
  itemStackIdentity,
  itemUseBaseAbilityDefinition,
  type ItemOwnershipDisposition,
} from "./items";
import {
  acquireItemQuantity,
  deriveCharacterLoadoutFromItems,
  transferItemQuantity,
} from "./item-transitions";
import {
  planPlayerInitialItemImport,
  playerInitialItemEventDrafts,
} from "./player-item-system";
import {
  CANONICAL_UNSIGNED_INTEGER_PATTERN,
  hasExactKeys,
  hasOnlyKeys,
  hashWorldState,
  isNonEmptyString,
  isProfileRef,
  isRecord,
} from "./validation";

type Draft = {
  eventType: EventType;
  payload: EventPayloadByType[EventType];
  visibilityPolicyId?: string;
  secrecy?: EventEnvelope["secrecy"];
  resolutionId?: string;
  reads?: string[];
  writes?: string[];
  creates?: string[];
};

function rootAction(state: AuthoritativeWorldState, input: JsonRecord): string | undefined {
  return isNonEmptyString(input.proposalId)
    && (!(input.proposalId in state.receipts) || isContinuedCompoundRoot(input, input.proposalId))
    ? input.proposalId
    : undefined;
}

function character(state: AuthoritativeWorldState, id: unknown) {
  return isNonEmptyString(id) && state.entities[id]?.tenureStatus === "active"
    ? state.entities[id]
    : undefined;
}

function characterWithItemSystemLoadout(
  characterValue: NonNullable<ReturnType<typeof character>>,
  itemSystem: NonNullable<AuthoritativeWorldState["campaignRuntime"]["itemSystem"]>,
) {
  const derived = deriveCharacterLoadoutFromItems(itemSystem, {
    holderRef: characterValue.id,
    ...(characterValue.classId === undefined ? {} : { classId: characterValue.classId }),
    scores: {
      dex: characterValue.abilityScores?.dex ?? 10,
      con: characterValue.abilityScores?.con ?? 10,
    },
    speedFeet: characterValue.loadout?.speedFeet ?? 30,
  });
  return "error" in derived
    ? undefined
    : { ...structuredClone(characterValue), loadout: derived.loadout };
}

function appendPlayerAbilityRegistrations(
  drafts: Draft[],
  catalog: Record<string, JsonRecord>,
  characterValue: NonNullable<ReturnType<typeof character>>,
  itemSystem: NonNullable<AuthoritativeWorldState["campaignRuntime"]["itemSystem"]>,
): string | undefined {
  if (characterValue.kind !== "player") return undefined;
  const nextCharacter = characterWithItemSystemLoadout(characterValue, itemSystem);
  if (nextCharacter === undefined) return "playerItemLoadoutUnavailable";
  const planned = planPlayerAbilityCatalog({
    character: nextCharacter,
    itemSystem,
    catalog,
  });
  if ("error" in planned) return planned.error;
  for (const artifact of planned.registrations) {
    const definitionId = String(artifact.definition.definitionId);
    drafts.push({
      eventType: "DefinitionRegistered",
      payload: structuredClone(artifact),
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      creates: [`definition:${definitionId}`],
    });
    catalog[definitionId] = registeredAbilityRecord(artifact);
  }
  return undefined;
}

function canonicalStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every(isNonEmptyString) || value.length !== new Set(value).size) {
    return undefined;
  }
  return [...value].sort();
}

const INHERITANCE_SCOPE_BY_KIND = {
  item: "transferPossession",
  knowledge: "acquireExactKnowledge",
  relationship: "establishDerivedRelationship",
  debt: "assumeDebtObligation",
  promise: "assumePromiseObligation",
} as const satisfies Record<InheritanceAuthorization["kind"], InheritanceAuthorization["scope"]>;

function canonicalInheritanceAuthorizations(
  value: unknown,
  predecessorCharacterId: string,
  successorCharacterId: string,
): InheritanceAuthorization[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries: InheritanceAuthorization[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)
      || !hasExactKeys(candidate, [
        "authorizationId",
        "kind",
        "scope",
        "sourceRef",
        "subjectCharacterId",
        "targetCharacterId",
        "targetRef",
      ])
      || ![
        candidate.authorizationId,
        candidate.subjectCharacterId,
        candidate.sourceRef,
        candidate.targetCharacterId,
        candidate.targetRef,
      ].every(isNonEmptyString)
      || !Object.hasOwn(INHERITANCE_SCOPE_BY_KIND, candidate.kind as PropertyKey)
      || INHERITANCE_SCOPE_BY_KIND[candidate.kind as InheritanceAuthorization["kind"]]
        !== candidate.scope
      || candidate.subjectCharacterId !== predecessorCharacterId
      || candidate.targetCharacterId !== successorCharacterId) return undefined;
    entries.push(structuredClone(candidate) as InheritanceAuthorization);
  }
  if (new Set(entries.map(({ authorizationId }) => authorizationId)).size !== entries.length
    || new Set(entries.map(({ kind, targetRef }) => `${kind}:${targetRef}`)).size !== entries.length) {
    return undefined;
  }
  return entries.sort((left, right) => left.authorizationId.localeCompare(right.authorizationId));
}

function inheritanceAuthorizationAvailable(
  state: AuthoritativeWorldState,
  authorization: InheritanceAuthorization,
): boolean {
  switch (authorization.kind) {
    case "item":
      return authorization.targetRef === authorization.sourceRef
        && state.campaignRuntime.itemSystem.entries[authorization.sourceRef]?.disposition === "held"
        && state.campaignRuntime.itemSystem.entries[authorization.sourceRef]?.holderRef
          === authorization.subjectCharacterId;
    case "knowledge":
      return state.knowledge[authorization.subjectCharacterId]?.[authorization.sourceRef] !== undefined
        && state.knowledge[authorization.targetCharacterId]?.[authorization.targetRef] === undefined;
    case "relationship": {
      const relationship = state.campaignRuntime.relationships[authorization.sourceRef];
      return Array.isArray(relationship?.subjectIds)
        && relationship.subjectIds.includes(authorization.subjectCharacterId)
        && relationship.subjectIds.length >= 2
        && state.campaignRuntime.relationships[authorization.targetRef] === undefined;
    }
    case "debt": {
      const debt = state.campaignRuntime.debts[authorization.sourceRef];
      return debt?.debtorId === authorization.subjectCharacterId
        && state.campaignRuntime.debts[authorization.targetRef] === undefined;
    }
    case "promise": {
      const promise = state.campaignRuntime.promises[authorization.sourceRef];
      return promise?.promisorId === authorization.subjectCharacterId
        && state.campaignRuntime.promises[authorization.targetRef] === undefined;
    }
    default:
      return false;
  }
}

function sequence(
  kind: "committed" | "concluded" | "awaitingInput" | "awaitingRandomness",
  profiles: RuntimeProfileManifest,
  source: AuthoritativeWorldState,
  rootActionId: string,
  drafts: Draft[],
  additions: JsonRecord = {},
): StepResult {
  const createdScopes = new Set(drafts.flatMap((draft) => draft.creates ?? []));
  const transactionScopeProof = createScopeProof(
    source,
    drafts.flatMap((draft) => draft.reads ?? [])
      .filter((scope) => !createdScopes.has(scope)),
    drafts.flatMap((draft) => draft.writes ?? [`receipt:${rootActionId}`])
      .filter((scope) => !createdScopes.has(scope)),
    [...createdScopes],
  );
  let state = source;
  const events: EventEnvelope[] = [];
  let receipt: PublicReceipt | undefined;
  for (const draft of drafts) {
    const eventScopeProof = createScopeProof(
      state,
      draft.reads ?? [],
      draft.writes ?? [`receipt:${rootActionId}`],
      draft.creates ?? [],
    );
    const transition = createEventTransition(state, profiles, {
      rootActionId,
      ...(draft.resolutionId === undefined ? {} : { resolutionId: draft.resolutionId }),
      eventType: draft.eventType,
      payload: draft.payload,
      scopeProof: eventScopeProof,
      visibilityPolicyId: draft.visibilityPolicyId ?? "visibility:public",
      secrecy: draft.secrecy ?? "public",
    });
    events.push(transition.event);
    state = transition.state;
    receipt = transition.receipt;
  }
  return {
    kind,
    events,
    state,
    cache: state,
    stateHash: events[events.length - 1].stateHashAfter,
    scopeProof: transactionScopeProof,
    receipt: {
      ...receipt!,
      eventRange: {
        fromEventSeq: events[0].eventSeq,
        toEventSeq: events[events.length - 1].eventSeq,
      },
      scopeProofHash: transactionScopeProof.proofHash,
    },
    ...additions,
  } as StepResult;
}

function combineCommittedTransitions(
  source: AuthoritativeWorldState,
  first: Extract<StepResult, { kind: "committed" }>,
  second: Extract<StepResult, { kind: "committed" }>,
): StepResult {
  const creates = [...new Set([...first.scopeProof.creates, ...second.scopeProof.creates])];
  const created = new Set(creates);
  const scopeProof = createScopeProof(
    source,
    [...first.scopeProof.reads, ...second.scopeProof.reads]
      .filter((scope) => !created.has(scope)),
    [...first.scopeProof.writes, ...second.scopeProof.writes]
      .filter((scope) => !created.has(scope)),
    creates,
  );
  const events = [...first.events, ...second.events];
  return {
    ...second,
    events,
    scopeProof,
    receipt: {
      ...second.receipt,
      eventRange: {
        fromEventSeq: events[0].eventSeq,
        toEventSeq: events[events.length - 1].eventSeq,
      },
      scopeProofHash: scopeProof.proofHash,
    },
  };
}

const ABILITY_NAMES: Record<string, FrozenCheck["ability"]> = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

function frozenCheck(
  profiles: RuntimeProfileManifest,
  value: unknown,
  goal: string,
  method: string,
  actor?: AuthoritativeWorldState["entities"][string],
  risk = "存在有意义失败后果",
  savingThrow = false,
): { requestCheck: FrozenCheck; publicCheck: EventPayloadByType["CheckFrozen"] } | undefined {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["ability", "dc", "kind", "mode"], ["failure", "skill", "success"])
    || (value.kind !== "ability" && value.kind !== "skill")
    || !isNonEmptyString(value.ability)
    || ABILITY_NAMES[value.ability] === undefined
    || !Number.isSafeInteger(value.dc)
    || Number(value.dc) < 0
    || !["normal", "advantage", "disadvantage"].includes(String(value.mode))
    || !(value.skill === undefined || value.skill === null || isNonEmptyString(value.skill))
  ) {
    return undefined;
  }
  const success = isRecord(value.success) ? structuredClone(value.success) : { publicResult: "成功" };
  const failure = isRecord(value.failure) ? structuredClone(value.failure) : { publicResult: "失败" };
  const modifier = actor === undefined
    ? 0
    : (savingThrow
        ? savingThrowModifier(profiles, actor, value.ability as ProficiencyAbility)
        : skillCheckModifier(
            profiles,
            actor,
            value.ability as ProficiencyAbility,
            typeof value.skill === "string" ? value.skill : null,
          )) ?? 0;
  return {
    requestCheck: {
      kind: value.kind,
      ability: ABILITY_NAMES[value.ability],
      skill: typeof value.skill === "string" ? value.skill : null,
      dc: String(value.dc),
      modifier: String(modifier),
      mode: value.mode as FrozenCheck["mode"],
      goal,
      method,
      risk,
      successOutcome: isNonEmptyString(success.publicResult) ? success.publicResult : "成功",
      failureOutcome: isNonEmptyString(failure.publicResult) ? failure.publicResult : "失败",
      costs: [],
    },
    publicCheck: {
      characterId: "",
      checkKind: value.kind,
      ability: value.ability,
      skill: typeof value.skill === "string" ? value.skill : null,
      dc: Number(value.dc),
      mode: value.mode as FrozenCheck["mode"],
      success,
      failure,
    },
  };
}

function randomness(
  state: AuthoritativeWorldState,
  rootActionId: string,
  actorCharacterId: string,
  purpose: Exclude<RandomnessRequest["purpose"], "restHitDice" | "hiddenRealitySelection">,
  check: FrozenCheck,
  suffix: string,
): { request: RandomnessRequest; continuation: AuthorityContinuation; draft: Draft } {
  const formula = check.mode === "normal" ? "1d20" : check.mode === "advantage" ? "2d20kh1" : "2d20kl1";
  const resolutionId = `resolution:${rootActionId}:${suffix}`;
  const request: RandomnessRequest = {
    randomnessId: `randomness:${rootActionId}:${suffix}`,
    resolutionId,
    actorCharacterId,
    purpose,
    diceExpression: formula,
    frozenCheck: check,
  };
  const continuation: AuthorityContinuation = {
    kind: "roomAuthorityRandomness",
    continuationId: `continuation:${resolutionId}`,
    capability: canonicalSha256({
      kind: "roomAuthorityRandomness",
      roomId: state.roomId,
      runtimeEpochId: state.runtimeEpochId,
      stateHash: hashWorldState(state),
      rootActionId,
      request,
    }),
  };
  return {
    request,
    continuation,
    draft: {
      eventType: "RandomnessRequested",
      payload: { request, continuation, purpose, formula },
      resolutionId,
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      writes: [`continuation:${continuation.continuationId}`, `receipt:${rootActionId}`],
      creates: [`continuation:${continuation.continuationId}`],
    },
  };
}

function resolveFreeAction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasOnlyKeys(input, ["characterId", "feasibility", "goal", "kind", "method", "proposalId"], [
    "acceptedCost", "check", "methodFingerprint", "outcome", "retryOfGoalId",
  ])) return rejected("invalidRulesInput", "Free action input has missing or additional fields.");
  const root = rootAction(state, input);
  const actor = character(state, input.characterId);
  if (root === undefined || actor === undefined || !isNonEmptyString(input.goal) || !isNonEmptyString(input.method) || !isRecord(input.feasibility)) {
    return rejected("privateOrUnknownReference", "The free action reference is unavailable.");
  }
  if (isNonEmptyString(input.retryOfGoalId)) {
    const failure = state.campaignRuntime.meaningfulFailures[input.retryOfGoalId];
    if (
      failure !== undefined
      && failure.methodFingerprint === input.methodFingerprint
      && state.campaignRuntime.retryChanges[input.retryOfGoalId] === undefined
    ) return rejected("unchangedRetry", "An unchanged failed method cannot be rerolled.");
  }
  const publicBasis = input.feasibility.publicBasis;
  if (!isNonEmptyString(publicBasis)) return rejected("invalidRulesInput", "Feasibility requires a public basis.");
  if (input.feasibility.kind === "missingPrerequisite") {
    return rejected("missingPrerequisite", publicBasis);
  }
  if (input.feasibility.kind === "worldLawViolation") {
    return rejected("worldLawViolation", publicBasis);
  }
  if (input.feasibility.kind === "clarificationRequired") {
    if (!hasExactKeys(input.feasibility, ["choices", "kind", "publicBasis"])
      || !Array.isArray(input.feasibility.choices)
      || input.feasibility.choices.length < 2
      || !input.feasibility.choices.every((choice) => isRecord(choice)
        && hasExactKeys(choice, ["choiceId", "label"])
        && isNonEmptyString(choice.choiceId) && isNonEmptyString(choice.label))) {
      return rejected("invalidRulesInput", "Clarification requires canonical choices.");
    }
    const pendingInputId = `pending:${root}`;
    const question = input.feasibility.choices.map((choice) => `${choice.choiceId}:${choice.label}`).join("；");
    return sequence("awaitingInput", profiles, state, root, [{
      eventType: "ClarificationRequested",
      payload: { actorCharacterId: actor.id, pendingInputId, question },
      visibilityPolicyId: `visibility:character-controller:${actor.id}`,
      secrecy: "private",
    }], {
      pending: {
        pendingInputId,
        kind: "clarification",
        question,
        controller: { kind: "character", characterId: actor.id },
      },
    });
  }
  if (!["directSuccess", "checkRequired", "highRiskFeasible"].includes(String(input.feasibility.kind))) {
    return rejected("invalidRulesInput", "Unknown feasibility ruling.");
  }
  const drafts: Draft[] = [{
    eventType: "FeasibilityRuled",
    payload: {
      characterId: actor.id,
      goal: input.goal,
      method: input.method,
      feasibilityKind: input.feasibility.kind as "directSuccess" | "checkRequired" | "highRiskFeasible",
      publicBasis,
    },
  }];
  if (input.feasibility.kind === "directSuccess") {
    if (isRecord(input.outcome) && typeof input.outcome.fictionTimeCostMicros === "string"
      && /^[1-9][0-9]*$/.test(input.outcome.fictionTimeCostMicros)) {
      drafts.push({
        eventType: "FictionTimeAdvanced",
        payload: { durationMicros: input.outcome.fictionTimeCostMicros, reason: input.goal },
      });
    }
    return sequence("committed", profiles, state, root, drafts);
  }
  const frozen = frozenCheck(profiles, input.check, input.goal, input.method, actor, publicBasis);
  if (frozen === undefined) return rejected("invalidRulesInput", "Check parameters must be frozen before randomness.");
  if (input.feasibility.kind === "highRiskFeasible") {
    if (!isRecord(input.acceptedCost)
      || !hasExactKeys(input.acceptedCost, ["amount", "resourceId"])
      || !isNonEmptyString(input.acceptedCost.resourceId)
      || !Number.isSafeInteger(input.acceptedCost.amount)
      || Number(input.acceptedCost.amount) <= 0
      || (actor.resources?.[input.acceptedCost.resourceId] ?? 0) < Number(input.acceptedCost.amount)) {
      return rejected("insufficientResource", "Accepted high-risk cost is unavailable.");
    }
    drafts.push({
      eventType: "ResourceReserved",
      payload: {
        characterId: actor.id,
        resourceId: input.acceptedCost.resourceId,
        amount: Number(input.acceptedCost.amount),
        purpose: input.goal,
      },
      reads: [`resource:${actor.id}:${input.acceptedCost.resourceId as string}`],
      writes: [`resource:${actor.id}:${input.acceptedCost.resourceId as string}`],
    });
  }
  drafts.push({
    eventType: "CheckFrozen",
    payload: { ...frozen.publicCheck, characterId: actor.id },
  });
  const random = randomness(state, root, actor.id, "abilityCheck", frozen.requestCheck, "check");
  drafts.push(random.draft);
  return sequence("awaitingRandomness", profiles, state, root, drafts, {
    randomnessRequest: random.request,
    continuation: random.continuation,
    randomnessRequests: [random.request],
    continuations: [random.continuation],
  });
}

function resolveContest(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["defenderCheck", "defenderId", "initiatorCheck", "initiatorId", "kind", "proposalId", "tieResult"])) {
    return rejected("invalidRulesInput", "Contest input is not canonical.");
  }
  const root = rootAction(state, input);
  const initiator = character(state, input.initiatorId);
  const defender = character(state, input.defenderId);
  const left = frozenCheck(
    profiles,
    { ...(isRecord(input.initiatorCheck) ? input.initiatorCheck : {}), kind: "skill", dc: 0 },
    "对抗",
    "发起对抗",
    initiator,
  );
  const right = frozenCheck(
    profiles,
    { ...(isRecord(input.defenderCheck) ? input.defenderCheck : {}), kind: "skill", dc: 0 },
    "对抗",
    "回应对抗",
    defender,
  );
  if (root === undefined || initiator === undefined || defender === undefined || left === undefined || right === undefined || !isNonEmptyString(input.tieResult)) {
    return rejected("invalidRulesInput", "Contest participants or checks are unavailable.");
  }
  const first = randomness(state, root, initiator.id, "contestCheck", left.requestCheck, "initiator");
  const second = randomness(state, root, defender.id, "contestCheck", right.requestCheck, "defender");
  const resolutionPlan = {
    schema: "zhuwei.contest-resolution-plan/v1" as const,
    initiatorId: initiator.id,
    defenderId: defender.id,
    tieResult: input.tieResult as string,
  };
  first.draft.payload = { ...first.draft.payload, resolutionPlan };
  second.draft.payload = { ...second.draft.payload, resolutionPlan };
  return sequence("awaitingRandomness", profiles, state, root, [
    { eventType: "ContestFrozen", payload: { initiatorId: initiator.id, defenderId: defender.id, initiatorCheck: structuredClone(input.initiatorCheck as JsonRecord), defenderCheck: structuredClone(input.defenderCheck as JsonRecord), tieResult: input.tieResult } },
    first.draft,
    second.draft,
  ], {
    randomnessRequest: first.request,
    continuation: first.continuation,
    randomnessRequests: [first.request, second.request],
    continuations: [first.continuation, second.continuation],
  });
}

function resolveSavingThrow(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["ability", "dc", "failure", "kind", "proposalId", "sourceDefinitionId", "success", "targetId"])) {
    return rejected("invalidRulesInput", "Saving throw input is not canonical.");
  }
  const root = rootAction(state, input);
  const target = character(state, input.targetId);
  const frozen = frozenCheck(
    profiles,
    { kind: "ability", ability: input.ability, dc: input.dc, mode: "normal", success: input.success, failure: input.failure },
    "抵抗危险",
    String(input.sourceDefinitionId),
    target,
    "存在有意义失败后果",
    true,
  );
  if (root === undefined || target === undefined || frozen === undefined || !isNonEmptyString(input.sourceDefinitionId)) {
    return rejected("invalidRulesInput", "Saving throw target or parameters are unavailable.");
  }
  frozen.requestCheck.kind = "savingThrow";
  const random = randomness(state, root, target.id, "savingThrow", frozen.requestCheck, "save");
  return sequence("awaitingRandomness", profiles, state, root, [
    { eventType: "SaveFrozen", payload: { targetId: target.id, sourceDefinitionId: input.sourceDefinitionId, ability: String(input.ability), dc: Number(input.dc), success: structuredClone(input.success as JsonRecord), failure: structuredClone(input.failure as JsonRecord) } },
    random.draft,
  ], { randomnessRequest: random.request, continuation: random.continuation, randomnessRequests: [random.request], continuations: [random.continuation] });
}

function useResource(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["amount", "characterId", "kind", "proposalId", "purpose", "resourceId"])) return rejected("invalidRulesInput", "Resource input is not canonical.");
  const root = rootAction(state, input); const actor = character(state, input.characterId);
  if (root === undefined || actor === undefined || !isNonEmptyString(input.resourceId) || !isNonEmptyString(input.purpose) || !Number.isSafeInteger(input.amount) || Number(input.amount) <= 0 || (actor.resources?.[input.resourceId] ?? 0) < Number(input.amount)) return rejected("insufficientResource", "Resource is unavailable.");
  const resourceScope = `resource:${actor.id}:${input.resourceId as string}`;
  return sequence("committed", profiles, state, root, [{
    eventType: "ResourceUsed",
    payload: {
      characterId: actor.id,
      resourceId: input.resourceId,
      amount: Number(input.amount),
      purpose: input.purpose,
    },
    reads: [resourceScope],
    writes: [resourceScope],
  }]);
}

function changeResource(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["characterId", "delta", "kind", "proposalId", "reason", "resourceId"])) {
    return rejected("invalidRulesInput", "Resource change input is not canonical.");
  }
  const root = rootAction(state, input);
  const actor = character(state, input.characterId);
  if (
    root === undefined
    || actor === undefined
    || !isNonEmptyString(input.resourceId)
    || !isNonEmptyString(input.reason)
    || !Number.isSafeInteger(input.delta)
    || Number(input.delta) === 0
  ) return rejected("invalidRulesInput", "Resource change parameters are unavailable.");
  const before = actor.resources?.[input.resourceId] ?? 0;
  const after = before + Number(input.delta);
  const combatEntity = state.combatRuntime.entities[actor.id];
  let combatPool: JsonRecord | undefined;
  if (isRecord(combatEntity)
    && isNonEmptyString(combatEntity.mechanicalDefinitionRef)
    && isRecord(combatEntity.resources)) {
    const candidate = combatEntity.resources[input.resourceId as string];
    if (isRecord(candidate)) combatPool = candidate;
  }
  if (after < 0 || (combatPool !== undefined && after > Number(combatPool.maximum))) {
    return rejected("insufficientResource", "Resource change would exceed its frozen bounds.");
  }
  return sequence("committed", profiles, state, root, [{
    eventType: "ResourceChanged",
    payload: {
      characterId: actor.id,
      resourceId: input.resourceId,
      before,
      after,
      delta: Number(input.delta),
      reason: input.reason,
    },
    reads: [`resource:${actor.id}:${input.resourceId as string}`],
    writes: [`resource:${actor.id}:${input.resourceId as string}`],
  }]);
}

/** Rules-internal scene placement for one already-derived narrative object.
 * The non-enumerable continued-root marker keeps this out of public action
 * inputs while exact JSON keys keep the semantic payload closed. */
function materializeSceneItem(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
      "definition",
      "entryId",
      "kind",
      "proposalId",
      "quantity",
      "sceneId",
    ])) {
    return rejected("invalidRulesInput", "Internal scene item materialization is not canonical.");
  }
  const proposalId = isNonEmptyString(input.proposalId) ? input.proposalId : undefined;
  const root = rootAction(state, input);
  const itemSystem = state.campaignRuntime.itemSystem;
  const definition = input.definition;
  if (proposalId === undefined
    || !isContinuedCompoundRoot(input, proposalId)
    || root === undefined
    || itemSystem === undefined
    || !isNonEmptyString(input.entryId)
    || !isNonEmptyString(input.sceneId)
    || !Number.isSafeInteger(input.quantity)
    || Number(input.quantity) <= 0
    || Number(input.quantity) > 1_000_000
    || !isItemDefinitionV1(definition)) {
    return rejected("invalidRulesInput", "Internal scene item materialization is not canonical.");
  }
  if (state.scenes[input.sceneId] === undefined
    || definition.causalBasisRefs.some((factRef) => state.canonicalFacts[factRef] === undefined)
    || itemSystem.entries[input.entryId] !== undefined) {
    return rejected(
      "privateOrUnknownReference",
      "The scene, causal basis, or item entry identity is unavailable.",
    );
  }
  const productRulesProfile = definition.rulesBasis === "srd5.1-2014"
    ? undefined
    : definition.rulesBasis.profileRef;
  if (productRulesProfile !== undefined
    && !profiles.extensions.some((extension) =>
      extension.profileId === productRulesProfile.profileId
      && extension.profileHash === productRulesProfile.profileHash)) {
    return rejected(
      "unsupportedRulesBasis",
      "The item definition cites an unavailable product ruling.",
    );
  }
  if (definition.content.category !== "object"
    || definition.content.equipment !== null
    || definition.content.use !== null
    || definition.content.equippedAbilityRefs.length !== 0) {
    return rejected(
      "unsupportedOperation",
      "Internal scene materialization currently supports narrative objects only.",
    );
  }
  if (!definition.content.stackable && Number(input.quantity) !== 1) {
    return rejected(
      "unsupportedOperation",
      "A non-stackable scene object must materialize as one exact entry.",
    );
  }
  const existingDefinition = itemSystem.definitions[definition.definitionId];
  if (existingDefinition !== undefined
    && canonicalSha256(existingDefinition) !== canonicalSha256(definition)) {
    return rejected("invalidRulesInput", "The item definition identity is already frozen differently.");
  }

  let entry;
  try {
    entry = createInitialItemEntry(definition, {
      entryId: input.entryId,
      quantity: Number(input.quantity),
      placement: { kind: "scene", sceneRef: input.sceneId },
      ownership: { kind: "unowned", ownerRef: null },
    });
  } catch {
    return rejected("invalidRulesInput", "The scene item entry does not match its definition.");
  }
  const candidateItemSystem = structuredClone(itemSystem);
  if (existingDefinition === undefined) {
    candidateItemSystem.definitions[definition.definitionId] = structuredClone(definition);
  }
  candidateItemSystem.entries[entry.entryId] = structuredClone(entry);
  if (!isItemSystemStateV1(candidateItemSystem)) {
    return rejected("invalidWorldState", "The scene item would conflict with the unified item system.");
  }

  const drafts: Draft[] = [];
  if (existingDefinition === undefined) {
    drafts.push({
      eventType: "ItemDefinitionRegistered",
      payload: { definition: structuredClone(definition) },
      visibilityPolicyId: definition.visibilityPolicyRef,
      secrecy: definition.visibilityPolicyRef === "visibility:public" ? "public" : "internal",
      reads: definition.causalBasisRefs.map((factRef) => `fact:${factRef}`),
      creates: [`item-definition:${definition.definitionId}`],
    });
  }
  drafts.push({
    eventType: "ItemMaterialized",
    payload: { entry },
    visibilityPolicyId: entry.visibilityPolicyRef,
    secrecy: entry.visibilityPolicyRef === "visibility:public" ? "public" : "internal",
    reads: [`scene:${input.sceneId}`, `item-definition:${definition.definitionId}`],
    creates: [`item-entry:${entry.entryId}`],
  });
  return sequence("committed", profiles, state, root, drafts);
}

function materializeItem(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
      "actorCharacterId",
      "definition",
      "entryId",
      "kind",
      "proposalId",
      "quantity",
      "sceneId",
    ])) {
    return rejected("invalidRulesInput", "Item materialization input is not canonical.");
  }
  const root = rootAction(state, input);
  const actor = character(state, input.actorCharacterId);
  const itemSystem = state.campaignRuntime.itemSystem;
  const definition = input.definition;
  if (root === undefined
    || actor === undefined
    || itemSystem === undefined
    || !isNonEmptyString(input.entryId)
    || !isNonEmptyString(input.sceneId)
    || actor.sceneId !== input.sceneId
    || state.scenes[input.sceneId] === undefined
    || !Number.isSafeInteger(input.quantity)
    || Number(input.quantity) <= 0
    || Number(input.quantity) > 1_000_000
    || !isItemDefinitionV1(definition)
    || definition.causalBasisRefs.some((factRef) => state.canonicalFacts[factRef] === undefined)
    || itemSystem.entries[input.entryId] !== undefined) {
    return rejected(
      "privateOrUnknownReference",
      "The item definition, scene, or entry identity is unavailable.",
    );
  }
  const productRulesProfile = definition.rulesBasis === "srd5.1-2014"
    ? undefined
    : definition.rulesBasis.profileRef;
  if (productRulesProfile !== undefined
    && !profiles.extensions.some((extension) =>
      extension.profileId === productRulesProfile.profileId
      && extension.profileHash === productRulesProfile.profileHash)) {
    return rejected("unsupportedRulesBasis", "The item definition cites an unavailable product ruling.");
  }
  if (!definition.content.stackable && input.quantity !== 1) {
    return rejected(
      "unsupportedOperation",
      "A non-stackable item must materialize as one exact entry.",
    );
  }
  const existingDefinition = itemSystem.definitions[definition.definitionId];
  if (existingDefinition !== undefined
    && canonicalSha256(existingDefinition) !== canonicalSha256(definition)) {
    return rejected("invalidRulesInput", "The item definition identity is already frozen differently.");
  }

  let entry;
  try {
    entry = createInitialItemEntry(definition, {
      entryId: input.entryId,
      quantity: Number(input.quantity),
      placement: { kind: "scene", sceneRef: input.sceneId },
      ownership: { kind: "unowned", ownerRef: null },
    });
  } catch {
    return rejected("invalidRulesInput", "The item entry does not match its frozen definition.");
  }

  const drafts: Draft[] = [];
  const plannedAbilityCatalog = structuredClone(state.combatRuntime.definitions);
  if (existingDefinition === undefined) {
    drafts.push({
      eventType: "ItemDefinitionRegistered",
      payload: { definition: structuredClone(definition) },
      visibilityPolicyId: definition.visibilityPolicyRef,
      secrecy: definition.visibilityPolicyRef === "visibility:public" ? "public" : "internal",
      creates: [`item-definition:${definition.definitionId}`],
    });
  }
  if (definition.content.use !== null) {
    const baseAbility = itemUseBaseAbilityDefinition(definition, plannedAbilityCatalog);
    if (baseAbility === undefined) {
      return rejected(
        "unsupportedOperation",
        "The item use ability is not frozen in the current catalog.",
      );
    }
    let ability;
    try {
      ability = compileItemEntryUseAbility(definition, entry.entryId, baseAbility);
    } catch {
      return rejected("invalidAbilityDefinition", "The item use ability cannot be compiled.");
    }
    const abilityId = ability.definition.definitionId;
    if (!isNonEmptyString(abilityId)
      || state.campaignRuntime.definitions[abilityId] !== undefined
      || state.combatRuntime.definitions[abilityId] !== undefined) {
      return rejected("invalidRulesInput", "The item ability identity is already registered.");
    }
    drafts.push({
      eventType: "DefinitionRegistered",
      payload: structuredClone(ability),
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      creates: [`definition:${abilityId}`],
    });
    plannedAbilityCatalog[abilityId] = registeredAbilityRecord(ability);
  }
  const beforeAcquisition = structuredClone(itemSystem);
  beforeAcquisition.definitions[definition.definitionId] = structuredClone(definition);
  beforeAcquisition.entries[entry.entryId] = structuredClone(entry);
  const acquired = acquireItemQuantity(beforeAcquisition, {
    entryId: entry.entryId,
    holderRef: actor.id,
    quantity: entry.quantity,
  });
  if ("error" in acquired) {
    return rejected("invalidWorldState", "The materialized item cannot enter the actor inventory.");
  }
  const abilityPlanError = appendPlayerAbilityRegistrations(
    drafts,
    plannedAbilityCatalog,
    actor,
    acquired.itemSystem,
  );
  if (abilityPlanError !== undefined) {
    return rejected(
      "invalidWorldState",
      "The acquired item ability closure cannot be frozen.",
    );
  }
  drafts.push({
    eventType: "ItemMaterialized",
    payload: { entry },
    visibilityPolicyId: entry.visibilityPolicyRef,
    secrecy: entry.visibilityPolicyRef === "visibility:public" ? "public" : "internal",
    reads: [`scene:${input.sceneId}`, `entity:${actor.id}`],
    creates: [`item-entry:${entry.entryId}`],
  }, {
    eventType: "ItemAcquired",
    payload: {
      entryId: entry.entryId,
      characterId: actor.id,
      fromSceneId: input.sceneId,
    },
    visibilityPolicyId: `visibility:character-controller:${actor.id}`,
    secrecy: "private",
    reads: [`item-entry:${entry.entryId}`, `entity:${actor.id}`],
    writes: [`item-entry:${entry.entryId}`, `entity:${actor.id}`, `combat-entity:${actor.id}`],
  });
  return sequence("committed", profiles, state, root, drafts);
}

function itemTransferTargetEntryId(
  state: AuthoritativeWorldState,
  rootActionId: string,
  entryId: string,
  toCharacterId: string,
  quantity: number,
  ownershipDisposition: ItemOwnershipDisposition,
): string | undefined {
  const itemSystem = state.campaignRuntime.itemSystem;
  const source = itemSystem?.entries[entryId];
  const definition = source === undefined
    ? undefined
    : itemSystem?.definitions[source.definitionRef];
  if (itemSystem === undefined || source === undefined || definition === undefined) return undefined;
  if (!definition.content.stackable) {
    return quantity === source.quantity ? source.entryId : undefined;
  }
  const targetOwnership = ownershipDisposition === "transferToRecipient"
    ? { kind: "character" as const, ownerRef: toCharacterId }
    : structuredClone(source.ownership);
  const targetIdentity = itemStackIdentity({
    ...structuredClone(source),
    disposition: "held",
    holderRef: toCharacterId,
    sceneRef: null,
    equippedSlot: null,
    ownership: targetOwnership,
    visibilityPolicyRef: `visibility:character-controller:${toCharacterId}`,
  });
  const targetStacks = Object.values(itemSystem.entries).filter((candidate) =>
    candidate.entryId !== source.entryId
    && candidate.disposition === "held"
    && candidate.holderRef === toCharacterId
    && candidate.definitionRef === source.definitionRef
    && candidate.definitionRevision === source.definitionRevision
    && itemStackIdentity(candidate) === targetIdentity);
  if (targetStacks.length > 1) return undefined;
  if (targetStacks.length === 1) return targetStacks[0].entryId;
  if (quantity === source.quantity) return source.entryId;
  return `item-entry:transfer:${canonicalSha256({ entryId, rootActionId, toCharacterId })}`;
}

function transferItem(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
      "fromCharacterId",
      "itemId",
      "kind",
      "method",
      "ownershipDisposition",
      "proposalId",
      "quantity",
      "toCharacterId",
    ])) return rejected("invalidRulesInput", "Item transfer input is not canonical.");
    const root = rootAction(state, input);
    const from = character(state, input.fromCharacterId);
    const to = character(state, input.toCharacterId);
    const itemSystem = state.campaignRuntime.itemSystem;
    const entry = isNonEmptyString(input.itemId)
      ? itemSystem.entries[input.itemId]
      : undefined;
    const definition = entry === undefined
      ? undefined
      : itemSystem.definitions[entry.definitionRef];
    const quantity = Number(input.quantity);
    const activeEncounter = [from?.id, to?.id].some((characterId) => characterId !== undefined
      && Object.values(state.combatRuntime.encounters).some((encounter) =>
        encounter.status !== "concluded"
        && Array.isArray(encounter.participantEntityIds)
        && encounter.participantEntityIds.includes(characterId)));
    if (root === undefined
      || from === undefined
      || to === undefined
      || from.id === to.id
      || from.sceneId !== to.sceneId
      || from.loadout === undefined
      || to.loadout === undefined
      || !isNonEmptyString(input.itemId)
      || !isNonEmptyString(input.method)
      || !["preserve", "transferToRecipient"].includes(String(input.ownershipDisposition))
      || !Number.isSafeInteger(input.quantity)
      || quantity <= 0
      || entry === undefined
      || definition === undefined
      || definition.revision !== entry.definitionRevision
      || entry.disposition !== "held"
      || entry.holderRef !== from.id
      || (entry.equippedSlot !== null && entry.equippedSlot !== "ammo")
      || activeEncounter) {
      return rejected(
        activeEncounter ? "pendingInputUnresolved" : "privateOrUnknownReference",
        "The item cannot be transferred between these authoritative inventories.",
      );
    }
    const ownershipDisposition = input.ownershipDisposition as ItemOwnershipDisposition;
    const targetItemId = itemTransferTargetEntryId(
      state,
      root,
      entry.entryId,
      to.id,
      quantity,
      ownershipDisposition,
    );
    if (targetItemId === undefined) {
      return rejected("invalidWorldState", "The target inventory contains conflicting item stacks.");
    }
    const transition = transferItemQuantity(itemSystem, {
      entryId: entry.entryId,
      fromHolderRef: from.id,
      toHolderRef: to.id,
      quantity,
      targetEntryId: targetItemId,
      ownershipDisposition,
    });
    if ("error" in transition || transition.targetEntryId !== targetItemId) {
      return rejected("privateOrUnknownReference", "The requested item quantity is unavailable.");
    }
    const drafts: Draft[] = [];
    const plannedAbilityCatalog = structuredClone(state.combatRuntime.definitions);
    if (definition.content.use !== null
      && targetItemId !== entry.entryId
      && itemSystem.entries[targetItemId] === undefined) {
      const baseAbility = itemUseBaseAbilityDefinition(definition, plannedAbilityCatalog);
      if (baseAbility === undefined) {
        return rejected("invalidWorldState", "The transferred item use ability is not frozen.");
      }
      let targetAbility;
      try {
        targetAbility = compileItemEntryUseAbility(definition, targetItemId, baseAbility);
      } catch {
        return rejected("invalidAbilityDefinition", "The transferred item use ability cannot be compiled.");
      }
      const targetAbilityId = targetAbility.definition.definitionId;
      if (!isNonEmptyString(targetAbilityId)
        || state.campaignRuntime.definitions[targetAbilityId] !== undefined
        || state.combatRuntime.definitions[targetAbilityId] !== undefined) {
        return rejected("invalidRulesInput", "The transferred item ability identity is already registered.");
      }
      drafts.push({
        eventType: "DefinitionRegistered",
        payload: structuredClone(targetAbility),
        visibilityPolicyId: "visibility:room-authority-only",
        secrecy: "internal",
        creates: [`definition:${targetAbilityId}`],
      });
      plannedAbilityCatalog[targetAbilityId] = registeredAbilityRecord(targetAbility);
    }
    for (const participant of [from, to].sort((left, right) => left.id.localeCompare(right.id))) {
      const abilityPlanError = appendPlayerAbilityRegistrations(
        drafts,
        plannedAbilityCatalog,
        participant,
        transition.itemSystem,
      );
      if (abilityPlanError !== undefined) {
        return rejected(
          "invalidWorldState",
          "The transferred item ability closure cannot be frozen.",
        );
      }
    }
    drafts.push({
      eventType: "ItemTransferred",
      payload: {
        fromCharacterId: from.id,
        toCharacterId: to.id,
        itemId: entry.entryId,
        targetItemId,
        quantity,
        method: input.method,
        ownershipDisposition,
      },
      visibilityPolicyId: "visibility:scene-observers",
      reads: [`item-entry:${entry.entryId}`, `entity:${from.id}`, `entity:${to.id}`],
      writes: [
        `item-entry:${entry.entryId}`,
        `item-entry:${targetItemId}`,
        `entity:${from.id}`,
        `entity:${to.id}`,
        `combat-entity:${from.id}`,
        `combat-entity:${to.id}`,
      ],
    });
    return sequence("committed", profiles, state, root, drafts);
}

function acquireItem(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, ["characterId", "itemId", "kind", "proposalId"])) {
    return rejected("invalidRulesInput", "Item acquisition input is not canonical.");
  }
  const root = rootAction(state, input);
  const actor = character(state, input.characterId);
  const itemSystem = state.campaignRuntime.itemSystem;
  const entry = isNonEmptyString(input.itemId)
    ? itemSystem.entries[input.itemId]
    : undefined;
  const definition = entry === undefined
    ? undefined
    : itemSystem.definitions[entry.definitionRef];
  if (
    root === undefined
    || actor === undefined
    || actor.loadout === undefined
    || entry?.disposition !== "scene"
    || entry.sceneRef !== actor.sceneId
    || definition?.revision !== entry.definitionRevision
  ) return rejected("privateOrUnknownReference", "Item reference is unavailable.");
  const transition = acquireItemQuantity(itemSystem, {
    entryId: entry.entryId,
    holderRef: actor.id,
    quantity: entry.quantity,
  });
  if ("error" in transition) {
    return rejected("privateOrUnknownReference", "Item reference is unavailable.");
  }
  const drafts: Draft[] = [];
  const abilityError = appendPlayerAbilityRegistrations(
    drafts,
    structuredClone(state.combatRuntime.definitions),
    actor,
    transition.itemSystem,
  );
  if (abilityError !== undefined) {
    return rejected("invalidWorldState", "The acquired item ability closure cannot be frozen.");
  }
  drafts.push({
    eventType: "ItemAcquired",
    payload: {
      entryId: entry.entryId,
      characterId: actor.id,
      fromSceneId: actor.sceneId,
    },
    visibilityPolicyId: entry.visibilityPolicyRef,
    secrecy: entry.visibilityPolicyRef.startsWith("visibility:public") ? "public" : "private",
  });
  return sequence("committed", profiles, state, root, drafts);
}

function startRest(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasOnlyKeys(
    input,
    ["characterId", "kind", "proposalId", "restKind"],
    [
      "arcaneRecoverySlotLevels",
      "hitDiceToSpend",
      "intendedDurationMicros",
      "memberCharacterIds",
    ],
  )) return rejected("invalidRulesInput", "Rest input is not canonical.");
  const root = rootAction(state, input); const actor = character(state, input.characterId);
  const restKind = ["short", "long"].includes(String(input.restKind))
    ? input.restKind as "short" | "long"
    : undefined;
  const intendedDurationMicros = input.intendedDurationMicros === undefined
    ? restKind === "short"
      ? SHORT_REST_MINIMUM_MICROS
      : restKind === "long" ? LONG_REST_MINIMUM_MICROS : undefined
    : typeof input.intendedDurationMicros === "string"
        && /^[1-9][0-9]*$/.test(input.intendedDurationMicros)
      ? BigInt(input.intendedDurationMicros)
      : undefined;
  const recoveryChoice = actor === undefined || restKind === undefined
    ? undefined
    : canonicalRestRecoveryChoice(
        actor,
        restKind,
        input.hitDiceToSpend ?? 0,
        input.arcaneRecoverySlotLevels ?? [],
      );
  const timelineId = actor === undefined ? undefined : characterTimelineId(state, actor.id);
  const nowMicros = timelineId === undefined ? undefined : BigInt(state.fictionTimelines[timelineId].nowMicros);
  const alreadyActive = actor === undefined ? false : Object.values(state.campaignRuntime.activities)
    .some((activity) => activity.status === "active" && activity.characterId === actor.id);
  const activeEncounter = actor === undefined ? undefined : Object.values(state.combatRuntime.encounters)
    .find((encounter) => encounter.status !== "concluded"
      && Array.isArray(encounter.participantEntityIds)
      && encounter.participantEntityIds.includes(actor.id));
  if (root === undefined || actor === undefined || restKind === undefined
    || intendedDurationMicros === undefined || recoveryChoice === undefined
    || timelineId === undefined || nowMicros === undefined || alreadyActive
    || activeEncounter !== undefined) {
    return rejected("invalidRulesInput", "Rest parameters are unavailable.");
  }
  if (!canStartRest(actor, restKind, nowMicros, intendedDurationMicros)) {
    return rejected(
      restKind === "long" && actor.lastLongRestCompletedAtMicros !== undefined
        ? "missingPrerequisite"
        : "invalidRulesInput",
      "The rest cannot confer its 2014 benefit at the frozen completion time.",
    );
  }
  const invitedCharacterIds = input.memberCharacterIds === undefined
    ? []
    : canonicalStrings(input.memberCharacterIds);
  if (invitedCharacterIds === undefined || invitedCharacterIds.includes(actor.id)) {
    return rejected("invalidRulesInput", "Group rest invitees must be a canonical list excluding the initiator.");
  }
  const activityId = invitedCharacterIds.length === 0
    ? `activity:${root}`
    : `activity:${root}:${actor.id}`;
  const restStarted: Draft = {
    eventType: "RestStarted",
    payload: {
      activityId,
      characterId: actor.id,
      restKind,
      intendedDurationMicros: intendedDurationMicros.toString(),
      recoveryChoice,
    },
    visibilityPolicyId: "visibility:scene-observers",
    writes: [`activity:${activityId}`],
  };
  if (invitedCharacterIds.length === 0) {
    return sequence("committed", profiles, state, root, [
      ...partyDepartureEvents(state, actor.id, "personalRest"),
      restStarted,
    ]);
  }

  const group = Object.values(state.multiplayerRuntime.partyGroups).find((candidate) =>
    candidate.status === "active"
    && Array.isArray(candidate.memberCharacterIds)
    && candidate.memberCharacterIds.includes(actor.id));
  const groupMembers = Array.isArray(group?.memberCharacterIds)
    ? group.memberCharacterIds.filter(isNonEmptyString).sort()
    : undefined;
  const expectedInvitees = groupMembers?.filter((characterId) => characterId !== actor.id);
  const inviteesAreEligible = expectedInvitees !== undefined
    && expectedInvitees.length > 0
    && JSON.stringify(expectedInvitees) === JSON.stringify(invitedCharacterIds)
    && invitedCharacterIds.every((characterId) => {
      const invitee = character(state, characterId);
      const inviteeTimelineId = invitee === undefined ? undefined : characterTimelineId(state, invitee.id);
      const inviteeTimeline = inviteeTimelineId === undefined
        ? undefined
        : state.fictionTimelines[inviteeTimelineId];
      const inviteeHasActivity = invitee === undefined ? true : Object.values(state.campaignRuntime.activities)
        .some((activity) => activity.status === "active" && activity.characterId === invitee.id);
      const inviteeEncounter = invitee === undefined ? undefined : Object.values(state.combatRuntime.encounters)
        .find((encounter) => encounter.status !== "concluded"
          && Array.isArray(encounter.participantEntityIds)
          && encounter.participantEntityIds.includes(invitee.id));
      return invitee?.kind === "player"
        && state.characterControls[invitee.id] !== undefined
        && invitee.sceneId === actor.sceneId
        && inviteeTimelineId === timelineId
        && inviteeTimeline?.nowMicros === nowMicros.toString()
        && !inviteeHasActivity
        && inviteeEncounter === undefined
        && canStartRest(invitee, restKind, nowMicros, intendedDurationMicros);
    });
  if (!inviteesAreEligible) {
    return rejected(
      "privateOrUnknownReference",
      "Group rest must name every other active, controlled, co-located PartyGroup member at the same fictional instant.",
    );
  }
  const pendingInputIds = invitedCharacterIds
    .map((characterId) => `pending:group-rest:${root}:${characterId}`);
  const firstPendingInputId = pendingInputIds[0];
  return sequence("awaitingInput", profiles, state, root, [
    restStarted,
    {
      eventType: "GroupRestOffered",
      payload: {
        initiatorCharacterId: actor.id,
        invitedCharacterIds,
        pendingInputIds,
        restKind,
        intendedDurationMicros: intendedDurationMicros.toString(),
      },
      visibilityPolicyId: "visibility:party-group",
      secrecy: "private",
      reads: groupMembers!.map((characterId) => `entity:${characterId}`),
      creates: pendingInputIds.map((pendingInputId) => `pending:${pendingInputId}`),
    },
  ], {
    pending: {
      pendingInputId: firstPendingInputId,
      kind: "groupRestConsent",
      question: `是否自愿加入${restKind === "long" ? "长休" : "短休"}？请自行选择恢复资源。`,
      controller: { kind: "character", characterId: invitedCharacterIds[0] },
      options: {
        initiatorCharacterId: actor.id,
        restKind,
        intendedDurationMicros: intendedDurationMicros.toString(),
        offeredAtFictionMicros: nowMicros.toString(),
      },
    },
  });
}

function answerGroupRestInvitation(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "accept",
    "arcaneRecoverySlotLevels",
    "controllerCharacterId",
    "hitDiceToSpend",
    "kind",
    "pendingInputId",
    "proposalId",
  ])
    || typeof input.accept !== "boolean"
    || !isNonEmptyString(input.controllerCharacterId)
    || !isNonEmptyString(input.pendingInputId)
    || !isNonEmptyString(input.proposalId)) {
    return rejected("invalidRulesInput", "Group rest answer is not canonical.");
  }
  const pending = state.pendingInputs[input.pendingInputId];
  const actor = character(state, input.controllerCharacterId);
  const receipt = state.receipts[input.proposalId];
  const options = isRecord(pending?.options) ? pending.options : undefined;
  const initiatorCharacterId = isNonEmptyString(options?.initiatorCharacterId)
    ? options.initiatorCharacterId
    : undefined;
  const initiatorActivityId = initiatorCharacterId === undefined
    ? undefined
    : `activity:${pending?.rootActionId}:${initiatorCharacterId}`;
  const initiatorActivity = initiatorActivityId === undefined
    ? undefined
    : state.campaignRuntime.activities[initiatorActivityId];
  const restKind = options?.restKind === "short" || options?.restKind === "long"
    ? options.restKind
    : undefined;
  const intendedDurationMicros = typeof options?.intendedDurationMicros === "string"
    && /^[1-9][0-9]*$/.test(options.intendedDurationMicros)
    ? BigInt(options.intendedDurationMicros)
    : undefined;
  const timelineId = actor === undefined ? undefined : characterTimelineId(state, actor.id);
  const nowMicros = timelineId === undefined ? undefined : BigInt(state.fictionTimelines[timelineId].nowMicros);
  const recoveryChoice = actor === undefined || restKind === undefined
    ? undefined
    : canonicalRestRecoveryChoice(
        actor,
        restKind,
        input.hitDiceToSpend,
        input.arcaneRecoverySlotLevels,
      );
  if (pending?.kind !== "groupRestConsent"
    || pending.rootActionId !== input.proposalId
    || pending.controllerCharacterId !== input.controllerCharacterId
    || receipt?.status !== "awaitingInput"
    || actor?.kind !== "player"
    || options === undefined
    || initiatorCharacterId === undefined
    || initiatorActivity?.status !== "active"
    || initiatorActivity.characterId !== initiatorCharacterId
    || restKind === undefined
    || intendedDurationMicros === undefined
    || timelineId === undefined
    || nowMicros === undefined
    || typeof options.offeredAtFictionMicros !== "string"
    || nowMicros.toString() !== options.offeredAtFictionMicros
    || recoveryChoice === undefined) {
    return rejected("privateOrUnknownReference", "Group rest invitation is unavailable or its fictional instant changed.");
  }
  if (!input.accept
    && (recoveryChoice.hitDiceToSpend !== 0 || recoveryChoice.arcaneRecoverySlotLevels.length !== 0)) {
    return rejected("invalidRulesInput", "A declined rest cannot spend recovery resources.");
  }
  const activeActivity = Object.values(state.campaignRuntime.activities)
    .some((activity) => activity.status === "active" && activity.characterId === actor.id);
  const activeEncounter = Object.values(state.combatRuntime.encounters)
    .find((encounter) => encounter.status !== "concluded"
      && Array.isArray(encounter.participantEntityIds)
      && encounter.participantEntityIds.includes(actor.id));
  if (input.accept && (activeActivity || activeEncounter !== undefined
    || !canStartRest(actor, restKind, nowMicros, intendedDurationMicros))) {
    return rejected("missingPrerequisite", "This character can no longer join the frozen group rest.");
  }
  const remainingPendingEntries = [
    ...Object.values(state.pendingInputs),
    ...Object.values(state.multiplayerRuntime.suspendedPendingInputs),
  ].filter((entry) => isRecord(entry)
    && entry.kind === "groupRestConsent"
    && entry.rootActionId === pending.rootActionId
    && entry.pendingInputId !== pending.pendingInputId
    && isNonEmptyString(entry.pendingInputId)
    && isNonEmptyString(entry.controllerCharacterId)
    && isNonEmptyString(entry.question)
    && (entry.options === undefined || isRecord(entry.options)))
    .sort((left, right) => String(left.pendingInputId).localeCompare(String(right.pendingInputId)));
  const remainingPendingInputIds = remainingPendingEntries
    .map(({ pendingInputId }) => String(pendingInputId));
  if (new Set(remainingPendingInputIds).size !== remainingPendingInputIds.length) {
    return rejected("invalidWorldState", "Group rest remaining invitations are duplicated.");
  }
  const drafts: Draft[] = [];
  if (input.accept) {
    const activityId = `activity:${pending.rootActionId}:${actor.id}`;
    drafts.push({
      eventType: "RestStarted",
      payload: {
        activityId,
        characterId: actor.id,
        restKind,
        intendedDurationMicros: intendedDurationMicros.toString(),
        recoveryChoice,
      },
      visibilityPolicyId: "visibility:scene-observers",
      writes: [`activity:${activityId}`],
    });
  }
  drafts.push({
    eventType: "GroupRestConsentRecorded",
    payload: {
      invitedCharacterId: actor.id,
      pendingInputId: pending.pendingInputId,
      accepted: input.accept,
      recoveryChoice: input.accept ? recoveryChoice : null,
      remainingPendingInputIds,
    },
    visibilityPolicyId: `visibility:character-controller:${actor.id}`,
    secrecy: "private",
    reads: [
      `activity:${initiatorActivityId}`,
      `pending:${pending.pendingInputId}`,
      ...remainingPendingInputIds.map((pendingInputId) => `pending:${pendingInputId}`),
    ],
    writes: [`pending:${pending.pendingInputId}`],
  });
  const next = remainingPendingEntries[0];
  return sequence(
    next === undefined ? "committed" : "awaitingInput",
    profiles,
    state,
    pending.rootActionId,
    drafts,
    next === undefined ? {} : {
      pending: {
        pendingInputId: next.pendingInputId as string,
        kind: "groupRestConsent",
        question: next.question as string,
        controller: { kind: "character", characterId: next.controllerCharacterId as string },
        ...(next.options === undefined ? {} : { options: structuredClone(next.options) }),
      },
    },
  );
}

type ActivityCompletion = {
  method: string;
  primaryFactRef: string;
  sourceSceneId: string;
  success: CompoundActionEffect[];
  failure: CompoundActionEffect[];
};

function canonicalActivityEffects(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  value: unknown,
): CompoundActionEffect[] | undefined {
  if (!Array.isArray(value) || value.length > 24) return undefined;
  const effects: CompoundActionEffect[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.kind)) return undefined;
    switch (candidate.kind) {
      case "acquireEvidence":
        if (!hasExactKeys(candidate, ["definitionRef", "evidence", "evidenceRef", "kind"])
          || !isNonEmptyString(candidate.definitionRef)
          || !isNonEmptyString(candidate.evidence)
          || !isNonEmptyString(candidate.evidenceRef)
          || !(candidate.definitionRef in state.canonicalFacts)) return undefined;
        effects.push({
          kind: "acquireEvidence",
          definitionRef: candidate.definitionRef,
          evidence: candidate.evidence,
          evidenceRef: candidate.evidenceRef,
        });
        break;
      case "acquireKnowledge":
        if (!hasExactKeys(candidate, ["definitionRef", "kind", "knowledgeRef", "value"])
          || !isNonEmptyString(candidate.definitionRef)
          || !isNonEmptyString(candidate.knowledgeRef)
          || !(candidate.definitionRef in state.canonicalFacts)
          || !(candidate.value === null || ["string", "number", "boolean"].includes(typeof candidate.value))
          || (typeof candidate.value === "number" && !Number.isFinite(candidate.value))) return undefined;
        effects.push({
          kind: "acquireKnowledge",
          definitionRef: candidate.definitionRef,
          knowledgeRef: candidate.knowledgeRef,
          value: candidate.value as string | number | boolean | null,
        });
        break;
      case "changeResource":
        if (!hasExactKeys(candidate, ["amount", "kind", "resourceRef", "targetRef"])
          || candidate.targetRef !== actorCharacterId
          || !isNonEmptyString(candidate.resourceRef)
          || !Number.isSafeInteger(candidate.amount)
          || Number(candidate.amount) >= 0) return undefined;
        effects.push({
          kind: "changeResource",
          targetRef: actorCharacterId,
          resourceRef: candidate.resourceRef,
          amount: Number(candidate.amount),
        });
        break;
      case "alertNpc":
        if (!hasExactKeys(candidate, ["kind", "npcId", "status"])
          || !isNonEmptyString(candidate.npcId)
          || !isNonEmptyString(candidate.status)
          || state.entities[candidate.npcId]?.kind !== "npc") return undefined;
        effects.push({ kind: "alertNpc", npcId: candidate.npcId, status: candidate.status });
        break;
      case "moveEntity":
        if (!hasExactKeys(candidate, ["entityRef", "kind", "sceneRef"])
          || candidate.entityRef !== actorCharacterId
          || !isNonEmptyString(candidate.sceneRef)
          || !(candidate.sceneRef in state.scenes)) return undefined;
        effects.push({ kind: "moveEntity", entityRef: actorCharacterId, sceneRef: candidate.sceneRef });
        break;
      default:
        return undefined;
    }
  }
  return effects.filter(({ kind }) => kind === "moveEntity").length <= 1 ? effects : undefined;
}

function canonicalActivityCompletion(
  state: AuthoritativeWorldState,
  actorCharacterId: string,
  value: unknown,
): ActivityCompletion | undefined {
  if (!isRecord(value)
    || !hasExactKeys(value, ["failure", "method", "primaryFactRef", "sourceSceneId", "success"])
    || !isNonEmptyString(value.method)
    || !isNonEmptyString(value.primaryFactRef)
    || !isNonEmptyString(value.sourceSceneId)
    || !(value.primaryFactRef in state.canonicalFacts)
    || state.entities[actorCharacterId]?.sceneId !== value.sourceSceneId) return undefined;
  const success = canonicalActivityEffects(state, actorCharacterId, value.success);
  const failure = canonicalActivityEffects(state, actorCharacterId, value.failure);
  return success === undefined || failure === undefined ? undefined : {
    method: value.method,
    primaryFactRef: value.primaryFactRef,
    sourceSceneId: value.sourceSceneId,
    success,
    failure,
  };
}

function activityCompletionDrafts(
  state: AuthoritativeWorldState,
  rootActionId: string,
  activityId: string,
  activity: JsonRecord,
): Draft[] | undefined {
  const actorId = isNonEmptyString(activity.characterId) ? activity.characterId : undefined;
  const completion = actorId === undefined
    ? undefined
    : canonicalActivityCompletion(state, actorId, activity.completion);
  const actor = actorId === undefined ? undefined : character(state, actorId);
  if (completion === undefined || actor === undefined) return undefined;

  const drafts: Draft[] = [{
    eventType: "ActivityCompleted",
    payload: { activityId },
    visibilityPolicyId: "visibility:scene-observers",
    writes: [`activity:${activityId}`],
  }];
  const heldKnowledge = new Set(Object.keys(state.knowledge[actor.id] ?? {}));
  const remainingResources = { ...(actor.resources ?? {}) };
  let movement: Extract<CompoundActionEffect, { kind: "moveEntity" }> | undefined;
  for (const effect of completion.success) {
    switch (effect.kind) {
      case "acquireEvidence":
      case "acquireKnowledge": {
        const knowledgeRef = effect.kind === "acquireEvidence" ? effect.evidenceRef : effect.knowledgeRef;
        if (heldKnowledge.has(knowledgeRef) || !(effect.definitionRef in state.canonicalFacts)) return undefined;
        heldKnowledge.add(knowledgeRef);
        drafts.push({
          eventType: "KnowledgeAcquired",
          payload: {
            characterId: actor.id,
            knowledgeRef,
            objectKind: effect.kind === "acquireEvidence" ? "sensoryEvidence" : "canonicalFact",
            layer: "full",
            content: effect.kind === "acquireEvidence" ? effect.evidence : effect.value,
            causeFactId: effect.definitionRef,
            acquisition: {
              sense: effect.kind === "acquireEvidence" ? "inspection" : "understanding",
              sceneId: completion.sourceSceneId,
              method: completion.method,
            },
            visibility: "private",
          },
          visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
          secrecy: "private",
          writes: [`knowledge:${actor.id}:${knowledgeRef}`],
        });
        break;
      }
      case "changeResource": {
        const amount = Math.abs(effect.amount);
        const available = remainingResources[effect.resourceRef] ?? 0;
        if (available < amount) return undefined;
        remainingResources[effect.resourceRef] = available - amount;
        drafts.push({
          eventType: "ResourceUsed",
          payload: {
            characterId: actor.id,
            resourceId: effect.resourceRef,
            amount,
            purpose: `activity:${activityId}:completion`,
          },
          visibilityPolicyId: `visibility:character-controller:${actor.id}`,
          secrecy: "private",
          reads: [`resource:${actor.id}:${effect.resourceRef}`],
          writes: [`resource:${actor.id}:${effect.resourceRef}`],
        });
        break;
      }
      case "alertNpc": {
        const npc = state.entities[effect.npcId];
        if (npc?.kind !== "npc" || npc.tenureStatus !== "active"
          || npc.sceneId !== completion.sourceSceneId) return undefined;
        const knowledgeRef = `knowledge:alert:${rootActionId}:${npc.id}`;
        if (knowledgeRef in (state.knowledge[npc.id] ?? {})) return undefined;
        drafts.push({
          eventType: "KnowledgeAcquired",
          payload: {
            characterId: npc.id,
            knowledgeRef,
            objectKind: "sensoryEvidence",
            layer: "partial",
            content: { observedActivityId: activityId, status: effect.status },
            causeFactId: completion.primaryFactRef,
            acquisition: {
              sense: "situationalAwareness",
              sceneId: completion.sourceSceneId,
              method: "observeCompletedActivity",
            },
            visibility: "private",
          },
          visibilityPolicyId: `visibility:knowledge-holder:${npc.id}`,
          secrecy: "private",
        });
        break;
      }
      case "moveEntity":
        if (movement !== undefined) return undefined;
        movement = effect;
        break;
      case "advanceFictionTime":
        return undefined;
    }
  }
  if (movement !== undefined) {
    const plan = completedActivityMovementPlan(state, actor.id, movement.sceneRef);
    if (plan === undefined) return undefined;
    drafts.push({
      eventType: "CharacterMoved",
      payload: { characterId: actor.id, destinationSceneId: movement.sceneRef, ...plan },
      visibilityPolicyId: "visibility:scene-observers",
      reads: [`entity:${actor.id}`, `timeline:${plan.sourceTimelineId}`],
      writes: [`entity:${actor.id}`, `timeline:${plan.destinationTimelineId}`],
    });
  }
  return drafts;
}

function startActivity(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, [
    "activityId",
    "activityKind",
    "characterId",
    "completion",
    "intendedDurationMicros",
    "kind",
    "proposalId",
  ]) || !isRecord(input.completion)) return rejected("invalidRulesInput", "Activity input is not canonical.");
  const root = rootAction(state, input);
  const actor = character(state, input.characterId);
  if (
    root === undefined
    || actor === undefined
    || !isNonEmptyString(input.activityId)
    || !isNonEmptyString(input.activityKind)
    || input.activityKind === "stableRecovery2014"
    || typeof input.intendedDurationMicros !== "string"
    || !/^[1-9][0-9]*$/.test(input.intendedDurationMicros)
    || state.campaignRuntime.activities[input.activityId] !== undefined
    || canonicalActivityCompletion(state, actor.id, input.completion) === undefined
    || Object.values(state.campaignRuntime.activities)
      .some((activity) => activity.status === "active" && activity.characterId === actor.id)
  ) return rejected("invalidRulesInput", "Activity parameters are unavailable.");
  return sequence("committed", profiles, state, root, [
    ...partyDepartureEvents(state, actor.id, "personalActivity"),
    {
      eventType: "ActivityStarted",
      payload: {
        activityId: input.activityId,
        characterId: actor.id,
        activityKind: input.activityKind,
        intendedDurationMicros: input.intendedDurationMicros,
        completion: structuredClone(input.completion),
      },
    },
  ]);
}

function interruptActivity(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["activityId", "cause", "kind", "proposalId"]) || !isRecord(input.cause)) return rejected("invalidRulesInput", "Activity interruption input is not canonical.");
  const root = rootAction(state, input);
  const activity = isNonEmptyString(input.activityId)
    ? state.campaignRuntime.activities[input.activityId]
    : undefined;
  if (root === undefined || activity?.status !== "active") return rejected("privateOrUnknownReference", "Activity is unavailable.");
  const concentration = isNonEmptyString(activity.characterId)
    ? state.combatRuntime.entities[activity.characterId]?.concentration
    : undefined;
  const groupRestPendingEntries = [
    ...Object.values(state.pendingInputs),
    ...Object.values(state.multiplayerRuntime.suspendedPendingInputs),
  ].filter((pending) => isRecord(pending)
    && pending.kind === "groupRestConsent"
    && isNonEmptyString(pending.pendingInputId)
    && isNonEmptyString(pending.rootActionId)
    && isRecord(pending.options)
    && pending.options.initiatorCharacterId === activity.characterId
    && `activity:${pending.rootActionId}:${String(activity.characterId)}` === input.activityId);
  const groupRestPendingScopes = [...new Set(groupRestPendingEntries
    .map((pending) => `pending:${String(pending.pendingInputId)}`))].sort();
  const groupRestReceiptScopes = [...new Set(groupRestPendingEntries
    .map((pending) => `receipt:${String(pending.rootActionId)}`))].sort();
  const drafts: Draft[] = [{
    eventType: "ActivityInterrupted",
    payload: { activityId: input.activityId as string, cause: structuredClone(input.cause) },
    reads: [
      `activity:${input.activityId as string}`,
      ...groupRestPendingScopes,
      ...groupRestReceiptScopes,
    ],
    writes: [
      `activity:${input.activityId as string}`,
      ...groupRestPendingScopes,
      ...groupRestReceiptScopes,
    ],
  }];
  if (activity.activityKind === "longSpellcasting"
    && isRecord(concentration)
    && concentration.kind === "longSpellcasting"
    && concentration.activityId === input.activityId) {
    drafts.push({
      eventType: "ConcentrationEnded",
      payload: { entityId: activity.characterId, reason: "longSpellActivityInterrupted" },
    });
  }
  return sequence("committed", profiles, state, root, drafts);
}

function restCompletionDrafts(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  activityId: string,
  activity: JsonRecord,
  choice: RestRecoveryChoice,
  hitDieFaces: number[],
  continuationId: string | null,
): Draft[] | undefined {
  const characterId = String(activity.characterId);
  const actor = state.entities[characterId];
  const timelineId = characterTimelineId(state, characterId);
  const restKind = activity.restKind === "short" || activity.restKind === "long"
    ? activity.restKind
    : undefined;
  if (actor?.tenureStatus !== "active" || timelineId === undefined || restKind === undefined) return undefined;
  const completedAtFictionMicros = state.fictionTimelines[timelineId].nowMicros;
  const recovered = resolveRestRecovery(
    actor,
    restKind,
    choice,
    hitDieFaces,
    completedAtFictionMicros,
  );
  if (recovered === undefined) return undefined;
  const compiled = compileStaticCharacterCombat(
    recovered.character,
    characterBuildSnapshot(recovered.character),
    state.campaignRuntime.itemSystem,
    state.combatRuntime.definitions,
  );
  const control = state.characterControls[characterId];
  const seat = control === undefined ? undefined : state.seats[control.seatId];
  const initialCombat = buildPlayerCombatEntity(
    profiles,
    recovered.character,
    compiled,
    seat?.principalId ?? recovered.character.controllerPrincipalId,
    undefined,
    state.campaignRuntime.itemSystem,
  );
  const combatEntity = synchronizePlayerCombatEntity(
    state.combatRuntime.entities[characterId],
    initialCombat,
  );
  return [
    {
      eventType: "ActivityCompleted",
      payload: { activityId },
      visibilityPolicyId: "visibility:scene-observers",
    },
    {
      eventType: "RestCompleted",
      payload: {
        activityId,
        characterId,
        restKind,
        completedAtFictionMicros,
        continuationId,
        resultingCharacter: recovered.character,
        recovery: recovered.summary,
      },
      visibilityPolicyId: `visibility:character-controller:${characterId}`,
      secrecy: "private",
      writes: [`entity:${characterId}`],
    },
    {
      eventType: "CharacterMechanicsSynchronized",
      payload: {
        characterId,
        combatEntity,
        definitions: Object.values(compiled.definitions)
          .sort((left, right) => String(left.definitionId).localeCompare(String(right.definitionId))),
      },
      visibilityPolicyId: `visibility:character-controller:${characterId}`,
      secrecy: "private",
      writes: [`combat-entity:${characterId}`],
    },
  ];
}

function restRandomness(
  state: AuthoritativeWorldState,
  rootActionId: string,
  activityId: string,
  activity: JsonRecord,
  choice: RestRecoveryChoice,
): { request: RestHitDiceRandomnessRequest; continuation: AuthorityContinuation; draft: Draft } | undefined {
  const characterId = String(activity.characterId);
  const actor = state.entities[characterId];
  const hitDieSides = classHitDie(actor?.classId);
  const timelineId = characterTimelineId(state, characterId);
  if (actor === undefined || hitDieSides === undefined || timelineId === undefined || choice.hitDiceToSpend < 1) {
    return undefined;
  }
  const resolutionId = `resolution:${rootActionId}:rest-hit-dice`;
  const frozenParameters = {
    activityId,
    characterId,
    restKind: activity.restKind,
    hitDiceToSpend: choice.hitDiceToSpend,
    arcaneRecoverySlotLevels: [...choice.arcaneRecoverySlotLevels],
    hitDieSides,
    startedAtFictionMicros: activity.startedAtFictionMicros,
    intendedDurationMicros: activity.intendedDurationMicros,
    completionFictionMicros: state.fictionTimelines[timelineId].nowMicros,
  };
  const core = {
    randomnessId: `randomness:${rootActionId}:rest-hit-dice`,
    resolutionId,
    actorCharacterId: characterId,
    purpose: "restHitDice" as const,
    purposeKey: `rest-hit-dice:${activityId}`,
    diceExpression: `${choice.hitDiceToSpend}d${hitDieSides}`,
    dice: [{ count: String(choice.hitDiceToSpend), sides: String(hitDieSides) }],
    frozenParameters,
  };
  const request: RestHitDiceRandomnessRequest = { ...core, requestHash: canonicalSha256(core) };
  const continuation: AuthorityContinuation = {
    kind: "roomAuthorityRandomness",
    continuationId: `continuation:${resolutionId}`,
    capability: canonicalSha256({
      kind: "roomAuthorityRandomness",
      roomId: state.roomId,
      runtimeEpochId: state.runtimeEpochId,
      stateHash: hashWorldState(state),
      rootActionId,
      request,
    }),
  };
  return {
    request,
    continuation,
    draft: {
      eventType: "RandomnessRequested",
      payload: { request, continuation, purpose: request.purpose, formula: request.diceExpression },
      resolutionId,
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      writes: [`continuation:${continuation.continuationId}`, `receipt:${rootActionId}`],
      creates: [`continuation:${continuation.continuationId}`],
    },
  };
}

function prepareActivityCompletion(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  rootActionId: string,
  activityId: string,
) {
  const activity = state.campaignRuntime.activities[activityId];
  if (activity?.status !== "active") {
    return { kind: "rejected", result: rejected("privateOrUnknownReference", "Activity is unavailable.") } as const;
  }
  const timelineId = isNonEmptyString(activity.characterId)
    ? characterTimelineId(state, activity.characterId)
    : undefined;
  if (timelineId === undefined
    || typeof activity.startedAtFictionMicros !== "string"
    || typeof activity.intendedDurationMicros !== "string"
    || BigInt(state.fictionTimelines[timelineId].nowMicros)
      < BigInt(activity.startedAtFictionMicros) + BigInt(activity.intendedDurationMicros)) {
    return {
      kind: "rejected",
      result: rejected("missingPrerequisite", "The Activity has not reached its frozen fictional completion time."),
    } as const;
  }
  if (activity.activityKind === "stableRecovery2014") {
    const targetEntityId = isRecord(activity.completion)
      && activity.completion.kind === "stableRecovery2014"
      && isNonEmptyString(activity.completion.entityId)
      ? activity.completion.entityId
      : undefined;
    const target = targetEntityId === undefined
      ? undefined
      : state.combatRuntime.entities[targetEntityId];
    if (targetEntityId === undefined
      || targetEntityId !== activity.characterId
      || target === undefined
      || target.lifeState === "dead"
      || !isRecord(target.hitPoints)
      || Number(target.hitPoints.current) !== 0
      || !isRecord(target.conditions)
      || target.conditions.stable !== true) {
      return {
        kind: "rejected",
        result: rejected("missingPrerequisite", "Stable recovery was interrupted before its frozen due time."),
      } as const;
    }
    const drafts: Draft[] = [
        {
          eventType: "ActivityCompleted",
          payload: { activityId },
          visibilityPolicyId: "visibility:scene-observers",
        },
        {
          eventType: "HealingResolved",
          payload: { entityId: targetEntityId, before: "0", after: "1" },
          visibilityPolicyId: "visibility:combat-observers",
        },
      ];
    return { kind: "committed" as const, drafts };
  }
  if (activity.restKind === "short" || activity.restKind === "long") {
    const actor = state.entities[String(activity.characterId)];
    const recoveryChoice = isRecord(activity.recoveryChoice) && actor !== undefined
      ? canonicalRestRecoveryChoice(
          actor,
          activity.restKind,
          activity.recoveryChoice.hitDiceToSpend,
          activity.recoveryChoice.arcaneRecoverySlotLevels,
        )
      : undefined;
    if (recoveryChoice === undefined) {
      return { kind: "rejected", result: rejected("invalidWorldState", "Frozen rest recovery is unavailable.") } as const;
    }
    if (activity.restKind === "long" && actor.lastLongRestCompletedAtMicros !== undefined
      && BigInt(state.fictionTimelines[timelineId].nowMicros)
        < BigInt(actor.lastLongRestCompletedAtMicros) + LONG_REST_BENEFIT_INTERVAL_MICROS) {
      return {
        kind: "rejected",
        result: rejected("missingPrerequisite", "A long rest benefit is available only once per 24 fictional hours."),
      } as const;
    }
    if (recoveryChoice.hitDiceToSpend > 0) {
      const random = restRandomness(state, rootActionId, activityId, activity, recoveryChoice);
      return random === undefined
        ? { kind: "rejected", result: rejected("invalidWorldState", "Frozen rest dice are unavailable.") } as const
        : { kind: "awaitingRandomness", random } as const;
    }
    const drafts = restCompletionDrafts(
      profiles,
      state,
      activityId,
      activity,
      recoveryChoice,
      [],
      null,
    );
    return drafts === undefined
      ? { kind: "rejected", result: rejected("invalidWorldState", "Rest recovery could not be resolved.") } as const
      : { kind: "committed", drafts } as const;
  }
  const drafts = activityCompletionDrafts(state, rootActionId, activityId, activity);
  return drafts === undefined
    ? {
        kind: "rejected",
        result: rejected("missingPrerequisite", "The frozen Activity completion is no longer mechanically legal."),
      } as const
    : { kind: "committed", drafts } as const;
}

function completeActivity(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["activityId", "kind", "proposalId"])) return rejected("invalidRulesInput", "Activity completion input is not canonical.");
  const root = rootAction(state, input);
  if (root === undefined || !isNonEmptyString(input.activityId)) {
    return rejected("privateOrUnknownReference", "Activity is unavailable.");
  }
  const prepared = prepareActivityCompletion(profiles, state, root, input.activityId);
  if (prepared.kind === "rejected") return prepared.result;
  if (prepared.kind === "awaitingRandomness") {
    return sequence("awaitingRandomness", profiles, state, root, [prepared.random.draft], {
      randomnessRequest: prepared.random.request,
      continuation: prepared.random.continuation,
      randomnessRequests: [prepared.random.request],
      continuations: [prepared.random.continuation],
    });
  }
  return sequence("committed", profiles, state, root, prepared.drafts);
}

const DUE_ACTIVITY_BYPASS_KINDS = new Set([
  "authoritativeRandomness",
  "fulfillAuthoritativeRandomness",
  "fulfillAuthoritativeRandomnessBatch",
  "answerPendingInput",
  "answerGroupRestInvitation",
  "completeActivity",
  "interruptActivity",
  "applyServiceCorrection",
  "resolveDueActorPlan",
]);

function inputTimelineId(state: AuthoritativeWorldState, input: JsonRecord): string | undefined {
  const characterId = [
    input.characterId,
    input.actorCharacterId,
    input.sourceCharacterId,
    input.actingNpcId,
    input.sourceEntityId,
    input.leaderCharacterId,
  ].find((value) => isNonEmptyString(value) && value in state.entities);
  return isNonEmptyString(characterId) ? characterTimelineId(state, characterId) : undefined;
}

/**
 * SPEC 0013 F04 preflight. A due Activity commits as its own deterministic root;
 * the untouched caller root can then be retried against the new projection.
 */
export function settleDueActivityBeforeInput(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (DUE_ACTIVITY_BYPASS_KINDS.has(String(input.kind))) return undefined;
  const timelineId = inputTimelineId(state, input);
  if (timelineId === undefined) return undefined;
  const nowMicros = BigInt(state.fictionTimelines[timelineId].nowMicros);
  const due = Object.values(state.campaignRuntime.activities)
    .filter((activity) => activity.status === "active"
      && activity.activityKind !== "longSpellcasting"
      && !(isRecord(activity.completion) && activity.completion.kind === "actorPlan")
      && isNonEmptyString(activity.activityId)
      && isNonEmptyString(activity.characterId)
      && characterTimelineId(state, activity.characterId) === timelineId
      && typeof activity.startedAtFictionMicros === "string"
      && typeof activity.intendedDurationMicros === "string"
      && BigInt(activity.startedAtFictionMicros) + BigInt(activity.intendedDurationMicros) <= nowMicros)
    .sort((left, right) => {
      const leftDue = BigInt(String(left.startedAtFictionMicros)) + BigInt(String(left.intendedDurationMicros));
      const rightDue = BigInt(String(right.startedAtFictionMicros)) + BigInt(String(right.intendedDurationMicros));
      return leftDue < rightDue ? -1 : leftDue > rightDue ? 1
        : String(left.activityId).localeCompare(String(right.activityId));
    })[0];
  if (due === undefined) return undefined;
  const dueMicros = (BigInt(String(due.startedAtFictionMicros))
    + BigInt(String(due.intendedDurationMicros))).toString();
  const rootActionId = `activity-due:${String(due.activityId)}:${dueMicros}`;
  if (rootActionId in state.receipts) return undefined;
  const prepared = prepareActivityCompletion(profiles, state, rootActionId, String(due.activityId));
  if (prepared.kind === "rejected") return prepared.result;
  const additions = {
    mechanicalResult: {
      kind: "dueActivitySettled",
      activityId: due.activityId,
      interruptedIntentKind: input.kind,
      retryOriginalIntent: true,
    },
  };
  if (prepared.kind === "awaitingRandomness") {
    return sequence("awaitingRandomness", profiles, state, rootActionId, [prepared.random.draft], {
      ...additions,
      randomnessRequest: prepared.random.request,
      continuation: prepared.random.continuation,
      randomnessRequests: [prepared.random.request],
      continuations: [prepared.random.continuation],
    });
  }
  return sequence("committed", profiles, state, rootActionId, prepared.drafts, additions);
}

export function fulfillRestRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  rolls: number[],
): StepResult | undefined {
  const stored = state.internalContinuations[continuationId];
  if (stored?.request.purpose !== "restHitDice") return undefined;
  const request = stored.request;
  const frozen = request.frozenParameters;
  const activityId = isNonEmptyString(frozen.activityId) ? frozen.activityId : undefined;
  const activity = activityId === undefined ? undefined : state.campaignRuntime.activities[activityId];
  const actor = state.entities[request.actorCharacterId];
  const choice = activity !== undefined && isRecord(activity.recoveryChoice) && actor !== undefined
    ? canonicalRestRecoveryChoice(
        actor,
        activity.restKind as "short" | "long",
        activity.recoveryChoice.hitDiceToSpend,
        activity.recoveryChoice.arcaneRecoverySlotLevels,
      )
    : undefined;
  const { requestHash: _requestHash, ...core } = request;
  if (activityId === undefined || activity?.status !== "active" || choice === undefined
    || request.requestHash !== canonicalSha256(core)
    || request.dice.length !== 1
    || request.dice[0].count !== String(choice.hitDiceToSpend)
    || request.dice[0].sides !== String(frozen.hitDieSides)
    || rolls.length !== choice.hitDiceToSpend
    || rolls.some((roll) => !Number.isInteger(roll) || roll < 1 || roll > Number(frozen.hitDieSides))) {
    return rejected("invalidRulesInput", "The authoritative rest rolls do not match the frozen request.");
  }
  const completion = restCompletionDrafts(
    profiles,
    state,
    activityId,
    activity,
    choice,
    rolls,
    continuationId,
  );
  if (completion === undefined) return rejected("invalidWorldState", "Rest recovery could not be fulfilled.");
  return sequence("committed", profiles, state, stored.rootActionId, [
    {
      eventType: "DiceRolled",
      payload: {
        randomnessId: request.randomnessId,
        resolutionId: request.resolutionId,
        formula: request.diceExpression,
        faces: [...rolls],
        selectedFace: null,
        requestHash: request.requestHash,
        frozenParametersHash: canonicalSha256(request.frozenParameters),
      },
      resolutionId: request.resolutionId,
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: [`continuation:${continuationId}`],
    },
    ...completion,
  ]);
}

function registerDefinition(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["definition", "kind", "proposalId"]) || !isRecord(input.definition)) return rejected("invalidRulesInput", "Definition input is not canonical.");
  const root = rootAction(state, input); const definition = input.definition;
  if (root === undefined || !isNonEmptyString(definition.definitionId)
    || !isNonEmptyString(definition.revision) || !isNonEmptyString(definition.definitionKind)
    || definition.definitionId in state.campaignRuntime.definitions) {
    return rejected("invalidRulesInput", "Dynamic definition identity is unavailable or already registered.");
  }
  // Hazards are settled before abilities are considered. A trap carries
  // perceptible signs, ways to be found or disarmed, and consequences it
  // leaves behind -- none of which an Ability has -- so letting the Ability
  // compiler claim it first is what allowed a hazard to be frozen with none of
  // SPEC 0001 section 8's nine properties.
  if (isEnvironmentHazardDefinitionCandidate(definition)) {
    if (!isEnvironmentHazardDefinition(definition)) {
      return rejected(
        "invalidRulesInput",
        "A hazard must settle its trigger, signs, disable methods, resolution, area, damage, conditions, duration and consequences.",
      );
    }
    return sequence("committed", profiles, state, root, [{
      eventType: "DefinitionRegistered",
      payload: { definition: structuredClone(definition) },
    }]);
  }
  if (isAbilityDefinitionCandidate(definition)) {
    const compiled = compileAbilityDefinition(definition);
    if (!compiled.ok) {
      const diagnostics = compiled.diagnostics.map((diagnostic) => ({
        code: compiled.code,
        message: diagnostic.reason,
        path: diagnostic.path,
        source: "SPEC 0013",
        visibility: "public",
      } as const));
      return compiled.code === "invalidAbilityDefinition"
        || compiled.code === "definitionComplexityExceeded"
        ? needsKp(state, diagnostics)
        : rejected(compiled.code, compiled.publicMessage, diagnostics);
    }
    return sequence("committed", profiles, state, root, [{
      eventType: "DefinitionRegistered",
      payload: structuredClone(compiled.artifact),
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
    }]);
  }
  if (definition.definitionKind === NPC_MECHANICAL_TEMPLATE_KIND) {
    return rejected(
      "unsupportedOperation",
      "NPC mechanical templates must be frozen through encounter materialization.",
    );
  }
  if (!["srd5.1-2014", "zhuwei-product-ruling"].includes(String(definition.rulesBasis))) {
    return rejected("unsupportedRulesBasis", "Dynamic definition requires an approved 2014 or product basis.");
  }
  return sequence("committed", profiles, state, root, [{ eventType: "DefinitionRegistered", payload: { definition: structuredClone(definition) } }]);
}

function triggerHazard(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["causeFactIds", "definitionId", "kind", "proposalId", "triggeringEntityId", "zoneId"])) return rejected("invalidRulesInput", "Hazard input is not canonical.");
  const root = rootAction(state, input); const target = character(state, input.triggeringEntityId); const definition = isNonEmptyString(input.definitionId) ? state.campaignRuntime.definitions[input.definitionId] : undefined; const causes = canonicalStrings(input.causeFactIds);
  const frozenEffectOperation = frozenRegisteredAbilityOperation(definition, "Effect");
  const effect = isRecord(frozenEffectOperation?.input.effect)
    ? frozenEffectOperation.input.effect
    : frozenEffectOperation?.input;
  if (root === undefined || target === undefined || definition === undefined || causes === undefined || causes.some((id) => !(id in state.canonicalFacts)) || !isNonEmptyString(input.zoneId) || effect?.kind !== "fixedDamage" || !Number.isSafeInteger(effect.amount) || !isNonEmptyString(effect.damageType)) return rejected("invalidRulesInput", "Hazard definition or trigger is unavailable.");
  const damage = resolveFixedDamage(target, Number(effect.amount));
  const drafts: Draft[] = [
    { eventType: "HazardTriggered", payload: { definitionId: input.definitionId as string, triggeringEntityId: target.id, zoneId: input.zoneId, causeFactIds: causes } },
    { eventType: "DamagePacketResolved", payload: { targetId: target.id, amount: Number(effect.amount), damageType: effect.damageType, sourceDefinitionId: input.definitionId as string } },
    { eventType: "HitPointsChanged", payload: { characterId: target.id, before: damage.before, after: damage.after, maximum: damage.maximum, causeId: input.definitionId as string } },
  ];
  if (damage.died) drafts.push({ eventType: "CreatureDied", payload: { characterId: target.id, causeId: input.definitionId as string } });
  return sequence("committed", profiles, state, root, drafts);
}

function declareCanonicalFact(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["fact", "kind", "proposalId"]) || !isRecord(input.fact)
    || !hasExactKeys(input.fact, ["causalParentIds", "factId", "factKind", "source", "subjectRefs", "value", "visibilityPolicy"])) {
    return rejected("invalidRulesInput", "Canonical fact input is not canonical.");
  }
  const root = rootAction(state, input); const fact = input.fact; const subjects = canonicalStrings(fact.subjectRefs); const parents = canonicalStrings(fact.causalParentIds);
  if (root === undefined || !isNonEmptyString(fact.factId) || !isNonEmptyString(fact.factKind) || subjects === undefined || parents === undefined || parents.some((id) => !(id in state.canonicalFacts)) || !["dynamicMaterialization", "observedEvent", "mechanicalResolution", "characterAction", "npcOrFactionAction"].includes(String(fact.source)) || !["public", "hiddenUntilEvidence"].includes(String(fact.visibilityPolicy)) || fact.factId in state.canonicalFacts) {
    return rejected("invalidRulesInput", "Canonical fact references or source are unavailable.");
  }
  return sequence("committed", profiles, state, root, [{
    eventType: "CanonicalFactDeclared",
    payload: { fact: {
      id: fact.factId,
      kind: fact.factKind,
      subjectRefs: subjects,
      value: structuredClone(fact.value),
      visibilityPolicyId: fact.visibilityPolicy === "public" ? "visibility:public" : "visibility:hidden-until-evidence",
      source: fact.source as EventPayloadByType["CanonicalFactDeclared"]["fact"]["source"],
      causalParentIds: parents,
    } },
    visibilityPolicyId: fact.visibilityPolicy === "public" ? "visibility:public" : "visibility:kp-internal",
    secrecy: fact.visibilityPolicy === "public" ? "public" : "internal",
  }]);
}

function acquireSensoryEvidence(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["characterId", "clarity", "factId", "kind", "proposalId", "publicEvidence", "sense"])) return rejected("invalidRulesInput", "Sensory evidence input is not canonical.");
  const root = rootAction(state, input); const actor = character(state, input.characterId);
  if (root === undefined || actor === undefined || !isNonEmptyString(input.factId) || !(input.factId in state.canonicalFacts) || !isNonEmptyString(input.sense) || !isNonEmptyString(input.clarity) || !isNonEmptyString(input.publicEvidence)) return rejected("privateOrUnknownReference", "Sensory evidence reference is unavailable.");
  return sequence("committed", profiles, state, root, [{
    eventType: "SensoryEvidenceAcquired",
    payload: {
      characterId: actor.id,
      factId: input.factId,
      sense: input.sense,
      clarity: input.clarity,
      publicEvidence: input.publicEvidence,
    },
    visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
    secrecy: "private",
    reads: [`entity:${actor.id}`, `fact:${input.factId}`],
    writes: [`knowledge:${actor.id}`, `receipt:${root}`],
    creates: [`knowledge:${actor.id}:${input.factId}`],
  }]);
}

function createSourceClaim(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["claimId", "formedAtFictionMicros", "kind", "motive", "proposalId", "semanticContent", "sourceBasis", "speakerId"])) return rejected("invalidRulesInput", "Source claim input is not canonical.");
  const root = rootAction(state, input); const speaker = character(state, input.speakerId);
  const speakerTimelineId = speaker === undefined ? undefined : characterTimelineId(state, speaker.id);
  const now = speakerTimelineId === undefined ? undefined : state.fictionTimelines[speakerTimelineId].nowMicros;
  if (root === undefined || speaker === undefined || !isNonEmptyString(now) || ![input.claimId, input.semanticContent, input.sourceBasis, input.motive].every(isNonEmptyString) || input.formedAtFictionMicros !== now || (input.claimId as string) in state.campaignRuntime.sourceClaims) return rejected("invalidRulesInput", "Source claim is unavailable or not frozen at Fiction Time.");
  return sequence("committed", profiles, state, root, [{ eventType: "SourceClaimCreated", payload: { speakerId: speaker.id, claimId: input.claimId as string, semanticContent: input.semanticContent as string, sourceBasis: input.sourceBasis as string, motive: input.motive as string, formedAtFictionMicros: now }, visibilityPolicyId: `visibility:knowledge-holder:${speaker.id}`, secrecy: "private" }]);
}

function formCharacterInference(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["characterId", "conclusion", "confidence", "evidenceRefs", "inferenceId", "kind", "proposalId"])) return rejected("invalidRulesInput", "Inference input is not canonical.");
  const root = rootAction(state, input); const actor = character(state, input.characterId); const evidence = canonicalStrings(input.evidenceRefs);
  if (root === undefined || actor === undefined || evidence === undefined || evidence.length === 0 || evidence.some((ref) => !(ref in (state.knowledge[actor.id] ?? {}))) || !isNonEmptyString(input.inferenceId) || !isNonEmptyString(input.conclusion) || !isNonEmptyString(input.confidence)) return rejected("privateOrUnknownReference", "Inference evidence is unavailable.");
  return sequence("committed", profiles, state, root, [{ eventType: "CharacterInferenceFormed", payload: { characterId: actor.id, inferenceId: input.inferenceId, evidenceRefs: evidence, conclusion: input.conclusion, confidence: input.confidence }, visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`, secrecy: "private" }]);
}

function changeRelationship(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["basisFactIds", "change", "kind", "proposalId", "relationshipId", "subjectIds"])) return rejected("invalidRulesInput", "Relationship input is not canonical.");
  const root = rootAction(state, input); const subjects = canonicalStrings(input.subjectIds); const basis = canonicalStrings(input.basisFactIds);
  if (root === undefined || subjects === undefined || subjects.length < 2 || subjects.some((id) => !(id in state.entities)) || basis === undefined || basis.some((id) => !(id in state.canonicalFacts)) || !isNonEmptyString(input.relationshipId) || !isNonEmptyString(input.change)) return rejected("privateOrUnknownReference", "Relationship references are unavailable.");
  return sequence("committed", profiles, state, root, [{ eventType: "RelationshipChanged", payload: { relationshipId: input.relationshipId, subjectIds: subjects, change: input.change, basisFactIds: basis }, visibilityPolicyId: "visibility:relationship-participants", secrecy: "private" }]);
}

function makePromise(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["condition", "content", "kind", "promiseeId", "promiseId", "promisorId", "proposalId"])) return rejected("invalidRulesInput", "Promise input is not canonical.");
  const root = rootAction(state, input);
  if (root === undefined || ![input.promiseId, input.promisorId, input.promiseeId, input.content, input.condition].every(isNonEmptyString) || !((input.promisorId as string) in state.entities) || !((input.promiseeId as string) in state.entities) || (input.promiseId as string) in state.campaignRuntime.promises) return rejected("privateOrUnknownReference", "Promise references are unavailable.");
  return sequence("committed", profiles, state, root, [{ eventType: "PromiseMade", payload: { promiseId: input.promiseId as string, promisorId: input.promisorId as string, promiseeId: input.promiseeId as string, content: input.content as string, condition: input.condition as string }, visibilityPolicyId: "visibility:promise-participants", secrecy: "private" }]);
}

function incurDebt(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, [
    "basisFactIds",
    "condition",
    "creditorId",
    "debtId",
    "debtorId",
    "kind",
    "obligation",
    "proposalId",
  ])) return rejected("invalidRulesInput", "Debt input is not canonical.");
  const root = rootAction(state, input);
  const basisFactIds = canonicalStrings(input.basisFactIds);
  if (root === undefined
    || ![
      input.condition,
      input.creditorId,
      input.debtId,
      input.debtorId,
      input.obligation,
    ].every(isNonEmptyString)
    || character(state, input.debtorId) === undefined
    || character(state, input.creditorId) === undefined
    || basisFactIds === undefined
    || basisFactIds.length === 0
    || basisFactIds.some((factId) => !(factId in state.canonicalFacts))
    || (input.debtId as string) in state.campaignRuntime.debts) {
    return rejected("privateOrUnknownReference", "Debt references are unavailable.");
  }
  return sequence("committed", profiles, state, root, [{
    eventType: "DebtIncurred",
    payload: {
      debtId: input.debtId as string,
      debtorId: input.debtorId as string,
      creditorId: input.creditorId as string,
      obligation: input.obligation as string,
      condition: input.condition as string,
      basisFactIds,
    },
    visibilityPolicyId: "visibility:debt-participants",
    secrecy: "private",
  }]);
}

function shareCampaignKnowledge(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasOnlyKeys(
    input,
    ["contentLayer", "kind", "knowledgeRefs", "medium", "proposalId", "recipientEntityIds", "senderCharacterId"],
    ["mediumFactId"],
  )) return rejected("invalidRulesInput", "Knowledge sharing input is not canonical.");
  const root = rootAction(state, input); const sender = character(state, input.senderCharacterId); const recipients = canonicalStrings(input.recipientEntityIds); const refs = canonicalStrings(input.knowledgeRefs);
  const recipientCharacters = recipients?.map((id) => character(state, id));
  const channel = isNonEmptyString(input.mediumFactId)
    ? state.canonicalFacts[input.mediumFactId]
    : undefined;
  const coLocated = sender !== undefined && recipientCharacters !== undefined
    && recipientCharacters.every((recipient) => recipient?.sceneId === sender.sceneId);
  const validChannel = sender !== undefined && recipients !== undefined && channel !== undefined
    && channel.kind === "establishedCommunicationChannel"
    && channel.subjectRefs.includes(sender.id)
    && recipients.every((id) => channel.subjectRefs.includes(id));
  if (root === undefined || sender === undefined || recipients === undefined || recipients.length === 0
    || recipientCharacters === undefined || recipientCharacters.some((entry) => entry === undefined)
    || refs === undefined || refs.length === 0
    || refs.some((ref) => !(ref in (state.knowledge[sender.id] ?? {})))
    || refs.some((ref) => recipients.some((recipientId) => ref in (state.knowledge[recipientId] ?? {})))
    || !isNonEmptyString(input.medium)
    || !["hint", "partial", "full"].includes(String(input.contentLayer))
    || (!coLocated && !validChannel)
    || (input.mediumFactId !== undefined && !validChannel)) {
    return rejected("privateOrUnknownReference", "Knowledge sharing requires held knowledge and a present or established world channel.");
  }
  const drafts: Draft[] = recipients.map((recipientId) => ({
    eventType: "KnowledgeAcquired",
    payload: {
      characterId: recipientId,
      sourceCharacterId: sender.id,
      medium: input.medium as string,
      contentLayer: input.contentLayer as "hint" | "partial" | "full",
      items: refs.map((ref) => {
        const source = state.knowledge[sender.id][ref];
        return { knowledgeRef: ref, objectKind: source.objectKind, content: structuredClone(source.content), provenanceChain: [...source.provenanceChain].sort() };
      }),
    },
    visibilityPolicyId: `visibility:knowledge-holder:${recipientId}`,
    secrecy: "private",
    reads: [
      ...refs.map((ref) => `knowledge:${sender.id}:${ref}`),
      ...(channel === undefined ? [] : [`fact:${channel.id}`]),
    ],
    writes: [...refs.map((ref) => `knowledge:${recipientId}:${ref}`), `receipt:${root}`],
    creates: refs.map((ref) => `knowledge:${recipientId}:${ref}`),
  }));
  return sequence("committed", profiles, state, root, drafts);
}

function resolveDueActorPlan(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (
    !hasOnlyKeys(input, [
      "affectedCharacterId",
      "causedByRootActionId",
      "decision",
      "kind",
      "mechanicalProposal",
      "planId",
      "proposalId",
    ], ["deferUntilFictionMicros", "reason", "revision", "targetRef"])
    || ![
      input.affectedCharacterId,
      input.causedByRootActionId,
      input.planId,
      input.proposalId,
    ].every(isNonEmptyString)
    || !["execute", "revise", "defer", "cancel"].includes(String(input.decision))
  ) return rejected("invalidRulesInput", "Due ActorPlan decision is not a closed canonical input.");
  if (input.mechanicalProposal !== null) {
    return rejected(
      "unsupportedMechanicPrimitive",
      "This ActorPlan slice executes only a frozen non-mechanical next step.",
    );
  }
  if (
    (input.decision === "execute"
      && (input.reason !== undefined
        || input.deferUntilFictionMicros !== undefined
        || input.revision !== undefined))
    || (input.decision === "cancel"
      && (input.deferUntilFictionMicros !== undefined
        || input.revision !== undefined
        || input.targetRef !== undefined))
    || (input.decision === "defer"
      && (input.revision !== undefined || input.targetRef !== undefined))
    || (input.decision === "revise"
      && (input.reason !== undefined
        || input.deferUntilFictionMicros !== undefined
        || input.targetRef !== undefined))
  ) return rejected("invalidRulesInput", "ActorPlan decision fields do not match its lifecycle variant.");
  const selected = earliestEligibleDueActorPlan(
    state,
    input.affectedCharacterId as string,
  );
  if (selected === undefined) {
    return rejected("privateOrUnknownReference", "The selected due ActorPlan is no longer eligible.");
  }
  const plan = selected.plan;
  const expectedRoot = dueActorPlanChildRoot(plan);
  const trace = isRecord(plan.trace) ? plan.trace : undefined;
  const activity = isRecord(plan.activity) ? plan.activity : undefined;
  const premiseRefs = canonicalStrings(plan.premiseRefs);
  const planFactionRef = plan.factionRef === null
    ? null
    : isNonEmptyString(plan.factionRef)
      ? plan.factionRef
      : undefined;
  const npc = state.entities[selected.npcId];
  if (
    plan.planId !== input.planId
    || expectedRoot !== input.proposalId
    || npc?.kind !== "npc"
    || !isNonEmptyString(plan.nextStep)
    || !isNonEmptyString(trace?.factRef)
    || !isNonEmptyString(trace.description)
    || !isNonEmptyString(trace.visibilityPolicyRef)
    || !isNonEmptyString(activity?.activityId)
    || premiseRefs === undefined
    || premiseRefs.length === 0
    || planFactionRef === undefined
  ) return rejected("privateOrUnknownReference", "The selected due ActorPlan is no longer eligible.");

  const root = rootAction(state, { proposalId: input.proposalId });
  if (root === undefined) {
    return rejected("duplicateRootAction", "The due ActorPlan child root is unavailable.");
  }
  const factionPlan = state.campaignRuntime.factionPlans[plan.planId as string];
  if (
    (planFactionRef === null) !== (factionPlan === undefined)
    || (factionPlan !== undefined && factionPlan.factionId !== planFactionRef)
  ) return rejected("invalidWorldState", "The selected ActorPlan faction binding is unavailable.");
  const factionPlanScope = factionPlan === undefined
    ? []
    : [`faction-plan:${String(plan.planId)}`];
  const planPremiseScopes = premiseRefs.flatMap((reference) => {
    const scope = actorPlanPremiseScope(state, selected.npcId, reference);
    return scope === undefined ? [] : [scope];
  });
  const planResourceScopes = actorPlanResourceScopes(
    state,
    selected.npcId,
    planFactionRef,
    plan.resourceRefs,
  );
  if (input.decision === "revise") {
    const revision = isRecord(input.revision) ? input.revision : undefined;
    const premiseRefs = revision === undefined ? undefined : canonicalStrings(revision.premiseRefs);
    const resourceRefs = revision === undefined ? undefined : canonicalStrings(revision.resourceRefs);
    const existingResources = Array.isArray(plan.resourceRefs) ? plan.resourceRefs : [];
    const faction = isNonEmptyString(factionPlan?.factionId)
      ? state.campaignRuntime.factions[factionPlan.factionId]
      : undefined;
    const requiredFactionResources = Array.isArray(faction?.resourceRefs)
      && faction.resourceRefs.every(isNonEmptyString)
      ? faction.resourceRefs
      : undefined;
    const heldKnowledge = state.knowledge[selected.npcId] ?? {};
    const nextRevision = isNonEmptyString(plan.revision)
      && /^(0|[1-9][0-9]*)$/.test(plan.revision)
      ? (BigInt(plan.revision) + 1n).toString()
      : undefined;
    if (
      revision === undefined
      || !hasExactKeys(revision, [
        "alternateTarget",
        "due",
        "nextStep",
        "premiseRefs",
        "reason",
        "resourceRefs",
        "trace",
        "trigger",
      ])
      || !isNonEmptyString(revision.reason)
      || !isNonEmptyString(revision.nextStep)
      || premiseRefs === undefined
      || premiseRefs.length === 0
      || premiseRefs.some((ref) =>
        !actorPlanPremiseIsAvailable(state, selected.npcId, ref))
      || resourceRefs === undefined
      || resourceRefs.some((ref) => !existingResources.includes(ref))
      || !actorPlanResourcesAreAvailable(
        state,
        selected.npcId,
        planFactionRef,
        resourceRefs,
      )
      || (factionPlan !== undefined && (
        faction === undefined
        || !Array.isArray(faction.memberRefs)
        || !faction.memberRefs.includes(selected.npcId)
        || requiredFactionResources === undefined
        || !resourceRefs.includes(factionPlan.factionId as string)
        || requiredFactionResources.some((ref) => !resourceRefs.includes(ref))
      ))
      || !isRecord(revision.trace)
      || !hasExactKeys(revision.trace, ["description", "factRef", "visibilityPolicyRef"])
      || !isNonEmptyString(revision.trace.factRef)
      || !isNonEmptyString(revision.trace.description)
      || !isNonEmptyString(revision.trace.visibilityPolicyRef)
      || revision.trace.visibilityPolicyRef !== trace.visibilityPolicyRef
      || revision.trace.factRef in state.canonicalFacts
      || !isRecord(revision.alternateTarget)
      || !hasExactKeys(revision.alternateTarget, ["reason", "targetRef"])
      || !isNonEmptyString(revision.alternateTarget.targetRef)
      || !isNonEmptyString(revision.alternateTarget.reason)
      || (!(revision.alternateTarget.targetRef in state.entities)
        && !(revision.alternateTarget.targetRef in state.scenes))
      || nextRevision === undefined
    ) return rejected("invalidRulesInput", "ActorPlan revision is not a finite canonical plan.");

    let due: EventPayloadByType["NpcPlanRevised"]["due"] = null;
    let trigger: EventPayloadByType["NpcPlanRevised"]["trigger"] = null;
    if (revision.due !== null) {
      if (
        !isRecord(revision.due)
        || !hasExactKeys(revision.due, ["atFictionMicros", "kind"])
        || revision.due.kind !== "fictionTime"
        || typeof revision.due.atFictionMicros !== "string"
        || !/^(0|[1-9][0-9]*)$/.test(revision.due.atFictionMicros)
        || BigInt(revision.due.atFictionMicros)
          <= BigInt(state.fictionTimelines[selected.timelineId].nowMicros)
      ) return rejected("invalidRulesInput", "ActorPlan revision due time is unavailable.");
      due = { kind: "fictionTime", atFictionMicros: revision.due.atFictionMicros };
    }
    if (revision.trigger !== null) {
      if (!isRecord(revision.trigger)) {
        return rejected("invalidRulesInput", "ActorPlan revision trigger is unavailable.");
      }
      const revisionTrigger = revision.trigger;
      if (
        revisionTrigger.kind === "knowledgeAcquired"
        && hasExactKeys(revisionTrigger, ["kind", "knowledgeRef"])
        && isNonEmptyString(revisionTrigger.knowledgeRef)
        && revisionTrigger.knowledgeRef in heldKnowledge
      ) {
        trigger = { kind: "knowledgeAcquired", knowledgeRef: revisionTrigger.knowledgeRef };
      } else if (
        revisionTrigger.kind === "committedEvent"
        && hasExactKeys(revisionTrigger, ["eventRef", "kind"])
        && isNonEmptyString(revisionTrigger.eventRef)
        && Object.values(heldKnowledge).some((knowledge) =>
          knowledge.acquiredByEventId === revisionTrigger.eventRef
          || knowledge.provenanceChain.includes(revisionTrigger.eventRef as string))
      ) {
        trigger = { kind: "committedEvent", eventRef: revisionTrigger.eventRef };
      } else {
        return rejected("privateOrUnknownReference", "ActorPlan revision trigger exceeds NPC knowledge.");
      }
    }
    if ((due === null) === (trigger === null)) {
      return rejected("invalidRulesInput", "ActorPlan revision requires exactly one due or trigger.");
    }
    return sequence("committed", profiles, state, root, [{
      eventType: "NpcPlanRevised",
      payload: {
        npcId: selected.npcId,
        planId: plan.planId as string,
        priorRevision: plan.revision as string,
        revision: nextRevision,
        decision: "revise",
        reason: revision.reason,
        premiseRefs,
        nextStep: revision.nextStep,
        resourceRefs,
        due,
        trigger,
        trace: {
          factRef: revision.trace.factRef,
          description: revision.trace.description,
          visibilityPolicyRef: revision.trace.visibilityPolicyRef,
        },
        alternateTarget: {
          targetRef: revision.alternateTarget.targetRef,
          reason: revision.alternateTarget.reason,
        },
        causedByRootActionId: input.causedByRootActionId as string,
      },
      visibilityPolicyId: "visibility:kp-internal",
      secrecy: "internal",
      reads: [
        `npc-plan:${String(plan.planId)}`,
        ...factionPlanScope,
        ...premiseRefs.flatMap((reference) => {
          const scope = actorPlanPremiseScope(state, selected.npcId, reference);
          return scope === undefined ? [] : [scope];
        }),
        ...actorPlanResourceScopes(state, selected.npcId, planFactionRef, resourceRefs),
        `activity:${String(activity.activityId)}`,
        `timeline:${selected.timelineId}`,
        `fact:${revision.trace.factRef}`,
        `definition:${revision.trace.factRef}`,
        revision.alternateTarget.targetRef in state.entities
          ? `entity:${revision.alternateTarget.targetRef}`
          : `scene:${revision.alternateTarget.targetRef}`,
        ...premiseRefs.map((ref) => `actor-plan-premise:${ref}`),
      ],
      writes: [`npc-plan:${String(plan.planId)}`, ...factionPlanScope],
    }]);
  }
  if (input.decision === "defer") {
    const timelineNow = state.fictionTimelines[selected.timelineId]?.nowMicros;
    const nextRevision = isNonEmptyString(plan.revision)
      && /^(0|[1-9][0-9]*)$/.test(plan.revision)
      ? (BigInt(plan.revision) + 1n).toString()
      : undefined;
    if (
      !isNonEmptyString(input.reason)
      || typeof input.deferUntilFictionMicros !== "string"
      || !/^(0|[1-9][0-9]*)$/.test(input.deferUntilFictionMicros)
      || timelineNow === undefined
      || BigInt(input.deferUntilFictionMicros) <= BigInt(timelineNow)
      || nextRevision === undefined
      || !Array.isArray(plan.premiseRefs)
      || !Array.isArray(plan.resourceRefs)
      || !plan.premiseRefs.every((reference) =>
        isNonEmptyString(reference)
        && actorPlanPremiseIsAvailable(state, selected.npcId, reference))
      || !isRecord(plan.trace)
      || !isRecord(plan.alternateTarget)
      || !actorPlanResourcesAreAvailable(
        state,
        selected.npcId,
        planFactionRef,
        plan.resourceRefs,
      )
    ) return rejected("invalidRulesInput", "ActorPlan deferral must name a later fiction instant and reason.");
    return sequence("committed", profiles, state, root, [{
      eventType: "NpcPlanRevised",
      payload: {
        npcId: selected.npcId,
        planId: plan.planId as string,
        priorRevision: plan.revision,
        revision: nextRevision,
        decision: "defer",
        reason: input.reason,
        premiseRefs: plan.premiseRefs as string[],
        nextStep: plan.nextStep as string,
        resourceRefs: plan.resourceRefs as string[],
        due: { kind: "fictionTime", atFictionMicros: input.deferUntilFictionMicros },
        trigger: null,
        trace: plan.trace as EventPayloadByType["NpcPlanRevised"]["trace"],
        alternateTarget: plan.alternateTarget as EventPayloadByType["NpcPlanRevised"]["alternateTarget"],
        causedByRootActionId: input.causedByRootActionId as string,
      },
      visibilityPolicyId: "visibility:kp-internal",
      secrecy: "internal",
      reads: [
        `npc-plan:${String(plan.planId)}`,
        ...factionPlanScope,
        ...planPremiseScopes,
        ...planResourceScopes,
        `activity:${String(activity.activityId)}`,
        `timeline:${selected.timelineId}`,
        `fact:${String(plan.trace.factRef)}`,
        `definition:${String(plan.trace.factRef)}`,
        String(plan.alternateTarget.targetRef) in state.entities
          ? `entity:${String(plan.alternateTarget.targetRef)}`
          : `scene:${String(plan.alternateTarget.targetRef)}`,
      ],
      writes: [`npc-plan:${String(plan.planId)}`, ...factionPlanScope],
    }]);
  }
  if (input.decision === "cancel") {
    if (!isNonEmptyString(input.reason) || !isNonEmptyString(plan.revision)) {
      return rejected("invalidRulesInput", "ActorPlan cancellation requires an explicit reason.");
    }
    return sequence("committed", profiles, state, root, [{
      eventType: "NpcPlanCancelled",
      payload: {
        npcId: selected.npcId,
        planId: plan.planId as string,
        priorRevision: plan.revision,
        reason: input.reason,
        causedByRootActionId: input.causedByRootActionId as string,
      },
      visibilityPolicyId: "visibility:kp-internal",
      secrecy: "internal",
      reads: [
        `npc-plan:${String(plan.planId)}`,
        ...factionPlanScope,
        `activity:${String(activity.activityId)}`,
      ],
      writes: [`npc-plan:${String(plan.planId)}`, ...factionPlanScope],
    }, {
      eventType: "ActivityInterrupted",
      payload: {
        activityId: activity.activityId,
        cause: {
          kind: "actorPlanCancelled",
          planId: plan.planId,
          causedByRootActionId: input.causedByRootActionId,
        },
      },
      visibilityPolicyId: `visibility:npc:${selected.npcId}`,
      secrecy: "internal",
      reads: [`npc-plan:${String(plan.planId)}`],
      writes: [`activity:${String(activity.activityId)}`],
    }]);
  }
  const alternateTarget = isRecord(plan.alternateTarget) ? plan.alternateTarget : undefined;
  const targetRef = input.targetRef === undefined
    ? npc.sceneId
    : isNonEmptyString(input.targetRef)
      && alternateTarget?.targetRef === input.targetRef
      && (input.targetRef in state.entities || input.targetRef in state.scenes)
      ? input.targetRef
      : undefined;
  if (targetRef === undefined) {
    return rejected("privateOrUnknownReference", "The selected ActorPlan target is unavailable.");
  }
  if (premiseRefs.some((reference) =>
    !actorPlanPremiseIsAvailable(state, selected.npcId, reference))) {
    return rejected("privateOrUnknownReference", "The selected ActorPlan premise is no longer available.");
  }
  const actionDraft: Draft | undefined = factionPlan === undefined
    ? plan.factionRef === null
      && actorPlanResourcesAreAvailable(state, selected.npcId, null, plan.resourceRefs)
      ? {
        eventType: "NpcActionCommitted",
        payload: {
          npcId: selected.npcId,
          planId: plan.planId as string,
          decision: "execute",
          causedByRootActionId: input.causedByRootActionId as string,
          nextStep: plan.nextStep as string,
          traceFactRef: trace.factRef,
          targetRef,
        },
        visibilityPolicyId: "visibility:kp-internal",
        secrecy: "internal",
        reads: [
          `npc-plan:${String(plan.planId)}`,
          ...planResourceScopes,
          `activity:${String(activity.activityId)}`,
          `timeline:${selected.timelineId}`,
          targetRef in state.entities ? `entity:${targetRef}` : `scene:${targetRef}`,
        ],
        writes: [`npc-plan:${String(plan.planId)}`],
      }
      : undefined
    : isNonEmptyString(factionPlan.factionId)
      && plan.factionRef === factionPlan.factionId
      && factionPlan.actingNpcId === selected.npcId
      && factionPlan.status === "scheduled"
      && Array.isArray(factionPlan.resourceRefs)
      && factionPlan.resourceRefs.every(isNonEmptyString)
      && JSON.stringify(plan.resourceRefs) === JSON.stringify(factionPlan.resourceRefs)
      && actorPlanResourcesAreAvailable(
        state,
        selected.npcId,
        factionPlan.factionId,
        factionPlan.resourceRefs,
      )
      ? {
          eventType: "FactionActionCommitted",
          payload: {
            factionId: factionPlan.factionId,
            planId: plan.planId as string,
            actingNpcId: selected.npcId,
            decision: "execute",
            causedByRootActionId: input.causedByRootActionId as string,
            nextStep: plan.nextStep as string,
            traceFactRef: trace.factRef,
            targetRef,
            resourceRefs: factionPlan.resourceRefs as string[],
          },
          visibilityPolicyId: "visibility:kp-internal",
          secrecy: "internal",
          reads: [
            `npc-plan:${String(plan.planId)}`,
            `faction-plan:${String(plan.planId)}`,
            ...planResourceScopes,
            `activity:${String(activity.activityId)}`,
            `timeline:${selected.timelineId}`,
            targetRef in state.entities ? `entity:${targetRef}` : `scene:${targetRef}`,
          ],
          writes: [
            `npc-plan:${String(plan.planId)}`,
            `faction-plan:${String(plan.planId)}`,
          ],
        }
      : undefined;
  if (actionDraft === undefined) {
    return rejected("invalidWorldState", "The selected FactionPlan binding is unavailable.");
  }
  const factionAdvanceDraft: Draft | undefined = actionDraft.eventType === "FactionActionCommitted"
    ? {
        eventType: "FactionPlanAdvanced",
        payload: {
          factionId: (actionDraft.payload as EventPayloadByType["FactionActionCommitted"]).factionId,
          planId: plan.planId as string,
          actingNpcId: selected.npcId,
          causeFactIds: premiseRefs,
          action: plan.nextStep as string,
        },
        visibilityPolicyId: `visibility:npc:${selected.npcId}`,
        secrecy: "internal",
        reads: [
          `npc-plan:${String(plan.planId)}`,
          `faction-plan:${String(plan.planId)}`,
          ...planPremiseScopes,
          ...planResourceScopes,
          ...premiseRefs.map((reference) => `actor-plan-premise:${reference}`),
        ],
        writes: [`faction-plan:${String(plan.planId)}`],
      }
    : undefined;
  return sequence("committed", profiles, state, root, [
    actionDraft,
    ...(factionAdvanceDraft === undefined ? [] : [factionAdvanceDraft]),
    {
      eventType: "CanonicalFactDeclared",
      payload: {
        fact: {
          id: trace.factRef,
          kind: "npcPlanTrace",
          subjectRefs: [selected.npcId, targetRef].sort(),
          value: {
            description: trace.description,
            planId: plan.planId,
            targetRef,
            causedByRootActionId: input.causedByRootActionId,
          },
          visibilityPolicyId: trace.visibilityPolicyRef,
          source: "npcOrFactionAction",
          causalParentIds: [],
        },
      },
      visibilityPolicyId: trace.visibilityPolicyRef,
      secrecy: "public",
      reads: [`npc-plan:${String(plan.planId)}`],
      creates: [`fact:${trace.factRef}`],
    }, {
      eventType: "ActivityCompleted",
      payload: { activityId: activity.activityId },
      visibilityPolicyId: `visibility:npc:${selected.npcId}`,
      secrecy: "internal",
      reads: [`npc-plan:${String(plan.planId)}`],
      writes: [`activity:${String(activity.activityId)}`],
    },
  ]);
}

function simpleCampaignEvent(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (![
    "openSceneQuestion",
    "commitMeaningfulFailure",
    "changeRetryCondition",
    "answerSceneQuestion",
    "raiseEndingCandidate",
    "concludeStory",
    "recordEpilogueChoice",
    "startSequel",
  ].includes(String(input.kind))) {
    return undefined;
  }
  const root = rootAction(state, input);
  if (root === undefined) return rejected("duplicateRootAction", "Proposal id already committed or missing.");
  switch (input.kind) {
    case "openSceneQuestion":
      if (!hasExactKeys(input, ["kind", "proposalId", "question", "sceneQuestionId"]) || !isNonEmptyString(input.sceneQuestionId) || !isNonEmptyString(input.question)) return rejected("invalidRulesInput", "Scene question is not canonical.");
      return sequence("committed", profiles, state, root, [{ eventType: "SceneQuestionOpened", payload: { sceneQuestionId: input.sceneQuestionId, question: input.question } }]);
    case "commitMeaningfulFailure": {
      if (!hasExactKeys(input, ["characterId", "consequences", "factualCause", "goalId", "kind", "methodFingerprint", "proposalId"]) || !isRecord(input.consequences) || Object.keys(input.consequences).length === 0 || ![input.characterId, input.goalId, input.methodFingerprint, input.factualCause].every(isNonEmptyString)) return rejected("invalidRulesInput", "Meaningful failure is not canonical.");
      const drafts: Draft[] = [{ eventType: "MeaningfulFailureCommitted", payload: { characterId: input.characterId as string, goalId: input.goalId as string, methodFingerprint: input.methodFingerprint as string, factualCause: input.factualCause as string, consequences: structuredClone(input.consequences) } }];
      if (typeof input.consequences.fictionTimeCostMicros === "string" && /^[1-9][0-9]*$/.test(input.consequences.fictionTimeCostMicros)) drafts.push({ eventType: "FictionTimeAdvanced", payload: { durationMicros: input.consequences.fictionTimeCostMicros, reason: input.factualCause as string } });
      return sequence("committed", profiles, state, root, drafts);
    }
    case "changeRetryCondition":
      if (!hasExactKeys(input, ["change", "characterId", "evidence", "goalId", "kind", "proposalId"]) || ![input.change, input.characterId, input.evidence, input.goalId].every(isNonEmptyString) || !(input.goalId as string in state.campaignRuntime.meaningfulFailures)) return rejected("invalidRulesInput", "Retry change is not canonical.");
      return sequence("committed", profiles, state, root, [{ eventType: "RetryConditionChanged", payload: { characterId: input.characterId as string, goalId: input.goalId as string, change: input.change as string, evidence: input.evidence as string } }]);
    case "answerSceneQuestion": {
      const refs = canonicalStrings(input.answerFactIds);
      if (!hasExactKeys(input, ["answerFactIds", "kind", "proposalId", "sceneQuestionId"]) || !isNonEmptyString(input.sceneQuestionId) || refs === undefined || refs.some((id) => !(id in state.canonicalFacts))) return rejected("invalidRulesInput", "Scene answer is not canonical.");
      return sequence("committed", profiles, state, root, [{ eventType: "SceneQuestionAnswered", payload: { sceneQuestionId: input.sceneQuestionId, answerFactIds: refs } }]);
    }
    case "raiseEndingCandidate": {
      const basis = canonicalStrings(input.basisFactIds); const unresolved = canonicalStrings(input.unresolvedConsequences);
      if (!hasExactKeys(input, ["basisFactIds", "endingCandidateId", "kind", "proposalId", "unresolvedConsequences"])
        || !isNonEmptyString(input.endingCandidateId)
        || input.endingCandidateId in state.campaignRuntime.endingCandidates
        || basis === undefined
        || basis.length === 0
        || unresolved === undefined
        || basis.some((id) => !(id in state.canonicalFacts))
        || unresolved.some((id) => !(id in state.canonicalFacts)
          && !state.campaignRuntime.unresolvedThreats.includes(id))) {
        return rejected("invalidRulesInput", "Ending candidate is not canonical.");
      }
      return sequence("committed", profiles, state, root, [{ eventType: "EndingCandidateRaised", payload: { endingCandidateId: input.endingCandidateId, basisFactIds: basis, unresolvedConsequences: unresolved } }]);
    }
    case "concludeStory": {
      const consequences = canonicalStrings(input.longTermConsequences);
      const unresolvedMechanics = Object.keys(state.pendingInputs).length > 0
        || Object.keys(state.internalContinuations).length > 0
        || Object.keys(state.combatRuntime.pendingInputs).length > 0
        || Object.values(state.combatRuntime.encounters).some((encounter) =>
          encounter.status !== "concluded");
      if (!hasExactKeys(input, ["endingCandidateId", "kind", "longTermConsequences", "outcome", "proposalId", "storyId"])
        || ![input.storyId, input.endingCandidateId, input.outcome].every(isNonEmptyString)
        || consequences === undefined
        || !(input.endingCandidateId as string in state.campaignRuntime.endingCandidates)
        || (input.storyId as string) in state.campaignRuntime.stories
        || unresolvedMechanics) {
        return rejected(
          unresolvedMechanics ? "pendingInputUnresolved" : "invalidRulesInput",
          unresolvedMechanics
            ? "Story conclusion cannot bypass pending player or mechanical resolution."
            : "Story conclusion is not canonical.",
        );
      }
      return sequence("concluded", profiles, state, root, [{ eventType: "StoryConcluded", payload: { storyId: input.storyId as string, endingCandidateId: input.endingCandidateId as string, outcome: input.outcome as string, longTermConsequences: consequences } }]);
    }
    case "recordEpilogueChoice":
      if (!hasExactKeys(input, ["characterId", "choice", "kind", "proposalId", "storyId"])
        || ![input.characterId, input.choice, input.storyId].every(isNonEmptyString)
        || state.campaignRuntime.stories[input.storyId as string]?.status !== "concluded"
        || state.entities[input.characterId as string] === undefined
        || `${input.storyId as string}:${input.characterId as string}` in state.campaignRuntime.epilogues) {
        return rejected("invalidRulesInput", "Epilogue choice is not canonical.");
      }
      return sequence("committed", profiles, state, root, [{ eventType: "EpilogueChoiceRecorded", payload: { characterId: input.characterId as string, storyId: input.storyId as string, choice: input.choice as string }, visibilityPolicyId: `visibility:knowledge-holder:${input.characterId}`, secrecy: "private" }]);
    case "startSequel": {
      const anchors = canonicalStrings(input.anchorFactIds);
      const campaign = state.campaignRuntime.campaign;
      const campaignId = isRecord(campaign) && isNonEmptyString(campaign.campaignId)
        ? campaign.campaignId
        : undefined;
      const fromChapterId = isRecord(campaign) && isNonEmptyString(campaign.currentChapterId)
        ? campaign.currentChapterId
        : undefined;
      const fromChapter = fromChapterId === undefined
        ? undefined
        : state.campaignRuntime.chapters[fromChapterId];
      const ordinal = typeof fromChapter?.ordinal === "string"
        && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(fromChapter.ordinal)
        ? (BigInt(fromChapter.ordinal) + 1n).toString()
        : undefined;
      if (!hasExactKeys(input, [
        "activityTransitions", "anchorFactIds", "chapterId", "kind", "priorStoryId",
        "proposalId", "sceneQuestion", "sequelStoryId",
      ])
        || ![input.chapterId, input.priorStoryId, input.sequelStoryId, input.sceneQuestion]
          .every(isNonEmptyString)
        || anchors === undefined
        || anchors.some((id) => !(id in state.canonicalFacts)
          && !state.campaignRuntime.unresolvedThreats.includes(id))
        || state.campaignRuntime.stories[input.priorStoryId as string]?.status !== "concluded"
        || (input.sequelStoryId as string) in state.campaignRuntime.stories
        || (input.chapterId as string) in state.campaignRuntime.chapters
        || !Array.isArray(input.activityTransitions)
        || campaignId === undefined
        || fromChapterId === undefined
        || ordinal === undefined) {
        return rejected("invalidRulesInput", "Sequel anchors are unavailable.");
      }
      const transitioned = transitionChapter(profiles, state, {
        kind: "transitionChapter",
        proposalId: root,
        campaignId,
        fromChapterId,
        toChapterId: input.chapterId,
        ordinal,
        reason: "玩家明确开启续篇",
        continuityPolicy: "preserveAuthoritativeFacts",
        storyAnchorRefs: anchors,
        sceneQuestion: input.sceneQuestion,
        activityTransitions: structuredClone(input.activityTransitions),
      });
      if (transitioned.kind !== "committed") return transitioned;
      const sequel = sequence("committed", profiles, transitioned.state, root, [{
        eventType: "SequelStarted",
        payload: {
          priorStoryId: input.priorStoryId as string,
          sequelStoryId: input.sequelStoryId as string,
          chapterId: input.chapterId as string,
          anchorFactIds: anchors,
          sceneQuestion: input.sceneQuestion as string,
        },
      }]);
      if (sequel.kind !== "committed") return sequel;
      return combineCommittedTransitions(state, transitioned, sequel);
    }
    default:
      return undefined;
  }
}

function grantMilestone(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["campaignId", "characterId", "kind", "proposalId", "sourceFactIds"])) return rejected("invalidRulesInput", "Milestone input is not canonical.");
  const root = rootAction(state, input); const actor = character(state, input.characterId); const sourceFactIds = canonicalStrings(input.sourceFactIds);
  const options = actor === undefined ? undefined : advancementOptions(actor);
  if (state.campaignRuntime.campaign?.advancementProfile !== "milestone") {
    return rejected("invalidRulesInput", "Milestone advancement is unavailable under the campaign's XP profile.");
  }
  if (root === undefined || actor?.kind !== "player" || options === undefined || state.campaignRuntime.campaign?.campaignId !== input.campaignId || sourceFactIds === undefined || sourceFactIds.length === 0 || sourceFactIds.some((id) => !(id in state.canonicalFacts))) return rejected("privateOrUnknownReference", "Milestone source or advancement profile is unavailable.");
  const pendingInputId = `pending:${root}`;
  return sequence("awaitingInput", profiles, state, root, [{ eventType: "AdvancementAvailable", payload: { pendingInputId, campaignId: input.campaignId as string, characterId: actor.id, sourceFactIds, options }, visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`, secrecy: "private" }], {
    pending: { pendingInputId, kind: "advancementChoice", question: "选择本次里程碑成长。", controller: { kind: "character", characterId: actor.id }, options },
  });
}

function awardExperience(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "amount",
    "campaignId",
    "characterId",
    "kind",
    "proposalId",
    "sourceFactIds",
  ])) return rejected("invalidRulesInput", "Experience award input is not canonical.");
  const root = rootAction(state, input);
  const actor = character(state, input.characterId);
  const sourceFactIds = canonicalStrings(input.sourceFactIds);
  const amount = Number(input.amount);
  const campaign = state.campaignRuntime.campaign;
  if (
    root === undefined
    || campaign?.campaignId !== input.campaignId
    || campaign?.advancementProfile !== "srdXp2014"
    || actor?.kind !== "player"
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || amount > MAX_EXPERIENCE_AWARD
    || sourceFactIds === undefined
    || sourceFactIds.length === 0
    || sourceFactIds.some((id) => !(id in state.canonicalFacts))
  ) return rejected("invalidRulesInput", "Experience award is unavailable or exceeds the canonical bound.");
  const priorTotal = actor.experiencePoints ?? 0;
  const total = priorTotal + amount;
  if (!Number.isSafeInteger(priorTotal) || priorTotal < 0 || !Number.isSafeInteger(total)) {
    return rejected("invalidRulesInput", "Experience total exceeds the canonical integer range.");
  }
  const drafts: Draft[] = [{
    eventType: "ExperienceAwarded",
    payload: {
      amount,
      campaignId: input.campaignId as string,
      characterId: actor.id,
      sourceFactIds,
      total,
    },
    visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
    secrecy: "private",
    writes: [`entity:${actor.id}`, `receipt:${root}`],
  }];
  const afterAward = { ...structuredClone(actor), experiencePoints: total };
  const alreadyPending = Object.values(state.pendingInputs).some((pending) =>
    pending.kind === "advancementChoice" && pending.controllerCharacterId === actor.id);
  const options = advancementOptions(afterAward);
  if (!alreadyPending && options !== undefined && experienceQualifiesForNextLevel(afterAward)) {
    const pendingInputId = `pending:${root}`;
    drafts.push({
      eventType: "AdvancementAvailable",
      payload: {
        pendingInputId,
        campaignId: input.campaignId as string,
        characterId: actor.id,
        sourceFactIds,
        options,
      },
      visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
      secrecy: "private",
      creates: [`pending:${pendingInputId}`],
    });
    return sequence("awaitingInput", profiles, state, root, drafts, {
      pending: {
        pendingInputId,
        kind: "advancementChoice",
        question: "选择本次经验值成长。",
        controller: { kind: "character", characterId: actor.id },
        options,
      },
    });
  }
  return sequence("committed", profiles, state, root, drafts);
}

function recordAdvancementChoice(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["characterId", "choice", "kind", "pendingInputId", "proposalId"])
    || !isRecord(input.choice)) return rejected("invalidRulesInput", "Advancement choice is not canonical.");
  const root = rootAction(state, input);
  const actor = character(state, input.characterId);
  const pending = isNonEmptyString(input.pendingInputId)
    ? state.pendingInputs[input.pendingInputId]
    : undefined;
  const currentOptions = actor === undefined ? undefined : advancementOptions(actor);
  if (root === undefined || actor?.kind !== "player" || pending?.kind !== "advancementChoice"
    || pending.controllerCharacterId !== actor.id
    || currentOptions === undefined || pending.options === undefined
    || canonicalSha256(currentOptions) !== canonicalSha256(pending.options)) {
    return rejected("invalidRulesInput", "Advancement choice is unavailable or stale.");
  }
  const advanced = advanceCharacter2014(actor, input.choice);
  if (!advanced.ok) return rejected("invalidRulesInput", advanced.message);
  const compiled = compileStaticCharacterCombat(
    advanced.character,
    characterBuildSnapshot(advanced.character),
    state.campaignRuntime.itemSystem,
    state.combatRuntime.definitions,
  );
  const control = state.characterControls[actor.id];
  const seat = control === undefined ? undefined : state.seats[control.seatId];
  const initialCombat = buildPlayerCombatEntity(
    profiles,
    advanced.character,
    compiled,
    seat?.principalId ?? actor.controllerPrincipalId,
    undefined,
    state.campaignRuntime.itemSystem,
  );
  const combatEntity = synchronizePlayerCombatEntity(
    state.combatRuntime.entities[actor.id],
    initialCombat,
  );
  const drafts: Draft[] = [
    {
      eventType: "CharacterAdvanced",
      payload: {
        pendingInputId: input.pendingInputId as string,
        characterId: actor.id,
        choice: advanced.choice,
        resultingCharacter: advanced.character,
      },
      visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
      secrecy: "private",
      writes: [`entity:${actor.id}`, `pending:${input.pendingInputId}`],
    },
    {
      eventType: "CharacterMechanicsSynchronized",
      payload: {
        characterId: actor.id,
        combatEntity,
        definitions: Object.values(compiled.definitions)
          .sort((left, right) => String(left.definitionId).localeCompare(String(right.definitionId))),
      },
      visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
      secrecy: "private",
      writes: [`combat-entity:${actor.id}`],
    },
  ];
  const campaign = state.campaignRuntime.campaign;
  const nextOptions = advancementOptions(advanced.character);
  const shouldOpenNext = campaign?.advancementProfile === "srdXp2014"
    && nextOptions !== undefined
    && experienceQualifiesForNextLevel(advanced.character);
  if (shouldOpenNext) {
    const pendingInputId = `pending:${root}:level:${nextOptions.newLevel}`;
    const sourceFactIds = pending.sourceFactIds ?? [];
    drafts.push({
      eventType: "AdvancementAvailable",
      payload: {
        pendingInputId,
        campaignId: campaign.campaignId as string,
        characterId: actor.id,
        sourceFactIds,
        options: nextOptions,
      },
      visibilityPolicyId: `visibility:knowledge-holder:${actor.id}`,
      secrecy: "private",
      creates: [`pending:${pendingInputId}`],
    });
    return sequence("awaitingInput", profiles, state, root, drafts, {
      pending: {
        pendingInputId,
        kind: "advancementChoice",
        question: "选择本次经验值成长。",
        controller: { kind: "character", characterId: actor.id },
        options: nextOptions,
      },
    });
  }
  return sequence("committed", profiles, state, root, drafts);
}

function concludeChapter(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["campaignId", "chapterId", "continuityPolicy", "kind", "proposalId", "reason"])) return rejected("invalidRulesInput", "Chapter conclusion is not canonical.");
  const root = rootAction(state, input);
  if (root === undefined || ![input.campaignId, input.chapterId, input.reason, input.continuityPolicy].every(isNonEmptyString) || state.campaignRuntime.campaign?.campaignId !== input.campaignId || state.campaignRuntime.chapters[input.chapterId as string]?.status !== "active" || input.continuityPolicy !== "preserveAuthoritativeFacts") return rejected("invalidRulesInput", "Chapter conclusion is unavailable.");
  return sequence("committed", profiles, state, root, [{ eventType: "ChapterConcluded", payload: { campaignId: input.campaignId as string, chapterId: input.chapterId as string, reason: input.reason as string, continuityPolicy: input.continuityPolicy } }]);
}

function startChapter(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["campaignId", "chapterId", "kind", "ordinal", "proposalId", "sceneQuestion", "storyAnchorRefs"])) return rejected("invalidRulesInput", "Chapter start is not canonical.");
  const root = rootAction(state, input); const anchors = canonicalStrings(input.storyAnchorRefs);
  const moduleRef = state.campaignRuntime.campaign?.moduleRef;
  if (root === undefined || ![input.campaignId, input.chapterId, input.ordinal, input.sceneQuestion].every(isNonEmptyString) || state.campaignRuntime.campaign?.campaignId !== input.campaignId || !isProfileRef(moduleRef) || (input.chapterId as string) in state.campaignRuntime.chapters || typeof input.ordinal !== "string" || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(input.ordinal) || anchors === undefined || anchors.some((id) => !(id in state.canonicalFacts) && !state.campaignRuntime.unresolvedThreats.includes(id))) return rejected("invalidRulesInput", "Chapter anchors are unavailable.");
  return sequence("committed", profiles, state, root, [{ eventType: "ChapterStarted", payload: { campaignId: input.campaignId as string, chapterId: input.chapterId as string, ordinal: input.ordinal, storyAnchorRefs: anchors, sceneQuestion: input.sceneQuestion as string, moduleRef: structuredClone(moduleRef) } }]);
}

function transitionChapter(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult {
  if (!hasExactKeys(input, [
    "activityTransitions",
    "campaignId",
    "continuityPolicy",
    "fromChapterId",
    "kind",
    "ordinal",
    "proposalId",
    "reason",
    "sceneQuestion",
    "storyAnchorRefs",
    "toChapterId",
  ])) return rejected("invalidRulesInput", "Chapter transition is not canonical.");
  const root = rootAction(state, input);
  const anchors = canonicalStrings(input.storyAnchorRefs);
  const currentModuleRef = state.campaignRuntime.campaign?.moduleRef;
  const campaign = state.campaignRuntime.campaign;
  const currentChapterId = isRecord(campaign) && isNonEmptyString(campaign.currentChapterId)
    ? campaign.currentChapterId
    : undefined;
  const currentChapter = currentChapterId === undefined
    ? undefined
    : state.campaignRuntime.chapters[currentChapterId];
  const expectedOrdinal = typeof currentChapter?.ordinal === "string"
    && CANONICAL_UNSIGNED_INTEGER_PATTERN.test(currentChapter.ordinal)
    ? (BigInt(currentChapter.ordinal) + 1n).toString()
    : undefined;
  if (root === undefined
    || ![
      input.campaignId,
      input.fromChapterId,
      input.toChapterId,
      input.ordinal,
      input.reason,
      input.sceneQuestion,
    ].every(isNonEmptyString)
    || input.continuityPolicy !== "preserveAuthoritativeFacts"
    || state.campaignRuntime.campaign?.campaignId !== input.campaignId
    || !isProfileRef(currentModuleRef)
    || input.fromChapterId !== currentChapterId
    || state.campaignRuntime.chapters[input.fromChapterId as string]?.status !== "active"
    || (input.toChapterId as string) in state.campaignRuntime.chapters
    || !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(input.ordinal as string)
    || input.ordinal !== expectedOrdinal
    || anchors === undefined
    || anchors.some((id) => !(id in state.canonicalFacts)
      && !state.campaignRuntime.unresolvedThreats.includes(id))) {
    return rejected("invalidRulesInput", "Chapter transition references are unavailable.");
  }
  if (Object.keys(state.pendingInputs).length > 0
    || Object.keys(state.internalContinuations).length > 0
    || Object.keys(state.combatRuntime.pendingInputs).length > 0
    || Object.values(state.combatRuntime.encounters).some((encounter) =>
      encounter.status !== "concluded")) {
    return rejected("pendingInputUnresolved", "Chapter transition cannot bypass pending player or mechanical resolution.");
  }
  if (!Array.isArray(input.activityTransitions)) {
    return rejected("invalidRulesInput", "Chapter activities require explicit dispositions.");
  }
  const transitions: ChapterActivityTransition[] = [];
  for (const candidate of input.activityTransitions) {
    if (!isRecord(candidate)
      || !hasExactKeys(candidate, ["activityId", "disposition"])
      || !isNonEmptyString(candidate.activityId)
      || !["continue", "summarize", "interrupt", "complete"].includes(String(candidate.disposition))) {
      return rejected("invalidRulesInput", "Chapter activity disposition is not canonical.");
    }
    transitions.push({
      activityId: candidate.activityId,
      disposition: candidate.disposition as ChapterActivityTransition["disposition"],
    });
  }
  transitions.sort((left, right) => left.activityId.localeCompare(right.activityId));
  if (new Set(transitions.map(({ activityId }) => activityId)).size !== transitions.length) {
    return rejected("invalidRulesInput", "Chapter activity dispositions must be unique.");
  }
  const activeActivityIds = Object.values(state.campaignRuntime.activities)
    .filter((activity) => activity.status === "active" && isNonEmptyString(activity.activityId))
    .map((activity) => activity.activityId as string)
    .sort();
  if (canonicalSha256(activeActivityIds) !== canonicalSha256(transitions.map(({ activityId }) => activityId))) {
    return rejected("pendingInputUnresolved", "Every active Activity needs an explicit chapter disposition.");
  }
  let manifestState = structuredClone(state);
  const interruptionCause = {
    kind: "chapterTransition",
    campaignId: input.campaignId as string,
    fromChapterId: input.fromChapterId as string,
    toChapterId: input.toChapterId as string,
  };
  const drafts: Draft[] = [];
  for (const transition of transitions) {
    let transitionDrafts: Draft[] = [];
    if (transition.disposition === "interrupt") {
      const activity = manifestState.campaignRuntime.activities[transition.activityId];
      if (activity?.status !== "active") {
        return rejected("invalidRulesInput", "Interrupted chapter Activity is unavailable.");
      }
      transitionDrafts = [{
        eventType: "ActivityInterrupted",
        payload: { activityId: transition.activityId, cause: structuredClone(interruptionCause) },
      }];
    } else if (transition.disposition === "complete") {
      const prepared = prepareActivityCompletion(profiles, manifestState, root, transition.activityId);
      if (prepared.kind === "rejected") return prepared.result;
      if (prepared.kind === "awaitingRandomness") {
        return rejected(
          "pendingInputUnresolved",
          "An Activity requiring authoritative randomness must complete before the chapter transition.",
        );
      }
      transitionDrafts = prepared.drafts;
    }
    if (transitionDrafts.length === 0) continue;
    drafts.push(...transitionDrafts);
    const simulated = sequence("committed", profiles, manifestState, root, transitionDrafts);
    if (simulated.kind !== "committed") {
      return rejected("invalidWorldState", "Chapter Activity disposition could not be simulated canonically.");
    }
    manifestState = simulated.state;
  }
  const manifest = campaignContinuityManifest(manifestState, transitions);
  drafts.push(
    {
      eventType: "ChapterConcluded",
      payload: {
        campaignId: input.campaignId as string,
        chapterId: input.fromChapterId as string,
        reason: input.reason as string,
        continuityPolicy: input.continuityPolicy,
      },
    },
    {
      eventType: "ChapterContinuityRecorded",
      payload: {
        campaignId: input.campaignId as string,
        fromChapterId: input.fromChapterId as string,
        toChapterId: input.toChapterId as string,
        manifest,
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
    },
    {
      eventType: "ChapterStarted",
      payload: {
        campaignId: input.campaignId as string,
        chapterId: input.toChapterId as string,
        ordinal: input.ordinal,
        storyAnchorRefs: anchors,
        sceneQuestion: input.sceneQuestion as string,
        moduleRef: structuredClone(currentModuleRef),
      },
    },
  );
  return sequence("committed", profiles, state, root, drafts);
}

function retireCampaignCharacter(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["characterId", "continueAsNpc", "kind", "proposalId", "reason"])) return rejected("invalidRulesInput", "Retirement input is not canonical.");
  const root = rootAction(state, input); const actor = character(state, input.characterId); const control = isNonEmptyString(input.characterId) ? state.characterControls[input.characterId] : undefined;
  const activeEncounter = actor === undefined ? undefined : Object.values(state.combatRuntime.encounters)
    .find((encounter) => encounter.status !== "concluded"
      && Array.isArray(encounter.participantEntityIds)
      && encounter.participantEntityIds.includes(actor.id));
  if (root === undefined || actor?.kind !== "player" || control === undefined
    || activeEncounter !== undefined || !isNonEmptyString(input.reason)
    || typeof input.continueAsNpc !== "boolean") {
    return rejected("privateOrUnknownReference", "Retirement reference is unavailable or combat is active.");
  }
  return sequence("committed", profiles, state, root, [{ eventType: "CharacterRetired", payload: { characterId: actor.id, controllingSeatId: control.seatId, reason: input.reason, continueAsNpc: input.continueAsNpc } }]);
}

function introduceCampaignSuccessor(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["controllerPrincipalId", "kind", "predecessorCharacterId", "proposalId", "successor", "worldEntry"])
    || !isRecord(input.successor)) return rejected("invalidRulesInput", "Successor input is not canonical.");
  const root = rootAction(state, input); const predecessor = isNonEmptyString(input.predecessorCharacterId) ? state.entities[input.predecessorCharacterId] : undefined;
  const seat = predecessor?.lastControllerSeatId === undefined
    ? undefined
    : state.seats[predecessor.lastControllerSeatId];
  const nextOrdinal = Object.values(state.entities).reduce((maximum, entry) => Math.max(maximum, Number(entry.entityOrdinal)), 0) + 1;
  const successor = canonicalControlledCharacter(profiles, input.successor, String(nextOrdinal));
  if (root === undefined || predecessor === undefined
    || !["dead", "retired", "missing", "npcTransitioned"].includes(predecessor.tenureStatus)
    || seat?.status !== "active"
    || seat.principalId !== input.controllerPrincipalId
    || state.multiplayerRuntime.members[seat.principalId]?.status !== "active"
    || successor === undefined
    || successor.id in state.entities
    || !(successor.sceneId in state.scenes)
    || Object.values(state.characterControls).some((control) => control.seatId === seat.id)
    || !isNonEmptyString(input.worldEntry)) {
    return rejected("invalidRulesInput", "Successor or controller reference is unavailable.");
  }
  const characterBuild = isRecord(input.successor.characterBuild)
    ? input.successor.characterBuild
    : characterBuildSnapshot(successor);
  const itemSystem = state.campaignRuntime.itemSystem;
  const itemImport = planPlayerInitialItemImport({
    itemSystem,
    character: successor,
    itemAbilityCatalog: state.combatRuntime.definitions,
  });
  if ("error" in itemImport) {
    return rejected("invalidRulesInput", "Successor starting equipment is unavailable.");
  }
  const eventSuccessor = itemImport.characterBeforeAcquisition;
  const compiled = compileStaticCharacterCombat(
    eventSuccessor,
    characterBuild,
    itemSystem,
    state.combatRuntime.definitions,
  );
  const spawn = allocateDynamicCombatantSpawn(state, successor.sceneId);
  if (spawn.kind === "unavailable") {
    return rejected(
      "spatialCapacityUnavailable",
      "The pinned tactical scene has no available character spawn.",
    );
  }
  const combatEntity = buildPlayerCombatEntity(
    profiles,
    eventSuccessor,
    compiled,
    seat.principalId,
    spawn.position,
    itemSystem,
  );
  return sequence("committed", profiles, state, root, [
    {
      eventType: "SuccessorIntroduced",
      payload: {
        combatEntity,
        predecessorCharacterId: predecessor.id,
        controllerSeatId: seat.id,
        definitions: Object.values(compiled.definitions)
          .sort((left, right) => String(left.definitionId).localeCompare(String(right.definitionId))),
        successor: eventSuccessor,
        worldEntry: input.worldEntry,
      },
      visibilityPolicyId: `visibility:knowledge-holder:${successor.id}`,
      secrecy: "private",
      creates: [
        `entity:${successor.id}`,
        `control:${successor.id}`,
        `combat-entity:${successor.id}`,
      ],
    },
    ...playerInitialItemEventDrafts(itemImport, successor.id, successor.sceneId),
  ]);
}

function establishInheritanceSource(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["kind", "predecessorCharacterId", "proposalId", "source", "successorCharacterId"]) || !isRecord(input.source)
    || !hasExactKeys(input.source, ["authorizations", "kind", "publicClause"])) return rejected("invalidRulesInput", "Inheritance source is not canonical.");
  const predecessorCharacterId = isNonEmptyString(input.predecessorCharacterId)
    ? input.predecessorCharacterId
    : undefined;
  const successorCharacterId = isNonEmptyString(input.successorCharacterId)
    ? input.successorCharacterId
    : undefined;
  const root = rootAction(state, input);
  const authorizations = predecessorCharacterId === undefined || successorCharacterId === undefined
    ? undefined
    : canonicalInheritanceAuthorizations(
      input.source.authorizations,
      predecessorCharacterId,
      successorCharacterId,
    );
  const predecessorStatus = predecessorCharacterId === undefined
    ? undefined
    : state.entities[predecessorCharacterId]?.tenureStatus;
  if (root === undefined
    || predecessorCharacterId === undefined
    || successorCharacterId === undefined
    || !["dead", "retired", "missing", "npcTransitioned"].includes(String(predecessorStatus))
    || state.entities[successorCharacterId]?.tenureStatus !== "active"
    || !["will", "explicitGift", "recovery", "publicRecord", "organizationGrant", "npcIntroduction", "knowledgePropagation"].includes(String(input.source.kind))
    || !isNonEmptyString(input.source.publicClause)
    || authorizations === undefined
    || authorizations.some((authorization) => !inheritanceAuthorizationAvailable(state, authorization))) {
    return rejected("privateOrUnknownReference", "Inheritance source is unavailable.");
  }
  const source = {
    kind: input.source.kind,
    publicClause: input.source.publicClause,
    authorizations,
  };
  const factId = `fact:inheritance:${canonicalSha256({
    predecessorCharacterId,
    successorCharacterId,
    source,
  }).slice("sha256:".length, "sha256:".length + 24)}`;
  if (factId in state.canonicalFacts || factId in state.campaignRuntime.inheritanceSources) {
    return rejected("duplicateRootAction", "Inheritance source is already established.");
  }
  return sequence("committed", profiles, state, root, [{
    eventType: "InheritanceSourceEstablished",
    payload: { predecessorCharacterId, successorCharacterId, factId, source },
    visibilityPolicyId: "visibility:kp-internal",
    secrecy: "internal",
  }]);
}

function transferInheritance(profiles: RuntimeProfileManifest, state: AuthoritativeWorldState, input: JsonRecord): StepResult {
  if (!hasExactKeys(input, ["authorizationId", "kind", "predecessorCharacterId", "proposalId", "sourceFactId", "successorCharacterId"])) return rejected("invalidRulesInput", "Inheritance transfer is not canonical.");
  const root = rootAction(state, input);
  const source = isNonEmptyString(input.sourceFactId)
    ? state.campaignRuntime.inheritanceSources[input.sourceFactId]
    : undefined;
  const sourceBody = isRecord(source?.source) ? source.source : undefined;
  const authorizations = sourceBody === undefined
    ? undefined
    : canonicalInheritanceAuthorizations(
      sourceBody.authorizations,
      String(source?.predecessorCharacterId ?? ""),
      String(source?.successorCharacterId ?? ""),
    );
  const authorization = authorizations?.find(({ authorizationId }) =>
    authorizationId === input.authorizationId);
  if (root === undefined
    || source === undefined
    || authorization === undefined
    || source.predecessorCharacterId !== input.predecessorCharacterId
    || source.successorCharacterId !== input.successorCharacterId) {
    return rejected("inheritanceProvenanceRequired", "Inheritance requires an exact authoritative in-world authorization.");
  }
  const consumedAuthorizationIds = canonicalStrings(source.consumedAuthorizationIds ?? []) ?? [];
  if (consumedAuthorizationIds.includes(authorization.authorizationId)) {
    return rejected("inheritanceAuthorizationConsumed", "Inheritance authorization was already consumed.");
  }
  if (!inheritanceAuthorizationAvailable(state, authorization)) {
    return rejected("inheritanceProvenanceRequired", "Inheritance authorization no longer matches authoritative state.");
  }
  const transfer: Draft = {
    eventType: "InheritanceTransferred",
    payload: {
      ...structuredClone(authorization),
      predecessorCharacterId: input.predecessorCharacterId as string,
      successorCharacterId: input.successorCharacterId as string,
      sourceFactId: input.sourceFactId as string,
    },
    visibilityPolicyId: "visibility:kp-internal",
    secrecy: "internal",
  };
  if (authorization.kind === "item") {
    const predecessor = state.entities[authorization.subjectCharacterId];
    const successor = state.entities[authorization.targetCharacterId];
    const itemSystem = state.campaignRuntime.itemSystem;
    const entry = itemSystem.entries[authorization.sourceRef];
    if (predecessor?.sceneId !== successor?.sceneId
      || entry?.disposition !== "held"
      || entry.holderRef !== predecessor?.id
      || entry.quantity !== 1) {
      return rejected("inheritanceProvenanceRequired", "Inherited possession requires the authorized item to be physically available.");
    }
    const targetEntryId = itemTransferTargetEntryId(
      state,
      root,
      entry.entryId,
      authorization.targetCharacterId,
      1,
      "preserve",
    );
    if (targetEntryId === undefined) {
      return rejected("invalidWorldState", "The inherited item has conflicting target stacks.");
    }
    const transition = transferItemQuantity(itemSystem, {
      entryId: entry.entryId,
      fromHolderRef: authorization.subjectCharacterId,
      toHolderRef: authorization.targetCharacterId,
      quantity: 1,
      targetEntryId,
      ownershipDisposition: "preserve",
    });
    if ("error" in transition || transition.targetEntryId !== targetEntryId) {
      return rejected("inheritanceProvenanceRequired", "Inherited possession is no longer transferable.");
    }
    const drafts: Draft[] = [transfer];
    const catalog = structuredClone(state.combatRuntime.definitions);
    for (const participant of [predecessor, successor]
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id))) {
      if (appendPlayerAbilityRegistrations(
        drafts,
        catalog,
        participant,
        transition.itemSystem,
      ) !== undefined) {
        return rejected("invalidWorldState", "The inherited item ability closure cannot be frozen.");
      }
    }
    drafts.push({
      eventType: "ItemTransferred",
      payload: {
        fromCharacterId: authorization.subjectCharacterId,
        toCharacterId: authorization.targetCharacterId,
        itemId: entry.entryId,
        targetItemId: targetEntryId,
        quantity: 1,
        method: `inheritance:${authorization.authorizationId}`,
        ownershipDisposition: "preserve",
      },
      visibilityPolicyId: "visibility:scene-observers",
    });
    return sequence("committed", profiles, state, root, drafts);
  }
  if (authorization.kind === "knowledge") {
    const knowledge = state.knowledge[authorization.subjectCharacterId]?.[authorization.sourceRef];
    if (knowledge === undefined) {
      return rejected("inheritanceProvenanceRequired", "Inherited knowledge is unavailable.");
    }
    return sequence("committed", profiles, state, root, [transfer, {
      eventType: "KnowledgeAcquired",
      payload: {
        characterId: authorization.targetCharacterId,
        sourceCharacterId: authorization.subjectCharacterId,
        medium: input.sourceFactId as string,
        contentLayer: knowledge.layer,
        items: [{
          knowledgeRef: authorization.targetRef,
          objectKind: knowledge.objectKind,
          content: structuredClone(knowledge.content),
          provenanceChain: [...new Set([
            ...knowledge.provenanceChain,
            input.sourceFactId as string,
            authorization.authorizationId,
          ])].sort(),
        }],
      },
      visibilityPolicyId: `visibility:knowledge-holder:${authorization.targetCharacterId}`,
      secrecy: "private",
    }]);
  }
  if (authorization.kind === "relationship") {
    const relationship = state.campaignRuntime.relationships[authorization.sourceRef];
    const sourceSubjectIds = canonicalStrings(relationship?.subjectIds);
    const value = relationship?.value;
    if (sourceSubjectIds === undefined
      || !isNonEmptyString(value)
      || !sourceSubjectIds.includes(authorization.subjectCharacterId)) {
      return rejected("inheritanceProvenanceRequired", "Inherited relationship is unavailable.");
    }
    const subjectIds = [...new Set(sourceSubjectIds.map((subjectId) =>
      subjectId === authorization.subjectCharacterId
        ? authorization.targetCharacterId
        : subjectId))].sort();
    const basisFactIds = [...new Set([
      ...(canonicalStrings(relationship.basisFactIds) ?? []),
      input.sourceFactId as string,
    ])].sort();
    if (subjectIds.length < 2 || subjectIds.some((subjectId) => !(subjectId in state.entities))) {
      return rejected("inheritanceProvenanceRequired", "Inherited relationship participants are unavailable.");
    }
    return sequence("committed", profiles, state, root, [transfer, {
      eventType: "RelationshipEstablished",
      payload: {
        relationshipId: authorization.targetRef,
        sourceRelationshipId: authorization.sourceRef,
        subjectIds,
        value,
        basisFactIds,
        sourceFactId: input.sourceFactId as string,
        authorizationId: authorization.authorizationId,
      },
      visibilityPolicyId: "visibility:relationship-participants",
      secrecy: "private",
    }]);
  }
  if (authorization.kind === "debt") {
    const debt = state.campaignRuntime.debts[authorization.sourceRef];
    const basisFactIds = [...new Set([
      ...(canonicalStrings(debt?.basisFactIds) ?? []),
      input.sourceFactId as string,
    ])].sort();
    if (debt?.debtorId !== authorization.subjectCharacterId
      || !isNonEmptyString(debt.creditorId)
      || !isNonEmptyString(debt.obligation)
      || !isNonEmptyString(debt.condition)) {
      return rejected("inheritanceProvenanceRequired", "Inherited debt is unavailable.");
    }
    return sequence("committed", profiles, state, root, [transfer, {
      eventType: "DebtAssumed",
      payload: {
        debtId: authorization.targetRef,
        sourceDebtId: authorization.sourceRef,
        debtorId: authorization.targetCharacterId,
        creditorId: debt.creditorId,
        obligation: debt.obligation,
        condition: debt.condition,
        basisFactIds,
        sourceFactId: input.sourceFactId as string,
        authorizationId: authorization.authorizationId,
      },
      visibilityPolicyId: "visibility:debt-participants",
      secrecy: "private",
    }]);
  }
  if (authorization.kind === "promise") {
    const promise = state.campaignRuntime.promises[authorization.sourceRef];
    if (promise?.promisorId !== authorization.subjectCharacterId
      || !isNonEmptyString(promise.promiseeId)
      || !isNonEmptyString(promise.content)
      || !isNonEmptyString(promise.condition)) {
      return rejected("inheritanceProvenanceRequired", "Inherited promise is unavailable.");
    }
    return sequence("committed", profiles, state, root, [transfer, {
      eventType: "PromiseAssumed",
      payload: {
        promiseId: authorization.targetRef,
        sourcePromiseId: authorization.sourceRef,
        promisorId: authorization.targetCharacterId,
        promiseeId: promise.promiseeId,
        content: promise.content,
        condition: promise.condition,
        sourceFactId: input.sourceFactId as string,
        authorizationId: authorization.authorizationId,
      },
      visibilityPolicyId: "visibility:promise-participants",
      secrecy: "private",
    }]);
  }
  return rejected("invalidRulesInput", "Inheritance authorization kind is unsupported.");
}

export function stepCampaignWorld(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  switch (input.kind) {
    case "resolveFreeAction": return resolveFreeAction(profiles, state, input);
    case "resolveContest": return resolveContest(profiles, state, input);
    case "resolveSavingThrow": return resolveSavingThrow(profiles, state, input);
    case "useResource": return useResource(profiles, state, input);
    case "changeResource": return changeResource(profiles, state, input);
    case "materializeSceneItem": return materializeSceneItem(profiles, state, input);
    case "materializeItem": return materializeItem(profiles, state, input);
    case "acquireItem": return acquireItem(profiles, state, input);
    case "transferItem": return transferItem(profiles, state, input);
    case "startRest": return startRest(profiles, state, input);
    case "answerGroupRestInvitation": return answerGroupRestInvitation(profiles, state, input);
    case "startActivity": return startActivity(profiles, state, input);
    case "interruptActivity": return interruptActivity(profiles, state, input);
    case "completeActivity": return completeActivity(profiles, state, input);
    case "registerDynamicDefinition": return registerDefinition(profiles, state, input);
    case "triggerHazard": return triggerHazard(profiles, state, input);
    case "declareCanonicalFact": return declareCanonicalFact(profiles, state, input);
    case "acquireSensoryEvidence": return acquireSensoryEvidence(profiles, state, input);
    case "createSourceClaim": return createSourceClaim(profiles, state, input);
    case "formCharacterInference": return formCharacterInference(profiles, state, input);
    case "changeRelationship": return changeRelationship(profiles, state, input);
    case "makePromise": return makePromise(profiles, state, input);
    case "incurDebt": return incurDebt(profiles, state, input);
    case "resolveDueActorPlan": return resolveDueActorPlan(profiles, state, input);
    case "grantMilestone": return grantMilestone(profiles, state, input);
    case "awardExperience": return awardExperience(profiles, state, input);
    case "recordAdvancementChoice": return recordAdvancementChoice(profiles, state, input);
    case "concludeChapter": return concludeChapter(profiles, state, input);
    case "startChapter": return startChapter(profiles, state, input);
    case "transitionChapter": return transitionChapter(profiles, state, input);
    case "retireCharacter":
      return "proposalId" in input ? retireCampaignCharacter(profiles, state, input) : undefined;
    case "introduceSuccessor":
      return "proposalId" in input ? introduceCampaignSuccessor(profiles, state, input) : undefined;
    case "establishInheritanceSource": return establishInheritanceSource(profiles, state, input);
    case "transferInheritance": return transferInheritance(profiles, state, input);
    case "shareKnowledge":
      return "proposalId" in input ? shareCampaignKnowledge(profiles, state, input) : undefined;
    default: return simpleCampaignEvent(profiles, state, input);
  }
}
