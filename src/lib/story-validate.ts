import type { Book, Note, NoteSource, Sentence, Story, StoryLevel, Word } from "./types";
import { newId, paragraphGroupsForSentences } from "./text";

export const STORY_LEVELS: readonly StoryLevel[] = ["HSK1", "HSK2", "HSK3", "other"];
const NOTE_SOURCES: readonly NoteSource[] = ["ai", "user", "sample"];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

const LIMITS = {
  title: 200,
  hanzi: 100_000,
  sentence: 8_000,
  pinyin: 8_000,
  sentences: 500,
  words: 400,
  word: 80,
  note: 2_000,
  notes: 500,
  noteKey: 80,
};

export function isStoryId(id: string): boolean {
  return ID_RE.test(id);
}

export function isStoryLevel(value: unknown): value is StoryLevel {
  return typeof value === "string" && (STORY_LEVELS as readonly string[]).includes(value);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export type ChapterAssignment = {
  bookId?: string;
  chapterNumber?: number;
  chapterTitle?: string;
};

export type MinimalStoryInput = {
  mode: "minimal";
  title: string;
  level: StoryLevel;
  hanzi: string;
  id?: string;
  bookId?: string;
  chapterNumber?: number;
  chapterTitle?: string;
};

export type FullStoryInput = {
  mode: "full";
  story: Story;
};

export function parseCreateBody(
  body: unknown,
): { ok: true; value: MinimalStoryInput | FullStoryInput } | { ok: false; error: string } {
  const record = asRecord(body);
  if (!record) return { ok: false, error: "Body must be a JSON object." };
  const idResult = optionalId(record.id);
  if (!idResult.ok) return idResult;

  const sentences = record.sentences;
  if (!Array.isArray(sentences) || sentences.length === 0) {
    const minimal = parseMinimalFields(record);
    if (!minimal.ok) return minimal;
    const chapter = readChapterAssignment(record);
    if (!chapter.ok) return chapter;
    return {
      ok: true,
      value: { mode: "minimal", ...minimal.value, id: idResult.id, ...chapterFields(chapter.chapter) },
    };
  }

  const full = parseFullStory(record, { requireId: false });
  if (!full.ok) return full;
  if (idResult.id) full.story.id = idResult.id;
  return { ok: true, value: { mode: "full", story: full.story } };
}

export function parseReplaceBody(
  body: unknown,
  id: string,
): { ok: true; story: Story } | { ok: false; error: string } {
  if (!isStoryId(id)) return { ok: false, error: "Invalid story id." };
  const record = asRecord(body);
  if (!record) return { ok: false, error: "Body must be a JSON object." };
  if (typeof record.id === "string" && record.id !== id) {
    return { ok: false, error: "id does not match the URL." };
  }
  if (!Array.isArray(record.sentences) || record.sentences.length === 0) {
    return { ok: false, error: "sentences is required to replace a story." };
  }
  const full = parseFullStory({ ...record, id }, { requireId: true });
  if (!full.ok) return full;
  full.story.id = id;
  return { ok: true, story: full.story };
}

/** Library Import: keep stories the old browser export can actually round-trip. */
export function coerceImportStory(raw: unknown): Story | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (typeof record.id !== "string" || !isStoryId(record.id)) return null;
  if (typeof record.hanzi !== "string" || !record.hanzi.trim()) return null;
  if (record.hanzi.length > LIMITS.hanzi) return null;
  if (!Array.isArray(record.sentences) || record.sentences.length === 0) return null;
  const sentences: Sentence[] = [];
  for (const item of record.sentences.slice(0, LIMITS.sentences)) {
    const sentence = coerceSentence(item);
    if (sentence) sentences.push(sentence);
  }
  if (!sentences.length) return null;
  const now = new Date().toISOString();
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim().slice(0, LIMITS.title)
      : "Untitled";
  const story: Story = {
    id: record.id,
    title,
    level: isStoryLevel(record.level) ? record.level : "other",
    bundled: record.bundled === true ? true : undefined,
    hanzi: record.hanzi.trim(),
    sentences,
    notes: coerceNotes(record.notes),
    createdAt: isIso(record.createdAt) ? record.createdAt : now,
    updatedAt: isIso(record.updatedAt) ? record.updatedAt : now,
  };
  applyLenientChapter(story, record);
  applyLenientParagraphs(story, record.paragraphs);
  return story;
}

export function parseImportBody(
  body: unknown,
): { ok: true; stories: Story[]; books: Book[] } | { ok: false; error: string } {
  let list: unknown[];
  if (Array.isArray(body)) {
    list = body;
  } else {
    const record = asRecord(body);
    if (!record || !Array.isArray(record.stories)) {
      return {
        ok: false,
        error: 'Import body must be {"version":1,"stories":[...]} or an array of stories.',
      };
    }
    if (record.version !== undefined && record.version !== 1) {
      return { ok: false, error: "Unsupported export version. Expected version 1." };
    }
    list = record.stories;
  }
  if (list.length > 500) return { ok: false, error: "Import is limited to 500 stories." };
  const stories: Story[] = [];
  for (const item of list) {
    const story = coerceImportStory(item);
    if (story) stories.push(story);
  }
  let books: Book[] = [];
  if (!Array.isArray(body)) {
    const record = asRecord(body);
    if (record?.books !== undefined) {
      if (!Array.isArray(record.books)) return { ok: false, error: "books must be an array." };
      if (record.books.length > 500) return { ok: false, error: "Import is limited to 500 books." };
      books = record.books.map(coerceBook).filter((book): book is Book => book != null);
    }
  }
  return { ok: true, stories, books };
}

function optionalId(value: unknown): { ok: true; id?: string } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true };
  if (typeof value !== "string" || !isStoryId(value)) {
    return {
      ok: false,
      error: "id must match /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.",
    };
  }
  return { ok: true, id: value };
}

function parseMinimalFields(
  record: Record<string, unknown>,
): { ok: true; value: { title: string; level: StoryLevel; hanzi: string } } | { ok: false; error: string } {
  if (typeof record.title !== "string" || !record.title.trim()) {
    return { ok: false, error: "title is required." };
  }
  if (record.title.trim().length > LIMITS.title) {
    return { ok: false, error: `title must be at most ${LIMITS.title} characters.` };
  }
  if (!isStoryLevel(record.level)) {
    return { ok: false, error: "level must be HSK1, HSK2, HSK3, or other." };
  }
  if (typeof record.hanzi !== "string" || !record.hanzi.trim()) {
    return { ok: false, error: "hanzi is required." };
  }
  if (record.hanzi.length > LIMITS.hanzi) {
    return { ok: false, error: `hanzi must be at most ${LIMITS.hanzi} characters.` };
  }
  return {
    ok: true,
    value: { title: record.title.trim(), level: record.level, hanzi: record.hanzi.trim() },
  };
}

function parseFullStory(
  record: Record<string, unknown>,
  opts: { requireId: boolean },
): { ok: true; story: Story } | { ok: false; error: string } {
  const fields = parseMinimalFields(record);
  if (!fields.ok) return fields;
  const idCheck = optionalId(record.id);
  if (!idCheck.ok) return idCheck;
  if (opts.requireId && !idCheck.id) return { ok: false, error: "id is required." };
  if (!Array.isArray(record.sentences) || record.sentences.length === 0) {
    return { ok: false, error: "sentences must be a non-empty array." };
  }
  if (record.sentences.length > LIMITS.sentences) {
    return { ok: false, error: `sentences is limited to ${LIMITS.sentences} items.` };
  }
  const sentences: Sentence[] = [];
  for (let i = 0; i < record.sentences.length; i++) {
    const parsed = parseSentence(record.sentences[i], i);
    if (!parsed.ok) return parsed;
    sentences.push(parsed.sentence);
  }
  if (record.notes !== undefined && asRecord(record.notes) === null) {
    return { ok: false, error: "notes must be an object." };
  }
  const notes = parseNotes(record.notes);
  if (!notes.ok) return notes;
  if (record.bundled !== undefined && typeof record.bundled !== "boolean") {
    return { ok: false, error: "bundled must be a boolean." };
  }
  if (record.createdAt !== undefined && !isIso(record.createdAt)) {
    return { ok: false, error: "createdAt must be an ISO date string." };
  }
  const chapter = readChapterAssignment(record);
  if (!chapter.ok) return chapter;
  const paragraphs = resolveParagraphs(fields.value.hanzi, sentences, record.paragraphs);
  if (!paragraphs.ok) return paragraphs;
  const now = new Date().toISOString();
  const story: Story = {
    id: idCheck.id ?? newId(),
    title: fields.value.title,
    level: fields.value.level,
    hanzi: fields.value.hanzi,
    sentences,
    notes: notes.notes,
    createdAt: isIso(record.createdAt) ? record.createdAt : now,
    updatedAt: now,
  };
  if (record.bundled === true) story.bundled = true;
  assignChapter(story, chapter.chapter);
  if (paragraphs.paragraphs) story.paragraphs = paragraphs.paragraphs;
  return { ok: true, story };
}

export function readChapterAssignment(
  record: Record<string, unknown>,
): { ok: true; chapter: ChapterAssignment } | { ok: false; error: string } {
  const hasBook = record.bookId !== undefined && record.bookId !== null && record.bookId !== "";
  const hasNumber =
    record.chapterNumber !== undefined && record.chapterNumber !== null && record.chapterNumber !== "";
  const hasTitle =
    record.chapterTitle !== undefined && record.chapterTitle !== null && record.chapterTitle !== "";
  if (!hasBook && !hasNumber && !hasTitle) return { ok: true, chapter: {} };
  if (!hasBook || !hasNumber) {
    return { ok: false, error: "bookId and chapterNumber must be set together." };
  }
  if (typeof record.bookId !== "string" || !isStoryId(record.bookId)) {
    return { ok: false, error: "bookId must match /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/." };
  }
  if (
    typeof record.chapterNumber !== "number" ||
    !Number.isInteger(record.chapterNumber) ||
    record.chapterNumber < 1 ||
    record.chapterNumber > 9999
  ) {
    return { ok: false, error: "chapterNumber must be an integer from 1 to 9999." };
  }
  if (hasTitle && typeof record.chapterTitle !== "string") {
    return { ok: false, error: "chapterTitle must be a string." };
  }
  if (typeof record.chapterTitle === "string" && record.chapterTitle.trim().length > LIMITS.title) {
    return { ok: false, error: `chapterTitle must be at most ${LIMITS.title} characters.` };
  }
  const chapter: ChapterAssignment = {
    bookId: record.bookId,
    chapterNumber: record.chapterNumber,
  };
  if (typeof record.chapterTitle === "string" && record.chapterTitle.trim()) {
    chapter.chapterTitle = record.chapterTitle.trim();
  }
  return { ok: true, chapter };
}

function chapterFields(chapter: ChapterAssignment): ChapterAssignment {
  const fields: ChapterAssignment = {};
  if (chapter.bookId) fields.bookId = chapter.bookId;
  if (chapter.chapterNumber != null) fields.chapterNumber = chapter.chapterNumber;
  if (chapter.chapterTitle) fields.chapterTitle = chapter.chapterTitle;
  return fields;
}

function assignChapter(story: Story, chapter: ChapterAssignment) {
  if (!chapter.bookId || chapter.chapterNumber == null) return;
  story.bookId = chapter.bookId;
  story.chapterNumber = chapter.chapterNumber;
  if (chapter.chapterTitle) story.chapterTitle = chapter.chapterTitle;
}

export function resolveParagraphs(
  hanzi: string,
  sentences: { id: string }[],
  explicit: unknown,
): { ok: true; paragraphs?: string[][] } | { ok: false; error: string } {
  if (explicit === undefined) {
    return { ok: true, paragraphs: paragraphGroupsForSentences(hanzi, sentences) };
  }
  if (!Array.isArray(explicit)) {
    return { ok: false, error: "paragraphs must be an array of sentence-id groups." };
  }
  if (explicit.length > 200) return { ok: false, error: "paragraphs is too long." };
  const known = new Set(sentences.map((sentence) => sentence.id));
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const group of explicit) {
    if (!Array.isArray(group) || group.length === 0) {
      return { ok: false, error: "each paragraph must be a non-empty array of sentence ids." };
    }
    const row: string[] = [];
    for (const id of group) {
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) {
        return {
          ok: false,
          error: "paragraphs must list each sentence id on this story exactly once.",
        };
      }
      seen.add(id);
      row.push(id);
    }
    groups.push(row);
  }
  if (seen.size !== sentences.length) {
    return { ok: false, error: "paragraphs must include every sentence id exactly once." };
  }
  if (groups.length <= 1) return { ok: true };
  return { ok: true, paragraphs: groups };
}

function applyLenientChapter(story: Story, record: Record<string, unknown>) {
  const chapter = readChapterAssignment(record);
  if (chapter.ok) assignChapter(story, chapter.chapter);
}

function applyLenientParagraphs(story: Story, explicit: unknown) {
  if (explicit === undefined) {
    const derived = paragraphGroupsForSentences(story.hanzi, story.sentences);
    if (derived) story.paragraphs = derived;
    return;
  }
  const resolved = resolveParagraphs(story.hanzi, story.sentences, explicit);
  if (resolved.ok && resolved.paragraphs) story.paragraphs = resolved.paragraphs;
}

function coerceBook(raw: unknown): Book | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== "string" || !isStoryId(record.id)) return null;
  const now = new Date().toISOString();
  const book: Book = {
    id: record.id,
    title:
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim().slice(0, LIMITS.title)
        : "Untitled",
    level: isStoryLevel(record.level) ? record.level : "other",
    createdAt: isIso(record.createdAt) ? record.createdAt : now,
    updatedAt: isIso(record.updatedAt) ? record.updatedAt : now,
  };
  if (typeof record.description === "string" && record.description.trim()) {
    book.description = record.description.trim().slice(0, 2_000);
  }
  return book;
}

function parseSentence(
  raw: unknown,
  index: number,
): { ok: true; sentence: Sentence } | { ok: false; error: string } {
  const record = asRecord(raw);
  if (!record) return { ok: false, error: `sentences[${index}] must be an object.` };
  if (typeof record.hanzi !== "string" || !record.hanzi.trim()) {
    return { ok: false, error: `sentences[${index}].hanzi is required.` };
  }
  if (record.hanzi.length > LIMITS.sentence) {
    return { ok: false, error: `sentences[${index}].hanzi is too long.` };
  }
  if (record.pinyin !== undefined && typeof record.pinyin !== "string") {
    return { ok: false, error: `sentences[${index}].pinyin must be a string.` };
  }
  const pinyin = typeof record.pinyin === "string" ? record.pinyin : "";
  if (pinyin.length > LIMITS.pinyin) {
    return { ok: false, error: `sentences[${index}].pinyin is too long.` };
  }
  if (record.id !== undefined && (typeof record.id !== "string" || record.id.length > 80 || !record.id.trim())) {
    return { ok: false, error: `sentences[${index}].id must be a short string.` };
  }
  if (!Array.isArray(record.words)) {
    return { ok: false, error: `sentences[${index}].words must be an array.` };
  }
  if (record.words.length > LIMITS.words) {
    return { ok: false, error: `sentences[${index}].words is too long.` };
  }
  const words: Word[] = [];
  for (let w = 0; w < record.words.length; w++) {
    const word = parseWord(record.words[w], index, w);
    if (!word.ok) return word;
    words.push(word.word);
  }
  return {
    ok: true,
    sentence: {
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : newId(),
      hanzi: record.hanzi.trim(),
      pinyin,
      words,
    },
  };
}

function parseWord(
  raw: unknown,
  sentenceIndex: number,
  wordIndex: number,
): { ok: true; word: Word } | { ok: false; error: string } {
  const record = asRecord(raw);
  const where = `sentences[${sentenceIndex}].words[${wordIndex}]`;
  if (!record) return { ok: false, error: `${where} must be an object.` };
  if (typeof record.hanzi !== "string" || !record.hanzi.trim()) {
    return { ok: false, error: `${where}.hanzi is required.` };
  }
  if (record.hanzi.length > LIMITS.word) {
    return { ok: false, error: `${where}.hanzi is too long.` };
  }
  if (record.pinyin !== undefined && typeof record.pinyin !== "string") {
    return { ok: false, error: `${where}.pinyin must be a string.` };
  }
  const pinyin = typeof record.pinyin === "string" ? record.pinyin : "";
  if (pinyin.length > LIMITS.pinyin) return { ok: false, error: `${where}.pinyin is too long.` };
  if (record.note !== undefined && typeof record.note !== "string") {
    return { ok: false, error: `${where}.note must be a string.` };
  }
  if (typeof record.note === "string" && record.note.length > LIMITS.note) {
    return { ok: false, error: `${where}.note is too long.` };
  }
  const word: Word = { hanzi: record.hanzi, pinyin };
  if (typeof record.note === "string" && record.note.trim()) word.note = record.note.trim();
  return { ok: true, word };
}

function parseNotes(
  raw: unknown,
): { ok: true; notes: Record<string, Note> } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, notes: {} };
  const record = asRecord(raw);
  if (!record) return { ok: false, error: "notes must be an object." };
  const entries = Object.entries(record);
  if (entries.length > LIMITS.notes) {
    return { ok: false, error: `notes is limited to ${LIMITS.notes} entries.` };
  }
  const notes: Record<string, Note> = {};
  for (const [key, value] of entries) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (!key.trim() || key.length > LIMITS.noteKey) {
      return { ok: false, error: "notes keys must be non-empty and at most 80 characters." };
    }
    const note = parseNote(value, key);
    if (!note.ok) return note;
    notes[key] = note.note;
  }
  return { ok: true, notes };
}

function parseNote(
  raw: unknown,
  key: string,
): { ok: true; note: Note } | { ok: false; error: string } {
  const record = asRecord(raw);
  if (!record) return { ok: false, error: `notes[${key}] must be an object.` };
  for (const field of ["pinyin", "gloss", "usage"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") {
      return { ok: false, error: `notes[${key}].${field} must be a string.` };
    }
    if (typeof record[field] === "string" && record[field].length > LIMITS.note) {
      return { ok: false, error: `notes[${key}].${field} is too long.` };
    }
  }
  if (
    record.source !== undefined &&
    (typeof record.source !== "string" || !(NOTE_SOURCES as readonly string[]).includes(record.source))
  ) {
    return { ok: false, error: `notes[${key}].source must be ai, user, or sample.` };
  }
  return {
    ok: true,
    note: {
      pinyin: typeof record.pinyin === "string" ? record.pinyin : "",
      gloss: typeof record.gloss === "string" ? record.gloss : "",
      usage: typeof record.usage === "string" ? record.usage : "",
      source: (record.source as NoteSource | undefined) ?? "user",
    },
  };
}

function coerceSentence(raw: unknown): Sentence | null {
  const record = asRecord(raw);
  if (!record || typeof record.hanzi !== "string" || !record.hanzi.trim()) return null;
  const words: Word[] = [];
  if (Array.isArray(record.words)) {
    for (const item of record.words.slice(0, LIMITS.words)) {
      const word = asRecord(item);
      if (!word || typeof word.hanzi !== "string" || !word.hanzi.trim()) continue;
      const next: Word = {
        hanzi: word.hanzi.slice(0, LIMITS.word),
        pinyin: typeof word.pinyin === "string" ? word.pinyin.slice(0, LIMITS.pinyin) : "",
      };
      if (typeof word.note === "string" && word.note.trim()) next.note = word.note.trim().slice(0, LIMITS.note);
      words.push(next);
    }
  }
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim().slice(0, 80) : newId(),
    hanzi: record.hanzi.trim().slice(0, LIMITS.sentence),
    pinyin: typeof record.pinyin === "string" ? record.pinyin.slice(0, LIMITS.pinyin) : "",
    words,
  };
}

function coerceNotes(raw: unknown): Record<string, Note> {
  const record = asRecord(raw);
  if (!record) return {};
  const notes: Record<string, Note> = {};
  for (const [key, value] of Object.entries(record).slice(0, LIMITS.notes)) {
    if (!key.trim() || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const note = asRecord(value);
    if (!note) continue;
    const source = NOTE_SOURCES.includes(note.source as NoteSource) ? (note.source as NoteSource) : "user";
    notes[key.slice(0, LIMITS.noteKey)] = {
      pinyin: typeof note.pinyin === "string" ? note.pinyin.slice(0, LIMITS.note) : "",
      gloss: typeof note.gloss === "string" ? note.gloss.slice(0, LIMITS.note) : "",
      usage: typeof note.usage === "string" ? note.usage.slice(0, LIMITS.note) : "",
      source,
    };
  }
  return notes;
}
