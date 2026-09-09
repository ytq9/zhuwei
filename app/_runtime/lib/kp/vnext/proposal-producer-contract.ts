import { deepFreeze, isPlainRecord } from "./canonical-json";

export type VNextProducerKind = "entity" | "semanticDefinition" | "abilityDefinition" | "hazardDefinition" | "itemDefinition" | "itemEntry";
export type VNextProposalProducerContract = Readonly<{
  count: 0 | 1;
  kind: VNextProducerKind | null;
  outcomeBinding: "same-as-entry";
}>;

const none = { count: 0, kind: null, outcomeBinding: "same-as-entry" } as const;
const one = (kind: VNextProducerKind): VNextProposalProducerContract => ({ count: 1, kind, outcomeBinding: "same-as-entry" });

/** Shared declaration requirements, not creation authority or world identity. */
export const VNEXT_PROPOSAL_PRODUCER_CONTRACT = deepFreeze({
  version: "zhuwei.proposal-producer-contract/v3",
  entries: {
    observe: none, social: none, formActorPlan: none, worldInteraction: none, commitNarrativeDetail: none,
    inventoryOperation: none, reviseSemanticDefinition: none,
    materializeNpc: one("entity"), materializeObject: one("semanticDefinition"), materializeItem: one("itemEntry"),
  },
  definitions: { ability: one("abilityDefinition"), hazard: one("hazardDefinition"), item: one("itemDefinition") },
});

export function vnextProposalProducerContract(kind: unknown, definitionKind?: unknown): VNextProposalProducerContract | undefined {
  if (kind === "materializeDefinition") {
    const definitions = VNEXT_PROPOSAL_PRODUCER_CONTRACT.definitions;
    return typeof definitionKind === "string" && Object.hasOwn(definitions, definitionKind)
      ? definitions[definitionKind as keyof typeof definitions] : undefined;
  }
  const entries = VNEXT_PROPOSAL_PRODUCER_CONTRACT.entries;
  return typeof kind === "string" && Object.hasOwn(entries, kind)
    ? entries[kind as keyof typeof entries] : undefined;
}

export function vnextEntryProducerContract(entry: Record<string, unknown>): VNextProposalProducerContract | undefined {
  return vnextProposalProducerContract(entry.kind, isPlainRecord(entry.source) ? entry.source.kind : undefined);
}
