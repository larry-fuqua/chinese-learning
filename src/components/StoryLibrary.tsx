"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
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

  async function refresh() {
    setStories(await listStories());
  }

  useEffect(() => {
    void refresh();
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
    const text = await file.text();
    const n = await importStories(text);
    setMessage(`Imported ${n} stor${n === 1 ? "y" : "ies"}.`);
    await refresh();
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
