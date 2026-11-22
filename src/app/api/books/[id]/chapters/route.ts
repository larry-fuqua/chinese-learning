import { getBook, nextChapterNumber } from "@/lib/book-store";
import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited, storeFailure } from "@/lib/http";
import { prepareFromInput } from "@/lib/prepare";
import { insertStory } from "@/lib/story-commit";
import { isStoryId, parseCreateBody, type MinimalStoryInput } from "@/lib/story-validate";
import { newId, paragraphGroupsForSentences, splitParagraphBlocks } from "@/lib/text";
import type { PrepareResponse, Story } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isStoryId(id)) return errorJson(400, "Invalid book id.");
  const body = await readJsonLimited(request, MAX_STORY_BYTES);
  if (!body.ok) return errorJson(body.status, body.error);
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return errorJson(400, "Body must be a JSON object.");
  }
  const record = { ...(body.value as Record<string, unknown>) };
  if (typeof record.bookId === "string" && record.bookId !== id) {
    return errorJson(400, "bookId does not match the URL.");
  }
  try {
    const book = await getBook(id);
    if (!book) return errorJson(404, "Book not found.");
    record.bookId = id;
    if (record.chapterNumber === undefined || record.chapterNumber === null || record.chapterNumber === "") {
      const next = await nextChapterNumber(id);
      record.chapterNumber = next ?? 1;
    }
    if (
      (record.chapterTitle === undefined || record.chapterTitle === null || record.chapterTitle === "") &&
      typeof record.title === "string" &&
      record.title.trim()
    ) {
      record.chapterTitle = record.title.trim();
    }
    const parsed = parseCreateBody(record);
    if (!parsed.ok) return errorJson(400, parsed.error);
    if (parsed.value.mode === "minimal") {
      const prepared = await prepareFromInput({
        title: parsed.value.title,
        level: parsed.value.level,
        hanzi: parsed.value.hanzi,
      });
      if (!prepared.ok) return errorJson(prepared.status, prepared.error, prepared.detail);
      if (!prepared.prepared.sentences.length) {
        return errorJson(502, "Prepare did not return any sentences.");
      }
      const created = await insertStory(storyFromPrepared(parsed.value, prepared.prepared));
      if (!created.ok) return errorJson(created.status, created.error);
      return privateJson(created.story, 201);
    }
    const created = await insertStory(parsed.value.story);
    if (!created.ok) return errorJson(created.status, created.error);
    return privateJson(created.story, 201);
  } catch (err) {
    return storeFailure(err);
  }
}

function storyFromPrepared(input: MinimalStoryInput, prepared: PrepareResponse): Story {
  const now = new Date().toISOString();
  const paragraphs =
    prepared.paragraphs ?? paragraphGroupsForSentences(input.hanzi, prepared.sentences);
  const hanzi =
    splitParagraphBlocks(input.hanzi).length > 1 ? input.hanzi : prepared.hanzi || input.hanzi;
  const story: Story = {
    id: input.id ?? newId(),
    title: input.title,
    level: input.level,
    hanzi,
    sentences: prepared.sentences,
    notes: prepared.notes ?? {},
    createdAt: now,
    updatedAt: now,
  };
  if (paragraphs && paragraphs.length > 1) story.paragraphs = paragraphs;
  if (input.bookId && input.chapterNumber != null) {
    story.bookId = input.bookId;
    story.chapterNumber = input.chapterNumber;
    if (input.chapterTitle) story.chapterTitle = input.chapterTitle;
  }
  return story;
}
