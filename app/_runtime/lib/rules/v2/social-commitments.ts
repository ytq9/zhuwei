import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, EventPayloadByType } from "./model";
import { hasExactKeys, isNonEmptyString, isRecord } from "./validation";

export type SocialCommitmentEventType = "RelationshipChanged" | "PromiseMade" | "DebtIncurred";
export type SocialCommitment =
  | Readonly<{ kind: "relationship"; relationshipId: string; subjectIds: readonly string[]; change: string }>
  | Readonly<{ kind: "promise"; promiseId: string; promisorId: string; promiseeId: string; content: string; condition: string }>
  | Readonly<{ kind: "debt"; debtId: string; debtorId: string; creditorId: string; obligation: string; condition: string }>;

const POLICY: Readonly<Record<SocialCommitmentEventType, string>> = {
  RelationshipChanged: "visibility:relationship-participants",
  PromiseMade: "visibility:promise-participants",
  DebtIncurred: "visibility:debt-participants",
};
export function socialCommitmentPolicy(type: SocialCommitmentEventType): string { return POLICY[type]; }

export function socialCommitmentConform(value: unknown): value is SocialCommitment {
  if (!isRecord(value)) return false;
  if (value.kind === "relationship") return hasExactKeys(value, ["kind", "relationshipId", "subjectIds", "change"])
    && isNonEmptyString(value.relationshipId) && isNonEmptyString(value.change) && refs(value.subjectIds, 2);
  if (value.kind === "promise") return hasExactKeys(value, ["kind", "promiseId", "promisorId", "promiseeId", "content", "condition"])
    && [value.promiseId, value.promisorId, value.promiseeId, value.content, value.condition].every(isNonEmptyString);
  return value.kind === "debt" && hasExactKeys(value, ["kind", "debtId", "debtorId", "creditorId", "obligation", "condition"])
    && [value.debtId, value.debtorId, value.creditorId, value.obligation, value.condition].every(isNonEmptyString);
}

/** Exact public semantics; causal facts stay in the authority-only basis. */
export function socialCommitmentFromPayload(type: SocialCommitmentEventType, payload: unknown): SocialCommitment | undefined {
  if (!isRecord(payload)) return undefined;
  const value = type === "RelationshipChanged"
    ? { kind: "relationship", relationshipId: payload.relationshipId, subjectIds: payload.subjectIds, change: payload.change }
    : type === "PromiseMade"
      ? { kind: "promise", promiseId: payload.promiseId, promisorId: payload.promisorId, promiseeId: payload.promiseeId,
        content: payload.content, condition: payload.condition }
      : { kind: "debt", debtId: payload.debtId, debtorId: payload.debtorId, creditorId: payload.creditorId,
        obligation: payload.obligation, condition: payload.condition };
  return socialCommitmentConform(value) ? value : undefined;
}

export function socialCommitmentRefs(value: SocialCommitment): readonly string[] {
  return [value.kind === "relationship" ? value.relationshipId : value.kind === "promise" ? value.promiseId : value.debtId,
    ...socialCommitmentParticipants(value)];
}

export function socialCommitmentParticipants(value: SocialCommitment): readonly string[] {
  return value.kind === "relationship" ? value.subjectIds
    : value.kind === "promise" ? [value.promisorId, value.promiseeId] : [value.debtorId, value.creditorId];
}

export function socialCommitmentPayloadConform(type: SocialCommitmentEventType, value: unknown): boolean {
  if (!isRecord(value) || !socialCommitmentFromPayload(type, value)) return false;
  if (type === "RelationshipChanged") return hasExactKeys(value, ["relationshipId", "subjectIds", "change", "basisFactIds"])
    && refs(value.basisFactIds);
  if (type === "PromiseMade") return hasExactKeys(value, ["promiseId", "promisorId", "promiseeId", "content", "condition"]);
  return hasExactKeys(value, ["debtId", "debtorId", "creditorId", "obligation", "condition", "basisFactIds"])
    && refs(value.basisFactIds, 1);
}

/** Shared preflight/fold gate. A relationship ID retains its participants;
 * obligations are created once and never overwritten by a repeated event. */
export function socialCommitmentIssue(state: AuthoritativeWorldState, type: SocialCommitmentEventType, value: unknown): string | undefined {
  if (!socialCommitmentPayloadConform(type, value)) return "social:commitment-payload-invalid";
  const payload = value as EventPayloadByType[SocialCommitmentEventType];
  if (type === "RelationshipChanged") {
    const row = payload as EventPayloadByType["RelationshipChanged"];
    if (row.subjectIds.some(id => !Object.hasOwn(state.entities, id))
      || row.basisFactIds.some(id => !Object.hasOwn(state.canonicalFacts, id))) return "social:relationship-basis-unavailable";
    const prior = state.campaignRuntime.relationships[row.relationshipId];
    if (prior && (!Array.isArray(prior.subjectIds)
      || canonicalSha256([...prior.subjectIds].sort()) !== canonicalSha256([...row.subjectIds].sort()))) return "social:relationship-participants-changed";
  } else if (type === "PromiseMade") {
    const row = payload as EventPayloadByType["PromiseMade"];
    if (!Object.hasOwn(state.entities, row.promisorId) || !Object.hasOwn(state.entities, row.promiseeId)
      || Object.hasOwn(state.campaignRuntime.promises, row.promiseId)) return "social:promise-participants-or-identity-invalid";
  } else {
    const row = payload as EventPayloadByType["DebtIncurred"];
    if (!Object.hasOwn(state.entities, row.debtorId) || !Object.hasOwn(state.entities, row.creditorId)
      || row.basisFactIds.some(id => !Object.hasOwn(state.canonicalFacts, id))
      || Object.hasOwn(state.campaignRuntime.debts, row.debtId)) return "social:debt-participants-basis-or-identity-invalid";
  }
  return undefined;
}

function refs(value: unknown, minimum = 0): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}
