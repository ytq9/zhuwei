import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  consumeSeatParam,
  keepSeatAlive,
  readStoredToken,
  restorePreviewSession,
} from "@/lib/preview-session";
import { resolveSeat } from "@/lib/whoami";

/** Logged-in if Better Auth session OR a stored seat token is valid. */
export function useSeated() {
  keepSeatAlive();
  restorePreviewSession();
  const { user, isPending } = useCurrentUserState();
  const token =
    typeof window !== "undefined" ? readStoredToken() : null;
  const who = useQuery({
    queryKey: ["resolve-seat", token],
    queryFn: async () => {
      restorePreviewSession();
      const seat = readStoredToken();
      try {
        return await resolveSeat({ data: { seat } });
      } catch {
        return null;
      }
    },
    retry: 1,
    staleTime: 8_000,
  });

  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 1600);
    return () => window.clearTimeout(t);
  }, []);

  const seated = Boolean(user) || Boolean(who.data?.userId);

  useEffect(() => {
    if (seated) consumeSeatParam();
  }, [seated]);

  useEffect(() => {
    restorePreviewSession();
    if (user) return;
    if (!readStoredToken()) return;
    void authClient.getSession();
  }, [user, token]);

  return {
    user,
    seated,
    isPending: !seated && !waited && (isPending || who.isLoading),
  };
}
