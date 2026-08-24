import {
  assertSameOrigin,
  expiredSessionCookie,
  revokeSession,
} from "../../../_lib/auth.server";
import { authRouteError } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeSession(request.headers.get("cookie"));
    return Response.json(
      { ok: true },
      { headers: { "set-cookie": expiredSessionCookie(request.url) } },
    );
  } catch (error) {
    return authRouteError(error);
  }
}
