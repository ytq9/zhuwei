import type { TacticalPosition } from "../rules/tactical-projection";

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
};

export type DeliveryAudienceBinding = {
  audienceId: string;
  principalId: string;
  sessionVersion: number;
  seatId: string;
  characterId: string;
  projectionHash: string;
  kpProjection: unknown;
};

export type DeliveryPlan = {
  publishCapability: string;
  rootActionId: string;
  receiptId: string;
  activeBranchId: string;
  eventRange: { first: string; last: string } | null;
  audiences: DeliveryAudienceBinding[];
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
  audio?: { kind: "clientTts"; textHash: string };
};

export type ObserverDeliveryOutcome =
  | { kind: "none" }
  | { kind: "current"; frame: DeliveryFrame; body?: string };

export type AuthoritativeRoomObservation = {
  readModel: unknown;
  delivery: ObserverDeliveryOutcome;
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
      runtimeProfiles: unknown;
      serviceCapabilities: unknown;
    }
  | Extract<AuthorityCommitOutcome, { kind: "rejected" }>;

export type { AuthoritativeRoomArchive as AuthoritativeArchive } from "./archive";
