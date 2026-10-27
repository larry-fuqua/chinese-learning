import { unauthorized } from "@/lib/guard";
import { errorJson, readJsonLimited } from "@/lib/http";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALIGN_BYTES = 8_000_000;
const ALIGN_TIMEOUT_MS = 25_000;

type AlignBody = {
  text?: string;
  syllables?: string[];
  audioBase64?: string;
};

/**
 * Proxy a sentence to the forced-alignment sidecar.
 * A missing sidecar returns an empty span list so the caller keeps token
 * timings. The response stays successful: this fallback is expected, and a
 * failed status would show up as a browser console error.
 */
function noSpans() {
  return NextResponse.json({ spans: [] }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  try {
    const bodyResult = await readJsonLimited(request, ALIGN_BYTES);
    if (!bodyResult.ok) return errorJson(bodyResult.status, bodyResult.error);
    const body =
      bodyResult.value && typeof bodyResult.value === "object"
        ? (bodyResult.value as AlignBody)
        : {};
    const text = body.text?.trim() ?? "";
    const syllables = Array.isArray(body.syllables)
      ? body.syllables.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    if (!text || !syllables.length || !audioBase64) {
      return errorJson(400, "text, syllables, and audioBase64 are required");
    }
    const base = process.env.ALIGN_URL?.replace(/\/$/, "");
    if (!base) {
      console.error("align sidecar skipped: ALIGN_URL is not set");
      return noSpans();
    }
    const chars = [...text].filter((ch) => ch >= "\u3400" && ch <= "\u9fff");
    const response = await fetch(`${base}/align`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chars, syllables, audioBase64 }),
      signal: AbortSignal.timeout(ALIGN_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("align sidecar failed", response.status);
      return noSpans();
    }
    const payload = (await response.json()) as {
      spans?: { char?: string; start?: number; end?: number }[];
    };
    const spans = Array.isArray(payload.spans)
      ? payload.spans
          .filter(
            (span) =>
              span &&
              typeof span.char === "string" &&
              typeof span.start === "number" &&
              typeof span.end === "number" &&
              Number.isFinite(span.start) &&
              Number.isFinite(span.end),
          )
          .map((span) => ({ char: span.char as string, start: span.start as number, end: span.end as number }))
      : [];
    if (!spans.length) {
      console.error("align sidecar failed: no spans");
      return noSpans();
    }
    return NextResponse.json({ spans }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("align sidecar failed", err instanceof Error ? err.message : "unknown");
    return noSpans();
  }
}
