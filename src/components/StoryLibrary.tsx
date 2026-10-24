"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { clearLegacyDatabase, legacyWorthUploading, readLegacyStories } from "@/lib/legacy-idb";
import {
  deleteStory,
  exportStories,
  importStories,
  listStories,
} from "@/lib/storage";
import type { Story } from "@/lib/types";

export function StoryLibrary() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [message, setMessage] = useState("");
  const [legacy, setLegacy] = useState<Story[] | null>(null);

  async function refresh() {
    try {
      setStories(await listStories());
    } catch (err) {
      setStories([]);
      setMessage(err instanceof Error ? err.message : "Could not load stories.");
    }
  }

  useEffect(() => {
    void refresh();
    if (sessionStorage.getItem("legacy-library-dismissed") === "1") return;
    void readLegacyStories().then((found) => {
      if (legacyWorthUploading(found)) setLegacy(found);
    });
  }, []);

  async function onExport() {
    const json = await exportStories();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chinese-reader-stories.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function onImport(file: File) {
    try {
      const text = await file.text();
      const n = await importStories(text);
      setMessage(`Imported ${n} stor${n === 1 ? "y" : "ies"}.`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Import failed.");
    }
  }

  async function uploadLegacy() {
    if (!legacy?.length) return;
    try {
      const n = await importStories(JSON.stringify({ version: 1, stories: legacy }));
      await clearLegacyDatabase();
      setLegacy(null);
      setMessage(`Uploaded ${n} browser stor${n === 1 ? "y" : "ies"} to the server.`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not upload browser stories.");
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-5xl">
      <AppHeader
        title="课文"
        right={
          <>
            <label className="cursor-pointer rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5 font-[family-name:var(--font-sans)] text-sm">
              Import
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onImport(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void onExport()}
              className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5 font-[family-name:var(--font-sans)] text-sm"
            >
              Export
            </button>
            <Link
              href="/new"
              className="rounded-full bg-cinnabar px-4 py-1.5 font-[family-name:var(--font-sans)] text-sm font-medium text-paper"
            >
              New story
            </Link>
          </>
        }
      />

      <main className="px-4 py-8 sm:px-6">
        <p className="max-w-xl font-[family-name:var(--font-sans)] text-sm leading-relaxed text-ink-soft">
          Simplified Chinese first. Hear a sentence, recite it, and compare the
          pitch — especially the tones. Pinyin and notes stay hidden until you
          ask.
        </p>
        {legacy ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[color-mix(in_oklab,var(--color-cinnabar)_30%,transparent)] bg-white/40 px-4 py-3">
            <p className="font-[family-name:var(--font-sans)] text-sm text-ink">
              This browser still has {legacy.length} local stor{legacy.length === 1 ? "y" : "ies"}.
              Upload them once so every device shares the server library.
            </p>
            <button
              type="button"
              onClick={() => void uploadLegacy()}
              className="rounded-full bg-cinnabar px-3 py-1.5 font-[family-name:var(--font-sans)] text-sm text-paper"
            >
              Upload local stories
            </button>
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem("legacy-library-dismissed", "1");
                setLegacy(null);
              }}
              className="font-[family-name:var(--font-sans)] text-sm text-ink-soft"
            >
              Not now
            </button>
          </div>
        ) : null}
        {message ? (
          <p className="mt-3 font-[family-name:var(--font-sans)] text-sm text-moss">
            {message}
          </p>
        ) : null}

        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {(stories ?? []).map((story) => (
            <li key={story.id} className="paper-card rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/read/${story.id}`} className="min-w-0">
                  <p className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-cinnabar">
                    {story.level}
                  </p>
                  <h2 className="hanzi mt-1 text-2xl">{story.title}</h2>
                  <p className="hanzi mt-3 line-clamp-2 text-lg text-ink-soft">
                    {story.hanzi.replace(/\n/g, "")}
                  </p>
                  <p className="mt-3 font-[family-name:var(--font-sans)] text-xs text-ink-soft">
                    {story.sentences.length} sentences
                  </p>
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Link
                    href={`/new?id=${encodeURIComponent(story.id)}`}
                    className="font-[family-name:var(--font-sans)] text-xs text-cinnabar"
                  >
                    Edit
                  </Link>
                  {!story.bundled ? (
                    <button
                      type="button"
                      className="font-[family-name:var(--font-sans)] text-xs text-ink-soft hover:text-cinnabar"
                      onClick={() => {
                        if (confirm(`Delete “${story.title}”?`)) {
                          void deleteStory(story.id).then(refresh);
                        }
                      }}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {stories && stories.length === 0 ? (
          <p className="mt-10 font-[family-name:var(--font-sans)] text-sm text-ink-soft">
            No stories yet. Add one to start reading.
          </p>
        ) : null}
      </main>
    </div>
  );
}
