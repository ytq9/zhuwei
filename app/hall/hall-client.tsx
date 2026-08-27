"use client";

/* eslint-disable @next/next/no-img-element -- preserve the upstream GitHub markup */

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { classById, raceById } from "@/lib/dnd/catalog";
import {
  AUTHORITATIVE_KP_MODELS,
  DEFAULT_KP_MODEL,
  LEGACY_KP_MODELS,
  kpModelById,
  type AuthoritativeKpModelId,
  type KpModelId,
} from "@/lib/kp/models";
import { AUTHORITATIVE_RULESET_VERSION } from "@/lib/rules/ruleset";
import {
  createRoom,
  deleteRoom,
  getRoomManagement,
  joinRoom,
  listMyRooms,
  setRoomModel,
  type RoomManagementResult,
} from "@/lib/table/client";
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
  const [model, setModel] = useState<AuthoritativeKpModelId>(DEFAULT_KP_MODEL);
  const [code, setCode] = useState("");
  const [managedCode, setManagedCode] = useState<string | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const rooms = useQuery<RoomRow[]>({
    queryKey: ["my-rooms"],
    queryFn: () => listMyRooms(),
    initialData: initialRooms,
  });
  const management = useQuery<RoomManagementResult>({
    queryKey: ["room-management", managedCode],
    queryFn: () => {
      if (!managedCode) throw new Error("没有选中要管理的桌子");
      return getRoomManagement({ data: { code: managedCode } });
    },
    enabled: Boolean(managedCode),
  });
  const creating = useMutation({
    mutationFn: () => createRoom({ data: { nickname: nick, model } }),
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.error);
      window.location.assign(`/table/${result.code}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const choosingModel = useMutation({
    mutationFn: ({ roomCode, model }: { roomCode: string; model: KpModelId }) =>
      setRoomModel({ data: { code: roomCode, model } }),
    onSuccess: (result, variables) => {
      if (!result.ok) return toast.error(result.error);
      toast.success("本桌模型已保存");
      void queryClient.invalidateQueries({
        queryKey: ["room-management", variables.roomCode],
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleting = useMutation({
    mutationFn: (roomCode: string) => deleteRoom({ data: { code: roomCode } }),
    onSuccess: (result, roomCode) => {
      if (!result.ok) return toast.error(result.error);
      toast.success(`桌子 ${roomCode} 已删除`);
      setManagedCode((current) => (current === roomCode ? null : current));
      setDeleteConfirmCode(null);
      void queryClient.invalidateQueries({ queryKey: ["my-rooms"] });
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
            <fieldset className="mt-5">
              <legend className="text-xs text-subtle">创建桌子前选择 KP 模型</legend>
              <div className="mt-2 grid gap-2">
                {AUTHORITATIVE_KP_MODELS.map((option) => {
                  const selected = option.id === model;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      className={`rounded-[12px] border px-3 py-3 text-left transition ${
                        selected
                          ? "border-brass bg-brass/10 text-fg"
                          : "border-border text-muted hover:border-brass/60 hover:text-fg"
                      }`}
                      onClick={() => setModel(option.id)}
                    >
                      <span className="block text-sm font-medium">{option.name}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {option.summary}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-subtle">模型随桌子固定，创建后不能更换。</p>
            </fieldset>
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
            {rooms.data?.map((room) => {
              const managementData =
                management.data?.ok && management.data.room.code === room.code
                  ? management.data
                  : null;
              const managedModel = managementData
                ? kpModelById(managementData.room.kp_model)
                : null;
              return (
                <article
                  key={room.id}
                  className="overflow-hidden rounded-[12px] border border-border bg-elevated/50"
                >
                  <div className="flex items-stretch">
                    <Link
                      href={`/table/${room.code}`}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 hover:bg-elevated"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{room.title}</p>
                        <p className="text-xs text-subtle">
                          {room.code} · {room.is_host ? "房主" : "玩家"} · {room.status === "play" ? "进行中" : room.status === "ended" ? "已结束" : "筹备"}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm text-brass">入座</span>
                    </Link>
                    {Boolean(room.is_host) && (
                      <div className="flex shrink-0 flex-col justify-center gap-1 border-l border-border px-2 py-2">
                        <button
                          type="button"
                          aria-expanded={managedCode === room.code}
                          aria-controls={`room-management-${room.code}`}
                          className="rounded-[8px] px-2 py-1 text-xs text-brass hover:bg-bg/50 hover:text-fg"
                          onClick={() => {
                            setDeleteConfirmCode(null);
                            setManagedCode((current) =>
                              current === room.code ? null : room.code,
                            );
                          }}
                        >
                          管理桌子
                        </button>
                        <button
                          type="button"
                          className="rounded-[8px] px-2 py-1 text-xs text-subtle hover:bg-danger/10 hover:text-danger"
                          onClick={() => {
                            setManagedCode(null);
                            setDeleteConfirmCode((current) =>
                              current === room.code ? null : room.code,
                            );
                          }}
                        >
                          删除桌子
                        </button>
                      </div>
                    )}
                  </div>
                  {managedCode === room.code && (
                    <div
                      id={`room-management-${room.code}`}
                      className="border-t border-border bg-bg/35 px-4 py-4"
                    >
                    {management.isLoading && (
                      <p className="text-sm text-muted">正在翻桌面记录……</p>
                    )}
                    {management.data && !management.data.ok && (
                      <p className="text-sm text-danger">{management.data.error}</p>
                    )}
                    {managementData && (
                      <div className="grid gap-5">
                        <section>
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-medium">
                              {managementData.room.ruleset_version === AUTHORITATIVE_RULESET_VERSION
                                ? "AI 模型"
                                : "选择 AI 模型"}
                            </h3>
                            {managementData.room.ruleset_version === AUTHORITATIVE_RULESET_VERSION ? (
                              <span className="text-[11px] text-subtle">创建时已固定</span>
                            ) : managementData.room.status !== "lobby" ? (
                              <span className="text-[11px] text-subtle">开团后已锁定</span>
                            ) : null}
                          </div>
                          {managementData.room.ruleset_version === AUTHORITATIVE_RULESET_VERSION ? (
                            <div className="mt-2 rounded-[12px] border border-brass bg-brass/10 px-3 py-3">
                              <p className="text-sm font-medium">
                                {managedModel?.name ?? "历史兼容模型"}
                              </p>
                              {managedModel && (
                                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                                  {managedModel.summary}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="mt-2 grid gap-2">
                              {LEGACY_KP_MODELS.map((option) => {
                                const selected = option.id === managementData.room.kp_model;
                                const pending = choosingModel.isPending
                                  && choosingModel.variables?.roomCode === room.code;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    aria-pressed={selected}
                                    disabled={
                                      pending
                                      || selected
                                      || managementData.room.status !== "lobby"
                                    }
                                    className={`rounded-[12px] border px-3 py-2 text-left transition disabled:cursor-default ${
                                      selected
                                        ? "border-brass bg-brass/10 text-fg"
                                        : "border-border text-muted hover:border-brass/60 hover:text-fg disabled:opacity-50"
                                    }`}
                                    onClick={() => choosingModel.mutate({
                                      roomCode: room.code,
                                      model: option.id,
                                    })}
                                  >
                                    <span className="block text-sm font-medium">{option.name}</span>
                                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                                      {option.summary}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </section>
                        <section className="border-t border-border pt-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-medium">历史人物卡</h3>
                            <span className="text-[11px] text-subtle">
                              {managementData.characters.length} 张
                            </span>
                          </div>
                          {managementData.characters.length === 0 ? (
                            <p className="mt-2 text-xs text-muted">这桌还没有锁定过人物卡。</p>
                          ) : (
                            <ul className="mt-2 grid gap-2">
                              {managementData.characters.map((character) => (
                                <li
                                  key={character.userId}
                                  className="rounded-[12px] border border-border bg-elevated/50 px-3 py-2"
                                >
                                  <p className="text-sm font-medium">
                                    {character.sheet.name || "未名冒险者"}
                                  </p>
                                  <p className="mt-0.5 text-xs text-muted">
                                    {raceById(character.sheet.raceId)?.name ?? "未知种族"}
                                    {classById(character.sheet.classId)?.name ?? "未知职业"}
                                    {` · ${character.sheet.level ?? 3} 级 · AC ${character.sheet.ac ?? "—"} · HP ${character.sheet.hp?.max ?? "—"}`}
                                  </p>
                                  <p className="mt-1 text-[11px] text-subtle">
                                    {character.locked ? "已锁定" : "草稿"} · 最后更新 {formatHistoryTime(character.updatedAt)}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </div>
                    )}
                    </div>
                  )}
                  {deleteConfirmCode === room.code && (
                    <div className="border-t border-danger/30 bg-danger/10 px-4 py-4">
                    <p className="text-sm text-fg">确定删除这张桌？</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      人物卡、消息、线索和日志会一起删除，无法从酒馆恢复。
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        disabled={deleting.isPending}
                        onClick={() => deleting.mutate(room.code)}
                      >
                        {deleting.isPending ? "正在删除……" : "确认删除"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleting.isPending}
                        onClick={() => setDeleteConfirmCode(null)}
                      >
                        取消
                      </Button>
                    </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
