"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The table's one disclosure: a full-width trigger that names the section
 * and says what is inside while closed, and a labelled region when open. */
export function Disclosure({
  title,
  hint,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  /** What is inside, shown while closed. */
  hint?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;
  return (
    <div className={cn("min-w-0 max-w-full overflow-hidden rounded-control border border-border", className)}>
      <button
        id={triggerId}
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-xs font-medium">{title}</span>
        <span className="min-w-0 truncate text-[11px] text-subtle">
          {open ? "收起" : hint || "展开"}
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="border-t border-border px-2.5 py-2 min-w-0"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
