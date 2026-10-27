import { createBook, listBooks, parseBookBody } from "@/lib/book-store";
import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited, storeFailure } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  try {
    return privateJson(await listBooks());
  } catch (err) {
    return storeFailure(err);
  }
}

export async function POST(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const body = await readJsonLimited(request, MAX_STORY_BYTES);
  if (!body.ok) return errorJson(body.status, body.error);
  const parsed = parseBookBody(body.value);
  if (!parsed.ok) return errorJson(400, parsed.error);
  try {
    const created = await createBook(parsed.value);
    if (created === "exists") return errorJson(409, "A book with this id already exists.");
    return privateJson(created, 201);
  } catch (err) {
    return storeFailure(err);
  }
}
