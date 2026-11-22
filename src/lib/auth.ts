import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookiePath } from "./base-path";

export const SESSION_COOKIE = "reader_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90;

type Bucket = { fails: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function windowMs(): number {
  const n = Number(process.env.READER_LOGIN_WINDOW_MS ?? 15 * 60 * 1000);
  return Number.isFinite(n) && n >= 1000 ? n : 15 * 60 * 1000;
}

function maxAttempts(): number {
  const n = Number(process.env.READER_LOGIN_MAX_ATTEMPTS ?? 8);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8;
}

function globalMax(): number {
  const n = Number(process.env.READER_LOGIN_GLOBAL_MAX ?? 40);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 40;
}

function bucket(key: string, now: number): Bucket {
  const found = buckets.get(key);
  if (!found || now >= found.resetAt) {
    const fresh = { fails: 0, resetAt: now + windowMs() };
    buckets.set(key, fresh);
    return fresh;
  }
  return found;
}

export function resetLoginRateLimits(): void {
  buckets.clear();
}

export function checkLoginAllowed(
  ip: string,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfter: number } {
  const ipBucket = bucket(ip, now);
  const globalBucket = bucket("*", now);
  if (ipBucket.fails >= maxAttempts() || globalBucket.fails >= globalMax()) {
    const retryAt = Math.min(
      ipBucket.fails >= maxAttempts() ? ipBucket.resetAt : Number.POSITIVE_INFINITY,
      globalBucket.fails >= globalMax() ? globalBucket.resetAt : Number.POSITIVE_INFINITY,
    );
    return { ok: false, retryAfter: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
  }
  return { ok: true };
}

export function recordLoginFailure(ip: string, now = Date.now()): void {
  bucket(ip, now).fails += 1;
  bucket("*", now).fails += 1;
}

export function clearLoginFailures(ip: string): void {
  buckets.delete(ip);
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const raw = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "local";
  const cleaned = raw.replace(/[^\w.:-]/g, "").slice(0, 80);
  return cleaned || "local";
}

/** Compare strings without leaking length or prefix through the equality check. */
export function safeEqualString(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

export function sessionSecret(): string | null {
  const secret = process.env.READER_SESSION_SECRET ?? "";
  if (secret.length < 16) return null;
  return secret;
}

export function signSession(now = Date.now(), ttlMs = SESSION_MAX_AGE * 1000): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("Session signing is not configured.");
  const payload = Buffer.from(
    JSON.stringify({ v: 1, iat: now, exp: now + ttlMs }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | null | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const secret = sessionSecret();
  if (!secret) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqualString(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: number;
      exp?: number;
    };
    return data.v === 1 && typeof data.exp === "number" && data.exp > now;
  } catch {
    return false;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function bearerMatches(header: string | null): boolean {
  const expected = process.env.READER_API_KEY ?? "";
  if (!expected) return false;
  if (!header) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return false;
  return safeEqualString(match[1], expected);
}

export function authDecision(input: {
  authorization: string | null;
  session: string | null;
}): "allow" | "deny" {
  if (bearerMatches(input.authorization)) return "allow";
  if (verifySession(input.session)) return "allow";
  return "deny";
}

export function isRequestAuthed(request: Request): boolean {
  return (
    authDecision({
      authorization: request.headers.get("authorization"),
      session: readCookie(request, SESSION_COOKIE),
    }) === "allow"
  );
}

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    `Path=${cookiePath()}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    `Path=${cookiePath()}`,
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}
