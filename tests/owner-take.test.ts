import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { windowSpansPause, windowsFromAlignment, type AlignSpan } from "../src/lib/align-audio";
import { decodeWavPcm16 } from "../src/lib/wav";

/**
 * Timing fixture only. Sentence 884d6d9a in story b9bee742.
 * The tone checker must not train or tune on this recording.
 */
test("owner take windows overlap the hand-marked character spans", () => {
  const dir = path.join(process.cwd(), "tests/fixtures/owner-take");
  const fixture = JSON.parse(fs.readFileSync(path.join(dir, "fixture.json"), "utf8")) as {
    storyId: string;
    sentenceId: string;
    text: string;
    bounds: [number, number][];
    spans: AlignSpan[];
  };
  assert.equal(fixture.storyId.startsWith("b9bee742"), true);
  assert.equal(fixture.sentenceId.startsWith("884d6d9a"), true);
  const wav = fs.readFileSync(path.join(dir, "take.wav"));
  const audio = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
  const { samples, sampleRate } = decodeWavPcm16(audio);
  const windows = windowsFromAlignment(fixture.text, fixture.spans, samples, sampleRate);
  assert.equal(windows.length, fixture.bounds.length);
  let covered = 0;
  let marked = 0;
  windows.forEach((window, index) => {
    const [start, end] = fixture.bounds[index];
    const own = overlap(window.start, window.end, start, end);
    const man = end - start;
    assert.ok(own > 0, `${window.hanzi} ${index} misses ${start}-${end}`);
    assert.ok(own / man >= 0.6, `${window.hanzi} covers ${own / man}`);
    covered += own;
    marked += man;
    fixture.bounds.forEach(([otherStart, otherEnd], other) => {
      if (other === index) return;
      const borrowed = overlap(window.start, window.end, otherStart, otherEnd);
      assert.ok(
        borrowed <= 0.05,
        `${window.hanzi} holds ${borrowed.toFixed(3)}s of ${fixture.spans[other]?.char}`,
      );
    });
    assert.equal(
      windowSpansPause(window.start, window.end, samples, sampleRate),
      false,
      `${window.hanzi} spans a pause`,
    );
  });
  const share = covered / marked;
  assert.ok(share >= 0.85, `own-audio share ${share}`);
});

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}
