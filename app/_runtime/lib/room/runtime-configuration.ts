import type { AuthoritativeKpProfile } from "../kp/authoritative-types";
import {
  authoritativeKpProfileByBinding,
} from "../kp/authoritative-policy";
import { canonicalJson } from "../kp/authoritative-helpers";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../kp/model-registry";
import { VNEXT_KP_CONFIGURATIONS } from "../kp/vnext/runtime-policy";
import { SOCIAL_RESOLUTION_MODULE_VERSION } from "../module/authoritative";
import { pinnedModuleRef } from "../module/registry";
import { VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST } from "../rules/profiles/vnext-world-interaction";
import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";
import {
  type PersistedRoomKpBinding,
  type V3RoomBindingValidation,
} from "./v3-binding";
import type { AuthoritativeModuleRef } from "../module/authoritative";
type RoomBindingInput = Readonly<{
  binding: PersistedRoomKpBinding | undefined;
  roomProfile: AuthoritativeKpProfile | undefined;
  requestedProfile?: AuthoritativeKpProfile;
  expectedModuleRef?: AuthoritativeModuleRef;
  observation?: unknown;
}>;

function exactJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left) === canonicalJson(right); }
  catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExactVNextProfile(profile: AuthoritativeKpProfile | undefined): boolean {
  return profile !== undefined && VNEXT_KP_CONFIGURATIONS.some(entry => exactJson(profile, entry.profile));
}

/** The current configuration a room's stored workflow manifest belongs to.
 * SPEC 0011 §3: a room keeps its model -- the workflow it was created on, its
 * KP profile and its narration profile -- while that workflow's version
 * (prompts, schemas, request assembly) follows the deployment, so the other
 * fields of an earlier manifest may differ. The stored text must still be a
 * manifest the server printed, byte for byte. */
function configurationForWorkflow(value: unknown) {
  if (typeof value !== "string") return undefined;
  let manifest: unknown;
  try { manifest = JSON.parse(value); } catch { return undefined; }
  if (!isRecord(manifest) || JSON.stringify(manifest) !== value) return undefined;
  return VNEXT_KP_CONFIGURATIONS.find(entry => manifest.workflowRef === entry.workflow.workflowRef
    && exactJson(manifest.profile, entry.workflow.profile) && exactJson(manifest.narrationProfile, entry.workflow.narrationProfile));
}

/** New rooms use vNext. Persisted rooms resolve only the model they were
 * created with, at its current workflow version; neither request data nor a
 * local flag can reinterpret them. */
export function roomRuntimeConfiguration() {
  const acceptsProfile = (profile: AuthoritativeKpProfile) =>
    isExactVNextProfile(profile);
  const hasWorkflow = (value: unknown): value is string =>
    configurationForWorkflow(value) !== undefined;
  const hasGenerationBinding = (profile: AuthoritativeKpProfile, workflow: unknown) => {
    const entry = configurationForWorkflow(workflow);
    return entry !== undefined && exactJson(profile, entry.profile);
  };

  function validateRoomBinding(input: RoomBindingInput): V3RoomBindingValidation {
    // vNext is the only profile with a proposal path. A room bound to the
    // retired V5 profile is refused here (ADR 0028, ADR 0034).
    if (!isExactVNextProfile(input.roomProfile)) return { kind: "invalid", violation: "modelProfile" };
    const binding = input.binding;
    if (binding === undefined || binding.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
      || binding.kp_model !== input.roomProfile!.modelId
      || binding.kp_model_profile !== input.roomProfile!.modelProfileVersion
      || input.requestedProfile !== undefined && !exactJson(input.requestedProfile, input.roomProfile)) {
      return { kind: "invalid", violation: "modelProfile" };
    }
    if (!hasGenerationBinding(input.roomProfile!, binding.kp_workflow_manifest)) return { kind: "invalid", violation: "workflow" };
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
    profileByModelId(model: unknown): AuthoritativeKpProfile | undefined {
      return VNEXT_KP_CONFIGURATIONS.find(entry => entry.profile.modelId === model)?.profile;
    },
    profileByBinding(model: unknown, version: unknown): AuthoritativeKpProfile | undefined {
      const current = VNEXT_KP_CONFIGURATIONS.find(entry => entry.profile.modelId === model && entry.profile.modelProfileVersion === version);
      if (current) return current.profile;
      return authoritativeKpProfileByBinding(model, version);
    },
    acceptsProfile,
    hasWorkflow,
    hasGenerationBinding,
    workflowForProfile(profile: AuthoritativeKpProfile): string | undefined {
      return VNEXT_KP_CONFIGURATIONS.find(entry => exactJson(profile, entry.profile))?.manifestJson;
    },
    /** The current version of a stored manifest's workflow, which the room's
     * next action records in its place. */
    currentWorkflowFor(value: unknown): string | undefined {
      return configurationForWorkflow(value)?.manifestJson;
    },
    runtimeManifestForWorkflow(value: unknown) {
      return configurationForWorkflow(value) === undefined ? undefined : VNEXT_STAGE3_RUNTIME_PROFILE_MANIFEST;
    },
    validateRoomBinding,
  });
}
