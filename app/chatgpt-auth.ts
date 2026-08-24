import { headers } from "next/headers";
import { userFromCookie } from "./_lib/auth.server";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  return userFromCookie(requestHeaders.get("cookie"));
}

export function chatGPTSignInPath(returnTo = "/hall"): string {
  const next = returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : "/hall";
  return `/login?next=${encodeURIComponent(next)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  void returnTo;
  return "/api/auth/logout";
}
