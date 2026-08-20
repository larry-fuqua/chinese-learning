import { NextResponse } from "next/server";
import type { Note, PrepareRequest, PrepareResponse, Sentence } from "@/lib/types";
import { buildSentencesFromHanzi, looksLikePinyin, newId } from "@/lib/text";
import { xaiFetch } from "@/lib/xai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PrepareRequest;
    const hanziIn = body.hanzi?.trim() ?? "";
    const pinyinIn = body.pinyin?.trim() ?? "";
    if (!hanziIn && !pinyinIn) {
      return NextResponse.json(
        { error: "Provide simplified Chinese, pinyin, or both." },
        { status: 400 },
      );
    }

    const sourceText =
      hanziIn && pinyinIn
        ? `Hanzi:\n${hanziIn}\n\nPinyin:\n${pinyinIn}`
        : hanziIn || pinyinIn;

    const inferredPinyinOnly = !hanziIn && (pinyinIn || looksLikePinyin(sourceText));

    const response = await xaiFetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: SYSTEM,
          },
          {
            role: "user",
            content: `Level hint: ${body.level ?? "HSK1"}
Suggested title: ${body.title ?? ""}
Input looks pinyin-only: ${inferredPinyinOnly}

${sourceText}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: `Prepare failed (${response.status})`, detail },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelJson(content);
    const prepared = normalizePrepare(parsed, body);
    return NextResponse.json(prepared);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prepare error";
    const status = message.includes("XAI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

const SYSTEM = `You prepare graded Chinese reading texts for a pronunciation learner.

Return ONLY a JSON object with this shape:
{
  "title": "short Chinese or bilingual title",
  "level": "HSK1" | "HSK2" | "HSK3" | "other",
  "hanzi": "full story in simplified Chinese, sentences separated by 。！？",
  "sentences": [
    {
      "hanzi": "sentence including punctuation",
      "pinyin": "tone-marked pinyin for the sentence",
      "words": [{ "hanzi": "词", "pinyin": "cí" }]
    }
  ],
  "notes": {
    "词": {
      "pinyin": "cí",
      "gloss": "short English gloss",
      "usage": "1-2 sentences on THIS story's usage, contrasts, measure words, or tone sandhi"
    }
  }
}

Rules:
- Always output simplified Chinese. Never traditional.
- Segment words the way a learner should click them (今天, 天气, not 天+气 when it is the word 天气). Keep punctuation as its own token with empty pinyin.
- Pinyin uses tone marks (nǐ hǎo), not numbers, except particle 了 as le.
- Notes only for KEY words: new vocab, measure words, easy-to-confuse pairs, names, particles that matter. Not every 的/是.
- If input is pinyin only, produce the most likely everyday simplified Chinese.
- If both hanzi and pinyin are given, prefer the hanzi; fix pinyin to match it.
- Keep the learner's meaning. Do not rewrite the story.`;

function parseModelJson(content: string): Partial<PrepareResponse> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Model did not return JSON.");
  return JSON.parse(raw.slice(start, end + 1)) as Partial<PrepareResponse>;
}

function normalizePrepare(
  parsed: Partial<PrepareResponse>,
  body: PrepareRequest,
): PrepareResponse {
  const hanzi = (parsed.hanzi || body.hanzi || "").trim();
  let sentences = Array.isArray(parsed.sentences) ? parsed.sentences : [];
  sentences = sentences
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
  if (!sentences.length && hanzi) {
    sentences = buildSentencesFromHanzi(hanzi);
  }
  const notes: Record<string, Note> = {};
  if (parsed.notes && typeof parsed.notes === "object") {
    for (const [key, note] of Object.entries(parsed.notes)) {
      if (!key || !note) continue;
      notes[key] = {
        pinyin: String(note.pinyin ?? ""),
        gloss: String(note.gloss ?? ""),
        usage: String(note.usage ?? ""),
        source: "ai",
      };
    }
  }
  return {
    title: (parsed.title || body.title || "Untitled").trim(),
    level: parsed.level || body.level || "HSK1",
    hanzi: hanzi || sentences.map((s: Sentence) => s.hanzi).join(""),
    sentences,
    notes,
  };
}
