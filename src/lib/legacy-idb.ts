import type { Story } from "./types";

const DB_NAME = "chinese-reader";

function looksLikeStory(value: unknown): value is Story {
  if (!value || typeof value !== "object") return false;
  const story = value as Story;
  return Boolean(story.id && story.hanzi && Array.isArray(story.sentences) && story.sentences.length);
}

/** Read stories left in this browser by the pre-server library. Does not create the database. */
export function readLegacyStories(): Promise<Story[]> {
  if (typeof indexedDB === "undefined") return Promise.resolve([]);
  return new Promise((resolve) => {
    let created = false;
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        created = true;
        request.transaction?.abort();
      }
    };
    request.onerror = () => {
      if (created) indexedDB.deleteDatabase(DB_NAME);
      resolve([]);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (created || !db.objectStoreNames.contains("stories")) {
        db.close();
        if (created) indexedDB.deleteDatabase(DB_NAME);
        resolve([]);
        return;
      }
      const tx = db.transaction("stories", "readonly");
      const all = tx.objectStore("stories").getAll();
      all.onerror = () => {
        db.close();
        resolve([]);
      };
      all.onsuccess = () => {
        db.close();
        const rows = Array.isArray(all.result) ? all.result : [];
        resolve(rows.filter(looksLikeStory));
      };
    };
  });
}

export function clearLegacyDatabase(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export function legacyWorthUploading(stories: Story[]): boolean {
  return stories.some(
    (story) => !story.bundled || Object.values(story.notes ?? {}).some((note) => note.source === "user"),
  );
}
