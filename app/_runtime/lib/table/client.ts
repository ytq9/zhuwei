"use client";

import type { TableSnap } from "@/components/play-table";
import type { CharacterSheet } from "@/lib/dnd/types";
import type { KpModelId } from "@/lib/kp/models";

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

export type RoomManagementResult =
  | {
      ok: true;
      room: {
        code: string;
        title: string;
        status: string;
        kp_model: KpModelId;
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
export const joinRoom = ({ data }: Args) => call<Result>("joinRoom", data);
export type FetchTableResult =
  | ({ ok: true } & TableSnap)
  | { ok: false; error: string; left?: true };
export const fetchTable = ({ data }: Args) =>
  call<FetchTableResult>("fetchTable", data);
export const lockCharacter = ({ data }: Args) => call<Result>("lockCharacter", data);
export const setGear = ({ data }: Args) => call<Result>("setGear", data);
export const setRoomModel = ({ data }: Args) => call<Result>("setRoomModel", data);
export const startGame = ({ data }: Args) => call<Result>("startGame", data);
export const sendAction = ({ data }: Args) => call<Result>("sendAction", data);
export const resolveRoll = ({ data }: Args) => call<Result>("resolveRoll", data);
export const joinCombat = ({ data }: Args) => call<Result>("joinCombat", data);
export const extraAttack = ({ data }: Args) => call<Result>("extraAttack", data);
export const endTurn = ({ data }: Args) => call<Result>("endTurn", data);
export const leaveFight = ({ data }: Args) => call<Result>("leaveFight", data);
export const resolveReact = ({ data }: Args) => call<Result>("resolveReact", data);
export const restNow = ({ data }: Args) => call<Result>("restNow", data);
export const cancelRest = ({ data }: Args) => call<Result>("cancelRest", data);
export const castSpell = ({ data }: Args) => call<Result>("castSpell", data);
export const useFeature = ({ data }: Args) => call<Result>("useFeature", data);
export const useHitDie = ({ data }: Args) => call<Result>("useHitDie", data);
export const kickMember = ({ data }: Args) => call<Result>("kickMember", data);
export const leaveTable = ({ data }: Args) => call<Result>("leaveTable", data);
export const inviteSquad = ({ data }: Args) => call<Result>("inviteSquad", data);
export const cancelSquadInvite = ({ data }: Args) => call<Result>("cancelSquadInvite", data);
export const answerSquad = ({ data }: Args) => call<Result>("answerSquad", data);
export const leaveSquadNow = ({ data }: Args) => call<Result>("leaveSquadNow", data);
export const passCaptain = ({ data }: Args) => call<Result>("passCaptain", data);
export const approveSquadQueue = ({ data }: Args) => call<Result>("approveSquadQueue", data);
