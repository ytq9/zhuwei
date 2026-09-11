import type { VNextProducerKind } from "./proposal-producer-contract";

/** The producer kind a reference slot names when it carries a same-bundle
 * handle, or null where the slot cites something no proposal type produces
 * (basis citations, threads, promises, factions, class resources) or admits
 * more than one kind. This only says which producer type a handle would need;
 * identity, authority and the dependency proof stay with the validators. */
export type VNextSlotProducerKind = VNextProducerKind | null;
type Visit = (value: unknown, kind: VNextSlotProducerKind) => void;

/** Extracts dependencies from declared reference positions in one proposal.
 * This is safe to call before domain validation: malformed containers are not
 * traversed or repaired, and every original field remains for that validator.
 * It does not validate handles, resolve identities, grant knowledge or inspect
 * context/state. Never use prose or arbitrary `set.value` as a dependency. */
export function proposalProspectiveHandles(value: unknown): readonly string[] {
  const entry = record(value);
  if (!entry) return Object.freeze([]);
  const handles = new Set<string>();
  if (!traverse(entry, (candidate) => {
    if (typeof candidate === "string" && candidate.startsWith("prospective:")) handles.add(candidate);
  })) return Object.freeze([]);
  return Object.freeze([...handles].sort());
}

/** The same traversal, reporting the producer kind each handle's slot names.
 * A handle used in slots of different kinds maps to null: no single producer
 * type could satisfy it, so nothing is inferred. */
export function proposalProspectiveHandleKinds(value: unknown): ReadonlyMap<string, VNextSlotProducerKind> {
  const kinds = new Map<string, VNextSlotProducerKind>();
  const entry = record(value);
  if (!entry) return kinds;
  traverse(entry, (candidate, kind) => {
    if (typeof candidate !== "string" || !candidate.startsWith("prospective:")) return;
    if (!kinds.has(candidate)) kinds.set(candidate, kind);
    else if (kinds.get(candidate) !== kind) kinds.set(candidate, null);
  });
  return kinds;
}

/** One traversal over every declared reference slot of every proposal family.
 * Returns false for an unknown family, in which case nothing was visited. */
function traverse(entry: Record<string, unknown>, visit: Visit): boolean {
  const ref = (value: unknown, kind: VNextSlotProducerKind): void => visit(value, kind);
  const refs = (value: unknown, kind: VNextSlotProducerKind): void => {
    if (Array.isArray(value)) value.forEach(item => visit(item, kind));
  };
  const operations = (value: unknown): void => records(value, operation => {
    if (operation.kind === "removeByRef") ref(operation.ref, null);
    else if (operation.kind === "upsertByRef") {
      const member = record(operation.entry);
      if (member) ref(Object.hasOwn(member, "goalRef") ? member.goalRef : member.planRef, null);
    }
  });
  const evidence = (value: unknown): void => records(value, item => {
    ref(item.observerRef, "entity"); ref(item.subjectRef, null); refs(item.basisRefs, null);
  });
  const branches = (walk: (branch: Record<string, unknown>) => void): void => {
    const branchSet = record(entry.branches);
    if (!branchSet) return;
    for (const key of ["success", "failure"] as const) {
      const branch = record(branchSet[key]);
      if (branch) walk(branch);
    }
  };

  switch (entry.kind) {
    case "materializeNpc": {
      ref(entry.sceneRef, "semanticDefinition"); refs(entry.basisRefs, null);
      const source = record(entry.source), template = record(source?.mechanicalTemplate);
      if (template) {
        refs(template.intrinsicAbilityRefs, "abilityDefinition"); refs(template.itemDefinitionRefs, "itemDefinition");
        records(record(template.initialLoadout)?.entries, item => {
          const origin = record(item.source);
          if (origin?.kind === "itemDefinition") ref(origin.ref, "itemDefinition");
        });
      }
      break;
    }
    case "worldInteraction":
      ref(entry.sceneRef, "semanticDefinition"); refs(entry.targetRefs, "semanticDefinition"); refs(entry.directTargetRefs, "semanticDefinition");
      refs(entry.instrumentRefs, "semanticDefinition"); ref(entry.abilityRef, "abilityDefinition");
      branches(branch => {
        records(branch.effects, effect => {
          if (effect.kind === "traversePassage") ref(effect.passageRef, "semanticDefinition");
          else if (effect.kind === "relationTransition") ref(effect.relationRef, null);
          else if (effect.kind === "definitionRevision") {
            ref(effect.definitionRef, "semanticDefinition"); operations(effect.operations);
          } else if (effect.kind === "registeredHazard") {
            ref(effect.sourceDefinitionRef, "semanticDefinition"); ref(effect.zoneRef, "semanticDefinition");
            const damage = record(effect.damage);
            if (damage?.kind === "authored") ref(damage.hazardDefinitionRef, "hazardDefinition");
          }
        });
        evidence(branch.sensoryEvidence);
        records(branch.pressures, pressure => { ref(pressure.sourceRef, null); refs(pressure.basisRefs, null); });
        records(branch.opportunities, opportunity => { ref(opportunity.targetRef, null); refs(opportunity.basisRefs, null); });
      });
      break;
    case "formActorPlan":
      ref(entry.npcRef, "entity"); ref(entry.factionRef, null); refs(entry.premiseRefs, null); refs(entry.resourceRefs, null); ref(entry.alternateTargetRef, null);
      break;
    case "social": {
      ref(entry.sceneRef, "semanticDefinition"); ref(entry.npcRef, "entity"); ref(entry.addressedThreadRef, null);
      const retry = record(entry.retryChange);
      if (retry) { ref(retry.priorThreadRef, null); refs(retry.basisRefs, null); }
      branches(branch => {
        const response = record(branch.response);
        if (response) records(response.basis, source => {
          if (source.kind === "npcContext") ref(source.ref, null);
          else if (source.kind === "materializedKnowledge") {
            ref(source.definitionRef, null); ref(source.holderRef, "entity");
          }
        });
        records(branch.consequences, effect => {
          if (effect.kind === "promise" || effect.kind === "promiseChange") {
            refs(effect.authorityRefs, null); ref(effect.promiseeRef, "entity"); ref(effect.promiseRef, null);
            const visitTerms = (value: unknown) => {
              const terms = record(value);
              if (!terms) return;
              refs(terms.subjectRefs, null);
              const activation = record(terms.activation);
              if (activation) refs(activation.subjectRefs, null);
              const delivery = record(terms.delivery);
              if (delivery) {
                ref(delivery.sourceRef, null); ref(delivery.itemRef, "itemEntry"); ref(delivery.destinationRef, null);
              }
              records(terms.parts, visitTerms);
            };
            visitTerms(effect.kind === "promise" ? effect.terms : record(effect.change)?.terms);
          }
          else if (effect.kind === "relationship" || effect.kind === "debt") {
            refs(effect.basisFactRefs, null);
            if (effect.kind === "relationship") ref(effect.relationshipRef, null);
          }
        });
      });
      break;
    }
    case "observe":
      ref(entry.sceneRef, "semanticDefinition"); refs(entry.focusRefs, "semanticDefinition"); refs(entry.existingFactRefs, null);
      branches(branch => evidence(branch.sensoryEvidence));
      // Inference heldKnowledge refs are holder-scoped existing records; their
      // read-set binding stays in the observation lowerer, not this graph.
      break;
    case "commitNarrativeDetail":
      ref(entry.sceneRef, "semanticDefinition");
      break;
    case "completeObject":
      ref(entry.definitionRef, "semanticDefinition");
      break;
    case "reviseSemanticDefinition":
      ref(entry.definitionRef, "semanticDefinition"); ref(entry.npcRef, "entity"); ref(entry.templateRef, null);
      operations(entry.operations);
      break;
    case "materializeObject": {
      ref(entry.templateRef, null); ref(entry.visibilityPolicyRef, null);
      const definition = record(entry.definition);
      if (!definition) break;
      ref(definition.sceneRef, "semanticDefinition"); ref(definition.visibilityFactId, null); refs(definition.mechanicDefinitionRefs, "abilityDefinition");
      const fact = record(definition.worldFact);
      if (fact) {
        refs(fact.subjectRefs, null);
        records(fact.initialKnowledge, knowledge => { ref(knowledge.holderRef, "entity"); refs(knowledge.acquisitionBasisRefs, null); });
      }
      const passage = record(definition.passage);
      if (passage) { ref(passage.fromLocationRef, "semanticDefinition"); ref(passage.toLocationRef, "semanticDefinition"); }
      break;
    }
    case "materializeDefinition": {
      const source = record(entry.source);
      const content = record(source?.content);
      if (!content) break;
      if (source?.kind === "hazard") {
        ref(content.mechanicsRef, "abilityDefinition");
        const trigger = record(content.trigger);
        if (trigger && (trigger.kind === "enterZone" || trigger.kind === "contactFeature" || trigger.kind === "disturbFeature")) ref(trigger.ref, "semanticDefinition");
      } else if (source?.kind === "item") {
        refs(content.equippedAbilityRefs, "abilityDefinition");
        const use = record(content.use);
        if (use?.kind === "useObject") ref(use.abilityRef, "abilityDefinition");
        const equipment = record(content.equipment);
        const weapon = record(equipment?.weapon);
        if (weapon) ref(weapon.ammunitionDefinitionRef, "itemDefinition");
      } else if (source?.kind === "ability") {
        const effectRef = (effect: Record<string, unknown>): void => {
          if (effect.kind === "endEffect") ref(effect.sourceRef, null);
        };
        const effect = record(content.effect);
        if (effect) effectRef(effect);
        records(content.effects, effectRef);
        records(content.costs, cost => {
          // Class resources and spell slots are not bundle-created ItemEntry
          // identities. Their existing Rules validation remains authoritative.
          if (cost.kind === "item") ref(cost.resourceId, null);
        });
      }
      break;
    }
    case "materializeItem": {
      ref(entry.definitionRef, "itemDefinition"); ref(entry.sceneRef, "semanticDefinition"); ref(entry.uniquenessBasisRef, null);
      const ownership = record(entry.ownership);
      if (ownership && (ownership.kind === "character" || ownership.kind === "party" || ownership.kind === "faction")) ref(ownership.ownerRef, "entity");
      break;
    }
    case "inventoryOperation": {
      const operation = record(entry.operation);
      if (!operation) break;
      switch (operation.kind) {
        case "assemble":
          records(operation.components, component => ref(component.entryRef, "itemEntry"));
          break;
        case "disassemble":
          ref(operation.assemblyRef, null);
          break;
        case "acquire": case "identify": case "equip": case "lifecycle":
          ref(operation.entryRef, "itemEntry");
          break;
        case "release":
          ref(operation.entryRef, "itemEntry"); ref(operation.sceneRef, "semanticDefinition");
          break;
        case "transfer":
          ref(operation.entryRef, "itemEntry"); ref(operation.targetCharacterRef, "entity");
          break;
        case "use":
          ref(operation.entryRef, "itemEntry"); refs(operation.targetRefs, null);
          break;
      }
      break;
    }
    case "materializeStory":
    case "admitStoryFacts":
      break;
    default:
      return false;
  }
  refs(entry.basisRefs, null);
  return true;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : undefined;
}

function records(value: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const entry = record(item);
    if (entry) visit(entry);
  }
}
