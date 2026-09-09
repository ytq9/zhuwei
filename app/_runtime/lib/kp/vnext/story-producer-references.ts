import { isPlainRecord } from "./canonical-json";
import type { VNextProposalBundleEntry } from "./proposal-schema";

/** Resolve only schema-declared identity slots of a reviewed producer. Text,
 * names, descriptions and arbitrary content remain byte-for-byte unchanged. */
export function resolveStoryProducerReferences(value: VNextProposalBundleEntry,
  mappings: ReadonlyMap<string, string>): VNextProposalBundleEntry {
  const entry = structuredClone(value) as unknown as Record<string, unknown>;
  const ref = (record: unknown, key: string): void => {
    if (isPlainRecord(record) && typeof record[key] === "string") record[key] = mappings.get(record[key]) ?? record[key];
  };
  const refs = (record: unknown, key: string): void => {
    if (isPlainRecord(record) && Array.isArray(record[key])) record[key] = record[key].map(value =>
      typeof value === "string" ? mappings.get(value) ?? value : value);
  };
  const each = (value: unknown, visit: (value: Record<string, unknown>) => void): void => {
    if (Array.isArray(value)) for (const item of value) if (isPlainRecord(item)) visit(item);
  };
  refs(entry, "basisRefs");
  each(entry.consumes, item => {
    if (item.kind === "prospective" && typeof item.handle === "string" && mappings.has(item.handle)) {
      item.kind = "existing"; item.ref = mappings.get(item.handle); delete item.handle;
    } else if (item.kind === "existing") ref(item, "ref");
  });
  if (entry.kind === "materializeNpc") {
    ref(entry, "sceneRef"); ref(entry, "visibilityPolicyRef");
    const template = isPlainRecord(entry.source) ? entry.source.mechanicalTemplate : undefined;
    refs(template, "intrinsicAbilityRefs"); refs(template, "itemDefinitionRefs");
    if (isPlainRecord(template) && isPlainRecord(template.initialLoadout)) each(template.initialLoadout.entries, item => {
      if (isPlainRecord(item.source) && item.source.kind === "itemDefinition") ref(item.source, "ref");
    });
  } else if (entry.kind === "materializeObject") {
    ref(entry, "templateRef"); ref(entry, "visibilityPolicyRef");
    const definition = entry.definition;
    ref(definition, "sceneRef"); ref(definition, "visibilityFactId"); refs(definition, "mechanicDefinitionRefs");
    if (isPlainRecord(definition)) {
      const fact = definition.worldFact;
      refs(fact, "subjectRefs");
      if (isPlainRecord(fact)) each(fact.initialKnowledge, item => { ref(item, "holderRef"); refs(item, "acquisitionBasisRefs"); });
      ref(definition.passage, "fromLocationRef"); ref(definition.passage, "toLocationRef");
    }
  } else if (entry.kind === "materializeDefinition" && isPlainRecord(entry.source) && isPlainRecord(entry.source.content)) {
    const { source } = entry, content = source.content as Record<string, unknown>;
    if (source.kind === "hazard") {
      ref(content, "mechanicsRef");
      if (isPlainRecord(content.trigger) && ["enterZone", "contactFeature", "disturbFeature"].includes(String(content.trigger.kind))) ref(content.trigger, "ref");
    } else if (source.kind === "item") {
      refs(content, "equippedAbilityRefs");
      if (isPlainRecord(content.use) && content.use.kind === "useObject") ref(content.use, "abilityRef");
      if (isPlainRecord(content.equipment)) ref(content.equipment.weapon, "ammunitionDefinitionRef");
    } else if (source.kind === "ability") {
      const effect = (item: Record<string, unknown>) => { if (item.kind === "endEffect") ref(item, "sourceRef"); };
      if (isPlainRecord(content.effect)) effect(content.effect);
      each(content.effects, effect);
      each(content.costs, cost => { if (cost.kind === "item") ref(cost, "resourceId"); });
    }
  } else if (entry.kind === "materializeItem") {
    ref(entry, "definitionRef"); ref(entry, "sceneRef"); ref(entry, "uniquenessBasisRef");
    if (isPlainRecord(entry.ownership) && ["character", "party", "faction"].includes(String(entry.ownership.kind))) ref(entry.ownership, "ownerRef");
  }
  return entry as unknown as VNextProposalBundleEntry;
}
