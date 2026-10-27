import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited, storeFailure } from "@/lib/http";
import { upsertBook } from "@/lib/book-store";
import { upsertStory } from "@/lib/story-store";
import { parseImportBody } from "@/lib/story-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const body = await readJsonLimited(request, MAX_STORY_BYTES);
  if (!body.ok) return errorJson(body.status, body.error);
  const parsed = parseImportBody(body.value);
  if (!parsed.ok) return errorJson(400, parsed.error);
  const received = Array.isArray(body.value)
    ? body.value.length
    : Array.isArray((body.value as { stories?: unknown }).stories)
      ? (body.value as { stories: unknown[] }).stories.length
      : 0;
  try {
    for (const book of parsed.books) {
      await upsertBook(book);
    }
    for (const story of parsed.stories) {
      await upsertStory(story);
    }
    return privateJson({ imported: parsed.stories.length, skipped: received - parsed.stories.length });
  } catch (err) {
    return storeFailure(err);
  }
}
