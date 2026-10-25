import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as align } from "../src/app/api/align/route";
import { windowSpansPause, windowsFromAlignment } from "../src/lib/align-audio";
import { alignmentSyllables } from "../src/lib/pinyin";

test("align route rejects an anonymous caller", async () => {
  const response = await align(
    new Request("http://localhost/api/align", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "啊", syllables: ["a"], audioBase64: "YQ==" }),
    }),
  );
  assert.equal(response.status, 401);
});

test("alignment syllables come from the stored pinyin", () => {
  assert.deepEqual(alignmentSyllables("好了", [{ hanzi: "好了", pinyin: "hǎo le" }]), ["hao", "le"]);
  assert.deepEqual(alignmentSyllables("女人", [{ hanzi: "女人", pinyin: "nǚrén" }]), ["nv", "ren"]);
  assert.deepEqual(
    alignmentSyllables("果果", [{ hanzi: "果果", pinyin: "Guǒguo" }]),
    ["guo", "guo"],
  );
});

test("plain alignment windows do not swallow the pause between characters", () => {
  const rate = 16000;
  const samples = bursts(
    [
      [0.3, 0.55],
      [1.0, 1.3],
    ],
    rate,
    1.6,
  );
  const windows = windowsFromAlignment(
    "啊，啊",
    [
      { char: "啊", start: 0.32, end: 0.5 },
      { char: "啊", start: 1.05, end: 1.25 },
    ],
    samples,
    rate,
  );
  assert.equal(windows.length, 2);
  assert.ok(overlap(windows[0].start, windows[0].end, 0.3, 0.55) > 0.1);
  assert.ok(overlap(windows[1].start, windows[1].end, 1.0, 1.3) > 0.1);
  assert.ok(overlap(windows[0].start, windows[0].end, 1.0, 1.3) <= 0.05);
  assert.ok(overlap(windows[1].start, windows[1].end, 0.3, 0.55) <= 0.05);
  assert.equal(windowSpansPause(windows[0].start, windows[0].end, samples, rate), false);
  assert.equal(windowSpansPause(windows[1].start, windows[1].end, samples, rate), false);
  assert.ok(windows[1].start > windows[0].end);
});

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function bursts(ranges: [number, number][], sampleRate: number, duration: number): Float32Array {
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  for (const [start, end] of ranges) {
    const i0 = Math.max(0, Math.floor(start * sampleRate));
    const i1 = Math.min(samples.length, Math.floor(end * sampleRate));
    for (let i = i0; i < i1; i++) samples[i] = Math.sin((2 * Math.PI * 180 * i) / sampleRate) * 0.5;
  }
  return samples;
}
