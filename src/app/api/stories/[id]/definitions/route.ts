import { defineUsage } from "@/lib/define-usage";
import { readDefinition, writeDefinition } from "@/lib/definitions";
import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson, readJsonLimited } from "@/lib/http";
import { getStory } from "@/lib/story-store";
import { isStoryId } from "@/lib/story-validate";
import { canDefineWord } from "@/lib/text";
import type { NoteSource } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 64_000;

type RouteContext = { params: Promise<{ id: string }> };

type DefinitionBody = {
  sentenceId?: string;
  hanzi?: string;
  pinyin?: string;
  gloss?: string;
  usage?: string;
  save?: boolean;
};

export async function POST(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isStoryId(id)) return errorJson(400, "Invalid story id.");
  try {
    const bodyResult = await readJsonLimited(request, MAX_BODY);
    if (!bodyResult.ok) return errorJson(bodyResult.status, bodyResult.error);
    const body =
      bodyResult.value && typeof bodyResult.value === "object"
        ? (bodyResult.value as DefinitionBody)
        : {};
    const sentenceId = body.sentenceId?.trim() ?? "";
    const hanzi = body.hanzi?.trim() ?? "";
    if (!isStoryId(sentenceId)) return errorJson(400, "Invalid sentence id.");
    if (!hanzi || hanzi.length > 80) return errorJson(400, "hanzi is required");
    if (!canDefineWord(hanzi)) return errorJson(400, "Definitions are for Chinese words.");

    const story = await getStory(id);
    if (!story) return errorJson(404, "Story not found.");
    const sentence = story.sentences.find((item) => item.id === sentenceId);
    if (!sentence) return errorJson(404, "Sentence not found.");
    const word = sentence.words.find((item) => item.hanzi === hanzi);
    if (!word && !sentence.hanzi.includes(hanzi)) return errorJson(400, "That word is not in this sentence.");

    const pinyin = clipText(body.pinyin?.trim() || word?.pinyin || "", 200);
    if (body.save) {
      const saved = await writeDefinition(id, sentenceId, hanzi, {
        pinyin,
        gloss: clipText(body.gloss ?? "", 2000),
        usage: clipText(body.usage ?? "", 2000),
        source: "user",
      });
      return privateJson(publicDefinition(saved));
    }

    const existing = await readDefinition(id, sentenceId, hanzi);
    if (existing) return privateJson(publicDefinition(existing));

    const storyNote = story.notes[hanzi];
    if (storyNote?.gloss?.trim()) {
      return privateJson({
        hanzi,
        pinyin: storyNote.pinyin || pinyin,
        gloss: storyNote.gloss,
        usage: storyNote.usage || "",
        source: storyNote.source,
        sentenceId,
      });
    }

    const defined = await defineUsage({
      hanzi,
      pinyin,
      sentence: sentence.hanzi,
    });
    const saved = await writeDefinition(id, sentenceId, hanzi, {
      pinyin,
      gloss: defined.gloss,
      usage: defined.usage,
      source: "ai",
    });
    return privateJson(publicDefinition(saved));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Definition error";
    const status = message.includes("XAI_API_KEY") ? 503 : 502;
    const error = message.includes("XAI_API_KEY")
      ? "XAI_API_KEY is not set. Add it to the server environment."
      : message;
    return errorJson(status, error);
  }
}

function publicDefinition(note: {
  hanzi: string;
  pinyin: string;
  gloss: string;
  usage: string;
  source: NoteSource;
  sentenceId: string;
}) {
  return {
    hanzi: note.hanzi,
    pinyin: note.pinyin,
    gloss: note.gloss,
    usage: note.usage,
    source: note.source,
    sentenceId: note.sentenceId,
  };
}

function clipText(value: string, max: number): string {
  return value.trim().slice(0, max);
}
