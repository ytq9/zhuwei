import { canonicalSha256, sameCanonical } from "../profiles/canonical";
import { isCanonicalTacticalGeometry, type CanonicalTacticalFeature } from "../profiles/tactical-geometry";
import { isItemDefinitionV1, isItemSystemStateV1, type ItemDefinitionContentV1, type ItemDefinitionV1, type ItemEntryV1 } from "./items";
import type { AuthoritativeWorldState } from "./model";
import type { NativeObjectCompletion } from "./object-completion-shapes";

export type CompletedItemDefinition = { definition: ItemDefinitionV1; entry: ItemEntryV1 };

/** SPEC 0016 §7.2: specialize only this physical instance. A null that was
 * not explicitly marked undecided is a fact and cannot become a power. */
export function completedItemDefinition(state: AuthoritativeWorldState, entryRef: string,
  content: ItemDefinitionContentV1): CompletedItemDefinition | { error: string } {
  const prior = state.campaignRuntime.itemSystem.entries[entryRef];
  const base = prior && state.campaignRuntime.itemSystem.definitions[prior.definitionRef];
  if (!prior || !base || !["held", "scene"].includes(prior.disposition) || prior.assemblyRef !== undefined) return { error: "completion:item-unavailable" };
  const undecided = new Set(base.content.undeterminedFields ?? []);
  if (!undecided.size) return { error: "completion:item-has-no-undetermined-fields" };
  const remaining = content.undeterminedFields ?? [];
  if (remaining.some(field => !undecided.has(field)) || remaining.length >= undecided.size) return { error: "completion:item-must-fill-an-existing-gap" };
  for (const key of Object.keys(base.content) as (keyof ItemDefinitionContentV1)[]) {
    if (key === "undeterminedFields" || undecided.has(key as never)) continue;
    if (!sameCanonical(base.content[key], content[key])) return { error: `completion:item-established-${key}` };
  }
  const definition: ItemDefinitionV1 = { ...structuredClone(base),
    definitionId: `item-definition:completion:${canonicalSha256({ entryRef, base, content }).slice(7, 39)}`,
    revision: "1", content: structuredClone(content) };
  if (!isItemDefinitionV1(definition)) return { error: "completion:item-invalid-definition" };
  const entry = { ...structuredClone(prior), definitionRef: definition.definitionId, definitionRevision: definition.revision };
  for (const [field, counter] of [["chargesMaximum", "charges"], ["durabilityMaximum", "durability"]] as const) {
    if (!undecided.has(field) || remaining.includes(field)) continue;
    const maximum = content[field];
    entry[counter] = maximum === null ? null : { maximum, current: counter === "durability" && prior.condition === "broken" ? 0 : maximum };
  }
  const system = { ...state.campaignRuntime.itemSystem,
    definitions: { ...state.campaignRuntime.itemSystem.definitions, [definition.definitionId]: definition },
    entries: { ...state.campaignRuntime.itemSystem.entries, [entryRef]: entry } };
  return isItemSystemStateV1(system) ? { definition, entry } : { error: "completion:item-invalid-result" };
}

/** Fill a mechanical dimension, preserving current geometry, established
 * transitions and any existing damage. The caller stores the full feature. */
export function completedFeatureDefinition(state: AuthoritativeWorldState, sceneRef: string, featureRef: string,
  completion: Extract<NativeObjectCompletion, { kind: "terrain" | "durability" }>): CanonicalTacticalFeature | { error: string } {
  const geometry = state.combatRuntime.scenes[sceneRef]?.geometry;
  if (!isCanonicalTacticalGeometry(geometry)) return { error: "completion:geometry-unavailable" };
  const prior = geometry.obstacles.find(feature => feature.featureId === featureRef);
  if (!prior || prior.environment !== undefined) return { error: "completion:feature-unavailable" };
  const next = structuredClone(prior);
  if (completion.kind === "terrain") {
    let added = false;
    for (const key of ["landform", "material", "depth", "current"] as const) {
      const value = completion[key];
      if (value == null) continue;
      if (prior[key] !== undefined && prior[key] !== value) return { error: `completion:established-${key}` };
      if (prior[key] === undefined) { Object.assign(next, { [key]: value }); added = true; }
    }
    if (!added) return { error: "completion:terrain-already-complete" };
  } else {
    if (prior.stateGraph?.durability !== undefined && prior.durability !== undefined) return { error: "completion:durability-already-complete" };
    const durability = { maximum: String(completion.hitPoints), armorClass: String(completion.armorClass),
      damageThreshold: String(completion.damageThreshold), immuneDamageTypes: [...completion.immuneDamageTypes] };
    if (prior.durability !== undefined) {
      const { current: _current, ...established } = prior.durability;
      if (!sameCanonical(established, durability)) return { error: "completion:established-durability" };
    }
    const graph = next.stateGraph ?? { definitionId: `object-state:${featureRef}:destructible-v1`,
      states: [{ state: prior.state, opaque: prior.opaque, impassable: prior.impassable, cover: prior.cover,
        propagation: prior.propagation, terrain: prior.terrain ?? "normal" }], transitions: [] };
    const destroyed = { state: "destroyed", ...completion.destroyed };
    const existing = graph.states.find(candidate => candidate.state === "destroyed");
    if (existing && !sameCanonical(existing, destroyed)) return { error: "completion:established-destruction-state" };
    if (!existing) graph.states.push(destroyed);
    graph.states.sort((left, right) => left.state.localeCompare(right.state));
    graph.durability = durability;
    graph.damageTransitions = graph.states.filter(candidate => candidate.state !== "destroyed")
      .map(candidate => ({ fromState: candidate.state, remainingDurabilityAtOrBelow: "0", toState: "destroyed" }));
    next.stateGraph = graph;
    next.durability = prior.durability ?? { current: durability.maximum, ...durability };
  }
  const valid = (candidate: CanonicalTacticalFeature) => isCanonicalTacticalGeometry({ ...geometry,
    obstacles: geometry.obstacles.map(feature => feature.featureId === featureRef ? candidate : feature) });
  // A definition must also be executable after each declared transition.
  return valid(next) && (next.stateGraph?.states ?? []).every(phase => valid({ ...next, ...phase }))
    ? next : { error: "completion:feature-result-not-executable" };
}
