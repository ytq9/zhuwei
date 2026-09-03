import {
  VNEXT_REQUIRED_CONTEXT_SCHEMA,
  type VNextRequiredContext,
} from "../kp/vnext/required-context";
import type {
  AuthoritativeWorldState,
  ReplayHead,
  RuntimeProfileManifest,
} from "../rules";
import type { AuthoritativeActionInput, JsonObject } from "./authority-types";

export type RoomVNextReadSetPhase =
  | "proposalLowering"
  | "beforeFirstRulesStep"
  | "beforeRandomnessWave"
  | "beforeFinalCommit";

export type RoomVNextPrepareContextInput = Readonly<{
  actionInput: AuthoritativeActionInput;
  preparedActionId: string;
  rootActionId: string;
  actorCharacterId: string;
  profiles: RuntimeProfileManifest;
  state: AuthoritativeWorldState;
  replayHead: ReplayHead;
  kpProjection: JsonObject;
}>;

export type RoomVNextPrepareContextResult =
  | Readonly<{ kind: "notApplicable" }>
  | Readonly<{ kind: "accepted"; requiredContext: VNextRequiredContext }>
  | Readonly<{
      kind: "rejected";
      code: string;
      /** This text crosses the Room public rejection boundary and must not contain secrets. */
      explanation: string;
    }>;

export type RoomVNextReadSetValidationInput = Readonly<{
  phase: RoomVNextReadSetPhase;
  requiredContext: VNextRequiredContext;
  /** Original lowered Rules input. Randomness fulfillment keeps validating the
   * plan captured here rather than widening back to the epistemic snapshot. */
  rulesInput: JsonObject;
  profiles: RuntimeProfileManifest;
  state: AuthoritativeWorldState;
  replayHead: ReplayHead;
}>;

export type RoomVNextReadSetValidationResult =
  | Readonly<{ kind: "valid" }>
  | Readonly<{
      kind: "conflict";
      /** Internal audit data only. Room never copies these refs into a public rejection. */
      changedRefs: readonly string[];
    }>;

export type RoomVNextProposalLoweringInput = Readonly<{
  proposal: unknown;
  preparedActionId: string;
  rootActionId: string;
  actorCharacterId: string;
  principalId: string;
  requiredContext: VNextRequiredContext;
  profiles: RuntimeProfileManifest;
  state: AuthoritativeWorldState;
}>;

export type RoomVNextProposalLoweringResult =
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{
      kind: "accepted";
      input: JsonObject;
      receiptExtras?: JsonObject;
      forceConcluded?: boolean;
    }>
  | Readonly<{
      kind: "rejected";
      code: string;
      /** This text crosses the Room public rejection boundary and must not contain secrets. */
      explanation: string;
    }>;

/**
 * Test-isolated vNext integration seam. It does not add another authority:
 * context is built from the current Room state and the same Rules projection,
 * proposal lowering only produces input for Rules.step, and read-set checks are
 * synchronous so the final check can run inside the Room commit transaction.
 */
export type RoomVNextAdjudicationBridge = Readonly<{
  prepareRequiredContext: (
    input: RoomVNextPrepareContextInput,
  ) => RoomVNextPrepareContextResult;
  validateReadSet: (
    input: RoomVNextReadSetValidationInput,
  ) => RoomVNextReadSetValidationResult;
  lowerProposal?: (
    input: RoomVNextProposalLoweringInput,
  ) => RoomVNextProposalLoweringResult;
}>;

/** Minimal Room-owned binding check. Domain completeness and hash integrity
 * remain the RequiredContext builder/validator's responsibility. */
export function requiredContextMatchesPreparedAction(
  value: unknown,
  expected: Readonly<{
    preparedActionId: string;
    rootActionId: string;
    roomEpochRef: string;
    baseEventSeq: string;
  }>,
): value is VNextRequiredContext {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<VNextRequiredContext>;
  const binding = candidate.binding;
  return candidate.schema === VNEXT_REQUIRED_CONTEXT_SCHEMA
    && binding !== undefined
    && binding.preparedActionId === expected.preparedActionId
    && binding.rootActionId === expected.rootActionId
    && binding.roomEpochRef === expected.roomEpochRef
    && binding.baseEventSeq === expected.baseEventSeq
    && typeof binding.contextHash === "string"
    && binding.contextHash.length > 0
    // The frozen context's own binding.readSet is always empty by
    // construction (required-context.ts rejects a non-empty one at build
    // time): the transaction read set is re-resolved from Proposal lowering
    // into the server-private Rules plan/continuation, never from this
    // epistemic slice. So this is a shape check, not a content check -- there
    // is never an element for it to inspect.
    && Array.isArray(binding.readSet)
    && binding.readSet.length === 0;
}
