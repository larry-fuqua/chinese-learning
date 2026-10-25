import type { Word } from "./types";
import { tonelessReading } from "./pinyin-readings";
import syllables from "./pinyin-syllables.json";

const SYLLABLE =
  /(?:[zcs]h|[bpmfdtnlgkhjqxzcsryw])?[aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+n?g?r?/gi;

const SYLLABLES = new Set<string>(syllables);
const TONE_BASE: Record<string, string> = {
  ā: "a", á: "a", ǎ: "a", à: "a",
  ē: "e", é: "e", ě: "e", è: "e",
  ī: "i", í: "i", ǐ: "i", ì: "i",
  ō: "o", ó: "o", ǒ: "o", ò: "o",
  ū: "u", ú: "u", ǔ: "u", ù: "u",
  ǖ: "v", ǘ: "v", ǚ: "v", ǜ: "v", ü: "v",
  ń: "n", ň: "n", ǹ: "n", ḿ: "m",
};
const HARD = new Set([" ", "'", "\u2019", "-", "·"]);
const MAX_PIECE = 7;
const isHanChar = (c: string) => c >= "\u3400" && c <= "\u9fff";
const baseChar = (c: string) => {
  const lower = c.toLowerCase();
  return TONE_BASE[lower] ?? lower;
};

export type SplitMode = "exact" | "mismatch" | "boundary" | "fallback" | "none" | "empty";

/**
 * Cut stored word pinyin into exactly one syllable per hanzi.
 * The table reading only breaks ties. Pieces are slices of the stored string.
 */
export function splitWordPinyin(
  hanzi: string,
  stored: string,
  readings: (ch: string) => string[] = (ch) => {
    const reading = tonelessReading(ch);
    return reading ? [reading] : [];
  },
): { pieces: string[]; mode: SplitMode } {
  const han = [...hanzi].filter(isHanChar);
  const count = han.length;
  if (!count) return { pieces: [], mode: "none" };
  const source = stored.trim().normalize("NFC");
  const chars: string[] = [];
  const hard = new Set<number>();
  for (const c of [...source]) {
    if (HARD.has(c)) {
      hard.add(chars.length);
      continue;
    }
    chars.push(c);
  }
  const base = chars.map(baseChar);
  const length = base.length;
  if (!length) return { pieces: han.map(() => ""), mode: "empty" };
  const allowed = han.map((ch) => new Set(readings(ch)));
  const memo = new Map<string, { cost: number; cuts: number[] } | null>();
  const best = (i: number, k: number): { cost: number; cuts: number[] } | null => {
    if (k === count) return i === length ? { cost: 0, cuts: [] } : null;
    if (i >= length) return null;
    const key = `${i}:${k}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    let out: { cost: number; cuts: number[] } | null = null;
    for (let j = i + 1; j <= Math.min(length, i + MAX_PIECE); j++) {
      let crosses = false;
      for (const boundary of hard) {
        if (boundary > i && boundary < j) crosses = true;
      }
      if (crosses) break;
      const piece = base.slice(i, j).join("");
      const erhua = han[k] === "儿" && piece === "r";
      const consonantOnly = !/[aeiouvê]/.test(piece);
      const ok = erhua || (SYLLABLES.has(piece) && (!consonantOnly || allowed[k].has(piece)));
      if (!ok) continue;
      const rest = best(j, k + 1);
      if (!rest) continue;
      const cost = (erhua || allowed[k].has(piece) ? 0 : 1) + rest.cost;
      if (!out || cost < out.cost) out = { cost, cuts: [j, ...rest.cuts] };
    }
    memo.set(key, out);
    return out;
  };
  const found = best(0, 0);
  if (!found) {
    const parts = source.split(/[\s'\u2019\-·]+/).filter(Boolean);
    if (parts.length === count) return { pieces: parts, mode: "boundary" };
    return { pieces: han.map((_, i) => (i === 0 ? source : "")), mode: "fallback" };
  }
  const cuts = [0, ...found.cuts];
  return {
    pieces: cuts.slice(0, count).map((cut, q) => chars.slice(cut, cuts[q + 1]).join("")),
    mode: found.cost === 0 ? "exact" : "mismatch",
  };
}

/** Greedy splitter kept for comparison. Display uses splitWordPinyin. */
export function splitPinyinSyllables(input: string): string[] {
  const s = input.trim().replace(/['’]/g, " ");
  if (!s) return [];
  if (/\s/.test(s)) return s.split(/\s+/).filter(Boolean);
  const found = s.match(SYLLABLE);
  return found ?? [s];
}

/** One stored syllable per character. Does not invent a dictionary reading. */
export function pinyinSyllablesForWord(hanzi: string, stored: string): string[] {
  return splitWordPinyin(hanzi, stored).pieces;
}

/** Ruby text: the fixed syllables, still taken from the stored word pinyin. */
export function displayPinyin(hanzi: string, stored: string): string {
  const pieces = pinyinSyllablesForWord(hanzi, stored).filter((piece) => piece.length > 0);
  return pieces.length ? pieces.join(" ") : stored.trim();
}

/** Fallback when the LLM is unavailable: tokens only, no fake pinyin. */
export function segmentWords(text: string): Word[] {
  const words: Word[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      words.push({ hanzi: buf, pinyin: "" });
      buf = "";
    }
  };
  for (const ch of text) {
    if (/[\u3400-\u9fff]/.test(ch)) buf += ch;
    else {
      flush();
      if (ch.trim() || ch === " ") words.push({ hanzi: ch, pinyin: "" });
    }
  }
  flush();
  return words.filter((w) => w.hanzi && !/^\s+$/.test(w.hanzi));
}
