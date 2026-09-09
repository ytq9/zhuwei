import type {
  CompleteStoryInvocation, CompleteStoryInvocationResult, ReserveExternalStoryInvocation,
  StoryExternalInvocationBeginResult, StoryExternalInvocationBinding, StoryExternalInvocationRead,
} from "./story-creation-invocation";
import type { StoryCreationStore } from "./story-creation-store";

/** The Room owns authentication, valid semantic stage transitions and the
 * frozen stage proof -> invocationId mapping. Its outer SQLite transaction
 * must cover begin plus that mapping. The returned ready capability is the
 * only permission to send; a timeout/new HTTP request is never a new stage.
 *
 * Proposal, NPC and narration adapters share this physical-call ledger with
 * Story Creation. Their protocol rows must not keep another mutable response
 * or send status. Reads and completion always come back to the same Store. */
export function createStoryExternalInvocationJournal(store: StoryCreationStore) {
  const request = (binding: StoryExternalInvocationBinding): ReserveExternalStoryInvocation | undefined => {
    if (binding.budget.roomAccountId !== binding.roomAccountId) return undefined;
    const { budget: _budget, ...invocation } = binding;
    return invocation;
  };
  const rejected = { kind: "rejected", code: "STORY_IDENTITY_CONFLICT" } as const;
  return {
    begin(binding: StoryExternalInvocationBinding): StoryExternalInvocationBeginResult {
      const invocation = request(binding);
      if (invocation === undefined) return rejected;
      const budget = store.openBudget({ source: binding.source, budget: binding.budget });
      if (budget.kind === "rejected") return budget;
      const reserved = store.reserveExternalInvocation(invocation);
      if (reserved.kind === "rejected") return reserved;
      if (reserved.kind === "reserved") {
        const started = store.startInvocation(reserved);
        return started.kind === "completed" || started.kind === "waiting"
          ? { ...started, invocationId: reserved.invocationId } : started;
      }
      const saved = store.readExternalInvocation(invocation);
      if (saved.kind !== "found") return saved.kind === "rejected" ? saved : rejected;
      return { ...reserved, invocationId: saved.invocation.invocationId };
    },
    read(binding: StoryExternalInvocationBinding, invocationId?: string): StoryExternalInvocationRead {
      const invocation = request(binding);
      return invocation === undefined ? rejected : store.readExternalInvocation(invocation, invocationId);
    },
    complete(binding: StoryExternalInvocationBinding, completion: CompleteStoryInvocation): CompleteStoryInvocationResult {
      const invocation = request(binding);
      if (invocation === undefined) return rejected;
      const saved = store.readExternalInvocation(invocation, completion.invocationId);
      if (saved.kind !== "found") return saved.kind === "rejected" ? saved : rejected;
      return store.completeInvocation(completion);
    },
  };
}

export type StoryExternalInvocationJournal = ReturnType<typeof createStoryExternalInvocationJournal>;
