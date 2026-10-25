import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  applyOwnership,
  numToZh,
  timedCharsFromWords2,
} from "../src/lib/align-audio";
import { tonelessReading } from "../src/lib/pinyin-readings";

const sliceDir = path.join(process.cwd(), "tests/fixtures/slice");

function readF32(file: string): Float32Array {
  const buf = fs.readFileSync(file);
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

test("ownership matches the reference windows, and 一年级's 一 keeps its early start", () => {
  const files = fs.readdirSync(sliceDir).filter((name) => name.endsWith(".json"));
  assert.ok(files.length >= 5);
  for (const name of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(sliceDir, name), "utf8")) as {
      sampleRate: number;
      text: string;
      words: { text: string; start: number; end: number }[];
      windows_F: [string, number, number][];
      windows_owned: [string, number, number][];
      stt_tokens: [string[], [number, number][]];
    };
    const samples = readF32(path.join(sliceDir, name.replace(/\.json$/, ".f32")));
    const windows = fixture.windows_F.map(([hanzi, start, end]) => ({ hanzi, start, end }));
    const owned = applyOwnership(windows, samples, fixture.sampleRate);
    assert.equal(owned.length, fixture.windows_owned.length, name);
    owned.forEach((window, i) => {
      const expected = fixture.windows_owned[i];
      assert.ok(expected, name);
      assert.equal(window.hanzi, expected[0], name);
      assert.ok(Math.abs(window.start - expected[1]) < 0.001, `${name} ${window.hanzi} start ${window.start}`);
      assert.ok(Math.abs(window.end - expected[2]) < 0.001, `${name} ${window.hanzi} end ${window.end}`);
    });
    const tokens = timedCharsFromWords2(fixture.words, fixture.text, tonelessReading);
    assert.deepEqual(tokens.graphChars, fixture.stt_tokens[0], name);
    tokens.charTimes.forEach((span, i) => {
      const expected = fixture.stt_tokens[1][i];
      assert.ok(expected, name);
      assert.ok(Math.abs(span[0] - expected[0]) < 1e-9, name);
      assert.ok(Math.abs(span[1] - expected[1]) < 1e-9, name);
    });
  }

  const chapter = JSON.parse(fs.readFileSync(path.join(sliceDir, "ch1_01_P.json"), "utf8")) as {
    windows_F: [string, number, number][];
    windows_owned: [string, number, number][];
  };
  const yi = chapter.windows_F.findIndex((window, index) => window[0] === "一" && index > 10);
  assert.equal(chapter.windows_F[yi]?.[0], "一");
  assert.equal(chapter.windows_owned[yi]?.[1], chapter.windows_F[yi]?.[1]);
});

test("digits become the Chinese numerals in the sentence, and multi-character words stay even", () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "tests/fixtures/stt_digits_ch1_01.json"), "utf8"),
  ) as {
    words: { text: string; start: number; end: number }[];
    text: string;
    expected_chars: string[];
    expected_times: [number, number][];
    num_cases: Record<string, string[]>;
  };
  const got = timedCharsFromWords2(fixture.words, fixture.text, tonelessReading);
  assert.deepEqual(got.graphChars, fixture.expected_chars);
  assert.equal(got.graphChars.join(""), "果果今年十三岁，是一名中学生，读中学一年级。");
  got.charTimes.forEach((span, i) => {
    assert.deepEqual(span, fixture.expected_times[i]);
  });
  for (const [digits, expected] of Object.entries(fixture.num_cases)) {
    assert.deepEqual(numToZh(digits), expected, digits);
  }
  const even = timedCharsFromWords2([{ text: "今年", start: 0, end: 1 }], "今年", tonelessReading);
  assert.deepEqual(even.graphChars, ["今", "年"]);
  assert.deepEqual(even.charTimes, [
    [0, 0.5],
    [0.5, 1],
  ]);
});
