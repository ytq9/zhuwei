import assert from "node:assert/strict";
import test from "node:test";
import { NEW_ROOM_KP_MODELS } from "../app/_runtime/lib/kp/models.ts";
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
const local = roomRuntimeConfiguration();

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

test("production new rooms use the exact vNext workflow and the public model choice agrees", () => {
  const configuration = roomRuntimeConfiguration();
  assert.deepEqual(NEW_ROOM_KP_MODELS.map(model => model.id), [VNEXT_KP_PROFILE.modelId]);
  assert.equal(configuration.profileByModelId(VNEXT_KP_PROFILE.modelId), VNEXT_KP_PROFILE);
  assert.equal(configuration.profileByModelId("deepseek-v4-pro"), undefined);
  assert.equal(configuration.profileByBinding(VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion), VNEXT_KP_PROFILE);
  assert.equal(configuration.acceptsProfile(VNEXT_KP_PROFILE), true);
  assert.equal(configuration.hasWorkflow(VNEXT_KP_WORKFLOW_MANIFEST_JSON), true);
  assert.equal(configuration.runtimeManifestForWorkflow(VNEXT_KP_WORKFLOW_MANIFEST_JSON), VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST);
  assert.deepEqual(configuration.validateRoomBinding(validBinding()), { kind: "valid" });
  for (const profile of AUTHORITATIVE_KP_PROFILES) {
    assert.equal(configuration.profileByBinding(profile.modelId, profile.modelProfileVersion), profile);
    assert.equal(configuration.workflowForProfile(profile), PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON);
    assert.deepEqual(configuration.validateRoomBinding(validBinding(profile)), { kind: "valid" });
  }
  assert.equal(authoritativeKpProfileByBinding(VNEXT_KP_PROFILE.modelId, VNEXT_KP_PROFILE.modelProfileVersion), undefined,
    "the legacy profile lookup must not silently reinterpret a persisted generation");
});

test("new room creation binds the one approved model while complete persisted V3 and vNext generations stay distinct", () => {
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

test("validation checks the full frozen model, workflow, planner, runtime, and module before authority use", () => {
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

test("client values and retired local opt-in flags cannot downgrade the new-room generation", () => {
  for (const value of [undefined, {}, { ZHUWEI_VNEXT_LOCAL: "false" }, { ZHUWEI_VNEXT_LOCAL: "true" },
    { runtime: "v3", profile: AUTHORITATIVE_KP_PROFILES[0] }]) {
    const configuration = roomRuntimeConfiguration(value);
    assert.equal(configuration.profileByModelId(VNEXT_KP_PROFILE.modelId), VNEXT_KP_PROFILE);
    assert.equal(configuration.workflowForProfile(VNEXT_KP_PROFILE), VNEXT_KP_WORKFLOW_MANIFEST_JSON);
    assert.equal(configuration.hasGenerationBinding(VNEXT_KP_PROFILE, PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON), false);
  }
});
