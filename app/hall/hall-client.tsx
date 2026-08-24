"use client";

/* eslint-disable @next/next/no-img-element -- preserve the upstream GitHub markup */

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRoom, joinRoom, listMyRooms } from "@/lib/table/client";
import { LogoutButton } from "../logout-button";

type RoomRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  is_host: boolean | number;
  created_at: string;
};

export function HallClient({
  userName,
  initialRooms,
}: {
  userName: string;
  initialRooms: RoomRow[];
}) {
  const [nick, setNick] = useState(userName.slice(0, 16));
  const [code, setCode] = useState("");
  const rooms = useQuery<RoomRow[]>({
    queryKey: ["my-rooms"],
    queryFn: () => listMyRooms(),
    initialData: initialRooms,
  });
  const creating = useMutation({
    mutationFn: () => createRoom({ data: { nickname: nick } }),
    onSuccess: (result) => {
      if (result.ok) window.location.assign(`/table/${result.code}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const joining = useMutation({
    mutationFn: () => joinRoom({ data: { code, nickname: nick } }),
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.error);
      window.location.assign(`/table/${result.code}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <main className="min-h-dvh bg-bg px-5 py-6 md:px-10">
      <header className="mx-auto flex max-w-5xl items-center justify-between">
        <Link href="/" className="font-display text-xl">烛帷</Link>
        <div className="flex items-center gap-2">
          <span className="max-w-28 truncate text-sm text-muted">{userName}</span>
          <LogoutButton />
        </div>
      </header>
      <div className="mx-auto mt-10 grid max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="overflow-hidden rounded-[28px] border border-border bg-surface">
          <img src="/art/inn.jpg" alt="" className="h-44 w-full object-cover" />
          <div className="p-6">
            <p className="text-xs tracking-[0.2em] text-brass">今晚开桌</p>
            <h1 className="mt-2 font-display text-3xl">黑橡居酒屋的第三份遗嘱</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">你来当房主，把房间码发给朋友。每人先建一张 3 级人物卡，你宣布守灵开始。</p>
            <label htmlFor="hall-nickname" className="mt-6 block text-xs text-subtle">桌上怎么称呼你</label>
            <Input id="hall-nickname" className="mt-2" value={nick} onChange={(event) => setNick(event.target.value)} placeholder="名字" maxLength={16} />
            <Button className="mt-4 w-full" size="lg" disabled={creating.isPending} onClick={() => creating.mutate()}>
              {creating.isPending ? "正在摆桌……" : "我来做房主"}
            </Button>
            <div className="mt-8 border-t border-border pt-6">
              <p className="text-sm text-muted">已有房间码？坐下。</p>
              <div className="mt-3 flex gap-2">
                <Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="例如 7K3MPL" className="uppercase tracking-widest" />
                <Button variant="ghost" disabled={joining.isPending || code.trim().length < 4} onClick={() => joining.mutate()}>加入</Button>
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-[28px] border border-border bg-surface p-6">
          <h2 className="font-display text-xl">你的桌子</h2>
          <div className="mt-4 grid gap-2">
            {rooms.isLoading && <p className="text-sm text-muted">正在翻账本……</p>}
            {rooms.data?.length === 0 && <p className="text-sm text-muted">还没有开过桌。</p>}
            {rooms.data?.map((room) => (
              <Link key={room.id} href={`/table/${room.code}`} className="flex items-center justify-between rounded-[12px] border border-border bg-elevated/50 px-4 py-3 hover:bg-elevated">
                <div>
                  <p className="font-medium">{room.title}</p>
                  <p className="text-xs text-subtle">{room.code} · {room.is_host ? "房主" : "玩家"} · {room.status === "play" ? "进行中" : room.status === "ended" ? "已结束" : "筹备"}</p>
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
