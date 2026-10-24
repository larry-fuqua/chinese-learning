import { deleteBook, getBook, parseBookBody, replaceBook } from "@/lib/book-store";
import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited, storeFailure } from "@/lib/http";
import { isStoryId } from "@/lib/story-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isStoryId(id)) return errorJson(400, "Invalid book id.");
  try {
    const book = await getBook(id);
    if (!book) return errorJson(404, "Book not found.");
    return privateJson(book);
  } catch (err) {
    return storeFailure(err);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isStoryId(id)) return errorJson(400, "Invalid book id.");
  const body = await readJsonLimited(request, MAX_STORY_BYTES);
  if (!body.ok) return errorJson(body.status, body.error);
  const parsed = parseBookBody(body.value, { id });
  if (!parsed.ok) return errorJson(400, parsed.error);
  try {
    const replaced = await replaceBook(id, parsed.value);
    if (!replaced) return errorJson(404, "Book not found.");
    return privateJson(replaced);
  } catch (err) {
    return storeFailure(err);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isStoryId(id)) return errorJson(400, "Invalid book id.");
  try {
    const removed = await deleteBook(id);
    if (!removed) return errorJson(404, "Book not found.");
    return privateJson({ ok: true, detached: removed.detached });
  } catch (err) {
    return storeFailure(err);
  }
}
