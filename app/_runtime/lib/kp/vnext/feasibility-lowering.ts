import type { VNextProposalBundleCommand } from "./proposal-bundle";
import type { WorldInteractionFeasibilityRulingPlan } from "../../rules/v2/world-interaction-model";
import { isSha256 } from "../../rules/v2/validation";

/** Shared by immediate refusals and frozen choices. All cost variants keep
 * their original values; an unsupported kind rejects the entire plan. */
export function lowerFeasibilityPlan(
  command: Extract<VNextProposalBundleCommand, { kind: "inWorldRefusal" }>,
): WorldInteractionFeasibilityRulingPlan | undefined {
  if (!isSha256(command.contextHash)) return undefined;
  const costs: WorldInteractionFeasibilityRulingPlan["costs"][number][] = [];
  for (const cost of command.ruling.attemptCosts) {
    if (cost.kind === "item") costs.push({ kind: "item", entryRef: cost.entryRef,
      quantity: cost.quantity, charges: cost.charges, durability: cost.durability });
    else if (cost.kind === "fictionTime") costs.push({ kind: "fictionTime", durationMicros: cost.durationMicros });
    else if (cost.kind === "resource") costs.push({ kind: "resource", resourceId: cost.resourceId, amount: cost.amount });
    else return undefined;
  }
  return {
    schema: "zhuwei.world-interaction-feasibility-ruling-plan/v1", contextHash: command.contextHash,
    readSet: structuredClone(command.readSet), actorCharacterId: command.actorCharacterId,
    intent: command.intent, method: command.method, rulingKind: command.ruling.kind,
    publicBasis: command.ruling.publicBasis,
    prerequisites: command.ruling.prerequisites.map(({ kind, ref, description }) => ({ kind, ref, description })),
    nextActions: command.ruling.nextActions.map(({ description }) => ({ description })), costs,
    basisRefs: [...new Set([...command.basisRefs,
      ...command.ruling.nextActions.flatMap(action => action.basisRefs)])].sort(),
  };
}
