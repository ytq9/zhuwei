"use client";

import type { TableSnap } from "@/components/play-table";
import type { CharacterSheet } from "@/lib/dnd/types";
import type { KpModelId } from "@/lib/kp/models";
import { callWithStableSubmission } from "@/lib/table/authoritative-client";

async function call<T>(command: string, data?: unknown): Promise<T> {
  const response = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, data }),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "桌面暂时没有回应");
  return payload;
}

type Args = { data: any };
type Result = any;

export type RestNowData = {
  code: string;
  kind: "short" | "long";
  mode?: "personal" | "group";
  hitDice?: number;
  /** authoritative-v2 only; the Room/Rules authority validates and settles it. */
  arcaneRecoverySlotLevels?: number[];
  /** Legacy Adapter only. authoritative-v2 never converts this shorthand. */
  arcane?: 0 | 1 | 2;
  submissionId?: string;
  pendingInputId?: string;
};

function sessionSubmissionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function callWithStableTableSubmission(command: string, data: unknown) {
  const payload = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  return callWithStableSubmission({
    command,
    data: payload,
    storage: sessionSubmissionStorage(),
    invoke: (stablePayload) => call<Result>(command, stablePayload),
  });
}

export type RoomManagementResult =
  | {
      ok: true;
      room: {
        code: string;
        title: string;
        status: string;
        ruleset_version: string;
        kp_model: KpModelId | null;
      };
      characters: {
        userId: string;
        locked: boolean;
        sheet: CharacterSheet;
        updatedAt: string;
      }[];
    }
  | { ok: false; error: string };

export const listMyRooms = () => call<Result>("listMyRooms");
export const getRoomManagement = ({ data }: Args) =>
  call<RoomManagementResult>("getRoomManagement", data);
export const deleteRoom = ({ data }: Args) => call<Result>("deleteRoom", data);
export const getCatalog = () => call<Result>("getCatalog");
export const createRoom = ({ data }: Args) => call<Result>("createRoom", data);
export const joinRoom = ({ data }: Args) => callWithStableTableSubmission("joinRoom", data);
export type FetchTableResult =
  | ({ ok: true } & TableSnap)
  | { ok: false; error: string; left?: true };
export const fetchTable = ({ data }: Args) =>
  call<FetchTableResult>("fetchTable", data);
export const lockCharacter = ({ data }: Args) => callWithStableTableSubmission("lockCharacter", data);
export const setGear = ({ data }: Args) => callWithStableTableSubmission("setGear", data);
export const setRoomModel = ({ data }: Args) => call<Result>("setRoomModel", data);
export const startGame = ({ data }: Args) => call<Result>("startGame", data);
export const sendAction = ({ data }: Args) => call<Result>("sendAction", data);
export const adjustSafetyPresentation = ({ data }: Args) =>
  callWithStableTableSubmission("adjustSafetyPresentation", data);
export const acknowledgeDelivery = ({ data }: Args) =>
  call<Result>("acknowledgeDelivery", data);
export const resolveRoll = ({ data }: Args) => callWithStableTableSubmission("resolveRoll", data);
export const joinCombat = ({ data }: Args) => callWithStableTableSubmission("joinCombat", data);
export const extraAttack = ({ data }: Args) => callWithStableTableSubmission("extraAttack", data);
export const endTurn = ({ data }: Args) => callWithStableTableSubmission("endTurn", data);
export const leaveFight = ({ data }: Args) => callWithStableTableSubmission("leaveFight", data);
export const resolveReact = ({ data }: Args) => callWithStableTableSubmission("resolveReact", data);
export const restNow = ({ data }: { data: RestNowData }) =>
  callWithStableTableSubmission("restNow", data);
export const cancelRest = ({ data }: Args) => callWithStableTableSubmission("cancelRest", data);
export const castSpell = ({ data }: Args) => callWithStableTableSubmission("castSpell", data);
export const useFeature = ({ data }: Args) => callWithStableTableSubmission("useFeature", data);
export const useHitDie = ({ data }: Args) => callWithStableTableSubmission("useHitDie", data);
export const kickMember = ({ data }: Args) => callWithStableTableSubmission("kickMember", data);
export const leaveTable = ({ data }: Args) => callWithStableTableSubmission("leaveTable", data);
export const inviteSquad = ({ data }: Args) => callWithStableTableSubmission("inviteSquad", data);
export const cancelSquadInvite = ({ data }: Args) =>
  callWithStableTableSubmission("cancelSquadInvite", data);
export const answerSquad = ({ data }: Args) => callWithStableTableSubmission("answerSquad", data);
export const leaveSquadNow = ({ data }: Args) =>
  callWithStableTableSubmission("leaveSquadNow", data);
export const passCaptain = ({ data }: Args) => callWithStableTableSubmission("passCaptain", data);
export const approveSquadQueue = ({ data }: Args) => call<Result>("approveSquadQueue", data);
