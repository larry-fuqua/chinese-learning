import { chapterSlot, touchBook } from "./book-store";
import { createStory, replaceStory } from "./story-store";
import type { Story } from "./types";

export async function insertStory(
  story: Story,
): Promise<{ ok: true; story: Story } | { ok: false; status: number; error: string }> {
  const slotError = await ensureChapterSlot(story);
  if (slotError) return slotError;
  const created = await createStory(story);
  if (created === "exists") {
    return { ok: false, status: 409, error: "A story with this id already exists." };
  }
  if (created.bookId) await touchBook(created.bookId);
  return { ok: true, story: created };
}

export async function updateStory(
  id: string,
  story: Story,
): Promise<{ ok: true; story: Story } | { ok: false; status: number; error: string }> {
  const slotError = await ensureChapterSlot(story, id);
  if (slotError) return slotError;
  const replaced = await replaceStory(id, story);
  if (!replaced) return { ok: false, status: 404, error: "Story not found." };
  return { ok: true, story: replaced };
}

async function ensureChapterSlot(
  story: Story,
  exceptId?: string,
): Promise<{ ok: false; status: number; error: string } | null> {
  if (!story.bookId || story.chapterNumber == null) return null;
  const slot = await chapterSlot(story.bookId, story.chapterNumber, exceptId);
  if (slot === "missing") return { ok: false, status: 400, error: "Book not found." };
  if (slot === "taken") {
    return { ok: false, status: 409, error: "That chapter number is already used in this book." };
  }
  return null;
}
