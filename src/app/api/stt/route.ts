import { unauthorized } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { clip, redact } from "@/lib/redact";
import { xaiFetch } from "@/lib/xai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  try {
    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof Blob)) return errorJson(400, "file is required");
    const audio = file;
    const hints = String(incoming.get("hints") ?? "")
      .split(/[\s,，]+/u)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= 50)
      .slice(0, 24);

    async function transcribe(withLanguage: boolean) {
      const form = new FormData();
      if (withLanguage) form.append("language", "zh");
      for (const hint of hints) form.append("keyterm", hint);
      form.append("file", audio, "recite.wav");
      return xaiFetch("/v1/stt", { method: "POST", body: form });
    }

    let response = await transcribe(true);
    if (response.status === 400) response = await transcribe(false);

    if (!response.ok) {
      const detail = clip(redact(await response.text()));
      return errorJson(response.status, `STT failed (${response.status})`, detail);
    }

    const payload = (await response.json()) as {
      text: string;
      duration?: number;
      words?: { text: string; start: number; end: number }[];
    };

    return Response.json(
      {
        text: payload.text ?? "",
        duration: payload.duration ?? 0,
        words: payload.words ?? [],
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "STT error";
    const status = message.includes("XAI_API_KEY") ? 503 : 500;
    const error = message.includes("XAI_API_KEY")
      ? "XAI_API_KEY is not set. Add it to the server environment."
      : redact(message);
    return errorJson(status, error);
  }
}
