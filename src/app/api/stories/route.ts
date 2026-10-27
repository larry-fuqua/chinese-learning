import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited, storeFailure } from "@/lib/http";
import { prepareFromInput } from "@/lib/prepare";
import { insertStory } from "@/lib/story-commit";
import { listSummaries } from "@/lib/story-store";
import { parseCreateBody, type MinimalStoryInput } from "@/lib/story-validate";
import { newId, paragraphGroupsForSentences, splitParagraphBlocks } from "@/lib/text";
import type { PrepareResponse, Story } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  try {
    return privateJson(await listSummaries());
  } catch (err) {
    return storeFailure(err);
  }
}

export async function POST(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const body = await readJsonLimited(request, MAX_STORY_BYTES);
  if (!body.ok) return errorJson(body.status, body.error);
  const parsed = parseCreateBody(body.value);
  if (!parsed.ok) return errorJson(400, parsed.error);

  try {
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
