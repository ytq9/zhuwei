/** Extracts dependencies from declared reference positions in one proposal.
 * This is safe to call before domain validation: malformed containers are not
 * traversed or repaired, and every original field remains for that validator.
 * It does not validate handles, resolve identities, grant knowledge or inspect
 * context/state. Never use prose or arbitrary `set.value` as a dependency. */
export function proposalProspectiveHandles(value: unknown): readonly string[] {
  const entry = record(value);
  if (!entry) return Object.freeze([]);
  const handles = new Set<string>();
  const ref = (value: unknown): void => {
    if (typeof value === "string" && value.startsWith("prospective:")) handles.add(value);
  };
  const refs = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(ref);
  };
  const operations = (value: unknown): void => records(value, operation => {
    if (operation.kind === "removeByRef") ref(operation.ref);
    else if (operation.kind === "upsertByRef") {
      const member = record(operation.entry);
      if (member) ref(Object.hasOwn(member, "goalRef") ? member.goalRef : member.planRef);
    }
  });
  const evidence = (value: unknown): void => records(value, item => {
    ref(item.observerRef); ref(item.subjectRef); refs(item.basisRefs);
  });
  const branches = (visit: (branch: Record<string, unknown>) => void): void => {
    const branchSet = record(entry.branches);
    if (!branchSet) return;
    for (const key of ["success", "failure"] as const) {
      const branch = record(branchSet[key]);
      if (branch) visit(branch);
    }
  };

  switch (entry.kind) {
    case "worldInteraction":
      ref(entry.sceneRef); refs(entry.targetRefs); refs(entry.directTargetRefs);
      refs(entry.instrumentRefs); ref(entry.abilityRef);
      branches(branch => {
        records(branch.effects, effect => {
          if (effect.kind === "traversePassage") ref(effect.passageRef);
          else if (effect.kind === "relationTransition") ref(effect.relationRef);
          else if (effect.kind === "definitionRevision") {
            ref(effect.definitionRef); operations(effect.operations);
          } else if (effect.kind === "registeredHazard") {
            ref(effect.sourceDefinitionRef); ref(effect.zoneRef);
            const damage = record(effect.damage);
            if (damage?.kind === "authored") ref(damage.hazardDefinitionRef);
          }
        });
        evidence(branch.sensoryEvidence);
        records(branch.pressures, pressure => { ref(pressure.sourceRef); refs(pressure.basisRefs); });
        records(branch.opportunities, opportunity => { ref(opportunity.targetRef); refs(opportunity.basisRefs); });
      });
      break;
    case "formActorPlan":
      ref(entry.npcRef); ref(entry.factionRef); refs(entry.premiseRefs); refs(entry.resourceRefs); ref(entry.alternateTargetRef);
      break;
    case "social": {
      ref(entry.sceneRef); ref(entry.npcRef); ref(entry.addressedThreadRef);
      const retry = record(entry.retryChange);
      if (retry) { ref(retry.priorThreadRef); refs(retry.basisRefs); }
      branches(branch => {
        const response = record(branch.response);
        if (response) records(response.basis, source => {
          if (source.kind === "npcContext") ref(source.ref);
          else if (source.kind === "materializedKnowledge") {
            ref(source.definitionRef); ref(source.holderRef);
          }
        });
        records(branch.consequences, effect => {
          if (effect.kind === "promise") refs(effect.authorityRefs);
          else if (effect.kind === "relationship" || effect.kind === "debt") {
            refs(effect.basisFactRefs);
            if (effect.kind === "relationship") ref(effect.relationshipRef);
          }
        });
      });
      break;
    }
    case "observe":
      ref(entry.sceneRef); refs(entry.focusRefs); refs(entry.existingFactRefs);
      branches(branch => evidence(branch.sensoryEvidence));
      // Inference heldKnowledge refs are holder-scoped existing records; their
      // read-set binding stays in the observation lowerer, not this graph.
      break;
    case "commitNarrativeDetail":
      ref(entry.sceneRef);
      break;
    case "reviseSemanticDefinition":
      ref(entry.definitionRef); ref(entry.npcRef); ref(entry.templateRef);
      operations(entry.operations);
      break;
    case "materializeObject": {
      ref(entry.templateRef); ref(entry.visibilityPolicyRef);
      const definition = record(entry.definition);
      if (!definition) break;
      ref(definition.sceneRef); ref(definition.visibilityFactId); refs(definition.mechanicDefinitionRefs);
      const fact = record(definition.worldFact);
      if (fact) {
        refs(fact.subjectRefs);
        records(fact.initialKnowledge, knowledge => { ref(knowledge.holderRef); refs(knowledge.acquisitionBasisRefs); });
      }
      const passage = record(definition.passage);
      if (passage) { ref(passage.fromLocationRef); ref(passage.toLocationRef); }
      break;
    }
    case "materializeDefinition": {
      const source = record(entry.source);
      const content = record(source?.content);
      if (!content) break;
      if (source?.kind === "hazard") {
        ref(content.mechanicsRef);
        const trigger = record(content.trigger);
        if (trigger && (trigger.kind === "enterZone" || trigger.kind === "contactFeature" || trigger.kind === "disturbFeature")) ref(trigger.ref);
      } else if (source?.kind === "item") {
        refs(content.equippedAbilityRefs);
        const use = record(content.use);
        if (use?.kind === "useObject") ref(use.abilityRef);
        const equipment = record(content.equipment);
        const weapon = record(equipment?.weapon);
        if (weapon) ref(weapon.ammunitionDefinitionRef);
      } else if (source?.kind === "ability") {
        const effectRef = (effect: Record<string, unknown>): void => {
          if (effect.kind === "endEffect") ref(effect.sourceRef);
        };
        const effect = record(content.effect);
        if (effect) effectRef(effect);
        records(content.effects, effectRef);
        records(content.costs, cost => {
          // Class resources and spell slots are not bundle-created ItemEntry
          // identities. Their existing Rules validation remains authoritative.
          if (cost.kind === "item") ref(cost.resourceId);
        });
      }
      break;
    }
    case "materializeItem": {
      ref(entry.definitionRef); ref(entry.sceneRef); ref(entry.uniquenessBasisRef);
      const ownership = record(entry.ownership);
      if (ownership && (ownership.kind === "character" || ownership.kind === "party" || ownership.kind === "faction")) ref(ownership.ownerRef);
      break;
    }
    case "inventoryOperation": {
      const operation = record(entry.operation);
      if (!operation) break;
      switch (operation.kind) {
        case "assemble":
          records(operation.components, component => ref(component.entryRef));
          break;
        case "disassemble":
          ref(operation.assemblyRef);
          break;
        case "acquire": case "identify": case "equip": case "lifecycle":
          ref(operation.entryRef);
          break;
        case "release":
          ref(operation.entryRef); ref(operation.sceneRef);
          break;
        case "transfer":
          ref(operation.entryRef); ref(operation.targetCharacterRef);
          break;
        case "use":
          ref(operation.entryRef); refs(operation.targetRefs);
          break;
      }
      break;
    }
    default:
      return Object.freeze([]);
  }
  refs(entry.basisRefs);
  return Object.freeze([...handles].sort());
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
