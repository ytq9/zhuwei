import { getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";

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
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError("请求内容无法读取。", 400);
  }
}

export function routeError(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  const message =
    error instanceof Error ? error.message : "桌面暂时无法响应，请稍后再试。";
  return Response.json({ error: message }, { status });
}
