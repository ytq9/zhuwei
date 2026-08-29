import {
  CAUSAL_ACTION_LANGUAGE_PROFILE,
} from "../../kp/causal-action-program";
import type { CanonicalProfileDocument, ProfileRef } from "./types";

/**
 * New-room-only Rules interpreter for the closed V3 causal action language.
 *
 * The language profile describes the data program produced at the private KP
 * boundary. This extension is the independently pinned executable semantics:
 * without the exact extension, Rules must reject rather than reinterpret a V3
 * program through the historical ActionPlan v1 adapter.
 */
export const CAUSAL_ACTION_INTERPRETER_PROFILE = {
  profileId: "causal-action-interpreter-2014-v3",
  profileHash: "sha256:4d291e26edc1ed7b1eeebe191999667295ea06c27a1677b4f7f0a96a459f9dee",
} as const satisfies ProfileRef;

export const CAUSAL_ACTION_INTERPRETER_PROFILE_DOCUMENT: CanonicalProfileDocument = {
  schema: "zhuwei.runtime-profile/v1",
  profileKind: "causalActionInterpreter",
  profileId: CAUSAL_ACTION_INTERPRETER_PROFILE.profileId,
  semanticVersion: "3.0.0",
  normativePayload: {
    conformanceVersion: "1",
    rulesBasis: "srd5.1-2014-plus-versioned-product-ruling",
    inputKind: "resolveCompoundActionPlan",
    actionPlanVersion: CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef,
    languageRef: CAUSAL_ACTION_LANGUAGE_PROFILE.languageRef,
    languageHash: CAUSAL_ACTION_LANGUAGE_PROFILE.languageHash,
    formCatalogRef: CAUSAL_ACTION_LANGUAGE_PROFILE.formCatalogRef,
    formCatalogHash: CAUSAL_ACTION_LANGUAGE_PROFILE.formCatalogHash,
    maxNodes: CAUSAL_ACTION_LANGUAGE_PROFILE.maxNodes,
    maxDepth: CAUSAL_ACTION_LANGUAGE_PROFILE.maxDepth,
    validation: "rules-revalidates-exact-language-form-program-hash-acyclic-graph-and-primitive-arguments",
    actorAuthority: "room-adds-authenticated-actor-and-root-only",
    execution: "rules-topological-node-interpreter-with-per-node-direct-or-check-branch-effects",
    costs: "freeze-and-consume-once-before-any-authoritative-randomness",
    randomness: "room-durable-object-only-bounded-batch-with-frozen-continuations",
    settlement: "all-check-results-required-and-atomically-applied-in-node-order",
    scope: "every-event-carries-state-bound-read-write-create-proof",
    replay: "typed-events-and-frozen-program-plan-only-no-model-or-reroll",
    legacyIsolation: "authoritative-kp-action-plan-v1-remains-byte-for-byte-separate",
  },
};

export function causalActionInterpreterEnabled(extensions: readonly ProfileRef[]): boolean {
  return extensions.some((extension) =>
    extension.profileId === CAUSAL_ACTION_INTERPRETER_PROFILE.profileId
    && extension.profileHash === CAUSAL_ACTION_INTERPRETER_PROFILE.profileHash);
}
