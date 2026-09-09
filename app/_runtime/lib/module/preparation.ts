import blackOakPreparation from "./black-oak-will-preparation.json";
import type { AuthoritativeModuleProfile } from "./authoritative";
import { canonicalSha256 } from "../rules/profiles/canonical";
import { createInitialItemEntry, isItemDefinitionV1 } from "../rules/v2/items";
import { uniqueItemEntryRef } from "../rules/v2/item-authority-vnext";
import type { InitialItemEntryInput, ItemDefinitionV1 } from "../rules/v2/items";
import type { KnowledgeRecord } from "../rules/v2/model";

type PreparationCharacter = { id: string; sceneId: string; proficientSkills?: readonly string[] };
type PreparedItem = {
  definition: ItemDefinitionV1;
  entry: InitialItemEntryInput;
  materialization: "initial" | "onDiscovery";
  fact: { id: string; sceneId: string; clueIds: string[]; description: string };
};
type PreparationKnowledge = {
  id: string;
  audience: { kind: "npc"; entityRef: string }
    | { kind: "openingPlayers"; sceneId: string; anyProficientSkills: string[] };
  kind: KnowledgeRecord["objectKind"];
  content: { description: string; sourceRefs: string[]; acquisition: string };
};
export type ModulePreparationCatalog = {
  schema: "zhuwei.module-preparation/v1";
  catalogId: string;
  moduleRef: AuthoritativeModuleProfile["moduleRef"];
  items: PreparedItem[];
  knowledge: PreparationKnowledge[];
};

const catalogs: Readonly<Record<string, unknown>> = {
  "black-oak-will": blackOakPreparation,
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Static authoring boundary only. Rules still validates every definition and
 * commits the resulting catalog, facts and holder knowledge in one genesis. */
export function validateModulePreparation(value: unknown, profile: AuthoritativeModuleProfile): ModulePreparationCatalog {
  const invalid = (): never => { throw new TypeError("Invalid module opening preparation."); };
  if (!record(value) || !exact(value, ["schema", "catalogId", "moduleRef", "items", "knowledge"])
    || value.schema !== "zhuwei.module-preparation/v1" || !text(value.catalogId)
    || canonicalSha256(value.moduleRef) !== canonicalSha256(profile.moduleRef)
    || !Array.isArray(value.items) || !Array.isArray(value.knowledge)) return invalid();
  const sceneIds = new Set(profile.storyBible.storyAnchors.locations.map(scene => scene.sceneId));
  const npcIds = new Set(profile.storyBible.importantNpcs.map(npc => npc.entityId));
  const clueIds = new Set(profile.storyBible.storyAnchors.clues.map(clue => clue.clueId));
  const refs = new Set([...sceneIds, ...npcIds]);
  const register = (ref: string) => { if (refs.has(ref)) invalid(); refs.add(ref); };
  const items: PreparedItem[] = [];
  for (const item of value.items) {
    if (!record(item) || !exact(item, ["definition", "entry", "materialization", "fact"])
      || !isItemDefinitionV1(item.definition) || !record(item.entry) || !record(item.fact)
      || !exact(item.entry, ["entryId", "quantity", "placement", "ownership", "visibilityPolicyRef"])
      || !record(item.entry.placement)
      || !(item.entry.placement.kind === "held"
        ? exact(item.entry.placement, ["kind", "holderRef", "equippedSlot"])
        : item.entry.placement.kind === "scene" && exact(item.entry.placement, ["kind", "sceneRef"]))
      || !exact(item.fact, ["id", "sceneId", "clueIds", "description"])
      || !text(item.fact.id) || !text(item.fact.sceneId) || !sceneIds.has(item.fact.sceneId)
      || !text(item.fact.description) || !strings(item.fact.clueIds)
      || item.fact.clueIds.some(ref => !clueIds.has(ref))
      || !["initial", "onDiscovery"].includes(String(item.materialization))
      || item.definition.causalBasisRefs.length !== 1 || item.definition.causalBasisRefs[0] !== item.fact.id) return invalid();
    // The existing ItemEntry constructor owns placement, ownership, quantity
    // and definition conformance; no second item schema or mechanic compiler.
    const entry = createInitialItemEntry(item.definition, item.entry as InitialItemEntryInput);
    if (entry.entryId !== uniqueItemEntryRef(item.fact.id) || entry.quantity !== 1 || item.definition.content.stackable
      || (entry.disposition === "held" && (!npcIds.has(entry.holderRef!)
      || profile.storyBible.importantNpcs.find(npc => npc.entityId === entry.holderRef)?.startSceneId !== item.fact.sceneId))
      || (entry.disposition === "scene" && entry.sceneRef !== item.fact.sceneId)
      || (item.materialization === "onDiscovery" && entry.disposition !== "scene")) return invalid();
    [item.definition.definitionId, entry.entryId, item.fact.id].forEach(register);
    items.push(item as PreparedItem);
  }
  const knowledge: PreparationKnowledge[] = [];
  for (const entry of value.knowledge) {
    if (!record(entry) || !exact(entry, ["id", "audience", "kind", "content"])
      || !text(entry.id) || !record(entry.audience) || !record(entry.content)
      || !exact(entry.content, ["description", "sourceRefs", "acquisition"])
      || !text(entry.content.description) || !text(entry.content.acquisition)
      || !strings(entry.content.sourceRefs) || entry.content.sourceRefs.some(ref => !refs.has(ref))
      || !["canonicalFact", "sensoryEvidence", "sourceClaim", "characterInference"].includes(String(entry.kind))) return invalid();
    const audience = entry.audience;
    if (audience.kind === "npc") {
      if (!exact(audience, ["kind", "entityRef"]) || !text(audience.entityRef) || !npcIds.has(audience.entityRef)) return invalid();
    } else if (audience.kind === "openingPlayers") {
      if (!exact(audience, ["kind", "sceneId", "anyProficientSkills"])
        || !text(audience.sceneId) || !sceneIds.has(audience.sceneId) || !strings(audience.anyProficientSkills)) return invalid();
    } else return invalid();
    register(entry.id);
    knowledge.push(entry as PreparationKnowledge);
  }
  return structuredClone({ schema: "zhuwei.module-preparation/v1", catalogId: value.catalogId,
    moduleRef: profile.moduleRef, items, knowledge });
}

export function modulePreparationSeeds(profile: AuthoritativeModuleProfile, characters: readonly PreparationCharacter[]) {
  const catalog = validateModulePreparation(catalogs[profile.moduleId], profile);
  const catalogRef = { profileId: catalog.catalogId, profileHash: canonicalSha256(catalog) };
  return {
    catalogRef,
    // These are opening facts, never a live location/ownership lookup. Later
    // decisions read committed ItemEntries and knowledge, not this source file.
    canonicalFacts: catalog.items.map(item => ({
      id: item.fact.id,
      kind: "modulePreparedItem",
      subjectRefs: [item.fact.sceneId, item.definition.definitionId,
        ...(item.materialization === "initial" ? [item.entry.entryId] : [])],
      value: {
        schema: "zhuwei.prepared-item-fact/v1",
        catalogRef,
        description: item.fact.description,
        clueIds: [...item.fact.clueIds],
        openingPlacement: structuredClone(item.entry.placement),
        ...(item.materialization === "initial"
          ? { initialEntryRef: item.entry.entryId }
          : { discovery: { definitionRef: item.definition.definitionId, sceneRef: item.fact.sceneId,
              quantity: item.entry.quantity, ownership: structuredClone(item.entry.ownership),
              uniquenessBasisRef: item.fact.id,
              instruction: "此实物已在开场事实中固定。实际发现时用已有定义和此唯一性依据经 materializeItem 落地；不要重写定义、换藏处或创建第二份。" } }),
      },
      visibilityPolicyId: "visibility:room-authority-only",
      source: "moduleAnchor" as const,
    })),
    initialKnowledge: catalog.knowledge.flatMap(entry => {
      const audience = entry.audience;
      const holders = audience.kind === "npc" ? [audience.entityRef] : characters
        .filter(character => character.sceneId === audience.sceneId
          && (audience.anyProficientSkills.length === 0
            || audience.anyProficientSkills.some(skill => character.proficientSkills?.includes(skill))))
        .map(character => character.id);
      return holders.map(characterId => ({
        characterId,
        knowledgeRef: `${entry.id}:${characterId}`,
        kind: entry.kind,
        layer: "full" as const,
        content: `${entry.content.description}（获知依据：${entry.content.acquisition}）`,
        visibility: "private" as const,
        provenanceChain: [`genesis:${entry.id}`, catalogRef.profileId, catalogRef.profileHash,
          ...entry.content.sourceRefs],
      }));
    }),
    itemDefinitions: catalog.items.map(item => structuredClone(item.definition)),
    itemEntries: catalog.items.filter(item => item.materialization === "initial")
      .map(item => ({ definitionRef: item.definition.definitionId, entry: structuredClone(item.entry) })),
  };
}
