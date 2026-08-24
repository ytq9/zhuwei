import type { ErrorComponentProps } from "@tanstack/react-router";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center text-fg">
      <div className="max-w-sm">
        <p className="font-display text-2xl">帷幕卡住了</p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          多半是这一页的脚本没加载全。刷新一次就能回来。
        </p>
        <p className="mt-2 break-words text-xs text-subtle">
          {error.message || "未知错误"}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href="/"
            className="inline-flex h-11 items-center rounded-[12px] border border-border px-4 text-sm"
          >
            回首页
          </a>
          <button
            type="button"
            className="inline-flex h-11 items-center rounded-[12px] bg-primary px-4 text-sm text-primary-fg"
            onClick={() => window.location.reload()}
          >
            刷新
          </button>
        </div>
      </div>
    </main>
  );
}
