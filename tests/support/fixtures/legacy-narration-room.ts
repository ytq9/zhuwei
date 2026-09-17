import type { RoomDurableObject } from "../../../app/_runtime/lib/room/durable-object";

/** Reconstruct an already committed, pre-plain-text Room at the publication
 * boundary. This is historical database setup, never a production switch.
 * The existing interruption suite verifies that those saved rooms retain their
 * old exact requests, postcommit recovery and lease semantics after upgrade. */
export function legacyCommittedNarrationAuthority(target: RoomDurableObject) {
  return new Proxy(target, { get(instance, key) {
    if (key !== "commit") {
      const value = Reflect.get(instance, key);
      return typeof value === "function" ? (...args: unknown[]) => Reflect.apply(value, instance, args) : value;
    }
    return async (...args: Parameters<RoomDurableObject["commit"]>) => {
      const result = await instance.commit(...args);
      if (result.kind !== "awaitingNarration") return result;
      const internal = instance as any, store = internal.authorityStore;
      const row = store.provisionalReplyForPublication(result.deliveryPlan.publishCapability);
      const staged = JSON.parse(row.payload_json), current = internal.authoritativeReplay();
      const replay = internal.rulesRuntime.replay(current.genesis, [...store.events(), ...staged.candidateEvents]);
      if (replay.kind !== "replayed") throw new Error("Legacy fixture candidate must replay.");
      const outcome = staged.outcome;
      delete outcome.deliveryPlan.narrationPolicy;
      delete outcome.deliveryPlan.commitMode;
      store.transaction(() => {
        const group = store.provisionalMechanics(row.prepared_action_id);
        const prefixLength = group ? JSON.parse(group.events_json).length : 0;
        for (const root of store.provisionalRoots(row.prepared_action_id)) {
          const submission = store.submissionByPrepared(root) ?? store.initiatingSubmission(root);
          const prior = submission?.result_json ? JSON.parse(submission.result_json) : undefined;
          if (!prior?.deliveryPlan) continue;
          delete prior.deliveryPlan.narrationPolicy; delete prior.deliveryPlan.commitMode;
          store.saveDeliveryPlan(prior.deliveryPlan, prior.receipt.eventRange.last);
          store.ensureDeliveryAudiences(prior.deliveryPlan);
          store.finishSubmission(submission.prepared_action_id, "committed", submission.proposal_hash, prior);
        }
        internal.appendAuthorityTransition(replay.state, staged.candidateEvents.slice(prefixLength));
        store.saveReceipt(outcome.receipt);
        store.advanceScope(store.submissionByPrepared(row.prepared_action_id).scene_scope);
        store.finishSubmission(row.prepared_action_id, "committed", staged.proposalHash, outcome);
        store.finishDueWork(outcome.receipt.rootActionId, "committed");
        store.finalizeRandomnessBatch(row.prepared_action_id);
        // Existing plans and physical contexts have no plain-text policy.
        internal.ctx.storage.sql.exec("UPDATE authority_delivery_plans SET plan_json = ? WHERE publish_capability = ?",
          JSON.stringify(outcome.deliveryPlan), row.publish_capability);
        internal.ctx.storage.sql.exec("DELETE FROM authority_provisional_replies WHERE prepared_action_id = ?", row.prepared_action_id);
        for (const audience of outcome.deliveryPlan.audiences) internal.ctx.storage.sql.exec("DELETE FROM authority_story_host_contexts WHERE context_kind = 'narration' AND prepared_action_id = ?", `narration:${outcome.receipt.rootActionId}:${audience.audienceId}:1`);
      });
      const parent = store.submissionByPrepared(args[1]);
      return parent && args[1] !== row.prepared_action_id ? { ...JSON.parse(parent.result_json), dueOutcomes: [outcome] } : outcome;
    };
  } });
}
