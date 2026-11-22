import type { PitchPoint, SyllablePitch, ToneGraph, Word } from "./types";
import {
  applyOwnership,
  sliceWindows,
  syllableTimesFromChars,
  timedCharsFromWords2,
  windowsFromAlignment,
  type AlignSpan,
} from "./align-audio";
import { tonelessReading } from "./pinyin-readings";
import { pinyinSyllablesForWord } from "./pinyin";
import { spokenTones } from "./sandhi";
import { gradeContour } from "./tone-model";
import { isHan } from "./text";

export { syllableTimesFromChars } from "./align-audio";

const HOP_SEC = 0.01;
const WIN_SEC = 0.04;
const MIN_HZ = 70;
const MAX_HZ = 400;
const YIN_THRESHOLD = 0.15;
/** An octave reference survives a dropout no longer than this. A longer gap starts fresh. */
const BRIDGE_SEC = 0.06;
const EDGE_ENERGY = 0.3;
const PITCH_GAP_SEC = 0.05;
const PITCH_MIN_RUN_SEC = 0.02;
/** A frame-to-frame jump past this ratio starts a new voiced run. */
const JUMP_RATIO = 1.25;

export function extractPitch(
  samples: Float32Array,
  sampleRate: number,
): PitchPoint[] {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SEC));
  const win = Math.max(hop * 2, Math.round(sampleRate * WIN_SEC));
  const energies: number[] = [];
  const raw: PitchPoint[] = [];
  for (let start = 0; start + win < samples.length; start += hop) {
    const frame = samples.subarray(start, start + win);
    const energy = rms(frame);
    energies.push(energy);
    raw.push({ t: start / sampleRate, hz: yinPitch(frame, sampleRate), e: energy });
  }
  const peak = percentile(energies, 0.9) || 1;
  const gate = peak * 0.12;
  const gated = raw.map((p, i) =>
    energies[i] < gate ? { ...p, hz: null } : p,
  );
  return octaveFix(medianFilter(gated, 4));
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[i];
}

/**
 * Halve or double a frame that jumped an octave from the last good frame.
 * A dropout of at most BRIDGE_SEC keeps that reference. A longer gap clears it.
 * A frame that is still far from the reference is dropped and does not move it.
 */
export function octaveFix(points: PitchPoint[]): PitchPoint[] {
  let last: number | null = null;
  let lastT = -1;
  return points.map((p) => {
    if (p.hz == null) {
      if (last != null && p.t - lastT > BRIDGE_SEC) last = null;
      return p;
    }
    let hz = p.hz;
    if (last != null) {
      const ratio = hz / last;
      if (ratio > 1.85) hz = hz / 2;
      else if (ratio < 0.54) hz = hz * 2;
      if (hz / last > 1.7 || hz / last < 0.6) return { ...p, hz: null };
    }
    last = hz;
    lastT = p.t;
    return { ...p, hz };
  });
}

function yinPitch(frame: Float32Array, sampleRate: number): number | null {
  const n = frame.length;
  const maxTau = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < n - tau; i++) {
      const diff = frame[i] - frame[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = d[tau] * tau / (running || 1);
  }
  let tauEstimate = -1;
  for (let tau = minTau; tau < maxTau; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0) {
    let best = minTau;
    for (let tau = minTau + 1; tau < maxTau; tau++) {
      if (cmnd[tau] < cmnd[best]) best = tau;
    }
    if (cmnd[best] > 0.45) return null;
    tauEstimate = best;
  }
  const better = parabolic(cmnd, tauEstimate);
  const hz = sampleRate / better;
  if (hz < MIN_HZ || hz > MAX_HZ) return null;
  return hz;
}

function parabolic(cmnd: Float32Array, tau: number): number {
  if (tau <= 0 || tau >= cmnd.length - 1) return tau;
  const s0 = cmnd[tau - 1];
  const s1 = cmnd[tau];
  const s2 = cmnd[tau + 1];
  const denom = 2 * s1 - s2 - s0;
  if (denom === 0) return tau;
  return tau + (s2 - s0) / (2 * denom);
}

function medianFilter(points: PitchPoint[], radius: number): PitchPoint[] {
  return points.map((p, i) => {
    if (p.hz == null) return p;
    const window: number[] = [];
    for (let j = i - radius; j <= i + radius; j++) {
      const hz = points[j]?.hz;
      if (hz != null) window.push(hz);
    }
    if (!window.length) return p;
    window.sort((a, b) => a - b);
    return { ...p, hz: window[Math.floor(window.length / 2)] };
  });
}

export function toSemitones(points: PitchPoint[]): (number | null)[] {
  const voiced = points.map((p) => p.hz).filter((hz): hz is number => hz != null);
  if (!voiced.length) return points.map(() => null);
  const mid = [...voiced].sort((a, b) => a - b)[Math.floor(voiced.length / 2)];
  return points.map((p) =>
    p.hz == null ? null : 12 * Math.log2(p.hz / mid),
  );
}

export function voicedSpan(
  points: PitchPoint[],
  start: number,
  end: number,
): { start: number; end: number } | null {
  const voiced = points.filter(
    (p) => p.hz != null && p.t >= start && p.t <= end,
  );
  if (voiced.length < 3) return null;
  return { start: voiced[0].t, end: voiced[voiced.length - 1].t };
}

type RunPoint = { t: number; hz: number; e: number };

/**
 * Median Hz and semitone range of voiced frames inside the windows.
 * Fewer than five voiced frames falls back to 150 Hz and 8 semitones.
 */
export function speakerStats(
  points: PitchPoint[],
  windows?: { start: number; end: number }[],
): { hz: number; rangeSt: number } {
  const hz: number[] = [];
  for (const point of points) {
    if (point.hz == null) continue;
    if (
      windows &&
      !windows.some((window) => window.end > window.start && point.t >= window.start && point.t <= window.end)
    ) {
      continue;
    }
    hz.push(point.hz);
  }
  if (hz.length < 5) return { hz: 150, rangeSt: 8 };
  hz.sort((a, b) => a - b);
  const at = (q: number) => hz[Math.min(hz.length - 1, Math.floor(q * (hz.length - 1)))];
  const mid = at(0.5);
  const lo = at(0.05);
  const hi = at(0.95);
  const rangeSt = lo > 0 && hi > lo ? 12 * Math.log2(hi / lo) : 8;
  return { hz: mid, rangeSt };
}

/**
 * Sixteen bins across the whole character, in semitones against `refHz`
 * (or the kept run's own median when `refHz` is omitted).
 * The longest voiced run is kept. A large pitch jump splits a run.
 * Bins outside that run stay empty. Holes inside it are filled.
 */
export function sliceContour(
  points: PitchPoint[],
  start: number,
  end: number,
  bins = 16,
  refHz?: number,
): (number | null)[] {
  const empty = Array<number | null>(bins).fill(null);
  if (!(end > start) || bins < 1) return empty;
  const span = end - start;
  const innerStart = span >= 0.08 ? start + span * 0.18 : start;
  const innerEnd = span >= 0.08 ? Math.max(innerStart, end - span * 0.06) : end;
  const runs: RunPoint[][] = [];
  let cur: RunPoint[] = [];
  let lastT = -1;
  for (const point of points) {
    if (point.t < innerStart || point.t > innerEnd || point.hz == null || !(point.hz > 0)) continue;
    const sample = { t: point.t, hz: point.hz, e: point.e ?? 1 };
    const prevHz = cur.length ? cur[cur.length - 1].hz : sample.hz;
    const jump =
      cur.length > 0 && Math.max(sample.hz / prevHz, prevHz / sample.hz) > JUMP_RATIO;
    if (cur.length && point.t - lastT <= PITCH_GAP_SEC && !jump) cur.push(sample);
    else {
      if (cur.length) runs.push(cur);
      cur = [sample];
    }
    lastT = point.t;
  }
  if (cur.length) runs.push(cur);
  let run: RunPoint[] | null = null;
  for (const candidate of runs) {
    const dur = candidate[candidate.length - 1].t - candidate[0].t;
    if (dur < PITCH_MIN_RUN_SEC) continue;
    if (!run || dur > run[run.length - 1].t - run[0].t) run = candidate;
  }
  if (!run) return empty;
  const peak = Math.max(...run.map((point) => point.e));
  let i0 = 0;
  let i1 = run.length - 1;
  while (i0 < i1 && run[i0].e < EDGE_ENERGY * peak) i0++;
  while (i1 > i0 && run[i1].e < EDGE_ENERGY * peak) i1--;
  run = run.slice(i0, i1 + 1);
  if (run.length < 3) return empty;
  const voiced = run.map((point) => point.hz).sort((a, b) => a - b);
  const mid = refHz && refHz > 0 ? refHz : voiced[Math.floor(voiced.length / 2)];
  const out: (number | null)[] = [];
  for (let i = 0; i < bins; i++) {
    const a = start + (span * i) / bins;
    const b = start + (span * (i + 1)) / bins;
    const vals: number[] = [];
    for (const point of run) {
      const inside = point.t >= a && (point.t < b || (i === bins - 1 && point.t <= b));
      if (inside) vals.push(12 * Math.log2(point.hz / mid));
    }
    out.push(vals.length ? mean(vals) : null);
  }
  for (let i = 0; i < bins; i++) {
    if (out[i] != null) continue;
    let left = i - 1;
    while (left >= 0 && out[left] == null) left--;
    let right = i + 1;
    while (right < bins && out[right] == null) right++;
    if (left >= 0 && right < bins) {
      const lv = out[left] as number;
      const rv = out[right] as number;
      out[i] = lv + ((rv - lv) * (i - left)) / (right - left);
    }
  }
  return out;
}

export type StrokeContext = {
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  stroke: () => void;
};

/** Start a new sub-path after every null so the line does not bridge a gap. */
export function strokeWithGaps(
  ctx: StrokeContext,
  values: (number | null)[],
  x: (index: number) => number,
  y: (value: number) => number,
) {
  ctx.beginPath();
  let pen = false;
  values.forEach((value, index) => {
    if (value == null) {
      pen = false;
      return;
    }
    if (!pen) {
      ctx.moveTo(x(index), y(value));
      pen = true;
    } else {
      ctx.lineTo(x(index), y(value));
    }
  });
  ctx.stroke();
}

export function classifyTone(contour: (number | null)[]): number | null {
  const vals = contour.filter((v): v is number => v != null);
  if (vals.length < 4) return null;
  const n = vals.length;
  const first = mean(vals.slice(0, Math.max(2, Math.floor(n / 3))));
  const mid = mean(vals.slice(Math.floor(n / 3), Math.ceil((2 * n) / 3)));
  const last = mean(vals.slice(Math.floor((2 * n) / 3)));
  const range = Math.max(...vals) - Math.min(...vals);
  const rise = last - first;
  const dip = Math.min(first, last) - mid;
  if (range < 1.2 && Math.abs(rise) < 1) return 1;
  if (dip > 1.4 && mid < first - 0.8 && mid < last - 0.8) return 3;
  if (rise > 1.4) return 2;
  if (rise < -1.4) return 4;
  if (range < 2) return 5;
  return rise >= 0 ? 2 : 4;
}

function mean(vals: number[]): number {
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export function canonicalTone(tone: number): number[] {
  const n = 16;
  return Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1);
    switch (tone) {
      case 1:
        return 1.2;
      case 2:
        return -2 + x * 4.5;
      case 3:
        return 1.2 - 5.2 * Math.sin(Math.PI * Math.min(1, x * 1.05)) ** 1.15 + x * 0.4;
      case 4:
        return 2.4 - x * 5.2;
      default:
        return -0.4;
    }
  });
}

export function voicedRuns(
  points: PitchPoint[],
  minGap = 0.11,
): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let run: { start: number; end: number } | null = null;
  let lastVoiced = -1;
  for (const p of points) {
    if (p.hz == null) continue;
    if (!run || lastVoiced < 0 || p.t - lastVoiced > minGap) {
      if (run) runs.push(run);
      run = { start: p.t, end: p.t };
    } else {
      run.end = p.t;
    }
    lastVoiced = p.t;
  }
  if (run) runs.push(run);
  return runs.filter((r) => r.end - r.start >= 0.035);
}

function resizeRuns(
  runs: { start: number; end: number }[],
  n: number,
): { start: number; end: number }[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length > n && out.length > 1) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < out.length - 1; i++) {
      const gap = out[i + 1].start - out[i].end;
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    out[best] = { start: out[best].start, end: out[best + 1].end };
    out.splice(best + 1, 1);
  }
  while (out.length < n && out.length > 0) {
    let longest = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i].end - out[i].start > out[longest].end - out[longest].start) {
        longest = i;
      }
    }
    const r = out[longest];
    const mid = (r.start + r.end) / 2;
    out.splice(longest, 1, { start: r.start, end: mid }, { start: mid, end: r.end });
  }
  return out;
}

function assignPieces(
  expectedChars: string[],
  pieces: { hanzi: string; start: number; end: number }[],
): ({ hanzi: string; start: number; end: number } | null)[] {
  let cursor = 0;
  return expectedChars.map((hanzi) => {
    const want = tonelessReading(hanzi);
    for (let i = cursor; i < pieces.length; i++) {
      const piece = pieces[i];
      if (!piece) continue;
      if (tonelessReading(piece.hanzi) !== want) continue;
      cursor = i + 1;
      return { hanzi, start: piece.start, end: piece.end };
    }
    return null;
  });
}

export function alignUserSyllableTimes(opts: {
  expectedChars: string[];
  /** Sentence text, punctuation included, so pauses stay attached to the right character. */
  expectedText?: string;
  heardChars: string[];
  sttWords: { text: string; start: number; end: number }[];
  userPitch: PitchPoint[];
  userDuration: number;
  ttsDuration: number;
  samples?: Float32Array;
  sampleRate?: number;
  /** Plain forced-alignment spans. When present, transcript times are not used. */
  faSpans?: AlignSpan[] | null;
}): ({ hanzi: string; start: number; end: number } | null)[] {
  const expected = opts.expectedChars;
  if (!expected.length) return [];

  const expectedText = opts.expectedText ?? expected.join("");
  if (opts.faSpans && opts.faSpans.length && opts.samples && opts.sampleRate) {
    const windows = windowsFromAlignment(
      expectedText,
      opts.faSpans,
      opts.samples,
      opts.sampleRate,
    );
    return expected.map((hanzi, i) => {
      const window = windows[i];
      if (!window || !(window.end > window.start)) return null;
      return { hanzi, start: window.start, end: window.end };
    });
  }
  const timed = timedCharsFromWords2(opts.sttWords, expectedText, tonelessReading);
  if (timed.graphChars.length) {
    if (opts.samples && opts.sampleRate && opts.samples.length > 0) {
      const windows = applyOwnership(
        sliceWindows(
          expectedText,
          timed.graphChars,
          timed.charTimes,
          opts.samples,
          opts.sampleRate,
        ),
        opts.samples,
        opts.sampleRate,
      );
      return expected.map((hanzi, i) => {
        const window = windows[i];
        if (!window || !(window.end > window.start)) return null;
        return { hanzi, start: window.start, end: window.end };
      });
    }
    const pieces = timed.graphChars.flatMap((hanzi, i) => {
      if (!isHan(hanzi) && tonelessReading(hanzi) === hanzi) return [];
      const span = timed.charTimes[i];
      if (!span || !(span[1] > span[0])) return [];
      return [{ hanzi, start: span[0], end: span[1] }];
    });
    if (pieces.length) return assignPieces(expected, pieces);
  }

  const runs = voicedRuns(opts.userPitch);
  if (!runs.length) return expected.map(() => null);

  const expectedN = expected.length;
  const heardN = opts.heardChars.length;
  const runN = runs.length;
  const tts = opts.ttsDuration;
  const fullAttempt =
    heardN >= Math.max(2, expectedN - 1) ||
    runN >= expectedN - 1 ||
    (tts > 0 &&
      opts.userDuration >= tts * 0.75 &&
      runN <= 3 &&
      heardN === 0);

  if (fullAttempt) {
    const t0 = runs[0].start;
    const t1 = runs[runs.length - 1].end;
    const source = runN >= expectedN - 1 ? runs : [{ start: t0, end: t1 }];
    const sized = resizeRuns(source, expectedN);
    return expected.map((hanzi, i) => ({
      hanzi,
      start: sized[i].start,
      end: Math.max(sized[i].end, sized[i].start + 0.05),
    }));
  }

  const spoken = Math.min(expectedN, runN);
  const sized = resizeRuns(runs, spoken);
  return expected.map((hanzi, i) => {
    if (i >= spoken || !sized[i]) return null;
    return {
      hanzi,
      start: sized[i].start,
      end: Math.max(sized[i].end, sized[i].start + 0.05),
    };
  });
}

export function buildSyllablePitches(opts: {
  words: Word[];
  refTimes: { hanzi: string; start: number; end: number }[];
  userTimes: ({ hanzi: string; start: number; end: number } | null)[];
  refPitch: PitchPoint[];
  userPitch: PitchPoint[];
}): SyllablePitch[] {
  const chars: { hanzi: string; pinyin: string }[] = [];
  for (const word of opts.words) {
    const han = [...word.hanzi].filter(isHan);
    const marks = pinyinSyllablesForWord(word.hanzi, word.pinyin);
    han.forEach((ch, i) => {
      chars.push({ hanzi: ch, pinyin: marks[i] ?? "" });
    });
  }
  const tones = spokenTones(chars);
  const refStats = speakerStats(
    opts.refPitch,
    opts.refTimes.filter((window) => window.end > window.start),
  );
  const userStats = speakerStats(
    opts.userPitch,
    opts.userTimes.filter((window): window is { hanzi: string; start: number; end: number } =>
      !!window && window.end > window.start,
    ),
  );
  let prevRef = 0;
  let prevUser = 0;
  return chars.map((ch, i) => {
    const ref = opts.refTimes[i];
    const user = opts.userTimes[i];
    const hasUser = !!user && user.end > user.start;
    const hasRef = !!ref && ref.end > ref.start;
    const tone = tones[i];
    const expected = tone?.spokenTone ?? 5;
    const refSemitones = hasRef
      ? sliceContour(opts.refPitch, ref.start, ref.end, 16, refStats.hz)
      : Array<number | null>(16).fill(null);
    const userSemitones = hasUser
      ? sliceContour(opts.userPitch, user.start, user.end, 16, userStats.hz)
      : Array<number | null>(16).fill(null);
    const refGrade = gradeContour(
      refSemitones,
      refStats.rangeSt,
      hasRef ? ref.end - ref.start : 0,
      prevRef,
      expected,
    );
    prevRef = refGrade.nextPrev;
    const userGrade = hasUser
      ? gradeContour(userSemitones, userStats.rangeSt, user.end - user.start, prevUser, expected)
      : { tone: null, pExpected: null, nextPrev: prevUser };
    if (hasUser) prevUser = userGrade.nextPrev;
    return {
      hanzi: ch.hanzi,
      pinyin: ch.pinyin,
      expectedTone: expected,
      dictionaryTone: tone?.dictionaryTone ?? 5,
      spokenTone: tone?.spokenTone ?? 5,
      toneNote: tone?.toneNote ?? "",
      heardTone: userGrade.tone,
      pExpected: expected === 5 ? null : userGrade.pExpected,
      modelHeardTone: hasRef ? refGrade.tone : null,
      modelPExpected: expected === 5 || !hasRef ? null : refGrade.pExpected,
      start: ref?.start ?? 0,
      end: ref?.end ?? 0,
      userStart: hasUser ? user.start : null,
      userEnd: hasUser ? user.end : null,
      refSemitones,
      userSemitones,
    };
  });
}

export function buildTakeGraph(opts: {
  words: Word[];
  hanzi: string;
  samples: Float32Array;
  sampleRate: number;
  heard: string;
  heardChars?: string[];
  sttWords: { text: string; start: number; end: number }[];
  duration: number;
  refPitch?: PitchPoint[];
  refTimes?: { hanzi: string; start: number; end: number }[];
  refDuration?: number;
  /** Plain forced-alignment spans for this recording. Null uses transcript times. */
  faSpans?: AlignSpan[] | null;
}): ToneGraph {
  const expectedChars = [...opts.hanzi].filter(isHan);
  const userPitch = extractPitch(opts.samples, opts.sampleRate);
  const userDuration = opts.duration > 0 ? opts.duration : opts.samples.length / opts.sampleRate;
  const refPitch = opts.refPitch ?? [];
  const refTimes =
    opts.refTimes ?? expectedChars.map((hanzi) => ({ hanzi, start: 0, end: 0 }));
  const userTimes = alignUserSyllableTimes({
    expectedChars,
    expectedText: opts.hanzi,
    heardChars: opts.heardChars ?? [],
    sttWords: opts.sttWords,
    userPitch,
    userDuration,
    ttsDuration: opts.refDuration ?? 0,
    samples: opts.samples,
    sampleRate: opts.sampleRate,
    faSpans: opts.faSpans,
  });
  return {
    syllables: buildSyllablePitches({
      words: opts.words,
      refTimes,
      userTimes,
      refPitch,
      userPitch,
    }),
    refPitch,
    userPitch,
    duration: Math.max(opts.refDuration ?? 0, userDuration),
    heard: opts.heard,
  };
}

export function referenceSyllables(
  words: Word[],
  hanzi: string,
  graphChars: string[],
  charTimes: [number, number][],
  refPitch: PitchPoint[],
): SyllablePitch[] {
  return buildSyllablePitches({
    words,
    refTimes: syllableTimesFromChars(hanzi, graphChars, charTimes),
    userTimes: [],
    refPitch,
    userPitch: [],
  });
}
