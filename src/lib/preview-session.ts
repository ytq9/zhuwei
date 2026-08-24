/**
 * Preview session: Better Auth cookies often do not stick. The auth client
 * (`getBearerToken`) only reads sessionStorage. We keep the same token in
 * localStorage + a JS cookie, copy it back continuously, and never throw away
 * `?seat=` until a seat is actually confirmed.
 */
export const PREVIEW_BEARER_KEY = "grok-auth.bearer-token";
const SEAT_COOKIE = "zhuyei_seat";

function writeCookie(token: string | null) {
  if (typeof document === "undefined") return;
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    if (token) {
      document.cookie = `${SEAT_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax${secure}`;
    } else {
      document.cookie = `${SEAT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    }
  } catch {
    /* ignore */
  }
}

function readCookie(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const parts = document.cookie.split(";");
    for (const part of parts) {
      const [k, ...rest] = part.trim().split("=");
      if (k === SEAT_COOKIE) return decodeURIComponent(rest.join("="));
    }
  } catch {
    /* ignore */
  }
  return null;
}

function write(token: string | null) {
  if (typeof window === "undefined") return;
  writeCookie(token);
  try {
    if (token) {
      window.sessionStorage.setItem(PREVIEW_BEARER_KEY, token);
      window.localStorage.setItem(PREVIEW_BEARER_KEY, token);
    } else {
      window.sessionStorage.removeItem(PREVIEW_BEARER_KEY);
      window.localStorage.removeItem(PREVIEW_BEARER_KEY);
    }
  } catch {
    /* storage blocked — cookie may still hold it */
  }
}

function tokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("seat");
    if (q) return q;
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return null;
    return new URLSearchParams(raw).get("seat");
  } catch {
    return null;
  }
}

function stripSeatFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("seat") && !url.hash.includes("seat=")) return;
    url.searchParams.delete("seat");
    url.hash = "";
    window.history.replaceState(null, "", url.pathname + url.search);
  } catch {
    /* ignore */
  }
}

export function restorePreviewSession() {
  if (typeof window === "undefined") return;
  const fromUrl = tokenFromUrl();
  if (fromUrl) write(fromUrl);
  const fromCookie = readCookie();
  if (fromCookie) write(fromCookie);
  try {
    const session = window.sessionStorage.getItem(PREVIEW_BEARER_KEY);
    const local = window.localStorage.getItem(PREVIEW_BEARER_KEY);
    if (!session && local) write(local);
    if (session && !local) write(session);
  } catch {
    /* ignore */
  }
}

export function keepSeatAlive() {
  if (typeof window === "undefined") return;
  restorePreviewSession();
  const w = window as Window & { __zhuyeiSeatKeep?: boolean };
  if (w.__zhuyeiSeatKeep) return;
  w.__zhuyeiSeatKeep = true;
  document.addEventListener("visibilitychange", () => restorePreviewSession());
  window.addEventListener("focus", () => restorePreviewSession());
  window.setInterval(() => restorePreviewSession(), 2500);
}

export function consumeSeatParam() {
  if (readStoredToken()) stripSeatFromUrl();
}

export function persistAuthToken(opts?: {
  headers?: Headers | null;
  token?: string | null;
}): string | null {
  const fromHeader =
    opts?.headers?.get("set-auth-token") ||
    opts?.headers?.get("Set-Auth-Token");
  const token = (fromHeader || opts?.token || "").trim();
  if (!token) return null;
  write(token);
  return token;
}

export function rememberPreviewSession() {
  restorePreviewSession();
}

export function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = tokenFromUrl();
  if (fromUrl) return fromUrl;
  try {
    return (
      window.sessionStorage.getItem(PREVIEW_BEARER_KEY) ||
      window.localStorage.getItem(PREVIEW_BEARER_KEY) ||
      readCookie()
    );
  } catch {
    return readCookie();
  }
}

export function urlWithSeat(path: string, token?: string | null) {
  const target = path || "/hall";
  if (!token) return target;
  const join = target.includes("?") ? "&" : "?";
  return `${target}${join}seat=${encodeURIComponent(token)}`;
}

export function hallUrlWithSeat(token?: string | null) {
  return urlWithSeat("/hall", token);
}

export function readNextPath() {
  if (typeof window === "undefined") return "/hall";
  try {
    const n = new URLSearchParams(window.location.search).get("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) return n;
  } catch {
    /* ignore */
  }
  return "/hall";
}

export function clearPreviewSession() {
  write(null);
  stripSeatFromUrl();
}

if (typeof window !== "undefined") restorePreviewSession();
