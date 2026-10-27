"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import {
  createBook,
  deleteBook,
  deleteStory,
  exportStories,
  importStories,
  listBooks,
  listStories,
} from "@/lib/storage";
import type { BookWithChapters, ChapterSummary, Story, StoryLevel } from "@/lib/types";

type LibraryEntry =
  | { kind: "book"; book: BookWithChapters; updatedAt: string }
  | { kind: "story"; story: Story; updatedAt: string };

export function StoryLibrary() {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [books, setBooks] = useState<BookWithChapters[] | null>(null);
  const [message, setMessage] = useState("");
  const [showBookForm, setShowBookForm] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [bookLevel, setBookLevel] = useState<StoryLevel>("HSK1");
  const [bookDescription, setBookDescription] = useState("");

  async function refresh() {
    try {
      const [nextStories, nextBooks] = await Promise.all([listStories(), listBooks()]);
      setStories(nextStories);
      setBooks(nextBooks);
    } catch (err) {
      setStories([]);
      setBooks([]);
      setMessage(err instanceof Error ? err.message : "Could not load stories.");
    }
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
    try {
      const text = await file.text();
      const n = await importStories(text);
      setMessage(`Imported ${n} stor${n === 1 ? "y" : "ies"}.`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Import failed.");
    }
  }

  async function onCreateBook() {
    const title = bookTitle.trim();
    if (!title) {
      setMessage("A book needs a title.");
      return;
    }
    try {
      await createBook({
        title,
        level: bookLevel,
        description: bookDescription.trim() || undefined,
      });
      setBookTitle("");
      setBookDescription("");
      setShowBookForm(false);
      setMessage(`Added book “${title}”.`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not add the book.");
    }
  }

  const bookIds = new Set((books ?? []).map((book) => book.id));
  const entries: LibraryEntry[] = [
    ...(books ?? []).map((book) => ({ kind: "book" as const, book, updatedAt: book.updatedAt })),
    ...(stories ?? [])
      .filter((story) => !story.bookId || !bookIds.has(story.bookId))
      .map((story) => ({ kind: "story" as const, story, updatedAt: story.updatedAt })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

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
            <button
              type="button"
              onClick={() => setShowBookForm((open) => !open)}
              className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5 font-[family-name:var(--font-sans)] text-sm"
            >
              New book
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
        {showBookForm ? (
          <form
            className="mt-4 grid gap-3 rounded-2xl border border-[color-mix(in_oklab,var(--color-ink)_12%,transparent)] bg-white/40 p-4 sm:grid-cols-[1fr_8rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void onCreateBook();
            }}
          >
            <label className="block sm:col-span-1">
              <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
                Book title
              </span>
              <input
                value={bookTitle}
                onChange={(event) => setBookTitle(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2"
                placeholder="汉语教程"
              />
            </label>
            <label className="block">
              <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
                Level
              </span>
              <select
                value={bookLevel}
                onChange={(event) => setBookLevel(event.target.value as StoryLevel)}
                className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2"
              >
                <option value="HSK1">HSK 1</option>
                <option value="HSK2">HSK 2</option>
                <option value="HSK3">HSK 3</option>
                <option value="other">Other</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="rounded-full bg-cinnabar px-4 py-2 font-[family-name:var(--font-sans)] text-sm text-paper"
              >
                Add book
              </button>
            </div>
            <label className="block sm:col-span-3">
              <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
                Description (optional)
              </span>
              <input
                value={bookDescription}
                onChange={(event) => setBookDescription(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2 font-[family-name:var(--font-sans)] text-sm"
              />
            </label>
          </form>
        ) : null}
        {message ? (
          <p className="mt-3 font-[family-name:var(--font-sans)] text-sm text-moss">
            {message}
          </p>
        ) : null}

        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {entries.map((entry) =>
            entry.kind === "book" ? (
              <BookCard
              key={entry.book.id}
              book={entry.book}
              stories={stories ?? []}
              onChange={refresh}
            />
            ) : (
              <StoryCard key={entry.story.id} story={entry.story} onChange={refresh} />
            ),
          )}
        </ul>

        {stories && books && entries.length === 0 ? (
          <p className="mt-10 font-[family-name:var(--font-sans)] text-sm text-ink-soft">
            No stories yet. Add one to start reading.
          </p>
        ) : null}
      </main>
    </div>
  );
}

function StoryCard({ story, onChange }: { story: Story; onChange: () => Promise<void> }) {
  return (
    <li className="paper-card rounded-2xl p-5">
      <StoryRow story={story} onChange={onChange} />
    </li>
  );
}

function StoryRow({
  story,
  chapter,
  onChange,
}: {
  story: Story;
  chapter?: ChapterSummary;
  onChange: () => Promise<void>;
}) {
  const label = chapter?.chapterTitle || chapter?.title || story.title;
  return (
    <div className="flex items-start justify-between gap-3">
      <Link href={`/read/${story.id}`} className="min-w-0">
        <p className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-cinnabar">
          {chapter ? `Chapter ${chapter.chapterNumber}` : story.level}
        </p>
        <h2 className="hanzi mt-1 text-2xl">{label}</h2>
        {chapter?.chapterTitle && chapter.chapterTitle !== story.title ? (
          <p className="mt-1 font-[family-name:var(--font-sans)] text-xs text-ink-soft">{story.title}</p>
        ) : null}
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
                void deleteStory(story.id).then(onChange);
              }
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BookCard({
  book,
  stories,
  onChange,
}: {
  book: BookWithChapters;
  stories: Story[];
  onChange: () => Promise<void>;
}) {
  const storyById = new Map(stories.map((story) => [story.id, story]));
  return (
    <li className="paper-card rounded-2xl p-5 sm:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-cinnabar">
            Book · {book.level}
          </p>
          <h2 className="hanzi mt-1 text-2xl">{book.title}</h2>
          {book.description ? (
            <p className="mt-2 font-[family-name:var(--font-sans)] text-sm text-ink-soft">{book.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Link
            href={`/new?book=${encodeURIComponent(book.id)}`}
            className="font-[family-name:var(--font-sans)] text-xs text-cinnabar"
          >
            Add chapter
          </Link>
          <button
            type="button"
            className="font-[family-name:var(--font-sans)] text-xs text-ink-soft hover:text-cinnabar"
            onClick={() => {
              const count = book.chapters.length;
              const chapterNote =
                count === 0
                  ? "This book has no chapters."
                  : `Its ${count} chapter${count === 1 ? "" : "s"} stay in the library as separate stories. The chapter text is not deleted.`;
              if (confirm(`Delete “${book.title}”? ${chapterNote}`)) {
                void deleteBook(book.id).then(onChange);
              }
            }}
          >
            Delete book
          </button>
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer font-[family-name:var(--font-sans)] text-xs text-ink-soft">
          {book.chapters.length} chapter{book.chapters.length === 1 ? "" : "s"}
        </summary>
        {book.chapters.length ? (
          <ul className="mt-4 space-y-3 border-t border-[color-mix(in_oklab,var(--color-ink)_10%,transparent)] pt-4">
            {book.chapters.map((chapter) => {
              const story = storyById.get(chapter.id);
              if (!story) return null;
              return (
                <li key={chapter.id}>
                  <StoryRow story={story} chapter={chapter} onChange={onChange} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 font-[family-name:var(--font-sans)] text-sm text-ink-soft">
            No chapters yet.
          </p>
        )}
      </details>
    </li>
  );
}
