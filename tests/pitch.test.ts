import assert from "node:assert/strict";
import { test } from "node:test";
import { sliceContour, strokeWithGaps } from "../src/lib/pitch";
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
