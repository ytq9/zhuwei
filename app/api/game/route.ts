import { requireApiUser, requestJson, routeError } from "../_shared";
import { assertSameOrigin } from "../../_lib/auth.server";
import {
  acknowledgeDelivery,
  adjustSafetyPresentation,
  answerSquad,
  approveSquadQueue,
  cancelRest,
  cancelSquadInvite,
  castSpell,
  createRoom,
  deleteRoom,
  endTurn,
  extraAttack,
  fetchTable,
  getCatalog,
  getRoomManagement,
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
  requestSafetyPause,
  retryNarration,
  sendAction,
  setGear,
  startGame,
  useFeature,
  useHitDie,
  useInventoryItem,
} from "../../_runtime/lib/table/server";
import {
  speakNarration,
  transcribeAudio,
} from "../../_runtime/lib/voice/server";

export const dynamic = "force-dynamic";

type Callable = (input: { data: never; userId: string }) => Promise<unknown>;

const commands: Record<string, Callable> = Object.assign(Object.create(null), {
  acknowledgeDelivery,
  adjustSafetyPresentation,
  answerSquad,
  approveSquadQueue,
  cancelRest,
  cancelSquadInvite,
  castSpell,
  createRoom,
  deleteRoom,
  endTurn,
  extraAttack,
  fetchTable,
  getCatalog,
  getRoomManagement,
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
  requestSafetyPause,
  retryNarration,
  sendAction,
  setGear,
  speakNarration,
  startGame,
  transcribeAudio,
  useFeature,
  useHitDie,
  useInventoryItem,
});

function preventDomainResponseCaching(response: Response): Response {
  response.headers.set("cache-control", "no-store, private");
  response.headers.set("pragma", "no-cache");
  return response;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const payload = await requestJson<{ command?: string; data?: unknown }>(request);
    const command = typeof payload.command === "string"
        && Object.hasOwn(commands, payload.command)
      ? commands[payload.command]
      : undefined;
    if (!command) {
      return preventDomainResponseCaching(
        Response.json({ error: "未知桌面指令。" }, { status: 404 }),
      );
    }
    return preventDomainResponseCaching(Response.json(
      await command({ data: payload.data as never, userId: user.userId }),
    ));
  } catch (error) {
    return preventDomainResponseCaching(routeError(error));
  }
}
