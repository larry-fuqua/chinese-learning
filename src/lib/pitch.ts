import type { PitchPoint, SyllablePitch, Word } from "./types";
import { pinyinSyllablesForWord } from "./pinyin";
import { isHan, toneFromPinyin } from "./text";

const HOP_SEC = 0.01;
const WIN_SEC = 0.04;
const MIN_HZ = 70;
const MAX_HZ = 400;
const YIN_THRESHOLD = 0.15;

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
    energies.push(rms(frame));
    raw.push({ t: start / sampleRate, hz: yinPitch(frame, sampleRate) });
  }
  const peak = percentile(energies, 0.9) || 1;
  const gate = peak * 0.12;
  const gated = raw.map((p, i) =>
    energies[i] < gate ? { ...p, hz: null } : p,
  );
  return removeOctaveJumps(medianFilter(gated, 4));
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

function removeOctaveJumps(points: PitchPoint[]): PitchPoint[] {
  let last: number | null = null;
  return points.map((p) => {
    if (p.hz == null) {
      last = null;
      return p;
    }
    let hz = p.hz;
    if (last != null) {
      const ratio = hz / last;
      if (ratio > 1.85) hz = hz / 2;
      else if (ratio < 0.54) hz = hz * 2;
      if (hz / last > 1.7 || hz / last < 0.6) {
        last = null;
        return { ...p, hz: null };
      }
    }
    last = hz;
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

export function sliceContour(
  points: PitchPoint[],
  start: number,
  end: number,
  bins = 16,
): (number | null)[] {
  const span = Math.max(0.06, end - start);
  // Tones live on the vowel: skip the initial consonant / onset.
  const innerStart = start + span * 0.18;
  const innerEnd = end - span * 0.06;
  const voiced = voicedSpan(points, innerStart, innerEnd);
  const a0 = voiced?.start ?? innerStart;
  const a1 = voiced?.end ?? innerEnd;
  const slice = points.filter((p) => p.t >= a0 && p.t <= a1);
  if (slice.filter((p) => p.hz != null).length < 3) {
    return Array(bins).fill(null);
  }
  const semitones = toSemitones(slice);
  const out: (number | null)[] = [];
  for (let i = 0; i < bins; i++) {
    const a = a0 + ((a1 - a0) * i) / bins;
    const b = a0 + ((a1 - a0) * (i + 1)) / bins;
    const vals: number[] = [];
    for (let j = 0; j < slice.length; j++) {
      if (slice[j].t >= a && slice[j].t < b && semitones[j] != null) {
        vals.push(semitones[j] as number);
      }
    }
    out.push(vals.length ? mean(vals) : null);
  }
  return out;
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

export function syllableTimesFromChars(
  hanzi: string,
  graphChars: string[],
  charTimes: [number, number][],
): { hanzi: string; start: number; end: number }[] {
  const out: { hanzi: string; start: number; end: number }[] = [];
  let gi = 0;
  for (const ch of hanzi) {
    if (!isHan(ch)) continue;
    while (gi < graphChars.length && graphChars[gi] !== ch) gi++;
    if (gi < graphChars.length && charTimes[gi]) {
      out.push({ hanzi: ch, start: charTimes[gi][0], end: charTimes[gi][1] });
      gi++;
    }
  }
  return out;
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

function charTimesFromStt(
  words: { text: string; start: number; end: number }[],
): { hanzi: string; start: number; end: number }[] {
  const pieces: { hanzi: string; start: number; end: number }[] = [];
  for (const w of words) {
    const chars = [...w.text].filter(isHan);
    if (!chars.length) continue;
    const span = Math.max(0.05, w.end - w.start);
    chars.forEach((ch, i) => {
      pieces.push({
        hanzi: ch,
        start: w.start + (span * i) / chars.length,
        end: w.start + (span * (i + 1)) / chars.length,
      });
    });
  }
  return pieces;
}

function assignPieces(
  expectedChars: string[],
  pieces: { hanzi: string; start: number; end: number }[],
): ({ hanzi: string; start: number; end: number } | null)[] {
  const used = new Set<number>();
  return expectedChars.map((hanzi) => {
    const idx = pieces.findIndex((p, i) => !used.has(i) && p.hanzi === hanzi);
    if (idx < 0) return null;
    used.add(idx);
    const p = pieces[idx];
    return {
      hanzi,
      start: p.start,
      end: Math.max(p.end, p.start + 0.05),
    };
  });
}

export function alignUserSyllableTimes(opts: {
  expectedChars: string[];
  heardChars: string[];
  sttWords: { text: string; start: number; end: number }[];
  userPitch: PitchPoint[];
  userDuration: number;
  ttsDuration: number;
}): ({ hanzi: string; start: number; end: number } | null)[] {
  const expected = opts.expectedChars;
  if (!expected.length) return [];

  const sttPieces = charTimesFromStt(opts.sttWords);
  if (sttPieces.length) {
    return assignPieces(expected, sttPieces);
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
  return chars.map((ch, i) => {
    const ref = opts.refTimes[i];
    const user = opts.userTimes[i];
    const hasUser = !!user && user.end > user.start;
    const refSemitones = ref
      ? sliceContour(opts.refPitch, ref.start, Math.max(ref.end, ref.start + 0.08))
      : Array(16).fill(null);
    const userSemitones = hasUser
      ? sliceContour(
          opts.userPitch,
          user.start,
          Math.max(user.end, user.start + 0.08),
        )
      : Array(16).fill(null);
    return {
      hanzi: ch.hanzi,
      pinyin: ch.pinyin,
      expectedTone: toneFromPinyin(ch.pinyin),
      heardTone: hasUser ? classifyTone(userSemitones) : null,
      start: ref?.start ?? 0,
      end: ref?.end ?? 0,
      userStart: hasUser ? user.start : null,
      userEnd: hasUser ? user.end : null,
      refSemitones,
      userSemitones,
    };
  });
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
