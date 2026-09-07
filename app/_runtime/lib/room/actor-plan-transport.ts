import { RpcTarget } from "cloudflare:workers";
import type { AuthoritativeModelBinding } from "../kp/authoritative-types";
import type { ActorPlanTransport, ActorPlanTransportResult } from "./actor-plan-transport-types";

/** The binding comes from the same HTTP call scope as player proposals and
 * narration. This capability never owns another counter or model fallback. */
export class ActorPlanTransportCapability extends RpcTarget implements ActorPlanTransport {
  #binding: AuthoritativeModelBinding;
  constructor(binding: AuthoritativeModelBinding) { super(); this.#binding = binding; }

  async run(model: string, input: Record<string, unknown>): Promise<ActorPlanTransportResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      return { kind: "completed", response: await this.#binding.run(model, input,
        { signal: controller.signal }) };
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error
        && error.code === "localProbeBudgetExhausted") {
        return { kind: "notInvoked", code: "ACTOR_PLAN_DECISION_CALL_BUDGET_EXHAUSTED" };
      }
      // Provider details stay in the frozen private invocation boundary.
      throw new Error("ACTOR_PLAN_DECISION_TRANSPORT_FAILED");
    } finally { clearTimeout(timer); }
  }
}
