import { tonelessReading } from "./pinyin-readings";
import { isHan } from "./text";

export type CharSpan = { hanzi: string; start: number; end: number };

/**
 * Fixed slice constants. Tuned once; nothing here is chosen per sentence.
 * Start is the aligner token start minus LEAD, with PAD_EDGE only beside a pause.
 * A join ends at the RMS minimum before the next token. A pause ends after
 * quiet has held for MIN_SIL, plus TAIL, plus PAD_EDGE.
 */
export const SLICE = {
  LEAD_SEC: 0.03,
  PAD_EDGE_SEC: 0.04,
  OFF_K: 0.15,
  MIN_SIL_SEC: 0.03,
  TAIL_SEC: 0.02,
};

export function normalizeTimestampUnit(
  charTimes: [number, number][],
  duration?: number,
): { times: [number, number][]; converted: boolean } {
  let maxEnd = 0;
  for (const span of charTimes) {
    if (span && span[1] > maxEnd) maxEnd = span[1];
  }
  const known = duration != null && duration > 0 && Number.isFinite(duration);
  const convert = known ? maxEnd > duration * 5 && maxEnd > 20 : maxEnd > 50;
  if (!convert) {
    return {
      times: charTimes.map((span) => [span?.[0] ?? 0, span?.[1] ?? 0]),
      converted: false,
    };
  }
  return {
    times: charTimes.map((span) => [(span?.[0] ?? 0) / 1000, (span?.[1] ?? 0) / 1000]),
    converted: true,
  };
}

/**
 * Map xAI graph_chars / graph_times onto the hanzi in `text`.
 * When graph_chars is the text itself, times stay on that character index.
 * A missing time becomes a zero-length span so later characters keep their own slots.
 */
export function syllableTimesFromChars(
  hanzi: string,
  graphChars: string[],
  charTimes: [number, number][],
): CharSpan[] {
  const chars = [...hanzi];
  const mirrored =
    graphChars.length === chars.length && graphChars.every((ch, i) => ch === chars[i]);
  if (mirrored) {
    const out: CharSpan[] = [];
    chars.forEach((ch, i) => {
      if (!isHan(ch)) return;
      out.push(spanOrEmpty(ch, charTimes[i]));
    });
    return out;
  }

  const out: CharSpan[] = [];
  let gi = 0;
  for (const ch of chars) {
    if (!isHan(ch)) continue;
    while (gi < graphChars.length && graphChars[gi] !== ch) gi++;
    if (gi < graphChars.length && graphChars[gi] === ch) {
      out.push(spanOrEmpty(ch, charTimes[gi]));
      gi++;
    } else {
      out.push({ hanzi: ch, start: 0, end: 0 });
    }
  }
  return out;
}

function spanOrEmpty(hanzi: string, span: [number, number] | undefined): CharSpan {
  if (span && Number.isFinite(span[0]) && Number.isFinite(span[1]) && span[1] > span[0]) {
    return { hanzi, start: span[0], end: span[1] };
  }
  return { hanzi, start: 0, end: 0 };
}

export function frameRms(
  samples: Float32Array,
  sampleRate: number,
): { t: number; rms: number }[] {
  const hop = Math.max(1, Math.round(sampleRate * 0.005));
  const win = Math.max(hop, Math.round(sampleRate * 0.02));
  const frames: { t: number; rms: number }[] = [];
  for (let i = 0; i + win <= samples.length; i += hop) {
    let sum = 0;
    const end = i + win;
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    frames.push({ t: i / sampleRate, rms: Math.sqrt(sum / win) });
  }
  return frames;
}

/** Seconds only. Does not move slices to chase an onset. */
export function alignCharTimes(opts: {
  text: string;
  graphChars: string[];
  charTimes: [number, number][];
  duration?: number;
  samples?: Float32Array;
  sampleRate?: number;
}): { charTimes: [number, number][]; unitConverted: boolean } {
  void opts.text;
  void opts.graphChars;
  void opts.samples;
  void opts.sampleRate;
  const normalized = normalizeTimestampUnit(opts.charTimes, opts.duration);
  return { charTimes: normalized.times, unitConverted: normalized.converted };
}

type IndexedChar = { ch: string; gi: number | null };
type MatchBlock = { a: number; b: number; size: number };

function isReadingChar(ch: string): boolean {
  if (!ch) return false;
  if (isHan(ch)) return true;
  return tonelessReading(ch) !== ch;
}

/**
 * Han characters in `text`, each pointing at a token in `graphChars`.
 * A mirrored timestamp list keeps the character index.
 * Otherwise tokens match in order by toneless reading, so 她 lines up with 他
 * and 2 lines up with 二 without borrowing a later character.
 */
export function graphIndex(text: string, graphChars: string[]): IndexedChar[] {
  const chars = [...text];
  const mirrored =
    graphChars.length === chars.length && graphChars.every((ch, i) => ch === chars[i]);
  if (mirrored) {
    const out: IndexedChar[] = [];
    chars.forEach((ch, i) => {
      if (isHan(ch)) out.push({ ch, gi: i });
    });
    return out;
  }

  const hans = chars.filter(isHan);
  const gpos: number[] = [];
  graphChars.forEach((ch, i) => {
    if (ch && isReadingChar(ch)) gpos.push(i);
  });
  const left = hans.map((ch) => tonelessReading(ch));
  const right = gpos.map((i) => tonelessReading(graphChars[i] ?? ""));
  const out: IndexedChar[] = hans.map((ch) => ({ ch, gi: null }));
  for (const block of matchingBlocks(left, right)) {
    for (let k = 0; k < block.size; k++) {
      const han = hans[block.a + k];
      const gi = gpos[block.b + k];
      if (han == null || gi == null) continue;
      out[block.a + k] = { ch: han, gi };
    }
  }
  return out;
}

function matchingBlocks(a: string[], b: string[]): MatchBlock[] {
  const b2j = new Map<string, number[]>();
  b.forEach((item, j) => {
    const list = b2j.get(item);
    if (list) list.push(j);
    else b2j.set(item, [j]);
  });
  const blocks: MatchBlock[] = [];
  const walk = (alo: number, ahi: number, blo: number, bhi: number) => {
    const match = longestMatch(a, b2j, alo, ahi, blo, bhi);
    if (match.size === 0) return;
    walk(alo, match.a, blo, match.b);
    blocks.push(match);
    walk(match.a + match.size, ahi, match.b + match.size, bhi);
  };
  walk(0, a.length, 0, b.length);
  return blocks;
}

function longestMatch(
  a: string[],
  b2j: Map<string, number[]>,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): MatchBlock {
  let bestA = alo;
  let bestB = blo;
  let bestSize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const next = new Map<number, number>();
    const js = b2j.get(a[i] ?? "") ?? [];
    for (const j of js) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      next.set(j, k);
      if (k > bestSize) {
        bestA = i - k + 1;
        bestB = j - k + 1;
        bestSize = k;
      }
    }
    j2len = next;
  }
  return { a: bestA, b: bestB, size: bestSize };
}

/**
 * Playback windows for each hanzi character.
 * `graphChars` / `charTimes` are xAI TTS timestamps, or STT words expanded to characters.
 * Token starts are kept (minus a fixed lead). Token ends are rebuilt from the waveform
 * because the aligner stops about 100 ms before the vowel finishes.
 */
export function sliceWindows(
  hanzi: string,
  graphChars: string[],
  charTimes: [number, number][],
  samples: Float32Array,
  sampleRate: number,
): CharSpan[] {
  const idx = graphIndex(hanzi, graphChars);
  const frames = frameRms(samples, sampleRate).map((frame) => ({
    t: frame.t + 0.01,
    rms: frame.rms,
  }));
  const sorted = frames.map((frame) => frame.rms).sort((a, b) => a - b);
  const peak = sorted[Math.floor(0.99 * (sorted.length - 1))] ?? 1;
  const dur = sampleRate > 0 ? samples.length / sampleRate : 0;
  type Span = { ch: string; a: number; e: number; kind: "join" | "pause" } | null;
  const spans: Span[] = idx.map(({ ch, gi }, k) => {
    const token = gi == null ? undefined : charTimes[gi];
    if (gi == null || !token || !(token[1] > token[0])) return null;
    const [a, b] = token;
    const nxt = gi + 1;
    if (nxt < graphChars.length && nxt < charTimes.length && isHan(graphChars[nxt] ?? "")) {
      const ns = charTimes[nxt]?.[0] ?? b;
      let e = ns;
      if (ns > b) {
        let best = Infinity;
        for (const frame of frames) {
          if (frame.t >= b && frame.t <= ns && frame.rms < best) {
            best = frame.rms;
            e = frame.t;
          }
        }
      }
      return { ch, a, e, kind: "join" };
    }
    let cap = dur;
    for (let later = k + 1; later < idx.length; later++) {
      const g2 = idx[later]?.gi;
      if (g2 != null && g2 < charTimes.length) {
        cap = charTimes[g2]?.[0] ?? cap;
        break;
      }
    }
    const need = Math.max(1, Math.round(SLICE.MIN_SIL_SEC / 0.005));
    let run = 0;
    let quiet: number | null = null;
    for (let j = 0; j < frames.length; j++) {
      const frame = frames[j];
      if (!frame || frame.t < b) continue;
      if (frame.t >= cap) break;
      run = frame.rms < SLICE.OFF_K * peak ? run + 1 : 0;
      if (run >= need) {
        quiet = (frames[j - need + 1]?.t ?? frame.t) + SLICE.TAIL_SEC;
        break;
      }
    }
    return { ch, a, e: Math.min(Math.max(quiet ?? cap, b), cap), kind: "pause" };
  });
  return spans.map((span, k) => {
    const ch = idx[k]?.ch ?? "";
    if (!span) return { hanzi: ch, start: 0, end: 0 };
    const prev = k > 0 ? spans[k - 1] : null;
    const prevPause = k === 0 || !prev || prev.kind === "pause";
    const start = Math.max(0, span.a - (prevPause ? SLICE.PAD_EDGE_SEC : 0) - SLICE.LEAD_SEC);
    const end = Math.min(dur, span.e + (span.kind === "pause" ? SLICE.PAD_EDGE_SEC : 0));
    return { hanzi: span.ch, start, end: end > start ? end : start };
  });
}

export function timedCharsFromWords(
  words: { text: string; start: number; end: number }[],
): { graphChars: string[]; charTimes: [number, number][] } {
  const graphChars: string[] = [];
  const charTimes: [number, number][] = [];
  for (const word of words) {
    const chars = [...word.text];
    if (!chars.length) continue;
    const span = Math.max(0, word.end - word.start);
    chars.forEach((ch, i) => {
      graphChars.push(ch);
      charTimes.push([
        word.start + (span * i) / chars.length,
        word.start + (span * (i + 1)) / chars.length,
      ]);
    });
  }
  return { graphChars, charTimes };
}

export type OffCase = {
  dictionaryTone: number;
  spokenTone: number;
  heardTone: number | null;
  timingOff: boolean;
};

/** Cases the dictionary-tone comparison would mark off. */
export function partitionOffCases(cases: OffCase[]): { off: number; timing: number; tone: number } {
  let off = 0;
  let timing = 0;
  let tone = 0;
  for (const item of cases) {
    if (item.heardTone === item.dictionaryTone) continue;
    off++;
    if (item.timingOff) timing++;
    else tone++;
  }
  return { off, timing, tone };
}
