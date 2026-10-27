import { redact } from "./redact";
import { xaiFetch } from "./xai";

export type DefinedUsage = { gloss: string; usage: string };

const SYSTEM = `You write a short English note for one Chinese word as it is used in one sentence.
Return ONLY a JSON object: {"gloss":"a few words","usage":"one sentence"}
The gloss must be the sense in that sentence, matching the given pinyin and its tone marks.
Do not define a different word or a different sense.`;

/** Ask the server-side model for the sense of one word in one sentence. */
export async function defineUsage(input: {
  hanzi: string;
  pinyin: string;
  sentence: string;
}): Promise<DefinedUsage> {
  const response = await xaiFetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-4.6",
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Word: ${input.hanzi}
Pinyin in this sentence: ${input.pinyin}
Sentence: ${input.sentence}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Definition failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const parsed = parseDefinition(content);
  if (!parsed.gloss) throw new Error("Definition was empty.");
  return parsed;
}

function parseDefinition(content: string): DefinedUsage {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Definition was not JSON.");
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("Definition was not JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("Definition was not JSON.");
  const record = value as Record<string, unknown>;
  const gloss = typeof record.gloss === "string" ? record.gloss.trim().slice(0, 400) : "";
  const usage = typeof record.usage === "string" ? record.usage.trim().slice(0, 1000) : "";
  if (redact(gloss) !== gloss || redact(usage) !== usage) {
    throw new Error("Definition was rejected.");
  }
  return { gloss, usage };
}
