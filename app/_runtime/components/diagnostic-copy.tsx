"use client";

import { useState } from "react";
import { diagnosticCopyText } from "../lib/platform/diagnostic-reference";

export function DiagnosticCopy({ message }: { message: string }) {
  const [feedback, setFeedback] = useState("");
  const text = diagnosticCopyText(message);
  if (!text) return null;
  return <div className="shrink-0 px-5 pb-3 text-xs text-subtle">
    <button type="button" className="underline underline-offset-4" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setFeedback("已复制，可发给维护者排查。");
      } catch {
        setFeedback("未能复制，请选中上方故障编号手动复制。");
      }
    }}>复制故障信息</button>
    <span className="ml-2" role="status">{feedback}</span>
  </div>;
}
