import { unauthorized, privateJson } from "@/lib/guard";
import { storeFailure } from "@/lib/http";
import { listStories } from "@/lib/story-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  try {
    const stories = await listStories();
    return privateJson({ version: 1, stories });
  } catch (err) {
    return storeFailure(err);
  }
}
