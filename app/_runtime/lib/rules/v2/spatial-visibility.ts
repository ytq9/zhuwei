import type {
  AuthoritativeWorldState,
  JsonRecord,
  KpViewer,
} from "./model";
import {
  hasExactKeys,
  isNonEmptyString,
  isRecord,
} from "./validation";

export const KP_SPATIAL_EVIDENCE_CAPABILITY = "internal:kp-spatial-evidence" as const;

export type SpatialVisibilityPolicyKind =
  | "public"
  | "sceneObservers"
  | "viewerScoped"
  | "hiddenUntilEvidence";

/**
 * Classifies the complete policy vocabulary understood by the spatial
 * projector. Callers that persist a new spatially addressable record use the
 * same classifier so an unknown policy cannot create an authority object that
 * no canonical Viewer path can ever interpret.
 */
export function spatialVisibilityPolicyKind(
  value: unknown,
): SpatialVisibilityPolicyKind | undefined {
  if (!isNonEmptyString(value)) return undefined;
  if (value === "visibility:public" || value.startsWith("visibility:public:")) {
    return "public";
  }
  if (value === "visibility:scene-observers") return "sceneObservers";
  if (value === "visibility:hidden-until-evidence") return "hiddenUntilEvidence";
  if ([
    "visibility:character-controller:",
    "visibility:knowledge-holder:",
    "visibility:npc:",
  ].some((prefix) => value.startsWith(prefix) && value.length > prefix.length)) {
    return "viewerScoped";
  }
  return undefined;
}

export function isKpSpatialViewer(value: unknown): value is KpViewer {
  return isRecord(value)
    && hasExactKeys(value, ["capability", "kind"])
    && value.kind === "kp"
    && value.capability === KP_SPATIAL_EVIDENCE_CAPABILITY;
}

/** One policy interpreter shared by target legality and observer projection. */
export function spatialRecordVisibleTo(
  state: AuthoritativeWorldState,
  record: JsonRecord,
  viewerCharacterId: string,
): boolean {
  const recordId = isNonEmptyString(record.id)
    ? record.id
    : isNonEmptyString(record.entityId)
      ? record.entityId
      : undefined;
  if (recordId === viewerCharacterId) return true;

  const policy = isNonEmptyString(record.visibilityPolicyId)
    ? record.visibilityPolicyId
    : undefined;
  const policyKind = spatialVisibilityPolicyKind(policy);
  if (policy === undefined || policyKind === "public") return true;
  if (policyKind === "sceneObservers") return true;
  if (
    policy === `visibility:character-controller:${viewerCharacterId}`
    || policy === `visibility:knowledge-holder:${viewerCharacterId}`
    || policy === `visibility:npc:${viewerCharacterId}`
  ) return true;
  if (policyKind !== "hiddenUntilEvidence") return false;

  return isNonEmptyString(record.visibilityFactId)
    && record.visibilityFactId in (state.knowledge[viewerCharacterId] ?? {});
}
