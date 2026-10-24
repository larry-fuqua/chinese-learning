import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited, storeFailure } from "@/lib/http";
import { deleteStory, getStory, replaceStory } from "@/lib/story-store";
import { isStoryId, parseReplaceBody } from "@/lib/story-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isStoryId(id)) return errorJson(400, "Invalid story id.");
  try {
    const story = await getStory(id);
    if (!story) return errorJson(404, "Story not found.");
    return privateJson(story);
  } catch (err) {
    return storeFailure(err);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isStoryId(id)) return errorJson(400, "Invalid story id.");
  const body = await readJsonLimited(request, MAX_STORY_BYTES);
  if (!body.ok) return errorJson(body.status, body.error);
  const parsed = parseReplaceBody(body.value, id);
  if (!parsed.ok) return errorJson(400, parsed.error);
  try {
    const replaced = await replaceStory(id, parsed.story);
    if (!replaced) return errorJson(404, "Story not found.");
    return privateJson(replaced);
  } catch (err) {
    return storeFailure(err);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isStoryId(id)) return errorJson(400, "Invalid story id.");
  try {
    const removed = await deleteStory(id);
    if (!removed) return errorJson(404, "Story not found.");
    return privateJson({ ok: true });
  } catch (err) {
    return storeFailure(err);
  }
}
