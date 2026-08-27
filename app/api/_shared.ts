import { getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { AuthError } from "../_lib/auth.server";
import { PublicServerError } from "../_runtime/lib/platform/server-fn";

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

export function routeError(error: unknown) {
  if (
    error instanceof HttpError
    || error instanceof AuthError
    || error instanceof PublicServerError
  ) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: "桌面暂时无法响应，请稍后再试。" },
    { status: 500 },
  );
}
