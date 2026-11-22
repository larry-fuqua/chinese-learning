import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isStoryId } from "./story-validate";

function dataDir(): string {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

export type TakeWord = { text: string; start: number; end: number };

export type SavedTake = {
  savedAt: string;
  text: string;
  duration: number;
  words: TakeWord[];
  sampleRate: number;
  audioBase64: string;
};

const MAX_WORDS = 500;
const MAX_TEXT = 8_000;
const MAX_WORD = 200;

function takeFile(storyId: string, sentenceId: string): string {
  if (!isStoryId(storyId) || !isStoryId(sentenceId)) throw new Error("Invalid id.");
  const root = path.resolve(dataDir(), "takes", storyId);
  const file = path.resolve(root, `${sentenceId}.json`);
  if (file !== path.join(root, `${sentenceId}.json`)) throw new Error("Invalid id.");
  return file;
}

export function parseTakeStt(raw: unknown): { text: string; duration: number; words: TakeWord[]; sampleRate: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.slice(0, MAX_TEXT) : "";
  const duration = typeof record.duration === "number" && Number.isFinite(record.duration) ? record.duration : 0;
  const sampleRate =
    typeof record.sampleRate === "number" && Number.isFinite(record.sampleRate) && record.sampleRate > 0
      ? record.sampleRate
      : 0;
  if (!Array.isArray(record.words) || record.words.length > MAX_WORDS) return null;
  const words: TakeWord[] = [];
  for (const item of record.words) {
    if (!item || typeof item !== "object") return null;
    const word = item as Record<string, unknown>;
    if (typeof word.text !== "string" || word.text.length > MAX_WORD) return null;
    if (typeof word.start !== "number" || typeof word.end !== "number") return null;
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start) return null;
    words.push({ text: word.text, start: word.start, end: word.end });
  }
  return { text, duration, words, sampleRate };
}

export async function readTake(storyId: string, sentenceId: string): Promise<SavedTake | undefined> {
  try {
    const raw = await fs.readFile(takeFile(storyId, sentenceId), "utf8");
    const parsed = JSON.parse(raw) as SavedTake;
    if (!parsed?.audioBase64 || !Array.isArray(parsed.words)) return undefined;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** One file per sentence. A new take replaces the previous one. */
export async function writeTake(
  storyId: string,
  sentenceId: string,
  audio: Buffer,
  stt: { text: string; duration: number; words: TakeWord[]; sampleRate: number },
): Promise<SavedTake> {
  const saved: SavedTake = {
    savedAt: new Date().toISOString(),
    text: stt.text,
    duration: stt.duration,
    words: stt.words,
    sampleRate: stt.sampleRate,
    audioBase64: audio.toString("base64"),
  };
  const file = takeFile(storyId, sentenceId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(saved));
  await fs.rename(tmp, file);
  return saved;
}
