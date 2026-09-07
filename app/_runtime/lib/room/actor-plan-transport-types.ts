/** Request-scoped server capability. Only the server's existing shared model
 * call scope may return notInvoked, before reaching a physical provider. */
export type ActorPlanTransportResult =
  | { kind: "completed"; response: unknown }
  | { kind: "notInvoked"; code: "ACTOR_PLAN_DECISION_CALL_BUDGET_EXHAUSTED" };

export type ActorPlanTransport = {
  run(model: string, input: Record<string, unknown>): Promise<ActorPlanTransportResult>;
};
