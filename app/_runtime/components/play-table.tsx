import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { CharacterSheet, SkillId } from "@/lib/dnd/types";
import { ABILITIES, ABILITY_LABEL, SKILLS } from "@/lib/dnd/types";
import { classById, raceById, spellById } from "@/lib/dnd/catalog";
import { ensureGear, skillBonus } from "@/lib/dnd/compute";
import {
  GEAR_SLOTS,
  allowedSlots,
  itemById,
  packSummary,
  slotLabel,
  wornSummary,
  type GearSlot,
} from "@/lib/dnd/gear";
import { abilityMod, cn, signed } from "@/lib/utils";
import { transcribeAudio, speakNarration } from "@/lib/voice/client";
import { resolveRoll, sendAction, setGear, joinCombat, endTurn, leaveFight, resolveReact, restNow, cancelRest, castSpell, useFeature, extraAttack, inviteSquad, answerSquad, leaveSquadNow, approveSquadQueue, passCaptain, leaveTable, cancelSquadInvite, kickMember } from "@/lib/table/client";
import type { PendingRoll } from "@/lib/kp/prompt";
import type { PublicCombat } from "@/lib/kp/combat";
import { eligibleBoosts } from "@/lib/dnd/boosts";
import { ensureResources, left, listStocks, type StockItem } from "@/lib/dnd/resources";
import { toast } from "sonner";
import { Mic, Send, ScrollText, UserRound, MapPinned, Users } from "lucide-react";

export type TableMessage = {
  id: string;
  user_id: string | null;
  kind: string;
  name: string;
  body: string;
  created_at: string;
  clues?: { id: string; name: string; hint: string }[];
};

export type TableSnap = {
  me: { userId: string; is_host: boolean; nickname: string };
  room: {
    id: string;
    code: string;
    title: string;
    status: string;
    module_id: string;
    kp_model: string;
  };
  members: { user_id: string; nickname: string; is_host: boolean }[];
  characters: { userId: string; locked: boolean; sheet: CharacterSheet }[];
  messages: TableMessage[];
  locationThreads: {
    placeId: string;
    name: string;
    messages: TableMessage[];
  }[];
  logs: { id: string; entry: string; created_at: string }[];
  state: {
    chapterName: string;
    sceneName: string;
    kpBusy: boolean;
    pendingRolls: PendingRoll[];
    clues: {
      id: string;
      name: string;
      text: string;
      hint: string;
      layer: "talk" | "full";
    }[];
    npcs: { id: string; name: string; intro: string }[];
    sceneId?: string;
    places?: Record<string, string>;
    placeNames?: Record<string, string>;
    partySplit?: boolean;
    clocks?: Record<string, { beats: number; minutes: number; lag: number }>;
    restVote?: {
      kind: "short" | "long";
      fromName: string;
      agreed: string[];
      waiting: string[];
    } | null;
    restHold?: {
      kind: "short" | "long";
      resters: string[];
      fromName: string;
      needBeats: number;
      remain: number;
    } | null;
    squads?: { ids: string[]; captain: string }[];
    squadInvite?: { from: string; to: string; fromName: string } | null;
    squadQueue?: { id: string; userId: string; name: string; body: string; beat: number }[];
    combat?: PublicCombat | null;
  };
  module: { title: string; chapters: { id: string; name: string }[] };
};

export function PlayTable({
  code,
  snap,
}: {
  code: string;
  snap: TableSnap;
}) {
  const [tab, setTab] = useState<"sheet" | "npcs" | "clues" | "log">("sheet");
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(`zhuwei-draft-${code}`) ?? "";
    } catch {
      return "";
    }
  });
  const [sending, setSending] = useState(false);
  const [rec, setRec] = useState<"idle" | "rec" | "stt">("idle");
  const spokenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const composingRef = useRef(false);
  const sendingRef = useRef(false);
  const [localSays, setLocalSays] = useState<
    { id: string; body: string; name: string }[]
  >([]);

  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`zhuwei-draft-${code}`, text);
      else sessionStorage.removeItem(`zhuwei-draft-${code}`);
    } catch {
      /* ignore */
    }
  }, [code, text]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [snap.messages.length]);

  useEffect(() => {
    const kpKinds = new Set(["narrate", "refuse", "call_roll", "open"]);
    if (!primedRef.current) {
      for (const m of snap.messages) {
        if (kpKinds.has(m.kind)) spokenRef.current.add(m.id);
      }
      primedRef.current = true;
      return;
    }
    const latest = [...snap.messages].reverse().find((m) => kpKinds.has(m.kind));
    if (!latest || spokenRef.current.has(latest.id)) return;
    spokenRef.current.add(latest.id);
    void playTts(snap.room.id, latest.id);
  }, [snap.messages, snap.room.id]);

  useEffect(() => {
    setLocalSays((prev) =>
      prev.filter(
        (l) =>
          !snap.messages.some(
            (m) =>
              m.user_id === snap.me.userId &&
              m.kind === "say" &&
              m.body === l.body,
          ),
      ),
    );
  }, [snap.messages, snap.me.userId]);

  async function submit() {
    const body = text.trim();
    if (!body || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const mineName =
      snap.characters.find((c) => c.userId === snap.me.userId)?.sheet.name || "你";
    const localId = `local-${Date.now()}`;
    setLocalSays((ls) => [...ls, { id: localId, body, name: mineName }]);
    setText("");
    try {
      const res = await sendAction({ data: { code, text: body } });
      if (!res.ok) {
        setLocalSays((ls) => ls.filter((x) => x.id !== localId));
        setText((t) => (t ? t : body));
        toast.error(res.error);
      } else if ("queued" in res && res.queued) {
        setLocalSays((ls) => ls.filter((x) => x.id !== localId));
        toast.message("已入队内缓冲。队长本拍内未批准就会消失。");
      }
    } catch (e) {
      setLocalSays((ls) => ls.filter((x) => x.id !== localId));
      setText((t) => (t ? t : body));
      toast.error(e instanceof Error ? e.message : "没能送出");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mime = mr.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        setRec("stt");
        try {
          const b64 = await blobToB64(blob);
          const out = await transcribeAudio({ data: { mime, b64 } });
          if (!out.ok) toast.error(out.error);
          else setText((t) => (t ? `${t} ${out.text}` : out.text));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "听写失败");
        } finally {
          setRec("idle");
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRec("rec");
    } catch {
      toast.error("无法使用麦克风");
    }
  }

  function stopRec() {
    if (mediaRef.current && rec === "rec") mediaRef.current.stop();
  }

  const pendingMine = snap.state.pendingRolls.filter(
    (r) => r.userId === snap.me.userId && !r.result,
  );

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(13.5rem,38dvh)] gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(17.5rem,22rem)] lg:grid-rows-1">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-border bg-surface">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <div>
            <p className="font-display text-lg">{snap.module.title}</p>
            <p className="text-xs text-subtle">
              {snap.state.chapterName} · {snap.state.sceneName}
              {snap.state.kpBusy ? " · KP 正在落笔" : ""}
            </p>
            {snap.state.partySplit ? (
              <p className="mt-0.5 text-[11px] text-brass">
                队伍已分开，同一条时间线。你只听见自己这边；最多差三拍，领先的人先停。
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <p className="font-mono text-xs tracking-widest text-brass">
              {snap.room.code}
            </p>
            <button
              type="button"
              className="text-[11px] text-subtle hover:text-danger"
              onClick={() => {
                void leaveTable({ data: { code } }).then((res) => {
                  if (res && "ok" in res && !res.ok) toast.error(res.error);
                });
              }}
            >
              离开这一桌
            </button>
          </div>
        </div>
        <LocationHistoryBar
          threads={snap.locationThreads}
          meId={snap.me.userId}
        />
        {snap.state.combat ? (
          <div className="shrink-0 overflow-y-auto border-b border-border px-4 py-3 lg:max-h-[30vh]">
            <CombatStrip
              code={code}
              combat={snap.state.combat}
              meId={snap.me.userId}
              isHost={snap.me.is_host}
              myPlace={snap.state.places?.[snap.me.userId] ?? snap.state.sceneId ?? "wake"}
              meSheet={
                snap.characters.find((c) => c.userId === snap.me.userId)?.sheet
              }
              party={snap.characters.map((c) => ({
                userId: c.userId,
                name: c.sheet.name,
                place: snap.state.places?.[c.userId],
              }))}
            />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {snap.messages.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              mine={m.user_id === snap.me.userId}
            />
          ))}
          {localSays.map((l) => (
            <MessageBubble
              key={l.id}
              m={{
                id: l.id,
                user_id: snap.me.userId,
                kind: "say",
                name: l.name,
                body: l.body,
                created_at: "",
              }}
              mine
            />
          ))}
          <div ref={endRef} />
        </div>
        {pendingMine.length > 0 && (
          <div className="shrink-0 border-t border-border px-5 py-3">
            <p className="mb-2 text-xs text-brass">轮到你掷骰</p>
            <div className="flex flex-col gap-3">
              {pendingMine.map((r) => (
                <RollButton
                  key={r.id}
                  code={code}
                  roll={r}
                  party={snap.characters}
                  where={snap.state.places ?? {}}
                  sceneId={snap.state.sceneId ?? "wake"}
                  combat={snap.state.combat ?? null}
                />
              ))}
            </div>
          </div>
        )}
        {(snap.state.squadQueue?.length ?? 0) > 0 && (
          <SquadQueueBar
            code={code}
            meId={snap.me.userId}
            queue={snap.state.squadQueue ?? []}
            squads={snap.state.squads ?? []}
          />
        )}
        <form
          className="flex shrink-0 items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <button
            type="button"
            aria-label="按住说话"
            onPointerDown={(e) => {
              e.preventDefault();
              void startRec();
            }}
            onPointerUp={stopRec}
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-[14px] border",
              rec === "rec"
                ? "border-danger bg-danger text-fg"
                : "border-border text-muted hover:text-fg",
            )}
          >
            <Mic className="size-5" />
          </button>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            placeholder={
              rec === "rec"
                ? "正在听……松手后写入输入框"
                : rec === "stt"
                  ? "正在转写……"
                  : snap.state.squads?.some(
                        (s) => s.ids.includes(snap.me.userId) && s.captain !== snap.me.userId,
                      )
                    ? "队员发言先给队长看。点右侧按钮送出。批准后才进桌。"
                    : "你做什么、说什么。点右侧按钮送出，回车只换行。"
            }
            className="min-h-12 max-h-36 flex-1"
            rows={2}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || composingRef.current || e.key === "Process") {
                return;
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            disabled={sending || !text.trim()}
            onClick={() => void submit()}
          >
            <Send className="size-4" />
          </Button>
        </form>
      </section>

      <aside className="flex min-h-0 flex-col rounded-[28px] border border-border bg-surface">
        <div className="flex border-b border-border">
          {(
            [
              ["sheet", UserRound, "人物"],
              ["npcs", Users, "在场"],
              ["clues", MapPinned, "线索"],
              ["log", ScrollText, "日志"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 py-3 text-xs sm:text-sm",
                tab === id ? "text-fg" : "text-subtle hover:text-muted",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "sheet" && (
            <SheetView
              party={snap.characters}
              meId={snap.me.userId}
              isHost={snap.me.is_host}
              code={code}
              inCombat={Boolean(snap.state.combat)}
              placeNames={snap.state.placeNames}
              clocks={snap.state.clocks}
              partySplit={snap.state.partySplit}
              restVote={snap.state.restVote}
              restHold={snap.state.restHold}
              squads={snap.state.squads}
              squadInvite={snap.state.squadInvite}
              places={snap.state.places}
            />
          )}
          {tab === "npcs" && <NpcBoard npcs={snap.state.npcs} />}
          {tab === "clues" && <ClueBoard clues={snap.state.clues} />}
          {tab === "log" && <LogView logs={snap.logs} party={snap.characters} />}
        </div>
      </aside>
    </div>
  );
}

function CombatStrip({
  code,
  combat,
  meId,
  isHost,
  myPlace,
  meSheet,
  party,
}: {
  code: string;
  combat: PublicCombat | null;
  meId: string;
  isHost: boolean;
  myPlace: string;
  meSheet?: CharacterSheet;
  party: { userId: string; name: string; place?: string }[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();
  if (!combat) return null;
  const here = combat.place === myPlace;
  const mine = combat.order.find((o) => o.id === meId);
  const inFight = Boolean(mine?.inCombat);
  const myTurn = combat.activeId === meId;
  const watchers = party.filter(
    (p) =>
      (p.place ?? myPlace) === combat.place &&
      !combat.order.some((o) => o.id === p.userId && o.inCombat),
  );

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, key: string) {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "做不到");
      else void qc.invalidateQueries({ queryKey: ["table", code] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "做不到");
    } finally {
      setBusy(null);
    }
  }

  if (!here) {
    return (
      <div className="rounded-[16px] border border-border bg-elevated px-4 py-3 text-sm text-muted">
        别处有人打起来了。你这边听不见刀声的细节。要介入，得先过去。
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-border bg-elevated px-4 py-3">
      <p className="text-[11px] tracking-wide text-brass">
        战斗 · 第 {combat.round} 轮 · {combat.place}
        {combat.waiting === "init" ? " · 先攻" : ""}
      </p>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {combat.order
          .filter((o) => o.inCombat)
          .map((o) => (
            <li
              key={o.id}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                o.id === combat.activeId
                  ? "border-brass bg-brass/15 text-fg"
                  : "border-border text-muted",
              )}
            >
              {o.name}
              {o.init != null ? ` ${o.init}` : ""}
              {o.band === "melee" ? " ·贴身" : o.band === "far" ? " ·远" : " ·近"}
              {o.cover === "half" ? " ·半掩" : o.cover === "three" ? " ·¾掩" : o.cover === "total" ? " ·全掩" : ""}
              {o.kind === "npc" ? "" : o.id === meId ? " ·你" : ""}
              {o.id === meId && o.spend
                ? ` ·${o.spend.action ? "动作" : ""}${o.spend.bonus ? "附赠" : ""}${o.spend.reaction ? "反应" : ""}${!o.spend.action && !o.spend.bonus && !o.spend.reaction ? "耗尽" : ""}`
                : ""}
            </li>
          ))}
      </ol>
      {combat.hazards.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
          {combat.hazards.map((h) => (
            <li key={h.id}>
              {h.name}：{h.text}
            </li>
          ))}
        </ul>
      )}
      {combat.reacts
        ?.filter((r) => r.userId === meId)
        .map((r) => (
          <div key={r.id} className="mt-3 rounded-[12px] border border-brass/40 px-3 py-2">
            <p className="text-xs text-fg">{r.text}</p>
            <div className="mt-2 flex gap-2">
              <Button
                disabled={Boolean(busy)}
                onClick={() =>
                  act(() => resolveReact({ data: { code, reactId: r.id, use: true } }), "rs")
                }
              >
                使用护盾术
              </Button>
              <Button
                disabled={Boolean(busy)}
                onClick={() =>
                  act(() => resolveReact({ data: { code, reactId: r.id, use: false } }), "rn")
                }
              >
                不用
              </Button>
            </div>
          </div>
        ))}
      {watchers.length > 0 && (
        <p className="mt-2 text-[11px] text-subtle">
          同处未参战：{watchers.map((w) => w.name).join("、")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {here && !inFight && (
          <Button
            disabled={busy === "join"}
            onClick={() => act(() => joinCombat({ data: { code } }), "join")}
          >
            {busy === "join" ? "加入……" : "加入战斗"}
          </Button>
        )}
        {inFight && !mine?.init && combat.waiting === "init" && (
          <p className="text-xs text-muted">先掷下面的先攻。</p>
        )}
        {(myTurn || isHost) && combat.waiting === "turn" && inFight && (
          <Button
            disabled={busy === "end"}
            onClick={() => act(() => endTurn({ data: { code } }), "end")}
          >
            {busy === "end" ? "……" : myTurn ? "结束回合" : "跳过这人"}
          </Button>
        )}
        {inFight && (myTurn || isHost) && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act(() => leaveFight({ data: { code, kind: "disengage" } }), "dis")}
            >
              撤离
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act(() => leaveFight({ data: { code, kind: "flee" } }), "flee")}
            >
              跑到远处
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act(() => leaveFight({ data: { code, kind: "withdraw" } }), "out")}
            >
              退出战场
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act(() => leaveFight({ data: { code, kind: "surrender" } }), "surr")}
            >
              投降
            </Button>
          </>
        )}
      </div>
      {(() => {
        const warLeft = meSheet
          ? left(ensureResources(meSheet).resources!.warPriest)
          : 0;
        const canWar =
          myTurn &&
          inFight &&
          combat.waiting === "turn" &&
          Boolean(mine?.spend?.attacked) &&
          mine?.spend?.action === false &&
          Boolean(mine?.spend?.bonus) &&
          warLeft > 0 &&
          meSheet?.subclassId === "war";
        const foes = combat.order.filter(
          (o) => o.kind === "npc" && o.inCombat,
        );
        if (!canWar || !foes.length) return null;
        return (
          <div className="mt-2 flex flex-wrap gap-2">
            {foes.map((o) => (
              <Button
                key={o.id}
                variant="brass"
                size="sm"
                disabled={Boolean(busy)}
                onClick={() =>
                  act(
                    () => extraAttack({ data: { code, targetId: o.id } }),
                    `war-${o.id}`,
                  )
                }
              >
                {busy === `war-${o.id}`
                  ? "……"
                  : `战争祭司再攻 ${o.name}（${warLeft}）`}
              </Button>
            ))}
          </div>
        );
      })()}
      {myTurn && mine?.spend && (
        <p className="mt-2 text-xs text-muted">
          轮到你。剩：
          {mine.spend.action ? " 动作" : ""}
          {mine.spend.bonus ? " 附赠" : ""}
          {mine.spend.reaction ? " 反应" : ""}
          {!mine.spend.action ? "（动作已用，不能再祝福或主手攻击）" : ""}
          {meSheet?.subclassId === "war" &&
          mine.spend.attacked &&
          !mine.spend.action &&
          mine.spend.bonus &&
          left(ensureResources(meSheet).resources!.warPriest) > 0
            ? `。战争祭司还可再攻（${left(ensureResources(meSheet).resources!.warPriest)}）`
            : ""}
          。说攻击谁、施法或撤离。
        </p>
      )}
      {inFight && !myTurn && combat.activeId && combat.waiting === "turn" && (
        <p className="mt-2 text-xs text-subtle">
          等待 {combat.order.find((o) => o.id === combat.activeId)?.name}
        </p>
      )}
    </div>
  );
}

function SquadQueueBar({
  code,
  meId,
  queue,
  squads,
}: {
  code: string;
  meId: string;
  queue: { id: string; userId: string; name: string; body: string; beat: number }[];
  squads: { ids: string[]; captain: string }[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const captain = squads.some((s) => s.captain === meId);
  async function act(id: string, accept: boolean) {
    setBusy(id + String(accept));
    try {
      const res = await approveSquadQueue({ data: { code, queueId: id, accept } });
      if (!res.ok) toast.error(res.error ?? "做不到");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "做不到");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="shrink-0 border-t border-border px-4 py-2">
      <p className="text-[11px] tracking-wide text-brass">
        队内缓冲 · 本拍未批准即消失
      </p>
      <ul className="mt-1.5 grid gap-1.5">
        {queue.map((q) => (
          <li
            key={q.id}
            className="rounded-[12px] border border-border bg-elevated px-3 py-2"
          >
            <p className="text-xs text-subtle">{q.name}</p>
            <p className="text-sm text-fg">{q.body}</p>
            {captain ? (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => act(q.id, true)}
                >
                  {busy === q.id + "true" ? "……" : "批准"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={() => act(q.id, false)}
                >
                  驳回
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-subtle">等待队长批准</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageBubble({
  m,
  mine,
}: {
  m: TableSnap["messages"][number];
  mine: boolean;
}) {
  if (m.kind === "stage") {
    return (
      <p className="px-1 text-center text-[11px] tracking-wide text-subtle">
        {m.body}
      </p>
    );
  }
  const kp = !m.user_id;
  return (
    <article
      className={cn("max-w-[42rem]", mine && "ml-auto", kp && "mx-0 w-full max-w-none")}
    >
      <p className="mb-1 text-[11px] tracking-wide text-subtle">
        {m.kind === "roll" ? m.name : kp ? "KP" : m.name}
        {m.kind === "roll" ? " · 检定" : ""}
        {m.kind === "refuse" ? " · 驳回" : ""}
      </p>
      <div
        className={cn(
          "whitespace-pre-wrap rounded-[16px] px-4 py-3 text-sm leading-relaxed",
          kp
            ? "border border-border bg-elevated font-display text-[15px] leading-7"
            : mine
              ? "bg-primary text-primary-fg"
              : "border border-border bg-bg",
          m.kind === "roll" && "font-mono text-xs",
        )}
      >
        {m.body}
      </div>
      {m.clues && m.clues.length > 0 && (
        <ul className="mt-2 grid gap-1.5">
          {m.clues.map((c) => (
            <li
              key={c.id}
              className="flex gap-2 rounded-[12px] border border-brass/35 bg-elevated px-3 py-2"
            >
              <MapPinned className="mt-0.5 size-3.5 shrink-0 text-brass" />
              <div className="min-w-0">
                <p className="text-[11px] tracking-wide text-brass">
                  钉上线索板 · {c.name}
                </p>
                <p className="text-xs text-muted">{c.hint}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function LocationHistoryBar({
  threads,
  meId,
}: {
  threads: TableSnap["locationThreads"];
  meId: string;
}) {
  const [openPlace, setOpenPlace] = useState<string | null>(null);
  if (!threads.length) return null;
  const openThread = threads.find((thread) => thread.placeId === openPlace);

  return (
    <div className="shrink-0 border-b border-border bg-bg/35">
      <div className="flex items-center gap-2 overflow-x-auto px-4 py-2">
        <span className="shrink-0 text-[10px] tracking-[0.16em] text-subtle">
          曾到过
        </span>
        {threads.map((thread) => {
          const open = thread.placeId === openPlace;
          return (
            <button
              key={thread.placeId}
              type="button"
              aria-expanded={open}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[11px] transition",
                open
                  ? "border-brass bg-brass/10 text-brass"
                  : "border-border text-muted hover:border-brass/60 hover:text-fg",
              )}
              onClick={() => setOpenPlace(open ? null : thread.placeId)}
            >
              {thread.name} · {thread.messages.length}
            </button>
          );
        })}
      </div>
      {openThread ? (
        <section
          aria-label={`${openThread.name}的历史对话`}
          className="max-h-[42dvh] overflow-y-auto border-t border-border px-5 py-4"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-sm text-fg">{openThread.name}</p>
              <p className="text-[11px] text-subtle">只收录你在这里经历过的对话</p>
            </div>
            <button
              type="button"
              className="text-xs text-muted hover:text-fg"
              onClick={() => setOpenPlace(null)}
            >
              收起
            </button>
          </div>
          <div className="space-y-4">
            {openThread.messages.map((message) => (
              <MessageBubble
                key={message.id}
                m={message}
                mine={message.user_id === meId}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RollButton({
  code,
  roll,
  party,
  where,
  sceneId,
  combat,
}: {
  code: string;
  roll: PendingRoll;
  party: TableSnap["characters"];
  where: Record<string, string>;
  sceneId: string;
  combat: PublicCombat | null;
}) {
  const boosts = eligibleBoosts(
    party.map((p) => ({ userId: p.userId, sheet: p.sheet })),
    roll,
    {
      where,
      sceneId,
      inCombat: Boolean(combat),
      activeId: combat?.activeId ?? null,
      spendAction: Object.fromEntries(
        (combat?.order ?? []).map((o) => [o.id, o.spend?.action !== false]),
      ),
    },
  );
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(boosts.map((b) => [b.id, Boolean(b.defaultOn)])),
  );
  const [busy, setBusy] = useState(false);
  const label =
    roll.kind === "init"
      ? "先攻"
      : roll.kind === "damage"
        ? "伤害"
        : roll.kind === "death"
          ? "死亡豁免"
          : roll.kind === "heal"
        ? "治疗"
        : roll.kind === "attack"
            ? "攻击"
            : (SKILLS.find((s) => s.id === roll.skill)?.label ??
              ABILITY_LABEL[roll.ability as keyof typeof ABILITY_LABEL] ??
              roll.ability);
  const alreadyGuide =
    (roll.kind === "check" || roll.kind === "init" || !roll.kind) &&
    party.find((p) => p.userId === roll.userId)?.sheet.resources?.conc?.id ===
      "guidance";
  return (
    <div className="rounded-[16px] border border-border bg-elevated px-3 py-3">
      <p className="text-xs text-muted">{roll.reason}</p>
      {alreadyGuide && (
        <p className="mt-2 text-[11px] text-brass">
          已有神导专注：掷出自动 +1d4，然后结束。
        </p>
      )}
      {boosts.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {boosts.map((b) => (
            <li key={`${b.id}-${b.fromUserId}`}>
              <label
                className={`flex items-start gap-2 text-xs ${b.blocked ? "opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={Boolean(b.blocked)}
                  checked={Boolean(on[b.id]) && !b.blocked}
                  onChange={(e) =>
                    setOn((prev) => ({ ...prev, [b.id]: e.target.checked }))
                  }
                />
                <span>
                  <span className="text-fg">{b.label}</span>
                  <span className="mt-0.5 block text-[11px] text-subtle">
                    {b.blocked ?? b.detail}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button
        className="mt-3"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const boostIds = Object.entries(on)
              .filter(([, v]) => v)
              .map(([k]) => k);
            const res = await resolveRoll({
              data: { code, rollId: roll.id, boostIds },
            });
            if (!res.ok) toast.error(res.error);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "骰子打滑了");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "掷出……" : `掷 ${label} DC ${roll.dc}`}
      </Button>
    </div>
  );
}

function SheetView({
  party,
  meId,
  isHost,
  code,
  inCombat,
  placeNames,
  clocks,
  partySplit,
  restVote,
  restHold,
  squads,
  squadInvite,
  places,
}: {
  party: TableSnap["characters"];
  meId: string;
  isHost?: boolean;
  code: string;
  inCombat: boolean;
  placeNames?: Record<string, string>;
  clocks?: Record<string, { beats: number; minutes: number; lag: number }>;
  partySplit?: boolean;
  restVote?: TableSnap["state"]["restVote"];
  restHold?: TableSnap["state"]["restHold"];
  squads?: { ids: string[]; captain: string }[];
  squadInvite?: { from: string; to: string; fromName: string } | null;
  places?: Record<string, string>;
}) {
  const [openId, setOpenId] = useState<string | null>(meId);
  const [busy, setBusy] = useState<string | null>(null);
  const [kickId, setKickId] = useState<string | null>(null);
  const someoneAhead = Object.values(clocks ?? {}).some((c) => c.lag > 0);
  const groups = squads ?? [];
  const nameOf = (id: string) =>
    party.find((p) => p.userId === id)?.sheet.name || "同伴";
  const myGroup = groups.find((g) => g.ids.includes(meId));
  const inviteToMe = squadInvite?.to === meId ? squadInvite : null;

  async function act(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return;
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "做不到");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "做不到");
    } finally {
      setBusy(null);
    }
  }

  if (!party.length) {
    return <p className="text-sm text-muted">还没有锁定的人物卡。</p>;
  }
  return (
    <div className="grid gap-2">
      {inviteToMe ? (
        <div className="rounded-[12px] border border-brass/40 bg-brass/10 px-3 py-2">
          <p className="text-xs text-fg">{inviteToMe.fromName} 邀请你组队。组队后去留一致。一分钟内不应答会自动取消。</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => act("yes", () => answerSquad({ data: { code, accept: true } }))}
            >
              同意
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => act("no", () => answerSquad({ data: { code, accept: false } }))}
            >
              拒绝
            </Button>
          </div>
        </div>
      ) : null}
      <ul className="grid gap-2">
      {party.map((p) => {
        const sheet = p.sheet;
        const race = raceById(sheet.raceId)?.name;
        const cls = classById(sheet.classId)?.name;
        const open = openId === p.userId;
        const together =
          (places?.[meId] ?? "") !== "" &&
          places?.[meId] === places?.[p.userId];
        const groupedWithMe = Boolean(
          myGroup && p.userId !== meId && myGroup.ids.includes(p.userId),
        );
        const theirGroup = groups.find((g) => g.ids.includes(p.userId));
        return (
          <li key={p.userId} className="overflow-hidden rounded-[16px] border border-border">
            <div className="flex w-full items-start justify-between gap-2 px-3 py-3">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : p.userId)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="font-medium">{sheet.name || "未名"}</span>
                {p.userId === meId && (
                  <span className="ml-2 text-[10px] text-brass">你</span>
                )}
                {theirGroup && theirGroup.ids.length > 1 ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-subtle">
                      组队 · {theirGroup.ids.map(nameOf).join("、")}
                    </span>
                    {p.userId === theirGroup.captain ? (
                      <span className="rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 text-[11px] text-brass">
                        队长
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {placeNames?.[p.userId] ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 text-[11px] text-brass">
                      所在 · {placeNames[p.userId]}
                    </span>
                    {partySplit && clocks?.[p.userId] ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-subtle">
                        {clocks[p.userId].lag > 0
                          ? `领先 ${clocks[p.userId].lag} 拍，先等另一边`
                          : someoneAhead
                            ? "待补这一拍"
                            : `第 ${clocks[p.userId].beats} 拍`}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span className="mt-0.5 block text-xs text-subtle">
                  {race}
                  {cls}
                  {" · 生命 "}
                  <span className="font-display tabular-nums text-fg">
                    {sheet.hp.current}
                  </span>
                  <span className="tabular-nums">/{sheet.hp.max}</span>
                </span>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs text-subtle">{open ? "收起" : "展开"}</span>
                {p.userId !== meId && together && !groupedWithMe ? (
                  squadInvite?.from === meId && squadInvite.to === p.userId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(busy)}
                      onClick={() => act("cancel-inv", () => cancelSquadInvite({ data: { code } }))}
                    >
                      取消邀请
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={Boolean(busy) || squadInvite?.from === meId}
                      onClick={() =>
                        act(`inv-${p.userId}`, () =>
                          inviteSquad({ data: { code, targetUserId: p.userId } }),
                        )
                      }
                    >
                      组队
                    </Button>
                  )
                ) : null}
                {p.userId !== meId &&
                myGroup &&
                myGroup.captain === meId &&
                myGroup.ids.includes(p.userId) ? (
                  <Button
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      act(`cap-${p.userId}`, () =>
                        passCaptain({ data: { code, toUserId: p.userId } }),
                      )
                    }
                  >
                    交队长
                  </Button>
                ) : null}
                {p.userId === meId && myGroup && myGroup.ids.length > 1 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={() => act("leave", () => leaveSquadNow({ data: { code } }))}
                  >
                    离队
                  </Button>
                ) : null}
                {isHost && p.userId !== meId ? (
                  kickId === p.userId ? (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        size="sm"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          act(`kick-${p.userId}`, async () => {
                            const res = await kickMember({
                              data: { code, userId: p.userId },
                            });
                            setKickId(null);
                            if (res.ok) toast.success("已请离。对方用房间码还能再进来。");
                            return res;
                          })
                        }
                      >
                        确认请离
                      </Button>
                      <button
                        type="button"
                        className="text-[11px] text-subtle hover:text-fg"
                        onClick={() => setKickId(null)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(busy)}
                      onClick={() => setKickId(p.userId)}
                    >
                      请离
                    </Button>
                  )
                ) : null}
              </div>
            </div>
            {open && (
              <CharacterDetail
                sheet={sheet}
                canEdit={p.userId === meId}
                code={code}
                inCombat={inCombat}
                placeName={placeNames?.[p.userId]}
                restVote={restVote}
                restHold={restHold}
                meId={meId}
                partyCount={party.length}
              />
            )}
          </li>
        );
      })}
      </ul>
    </div>
  );
}

function Fold({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[12px] border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-xs font-medium">{title}</span>
        <span className="min-w-0 truncate text-[11px] text-subtle">
          {open ? "收起" : hint || "展开"}
        </span>
      </button>
      {open && <div className="border-t border-border px-2.5 py-2">{children}</div>}
    </div>
  );
}

function CharacterDetail({
  sheet,
  canEdit,
  code,
  inCombat,
  placeName,
  restVote,
  restHold,
  meId,
  partyCount,
}: {
  sheet: CharacterSheet;
  canEdit: boolean;
  code: string;
  inCombat: boolean;
  placeName?: string;
  restVote?: TableSnap["state"]["restVote"];
  restHold?: TableSnap["state"]["restHold"];
  meId?: string;
  partyCount?: number;
}) {
  const live = ensureGear(sheet);
  const race = raceById(live.raceId);
  const cls = classById(live.classId);
  const sub = cls?.subclasses.find((s) => s.id === live.subclassId);
  const spellIds = [
    ...new Set([...live.cantrips, ...live.prepared, ...live.spellbook]),
  ];
  const stocks = listStocks(live);
  const packed = ensureResources(live);
  return (
    <div className="grid gap-3 border-t border-border px-3 py-3 text-sm">
      {placeName ? (
        <p className="text-xs text-brass">所在 · {placeName}</p>
      ) : null}
      <p className="text-muted">
        {race?.name}
        {cls?.name}
        {sub ? ` · ${sub.name}` : ""} 3 级
      </p>
      <div className="flex gap-3 tabular-nums">
        <Stat k="AC" v={live.ac} />
        <Stat k="生命" remain={live.hp.current} max={live.hp.max} />
        <Stat k="速度" v={`${live.speed}尺`} />
      </div>
      <ResourcePanel
        sheet={packed}
        canEdit={canEdit}
        code={code}
        inCombat={inCombat}
        restVote={restVote}
        restHold={restHold}
        meId={meId}
        partyCount={partyCount ?? 1}
      />
      <div className="grid grid-cols-3 gap-2">
        {ABILITIES.map((a) => (
          <div
            key={a}
            className="rounded-[12px] border border-border p-2 text-center"
          >
            <p className="text-[10px] text-subtle">{ABILITY_LABEL[a]}</p>
            <p className="font-display text-lg tabular-nums">{live.scores[a]}</p>
            <p className="text-xs text-muted tabular-nums">
              {signed(abilityMod(live.scores[a]))}
            </p>
          </div>
        ))}
      </div>
      <Fold
        title="技能"
        hint={`${live.skills.length} 项熟练`}
      >
        <ul className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
          {SKILLS.filter((s) => live.skills.includes(s.id)).map((s) => (
            <li key={s.id}>
              {s.label}{" "}
              <span className="tabular-nums text-muted">
                {signed(skillBonus(live, s.id as SkillId))}
              </span>
              {live.expertise.includes(s.id as SkillId) && (
                <span className="ml-1 text-[10px] text-brass">专精</span>
              )}
            </li>
          ))}
        </ul>
      </Fold>
      {live.features.length > 0 && (
        <Fold title="动作" hint={`${live.features.length} 条`}>
          <ul className="grid gap-2">
            {live.features.map((f) => (
              <FeatureLine
                key={f.slice(0, 24)}
                text={f}
                stock={stockForFeature(f, stocks)}
              />
            ))}
          </ul>
        </Fold>
      )}
      {spellIds.length > 0 && (
        <Fold
          title="法术"
          hint={
            packed.resources?.slot1.max
              ? `一环 ${left(packed.resources.slot1)}/${packed.resources.slot1.max}`
              : `${spellIds.length} 个`
          }
        >
          <ul className="grid gap-2">
            {spellIds.map((id) => (
              <SpellLine
                key={id}
                id={id}
                canEdit={canEdit}
                code={code}
                stocks={packed}
              />
            ))}
          </ul>
        </Fold>
      )}
      <Fold title="身上" hint={wornSummary(live.equipped ?? {})}>
        <GearSlots
          sheet={live}
          canEdit={canEdit}
          code={code}
        />
      </Fold>
      <Fold title="背包" hint={packSummary(live.backpack ?? [])}>
        <Backpack
          sheet={live}
          canEdit={canEdit}
          code={code}
        />
      </Fold>
      {(live.appearance || live.trait) && (
        <Fold title="角色" hint={live.appearance ? "外貌" : "展开"}>
          {live.appearance && (
            <p className="text-xs leading-relaxed text-muted">{live.appearance}</p>
          )}
          {live.trait && (
            <p className="mt-2 text-xs text-muted">特质：{live.trait}</p>
          )}
          {live.ideal && (
            <p className="mt-1 text-xs text-muted">理想：{live.ideal}</p>
          )}
          {live.bond && (
            <p className="mt-1 text-xs text-muted">羁绊：{live.bond}</p>
          )}
          {live.flaw && (
            <p className="mt-1 text-xs text-muted">缺陷：{live.flaw}</p>
          )}
        </Fold>
      )}
    </div>
  );
}

function ResourcePanel({
  sheet,
  canEdit,
  code,
  inCombat,
  restVote,
  restHold,
  meId,
  partyCount,
}: {
  sheet: CharacterSheet;
  canEdit: boolean;
  code: string;
  inCombat: boolean;
  restVote?: TableSnap["state"]["restVote"];
  restHold?: TableSnap["state"]["restHold"];
  meId?: string;
  partyCount: number;
}) {
  const r = sheet.resources!;
  const [busy, setBusy] = useState<string | null>(null);
  const [rest, setRest] = useState<null | "short" | "long">(null);
  const [dice, setDice] = useState(0);
  const [arcane, setArcane] = useState<0 | 1 | 2>(0);
  const hdLeft = left(r.hitDice);
  const con = abilityMod(sheet.scores.con);
  const needVote = partyCount > 1;
  const myAgreed = Boolean(meId && restVote?.agreed.includes(meId));

  async function go(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (!canEdit || busy) return;
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "做不到");
      else setRest(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "做不到");
    } finally {
      setBusy(null);
    }
  }

  if (rest === "short") {
    return (
      <div className="rounded-[12px] border border-brass/40 px-3 py-3">
        <p className="font-display text-sm">短休 · 约一小时</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          坐下包扎、换绷带。引导神力、动作如潮、回气、战术骰会回来。法术位不回来。
        </p>
        <div className="mt-3">
          <p className="text-xs font-medium">花生命骰回血</p>
          <p className="mt-0.5 text-xs text-muted">
            还剩{" "}
            <span className="font-display tabular-nums text-fg">{hdLeft}</span>
            {" "}颗 d{r.hitDice.die}。每颗大约 1d{r.hitDice.die}＋{con} 生命，不会超过上限 {sheet.hp.max}。现在{" "}
            <span className="font-display tabular-nums text-fg">{sheet.hp.current}</span>
            <span className="tabular-nums text-subtle">/{sheet.hp.max}</span>
            。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="subtle" disabled={dice <= 0} onClick={() => setDice((n) => Math.max(0, n - 1))}>
              −
            </Button>
            <span className="min-w-8 text-center font-display text-lg tabular-nums text-fg">{dice}</span>
            <Button size="sm" variant="subtle" disabled={dice >= hdLeft} onClick={() => setDice((n) => Math.min(hdLeft, n + 1))}>
              ＋
            </Button>
            <span className="text-xs text-subtle">颗</span>
          </div>
        </div>
        {sheet.classId === "wizard" && !r.arcaneRecovery && (
          <div className="mt-3">
            <p className="text-xs font-medium">奥术恢复（每日一次）</p>
            <div className="mt-1 flex gap-1.5">
              {([0, 1, 2] as const).map((n) => (
                <Button key={n} onClick={() => setArcane(n)}>
                  {n === 0 ? "不用" : n === 1 ? "回一个一环" : "回一个二环"}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-subtle">当前选：{arcane === 0 ? "不用" : arcane === 1 ? "一环" : "二环"}</p>
          </div>
        )}
        {inCombat && (
          <p className="mt-2 text-[11px] text-brass">战斗中不能休整。</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            disabled={Boolean(busy) || inCombat}
            onClick={() =>
              go("s", () =>
                restNow({ data: { code, kind: "short", hitDice: dice, arcane } }),
              )
            }
          >
            {busy === "s" ? "结算……" : needVote ? "提议短休" : "开始短休"}
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => setRest(null)}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  if (rest === "long") {
    const hungry = r.ration <= 0;
    return (
      <div className="rounded-[12px] border border-brass/40 px-3 py-3">
        <p className="font-display text-sm">长休 · 过夜</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          睡够大约八小时。生命回满，一环/二环、狂暴、战争祭司、引导、如潮都回来。生命骰补回一半。
        </p>
        <p className="mt-2 text-xs text-muted">
          口粮{" "}
          <span className="font-display tabular-nums text-fg">{r.ration}</span>
          {" "}份。
          {hungry
            ? " 没有口粮：仍能撑过一晚，生命只恢复一半失去的，环位照常回满。"
            : " 会吃掉 1 份。"}
        </p>
        {inCombat && (
          <p className="mt-2 text-[11px] text-brass">战斗中不能休整。</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            disabled={Boolean(busy) || inCombat}
            onClick={() => go("l", () => restNow({ data: { code, kind: "long" } }))}
          >
            {busy === "l" ? "结算……" : needVote ? "提议长休" : "开始长休"}
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => setRest(null)}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border px-3 py-3">
      {canEdit && restHold ? (
        <div className="mb-3 rounded-[10px] border border-brass/40 bg-brass/10 px-3 py-2">
          <p className="text-xs text-fg">
            {restHold.fromName}那边正在{restHold.kind === "long" ? "长休" : "短休"}（共 {restHold.needBeats} 拍）。
            {meId && restHold.resters.includes(meId)
              ? ` 你在歇。另一边再走 ${restHold.remain} 拍后你醒来，时间对齐。`
              : ` 你可继续行动。再 ${restHold.remain} 拍后他们醒来。`}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={Boolean(busy)}
            onClick={() => go("wake", () => cancelRest({ data: { code } }))}
          >
            打断休息
          </Button>
        </div>
      ) : null}
      {canEdit && restVote ? (
        <div className="mb-3 rounded-[10px] border border-brass/40 bg-brass/10 px-3 py-2">
          <p className="text-xs text-fg">
            {restVote.fromName} 提议{restVote.kind === "long" ? "长休" : "短休"}。还差 {restVote.waiting.length} 人同意。
          </p>
          {myAgreed ? (
            <p className="mt-1 text-[11px] text-subtle">你已同意，等其他人。</p>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={Boolean(busy) || inCombat}
                onClick={() =>
                  go("ok", () =>
                    restNow({
                      data: {
                        code,
                        kind: restVote.kind,
                        hitDice: restVote.kind === "short" ? dice : undefined,
                        arcane: restVote.kind === "short" ? arcane : undefined,
                      },
                    }),
                  )
                }
              >
                {busy === "ok" ? "……" : "同意"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={() => go("no", () => cancelRest({ data: { code } }))}
              >
                反对
              </Button>
            </div>
          )}
        </div>
      ) : null}
      <p className="text-xs font-medium">库存</p>
      {r.conc && (
        <p className="mt-1 text-xs text-muted">
          专注中：<span className="text-fg">{r.conc.name}</span>
        </p>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {listStocks(sheet).map((s) => (
          <StockChip key={s.id} item={s} />
        ))}
      </div>
      {r.warPriest.max > 0 && (
        <p className="mt-2 text-xs text-subtle">
          战争祭司：动作打过一次后，战斗条会出现「再攻」。掷出才扣次数。
        </p>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button disabled={Boolean(busy)} onClick={() => setRest("short")}>
            短休
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => setRest("long")}>
            长休
          </Button>
          {r.rage.max > 0 && (
            <Button disabled={Boolean(busy) || left(r.rage) <= 0} onClick={() => go("rg", () => useFeature({ data: { code, feat: "rage" } }))}>
              狂暴
            </Button>
          )}
          {r.surge.max > 0 && (
            <Button disabled={Boolean(busy) || left(r.surge) <= 0} onClick={() => go("sg", () => useFeature({ data: { code, feat: "surge" } }))}>
              动作如潮
            </Button>
          )}
          {r.secondWind.max > 0 && (
            <Button disabled={Boolean(busy) || left(r.secondWind) <= 0} onClick={() => go("sw", () => useFeature({ data: { code, feat: "secondWind" } }))}>
              回气
            </Button>
          )}
          {r.torch > 0 && (
            <Button disabled={Boolean(busy)} onClick={() => go("t", () => useFeature({ data: { code, feat: "torch" } }))}>
              点火把
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function stockForFeature(text: string, stocks: StockItem[]) {
  const hit = (id: string) => stocks.find((s) => s.id === id);
  if (/战争祭司/.test(text)) return hit("warPriest");
  if (/引导神力|导向打击|维持生命/.test(text)) return hit("channel");
  if (/狂暴/.test(text)) return hit("rage");
  if (/动作如潮|surg/.test(text)) return hit("surge");
  if (/回气/.test(text)) return hit("secondWind");
  if (/战术|优越/.test(text)) return hit("superiority");
  if (/奥术结界/.test(text)) return hit("ward");
  return undefined;
}

function FeatureLine({ text, stock }: { text: string; stock?: StockItem }) {
  const [open, setOpen] = useState(false);
  const title = text.split(/[：:]/)[0] ?? text;
  const rest = text.slice(title.length).replace(/^[：:]/, "");
  return (
    <div className="rounded-[10px] border border-border bg-bg/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-2 px-2.5 py-2 text-left text-xs"
      >
        <span className="font-medium">{title}</span>
        {stock && (
          <span className="ml-auto shrink-0 tabular-nums">
            <span className="font-display text-sm text-fg">{stock.remain}</span>
            {stock.max != null && (
              <span className="text-subtle">/{stock.max}</span>
            )}
          </span>
        )}
        {!open && !stock && rest && (
          <span className="min-w-0 flex-1 truncate text-subtle">{rest}</span>
        )}
      </button>
      {open && (
        <p className="border-t border-border px-2.5 py-2 text-xs leading-relaxed text-muted">
          {text}
        </p>
      )}
    </div>
  );
}

function SpellLine({
  id,
  canEdit,
  code,
  stocks,
}: {
  id: string;
  canEdit: boolean;
  code: string;
  stocks: CharacterSheet;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sp = spellById(id);
  if (!sp) return null;
  const r = ensureResources(stocks).resources!;
  const slot = sp.level === 1 ? r.slot1 : sp.level === 2 ? r.slot2 : null;
  const ring = sp.level === 0 ? "戏法" : `${sp.level} 环`;
  return (
    <div className="rounded-[10px] border border-border bg-bg/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-xs font-medium">{sp.name}</span>
        <span className="text-xs text-subtle">
          {ring}
          {sp.level === 0 ? (
            <span> · 不耗位</span>
          ) : slot ? (
            <>
              {" · "}
              <span className="font-display tabular-nums text-fg">{left(slot)}</span>
              <span className="tabular-nums">/{slot.max}</span>
            </>
          ) : null}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-2.5 py-2">
          {(sp.time || sp.range || sp.duration) && (
            <p className="text-[11px] text-subtle">
              {[sp.time, sp.range, sp.duration].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="mt-1 text-xs leading-relaxed text-muted">{sp.text}</p>
          {canEdit && (
            <Button
              className="mt-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await castSpell({ data: { code, spellId: id } });
                  if (!res.ok) toast.error(res.error ?? "施放失败");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "施放失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "施放……" : "施放"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function useGearAct(code: string, canEdit: boolean) {
  const [busy, setBusy] = useState<string | null>(null);
  async function act(
    action: "wear" | "stow",
    slot: GearSlot,
    itemId?: string,
  ) {
    if (!canEdit || busy) return;
    setBusy(`${action}-${slot}`);
    try {
      const res = await setGear({ data: { code, action, slot, itemId } });
      if (!res.ok) toast.error(String(res.error));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "换装失败");
    } finally {
      setBusy(null);
    }
  }
  return { busy, act };
}

function GearSlots({
  sheet,
  canEdit,
  code,
}: {
  sheet: CharacterSheet;
  canEdit: boolean;
  code: string;
}) {
  const { busy, act } = useGearAct(code, canEdit);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const equipped = sheet.equipped ?? {};
  return (
    <ul className="grid gap-1.5">
      {GEAR_SLOTS.map((s) => {
        const it = itemById(equipped[s.id]);
        const open = openSlot === s.id;
        return (
          <li key={s.id} className="rounded-[10px] border border-border bg-bg/40">
            <button
              type="button"
              onClick={() => setOpenSlot(open ? null : s.id)}
              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
            >
              <span className="text-[11px] text-subtle">{s.label}</span>
              <span className="text-xs">
                {it ? it.name : <span className="text-subtle">空</span>}
              </span>
            </button>
            {open && (
              <div className="border-t border-border px-2.5 py-2">
                {it ? (
                  <>
                    <p className="text-xs leading-relaxed text-muted">
                      {it.damage ? `${it.damage}。` : ""}
                      {it.text}
                    </p>
                    {canEdit && (
                      <button
                        type="button"
                        className="mt-2 text-[11px] text-brass"
                        disabled={Boolean(busy)}
                        onClick={() => void act("stow", s.id)}
                      >
                        卸到背包
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-subtle">这一格是空的。从背包里选一件穿上。</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Backpack({
  sheet,
  canEdit,
  code,
}: {
  sheet: CharacterSheet;
  canEdit: boolean;
  code: string;
}) {
  const { busy, act } = useGearAct(code, canEdit);
  const [openId, setOpenId] = useState<string | null>(null);
  const pack = sheet.backpack ?? [];
  if (!pack.length) {
    return <p className="text-xs text-subtle">背包是空的。</p>;
  }
  return (
    <ul className="grid gap-1.5">
      {pack.map((p) => {
        const it = itemById(p.itemId);
        const name = it?.name ?? p.itemId;
        const open = openId === p.itemId;
        const slots = it ? allowedSlots(it) : [];
        return (
          <li key={p.itemId} className="rounded-[10px] border border-border bg-bg/40">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : p.itemId)}
              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
            >
              <span className="text-xs">{name}</span>
              <span className="text-[11px] text-subtle">×{p.qty}</span>
            </button>
            {open && (
              <div className="border-t border-border px-2.5 py-2">
                <p className="text-xs leading-relaxed text-muted">
                  {it?.damage ? `${it.damage}。` : ""}
                  {it?.text ?? "没有更细的说明。"}
                </p>
                {canEdit && slots.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {slots.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        className="rounded-full border border-border px-2 py-0.5 text-[11px] text-brass disabled:opacity-50"
                        disabled={Boolean(busy)}
                        onClick={() => void act("wear", slot, p.itemId)}
                      >
                        戴到{slotLabel(slot)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NpcBoard({
  npcs,
}: {
  npcs: { id: string; name: string; intro: string }[];
}) {
  if (!npcs.length) {
    return (
      <p className="text-sm text-muted">
        还没人走到灯下来。见过面的人会出现在这里。
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {npcs.map((n) => (
        <li
          key={n.id}
          className="rounded-[16px] border border-border bg-bg/40 p-3"
        >
          <p className="font-medium">{n.name}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{n.intro}</p>
        </li>
      ))}
    </ul>
  );
}

function StockChip({ item }: { item: StockItem }) {
  const empty = item.remain <= 0;
  return (
    <div className="rounded-[8px] border border-border bg-bg/40 px-2 py-2">
      <p className="text-[10px] leading-none text-subtle">{item.label}</p>
      <p className="mt-1 font-display text-xl leading-none tabular-nums text-fg">
        {item.remain}
        {item.max != null && (
          <span className="ml-0.5 text-xs font-sans text-subtle">/{item.max}</span>
        )}
      </p>
      <p className="mt-1 text-[10px] leading-none text-subtle">
        {empty && item.max != null ? "用尽" : item.note ?? "\u00a0"}
      </p>
    </div>
  );
}

function Stat({
  k,
  v,
  remain,
  max,
}: {
  k: string;
  v?: string | number;
  remain?: number;
  max?: number;
}) {
  return (
    <div className="rounded-[12px] border border-border px-3 py-2">
      <p className="text-[10px] text-subtle">{k}</p>
      {remain != null && max != null ? (
        <p className="font-display tabular-nums">
          <span className="text-fg">{remain}</span>
          <span className="text-sm text-subtle">/{max}</span>
        </p>
      ) : (
        <p className="font-display tabular-nums text-fg">{v}</p>
      )}
    </div>
  );
}

function ClueBoard({ clues }: { clues: TableSnap["state"]["clues"] }) {
  if (!clues.length) {
    return (
      <div>
        <p className="text-[11px] text-subtle">全桌共享，任何人发现后都会同步到这里。</p>
        <p className="mt-2 text-sm text-muted">线索板还是空的。去看、去问、去翻。</p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-3 text-[11px] text-subtle">
        全桌共享 · 表层线索可继续检定，成功后会在原卡片上更新。
      </p>
      <ul className="grid gap-3">
        {clues.map((c) => (
          <li
            key={c.id}
            className="rounded-[16px] border border-border bg-bg/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{c.name}</p>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-subtle">
                {c.layer === "full" ? "已确认" : "表层"}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted">{c.text}</p>
            {c.layer === "talk" && c.hint ? (
              <p className="mt-1 text-[11px] text-brass">{c.hint}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogView({
  logs,
  party,
}: {
  logs: TableSnap["logs"];
  party: TableSnap["characters"];
}) {
  const hp = useMemo(
    () =>
      party
        .map((p) => `${p.sheet.name} ${p.sheet.hp.current}/${p.sheet.hp.max}`)
        .join(" · "),
    [party],
  );
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-xs text-subtle">生命 {hp}</p>
      <ol className="space-y-2">
        {logs.map((l) => (
          <li key={l.id} className="border-l-2 border-brass/40 pl-3 text-muted">
            {l.entry}
          </li>
        ))}
      </ol>
      {logs.length === 0 && (
        <p className="text-muted">日志将在行动之后生长。</p>
      )}
    </div>
  );
}

async function playTts(roomId: string, messageId: string) {
  try {
    const out = await speakNarration({ data: { roomId, messageId } });
    if (!out.ok) return;
    const bytes = Uint8Array.from(atob(out.b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: out.mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    /* autoplay blocked until a gesture */
  }
}

async function blobToB64(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
