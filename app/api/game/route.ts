import { HttpError, requireApiUser, requestJson, routeError } from "../_shared";
import { assertSameOrigin } from "../../_lib/auth.server";
import { gameRequestDiagnostics } from "../../_runtime/lib/platform/game-request-diagnostics";
import {
  acknowledgeDelivery,
  answerSquad,
  cancelRest,
  controlActivity,
  cancelSquadInvite,
  createRoom,
  deleteRoom,
  endTurn,
  fetchTable,
  getCatalog,
  getRoomManagement,
  inviteSquad,
  joinRoom,
  kickMember,
  leaveSquadNow,
  leaveTable,
  listMyRooms,
  lockCharacter,
  passCaptain,
  resolveRoll,
  restNow,
  retryNarration,
  sendAction,
  setGear,
  startGame,
  useInventoryItem,
  moveOnMap,
  combatAbility,
} from "../../_runtime/lib/table/server";
import {
  speakNarration,
  transcribeAudio,
} from "../../_runtime/lib/voice/server";
import {
  createHistoricalRoom,
  exportStoryHistoryPage,
  listHistoricalStarts,
} from "../../_runtime/lib/room/story-history-server";

export const dynamic = "force-dynamic";

type Callable = (input: { data: never; userId: string }) => Promise<unknown>;

const commands: Record<string, Callable> = Object.assign(Object.create(null), {
  acknowledgeDelivery,
  answerSquad,
  cancelRest,
  controlActivity,
  cancelSquadInvite,
  combatAbility,
  createRoom,
  createHistoricalRoom,
  deleteRoom,
  endTurn,
  exportStoryHistoryPage,
  fetchTable,
  getCatalog,
  getRoomManagement,
  inviteSquad,
  joinRoom,
  kickMember,
  leaveSquadNow,
  leaveTable,
  listMyRooms,
  listHistoricalStarts,
  lockCharacter,
  moveOnMap,
  passCaptain,
  resolveRoll,
  restNow,
  retryNarration,
  sendAction,
  setGear,
  speakNarration,
  startGame,
  transcribeAudio,
  useInventoryItem,
});

function preventDomainResponseCaching(response: Response): Response {
  response.headers.set("cache-control", "no-store, private");
  response.headers.set("pragma", "no-cache");
  return response;
}

export async function POST(request: Request) {
  const diagnostics = gameRequestDiagnostics(request);
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const payload = await requestJson<{ command?: string; data?: unknown }>(request);
    const command = typeof payload.command === "string"
        && Object.hasOwn(commands, payload.command)
      ? commands[payload.command]
      : undefined;
    if (!command) {
      return preventDomainResponseCaching(diagnostics.response(routeError(
        new HttpError("未知桌面指令。", 404), diagnostics.reference,
      )));
    }
    diagnostics.started(payload.command!, user.userId, payload.data);
    const result = await command({ data: payload.data as never, userId: user.userId });
    diagnostics.completed(payload.command!, user.userId, payload.data, result);
    return preventDomainResponseCaching(diagnostics.response(Response.json(result)));
  } catch (error) {
    return preventDomainResponseCaching(diagnostics.response(routeError(error, diagnostics.reference)));
  }
}
