import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useSeated } from "@/components/use-seated";
import { clearPreviewSession } from "@/lib/preview-session";

export function AccountChip() {
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  if (!live) {
    return (
      <Link to="/login" className="text-sm text-fg/80 hover:text-fg">
        登录
      </Link>
    );
  }
  return <AccountChipLive />;
}

function AccountChipLive() {
  const { user, seated } = useSeated();
  const [busy, setBusy] = useState(false);
  if (!seated) {
    return (
      <Link to="/login" className="text-sm text-fg/80 hover:text-fg">
        登录
      </Link>
    );
  }
  const label = user?.displayName ?? user?.primaryEmail ?? "已入座";
  return (
    <div className="flex items-center gap-2">
      <span className="max-w-28 truncate text-sm text-muted">{label}</span>
      {authEnabled && (
        <button
          type="button"
          disabled={busy}
          className="text-sm text-subtle hover:text-fg disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            clearPreviewSession();
            void signOut("/").catch(() => setBusy(false));
          }}
        >
          {busy ? "正在离席…" : "登出"}
        </button>
      )}
    </div>
  );
}
