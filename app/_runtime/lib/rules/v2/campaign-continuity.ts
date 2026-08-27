import { canonicalSha256 } from "../profiles/canonical";
import type { Sha256Ref } from "../profiles/types";
import type { AuthoritativeWorldState } from "./model";
import { hasExactKeys, isNonEmptyString, isRecord, isSha256 } from "./validation";

type HashedRef = { ref: string; stateHash: Sha256Ref };

export type ChapterActivityTransition = {
  activityId: string;
  disposition: "continue" | "summarize" | "interrupt" | "complete";
};

export type CampaignContinuityManifestV1 = {
  schema: "zhuwei.campaign-continuity-manifest/v1";
  characterStates: HashedRef[];
  artifactStates: HashedRef[];
  knowledgeStates: HashedRef[];
  relationshipStates: HashedRef[];
  debtStates: HashedRef[];
  promiseStates: HashedRef[];
  activityStates: HashedRef[];
  canonicalFactStates: HashedRef[];
  definitionStates: HashedRef[];
  precedentStates: HashedRef[];
  combatEffectStates: HashedRef[];
  fictionTimelineStates: HashedRef[];
  causalFrontierStates: HashedRef[];
  unresolvedThreatRefs: string[];
  activityTransitions: ChapterActivityTransition[];
  manifestHash: Sha256Ref;
};

export type CampaignContinuityManifestV2 = Omit<
  CampaignContinuityManifestV1,
  "schema" | "manifestHash"
> & {
  schema: "zhuwei.campaign-continuity-manifest/v2";
  actorPlanStates: HashedRef[];
  factionPlanStates: HashedRef[];
  manifestHash: Sha256Ref;
};

export type CampaignContinuityManifest =
  | CampaignContinuityManifestV1
  | CampaignContinuityManifestV2;

function hashedRecords(prefix: string, records: Record<string, unknown>): HashedRef[] {
  return Object.keys(records).sort().map((id) => ({
    ref: `${prefix}:${id}`,
    stateHash: canonicalSha256(records[id]),
  }));
}

function hashedCausalFrontiers(state: AuthoritativeWorldState): HashedRef[] {
  return Object.keys(state.multiplayerRuntime.causalFrontiers).sort().map((timelineId) => {
    const frontier = state.multiplayerRuntime.causalFrontiers[timelineId];
    const { eventHeadId: _eventHeadId, ...causalPosition } = frontier;
    return {
      ref: `causal-frontier:${timelineId}`,
      stateHash: canonicalSha256(causalPosition),
    };
  });
}

function withoutManifestHash<T extends CampaignContinuityManifest>(manifest: T): Omit<T, "manifestHash"> {
  const { manifestHash: _manifestHash, ...core } = manifest;
  return core as Omit<T, "manifestHash">;
}

function legacyContinuityManifest(
  state: AuthoritativeWorldState,
  activityTransitions: ChapterActivityTransition[],
): CampaignContinuityManifestV1 {
  const knowledgeStates = Object.keys(state.knowledge).sort().flatMap((characterId) =>
    Object.keys(state.knowledge[characterId] ?? {}).sort().map((knowledgeRef) => ({
      ref: `knowledge:${characterId}:${knowledgeRef}`,
      stateHash: canonicalSha256(state.knowledge[characterId][knowledgeRef]),
    })));
  const characterStates = Object.keys(state.entities).sort().map((characterId) => ({
    ref: `character:${characterId}`,
    stateHash: canonicalSha256({
      character: state.entities[characterId],
      combatEntity: state.combatRuntime.entities[characterId] ?? null,
    }),
  }));
  const core = {
    schema: "zhuwei.campaign-continuity-manifest/v1" as const,
    characterStates,
    artifactStates: hashedRecords("artifact", state.campaignRuntime.artifacts),
    knowledgeStates,
    relationshipStates: hashedRecords("relationship", state.campaignRuntime.relationships),
    debtStates: hashedRecords("debt", state.campaignRuntime.debts),
    promiseStates: hashedRecords("promise", state.campaignRuntime.promises),
    activityStates: hashedRecords("activity", state.campaignRuntime.activities),
    canonicalFactStates: hashedRecords("fact", state.canonicalFacts),
    definitionStates: [
      ...hashedRecords("campaign-definition", state.campaignRuntime.definitions),
      ...hashedRecords("combat-definition", state.combatRuntime.definitions),
    ].sort((left, right) => left.ref.localeCompare(right.ref)),
    precedentStates: [
      ...hashedRecords("meaningful-failure", state.campaignRuntime.meaningfulFailures),
      ...hashedRecords("retry-change", state.campaignRuntime.retryChanges),
    ].sort((left, right) => left.ref.localeCompare(right.ref)),
    combatEffectStates: hashedRecords("combat-effect", state.combatRuntime.effects),
    fictionTimelineStates: hashedRecords("fiction-timeline", state.fictionTimelines),
    // Event heads advance while the atomic chapter transaction folds. The
    // logical scene/time frontier is the continuity-bearing value.
    causalFrontierStates: hashedCausalFrontiers(state),
    unresolvedThreatRefs: [...state.campaignRuntime.unresolvedThreats].sort(),
    activityTransitions: [...activityTransitions]
      .map((transition) => structuredClone(transition))
      .sort((left, right) => left.activityId.localeCompare(right.activityId)),
  };
  return { ...core, manifestHash: canonicalSha256(core) };
}

export function campaignContinuityManifest(
  state: AuthoritativeWorldState,
  activityTransitions: ChapterActivityTransition[],
): CampaignContinuityManifestV2 {
  const legacy = legacyContinuityManifest(state, activityTransitions);
  const { schema: _legacySchema, manifestHash: _legacyHash, ...legacyCore } = legacy;
  const core = {
    ...legacyCore,
    schema: "zhuwei.campaign-continuity-manifest/v2" as const,
    precedentStates: [
      ...legacy.precedentStates,
      ...hashedRecords(
        "adjudication-precedent",
        state.campaignRuntime.adjudicationPrecedents ?? {},
      ),
    ].sort((left, right) => left.ref.localeCompare(right.ref)),
    actorPlanStates: hashedRecords("actor-plan", state.campaignRuntime.npcPlans),
    factionPlanStates: hashedRecords("faction-plan", state.campaignRuntime.factionPlans),
  };
  return { ...core, manifestHash: canonicalSha256(core) };
}

/** Historical v1 chapter events remain replayable under their pinned profile. */
export function campaignContinuityManifestForSchema(
  state: AuthoritativeWorldState,
  activityTransitions: ChapterActivityTransition[],
  schema: CampaignContinuityManifest["schema"],
): CampaignContinuityManifest {
  return schema === "zhuwei.campaign-continuity-manifest/v1"
    ? legacyContinuityManifest(state, activityTransitions)
    : campaignContinuityManifest(state, activityTransitions);
}

function hashedRefs(value: unknown): value is HashedRef[] {
  return Array.isArray(value)
    && value.every((entry) => isRecord(entry)
      && hasExactKeys(entry, ["ref", "stateHash"])
      && isNonEmptyString(entry.ref)
      && isSha256(entry.stateHash));
}

export function isCampaignContinuityManifest(value: unknown): value is CampaignContinuityManifest {
  if (!isRecord(value)) return false;
  const v1Keys = [
    "activityStates",
    "activityTransitions",
    "artifactStates",
    "canonicalFactStates",
    "causalFrontierStates",
    "characterStates",
    "combatEffectStates",
    "debtStates",
    "definitionStates",
    "fictionTimelineStates",
    "knowledgeStates",
    "manifestHash",
    "precedentStates",
    "promiseStates",
    "relationshipStates",
    "schema",
    "unresolvedThreatRefs",
  ];
  const isV1 = value.schema === "zhuwei.campaign-continuity-manifest/v1";
  const isV2 = value.schema === "zhuwei.campaign-continuity-manifest/v2";
  if ((!isV1 && !isV2)
    || !hasExactKeys(value, isV1 ? v1Keys : [
      ...v1Keys,
      "actorPlanStates",
      "factionPlanStates",
    ])
    || !isSha256(value.manifestHash)
    || ![
      value.activityStates,
      value.artifactStates,
      value.canonicalFactStates,
      value.causalFrontierStates,
      value.characterStates,
      value.combatEffectStates,
      value.debtStates,
      value.definitionStates,
      value.fictionTimelineStates,
      value.knowledgeStates,
      value.precedentStates,
      value.promiseStates,
      value.relationshipStates,
      ...(isV2 ? [value.actorPlanStates, value.factionPlanStates] : []),
    ].every(hashedRefs)
    || !Array.isArray(value.unresolvedThreatRefs)
    || !value.unresolvedThreatRefs.every(isNonEmptyString)
    || !Array.isArray(value.activityTransitions)
    || !value.activityTransitions.every((transition) => isRecord(transition)
      && hasExactKeys(transition, ["activityId", "disposition"])
      && isNonEmptyString(transition.activityId)
      && ["continue", "summarize", "interrupt", "complete"].includes(String(transition.disposition)))) {
    return false;
  }
  const manifest = value as unknown as CampaignContinuityManifest;
  return canonicalSha256(withoutManifestHash(manifest)) === manifest.manifestHash;
}

export function continuityManifestsEqual(
  left: CampaignContinuityManifest,
  right: CampaignContinuityManifest,
): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}
