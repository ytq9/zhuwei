import { ensureDb, first, run } from "../../db";

const PASSWORD_ITERATIONS = 210_000;
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PRODUCTION_COOKIE = "__Host-zhuwei_session";
const DEVELOPMENT_COOKIE = "zhuwei_session";

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

type SessionUserRow = Pick<UserRow, "id" | "name" | "email"> & {
  expires_at: string;
};

export type AuthUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt).buffer,
      iterations,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError("请填写邮箱。", 400);
  const email = raw.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    throw new AuthError("邮箱格式不正确。", 400);
  }
  return email;
}

function validatePassword(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 8) {
    throw new AuthError("密码至少 8 位。", 400);
  }
  if (raw.length > 128) throw new AuthError("密码最多 128 位。", 400);
  return raw;
}

function normalizeName(raw: unknown, email: string): string {
  if (raw !== undefined && typeof raw !== "string") {
    throw new AuthError("称呼格式不正确。", 400);
  }
  const name = (raw?.trim() || email.split("@", 1)[0] || "冒险者").slice(0, 32);
  if (!name) throw new AuthError("请填写桌上称呼。", 400);
  return name;
}

function cookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = new Map(
    cookieHeader.split(";").map((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [part.trim(), ""];
      return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  return cookies.get(PRODUCTION_COOKIE) ?? cookies.get(DEVELOPMENT_COOKIE) ?? null;
}

function publicUser(row: Pick<UserRow, "id" | "name" | "email">): AuthUser {
  return {
    userId: row.id,
    displayName: row.name,
    email: row.email,
    fullName: row.name,
  };
}

async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await run(
    "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    tokenHash,
    userId,
    expiresAt,
  );
  return token;
}

export async function registerWithPassword(input: {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}): Promise<{ user: AuthUser; token: string }> {
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const name = normalizeName(input.name, email);
  await ensureDb();
  if (await first<{ id: string }>("SELECT id FROM auth_users WHERE email = ?", email)) {
    throw new AuthError("这个邮箱已经注册过。请改用登录。", 409);
  }

  const userId = crypto.randomUUID();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  try {
    await run(
      `INSERT INTO auth_users
        (id, name, email, password_hash, password_salt, password_iterations)
       VALUES (?, ?, ?, ?, ?, ?)`,
      userId,
      name,
      email,
      bytesToBase64Url(passwordHash),
      bytesToBase64Url(salt),
      PASSWORD_ITERATIONS,
    );
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new AuthError("这个邮箱已经注册过。请改用登录。", 409);
    }
    throw error;
  }
  const user = { id: userId, name, email };
  return { user: publicUser(user), token: await createSession(userId) };
}

export async function loginWithPassword(input: {
  email?: unknown;
  password?: unknown;
}): Promise<{ user: AuthUser; token: string }> {
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const row = await first<UserRow>(
    `SELECT id, name, email, password_hash, password_salt, password_iterations
     FROM auth_users WHERE email = ?`,
    email,
  );
  if (!row) throw new AuthError("邮箱或密码不对。", 401);

  const actual = await derivePassword(
    password,
    base64UrlToBytes(row.password_salt),
    row.password_iterations,
  );
  if (!equalBytes(actual, base64UrlToBytes(row.password_hash))) {
    throw new AuthError("邮箱或密码不对。", 401);
  }
  return { user: publicUser(row), token: await createSession(row.id) };
}

export async function userFromCookie(cookieHeader: string | null): Promise<AuthUser | null> {
  const token = cookieValue(cookieHeader);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await first<SessionUserRow>(
    `SELECT u.id, u.name, u.email, s.expires_at
     FROM auth_sessions s
     JOIN auth_users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    tokenHash,
  );
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await run("DELETE FROM auth_sessions WHERE token_hash = ?", tokenHash);
    return null;
  }
  return publicUser(row);
}

export async function revokeSession(cookieHeader: string | null): Promise<void> {
  const token = cookieValue(cookieHeader);
  if (!token) return;
  await run("DELETE FROM auth_sessions WHERE token_hash = ?", await sha256(token));
}

export function sessionCookie(requestUrl: string, token: string): string {
  const secure = new URL(requestUrl).protocol === "https:";
  const name = secure ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE;
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:";
  const name = secure ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE;
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new AuthError("请求来源不可信。", 403);
  }
}
