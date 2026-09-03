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
  lowerVNextProposalBundle,
  VNEXT1_PROPOSAL_BUNDLE_SCHEMA,
  type VNextAttemptCost,
  type VNextProposalBundleCommand,
} from "./proposal-bundle";
import {
  lowerVNext2ProposalBundle,
  type VNext2ProposalBundleCommand,
} from "./proposal-bundle-lowering";
import { VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "./proposal-schema";

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
      // Opening a private player choice has no world read set. Its actor,
      // controller and root binding are revalidated by Rules when the
      // PendingInput is created; test this before the plan extractor because
      // this input intentionally has no `plan.readSet` field.
      if (isPlayerChoicePendingInput(input.rulesInput)) {
        return Object.freeze({ kind: "valid" });
      }
      const transactionReadSet = loweredTransactionReadSet(input.rulesInput);
      if (transactionReadSet === undefined) {
        return Object.freeze({ kind: "conflict", changedRefs: Object.freeze([]) });
      }
      if (transactionReadSet.length === 0) {
        return Object.freeze({ kind: "conflict", changedRefs: Object.freeze([]) });
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
      if (formProposal.schema === VNEXT1_PROPOSAL_BUNDLE_SCHEMA) {
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
      if (formProposal.schema === VNEXT2_PROPOSAL_BUNDLE_SCHEMA) {
        const lowered = lowerVNext2ProposalBundle({
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
        return vnext2CommandToRoomLowering(lowered.command);
      }
      return Object.freeze({
        kind: "rejected",
        code: "PROPOSAL_FORM_INVALID",
        explanation: "The KP proposal does not match the frozen vNext Bundle contract.",
      });
    },
  });

/** Exported for direct unit coverage of the one non-atomic per-command
 * lowering surface; every accepted proposal still enters the same Rules.step
 * and Room transaction through the bridge above. */
export function bundleCommandToRoomLowering(
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
    return Object.freeze({
      kind: "accepted",
      input: {
        kind: "applyAtomicWorldInteractionSteps",
        rootActionId: command.rootActionId,
        actorCharacterId: command.actorCharacterId,
        bundleHash: command.bundleHash,
        contextHash: command.contextHash,
        sharedRuling: command.sharedRuling,
        steps: command.steps.map((step) => ({
          formId: step.formId,
          proposalRef: step.proposalRef,
          ruling: step.ruling,
          rulesInput: structuredClone(step.rulesInput),
          dependsOn: [...step.dependsOn],
          consumes: step.consumes.map((reference) => ({ ...reference })),
          produces: step.produces.map((reference) => ({ ...reference })),
          outcomeBinding: step.outcomeBinding,
        })),
      },
    });
  }
  if (command.kind === "inWorldRefusal") {
    // The world declining an action is a first-class mechanical outcome, not
    // an error -- it lowers to the typed feasibility-ruling Rules input.
    // Attempt costs are lowered only when Rules already has a transition
    // path for their kind (currently: item costs only); a cost kind Rules
    // cannot yet apply must fail the whole lowering closed rather than be
    // silently dropped, since a real spent cost must never vanish.
    const costs = lowerAttemptCosts(command.ruling.attemptCosts);
    if (costs === undefined) {
      return Object.freeze({
        kind: "rejected",
        code: "BUNDLE_LOWERING_UNSUPPORTED",
        explanation: "The pinned vNext Rules profile has no transition for one of the attempt costs.",
      });
    }
    return Object.freeze({
      kind: "accepted",
      input: {
        kind: "ruleWorldInteractionFeasibility",
        rootActionId: command.rootActionId,
        actorCharacterId: command.actorCharacterId,
        plan: {
          schema: "zhuwei.world-interaction-feasibility-ruling-plan/v1",
          actorCharacterId: command.actorCharacterId,
          intent: command.intent,
          method: command.method,
          rulingKind: command.ruling.kind,
          publicBasis: command.ruling.publicBasis,
          prerequisites: command.ruling.prerequisites.map((prerequisite) => ({
            kind: prerequisite.kind,
            ref: prerequisite.ref,
            description: prerequisite.description,
          })),
          nextActions: command.ruling.nextActions.map((nextAction) => ({
            description: nextAction.description,
          })),
          costs,
          // Authority-only: the KP's own citation plus every nextAction's
          // basisRefs fold in here so Rules can bind its read scope to them.
          // None of this reaches the committed payload -- see the plan type.
          basisRefs: [...new Set([
            ...command.basisRefs,
            ...command.ruling.nextActions.flatMap((nextAction) => nextAction.basisRefs),
          ])].sort(),
        },
      },
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

/**
 * vnext-2 counterpart of bundleCommandToRoomLowering above. Only three
 * command kinds exist for vnext-2 in this pass (see
 * proposal-bundle-lowering.ts): a `rulesStep` forwards its rulesInput
 * verbatim -- this is also how a whole atomic multi-entry Bundle reaches
 * Room, since its rulesInput.kind is `applyAtomicWorldInteractionSteps`,
 * the exact same Rules primitive the vnext-1 `atomicRulesSteps` command
 * lowers to just above. `pendingClarification` and `inWorldRefusal` are
 * unchanged in shape from vnext-1 and lower the same way.
 */
export function vnext2CommandToRoomLowering(
  command: VNext2ProposalBundleCommand,
): RoomVNextProposalLoweringResult {
  if (command.kind === "rulesStep") {
    return Object.freeze({
      kind: "accepted",
      input: structuredClone(command.rulesInput),
    });
  }
  if (command.kind === "pendingClarification") {
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
  // kind === "inWorldRefusal"
  const costs = lowerAttemptCosts(command.ruling.attemptCosts);
  if (costs === undefined) {
    return Object.freeze({
      kind: "rejected",
      code: "BUNDLE_LOWERING_UNSUPPORTED",
      explanation: "The pinned vNext Rules profile has no transition for one of the attempt costs.",
    });
  }
  return Object.freeze({
    kind: "accepted",
    input: {
      kind: "ruleWorldInteractionFeasibility",
      rootActionId: command.rootActionId,
      actorCharacterId: command.actorCharacterId,
      plan: {
        schema: "zhuwei.world-interaction-feasibility-ruling-plan/v1",
        actorCharacterId: command.actorCharacterId,
        intent: command.intent,
        method: command.method,
        rulingKind: command.ruling.kind,
        publicBasis: command.ruling.publicBasis,
        prerequisites: command.ruling.prerequisites.map((prerequisite) => ({
          kind: prerequisite.kind,
          ref: prerequisite.ref,
          description: prerequisite.description,
        })),
        nextActions: command.ruling.nextActions.map((nextAction) => ({
          description: nextAction.description,
        })),
        costs,
        basisRefs: [...new Set([
          ...command.basisRefs,
          ...command.ruling.nextActions.flatMap((nextAction) => nextAction.basisRefs),
        ])].sort(),
      },
    },
  });
}

/**
 * Rules currently has exactly one attempt-cost transition path: the item-cost
 * path world-interaction already uses. A `fictionTime` or `resource` attempt
 * cost has no Rules consumer yet, so its presence fails the whole lowering
 * closed -- it must never be silently dropped, because it was really spent.
 */
function lowerAttemptCosts(
  costs: readonly VNextAttemptCost[],
): readonly Readonly<{
  kind: "item";
  entryRef: string;
  quantity: number;
  charges: number;
  durability: number;
}>[] | undefined {
  const lowered: Readonly<{
    kind: "item";
    entryRef: string;
    quantity: number;
    charges: number;
    durability: number;
  }>[] = [];
  for (const cost of costs) {
    if (cost.kind !== "item") return undefined;
    lowered.push({
      kind: "item",
      entryRef: cost.entryRef,
      quantity: cost.quantity,
      charges: cost.charges,
      durability: cost.durability,
    });
  }
  return lowered;
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
  if (rulesInput.kind === "applyAtomicWorldInteractionSteps") {
    if (!Array.isArray(rulesInput.steps) || rulesInput.steps.length < 2) return undefined;
    const merged = new Map<string, string>();
    for (const step of rulesInput.steps) {
      if (!isPlainRecord(step)
        || !isPlainRecord(step.rulesInput)
        || !["materializeSemanticDefinition", "reviseSemanticDefinition", "resolveWorldInteraction"]
          .includes(String(step.rulesInput.kind))) return undefined;
      const childReadSet = loweredTransactionReadSet(step.rulesInput);
      if (childReadSet === undefined || childReadSet.length === 0) return undefined;
      for (const { ref, revisionOrHash } of childReadSet) {
        // Prospective handles are not current authority reads. Rules derives
        // and validates their committed refs only inside a branch candidate.
        if (ref.startsWith("prospective:")) return undefined;
        const prior = merged.get(ref);
        if (prior !== undefined && prior !== revisionOrHash) return undefined;
        merged.set(ref, revisionOrHash);
      }
    }
    return [...merged.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([ref, revisionOrHash]) => ({ ref, revisionOrHash }));
  }
  if ((rulesInput.kind !== "materializeSemanticDefinition"
      && rulesInput.kind !== "reviseSemanticDefinition"
      && rulesInput.kind !== "resolveWorldInteraction")
    || !isPlainRecord(rulesInput.plan)
    || !Array.isArray(rulesInput.plan.readSet)) return undefined;
  const readSet = rulesInput.plan.readSet;
  if (!readSet.every((entry) => isPlainRecord(entry)
    && typeof entry.ref === "string"
    && entry.ref.length > 0
    && !entry.ref.startsWith("prospective:")
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
