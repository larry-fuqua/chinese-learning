import { apiFetch } from "./api-fetch";
import type { BookWithChapters, Note, Story, StoryLevel } from "./types";

async function errorFrom(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error || `Request failed (${response.status})`);
}

export async function listStories(): Promise<Story[]> {
  const response = await apiFetch("/api/stories/export");
  if (!response.ok) throw await errorFrom(response);
  const data = (await response.json()) as { stories?: Story[] };
  const stories = data.stories ?? [];
  return stories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listBooks(): Promise<BookWithChapters[]> {
  const response = await apiFetch("/api/books");
  if (!response.ok) throw await errorFrom(response);
  const books = (await response.json()) as BookWithChapters[];
  return books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBook(id: string): Promise<BookWithChapters | undefined> {
  const response = await apiFetch(`/api/books/${encodeURIComponent(id)}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as BookWithChapters;
}

export async function createBook(input: {
  title: string;
  level: StoryLevel;
  description?: string;
}): Promise<BookWithChapters> {
  const response = await apiFetch("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as BookWithChapters;
}

export async function deleteBook(id: string): Promise<void> {
  const response = await apiFetch(`/api/books/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status === 404) return;
  if (!response.ok) throw await errorFrom(response);
}

export async function getStory(id: string): Promise<Story | undefined> {
  const response = await apiFetch(`/api/stories/${encodeURIComponent(id)}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as Story;
}

export async function saveStory(story: Story): Promise<void> {
  const payload = JSON.stringify(story);
  const put = await apiFetch(`/api/stories/${encodeURIComponent(story.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  if (put.status === 404) {
    const post = await apiFetch("/api/stories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    if (!post.ok) throw await errorFrom(post);
    return;
  }
  if (!put.ok) throw await errorFrom(put);
}

export async function deleteStory(id: string): Promise<void> {
  const response = await apiFetch(`/api/stories/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status === 404) return;
  if (!response.ok) throw await errorFrom(response);
}

export async function upsertNote(
  storyId: string,
  hanzi: string,
  note: Note,
): Promise<Story | undefined> {
  const story = await getStory(storyId);
  if (!story) return undefined;
  story.notes[hanzi] = note;
  await saveStory(story);
  const updated = await getStory(storyId);
  return updated ?? { ...story, updatedAt: new Date().toISOString() };
}

export async function exportStories(): Promise<string> {
  const response = await apiFetch("/api/stories/export");
  if (!response.ok) throw await errorFrom(response);
  const data = await response.json();
  return JSON.stringify(data, null, 2);
}

export async function importStories(json: string): Promise<number> {
  const response = await apiFetch("/api/stories/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
  });
  if (!response.ok) throw await errorFrom(response);
  const data = (await response.json()) as { imported?: number };
  return data.imported ?? 0;
}
