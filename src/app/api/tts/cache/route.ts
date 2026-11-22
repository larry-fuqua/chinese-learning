import { clearTtsCache } from "@/lib/audio-cache";
import { unauthorized } from "@/lib/guard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Drop cached TTS audio only. Stories and books stay where they are. */
export async function DELETE(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  const deleted = await clearTtsCache();
  return NextResponse.json(
    { deleted },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
