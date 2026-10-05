import type { AuthoritativeWorldState } from "../../../rules/authority-read";
import type { ContextWorkBudget } from "./work-budget";

/** SPEC 0001 §§11、16: the host reads existing local intentions even when
 * the player asks about the situation without naming an NPC. This contains
 * no manuscript future and never enters the separately built NPC frame. */
export function situationalPlanRefs(state: AuthoritativeWorldState, actorRef: string, budget: ContextWorkBudget): readonly string[] | undefined {
  const sceneRef = state.entities[actorRef]?.sceneId;
  const refs: string[] = [];
  for (const [id, plan] of Object.entries(state.campaignRuntime.npcPlans)) {
    if (!budget.charge("postingVisits", 1)) return undefined;
    if (typeof plan.npcId !== "string" || state.entities[plan.npcId]?.sceneId !== sceneRef) continue;
    const active = ["scheduled", "planned", "deferred"].includes(String(plan.status));
    if (active) refs.push(`continuity:npcPlans:${id}`);
  }
  return refs.sort();
}
