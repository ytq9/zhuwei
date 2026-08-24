import { AuthError } from "../../_lib/auth.server";

export async function authJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new AuthError("请求内容无法读取。", 400);
  }
}

export function authRouteError(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "登录服务暂时无法响应。" }, { status: 500 });
}
