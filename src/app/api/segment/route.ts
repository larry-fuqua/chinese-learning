import { NextResponse } from "next/server";
import type { Sentence } from "@/lib/types";
import { WORD_SEGMENT_RULES } from "@/lib/segmentation";
import {
  buildSentencesFromHanzi,
  glueOrphanPunct,
  newId,
  splitSentences,
} from "@/lib/text";
import { xaiFetch } from "@/lib/xai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { hanzi?: string };
    const hanzi = body.hanzi?.trim() ?? "";
    if (!hanzi) {
      return NextResponse.json({ error: "hanzi is required" }, { status: 400 });
    }

    const response = await xaiFetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: splitSentences(hanzi)
              .map((s, i) => `${i + 1}. ${s}`)
              .join("\n"),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: `Segment failed (${response.status})`, detail },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const sentences = parseSentences(content, hanzi);
    return NextResponse.json({ sentences });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Segment error";
    const status = message.includes("XAI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

const SYSTEM = `You convert each Simplified Chinese sentence into grouped words with pinyin.
Return ONLY JSON:
{ "sentences": [ { "hanzi": "full sentence", "pinyin": "tone-marked pinyin of the words", "words": [{ "hanzi": "词", "pinyin": "cí" }] } ] }
Keep sentence order. Do not add or drop sentences.

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
        ? s.words
            .filter((w) => w && w.hanzi)
            .map((w) => ({ hanzi: String(w.hanzi), pinyin: String(w.pinyin ?? "") }))
        : [],
    }));
  return glueOrphanPunct(sentences.length ? sentences : buildSentencesFromHanzi(fallbackHanzi));
}
