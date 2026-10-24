import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alignCharTimes,
  normalizeTimestampUnit,
  partitionOffCases,
  scoreOnsets,
  syllableTimesFromChars,
  type OffCase,
} from "../src/lib/align-audio";
import { buildSyllablePitches, sliceContour } from "../src/lib/pitch";
import {
  contourVerdict,
  spokenTones,
  toneDifferenceLabel,
  type Reading,
} from "../src/lib/sandhi";
import type { PitchPoint } from "../src/lib/types";

function say(pairs: [string, string][]) {
  return spokenTones(pairs.map(([hanzi, pinyin]) => ({ hanzi, pinyin })));
}

function tones(pairs: [string, string][]) {
  return say(pairs).map((item) => item.spokenTone);
}

test("third-tone sandhi, yi, bu, and neutral syllables", () => {
  assert.deepEqual(tones([["你", "nǐ"], ["好", "hǎo"]]), [2, 3]);
  assert.equal(say([["你", "nǐ"], ["好", "hǎo"]])[0]?.toneNote, "3rd-tone sandhi");
  assert.deepEqual(tones([["水", "shuǐ"], ["果", "guǒ"]]), [2, 3]);
  assert.deepEqual(
    tones([["我", "wǒ"], ["很", "hěn"], ["好", "hǎo"]]),
    [2, 2, 3],
  );
  assert.deepEqual(tones([["你", "nǐ"], ["好", "hǎo"], ["吗", "ma"]]), [2, 3, 5]);
  assert.deepEqual(tones([["一", "yī"], ["个", "gè"]]), [2, 4]);
  assert.deepEqual(tones([["一", "yī"], ["天", "tiān"]]), [4, 1]);
  assert.deepEqual(tones([["一", "yī"], ["点", "diǎn"]]), [4, 3]);
  assert.deepEqual(tones([["第", "dì"], ["一", "yī"]]), [4, 1]);
  assert.equal(say([["第", "dì"], ["一", "yī"]])[1]?.toneNote, "");
  assert.deepEqual(tones([["不", "bù"], ["是", "shì"]]), [2, 4]);
  assert.deepEqual(tones([["不", "bù"], ["去", "qù"]]), [2, 4]);
  assert.deepEqual(tones([["不", "bù"], ["好", "hǎo"]]), [4, 3]);
  assert.deepEqual(tones([["好", "hǎo"], ["了", "le"]]), [3, 5]);
  assert.deepEqual(tones([["好", "hǎo"], ["了", "liǎo"]]), [2, 3]);
  assert.equal(say([["好", "hǎo"], ["了", "liǎo"]])[1]?.spokenTone, 3);
  assert.equal(say([["好", "hǎo"], ["了", "liǎo"]])[1]?.toneNote, "");
  assert.deepEqual(tones([["我", "wǒ"], ["的", "de"]]), [3, 5]);
  assert.deepEqual(tones([["目", "mù"], ["的", "dì"]]), [4, 4]);
  assert.deepEqual(tones([["爸", "bà"], ["爸", "bà"]]), [4, 5]);
  assert.deepEqual(tones([["妈", "mā"], ["妈", "mā"]]), [1, 5]);
  assert.deepEqual(tones([["看", "kàn"], ["一", "yī"], ["看", "kàn"]]), [4, 5, 4]);
  assert.deepEqual(tones([["好", "hǎo"], ["不", "bù"], ["好", "hǎo"]]), [3, 5, 3]);
  assert.deepEqual(tones([["你", "ni3"], ["好", "hao3"]]), [2, 3]);
  assert.equal(
    toneDifferenceLabel(3, 2, "3rd-tone sandhi"),
    "dict 3rd vs spoken 2nd (3rd-tone sandhi)",
  );
  assert.equal(toneDifferenceLabel(1, 1, ""), null);
});

test("a sandhi contour matches the spoken tone", () => {
  assert.equal(contourVerdict({ userStart: 0.1, expectedTone: 2, heardTone: 2 }), " · shape matches");
  assert.equal(contourVerdict({ userStart: 0.1, expectedTone: 2, heardTone: 5 }), " · light / short");
  assert.equal(contourVerdict({ userStart: 0.1, expectedTone: 3, heardTone: 2 }), " · shape is off");
  assert.equal(contourVerdict({ userStart: null, expectedTone: 2, heardTone: 2 }), " · not in this take");
});

test("syllable pitches use the spoken tone and stay inside the timestamp", () => {
  const syllables = buildSyllablePitches({
    words: [{ hanzi: "你好", pinyin: "nǐ hǎo" }],
    refTimes: [
      { hanzi: "你", start: 0, end: 0.03 },
      { hanzi: "好", start: 0.03, end: 0.2 },
    ],
    userTimes: [],
    refPitch: pitchBurst(0, 0.03, 100).concat(pitchBurst(0.04, 0.12, 200)),
    userPitch: [],
  });
  assert.equal(syllables[0]?.dictionaryTone, 3);
  assert.equal(syllables[0]?.spokenTone, 2);
  assert.equal(syllables[0]?.expectedTone, 2);
  assert.equal(syllables[0]?.toneNote, "3rd-tone sandhi");
  assert.equal(syllables[1]?.expectedTone, 3);
  const contour = syllables[0]?.refSemitones ?? [];
  const voiced = contour.filter((value): value is number => value != null);
  assert.ok(voiced.length >= 2);
  for (const value of voiced) assert.ok(Math.abs(value) < 1);
});

test("index alignment keeps each copy of a character on its own interval", () => {
  const times = syllableTimesFromChars(
    "妈妈。",
    ["妈", "妈", "。"],
    [
      [0, 0.2],
      [0.2, 0.45],
      [0.45, 0.5],
    ],
  );
  assert.equal(times.length, 2);
  assert.equal(times[1]?.start, 0.2);
  assert.equal(times[1]?.end, 0.45);

  const sequential = syllableTimesFromChars(
    "妈妈。",
    ["x", "妈", "妈", "。"],
    [
      [0, 0.1],
      [0.1, 0.2],
      [0.2, 0.4],
      [0.4, 0.5],
    ],
  );
  assert.deepEqual(
    sequential.map((item) => [item.start, item.end]),
    [
      [0.1, 0.2],
      [0.2, 0.4],
    ],
  );
});

test("millisecond timestamps convert only when they disagree with duration", () => {
  const converted = normalizeTimestampUnit(
    [
      [0, 400],
      [400, 500],
    ],
    0.4,
  );
  assert.equal(converted.converted, true);
  assert.deepEqual(converted.times, [
    [0, 0.4],
    [0.4, 0.5],
  ]);
  const seconds = normalizeTimestampUnit(
    [
      [0, 12],
      [12, 28],
    ],
    28,
  );
  assert.equal(seconds.converted, false);
  assert.equal(seconds.times[1]?.[1], 28);
});

test("a contour sample stays inside the labeled slice", () => {
  const points = pitchBurst(0, 0.03, 100).concat(pitchBurst(0.04, 0.12, 200));
  const contour = sliceContour(points, 0, 0.03);
  const voiced = contour.filter((value): value is number => value != null);
  assert.ok(voiced.length >= 2);
  for (const value of voiced) assert.ok(Math.abs(value) < 1);
});

test("energy onsets accept aligned slices and correct one clustered shift", () => {
  const rate = 8000;
  const trueSlices = [0, 1, 2].map((i) => {
    const start = 0.3 + i * 0.4;
    return [start, start + 0.16] as [number, number];
  });
  const samples = bursts(trueSlices, rate);
  const aligned = scoreOnsets(
    samples,
    rate,
    trueSlices.map(([start, end]) => ({ start, end })),
  );
  assert.equal(aligned.offsetSec, 0);
  assert.equal(aligned.onTime, 3);

  const early = trueSlices.map(([start, end]) => [start - 0.12, end - 0.12] as [number, number]);
  const shifted = scoreOnsets(
    samples,
    rate,
    early.map(([start, end]) => ({ start, end })),
  );
  assert.ok(shifted.offsetSec > 0.08 && shifted.offsetSec < 0.14, String(shifted.offsetSec));

  const text = "啊啊啊";
  const fixed = alignCharTimes({
    text,
    graphChars: [...text],
    charTimes: early,
    duration: samples.length / rate,
    samples,
    sampleRate: rate,
  });
  assert.ok(Math.abs((fixed.report?.offsetSec ?? 0) - shifted.offsetSec) < 1e-9);
  const again = scoreOnsets(
    samples,
    rate,
    syllableTimesFromChars(text, [...text], fixed.charTimes),
  );
  assert.equal(again.offsetSec, 0);

  const untouched = alignCharTimes({
    text,
    graphChars: [...text],
    charTimes: trueSlices,
    duration: samples.length / rate,
    samples,
    sampleRate: rate,
  });
  assert.equal(untouched.report?.offsetSec, 0);
  assert.deepEqual(untouched.charTimes, trueSlices);

  const silent = alignCharTimes({
    text,
    graphChars: [...text],
    charTimes: trueSlices,
    duration: 1,
    samples: new Float32Array(rate),
    sampleRate: rate,
  });
  assert.equal(silent.report?.offsetSec, 0);
  assert.deepEqual(silent.charTimes, trueSlices);
});

test("dictionary mismatches on aligned audio are tone variation", () => {
  const readings: Reading[] = [
    ["你", "nǐ"],
    ["好", "hǎo"],
    ["妈", "mā"],
    ["妈", "mā"],
    ["一", "yī"],
    ["个", "gè"],
    ["不", "bù"],
    ["是", "shì"],
    ["我", "wǒ"],
    ["的", "dè"],
    ["爸", "bà"],
    ["爸", "bà"],
    ["水", "shuǐ"],
    ["果", "guǒ"],
    ["不", "bù"],
    ["去", "qù"],
    ["一", "yī"],
    ["天", "tiān"],
    ["好", "hǎo"],
    ["了", "lè"],
  ].map(([hanzi, pinyin]) => ({ hanzi, pinyin }));
  const text = readings.map((item) => item.hanzi).join("");
  const spoken = spokenTones(readings);
  const rate = 8000;
  const trueSlices = readings.map((_, i) => {
    const start = 0.3 + i * 0.4;
    return [start, start + 0.16] as [number, number];
  });
  const samples = bursts(trueSlices, rate);
  const duration = samples.length / rate;
  const graphChars = [...text];

  const aligned = alignCharTimes({
    text,
    graphChars,
    charTimes: trueSlices,
    duration,
    samples,
    sampleRate: rate,
  });
  assert.equal(aligned.report?.offsetSec, 0);
  const alignedShare = partitionOffCases(
    casesFrom(spoken, aligned.report?.offsetSec !== 0),
  );
  assert.deepEqual(alignedShare, { off: 10, timing: 0, tone: 10 });

  const early = trueSlices.map(([start, end]) => [start - 0.12, end - 0.12] as [number, number]);
  const shifted = alignCharTimes({
    text,
    graphChars,
    charTimes: early,
    duration,
    samples,
    sampleRate: rate,
  });
  assert.ok((shifted.report?.offsetSec ?? 0) > 0.08);
  const shiftedShare = partitionOffCases(
    casesFrom(spoken, (shifted.report?.offsetSec ?? 0) !== 0),
  );
  assert.deepEqual(shiftedShare, { off: 10, timing: 10, tone: 0 });
  const repaired = scoreOnsets(
    samples,
    rate,
    syllableTimesFromChars(text, graphChars, shifted.charTimes),
  );
  assert.equal(repaired.offsetSec, 0);
});

function casesFrom(
  spoken: { dictionaryTone: number; spokenTone: number }[],
  timingOff: boolean,
): OffCase[] {
  return spoken.map((item) => ({
    dictionaryTone: item.dictionaryTone,
    spokenTone: item.spokenTone,
    heardTone: item.spokenTone,
    timingOff,
  }));
}

function bursts(ranges: [number, number][], sampleRate: number): Float32Array {
  const last = ranges[ranges.length - 1]?.[1] ?? 0;
  const samples = new Float32Array(Math.ceil((last + 0.05) * sampleRate));
  for (const [start, end] of ranges) {
    const i0 = Math.max(0, Math.floor(start * sampleRate));
    const i1 = Math.min(samples.length, Math.floor(end * sampleRate));
    for (let i = i0; i < i1; i++) samples[i] = 0.8;
  }
  return samples;
}

function pitchBurst(start: number, end: number, hz: number): PitchPoint[] {
  const points: PitchPoint[] = [];
  for (let t = start; t <= end + 1e-9; t += 0.01) points.push({ t, hz });
  return points;
}
