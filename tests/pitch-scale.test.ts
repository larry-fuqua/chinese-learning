import assert from "node:assert/strict";
import { test } from "node:test";
import {
  binCenterX,
  characterPxPerSec,
  pitchPlotLayout,
  sentencePxPerSec,
  sharedPitchAxis,
  slotWidth,
  visibleTimeSpan,
} from "../src/lib/pitch-scale";

test("sentence slots share one milliseconds-per-pixel scale across the plot width", () => {
  const span = visibleTimeSpan([2]);
  const width = 200;
  const px = sentencePxPerSec(width, span);
  assert.equal(px, 100);
  const short = slotWidth(0.2, 0.4, span, width);
  const long = slotWidth(1, 1.4, span, width);
  assert.ok(Math.abs(short - 20) < 1e-9);
  assert.ok(Math.abs(long - 40) < 1e-9);
  assert.ok(Math.abs(short / 0.2 - px) < 1e-9);
  assert.ok(Math.abs(long / 0.4 - px) < 1e-9);
});

test("a hidden longer recording does not shrink the visible sentence", () => {
  const modelOnly = visibleTimeSpan([6.7]);
  const withUser = visibleTimeSpan([6.7, 17.4]);
  assert.equal(modelOnly, 6.7);
  assert.equal(withUser, 17.4);
  assert.equal(visibleTimeSpan([]), 0.2);
});

test("the per-character box uses one time scale and the longest syllable fills it", () => {
  const px = characterPxPerSec(100, [0.2, 0.5, 0.25]);
  assert.equal(px, 200);
  assert.ok(Math.abs(0.2 * px - 40) < 1e-9);
  assert.ok(Math.abs(0.5 * px - 100) < 1e-9);
  assert.equal(characterPxPerSec(0, [0.2]), 0);
  assert.equal(characterPxPerSec(100, []), 0);
});

test("contour bins stay on the character's own time axis", () => {
  const x0 = 10;
  const x1 = 50;
  const first = binCenterX(0, 16, x0, x1);
  const next = binCenterX(1, 16, x0, x1);
  assert.ok(first > x0 && first < next);
  assert.ok(Math.abs(next - first - (x1 - x0) / 16) < 1e-9);
});

test("the pitch axis fits the drawn range with padding and is shared", () => {
  const tight = sharedPitchAxis([[0, 0.2, null, 0.4]]);
  assert.ok(tight.min < 0);
  assert.ok(tight.max > 0.4);
  assert.ok(tight.max - tight.min < 2, String(tight.max - tight.min));
  const wide = sharedPitchAxis([[-8, -6, 0, 6, 8]]);
  assert.ok(wide.min < -8 && wide.max > 8);
  const pad = wide.max - wide.min - 16;
  assert.ok(pad > 0 && pad < 8);
  const flat = sharedPitchAxis([[null, null]]);
  assert.deepEqual(flat, { min: -4.5, max: 4.5 });
  const both = sharedPitchAxis([[0, 1], [-3, 4]]);
  assert.ok(both.min < -3 && both.max > 4);
});

test("character labels sit outside every pitch band", () => {
  const one = pitchPlotLayout({ width: 800, height: 176, showUser: false });
  assert.ok(one.ref.top + one.ref.height <= one.labels.top);
  assert.ok(one.ref.height > 100);
  assert.equal(one.gutter + one.plotWidth, 800);
  const two = pitchPlotLayout({ width: 800, height: 248, showUser: true });
  assert.ok(two.user);
  assert.ok(two.ref.top + two.ref.height <= two.user.top);
  assert.ok(two.user.top + two.user.height <= two.labels.top);
  assert.ok(two.ref.height > 80 && two.user.height > 80);
});
