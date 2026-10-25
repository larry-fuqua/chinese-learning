import assert from "node:assert/strict";
import { test } from "node:test";
import {
  binCenterX,
  sentencePxPerSec,
  sharedPitchAxis,
  slotWidth,
} from "../src/lib/pitch-scale";

test("sentence slots and the zoom share one milliseconds-per-pixel scale", () => {
  const span = 2;
  const width = 200;
  const px = sentencePxPerSec(width, span);
  assert.equal(px, 100);
  const short = slotWidth(0.2, 0.4, span, width);
  const long = slotWidth(1, 1.4, span, width);
  assert.ok(Math.abs(short - 20) < 1e-9);
  assert.ok(Math.abs(long - 40) < 1e-9);
  assert.ok(Math.abs(short / 0.2 - px) < 1e-9);
  assert.ok(Math.abs(long / 0.4 - px) < 1e-9);
  assert.ok(Math.abs(0.2 * px - short) < 1e-9);
  assert.ok(Math.abs(0.4 * px - long) < 1e-9);
});

test("contour bins stay on the character's own time axis", () => {
  const x0 = 10;
  const x1 = 50;
  const first = binCenterX(0, 16, x0, x1);
  const next = binCenterX(1, 16, x0, x1);
  assert.ok(first > x0 && first < next);
  assert.ok(Math.abs(next - first - (x1 - x0) / 16) < 1e-9);
});

test("one pitch axis is shared and a small range is not stretched", () => {
  const tight = sharedPitchAxis([[0, 0.2, null, 0.4]]);
  assert.ok(tight.max - tight.min >= 4);
  const wide = sharedPitchAxis([[-8, -6, 0, 6, 8]]);
  assert.ok(wide.min < -4 && wide.max > 4);
  const flat = sharedPitchAxis([[null, null]]);
  assert.deepEqual(flat, { min: -4.5, max: 4.5 });
});
