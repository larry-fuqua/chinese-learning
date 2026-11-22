import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { practiceIndex, readPracticeTake, writePracticeTake } from "@/lib/practice-takes";
import { getStory } from "@/lib/story-store";
import { isStoryId } from "@/lib/story-validate";
import { parseTakeStt } from "@/lib/takes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TAKE_BYTES = 8_000_000;

type RouteContext = { params: Promise<{ id: string; sentenceId: string; index: string }> };

async function ids(
  context: RouteContext,
): Promise<{ storyId: string; sentenceId: string; index: number } | Response> {
  const { id, sentenceId, index } = await context.params;
  const syllable = practiceIndex(index);
  if (!isStoryId(id) || !isStoryId(sentenceId) || syllable == null) {
    return errorJson(400, "Invalid story, sentence, or character.");
  }
  return { storyId: id, sentenceId, index: syllable };
}

export async function GET(request: Request, context: RouteContext) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const parsed = await ids(context);
  if (parsed instanceof Response) return parsed;
  try {
    const take = await readPracticeTake(parsed.storyId, parsed.sentenceId, parsed.index);
    if (!take) return errorJson(404, "No practice take for this character.");
    return privateJson(take);
  } catch {
    return errorJson(500, "Could not read the practice take.");
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
    const saved = await writePracticeTake(parsed.storyId, parsed.sentenceId, parsed.index, audio, stt);
    return privateJson({ ok: true, savedAt: saved.savedAt });
  } catch {
    return errorJson(500, "Could not save the practice take.");
  }
}
