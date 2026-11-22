import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isStoryId } from "./story-validate";
import type { SavedTake } from "./takes";

function dataDir(): string {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

/**
 * One character practice take. A new attempt replaces the previous file.
 * These recordings are the learner's practice. They are not training data.
 */
export function practiceIndex(value: string): number | null {
  if (!/^\d{1,4}$/.test(value)) return null;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > 399) return null;
  return index;
}

function practiceFile(storyId: string, sentenceId: string, index: number): string {
  if (!isStoryId(storyId) || !isStoryId(sentenceId)) throw new Error("Invalid id.");
  if (!Number.isInteger(index) || index < 0 || index > 399) throw new Error("Invalid index.");
  const root = path.resolve(dataDir(), "takes", storyId, "practice", sentenceId);
  const file = path.resolve(root, `${index}.json`);
  if (file !== path.join(root, `${index}.json`)) throw new Error("Invalid index.");
  return file;
}

export async function readPracticeTake(
  storyId: string,
  sentenceId: string,
  index: number,
): Promise<SavedTake | undefined> {
  try {
    const raw = await fs.readFile(practiceFile(storyId, sentenceId, index), "utf8");
    const parsed = JSON.parse(raw) as SavedTake;
    if (!parsed?.audioBase64 || !Array.isArray(parsed.words)) return undefined;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function writePracticeTake(
  storyId: string,
  sentenceId: string,
  index: number,
  audio: Buffer,
  stt: { text: string; duration: number; words: SavedTake["words"]; sampleRate: number },
): Promise<SavedTake> {
  const saved: SavedTake = {
    savedAt: new Date().toISOString(),
    text: stt.text,
    duration: stt.duration,
    words: stt.words,
    sampleRate: stt.sampleRate,
    audioBase64: audio.toString("base64"),
  };
  const file = practiceFile(storyId, sentenceId, index);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(saved));
  await fs.rename(tmp, file);
  return saved;
}
