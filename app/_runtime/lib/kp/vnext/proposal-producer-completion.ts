import type { JsonRecord } from "./canonical-json";
import { closeVNextProposalCapabilities, VNEXT_PROPOSAL_CAPABILITIES, type VNextProposalCapabilityId } from "./proposal-capabilities";
import { vnextProposalProducerContract, type VNextProducerKind } from "./proposal-producer-contract";
import { proposalProspectiveHandleKinds } from "./proposal-reference-slots";

/** A same-bundle handle the draft consumes in a typed slot but no step
 * produces, with the one capability whose step would produce that kind. */
export type VNextDanglingHandle = Readonly<{
  handle: string;
  kind: VNextProducerKind;
  capability: VNextProposalCapabilityId;
}>;

/** The capability that produces each kind, read off the same contract the
 * dependency graph proves against; no second table. Native surfaces and story
 * materialization (whose kind comes from a prepared candidate, not the
 * catalogue) are not producers a selection can add. */
function producerCapabilityByKind(): ReadonlyMap<VNextProducerKind, VNextProposalCapabilityId> {
  const byKind = new Map<VNextProducerKind, VNextProposalCapabilityId>();
  for (const capability of VNEXT_PROPOSAL_CAPABILITIES) {
    if ("surface" in capability && capability.surface === "native") continue;
    const contract = vnextProposalProducerContract(capability.proposalKind,
      "definitionKind" in capability ? capability.definitionKind : undefined);
    if (contract?.count === 1 && contract.kind !== null && !byKind.has(contract.kind)) byKind.set(contract.kind, capability.id);
  }
  return byKind;
}

/** Handles the draft names in typed slots that no step in the draft declares
 * as produced. Derived from the draft alone, so Provider and Room reach the
 * identical list from the same saved bytes. A handle whose slot implies no
 * single producer kind, or whose kind no catalogue type produces, is left to
 * the ordinary dependency diagnostic. */
export function vnextProposalDanglingHandles(draft: Readonly<JsonRecord>): readonly VNextDanglingHandle[] {
  const proposals = Array.isArray(draft.proposals) ? draft.proposals : [];
  const produced = new Set<string>();
  for (const proposal of proposals) {
    if (!isRecord(proposal) || !Array.isArray(proposal.produces)) continue;
    for (const item of proposal.produces) if (isRecord(item) && typeof item.handle === "string") produced.add(item.handle);
  }
  const byKind = producerCapabilityByKind();
  const dangling = new Map<string, VNextDanglingHandle | null>();
  for (const proposal of proposals) {
    for (const [handle, kind] of proposalProspectiveHandleKinds(proposal)) {
      if (produced.has(handle)) continue;
      const capability = kind === null ? undefined : byKind.get(kind);
      const entry = kind === null || capability === undefined ? null : Object.freeze({ handle, kind, capability });
      if (!dangling.has(handle)) dangling.set(handle, entry);
      else if (dangling.get(handle)?.kind !== entry?.kind) dangling.set(handle, null);
    }
  }
  return Object.freeze([...dangling.values()].filter((entry): entry is VNextDanglingHandle => entry !== null)
    .sort((a, b) => a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
}

/** The selection this correction is sent with: the loaded types plus the
 * producer type of every dangling handle the selection did not load, closed
 * over dependencies. A handle whose producer type is already loaded adds
 * nothing -- the model omitted the step, and the diagnostic already says so. */
export function vnextProposalProducerCompletion(draft: Readonly<JsonRecord>,
  capabilities: readonly VNextProposalCapabilityId[]): Readonly<{
    loaded: readonly VNextProposalCapabilityId[];
    completions: readonly VNextDanglingHandle[];
  }> {
  const loaded = closeVNextProposalCapabilities(capabilities);
  const completions = vnextProposalDanglingHandles(draft).filter(entry => !loaded.includes(entry.capability));
  return Object.freeze({
    loaded: completions.length === 0 ? loaded
      : closeVNextProposalCapabilities([...loaded, ...completions.map(entry => entry.capability)]),
    completions: Object.freeze(completions),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
