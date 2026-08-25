import { requireApiUser, requestJson, routeError } from "../_shared";
import {
  answerSquad,
  approveSquadQueue,
  cancelRest,
  cancelSquadInvite,
  castSpell,
  createRoom,
  endTurn,
  extraAttack,
  fetchTable,
  getCatalog,
  inviteSquad,
  joinCombat,
  joinRoom,
  kickMember,
  leaveFight,
  leaveSquadNow,
  leaveTable,
  listMyRooms,
  lockCharacter,
  passCaptain,
  resolveReact,
  resolveRoll,
  restNow,
  sendAction,
  setGear,
  setRoomModel,
  startGame,
  useFeature,
  useHitDie,
} from "../../_runtime/lib/table/server";
import {
  speakNarration,
  transcribeAudio,
} from "../../_runtime/lib/voice/server";

export const dynamic = "force-dynamic";

type Callable = (input: { data: never; userId: string }) => Promise<unknown>;

const commands: Record<string, Callable> = {
  answerSquad,
  approveSquadQueue,
  cancelRest,
  cancelSquadInvite,
  castSpell,
  createRoom,
  endTurn,
  extraAttack,
  fetchTable,
  getCatalog,
  inviteSquad,
  joinCombat,
  joinRoom,
  kickMember,
  leaveFight,
  leaveSquadNow,
  leaveTable,
  listMyRooms,
  lockCharacter,
  passCaptain,
  resolveReact,
  resolveRoll,
  restNow,
  sendAction,
  setGear,
  setRoomModel,
  speakNarration,
  startGame,
  transcribeAudio,
  useFeature,
  useHitDie,
};

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const payload = await requestJson<{ command?: string; data?: unknown }>(request);
    const command = payload.command ? commands[payload.command] : undefined;
    if (!command) return Response.json({ error: "未知桌面指令。" }, { status: 404 });
    return Response.json(
      await command({ data: payload.data as never, userId: user.userId }),
    );
  } catch (error) {
    return routeError(error);
  }
}
