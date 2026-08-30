import type { AuthoritativeKpProfile } from "../kp/authoritative-types";
import {
  V3_AUTHORITATIVE_KP_PROFILES,
  V5_KP_WORKFLOW_MANIFEST_JSON,
  hasExactV3KpWorkflowManifest,
  isSocialResolutionKpProfile,
  isV3AuthoritativeKpProfile,
  runtimeManifestForExactV3KpWorkflow,
} from "../kp/authoritative-policy";
import { canonicalJson } from "../kp/authoritative-helpers";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../kp/model-registry";
import type { AuthoritativeModuleRef } from "../module/authoritative";
import { SOCIAL_RESOLUTION_MODULE_VERSION } from "../module/authoritative";
import { pinnedModuleRef } from "../module/migration-registry";
import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";

type UnknownRecord = Record<string, unknown>;

export type PersistedRoomKpBinding = Readonly<{
  ruleset_version: string;
  module_id: string;
  host_user_id: string;
  kp_model: string;
  kp_model_profile: string;
  kp_workflow_manifest: string | null;
  kp_context_planner_profile: string | null;
}>;

export type V3RoomBindingViolation =
  | "modelProfile"
  | "workflow"
  | "planner"
  | "runtimeManifest"
  | "module";

export type V3RoomBindingValidation =
  | Readonly<{ kind: "historical" }>
  | Readonly<{ kind: "valid" }>
  | Readonly<{ kind: "invalid"; violation: V3RoomBindingViolation }>;

export function claimsV3RoomBinding(input: Readonly<{
  binding?: Pick<
    PersistedRoomKpBinding,
    "kp_model_profile" | "kp_workflow_manifest" | "kp_context_planner_profile"
  >;
  roomProfile?: AuthoritativeKpProfile;
  requestedProfile?: AuthoritativeKpProfile;
}>): boolean {
  return (input.roomProfile !== undefined && isV3AuthoritativeKpProfile(input.roomProfile))
    || (input.requestedProfile !== undefined && isV3AuthoritativeKpProfile(input.requestedProfile))
    || (input.binding !== undefined && V3_AUTHORITATIVE_KP_PROFILES.some((profile) =>
      profile.modelProfileVersion === input.binding!.kp_model_profile))
    || input.binding?.kp_workflow_manifest != null
    || input.binding?.kp_context_planner_profile != null;
}

/** The persisted model policy and workflow are one generation binding. This
 * prevents a newer prompt from driving an older Rules epoch (or vice versa). */
export function hasExactV3KpGenerationBinding(
  profile: AuthoritativeKpProfile,
  workflowManifest: unknown,
): boolean {
  return isV3AuthoritativeKpProfile(profile)
    && hasExactV3KpWorkflowManifest(workflowManifest)
    && ((workflowManifest === V5_KP_WORKFLOW_MANIFEST_JSON)
      === isSocialResolutionKpProfile(profile));
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function projectedReadModel(observation: unknown): UnknownRecord | undefined {
  if (!isRecord(observation) || !isRecord(observation.readModel)) return undefined;
  return observation.readModel;
}

/**
 * Validates every server-side binding that distinguishes a V3 room from a
 * historical authoritative room. The complete runtime manifest comparison
 * covers the frozen Rules, Geometry, Event and Delivery refs; Module and
 * Planner are pinned separately by their own registries.
 */
export function validateV3RoomBinding(input: Readonly<{
  binding: PersistedRoomKpBinding | undefined;
  roomProfile: AuthoritativeKpProfile | undefined;
  requestedProfile?: AuthoritativeKpProfile;
  expectedModuleRef?: AuthoritativeModuleRef;
  observation?: unknown;
}>): V3RoomBindingValidation {
  const roomV3 = input.roomProfile !== undefined
    && isV3AuthoritativeKpProfile(input.roomProfile);
  const claimsV3 = claimsV3RoomBinding(input);
  if (!claimsV3) return { kind: "historical" };

  if (
    input.binding === undefined
    || input.roomProfile === undefined
    || !roomV3
    || input.binding.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
    || input.roomProfile.modelId !== input.binding.kp_model
    || input.roomProfile.modelProfileVersion !== input.binding.kp_model_profile
    || (
      input.requestedProfile !== undefined
      && (
        input.requestedProfile.modelId !== input.binding.kp_model
        || input.requestedProfile.modelProfileVersion !== input.binding.kp_model_profile
      )
    )
  ) {
    return { kind: "invalid", violation: "modelProfile" };
  }
  if (!hasExactV3KpWorkflowManifest(input.binding.kp_workflow_manifest)) {
    return { kind: "invalid", violation: "workflow" };
  }
  const socialGeneration = input.binding.kp_workflow_manifest === V5_KP_WORKFLOW_MANIFEST_JSON;
  if (!hasExactV3KpGenerationBinding(
    input.roomProfile,
    input.binding.kp_workflow_manifest,
  )) {
    return { kind: "invalid", violation: "modelProfile" };
  }
  const expectedRuntimeManifest = runtimeManifestForExactV3KpWorkflow(
    input.binding.kp_workflow_manifest,
  );
  if (input.binding.kp_context_planner_profile !== DISABLED_CONTEXT_PLANNER_PROFILE_REF) {
    return { kind: "invalid", violation: "planner" };
  }

  const readModel = projectedReadModel(input.observation);
  if (expectedRuntimeManifest === undefined
    || !exactJson(readModel?.runtimeProfiles, expectedRuntimeManifest)) {
    return { kind: "invalid", violation: "runtimeManifest" };
  }
  if (
    input.expectedModuleRef === undefined
    || !isRecord(readModel?.campaign)
    || !exactJson(readModel.campaign.moduleRef, input.expectedModuleRef)
  ) {
    return { kind: "invalid", violation: "module" };
  }
  const socialModuleRef = pinnedModuleRef(
    input.binding.module_id,
    SOCIAL_RESOLUTION_MODULE_VERSION,
  );
  const hasSocialModule = socialModuleRef !== undefined
    && exactJson(input.expectedModuleRef, socialModuleRef);
  if (socialGeneration !== hasSocialModule) {
    return { kind: "invalid", violation: "module" };
  }
  return { kind: "valid" };
}
