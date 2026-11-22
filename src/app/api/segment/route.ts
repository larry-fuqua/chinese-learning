import { unauthorized } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited } from "@/lib/http";
import { WORD_SEGMENT_RULES } from "@/lib/segmentation";
import { clip, redact } from "@/lib/redact";
import {
  buildSentencesFromHanzi,
  glueOrphanPunct,
  newId,
  normalizeWord,
} from "@/lib/text";
import type { Sentence } from "@/lib/types";
import { xaiFetch } from "@/lib/xai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  try {
    const bodyResult = await readJsonLimited(request, MAX_STORY_BYTES);
    if (!bodyResult.ok) return errorJson(bodyResult.status, bodyResult.error);
    const body =
      bodyResult.value && typeof bodyResult.value === "object"
        ? (bodyResult.value as { hanzi?: string })
        : {};
    const hanzi = body.hanzi?.trim() ?? "";
    if (!hanzi) return errorJson(400, "hanzi is required");

    const response = await xaiFetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.6",
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: hanzi },
        ],
      }),
    });

    if (!response.ok) {
      const detail = clip(redact(await response.text()));
      return errorJson(response.status, `Segment failed (${response.status})`, detail);
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const sentences = parseSentences(content, hanzi);
    return NextResponse.json(
      { sentences },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Segment error";
    const status = message.includes("XAI_API_KEY") ? 503 : 500;
    const error = message.includes("XAI_API_KEY")
      ? "XAI_API_KEY is not set. Add it to the server environment."
      : redact(message);
    return errorJson(status, error);
  }
}

const SYSTEM = `You convert a Simplified Chinese story into grouped words with pinyin.
Read the full text. Return ONLY JSON:
{ "sentences": [ { "hanzi": "full sentence", "pinyin": "tone-marked pinyin of the words", "words": [{ "hanzi": "词", "pinyin": "cí" }] } ] }
Keep sentence order. Do not add or drop or rewrite sentences.

${WORD_SEGMENT_RULES}`;

function parseSentences(content: string, fallbackHanzi: string): Sentence[] {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) return buildSentencesFromHanzi(fallbackHanzi);
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    sentences?: Sentence[];
  };
  const sentences = (parsed.sentences ?? [])
    .filter((s) => s && typeof s.hanzi === "string" && s.hanzi.trim())
    .map((s) => ({
      id: newId(),
      hanzi: s.hanzi.trim(),
      pinyin: String(s.pinyin ?? ""),
      words: Array.isArray(s.words)
        ? s.words.map((w) => normalizeWord(w)).filter((w): w is NonNullable<typeof w> => w != null)
        : [],
    }));
  return glueOrphanPunct(sentences.length ? sentences : buildSentencesFromHanzi(fallbackHanzi));
}
