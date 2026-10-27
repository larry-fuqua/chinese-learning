import type { Note, Sentence, Word } from "./types";
import { romanizeSyllable, segmentWords } from "./pinyin";

const HAN = /\p{Script=Han}/u;

export function isHan(ch: string): boolean {
  return HAN.test(ch);
}

export function onlyHanzi(text: string): string {
  return [...text].filter(isHan).join("");
}

export function looksLikePinyin(text: string): boolean {
  const han = onlyHanzi(text).length;
  const latin = (text.match(/[A-Za-züÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g) ?? []).length;
  return latin > 8 && latin > han * 2;
}

const PUNCT_ONLY = /^[\s"'“”‘’「」『』（）()[\]【】《》〈〉…—–,.，、；;:：!?！？。]*$/;

export function isPunctOnly(text: string): boolean {
  return PUNCT_ONLY.test(text.trim());
}

export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(/(?<=[。！？!?…\n])/u);
  const merged: string[] = [];
  for (const raw of parts) {
    const s = raw.replace(/\n/g, "").trim();
    if (!s) continue;
    if (merged.length && isPunctOnly(s)) {
      merged[merged.length - 1] += s;
      continue;
    }
    merged.push(s);
  }
  return merged;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildSentence(hanzi: string): Sentence {
  const words: Word[] = segmentWords(hanzi);
  return {
    id: newId(),
    hanzi,
    pinyin: words.map((w) => w.pinyin).filter(Boolean).join(" "),
    words,
  };
}

export function buildSentencesFromHanzi(hanzi: string): Sentence[] {
  return glueOrphanPunct(splitSentences(hanzi).map(buildSentence));
}

/** Blank lines separate paragraphs. A single newline stays inside a paragraph. */
export function splitParagraphBlocks(hanzi: string): string[] {
  const normalized = hanzi.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  return normalized
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * Group sentence ids by blank-line paragraphs in `hanzi`.
 * Returns undefined when the text is a single paragraph.
 * When the sentence split does not match the blocks, sentences are
 * divided across as many paragraphs as can each receive one sentence.
 */
export function paragraphGroupsForSentences(
  hanzi: string,
  sentences: { id: string }[],
): string[][] | undefined {
  const blocks = splitParagraphBlocks(hanzi);
  if (blocks.length <= 1 || sentences.length === 0) return undefined;
  const counts = blocks.map((block) => splitSentences(block).length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const sizes =
    total === sentences.length && counts.every((count) => count > 0)
      ? counts
      : proportionalParagraphSizes(blocks.length, sentences.length);
  const groups: string[][] = [];
  let offset = 0;
  for (const size of sizes) {
    const slice = sentences.slice(offset, offset + size);
    offset += size;
    if (slice.length) groups.push(slice.map((sentence) => sentence.id));
  }
  if (offset < sentences.length && groups.length) {
    groups[groups.length - 1].push(...sentences.slice(offset).map((sentence) => sentence.id));
  }
  if (groups.length <= 1) return undefined;
  return groups;
}

function proportionalParagraphSizes(blockCount: number, sentenceCount: number): number[] {
  const groups = Math.min(blockCount, sentenceCount);
  if (groups <= 1) return [sentenceCount];
  const base = Math.floor(sentenceCount / groups);
  let extra = sentenceCount % groups;
  const sizes: number[] = [];
  for (let i = 0; i < groups; i++) {
    sizes.push(base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra -= 1;
  }
  return sizes;
}

export type IndexedSentence<T> = { sentence: T; index: number };

/** One group when `paragraphs` is missing or a single paragraph. */
export function sentenceGroups<T extends { id: string }>(
  sentences: T[],
  paragraphs?: string[][],
): IndexedSentence<T>[][] {
  const single = [sentences.map((sentence, index) => ({ sentence, index }))];
  if (!paragraphs || paragraphs.length <= 1 || sentences.length === 0) return single;
  const indexById = new Map(sentences.map((sentence, index) => [sentence.id, index]));
  const used = new Set<string>();
  const groups: IndexedSentence<T>[][] = [];
  for (const ids of paragraphs) {
    const rows: IndexedSentence<T>[] = [];
    for (const id of ids) {
      const index = indexById.get(id);
      if (index === undefined || used.has(id)) continue;
      used.add(id);
      rows.push({ sentence: sentences[index]!, index });
    }
    if (rows.length) groups.push(rows);
  }
  const rest = sentences
    .map((sentence, index) => ({ sentence, index }))
    .filter((row) => !used.has(row.sentence.id));
  if (rest.length) groups.push(rest);
  if (groups.length <= 1) return single;
  return groups;
}

export function glueOrphanPunct(sentences: Sentence[]): Sentence[] {
  const out: Sentence[] = [];
  for (const s of sentences) {
    if (out.length && isPunctOnly(s.hanzi)) {
      const prev = out[out.length - 1];
      prev.hanzi += s.hanzi;
      prev.words = [...prev.words, ...s.words.filter((w) => w.hanzi.trim())];
      continue;
    }
    out.push({ ...s, words: [...s.words] });
  }
  return out;
}

export function toneFromPinyin(pinyin: string): number {
  const numbered = pinyin.match(/[1-5]/);
  if (numbered) return Number(numbered[0]);
  if (/[āēīōūǖ]/.test(pinyin)) return 1;
  if (/[áéíóúǘ]/.test(pinyin)) return 2;
  if (/[ǎěǐǒǔǚ]/.test(pinyin)) return 3;
  if (/[àèìòùǜ]/.test(pinyin)) return 4;
  return 5;
}

const TONE_MARKS: Record<string, string> = {
  a1: "ā", a2: "á", a3: "ǎ", a4: "à",
  e1: "ē", e2: "é", e3: "ě", e4: "è",
  i1: "ī", i2: "í", i3: "ǐ", i4: "ì",
  o1: "ō", o2: "ó", o3: "ǒ", o4: "ò",
  u1: "ū", u2: "ú", u3: "ǔ", u4: "ù",
  v1: "ǖ", v2: "ǘ", v3: "ǚ", v4: "ǜ",
};

/**
 * Pinyin with the tone mark for the tone already chosen for this use.
 * Tone 5 is unmarked. a or e takes the mark, otherwise o in ou, otherwise the last vowel.
 */
export function spokenReading(pinyin: string, tone: number): string {
  const parts = pinyin.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts.map((part) => markSyllable(part, tone)).join(" ");
}

function markSyllable(pinyin: string, tone: number): string {
  const base = romanizeSyllable(pinyin);
  if (!base || tone < 1 || tone > 4) return base;
  const chars = [...base];
  const vowelAt: number[] = [];
  chars.forEach((ch, index) => {
    if ("aeiouv".includes(ch)) vowelAt.push(index);
  });
  if (!vowelAt.length) return base;
  const vowels = vowelAt.map((index) => chars[index]).join("");
  let markAt = vowelAt[vowelAt.length - 1]!;
  if (vowels.includes("a")) markAt = vowelAt[vowels.indexOf("a")]!;
  else if (vowels.includes("e")) markAt = vowelAt[vowels.indexOf("e")]!;
  else if (vowels.includes("ou")) markAt = vowelAt[vowels.indexOf("ou")]!;
  const vowel = chars[markAt];
  if (!vowel) return base;
  chars[markAt] = TONE_MARKS[`${vowel}${tone}`] ?? vowel;
  return chars.join("");
}

export function toneName(tone: number): string {
  switch (tone) {
    case 1:
      return "1st · flat";
    case 2:
      return "2nd · rising";
    case 3:
      return "3rd · dip";
    case 4:
      return "4th · falling";
    default:
      return "neutral";
  }
}

export type CharMatch = "ok" | "miss" | "sub" | "extra";

export function compareHanzi(
  expected: string,
  heard: string,
): { expectedChars: string[]; heardChars: string[]; matches: CharMatch[] } {
  const expectedChars = [...onlyHanzi(expected)];
  const heardChars = [...onlyHanzi(heard)];
  const n = expectedChars.length;
  const m = heardChars.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0),
  );
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n && j === m) {
        dp[i][j] = 0;
        continue;
      }
      const options: number[] = [];
      if (i < n && j < m) {
        options.push(
          (expectedChars[i] === heardChars[j] ? 0 : 1) + dp[i + 1][j + 1],
        );
      }
      if (i < n) options.push(1 + dp[i + 1][j]);
      if (j < m) options.push(1 + dp[i][j + 1]);
      dp[i][j] = Math.min(...options);
    }
  }

  const matches: CharMatch[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && expectedChars[i] === heardChars[j]) {
      matches.push("ok");
      i++;
      j++;
      continue;
    }
    const sub =
      i < n && j < m ? 1 + dp[i + 1][j + 1] : Number.POSITIVE_INFINITY;
    const del = i < n ? 1 + dp[i + 1][j] : Number.POSITIVE_INFINITY;
    const ins = j < m ? 1 + dp[i][j + 1] : Number.POSITIVE_INFINITY;
    const best = Math.min(sub, del, ins);
    if (best === sub) {
      matches.push("sub");
      i++;
      j++;
    } else if (best === del) {
      matches.push("miss");
      i++;
    } else {
      matches.push("extra");
      j++;
    }
  }
  return { expectedChars, heardChars, matches };
}

export function fallbackPinyinWord(hanzi: string): Word {
  return { hanzi, pinyin: "" };
}

export function normalizeWord(raw: {
  hanzi?: string;
  pinyin?: string;
  note?: string;
}): Word | null {
  if (!raw?.hanzi) return null;
  const { pinyin, note } = parseWordHint(String(raw.pinyin ?? ""), raw.note);
  const word: Word = { hanzi: String(raw.hanzi), pinyin };
  if (note) word.note = note;
  return word;
}

export function parseWordHint(pinyin: string, note?: string): { pinyin: string; note: string } {
  const explicit = note?.trim() ?? "";
  const m = pinyin.match(/^(.*?)\s*\{([^}]*)\}\s*$/);
  if (m) {
    return { pinyin: m[1].trim(), note: explicit || m[2].trim() };
  }
  return { pinyin: pinyin.trim(), note: explicit };
}

export function notesFromWordHints(
  sentences: Sentence[],
  existing: Record<string, Note> = {},
): Record<string, Note> {
  const out: Record<string, Note> = { ...existing };
  for (const s of sentences) {
    for (const w of s.words) {
      const hint = w.note?.trim();
      if (!hint || !w.hanzi.trim() || isPunctOnly(w.hanzi)) continue;
      if (out[w.hanzi]?.source === "user") continue;
      const gloss = hint.split(/[.;：:]/)[0]?.trim() || hint;
      out[w.hanzi] = {
        pinyin: w.pinyin,
        gloss,
        usage: hint,
        source: "ai",
      };
    }
  }
  return out;
}
