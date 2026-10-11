import type { KnowledgeCard } from "../lib/table/knowledge-notebook";
import { DiagnosticCopy } from "./diagnostic-copy";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Disclosure } from "@/components/ui/disclosure";
import { TacticalMap } from "@/components/tactical-map";
import { useTacticalMapActions } from "@/components/tactical-map-actions";
import { ActionList, TaskBar, TurnBar } from "@/components/table-actions";
import { playerEncounter } from "@/components/tactical-task";
import { InventoryPanel } from "@/components/inventory-panel";
import {
  CharacterPanel,
  CharacterVitalsStrip,
  characterResourcePools,
  characterVitalsOf,
  useCharacterPanelDocked,
  type CharacterPanelTab,
} from "@/components/character-panel";
import type { Ability, CharacterSheet, SkillId } from "@/lib/dnd/types";
import { ABILITIES, ABILITY_LABEL, SKILLS } from "@/lib/dnd/types";
import { classById, raceById, spellById } from "@/lib/dnd/catalog";
import { ensureGear, sheetProficiencies, skillBonus } from "@/lib/dnd/compute";
import type { TacticalProjection } from "@/lib/rules/tactical-projection";
import { abilityMod, cn, signed } from "@/lib/utils";
import { transcribeAudio, speakNarration } from "@/lib/voice/client";
import { resolveRoll, retryNarration, sendAction, restNow, cancelRest, controlActivity, inviteSquad, answerSquad, leaveSquadNow, passCaptain, leaveTable, cancelSquadInvite, kickMember } from "@/lib/table/client";
import {
  tableActionAccepted,
  type TableActionResponse,
} from "@/lib/table/authoritative-client";
import {
  arcaneRecoveryAvailability,
  changeArcaneRecoverySelection,
  publicNarrationRecoveryReason,
  type ArcaneRecoverySlotLevel,
  type AuthoritativeInventory,
  type CharacterCondition,
  type CombatControls,
  type NpcCombatTurnStatus,
} from "@/lib/table/authoritative";
import type { PendingRoll } from "@/lib/kp/pending-roll";
import type { KpModelId } from "@/lib/kp/models";
import type { ViewerNarrationRecovery } from "@/lib/room/authority-types";
import { narrationFailureCanRetry } from "@/lib/kp/public-failure-codes";
import { ensureResources, left, listStocks, type StockItem } from "@/lib/dnd/resources";
import { toast } from "sonner";
import {
  BookOpenText,
  CircleDot,
  LoaderCircle,
  MapPin,
  MapPinned,
  Mic,
  Send,
  Swords,
  UserRound,
  Users,
  X,
} from "lucide-react";

export type TableMessage = {
  id: string;
  receiptId?: string;
  submissionId?: string;
  user_id: string | null;
  kind: string;
  name: string;
  body: string;
  created_at: string;
  clues?: { id: string; name: string; hint: string }[];
};

type SendActionPayload = {
  code: string;
  text: string;
  submissionId: string;
  pendingInputId?: string;
  answer?: unknown;
};

type RecoverableSendAction = {
  source: "composer" | "pending";
  fingerprint: string;
  payload: SendActionPayload;
  recoveryMode: "transportUnknown" | "confirmedNotCommitted";
  localId?: string;
  failureMessage: string;
  committed?: true;
  lastError?: string;
};

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoredSendAction(
  storageKey: string,
  code: string,
): RecoverableSendAction | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!recordValue(parsed) || !recordValue(parsed.payload)) return null;
    const source = parsed.source;
    const fingerprint = parsed.fingerprint;
    const failureMessage = parsed.failureMessage;
    const payload = parsed.payload;
    if (
      (source !== "composer" && source !== "pending")
      || typeof fingerprint !== "string"
      || typeof failureMessage !== "string"
      || payload.code !== code
      || typeof payload.text !== "string"
      || typeof payload.submissionId !== "string"
      || (payload.pendingInputId !== undefined && typeof payload.pendingInputId !== "string")
    ) return null;
    return {
      source,
      fingerprint,
      failureMessage,
      recoveryMode: parsed.recoveryMode === "confirmedNotCommitted"
        ? "confirmedNotCommitted"
        : "transportUnknown",
      payload: {
        code,
        text: payload.text,
        submissionId: payload.submissionId,
        ...(typeof payload.pendingInputId === "string"
          ? { pendingInputId: payload.pendingInputId }
          : {}),
        ...(Object.hasOwn(payload, "answer") ? { answer: payload.answer } : {}),
      },
      ...(typeof parsed.localId === "string" ? { localId: parsed.localId } : {}),
      ...(parsed.committed === true ? { committed: true as const } : {}),
      lastError: typeof parsed.lastError === "string"
        ? parsed.lastError
        : "上次提交中断了。请用原提交标识恢复 KP 回应。",
    };
  } catch {
    return null;
  }
}

function persistSendAction(storageKey: string, submission: RecoverableSendAction | null) {
  try {
    if (submission === null) sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, JSON.stringify(submission));
  } catch {
    // Same-page retries still use the in-memory ref when session storage is unavailable.
  }
}

type AdvancementOptions = {
  classId: string;
  newLevel: number;
  hitPointMethod: "fixed2014";
  fixedHitPointGain: number;
  abilityScoreBudget: number;
  maximumAbilityScore: number;
  grantedFeatureIds: string[];
};

type GroupRestOptions = {
  initiatorCharacterId: string;
  restKind: "short" | "long";
  intendedDurationMicros: string;
  offeredAtFictionMicros: string;
};

type SocialResolutionOptions = {
  npcCharacterId: string;
  npcName: string;
  goal: string;
  method: string;
  risk: string;
  successOutcome: string;
  failureOutcome: string;
  dc: number;
  retryGate: string[];
};

type AuthoritativeControlledCharacter = {
  characterId: string;
  name?: string;
  sceneId?: string;
  hitPoints?: { current: number; maximum: number };
  conditions?: CharacterCondition[];
  resources?: Record<string, number>;
  resourceMaximums?: Record<string, number>;
  classId?: string;
  level?: number;
  experiencePoints?: number;
  abilityScores?: Record<Ability, number>;
  loadout?: {
    armorClass: number;
    speedFeet: number;
    equipped: Record<string, string>;
    backpack: Array<{ itemId: string; quantity: number }>;
  };
  inventory?: AuthoritativeInventory;
  restRecoveryOptions?: {
    shortRest?: {
      hitDiceMaximumSpend?: number;
      hitDieSides?: number;
      arcaneRecovery?: {
        eligible?: boolean;
        spellLevelBudget?: number;
        maximumSlotsByLevel?: Partial<Record<ArcaneRecoverySlotLevel, number>>;
      };
    };
  };
};

type TablePendingInput = {
  pendingInputId: string;
  rootActionId: string;
  question: string;
} & (
  | { kind: "clarification"; options?: undefined }
  | {
      kind: "playerChoice";
      options?: undefined;
      choices: Array<{ choiceId: string; label: string; consequence: string }>;
    }
  | { kind: "advancementChoice"; options: AdvancementOptions }
  | { kind: "groupRestConsent"; options: GroupRestOptions }
  | { kind: "partyMoveConsent"; options?: undefined }
  | { kind: "socialResolution"; options: SocialResolutionOptions }
  | {
      kind: "combatChoice";
      options?: undefined;
    } & (
      | { choiceKind: "target"; candidateEntityIds: string[] }
      | {
          choiceKind: "reaction" | "knockOut" | "contestDefense" | "commandWord";
          answerOptions: Array<{ label: string; answer: Record<string, unknown> }>;
        }
      | { choiceKind: "initiativeTieOrder"; orderedEntityIds: string[] }
      | { choiceKind: "encounterConclusion" }
    )
);

type CombatPendingInput = Extract<TablePendingInput, { kind: "combatChoice" }>;

export type TableSnap = {
  me: { userId: string; is_host: boolean; nickname: string };
  room: {
    id: string;
    code: string;
    title: string;
    status: string;
    module_id: string;
    kp_model: KpModelId | null;
    ruleset_version?: string;
  };
  members: { user_id: string; nickname: string; is_host: boolean }[];
  characters: {
    userId: string;
    locked: boolean;
    sheet: CharacterSheet;
    visibility?: "identityOnly";
  }[];
  messages: TableMessage[];
  locationThreads: {
    placeId: string;
    name: string;
    messages: TableMessage[];
  }[];
  logs: { id: string; entry: string; created_at: string }[];
  state: {
    chapterName: string;
    sceneName: string;
    kpBusy: boolean;
    pendingRolls: PendingRoll[];
    pendingInputs?: TablePendingInput[];
    clues: KnowledgeCard[];
    npcs: { id: string; name: string; intro: string }[];
    present?: PresentCharacter[];
    sceneId?: string;
    places?: Record<string, string>;
    placeNames?: Record<string, string>;
    partySplit?: boolean;
    clocks?: Record<string, { beats: number; minutes: number; lag: number }>;
    fictionTime?: { branchId: string; nowMicros: string };
    currentDeliveryId?: string;
    receipts?: Array<{ receiptId: string; rootActionId: string; status: string }>;
    authoritative?: {
      stateVersion?: string;
      projectionHash?: string;
      controlledCharacter: AuthoritativeControlledCharacter | null;
      activities?: Array<{
        activityId: string;
        characterId: string;
        status: "active" | "completed" | "interrupted";
        startedAtFictionMicros: string;
        intendedDurationMicros: string;
        kind?: "timePassage" | "activity";
        attention?: { rootActionId: string; atFictionMicros: string; messages: string[] };
        processingState?: "processing" | "blocked" | "cannotSafelyContinue";
        progressFictionMicros?: string;
        endedAtFictionMicros?: string;
        interruptionReason?: string;
        restKind?: "short" | "long";
      }>;
      inCombat?: boolean;
      lifecycle?: {
        kind: "successorRequired";
        defaultPredecessorCharacterId: string;
        eligiblePredecessors: Array<{
          characterId: string;
          name: string;
          tenureStatus: string;
        }>;
      };
      tacticalProjection?: TacticalProjection;
      combatControls?: CombatControls;
      npcCombatTurn?: NpcCombatTurnStatus;
      narrationRecovery?: ViewerNarrationRecovery;
    } | null;
    squads?: { ids: string[]; captain: string }[];
    squadInvite?: { from: string; to: string; fromName: string } | null;
    ruleProjection?: {
      viewer: {
        id: string;
        timeline: { spotlightBeat: number; fictionSeconds: number };
        hp?: { current: number; max: number };
        ac: number;
        speedFeet: number;
        activeEffects: string[];
        spellEffects: Array<{
          id: string;
          spellId: string;
          label: string;
          tags: string[];
          concentration: boolean;
        }>;
        rest?: {
          kind: "short" | "long";
          startedAt: number;
          requiredSeconds: number;
          status: "resting" | "interrupted" | "completed";
        };
      };
      visibleEntities: Array<{
        id: string;
        name: string;
        kind: "player" | "npc";
        condition: "active" | "down" | "dead";
      }>;
      combat?: {
        order: Array<{ entityId: string; positionFeet: number }>;
      };
    } | null;
  };
  module: { title: string; chapters: { id: string; name: string }[] };
};

function timePassageProgress(state: TableSnap["state"]): string | undefined {
  const activities = state.authoritative?.activities?.filter(activity => activity.kind === "timePassage"
    && /^(0|[1-9][0-9]*)$/.test(activity.startedAtFictionMicros));
  const activity = activities?.sort((left, right) => BigInt(left.startedAtFictionMicros) > BigInt(right.startedAtFictionMicros) ? -1 : 1)[0];
  if (!activity) return undefined;
  const ended = activity.status === "active" ? activity.progressFictionMicros : activity.endedAtFictionMicros;
  if (ended === undefined || !/^(0|[1-9][0-9]*)$/.test(ended)
    || !/^[1-9][0-9]*$/.test(activity.intendedDurationMicros) || BigInt(ended) < BigInt(activity.startedAtFictionMicros)) return undefined;
  const seconds = (value: bigint) => {
    const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
    return `${value / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
  };
  const elapsed = seconds(BigInt(ended) - BigInt(activity.startedAtFictionMicros));
  const intended = seconds(BigInt(activity.intendedDurationMicros));
  const status = activity.status === "active" ? "等待中" : activity.status === "completed" ? "等待已结束" : "等待已中断";
  const reasons: Record<string, string> = { actorUnavailable: "无法继续行动", actorIncapacitated: "无法继续等待",
    encounterActive: "需要处理当前遭遇", locationChanged: "地点已改变", externalInterruption: "受到中断" };
  const reason = activity.status === "interrupted" ? reasons[activity.interruptionReason ?? ""] : undefined;
  const processing = activity.status !== "active" ? "" : activity.processingState === "cannotSafelyContinue"
    ? " · 系统无法安全继续本次处理，等待尚未完成，已过时间已保留。"
    : activity.processingState === "blocked" ? " · 系统尚未完成本次处理，等待尚未完成，已过时间已保留。" : "";
  return `${status} · 实际经过 ${elapsed} 秒 / 计划 ${intended} 秒${reason ? ` · ${reason}` : ""}${processing}`;
}

/**
 * Whether a new KP message is read aloud.
 *
 * Off for now, at the user's request. The `speakNarration` endpoint is
 * untouched -- its membership and privacy behaviour is covered by tests and a
 * viewer can still ask for speech -- this only stops the table from firing it
 * on every delivery. Flip to true to restore automatic playback.
 */
const NARRATION_SPEECH_ENABLED = false;

export function PlayTable({
  code,
  snap,
  syncing = false,
}: {
  code: string;
  snap: TableSnap;
  syncing?: boolean;
}) {
  const [tab, setTab] = useState<TableJournalTab>("npcs");
  const [journalOpen, setJournalOpen] = useState(false);
  const [characterTab, setCharacterTab] = useState<CharacterPanelTab>("actions");
  const [characterOpen, setCharacterOpen] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const characterDocked = useCharacterPanelDocked();
  const composerRef = useRef<HTMLFormElement>(null);
  const draftStorageKey = `zhuwei-draft-${snap.me.userId}-${code}`;
  const actionRecoveryStorageKey = `zhuwei:v2-action-recovery:${snap.me.userId}:${code}`;
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(draftStorageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [editableFailedAction, setEditableFailedAction] = useState(false);
  const [supersededRecoveryCapability, setSupersededRecoveryCapability] = useState<string>();
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();
  const [rec, setRec] = useState<"idle" | "rec" | "stt">("idle");
  const spokenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const composingRef = useRef(false);
  const sendingRef = useRef(false);
  const [recoverableSubmission, setRecoverableSubmission] = useState<RecoverableSendAction | null>(
    () => restoredSendAction(actionRecoveryStorageKey, code),
  );
  const submissionRef = useRef<RecoverableSendAction | null>(recoverableSubmission);
  const presentationEpochRef = useRef(0);
  const activeNarrationRef = useRef<HTMLAudioElement | null>(null);
  const [localSays, setLocalSays] = useState<
    { id: string; submissionId: string; body: string; name: string; receiptId?: string }[]
  >([]);
  const viewerNarrationRecovery = snap.state.authoritative?.narrationRecovery;
  // A newly submitted line supersedes the previous delivery problem in the
  // conversation UI. If this new line also needs recovery, the refreshed
  // authoritative snapshot will replace it with that newer recovery record.
  const visibleViewerNarrationRecovery = localSays.length === 0
    && viewerNarrationRecovery?.capability !== supersededRecoveryCapability
    ? viewerNarrationRecovery
    : undefined;
  const viewerNarrationFailed = visibleViewerNarrationRecovery?.state === "rejected"
    || visibleViewerNarrationRecovery?.state === "retryableFailure";
  const viewerNarrationRetryable = viewerNarrationFailed
    && (visibleViewerNarrationRecovery?.canRetry ?? narrationFailureCanRetry(visibleViewerNarrationRecovery?.failureCode));
  const visibleMessages = snap.messages;
  const localMessage = (
    local: (typeof localSays)[number],
  ): TableMessage => ({
    id: local.id,
    user_id: snap.me.userId,
    kind: "say",
    name: local.name,
    body: local.body,
    created_at: "",
  });
  // SPEC 0010 §8.3: a changed current slot can belong to an earlier action.
  // Place an optimistic line before a reply only with its own receipt identity.
  const unconfirmedLocalSays = localSays.filter(local => !visibleMessages.some(message =>
    message.user_id === snap.me.userId && message.kind === "say"
    && (message.submissionId === local.submissionId
      || local.receiptId !== undefined && message.receiptId === local.receiptId)));
  const insertedLocalIds = new Set<string>();
  const conversationMessages = [
    ...visibleMessages.flatMap(message => {
      const preceding = unconfirmedLocalSays.filter(local => local.receiptId !== undefined
        && local.receiptId === message.receiptId && !insertedLocalIds.has(local.id));
      preceding.forEach(local => insertedLocalIds.add(local.id));
      return [...preceding.map(localMessage), message];
    }),
    ...unconfirmedLocalSays.filter(local => !insertedLocalIds.has(local.id)).map(localMessage),
  ];
  const currentPending = snap.state.pendingInputs?.[0];
  const advancementPending = currentPending?.kind === "advancementChoice"
    ? currentPending
    : undefined;
  const groupRestPending = currentPending?.kind === "groupRestConsent"
    ? currentPending
    : undefined;
  const partyMovePending = currentPending?.kind === "partyMoveConsent"
    ? currentPending
    : undefined;
  const playerChoicePending = currentPending?.kind === "playerChoice"
    ? currentPending
    : undefined;
  const socialResolutionPending = currentPending?.kind === "socialResolution"
    ? currentPending
    : undefined;
  // SPEC 0016 §7.2 (ADR 0081): the KP's one question; the composer answers it.
  const clarificationPending = currentPending?.kind === "clarification"
    ? currentPending
    : undefined;
  const combatPending = currentPending?.kind === "combatChoice"
    ? currentPending
    : undefined;

  function rememberSubmission(submission: RecoverableSendAction) {
    submissionRef.current = submission;
    setRecoverableSubmission(submission);
    persistSendAction(actionRecoveryStorageKey, submission);
  }

  function clearRememberedSubmission() {
    submissionRef.current = null;
    setRecoverableSubmission(null);
    persistSendAction(actionRecoveryStorageKey, null);
  }

  useEffect(() => {
    const restored = restoredSendAction(actionRecoveryStorageKey, code);
    submissionRef.current = restored;
    setRecoverableSubmission(restored);
  }, [actionRecoveryStorageKey, code]);

  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(draftStorageKey, text);
      else sessionStorage.removeItem(draftStorageKey);
    } catch {
      /* ignore */
    }
  }, [draftStorageKey, text]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationMessages.length, sending, snap.state.kpBusy, rec]);

  useEffect(() => {
    if ((!journalOpen && !characterOpen) || typeof window === "undefined") return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setJournalOpen(false);
      setCharacterOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [journalOpen, characterOpen]);

  useEffect(() => {
    if (!NARRATION_SPEECH_ENABLED) return;
    const kpKinds = new Set(["narrate", "refuse", "call_roll", "open"]);
    if (!primedRef.current) {
      for (const m of snap.messages) {
        if (kpKinds.has(m.kind) && m.id !== snap.state.currentDeliveryId) {
          spokenRef.current.add(m.id);
        }
      }
      primedRef.current = true;
      if (!snap.state.currentDeliveryId) return;
    }
    const latest = snap.state.currentDeliveryId
      ? snap.messages.find((message) => message.id === snap.state.currentDeliveryId)
      : [...snap.messages].reverse().find((message) => kpKinds.has(message.kind));
    if (!latest || spokenRef.current.has(latest.id)) return;
    spokenRef.current.add(latest.id);
    const presentationEpoch = presentationEpochRef.current;
    void playTts(snap.room.id, latest.id, {
      isCurrent: () => presentationEpochRef.current === presentationEpoch,
      register: (audio) => {
        activeNarrationRef.current = audio;
      },
    });
  }, [snap.messages, snap.room.id, snap.state.currentDeliveryId]);

  useEffect(() => {
    setLocalSays((prev) =>
      prev.filter(
        (l) =>
          !snap.messages.some(
            (m) =>
              m.user_id === snap.me.userId &&
              m.kind === "say" &&
              (m.submissionId === l.submissionId
                || l.receiptId !== undefined && m.receiptId === l.receiptId),
          ),
      ),
    );
  }, [snap.messages, snap.me.userId]);

  async function retryViewerNarration() {
    if (sendingRef.current || !viewerNarrationRetryable || visibleViewerNarrationRecovery?.kind !== "available") return;
    sendingRef.current = true;
    setSending(true);
    setSubmissionError(null);
    setEditableFailedAction(false);
    try {
      const result = await retryNarration({
        data: { code, capability: visibleViewerNarrationRecovery.capability },
      });
      if (result.action === "committed" && result.narration === "published") {
        clearRememberedSubmission();
        void qc.invalidateQueries({ queryKey: ["table", code] });
        return;
      }
      if (result.action === "committed" && result.narration === "pending") {
        void qc.invalidateQueries({ queryKey: ["table", code] });
        return;
      }
      const message = typeof result.error === "string"
        ? result.error
        : "KP 回复仍未送达，请稍后再试。";
      setSubmissionError(message);
      toast.error(message);
      void qc.invalidateQueries({ queryKey: ["table", code] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "没能重试 KP 回复";
      setSubmissionError(message);
      toast.error(message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function requireRecoveryFirst() {
    const message = "上一条行动仍在等待 KP 回应，请先恢复后再提交新行动。";
    setSubmissionError(message);
    toast.error(message);
  }

  async function submitRememberedAction(submission: RecoverableSendAction) {
    if (sendingRef.current) return;
    const inFlightSubmission: RecoverableSendAction = {
      ...submission,
      recoveryMode: "transportUnknown",
    };
    rememberSubmission(inFlightSubmission);
    sendingRef.current = true;
    setSending(true);
    setSubmissionError(null);
    setEditableFailedAction(false);
    const localId = submission.localId;
    if (submission.lastError === undefined) setSupersededRecoveryCapability(viewerNarrationRecovery?.capability);
    const composerSubmission = submission.source === "composer" && localId !== undefined;
    if (composerSubmission) {
      const mineName =
        snap.characters.find((c) => c.userId === snap.me.userId)?.sheet.name || "你";
      setLocalSays((ls) => ls.some((local) => local.id === localId)
        ? ls
        : [...ls, {
            id: localId,
            submissionId: submission.payload.submissionId,
            body: submission.payload.text,
            name: mineName,
          }]);
      setText((draft) => draft.trim() === submission.payload.text ? "" : draft);
    }
    try {
      const res = await sendAction({
        data: { ...submission.payload, ...(submission.lastError === undefined ? {} : { recoverProposal: true }) },
      });
      const outcome = recordValue(res.outcome) ? res.outcome : undefined;
      if (recordValue(outcome?.receipt) && typeof outcome.receipt.receiptId === "string") {
        const receiptId = outcome.receipt.receiptId;
        setLocalSays(lines => lines.map(line => line.id === localId ? { ...line, receiptId } : line));
      }
      const returnedSubmissionId = typeof res.submissionId === "string"
        ? res.submissionId.trim()
        : "";
      const stableSubmission = returnedSubmissionId
        && returnedSubmissionId !== submission.payload.submissionId
        ? {
            ...inFlightSubmission,
            payload: { ...submission.payload, submissionId: returnedSubmissionId },
          }
        : inFlightSubmission;
      const explicitAction = typeof res.action === "string" ? res.action : undefined;
      const confirmedNotCommitted = explicitAction === "notCommitted";
      const actionCommitted = explicitAction === "committed"
        || explicitAction === "resolvedInWorld"
        || explicitAction === "concluded"
        || res.committed === true;
      const requestFailed = res.ok === false
        || (res.ok !== true && !actionCommitted && explicitAction !== "awaitingInput");
      if (requestFailed || (actionCommitted && (
        res.narration === "rejected" || res.narration === "retryableFailure"
      ))) {
        const message = typeof res.error === "string" ? res.error : submission.failureMessage;
        const viewerLocalNarrationFailure = actionCommitted
          && res.ok === undefined
          && (res.narration === "rejected" || res.narration === "retryableFailure");
        if (viewerLocalNarrationFailure) {
          clearRememberedSubmission();
          void qc.invalidateQueries({ queryKey: ["table", code] });
        } else if (res.retryable === true || actionCommitted) {
          rememberSubmission({
            ...stableSubmission,
            recoveryMode: confirmedNotCommitted
              ? "confirmedNotCommitted"
              : "transportUnknown",
            ...(actionCommitted || stableSubmission.committed === true
              ? { committed: true as const }
              : {}),
            lastError: message,
          });
        } else {
          clearRememberedSubmission();
        }
        if (composerSubmission && !actionCommitted) {
          setLocalSays((ls) => ls.filter((x) => x.id !== localId));
          setText((draft) => draft || submission.payload.text);
        }
        // SPEC 0003 §1, SPEC 0011 §2: a new intent is safe only after the
        // authority explicitly confirms no action was committed.
        setEditableFailedAction(composerSubmission && confirmedNotCommitted && !actionCommitted && res.retryable !== true);
        setSubmissionError(message);
        toast.error(message);
      } else {
        clearRememberedSubmission();
        void qc.invalidateQueries({ queryKey: ["table", code] });
      }
    } catch (e) {
      if (composerSubmission) {
        setLocalSays((ls) => ls.filter((x) => x.id !== localId));
        setText((draft) => draft || submission.payload.text);
      }
      const message = e instanceof Error ? e.message : submission.failureMessage;
      rememberSubmission({ ...inFlightSubmission, lastError: message });
      setSubmissionError(message);
      toast.error(message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function submit() {
    await submitText(text.trim());
  }

  /** One player intent line, from the composer or composed by the tactical
   * map (ADR 0091 §3), through the same recoverable submission. */
  async function submitText(body: string) {
    if (!body || sendingRef.current) return;
    const existing = submissionRef.current;
    if (existing !== null) {
      if (existing.source === "composer" && existing.fingerprint === body) {
        await submitRememberedAction(existing);
        return;
      }
      if (existing.recoveryMode === "transportUnknown") {
        requireRecoveryFirst();
        return;
      }
      clearRememberedSubmission();
    }
    const pendingInputId = snap.state.pendingInputs?.[0]?.pendingInputId;
    const submissionId = crypto.randomUUID();
    const submission: RecoverableSendAction = {
      source: "composer",
      fingerprint: body,
      recoveryMode: "transportUnknown",
      payload: {
        code,
        text: body,
        submissionId,
        ...(pendingInputId ? { pendingInputId } : {}),
      },
      localId: `local-${submissionId}`,
      failureMessage: "没能送出",
    };
    rememberSubmission(submission);
    await submitRememberedAction(submission);
  }

  async function submitAdvancement(answer: {
    classId: string;
    newLevel: number;
    hitPointMethod: "fixed2014";
    selectedFeatureIds: string[];
    abilityScoreIncreases?: Partial<Record<Ability, number>>;
  }) {
    if (!advancementPending || sendingRef.current) return;
    const body = `确认晋升至 ${answer.newLevel} 级。`;
    const fingerprint = `${advancementPending.pendingInputId}\u0000${body}\u0000${JSON.stringify(answer)}`;
    const existing = submissionRef.current;
    if (existing !== null) {
      if (existing.source === "pending" && existing.fingerprint === fingerprint) {
        await submitRememberedAction(existing);
        return;
      }
      if (existing.recoveryMode === "transportUnknown") {
        requireRecoveryFirst();
        return;
      }
      clearRememberedSubmission();
    }
    const submissionId = crypto.randomUUID();
    const submission: RecoverableSendAction = {
      source: "pending",
      fingerprint,
      recoveryMode: "transportUnknown",
      payload: {
        code,
        text: body,
        submissionId,
        pendingInputId: advancementPending.pendingInputId,
        answer,
      },
      failureMessage: "没能提交成长选择",
    };
    rememberSubmission(submission);
    await submitRememberedAction(submission);
  }

  async function answerGroupRest(input: {
    accept: boolean;
    hitDice: number;
    arcaneRecoverySlotLevels: number[];
  }) {
    if (!groupRestPending || sendingRef.current) return;
    if (submissionRef.current !== null) {
      if (submissionRef.current.recoveryMode === "transportUnknown") {
        requireRecoveryFirst();
        return;
      }
      clearRememberedSubmission();
    }
    sendingRef.current = true;
    setSending(true);
    try {
      const result = input.accept
        ? await restNow({
            data: {
              code,
              pendingInputId: groupRestPending.pendingInputId,
              kind: groupRestPending.options.restKind,
              mode: "group",
              hitDice: groupRestPending.options.restKind === "short" ? input.hitDice : undefined,
              arcaneRecoverySlotLevels: groupRestPending.options.restKind === "short"
                ? input.arcaneRecoverySlotLevels
                : undefined,
            },
          })
        : await cancelRest({
            data: { code, pendingInputId: groupRestPending.pendingInputId },
          });
      if (!tableActionAccepted(result)) toast.error(result.error ?? "没能提交休整决定");
      else void qc.invalidateQueries({ queryKey: ["table", code] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "没能提交休整决定");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function answerTypedPending(input: {
    pendingInputId: string;
    answer: Record<string, unknown>;
    body: string;
    failureMessage: string;
  }) {
    if (sendingRef.current) return;
    const fingerprint = `${input.pendingInputId}\u0000${input.body}\u0000${JSON.stringify(input.answer)}`;
    const existing = submissionRef.current;
    if (existing !== null) {
      if (existing.source === "pending" && existing.fingerprint === fingerprint) {
        await submitRememberedAction(existing);
        return;
      }
      if (existing.recoveryMode === "transportUnknown") {
        requireRecoveryFirst();
        return;
      }
      clearRememberedSubmission();
    }
    const submissionId = crypto.randomUUID();
    const submission: RecoverableSendAction = {
      source: "pending",
      fingerprint,
      recoveryMode: "transportUnknown",
      payload: {
        code,
        text: input.body,
        submissionId,
        pendingInputId: input.pendingInputId,
        answer: input.answer,
      },
      failureMessage: input.failureMessage,
    };
    rememberSubmission(submission);
    await submitRememberedAction(submission);
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = mr.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        setRec("stt");
        try {
          const b64 = await blobToB64(blob);
          const out = await transcribeAudio({ data: { mime, b64 } });
          if (!out.ok) toast.error(out.error);
          else setText((t) => (t ? `${t} ${out.text}` : out.text));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "听写失败");
        } finally {
          setRec("idle");
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRec("rec");
    } catch {
      toast.error("无法使用麦克风");
    }
  }

  function stopRec() {
    if (mediaRef.current && rec === "rec") mediaRef.current.stop();
  }

  const pendingMine = snap.state.pendingRolls.filter(
    (r) => r.userId === snap.me.userId && !r.result,
  );
  const tacticalProjection = snap.state.authoritative?.tacticalProjection ?? null;
  const tacticalEncounterActive = tacticalProjection?.encounter !== null
    && tacticalProjection?.encounter !== undefined
    && tacticalProjection.encounter.status !== "concluded";
  const tacticalMapInCombat = snap.state.authoritative?.inCombat === true
    || tacticalEncounterActive;
  const tacticalMapKey = [
    tacticalMapInCombat ? "combat" : "exploration",
    tacticalProjection?.scene.id ?? "unknown",
  ].join(":");
  /** ADR 0146: a sentence put together from the map, the action list or an
   * item goes into the composer, where the player can add to it and send. */
  function draftSentence(sentence: string) {
    setText((draft) => draft.trim() ? `${draft.trim()} ${sentence}` : sentence);
    setCharacterOpen(false);
    setMapOpen(false);
    setTimeout(() => composerRef.current?.querySelector("textarea")?.focus(), 0);
  }
  // SPEC 0014 §§3、4、8 (ADR 0091): the map's moves, turn actions and the
  // sentences put together outside an encounter, which go into the composer
  // for the player to add to and send.
  const tacticalActions = useTacticalMapActions({
    code,
    projection: tacticalProjection,
    controls: snap.state.authoritative?.combatControls ?? null,
    sending,
    ...(currentPending ? { intentUnavailable: "请先完成当前待你决定的选择，再放入新的行动。" } : {}),
    draftIntent: draftSentence,
  });
  const inEncounter = tacticalProjection !== null && playerEncounter(tacticalProjection).inEncounter;
  const controlledCharacter = snap.state.authoritative?.controlledCharacter;
  // SPEC 0010 §7: the character panel reads the authority's own state and
  // pools; the locked sheet fills in only what the authority lacks.
  const myCard = snap.characters.find((character) => character.userId === snap.me.userId
    && character.visibility !== "identityOnly");
  const characterVitals = myCard === undefined ? undefined : characterVitalsOf({
    sheet: myCard.sheet,
    level: controlledCharacter?.level,
    hitPoints: controlledCharacter?.hitPoints,
    // SPEC 0012 §10.1: the armor class attacks are rolled against, effects included.
    armorClass: snap.state.authoritative?.combatControls?.vitals?.armorClass ?? controlledCharacter?.loadout?.armorClass,
    speedFeet: controlledCharacter?.loadout?.speedFeet,
    conditions: controlledCharacter?.conditions,
    combat: snap.state.authoritative?.combatControls?.vitals,
  });
  const characterPools = characterResourcePools({
    resources: controlledCharacter?.resources,
    maximums: controlledCharacter?.resourceMaximums,
    hitDieSides: controlledCharacter?.restRecoveryOptions?.shortRest?.hitDieSides
      ?? myCard?.sheet.resources?.hitDice.die,
  });
  const myGroupSize = snap.state.squads?.find((group) => group.ids.includes(snap.me.userId))?.ids.length ?? 1;
  const spellSlots = (level: number) => {
    const pool = characterPools.find((candidate) => candidate.id === `slot${level}`);
    return pool?.maximum === undefined ? undefined : { current: pool.current, maximum: pool.maximum };
  };
  const characterContent = myCard === undefined ? null : (
    <CharacterDetail
      tab={characterTab}
      onDraft={currentPending ? undefined : draftSentence}
      actionList={tacticalProjection === null ? undefined : (
        <ActionList
          projection={tacticalProjection}
          actions={tacticalActions}
          slots={spellSlots}
          onPicking={() => {
            if (!characterDocked) setCharacterOpen(false);
          }}
        />
      )}
      sheet={myCard.sheet}
      canEdit
      code={code}
      inCombat={snap.state.authoritative?.inCombat === true}
      meId={snap.me.userId}
      partyCount={myGroupSize}
      activeRule={snap.state.ruleProjection?.viewer}
      authoritativeCharacter={controlledCharacter ?? undefined}
      authoritativeActivities={snap.state.authoritative?.activities}
    />
  );
  const currentPlace = snap.state.placeNames?.[snap.me.userId]
    ?? tacticalProjection?.scene.name
    ?? snap.state.sceneName;
  const conversationWorkKind: TableWorkKind | null = sending
    ? "action" as const
    : snap.state.kpBusy || visibleViewerNarrationRecovery?.state === "pending"
      ? "kp" as const
      : rec === "stt"
        ? "speech" as const
        : null;
  const topStatusKind: TableTopStatusKind | null = conversationWorkKind
    ?? (syncing ? "sync" : null);
  const passageProgress = timePassageProgress(snap.state);
  const momentLabel = topStatusKind
    ? topStatusKind === "speech"
      ? "正在整理语音"
      : topStatusKind === "sync"
        ? "正在同步桌面"
        : "KP 正在处理"
    : currentPending
      ? "待你决定"
      : pendingMine.length > 0
        ? "轮到你掷骰"
        : tacticalMapInCombat
          ? "战斗进行中"
          : snap.state.partySplit
            ? "分头行动中"
            : "等待你的行动";

  return (
    <div className="relative flex min-h-0 min-w-0 w-full flex-1 gap-3 overflow-hidden">
      <section className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-shell border border-border bg-surface">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <div>
            <p className="font-display text-lg">{snap.module.title}</p>
            <p className="text-xs text-subtle">
              {snap.state.chapterName} · {snap.state.sceneName}
            </p>
            {snap.state.ruleProjection ? (
              <p className="mt-0.5 text-[11px] text-subtle">
                第 {snap.state.ruleProjection.viewer.timeline.spotlightBeat} 拍 · 虚构时间约 {Math.floor(snap.state.ruleProjection.viewer.timeline.fictionSeconds / 60)} 分钟
              </p>
            ) : null}
            {passageProgress ? <p className="mt-0.5 text-[11px] text-brass" role="status">{passageProgress}</p> : null}
            {snap.state.partySplit ? (
              <p className="mt-0.5 text-[11px] text-brass">
                队伍已分开，同一条时间线。你只听见自己这边；最多差三拍，领先的人先停。
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <p className="font-mono text-xs tracking-widest text-brass">
              {snap.room.code}
            </p>
            {leaveConfirm ? (
              <span className="flex items-center gap-2 text-[11px]" data-table-leave-confirm>
                <span className="text-muted">确定离开这一桌？</span>
                <button
                  type="button"
                  className="text-danger hover:text-fg"
                  onClick={() => {
                    setLeaveConfirm(false);
                    void leaveTable({ data: { code } }).then((res) => {
                      if (res && "ok" in res && !res.ok) toast.error(res.error);
                    });
                  }}
                >
                  离开
                </button>
                <button type="button" autoFocus className="text-subtle hover:text-fg" onClick={() => setLeaveConfirm(false)}>
                  留下
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="text-[11px] text-subtle hover:text-danger"
                onClick={() => setLeaveConfirm(true)}
              >
                离开这一桌
              </button>
            )}
          </div>
        </div>
        <div
          data-table-context-bar
          className="flex shrink-0 items-center gap-2 border-b border-border bg-bg/35 px-3 py-2 sm:px-5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-table-top-status={topStatusKind ?? "idle"}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                topStatusKind
                  ? "border-brass/50 bg-brass/10 text-brass"
                  : currentPending || pendingMine.length > 0
                    ? "border-brass/40 text-brass"
                    : "border-border text-muted",
              )}
            >
              {topStatusKind ? (
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <CircleDot className="size-3" aria-hidden="true" />
              )}
              {momentLabel}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted">
              <MapPin className="size-3.5 text-brass" aria-hidden="true" />
              {currentPlace}
            </span>
          </div>
          <button
            type="button"
            data-table-journal-trigger
            aria-haspopup="dialog"
            aria-controls="table-journal"
            aria-expanded={journalOpen}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-fg transition hover:border-brass/60 hover:bg-elevated"
            onClick={() => setJournalOpen(true)}
          >
            <BookOpenText className="size-3.5 text-brass" aria-hidden="true" />
            <span>桌边册</span>
            <span className="hidden text-[10px] text-subtle sm:inline">
              在场 {(snap.state.present ?? []).length} · 线索 {snap.state.clues.filter((clue) => !clue.background).length}
            </span>
          </button>
        </div>
        {!characterDocked && characterVitals !== undefined ? (
          <CharacterVitalsStrip
            vitals={characterVitals}
            pools={characterPools}
            expanded={characterOpen}
            onOpen={() => setCharacterOpen(true)}
          />
        ) : null}
        <LocationHistoryBar
          threads={snap.locationThreads}
          meId={snap.me.userId}
        />
        {snap.state.authoritative ? (
          <TacticalMap
            key={tacticalMapKey}
            projection={tacticalProjection}
            defaultExpanded={tacticalMapInCombat}
            actions={tacticalActions}
            npcTurn={snap.state.authoritative?.npcCombatTurn}
            mobileOpen={mapOpen}
            onMobileOpenChange={setMapOpen}
            mobileFooter={tacticalProjection === null ? null : (
              <TaskBar projection={tacticalProjection} actions={tacticalActions} />
            )}
          />
        ) : null}
        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
          aria-busy={conversationWorkKind !== null}
          data-table-conversation
        >
          {conversationMessages.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              mine={m.user_id === snap.me.userId}
            />
          ))}
          {conversationWorkKind ? <TableWorkIndicator kind={conversationWorkKind} /> : null}
          <div ref={endRef} />
        </div>
        {viewerNarrationFailed && visibleViewerNarrationRecovery?.kind === "available" ? (
          <div
            data-narration-recovery="viewer"
            role="alert"
            className="shrink-0 border-t border-danger/40 bg-danger/10 px-5 py-3"
          >
            <p className="text-sm text-fg">{visibleViewerNarrationRecovery.cancelled ? "本次行动已取消，没有生效。" : visibleViewerNarrationRecovery.action === "notCommitted"
              ? "KP 回复尚未准备完成，本次行动还没有生效。"
              : "行动已经结算，但这条 KP 回复尚未送达。"}</p>
            <p className="mt-1 text-xs text-subtle">
              {publicNarrationRecoveryReason(visibleViewerNarrationRecovery.state, visibleViewerNarrationRecovery.failureCode, visibleViewerNarrationRecovery.canRetry, visibleViewerNarrationRecovery.action, visibleViewerNarrationRecovery.cancelled)}
            </p>
            {viewerNarrationRetryable ? (
              <>
                <p className="mt-1 text-xs text-subtle">
                  {visibleViewerNarrationRecovery.action === "notCommitted"
                    ? "重试会继续准备同一次行动的回复，不会重新掷骰；回复就绪后才会结算资源。"
                    : "重试只恢复你自己的回复，不会重新裁定、掷骰或消耗资源。"}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-2"
                  data-narration-recovery-submit
                  disabled={sending}
                  onClick={() => void retryViewerNarration()}
                >
                  {sending ? "重试中……" : "重试 KP 回复"}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {visibleViewerNarrationRecovery === undefined && recoverableSubmission?.lastError ? (
          <div
            data-action-recovery="send-action"
            role="alert"
            className="shrink-0 border-t border-danger/40 bg-danger/10 px-5 py-3"
          >
            <p className="text-sm text-fg">
              {recoverableSubmission.committed
                ? "行动已经提交，KP 回应尚未送达。"
                : recoverableSubmission.recoveryMode === "confirmedNotCommitted"
                  ? "这项行动没有提交到世界。"
                  : "上次提交的结果还没有确认。"}
            </p>
            <p className="mt-1 text-xs text-subtle">
              {recoverableSubmission.recoveryMode === "confirmedNotCommitted"
                ? "可以原样重试，也可以修改输入或直接发送新的行动。"
                : "将原样使用同一个提交标识恢复，不会按当前待决状态创建新行动。"}
            </p>
            <p className="mt-1 text-xs text-danger">{recoverableSubmission.lastError}</p>
            <Button
              type="button"
              size="sm"
              className="mt-2"
              data-action-recovery-submit
              disabled={sending}
              onClick={() => void submitRememberedAction(recoverableSubmission)}
            >
              {sending
                ? "恢复中……"
                : recoverableSubmission.recoveryMode === "confirmedNotCommitted"
                  ? "重试原行动"
                  : "恢复 KP 回应"}
            </Button>
          </div>
        ) : null}
        {/* SPEC 0014 §4 (ADR 0091): the turn and the pick in progress sit right
            above the decisions and the composer. */}
        {tacticalProjection !== null && inEncounter ? (
          <TurnBar
            projection={tacticalProjection}
            actions={tacticalActions}
            npcTurn={snap.state.authoritative?.npcCombatTurn}
          />
        ) : null}
        {tacticalProjection !== null ? (
          <TaskBar
            projection={tacticalProjection}
            actions={tacticalActions}
            onOpenMap={() => setMapOpen(true)}
          />
        ) : null}
        {pendingMine.length > 0 && (
          <div className="shrink-0 border-t border-border px-5 py-3">
            <p className="mb-2 text-xs text-brass">轮到你掷骰</p>
            <div className="flex flex-col gap-3">
              {pendingMine.map((r) => (
                <RollButton
                  key={r.id}
                  code={code}
                  roll={r}
                />
              ))}
            </div>
          </div>
        )}
        {currentPending ? (
          <div className="shrink-0 border-t border-border px-5 py-3">
            <p className="text-xs text-brass">KP 等你明确决定</p>
            <p className="mt-1 text-sm text-fg">
              {currentPending.question}
            </p>
            {advancementPending ? (
              <AdvancementChoicePanel
                key={advancementPending.pendingInputId}
                options={advancementPending.options!}
                scores={snap.state.authoritative?.controlledCharacter?.abilityScores}
                sending={sending}
                onSubmit={submitAdvancement}
              />
            ) : null}
            {groupRestPending ? (
              <GroupRestConsentPanel
                key={groupRestPending.pendingInputId}
                options={groupRestPending.options}
                character={snap.state.authoritative?.controlledCharacter ?? null}
                sending={sending}
                onSubmit={answerGroupRest}
              />
            ) : null}
            {partyMovePending ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={sending}
                  onClick={() => void answerTypedPending({
                    pendingInputId: partyMovePending.pendingInputId,
                    answer: { accept: true },
                    body: "我同意这次整队移动。",
                    failureMessage: "没能提交整队移动决定",
                  })}
                >
                  同意同行
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={sending}
                  onClick={() => void answerTypedPending({
                    pendingInputId: partyMovePending.pendingInputId,
                    answer: { accept: false },
                    body: "我不同意这次整队移动。",
                    failureMessage: "没能提交整队移动决定",
                  })}
                >
                  拒绝同行
                </Button>
              </div>
            ) : null}
            {playerChoicePending ? (
              <div className="mt-3 grid gap-2">
                {playerChoicePending.choices.map((choice) => (
                  <Button variant="secondary"
                    key={choice.choiceId}
                    type="button"
                    className="h-auto min-h-11 justify-start whitespace-normal py-2"
                    disabled={sending}
                    onClick={() => void answerTypedPending({
                      pendingInputId: playerChoicePending.pendingInputId,
                      answer: { choiceId: choice.choiceId },
                      body: `我选择：${choice.label}。`,
                      failureMessage: "没能提交这项决定",
                    })}
                  >
                    <span className="text-left">
                      <span className="block">{choice.label}</span>
                      <span className="block text-xs font-normal text-muted">{choice.consequence}</span>
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
            {socialResolutionPending ? (
              <div className="mt-3 space-y-3 rounded-control border border-border bg-bg/40 p-3">
                <div className="space-y-1 text-xs text-subtle">
                  {typeof socialResolutionPending.options?.npcName === "string" ? (
                    <p>对象：{socialResolutionPending.options.npcName}</p>
                  ) : null}
                  {typeof socialResolutionPending.options?.goal === "string" ? (
                    <p>目标：{socialResolutionPending.options.goal}</p>
                  ) : null}
                  {typeof socialResolutionPending.options?.method === "string" ? (
                    <p>做法：{socialResolutionPending.options.method}</p>
                  ) : null}
                  {typeof socialResolutionPending.options?.risk === "string" ? (
                    <p>风险：{socialResolutionPending.options.risk}</p>
                  ) : null}
                  {typeof socialResolutionPending.options?.successOutcome === "string" ? (
                    <p>成功时：{socialResolutionPending.options.successOutcome}</p>
                  ) : null}
                  {typeof socialResolutionPending.options?.failureOutcome === "string" ? (
                    <p>失败时：{socialResolutionPending.options.failureOutcome}</p>
                  ) : null}
                  {typeof socialResolutionPending.options?.dc === "number" ? (
                    <p>当前冻结边界：DC {socialResolutionPending.options.dc}；最终结果还会按差值分档。</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={sending}
                    onClick={() => void answerTypedPending({
                      pendingInputId: socialResolutionPending.pendingInputId,
                      answer: { choice: "press" },
                      body: "我坚持这个做法，进行检定。",
                      failureMessage: "没能确认这次社交检定",
                    })}
                  >
                    坚持并掷骰
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={sending}
                    onClick={() => void answerTypedPending({
                      pendingInputId: socialResolutionPending.pendingInputId,
                      answer: { choice: "acceptStatusQuo" },
                      body: "我不进行检定，接受当前局面。",
                      failureMessage: "没能接受当前局面",
                    })}
                  >
                    不掷骰，接受现状
                  </Button>
                </div>
                <p className="text-xs text-muted">也可以直接在下方输入新的说法；旧检定会在掷骰前失效，但已经说出口的话仍然存在。</p>
              </div>
            ) : null}
            {clarificationPending ? (
              <div className="mt-3 grid gap-2">
                <p className="text-xs text-muted">在下方输入你的补充作为回答；不想补充也可以照原样进行。</p>
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    data-pending-decline
                    disabled={sending}
                    onClick={() => void answerTypedPending({
                      pendingInputId: clarificationPending.pendingInputId,
                      answer: { decline: true },
                      body: "就这样，不补充。",
                      failureMessage: "没能提交这项决定",
                    })}
                  >
                    就这样，不补充
                  </Button>
                </div>
              </div>
            ) : null}
            {combatPending ? (
              <CombatChoicePanel
                key={combatPending.pendingInputId}
                pending={combatPending}
                sending={sending}
                entityLabel={(entityId) => {
                  const controlled = snap.state.authoritative?.controlledCharacter;
                  if (controlled?.characterId === entityId) return controlled.name ?? "你";
                  const character = snap.characters.find((candidate) =>
                    entityId === `character:${candidate.userId}` || entityId.includes(candidate.userId));
                  if (character) return character.sheet.name || entityId;
                  return snap.state.npcs.find((npc) => npc.id === entityId)?.name ?? entityId;
                }}
                onSubmit={(answer, body) => answerTypedPending({
                  pendingInputId: combatPending.pendingInputId,
                  answer,
                  body,
                  failureMessage: "没能提交战斗决定",
                })}
              />
            ) : null}
          </div>
        ) : null}
        {pendingMine.length === 0 && !advancementPending && !groupRestPending && !partyMovePending && !playerChoicePending && !combatPending ? <form
          ref={composerRef}
          className="flex shrink-0 flex-wrap items-end gap-2 border-t border-border p-3"
          aria-busy={sending || rec === "stt"}
          onSubmit={(e) => e.preventDefault()}
        >
          <button
            type="button"
            aria-label="按住说话"
            onPointerDown={(e) => {
              e.preventDefault();
              void startRec();
            }}
            onPointerUp={stopRec}
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-control border",
              rec === "rec"
                ? "border-danger bg-danger text-fg"
                : "border-border text-muted hover:text-fg",
            )}
          >
            <Mic className="size-5" />
          </button>
          {!characterDocked && characterVitals !== undefined ? (
            <button
              type="button"
              data-table-actions-trigger
              aria-label="打开行动"
              aria-haspopup="dialog"
              aria-controls="character-panel"
              onClick={() => {
                setCharacterTab("actions");
                setCharacterOpen(true);
              }}
              className="grid size-12 shrink-0 place-items-center rounded-control border border-border text-muted hover:text-fg"
            >
              <Swords className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!editableFailedAction) setSubmissionError(null);
            }}
            aria-invalid={submissionError ? true : undefined}
            aria-describedby={submissionError ? "action-submission-error" : undefined}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            placeholder={
              sending
                ? "行动已送出；结果出现前，可以先想想下一步。"
                : rec === "rec"
                ? "正在听……松手后写入输入框"
                : rec === "stt"
                  ? "正在转写……"
                  : "你做什么、说什么。点右侧按钮送出，回车只换行。"
            }
            className="min-h-12 max-h-36 flex-1"
            rows={2}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || composingRef.current || e.key === "Process") {
                return;
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            aria-label={sending ? "正在发送行动" : "发送行动"}
            disabled={sending || !text.trim()}
            onClick={() => void submit()}
          >
            {sending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
          {submissionError ? (
            <div
              id="action-submission-error"
              role="alert"
              data-submission-error
              className="basis-full whitespace-pre-line break-all text-xs text-danger"
            >
              <p>{submissionError}</p>
              {editableFailedAction ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="basis-full text-subtle">这次行动未生效，原文已保留。参考上面的原因修改内容，再重新提交。</p>
                  <Button type="button" size="sm" variant="secondary" data-action-edit
                    disabled={sending} onClick={(event) => event.currentTarget.form?.querySelector("textarea")?.focus()}>
                    修改内容
                  </Button>
                  <Button type="button" size="sm" data-action-resubmit
                    disabled={sending || !text.trim()} onClick={() => void submit()}>
                    重新提交
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </form> : null}
        <DiagnosticCopy key={submissionError ?? recoverableSubmission?.lastError ?? ""}
          message={submissionError ?? recoverableSubmission?.lastError ?? ""} />
      </section>
      {characterDocked && characterVitals !== undefined ? (
        <aside
          id="character-panel"
          aria-labelledby="character-panel-title"
          className="flex w-[22rem] shrink-0 flex-col overflow-hidden rounded-shell border border-border bg-surface"
        >
          <CharacterPanel vitals={characterVitals} pools={characterPools} tab={characterTab} onTabChange={setCharacterTab}>
            {characterContent}
          </CharacterPanel>
        </aside>
      ) : null}
      {!characterDocked && characterOpen && characterVitals !== undefined ? (
        <>
          <button
            type="button"
            aria-label="关闭角色栏"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default bg-bg/75 backdrop-blur-[2px]"
            onClick={() => setCharacterOpen(false)}
          />
          <aside
            id="character-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="character-panel-title"
            data-table-character-dialog
            className="fixed inset-x-2 bottom-2 top-2 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-shell border border-border-strong bg-surface shadow-2xl sm:inset-x-auto sm:right-3 sm:w-[min(26rem,calc(100vw-1.5rem))]"
          >
            <CharacterPanel
              vitals={characterVitals}
              pools={characterPools}
              tab={characterTab}
              onTabChange={setCharacterTab}
              headerAction={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  autoFocus
                  aria-label="收起角色栏"
                  className="size-9 shrink-0"
                  onClick={() => setCharacterOpen(false)}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              )}
            >
              {characterContent}
            </CharacterPanel>
          </aside>
        </>
      ) : null}
      {journalOpen ? (
        <TableJournal
          code={code}
          snap={snap}
          tab={tab}
          onTabChange={setTab}
          onClose={() => setJournalOpen(false)}
        />
      ) : null}
    </div>
  );
}

type TableWorkKind = "action" | "kp" | "speech";
type TableTopStatusKind = TableWorkKind | "sync";

function TableWorkIndicator({ kind }: { kind: TableWorkKind }) {
  const copy = {
    action: {
      title: "行动已送出，正在等待 KP",
      detail: "系统正在理解意图、核对规则并更新世界状态。",
    },
    kp: {
      title: "KP 正在处理桌上的行动",
      detail: "结果准备好后会直接出现在这段对话里。",
    },
    speech: {
      title: "正在整理你的语音",
      detail: "转写完成后会放回输入框，由你确认再送出。",
    },
  }[kind];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-table-loading={kind}
      className="max-w-[42rem] rounded-panel border border-brass/35 bg-brass/[0.07] px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-brass/30 bg-bg/50 text-brass"
          aria-hidden="true"
        >
          <LoaderCircle className="size-4 animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg">{copy.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{copy.detail}</p>
          <span className="mt-2 flex gap-1" aria-hidden="true">
            <span className="size-1.5 animate-pulse rounded-full bg-brass" />
            <span className="size-1.5 animate-pulse rounded-full bg-brass [animation-delay:160ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-brass [animation-delay:320ms]" />
          </span>
        </div>
      </div>
    </div>
  );
}

type TableJournalTab = "party" | "npcs" | "clues";

function TableJournal({
  code,
  snap,
  tab,
  onTabChange,
  onClose,
}: {
  code: string;
  snap: TableSnap;
  tab: TableJournalTab;
  onTabChange: (tab: TableJournalTab) => void;
  onClose: () => void;
}) {
  // The journal holds what the character has met; the character itself is in
  // the character panel. Companions get a tab only when there are others.
  const tabs = [
    ...(snap.characters.length > 1 ? [["party", UserRound, "同伴", snap.characters.length - 1] as const] : []),
    ["npcs", Users, "在场", (snap.state.present ?? []).length] as const,
    ["clues", MapPinned, "线索", snap.state.clues.filter((clue) => !clue.background).length] as const,
  ];
  const activeTab = tabs.some(([id]) => id === tab) ? tab : "npcs";
  const activeLabel = tabs.find(([id]) => id === activeTab)?.[2] ?? "桌边册";

  return (
    <>
      <button
        type="button"
        aria-label="关闭桌边册"
        tabIndex={-1}
        className="fixed inset-0 z-40 cursor-default bg-bg/75 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        id="table-journal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-journal-title"
        data-table-journal
        className="fixed inset-x-2 bottom-2 top-2 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-shell border border-border-strong bg-surface shadow-2xl sm:inset-x-auto sm:right-3 sm:w-[min(32rem,calc(100vw-1.5rem))]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
          <div>
            <p id="table-journal-title" className="font-display text-lg text-fg">桌边册</p>
            <p className="mt-0.5 text-xs text-subtle">
              需要时再翻开 · 当前查看{activeLabel}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            autoFocus
            aria-label="收起桌边册"
            className="size-9 shrink-0"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </header>
        <div
          role="tablist"
          aria-label="桌边册栏目"
          className="flex shrink-0 overflow-x-auto border-b border-border px-2"
        >
          {tabs.map(([id, Icon, label, count]) => (
            <button
              key={id}
              id={`table-journal-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`table-journal-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => onTabChange(id)}
              className={cn(
                "flex min-w-20 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-3 text-xs transition sm:text-sm",
                activeTab === id
                  ? "border-brass text-fg"
                  : "border-transparent text-subtle hover:text-muted",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
              <span className="text-[10px] tabular-nums text-subtle">{count}</span>
            </button>
          ))}
        </div>
        <div
          id={`table-journal-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`table-journal-tab-${activeTab}`}
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-5"
        >
          {activeTab === "party" ? (
            <PartyBoard
              party={snap.characters}
              meId={snap.me.userId}
              isHost={snap.me.is_host}
              code={code}
              placeNames={snap.state.placeNames}
              clocks={snap.state.clocks}
              partySplit={snap.state.partySplit}
              squads={snap.state.squads}
              squadInvite={snap.state.squadInvite}
              places={snap.state.places}
              myHitPoints={snap.state.authoritative?.controlledCharacter?.hitPoints}
            />
          ) : null}
          {activeTab === "npcs" ? <PresenceBoard people={snap.state.present ?? []} /> : null}
          {activeTab === "clues" ? <ClueBoard clues={snap.state.clues} /> : null}
        </div>
      </aside>
    </>
  );
}

function CombatChoicePanel({
  pending,
  sending,
  entityLabel,
  onSubmit,
}: {
  pending: CombatPendingInput;
  sending: boolean;
  entityLabel: (entityId: string) => string;
  onSubmit: (answer: Record<string, unknown>, body: string) => Promise<void>;
}) {
  const [initiativeOrder, setInitiativeOrder] = useState<string[]>(
    pending.choiceKind === "initiativeTieOrder" ? pending.orderedEntityIds : [],
  );

  if (pending.choiceKind === "target") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {pending.candidateEntityIds.map((entityId) => (
          <Button variant="secondary"
            key={entityId}
            type="button"
            disabled={sending}
            onClick={() => void onSubmit(
              { kind: "selectTarget", targetEntityId: entityId },
              `我选择 ${entityLabel(entityId)} 作为目标。`,
            )}
          >
            {entityLabel(entityId)}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          disabled={sending}
          onClick={() => void onSubmit({ kind: "cancel" }, "我取消这次战斗行动。")}
        >
          取消行动
        </Button>
      </div>
    );
  }

  if (pending.choiceKind === "reaction" || pending.choiceKind === "knockOut" || pending.choiceKind === "contestDefense"
    || pending.choiceKind === "commandWord") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {pending.answerOptions.map((option, index) => (
          <Button variant="secondary"
            key={`${index}:${option.label}`}
            type="button"
            disabled={sending}
            onClick={() => void onSubmit(structuredClone(option.answer), option.label)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  }

  if (pending.choiceKind === "encounterConclusion") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={sending}
          onClick={() => void onSubmit(
            { kind: "acceptEncounterConclusion" },
            "我接受当前遭遇的收束。",
          )}
        >
          接受遭遇收束
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={sending}
          onClick={() => void onSubmit(
            { kind: "rejectEncounterConclusion" },
            "我拒绝当前遭遇的收束，继续采取合法行动。",
          )}
        >
          拒绝并继续
        </Button>
      </div>
    );
  }

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= initiativeOrder.length) return;
    setInitiativeOrder((previous) => {
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  return (
    <div className="mt-3 rounded-panel border border-border bg-bg/40 p-3">
      <ol className="grid gap-2">
        {initiativeOrder.map((entityId, index) => (
          <li
            key={entityId}
            className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2 text-sm"
          >
            <span>{index + 1}. {entityLabel(entityId)}</span>
            <span className="flex gap-2">
              <button
                type="button"
                aria-label={`让${entityLabel(entityId)}提前`}
                disabled={sending || index === 0}
                className="text-brass disabled:opacity-30"
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`让${entityLabel(entityId)}延后`}
                disabled={sending || index === initiativeOrder.length - 1}
                className="text-brass disabled:opacity-30"
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        className="mt-3"
        disabled={sending}
        onClick={() => void onSubmit(
          { orderedEntityIds: initiativeOrder },
          `我确认先攻顺序为 ${initiativeOrder.map(entityLabel).join("、")}。`,
        )}
      >
        确认先攻顺序
      </Button>
    </div>
  );
}

function AdvancementChoicePanel({
  options,
  scores,
  sending,
  onSubmit,
}: {
  options: AdvancementOptions;
  scores?: Record<Ability, number>;
  sending: boolean;
  onSubmit: (answer: {
    classId: string;
    newLevel: number;
    hitPointMethod: "fixed2014";
    selectedFeatureIds: string[];
    abilityScoreIncreases?: Partial<Record<Ability, number>>;
  }) => Promise<void>;
}) {
  const [increases, setIncreases] = useState<Partial<Record<Ability, number>>>({});
  const spent = Object.values(increases).reduce((sum, amount) => sum + (amount ?? 0), 0);
  const ready = spent === options.abilityScoreBudget;
  return (
    <div className="mt-3 rounded-panel border border-border bg-bg/40 p-3">
      <p className="text-xs text-muted">
        采用 2014 固定生命值：最大生命值 +{options.fixedHitPointGain}。
        {options.grantedFeatureIds.length > 0
          ? ` 获得：${options.grantedFeatureIds.map((id) => id.replace(/^feature:/, "")).join("、")}。`
          : " 本级没有新增通用职业特性。"}
      </p>
      {options.abilityScoreBudget > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ABILITIES.map((ability) => {
            const current = scores?.[ability];
            const added = increases[ability] ?? 0;
            const capped = current !== undefined
              && current + added >= options.maximumAbilityScore;
            return (
              <div key={ability} className="flex items-center justify-between rounded-control border border-border px-3 py-2 text-sm">
                <span>{ABILITY_LABEL[ability]} {current ?? "?"}{added ? ` +${added}` : ""}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    aria-label={`减少${ABILITY_LABEL[ability]}`}
                    disabled={added === 0 || sending}
                    className="text-muted disabled:opacity-30"
                    onClick={() => setIncreases((previous) => {
                      const next = { ...previous };
                      const value = (next[ability] ?? 0) - 1;
                      if (value > 0) next[ability] = value;
                      else delete next[ability];
                      return next;
                    })}
                  >−</button>
                  <button
                    type="button"
                    aria-label={`提高${ABILITY_LABEL[ability]}`}
                    disabled={sending || spent >= options.abilityScoreBudget || added >= 2 || capped}
                    className="text-brass disabled:opacity-30"
                    onClick={() => setIncreases((previous) => ({
                      ...previous,
                      [ability]: (previous[ability] ?? 0) + 1,
                    }))}
                  >＋</button>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <Button
        type="button"
        className="mt-3"
        disabled={!ready || sending}
        onClick={() => void onSubmit({
          classId: options.classId,
          newLevel: options.newLevel,
          hitPointMethod: options.hitPointMethod,
          selectedFeatureIds: [...options.grantedFeatureIds],
          ...(options.abilityScoreBudget === 0 ? {} : { abilityScoreIncreases: increases }),
        })}
      >
        {sending ? "提交成长……" : `确认晋升至 ${options.newLevel} 级`}
      </Button>
    </div>
  );
}

function ArcaneRecoveryPicker({
  character,
  selection,
  disabled,
  onChange,
}: {
  character: AuthoritativeControlledCharacter | null | undefined;
  selection: number[];
  disabled: boolean;
  onChange: (selection: number[]) => void;
}) {
  const availability = arcaneRecoveryAvailability(character);
  if (!availability.eligible) return null;
  const spent = selection.reduce((sum, level) => sum + level, 0);
  const levels = ([1, 2, 3, 4, 5] as const)
    .filter((level) => availability.missingByLevel[level] > 0);
  return (
    <div className="space-y-2 text-sm">
      <div>
        <p>奥术恢复（每日一次）</p>
        <p className="text-[11px] text-subtle">
          可恢复环数预算 {availability.budget}；已选择 {spent}。这里只冻结你的选择，完成短休后由规则结算。
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {levels.map((level) => {
          const selected = selection.filter((entry) => entry === level).length;
          const canAdd = selected < availability.missingByLevel[level]
            && spent + level <= availability.budget;
          return (
            <div
              key={level}
              className="flex items-center gap-2 rounded-control border border-border/70 px-2 py-1.5"
            >
              <span className="min-w-16 text-xs">{level} 环位</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || selected === 0}
                onClick={() => onChange(changeArcaneRecoverySelection(
                  character,
                  selection,
                  level as ArcaneRecoverySlotLevel,
                  -1,
                ))}
              >−</Button>
              <span className="min-w-5 text-center tabular-nums">{selected}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || !canAdd}
                onClick={() => onChange(changeArcaneRecoverySelection(
                  character,
                  selection,
                  level as ArcaneRecoverySlotLevel,
                  1,
                ))}
              >＋</Button>
              <span className="text-[10px] text-subtle">
                缺 {availability.missingByLevel[level]}
              </span>
            </div>
          );
        })}
      </div>
      {selection.length > 0 ? (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange([])}>
          不使用奥术恢复
        </Button>
      ) : null}
    </div>
  );
}

function GroupRestConsentPanel({
  options,
  character,
  sending,
  onSubmit,
}: {
  options: GroupRestOptions;
  character: AuthoritativeControlledCharacter | null;
  sending: boolean;
  onSubmit: (input: {
    accept: boolean;
    hitDice: number;
    arcaneRecoverySlotLevels: number[];
  }) => Promise<void>;
}) {
  const availableHitDice = Math.max(
    0,
    Math.floor(character?.restRecoveryOptions?.shortRest?.hitDiceMaximumSpend ?? 0),
  );
  const [hitDice, setHitDice] = useState(0);
  const [arcaneRecoverySlotLevels, setArcaneRecoverySlotLevels] = useState<number[]>([]);
  return (
    <div className="mt-3 rounded-panel border border-brass/40 bg-brass/10 p-3">
      <p className="text-xs text-muted">
        发起者只决定自己的休整。你是否加入由你决定；拒绝或暂不回答都不会替你推进虚构时间。
      </p>
      {options.restKind === "short" ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span>花费生命骰</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={sending || hitDice === 0}
              onClick={() => setHitDice((value) => Math.max(0, value - 1))}
            >−</Button>
            <span className="min-w-6 text-center tabular-nums">{hitDice}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={sending || hitDice >= availableHitDice}
              onClick={() => setHitDice((value) => Math.min(availableHitDice, value + 1))}
            >＋</Button>
          </div>
          <ArcaneRecoveryPicker
            character={character}
            selection={arcaneRecoverySlotLevels}
            disabled={sending}
            onChange={setArcaneRecoverySlotLevels}
          />
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          disabled={sending}
          onClick={() => void onSubmit({
            accept: true,
            hitDice,
            arcaneRecoverySlotLevels,
          })}
        >
          {sending ? "提交中……" : `加入${options.restKind === "long" ? "长休" : "短休"}`}
        </Button>
        <Button
          variant="ghost"
          disabled={sending}
          onClick={() => void onSubmit({
            accept: false,
            hitDice: 0,
            arcaneRecoverySlotLevels: [],
          })}
        >拒绝</Button>
      </div>
    </div>
  );
}

function MessageBubble({
  m,
  mine,
}: {
  m: TableSnap["messages"][number];
  mine: boolean;
}) {
  if (m.kind === "stage") {
    return (
      <p className="px-1 text-center text-[11px] tracking-wide text-subtle">
        {m.body}
      </p>
    );
  }
  const kp = !m.user_id;
  return (
    <article
      data-delivery-id={m.id}
      className={cn("max-w-[42rem]", mine && "ml-auto", kp && "mx-0 w-full max-w-[52rem]")}
    >
      <p className="mb-1 text-[11px] tracking-wide text-subtle">
        {m.kind === "roll" ? m.name : kp ? "KP" : m.name}
        {m.kind === "roll" ? " · 检定" : ""}
        {m.kind === "refuse" ? " · 驳回" : ""}
      </p>
      <div
        className={cn(
          "whitespace-pre-wrap rounded-panel px-4 py-3 text-sm leading-relaxed",
          kp
            ? "border border-border bg-elevated font-display text-[15px] leading-7"
            : mine
              ? "bg-primary text-primary-fg"
              : "border border-border bg-bg",
          m.kind === "roll" && "font-mono text-xs",
        )}
      >
        {m.body}
      </div>
      {m.clues && m.clues.length > 0 && (
        <ul className="mt-2 grid gap-1.5">
          {m.clues.map((c) => (
            <li
              key={c.id}
              className="flex gap-2 rounded-control border border-brass/35 bg-elevated px-3 py-2"
            >
              <MapPinned className="mt-0.5 size-3.5 shrink-0 text-brass" />
              <div className="min-w-0">
                <p className="text-[11px] tracking-wide text-brass">
                  钉上线索板 · {c.name}
                </p>
                <p className="text-xs text-muted">{c.hint}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function LocationHistoryBar({
  threads,
  meId,
}: {
  threads: TableSnap["locationThreads"];
  meId: string;
}) {
  const [openPlace, setOpenPlace] = useState<string | null>(null);
  if (!threads.length) return null;
  const openThread = threads.find((thread) => thread.placeId === openPlace);

  return (
    <div className="shrink-0 border-b border-border bg-bg/35">
      <div className="flex items-center gap-2 overflow-x-auto px-4 py-2">
        <span className="shrink-0 text-[10px] tracking-[0.16em] text-subtle">
          曾到过
        </span>
        {threads.map((thread) => {
          const open = thread.placeId === openPlace;
          return (
            <button
              key={thread.placeId}
              type="button"
              aria-expanded={open}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[11px] transition",
                open
                  ? "border-brass bg-brass/10 text-brass"
                  : "border-border text-muted hover:border-brass/60 hover:text-fg",
              )}
              onClick={() => setOpenPlace(open ? null : thread.placeId)}
            >
              {thread.name} · {thread.messages.length}
            </button>
          );
        })}
      </div>
      {openThread ? (
        <section
          aria-label={`${openThread.name}的历史对话`}
          className="max-h-[42dvh] overflow-y-auto border-t border-border px-5 py-4"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-sm text-fg">{openThread.name}</p>
              <p className="text-[11px] text-subtle">只收录你在这里经历过的对话</p>
            </div>
            <button
              type="button"
              className="text-xs text-muted hover:text-fg"
              onClick={() => setOpenPlace(null)}
            >
              收起
            </button>
          </div>
          <div className="space-y-4">
            {openThread.messages.map((message) => (
              <MessageBubble
                key={message.id}
                m={message}
                mine={message.user_id === meId}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** SPEC 0003, SPEC 0011: the player's gesture for a roll the authority
 * froze; the dice and any bonus are the authority's, never the page's. */
function RollButton({
  code,
  roll,
}: {
  code: string;
  roll: PendingRoll;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const label =
    roll.kind === "init"
      ? "先攻"
      : roll.kind === "damage"
        ? "伤害"
        : roll.kind === "death"
          ? "死亡豁免"
          : roll.kind === "heal"
        ? "治疗"
        : roll.kind === "attack"
            ? "攻击"
            : roll.kind === "save"
              ? "豁免"
            : (SKILLS.find((s) => s.id === roll.skill)?.label ??
              ABILITY_LABEL[roll.ability as keyof typeof ABILITY_LABEL] ??
              roll.ability);
  return (
    <div className="rounded-panel border border-border bg-elevated px-3 py-3">
      <p className="text-xs text-muted">{roll.reason}</p>
      {roll.authoritative ? (
        <p className="mt-1 text-xs text-subtle">{roll.dice}{roll.advantage ? " · 优势" : roll.disadvantage ? " · 劣势" : ""}</p>
      ) : null}
      <Button
        className="mt-3"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await resolveRoll({ data: { code, rollId: roll.id } });
            if (!tableActionAccepted(res)) toast.error(String(res.error ?? "没有完成这次掷骰"));
            else void qc.invalidateQueries({ queryKey: ["table", code] });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "骰子打滑了");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "掷出……" : `掷 ${label}${roll.dc > 0 ? ` DC ${roll.dc}` : ""}`}
      </Button>
    </div>
  );
}

/** The other players at the table and the squad controls between them; the
 * viewer's own character is in the character panel. */
function PartyBoard({
  party,
  meId,
  isHost,
  code,
  placeNames,
  clocks,
  partySplit,
  squads,
  squadInvite,
  places,
  myHitPoints,
}: {
  party: TableSnap["characters"];
  meId: string;
  isHost?: boolean;
  code: string;
  placeNames?: Record<string, string>;
  clocks?: Record<string, { beats: number; minutes: number; lag: number }>;
  partySplit?: boolean;
  squads?: { ids: string[]; captain: string }[];
  squadInvite?: { from: string; to: string; fromName: string } | null;
  places?: Record<string, string>;
  myHitPoints?: { current: number; maximum: number };
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [kickId, setKickId] = useState<string | null>(null);
  const someoneAhead = Object.values(clocks ?? {}).some((c) => c.lag > 0);
  const groups = squads ?? [];
  const nameOf = (id: string) =>
    party.find((p) => p.userId === id)?.sheet.name || "同伴";
  const myGroup = groups.find((g) => g.ids.includes(meId));
  const inviteToMe = squadInvite?.to === meId ? squadInvite : null;

  async function act(key: string, fn: () => Promise<TableActionResponse>) {
    if (busy) return;
    setBusy(key);
    try {
      const res = await fn();
      if (!tableActionAccepted(res)) toast.error(String(res.error ?? "做不到"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "做不到");
    } finally {
      setBusy(null);
    }
  }

  if (!party.length) {
    return <p className="text-sm text-muted">还没有锁定的人物卡。</p>;
  }
  return (
    <div className="grid min-w-0 gap-2">
      {inviteToMe ? (
        <div className="rounded-control border border-brass/40 bg-brass/10 px-3 py-2">
          <p className="text-xs text-fg">{inviteToMe.fromName} 邀请你组队。队长可组织整队移动；你仍可直接个人行动，单独移动或休息时会提示并离队。</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act("yes", () => answerSquad({ data: { code, accept: true } }))}
            >
              同意
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => act("no", () => answerSquad({ data: { code, accept: false } }))}
            >
              拒绝
            </Button>
          </div>
        </div>
      ) : null}
      <ul className="grid min-w-0 gap-2">
      {party.map((p) => {
        const sheet = p.sheet;
        const identityOnly = p.visibility === "identityOnly";
        const race = raceById(sheet.raceId)?.name;
        const cls = classById(sheet.classId)?.name;
        const together =
          (places?.[meId] ?? "") !== "" &&
          places?.[meId] === places?.[p.userId];
        const groupedWithMe = Boolean(
          myGroup && p.userId !== meId && myGroup.ids.includes(p.userId),
        );
        const theirGroup = groups.find((g) => g.ids.includes(p.userId));
        return (
          <li key={p.userId} className="min-w-0 overflow-hidden rounded-panel border border-border">
            <div className="flex w-full items-start justify-between gap-2 px-3 py-3">
              <div className="min-w-0 flex-1 text-left">
                <span className="font-medium">{sheet.name || "未名"}</span>
                {p.userId === meId && (
                  <span className="ml-2 text-[10px] text-brass">你</span>
                )}
                {theirGroup && theirGroup.ids.length > 1 ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-subtle">
                      组队 · {theirGroup.ids.map(nameOf).join("、")}
                    </span>
                    {p.userId === theirGroup.captain ? (
                      <span className="rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 text-[11px] text-brass">
                        队长
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {placeNames?.[p.userId] ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 text-[11px] text-brass">
                      所在 · {placeNames[p.userId]}
                    </span>
                    {partySplit && clocks?.[p.userId] ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-subtle">
                        {clocks[p.userId].lag > 0
                          ? `领先 ${clocks[p.userId].lag} 拍，先等另一边`
                          : someoneAhead
                            ? "待补这一拍"
                            : `第 ${clocks[p.userId].beats} 拍`}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span className="mt-0.5 block text-xs text-subtle">
                  {identityOnly ? (
                    "人物详情仅本人可见"
                  ) : (
                    <>
                      {race}
                      {cls}
                      {" · 生命 "}
                      <span className="font-display tabular-nums text-fg">
                        {p.userId === meId ? myHitPoints?.current ?? sheet.hp.current : sheet.hp.current}
                      </span>
                      <span className="tabular-nums">/
                        {p.userId === meId ? myHitPoints?.maximum ?? sheet.hp.max : sheet.hp.max}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {p.userId !== meId && together && !groupedWithMe ? (
                  squadInvite?.from === meId && squadInvite.to === p.userId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(busy)}
                      onClick={() => act("cancel-inv", () => cancelSquadInvite({ data: { code } }))}
                    >
                      取消邀请
                    </Button>
                  ) : (
                    <Button variant="secondary"
                      size="sm"
                      disabled={Boolean(busy) || squadInvite?.from === meId}
                      onClick={() =>
                        act(`inv-${p.userId}`, () =>
                          inviteSquad({ data: { code, targetUserId: p.userId } }),
                        )
                      }
                    >
                      组队
                    </Button>
                  )
                ) : null}
                {p.userId !== meId &&
                myGroup &&
                myGroup.captain === meId &&
                myGroup.ids.includes(p.userId) ? (
                  <Button variant="secondary"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      act(`cap-${p.userId}`, () =>
                        passCaptain({ data: { code, toUserId: p.userId } }),
                      )
                    }
                  >
                    交队长
                  </Button>
                ) : null}
                {p.userId === meId && myGroup && myGroup.ids.length > 1 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={() => act("leave", () => leaveSquadNow({ data: { code } }))}
                  >
                    离队
                  </Button>
                ) : null}
                {isHost && p.userId !== meId ? (
                  kickId === p.userId ? (
                    <div className="flex flex-col items-end gap-1">
                      <Button variant="danger"
                        size="sm"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          act(`kick-${p.userId}`, async () => {
                            const res = await kickMember({
                              data: { code, userId: p.userId },
                            });
                            setKickId(null);
                            if (res.ok) toast.success("已请离。对方用房间码还能再进来。");
                            return res;
                          })
                        }
                      >
                        确认请离
                      </Button>
                      <button
                        type="button"
                        className="text-[11px] text-subtle hover:text-fg"
                        onClick={() => setKickId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(busy)}
                      onClick={() => setKickId(p.userId)}
                    >
                      请离
                    </Button>
                  )
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
      </ul>
    </div>
  );
}

/** One tab of the character panel: what the character can do now (the
 * abilities Rules lists, and rests), what it carries, and who it is. */
function CharacterDetail({
  tab,
  actionList,
  onDraft,
  sheet,
  canEdit,
  code,
  inCombat,
  meId,
  partyCount,
  activeRule,
  authoritativeCharacter,
  authoritativeActivities,
}: {
  tab: CharacterPanelTab;
  actionList?: ReactNode;
  /** Puts a sentence about an item in the composer; absent while a decision waits. */
  onDraft?: (sentence: string) => void;
  sheet: CharacterSheet;
  canEdit: boolean;
  code: string;
  inCombat: boolean;
  meId?: string;
  partyCount?: number;
  activeRule?: NonNullable<TableSnap["state"]["ruleProjection"]>["viewer"];
  authoritativeCharacter?: AuthoritativeControlledCharacter;
  authoritativeActivities?: NonNullable<TableSnap["state"]["authoritative"]>["activities"];
}) {
  const live = ensureGear(sheet);
  const spellIds = [
    ...new Set([...live.cantrips, ...live.prepared, ...live.spellbook]),
  ];
  const stocks = listStocks(live);
  const packed = ensureResources(live);
  if (tab === "inventory") {
    return (
      <InventoryPanel
        inventory={authoritativeCharacter?.inventory}
        canEdit={canEdit}
        code={code}
        onDraft={onDraft}
      />
    );
  }
  if (tab === "profile") {
    return (
      <div className="grid min-w-0 gap-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          {ABILITIES.map((a) => (
            <div
              key={a}
              className="rounded-control border border-border p-2 text-center"
            >
              <p className="text-[10px] text-subtle">{ABILITY_LABEL[a]}</p>
              <p className="font-display text-lg tabular-nums">{live.scores[a]}</p>
              <p className="text-xs text-muted tabular-nums">
                {signed(abilityMod(live.scores[a]))}
              </p>
            </div>
          ))}
        </div>
        <Disclosure
          title="技能"
          hint={`${live.skills.length} 项熟练`}
        >
          <ul className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
            {SKILLS.filter((s) => live.skills.includes(s.id)).map((s) => (
              <li key={s.id}>
                {s.label}{" "}
                <span className="tabular-nums text-muted">
                  {signed(skillBonus(live, s.id as SkillId))}
                </span>
                {live.expertise.includes(s.id as SkillId) && (
                  <span className="ml-1 text-[10px] text-brass">专精</span>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
        <ProficiencyFold sheet={live} />
        {live.features.length > 0 && (
          <Disclosure title="特性" hint={`${live.features.length} 条`}>
            <ul className="grid min-w-0 gap-2">
              {live.features.map((f) => (
                <FeatureLine
                  key={f.slice(0, 24)}
                  text={f}
                  stock={stockForFeature(f, stocks)}
                />
              ))}
            </ul>
          </Disclosure>
        )}
        {spellIds.length > 0 && (
          <Disclosure title="法术" hint={`${spellIds.length} 个`}>
            <ul className="grid min-w-0 gap-2">
              {spellIds.map((id) => {
                const spell = spellById(id);
                if (spell === undefined) return null;
                return (
                  <li key={id} className="min-w-0">
                    <details>
                      <summary className="cursor-pointer text-xs text-fg">
                        {spell.name}
                        <span className="ml-1.5 text-[11px] text-subtle">{spell.level === 0 ? "戏法" : `${spell.level} 环`}</span>
                      </summary>
                      <p className="mt-1 text-[11px] text-subtle">
                        {[spell.time, spell.range, spell.duration].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted">{spell.text}</p>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Disclosure>
        )}
        {(live.appearance || live.trait) && (
          <Disclosure title="角色" hint={live.appearance ? "外貌" : "展开"}>
            {live.appearance && (
              <p className="text-xs leading-relaxed text-muted">{live.appearance}</p>
            )}
            {live.trait && (
              <p className="mt-2 text-xs text-muted">特质：{live.trait}</p>
            )}
            {live.ideal && (
              <p className="mt-1 text-xs text-muted">理想：{live.ideal}</p>
            )}
            {live.bond && (
              <p className="mt-1 text-xs text-muted">羁绊：{live.bond}</p>
            )}
            {live.flaw && (
              <p className="mt-1 text-xs text-muted">缺陷：{live.flaw}</p>
            )}
          </Disclosure>
        )}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-3 text-sm">
      {actionList}
      <ResourcePanel
        sheet={packed}
        canEdit={canEdit}
        code={code}
        inCombat={inCombat}
        meId={meId}
        partyCount={partyCount ?? 1}
        activeRule={activeRule}
        authoritativeCharacter={authoritativeCharacter}
        authoritativeActivities={authoritativeActivities}
      />
    </div>
  );
}

/** SPEC 0004 §4: the sheet's tools (marking Expertise), weapons and armor,
 * derived from its class, race, subclass, background and tool choices. */
function ProficiencyFold({ sheet }: { sheet: CharacterSheet }) {
  const { tools, weapons, armor } = sheetProficiencies(sheet);
  const rows = [
    { title: "工具", entries: tools },
    { title: "武器", entries: weapons },
    { title: "护甲", entries: armor },
  ];
  return (
    <Disclosure title="熟练" hint={`工具 ${tools.length} · 武器 ${weapons.length} · 护甲 ${armor.length}`}>
      <dl className="grid gap-1 text-xs">
        {rows.map((row) => (
          <div key={row.title} className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-subtle">{row.title}</dt>
            <dd className="min-w-0 text-muted">
              {row.entries.length === 0
                ? "无"
                : row.entries.map((entry, index) => (
                  <span key={entry.id}>
                    {index > 0 && "、"}
                    {entry.label}
                    {entry.expertise && <span className="ml-1 text-[10px] text-brass">专精</span>}
                  </span>
                ))}
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

function ResourcePanel({
  sheet,
  canEdit,
  code,
  inCombat,
  meId,
  partyCount,
  activeRule,
  authoritativeCharacter,
  authoritativeActivities,
}: {
  sheet: CharacterSheet;
  canEdit: boolean;
  code: string;
  inCombat: boolean;
  meId?: string;
  partyCount: number;
  activeRule?: NonNullable<TableSnap["state"]["ruleProjection"]>["viewer"];
  authoritativeCharacter?: AuthoritativeControlledCharacter;
  authoritativeActivities?: NonNullable<TableSnap["state"]["authoritative"]>["activities"];
}) {
  const r = sheet.resources!;
  const [busy, setBusy] = useState<string | null>(null);
  const [rest, setRest] = useState<null | "short" | "long">(null);
  const [dice, setDice] = useState(0);
  const [arcaneRecoverySlotLevels, setArcaneRecoverySlotLevels] = useState<number[]>([]);
  const hdLeft = authoritativeCharacter?.restRecoveryOptions?.shortRest?.hitDiceMaximumSpend
    ?? (authoritativeCharacter === undefined ? left(r.hitDice) : 0);
  const hitDieSides = authoritativeCharacter?.restRecoveryOptions?.shortRest?.hitDieSides
    ?? r.hitDice.die;
  const con = abilityMod(authoritativeCharacter?.abilityScores?.con ?? sheet.scores.con);
  const needVote = partyCount > 1;
  const authoritativeRest = authoritativeActivities?.find((activity) =>
    activity.status === "active" && activity.restKind !== undefined);

  async function go(key: string, fn: () => Promise<TableActionResponse>) {
    if (!canEdit || busy) return;
    setBusy(key);
    try {
      const res = await fn();
      if (!tableActionAccepted(res)) toast.error(String(res.error ?? "做不到"));
      else setRest(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "做不到");
    } finally {
      setBusy(null);
    }
  }

  if (rest === "short") {
    return (
      <div className="rounded-control border border-brass/40 px-3 py-3">
        <p className="font-display text-sm">短休 · 约一小时</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          坐下包扎、换绷带。引导神力、动作如潮、回气、战术骰会回来。法术位不回来。
        </p>
        <div className="mt-3">
          <p className="text-xs font-medium">花生命骰回血</p>
          <p className="mt-0.5 text-xs text-muted">
            还剩{" "}
            <span className="font-display tabular-nums text-fg">{hdLeft}</span>
            {" "}颗 d{hitDieSides}。每颗大约 1d{hitDieSides}＋{con} 生命，不会超过上限 {sheet.hp.max}。现在{" "}
            <span className="font-display tabular-nums text-fg">{sheet.hp.current}</span>
            <span className="tabular-nums text-subtle">/{sheet.hp.max}</span>
            。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={dice <= 0} onClick={() => setDice((n) => Math.max(0, n - 1))}>
              −
            </Button>
            <span className="min-w-8 text-center font-display text-lg tabular-nums text-fg">{dice}</span>
            <Button size="sm" variant="secondary" disabled={dice >= hdLeft} onClick={() => setDice((n) => Math.min(hdLeft, n + 1))}>
              ＋
            </Button>
            <span className="text-xs text-subtle">颗</span>
          </div>
        </div>
        {authoritativeCharacter !== undefined ? (
          <div className="mt-3">
            <ArcaneRecoveryPicker
              character={authoritativeCharacter}
              selection={arcaneRecoverySlotLevels}
              disabled={Boolean(busy)}
              onChange={setArcaneRecoverySlotLevels}
            />
          </div>
        ) : null}
        {inCombat && (
          <p className="mt-2 text-[11px] text-brass">战斗中不能休整。</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            disabled={Boolean(busy) || inCombat}
            onClick={() =>
              go("s", () =>
                restNow({
                  data: {
                    code,
                    kind: "short",
                    mode: needVote ? "group" : "personal",
                    hitDice: dice,
                    arcaneRecoverySlotLevels,
                  },
                }),
              )
            }
          >
            {busy === "s" ? "结算……" : needVote ? "提议队伍短休" : "开始短休"}
          </Button>
          {needVote ? (
            <Button
              variant="secondary"
              disabled={Boolean(busy) || inCombat}
              onClick={() =>
                go("solo-s", () =>
                  restNow({
                    data: {
                      code,
                      kind: "short",
                      mode: "personal",
                      hitDice: dice,
                      arcaneRecoverySlotLevels,
                    },
                  }),
                )
              }
            >
              {busy === "solo-s" ? "结算……" : "单独短休"}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={Boolean(busy)} onClick={() => setRest(null)}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  if (rest === "long") {
    return (
      <div className="rounded-control border border-brass/40 px-3 py-3">
        <p className="font-display text-sm">长休 · 过夜</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          睡够大约八小时。生命回满，一环/二环、狂暴、战争祭司、引导、如潮都回来。生命骰补回一半。
        </p>
        <p className="mt-2 text-xs text-muted">
          口粮{" "}
          <span className="font-display tabular-nums text-fg">{r.ration}</span>
          {" "}份。口粮按旅途与环境规则另行消耗，不会自行改写 5e 长休恢复量。
        </p>
        {inCombat && (
          <p className="mt-2 text-[11px] text-brass">战斗中不能休整。</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            disabled={Boolean(busy) || inCombat}
            onClick={() => go("l", () => restNow({ data: { code, kind: "long", mode: needVote ? "group" : "personal" } }))}
          >
            {busy === "l" ? "结算……" : needVote ? "提议队伍长休" : "开始长休"}
          </Button>
          {needVote ? (
            <Button
              variant="secondary"
              disabled={Boolean(busy) || inCombat}
              onClick={() =>
                go("solo-l", () =>
                  restNow({ data: { code, kind: "long", mode: "personal" } }),
                )
              }
            >
              {busy === "solo-l" ? "结算……" : "单独长休"}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={Boolean(busy)} onClick={() => setRest(null)}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-control border border-border px-3 py-3">
      {canEdit ? authoritativeActivities?.filter(activity => activity.status === "active" && activity.attention).map(activity => (
        <div key={activity.activityId} className="mb-3 rounded-control border border-brass/40 bg-brass/10 px-3 py-2" role="status">
          <p className="text-xs text-fg">活动途中有新消息，时间推进已暂停。</p>
          {activity.attention!.messages.map((message, index) => <p key={index} className="mt-1 text-xs">{message}</p>)}
          <p className="mt-1 text-xs text-muted">已经过的时间保留，活动仍在进行。{inCombat ? "当前由战斗回合接管。" : "请选择继续，或结束当前活动后采取其他行动。"}</p>
          {(["continue", "stop"] as const).map(decision => <Button key={decision} size="sm" variant="ghost" className="mt-2"
            disabled={Boolean(busy) || inCombat} onClick={() => go(`activity-${decision}`, () => controlActivity({ data: {
              code, activityId: activity.activityId, attentionRootActionId: activity.attention!.rootActionId, decision,
            } }))}>{decision === "continue" ? "继续当前活动" : "结束当前活动"}</Button>)}
        </div>
      )) : null}
      {canEdit && (activeRule?.rest?.status === "resting" || authoritativeRest !== undefined) ? (
        <div className="mb-3 rounded-control border border-brass/40 bg-brass/10 px-3 py-2">
          <p className="text-xs text-fg">
            {activeRule?.rest?.status === "resting"
              ? `你正在${activeRule.rest.kind === "long" ? "长休" : "短休"}。还需约 ${Math.ceil(Math.max(0, activeRule.rest.requiredSeconds - (activeRule.timeline.fictionSeconds - activeRule.rest.startedAt)) / 60)} 分钟虚构时间；拍数不会替代这段时长。`
              : `你正在${authoritativeRest?.restKind === "long" ? "长休" : "短休"}。恢复选择已经冻结；只有完整虚构时长过去且 Activity 完成后才会结算。`}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={Boolean(busy)}
            onClick={() => go("wake-v2", () => cancelRest({ data: { code } }))}
          >
            提前结束自己的休息
          </Button>
        </div>
      ) : null}
      <p className="text-xs font-medium">休整</p>
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(busy)}
            onClick={() => {
              setArcaneRecoverySlotLevels([]);
              setRest("short");
            }}
          >
            短休
          </Button>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => setRest("long")}>
            长休
          </Button>
        </div>
      )}
    </div>
  );
}

function stockForFeature(text: string, stocks: StockItem[]) {
  const hit = (id: string) => stocks.find((s) => s.id === id);
  if (/战争祭司/.test(text)) return hit("warPriest");
  if (/引导神力|导向打击|维持生命/.test(text)) return hit("channel");
  if (/狂暴/.test(text)) return hit("rage");
  if (/动作如潮|surg/.test(text)) return hit("surge");
  if (/回气/.test(text)) return hit("secondWind");
  if (/战术|优越/.test(text)) return hit("superiority");
  if (/奥术结界/.test(text)) return hit("ward");
  return undefined;
}

function FeatureLine({ text, stock }: { text: string; stock?: StockItem }) {
  const [open, setOpen] = useState(false);
  const title = text.split(/[：:]/)[0] ?? text;
  const rest = text.slice(title.length).replace(/^[：:]/, "");

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className="min-w-0 max-w-full rounded-control border border-border bg-bg/40">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 px-2.5 py-2 text-left text-xs"
      >
        <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{title}</span>
        {stock && (
          <span className="ml-auto shrink-0 tabular-nums">
            <span className="font-display text-sm text-fg">{stock.remain}</span>
            {stock.max != null && (
              <span className="text-subtle">/{stock.max}</span>
            )}
          </span>
        )}
        {!open && !stock && rest && (
          <span className="min-w-0 flex-[1_1_10rem] whitespace-normal break-words text-subtle [overflow-wrap:anywhere]">
            {rest}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/70 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label={`${title}详情`}
              className="max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-lg rounded-shell border border-border bg-surface shadow-2xl"
            >
              <header className="sticky top-0 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{title}</p>
                  {stock && (
                    <p className="mt-0.5 text-xs text-subtle">
                      剩余 {stock.remain}{stock.max != null ? `/${stock.max}` : ""}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted hover:text-fg"
                  onClick={() => setOpen(false)}
                >
                  关闭
                </button>
              </header>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-4 py-4 text-sm leading-7 text-fg">
                {text}
              </p>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}

type PresentCharacter = {
  id: string;
  name: string;
  kind: "player" | "npc";
  intro: string;
  tenureStatus: "active" | "dead" | "retired" | "missing" | "npcTransitioned";
  alive: boolean;
  conscious: boolean;
};

const TENURE_LABEL: Record<PresentCharacter["tenureStatus"], string> = {
  active: "在任",
  dead: "死亡",
  retired: "退役",
  missing: "失踪",
  npcTransitioned: "转为 NPC",
};

/** The states that decide whether someone can notice what happens here
 * (SPEC 0005 §6.2): present, in tenure, alive and conscious. */
function presenceStates(person: PresentCharacter): Array<[label: string, usual: boolean]> {
  return [
    ["在场", true],
    [TENURE_LABEL[person.tenureStatus], person.tenureStatus === "active"],
    [person.alive ? "存活" : "已死亡", person.alive],
    ...(person.alive ? [[person.conscious ? "清醒" : "失去意识", person.conscious] as [string, boolean]] : []),
  ];
}

function PresenceBoard({ people }: { people: PresentCharacter[] }) {
  if (!people.length) {
    return (
      <p className="text-sm text-muted">
        身边没有看得见的人。在场的人会出现在这里。
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {people.map((person) => (
        <li
          key={person.id}
          data-present-character={person.id}
          className="rounded-panel border border-border bg-bg/40 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{person.name}</p>
            {person.kind === "player" ? (
              <span className="text-[10px] text-subtle">同伴</span>
            ) : null}
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${person.name}的状态`}>
            {presenceStates(person).map(([label, usual]) => (
              <li
                key={label}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px]",
                  usual ? "border-border text-muted" : "border-danger/40 text-danger",
                )}
              >
                {label}
              </li>
            ))}
          </ul>
          {person.intro ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">{person.intro}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ClueBoard({ clues }: { clues: TableSnap["state"]["clues"] }) {
  const discoveries = clues.filter((clue) => !clue.background);
  const background = clues.filter((clue) => clue.background);
  function notes(card: KnowledgeCard) {
    // SPEC 0005 §6、SPEC 0010 §7：完整持有不等于已核实，记录保留各自性质。
    return <ul className="mt-2 space-y-3">{(card.notes ?? [card]).map(note => (
      <li key={note.id}>
        <p className="text-[11px] text-subtle">{note.hint}{"source" in note && note.source ? ` · ${note.source}` : ""}{note.layer === "talk" ? " · 信息不完整" : ""}</p>
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">{note.text}</p>
      </li>
    ))}</ul>;
  }
  return (
    <div>
      <p className="mb-3 text-[11px] text-subtle">记录你所控制角色已知的信息。同一对象的观察放在一起，他人的说法与推断保留各自来源。</p>
      {!discoveries.length ? <p className="text-sm text-muted">暂时没有整理出的线索。</p> : null}
      <ul className="grid gap-3">
        {discoveries.map(card => <li key={card.id} className="rounded-panel border border-border bg-bg/40 p-3">
          <p className="font-medium">{card.name}</p>
          {card.notes && card.notes.length > 1 ? <>
            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted">{card.text}</p>
            <details className="mt-2"><summary className="cursor-pointer text-xs text-brass">查看 {card.notes.length} 条相关记录</summary>{notes(card)}</details>
          </> : notes(card)}
        </li>)}
      </ul>
      {background.map(card => <details key={card.id} className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs text-subtle">其他见闻 · {card.notes?.length ?? 1} 条</summary>
        {notes(card)}
      </details>)}
    </div>
  );
}

async function playTts(
  roomId: string,
  messageId: string,
  presentation: {
    isCurrent(): boolean;
    register(audio: HTMLAudioElement | null): void;
  },
) {
  try {
    const out = await speakNarration({ data: { roomId, messageId } });
    if (!out.ok || !presentation.isCurrent()) return;
    const bytes = Uint8Array.from(atob(out.b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: out.mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    presentation.register(audio);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      presentation.register(null);
    };
    if (!presentation.isCurrent()) {
      audio.pause();
      URL.revokeObjectURL(url);
      presentation.register(null);
      return;
    }
    await audio.play();
  } catch {
    /* autoplay blocked until a gesture */
  }
}

async function blobToB64(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
