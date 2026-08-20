import { OutputFormat, pinyin, segment } from "pinyin-pro";
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

export function pinyinSyllablesForWord(hanzi: string, stored: string): string[] {
  const han = [...hanzi].filter((ch) => /[\u3400-\u9fff]/.test(ch));
  if (!han.length) return [];
  const fromStored = splitPinyinSyllables(stored);
  if (fromStored.length === han.length) return fromStored;
  try {
    const fromLib = pinyin(hanzi, { type: "array", toneType: "symbol" });
    if (Array.isArray(fromLib) && fromLib.length === han.length) return fromLib;
    return han.map((ch, i) => fromStored[i] ?? fromLib[i] ?? pinyinFor(ch));
  } catch {
    return han.map((ch, i) => fromStored[i] ?? pinyinFor(ch));
  }
}

export function pinyinFor(hanzi: string): string {
  if (!hanzi.trim()) return "";
  try {
    return pinyin(hanzi, {
      toneType: "symbol",
      type: "array",
      nonZh: "consecutive",
    }).join(" ");
  } catch {
    return "";
  }
}

export function segmentWords(text: string): Word[] {
  try {
    const parts = segment(text, {
      format: OutputFormat.AllSegment,
      toneType: "symbol",
    });
    const words = parts
      .map((part) => ({
        hanzi: part.origin,
        pinyin: /[\u3400-\u9fff]/.test(part.origin) ? part.result : "",
      }))
      .filter((w) => w.hanzi && !/^\s+$/.test(w.hanzi));
    if (words.length) return words;
  } catch {
    // fall through
  }
  return [...text].map((ch) => ({
    hanzi: ch,
    pinyin: /[\u3400-\u9fff]/.test(ch) ? pinyinFor(ch) : "",
  }));
}
