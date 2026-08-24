import { env } from "cloudflare:workers";
import type { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "startrace_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 310_000;
const MAX_AUTH_BODY_BYTES = 4 * 1024;
const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$310000$c3RhcnRyYWNlLWR1bW15IQ$gAf7-TJeDC9bgA-4rLiBJfGEc8XOkGFvZMjy1jzAgjI";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
};

export type AuthUser = { id: string; username: string };

let authSchemaReady = false;

function db(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB as D1Database;
}

export async function ensureAuthSchema() {
  if (authSchemaReady) return;
  const database = db();
  await database.batch([
    database.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)"),
    database.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    database.prepare("CREATE TABLE IF NOT EXISTS auth_login_attempts (username TEXT PRIMARY KEY COLLATE NOCASE, failures INTEGER NOT NULL, window_started TEXT NOT NULL)"),
    database.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at)"),
  ]);
  authSchemaReady = true;
}

export function validateUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw new Error("用户名须为 3–24 位字母、数字或下划线");
  }
  return username;
}

export function validatePassword(value: string) {
  if (value.length < 10 || value.length > 128) {
    throw new Error("密码须为 10–128 个字符");
  }
  return value;
}

export async function readCredentials(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_AUTH_BODY_BYTES) {
    throw new Error("登录请求体过大");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("请求不是有效 JSON");
  }
  if (!body || typeof body !== "object") throw new Error("缺少登录信息");
  const credentials = body as Record<string, unknown>;
  if (typeof credentials.username !== "string" || typeof credentials.password !== "string") {
    throw new Error("用户名与密码格式无效");
  }
  return { username: credentials.username, password: credentials.password };
}

export async function registerUser(usernameInput: string, passwordInput: string) {
  await ensureAuthSchema();
  const username = validateUsername(usernameInput);
  const password = validatePassword(passwordInput);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  try {
    await db()
      .prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, username, passwordHash, now)
      .run();
  } catch {
    throw new Error("该用户名已被使用");
  }
  return createSession({ id, username });
}

export async function loginUser(usernameInput: string, passwordInput: string) {
  await ensureAuthSchema();
  const username = validateUsername(usernameInput);
  validatePassword(passwordInput);
  await assertLoginAllowed(username);
  const row = await db()
    .prepare("SELECT id, username, password_hash, created_at FROM users WHERE username = ?")
    .bind(username)
    .first<UserRow>();
  const storedHash = row?.password_hash.startsWith("pbkdf2-sha256$")
    ? row.password_hash
    : DUMMY_PASSWORD_HASH;
  const valid = await verifyPassword(passwordInput, storedHash);
  if (!row || !valid) {
    await recordLoginFailure(username);
    throw new Error("用户名或密码错误");
  }
  await db().prepare("DELETE FROM auth_login_attempts WHERE username = ?").bind(username).run();
  return createSession({ id: row.id, username: row.username });
}

export async function authenticateRequest(request: NextRequest): Promise<AuthUser | null> {
  await ensureAuthSchema();
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const token = bearer || request.cookies.get(SESSION_COOKIE)?.value || "";
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const user = await db()
    .prepare("SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(tokenHash, now)
    .first<AuthUser>();
  return user ?? null;
}

export async function revokeRequestSession(request: NextRequest) {
  await ensureAuthSchema();
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const token = bearer || request.cookies.get(SESSION_COOKIE)?.value || "";
  if (token) {
    await db().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

async function createSession(user: AuthUser) {
  await ensureAuthSchema();
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(tokenBytes);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db()
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), user.id, now.toISOString(), expires.toISOString())
    .run();
  await db().prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now.toISOString()).run();
  return { user, token, expiresAt: expires.toISOString() };
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return ["pbkdf2-sha256", PBKDF2_ITERATIONS, base64Url(salt), base64Url(hash)].join("$");
}

async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterationsText, saltText, expectedText] = stored.split("$");
  if (algorithm !== "pbkdf2-sha256") return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  const actual = await derivePassword(password, fromBase64Url(saltText), iterations);
  const expected = fromBase64Url(expectedText);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBytes = Uint8Array.from(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function assertLoginAllowed(username: string) {
  if (!username) return;
  const row = await db()
    .prepare("SELECT failures, window_started FROM auth_login_attempts WHERE username = ?")
    .bind(username)
    .first<{ failures: number; window_started: string }>();
  if (!row) return;
  const age = Date.now() - new Date(row.window_started).getTime();
  if (age > 15 * 60 * 1000) {
    await db().prepare("DELETE FROM auth_login_attempts WHERE username = ?").bind(username).run();
    return;
  }
  if (row.failures >= 8) throw new Error("登录尝试过多，请 15 分钟后重试");
}

async function recordLoginFailure(username: string) {
  if (!username) return;
  const now = new Date().toISOString();
  const existing = await db()
    .prepare("SELECT failures, window_started FROM auth_login_attempts WHERE username = ?")
    .bind(username)
    .first<{ failures: number; window_started: string }>();
  const expired = !existing || Date.now() - new Date(existing.window_started).getTime() > 15 * 60 * 1000;
  await db()
    .prepare("INSERT INTO auth_login_attempts (username, failures, window_started) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, window_started = excluded.window_started")
    .bind(username, expired ? 1 : existing.failures + 1, expired ? now : existing.window_started)
    .run();
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
