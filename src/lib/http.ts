import { NextResponse } from "next/server";
import { clip, redact } from "./redact";

export const MAX_STORY_BYTES = 1_048_576;

export async function readLimitedText(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    return {
      ok: false,
      status: 400,
      error: `Request body exceeds ${maxBytes} bytes.`,
    };
  }
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          status: 400,
          error: `Request body exceeds ${maxBytes} bytes.`,
        };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "Could not read request body." };
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

export async function readJsonLimited(
  request: Request,
  maxBytes: number,
): Promise<
  { ok: true; value: unknown } | { ok: false; status: number; error: string }
> {
  const read = await readLimitedText(request, maxBytes);
  if (!read.ok) return read;
  if (!read.text.trim()) {
    return { ok: false, status: 400, error: "Request body is required." };
  }
  try {
    return { ok: true, value: JSON.parse(read.text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Request body must be JSON." };
  }
}

export function errorJson(status: number, error: string, detail?: string): NextResponse {
  const body: { error: string; detail?: string } = { error: redact(error) };
  if (detail) body.detail = clip(redact(detail));
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function storeFailure(err: unknown): NextResponse {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return errorJson(
      500,
      "Data directory is not writable. The process runs as uid 1001 and DATA_DIR must be writable by that user.",
    );
  }
  console.error("story store error", code ?? (err instanceof Error ? err.name : "unknown"));
  return errorJson(500, "Could not store the story.");
}
