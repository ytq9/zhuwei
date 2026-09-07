import { VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH } from "./actor-plan-decision";
import { VNEXT_NARRATION_POLICY } from "../narration-vnext";
import { AUTHORITATIVE_KP_PROFILE } from "../authoritative-policy";
import { canonicalHash } from "./canonical-json";
import { providerBudgetProfile } from "./invocation/budget";
import { VNEXT_PROPOSAL_BUNDLE_PARSER_HASH } from "./proposal-provider";
import { SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA, SUBMIT_KP_PROPOSAL_BUNDLE_TOOL, OFFER_KP_PROPOSAL_BUNDLE_TOOL, CORRECT_KP_PROPOSAL_BUNDLE_TOOL, CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA, VNEXT2_PROPOSAL_BUNDLE_SCHEMA } from "./proposal-schema";
import { VNEXT_PROPOSAL_CAPABILITY_POLICY_HASH } from "./proposal-capabilities";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../../rules/profiles/vnext-world-interaction";
import { createVersionedRulesRuntime } from "../../rules/v2-runtime";
import { PRODUCTION_RUNTIME_PROFILE_REGISTRY } from "../../rules/profiles/registry";
import { VNEXT_PROPOSAL_GUIDANCE_POLICY_HASH } from "./proposal-guidance";
import { VNEXT_PROPOSAL_CONTEXT_SCHEMA } from "./proposal-context";

export const VNEXT_PROVIDER_BUDGET = providerBudgetProfile("zhuwei.local-vnext-input-budget/v1", {
  contextWindowTokens: 64_000,
  completionReserveTokens: 4_000,
  safetyMarginTokens: 2_000,
  counterRef: "conservative-v1",
});

export const VNEXT_KP_PROFILE = Object.freeze({
  ...AUTHORITATIVE_KP_PROFILE,
  modelProfileVersion: "authoritative-kp-deepseek-vnext-local-v1",
  promptPolicyVersion: "kp-vnext-authority-policy-v2",
  proposalSchemaVersion: VNEXT2_PROPOSAL_BUNDLE_SCHEMA,
  actionLanguageVersion: "kp-vnext2-proposal-bundle-v1",
});

export const VNEXT_KP_WORKFLOW = Object.freeze({
  workflowRef: "kp-vnext-local-workflow-v1",
  profile: VNEXT_KP_PROFILE,
  promptHash: VNEXT_PROPOSAL_GUIDANCE_POLICY_HASH,
  schemaHash: canonicalHash(SUBMIT_KP_PROPOSAL_BUNDLE_SCHEMA),
  // Schema property order affects the model's filling surface even though
  // canonical structural hashes intentionally ignore object-member order.
  schemaPresentationHash: canonicalHash(JSON.stringify({
    proposal: SUBMIT_KP_PROPOSAL_BUNDLE_TOOL, offer: OFFER_KP_PROPOSAL_BUNDLE_TOOL,
    correction: CORRECT_KP_PROPOSAL_BUNDLE_TOOL,
  })),
  offerToolHash: canonicalHash(OFFER_KP_PROPOSAL_BUNDLE_TOOL),
  schemaCapabilityPolicyHash: VNEXT_PROPOSAL_CAPABILITY_POLICY_HASH,
  callPolicy: { selections: 1, proposals: 1, terminalMaximumTotal: 2, stepCorrections: 1, stepMaximumTotal: 3 },
  correctionSchemaHash: canonicalHash(CORRECT_KP_PROPOSAL_BUNDLE_SCHEMA),
  parserHash: VNEXT_PROPOSAL_BUNDLE_PARSER_HASH,
  contextRepresentation: VNEXT_PROPOSAL_CONTEXT_SCHEMA,
  budgetHash: VNEXT_PROVIDER_BUDGET.profileHash,
  runtimeManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST,
  proposalTransport: "deepseek-strict-tool-beta",
  actorPlanDecision: { bindingHash: VNEXT_ACTOR_PLAN_DECISION_BINDING_HASH,
    decisions: 1, corrections: 0, maximumTransportAttempts: 1 },
  narrationProfile: AUTHORITATIVE_KP_PROFILE,
  narrationPolicy: VNEXT_NARRATION_POLICY,
  validationStatus: "development",
});
export const VNEXT_KP_WORKFLOW_HASH = canonicalHash(VNEXT_KP_WORKFLOW);
export const VNEXT_KP_WORKFLOW_MANIFEST_JSON = JSON.stringify(VNEXT_KP_WORKFLOW);

/** Only an explicit local host selects this runtime. Production registry is unchanged. */
export const VNEXT_LOCAL_RULES_RUNTIME = createVersionedRulesRuntime({
  registrations: [...PRODUCTION_RUNTIME_PROFILE_REGISTRY.registrations,
    { manifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST, interpreterKind: "authoritative-v2" }],
  defaultManifest: VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST.manifest,
});
