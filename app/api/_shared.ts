import { getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { AuthError } from "../_lib/auth.server";
import { PublicServerError } from "../_runtime/lib/platform/server-fn";
import { buildRoomTelemetryEvent } from "../_runtime/lib/room/telemetry";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function requireApiUser(): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError("请先登录。", 401);
  return user;
}

export async function requestJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new HttpError("请求内容类型必须是 JSON。", 415);
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError("请求内容无法读取。", 400);
  }
}

export function routeError(error: unknown, requestId?: string) {
  const known = error instanceof HttpError || error instanceof AuthError || error instanceof PublicServerError;
  const status = known ? error.status : 500;
  // SPEC 0011 §§1、5: record the HTTP boundary before returning public copy.
  // Status is evidence; an unknown 500 does not prove a Provider timeout.
  try {
    console.error(JSON.stringify(buildRoomTelemetryEvent({
      occurredAt: new Date().toISOString(), eventName: "http.request.failed", severity: status >= 500 ? "error" : "warn", requestId,
      httpStatus: status, outcome: { kind: "rejected" },
      failure: { stage: "httpRequest", error, code: status === 401 ? "HTTP_AUTHENTICATION_REQUIRED"
        : status === 403 ? "HTTP_FORBIDDEN" : status === 404 ? "HTTP_ROUTE_NOT_FOUND"
          : status === 415 ? "HTTP_CONTENT_TYPE_INVALID" : status < 500 ? "HTTP_REQUEST_INVALID" : "authorityTransient" },
    })));
  } catch { /* Diagnostics cannot change the response. */ }
  if (
    error instanceof HttpError
    || error instanceof AuthError
    || error instanceof PublicServerError
  ) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: "游戏服务处理请求时发生内部错误，具体原因尚未确认。请先刷新桌面核对结果；若持续出现，请将操作时间和步骤反馈给维护者。" },
    { status: 500 },
  );
}
