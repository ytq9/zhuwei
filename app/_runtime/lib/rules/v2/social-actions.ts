import {
  type CausalActionProgram,
  type CausalValue,
} from "../../kp/causal-action-program";
import { canonicalSha256 } from "../profiles/canonical";
import { socialResolutionProfileEnabled } from "../profiles/social-resolution";
import type { RuntimeProfileManifest } from "../profiles/types";
import { causalProgramFactValue } from "./causal-model";
import {
  createEventTransition,
  createScopeProof,
  type TransitionDraft,
} from "./events";
import type {
  AuthoritativeWorldState,
  AuthorityContinuation,
  CharacterRecord,
  EventEnvelope,
  EventPayloadByType,
  EventType,
  JsonRecord,
  PendingInputRecord,
  PublicReceipt,
  RandomnessRequest,
  ScopeProof,
  SocialClaimSemantics,
  SocialNpcResponse,
  SocialResolutionPlan,
  StepResult,
} from "./model";
import { rejected } from "./results";
import { characterTimelineId } from "./timeline";
import {
  capSocialDegree,
  currentSocialTrust,
  deriveSocialResolutionPlan,
  isNpcSocialMechanics,
  isSocialResolutionPlan,
  socialCheckReactionSpeech,
  socialDegreeForMargin,
  socialMethodFingerprint,
  socialParticipantsCoPresent,
  socialRelationshipId,
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

function scalarString(value: CausalValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

function appendProgramFact(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  plan: SocialResolutionPlan,
): void {
  const program = plan.program as unknown as CausalActionProgram;
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    eventType: "ImprovisedActionResolved",
    payload: {
      actorCharacterId: plan.actorCharacterId,
      outcomeCode: "causal-program-frozen",
      fact: {
        id: plan.programFactRef,
        kind: "causalActionProgram",
        subjectRefs: [plan.actorCharacterId],
        value: causalProgramFactValue(program),
        visibilityPolicyId: "visibility:room-authority-only",
        source: "characterAction",
      },
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [`entity:${plan.actorCharacterId}`],
    writes: [`fact:${plan.programFactRef}`, `receipt:${plan.rootActionId}`],
    creates: [`fact:${plan.programFactRef}`],
  });
}

function appendSpokenClaim(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  plan: SocialResolutionPlan,
  speakerId: string,
  claimRef: string,
  content: string,
  sourceBasis: string,
): void {
  const timelineId = characterTimelineId(accumulator.state, plan.actorCharacterId);
  if (timelineId === undefined) throw new TypeError("social claim timeline is unavailable");
  const speaker = accumulator.state.entities[speakerId];
  if (speaker === undefined) throw new TypeError("social claim speaker is unavailable");
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    eventType: "SourceClaimCreated",
    payload: {
      speakerId,
      claimId: claimRef,
      semanticContent: content,
      sourceBasis,
      motive: "speaker-authored-unknown",
      formedAtFictionMicros: accumulator.state.fictionTimelines[timelineId].nowMicros,
    },
    visibilityPolicyId: `visibility:knowledge-holder:${speakerId}`,
    secrecy: "private",
    reads: [`entity:${speakerId}`],
    writes: [
      `claim:${claimRef}`,
      `knowledge:${speakerId}:${claimRef}`,
      `receipt:${plan.rootActionId}`,
    ],
    creates: [`claim:${claimRef}`, `knowledge:${speakerId}:${claimRef}`],
  });
  const recipients = Object.values(accumulator.state.entities)
    .filter((entity) => entity.id !== speakerId
      && entity.tenureStatus === "active"
      && entity.sceneId === plan.sourceSceneId
      && socialParticipantsCoPresent(accumulator.state, speaker, entity))
    .map((entity) => entity.id)
    .sort();
  for (const characterId of recipients) {
    append(accumulator, profiles, {
      rootActionId: plan.rootActionId,
      eventType: "KnowledgeAcquired",
      payload: {
        characterId,
        sourceCharacterId: speakerId,
        medium: "spokenConversation",
        contentLayer: "full",
        items: [{
          knowledgeRef: claimRef,
          objectKind: "sourceClaim",
          content,
          provenanceChain: [claimRef],
        }],
      },
      visibilityPolicyId: `visibility:knowledge-holder:${characterId}`,
      secrecy: "private",
      reads: [
        `entity:${speakerId}`,
        `entity:${characterId}`,
        `knowledge:${speakerId}:${claimRef}`,
      ],
      writes: [
        `knowledge:${characterId}:${claimRef}`,
        `receipt:${plan.rootActionId}`,
      ],
      creates: [`knowledge:${characterId}:${claimRef}`],
    });
  }
}

function appendPlayerSourceClaim(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  plan: SocialResolutionPlan,
): void {
  const program = plan.program as unknown as CausalActionProgram;
  const utterance = scalarString(program.nodes[0]?.arguments.utterance);
  if (utterance === undefined) throw new TypeError("social exchange lacks a spoken claim");
  appendSpokenClaim(
    accumulator,
    profiles,
    plan,
    plan.actorCharacterId,
    plan.claimRef,
    utterance,
    `utterance:${plan.rootActionId}`,
  );
}

function appendSocialCommitment(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  plan: SocialResolutionPlan,
  responseClaimRef: string,
): void {
  if (plan.successResponse.mode !== "commitment") return;
  const promiseId = `promise:social:${plan.rootActionId}:${plan.programHash.slice("fnv1a64:".length)}`;
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    eventType: "PromiseMade",
    payload: {
      promiseId,
      promisorId: plan.npcCharacterId,
      promiseeId: plan.actorCharacterId,
      content: plan.successResponse.speech,
      condition: JSON.stringify({
        responseClaimRef,
        scopeRefs: [...plan.successResponse.sourceRefs],
      }),
    },
    visibilityPolicyId: "visibility:relationship-participants",
    secrecy: "private",
    reads: [
      `entity:${plan.actorCharacterId}`,
      `entity:${plan.npcCharacterId}`,
      `claim:${responseClaimRef}`,
      ...plan.successResponse.sourceRefs.map((ref) => `scope:${ref}`),
    ],
    writes: [`promise:${promiseId}`, `receipt:${plan.rootActionId}`],
    creates: [`promise:${promiseId}`],
  });
}

function appendFictionTime(
  accumulator: Accumulator,
  profiles: RuntimeProfileManifest,
  plan: SocialResolutionPlan,
): void {
  const timelineId = characterTimelineId(accumulator.state, plan.actorCharacterId);
  if (timelineId === undefined) throw new TypeError("social fiction timeline is unavailable");
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    eventType: "FictionTimeAdvanced",
    payload: {
      durationMicros: plan.durationMicros,
      reason: plan.frozenCheck.goal,
    },
    visibilityPolicyId: "visibility:scene-observers",
    secrecy: "public",
    reads: [`timeline:${timelineId}`],
    writes: [`timeline:${timelineId}`, `receipt:${plan.rootActionId}`],
  });
}

function socialTopicLabel(claim: SocialClaimSemantics): string {
  if (claim.assertion !== null) return "这项主张";
  return claim.influenceGoal === "deemphasize" ? "这个话题"
    : claim.influenceGoal === "disclose" ? "这项询问"
      : claim.influenceGoal === "permit" ? "这项许可请求"
        : claim.influenceGoal === "cooperate" ? "这项合作请求"
          : claim.influenceGoal === "deter" ? "这次施压"
            : "这次影响";
}

function immediateSocialBehavior(
  degree: ReturnType<typeof socialDegreeForMargin>,
  claim: SocialClaimSemantics,
): string {
  const topic = socialTopicLabel(claim);
  switch (degree) {
    case "strongFailure":
      return `对方拒绝本次影响，并更专注于处理${topic}。`;
    case "failure":
      return `对方没有接受本次影响，${topic}仍然活跃。`;
    case "limitedSuccess":
      return claim.assertion === null
        ? `对方暂时降低了对${topic}的关注，但尚未给出完整配合。`
        : "对方暂时不再紧抓这项主张，但没有把它当作事实。";
    case "fullSuccess":
      return claim.assertion === null
        ? "对方在自身权限与可行范围内作出有限配合。"
        : "对方在自身权限与可行范围内作出有限配合；这项主张仍不是世界事实。";
    case "strongSuccess":
      return claim.assertion === null
        ? "对方在自身权限与可行范围内充分配合。"
        : "对方在自身权限与可行范围内充分配合；这项主张仍不是世界事实。";
  }
}

function socialInferenceConclusion(
  degree: ReturnType<typeof socialDegreeForMargin>,
  claim: SocialClaimSemantics,
): string {
  if (claim.assertion !== null) {
    return degree === "strongFailure" ? "当前更不相信这项主张"
      : degree === "failure" ? "当前仍怀疑这项主张"
        : degree === "limitedSuccess" ? "愿意暂时不追究，但没有确认主张为真"
          : degree === "fullSuccess" ? "当前愿意依此采取有限行动"
            : "当前高度信任这项主张，但它仍不是 CanonicalFact";
  }
  const topic = socialTopicLabel(claim);
  return degree === "strongFailure" ? `当前更不愿顺应${topic}`
    : degree === "failure" ? `当前不愿顺应${topic}`
      : degree === "limitedSuccess" ? `当前愿意降低对${topic}的关注，但不会完整配合`
        : degree === "fullSuccess" ? `当前愿意在权限内有限配合${topic}`
          : `当前愿意在权限内充分配合${topic}`;
}

const SOCIAL_SUCCESS_DEGREE_RANK = {
  limitedSuccess: 0,
  fullSuccess: 1,
  strongSuccess: 2,
} as const;

function directThreadDisposition(response: SocialNpcResponse):
"active" | "deemphasized" | "dormant" | "closed" {
  if (response.mode !== "reaction") return "closed";
  switch (response.reactionKind) {
    case "askClarification": return "active";
    case "redirect": return "deemphasized";
    case "decline": return "closed";
    case "acknowledge":
    case "silence":
    default:
      return "dormant";
  }
}

/** Specialized V5 branch for npc-exchange.v1. Returning undefined means the
 * exact current profile or Form does not own this operation. */
export function stepSocialCausalAction(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  input: JsonRecord,
  program: CausalActionProgram,
  actor: CharacterRecord,
): StepResult | undefined {
  if (!socialResolutionProfileEnabled(profiles.extensions)
    || program.formRef !== "npc-exchange.v1") return undefined;
  const derived = deriveSocialResolutionPlan(
    profiles,
    state,
    actor,
    program,
    String(input.rootActionId),
  );
  if (derived === undefined) {
    return rejected(
      "privateOrUnknownReference",
      "A social exchange requires exactly one finite, active, same-scene NPC reference with structured mechanics.",
    );
  }
  if ("rejection" in derived) {
    switch (derived.rejection) {
      case "unchangedRetry":
        return rejected(
          "unchangedRetry",
          "A repeated social check requires a changed method, new evidence, a changed position, or an advanced situation.",
        );
      case "targetUnavailable":
        return rejected(
          "privateOrUnknownReference",
          "The cited social target is not an active same-scene NPC with versioned mechanics.",
        );
      case "evidenceUnavailable":
        return rejected(
          "privateOrUnknownReference",
          "The cited social evidence is not mutually known or does not support the typed assertion.",
        );
      case "invalidNpcResponse":
        return rejected(
          "invalidRulesInput",
          "The NPC response is not grounded in finite knowledge or bounded authority.",
        );
      case "invalidCheck":
        return rejected(
          "invalidRulesInput",
          "The proposed social check lacks a valid SRD ability, skill, mode, or stakes input.",
        );
      case "invalidSocialIntent":
      default:
        return rejected(
          "invalidRulesInput",
          "The typed social intent does not bind its target, assertion, topic, and desired behavior consistently.",
        );
    }
  }
  const { plan, npc } = derived;
  const accumulator: Accumulator = { state, events: [] };
  appendProgramFact(accumulator, profiles, plan);
  appendPlayerSourceClaim(accumulator, profiles, plan);
  // The spoken exchange consumes fictional time when the words enter the
  // world. Later press/accept clicks are meta-decisions and do not consume it
  // a second time; each free-text reframe creates a new spoken exchange.
  appendFictionTime(accumulator, profiles, plan);

  const programNode = program.nodes[0];
  if (programNode.arguments.resolution === "direct") {
    const response = derived.directResponse;
    if (response === undefined) {
      return rejected("invalidRulesInput", "A direct NPC response lacks finite-knowledge grounding.");
    }
    const responseClaimRef = response.reactionKind === "silence"
      ? null
      : `claim:social-npc:${plan.rootActionId}:${plan.programHash.slice("fnv1a64:".length)}`;
    const threadDisposition = directThreadDisposition(response);
    if (responseClaimRef !== null) {
      appendSpokenClaim(
        accumulator,
        profiles,
        plan,
        plan.npcCharacterId,
        responseClaimRef,
        response.speech,
        `npc-response:${plan.rootActionId}`,
      );
      appendSocialCommitment(accumulator, profiles, plan, responseClaimRef);
    }
    append(accumulator, profiles, {
      rootActionId: plan.rootActionId,
      resolutionId: `resolution:${plan.rootActionId}:social:${plan.nodeRef}`,
      eventType: "SocialDirectResolved",
      payload: {
        actorCharacterId: plan.actorCharacterId,
        npcCharacterId: plan.npcCharacterId,
        claimRef: plan.claimRef,
        claimSemantics: structuredClone(plan.claimSemantics),
        addressedThreadRef: plan.claimSemantics.addressedThreadRef,
        responseClaimRef,
        responseMode: response.mode,
        responseReaction: response.reactionKind,
        responseMinimumDegree: response.minimumDegree,
        sourceRefs: [...response.sourceRefs],
        threadRef: plan.threadRef,
        immediateBehavior: responseClaimRef === null
          ? "对方保持沉默，没有形成任何口头 SourceClaim。"
          : "对方作出了一个已明确归属于自己的口头回应。",
        threadDisposition,
        outcome: responseClaimRef === null
          ? "NPC 没有作答；这是一项可观察反应，不是说过的话。"
          : "NPC 的回应已作为 SourceClaim 记录；它不是 CanonicalFact。",
        planHash: canonicalSha256(plan),
        plan: structuredClone(plan),
      },
      visibilityPolicyId: "visibility:room-authority-only",
      secrecy: "internal",
      reads: [
        `entity:${plan.actorCharacterId}`,
        `entity:${plan.npcCharacterId}`,
        `claim:${plan.claimRef}`,
        ...(responseClaimRef === null ? [] : [`claim:${responseClaimRef}`]),
      ],
      writes: [`conversation:${plan.threadRef}`, `receipt:${plan.rootActionId}`],
      creates: [`conversation:${plan.threadRef}`],
    });
    return finished("committed", accumulator, {
      mechanicalResult: {
        kind: "socialResolution",
        resolution: "direct",
        actorCharacterId: actor.id,
        npcCharacterId: npc.id,
        claimRef: plan.claimRef,
        responseClaimRef,
        threadRef: plan.threadRef,
        outcome: responseClaimRef === null
          ? "NPC 没有作答；这是一项可观察反应，不是说过的话。"
          : "NPC 的回应已作为 SourceClaim 记录；它不是 CanonicalFact。",
      },
    });
  }

  const question = `是否坚持以“${plan.frozenCheck.method}”争取“${plan.frozenCheck.goal}”？你也可以接受现状，或直接输入新的说法。`;
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    eventType: "SocialResolutionOffered",
    payload: {
      actorCharacterId: plan.actorCharacterId,
      npcCharacterId: plan.npcCharacterId,
      pendingInputId: plan.pendingInputId,
      claimRef: plan.claimRef,
      threadRef: plan.threadRef,
      question,
      planHash: canonicalSha256(plan),
      plan: structuredClone(plan),
    },
    visibilityPolicyId: `visibility:character-controller:${plan.actorCharacterId}`,
    secrecy: "private",
    reads: [
      `entity:${plan.actorCharacterId}`,
      `entity:${plan.npcCharacterId}`,
      `claim:${plan.claimRef}`,
      `fact:${plan.programFactRef}`,
    ],
    writes: [
      `pending:${plan.pendingInputId}`,
      `conversation:${plan.threadRef}`,
      `receipt:${plan.rootActionId}`,
    ],
    creates: [`pending:${plan.pendingInputId}`, `conversation:${plan.threadRef}`],
  });
  return finished("awaitingInput", accumulator, {
    pending: {
      pendingInputId: plan.pendingInputId,
      kind: "socialResolution",
      question,
      options: {
        npcCharacterId: plan.npcCharacterId,
        npcName: npc.name,
        goal: plan.frozenCheck.goal,
        method: plan.frozenCheck.method,
        risk: plan.frozenCheck.risk,
        successOutcome: plan.frozenCheck.successOutcome,
        failureOutcome: plan.frozenCheck.failureOutcome,
        dc: Number(plan.frozenCheck.dc),
        choices: ["press", "acceptStatusQuo", "reframe"],
      },
    },
    mechanicalResult: {
      kind: "socialResolutionOffer",
      actorCharacterId: plan.actorCharacterId,
      npcCharacterId: plan.npcCharacterId,
      claimRef: plan.claimRef,
      threadRef: plan.threadRef,
      boundary: Number(plan.frozenCheck.dc),
      randomnessRequested: false,
    },
  });
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

export function fulfillSocialResolutionRandomness(
  profiles: RuntimeProfileManifest,
  state: AuthoritativeWorldState,
  continuationId: string,
  rolls: number[],
): StepResult | undefined {
  const stored = state.internalContinuations[continuationId];
  if (!isSocialResolutionPlan(stored?.resolutionPlan)) return undefined;
  if (!socialResolutionProfileEnabled(profiles.extensions)) {
    return rejected("profileIntegrityMismatch", "The frozen social continuation is not enabled.");
  }
  const plan = stored.resolutionPlan;
  const request = stored.request;
  if (!("frozenCheck" in request)
    || canonicalSha256(request.frozenCheck) !== canonicalSha256(plan.frozenCheck)) {
    return rejected("invalidWorldState", "The social continuation lost its frozen check.");
  }
  const expectedCount = plan.frozenCheck.mode === "normal" ? 1 : 2;
  if (rolls.length !== expectedCount
    || rolls.some((roll) => !Number.isInteger(roll) || roll < 1 || roll > 20)) {
    return rejected("invalidRulesInput", "The social result does not match its frozen dice.");
  }
  const actor = state.entities[plan.actorCharacterId];
  const npc = state.entities[plan.npcCharacterId];
  if (actor?.kind !== "player" || npc?.kind !== "npc" || !isNpcSocialMechanics(npc.socialMechanics)) {
    return rejected("privateOrUnknownReference", "The social participants are unavailable.");
  }
  const selectedRoll = plan.frozenCheck.mode === "advantage" ? Math.max(...rolls)
    : plan.frozenCheck.mode === "disadvantage" ? Math.min(...rolls) : rolls[0];
  const total = selectedRoll + Number(plan.frozenCheck.modifier);
  const boundary = Number(plan.frozenCheck.dc);
  const margin = total - boundary;
  const marginDegree = socialDegreeForMargin(margin);
  const degree = capSocialDegree(marginDegree, plan.maximumInfluenceDegree);
  const succeeded = margin >= 0;
  const immediateBehavior = immediateSocialBehavior(degree, plan.claimSemantics);
  const threadDisposition = degree === "strongFailure" || degree === "failure"
    ? "active" as const
    : degree === "limitedSuccess"
      ? "deemphasized" as const
      : degree === "fullSuccess" ? "dormant" as const : "closed" as const;
  const intendedRelationshipDelta = marginDegree === "strongFailure"
    && plan.frozenBoundary.stakesModifier >= 2
    ? -1
    : marginDegree === "strongSuccess"
      && plan.frozenBoundary.mutuallyKnownEvidenceRefs.length > 0 ? 1 : 0;
  const relationshipBefore = currentSocialTrust(
    state,
    actor,
    npc as CharacterRecord & { socialMechanics: NonNullable<CharacterRecord["socialMechanics"]> },
  );
  const relationshipScore = Math.max(
    -5,
    Math.min(5, relationshipBefore + intendedRelationshipDelta),
  );
  const relationshipDelta = relationshipScore - relationshipBefore;
  const accumulator: Accumulator = { state, events: [] };
  const responseReached = succeeded
    && (degree === "limitedSuccess" || degree === "fullSuccess" || degree === "strongSuccess")
    && SOCIAL_SUCCESS_DEGREE_RANK[degree]
      >= SOCIAL_SUCCESS_DEGREE_RANK[plan.successResponse.minimumDegree];
  const responseClaimRef = responseReached && plan.successResponse.reactionKind !== "silence"
    ? `claim:social-npc:${plan.rootActionId}:${plan.programHash.slice("fnv1a64:".length)}:success`
    : null;
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    resolutionId: request.resolutionId,
    eventType: "DiceRolled",
    payload: {
      randomnessId: request.randomnessId,
      resolutionId: request.resolutionId,
      formula: request.diceExpression,
      faces: [...rolls],
      selectedFace: selectedRoll,
      requestHash: canonicalSha256(request),
      frozenParametersHash: canonicalSha256(plan),
    },
    visibilityPolicyId: "visibility:room-authority-only",
    secrecy: "internal",
    reads: [`continuation:${continuationId}`],
    writes: [`receipt:${plan.rootActionId}`],
  });
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    resolutionId: request.resolutionId,
    eventType: "ImprovisedCheckResolved",
    payload: {
      request: structuredClone(request),
      rolls: [...rolls],
      selectedRoll,
      total,
      succeeded,
      outcome: immediateBehavior,
    },
    visibilityPolicyId: `visibility:character-controller:${plan.actorCharacterId}`,
    secrecy: "private",
    reads: [`continuation:${continuationId}`, `entity:${plan.actorCharacterId}`],
    writes: [`continuation:${continuationId}`, `receipt:${plan.rootActionId}`],
  });
  if (responseClaimRef !== null) {
    const responseSpeech = plan.successResponse.mode === "reaction"
      ? socialCheckReactionSpeech(
          degree as Extract<typeof degree, "limitedSuccess" | "fullSuccess" | "strongSuccess">,
          plan.claimSemantics.influenceGoal,
        )
      : plan.successResponse.speech;
    appendSpokenClaim(
      accumulator,
      profiles,
      plan,
      plan.npcCharacterId,
      responseClaimRef,
      responseSpeech,
      `social-success-response:${plan.rootActionId}:${degree}`,
    );
    appendSocialCommitment(accumulator, profiles, plan, responseClaimRef);
  }
  const inferenceId = `inference:social:${plan.rootActionId}:${plan.programHash.slice("fnv1a64:".length)}`;
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    resolutionId: request.resolutionId,
    eventType: "CharacterInferenceFormed",
    payload: {
      characterId: plan.npcCharacterId,
      inferenceId,
      evidenceRefs: [plan.claimRef, ...plan.frozenBoundary.mutuallyKnownEvidenceRefs],
      conclusion: socialInferenceConclusion(degree, plan.claimSemantics),
      confidence: degree,
    },
    visibilityPolicyId: `visibility:knowledge-holder:${plan.npcCharacterId}`,
    secrecy: "private",
    reads: [
      `entity:${plan.npcCharacterId}`,
      `knowledge:${plan.npcCharacterId}:${plan.claimRef}`,
      ...plan.frozenBoundary.mutuallyKnownEvidenceRefs.map((ref) =>
        `knowledge:${plan.npcCharacterId}:${ref}`),
    ],
    writes: [`knowledge:${plan.npcCharacterId}:${inferenceId}`, `receipt:${plan.rootActionId}`],
    creates: [`knowledge:${plan.npcCharacterId}:${inferenceId}`],
  });
  if (relationshipDelta !== 0) {
    const relationRef = socialRelationshipId(plan.actorCharacterId, plan.npcCharacterId);
    append(accumulator, profiles, {
      rootActionId: plan.rootActionId,
      resolutionId: request.resolutionId,
      eventType: "RelationshipChanged",
      payload: {
        relationshipId: relationRef,
        subjectIds: [plan.actorCharacterId, plan.npcCharacterId].sort(),
        change: `socialTrust:${relationshipScore}`,
        basisFactIds: [plan.claimRef, ...plan.frozenBoundary.mutuallyKnownEvidenceRefs],
      },
      visibilityPolicyId: "visibility:relationship-participants",
      secrecy: "private",
      reads: [
        `entity:${plan.actorCharacterId}`,
        `entity:${plan.npcCharacterId}`,
        `relationship:${relationRef}`,
      ],
      writes: [`relationship:${relationRef}`, `receipt:${plan.rootActionId}`],
    });
  }
  if (!succeeded) {
    append(accumulator, profiles, {
      rootActionId: plan.rootActionId,
      resolutionId: request.resolutionId,
      eventType: "MeaningfulFailureCommitted",
      payload: {
        characterId: plan.actorCharacterId,
        goalId: plan.threadRef,
        methodFingerprint: socialMethodFingerprint(plan.frozenCheck),
        factualCause: `social-resolution:${request.resolutionId}:failed`,
        consequences: {
          effectKinds: [
            degree === "strongFailure" ? "npcFocusIncreased" : "topicRemainsActive",
          ],
          threadRef: plan.threadRef,
          topicFingerprint: plan.claimSemantics.topicFingerprint,
        },
      },
      visibilityPolicyId: `visibility:character-controller:${plan.actorCharacterId}`,
      secrecy: "private",
      reads: [`conversation:${plan.threadRef}`],
      writes: [`failure:${plan.threadRef}`, `receipt:${plan.rootActionId}`],
      creates: [`failure:${plan.threadRef}`],
    });
  }
  append(accumulator, profiles, {
    rootActionId: plan.rootActionId,
    resolutionId: request.resolutionId,
    eventType: "SocialCheckResolved",
    payload: {
      actorCharacterId: plan.actorCharacterId,
      npcCharacterId: plan.npcCharacterId,
      claimRef: plan.claimRef,
      addressedThreadRef: plan.claimSemantics.addressedThreadRef,
      addressedThreadDisposition: plan.claimSemantics.addressedThreadRef === null
        ? null
        : succeeded ? threadDisposition : "active",
      responseClaimRef,
      responseReached,
      responseMode: responseReached ? plan.successResponse.mode : null,
      responseReaction: responseReached ? plan.successResponse.reactionKind : null,
      responseMinimumDegree: plan.successResponse.minimumDegree,
      responseSourceRefs: responseReached ? [...plan.successResponse.sourceRefs] : [],
      threadRef: plan.threadRef,
      boundary,
      selectedRoll,
      total,
      margin,
      marginDegree,
      degree,
      succeeded,
      maximumInfluenceDegree: plan.maximumInfluenceDegree,
      immediateBehavior,
      threadDisposition,
      relationshipBefore,
      relationshipDelta,
      relationshipScore,
      outcome: immediateBehavior,
    },
    visibilityPolicyId: "visibility:relationship-participants",
    secrecy: "private",
    reads: [
      `entity:${plan.actorCharacterId}`,
      `entity:${plan.npcCharacterId}`,
      `claim:${plan.claimRef}`,
      ...(responseClaimRef === null ? [] : [`claim:${responseClaimRef}`]),
      `conversation:${plan.threadRef}`,
      ...(plan.claimSemantics.addressedThreadRef === null
        ? []
        : [`conversation:${plan.claimSemantics.addressedThreadRef}`]),
    ],
    writes: [
      `conversation:${plan.threadRef}`,
      ...(plan.claimSemantics.addressedThreadRef === null
        ? []
        : [`conversation:${plan.claimSemantics.addressedThreadRef}`]),
      `receipt:${plan.rootActionId}`,
    ],
  });
  return finished("committed", accumulator, {
    mechanicalResult: {
      kind: "socialResolution",
      resolution: "check",
      actorCharacterId: plan.actorCharacterId,
      npcCharacterId: plan.npcCharacterId,
      claimRef: plan.claimRef,
      responseClaimRef,
      threadRef: plan.threadRef,
      boundary,
      selectedRoll,
      total,
      margin,
      marginDegree,
      degree,
      succeeded,
      relationshipBefore,
      relationshipDelta,
      relationshipScore,
      threadDisposition,
      outcome: immediateBehavior,
    },
  });
}
