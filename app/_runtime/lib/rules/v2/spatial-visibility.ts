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

/** SPEC 0004 §4 (ADR 0097): a hidden creature's own record, on its combat
 * entity's conditions: the Stealth total it rolled when it hid. Anything else
 * is not a hidden record. */
export type HiddenCondition = Readonly<{ stealthTotal: string }>;

export function hiddenCondition(conditions: unknown): HiddenCondition | undefined {
  const hidden = isRecord(conditions) ? conditions.hidden : undefined;
  return isRecord(hidden) && hasExactKeys(hidden, ["stealthTotal"])
    && typeof hidden.stealthTotal === "string" && /^-?(0|[1-9][0-9]*)$/.test(hidden.stealthTotal) && hidden.stealthTotal !== "-0"
    ? hidden as HiddenCondition : undefined;
}

/** SPEC 0004 §4 (ADR 0097): players hide from NPCs and NPCs from players, so
 * two characters are each other's opponents when one is a player character
 * and the other an NPC. A creature's own side always sees it. */
export function hidingOpponents(state: AuthoritativeWorldState, leftId: string, rightId: string): boolean {
  const left = state.entities[leftId]?.kind, right = state.entities[rightId]?.kind;
  return left !== undefined && right !== undefined && left !== right;
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
  // SPEC 0004 §4 (ADR 0097): a hidden creature's opponents do not see it.
  if (recordId !== undefined && hiddenCondition(record.conditions) !== undefined
    && hidingOpponents(state, recordId, viewerCharacterId)) return false;

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
