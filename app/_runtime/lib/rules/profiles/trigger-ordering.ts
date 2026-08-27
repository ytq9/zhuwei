import { canonicalSha256 } from "./canonical";
import type { CanonicalProfileDocument, ProfileRef } from "./types";

export const TRIGGER_ORDERING_PROFILE = {
  profileId: "trigger-initiative-order-2014-v1",
  profileHash: "sha256:825ef8de6f962f01111c9ce325189c0d203ee71ab305149fd7b2b7485b6b8089",
} as const satisfies ProfileRef;

export const TRIGGER_ORDERING_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "triggerOrdering",
  profileId: TRIGGER_ORDERING_PROFILE.profileId,
  semanticVersion: "1.0.0",
  normativePayload: {
    conformanceVersion: "1",
    spec: "SPEC 0013",
    eligibility: "frozen-at-causal-point",
    crossControllerOrder: "explicit-dependency-then-initiative-or-entity-ordinal",
    sameControllerNonCommutative: "controller-private-pending-input",
    networkOrder: "ignored",
    objectTraversalOrder: "ignored",
    timeout: "hold-current-window",
  },
};

export type TriggerOrderEntity = {
  entityId: string;
  entityOrdinal: string;
  kind?: string;
};

export type FrozenTrigger = {
  triggerInstanceId: string;
  sourceEntityId: string;
  sourceKind?: string;
  controllerEntityId: string;
  definitionId: string;
  timing: string;
  mandatory: boolean;
  secrecy: string;
};

function ordinal(value: string): bigint {
  return /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : 0n;
}

export function orderTriggerEntityIds(
  causationEntityId: string,
  candidateIds: readonly string[],
  entities: Readonly<Record<string, TriggerOrderEntity | undefined>>,
  initiativeOrder: readonly string[],
  activeEntityId?: string,
): string[] {
  const unique = [...new Set(candidateIds)];
  if (initiativeOrder.length > 0) {
    const start = Math.max(0, initiativeOrder.indexOf(activeEntityId ?? causationEntityId));
    const rotated = [...initiativeOrder.slice(start), ...initiativeOrder.slice(0, start)];
    return unique.sort((left, right) => {
      const leftEntity = entities[left];
      const rightEntity = entities[right];
      const leftEnvironment = leftEntity?.kind === "environment";
      const rightEnvironment = rightEntity?.kind === "environment";
      if (leftEnvironment !== rightEnvironment) return leftEnvironment ? 1 : -1;
      const leftIndex = rotated.indexOf(left);
      const rightIndex = rotated.indexOf(right);
      if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
      if (leftIndex >= 0) return -1;
      if (rightIndex >= 0) return 1;
      return left.localeCompare(right);
    });
  }
  return unique.sort((left, right) => {
    const leftEntity = entities[left];
    const rightEntity = entities[right];
    const leftEnvironment = leftEntity?.kind === "environment";
    const rightEnvironment = rightEntity?.kind === "environment";
    if (leftEnvironment !== rightEnvironment) return leftEnvironment ? 1 : -1;
    if (left === causationEntityId && right !== causationEntityId) return -1;
    if (right === causationEntityId && left !== causationEntityId) return 1;
    const difference = ordinal(leftEntity?.entityOrdinal ?? "0") - ordinal(rightEntity?.entityOrdinal ?? "0");
    return difference < 0n ? -1 : difference > 0n ? 1 : left.localeCompare(right);
  });
}

export function freezeTriggerBatch(
  rootActionId: string,
  causation: Readonly<Record<string, unknown>>,
  triggers: readonly FrozenTrigger[],
  orderBaseline: readonly string[],
): { triggerBatchId: string; triggerBatchHash: string; orderedTriggers: FrozenTrigger[] } {
  const orderedTriggers = [...triggers].sort((left, right) => {
    const leftEnvironment = left.sourceKind === "environment";
    const rightEnvironment = right.sourceKind === "environment";
    if (leftEnvironment !== rightEnvironment) return leftEnvironment ? 1 : -1;
    if (leftEnvironment) {
      return left.definitionId.localeCompare(right.definitionId)
        || left.sourceEntityId.localeCompare(right.sourceEntityId)
        || left.triggerInstanceId.localeCompare(right.triggerInstanceId);
    }
    return orderBaseline.indexOf(left.sourceEntityId) - orderBaseline.indexOf(right.sourceEntityId)
      || left.definitionId.localeCompare(right.definitionId)
      || left.triggerInstanceId.localeCompare(right.triggerInstanceId);
  });
  const frozen = {
    causation,
    orderBaseline: [...orderBaseline],
    triggers: orderedTriggers,
  };
  const triggerBatchHash = canonicalSha256(frozen);
  return {
    triggerBatchId: `trigger-batch:${rootActionId}:${triggerBatchHash.slice("sha256:".length, "sha256:".length + 24)}`,
    triggerBatchHash,
    orderedTriggers,
  };
}
