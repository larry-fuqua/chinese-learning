import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import model from "../src/lib/tone-model.json";
import { contourFeatures, toneProbabilities } from "../src/lib/tone-model";

const BANNED = ["884d6d9a", "b9bee742", "owner-take"];

test("the learned checker matches the frozen training vectors", () => {
  assert.ok(model.checks.length >= 3);
  for (const check of model.checks) {
    const features = contourFeatures(check.c3, check.range, check.dur, check.prev);
    assert.ok(features.x, check.id);
    features.x.forEach((value, index) => {
      assert.ok(Math.abs(value - check.x[index]) < 1e-5, `${check.id} feature ${index}`);
    });
    const { proba } = toneProbabilities(features.x);
    proba.forEach((value, index) => {
      assert.ok(Math.abs(value - check.proba[index]) < 1e-5, `${check.id} proba ${index}`);
    });
  }
});

test("tone training excludes the owner take", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts/train-tone.py"), "utf8");
  assert.match(script, /EXCLUDED FROM TRAINING AND TUNING/);
  for (const token of BANNED) {
    assert.equal(script.includes(token), true, token);
    assert.equal(model.excluded.includes(token), true, token);
  }
  assert.match(script, /assert leaked == \[\]/);
  const blob = JSON.stringify(model);
  for (const token of BANNED) assert.equal(blob.includes(token) && model.excluded.includes(token), true);
  const rows = fs.readFileSync(path.join(process.cwd(), "scripts/data/tone-rows.json"), "utf8");
  for (const token of BANNED) assert.equal(rows.includes(token), false, token);
  assert.equal(model.trainedOn.includes("kind=ai"), true);
  assert.equal(model.nTrain > 0, true);
});
