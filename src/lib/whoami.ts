import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const whoAmI = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ userId: context.userId }));

/** Resolve a seat token even when cookies / sessionStorage are empty. */
export const resolveSeat = createServerFn({ method: "GET" })
  .validator((d: { seat?: string | null }) => ({
    seat: d?.seat?.trim() || undefined,
  }))
  .handler(async ({ data }) => {
    const { getSessionUser } = await import("@/lib/auth/verify.server");
    const user = await getSessionUser(data.seat);
    if (!user) return null;
    return { userId: user.id, email: user.email };
  });
