import { unauthorized } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited } from "@/lib/http";
import { prepareFromInput } from "@/lib/prepare";
import type { PrepareRequest } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const body = await readJsonLimited(request, MAX_STORY_BYTES);
  if (!body.ok) return errorJson(body.status, body.error);
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return errorJson(400, "Body must be a JSON object.");
  }
  const result = await prepareFromInput(body.value as PrepareRequest);
  if (!result.ok) return errorJson(result.status, result.error, result.detail);
  return NextResponse.json(result.prepared, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
