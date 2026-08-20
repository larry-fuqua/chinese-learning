import { NextResponse } from "next/server";
import { xaiFetch } from "@/lib/xai";

export const runtime = "nodejs";

type TtsBody = {
  text?: string;
  speed?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TtsBody;
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    const speed = clamp(body.speed ?? 0.85, 0.7, 1.5);

    const response = await xaiFetch("/v1/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: "zh",
        voice_id: "eve",
        speed,
        with_timestamps: true,
        output_format: { codec: "wav", sample_rate: 24000 },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: `TTS failed (${response.status})`, detail },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as {
      audio: string;
      duration: number;
      audio_timestamps?: {
        graph_chars: string[];
        graph_times: [number, number][];
      };
    };

    return NextResponse.json({
      audioBase64: payload.audio,
      duration: payload.duration,
      graphChars: payload.audio_timestamps?.graph_chars ?? [...text],
      charTimes: payload.audio_timestamps?.graph_times ?? [],
      speed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS error";
    const status = message.includes("XAI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
