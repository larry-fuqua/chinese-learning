import assert from "node:assert/strict";
import { test } from "node:test";
import {
  graphIndex,
  sliceWindows,
  SLICE,
} from "../src/lib/align-audio";
import { alignUserSyllableTimes } from "../src/lib/pitch";
import { tonelessReading } from "../src/lib/pinyin-readings";
import type { PitchPoint } from "../src/lib/types";

const SENTENCE = "果果今年十三岁，是一名中学生，读中学一年级。";

/** Method B windows from the recognition bench: raw xAI spans with 30 ms of pad on each side. */
const BENCH_RAW_PADDED: [number, number][] = [
  [0.05, 0.23],
  [0.29, 0.45],
  [0.55, 0.77],
  [0.75, 0.99],
  [0.93, 1.29],
  [1.23, 1.59],
  [1.53, 1.81],
  [2.23, 2.39],
  [2.33, 2.61],
  [2.55, 2.83],
  [2.9, 3.14],
  [3.14, 3.34],
  [3.4, 3.7],
  [4.06, 4.22],
  [4.32, 4.56],
  [4.56, 4.74],
  [4.68, 5.06],
  [5.0, 5.24],
  [5.28, 5.46],
];

/** Sentence 1 windows from the bench slicer (windows.json "new"). */
const SENTENCE_WINDOWS: [string, number, number][] = [
  ["果", 0.01, 0.32],
  ["果", 0.29, 0.575],
  ["今", 0.55, 0.745],
  ["年", 0.75, 0.96],
  ["十", 0.93, 1.26],
  ["三", 1.23, 1.56],
  ["岁", 1.53, 1.9],
  ["是", 2.19, 2.36],
  ["一", 2.33, 2.58],
  ["名", 2.55, 2.915],
  ["中", 2.9, 3.17],
  ["学", 3.14, 3.405],
  ["生", 3.4, 3.765],
  ["读", 4.02, 4.345],
  ["中", 4.32, 4.59],
  ["学", 4.56, 4.71],
  ["一", 4.68, 5.03],
  ["年", 5.0, 5.29],
  ["级", 5.28, 5.6],
];

test("citation readings match homophones and digits", () => {
  assert.equal(tonelessReading("她"), "ta");
  assert.equal(tonelessReading("他"), "ta");
  assert.equal(tonelessReading("二"), "er");
  assert.equal(tonelessReading("2"), "er");
  assert.equal(tonelessReading("零"), "ling");
  assert.equal(tonelessReading("0"), "ling");
  assert.equal(SLICE.LEAD_SEC, 0.03);
  assert.equal(SLICE.PAD_EDGE_SEC, 0.04);
});

test("toneless alignment keeps order across 她/他 and digits", () => {
  const swapped = graphIndex("他爱她", ["她", "爱", "他"]);
  assert.deepEqual(
    swapped.map((item) => item.gi),
    [0, 1, 2],
  );
  const digits = graphIndex("二零二六年", ["2", "0", "2", "6", "年"]);
  assert.deepEqual(
    digits.map((item) => item.gi),
    [0, 1, 2, 3, 4],
  );
});

test("recording match walks forward, so an early homophone is not stolen from later", () => {
  const empty: PitchPoint[] = [];
  const times = alignUserSyllableTimes({
    expectedChars: ["他", "爱", "她"],
    expectedText: "他爱她",
    heardChars: ["她", "爱", "他"],
    sttWords: [
      { text: "她", start: 0.1, end: 0.2 },
      { text: "爱", start: 0.3, end: 0.4 },
      { text: "他", start: 0.5, end: 0.6 },
    ],
    userPitch: empty,
    userDuration: 1,
    ttsDuration: 1,
  });
  assert.deepEqual(
    times.map((item) => item && [item.start, item.end]),
    [
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6],
    ],
  );
});

test("a join ends at the energy dip and a pause keeps a short tail", () => {
  const rate = 8000;
  const text = "你好。";
  const chars = [...text];
  const charTimes: [number, number][] = [
    [0.2, 0.35],
    [0.55, 0.7],
    [0.9, 1.0],
  ];
  const dur = 1.4;
  const samples = new Float32Array(Math.ceil(dur * rate));
  samples.fill(0.5);
  mute(samples, rate, 0.46, 0.48);
  mute(samples, rate, 0.8, dur);
  const windows = sliceWindows(text, chars, charTimes, samples, rate);
  assert.equal(windows.length, 2);
  assert.equal(windows[0]?.hanzi, "你");
  assert.ok(Math.abs((windows[0]?.start ?? 0) - (0.2 - 0.04 - 0.03)) < 1e-9);
  assert.ok(Math.abs((windows[0]?.end ?? 0) - 0.47) < 0.006, String(windows[0]?.end));
  assert.equal(windows[1]?.hanzi, "好");
  assert.ok(Math.abs((windows[1]?.start ?? 0) - (0.55 - 0.03)) < 1e-9);
  assert.ok(Math.abs((windows[1]?.end ?? 0) - 0.87) < 0.006, String(windows[1]?.end));
});

test("sentence 1 windows match the recognition bench", () => {
  const chars = [...SENTENCE];
  const hanAt: number[] = [];
  chars.forEach((ch, i) => {
    if (/\p{Script=Han}/u.test(ch)) hanAt.push(i);
  });
  assert.equal(hanAt.length, SENTENCE_WINDOWS.length);
  const raw = BENCH_RAW_PADDED.map(([start, end]) => [start + 0.03, end - 0.03] as [number, number]);
  const charTimes: [number, number][] = chars.map(() => [0, 0.01]);
  raw.forEach((span, i) => {
    const at = hanAt[i];
    if (at != null) charTimes[at] = span;
  });

  const rate = 16000;
  const dur = 6.2;
  const samples = new Float32Array(Math.ceil(dur * rate));
  samples.fill(0.5);
  SENTENCE_WINDOWS.forEach(([, , end], i) => {
    const token = raw[i];
    const next = raw[i + 1];
    if (!token) return;
    const nextIsHan = next != null && hanAt[i + 1] === (hanAt[i] ?? 0) + 1;
    if (nextIsHan && next && next[0] > token[1]) {
      mute(samples, rate, end - 0.01, end + 0.01);
    } else if (!nextIsHan) {
      const quiet = end - 0.06;
      mute(samples, rate, quiet - 0.01, next ? next[0] : dur);
    }
  });

  const windows = sliceWindows(SENTENCE, chars, charTimes, samples, rate);
  assert.equal(windows.length, SENTENCE_WINDOWS.length);
  windows.forEach((window, i) => {
    const expected = SENTENCE_WINDOWS[i];
    assert.ok(expected);
    assert.equal(window.hanzi, expected[0]);
    assert.ok(
      Math.abs(window.start - expected[1]) < 0.006,
      `${window.hanzi}#${i} start ${window.start} vs ${expected[1]}`,
    );
    assert.ok(
      Math.abs(window.end - expected[2]) < 0.006,
      `${window.hanzi}#${i} end ${window.end} vs ${expected[2]}`,
    );
  });
  assert.ok(windows[0] && windows[0].start > 0 && windows[0].end > 0.25);
});

function mute(samples: Float32Array, rate: number, start: number, end: number) {
  const i0 = Math.max(0, Math.floor(start * rate));
  const i1 = Math.min(samples.length, Math.ceil(end * rate));
  for (let i = i0; i < i1; i++) samples[i] = 0;
}
