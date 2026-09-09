import type { AuthoritativeWorldState } from "../../rules";
import { archiveSha256, validateAuthoritativeArchive } from "../archive";
import type { ExperiencedTranscriptMessage } from "../authority-types";
import type {
  StoryBranchSeed, StoryExportRequest, StoryExportResult, StoryHistoricalBranchRequest,
  StoryHistoricalBranchResult, StoryHistoricalVerification, StoryHistoryHost,
  StoryHistoryPreparation, StoryHistoryRejection, StoryHistorySourceMaterial,
  StorySystemExport, StorySystemExportRequest, StoryViewerExport,
} from "./contracts";
import { describeHistoricalCut, selectHistoricalSupplements } from "./historical-cut";
import {
  branchRequest, exact, exportRequest, hash, isRecord, rejected, sequence,
  text, uniqueStrings, validPreparation,
} from "./validation";

export type * from "./contracts";

const failures = new Set([
  "STORY_HISTORY_REQUEST_INVALID", "STORY_HISTORY_SOURCE_UNAVAILABLE",
  "STORY_HISTORY_ARCHIVE_INVALID", "STORY_HISTORY_PROFILE_UNSUPPORTED",
  "STORY_HISTORY_MATERIALS_MISSING", "STORY_HISTORY_BINDING_INVALID",
  "STORY_HISTORY_CUT_UNSUPPORTED", "STORY_HISTORY_TIME_UNRESOLVED",
  "STORY_HISTORY_IDENTITY_UNSUPPORTED", "STORY_HISTORY_IDENTITY_CONFLICT",
  "STORY_HISTORY_UNAVAILABLE",
]);
function hostRejection(value: unknown): StoryHistoryRejection | undefined {
  if (!isRecord(value) || value.kind !== "rejected") return undefined;
  return rejected(failures.has(String(value.code))
    ? value.code as StoryHistoryRejection["code"] : "STORY_HISTORY_UNAVAILABLE");
}

async function loadSource(
  request: StorySystemExportRequest | StoryHistoricalBranchRequest,
  host: StoryHistoryHost,
  purpose: "systemExport" | "historicalBranch",
  authorizationBindingHash: `sha256:${string}`,
): Promise<{
  kind: "loaded";
  material: StoryHistorySourceMaterial;
  state: AuthoritativeWorldState;
} | StoryHistoryRejection> {
  const response = await host.readSource({ request: structuredClone(request), purpose, authorizationBindingHash });
  const denial = hostRejection(response);
  if (denial) return denial;
  if (!exact(response, ["kind", "authorizationBindingHash", "value"])
    || response.kind !== "available" || response.authorizationBindingHash !== authorizationBindingHash
    || !exact(response.value, ["archive", "preparations", "requiredPreparationHashes"])) {
    return rejected("STORY_HISTORY_BINDING_INVALID");
  }
  const snapshot = structuredClone(response.value);
  const validation = await validateAuthoritativeArchive(snapshot.archive, host.replay);
  if (!validation.ok) return rejected(validation.code === "profileIntegrityMismatch"
    ? "STORY_HISTORY_PROFILE_UNSUPPORTED" : "STORY_HISTORY_ARCHIVE_INVALID");
  const { archive } = validation.value;
  if (archive.roomId !== request.source.roomId
    || archive.signedGenesis.runtimeEpochId !== request.source.runtimeEpochId
    || archive.archiveHash !== request.source.archiveHash
    || archive.head.activeBranchId !== request.source.branchId) {
    return rejected("STORY_HISTORY_BINDING_INVALID");
  }
  const preparations = snapshot.preparations;
  const required = snapshot.requiredPreparationHashes;
  if (!Array.isArray(preparations) || !uniqueStrings(required) || !required.every(hash)) {
    return rejected("STORY_HISTORY_MATERIALS_MISSING");
  }
  for (const preparation of preparations) {
    if (!await validPreparation(preparation, archive.head.eventSeq)) return rejected("STORY_HISTORY_MATERIALS_MISSING");
  }
  const typed = preparations as StoryHistoryPreparation[];
  const available = new Set(typed.map(preparation => preparation.preparationHash));
  if (available.size !== preparations.length || required.some(ref => !available.has(ref))) {
    return rejected("STORY_HISTORY_MATERIALS_MISSING");
  }
  return {
    kind: "loaded",
    material: { archive, preparations: structuredClone(typed), requiredPreparationHashes: [...required] },
    state: validation.value.state as AuthoritativeWorldState,
  };
}

function transcriptMessage(value: unknown): value is ExperiencedTranscriptMessage {
  return exact(value, ["ordinal", "messageId", "sceneIds", "kind", "speakerCharacterId", "speakerName", "body", "sourceEventSeq", "receiptId"])
    && typeof value.ordinal === "number" && Number.isSafeInteger(value.ordinal) && value.ordinal > 0
    && text(value.messageId) && uniqueStrings(value.sceneIds)
    && ["player", "kp"].includes(String(value.kind))
    && (value.speakerCharacterId === null || text(value.speakerCharacterId))
    && typeof value.speakerName === "string"
    && typeof value.body === "string" && sequence(value.sourceEventSeq)
    && text(value.receiptId);
}

/** The viewer path never reads the system archive or preparation store. Its
 * host callback must use the current trusted Viewer and retained transcript. */
export async function prepareExport(request: StoryExportRequest, host: StoryHistoryHost): Promise<StoryExportResult> {
  if (!exportRequest(request)) return rejected("STORY_HISTORY_REQUEST_INVALID");
  try {
    const frozen = structuredClone(request);
    const authorizationBindingHash = await archiveSha256({ purpose: frozen.kind === "viewer" ? "viewerExport" : "systemExport", request: frozen });
    if (frozen.kind === "viewer") {
      const response = await host.readViewerExport({ request: structuredClone(frozen), authorizationBindingHash });
      const denial = hostRejection(response);
      if (denial) return denial;
      if (!exact(response, ["kind", "authorizationBindingHash", "value"])
        || response.kind !== "available" || response.authorizationBindingHash !== authorizationBindingHash
        || !exact(response.value, ["readModel", "projectionHash", "transcript", "nextCursor"])
        || !isRecord(response.value.readModel) || !hash(response.value.projectionHash)
        || !Array.isArray(response.value.transcript) || !response.value.transcript.every(transcriptMessage)
        || !(response.value.nextCursor === null || text(response.value.nextCursor))) {
        return rejected("STORY_HISTORY_BINDING_INVALID");
      }
      const messages = response.value.transcript;
      if (new Set(messages.map(message => message.messageId)).size !== messages.length
        || messages.some((message, index) => index > 0 && message.ordinal <= messages[index - 1].ordinal)) {
        return rejected("STORY_HISTORY_BINDING_INVALID");
      }
      const unsigned: Omit<StoryViewerExport, "contentHash"> = {
        format: "zhuwei.story-viewer-export/v1", source: frozen.source, characterId: frozen.characterId,
        readModel: structuredClone(response.value.readModel) as StoryViewerExport["readModel"],
        projectionHash: response.value.projectionHash, transcript: structuredClone(messages),
        nextCursor: response.value.nextCursor,
      };
      return { kind: "viewerExportPrepared", record: { ...unsigned, contentHash: await archiveSha256(unsigned) } };
    }
    const loaded = await loadSource(frozen, host, "systemExport", authorizationBindingHash);
    if (loaded.kind === "rejected") return loaded;
    const unsigned: Omit<StorySystemExport, "contentHash"> = {
      format: "zhuwei.story-system-export/v1", audience: "trustedSystemOnly", source: frozen.source,
      archive: structuredClone(loaded.material.archive), preparations: structuredClone(loaded.material.preparations),
    };
    return { kind: "systemExportPrepared", record: { ...unsigned, contentHash: await archiveSha256(unsigned) } };
  } catch {
    return rejected("STORY_HISTORY_UNAVAILABLE");
  }
}

function verified(value: unknown, authorizationBindingHash: string, verificationHash: string): boolean {
  return exact(value, ["kind", "authorizationBindingHash", "verificationHash"])
    && value.kind === "verified" && value.authorizationBindingHash === authorizationBindingHash
    && value.verificationHash === verificationHash;
}

/** Prepare only. The Room entry point must revalidate this seed, initialize a
 * new room/epoch through Rules, and establish fresh control/delivery/budgets. */
export async function prepareHistoricalBranch(
  request: StoryHistoricalBranchRequest, host: StoryHistoryHost,
): Promise<StoryHistoricalBranchResult> {
  if (isRecord(request) && isRecord(request.identity) && request.identity.kind !== "newCharacter") {
    return rejected("STORY_HISTORY_IDENTITY_UNSUPPORTED");
  }
  if (!branchRequest(request)) return rejected("STORY_HISTORY_REQUEST_INVALID");
  try {
    const frozen = structuredClone(request);
    const authorizationBindingHash = await archiveSha256({ purpose: "historicalBranch", request: frozen });
    const loaded = await loadSource(frozen, host, "historicalBranch", authorizationBindingHash);
    if (loaded.kind === "rejected") return loaded;
    const { archive, preparations } = loaded.material;
    if (BigInt(frozen.cut.eventSeq) > BigInt(archive.head.eventSeq)) return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
    const prefixLength = Number(BigInt(frozen.cut.eventSeq));
    const prefixEvents = archive.events.slice(0, prefixLength);
    const prefix = host.replay(archive.signedGenesis, prefixEvents);
    if (prefix.kind !== "replayed") return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
    const cutState = prefix.state as AuthoritativeWorldState;
    if (cutState.activeBranchId !== archive.head.activeBranchId) return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
    // No root may be cut between its committed steps or later continuation.
    const prefixRoots = new Set(prefixEvents.map(event => event.rootActionId));
    if (archive.events.slice(prefixLength).some(event => prefixRoots.has(event.rootActionId))) {
      return rejected("STORY_HISTORY_CUT_UNSUPPORTED");
    }
    const cut = await describeHistoricalCut(cutState, prefix.head, frozen.cut.focusSceneId);
    if ("kind" in cut) return cut;
    if (cutState.entities[frozen.identity.characterId]) return rejected("STORY_HISTORY_IDENTITY_CONFLICT");
    if (frozen.identity.sceneId !== frozen.cut.focusSceneId || !cutState.scenes[frozen.identity.sceneId]) {
      return rejected("STORY_HISTORY_IDENTITY_UNSUPPORTED");
    }
    const selected = selectHistoricalSupplements({
      preparations, events: archive.events, sourceState: loaded.state, cutState, cutEventSeq: cut.eventSeq,
    });
    if (selected.kind === "rejected") return selected;
    const value: StoryHistoricalVerification = {
      request: frozen, sourceArchive: archive, sourceState: loaded.state, cut, cutState,
      lateFacts: selected.lateFacts,
      preparations: preparations.filter(material => BigInt(material.recordedAtEventSeq) <= BigInt(cut.eventSeq)),
    };
    const contentHash = await archiveSha256(value);
    const cutVerificationHash = await archiveSha256({ purpose: "historicalCut", contentHash });
    const identityVerificationHash = await archiveSha256({ purpose: "newIdentity", contentHash });
    const cutValidation = await host.validateHistoricalCut({ value: structuredClone(value), authorizationBindingHash, verificationHash: cutVerificationHash });
    const cutDenial = hostRejection(cutValidation);
    if (cutDenial) return cutDenial;
    if (!verified(cutValidation, authorizationBindingHash, cutVerificationHash)) return rejected("STORY_HISTORY_BINDING_INVALID");
    const identityValidation = await host.validateNewIdentity({ value: structuredClone(value), authorizationBindingHash, verificationHash: identityVerificationHash });
    const identityDenial = hostRejection(identityValidation);
    if (identityDenial) return identityDenial;
    if (!verified(identityValidation, authorizationBindingHash, identityVerificationHash)) return rejected("STORY_HISTORY_BINDING_INVALID");
    // Mutating an object supplied to a host never changes the frozen seed.
    if (await archiveSha256(value) !== contentHash) return rejected("STORY_HISTORY_BINDING_INVALID");
    const unsigned: Omit<StoryBranchSeed, "seedHash"> = {
      format: "zhuwei.story-branch-seed/v1", audience: "trustedSystemOnly", source: frozen.source,
      sourceHead: structuredClone(archive.head), profiles: structuredClone(archive.signedGenesis.profiles),
      moduleRef: structuredClone(archive.signedGenesis.moduleRef), sourceGenesis: structuredClone(archive.signedGenesis),
      prefixEvents: structuredClone(prefixEvents), cut, cutState: structuredClone(cutState),
      preparations: structuredClone(value.preparations), lateFacts: structuredClone(selected.lateFacts),
      identity: structuredClone(frozen.identity),
      verification: {
        authorizationBindingHash, cutVerificationHash, identityVerificationHash,
        lateFactsRequireSourceArchive: selected.lateFacts.length > 0,
      },
    };
    return { kind: "branchPrepared", seed: { ...unsigned, seedHash: await archiveSha256(unsigned) } };
  } catch {
    return rejected("STORY_HISTORY_UNAVAILABLE");
  }
}
