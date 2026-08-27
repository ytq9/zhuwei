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
  if (policy === undefined || policy.startsWith("visibility:public")) return true;
  if (policy === "visibility:scene-observers") return true;
  if (
    policy === `visibility:character-controller:${viewerCharacterId}`
    || policy === `visibility:knowledge-holder:${viewerCharacterId}`
    || policy === `visibility:npc:${viewerCharacterId}`
  ) return true;
  if (policy !== "visibility:hidden-until-evidence") return false;

  return isNonEmptyString(record.visibilityFactId)
    && record.visibilityFactId in (state.knowledge[viewerCharacterId] ?? {});
}
