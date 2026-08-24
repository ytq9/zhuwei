import { userFromCookie } from "../../../_lib/auth.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json({ user: await userFromCookie(request.headers.get("cookie")) });
}
