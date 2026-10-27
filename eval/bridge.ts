/**
 * Eval-only adapter. Imports the app's pitch, slicing, and grading functions
 * and returns their outputs. It does not change those functions.
 *
 * Usage: node --import tsx eval/bridge.ts jobs.json out.json
 *        node --import tsx eval/bridge.ts --rows tone-rows.json out.json
 */
import fs from "node:fs";
import {
  applyOwnership,
  sliceWindows,
  timedCharsFromWords,
  windowsFromAlignment,
} from "../src/lib/align-audio";
import {
  alignUserSyllableTimes,
  classifyTone,
  extractPitch,
  sliceContour,
  speakerStats,
} from "../src/lib/pitch";
import { contourVerdict, spokenTones } from "../src/lib/sandhi";
import { contourFeatures, toneProbabilities } from "../src/lib/tone-model";
import type { PitchPoint } from "../src/lib/types";
import { decodeWavPcm16 } from "../src/lib/wav";

type Grade = {
  ipa: number;
  spoken: number;
  dictionary: number;
  pred: number | null;
  shape: number | null;
  pIpa: number | null;
  pSpoken: number | null;
  verdictIpa: string;
  verdictSpoken: string;
  /** Verdict string when the expected tone is forced to this class. */
  verdictIf: Record<string, string>;
  features: number[] | null;
  dur: number;
};

type Job = {
  id: string;
  wav?: string;
  pcm?: "wav" | "f32";
  sampleRate?: number;
  text: string;
  pinyin: string[];
  reference: [number, number][];
  tokens: [number, number][];
  /** Full sentence the slicer sees, including punctuation inserted at pauses. */
  graphText?: string;
  graphTimes?: [number, number][];
  ipaTone: number[];
  tier: "align" | "full";
  praat?: { t: number; hz: number | null }[];
};

function loadSamples(job: Job): { samples: Float32Array; sampleRate: number } {
  if (!job.wav) throw new Error("wav is required");
  const buf = fs.readFileSync(job.wav);
  const audio = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (job.pcm === "f32") {
    const rate = job.sampleRate ?? 0;
    if (!(rate > 0)) throw new Error("f32 audio needs sampleRate");
    return { samples: new Float32Array(audio), sampleRate: rate };
  }
  return decodeWavPcm16(audio);
}

function spansOf(times: [number, number][]): { start: number; end: number }[] {
  return times.map(([start, end]) => ({ start, end }));
}

function pairs(windows: { start: number; end: number }[]): [number, number][] {
  return windows.map((window) => [window.start, window.end]);
}

/** Same binning as sliceContour, with the 18% onset skip turned off. Eval ablation only. */
function sliceContourNoSkip(
  points: PitchPoint[],
  start: number,
  end: number,
  refHz?: number,
): (number | null)[] {
  const bins = 16;
  const empty = Array<number | null>(bins).fill(null);
  if (!(end > start)) return empty;
  const span = end - start;
  const innerStart = start;
  const innerEnd = end;
  const runs: { t: number; hz: number; e: number }[][] = [];
  let cur: { t: number; hz: number; e: number }[] = [];
  let lastT = -1;
  for (const point of points) {
    if (point.t < innerStart || point.t > innerEnd || point.hz == null || !(point.hz > 0)) continue;
    const sample = { t: point.t, hz: point.hz, e: point.e ?? 1 };
    const prevHz = cur.length ? cur[cur.length - 1].hz : sample.hz;
    const jump = cur.length > 0 && Math.max(sample.hz / prevHz, prevHz / sample.hz) > 1.25;
    if (cur.length && point.t - lastT <= 0.05 && !jump) cur.push(sample);
    else {
      if (cur.length) runs.push(cur);
      cur = [sample];
    }
    lastT = point.t;
  }
  if (cur.length) runs.push(cur);
  let run: { t: number; hz: number; e: number }[] | null = null;
  for (const candidate of runs) {
    const dur = candidate[candidate.length - 1].t - candidate[0].t;
    if (dur < 0.02) continue;
    if (!run || dur > run[run.length - 1].t - run[0].t) run = candidate;
  }
  if (!run) return empty;
  const peak = Math.max(...run.map((point) => point.e));
  let i0 = 0;
  let i1 = run.length - 1;
  while (i0 < i1 && run[i0].e < 0.3 * peak) i0++;
  while (i1 > i0 && run[i1].e < 0.3 * peak) i1--;
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
    out.push(vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
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

function nearestHz(
  frames: { t: number; hz: number | null }[],
  time: number,
): number | null {
  if (!frames.length) return null;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const dist = Math.abs(frames[i].t - time);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  if (bestDist > 0.02) return null;
  return frames[best].hz;
}

function verdictFor(
  present: boolean,
  expected: number,
  heard: number | null,
  proba: number[] | null,
  classes: number[],
  shape: number | null,
): { verdict: string; pExpected: number | null } {
  const index = classes.indexOf(expected);
  const pExpected = proba && index >= 0 ? proba[index] : null;
  const verdict = contourVerdict({
    present,
    expectedTone: expected,
    heardTone: heard,
    pExpected: expected === 5 ? null : pExpected,
    shapeTone: shape,
  });
  return { verdict, pExpected: expected === 5 ? null : pExpected };
}

function gradeTrack(opts: {
  text: string;
  pinyin: string[];
  ipaTone: number[];
  pitch: PitchPoint[];
  windows: [number, number][];
  contourOf?: (
    pitch: PitchPoint[],
    start: number,
    end: number,
    refHz: number,
  ) => (number | null)[];
}): Grade[] {
  const chars = [...opts.text];
  const readings = chars.map((hanzi, index) => ({
    hanzi,
    pinyin: opts.pinyin[index] ?? "",
  }));
  const tones = spokenTones(readings);
  const windows = spansOf(opts.windows);
  const stats = speakerStats(
    opts.pitch,
    windows.filter((window) => window.end > window.start),
  );
  let prev = 0;
  return chars.map((_, index) => {
    const span = opts.windows[index] ?? [0, 0];
    const present = span[1] > span[0];
    const dur = present ? span[1] - span[0] : 0;
    const contour = present
      ? opts.contourOf
        ? opts.contourOf(opts.pitch, span[0], span[1], stats.hz)
        : sliceContour(opts.pitch, span[0], span[1], 16, stats.hz)
      : Array<number | null>(16).fill(null);
    const features = contourFeatures(contour, stats.rangeSt, dur, prev);
    prev = features.nextPrev;
    const scored = features.x ? toneProbabilities(features.x) : null;
    let pred: number | null = null;
    if (scored) {
      let best = 0;
      for (let i = 1; i < scored.proba.length; i++) {
        if (scored.proba[i] > scored.proba[best]) best = i;
      }
      pred = scored.classes[best] ?? null;
    }
    const shape = classifyTone(contour);
    const ipa = opts.ipaTone[index] ?? 0;
    const spoken = tones[index]?.spokenTone ?? 5;
    const dictionary = tones[index]?.dictionaryTone ?? 5;
    const classes = scored?.classes ?? [];
    const proba = scored?.proba ?? null;
    const ipaVerdict = verdictFor(present, ipa, pred, proba, classes, shape);
    const spokenVerdict = verdictFor(present, spoken, pred, proba, classes, shape);
    const verdictIf: Record<string, string> = {};
    if (ipa >= 1 && ipa <= 4) {
      for (const tone of [1, 2, 3, 4]) {
        if (tone === ipa) continue;
        verdictIf[String(tone)] = verdictFor(present, tone, pred, proba, classes, shape).verdict;
      }
    }
    return {
      ipa,
      spoken,
      dictionary,
      pred,
      shape,
      pIpa: ipaVerdict.pExpected,
      pSpoken: spokenVerdict.pExpected,
      verdictIpa: ipaVerdict.verdict,
      verdictSpoken: spokenVerdict.verdict,
      verdictIf,
      features: features.x,
      dur,
    };
  });
}

function proportionalRaw(text: string, reference: [number, number][]): [number, number][] {
  const usable = reference.filter((span) => span[1] > span[0]);
  const start = usable.length ? Math.min(...usable.map((span) => span[0])) : 0;
  const end = usable.length ? Math.max(...usable.map((span) => span[1])) : 0;
  const timed = timedCharsFromWords([{ text, start, end }], text);
  const han = [...text];
  return han.map((_, index) => timed.charTimes[index] ?? [0, 0]);
}

function runJob(job: Job) {
  const { samples, sampleRate } = loadSamples(job);
  const text = job.text;
  const chars = [...text];
  const duration = sampleRate > 0 ? samples.length / sampleRate : 0;
  const tokenTimes: [number, number][] = chars.map((_, index) => job.tokens[index] ?? [0, 0]);
  const graphText = job.graphText && job.graphTimes ? job.graphText : text;
  const graphChars = [...graphText];
  const graphTimes: [number, number][] =
    job.graphText && job.graphTimes ? job.graphTimes : tokenTimes;
  const sliced = pairs(
    applyOwnership(
      sliceWindows(graphText, graphChars, graphTimes, samples, sampleRate),
      samples,
      sampleRate,
    ),
  );
  const faPost = pairs(
    windowsFromAlignment(
      graphText,
      graphChars.map((ch, index) => ({
        char: ch,
        start: graphTimes[index]?.[0] ?? 0,
        end: graphTimes[index]?.[1] ?? 0,
      })).filter((span) => /[\u3400-\u9fff]/.test(span.char)),
      samples,
      sampleRate,
    ),
  );
  const rawEven = proportionalRaw(text, job.reference);
  const proportional = pairs(
    alignUserSyllableTimes({
      expectedChars: chars,
      expectedText: text,
      heardChars: chars,
      sttWords: [
        {
          text,
          start: rawEven[0]?.[0] ?? 0,
          end: rawEven[rawEven.length - 1]?.[1] ?? 0,
        },
      ],
      userPitch: [],
      userDuration: duration,
      ttsDuration: duration,
      samples,
      sampleRate,
    }).map((window) => ({
      start: window?.start ?? 0,
      end: window?.end ?? 0,
    })),
  );

  const result: Record<string, unknown> = {
    id: job.id,
    n: chars.length,
    duration,
    windows: {
      tokens: tokenTimes,
      sliced,
      faPost,
      proportionalRaw: rawEven,
      proportional,
    },
  };

  if (job.tier !== "full") return result;

  const pitch = extractPitch(samples, sampleRate);
  const voiced = pairs(
    alignUserSyllableTimes({
      expectedChars: chars,
      expectedText: text,
      heardChars: chars,
      sttWords: [],
      userPitch: pitch,
      userDuration: duration,
      ttsDuration: duration,
      samples,
      sampleRate,
    }).map((window) => ({
      start: window?.start ?? 0,
      end: window?.end ?? 0,
    })),
  );
  (result.windows as Record<string, unknown>).voiced = voiced;

  const praatPoints: PitchPoint[] = (job.praat ?? []).map((frame) => ({
    t: frame.t,
    hz: frame.hz,
    e: 1,
  }));
  const hybrid: PitchPoint[] = pitch.map((point) => {
    if (point.hz == null || !praatPoints.length) return point;
    const hz = nearestHz(praatPoints, point.t);
    if (hz == null || !(hz > 0)) return point;
    return { ...point, hz };
  });

  const gradeArgs = {
    text,
    pinyin: job.pinyin,
    ipaTone: job.ipaTone,
    pitch,
  };
  result.pitch = {
    t: pitch.map((point) => point.t),
    hz: pitch.map((point) => point.hz),
  };
  result.grades = {
    oracle: gradeTrack({ ...gradeArgs, windows: job.reference }),
    sliced: gradeTrack({ ...gradeArgs, windows: sliced }),
    proportional: gradeTrack({ ...gradeArgs, windows: proportional }),
    voiced: gradeTrack({ ...gradeArgs, windows: voiced }),
    praat: praatPoints.length
      ? gradeTrack({ ...gradeArgs, pitch: praatPoints, windows: job.reference })
      : [],
    hybrid: praatPoints.length
      ? gradeTrack({ ...gradeArgs, pitch: hybrid, windows: job.reference })
      : [],
    noskip: gradeTrack({
      ...gradeArgs,
      windows: job.reference,
      contourOf: (points, start, end, refHz) => sliceContourNoSkip(points, start, end, refHz),
    }),
  };
  return result;
}

type Row = {
  id: string;
  i: number;
  kind: string;
  split: string;
  ws: string;
  exp: number;
  dict: number;
  cur: number;
  range: number;
  dur: number;
  c3: (number | null)[];
};

function runRows(path: string) {
  const rows = JSON.parse(fs.readFileSync(path, "utf8")) as Row[];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.kind}|${row.split}|${row.ws}|${row.id}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => a.i - b.i);
    let prev = 0;
    const graded = group.map((row) => {
      const features = contourFeatures(row.c3, row.range, row.dur, prev);
      prev = features.nextPrev;
      const scored = features.x ? toneProbabilities(features.x) : null;
      let pred: number | null = null;
      if (scored) {
        let best = 0;
        for (let i = 1; i < scored.proba.length; i++) {
          if (scored.proba[i] > scored.proba[best]) best = i;
        }
        pred = scored.classes[best] ?? null;
      }
      const shape = classifyTone(row.c3);
      const classes = scored?.classes ?? [];
      const proba = scored?.proba ?? null;
      const expected = row.exp;
      const own = verdictFor(true, expected, pred, proba, classes, shape);
      const verdictIf: Record<string, string> = {};
      if (expected >= 1 && expected <= 4) {
        for (const tone of [1, 2, 3, 4]) {
          if (tone === expected) continue;
          verdictIf[String(tone)] = verdictFor(true, tone, pred, proba, classes, shape).verdict;
        }
      }
      return {
        exp: expected,
        dict: row.dict,
        cur: row.cur,
        pred,
        shape,
        pExpected: own.pExpected,
        verdict: own.verdict,
        verdictIf,
        dur: row.dur,
      };
    });
    const [kind, split, ws, id] = key.split("|");
    out.push({ id, kind, split, ws, items: graded });
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--rows") {
    const produced = runRows(args[1] ?? "");
    fs.writeFileSync(args[2] ?? "", JSON.stringify(produced));
    console.error(`rows ${produced.length}`);
    return;
  }
  const jobs = JSON.parse(fs.readFileSync(args[0] ?? "", "utf8")) as Job[];
  const produced = jobs.map((job) => {
    try {
      return runJob(job);
    } catch (err) {
      return { id: job.id, error: err instanceof Error ? err.message : "failed" };
    }
  });
  fs.writeFileSync(args[1] ?? "", JSON.stringify(produced));
  const failed = produced.filter((item) => "error" in item && item.error).length;
  console.error(`jobs ${produced.length} failed ${failed}`);
}

main();
