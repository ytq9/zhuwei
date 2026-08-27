import { canonicalSha256 } from "../profiles/canonical";
import type {
  CharacterControlRecord,
  CharacterRecord,
  MultiplayerRuntimeState,
  PrincipalRecord,
  RoomMemberRecord,
  SceneRecord,
  SeatRecord,
} from "./model";

type PrincipalSeed = PrincipalRecord & { role?: RoomMemberRecord["role"] };

export function fictionTimelineIdForScene(branchId: string, sceneId: string): string {
  return `timeline:${branchId}:${sceneId}`;
}

export function initialMultiplayerFictionTimelines(
  activeBranchId: string,
  entities: Record<string, CharacterRecord>,
  nowMicros: string,
): Record<string, { branchId: string; nowMicros: string }> {
  const timelines: Record<string, { branchId: string; nowMicros: string }> = {
    [activeBranchId]: { branchId: activeBranchId, nowMicros },
  };
  const sceneIds = [...new Set(Object.values(entities).map(({ sceneId }) => sceneId))].sort();
  const primarySceneId = Object.values(entities)
    .sort((left, right) => BigInt(left.entityOrdinal) < BigInt(right.entityOrdinal) ? -1 : 1)[0]?.sceneId
    ?? sceneIds[0];
  for (const sceneId of sceneIds.filter((id) => id !== primarySceneId)) {
    timelines[fictionTimelineIdForScene(activeBranchId, sceneId)] = {
      branchId: activeBranchId,
      nowMicros,
    };
  }
  return timelines;
}

export function emptyMultiplayerRuntime(
  roomId: string,
  runtimeEpochId: string,
  principals: Record<string, PrincipalSeed>,
  seats: Record<string, SeatRecord>,
  entities: Record<string, CharacterRecord>,
  controls: Record<string, CharacterControlRecord>,
  activeBranchId: string,
  scenes: Record<string, SceneRecord>,
  initialFictionInstantMicros: string,
): MultiplayerRuntimeState {
  const principalIds = Object.keys(principals).sort();
  const declaredHost = principalIds.find((principalId) => principals[principalId].role === "host");
  const hostPrincipalId = declaredHost ?? principalIds[0] ?? "principal:unassigned-host";
  const members = Object.fromEntries(principalIds.map((principalId) => [principalId, {
    principalId,
    role: principalId === hostPrincipalId
      ? "host"
      : principals[principalId].role ?? "player",
    status: "active" as const,
  }]));
  const characterTimelineIds: Record<string, string> = {};
  const causalFrontiers: Record<string, Record<string, unknown>> = {};
  const primarySceneId = Object.values(entities)
    .sort((left, right) => BigInt(left.entityOrdinal) < BigInt(right.entityOrdinal) ? -1 : 1)[0]?.sceneId
    ?? Object.keys(scenes).sort()[0]
    ?? "scene:unknown";
  for (const character of Object.values(entities).sort((left, right) => left.id.localeCompare(right.id))) {
    const timelineId = character.sceneId === primarySceneId
      ? activeBranchId
      : fictionTimelineIdForScene(activeBranchId, character.sceneId);
    characterTimelineIds[character.id] = timelineId;
    causalFrontiers[timelineId] ??= {
      timelineId,
      sceneId: character.sceneId,
      branchId: activeBranchId,
      nowMicros: initialFictionInstantMicros,
      eventHeadId: null,
      causalParentTimelineIds: [],
    };
  }
  causalFrontiers[activeBranchId] ??= {
    timelineId: activeBranchId,
    sceneId: primarySceneId,
    branchId: activeBranchId,
    nowMicros: initialFictionInstantMicros,
    eventHeadId: null,
  };
  const spotlightLedger = Object.fromEntries(
    Object.keys(controls).sort().map((characterId) => [characterId, {
      characterId,
      seatId: controls[characterId].seatId,
      decisionBeats: "0",
      invited: false,
      lastInvitedBeat: null,
      explicitSkips: "0",
    }]),
  );
  return {
    roomAdministrationCapability: canonicalSha256({
      kind: "roomAdministration",
      roomId,
      runtimeEpochId,
    }),
    members,
    hostPrincipalId,
    safetyPresentations: {},
    suspendedPendingInputs: {},
    partyGroups: {},
    partyInvitations: {},
    partyMoveProposals: {},
    characterTimelineIds,
    causalFrontiers,
    spotlightLedger,
  };
}

export function isMultiplayerRuntime(value: unknown): value is MultiplayerRuntimeState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const runtime = value as Record<string, unknown>;
  const expected = [
    "causalFrontiers",
    "characterTimelineIds",
    "hostPrincipalId",
    "members",
    "partyGroups",
    "partyInvitations",
    "partyMoveProposals",
    "roomAdministrationCapability",
    "safetyPresentations",
    "spotlightLedger",
    "suspendedPendingInputs",
  ].sort();
  const actual = Object.keys(runtime).sort();
  const safetyPresentations = runtime.safetyPresentations;
  const safetyPresentationValid = safetyPresentations !== null
    && typeof safetyPresentations === "object"
    && !Array.isArray(safetyPresentations)
    && Object.entries(safetyPresentations).every(([principalId, entry]) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return keys.length === 3
      && keys[0] === "presentationAdjustment"
      && keys[1] === "requesterPrincipalId"
      && keys[2] === "status"
      && record.requesterPrincipalId === principalId
      && (record.status === "paused" || record.status === "resumed")
      && (record.presentationAdjustment === null
        || record.presentationAdjustment === "fadeToBlack"
        || record.presentationAdjustment === "reduceDetail"
        || record.presentationAdjustment === "skipSensitiveContent");
    });
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    && typeof runtime.roomAdministrationCapability === "string"
    && /^sha256:[0-9a-f]{64}$/.test(runtime.roomAdministrationCapability)
    && typeof runtime.hostPrincipalId === "string"
    && runtime.hostPrincipalId.length > 0
    && [
      runtime.members,
      runtime.safetyPresentations,
      runtime.suspendedPendingInputs,
      runtime.partyGroups,
      runtime.partyInvitations,
      runtime.partyMoveProposals,
      runtime.characterTimelineIds,
      runtime.causalFrontiers,
      runtime.spotlightLedger,
    ].every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))
    && safetyPresentationValid;
}
