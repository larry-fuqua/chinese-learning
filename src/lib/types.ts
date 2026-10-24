export type StoryLevel = "HSK1" | "HSK2" | "HSK3" | "other";

export type PinyinMode = "off" | "word" | "line" | "all";

export type NoteSource = "ai" | "user" | "sample";

export type Word = {
  hanzi: string;
  pinyin: string;
  /** Optional English usage hint from the LLM. */
  note?: string;
};

export type Sentence = {
  id: string;
  hanzi: string;
  pinyin: string;
  words: Word[];
};

export type Note = {
  pinyin: string;
  gloss: string;
  usage: string;
  source: NoteSource;
};

export type Story = {
  id: string;
  title: string;
  level: StoryLevel;
  bundled?: boolean;
  hanzi: string;
  sentences: Sentence[];
  notes: Record<string, Note>;
  createdAt: string;
  updatedAt: string;
  /** Set together with chapterNumber when this story is a chapter. */
  bookId?: string;
  chapterNumber?: number;
  chapterTitle?: string;
  /**
   * Sentence ids grouped into paragraphs. Omitted for a single paragraph,
   * including stories saved before paragraphs existed.
   */
  paragraphs?: string[][];
};

export type Book = {
  id: string;
  title: string;
  level: StoryLevel;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type ChapterSummary = {
  id: string;
  title: string;
  chapterNumber: number;
  chapterTitle?: string;
  level: StoryLevel;
  createdAt: string;
  updatedAt: string;
};

export type BookWithChapters = Book & {
  chapters: ChapterSummary[];
};

export type TtsCache = {
  audio: ArrayBuffer;
  duration: number;
  charTimes: [number, number][];
  graphChars: string[];
  speed: number;
};

export type PitchPoint = {
  t: number;
  hz: number | null;
};

export type SyllablePitch = {
  hanzi: string;
  pinyin: string;
  /** Tone the graph compares and draws. Spoken tone after sandhi and neutral tone. */
  expectedTone: number;
  dictionaryTone: number;
  spokenTone: number;
  /** Why spoken tone differs from the dictionary tone. Empty when they match. */
  toneNote: string;
  heardTone: number | null;
  start: number;
  end: number;
  userStart: number | null;
  userEnd: number | null;
  refSemitones: (number | null)[];
  userSemitones: (number | null)[];
};

export type ReciteResult = {
  heard: string;
  words: { text: string; start: number; end: number }[];
  expected: string;
  matches: ("ok" | "miss" | "sub" | "extra")[];
  expectedChars: string[];
  heardChars: string[];
  syllables: SyllablePitch[];
  userDuration: number;
};

export type ToneGraph = {
  syllables: SyllablePitch[];
  refPitch: PitchPoint[];
  userPitch: PitchPoint[];
  duration: number;
  heard: string;
};

export type PrepareRequest = {
  title?: string;
  level?: StoryLevel;
  hanzi?: string;
  pinyin?: string;
};

export type PrepareResponse = {
  title: string;
  level: StoryLevel;
  hanzi: string;
  sentences: Sentence[];
  notes: Record<string, Note>;
  paragraphs?: string[][];
};
