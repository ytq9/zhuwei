import assert from "node:assert/strict";
import test from "node:test";
import { roomRuntimeConfiguration } from "../app/_runtime/lib/room/runtime-configuration.ts";
import {
  AUTHORITATIVE_KP_PROFILES, authoritativeKpProfileByBinding,
  PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON,
} from "../app/_runtime/lib/kp/authoritative-policy.ts";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON } from "../app/_runtime/lib/kp/vnext/runtime-policy.ts";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../app/_runtime/lib/kp/model-registry.ts";
import { authoritativeModuleProfile } from "../app/_runtime/lib/module/authoritative.ts";
import { ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/manifests.ts";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../app/_runtime/lib/rules/profiles/vnext-world-interaction.ts";
import { AUTHORITATIVE_RULESET_VERSION } from "../app/_runtime/lib/rules/ruleset.ts";

const moduleProfile = await authoritativeModuleProfile("black-oak-will");
const local = roomRuntimeConfiguration({ ZHUWEI_VNEXT_LOCAL: "true" });

function validBinding(profile = VNEXT_KP_PROFILE) {
  const vNext = profile === VNEXT_KP_PROFILE;
  return {
    binding: {
      ruleset_version: AUTHORITATIVE_RULESET_VERSION, module_id: moduleProfile.moduleId, host_user_id: "principal:host",
      kp_model: profile.modelId, kp_model_profile: profile.modelProfileVersion,
      kp_workflow_manifest: vNext ? VNEXT_KP_WORKFLOW_MANIFEST_JSON : PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON,
      kp_context_planner_profile: DISABLED_CONTEXT_PLANNER_PROFILE_REF,
    },
    roomProfile: profile, requestedProfile: profile, expectedModuleRef: moduleProfile.moduleRef,
    observation: { kind: "observed", readModel: {
      runtimeProfiles: structuredClone(vNext ? VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST : ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST),
      campaign: { moduleRef: structuredClone(moduleProfile.moduleRef) },
    } },
  };
}

test("only the exact server opt-in enables vNext; the production model and workflow registry remain unchanged", () => {
  for (const flag of [undefined, false, true, "false", "TRUE", "1"]) {
    const configuration = roomRuntimeConfiguration({ ZHUWEI_VNEXT_LOCAL: flag });
    assert.equal(configuration.localVNext, false);
    assert.equal(configuration.profileByBinding(VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion), undefined);
    assert.equal(configuration.acceptsProfile(VNEXT_KP_PROFILE), false);
    assert.equal(configuration.hasWorkflow(VNEXT_KP_WORKFLOW_MANIFEST_JSON), false);
    assert.equal(configuration.runtimeManifestForWorkflow(VNEXT_KP_WORKFLOW_MANIFEST_JSON), undefined);
    assert.equal(configuration.validateRoomBinding(validBinding()).kind, "invalid");
    for (const profile of AUTHORITATIVE_KP_PROFILES) {
      assert.equal(configuration.profileByModelId(profile.modelId), profile);
      assert.equal(configuration.profileByBinding(profile.modelId, profile.modelProfileVersion), profile);
      assert.equal(configuration.workflowForProfile(profile), PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON);
      assert.equal(configuration.runtimeManifestForWorkflow(PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON), ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST);
      assert.deepEqual(configuration.validateRoomBinding(validBinding(profile)), { kind: "valid" });
    }
  }
  assert.equal(authoritativeKpProfileByBinding(VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion), undefined);
});

test("local creation binds the one approved model while complete persisted V3 and vNext generations stay distinct", () => {
  assert.equal(local.profileByModelId(VNEXT_KP_PROFILE.modelId), VNEXT_KP_PROFILE);
  assert.equal(local.profileByModelId("deepseek-v4-pro"), undefined, "an unsupported local model is rejected, never silently replaced");
  assert.equal(local.profileByModelId("client-selected-profile"), undefined);
  assert.equal(local.profileByBinding(VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion), VNEXT_KP_PROFILE);
  assert.equal(local.workflowForProfile(VNEXT_KP_PROFILE), VNEXT_KP_WORKFLOW_MANIFEST_JSON);
  assert.equal(local.hasWorkflow(VNEXT_KP_WORKFLOW_MANIFEST_JSON), true);
  assert.equal(local.hasWorkflow(`${VNEXT_KP_WORKFLOW_MANIFEST_JSON} `), false);
  assert.equal(local.runtimeManifestForWorkflow(VNEXT_KP_WORKFLOW_MANIFEST_JSON), VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST);
  assert.equal(local.hasGenerationBinding(VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON), true);
  assert.equal(local.hasGenerationBinding(VNEXT_KP_PROFILE, PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON), false);
  for (const profile of AUTHORITATIVE_KP_PROFILES) {
    assert.equal(local.profileByBinding(profile.modelId, profile.modelProfileVersion), profile);
    assert.equal(local.hasGenerationBinding(profile, PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON), true);
    assert.equal(local.hasGenerationBinding(profile, VNEXT_KP_WORKFLOW_MANIFEST_JSON), false);
    assert.deepEqual(local.validateRoomBinding(validBinding(profile)), { kind: "valid" });
  }
  const altered = { ...VNEXT_KP_PROFILE, promptPolicyVersion: "forged-policy" };
  assert.equal(local.acceptsProfile(altered), false);
  assert.equal(local.workflowForProfile(altered), undefined);
  assert.equal(local.hasGenerationBinding(altered, VNEXT_KP_WORKFLOW_MANIFEST_JSON), false);
});

test("local validation checks the full frozen model, workflow, planner, runtime, and module before authority use", () => {
  assert.deepEqual(local.validateRoomBinding(validBinding()), { kind: "valid" });
  for (const [violation, mutate] of [
    ["modelProfile", value => { value.binding.kp_model = "deepseek-v4-pro"; }],
    ["modelProfile", value => { value.binding.kp_model_profile = AUTHORITATIVE_KP_PROFILES[0].modelProfileVersion; }],
    ["modelProfile", value => { value.binding.ruleset_version = "retired-rules"; }],
    ["modelProfile", value => { value.requestedProfile = AUTHORITATIVE_KP_PROFILES[0]; }],
    ["modelProfile", value => { value.roomProfile = { ...VNEXT_KP_PROFILE, modelRevision: "forged-revision" }; }],
    ["workflow", value => { value.binding.kp_workflow_manifest = PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON; }],
    ["workflow", value => { value.binding.kp_workflow_manifest += " "; }],
    ["planner", value => { value.binding.kp_context_planner_profile = "planner:foreign"; }],
    ["runtimeManifest", value => { value.observation.readModel.runtimeProfiles = structuredClone(ENVIRONMENT_V5_RUNTIME_PROFILE_MANIFEST); }],
    ["runtimeManifest", value => { value.observation.readModel.runtimeProfiles.eventSchema.profileHash = `sha256:${"0".repeat(64)}`; }],
    ["runtimeManifest", value => { value.observation = undefined; }],
    ["module", value => { value.observation.readModel.campaign.moduleRef.profileHash = `sha256:${"0".repeat(64)}`; }],
    ["module", value => { value.expectedModuleRef = undefined; }],
    ["module", value => { value.binding.module_id = "unregistered-module"; }],
  ]) {
    const value = validBinding();
    mutate(value);
    assert.deepEqual(local.validateRoomBinding(value), { kind: "invalid", violation });
  }
});

test("configuration reads host opt-in at each request and never accepts a player runtime or profile field", () => {
  const environment = { ZHUWEI_VNEXT_LOCAL: "true" };
  const firstRequest = roomRuntimeConfiguration(environment);
  environment.ZHUWEI_VNEXT_LOCAL = "false";
  const nextRequest = roomRuntimeConfiguration(environment);
  assert.equal(firstRequest.localVNext, true);
  assert.equal(nextRequest.localVNext, false);
  assert.equal(nextRequest.hasWorkflow(VNEXT_KP_WORKFLOW_MANIFEST_JSON), false);
  assert.equal(roomRuntimeConfiguration({ runtime: "vnext", profile: VNEXT_KP_PROFILE }).localVNext, false);
});
