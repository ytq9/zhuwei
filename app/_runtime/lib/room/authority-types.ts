import type { TacticalPosition } from "../rules/tactical-projection";
import type { RuntimeProfileManifest } from "../rules";
import type { ProfileRef } from "../rules/profiles/types";

export type JsonObject = Record<string, unknown>;

export type TrustedPrincipalContext = {
  principal: {
    id: string;
    sessionVersion: number;
  };
};

export type AuthoritativeMemberSeed = {
  principalId: string;
  role: "host" | "player" | "observer";
};

export type AuthoritativeCharacterSeed = {
  characterId: string;
  controllerPrincipalId: string;
  staticCard: JsonObject & {
    name: string;
    sceneId: string;
  };
};

export type InitializeAuthoritativeRoomInput = {
  roomId: string;
  moduleId: string;
  moduleVersion?: string;
  members: AuthoritativeMemberSeed[];
  characters: AuthoritativeCharacterSeed[];
  fixtureFacts?: unknown[];
  /** Exact registered manifest selected only when a new room epoch is born. */
  runtimeProfiles?: RuntimeProfileManifest;
};

export type AuthoritativeActionInput =
  | {
      kind: "intent";
      submissionId: string;
      text: string;
      acknowledgementId?: string;
    }
  | {
      kind: "answer";
      submissionId: string;
      pendingInputId: string;
      answer: unknown;
      displayText?: string;
      acknowledgementId?: string;
    }
  | {
      kind: "retry";
      submissionId: string;
      rootActionId: string;
    }
  | {
      kind: "gear";
      submissionId: string;
      action: "wear" | "stow";
      slot: string;
      itemId?: string;
    }
  | {
      kind: "environmentInteract";
      submissionId: string;
      featureId: string;
      intent: "open" | "close";
    }
  | {
      kind: "environmentAbility";
      submissionId: string;
      featureId: string;
      abilityRef: string;
    }
  | {
      kind: "movement";
      submissionId: string;
      movementMode: "walk";
      spatialRevision: `sha256:${string}`;
      path: TacticalPosition[];
    }
  | {
      kind: "safetyPause";
      submissionId: string;
    }
  | {
      kind: "safetyAdjust";
      submissionId: string;
      presentationAdjustment: "fadeToBlack" | "reduceDetail" | "skipSensitiveContent";
    }
  | {
      kind: "errorReport";
      submissionId: string;
      receiptId: string;
      concern: "rules" | "facts";
      explanation: string;
    };

export type PublicReceipt = {
  receiptId: string;
  rootActionId: string;
  actorCharacterId?: string;
  status:
    | "awaitingInput"
    | "needsKp"
    | "committed"
    | "rejected"
    | "concluded"
    | "corrected"
    | "superseded";
  runtimeEpochId: string;
  activeBranchId: string;
  eventRange: { first: string; last: string; from?: number; to?: number } | null;
  scopeVersions: Record<string, string>;
  randomnessCommitments: Array<{
    randomnessId: string;
    requestHash: string;
    frozenParametersHash?: string;
  }>;
  pendingInputId?: string;
  correctionId?: string;
  projectionHash?: string;
  meaningfulFailure?: boolean;
  newOptions?: JsonObject[];
  resolutionDisposition?: "inWorldRefusal";
};

export type PreparedAuthoritativeAction = {
  kind: "prepared";
  preparedActionId: string;
  rootActionId: string;
  receipt?: PublicReceipt;
  kpProjection: unknown;
  resolutionMode?: "kpProposal" | "authorityDirect";
  phase?: "dueActorPlan" | "playerIntent";
  dueActorPlan?: JsonObject;
  /** Private Room-to-orchestrator continuation used only after a due NPC
   * stage pauses for the controlling player's explicit roll gesture. */
  resumedActionInput?: JsonObject;
  /** Room-certified original actor context. A different player may be the one
   * authorized to click a saving throw before this action can continue. */
  resumedPrincipalContext?: TrustedPrincipalContext;
};

export type DeliveryAudienceBinding = {
  audienceId: string;
  principalId: string;
  sessionVersion: number;
  seatId: string;
  characterId: string;
  /** Frozen observer locations for this result. Optional for pre-deployment open plans. */
  sceneIds?: string[];
  projectionHash: string;
  kpProjection: unknown;
};

export const DELIVERY_AUDIENCE_STATES = [
  "pending",
  "published",
  "rejected",
  "retryableFailure",
  "superseded",
] as const;

export type DeliveryAudienceState = typeof DELIVERY_AUDIENCE_STATES[number];

/** Room-owned publication state for one immutable audience snapshot. */
export type DeliveryAudiencePublication = {
  audienceId: string;
  viewerKey: string;
  projectionHash: string;
  deliveryGeneration: number;
  state: DeliveryAudienceState;
  errorCode?: string;
};

export type ExperiencedTranscriptMessage = {
  ordinal: number;
  messageId: string;
  sceneIds: string[];
  kind: "player" | "kp";
  speakerCharacterId: string | null;
  speakerName: string;
  body: string;
  sourceEventSeq: string;
  receiptId: string;
};

export type ExperiencedTranscriptMessageInput =
  & Omit<ExperiencedTranscriptMessage, "ordinal">
  & { viewerKey: string };

export type DeliveryPlan = {
  /** Frozen publication interpreter. Plans persisted before this field existed
   * are historical DELIVERY_PROTOCOL_PROFILE plans by genesis contract. */
  deliveryProtocol?: ProfileRef;
  publishCapability: string;
  rootActionId: string;
  receiptId: string;
  activeBranchId: string;
  eventRange: { first: string; last: string } | null;
  audiences: DeliveryAudienceBinding[];
  actorMessage?: {
    messageId: string;
    characterId: string;
    name: string;
    body: string;
    sceneIds: string[];
  };
};

export type DeliveryFrame = {
  deliveryId: string;
  receiptId: string;
  activeBranchId: string;
  projectionHash: string;
  presentationPolicyVersion: string;
  narrationPolicyVersion: string;
  payloadHash: string;
  text: string;
  sceneIds?: string[];
  derivedEvidenceRefs?: string[];
  derivedAgencyClaims?: Array<{
    subjectKind: "playerCharacter" | "npc" | "world";
    subjectRef: string | null;
    claimKind: "committedObservableAction" | "sensoryConsequence";
    basisRefs: string[];
  }>;
  deliveryGeneration?: number;
  audio?: { kind: "clientTts"; textHash: string };
};

export type ObserverDeliveryOutcome =
  | { kind: "none" }
  | { kind: "current"; frame: DeliveryFrame; body?: string };

/**
 * The only narration-recovery datum allowed through a player observation.
 * The capability is random and carries no Receipt, Audience, ViewerKey, or
 * projection claim; the Room must resolve all of those again from the trusted
 * principal and its frozen private journal.
 */
export type ViewerNarrationRecovery = {
  kind: "available";
  capability: string;
  state: "pending" | "rejected" | "retryableFailure";
};

/** One frozen, viewer-owned randomness request that is waiting only for the
 * controlling player's explicit roll gesture. The browser never supplies
 * faces or modifiers; it can only resume this exact Room-owned request. */
export type ViewerPendingPlayerRoll = {
  id: string;
  characterId: string;
  name: string;
  kind: "check" | "save" | "attack" | "init" | "damage" | "death" | "heal";
  ability: string;
  skill?: string;
  dc: number;
  reason: string;
  dice: string;
  advantage?: boolean;
  disadvantage?: boolean;
};

export type AuthoritativeRoomObservation = {
  readModel: unknown;
  transcript: ExperiencedTranscriptMessage[];
  delivery: ObserverDeliveryOutcome;
  pendingPlayerRolls: ViewerPendingPlayerRoll[];
  narrationRecovery?: ViewerNarrationRecovery;
  /** Server-adapter-only presentation hold. Every ref is already present in
   * this viewer's readModel; it prevents an undelivered result from appearing
   * as a detached clue before its grounded KP response. */
  presentationHold?: { knowledgeRefs: string[] };
};

export type AuthorityCommitOutcome =
  | {
      kind: "continue";
      prepared: PreparedAuthoritativeAction;
    }
  | {
      kind: "committed" | "concluded";
      receipt: PublicReceipt;
      kpProjection: unknown;
      deliveryPlan?: DeliveryPlan;
    }
  | {
      kind: "awaitingInput";
      receipt: PublicReceipt;
      pending: unknown;
      kpProjection?: unknown;
    }
  | {
      kind: "awaitingPlayerRoll";
      pendingPlayerRolls: ViewerPendingPlayerRoll[];
    }
  | {
      kind: "needsKp";
      receipt: PublicReceipt;
      code?: string;
      diagnostics: unknown[];
    }
  | {
      kind: "retryableFailure";
      code: string;
      receipt?: PublicReceipt;
    }
  | {
      kind: "rejected";
      code: string;
      explanation: string;
      receipt?: PublicReceipt;
    }
  | {
      kind: "committed";
      correctionId: string;
      strategy: "forwardCompensation" | "causalBranch";
      activeBranchId: string;
      supersededRootActionIds: string[];
      receipt: PublicReceipt;
      deliveryPlan: DeliveryPlan;
    };

export type AuthoritativeInitializationOutcome =
  | {
      created: boolean;
      runtimeEpochId: string;
      genesisHash: string;
      moduleRef: ProfileRef;
      runtimeProfiles: unknown;
      serviceCapabilities: unknown;
    }
  | Extract<AuthorityCommitOutcome, { kind: "rejected" }>;

export type { AuthoritativeRoomArchive as AuthoritativeArchive } from "./archive";
