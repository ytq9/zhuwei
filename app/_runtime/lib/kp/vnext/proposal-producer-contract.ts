import { deepFreeze, isPlainRecord } from "./canonical-json";

export type VNextProducerKind = "semanticDefinition" | "abilityDefinition" | "hazardDefinition" | "itemDefinition" | "itemEntry";
export type VNextProposalProducerContract = Readonly<{
  count: 0 | 1;
  kind: VNextProducerKind | null;
  outcomeBinding: "same-as-entry";
}>;

const none = { count: 0, kind: null, outcomeBinding: "same-as-entry" } as const;
const one = (kind: VNextProducerKind): VNextProposalProducerContract => ({ count: 1, kind, outcomeBinding: "same-as-entry" });

/** Shared declaration requirements, not creation authority or world identity. */
export const VNEXT_PROPOSAL_PRODUCER_CONTRACT = deepFreeze({
  version: "zhuwei.proposal-producer-contract/v2",
  entries: {
    observe: none, social: none, formActorPlan: none, worldInteraction: none, commitNarrativeDetail: none,
    inventoryOperation: none, reviseSemanticDefinition: none,
    materializeObject: one("semanticDefinition"), materializeItem: one("itemEntry"),
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

export function vnextProducerWireGuidance(kind: unknown, definitionKind?: unknown): string {
  const contract = vnextProposalProducerContract(kind, definitionKind);
  if (!contract) throw new TypeError("PROPOSAL_PRODUCER_CONTRACT_UNAVAILABLE");
  return contract.count === 0
    ? "本类操作不创建新对象，无需填写 handle；服务器生成空生产者声明。"
    : "只填写新对象的本束 prospective handle；生产者类型、结果绑定和依赖由服务器从已选类型及引用生成，不重复声明。";
}
