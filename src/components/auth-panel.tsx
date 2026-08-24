import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  GROK_PROVIDERS,
  authClient,
  authEnabled,
  signIn,
} from "@/lib/auth/client";
import { persistAuthToken, rememberPreviewSession, urlWithSeat, readNextPath, readStoredToken } from "@/lib/preview-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function explainAuthError(raw: string) {
  const t = raw.toLowerCase();
  if (t.includes("exist") || t.includes("already"))
    return "这个邮箱已经注册过。请改用登录。";
  if (t.includes("password") || t.includes("invalid") || t.includes("credential"))
    return "邮箱或密码不对。第一次来请先注册。";
  if (t.includes("origin")) return "请从酒馆页面打开后再登。";
  if (t.includes("pop-up") || t.includes("popup"))
    return "弹窗被挡住了。手机上请用邮箱。";
  return raw || "没能入座";
}

export function AuthPanel({
  mode,
  embed,
  next,
}: {
  mode: "in" | "up";
  embed?: boolean;
  next?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [tab, setTab] = useState<"in" | "up">(mode);
  const active = embed ? tab : mode;

  async function submit() {
    if (busy) return;
    const mail = email.trim();
    if (!mail || !mail.includes("@")) {
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
      let captured: string | null = null;
      const fetchOptions = {
        onSuccess: (ctx: {
          data?: { token?: string };
          response?: Response;
        }) => {
          captured =
            persistAuthToken({
              headers: ctx.response?.headers ?? null,
              token: ctx.data?.token,
            }) || captured;
        },
      };
      const finish = (token?: string | null) => {
        const saved = persistAuthToken({ token }) || captured || readStoredToken();
        if (!saved) {
          throw new Error("账号对了，但座位没能保住。请再试一次。");
        }
        window.location.assign(urlWithSeat(next || readNextPath(), saved));
      };
      if (active === "up") {
        const res = await authClient.signUp.email({
          email: mail,
          password,
          name: name.trim() || mail.split("@")[0],
          fetchOptions,
        });
        if (res.error) {
          const msg = res.error.message || "注册失败";
          if (/exist|already/i.test(msg)) {
            setHint("这个邮箱已经注册过。请点上面的登录。");
            toast.error("这个邮箱已经注册过。请点上面的登录。");
            setBusy(false);
            return;
          }
          throw new Error(msg);
        }
        finish(
          res.data && typeof res.data === "object" && "token" in res.data
            ? String((res.data as { token?: string }).token ?? "")
            : null,
        );
        return;
      }
      const res = await authClient.signIn.email({
        email: mail,
        password,
        fetchOptions,
      });
      if (res.error) throw new Error(res.error.message || "登录失败");
      finish(
        res.data && typeof res.data === "object" && "token" in res.data
          ? String((res.data as { token?: string }).token ?? "")
          : null,
      );
    } catch (err) {
      const msg = explainAuthError(
        err instanceof Error ? err.message : "无法登录",
      );
      setHint(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const shell = (
      <div className={embed ? "" : "mx-auto flex min-h-[80dvh] max-w-md flex-col justify-center"}>
        {!embed && (
          <>
            <Link to="/" className="mb-6 font-display text-3xl text-fg">
              烛帷
            </Link>
            <p className="mb-2 font-display text-2xl">
              {active === "up" ? "注册一个座位" : "登录入座"}
            </p>
            <p className="mb-6 text-sm text-muted">用邮箱。手机上请不要用 Google / X 弹窗。</p>
          </>
        )}
        {embed && (
          <p className="mb-4 text-sm text-muted">掉线了就在这儿重新入座，不用跑去别的页。</p>
        )}
        <div className="rounded-[28px] border border-border bg-surface p-5 sm:p-6">
          {authEnabled ? (
            <>
              <div className="mb-5 grid grid-cols-2 gap-2">
                {embed ? (
                  <>
                    <button
                      type="button"
                      className={cn(
                        "grid h-12 place-items-center rounded-[12px] border text-base font-medium",
                        active === "up"
                          ? "border-primary bg-primary text-primary-fg"
                          : "border-border text-muted",
                      )}
                      onClick={() => setTab("up")}
                    >
                      注册
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "grid h-12 place-items-center rounded-[12px] border text-base font-medium",
                        active === "in"
                          ? "border-primary bg-primary text-primary-fg"
                          : "border-border text-muted",
                      )}
                      onClick={() => setTab("in")}
                    >
                      登录
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      to="/register"
                      className={cn(
                        "grid h-12 place-items-center rounded-[12px] border text-base font-medium",
                        active === "up"
                          ? "border-primary bg-primary text-primary-fg"
                          : "border-border text-muted",
                      )}
                    >
                      注册
                    </Link>
                    <Link
                      to="/login"
                      className={cn(
                        "grid h-12 place-items-center rounded-[12px] border text-base font-medium",
                        active === "in"
                          ? "border-primary bg-primary text-primary-fg"
                          : "border-border text-muted",
                      )}
                    >
                      登录
                    </Link>
                  </>
                )}
              </div>
              <div className="grid gap-3">
                {active === "up" && (
                  <Input
                    placeholder="桌上怎么称呼"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                )}
                <Input
                  type="email"
                  placeholder="邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                <Input
                  type="password"
                  placeholder="密码（至少 8 位）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={active === "up" ? "new-password" : "current-password"}
                />
                {hint && <p className="text-sm text-danger">{hint}</p>}
                <Button
                  type="button"
                  disabled={busy}
                  className="w-full"
                  onClick={() => void submit()}
                >
                  {busy
                    ? "正在入座……"
                    : active === "up"
                      ? "注册并进入酒馆"
                      : "登录并进入酒馆"}
                </Button>
              </div>
              <div className="my-5 flex items-center gap-3 text-xs text-subtle">
                <span className="h-px flex-1 bg-border" />
                或
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-2">
                {GROK_PROVIDERS.map((p) => (
                  <Button
                    key={p.providerId}
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() =>
                      signIn(p.providerId, {
                        callbackURL: next || readNextPath(),
                      })
                        .then(() => rememberPreviewSession())
                        .catch((err: unknown) => {
                          const msg = explainAuthError(
                            err instanceof Error ? err.message : "弹窗失败",
                          );
                          setHint(msg);
                          toast.error(msg);
                        })
                    }
                  >
                    使用 {p.label === "X" ? "X" : "Google"}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">登录暂未开放。</p>
          )}
        </div>
      </div>
  );

  if (embed) return shell;
  return (
    <main className="min-h-dvh bg-bg px-5 py-10 pb-28">{shell}</main>
  );
}
