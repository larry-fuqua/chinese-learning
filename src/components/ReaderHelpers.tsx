"use client";
import type {
  Note,
  PinyinMode,
  PitchPoint,
  Sentence,
  Story,
  ToneGraph,
  TtsCache,
  Word,
} from "@/lib/types";
import type { CharSpan } from "@/lib/align-audio";
import { applyOwnership, normalizeTimestampUnit, sliceWindows } from "@/lib/align-audio";
import { displayPinyin } from "@/lib/pinyin";
import { isHan } from "@/lib/text";
import { decodeToMono } from "@/lib/wav";
import { buildSyllablePitches, extractPitch } from "@/lib/pitch";
export function SentenceLine({
  sentence,
  active,
  pinyinMode,
  selectedWord,
  spokenChar,
  matchByExpected,
  notes,
  onWord,
}: {
  sentence: Sentence;
  active: boolean;
  pinyinMode: PinyinMode;
  selectedWord: string | null;
  spokenChar: number | null;
  matchByExpected?: Map<number, "ok" | "miss" | "sub">;
  notes: Story["notes"];
  onWord: (word: Word) => void;
}) {
  let hanOffset = 0;
  return (
    <p className="hanzi text-[1.7rem] leading-[2.4] sm:text-[2rem] sm:leading-[2.5]">
      {sentence.words.map((word, wi) => {
        const showRuby =
          pinyinMode === "all" ||
          (pinyinMode === "line" && active) ||
          (pinyinMode === "word" && active && selectedWord === word.hanzi);
        const chars = [...word.hanzi];
        const start = hanOffset;
        const hanCount = chars.filter(isHan).length;
        hanOffset += hanCount;
        const hint = word.note || notes[word.hanzi]?.usage || notes[word.hanzi]?.gloss;
        const ruby = displayPinyin(word.hanzi, word.pinyin);
        return (
          <span
            key={`${sentence.id}-${wi}`}
            role="button"
            tabIndex={-1}
            className={`ruby-word word-btn ${
              selectedWord === word.hanzi && active ? "active" : ""
            } ${hint ? "has-note" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onWord(word);
            }}
          >
            {showRuby && ruby ? <rt>{ruby}</rt> : <rt>&nbsp;</rt>}
            <span>
              {chars.map((ch, ci) => {
                const hanBefore =
                  start + chars.slice(0, ci).filter(isHan).length;
                const spoken = spokenChar === hanBefore && isHan(ch);
                const match = isHan(ch) ? matchByExpected?.get(hanBefore) : undefined;
                return (
                  <span
                    key={ci}
                    className={`${spoken ? "spoken" : ""} ${
                      match === "ok"
                        ? "match-ok"
                        : match === "miss" || match === "sub"
                          ? "match-bad"
                          : ""
                    }`}
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          </span>
        );
      })}
    </p>
  );
}
export function emptyNote(word: Word): Note {
  return { pinyin: word.pinyin, gloss: "", usage: "", source: "user" };
}
export function mergeSentences(current: Sentence[], incoming: Sentence[]): Sentence[] {
  if (!incoming.length) return current;
  return current.map((s, i) => {
    const next = incoming[i];
    if (!next) return s;
    return {
      ...s,
      pinyin: next.pinyin || s.pinyin,
      words: next.words?.length ? next.words : s.words,
    };
  });
}
export function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
export function hanCharOffsets(hanzi: string): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  const counts = new Map<string, number>();
  for (const ch of hanzi) {
    if (!isHan(ch)) continue;
    const seen = counts.get(ch) ?? 0;
    map.set(`${ch}:${seen}`, n);
    counts.set(ch, seen + 1);
    n++;
  }
  return map;
}
export function countBefore(chars: string[], index: number, ch: string): number {
  let n = 0;
  for (let i = 0; i < index; i++) if (chars[i] === ch) n++;
  return n;
}
export function ttsKey(storyId: string, sentenceId: string, speed: number) {
  return `${storyId}:${sentenceId}:${speed.toFixed(2)}`;
}
export async function decodeReference(
  sentence: Sentence,
  tts: TtsCache,
  storyId: string,
  speed: number,
  cache: Map<string, PitchPoint[]>,
): Promise<{ refPitch: PitchPoint[]; duration: number; windows: CharSpan[] }> {
  const key = ttsKey(storyId, sentence.id, speed);
  const decoded = await decodeToMono(tts.audio);
  let refPitch = cache.get(key);
  if (!refPitch) {
    refPitch = extractPitch(decoded.samples, decoded.sampleRate);
    cache.set(key, refPitch);
  }
  const duration = tts.duration || decoded.samples.length / decoded.sampleRate;
  const normalized = normalizeTimestampUnit(tts.charTimes, duration);
  tts.charTimes = normalized.times;
  const windows = applyOwnership(
    sliceWindows(
      sentence.hanzi,
      tts.graphChars,
      tts.charTimes,
      decoded.samples,
      decoded.sampleRate,
    ),
    decoded.samples,
    decoded.sampleRate,
  );
  return { refPitch, duration, windows };
}

export async function loadReferenceGraph(
  sentence: Sentence,
  tts: TtsCache,
  storyId: string,
  speed: number,
  cache: Map<string, PitchPoint[]>,
): Promise<ToneGraph> {
  const { refPitch, duration, windows } = await decodeReference(sentence, tts, storyId, speed, cache);
  return {
    syllables: buildSyllablePitches({
      words: sentence.words,
      refTimes: windows,
      userTimes: [],
      refPitch,
      userPitch: [],
    }),
    refPitch,
    userPitch: [],
    duration: duration || lastPitchTime(refPitch),
    heard: "",
  };
}
function lastPitchTime(points: PitchPoint[]): number {
  return points.length ? points[points.length - 1].t : 0.2;
}
