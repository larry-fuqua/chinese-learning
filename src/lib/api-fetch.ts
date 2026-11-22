import { apiUrl } from "./base-path";

/** Fetch an app path, prefixed with BASE_PATH. Sends the session cookie. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(apiUrl(path), { ...init, credentials: "same-origin" });
  if (
    response.status === 401 &&
    typeof window !== "undefined" &&
    !window.location.pathname.endsWith("/login")
  ) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`${apiUrl("/login")}?next=${encodeURIComponent(next)}`);
  }
  return response;
}
