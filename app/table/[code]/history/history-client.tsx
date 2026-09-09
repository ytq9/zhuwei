"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CharacterWizard } from "@/components/character-wizard";
import type { DraftSheet } from "@/lib/dnd/types";
import type { CreateHistoricalRoomInput, StoryHistoricalStart } from "@/lib/room/story-history-api-types";
import { collectStoryViewerExport, createHistoricalRoom, listHistoricalStarts, storyHistoryFailureMessage } from "@/lib/table/story-history-client";

export function StoryHistoryClient({ code, userName, accountId }: { code: string; userName: string; accountId: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<StoryHistoricalStart | null>(null);
  const [nickname, setNickname] = useState(userName.slice(0, 16));
  const [characterDraft, setCharacterDraft] = useState<DraftSheet | undefined>();
  const [pending, setPending] = useState<CreateHistoricalRoomInput | null>(null);
  const [creationError, setCreationError] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportCount, setExportCount] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const pendingKey = `zhuwei:historical-room-pending:${accountId}:${code}`;

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.sessionStorage.getItem(pendingKey) ?? "null");
      if (saved && typeof saved === "object" && "code" in saved && saved.code === code
        && "submissionId" in saved && typeof saved.submissionId === "string"
        && "startToken" in saved && typeof saved.startToken === "string"
        && "draft" in saved && typeof saved.draft === "object") {
        setPending(saved as CreateHistoricalRoomInput);
        setCharacterDraft((saved as CreateHistoricalRoomInput).draft);
        setCreationError("上次开团的结果尚未确认，请继续完成原请求。");
      }
    } catch { /* An unavailable or invalid local cache does not establish a Room result. */ }
  }, [pendingKey, code]);

  const starts = useInfiniteQuery({
    queryKey: ["story-historical-starts", code, accountId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listHistoricalStarts({ code, cursor: pageParam });
      if (result.kind !== "listed") throw new Error(storyHistoryFailureMessage(result));
      return result;
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    refetchOnWindowFocus: false,
    retry: false,
  });
  function clearPending() {
    setPending(null);
    try { window.sessionStorage.removeItem(pendingKey); } catch { /* Best-effort local cleanup. */ }
  }
  const create = useMutation({
    mutationFn: createHistoricalRoom,
    onSuccess: result => {
      if (result.kind === "created") {
        clearPending();
        setCreationError("");
        setCreatedCode(result.code);
        router.push(`/table/${result.code}`);
      } else {
        setCreationError(storyHistoryFailureMessage(result));
        if (result.kind === "rejected") clearPending();
      }
    },
    onError: (error: Error) => setCreationError(error.message),
  });
  function startWithCharacter(draft: DraftSheet) {
    if (!selected || pending || create.isPending) return;
    if (!nickname.trim()) { setCreationError("请填写新团中的称呼。"); return; }
    const request = { code, startToken: selected.startToken, nickname: nickname.trim(), draft,
      submissionId: crypto.randomUUID() };
    setCharacterDraft(draft);
    setPending(request);
    setCreationError("");
    try { window.sessionStorage.setItem(pendingKey, JSON.stringify(request)); } catch { /* Keep the same request in component state. */ }
    create.mutate(request);
  }
  async function downloadHistory() {
    if (exporting) return;
    setExporting(true);
    setExportCount(0);
    setExportMessage("");
    setExportError("");
    try {
      const pages = await collectStoryViewerExport(code, setExportCount);
      const blob = new Blob([JSON.stringify({ format: "zhuwei.story-viewer-export-pages/v1", pages }, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${code}-跑团经历.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportMessage("经历已整理完成，下载文件中保留了每页的原始记录。");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "经历导出暂未完成，请稍后重试。");
    } finally { setExporting(false); }
  }

  return (
    <main className="min-h-dvh bg-bg px-4 py-6 text-fg md:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <Link href={`/table/${code}`} className="text-sm text-brass hover:text-fg">← 返回桌面</Link>
          <span className="text-sm text-muted">房间 {code}</span>
        </header>
        <h1 className="mt-8 font-display text-3xl">故事档案</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">保存这段经历，也可以从历史中的一个时刻，以新人物开启另一段故事。</p>

        <section className="mt-6 rounded-[24px] border border-border bg-surface p-6" aria-labelledby="history-export-title">
          <h2 id="history-export-title" className="font-display text-xl">保存我的经历</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">导出当前人物有权查看的经历、对话与掷骰记录。</p>
          <Button className="mt-4" disabled={exporting} onClick={() => void downloadHistory()}>
            {exporting ? `正在整理 · ${exportCount} 条记录` : "下载完整经历（JSON）"}
          </Button>
          {exportMessage && <p className="mt-3 text-sm text-muted" role="status">{exportMessage}</p>}
          {exportError && <p className="mt-3 text-sm text-danger" role="alert">{exportError}</p>}
        </section>

        <section className="mt-6 rounded-[24px] border border-border bg-surface p-6" aria-labelledby="history-branch-title">
          <h2 id="history-branch-title" className="font-display text-xl">从历史开启新团</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">选择时刻与地点，创建符合入场条件的新人物。新团拥有独立的后续发展；原团保留已有经历。</p>
          {creationError && <p className="mt-4 text-sm text-danger" role="alert">{creationError}</p>}
          {createdCode ? (
            <Link className="mt-4 inline-flex text-brass hover:text-fg" href={`/table/${createdCode}`}>进入新团 {createdCode}</Link>
          ) : pending ? (
            <div className="mt-5 rounded-2xl border border-border p-4">
              <p className="text-sm" role="status">{create.isPending ? "正在建立新团，请稍候……" : "原开团请求已保留，可以继续确认并完成。"}</p>
              <Button className="mt-4" disabled={create.isPending} onClick={() => create.mutate(pending)}>继续完成开团</Button>
            </div>
          ) : selected ? (
            <div className="mt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-display text-lg">{selected.label}</h3><p className="mt-1 text-sm text-muted">{selected.sceneName} · {selected.fictionTimeLabel}</p></div>
                <Button variant="ghost" onClick={() => setSelected(null)}>重新选择起点</Button>
              </div>
              <label className="mt-5 block text-sm">你在新团中的称呼
                <Input className="mt-2 max-w-xs" value={nickname} maxLength={16} onChange={event => setNickname(event.target.value)} />
              </label>
              <div className="mt-6"><CharacterWizard initial={characterDraft} onLock={startWithCharacter} busy={create.isPending} /></div>
            </div>
          ) : (
            <div className="mt-5">
              {starts.isPending && <p className="text-sm text-muted" role="status">正在读取可进入的历史起点……</p>}
              {starts.isError && <div role="alert"><p className="text-sm text-danger">{starts.error.message}</p><Button className="mt-3" size="sm" onClick={() => void starts.refetch()}>重新读取</Button></div>}
              {starts.data && starts.data.pages.every(page => page.starts.length === 0) && <p className="text-sm text-muted">目前没有可进入的历史起点。</p>}
              <div className="grid gap-3 md:grid-cols-2">
                {starts.data?.pages.flatMap(page => page.starts).map(start => (
                  <button key={start.startToken} type="button" onClick={() => { setSelected(start); setCreationError(""); }}
                    className="rounded-2xl border border-border p-4 text-left transition-colors hover:border-brass focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass">
                    <span className="block font-display text-lg">{start.label}</span>
                    <span className="mt-2 block text-sm text-muted">{start.sceneName} · {start.fictionTimeLabel}</span>
                  </button>
                ))}
              </div>
              {starts.hasNextPage && <Button className="mt-4" variant="ghost" disabled={starts.isFetchingNextPage} onClick={() => void starts.fetchNextPage()}>
                {starts.isFetchingNextPage ? "正在读取……" : "更多历史起点"}
              </Button>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
