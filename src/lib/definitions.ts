import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./story-store";
import { isStoryId } from "./story-validate";
import type { NoteSource } from "./types";

export type StoredDefinition = {
  hanzi: string;
  pinyin: string;
  gloss: string;
  usage: string;
  source: NoteSource;
  sentenceId: string;
  updatedAt: string;
};

/** One definition per word in one sentence of one story. */
export function definitionKey(storyId: string, sentenceId: string, hanzi: string): string {
  return `${storyId}|${sentenceId}|${hanzi}`;
}

function definitionFile(storyId: string, sentenceId: string, hanzi: string): string {
  if (!isStoryId(storyId) || !isStoryId(sentenceId)) throw new Error("Invalid id.");
  const word = hanzi.trim();
  if (!word || word.length > 80) throw new Error("Invalid word.");
  const hash = createHash("sha256").update(definitionKey(storyId, sentenceId, word)).digest("hex");
  const root = path.resolve(dataDir(), "definitions", storyId);
  const file = path.resolve(root, `${hash}.json`);
  if (file !== path.join(root, `${hash}.json`)) throw new Error("Invalid id.");
  return file;
}

export async function readDefinition(
  storyId: string,
  sentenceId: string,
  hanzi: string,
): Promise<StoredDefinition | undefined> {
  try {
    const raw = await fs.readFile(definitionFile(storyId, sentenceId, hanzi), "utf8");
    const parsed = JSON.parse(raw) as StoredDefinition;
    if (!parsed || typeof parsed.gloss !== "string" || typeof parsed.hanzi !== "string") return undefined;
    if (parsed.source !== "ai" && parsed.source !== "user" && parsed.source !== "sample") return undefined;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function writeDefinition(
  storyId: string,
  sentenceId: string,
  hanzi: string,
  note: { pinyin: string; gloss: string; usage: string; source: NoteSource },
): Promise<StoredDefinition> {
  const saved: StoredDefinition = {
    hanzi: hanzi.trim(),
    pinyin: note.pinyin,
    gloss: note.gloss,
    usage: note.usage,
    source: note.source,
    sentenceId,
    updatedAt: new Date().toISOString(),
  };
  const file = definitionFile(storyId, sentenceId, hanzi);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(saved));
  await fs.rename(tmp, file);
  return saved;
}
