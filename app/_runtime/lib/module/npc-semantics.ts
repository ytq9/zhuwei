import type { AuthoritativeModuleProfile } from "./authoritative";
import { createDefinitionSnapshot, storedSemanticDefinition } from "../rules/v2/semantic-definitions";

/** Creation-time interpretation of the pinned Bible. The resulting definitions
 * live in Room genesis and evolve through Rules; later decisions never reread
 * the module as a second NPC state source. */
export function moduleNpcSemanticSeeds(profile: AuthoritativeModuleProfile) {
  return profile.storyBible.importantNpcs.map(npc => {
    const definitionRef = `definition:module-npc:${npc.entityId}`;
    const snapshot = createDefinitionSnapshot(definitionRef, "1", {
      label: npc.name,
      description: npc.publicFace,
      links: { entityRef: npc.entityId },
      semantics: {
        goals: [{ goalRef: `goal:${npc.entityId}:module-initial`, description: npc.goal }],
        plans: [],
        behavioralConstraints: structuredClone(npc.behavioralConstraints),
        // This is an initial knowledge boundary, not a permanent prohibition
        // on learning. Later holder knowledge remains the evidence of learning.
        initialUnknowns: [...npc.declaredUnknowns],
        publicExpression: { voice: npc.voice, attitude: null },
      },
    });
    return {
      definition: storedSemanticDefinition("npc", "visibility:scene-observers", snapshot, {
        templateRef: definitionRef, templateHash: snapshot.definitionHash,
      }),
      binding: { entityRef: npc.entityId, definitionRef },
    };
  });
}
