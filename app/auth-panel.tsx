"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function safeNext(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/hall";
}

export function AuthPanel({
  mode,
  next,
}: {
  mode: "in" | "up";
  next?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const destination = safeNext(next);

  async function submit() {
    if (busy) return;
    if (!email.trim() || !email.includes("@")) {
      setHint("请先填写邮箱。");
      return;
    }
    if (password.length < 8) {
      setHint("密码至少 8 位。");
      return;
    }
    setBusy(true);
    setHint("");
    try {
      const response = await fetch(
        mode === "up" ? "/api/auth/register" : "/api/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "没能入座");
      window.location.assign(destination);
    } catch (error) {
      setHint(error instanceof Error ? error.message : "没能入座");
    } finally {
      setBusy(false);
    }
  }

  const nextQuery = encodeURIComponent(destination);
  return (
    <main className="min-h-dvh bg-bg px-5 py-10 pb-28 text-fg">
      <div className="mx-auto flex min-h-[80dvh] max-w-md flex-col justify-center">
        <Link href="/" className="mb-6 font-display text-3xl text-fg">烛帷</Link>
        <p className="mb-2 font-display text-2xl">
          {mode === "up" ? "注册一个座位" : "登录入座"}
        </p>
        <p className="mb-6 text-sm text-muted">用邮箱。登录只保存在这座烛帷 Worker。</p>
        <div className="rounded-[28px] border border-border bg-surface p-5 sm:p-6">
          <div className="mb-5 grid grid-cols-2 gap-2">
            <Link
              href={`/register?next=${nextQuery}`}
              className={cn(
                "grid h-12 place-items-center rounded-[12px] border text-base font-medium",
                mode === "up" ? "border-primary bg-primary text-primary-fg" : "border-border text-muted",
              )}
            >
              注册
            </Link>
            <Link
              href={`/login?next=${nextQuery}`}
              className={cn(
                "grid h-12 place-items-center rounded-[12px] border text-base font-medium",
                mode === "in" ? "border-primary bg-primary text-primary-fg" : "border-border text-muted",
              )}
            >
              登录
            </Link>
          </div>
          <div className="grid gap-3">
            {mode === "up" && (
              <Input
                placeholder="桌上怎么称呼"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                maxLength={32}
              />
            )}
            <Input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              maxLength={254}
            />
            <Input
              type="password"
              placeholder="密码（至少 8 位）"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              maxLength={128}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
            {hint && <p role="alert" className="text-sm text-danger">{hint}</p>}
            <Button type="button" disabled={busy} className="w-full" onClick={() => void submit()}>
              {busy ? "正在入座……" : mode === "up" ? "注册并进入酒馆" : "登录并进入酒馆"}
            </Button>
          </div>
          <div className="my-5 flex items-center gap-3 text-xs text-subtle">
            <span className="h-px flex-1 bg-border" />或<span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-2">
            <Button type="button" variant="ghost" disabled className="w-full">使用 Google（待配置）</Button>
            <Button type="button" variant="ghost" disabled className="w-full">使用 X（待配置）</Button>
          </div>
        </div>
      </div>
    </main>
  );
}
