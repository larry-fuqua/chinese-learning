import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Note, Story, TtsCache } from "./types";
import { SAMPLE_STORY } from "./sample";

const DB_NAME = "chinese-reader";
const DB_VERSION = 1;

interface ReaderDB extends DBSchema {
  stories: {
    key: string;
    value: Story;
  };
  audio: {
    key: string;
    value: {
      key: string;
      audio: ArrayBuffer;
      duration: number;
      charTimes: [number, number][];
      graphChars: string[];
      speed: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<ReaderDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("stories")) {
          database.createObjectStore("stories", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("audio")) {
          database.createObjectStore("audio", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

export async function seedIfEmpty(): Promise<void> {
  const database = await db();
  const count = await database.count("stories");
  if (count === 0) {
    await database.put("stories", SAMPLE_STORY);
  }
}

export async function listStories(): Promise<Story[]> {
  await seedIfEmpty();
  const database = await db();
  const stories = await database.getAll("stories");
  return stories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getStory(id: string): Promise<Story | undefined> {
  await seedIfEmpty();
  const database = await db();
  return database.get("stories", id);
}

export async function saveStory(story: Story): Promise<void> {
  const database = await db();
  await database.put("stories", { ...story, updatedAt: new Date().toISOString() });
}

export async function deleteStory(id: string): Promise<void> {
  const database = await db();
  await database.delete("stories", id);
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
  return story;
}

function audioKey(storyId: string, sentenceId: string, speed: number) {
  return `${storyId}:${sentenceId}:${speed.toFixed(2)}`;
}

export async function getTts(
  storyId: string,
  sentenceId: string,
  speed: number,
): Promise<TtsCache | undefined> {
  const database = await db();
  const row = await database.get("audio", audioKey(storyId, sentenceId, speed));
  if (!row) return undefined;
  return {
    audio: row.audio,
    duration: row.duration,
    charTimes: row.charTimes,
    graphChars: row.graphChars,
    speed: row.speed,
  };
}

export async function putTts(
  storyId: string,
  sentenceId: string,
  cache: TtsCache,
): Promise<void> {
  const database = await db();
  await database.put("audio", {
    key: audioKey(storyId, sentenceId, cache.speed),
    ...cache,
  });
}

export async function exportStories(): Promise<string> {
  const stories = await listStories();
  return JSON.stringify({ version: 1, stories }, null, 2);
}

export async function importStories(json: string): Promise<number> {
  const parsed = JSON.parse(json) as { stories?: Story[] } | Story[];
  const stories = Array.isArray(parsed) ? parsed : parsed.stories ?? [];
  let n = 0;
  for (const story of stories) {
    if (!story?.id || !story.hanzi || !story.sentences) continue;
    await saveStory(story);
    n++;
  }
  return n;
}
