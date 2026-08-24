import {
  assertSameOrigin,
  registerWithPassword,
  sessionCookie,
} from "../../../_lib/auth.server";
import { authJson, authRouteError } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const payload = await authJson(request);
    const result = await registerWithPassword(payload);
    return Response.json(
      { user: result.user },
      {
        status: 201,
        headers: { "set-cookie": sessionCookie(request.url, result.token) },
      },
    );
  } catch (error) {
    return authRouteError(error);
  }
}
