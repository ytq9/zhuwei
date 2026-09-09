import { createAuthoritativeKpAdapter } from "../kp/authoritative";
import type { AuthoritativeKpAdapter, AuthoritativeKpAdapterOptions } from "../kp/authoritative-types";
import { deepSeekRequestBody } from "../kp/deepseek";

/** Private publication authority, never part of the model's creative input. */
export type StoryNarrationAuthority =
  | { kind: "delivery"; publishCapability: string; audienceId: string }
  | { kind: "recovery"; capability: string };

export function createJournaledNarrationAdapter(options: AuthoritativeKpAdapterOptions,
  run: (authority: StoryNarrationAuthority, generation: number, ordinal: 1 | 2,
    providerBody: Record<string, unknown>) => Promise<unknown>): AuthoritativeKpAdapter {
  const ordinary = createAuthoritativeKpAdapter(options);
  return { ...ordinary, async narrate(request) {
    if (request.narrationInputMode !== "frozenRenderableClaims-vnext-1") return ordinary.narrate(request);
    if (request.publicationAuthority === undefined || !Number.isSafeInteger(request.deliveryGeneration)) {
      throw Object.assign(new Error("NARRATION_PUBLICATION_FAILED"), { publicCode: "NARRATION_PUBLICATION_FAILED" });
    }
    const authority = request.publicationAuthority, generation = request.deliveryGeneration!;
    let ordinal = 0;
    // Each narration has a private counter. No request can share or mutate a
    // different Viewer's stage; Room proves the exact generation/review input.
    return createAuthoritativeKpAdapter({ ...options, ai: { async run(model, input) {
      ordinal += 1;
      if (ordinal !== 1 && ordinal !== 2) throw new TypeError("STORY_CALL_LIMIT_REACHED");
      return run(authority, generation, ordinal, deepSeekRequestBody(model, input));
    } } }).narrate(request);
  } };
}
