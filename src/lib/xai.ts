export function requireApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    throw new Error("XAI_API_KEY is not set. Add it to .env.local.");
  }
  return key;
}

export async function xaiFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const key = requireApiKey();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  return fetch(`https://api.x.ai${path}`, { ...init, headers });
}
