import type { AuthoritativeKpProfile } from "../kp/authoritative-types";
import {
  authoritativeKpProfileByBinding, authoritativeKpProfileByModelId,
  hasExactV3KpWorkflowManifest, isV3AuthoritativeKpProfile,
  PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON, runtimeManifestForExactV3KpWorkflow,
} from "../kp/authoritative-policy";
import { canonicalJson } from "../kp/authoritative-helpers";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../kp/model-registry";
import { VNEXT_KP_PROFILE, VNEXT_KP_WORKFLOW_MANIFEST_JSON } from "../kp/vnext/runtime-policy";
import { SOCIAL_RESOLUTION_MODULE_VERSION } from "../module/authoritative";
import { pinnedModuleRef } from "../module/registry";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../rules/profiles/vnext-world-interaction";
import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";
import { hasExactV3KpGenerationBinding, validateV3RoomBinding, type V3RoomBindingValidation } from "./v3-binding";

type RoomBindingInput = Parameters<typeof validateV3RoomBinding>[0];

function exactJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left) === canonicalJson(right); }
  catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExactVNextProfile(profile: AuthoritativeKpProfile | undefined): boolean {
  return profile !== undefined && exactJson(profile, VNEXT_KP_PROFILE);
}

/** Request-time host configuration. No client input or module-level env read
 * selects a generation, and enabling local vNext never reinterprets V3 rooms. */
export function roomRuntimeConfiguration(environment: unknown) {
  const localVNext = isRecord(environment) && environment.ZHUWEI_VNEXT_LOCAL === "true";
  const acceptsProfile = (profile: AuthoritativeKpProfile) =>
    isV3AuthoritativeKpProfile(profile) || localVNext && isExactVNextProfile(profile);
  const hasWorkflow = (value: unknown): value is string =>
    hasExactV3KpWorkflowManifest(value) || localVNext && value === VNEXT_KP_WORKFLOW_MANIFEST_JSON;
  const hasGenerationBinding = (profile: AuthoritativeKpProfile, workflow: unknown) =>
    hasExactV3KpGenerationBinding(profile, workflow)
    || localVNext && isExactVNextProfile(profile) && workflow === VNEXT_KP_WORKFLOW_MANIFEST_JSON;

  function validateRoomBinding(input: RoomBindingInput): V3RoomBindingValidation {
    if (!localVNext || !isExactVNextProfile(input.roomProfile)) return validateV3RoomBinding(input);
    const binding = input.binding;
    if (binding === undefined || binding.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      || binding.kp_model !== VNEXT_KP_PROFILE.modelId
      || binding.kp_model_profile !== VNEXT_KP_PROFILE.modelProfileVersion
      || input.requestedProfile !== undefined && !isExactVNextProfile(input.requestedProfile)) {
      return { kind: "invalid", violation: "modelProfile" };
    }
    if (binding.kp_workflow_manifest !== VNEXT_KP_WORKFLOW_MANIFEST_JSON) return { kind: "invalid", violation: "workflow" };
    if (binding.kp_context_planner_profile !== DISABLED_CONTEXT_PLANNER_PROFILE_REF) return { kind: "invalid", violation: "planner" };
    const readModel = isRecord(input.observation) && isRecord(input.observation.readModel)
      ? input.observation.readModel : undefined;
    if (!exactJson(readModel?.runtimeProfiles, VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST)) {
      return { kind: "invalid", violation: "runtimeManifest" };
    }
    const campaign = isRecord(readModel?.campaign) ? readModel.campaign : undefined;
    const moduleRef = pinnedModuleRef(binding.module_id, SOCIAL_RESOLUTION_MODULE_VERSION);
    if (input.expectedModuleRef === undefined || moduleRef === undefined
      || !exactJson(input.expectedModuleRef, moduleRef)
      || !exactJson(campaign?.moduleRef, input.expectedModuleRef)) {
      return { kind: "invalid", violation: "module" };
    }
    return { kind: "valid" };
  }

  return Object.freeze({
    localVNext,
    profileByModelId(model: unknown): AuthoritativeKpProfile | undefined {
      return localVNext ? model === VNEXT_KP_PROFILE.modelId ? VNEXT_KP_PROFILE : undefined
        : authoritativeKpProfileByModelId(model);
    },
    profileByBinding(model: unknown, version: unknown): AuthoritativeKpProfile | undefined {
      if (localVNext && model === VNEXT_KP_PROFILE.modelId && version === VNEXT_KP_PROFILE.modelProfileVersion) return VNEXT_KP_PROFILE;
      return authoritativeKpProfileByBinding(model, version);
    },
    acceptsProfile,
    hasWorkflow,
    hasGenerationBinding,
    workflowForProfile(profile: AuthoritativeKpProfile): string | undefined {
      if (localVNext && isExactVNextProfile(profile)) return VNEXT_KP_WORKFLOW_MANIFEST_JSON;
      return isV3AuthoritativeKpProfile(profile) ? PRIVATE_TOOLS_KP_WORKFLOW_MANIFEST_JSON : undefined;
    },
    runtimeManifestForWorkflow(value: unknown) {
      if (localVNext && value === VNEXT_KP_WORKFLOW_MANIFEST_JSON) return VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST;
      return runtimeManifestForExactV3KpWorkflow(value);
    },
    validateRoomBinding,
  });
}
