import { readTtsCache, writeTtsCache } from "@/lib/audio-cache";
import { unauthorized } from "@/lib/guard";
import { errorJson, MAX_STORY_BYTES, readJsonLimited } from "@/lib/http";
import { clip, redact } from "@/lib/redact";
import { xaiFetch } from "@/lib/xai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TtsBody = {
  text?: string;
  speed?: number;
};

export async function POST(request: Request) {
  const denied = unauthorized(request);
  if (denied) return denied;
  try {
    const bodyResult = await readJsonLimited(request, MAX_STORY_BYTES);
    if (!bodyResult.ok) return errorJson(bodyResult.status, bodyResult.error);
    const body =
      bodyResult.value && typeof bodyResult.value === "object"
        ? (bodyResult.value as TtsBody)
        : {};
    const text = body.text?.trim();
    if (!text) return errorJson(400, "text is required");
    const speed = clamp(body.speed ?? 0.85, 0.7, 1.5);

    const cached = await readTtsCache(text, speed);
    if (cached) {
      return NextResponse.json(cached, { headers: { "Cache-Control": "private, no-store" } });
    }

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
      const detail = clip(redact(await response.text()));
      return errorJson(response.status, `TTS failed (${response.status})`, detail);
    }

    const payload = (await response.json()) as {
      audio: string;
      duration: number;
      audio_timestamps?: {
        graph_chars: string[];
        graph_times: [number, number][];
      };
    };

    const result = {
      audioBase64: payload.audio,
      duration: payload.duration,
      graphChars: payload.audio_timestamps?.graph_chars ?? [...text],
      charTimes: payload.audio_timestamps?.graph_times ?? [],
      speed,
    };
    if (result.audioBase64) {
      await writeTtsCache(text, speed, result).catch((err) => {
        const code = (err as NodeJS.ErrnoException).code;
        console.error("tts cache write failed", code ?? "unknown");
      });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS error";
    const status = message.includes("XAI_API_KEY") ? 503 : 500;
    const error = message.includes("XAI_API_KEY")
      ? "XAI_API_KEY is not set. Add it to the server environment."
      : redact(message);
    return errorJson(status, error);
  }
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
