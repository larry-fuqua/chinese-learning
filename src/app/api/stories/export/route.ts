import { unauthorized, privateJson } from "@/lib/guard";
import { storeFailure } from "@/lib/http";
import { listBookRecords } from "@/lib/book-store";
import { listStories } from "@/lib/story-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  try {
    const [stories, books] = await Promise.all([listStories(), listBookRecords()]);
    return privateJson({ version: 1, stories, books });
  } catch (err) {
    return storeFailure(err);
  }
}
