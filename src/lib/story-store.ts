import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SAMPLE_STORY } from "./sample";
import { isStoryId } from "./story-validate";
import type { Story } from "./types";

export type StorySummary = Pick<Story, "id" | "title" | "level" | "createdAt" | "updatedAt"> &
  Partial<Pick<Story, "bookId" | "chapterNumber" | "chapterTitle">>;

const MIGRATION_ID = "books-paragraphs-v1";
let backupTask: Promise<void> | null = null;

/** Copy story and book JSON once before this version writes. Audio is left alone. */
export function ensureDataBackup(): Promise<void> {
  if (!backupTask) {
    backupTask = runDataBackup().finally(() => {
      backupTask = null;
    });
  }
  return backupTask;
}

async function runDataBackup(): Promise<void> {
  const root = dataDir();
  const marker = path.join(root, ".migrations", MIGRATION_ID);
  try {
    await fs.access(marker);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(root, "backups", `${stamp}-${MIGRATION_ID}`);
  const copiedStories = await copyJsonDir(path.join(root, "stories"), path.join(dest, "stories"));
  const copiedBooks = await copyJsonDir(path.join(root, "books"), path.join(dest, "books"));
  if (!copiedStories && !copiedBooks) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
  }
  await fs.mkdir(path.dirname(marker), { recursive: true });
  try {
    await fs.writeFile(marker, "1", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

async function copyJsonDir(from: string, to: string): Promise<boolean> {
  let names: string[];
  try {
    names = (await fs.readdir(from)).filter((name) => name.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  if (!names.length) return false;
  await fs.mkdir(to, { recursive: true });
  for (const name of names) {
    await fs.copyFile(path.join(from, name), path.join(to, name));
  }
  return true;
}

export function dataDir(): string {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

function storiesDir(): string {
  return path.join(dataDir(), "stories");
}

function markerFile(): string {
  return path.join(dataDir(), ".seeded");
}

function storyFile(id: string): string {
  if (!isStoryId(id)) throw new Error("Invalid story id.");
  const root = path.resolve(storiesDir());
  const file = path.resolve(root, `${id}.json`);
  if (file !== path.join(root, `${id}.json`)) throw new Error("Invalid story id.");
  return file;
}

async function writeAtomic(file: string, story: Story): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(story));
  await fs.rename(tmp, file);
}

async function readStoryFile(file: string): Promise<Story | undefined> {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text) as Story;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function ensureSeeded(): Promise<void> {
  const dir = storiesDir();
  await fs.mkdir(dir, { recursive: true });
  await ensureDataBackup();
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const marker = markerFile();
  if (names.length > 0) {
    await fs.writeFile(marker, "1").catch(() => undefined);
    return;
  }
  try {
    await fs.access(marker);
    return;
  } catch {
    /* first run */
  }
  await writeAtomic(storyFile(SAMPLE_STORY.id), SAMPLE_STORY);
  await fs.writeFile(marker, "1");
}

export async function listStories(): Promise<Story[]> {
  await ensureSeeded();
  const dir = storiesDir();
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const stories: Story[] = [];
  for (const name of names) {
    const story = await readStoryFile(path.join(dir, name));
    if (story?.id) stories.push(story);
  }
  stories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return stories;
}

export async function listSummaries(): Promise<StorySummary[]> {
  const stories = await listStories();
  return stories.map(summaryOf);
}

function summaryOf(story: Story): StorySummary {
  const summary: StorySummary = {
    id: story.id,
    title: story.title,
    level: story.level,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
  if (story.bookId && story.chapterNumber != null) {
    summary.bookId = story.bookId;
    summary.chapterNumber = story.chapterNumber;
    if (story.chapterTitle) summary.chapterTitle = story.chapterTitle;
  }
  return summary;
}

export async function getStory(id: string): Promise<Story | undefined> {
  await ensureSeeded();
  if (!isStoryId(id)) return undefined;
  return readStoryFile(storyFile(id));
}

export async function createStory(story: Story): Promise<Story | "exists"> {
  await ensureDataBackup();
  await fs.mkdir(storiesDir(), { recursive: true });
  const file = storyFile(story.id);
  try {
    await fs.writeFile(file, JSON.stringify(story), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return "exists";
    throw err;
  }
  await fs.writeFile(markerFile(), "1").catch(() => undefined);
  return story;
}

export async function replaceStory(id: string, story: Story): Promise<Story | undefined> {
  const existing = await getStory(id);
  if (!existing) return undefined;
  const next: Story = {
    ...story,
    id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await writeAtomic(storyFile(id), next);
  return next;
}

export async function upsertStory(story: Story): Promise<Story> {
  const existing = await getStory(story.id).catch(() => undefined);
  if (!existing) {
    const created = await createStory(story);
    if (created === "exists") return replaceStory(story.id, story).then((row) => row ?? story);
    return created;
  }
  const next: Story = { ...story, id: story.id };
  await writeAtomic(storyFile(story.id), next);
  return next;
}

export async function deleteStory(id: string): Promise<boolean> {
  await ensureDataBackup();
  if (!isStoryId(id)) return false;
  try {
    await fs.unlink(storyFile(id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
