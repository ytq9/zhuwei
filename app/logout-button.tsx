"use client";

import { useState } from "react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="text-sm text-subtle hover:text-fg disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } finally {
          window.location.assign("/");
        }
      }}
    >
      {busy ? "正在离席……" : "登出"}
    </button>
  );
}
