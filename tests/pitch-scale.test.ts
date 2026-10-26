import assert from "node:assert/strict";
import { test } from "node:test";
import {
  binCenterX,
  characterPxPerSec,
  LABEL_MIN_GAP,
  laneTime,
  laneX,
  pitchPlotLayout,
  sentencePxPerSec,
  separateLabelCenters,
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

test("each lane keeps its own labels clear of its traces", () => {
  const one = pitchPlotLayout({ width: 800, height: 176, showUser: false });
  assert.equal(one.user, null);
  assert.equal(one.userLabels, null);
  assert.ok(one.ref.top + one.ref.height <= one.refLabels.top);
  assert.ok(one.ref.height > 100);
  assert.equal(one.gutter + one.plotWidth, 800);
  const two = pitchPlotLayout({ width: 800, height: 290, showUser: true });
  assert.ok(two.user && two.userLabels);
  assert.ok(two.ref.top + two.ref.height <= two.refLabels.top);
  assert.ok(two.refLabels.top + two.refLabels.height <= two.user.top);
  assert.ok(two.user.top + two.user.height <= two.userLabels.top);
  assert.ok(two.ref.height > 90 && two.user.height > 90);
  assert.ok(Math.abs(two.ref.height - two.user.height) < 1e-9);
});

test("each voice fits its own sentence across the full plot width", () => {
  const width = 300;
  const left = 36;
  const model = laneTime({ starts: [0.2, 1.0], ends: [0.5, 1.4] });
  const user = laneTime({ starts: [1.0, 8.0], ends: [1.6, 9.2] });
  assert.equal(model.origin, 0.2);
  assert.ok(Math.abs(model.span - 1.2) < 1e-9);
  assert.equal(user.origin, 1.0);
  assert.ok(Math.abs(user.span - 8.2) < 1e-9);
  assert.ok(Math.abs(laneX(model.origin, model, left, width) - left) < 1e-9);
  assert.ok(Math.abs(laneX(model.origin + model.span, model, left, width) - (left + width)) < 1e-9);
  assert.ok(Math.abs(laneX(user.origin, user, left, width) - left) < 1e-9);
  assert.ok(Math.abs(laneX(user.origin + user.span, user, left, width) - (left + width)) < 1e-9);
  const modelSlot = laneX(0.5, model, left, width) - laneX(0.2, model, left, width);
  const userSlot = laneX(1.6, user, left, width) - laneX(1.0, user, left, width);
  assert.ok(Math.abs(modelSlot - (0.3 / 1.2) * width) < 1e-6);
  assert.ok(Math.abs(userSlot - (0.6 / 8.2) * width) < 1e-6);
  assert.ok(modelSlot > userSlot);
  const modelLate = laneX(1.0, model, left, width);
  assert.ok(modelLate > left + width * 0.5);
  assert.equal(laneTime({ starts: [], ends: [] }).span, 0.2);
});

test("close labels step aside and spaced labels stay on their slices", () => {
  const nudged = separateLabelCenters({
    ideal: [100, 108],
    widths: [14, 14],
    left: 0,
    right: 400,
    minGap: LABEL_MIN_GAP,
  });
  assert.ok(Math.abs(nudged[0]! - 100) < 1e-9);
  assert.ok(nudged[1]! - nudged[0]! >= 14 + LABEL_MIN_GAP - 1e-9);
  const spaced = separateLabelCenters({
    ideal: [40, 200],
    widths: [14, 14],
    left: 0,
    right: 400,
    minGap: LABEL_MIN_GAP,
  });
  assert.deepEqual(spaced, [40, 200]);
  const packed = separateLabelCenters({
    ideal: [10, 10, 10, 10, 10],
    widths: [20, 20, 20, 20, 20],
    left: 0,
    right: 100,
    minGap: 8,
  });
  assert.ok(packed[0]! >= 10 - 1e-9);
  assert.ok(packed[4]! <= 90 + 1e-9);
  for (let i = 1; i < packed.length; i++) {
    assert.ok(packed[i]! - packed[i - 1]! >= 20 - 1e-6);
  }
});
