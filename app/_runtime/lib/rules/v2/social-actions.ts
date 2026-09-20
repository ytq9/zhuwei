
import { canonicalSha256 } from "../profiles/canonical";
import { socialResolutionProfileEnabled } from "../profiles/social-resolution";
import type { RuntimeProfileManifest } from "../profiles/types";

import {
  createEventTransition,
  createScopeProof,
  type TransitionDraft,
} from "./events";
import {
  AuthoritativeWorldState,
  AuthorityContinuation,
  EventEnvelope,
  EventType,
  JsonRecord,
  PendingInputRecord,
  PublicReceipt,
  RandomnessRequest,
  ScopeProof,
  SocialResolutionPlan,
  StepResult,
} from "./model";
import { rejected } from "./results";

import {
  isSocialResolutionPlan,
  socialParticipantsCoPresent,
} from "./social-model";
import {
  hasExactKeys,
  hashWorldState,
  isNonEmptyString,
  isRecord,
} from "./validation";

type Accumulator = {
  state: AuthoritativeWorldState;
  events: EventEnvelope[];
  receipt?: PublicReceipt;
  scopeProof?: ScopeProof;
};

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
  additions: JsonRecord,
): StepResult {
  const last = accumulator.events.at(-1);
  if (last === undefined || accumulator.receipt === undefined || accumulator.scopeProof === undefined) {
    return rejected("invalidWorldState", "Social resolution produced no canonical transition.");
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

function pendingSocialPlan(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pendingInputId: string,
): { pending: PendingInputRecord; plan: SocialResolutionPlan } | undefined {
  const pending = state.pendingInputs[pendingInputId];
  const plan = pending?.kind === "socialResolution" && isRecord(pending.options)
    ? pending.options.plan
    : undefined;
  const planHash = pending?.kind === "socialResolution" && isRecord(pending.options)
    ? pending.options.planHash
    : undefined;
  return pending?.kind === "socialResolution"
    && isSocialResolutionPlan(plan)
    && isNonEmptyString(planHash)
    && canonicalSha256(plan) === planHash
    && state.campaignRuntime.conversationThreads?.[plan.threadRef]?.planHash === planHash
    ? { pending, plan }
    : undefined;
}

function appendPendingAnswer(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  pending: PendingInputRecord,
  answer: JsonRecord,
): void {
  append(accumulator, profiles, {
    rootActionId: pending.rootActionId,
    eventType: "PendingInputAnswered",
    payload: {
      actorCharacterId: pending.controllerCharacterId,
      pendingInputId: pending.pendingInputId,
      openedByEventId: pending.openedByEventId,
      answer: structuredClone(answer),
    },
    visibilityPolicyId: `visibility:character-controller:${pending.controllerCharacterId}`,
    secrecy: "private",
    reads: [
      `entity:${pending.controllerCharacterId}`,
      `pending:${pending.pendingInputId}`,
      `receipt:${pending.rootActionId}`,
    ],
    writes: [`pending:${pending.pendingInputId}`, `receipt:${pending.rootActionId}`],
  });
}

export function answerSocialResolution(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
): StepResult | undefined {
  if (input.kind !== "answerSocialResolution") return undefined;
  if (!socialResolutionProfileEnabled(profiles.extensions)) {
    return rejected("unsupportedOperation", "This room has no social resolution Profile.");
  }
  if (!hasExactKeys(input, [
    "choice",
    "controllerCharacterId",
    "kind",
    "pendingInputId",
    "rootActionId",
  ])
    || !isNonEmptyString(input.pendingInputId)
    || !isNonEmptyString(input.rootActionId)
    || !isNonEmptyString(input.controllerCharacterId)
    || !["press", "acceptStatusQuo"].includes(String(input.choice))) {
    return rejected("invalidRulesInput", "A social answer must select press or acceptStatusQuo.");
  }
  const entry = pendingSocialPlan(profiles, state, input.pendingInputId);
  const receipt = state.receipts[input.rootActionId];
  if (entry === undefined
    || entry.pending.rootActionId !== input.rootActionId
    || entry.pending.controllerCharacterId !== input.controllerCharacterId
    || receipt?.status !== "awaitingInput") {
    return rejected("privateOrUnknownReference", "The social resolution offer is unavailable.");
  }
  const { pending, plan } = entry;
  const accumulator: Accumulator = { state, events: [] };
  appendPendingAnswer(accumulator, profiles, pending, { choice: input.choice });

  if (input.choice === "acceptStatusQuo") {
    const outcome = "你没有进行检定；冻结选项已经关闭，但对方此前的关注与判断保持原状，长期关系不变。";
    append(accumulator, profiles, {
      rootActionId: plan.rootActionId,
      eventType: "SocialResolutionDeclined",
      payload: {
        actorCharacterId: plan.actorCharacterId,
        npcCharacterId: plan.npcCharacterId,
        pendingInputId: plan.pendingInputId,
        claimRef: plan.claimRef,
        threadRef: plan.threadRef,
        disposition: "active",
        reason: "acceptedStatusQuo",
        outcome,
      },
      visibilityPolicyId: "visibility:relationship-participants",
      secrecy: "private",
      reads: [
        `entity:${plan.actorCharacterId}`,
        `entity:${plan.npcCharacterId}`,
        `conversation:${plan.threadRef}`,
      ],
      writes: [`conversation:${plan.threadRef}`, `receipt:${plan.rootActionId}`],
    });
    return finished("committed", accumulator, {
      mechanicalResult: {
        kind: "socialResolution",
        resolution: "statusQuo",
        claimRef: plan.claimRef,
        threadRef: plan.threadRef,
        disposition: "active",
        randomnessRequested: false,
        outcome,
      },
    });
  }

  const currentActor = accumulator.state.entities[plan.actorCharacterId];
  const currentNpc = accumulator.state.entities[plan.npcCharacterId];
  if (currentActor?.tenureStatus !== "active"
    || currentNpc?.tenureStatus !== "active"
    || currentActor.sceneId !== plan.sourceSceneId
    || currentNpc.sceneId !== plan.sourceSceneId
    || !socialParticipantsCoPresent(accumulator.state, currentActor, currentNpc)) {
    const outcome = "冻结检定对应的交谈机会已经不在当前场景；本次未掷骰，旧选项已关闭。";
    append(accumulator, profiles, {
      rootActionId: plan.rootActionId,
      eventType: "SocialResolutionDeclined",
      payload: {
        actorCharacterId: plan.actorCharacterId,
        npcCharacterId: plan.npcCharacterId,
        pendingInputId: plan.pendingInputId,
        claimRef: plan.claimRef,
        threadRef: plan.threadRef,
        disposition: "dormant",
        reason: "invalidated",
        outcome,
      },
      visibilityPolicyId: "visibility:relationship-participants",
      secrecy: "private",
      reads: [`conversation:${plan.threadRef}`],
      writes: [`conversation:${plan.threadRef}`, `receipt:${plan.rootActionId}`],
    });
    return finished("committed", accumulator, {
      mechanicalResult: {
        kind: "socialResolution",
        resolution: "invalidated",
        claimRef: plan.claimRef,
        threadRef: plan.threadRef,
        disposition: "dormant",
        randomnessRequested: false,
        outcome,
      },
    });
  }

  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    resolutionId: `resolution:${plan.rootActionId}:social:${plan.nodeRef}`,
    eventType: "CheckFrozen",
    payload: {
      characterId: plan.actorCharacterId,
      checkKind: "skill",
      ability: plan.frozenCheck.ability,
      skill: plan.frozenCheck.skill,
      dc: Number(plan.frozenCheck.dc),
      mode: plan.frozenCheck.mode,
      success: {
        planHash: canonicalSha256(plan),
        consequence: plan.frozenCheck.successOutcome,
      },
      failure: {
        planHash: canonicalSha256(plan),
        consequence: plan.frozenCheck.failureOutcome,
      },
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [`entity:${plan.actorCharacterId}`, `fact:${plan.programFactRef}`],
    writes: [`check:${plan.rootActionId}:${plan.nodeRef}`, `receipt:${plan.rootActionId}`],
    creates: [`check:${plan.rootActionId}:${plan.nodeRef}`],
  });
  const request: RandomnessRequest = {
    randomnessId: `randomness:${plan.rootActionId}:social:${plan.nodeRef}`,
    resolutionId: `resolution:${plan.rootActionId}:social:${plan.nodeRef}`,
    actorCharacterId: plan.actorCharacterId,
    purpose: "improvisedCheck",
    diceExpression: plan.frozenCheck.mode === "normal" ? "1d20"
      : plan.frozenCheck.mode === "advantage" ? "2d20kh1" : "2d20kl1",
    frozenCheck: structuredClone(plan.frozenCheck),
  };
  const continuation: AuthorityContinuation = {
    kind: "roomAuthorityRandomness",
    continuationId: `continuation:${request.resolutionId}`,
    capability: canonicalSha256({
      kind: "roomAuthorityRandomness",
      roomId: accumulator.state.roomId,
      runtimeEpochId: accumulator.state.runtimeEpochId,
      stateHash: hashWorldState(accumulator.state),
      rootActionId: plan.rootActionId,
      request,
      resolutionPlan: plan,
    }),
  };
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    resolutionId: request.resolutionId,
    eventType: "RandomnessRequested",
    payload: {
      request,
      continuation,
      purpose: request.purpose,
      formula: request.diceExpression,
      resolutionPlan: structuredClone(plan),
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [
      `entity:${plan.actorCharacterId}`,
      `entity:${plan.npcCharacterId}`,
      `fact:${plan.programFactRef}`,
      `conversation:${plan.threadRef}`,
    ],
    writes: [`continuation:${continuation.continuationId}`, `receipt:${plan.rootActionId}`],
    creates: [`continuation:${continuation.continuationId}`],
  });
  return finished("awaitingRandomness", accumulator, {
    randomnessRequest: request,
    continuation,
    randomnessRequests: [request],
    continuations: [continuation],
    mechanicalResult: {
      kind: "socialResolutionPending",
      claimRef: plan.claimRef,
      threadRef: plan.threadRef,
      boundary: Number(plan.frozenCheck.dc),
      randomnessRequested: true,
    },
  });
}

/** Called only after the generic PendingInputAnswered transition has atomically
 * removed an unrolled social offer. This closes only the frozen roll option;
 * the NPC's topic attention remains unchanged until the new words resolve. */
export function supersedeSocialResolutionPending(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  pending: PendingInputRecord,
): { state: AuthoritativeWorldState; event: EventEnvelope } | undefined {
  if (pending.kind !== "socialResolution" || !isRecord(pending.options)) return undefined;
  const plan = pending.options.plan;
  if (!isSocialResolutionPlan(plan)) return undefined;
  const scopeProof = createScopeProof(
    state,
    [
      `entity:${plan.actorCharacterId}`,
      `entity:${plan.npcCharacterId}`,
      `conversation:${plan.threadRef}`,
    ],
    [`conversation:${plan.threadRef}`, `receipt:${plan.rootActionId}`],
    [],
  );
  const transition = createEventTransition(state, profiles, {
    rootActionId: plan.rootActionId,
    eventType: "SocialResolutionDeclined",
    payload: {
      actorCharacterId: plan.actorCharacterId,
      npcCharacterId: plan.npcCharacterId,
      pendingInputId: plan.pendingInputId,
      claimRef: plan.claimRef,
      threadRef: plan.threadRef,
      disposition: "active",
      reason: "reframed",
      outcome: "玩家改换了当前说法或做法；旧检定未掷骰且已失效，原先说出口的主张仍保留为 SourceClaim。",
    },
    scopeProof,
    visibilityPolicyId: "visibility:relationship-participants",
    secrecy: "private",
  });
  return { state: transition.state, event: transition.event };
}
