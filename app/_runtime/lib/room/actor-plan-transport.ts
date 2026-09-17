import { diagnoseFailure, diagnosticError, fixedFailureDiagnostic } from "../platform/failure-diagnostics";
import { RpcTarget } from "cloudflare:workers";
import { NARRATION_TIMEOUT_MS } from "../kp/timeouts";
import type { AuthoritativeModelBinding } from "../kp/authoritative-types";
import type { ActorPlanTransport, ActorPlanTransportResult } from "./actor-plan-transport-types";

/** The binding comes from the same HTTP call scope as player proposals and
 * narration. This capability never owns another counter or model fallback. */
export class ActorPlanTransportCapability extends RpcTarget implements ActorPlanTransport {
  #binding: AuthoritativeModelBinding;
  constructor(binding: AuthoritativeModelBinding) { super(); this.#binding = binding; }

  async run(model: string, input: Record<string, unknown>, timeoutMs = 45_000): Promise<ActorPlanTransportResult> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > NARRATION_TIMEOUT_MS) {
      throw new TypeError("MODEL_TRANSPORT_TIMEOUT_INVALID");
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      return { kind: "completed", response: await this.#binding.run(model, input,
        { signal: controller.signal }) };
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error
        && error.code === "localProbeBudgetExhausted") {
        return { kind: "notInvoked", code: "ACTOR_PLAN_DECISION_CALL_BUDGET_EXHAUSTED" };
      }
      // Provider details stay in the frozen private invocation boundary.
      throw diagnosticError(timedOut ? fixedFailureDiagnostic("providerTimeout") : diagnoseFailure(error, "modelRequest"));
    } finally { clearTimeout(timer); }
  }
}
