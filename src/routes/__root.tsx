import { useState, useEffect } from "react";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth/provider";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { restorePreviewSession, readStoredToken, keepSeatAlive } from "@/lib/preview-session";
import { authClient } from "@/lib/auth/client";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "烛帷";

export const Route = createRootRoute({
  errorComponent: RootError,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#120e0c" },
      {
        name: "description",
        content: "帷幕后，烛火未灭。多人在线，AI 主持的龙与地下城 5e 跑团。",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@500;600;700&display=swap",
      },
    ],
  }),
  component: RootDocument,
});

function RootError({ error }: { error: Error }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>烛帷</title>
      </head>
      <body style={{ background: "#120e0c", color: "#f0e6d6", fontFamily: "sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 360, textAlign: "center" }}>
            <p style={{ fontSize: 28, margin: 0 }}>灯灭了一下</p>
            <p style={{ marginTop: 12, opacity: 0.7, fontSize: 14 }}>
              酒馆没能点亮。请再打开一次。
            </p>
            <a href="/" style={{ display: "inline-block", marginTop: 20, color: "#c4a574" }}>
              回首页
            </a>
            {import.meta.env.DEV && (
              <p style={{ marginTop: 16, fontSize: 11, opacity: 0.4 }}>{error.message}</p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}

function RootDocument() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <html lang="zh-CN" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SessionWarmup />
            <Outlet />
            <Toaster
              theme="dark"
              position="top-center"
              toastOptions={{
                className:
                  "!bg-elevated !text-fg !border !border-border !font-sans",
              }}
            />
          </AuthProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}

/** Keep the session store subscribed on every page so /hall does not remount it pending. */
function SessionWarmup() {
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  if (!live) return null;
  return <SessionWarmupLive />;
}

function SessionWarmupLive() {
  keepSeatAlive();
  restorePreviewSession();
  useCurrentUserState();
  useEffect(() => {
    keepSeatAlive();
    restorePreviewSession();
    if (readStoredToken()) void authClient.getSession();
  }, []);
  return null;
}
