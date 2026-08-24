import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!isPending) {
      setStuck(false);
      return;
    }
    const t = window.setTimeout(() => setStuck(true), 2200);
    return () => window.clearTimeout(t);
  }, [isPending]);

  if (user) return <>{children}</>;

  if (isPending) {
    return (
      <main className="flex min-h-dvh flex-col bg-bg text-fg">
        <header className="flex items-center justify-between px-5 py-4">
          <Link to="/" className="font-display text-lg">
            烛帷
          </Link>
          <Link to="/login" className="text-sm text-fg/80 hover:text-fg">
            登录
          </Link>
        </header>
        <div className="grid flex-1 place-items-center px-6 pb-24 text-center">
          <div className="max-w-sm">
            <p className="font-display text-lg tracking-wide text-muted">
              {stuck ? "灯芯晃了一下" : "正在确认座位……"}
            </p>
            <p className="mt-2 text-sm text-subtle">
              {stuck
                ? "进不去这一页。多半是登录还没落下，回首页或再登一次。"
                : "酒馆要先认出你是谁。等不及可以回首页。"}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button asChild variant="ghost">
                <Link to="/">回首页</Link>
              </Button>
              <Button asChild>
                <Link to="/login">去登录</Link>
              </Button>
              {stuck && (
                <Button
                  type="button"
                  variant="subtle"
                  onClick={() => window.location.reload()}
                >
                  再试一次
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return <RedirectToSignIn />;
}
