/** URL prefix baked at build time via BASE_PATH (for example `/chinese`). */

const SAFE_SEGMENT = /^\/(?:[A-Za-z0-9._~-]+)(?:\/[A-Za-z0-9._~-]+)*$/;

export function normalizeBasePath(raw: string | undefined | null): string {
  let value = (raw ?? "").trim();
  if (!value || value === "/") return "";
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/+$/, "");
  if (!SAFE_SEGMENT.test(value) || value.includes("..")) {
    throw new Error(`Invalid BASE_PATH (${JSON.stringify(raw)}). Use a path like /chinese.`);
  }
  return value;
}

export function basePath(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH || process.env.BASE_PATH || "";
  return normalizeBasePath(raw);
}

/** Prefix an app-absolute path (`/api/health`) with the base path. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${basePath()}${suffix}`;
}

/** Cookie Path. Root hosting uses `/` so the cookie is sent on every route. */
export function cookiePath(): string {
  return basePath() || "/";
}

/**
 * Where to send the browser after login. Accepts an app path (`/read/id`)
 * or a path that already includes the base (`/chinese/read/id`).
 */
export function safeNextPath(raw: string | null | undefined): string {
  const base = basePath();
  const home = base ? `${base}/` : "/";
  if (!raw) return home;
  const value = raw.trim();
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("://") ||
    value.includes("\0")
  ) {
    return home;
  }
  const pathOnly = value.split("?")[0] ?? value;
  if (pathOnly === "/login" || pathOnly.endsWith("/login")) return home;
  if (base) {
    if (value === base || value.startsWith(`${base}/`)) return value;
    if (pathOnly.startsWith("/api/")) return home;
    return `${base}${value}`;
  }
  if (pathOnly.startsWith("/api/")) return home;
  return value;
}
