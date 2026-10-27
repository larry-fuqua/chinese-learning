"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { apiFetch } from "@/lib/api-fetch";
import { getStory, listBooks, saveStory } from "@/lib/storage";
import {
  buildSentencesFromHanzi,
  looksLikePinyin,
  newId,
  onlyHanzi,
  paragraphGroupsForSentences,
} from "@/lib/text";
import type { BookWithChapters, PrepareResponse, Story, StoryLevel } from "@/lib/types";

export function NewStoryForm({ storyId, bookId: initialBookId }: { storyId?: string; bookId?: string }) {
  const router = useRouter();
  const [existing, setExisting] = useState<Story | null>(null);
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<StoryLevel>("HSK1");
  const [hanzi, setHanzi] = useState("");
  const [pinyin, setPinyin] = useState("");
  const [books, setBooks] = useState<BookWithChapters[]>([]);
  const [bookId, setBookId] = useState(initialBookId ?? "");
  const [chapterNumber, setChapterNumber] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(storyId);

  useEffect(() => {
    void listBooks().then(setBooks).catch(() => setBooks([]));
  }, []);

  useEffect(() => {
    if (!storyId) return;
    void getStory(storyId).then((found) => {
      if (!found) {
        setError("Story not found.");
        return;
      }
      setExisting(found);
      setTitle(found.title);
      setLevel(found.level);
      setHanzi(found.hanzi);
      setPinyin(found.sentences.map((s) => s.pinyin).filter(Boolean).join("\n"));
      setBookId(found.bookId ?? "");
      setChapterNumber(found.chapterNumber ? String(found.chapterNumber) : "");
      setChapterTitle(found.chapterTitle ?? "");
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load story.");
    });
  }, [storyId]);

  useEffect(() => {
    if (storyId || !initialBookId || !books.length) return;
    const book = books.find((item) => item.id === initialBookId);
    if (!book) return;
    setBookId(book.id);
    setLevel(book.level);
    const next = book.chapters.reduce((max, chapter) => Math.max(max, chapter.chapterNumber), 0) + 1;
    setChapterNumber((current) => current || String(next));
  }, [books, initialBookId, storyId]);

  function readPlacement():
    | { ok: true; chapter: { bookId?: string; chapterNumber?: number; chapterTitle?: string } }
    | { ok: false; error: string } {
    if (!bookId) return { ok: true, chapter: {} };
    const n = Number(chapterNumber);
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      return { ok: false, error: "Chapter number must be a whole number from 1 to 9999." };
    }
    return {
      ok: true,
      chapter: { bookId, chapterNumber: n, chapterTitle: chapterTitle.trim() || undefined },
    };
  }

  async function prepareAndSave() {
    setError("");
    const hanziText = hanzi.trim();
    const pinyinText = pinyin.trim();
    if (!hanziText && !pinyinText) {
      setError("Paste simplified Chinese, pinyin, or both.");
      return;
    }
    const placement = readPlacement();
    if (!placement.ok) {
      setError(placement.error);
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch("/api/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          level,
          hanzi: hanziText || undefined,
          pinyin: pinyinText || undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Prepare failed (${response.status})`);
      }
      const prepared = (await response.json()) as PrepareResponse;
      const story = placeStory(toStory(prepared, existing), placement.chapter);
      await saveStory(story);
      router.push(`/read/${story.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not prepare story.";
      if (hanziText && onlyHanzi(hanziText) && !looksLikePinyin(hanziText)) {
        const local = placeStory(localStory(title, level, hanziText, existing), placement.chapter);
        await saveStory(local);
        router.push(`/read/${local.id}`);
        return;
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function saveLocalOnly() {
    setError("");
    const hanziText = hanzi.trim();
    if (!hanziText || !onlyHanzi(hanziText)) {
      setError("Local save needs simplified Chinese text.");
      return;
    }
    const placement = readPlacement();
    if (!placement.ok) {
      setError(placement.error);
      return;
    }
    setBusy(true);
    try {
      const story = placeStory(localStory(title, level, hanziText, existing), placement.chapter);
      const segmented = await apiFetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hanzi: hanziText }),
      });
      const body = (await segmented.json()) as {
        sentences?: Story["sentences"];
        error?: string;
      };
      if (!segmented.ok || !body.sentences?.length) {
        throw new Error(body.error || "Could not group words. Try Save with AI.");
      }
      story.sentences = body.sentences;
      story.notes = existing?.notes ?? {};
      const paragraphs = paragraphGroupsForSentences(hanziText, story.sentences);
      if (paragraphs) story.paragraphs = paragraphs;
      else delete story.paragraphs;
      await saveStory(story);
      router.push(`/read/${story.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function onDropFile(file: File) {
    const text = await file.text();
    if (file.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(text) as { hanzi?: string; title?: string; pinyin?: string };
        if (parsed.hanzi) setHanzi(parsed.hanzi);
        if (parsed.pinyin) setPinyin(parsed.pinyin);
        if (parsed.title) setTitle(parsed.title);
        return;
      } catch {
        /* treat as text */
      }
    }
    if (looksLikePinyin(text) && !onlyHanzi(text)) setPinyin(text);
    else setHanzi(text);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl">
      <AppHeader
        title={editing ? "改课文" : "新课文"}
        right={
          <Link
            href="/"
            className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5 font-[family-name:var(--font-sans)] text-sm"
          >
            Library
          </Link>
        }
      />
      <main className="px-4 py-8 sm:px-6">
        <p className="font-[family-name:var(--font-sans)] text-sm leading-relaxed text-ink-soft">
          {editing
            ? "Fix the Chinese (or title) and save. Word groups and pinyin are rebuilt; your notes stay as you left them."
            : "Paste a graded reader, a social post, or numbered pinyin. AI fills missing hanzi or pinyin and groups words. Notes are manual. Display stays simplified Chinese."}
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void prepareAndSave();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <label className="block">
              <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
                Title
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2"
                placeholder="小明的一天"
              />
            </label>
            <label className="block">
              <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
                Level
              </span>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as StoryLevel)}
                className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2"
              >
                <option value="HSK1">HSK 1</option>
                <option value="HSK2">HSK 2</option>
                <option value="HSK3">HSK 3</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <label className="block">
              <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
                Book
              </span>
              <select
                value={bookId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setBookId(nextId);
                  if (!nextId) return;
                  const book = books.find((item) => item.id === nextId);
                  if (!book) return;
                  if (!editing) setLevel(book.level);
                  if (!chapterNumber) {
                    const next =
                      book.chapters.reduce((max, chapter) => Math.max(max, chapter.chapterNumber), 0) + 1;
                    setChapterNumber(String(next));
                  }
                }}
                className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2"
              >
                <option value="">Standalone story</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>
            </label>
            {bookId ? (
              <label className="block">
                <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
                  Chapter
                </span>
                <input
                  value={chapterNumber}
                  onChange={(e) => setChapterNumber(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2"
                />
              </label>
            ) : null}
          </div>
          {bookId ? (
            <label className="block">
              <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
                Chapter title (optional)
              </span>
              <input
                value={chapterTitle}
                onChange={(e) => setChapterTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2"
              />
            </label>
          ) : null}

          <label className="block">
            <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
              Simplified Chinese
            </span>
            <textarea
              value={hanzi}
              onChange={(e) => setHanzi(e.target.value)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) void onDropFile(file);
              }}
              rows={8}
              className="hanzi mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2 text-xl leading-relaxed"
              placeholder="今天天气很好。"
            />
          </label>

          <label className="block">
            <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
              Pinyin (optional)
            </span>
            <textarea
              value={pinyin}
              onChange={(e) => setPinyin(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2 font-[family-name:var(--font-sans)]"
              placeholder="Jīntiān tiānqì hěn hǎo.  —  or  jin1 tian1 tian1 qi4 hen3 hao3"
            />
          </label>

          {error ? (
            <p className="font-[family-name:var(--font-sans)] text-sm text-cinnabar">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-cinnabar px-5 py-2 font-[family-name:var(--font-sans)] text-sm font-medium text-paper disabled:opacity-60"
            >
              {busy ? "Preparing…" : editing ? "Save with AI" : "Prepare with AI"}
            </button>
            <button
              type="button"
              onClick={() => void saveLocalOnly()}
              className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-5 py-2 font-[family-name:var(--font-sans)] text-sm"
            >
              {editing ? "Save text only" : "Save Chinese only"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

function toStory(prepared: PrepareResponse, existing: Story | null): Story {
  const now = new Date().toISOString();
  const paragraphs =
    prepared.paragraphs ?? paragraphGroupsForSentences(prepared.hanzi, prepared.sentences);
  const story: Story = {
    id: existing?.id ?? newId(),
    title: prepared.title,
    level: prepared.level,
    bundled: existing?.bundled,
    hanzi: prepared.hanzi,
    sentences: prepared.sentences,
    notes: existing?.notes ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (paragraphs && paragraphs.length > 1) story.paragraphs = paragraphs;
  return story;
}

function placeStory(
  story: Story,
  chapter: { bookId?: string; chapterNumber?: number; chapterTitle?: string },
): Story {
  const next: Story = { ...story };
  delete next.bookId;
  delete next.chapterNumber;
  delete next.chapterTitle;
  if (chapter.bookId && chapter.chapterNumber) {
    next.bookId = chapter.bookId;
    next.chapterNumber = chapter.chapterNumber;
    if (chapter.chapterTitle) next.chapterTitle = chapter.chapterTitle;
  }
  return next;
}

function localStory(
  title: string,
  level: StoryLevel,
  hanzi: string,
  existing: Story | null,
): Story {
  const now = new Date().toISOString();
  const sentences = buildSentencesFromHanzi(hanzi);
  const paragraphs = paragraphGroupsForSentences(hanzi, sentences);
  const story: Story = {
    id: existing?.id ?? newId(),
    title: title.trim() || existing?.title || "Untitled",
    level,
    bundled: existing?.bundled,
    hanzi,
    sentences,
    notes: existing?.notes ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (paragraphs) story.paragraphs = paragraphs;
  return story;
}
