import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { persistAuthToken } from "@/lib/preview-session";
import { useSeated } from "@/components/use-seated";
import { AccountChip } from "@/components/account-chip";
import { AuthPanel } from "@/components/auth-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRoom, joinRoom, listMyRooms } from "@/lib/table/server";
import { toast } from "sonner";

export const Route = createFileRoute("/hall")({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): { seat?: string } =>
    typeof raw.seat === "string" && raw.seat.length > 0
      ? { seat: raw.seat }
      : {},
  beforeLoad: ({ search }) => {
    if (search.seat) persistAuthToken({ token: search.seat });
  },
  component: Hall,
});

function Hall() {
  const { user, seated, isPending } = useSeated();
  const [nick, setNick] = useState(user?.displayName?.slice(0, 16) ?? "");
  const [code, setCode] = useState("");
  useEffect(() => {
    const n = user?.displayName?.slice(0, 16);
    if (n) setNick((prev) => prev || n);
  }, [user?.displayName]);
  const rooms = useQuery({
    queryKey: ["my-rooms", user?.id],
    queryFn: () => listMyRooms(),
    enabled: seated,
  });
  const creating = useMutation({
    mutationFn: () => createRoom({ data: { nickname: nick } }),
    onSuccess: (res) => {
      if (res.ok) window.location.assign(`/table/${res.code}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const joining = useMutation({
    mutationFn: () => joinRoom({ data: { code, nickname: nick } }),
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.error);
      window.location.assign(`/table/${res.code}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="min-h-dvh bg-bg px-5 py-6 md:px-10">
      <header className="mx-auto flex max-w-5xl items-center justify-between">
        <Link to="/" className="font-display text-xl">
          烛帷
        </Link>
        <AccountChip />
      </header>
      <div className="mx-auto mt-10 grid max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="overflow-hidden rounded-[28px] border border-border bg-surface">
          <img src="/art/inn.jpg" alt="" className="h-44 w-full object-cover" />
          <div className="p-6">
            <p className="text-xs tracking-[0.2em] text-brass">今晚开桌</p>
            <h1 className="mt-2 font-display text-3xl">黑橡居酒屋的第三份遗嘱</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              你来当房主，把房间码发给朋友。每人先建一张 3 级人物卡，你宣布守灵开始。
            </p>
            {seated ? (
              <>
                <label className="mt-6 block text-xs text-subtle">
                  桌上怎么称呼你
                </label>
                <Input
                  className="mt-2"
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  placeholder="名字"
                  maxLength={16}
                />
                <Button
                  className="mt-4 w-full"
                  size="lg"
                  disabled={creating.isPending}
                  onClick={() => creating.mutate()}
                >
                  {creating.isPending ? "正在摆桌……" : "我来做房主"}
                </Button>
                <div className="mt-8 border-t border-border pt-6">
                  <p className="text-sm text-muted">已有房间码？坐下。</p>
                  <div className="mt-3 flex gap-2">
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="例如 7K3MPL"
                      className="uppercase tracking-widest"
                    />
                    <Button
                      variant="ghost"
                      disabled={joining.isPending || code.trim().length < 4}
                      onClick={() => joining.mutate()}
                    >
                      加入
                    </Button>
                  </div>
                </div>
              </>
            ) : isPending ? (
              <p className="mt-6 text-sm text-muted">正在确认座位……</p>
            ) : (
              <div className="mt-6">
                <AuthPanel mode="in" embed next="/hall" />
              </div>
            )}
          </div>
        </section>
        <section className="rounded-[28px] border border-border bg-surface p-6">
          <h2 className="font-display text-xl">你的桌子</h2>
          <div className="mt-4 grid gap-2">
            {!seated && (
              <p className="text-sm text-muted">登录后，开过的桌会留在这里。</p>
            )}
            {user && rooms.isLoading && (
              <p className="text-sm text-muted">正在翻账本……</p>
            )}
            {user && rooms.data?.length === 0 && (
              <p className="text-sm text-muted">还没有开过桌。</p>
            )}
            {rooms.data?.map((r) => (
              <Link
                key={r.id}
                to="/table/$code"
                params={{ code: r.code }}
                className="flex items-center justify-between rounded-[12px] border border-border bg-elevated/50 px-4 py-3 hover:bg-elevated"
              >
                <div>
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-subtle">
                    {r.code} · {r.is_host ? "房主" : "玩家"} ·{" "}
                    {r.status === "play"
                      ? "进行中"
                      : r.status === "ended"
                        ? "已结束"
                        : "筹备"}
                  </p>
                </div>
                <span className="text-sm text-brass">入座</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
