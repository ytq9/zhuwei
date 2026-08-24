import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { ensureDbReady } from "@/lib/db";

async function handleAuth(request: Request) {
  try {
    await ensureDbReady();
    return await auth.handler(request);
  } catch (err) {
    console.error("[auth]", err);
    const path = new URL(request.url).pathname;
    if (path.includes("get-session")) {
      return Response.json(null, { status: 200 });
    }
    return Response.json(
      {
        error: true,
        message: err instanceof Error ? err.message : "登录服务暂时不可用",
      },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
