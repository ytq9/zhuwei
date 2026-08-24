"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CharacterWizard } from "@/components/character-wizard";
import { PlayTable } from "@/components/play-table";
import {
  fetchTable,
  kickMember,
  leaveTable,
  lockCharacter,
  startGame,
  joinRoom,
} from "@/lib/table/client";
import { toast } from "sonner";
import { classById, raceById } from "@/lib/dnd/catalog";
import { LogoutButton } from "../../logout-button";

export function TableClient({ code, userName }: { code: string; userName: string }) {
  const q = useQuery({
    queryKey: ["table", code],
    queryFn: () => fetchTable({ data: code }),
    refetchInterval: 1600,
    placeholderData: (prev) => prev,
  });
  const data = q.data;
  const lockToViewport =
    data?.ok === true &&
    data.room.status === "play" &&
    data.characters.some((c) => c.userId === data.me.userId && c.locked);

  return (
    <main
      className={
        lockToViewport
          ? "flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg"
          : "flex min-h-dvh flex-col bg-bg"
      }
    >
      <header className="flex shrink-0 items-center justify-between px-4 py-3 md:px-6">
        <Link href="/hall" className="font-display text-lg">烛帷</Link>
        <div className="flex items-center gap-2">
          <span className="max-w-28 truncate text-sm text-muted">{userName}</span>
          <LogoutButton />
        </div>
      </header>
      <div
        className={
          lockToViewport
            ? "flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-4 md:px-6"
            : "flex min-h-0 flex-1 flex-col px-3 pb-4 md:px-6"
        }
      >
        {q.isLoading && !data && (
          <p className="m-auto text-muted">正在掀开帷幕……</p>
        )}
        {data && !data.ok && "left" in data && data.left && (
          <LeftTable code={code} />
        )}
        {data && !data.ok && !("left" in data && data.left) && (
          <div className="m-auto grid gap-3 text-center">
            <p className="text-danger">{data.error}</p>
            <Link href="/hall" className="text-sm text-brass hover:text-fg">回酒馆</Link>
          </div>
        )}
        {data && data.ok && data.room.status !== "play" && (
          <Lobby snap={data} code={code} />
        )}
        {data && data.ok && data.room.status === "play" && (
          <>
            {!data.characters.some(
              (c) => c.userId === data.me.userId && c.locked,
            ) ? (
              <div className="mx-auto w-full max-w-3xl">
                <p className="mb-4 text-sm text-muted">
                  团已经开始。先把人物卡锁定，才能开口。
                </p>
                <LockWizard code={code} />
              </div>
            ) : (
              <PlayTable code={code} snap={data} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Lobby({
  code,
  snap,
}: {
  code: string;
  snap: Extract<Awaited<ReturnType<typeof fetchTable>>, { ok: true }>;
}) {
  const mine = snap.characters.find((c) => c.userId === snap.me.userId);
  const qc = useQueryClient();
  const [kickId, setKickId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => startGame({ data: code }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error);
      else void qc.invalidateQueries({ queryKey: ["table", code] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        {!mine?.locked ? (
          <LockWizard code={code} />
        ) : (
          <div className="rounded-[28px] border border-border bg-surface p-8">
            <p className="text-xs tracking-[0.2em] text-brass">已入座</p>
            <h2 className="mt-2 font-display text-3xl">{mine.sheet.name}</h2>
            <p className="mt-2 text-muted">
              {raceById(mine.sheet.raceId)?.name}
              {classById(mine.sheet.classId)?.name} · AC {mine.sheet.ac} · HP{" "}
              {mine.sheet.hp.max}
            </p>
            <p className="mt-6 text-sm text-muted">
              等房主宣布守灵开始。你可以在心里再读一遍自己的缺点。
            </p>
          </div>
        )}
      </div>
      <aside className="rounded-[28px] border border-border bg-surface p-5">
        <p className="text-xs text-subtle">房间码</p>
        <p className="font-mono text-2xl tracking-[0.3em] text-brass">{snap.room.code}</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => {
            void navigator.clipboard.writeText(snap.room.code).then(
              () => toast.success("房间码已复制"),
              () => toast.error("复制失败，请长按选中"),
            );
          }}
        >
          复制房间码
        </Button>
        <p className="mt-1 text-xs text-muted">发给朋友，让他们从酒馆加入。</p>
        <h3 className="mt-6 font-display">在座 {snap.members.length}/5</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {snap.members.map((m) => {
            const pc = snap.characters.find((c) => c.userId === m.user_id);
            return (
              <li
                key={m.user_id}
                className="flex items-center justify-between gap-2 rounded-[12px] border border-border px-3 py-2"
              >
                <span>
                  {m.nickname || "无名"}
                  {m.is_host ? " · 房主" : ""}
                  <span className="block text-xs text-subtle">
                    {pc?.locked ? pc.sheet.name : "还在建卡"}
                  </span>
                </span>
                {snap.me.is_host && !m.is_host && (
                  kickId === m.user_id ? (
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="text-xs text-danger hover:text-fg"
                        onClick={() => {
                          kickMember({ data: { code, userId: m.user_id } })
                            .then((res) => {
                              if (res && "ok" in res && !res.ok) toast.error(res.error);
                              else {
                                toast.success("已请离。对方用房间码还能再进来。");
                                setKickId(null);
                                void qc.invalidateQueries({ queryKey: ["table", code] });
                              }
                            })
                            .catch((e: Error) => toast.error(e.message));
                        }}
                      >
                        确认请离
                      </button>
                      <button
                        type="button"
                        className="text-xs text-subtle hover:text-fg"
                        onClick={() => setKickId(null)}
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-subtle hover:text-danger"
                      onClick={() => setKickId(m.user_id)}
                    >
                      请离
                    </button>
                  )
                )}
                {m.user_id === snap.me.userId && (
                  <button
                    type="button"
                    className="text-xs text-subtle hover:text-danger"
                    onClick={() =>
                      leaveTable({ data: { code } }).then((res) => {
                        if (res && "ok" in res && !res.ok) toast.error(res.error);
                        else window.location.assign("/hall");
                      }).catch((e: Error) => toast.error(e.message))
                    }
                  >
                    离开
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {snap.me.is_host && (
          <Button
            className="mt-6 w-full"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? "掀开帷幕……" : "开始守灵"}
          </Button>
        )}
      </aside>
    </div>
  );
}

function LockWizard({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <CharacterWizard
      busy={busy}
      onLock={async (draft) => {
        setBusy(true);
        try {
          const res = await lockCharacter({ data: { code, draft } });
          if (!res.ok) toast.error(res.error);
          else toast.success(`${res.sheet.name} 已坐下`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "无法锁定");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

function LeftTable({ code }: { code: string }) {
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="m-auto grid max-w-md gap-3 px-4 text-center">
      <p className="text-fg">你已离开这一桌。</p>
      <p className="text-sm text-muted">
        人物卡还留着。用房间码再进来，会坐回原来的角色，时间对齐到桌上现在这一拍。
      </p>
      <input
        className="rounded-[12px] border border-border bg-bg px-3 py-2 text-sm"
        placeholder="桌上怎么称呼你"
        value={nick}
        onChange={(e) => setNick(e.target.value)}
      />
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await joinRoom({
              data: { code, nickname: nick.trim() || "冒险者" },
            });
            if (!res.ok) toast.error(res.error);
            else window.location.reload();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "进不去");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在入座……" : "再进来"}
      </Button>
      <Link href="/hall" className="text-sm text-brass hover:text-fg">回酒馆</Link>
    </div>
  );
}
