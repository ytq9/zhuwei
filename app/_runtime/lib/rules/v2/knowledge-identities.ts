import { heldKnowledgeDisplayRefs } from "./knowledge-expression";
import type { AuthoritativeWorldState, KnowledgeRecord } from "./model";
import { isNonEmptyString, isRecord } from "./validation";

export type KnowledgeIdentity = Readonly<{ knowledgeRef: string; ref: string; name: string }>;

/** A name-only projection of explicitly authorized, offstage premise
 * identities. This never grants a target, its hidden properties or mechanics.
 * Shared knowledge does not inherit the original holder's private policies. */
export function projectHeldKnowledgeIdentities(state: AuthoritativeWorldState, characterId: string,
  knowledge: readonly KnowledgeRecord[]): KnowledgeIdentity[] {
  return knowledge.flatMap(record => {
    if (record.objectKind !== "canonicalFact" || record.layer !== "full") return [];
    return heldKnowledgeDisplayRefs([record]).flatMap(ref => {
      const definition = state.campaignRuntime.definitions[ref];
      if (!isRecord(definition) || !isRecord(definition.content)) return [];
      const policy = definition.visibilityPolicyRef;
      if (policy !== `visibility:knowledge-holder:${characterId}` && policy !== `visibility:character-controller:${characterId}`
        && policy !== "visibility:public" && !(typeof policy === "string" && policy.startsWith("visibility:public:"))) return [];
      const name = definition.content.name ?? definition.content.displayAlias;
      if (!isNonEmptyString(name) || /[a-z][a-z0-9-]{1,63}:[a-z0-9][a-z0-9._:/-]*/iu.test(name)) return [];
      return [{ knowledgeRef: record.knowledgeRef, ref, name }];
    });
  }).sort((a, b) => a.knowledgeRef < b.knowledgeRef ? -1 : a.knowledgeRef > b.knowledgeRef ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
}
