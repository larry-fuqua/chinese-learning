import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, ensureDataBackup, listStories, replaceStory } from "./story-store";
import { isStoryId, isStoryLevel } from "./story-validate";
import { newId } from "./text";
import type { Book, BookWithChapters, ChapterSummary, Story, StoryLevel } from "./types";

const DESCRIPTION_LIMIT = 2_000;

function booksDir(): string {
  return path.join(dataDir(), "books");
}

function bookFile(id: string): string {
  if (!isStoryId(id)) throw new Error("Invalid book id.");
  const root = path.resolve(booksDir());
  const file = path.resolve(root, `${id}.json`);
  if (file !== path.join(root, `${id}.json`)) throw new Error("Invalid book id.");
  return file;
}

async function writeAtomic(file: string, book: Book): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(book));
  await fs.rename(tmp, file);
}

async function readBookFile(file: string): Promise<Book | undefined> {
  try {
    const text = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(text) as Book;
    if (!parsed?.id || !isStoryId(parsed.id)) return undefined;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function readBook(id: string): Promise<Book | undefined> {
  await ensureDataBackup();
  if (!isStoryId(id)) return undefined;
  return readBookFile(bookFile(id));
}

export async function listBookRecords(): Promise<Book[]> {
  await ensureDataBackup();
  const dir = booksDir();
  await fs.mkdir(dir, { recursive: true });
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const books: Book[] = [];
  for (const name of names) {
    const book = await readBookFile(path.join(dir, name));
    if (book) books.push(book);
  }
  books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return books;
}

export async function listBooks(): Promise<BookWithChapters[]> {
  const [books, stories] = await Promise.all([listBookRecords(), listStories()]);
  return books.map((book) => withChapters(book, stories));
}

export async function getBook(id: string): Promise<BookWithChapters | undefined> {
  const book = await readBook(id);
  if (!book) return undefined;
  const stories = await listStories();
  return withChapters(book, stories);
}

export async function createBook(input: {
  id?: string;
  title: string;
  level: StoryLevel;
  description?: string;
}): Promise<BookWithChapters | "exists"> {
  await ensureDataBackup();
  const now = new Date().toISOString();
  const book: Book = {
    id: input.id ?? newId(),
    title: input.title,
    level: input.level,
    createdAt: now,
    updatedAt: now,
  };
  if (input.description) book.description = input.description;
  if (!isStoryId(book.id)) throw new Error("Invalid book id.");
  await fs.mkdir(booksDir(), { recursive: true });
  try {
    await fs.writeFile(bookFile(book.id), JSON.stringify(book), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return "exists";
    throw err;
  }
  return { ...book, chapters: [] };
}

export async function replaceBook(
  id: string,
  input: { title: string; level: StoryLevel; description?: string },
): Promise<BookWithChapters | undefined> {
  const existing = await readBook(id);
  if (!existing) return undefined;
  const next: Book = {
    ...existing,
    id,
    title: input.title,
    level: input.level,
    updatedAt: new Date().toISOString(),
  };
  if (input.description) next.description = input.description;
  else delete next.description;
  await writeAtomic(bookFile(id), next);
  const stories = await listStories();
  return withChapters(next, stories);
}

/** Drop the book record. Chapter stories stay, without book fields. */
export async function deleteBook(id: string): Promise<{ detached: string[] } | undefined> {
  await ensureDataBackup();
  if (!isStoryId(id)) return undefined;
  const existing = await readBook(id);
  if (!existing) return undefined;
  const stories = await listStories();
  const detached: string[] = [];
  for (const story of stories) {
    if (story.bookId !== id) continue;
    const next: Story = { ...story };
    delete next.bookId;
    delete next.chapterNumber;
    delete next.chapterTitle;
    await replaceStory(story.id, next);
    detached.push(story.id);
  }
  await fs.unlink(bookFile(id));
  return { detached };
}

export async function upsertBook(book: Book): Promise<Book> {
  await ensureDataBackup();
  await fs.mkdir(booksDir(), { recursive: true });
  const existing = await readBook(book.id).catch(() => undefined);
  if (!existing) {
    try {
      await fs.writeFile(bookFile(book.id), JSON.stringify(book), { flag: "wx" });
      return book;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  await writeAtomic(bookFile(book.id), { ...book, id: book.id });
  return book;
}

export async function touchBook(id: string): Promise<void> {
  const book = await readBook(id);
  if (!book) return;
  book.updatedAt = new Date().toISOString();
  await writeAtomic(bookFile(id), book);
}

export async function chapterSlot(
  bookId: string,
  chapterNumber: number,
  exceptStoryId?: string,
): Promise<"ok" | "missing" | "taken"> {
  const book = await readBook(bookId);
  if (!book) return "missing";
  const stories = await listStories();
  const taken = stories.some(
    (story) =>
      story.bookId === bookId &&
      story.chapterNumber === chapterNumber &&
      story.id !== exceptStoryId,
  );
  return taken ? "taken" : "ok";
}

export async function nextChapterNumber(bookId: string): Promise<number | undefined> {
  const book = await getBook(bookId);
  if (!book) return undefined;
  return book.chapters.reduce((max, chapter) => Math.max(max, chapter.chapterNumber), 0) + 1;
}

export function parseBookBody(
  body: unknown,
  opts: { id?: string } = {},
):
  | { ok: true; value: { id?: string; title: string; level: StoryLevel; description?: string } }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  if (opts.id && typeof record.id === "string" && record.id !== opts.id) {
    return { ok: false, error: "id does not match the URL." };
  }
  if (typeof record.title !== "string" || !record.title.trim()) {
    return { ok: false, error: "title is required." };
  }
  if (record.title.trim().length > 200) {
    return { ok: false, error: "title must be at most 200 characters." };
  }
  if (!isStoryLevel(record.level)) {
    return { ok: false, error: "level must be HSK1, HSK2, HSK3, or other." };
  }
  let id = opts.id;
  if (!id && record.id !== undefined && record.id !== null && record.id !== "") {
    if (typeof record.id !== "string" || !isStoryId(record.id)) {
      return { ok: false, error: "id must match /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/." };
    }
    id = record.id;
  }
  let description: string | undefined;
  if (record.description !== undefined && record.description !== null && record.description !== "") {
    if (typeof record.description !== "string") {
      return { ok: false, error: "description must be a string." };
    }
    if (record.description.trim().length > DESCRIPTION_LIMIT) {
      return { ok: false, error: `description must be at most ${DESCRIPTION_LIMIT} characters.` };
    }
    if (record.description.trim()) description = record.description.trim();
  }
  return {
    ok: true,
    value: { id, title: record.title.trim(), level: record.level, description },
  };
}

function withChapters(book: Book, stories: Story[]): BookWithChapters {
  const chapters: ChapterSummary[] = stories
    .filter((story) => story.bookId === book.id && story.chapterNumber != null)
    .map((story) => {
      const summary: ChapterSummary = {
        id: story.id,
        title: story.title,
        chapterNumber: story.chapterNumber!,
        level: story.level,
        createdAt: story.createdAt,
        updatedAt: story.updatedAt,
      };
      if (story.chapterTitle) summary.chapterTitle = story.chapterTitle;
      return summary;
    })
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id));
  return { ...book, chapters };
}
