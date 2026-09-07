import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, JsonRecord } from "./model";
import { isEnvironmentHazardDefinition } from "./environment-hazards";
import { createDefinitionSnapshot, isStoredSemanticDefinition, storedSemanticDefinition } from "./semantic-definitions";

/** Registration supplies the initial trigger connection. Later changes use
 * the same typed relation transition as every other causal connection. */
export function hazardTriggerRelationRef(hazardRef: string): string {
  return `relation:hazard-trigger:${canonicalSha256({ hazardRef }).slice(7)}`;
}

export function initialHazardTriggerRelation(hazard: unknown) {
  if (!isEnvironmentHazardDefinition(hazard)) return undefined;
  const content = hazard.content as JsonRecord;
  const trigger = content.trigger as JsonRecord;
  const ref = hazardTriggerRelationRef(String(hazard.definitionId));
  const snapshot = createDefinitionSnapshot(ref, "1", {
    relationRef: ref, kind: "triggers", subjectRef: String(trigger.ref),
    objectRef: String(hazard.definitionId), state: "active",
  });
  return storedSemanticDefinition("worldRelation", String(hazard.visibilityPolicyRef), snapshot,
    { templateRef: ref, templateHash: snapshot.definitionHash });
}

/** Called by the common DefinitionRegistered fold, including KP authoring and
 * direct Rules registration. No missing-relation fallback makes a hazard live. */
export function initializeHazardTriggerRelation(state: AuthoritativeWorldState, hazard: unknown): void {
  const relation = initialHazardTriggerRelation(hazard);
  if (relation === undefined) return;
  if (state.campaignRuntime.definitions[relation.definitionId] !== undefined) {
    throw new TypeError("A new hazard cannot replace an existing trigger relation.");
  }
  state.campaignRuntime.definitions[relation.definitionId] = relation as unknown as JsonRecord;
}

export function hazardTriggerIsActive(state: AuthoritativeWorldState, hazard: unknown): boolean {
  if (!isEnvironmentHazardDefinition(hazard)) return false;
  const expected = initialHazardTriggerRelation(hazard)!;
  const actual = state.campaignRuntime.definitions[expected.definitionId];
  return isStoredSemanticDefinition(actual) && actual.semanticKind === "worldRelation"
    && actual.templateRef === expected.templateRef && actual.templateHash === expected.templateHash
    && actual.content.relationRef === expected.definitionId
    && actual.content.kind === "triggers" && actual.content.state === "active"
    && actual.content.subjectRef === expected.content.subjectRef
    && actual.content.objectRef === expected.content.objectRef;
}
