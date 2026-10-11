import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The radius tokens in globals.css, so a later radius class replaces an
// earlier one instead of both applying.
const twMerge = extendTailwindMerge({
  extend: { theme: { radius: ["control", "panel", "shell"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

export function abilityMod(score: number) {
  return Math.floor((score - 10) / 2);
}

export function signed(n: number) {
  return n >= 0 ? `+${n}` : String(n);
}
