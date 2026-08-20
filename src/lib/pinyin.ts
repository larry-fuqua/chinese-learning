import type { Word } from "./types";

const SYLLABLE =
  /(?:[zcs]h|[bpmfdtnlgkhjqxzcsryw])?[aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+n?g?r?/gi;

export function splitPinyinSyllables(input: string): string[] {
  const s = input.trim().replace(/['’]/g, " ");
  if (!s) return [];
  if (/\s/.test(s)) return s.split(/\s+/).filter(Boolean);
  const found = s.match(SYLLABLE);
  return found ?? [s];
}

/** Use stored word pinyin only. Never invent per-character dictionary readings. */
export function pinyinSyllablesForWord(hanzi: string, stored: string): string[] {
  const han = [...hanzi].filter((ch) => /[\u3400-\u9fff]/.test(ch));
  if (!han.length) return [];
  const fromStored = splitPinyinSyllables(stored);
  if (fromStored.length === han.length) return fromStored;
  if (fromStored.length === 1 && han.length > 1) {
    return han.map((_, i) => (i === 0 ? fromStored[0] : ""));
  }
  return han.map((_, i) => fromStored[i] ?? "");
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
