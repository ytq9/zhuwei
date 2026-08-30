import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { TacticalMap } from "@/components/tactical-map";
import { InventoryPanel } from "@/components/inventory-panel";
import type { Ability, CharacterSheet, SkillId } from "@/lib/dnd/types";
import { ABILITIES, ABILITY_LABEL, SKILLS } from "@/lib/dnd/types";
import { classById, raceById, spellById } from "@/lib/dnd/catalog";
import { ensureGear, skillBonus, spellcastingProfile } from "@/lib/dnd/compute";
import { spellCardFacts } from "@/lib/dnd/spell-card";
import { spellDefinition, spellMaxTargets } from "@/lib/rules/spell-catalog";
import type { TacticalProjection } from "@/lib/rules/tactical-projection";
import { abilityMod, cn, signed } from "@/lib/utils";
import { transcribeAudio, speakNarration } from "@/lib/voice/client";
import { adjustSafetyPresentation, resolveRoll, retryNarration, sendAction, joinCombat, endTurn, leaveFight, resolveReact, restNow, cancelRest, castSpell, useFeature, extraAttack, inviteSquad, answerSquad, leaveSquadNow, approveSquadQueue, passCaptain, leaveTable, cancelSquadInvite, kickMember } from "@/lib/table/client";
import {
  tableActionAccepted,
  type TableActionResponse,
} from "@/lib/table/authoritative-client";
import {
  arcaneRecoveryAvailability,
  changeArcaneRecoverySelection,
  publicNarrationRecoveryReason,
  type ArcaneRecoverySlotLevel,
} from "@/lib/table/authoritative";
import type { PendingRoll } from "@/lib/kp/prompt";
import type { PublicCombat } from "@/lib/kp/combat";
import type { KpModelId } from "@/lib/kp/models";
import { eligibleBoosts } from "@/lib/dnd/boosts";
import { ensureResources, left, listStocks, type StockItem } from "@/lib/dnd/resources";
import { toast } from "sonner";
import { Mic, Send, ScrollText, UserRound, MapPinned, Users } from "lucide-react";

export type TableMessage = {
  id: string;
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
  localId?: string;
  deliveryIdAtFirstSubmission?: string;
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
      ...(typeof parsed.deliveryIdAtFirstSubmission === "string"
        ? { deliveryIdAtFirstSubmission: parsed.deliveryIdAtFirstSubmission }
        : {}),
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
          choiceKind: "reaction";
          candidateAbilityRefs: string[];
          targetEntityId: string;
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
    clues: {
      id: string;
      name: string;
      text: string;
      hint: string;
      layer: "talk" | "full";
    }[];
    npcs: { id: string; name: string; intro: string }[];
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
        restKind?: "short" | "long";
      }>;
      inCombat?: boolean;
      safetyPresentation?: {
        status: "paused" | "resumed";
        presentationAdjustment: "fadeToBlack" | "reduceDetail" | "skipSensitiveContent" | null;
      };
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
      narrationRecovery?: {
        kind: "available";
        capability: string;
        state: "pending" | "rejected" | "retryableFailure";
      };
    } | null;
    restVote?: {
      kind: "short" | "long";
      fromName: string;
      agreed: string[];
      waiting: string[];
    } | null;
    restHold?: {
      kind: "short" | "long";
      resters: string[];
      fromName: string;
      needBeats: number;
      remain: number;
    } | null;
    squads?: { ids: string[]; captain: string }[];
    squadInvite?: { from: string; to: string; fromName: string } | null;
    squadQueue?: { id: string; userId: string; name: string; body: string; beat: number }[];
    combat?: PublicCombat | null;
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
        availableRollBoosts: Array<"guidance" | "inspiration" | "lucky">;
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

export function PlayTable({
  code,
  snap,
}: {
  code: string;
  snap: TableSnap;
}) {
  const [tab, setTab] = useState<"sheet" | "npcs" | "clues" | "log">("sheet");
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
    { id: string; body: string; name: string; deliveryIdAtSubmission: string | undefined }[]
  >([]);
  const safetyPresentation = snap.state.authoritative?.safetyPresentation;
  const viewerNarrationRecovery = snap.state.authoritative?.narrationRecovery;
  // A newly submitted line supersedes the previous delivery problem in the
  // conversation UI. If this new line also needs recovery, the refreshed
  // authoritative snapshot will replace it with that newer recovery record.
  const visibleViewerNarrationRecovery = localSays.length === 0
    ? viewerNarrationRecovery
    : undefined;
  const safetyPaused = safetyPresentation?.status === "paused";
  const visibleMessages = safetyPaused
    ? snap.messages.filter((message) => message.id !== snap.state.currentDeliveryId)
    : snap.messages;
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
  const visibleCurrentDeliveryId = visibleMessages.some(
    (message) => message.id === snap.state.currentDeliveryId,
  )
    ? snap.state.currentDeliveryId
    : undefined;
  const conversationMessages = visibleCurrentDeliveryId
    ? [
        ...visibleMessages.flatMap((message) => {
          if (message.id !== visibleCurrentDeliveryId) return [message];
          const submittedBefore = localSays
            .filter((local) => local.deliveryIdAtSubmission !== visibleCurrentDeliveryId)
            .map(localMessage);
          return [...submittedBefore, message];
        }),
        ...localSays
          .filter((local) => local.deliveryIdAtSubmission === visibleCurrentDeliveryId)
          .map(localMessage),
      ]
    : [...visibleMessages, ...localSays.map(localMessage)];
  const currentPending = safetyPaused ? undefined : snap.state.pendingInputs?.[0];
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
  }, [conversationMessages.length]);

  useEffect(() => {
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
    if (!safetyPaused) return;
    presentationEpochRef.current += 1;
    activeNarrationRef.current?.pause();
    activeNarrationRef.current = null;
  }, [safetyPaused]);

  useEffect(() => {
    setLocalSays((prev) =>
      prev.filter(
        (l) =>
          !snap.messages.some(
            (m) =>
              m.user_id === snap.me.userId &&
              m.kind === "say" &&
              m.body === l.body,
          ),
      ),
    );
  }, [snap.messages, snap.me.userId]);

  async function resumeWithSafetyAdjustment(
    presentationAdjustment: "fadeToBlack" | "reduceDetail" | "skipSensitiveContent",
  ) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await adjustSafetyPresentation({
        data: { code, presentationAdjustment },
      });
      if (!tableActionAccepted(result)) {
        toast.error(result.error ?? "没能提交安全调整");
        return;
      }
      void qc.invalidateQueries({ queryKey: ["table", code] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "没能提交安全调整");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function retryViewerNarration() {
    if (sendingRef.current || visibleViewerNarrationRecovery?.kind !== "available") return;
    sendingRef.current = true;
    setSending(true);
    setSubmissionError(null);
    try {
      const result = await retryNarration({
        data: { code, capability: visibleViewerNarrationRecovery.capability },
      });
      if (result.action === "committed" && result.narration === "published") {
        clearRememberedSubmission();
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
    rememberSubmission(submission);
    sendingRef.current = true;
    setSending(true);
    setSubmissionError(null);
    const localId = submission.localId;
    const composerSubmission = submission.source === "composer" && localId !== undefined;
    if (composerSubmission) {
      const mineName =
        snap.characters.find((c) => c.userId === snap.me.userId)?.sheet.name || "你";
      setLocalSays((ls) => ls.some((local) => local.id === localId)
        ? ls
        : [...ls, {
            id: localId,
            body: submission.payload.text,
            name: mineName,
            deliveryIdAtSubmission: submission.deliveryIdAtFirstSubmission,
          }]);
      setText((draft) => draft.trim() === submission.payload.text ? "" : draft);
    }
    try {
      const res = await sendAction({
        data: submission.payload,
      });
      const returnedSubmissionId = typeof res.submissionId === "string"
        ? res.submissionId.trim()
        : "";
      const stableSubmission = returnedSubmissionId
        && returnedSubmissionId !== submission.payload.submissionId
        ? {
            ...submission,
            payload: { ...submission.payload, submissionId: returnedSubmissionId },
          }
        : submission;
      const explicitAction = typeof res.action === "string" ? res.action : undefined;
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
        setSubmissionError(message);
        toast.error(message);
      } else if ("queued" in res && res.queued) {
        clearRememberedSubmission();
        if (localId !== undefined) {
          setLocalSays((ls) => ls.filter((x) => x.id !== localId));
        }
        toast.message("已入队内缓冲。队长本拍内未批准就会消失。");
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
      rememberSubmission({ ...submission, lastError: message });
      setSubmissionError(message);
      toast.error(message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function submit() {
    const body = text.trim();
    if (!body || sendingRef.current) return;
    const existing = submissionRef.current;
    if (existing !== null) {
      if (existing.source === "composer" && existing.fingerprint === body) {
        await submitRememberedAction(existing);
      } else {
        requireRecoveryFirst();
      }
      return;
    }
    const pendingInputId = snap.state.pendingInputs?.[0]?.pendingInputId;
    const submissionId = crypto.randomUUID();
    const submission: RecoverableSendAction = {
      source: "composer",
      fingerprint: body,
      payload: {
        code,
        text: body,
        submissionId,
        ...(pendingInputId ? { pendingInputId } : {}),
      },
      localId: `local-${submissionId}`,
      deliveryIdAtFirstSubmission: snap.state.currentDeliveryId,
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
      } else {
        requireRecoveryFirst();
      }
      return;
    }
    const submissionId = crypto.randomUUID();
    const submission: RecoverableSendAction = {
      source: "pending",
      fingerprint,
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
      requireRecoveryFirst();
      return;
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
      } else {
        requireRecoveryFirst();
      }
      return;
    }
    const submissionId = crypto.randomUUID();
    const submission: RecoverableSendAction = {
      source: "pending",
      fingerprint,
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

  return (
    <div className="grid min-h-0 min-w-0 w-full flex-1 grid-rows-[minmax(0,1fr)_minmax(13.5rem,38dvh)] gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(17.5rem,22rem)] lg:grid-rows-1">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-border bg-surface">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <div>
            <p className="font-display text-lg">{snap.module.title}</p>
            <p className="text-xs text-subtle">
              {snap.state.chapterName} · {snap.state.sceneName}
              {snap.state.kpBusy ? " · KP 正在落笔" : ""}
            </p>
            {snap.state.ruleProjection ? (
              <p className="mt-0.5 text-[11px] text-subtle">
                第 {snap.state.ruleProjection.viewer.timeline.spotlightBeat} 拍 · 虚构时间约 {Math.floor(snap.state.ruleProjection.viewer.timeline.fictionSeconds / 60)} 分钟
              </p>
            ) : null}
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
            <button
              type="button"
              className="text-[11px] text-subtle hover:text-danger"
              onClick={() => {
                void leaveTable({ data: { code } }).then((res) => {
                  if (res && "ok" in res && !res.ok) toast.error(res.error);
                });
              }}
            >
              离开这一桌
            </button>
          </div>
        </div>
        <LocationHistoryBar
          threads={snap.locationThreads}
          meId={snap.me.userId}
        />
        {snap.state.authoritative ? (
          <TacticalMap
            key={tacticalMapKey}
            projection={tacticalProjection}
            defaultExpanded={tacticalMapInCombat}
          />
        ) : null}
        {snap.state.combat ? (
          <div className="shrink-0 overflow-y-auto border-b border-border px-4 py-3 lg:max-h-[30vh]">
            <CombatStrip
              code={code}
              combat={snap.state.combat}
              meId={snap.me.userId}
              isHost={snap.me.is_host}
              rulesV2={Boolean(snap.state.ruleProjection)}
              myPlace={snap.state.places?.[snap.me.userId] ?? snap.state.sceneId ?? "wake"}
              meSheet={
                snap.characters.find((c) => c.userId === snap.me.userId)?.sheet
              }
              party={snap.characters.map((c) => ({
                userId: c.userId,
                name: c.sheet.name,
                place: snap.state.places?.[c.userId],
              }))}
            />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {conversationMessages.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              mine={m.user_id === snap.me.userId}
            />
          ))}
          <div ref={endRef} />
        </div>
        {visibleViewerNarrationRecovery?.kind === "available" ? (
          <div
            data-narration-recovery="viewer"
            role="alert"
            className="shrink-0 border-t border-danger/40 bg-danger/10 px-5 py-3"
          >
            <p className="text-sm text-fg">行动已经结算，但这条 KP 回复尚未送达。</p>
            <p className="mt-1 text-xs text-subtle">
              {publicNarrationRecoveryReason(visibleViewerNarrationRecovery.state)}
            </p>
            <p className="mt-1 text-xs text-subtle">
              重试只恢复你自己的回复，不会重新裁定、掷骰或消耗资源。
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
                : "上次提交的结果还没有确认。"}
            </p>
            <p className="mt-1 text-xs text-subtle">
              将原样使用同一个提交标识恢复，不会按当前待决状态创建新行动。
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
              {sending ? "恢复中……" : "恢复 KP 回应"}
            </Button>
          </div>
        ) : null}
        {!safetyPaused && pendingMine.length > 0 && (
          <div className="shrink-0 border-t border-border px-5 py-3">
            <p className="mb-2 text-xs text-brass">轮到你掷骰</p>
            <div className="flex flex-col gap-3">
              {pendingMine.map((r) => (
                <RollButton
                  key={r.id}
                  code={code}
                  roll={r}
                  party={snap.characters}
                  where={snap.state.places ?? {}}
                  sceneId={snap.state.sceneId ?? "wake"}
                  combat={snap.state.combat ?? null}
                  ruleBoosts={snap.state.ruleProjection?.viewer.availableRollBoosts}
                />
              ))}
            </div>
          </div>
        )}
        {(snap.state.squadQueue?.length ?? 0) > 0 && (
          <SquadQueueBar
            code={code}
            meId={snap.me.userId}
            queue={snap.state.squadQueue ?? []}
            squads={snap.state.squads ?? []}
          />
        )}
        {snap.state.authoritative && safetyPaused ? (
          <div className="shrink-0 border-t border-border px-5 py-3">
            <div className="space-y-2">
              <p className="text-sm text-fg">呈现已立即暂停在最近的稳定状态。</p>
              <p className="text-xs text-subtle">只有你能选择最小呈现调整并恢复。</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={sending}
                  onClick={() => void resumeWithSafetyAdjustment("fadeToBlack")}
                >
                  淡出当前内容
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="subtle"
                  disabled={sending}
                  onClick={() => void resumeWithSafetyAdjustment("reduceDetail")}
                >
                  降低呈现细节
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={sending}
                  onClick={() => void resumeWithSafetyAdjustment("skipSensitiveContent")}
                >
                  跳过敏感内容
                </Button>
              </div>
            </div>
          </div>
        ) : null}
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
                  <Button
                    key={choice.choiceId}
                    type="button"
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
              <div className="mt-3 space-y-3 rounded-xl border border-border bg-panel/40 p-3">
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
        {!safetyPaused && pendingMine.length === 0 && !advancementPending && !groupRestPending && !partyMovePending && !playerChoicePending && !combatPending ? <form
          className="flex shrink-0 flex-wrap items-end gap-2 border-t border-border p-3"
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
              "grid size-12 shrink-0 place-items-center rounded-[14px] border",
              rec === "rec"
                ? "border-danger bg-danger text-fg"
                : "border-border text-muted hover:text-fg",
            )}
          >
            <Mic className="size-5" />
          </button>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSubmissionError(null);
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
              rec === "rec"
                ? "正在听……松手后写入输入框"
                : rec === "stt"
                  ? "正在转写……"
                  : snap.state.squads?.some(
                        (s) => s.ids.includes(snap.me.userId) && s.captain !== snap.me.userId,
                      )
                    ? "队员发言先给队长看。点右侧按钮送出。批准后才进桌。"
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
            disabled={sending || !text.trim()}
            onClick={() => void submit()}
          >
            <Send className="size-4" />
          </Button>
          {submissionError ? (
            <p
              id="action-submission-error"
              role="alert"
              data-submission-error
              className="basis-full text-xs text-danger"
            >
              {submissionError}
            </p>
          ) : null}
        </form> : null}
      </section>

      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[28px] border border-border bg-surface">
        <div className="flex border-b border-border">
          {(
            [
              ["sheet", UserRound, "人物"],
              ["npcs", Users, "在场"],
              ["clues", MapPinned, "线索"],
              ["log", ScrollText, "日志"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 py-3 text-xs sm:text-sm",
                tab === id ? "text-fg" : "text-subtle hover:text-muted",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere]">
          {tab === "sheet" && (
            <SheetView
              party={snap.characters}
              meId={snap.me.userId}
              isHost={snap.me.is_host}
              code={code}
              inCombat={Boolean(snap.state.combat) || snap.state.authoritative?.inCombat === true}
              placeNames={snap.state.placeNames}
              clocks={snap.state.clocks}
              partySplit={snap.state.partySplit}
              restVote={snap.state.restVote}
              restHold={snap.state.restHold}
              squads={snap.state.squads}
              squadInvite={snap.state.squadInvite}
              places={snap.state.places}
              ruleProjection={snap.state.ruleProjection}
              authoritative={snap.state.authoritative}
            />
          )}
          {tab === "npcs" && <NpcBoard npcs={snap.state.npcs} />}
          {tab === "clues" && <ClueBoard clues={snap.state.clues} />}
          {tab === "log" && <LogView logs={snap.logs} party={snap.characters} />}
        </div>
      </aside>
    </div>
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
          <Button
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

  if (pending.choiceKind === "reaction") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {pending.candidateAbilityRefs.map((abilityRef) => (
          <Button
            key={abilityRef}
            type="button"
            disabled={sending}
            onClick={() => void onSubmit({
              kind: "useReaction",
              abilityRef,
              targetEntityId: pending.targetEntityId,
            }, `我对 ${entityLabel(pending.targetEntityId)} 使用反应。`)}
          >
            {abilityRef === "action:opportunity-attack" ? "借机攻击" : abilityRef}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          disabled={sending}
          onClick={() => void onSubmit({ kind: "decline" }, "我不使用这次反应。")}
        >
          不使用反应
        </Button>
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
    <div className="mt-3 rounded-[16px] border border-border bg-bg/40 p-3">
      <ol className="grid gap-2">
        {initiativeOrder.map((entityId, index) => (
          <li
            key={entityId}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-3 py-2 text-sm"
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
    <div className="mt-3 rounded-[16px] border border-border bg-bg/40 p-3">
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
              <div key={ability} className="flex items-center justify-between rounded-[12px] border border-border px-3 py-2 text-sm">
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
              className="flex items-center gap-2 rounded-[10px] border border-border/70 px-2 py-1.5"
            >
              <span className="min-w-16 text-xs">{level} 环位</span>
              <Button
                size="sm"
                variant="subtle"
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
                variant="subtle"
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
    <div className="mt-3 rounded-[16px] border border-brass/40 bg-brass/10 p-3">
      <p className="text-xs text-muted">
        发起者只决定自己的休整。你是否加入由你决定；拒绝或暂不回答都不会替你推进虚构时间。
      </p>
      {options.restKind === "short" ? (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span>花费生命骰</span>
            <Button
              size="sm"
              variant="subtle"
              disabled={sending || hitDice === 0}
              onClick={() => setHitDice((value) => Math.max(0, value - 1))}
            >−</Button>
            <span className="min-w-6 text-center tabular-nums">{hitDice}</span>
            <Button
              size="sm"
              variant="subtle"
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

function CombatStrip({
  code,
  combat,
  meId,
  isHost,
  rulesV2,
  myPlace,
  meSheet,
  party,
}: {
  code: string;
  combat: PublicCombat | null;
  meId: string;
  isHost: boolean;
  rulesV2: boolean;
  myPlace: string;
  meSheet?: CharacterSheet;
  party: { userId: string; name: string; place?: string }[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();
  if (!combat) return null;
  const here = combat.place === myPlace;
  const mine = combat.order.find((o) => o.id === meId);
  const inFight = Boolean(mine?.inCombat);
  const myTurn = combat.activeId === meId;
  const watchers = party.filter(
    (p) =>
      (p.place ?? myPlace) === combat.place &&
      !combat.order.some((o) => o.id === p.userId && o.inCombat),
  );

  async function act(fn: () => Promise<TableActionResponse>, key: string) {
    setBusy(key);
    try {
      const res = await fn();
      if (!tableActionAccepted(res)) toast.error(String(res.error ?? "做不到"));
      else void qc.invalidateQueries({ queryKey: ["table", code] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "做不到");
    } finally {
      setBusy(null);
    }
  }

  if (!here) {
    return (
      <div className="rounded-[16px] border border-border bg-elevated px-4 py-3 text-sm text-muted">
        别处有人打起来了。你这边听不见刀声的细节。要介入，得先过去。
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-border bg-elevated px-4 py-3">
      <p className="text-[11px] tracking-wide text-brass">
        战斗 · 第 {combat.round} 轮 · {combat.place}
        {combat.waiting === "init" ? " · 先攻" : ""}
      </p>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {combat.order
          .filter((o) => o.inCombat)
          .map((o) => (
            <li
              key={o.id}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                o.id === combat.activeId
                  ? "border-brass bg-brass/15 text-fg"
                  : "border-border text-muted",
              )}
            >
              {o.name}
              {o.init != null ? ` ${o.init}` : ""}
              {o.band === "melee" ? " ·贴身" : o.band === "far" ? " ·远" : " ·近"}
              {o.cover === "half" ? " ·半掩" : o.cover === "three" ? " ·¾掩" : o.cover === "total" ? " ·全掩" : ""}
              {o.kind === "npc" ? "" : o.id === meId ? " ·你" : ""}
              {o.id === meId && o.spend
                ? ` ·${o.spend.action ? "动作" : ""}${o.spend.bonus ? "附赠" : ""}${o.spend.reaction ? "反应" : ""}${!o.spend.action && !o.spend.bonus && !o.spend.reaction ? "耗尽" : ""}`
                : ""}
            </li>
          ))}
      </ol>
      {combat.hazards.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
          {combat.hazards.map((h) => (
            <li key={h.id}>
              {h.name}：{h.text}
            </li>
          ))}
        </ul>
      )}
      {!rulesV2 && combat.reacts
        ?.filter((r) => r.userId === meId)
        .map((r) => (
          <div key={r.id} className="mt-3 rounded-[12px] border border-brass/40 px-3 py-2">
            <p className="text-xs text-fg">{r.text}</p>
            <div className="mt-2 flex gap-2">
              <Button
                disabled={Boolean(busy)}
                onClick={() =>
                  act(() => resolveReact({ data: { code, reactId: r.id, use: true } }), "rs")
                }
              >
                使用护盾术
              </Button>
              <Button
                disabled={Boolean(busy)}
                onClick={() =>
                  act(() => resolveReact({ data: { code, reactId: r.id, use: false } }), "rn")
                }
              >
                不用
              </Button>
            </div>
          </div>
        ))}
      {watchers.length > 0 && (
        <p className="mt-2 text-[11px] text-subtle">
          同处未参战：{watchers.map((w) => w.name).join("、")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {here && !inFight && (
          <Button
            disabled={busy === "join"}
            onClick={() => act(() => joinCombat({ data: { code } }), "join")}
          >
            {busy === "join" ? "加入……" : "加入战斗"}
          </Button>
        )}
        {inFight && !mine?.init && combat.waiting === "init" && (
          <p className="text-xs text-muted">先掷下面的先攻。</p>
        )}
        {rulesV2 && myTurn && inFight && meSheet?.hp.current === 0 && (
          <Button
            variant="brass"
            disabled={busy === "death-save"}
            onClick={() =>
              act(
                () => sendAction({ data: { code, text: "进行本回合的死亡豁免" } }),
                "death-save",
              )
            }
          >
            {busy === "death-save" ? "掷骰……" : "死亡豁免"}
          </Button>
        )}
        {(myTurn || isHost) && combat.waiting === "turn" && inFight && (
          <Button
            disabled={busy === "end"}
            onClick={() => act(() => endTurn({ data: { code } }), "end")}
          >
            {busy === "end" ? "……" : myTurn ? "结束回合" : "跳过这人"}
          </Button>
        )}
        {!rulesV2 && inFight && (myTurn || isHost) && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act(() => leaveFight({ data: { code, kind: "disengage" } }), "dis")}
            >
              撤离
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act(() => leaveFight({ data: { code, kind: "flee" } }), "flee")}
            >
              跑到远处
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act(() => leaveFight({ data: { code, kind: "withdraw" } }), "out")}
            >
              退出战场
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act(() => leaveFight({ data: { code, kind: "surrender" } }), "surr")}
            >
              投降
            </Button>
          </>
        )}
        {rulesV2 && inFight && myTurn && (
          <p className="self-center text-[11px] text-muted">
            攻击、施法、撤离或疾走请直接写进行动；规则内核会结算本回合资源。
          </p>
        )}
      </div>
      {(() => {
        const warLeft = meSheet
          ? left(ensureResources(meSheet).resources!.warPriest)
          : 0;
        const canWar =
          myTurn &&
          inFight &&
          combat.waiting === "turn" &&
          Boolean(mine?.spend?.attacked) &&
          mine?.spend?.action === false &&
          Boolean(mine?.spend?.bonus) &&
          warLeft > 0 &&
          meSheet?.subclassId === "war";
        const foes = combat.order.filter(
          (o) => o.kind === "npc" && o.inCombat,
        );
        if (!canWar || !foes.length) return null;
        return (
          <div className="mt-2 flex flex-wrap gap-2">
            {foes.map((o) => (
              <Button
                key={o.id}
                variant="brass"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() =>
                  act(
                    () => extraAttack({ data: { code, targetId: o.id } }),
                    `war-${o.id}`,
                  )
                }
              >
                {busy === `war-${o.id}`
                  ? "……"
                  : `战争祭司再攻 ${o.name}（${warLeft}）`}
              </Button>
            ))}
          </div>
        );
      })()}
      {myTurn && mine?.spend && (
        <p className="mt-2 text-xs text-muted">
          轮到你。剩：
          {mine.spend.action ? " 动作" : ""}
          {mine.spend.bonus ? " 附赠" : ""}
          {mine.spend.reaction ? " 反应" : ""}
          {!mine.spend.action ? "（动作已用，不能再祝福或主手攻击）" : ""}
          {meSheet?.subclassId === "war" &&
          mine.spend.attacked &&
          !mine.spend.action &&
          mine.spend.bonus &&
          left(ensureResources(meSheet).resources!.warPriest) > 0
            ? `。战争祭司还可再攻（${left(ensureResources(meSheet).resources!.warPriest)}）`
            : ""}
          。说攻击谁、施法或撤离。
        </p>
      )}
      {inFight && !myTurn && combat.activeId && combat.waiting === "turn" && (
        <p className="mt-2 text-xs text-subtle">
          等待 {combat.order.find((o) => o.id === combat.activeId)?.name}
        </p>
      )}
    </div>
  );
}

function SquadQueueBar({
  code,
  meId,
  queue,
  squads,
}: {
  code: string;
  meId: string;
  queue: { id: string; userId: string; name: string; body: string; beat: number }[];
  squads: { ids: string[]; captain: string }[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const captain = squads.some((s) => s.captain === meId);
  async function act(id: string, accept: boolean) {
    setBusy(id + String(accept));
    try {
      const res = await approveSquadQueue({ data: { code, queueId: id, accept } });
      if (!res.ok) toast.error(res.error ?? "做不到");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "做不到");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="shrink-0 border-t border-border px-4 py-2">
      <p className="text-[11px] tracking-wide text-brass">
        队内缓冲 · 本拍未批准即消失
      </p>
      <ul className="mt-1.5 grid gap-1.5">
        {queue.map((q) => (
          <li
            key={q.id}
            className="rounded-[12px] border border-border bg-elevated px-3 py-2"
          >
            <p className="text-xs text-subtle">{q.name}</p>
            <p className="text-sm text-fg">{q.body}</p>
            {captain ? (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => act(q.id, true)}
                >
                  {busy === q.id + "true" ? "……" : "批准"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={() => act(q.id, false)}
                >
                  驳回
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-subtle">等待队长批准</p>
            )}
          </li>
        ))}
      </ul>
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
      className={cn("max-w-[42rem]", mine && "ml-auto", kp && "mx-0 w-full max-w-none")}
    >
      <p className="mb-1 text-[11px] tracking-wide text-subtle">
        {m.kind === "roll" ? m.name : kp ? "KP" : m.name}
        {m.kind === "roll" ? " · 检定" : ""}
        {m.kind === "refuse" ? " · 驳回" : ""}
      </p>
      <div
        className={cn(
          "whitespace-pre-wrap rounded-[16px] px-4 py-3 text-sm leading-relaxed",
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
              className="flex gap-2 rounded-[12px] border border-brass/35 bg-elevated px-3 py-2"
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

function RollButton({
  code,
  roll,
  party,
  where,
  sceneId,
  combat,
  ruleBoosts,
}: {
  code: string;
  roll: PendingRoll;
  party: TableSnap["characters"];
  where: Record<string, string>;
  sceneId: string;
  combat: PublicCombat | null;
  ruleBoosts?: Array<"guidance" | "inspiration" | "lucky">;
}) {
  const qc = useQueryClient();
  const boosts = roll.authoritative
    ? []
    : ruleBoosts
    ? ruleBoosts.map((id) => ({
        id,
        fromUserId: roll.userId,
        label:
          id === "guidance"
            ? "已有神导术 +1d4"
            : id === "inspiration"
              ? "激励（优势）"
              : "半身人幸运",
        detail:
          id === "guidance"
            ? "使用已生效的神导术并结束这项专注。"
            : id === "inspiration"
              ? "花费激励；优势与劣势按 2014 规则相消。"
              : "若 d20 出 1，重掷一次并采用新结果。",
        defaultOn: id === "lucky",
        blocked: undefined,
      }))
    : eligibleBoosts(
        party.map((p) => ({ userId: p.userId, sheet: p.sheet })),
        roll,
        {
          where,
          sceneId,
          inCombat: Boolean(combat),
          activeId: combat?.activeId ?? null,
          spendAction: Object.fromEntries(
            (combat?.order ?? []).map((o) => [o.id, o.spend?.action !== false]),
          ),
        },
      );
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(boosts.map((b) => [b.id, Boolean(b.defaultOn)])),
  );
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
            : (SKILLS.find((s) => s.id === roll.skill)?.label ??
              ABILITY_LABEL[roll.ability as keyof typeof ABILITY_LABEL] ??
              roll.ability);
  const alreadyGuide =
    !roll.authoritative &&
    (roll.kind === "check" || roll.kind === "init" || !roll.kind) &&
    (ruleBoosts
      ? ruleBoosts.includes("guidance")
      : party.find((p) => p.userId === roll.userId)?.sheet.resources?.conc?.id ===
        "guidance");
  return (
    <div className="rounded-[16px] border border-border bg-elevated px-3 py-3">
      <p className="text-xs text-muted">{roll.reason}</p>
      {alreadyGuide && (
        <p className="mt-2 text-[11px] text-brass">
          已有神导专注：掷出自动 +1d4，然后结束。
        </p>
      )}
      {boosts.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {boosts.map((b) => (
            <li key={`${b.id}-${b.fromUserId}`}>
              <label
                className={`flex items-start gap-2 text-xs ${b.blocked ? "opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={Boolean(b.blocked)}
                  checked={Boolean(on[b.id]) && !b.blocked}
                  onChange={(e) =>
                    setOn((prev) => ({ ...prev, [b.id]: e.target.checked }))
                  }
                />
                <span>
                  <span className="text-fg">{b.label}</span>
                  <span className="mt-0.5 block text-[11px] text-subtle">
                    {b.blocked ?? b.detail}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button
        className="mt-3"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const boostIds = Object.entries(on)
              .filter(([, v]) => v)
              .map(([k]) => k);
            const res = await resolveRoll({
              data: { code, rollId: roll.id, boostIds },
            });
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

function SheetView({
  party,
  meId,
  isHost,
  code,
  inCombat,
  placeNames,
  clocks,
  partySplit,
  restVote,
  restHold,
  squads,
  squadInvite,
  places,
  ruleProjection,
  authoritative,
}: {
  party: TableSnap["characters"];
  meId: string;
  isHost?: boolean;
  code: string;
  inCombat: boolean;
  placeNames?: Record<string, string>;
  clocks?: Record<string, { beats: number; minutes: number; lag: number }>;
  partySplit?: boolean;
  restVote?: TableSnap["state"]["restVote"];
  restHold?: TableSnap["state"]["restHold"];
  squads?: { ids: string[]; captain: string }[];
  squadInvite?: { from: string; to: string; fromName: string } | null;
  places?: Record<string, string>;
  ruleProjection?: TableSnap["state"]["ruleProjection"];
  authoritative?: TableSnap["state"]["authoritative"];
}) {
  const [openId, setOpenId] = useState<string | null>(meId);
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
        <div className="rounded-[12px] border border-brass/40 bg-brass/10 px-3 py-2">
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
        const open = openId === p.userId;
        const together =
          (places?.[meId] ?? "") !== "" &&
          places?.[meId] === places?.[p.userId];
        const groupedWithMe = Boolean(
          myGroup && p.userId !== meId && myGroup.ids.includes(p.userId),
        );
        const theirGroup = groups.find((g) => g.ids.includes(p.userId));
        return (
          <li key={p.userId} className="min-w-0 overflow-hidden rounded-[16px] border border-border">
            <div className="flex w-full items-start justify-between gap-2 px-3 py-3">
              <button
                type="button"
                onClick={() => {
                  if (!identityOnly) setOpenId(open ? null : p.userId);
                }}
                className="min-w-0 flex-1 text-left"
              >
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
                        {p.userId === meId
                          ? authoritative?.controlledCharacter?.hitPoints?.current ?? sheet.hp.current
                          : sheet.hp.current}
                      </span>
                      <span className="tabular-nums">/
                        {p.userId === meId
                          ? authoritative?.controlledCharacter?.hitPoints?.maximum ?? sheet.hp.max
                          : sheet.hp.max}
                      </span>
                    </>
                  )}
                </span>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {!identityOnly ? (
                  <span className="text-xs text-subtle">{open ? "收起" : "展开"}</span>
                ) : null}
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
                    <Button
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
                  <Button
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
                      <Button
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
            {open && !identityOnly && (
              <CharacterDetail
                sheet={sheet}
                canEdit={p.userId === meId}
                code={code}
                inCombat={inCombat}
                restVote={restVote}
                restHold={restHold}
                meId={meId}
                partyCount={myGroup?.ids.length ?? 1}
                activeRule={p.userId === meId ? ruleProjection?.viewer : undefined}
                authoritativeCharacter={p.userId === meId
                  ? authoritative?.controlledCharacter ?? undefined
                  : undefined}
                authoritativeActivities={p.userId === meId
                  ? authoritative?.activities
                  : undefined}
                visibleEntities={p.userId === meId ? ruleProjection?.visibleEntities : undefined}
                actorPosition={
                  p.userId === meId
                    ? ruleProjection?.combat?.order.find((entry) => entry.entityId === meId)?.positionFeet
                    : undefined
                }
              />
            )}
          </li>
        );
      })}
      </ul>
    </div>
  );
}

function Fold({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[12px] border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-xs font-medium">{title}</span>
        <span className="min-w-0 truncate text-[11px] text-subtle">
          {open ? "收起" : hint || "展开"}
        </span>
      </button>
      {open && <div className="border-t border-border px-2.5 py-2 min-w-0">{children}</div>}
    </div>
  );
}

function CharacterDetail({
  sheet,
  canEdit,
  code,
  inCombat,
  restVote,
  restHold,
  meId,
  partyCount,
  activeRule,
  authoritativeCharacter,
  authoritativeActivities,
  visibleEntities,
  actorPosition,
}: {
  sheet: CharacterSheet;
  canEdit: boolean;
  code: string;
  inCombat: boolean;
  restVote?: TableSnap["state"]["restVote"];
  restHold?: TableSnap["state"]["restHold"];
  meId?: string;
  partyCount?: number;
  activeRule?: NonNullable<TableSnap["state"]["ruleProjection"]>["viewer"];
  authoritativeCharacter?: AuthoritativeControlledCharacter;
  authoritativeActivities?: NonNullable<TableSnap["state"]["authoritative"]>["activities"];
  visibleEntities?: NonNullable<TableSnap["state"]["ruleProjection"]>["visibleEntities"];
  actorPosition?: number;
}) {
  const live = ensureGear(sheet);
  const race = raceById(live.raceId);
  const cls = classById(live.classId);
  const sub = cls?.subclasses.find((s) => s.id === live.subclassId);
  const spellIds = [
    ...new Set([...live.cantrips, ...live.prepared, ...live.spellbook]),
  ];
  const stocks = listStocks(live);
  const packed = ensureResources(live);
  const liveConditions = [
    ...live.conditions,
    ...(activeRule?.activeEffects ?? []),
    ...(activeRule?.spellEffects.map((effect) =>
      `${effect.label}${effect.concentration ? "（专注）" : ""}`,
    ) ?? []),
  ];
  return (
    <div className="grid min-w-0 gap-3 border-t border-border px-3 py-3 text-sm">
      <p className="text-muted">
        {race?.name}
        {cls?.name}
        {sub ? ` · ${sub.name}` : ""} {authoritativeCharacter?.level ?? 3} 级
      </p>
      <div className="flex gap-3 tabular-nums">
        <Stat k="AC" v={activeRule?.ac ?? live.ac} />
        <Stat
          k="生命"
          remain={authoritativeCharacter?.hitPoints?.current ?? activeRule?.hp?.current ?? live.hp.current}
          max={authoritativeCharacter?.hitPoints?.maximum ?? activeRule?.hp?.max ?? live.hp.max}
        />
        <Stat k="速度" v={`${activeRule?.speedFeet ?? live.speed}尺`} />
      </div>
      {liveConditions.length > 0 && (
        <Fold title="状态" hint={`${liveConditions.length} 项生效`}>
          <ul className="grid gap-1 text-xs text-muted">
            {[...new Set(liveConditions)].map((condition) => (
              <li key={condition}>· {condition}</li>
            ))}
          </ul>
        </Fold>
      )}
      <ResourcePanel
        sheet={packed}
        canEdit={canEdit}
        code={code}
        inCombat={inCombat}
        restVote={restVote}
        restHold={restHold}
        meId={meId}
        partyCount={partyCount ?? 1}
        activeRule={activeRule}
        authoritativeCharacter={authoritativeCharacter}
        authoritativeActivities={authoritativeActivities}
      />
      <div className="grid grid-cols-3 gap-2">
        {ABILITIES.map((a) => (
          <div
            key={a}
            className="rounded-[12px] border border-border p-2 text-center"
          >
            <p className="text-[10px] text-subtle">{ABILITY_LABEL[a]}</p>
            <p className="font-display text-lg tabular-nums">{live.scores[a]}</p>
            <p className="text-xs text-muted tabular-nums">
              {signed(abilityMod(live.scores[a]))}
            </p>
          </div>
        ))}
      </div>
      <Fold
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
      </Fold>
      {live.features.length > 0 && (
        <Fold title="动作" hint={`${live.features.length} 条`}>
          <ul className="grid min-w-0 gap-2">
            {live.features.map((f) => (
              <FeatureLine
                key={f.slice(0, 24)}
                text={f}
                stock={stockForFeature(f, stocks)}
              />
            ))}
          </ul>
        </Fold>
      )}
      {spellIds.length > 0 && (
        <Fold
          title="法术"
          hint={
            packed.resources?.slot1.max
              ? `一环 ${left(packed.resources.slot1)}/${packed.resources.slot1.max}`
              : `${spellIds.length} 个`
          }
        >
          <ul className="grid gap-2">
            {spellIds.map((id) => (
              <SpellLine
                key={id}
                id={id}
                canEdit={canEdit}
                code={code}
                stocks={packed}
                sheet={live}
                actorId={activeRule?.id}
                visibleEntities={visibleEntities}
                inCombat={inCombat}
                actorPosition={actorPosition}
              />
            ))}
          </ul>
        </Fold>
      )}
      <InventoryPanel
        equipped={live.equipped ?? {}}
        backpack={live.backpack ?? []}
        canEdit={canEdit}
        code={code}
      />
      {(live.appearance || live.trait) && (
        <Fold title="角色" hint={live.appearance ? "外貌" : "展开"}>
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
        </Fold>
      )}
    </div>
  );
}

function ResourcePanel({
  sheet,
  canEdit,
  code,
  inCombat,
  restVote,
  restHold,
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
  restVote?: TableSnap["state"]["restVote"];
  restHold?: TableSnap["state"]["restHold"];
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
  // Legacy Adapter choice. authoritative-v2 uses arcaneRecoverySlotLevels only.
  const [arcane, setArcane] = useState<0 | 1 | 2>(0);
  const hdLeft = authoritativeCharacter?.restRecoveryOptions?.shortRest?.hitDiceMaximumSpend
    ?? (authoritativeCharacter === undefined ? left(r.hitDice) : 0);
  const hitDieSides = authoritativeCharacter?.restRecoveryOptions?.shortRest?.hitDieSides
    ?? r.hitDice.die;
  const con = abilityMod(authoritativeCharacter?.abilityScores?.con ?? sheet.scores.con);
  const needVote = partyCount > 1;
  const myAgreed = Boolean(meId && restVote?.agreed.includes(meId));
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
      <div className="rounded-[12px] border border-brass/40 px-3 py-3">
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
            <Button size="sm" variant="subtle" disabled={dice <= 0} onClick={() => setDice((n) => Math.max(0, n - 1))}>
              −
            </Button>
            <span className="min-w-8 text-center font-display text-lg tabular-nums text-fg">{dice}</span>
            <Button size="sm" variant="subtle" disabled={dice >= hdLeft} onClick={() => setDice((n) => Math.min(hdLeft, n + 1))}>
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
        ) : sheet.classId === "wizard" && !r.arcaneRecovery ? (
          <div className="mt-3">
            <p className="text-xs font-medium">奥术恢复（每日一次）</p>
            <div className="mt-1 flex gap-1.5">
              {([0, 1, 2] as const).map((n) => (
                <Button key={n} onClick={() => setArcane(n)}>
                  {n === 0 ? "不用" : n === 1 ? "回一个一环" : "回一个二环"}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-subtle">当前选：{arcane === 0 ? "不用" : arcane === 1 ? "一环" : "二环"}</p>
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
                    ...(authoritativeCharacter === undefined
                      ? { arcane }
                      : { arcaneRecoverySlotLevels }),
                  },
                }),
              )
            }
          >
            {busy === "s" ? "结算……" : needVote ? "提议队伍短休" : "开始短休"}
          </Button>
          {needVote ? (
            <Button
              variant="subtle"
              disabled={Boolean(busy) || inCombat}
              onClick={() =>
                go("solo-s", () =>
                  restNow({
                    data: {
                      code,
                      kind: "short",
                      mode: "personal",
                      hitDice: dice,
                      ...(authoritativeCharacter === undefined
                        ? { arcane }
                        : { arcaneRecoverySlotLevels }),
                    },
                  }),
                )
              }
            >
              {busy === "solo-s" ? "结算……" : "单独短休"}
            </Button>
          ) : null}
          <Button disabled={Boolean(busy)} onClick={() => setRest(null)}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  if (rest === "long") {
    return (
      <div className="rounded-[12px] border border-brass/40 px-3 py-3">
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
              variant="subtle"
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
          <Button disabled={Boolean(busy)} onClick={() => setRest(null)}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border px-3 py-3">
      {canEdit && (activeRule?.rest?.status === "resting" || authoritativeRest !== undefined) ? (
        <div className="mb-3 rounded-[10px] border border-brass/40 bg-brass/10 px-3 py-2">
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
      {canEdit && restHold ? (
        <div className="mb-3 rounded-[10px] border border-brass/40 bg-brass/10 px-3 py-2">
          <p className="text-xs text-fg">
            {restHold.fromName}那边正在{restHold.kind === "long" ? "长休" : "短休"}（共 {restHold.needBeats} 拍）。
            {meId && restHold.resters.includes(meId)
              ? ` 你在歇。另一边再走 ${restHold.remain} 拍后你醒来，时间对齐。`
              : ` 你可继续行动。再 ${restHold.remain} 拍后他们醒来。`}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={Boolean(busy)}
            onClick={() => go("wake", () => cancelRest({ data: { code } }))}
          >
            打断休息
          </Button>
        </div>
      ) : null}
      {canEdit && restVote ? (
        <div className="mb-3 rounded-[10px] border border-brass/40 bg-brass/10 px-3 py-2">
          <p className="text-xs text-fg">
            {restVote.fromName} 提议{restVote.kind === "long" ? "长休" : "短休"}。还差 {restVote.waiting.length} 人同意。
          </p>
          {myAgreed ? (
            <p className="mt-1 text-[11px] text-subtle">你已同意，等其他人。</p>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={Boolean(busy) || inCombat}
                onClick={() =>
                  go("ok", () =>
                    restNow({
                      data: {
                        code,
                        kind: restVote.kind,
                        mode: "group",
                        hitDice: restVote.kind === "short" ? dice : undefined,
                        ...(restVote.kind !== "short"
                          ? {}
                          : authoritativeCharacter === undefined
                            ? { arcane }
                            : { arcaneRecoverySlotLevels }),
                      },
                    }),
                  )
                }
              >
                {busy === "ok" ? "……" : "同意"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={() => go("no", () => cancelRest({ data: { code } }))}
              >
                反对
              </Button>
            </div>
          )}
        </div>
      ) : null}
      <p className="text-xs font-medium">库存</p>
      {r.conc && (
        <p className="mt-1 text-xs text-muted">
          专注中：<span className="text-fg">{r.conc.name}</span>
        </p>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {listStocks(sheet).map((s) => (
          <StockChip key={s.id} item={s} />
        ))}
      </div>
      {r.warPriest.max > 0 && (
        <p className="mt-2 text-xs text-subtle">
          战争祭司：动作打过一次后，战斗条会出现「再攻」。掷出才扣次数。
        </p>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            disabled={Boolean(busy)}
            onClick={() => {
              setArcane(0);
              setArcaneRecoverySlotLevels([]);
              setRest("short");
            }}
          >
            短休
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => setRest("long")}>
            长休
          </Button>
          {r.rage.max > 0 && (
            <Button disabled={Boolean(busy) || left(r.rage) <= 0} onClick={() => go("rg", () => useFeature({ data: { code, feat: "rage" } }))}>
              狂暴
            </Button>
          )}
          {r.surge.max > 0 && (
            <Button disabled={Boolean(busy) || left(r.surge) <= 0} onClick={() => go("sg", () => useFeature({ data: { code, feat: "surge" } }))}>
              动作如潮
            </Button>
          )}
          {r.secondWind.max > 0 && (
            <Button disabled={Boolean(busy) || left(r.secondWind) <= 0} onClick={() => go("sw", () => useFeature({ data: { code, feat: "secondWind" } }))}>
              回气
            </Button>
          )}
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
    <div className="min-w-0 max-w-full rounded-[10px] border border-border bg-bg/40">
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
              className="max-h-[calc(100dvh-2rem)] overflow-y-auto w-full max-w-lg rounded-[20px] border border-border bg-surface shadow-2xl"
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

function SpellLine({
  id,
  canEdit,
  code,
  stocks,
  sheet,
  actorId,
  visibleEntities,
  inCombat,
  actorPosition,
}: {
  id: string;
  canEdit: boolean;
  code: string;
  stocks: CharacterSheet;
  sheet: CharacterSheet;
  actorId?: string;
  visibleEntities?: NonNullable<TableSnap["state"]["ruleProjection"]>["visibleEntities"];
  inCombat: boolean;
  actorPosition?: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [choice, setChoice] = useState("");
  const [ritual, setRitual] = useState(false);
  const [upcast, setUpcast] = useState(false);
  const [destinationFeet, setDestinationFeet] = useState(30);
  const [areaOriginFeet, setAreaOriginFeet] = useState<number | undefined>(undefined);
  const sp = spellById(id);
  if (!sp) return null;
  const definition = spellDefinition(id);
  const profile = spellcastingProfile(sheet, id);
  const r = ensureResources(stocks).resources!;
  const slot = sp.level === 1 ? r.slot1 : sp.level === 2 ? r.slot2 : null;
  const ring = sp.level === 0 ? "戏法" : `${sp.level} 环`;
  const selectedSlot = sp.level === 1 && upcast ? 2 : sp.level;
  const facts = spellCardFacts(id, profile, selectedSlot);
  const attackAllocations = definition
    ? definition.resolution.special === "magic-missile"
      ? 3 + Math.max(0, selectedSlot - definition.level)
      : definition.resolution.mode === "attack"
        ? (definition.resolution.attacks ?? 1) +
          Math.max(0, selectedSlot - definition.level) *
            (definition.resolution.attacksPerSlotAbove ?? 0)
        : 0
    : 0;
  const needsAreaTargets =
    definition?.resolution.mode === "save" ||
    definition?.resolution.special === "sleep-hp-pool";
  const needsEntityTarget = Boolean(
    definition &&
      !["self", "object", "space", "area"].includes(definition.targets.filter),
  );
  const needsSelection = Boolean(needsEntityTarget || needsAreaTargets);
  const options = (visibleEntities ?? []).filter((entity) => {
    if (entity.condition === "dead") return false;
    if (definition?.targets.filter === "living-at-zero-hp") return entity.condition === "down";
    if (definition?.targets.filter === "self") return entity.id === actorId;
    return true;
  });
  const ready = !needsSelection ||
    (attackAllocations > 1
      ? targetIds.length === attackAllocations && targetIds.every(Boolean)
      : targetIds.length > 0);

  function updateAllocation(index: number, value: string) {
    setTargetIds((current) => {
      const next = Array.from({ length: attackAllocations }, (_, i) => current[i] ?? "");
      next[index] = value;
      return next;
    });
  }

  function toggleTarget(targetId: string) {
    setTargetIds((current) => {
      if (current.includes(targetId)) return current.filter((entry) => entry !== targetId);
      const maximum = definition ? spellMaxTargets(definition, selectedSlot) : undefined;
      if (maximum !== null && maximum !== undefined && current.length >= maximum) return current;
      return [...current, targetId];
    });
  }

  return (
    <div className="rounded-[10px] border border-border bg-bg/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-xs font-medium">{sp.name}</span>
        <span className="text-xs text-subtle">
          {ring}
          {sp.level === 0 ? (
            <span> · 不耗位</span>
          ) : slot ? (
            <>
              {" · "}
              <span className="font-display tabular-nums text-fg">{left(slot)}</span>
              <span className="tabular-nums">/{slot.max}</span>
            </>
          ) : null}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-2.5 py-2">
          {(sp.time || sp.range || sp.duration) && (
            <p className="text-[11px] text-subtle">
              {[sp.time, sp.range, sp.duration].filter(Boolean).join(" · ")}
            </p>
          )}
          {profile && (
            <p className="mt-1 text-[11px] text-brass">
              施法攻击 {signed(profile.attackBonus)} · 豁免 DC {profile.saveDc} · {ABILITY_LABEL[profile.ability]}
            </p>
          )}
          {facts && (
            <div className="mt-2 grid gap-1 rounded-[8px] border border-border bg-surface px-2 py-1.5 text-[11px] text-fg">
              <p>{facts.target}</p>
              <p>{facts.resolution}</p>
            </div>
          )}
          <p className="mt-1 text-xs leading-relaxed text-muted">{sp.text}</p>
          {canEdit && sp.level === 1 && r.slot2.max > 0 && (
            <label className="mt-2 flex items-center gap-2 text-[11px] text-subtle">
              <input
                type="checkbox"
                checked={upcast}
                disabled={left(r.slot2) < 1 || ritual}
                onChange={(event) => {
                  setUpcast(event.target.checked);
                  setTargetIds([]);
                }}
              />
              使用二环法术位施放（剩 {left(r.slot2)}/{r.slot2.max}）
            </label>
          )}
          {canEdit && needsSelection && attackAllocations > 1 && (
            <div className="mt-2 grid gap-1.5">
              {Array.from({ length: attackAllocations }, (_, index) => (
                <label key={index} className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[11px] text-subtle">
                  <span>第 {index + 1} 发</span>
                  <select
                    value={targetIds[index] ?? ""}
                    onChange={(event) => updateAllocation(index, event.target.value)}
                    className="min-w-0 rounded-[8px] border border-border bg-bg px-2 py-1 text-xs text-fg"
                  >
                    <option value="">选择目标</option>
                    {options.map((entity) => (
                      <option key={entity.id} value={entity.id}>{entity.name}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {canEdit && needsSelection && attackAllocations <= 1 && definition && spellMaxTargets(definition, selectedSlot) === 1 && (
            <label className="mt-2 grid gap-1 text-[11px] text-subtle">
              <span>目标</span>
              <select
                value={targetIds[0] ?? ""}
                onChange={(event) => setTargetIds(event.target.value ? [event.target.value] : [])}
                className="rounded-[8px] border border-border bg-bg px-2 py-1 text-xs text-fg"
              >
                <option value="">选择目标</option>
                {options.map((entity) => (
                  <option key={entity.id} value={entity.id}>{entity.name}</option>
                ))}
              </select>
            </label>
          )}
          {canEdit && needsSelection && attackAllocations <= 1 && definition && spellMaxTargets(definition, selectedSlot) !== 1 && (
            <div className="mt-2">
              <p className="text-[11px] text-subtle">选择范围内目标</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {options.map((entity) => (
                  <label key={entity.id} className="flex items-center gap-1 rounded-[8px] border border-border px-2 py-1 text-[11px]">
                    <input
                      type="checkbox"
                      checked={targetIds.includes(entity.id)}
                      onChange={() => toggleTarget(entity.id)}
                    />
                    {entity.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {canEdit && id === "command" && (
            <label className="mt-2 grid gap-1 text-[11px] text-subtle">
              <span>命令词</span>
              <select
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
                className="rounded-[8px] border border-border bg-bg px-2 py-1 text-xs text-fg"
              >
                <option value="">选择命令</option>
                {["过来", "放下", "逃走", "趴下", "停下"].map((word) => <option key={word}>{word}</option>)}
              </select>
            </label>
          )}
          {canEdit && id === "lesser-restoration" && (
            <label className="mt-2 grid gap-1 text-[11px] text-subtle">
              <span>结束状态</span>
              <select
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
                className="rounded-[8px] border border-border bg-bg px-2 py-1 text-xs text-fg"
              >
                <option value="">自动选择已有状态</option>
                <option value="diseased">疾病</option>
                <option value="blinded">目盲</option>
                <option value="deafened">耳聋</option>
                <option value="paralyzed">麻痹</option>
                <option value="poisoned">中毒</option>
              </select>
            </label>
          )}
          {canEdit && id === "misty" && inCombat && (
            <label className="mt-2 grid gap-1 text-[11px] text-subtle">
              <span>战场目标位置（尺）</span>
              <input
                type="number"
                min={0}
                value={destinationFeet}
                onChange={(event) => setDestinationFeet(Number(event.target.value))}
                className="rounded-[8px] border border-border bg-bg px-2 py-1 text-xs text-fg"
              />
            </label>
          )}
          {canEdit && definition?.area?.origin === "point" && inCombat && (
            <label className="mt-2 grid gap-1 text-[11px] text-subtle">
              <span>区域中心位置（尺）</span>
              <input
                type="number"
                min={0}
                value={areaOriginFeet ?? actorPosition ?? 0}
                onChange={(event) => setAreaOriginFeet(Number(event.target.value))}
                className="rounded-[8px] border border-border bg-bg px-2 py-1 text-xs text-fg"
              />
            </label>
          )}
          {canEdit && definition?.ritual && !inCombat && (
            <label className="mt-2 flex items-center gap-2 text-[11px] text-subtle">
              <input
                type="checkbox"
                checked={ritual}
                onChange={(event) => {
                  setRitual(event.target.checked);
                  if (event.target.checked) setUpcast(false);
                }}
              />
              以仪式施放（不耗法术位，额外 10 分钟）
            </label>
          )}
          {canEdit && (
            <Button
              className="mt-2"
              disabled={busy || !ready}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await castSpell({
                    data: {
                      code,
                      spellId: id,
                      slot: selectedSlot > 0 ? selectedSlot : undefined,
                      targetIds: targetIds.filter(Boolean),
                      choice: choice || undefined,
                      destinationFeet: id === "misty" && inCombat ? destinationFeet : undefined,
                      originFeet:
                        definition?.area?.origin === "point" && inCombat
                          ? areaOriginFeet ?? actorPosition ?? 0
                          : undefined,
                      ritual,
                    },
                  });
                  if (!tableActionAccepted(res)) toast.error(String(res.error ?? "施放失败"));
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "施放失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "施放……" : "施放"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function NpcBoard({
  npcs,
}: {
  npcs: { id: string; name: string; intro: string }[];
}) {
  if (!npcs.length) {
    return (
      <p className="text-sm text-muted">
        还没人走到灯下来。见过面的人会出现在这里。
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {npcs.map((n) => (
        <li
          key={n.id}
          className="rounded-[16px] border border-border bg-bg/40 p-3"
        >
          <p className="font-medium">{n.name}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{n.intro}</p>
        </li>
      ))}
    </ul>
  );
}

function StockChip({ item }: { item: StockItem }) {
  const empty = item.remain <= 0;
  return (
    <div className="rounded-[8px] border border-border bg-bg/40 px-2 py-2">
      <p className="text-[10px] leading-none text-subtle">{item.label}</p>
      <p className="mt-1 font-display text-xl leading-none tabular-nums text-fg">
        {item.remain}
        {item.max != null && (
          <span className="ml-0.5 text-xs font-sans text-subtle">/{item.max}</span>
        )}
      </p>
      <p className="mt-1 text-[10px] leading-none text-subtle">
        {empty && item.max != null ? "用尽" : item.note ?? "\u00a0"}
      </p>
    </div>
  );
}

function Stat({
  k,
  v,
  remain,
  max,
}: {
  k: string;
  v?: string | number;
  remain?: number;
  max?: number;
}) {
  return (
    <div className="rounded-[12px] border border-border px-3 py-2">
      <p className="text-[10px] text-subtle">{k}</p>
      {remain != null && max != null ? (
        <p className="font-display tabular-nums">
          <span className="text-fg">{remain}</span>
          <span className="text-sm text-subtle">/{max}</span>
        </p>
      ) : (
        <p className="font-display tabular-nums text-fg">{v}</p>
      )}
    </div>
  );
}

function ClueBoard({ clues }: { clues: TableSnap["state"]["clues"] }) {
  if (!clues.length) {
    return (
      <div>
        <p className="text-[11px] text-subtle">全桌共享，任何人发现后都会同步到这里。</p>
        <p className="mt-2 text-sm text-muted">线索板还是空的。去看、去问、去翻。</p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-3 text-[11px] text-subtle">
        全桌共享 · 表层线索可继续检定，成功后会在原卡片上更新。
      </p>
      <ul className="grid gap-3">
        {clues.map((c) => (
          <li
            key={c.id}
            className="rounded-[16px] border border-border bg-bg/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{c.name}</p>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-subtle">
                {c.layer === "full" ? "已确认" : "表层"}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted">{c.text}</p>
            {c.layer === "talk" && c.hint ? (
              <p className="mt-1 text-[11px] text-brass">{c.hint}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogView({
  logs,
  party,
}: {
  logs: TableSnap["logs"];
  party: TableSnap["characters"];
}) {
  const hp = useMemo(
    () =>
      party
        .filter((p) => p.visibility !== "identityOnly")
        .map((p) => `${p.sheet.name} ${p.sheet.hp.current}/${p.sheet.hp.max}`)
        .join(" · "),
    [party],
  );
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-xs text-subtle">生命 {hp}</p>
      <ol className="space-y-2">
        {logs.map((l) => (
          <li key={l.id} className="border-l-2 border-brass/40 pl-3 text-muted">
            {l.entry}
          </li>
        ))}
      </ol>
      {logs.length === 0 && (
        <p className="text-muted">日志将在行动之后生长。</p>
      )}
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
