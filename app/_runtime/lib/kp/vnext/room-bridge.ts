import type { RuntimeProfileManifest } from "../../rules/profiles/types";
import type { KpSpatialReadModel } from "../../rules/authority-read";
import type {
  RoomVNextAdjudicationBridge,
  RoomVNextProposalLoweringResult,
} from "../../room/vnext-adjudication-bridge";
import {
  VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
} from "../../rules/profiles/vnext-world-interaction";
import { isPlainRecord } from "./canonical-json";
import { freezeAdjudicationContext } from "./context";
import { validateVNextTransactionReadSet } from "./required-context-runtime";
import {
  lowerVNextCoarseFormProposal,
  VNEXT_KP_PROPOSAL_SCHEMA,
} from "./proposals";
import {
  lowerVNextProposalBundle,
  VNEXT_PROPOSAL_BUNDLE_SCHEMA,
  type VNextProposalBundleCommand,
} from "./proposal-bundle";

/**
 * Hard ceiling on the frozen artifact, in canonical units (UTF-8 bytes / 4).
 * These are not model tokens and do not pretend to be. What a provider will
 * actually accept is measured separately on the assembled request, because a
 * context that fits here can still overflow once the system prompt, Form and
 * tool schemas and repair diagnostics are built around it.
 */
const VNEXT_CONTEXT_MAX_UNITS = 16_000;

/**
 * Preparation failures are reported by cause, so a request that never reached
 * a provider is never presented as one that did.
 */
const PUBLIC_BLOCK_CODES = Object.freeze({
  criticalUnavailable: "CONTEXT_INSUFFICIENT",
  integrityConflict: "CONTEXT_INSUFFICIENT",
  preparationLimit: "CONTEXT_PREPARATION_LIMIT",
  contextBudgetExceeded: "CONTEXT_BUDGET_EXCEEDED",
  invalid: "CONTEXT_INSUFFICIENT",
} as const);

const BLOCK_EXPLANATIONS = Object.freeze({
  criticalUnavailable: "The action does not have a complete authorized adjudication context.",
  integrityConflict: "The adjudication context does not agree with the current world state.",
  preparationLimit: "Preparing this action's adjudication context exceeded its work budget.",
  contextBudgetExceeded: "This action's adjudication context is larger than one request may carry.",
  invalid: "The action does not have a complete authorized adjudication context.",
} as const);

/**
 * Isolated stage-three bridge used only by the test vNext Room binding. Every
 * accepted proposal still enters the same Rules.step and Room transaction.
 */
export const VNEXT_STAGE3_ROOM_ADJUDICATION_BRIDGE: RoomVNextAdjudicationBridge =
  Object.freeze({
    prepareRequiredContext(input) {
      if (!sameManifest(input.profiles, VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST)) {
        return Object.freeze({ kind: "notApplicable" });
      }
      if (input.actionInput.kind !== "intent") {
        return Object.freeze({
          kind: "rejected",
          code: "requiredContextUnavailable",
          explanation: "The isolated vNext profile accepts natural-language intent actions only.",
        });
      }
      if (!isKpProjection(input.kpProjection)) {
        return Object.freeze({
          kind: "rejected",
          code: "requiredContextUnavailable",
          explanation: "The adjudication projection is unavailable.",
        });
      }
      const result = freezeAdjudicationContext({
        state: input.state,
        profiles: input.profiles,
        kpProjection: input.kpProjection,
        replayHead: {
          eventSeq: input.replayHead.eventSeq,
          stateHash: input.replayHead.stateHash,
        },
        preparedActionId: input.preparedActionId,
        rootActionId: input.rootActionId,
        submissionRef: input.actionInput.submissionId,
        actorCharacterId: input.actorCharacterId,
        intentText: input.actionInput.text,
        maxUnits: VNEXT_CONTEXT_MAX_UNITS,
      });
      // The work receipt and coverage stay server-private; only the reason
      // crosses the Room public rejection boundary.
      return result.kind === "ready"
        ? Object.freeze({ kind: "accepted", requiredContext: result.context })
        : Object.freeze({
            kind: "rejected",
            code: PUBLIC_BLOCK_CODES[result.reason],
            explanation: BLOCK_EXPLANATIONS[result.reason],
          });
    },
    validateReadSet(input) {
      if (!sameManifest(input.profiles, VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST)
        || !profilesMatchContext(input.profiles, input.requiredContext.binding.profiles)) {
        return Object.freeze({ kind: "conflict", changedRefs: Object.freeze([]) });
      }
      const transactionReadSet = loweredTransactionReadSet(input.rulesInput);
      if (transactionReadSet === undefined) {
        return Object.freeze({ kind: "conflict", changedRefs: Object.freeze([]) });
      }
      if (transactionReadSet.length === 0) {
        // A player-choice pending transition reads only the authenticated
        // actor/root binding, which Rules revalidates before opening the
        // private PendingInput. It has no world read set, randomness, or cost
        // to settle at this phase.
        return isPlayerChoicePendingInput(input.rulesInput)
          ? Object.freeze({ kind: "valid" })
          : Object.freeze({ kind: "conflict", changedRefs: Object.freeze([]) });
      }
      const validation = validateVNextTransactionReadSet(transactionReadSet, input.state);
      return validation.kind === "valid"
        ? validation
        : Object.freeze({
            kind: "conflict",
            changedRefs: Object.freeze(validation.conflicts.map(({ ref }) => ref)),
          });
    },
    lowerProposal(input) {
      if (!isPlainRecord(input.proposal)
        || (input.proposal.rootActionId !== undefined
          && input.proposal.rootActionId !== input.rootActionId)) {
        return Object.freeze({
          kind: "rejected",
          code: "PROPOSAL_FORM_INVALID",
          explanation: "The KP proposal does not match the frozen vNext Form contract.",
        });
      }
      // Room injects its trusted RootAction binding before commit. It is not a
      // model-authored Form field, so verify it above and remove it before the
      // strict Form envelope validator/lowerer.
      const { rootActionId: _trustedRoomBinding, ...formProposal } = input.proposal;
      if (formProposal.schema === VNEXT_PROPOSAL_BUNDLE_SCHEMA) {
        const lowered = lowerVNextProposalBundle({
          value: formProposal,
          requiredContext: input.requiredContext,
          state: input.state,
          rootActionId: input.rootActionId,
          actorCharacterId: input.actorCharacterId,
        });
        if (lowered.kind === "rejected") {
          return Object.freeze({
            kind: "rejected",
            code: lowered.code,
            explanation: "The KP proposal bundle could not be verified against its frozen context.",
          });
        }
        return bundleCommandToRoomLowering(lowered.command);
      }
      if (formProposal.schema !== VNEXT_KP_PROPOSAL_SCHEMA) {
        return Object.freeze({
          kind: "rejected",
          code: "PROPOSAL_FORM_INVALID",
          explanation: "The KP proposal does not match the frozen vNext Form contract.",
        });
      }
      const lowered = lowerVNextCoarseFormProposal({
        value: formProposal,
        requiredContext: input.requiredContext,
        state: input.state,
        rootActionId: input.rootActionId,
        actorCharacterId: input.actorCharacterId,
      });
      return lowered.kind === "accepted"
        ? Object.freeze({ kind: "accepted", input: lowered.rulesInput })
        : Object.freeze({
            kind: "rejected",
            code: lowered.code,
            explanation: "The KP proposal could not be verified against its frozen context.",
          });
    },
  });

function bundleCommandToRoomLowering(
  command: VNextProposalBundleCommand,
): RoomVNextProposalLoweringResult {
  if (command.kind === "rulesStep") {
    return Object.freeze({
      kind: "accepted",
      input: structuredClone(command.rulesInput),
    });
  }
  if (command.kind === "pendingClarification") {
    // Keep this on the existing Rules pending seam. The command's publicRisk
    // is the player-visible consequence text; basis refs remain in the
    // frozen Context and are never copied into the generic pending payload.
    return Object.freeze({
      kind: "accepted",
      input: {
        kind: "resolveImprovisedAction",
        rootActionId: command.rootActionId,
        actorCharacterId: command.actorCharacterId,
        ruling: {
          kind: "playerChoice",
          pendingInputId: command.pendingInputId,
          question: command.question,
          choices: command.choices.map((choice) => ({
            choiceId: choice.choiceId,
            label: choice.label,
            consequence: choice.publicRisk,
          })),
        },
      },
    });
  }
  if (command.kind === "atomicRulesSteps") {
    // An ordered multi-Form set must become exactly one Rules transaction and
    // one Receipt. Executing the steps one at a time here would produce
    // partial world state and multiple Receipts, so this stays closed until
    // the atomic Rules/Room consumer exists.
    return Object.freeze({
      kind: "rejected",
      code: "BUNDLE_LOWERING_UNSUPPORTED",
      explanation: "The pinned vNext Rules profile has no atomic multi-step consumer yet.",
    });
  }
  if (command.kind === "inWorldRefusal") {
    // Refusal has no Rules primitive in the stage-three bridge until the
    // profile-gated typed refusal input is installed. Never encode it as a
    // direct success or silently discard attempt costs.
    return Object.freeze({
      kind: "rejected",
      code: "BUNDLE_LOWERING_UNSUPPORTED",
      explanation: "The pinned vNext Rules profile has no typed in-world refusal consumer yet.",
    });
  }
  // A confirmed high-risk ruling must not ask the player to confirm again.
  // It remains blocked until the dedicated Rules primitive can consume its
  // frozen ruling and accepted costs.
  return Object.freeze({
    kind: "rejected",
    code: "BUNDLE_LOWERING_UNSUPPORTED",
    explanation: "The pinned vNext Rules profile has no confirmed high-risk consumer yet.",
  });
}

function isKpProjection(value: unknown): value is KpSpatialReadModel {
  return isPlainRecord(value)
    && value.kind === "projected"
    && isPlainRecord(value.viewer)
    && value.viewer.kind === "kp"
    && typeof value.stateVersion === "string"
    && typeof value.activeBranchId === "string"
    && typeof value.projectionHash === "string"
    && isPlainRecord(value.spatialEvidence);
}

function loweredTransactionReadSet(
  rulesInput: Readonly<Record<string, unknown>>,
): readonly Readonly<{ ref: string; revisionOrHash: string }>[] | undefined {
  if ((rulesInput.kind !== "reviseSemanticDefinition"
      && rulesInput.kind !== "resolveWorldInteraction")
    || !isPlainRecord(rulesInput.plan)
    || !Array.isArray(rulesInput.plan.readSet)) return undefined;
  const readSet = rulesInput.plan.readSet;
  if (!readSet.every((entry) => isPlainRecord(entry)
    && typeof entry.ref === "string"
    && entry.ref.length > 0
    && typeof entry.revisionOrHash === "string"
    && entry.revisionOrHash.length > 0)) return undefined;
  return readSet as readonly Readonly<{ ref: string; revisionOrHash: string }>[];
}

function isPlayerChoicePendingInput(
  rulesInput: Readonly<Record<string, unknown>>,
): boolean {
  const ruling = rulesInput.ruling;
  return rulesInput.kind === "resolveImprovisedAction"
    && isPlainRecord(ruling)
    && ruling.kind === "playerChoice"
    && typeof ruling.pendingInputId === "string"
    && ruling.pendingInputId.length > 0
    && typeof ruling.question === "string"
    && ruling.question.length > 0
    && Array.isArray(ruling.choices)
    && ruling.choices.length >= 2;
}

function sameManifest(
  left: RuntimeProfileManifest,
  right: RuntimeProfileManifest,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function profilesMatchContext(
  profiles: RuntimeProfileManifest,
  bound: readonly Readonly<{ profileRef: string; profileHash: string }>[],
): boolean {
  const actual = [
    profiles.manifest,
    profiles.ruleset,
    profiles.eventSchema,
    profiles.abilityCompiler,
    profiles.geometry,
    profiles.triggerOrdering,
    profiles.fictionCombatTime,
    ...profiles.extensions,
  ].map(({ profileId, profileHash }) => ({ profileRef: profileId, profileHash }))
    .sort((left, right) => left.profileRef.localeCompare(right.profileRef));
  const expected = [...bound].sort((left, right) => left.profileRef.localeCompare(right.profileRef));
  return JSON.stringify(actual) === JSON.stringify(expected);
}
