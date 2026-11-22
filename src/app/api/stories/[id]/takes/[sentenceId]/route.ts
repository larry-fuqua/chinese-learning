import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { getStory } from "@/lib/story-store";
import { isStoryId } from "@/lib/story-validate";
import { parseTakeStt, readTake, writeTake } from "@/lib/takes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TAKE_BYTES = 8_000_000;

type RouteContext = { params: Promise<{ id: string; sentenceId: string }> };

async function ids(context: RouteContext): Promise<{ storyId: string; sentenceId: string } | Response> {
  const { id, sentenceId } = await context.params;
  if (!isStoryId(id) || !isStoryId(sentenceId)) {
    return errorJson(400, "Invalid story or sentence id.");
  }
  return { storyId: id, sentenceId };
}

export async function GET(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const parsed = await ids(context);
  if (parsed instanceof Response) return parsed;
  try {
    const take = await readTake(parsed.storyId, parsed.sentenceId);
    if (!take) return errorJson(404, "No take for this sentence.");
    return privateJson(take);
  } catch {
    return errorJson(500, "Could not read the take.");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const parsed = await ids(context);
  if (parsed instanceof Response) return parsed;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_TAKE_BYTES)) {
    return errorJson(400, `Request body exceeds ${MAX_TAKE_BYTES} bytes.`);
  }
  try {
    const story = await getStory(parsed.storyId);
    if (!story) return errorJson(404, "Story not found.");
    if (!story.sentences.some((sentence) => sentence.id === parsed.sentenceId)) {
      return errorJson(404, "Sentence not found.");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size <= 0 || file.size > MAX_TAKE_BYTES) {
      return errorJson(400, "file is required");
    }
    let sttRaw: unknown;
    try {
      sttRaw = JSON.parse(String(form.get("stt") ?? ""));
    } catch {
      return errorJson(400, "stt must be JSON.");
    }
    const stt = parseTakeStt(sttRaw);
    if (!stt) return errorJson(400, "stt words are invalid.");
    const audio = Buffer.from(await file.arrayBuffer());
    const saved = await writeTake(parsed.storyId, parsed.sentenceId, audio, stt);
    return privateJson({ ok: true, savedAt: saved.savedAt });
  } catch {
    return errorJson(500, "Could not save the take.");
  }
}
