import { apiFetch } from "./api-fetch";
import type { AlignSpan } from "./align-audio";
import { alignmentSyllables } from "./pinyin";

/** Ask the sidecar to align this wav. Null means the caller should use token times. */
export async function fetchAlignment(opts: {
  hanzi: string;
  words: { hanzi: string; pinyin: string }[];
  audioBase64: string;
}): Promise<AlignSpan[] | null> {
  try {
    const syllables = alignmentSyllables(opts.hanzi, opts.words);
    const response = await apiFetch("/api/align", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: opts.hanzi,
        syllables,
        audioBase64: opts.audioBase64,
      }),
    });
    if (!response.ok) {
      console.error("align unavailable; using token timings");
      return null;
    }
    const body = (await response.json()) as { spans?: AlignSpan[] };
    if (!Array.isArray(body.spans) || !body.spans.length) {
      console.error("align unavailable; using token timings");
      return null;
    }
    return body.spans.filter(
      (span) =>
        !!span &&
        typeof span.char === "string" &&
        Number.isFinite(span.start) &&
        Number.isFinite(span.end),
    );
  } catch (err) {
    console.error("align unavailable; using token timings", err instanceof Error ? err.message : "unknown");
    return null;
  }
}
