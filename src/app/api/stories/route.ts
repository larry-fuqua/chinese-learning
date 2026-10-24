import { unauthorized, privateJson } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited, storeFailure } from "@/lib/http";
import { prepareFromInput } from "@/lib/prepare";
import { createStory, listSummaries } from "@/lib/story-store";
import { parseCreateBody } from "@/lib/story-validate";
import { newId } from "@/lib/text";
import type { Story } from "@/lib/types";

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
      const now = new Date().toISOString();
      const story: Story = {
        id: parsed.value.id ?? newId(),
        title: parsed.value.title,
        level: parsed.value.level,
        hanzi: prepared.prepared.hanzi || parsed.value.hanzi,
        sentences: prepared.prepared.sentences,
        notes: prepared.prepared.notes ?? {},
        createdAt: now,
        updatedAt: now,
      };
      const created = await createStory(story);
      if (created === "exists") return errorJson(409, "A story with this id already exists.");
      return privateJson(created, 201);
    }

    const created = await createStory(parsed.value.story);
    if (created === "exists") return errorJson(409, "A story with this id already exists.");
    return privateJson(created, 201);
  } catch (err) {
    return storeFailure(err);
  }
}
