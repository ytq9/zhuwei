import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { BACKGROUNDS, CLASS_KITS, SPELLS, classById, raceById } from "../dnd/catalog";
import { compileSheet, pointsSpent, POINT_BUY_CAP } from "../dnd/compute";
import { ABILITIES, SKILLS, type DraftSheet } from "../dnd/types";
import { DISABLED_CONTEXT_PLANNER_PROFILE_REF } from "../kp/model-registry";
import { SOCIAL_RESOLUTION_MODULE_VERSION } from "../module/authoritative";
import { pinnedModuleRef } from "../module/registry";
import { AUTHORITATIVE_RULESET_VERSION } from "../rules/ruleset";
import { canonicalSha256 } from "../rules/profiles/canonical";
import { buildAuthoritativeCharacterSeed } from "../table/authoritative";
import { roomCode } from "../utils";
import { trustedRoomPrincipal } from "./server";
import { roomRuntimeConfiguration } from "./runtime-configuration";
import type { PersistedRoomKpBinding } from "./v3-binding";
import type {
  CreateHistoricalRoomInput, CreateHistoricalRoomResult, ExportStoryHistoryPageInput,
  InitializeHistoricalAuthoritativeResult, ListHistoricalStartsInput,
  StoryHistoricalStartsResult, StoryHistoryApiFailure, StoryHistoryRpc, StoryViewerPageResult,
} from "./story-history-api-types";
import { storyHistoricalTargetRoomId, storyRoomIdentityIds } from "./story-history-identity";

type Invocation = { data: unknown; userId: string };
type SourceRoom = PersistedRoomKpBinding & {
  id: string; title: string; status: string; runtime_epoch_id: string | null;
};
type Initialized = Extract<InitializeHistoricalAuthoritativeResult, { kind: "initialized" }>;
type PublishedRoom = {
  code: string; host_user_id: string; runtime_epoch_id: string; genesis_hash: string;
  module_id: string; ruleset_version: string; kp_model: string; kp_model_profile: string;
  kp_workflow_manifest: string; kp_context_planner_profile: string;
};

const publicCodes = new Set([
  "STORY_HISTORY_REQUEST_INVALID", "STORY_HISTORY_SOURCE_UNAVAILABLE",
  "STORY_HISTORY_ARCHIVE_INVALID", "STORY_HISTORY_PROFILE_UNSUPPORTED",
  "STORY_HISTORY_MATERIALS_MISSING", "STORY_HISTORY_BINDING_INVALID",
  "STORY_HISTORY_CUT_UNSUPPORTED", "STORY_HISTORY_TIME_UNRESOLVED",
  "STORY_HISTORY_IDENTITY_UNSUPPORTED", "STORY_HISTORY_IDENTITY_CONFLICT",
  "STORY_HISTORY_UNAVAILABLE", "STORY_HISTORY_REQUEST_CONFLICT",
  "STORY_HISTORY_CHARACTER_INVALID", "STORY_HISTORY_PUBLICATION_PENDING",
]);
const rejected = (code: string): StoryHistoryApiFailure => ({ kind: "rejected", code });
const retryable = (code = "STORY_HISTORY_UNAVAILABLE"): StoryHistoryApiFailure => ({ kind: "retryableFailure", code });
function publicFailure(value: StoryHistoryApiFailure): StoryHistoryApiFailure {
  return { kind: value.kind, code: publicCodes.has(value.code) ? value.code : "STORY_HISTORY_UNAVAILABLE" };
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}
function string(value: unknown, max: number, empty = false): value is string {
  return typeof value === "string" && value.length <= max && (empty || value.trim().length > 0);
}
function cursor(value: unknown): value is string | null {
  return value === null || string(value, 16_384);
}
function roomInput(value: unknown): value is Record<string, unknown> & { code: string } {
  return record(value) && string(value.code, 32) && /^[A-Z0-9]+$/u.test(value.code.trim().toUpperCase());
}
function exportInput(value: unknown): value is ExportStoryHistoryPageInput {
  return roomInput(value) && exactKeys(value, ["code", "cursor", "characterId"])
    && cursor(value.cursor) && (value.characterId === undefined || string(value.characterId, 512));
}
function startsInput(value: unknown): value is ListHistoricalStartsInput {
  return roomInput(value) && exactKeys(value, ["code", "cursor"]) && cursor(value.cursor);
}

/** Validate the ordinary wizard's transport and catalog choices before its
 * compiler (which otherwise has fallback choices). Rules still owns builds. */
function draftInput(value: unknown): value is DraftSheet {
  if (!record(value) || !exactKeys(value, ["name", "raceId", "classId", "subclassId", "backgroundId",
    "scores", "extraSkillIds", "cantrips", "prepared", "spellbook", "equipmentChoice",
    "appearance", "trait", "ideal", "bond", "flaw"])) return false;
  if (!string(value.name, 120) || !string(value.raceId, 100) || !string(value.classId, 100)
    || !string(value.subclassId, 100, true) || !string(value.backgroundId, 100)
    || !["appearance", "trait", "ideal", "bond", "flaw"].every(key => string(value[key], 4_000, true))) return false;
  const cls = classById(value.classId);
  if (!cls || !raceById(value.raceId) || !BACKGROUNDS.some(item => item.id === value.backgroundId)
    || !(cls.subclasses.length === 0 && value.subclassId === "")
      && !cls.subclasses.some(item => item.id === value.subclassId)) return false;
  if (!record(value.scores) || !exactKeys(value.scores, ABILITIES)
    || !ABILITIES.every(key => Number.isInteger((value.scores as Record<string, unknown>)[key])
      && Number((value.scores as Record<string, unknown>)[key]) >= 8
      && Number((value.scores as Record<string, unknown>)[key]) <= 15)
    || pointsSpent(value.scores as DraftSheet["scores"]) > POINT_BUY_CAP) return false;
  if (!Number.isInteger(value.equipmentChoice) || Number(value.equipmentChoice) < 0
    || Number(value.equipmentChoice) >= (CLASS_KITS[cls.id]?.length ?? 1)) return false;
  for (const key of ["extraSkillIds", "cantrips", "prepared", "spellbook"]) {
    const entries = value[key];
    if (!Array.isArray(entries) || entries.length > 100 || new Set(entries).size !== entries.length
      || !entries.every(entry => string(entry, 100) && (key === "extraSkillIds"
        ? SKILLS.some(skill => skill.id === entry) : SPELLS.some(spell => spell.id === entry)))) return false;
  }
  return true;
}
function creationInput(value: unknown): value is CreateHistoricalRoomInput {
  return roomInput(value) && exactKeys(value, ["code", "submissionId", "startToken", "nickname", "draft"])
    && string(value.submissionId, 200) && /^[A-Za-z0-9:_-]+$/u.test(value.submissionId)
    && string(value.startToken, 16_384) && string(value.nickname, 16) && draftInput(value.draft);
}

/** The Room remains the authority. This adapter publishes its successful
 * initialization to the existing directory using a single D1 transaction. */
export function createStoryHistoryServer(deps: {
  database(): D1Database;
  room(roomId: string): StoryHistoryRpc;
  newRoomCode(): string;
}) {
  async function sourceRoom(db: D1Database, code: string, userId: string): Promise<SourceRoom | null> {
    if (!userId) return null;
    return db.prepare(`SELECT r.id, r.title, r.status, r.runtime_epoch_id,
      r.ruleset_version, r.module_id, r.host_user_id, r.kp_model, r.kp_model_profile,
      r.kp_workflow_manifest, r.kp_context_planner_profile FROM rooms r
      INNER JOIN room_members m ON m.room_id = r.id AND m.user_id = ?
      WHERE r.code = ? AND r.status = 'play'`)
      .bind(userId, code.trim().toUpperCase()).first<SourceRoom>();
  }
  async function exported({ data, userId }: Invocation): Promise<StoryViewerPageResult> {
    if (!exportInput(data)) return rejected("STORY_HISTORY_REQUEST_INVALID");
    try {
      const source = await sourceRoom(deps.database(), data.code, userId);
      if (!source) return rejected("STORY_HISTORY_SOURCE_UNAVAILABLE");
      const result = await deps.room(source.id).readStoryViewerPage(trustedRoomPrincipal(userId), {
        cursor: data.cursor, ...(data.characterId === undefined ? {} : { characterId: data.characterId }),
      });
      if (result.kind !== "exported") return publicFailure(result);
      const value = result.export;
      if (value.format !== "zhuwei.story-viewer-export/v1" || value.source.roomId !== source.id) {
        return rejected("STORY_HISTORY_BINDING_INVALID");
      }
      // Only the declared Viewer DTO crosses HTTP, never a sibling system archive.
      return { kind: "exported", export: {
        format: value.format, source: { roomId: value.source.roomId, runtimeEpochId: value.source.runtimeEpochId,
          archiveHash: value.source.archiveHash, branchId: value.source.branchId },
        characterId: value.characterId, readModel: value.readModel, projectionHash: value.projectionHash,
        transcript: value.transcript, nextCursor: value.nextCursor, contentHash: value.contentHash,
      } };
    } catch { return retryable(); }
  }
  async function listed({ data, userId }: Invocation): Promise<StoryHistoricalStartsResult> {
    if (!startsInput(data)) return rejected("STORY_HISTORY_REQUEST_INVALID");
    try {
      const source = await sourceRoom(deps.database(), data.code, userId);
      if (!source) return rejected("STORY_HISTORY_SOURCE_UNAVAILABLE");
      const result = await deps.room(source.id).listStoryHistoricalStarts(trustedRoomPrincipal(userId), { cursor: data.cursor });
      if (result.kind !== "listed") return publicFailure(result);
      return { kind: "listed", starts: result.starts.map(start => ({ startToken: start.startToken,
        label: start.label, sceneName: start.sceneName, fictionTimeLabel: start.fictionTimeLabel })), nextCursor: result.nextCursor };
    } catch { return retryable(); }
  }

  async function published(db: D1Database, targetId: string): Promise<PublishedRoom | null> {
    return db.prepare(`SELECT code, host_user_id, runtime_epoch_id, genesis_hash, module_id,
      ruleset_version, kp_model, kp_model_profile, kp_workflow_manifest, kp_context_planner_profile
      FROM rooms WHERE id = ?`).bind(targetId).first<PublishedRoom>();
  }
  function publicationMatches(row: PublishedRoom, initialized: Initialized, source: SourceRoom, userId: string) {
    return row.host_user_id === userId && row.runtime_epoch_id === initialized.runtimeEpochId
      && row.genesis_hash === initialized.genesisHash
      && ["module_id", "ruleset_version", "kp_model", "kp_model_profile", "kp_workflow_manifest", "kp_context_planner_profile"]
        .every(key => row[key as keyof PublishedRoom] === source[key as keyof SourceRoom]);
  }
  async function publish(db: D1Database, data: CreateHistoricalRoomInput, userId: string,
    source: SourceRoom, initialized: Initialized, sheetJson: string): Promise<CreateHistoricalRoomResult> {
    const existing = await published(db, initialized.roomId);
    if (existing) return publicationMatches(existing, initialized, source, userId)
      ? { kind: "created", code: existing.code } : rejected("STORY_HISTORY_REQUEST_CONFLICT");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = deps.newRoomCode();
      try {
        await db.batch([
          db.prepare(`INSERT INTO rooms (id, code, host_user_id, title, module_id, ruleset_version,
            kp_model, kp_model_profile, kp_workflow_manifest, kp_context_planner_profile,
            runtime_epoch_id, genesis_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'play')`)
            .bind(initialized.roomId, code, userId, `${source.title} · 新的篇章`.slice(0, 160), source.module_id,
              source.ruleset_version, source.kp_model, source.kp_model_profile, source.kp_workflow_manifest,
              source.kp_context_planner_profile, initialized.runtimeEpochId, initialized.genesisHash),
          db.prepare("INSERT INTO room_members (room_id, user_id, nickname, is_host, seated) VALUES (?, ?, ?, 1, 1)")
            .bind(initialized.roomId, userId, data.nickname.trim()),
          db.prepare("INSERT INTO characters (id, room_id, user_id, sheet, locked) VALUES (?, ?, ?, ?, 1)")
            .bind(initialized.characterId, initialized.roomId, userId, sheetJson),
        ]);
        return { kind: "created", code };
      } catch {
        // A concurrent retry may have published the same Room. A room-code
        // collision is the only failure that warrants choosing another code.
        const recovered = await published(db, initialized.roomId);
        if (recovered) return publicationMatches(recovered, initialized, source, userId)
          ? { kind: "created", code: recovered.code } : rejected("STORY_HISTORY_REQUEST_CONFLICT");
        const collision = await db.prepare("SELECT id FROM rooms WHERE code = ?").bind(code).first<{ id: string }>();
        if (!collision) return retryable("STORY_HISTORY_PUBLICATION_PENDING");
      }
    }
    return retryable("STORY_HISTORY_PUBLICATION_PENDING");
  }

  async function created({ data, userId }: Invocation): Promise<CreateHistoricalRoomResult> {
    if (!creationInput(data)) return rejected("STORY_HISTORY_REQUEST_INVALID");
    let initialized = false;
    try {
      const db = deps.database();
      const source = await sourceRoom(db, data.code, userId);
      if (!source) return rejected("STORY_HISTORY_SOURCE_UNAVAILABLE");
      const configuration = roomRuntimeConfiguration();
      const profile = configuration.profileByBinding(source.kp_model, source.kp_model_profile);
      const runtimeProfiles = configuration.runtimeManifestForWorkflow(source.kp_workflow_manifest);
      const moduleRef = pinnedModuleRef(source.module_id, SOCIAL_RESOLUTION_MODULE_VERSION);
      if (!profile || !runtimeProfiles || !moduleRef || source.ruleset_version !== AUTHORITATIVE_RULESET_VERSION
        || !configuration.hasGenerationBinding(profile, source.kp_workflow_manifest)
        || source.kp_context_planner_profile !== DISABLED_CONTEXT_PLANNER_PROFILE_REF) {
        return rejected("STORY_HISTORY_BINDING_INVALID");
      }
      const targetRoomId = storyHistoricalTargetRoomId(userId, data.submissionId);
      const identity = storyRoomIdentityIds(targetRoomId, userId);
      const sheet = compileSheet(data.draft);
      const character = buildAuthoritativeCharacterSeed({ characterId: identity.characterId,
        controllerPrincipalId: userId, sheet, runtimeProfiles,
        sceneId: "scene:historical-origin-pending" });
      const requestHash = canonicalSha256({ domain: "zhuwei.story-history-publication-request/v1",
        principalId: userId, targetRoomId, submissionId: data.submissionId,
        source: { roomId: source.id, startToken: data.startToken },
        nickname: data.nickname.trim(), draft: data.draft, character,
        binding: { rulesetVersion: source.ruleset_version, moduleRef, runtimeProfiles,
          modelId: source.kp_model, modelProfile: source.kp_model_profile,
          workflow: source.kp_workflow_manifest, planner: source.kp_context_planner_profile } });
      const result = await deps.room(targetRoomId).initializeHistoricalAuthoritative(trustedRoomPrincipal(userId), {
        targetRoomId, submissionId: data.submissionId, requestHash,
        source: { roomId: source.id, startToken: data.startToken }, character,
      });
      if (result.kind !== "initialized") return publicFailure(result);
      initialized = true;
      if (result.roomId !== targetRoomId || result.requestHash !== requestHash
        || result.characterId !== identity.characterId || result.seatId !== identity.seatId
        || !string(result.runtimeEpochId, 512) || result.runtimeEpochId === source.runtime_epoch_id
        || !/^sha256:[0-9a-f]{64}$/u.test(result.genesisHash)
        || canonicalSha256(result.moduleRef) !== canonicalSha256(moduleRef)
        || canonicalSha256(result.runtimeProfiles) !== canonicalSha256(runtimeProfiles)) {
        return rejected("STORY_HISTORY_BINDING_INVALID");
      }
      return await publish(db, data, userId, source, result, JSON.stringify(sheet));
    } catch { return retryable(initialized ? "STORY_HISTORY_PUBLICATION_PENDING" : "STORY_HISTORY_UNAVAILABLE"); }
  }
  return { exportStoryHistoryPage: exported, listHistoricalStarts: listed, createHistoricalRoom: created };
}

export const { exportStoryHistoryPage, listHistoricalStarts, createHistoricalRoom } = createStoryHistoryServer({
  database: getD1,
  room: roomId => env.ROOMS.getByName(roomId) as unknown as StoryHistoryRpc,
  newRoomCode: roomCode,
});
