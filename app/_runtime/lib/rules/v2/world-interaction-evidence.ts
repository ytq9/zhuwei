import { canonicalSha256 } from "../profiles/canonical";
import type { AuthoritativeWorldState, EventPayloadByType } from "./model";
import type { WorldInteractionBranch, WorldInteractionResolutionPlan } from "./world-interaction-model";

export function sensoryEvidenceFactId(rootActionId: string, resolutionId: string, branch: "success" | "failure", index: number): string {
  return `fact:world-interaction:${canonicalSha256({ rootActionId, resolutionId, branch, index })
    .slice("sha256:".length, "sha256:".length + 32)}`;
}

export type WorldInteractionEvidenceDraft =
  | Readonly<{ eventType: "CanonicalFactDeclared"; resolutionId: string; payload: EventPayloadByType["CanonicalFactDeclared"];
    reads: string[]; writes: string[]; creates: string[]; visibilityPolicyId: string; secrecy: "internal" }>
  | Readonly<{ eventType: "SensoryEvidenceAcquired"; resolutionId: string; payload: EventPayloadByType["SensoryEvidenceAcquired"];
    reads: string[]; writes: string[]; creates: string[]; visibilityPolicyId: string; secrecy: "public" | "private" }>;

/** The two events each branch perception produces: the observed fact and its
 * observer's acquisition. Execution appends them; the social settlement fold
 * checks the same drafts, so neither can drift from the other. */
export function worldInteractionEvidenceDrafts(state: AuthoritativeWorldState, rootActionId: string,
  plan: WorldInteractionResolutionPlan, branchName: "success" | "failure", branch: WorldInteractionBranch): WorldInteractionEvidenceDraft[] {
  return branch.sensoryEvidence.flatMap((evidence, index): WorldInteractionEvidenceDraft[] => {
    const factId = sensoryEvidenceFactId(rootActionId, plan.resolutionId, branchName, index);
    return [{
      eventType: "CanonicalFactDeclared", resolutionId: plan.resolutionId,
      payload: { fact: {
        id: factId, kind: "worldInteractionSensoryEvidence",
        subjectRefs: refs([plan.sceneRef, evidence.observerRef, ...(evidence.subjectRef === null ? [] : [evidence.subjectRef])]),
        value: { schema: "zhuwei.world-interaction-sensory-fact/v1", observerRef: evidence.observerRef, subjectRef: evidence.subjectRef,
          sense: evidence.sense, evidence: evidence.evidence },
        visibilityPolicyId: "visibility:hidden-until-evidence", source: "observedEvent",
        causalParentIds: refs(evidence.basisRefs.filter(ref => state.canonicalFacts[ref] !== undefined)),
      } },
      reads: refs([`entity:${evidence.observerRef}`, `scene:${plan.sceneRef}`, ...evidence.basisRefs]),
      writes: [`fact:${factId}`, `receipt:${rootActionId}`], creates: [`fact:${factId}`],
      visibilityPolicyId: "visibility:room-authority-only", secrecy: "internal",
    }, {
      eventType: "SensoryEvidenceAcquired", resolutionId: plan.resolutionId,
      payload: { characterId: evidence.observerRef, factId, sense: evidence.sense, clarity: "full", publicEvidence: evidence.evidence },
      reads: [`entity:${evidence.observerRef}`, `fact:${factId}`],
      writes: [`knowledge:${evidence.observerRef}`, `receipt:${rootActionId}`],
      creates: [`knowledge:${evidence.observerRef}:${factId}`],
      visibilityPolicyId: evidence.visibilityPolicyRef,
      secrecy: evidence.visibilityPolicyRef === "visibility:scene-observers" ? "public" : "private",
    }];
  });
}

function refs(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
