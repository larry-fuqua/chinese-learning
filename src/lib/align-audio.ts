import { isHan } from "./text";

export type CharSpan = { hanzi: string; start: number; end: number };

export type AlignmentReport = {
  checked: number;
  onTime: number;
  medianOffset: number;
  clustered: boolean;
  /** Seconds to add to every character time. Zero when the slices already line up. */
  offsetSec: number;
};

const ONSET_EARLY_SEC = 0.04;
const SHIFT_MIN_SEC = 0.05;
const CLUSTER_SEC = 0.03;

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

/** First broadband-energy onset near the labeled start. Null when the window is silent. */
export function energyOnset(
  frames: { t: number; rms: number }[],
  start: number,
  end: number,
): number | null {
  const from = start - 0.08;
  const to = Math.min(Math.max(end, start + 0.16), start + 0.22);
  let peak = 0;
  const window: { t: number; rms: number }[] = [];
  for (const frame of frames) {
    if (frame.t < from || frame.t > to) continue;
    window.push(frame);
    if (frame.rms > peak) peak = frame.rms;
  }
  if (peak < 1e-4 || !window.length) return null;
  const thresh = peak * 0.35;
  for (const frame of window) {
    if (frame.rms >= thresh) return frame.t;
  }
  return null;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function scoreOnsets(
  samples: Float32Array,
  sampleRate: number,
  slices: { start: number; end: number }[],
): AlignmentReport {
  const frames = frameRms(samples, sampleRate);
  const offsets: number[] = [];
  let onTime = 0;
  for (const slice of slices) {
    if (!(slice.end > slice.start)) continue;
    const onset = energyOnset(frames, slice.start, slice.end);
    if (onset == null) continue;
    offsets.push(onset - slice.start);
    if (onset >= slice.start - ONSET_EARLY_SEC && onset <= slice.end) onTime++;
  }
  const med = median(offsets);
  const clustered =
    offsets.length >= 2 &&
    offsets.filter((delta) => Math.abs(delta - med) <= CLUSTER_SEC).length / offsets.length >= 0.7;
  const offsetSec = clustered && Math.abs(med) >= SHIFT_MIN_SEC ? med : 0;
  return { checked: offsets.length, onTime, medianOffset: med, clustered, offsetSec };
}

export function alignCharTimes(opts: {
  text: string;
  graphChars: string[];
  charTimes: [number, number][];
  duration?: number;
  samples?: Float32Array;
  sampleRate?: number;
}): { charTimes: [number, number][]; unitConverted: boolean; report: AlignmentReport | null } {
  const normalized = normalizeTimestampUnit(opts.charTimes, opts.duration);
  let times = normalized.times;
  let report: AlignmentReport | null = null;
  if (opts.samples && opts.sampleRate && opts.samples.length > 0) {
    const slices = syllableTimesFromChars(opts.text, opts.graphChars, times).filter(
      (slice) => slice.end > slice.start,
    );
    report = scoreOnsets(opts.samples, opts.sampleRate, slices);
    if (report.offsetSec !== 0) {
      const shift = report.offsetSec;
      times = times.map(([start, end]) => {
        const a = Math.max(0, start + shift);
        return [a, Math.max(a, end + shift)] as [number, number];
      });
    }
  }
  return { charTimes: times, unitConverted: normalized.converted, report };
}

export type OffCase = {
  dictionaryTone: number;
  spokenTone: number;
  heardTone: number | null;
  /** Slice boundary failed the energy check, or the whole take needs one shift. */
  timingOff: boolean;
};

/**
 * Cases the dictionary-tone comparison would mark off.
 * A bad boundary counts as timing, including when sandhi also changed the tone.
 */
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
