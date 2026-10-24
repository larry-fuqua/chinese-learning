import type { Note, PrepareRequest, PrepareResponse, Sentence } from "./types";
import { WORD_SEGMENT_RULES } from "./segmentation";
import {
  buildSentencesFromHanzi,
  glueOrphanPunct,
  looksLikePinyin,
  newId,
  normalizeWord,
  paragraphGroupsForSentences,
  splitParagraphBlocks,
} from "./text";
import { xaiFetch } from "./xai";
import { clip, redact } from "./redact";

export type PrepareResult =
  | { ok: true; prepared: PrepareResponse }
  | { ok: false; status: number; error: string; detail?: string };

export async function prepareFromInput(body: PrepareRequest): Promise<PrepareResult> {
  try {
    const hanziIn = body.hanzi?.trim() ?? "";
    const pinyinIn = body.pinyin?.trim() ?? "";
    if (!hanziIn && !pinyinIn) {
      return { ok: false, status: 400, error: "Provide simplified Chinese, pinyin, or both." };
    }

    const sourceText =
      hanziIn && pinyinIn ? `Hanzi:\n${hanziIn}\n\nPinyin:\n${pinyinIn}` : hanziIn || pinyinIn;
    const inferredPinyinOnly = !hanziIn && (pinyinIn || looksLikePinyin(sourceText));

    const response = await xaiFetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.6",
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM },
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
      const detail = clip(redact(await response.text()));
      return {
        ok: false,
        status: response.status >= 400 && response.status < 600 ? response.status : 502,
        error: `Prepare failed (${response.status})`,
        detail,
      };
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelJson(content);
    return { ok: true, prepared: normalizePrepare(parsed, body) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prepare error";
    if (message.includes("XAI_API_KEY")) {
      return { ok: false, status: 503, error: "XAI_API_KEY is not set. Add it to the server environment." };
    }
    return { ok: false, status: 500, error: redact(message) };
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
  ]
}

Rules:
- Always output simplified Chinese. Never traditional.
- If input is pinyin only, produce the most likely everyday simplified Chinese.
- If both hanzi and pinyin are given, prefer the hanzi; fix pinyin to match it.
- Keep the learner's meaning. Do not rewrite the story.

${WORD_SEGMENT_RULES}`;

function parseModelJson(content: string): Partial<PrepareResponse> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Model did not return JSON.");
  return JSON.parse(raw.slice(start, end + 1)) as Partial<PrepareResponse>;
}

function normalizePrepare(parsed: Partial<PrepareResponse>, body: PrepareRequest): PrepareResponse {
  const hanzi = (parsed.hanzi || body.hanzi || "").trim();
  let sentences = Array.isArray(parsed.sentences) ? parsed.sentences : [];
  sentences = sentences
    .filter((s) => s && typeof s.hanzi === "string" && s.hanzi.trim())
    .map((s) => ({
      id: newId(),
      hanzi: s.hanzi.trim(),
      pinyin: String(s.pinyin ?? ""),
      words: Array.isArray(s.words)
        ? s.words.map((w) => normalizeWord(w)).filter((w): w is NonNullable<typeof w> => w != null)
        : [],
    }));
  sentences = glueOrphanPunct(sentences);
  if (!sentences.length && hanzi) sentences = buildSentencesFromHanzi(hanzi);
  const notes: Record<string, Note> = {};
  const source = (body.hanzi || "").trim();
  const paragraphSource = splitParagraphBlocks(source).length > 1 ? source : hanzi;
  const paragraphs = paragraphGroupsForSentences(paragraphSource, sentences);
  const prepared: PrepareResponse = {
    title: (parsed.title || body.title || "Untitled").trim(),
    level: parsed.level || body.level || "HSK1",
    hanzi: paragraphSource || sentences.map((s: Sentence) => s.hanzi).join(""),
    sentences,
    notes,
  };
  if (paragraphs) prepared.paragraphs = paragraphs;
  return prepared;
}
