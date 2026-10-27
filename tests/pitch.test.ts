import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildSyllablePitches, classifyTone, extractPitch, octaveFix, sliceContour, strokeWithGaps } from "../src/lib/pitch";
import { pitchTrackNote } from "../src/lib/sandhi";
import type { PitchPoint } from "../src/lib/types";

function burst(start: number, end: number, hz: number): PitchPoint[] {
  const points: PitchPoint[] = [];
  for (let t = start; t <= end + 1e-9; t += 0.01) points.push({ t, hz });
  return points;
}

test("pitch bins stay on the longest voiced run across a pause", () => {
  const points = burst(0.13, 0.25, 100).concat(burst(0.42, 0.64, 200));
  const contour = sliceContour(points, 0, 0.7);
  const voiced = contour.filter((value): value is number => value != null);
  assert.ok(voiced.length >= 4);
  for (const value of voiced) assert.ok(Math.abs(value) < 0.5, String(value));
});

test("a pitch stroke starts again after a null", () => {
  const calls: string[] = [];
  const ctx = {
    beginPath() {
      calls.push("begin");
    },
    moveTo(x: number) {
      calls.push(`move:${x}`);
    },
    lineTo(x: number) {
      calls.push(`line:${x}`);
    },
    stroke() {
      calls.push("stroke");
    },
  };
  strokeWithGaps(ctx, [1, 2, null, 3, 4], (index) => index, (value) => value);
  assert.deepEqual(calls, ["begin", "move:0", "line:1", "move:3", "line:4", "stroke"]);
});

test("octave correction survives a short gap and resets after a long one", () => {
  const points: PitchPoint[] = [
    { t: 0, hz: 100, e: 1 },
    { t: 0.01, hz: 100, e: 1 },
    { t: 0.02, hz: null, e: 0 },
    { t: 0.03, hz: 200, e: 1 },
    { t: 0.1, hz: null, e: 0 },
    { t: 0.2, hz: 200, e: 1 },
  ];
  const out = octaveFix(points);
  assert.equal(out[3]?.hz, 100);
  assert.equal(out[5]?.hz, 200);
});

test("a pitch jump is not glued across a one-frame gap", () => {
  const points: PitchPoint[] = [];
  for (let t = 0.1; t <= 0.4 + 1e-9; t += 0.01) points.push({ t, hz: 150, e: 1 });
  points.push({ t: 0.41, hz: null, e: 0 });
  for (let t = 0.42; t <= 0.5 + 1e-9; t += 0.01) points.push({ t, hz: 220, e: 1 });
  const contour = sliceContour(points, 0, 0.6);
  const voiced = contour.filter((value): value is number => value != null);
  assert.ok(voiced.length >= 4);
  for (const value of voiced) assert.ok(Math.abs(value) < 1, String(value));
});

test("an interior pitch hole is filled and silence outside the run stays empty", () => {
  const points: PitchPoint[] = [];
  for (let t = 0; t <= 0.48 + 1e-9; t += 0.01) points.push({ t: round(t), hz: null, e: 0 });
  for (const point of points) {
    if (point.t >= 0.06 && point.t <= 0.3 && (point.t < 0.16 || point.t > 0.2)) {
      point.hz = 160;
      point.e = 1;
    }
  }
  const contour = sliceContour(points, 0, 0.48);
  assert.equal(contour[0], null);
  assert.equal(contour[contour.length - 1], null);
  const first = contour.findIndex((value) => value != null);
  let last = -1;
  contour.forEach((value, index) => {
    if (value != null) last = index;
  });
  assert.ok(first > 0 && last < contour.length - 1 && last > first);
  for (let i = first; i <= last; i++) assert.notEqual(contour[i], null);
});

test("学 on the AI voice is graded from the contour that is drawn", () => {
  const dir = path.join(process.cwd(), "tests/fixtures/slice");
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "ch1_01_P.json"), "utf8")) as {
    sampleRate: number;
    windows_owned: [string, number, number][];
  };
  const buf = fs.readFileSync(path.join(dir, "ch1_01_P.f32"));
  const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const syllables = buildSyllablePitches({
    words: [
      { hanzi: "果果", pinyin: "Guǒguo" },
      { hanzi: "今年", pinyin: "jīnnián" },
      { hanzi: "十三", pinyin: "shísān" },
      { hanzi: "岁", pinyin: "suì" },
      { hanzi: "是", pinyin: "shì" },
      { hanzi: "一名", pinyin: "yì míng" },
      { hanzi: "中学生", pinyin: "zhōngxuéshēng" },
      { hanzi: "读", pinyin: "dú" },
      { hanzi: "中学", pinyin: "zhōngxué" },
      { hanzi: "一年级", pinyin: "yì nián jí" },
    ],
    refTimes: meta.windows_owned.map(([hanzi, start, end]) => ({ hanzi, start, end })),
    userTimes: [],
    refPitch: extractPitch(samples, meta.sampleRate),
    userPitch: [],
  });
  const xue = syllables[11];
  assert.equal(xue?.hanzi, "学");
  assert.equal(xue?.expectedTone, 2);
  const voiced = (xue?.refSemitones ?? []).filter((value): value is number => value != null);
  assert.ok(voiced.length >= 4);
  assert.ok(voiced[voiced.length - 1]! < voiced[0]! - 1, voiced.join(","));
  assert.equal(classifyTone(xue?.refSemitones ?? []), 4);
  const note = pitchTrackNote({
    track: "model",
    hasUserTake: false,
    expectedTone: xue?.expectedTone ?? 0,
    heardTone: null,
    modelHeardTone: xue?.modelHeardTone ?? null,
    pExpected: null,
    modelPExpected: xue?.modelPExpected ?? null,
    userStart: null,
    start: xue?.start ?? 0,
    end: xue?.end ?? 0,
    shapeTone: classifyTone(xue?.refSemitones ?? []),
  });
  assert.match(note, /shape is off/);
  assert.match(note, /falling/);
});

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
