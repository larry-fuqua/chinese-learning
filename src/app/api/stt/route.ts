import { NextResponse } from "next/server";
import { xaiFetch } from "@/lib/xai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
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
      const detail = await response.text();
      return NextResponse.json(
        { error: `STT failed (${response.status})`, detail },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as {
      text: string;
      duration?: number;
      words?: { text: string; start: number; end: number }[];
    };

    return NextResponse.json({
      text: payload.text ?? "",
      duration: payload.duration ?? 0,
      words: payload.words ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "STT error";
    const status = message.includes("XAI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
