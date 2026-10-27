import "./env";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { GET, PUT } from "../src/app/api/stories/[id]/practice/[sentenceId]/[index]/route";
import { classifyTone } from "../src/lib/pitch";
import {
  drawnPracticeContour,
  practiceFeedback,
  practiceFeedbackLines,
  practicePlotAxis,
  practiceWindowSec,
  voicedTimeRange,
  toneGraphModel,
  toneGraphUser,
  voicedSpan,
} from "../src/lib/practice-graph";
import { deleteStory } from "../src/lib/story-store";
import { spokenReading } from "../src/lib/text";
import { ttsCacheKey } from "../src/lib/tts-key";
import { API_KEY, dataDir } from "./env";

const falling = [-0.2, -0.5, -0.8, -1.2, -1.6, -2.0, -2.3, -2.6, -2.8, -3.0];
const rising = [-2.2, -1.8, -1.2, -0.6, 0, 0.4, 0.9, 1.3, 1.7, 2.1];

test("contextual pinyin keeps the tone the sentence already uses", () => {
  assert.equal(spokenReading("xue", 2), "xué");
  assert.equal(spokenReading("xué", 2), "xué");
  assert.equal(spokenReading("yi", 2), "yí");
  assert.equal(spokenReading("guo", 3), "guǒ");
  assert.equal(spokenReading("xué", 5), "xue");
  assert.equal(spokenReading("lü", 4), "lǜ");
});

test("practice speech is cached by character, contextual pinyin, and voice", () => {
  assert.equal(ttsCacheKey("学", 0.85, "xué"), "eve|zh|24000|0.85|学|xué");
  assert.equal(ttsCacheKey("果果今年十三岁。", 0.85), "eve|zh|24000|0.85|果果今年十三岁。");
  assert.notEqual(ttsCacheKey("学", 0.85, "xué"), ttsCacheKey("学", 0.85, "xuě"));
  assert.notEqual(ttsCacheKey("学", 0.85, "xué"), ttsCacheKey("学", 0.85));
});

test("the tone graph uses the clean clip and hides You until a recite", () => {
  const slice = [0, 0, 0, 0, 0, 0];
  assert.deepEqual(toneGraphModel(slice, null), slice);
  assert.deepEqual(toneGraphModel(slice, [null, null, null]), slice);
  assert.deepEqual(toneGraphModel(slice, rising), rising);
  assert.equal(toneGraphUser(null), null);
  assert.equal(toneGraphUser([null, null]), null);
  assert.deepEqual(toneGraphUser(rising), rising);
});

test("a practice clip is trimmed to its voiced run and shares one scale", () => {
  const quietRise = [
    null, null, null, null,
    -2.2, -1.4, -0.4, 0.6, 1.4, 2.2,
    null, null, null, null, null, null,
  ];
  const quietFall = [
    null, null,
    2.0, 1.2, 0.2, -0.8, -1.6, -2.4,
    null, null, null, null, null, null, null, null,
  ];
  const riseSpan = voicedSpan(quietRise);
  assert.deepEqual(riseSpan, { start: 3, end: 10 });
  const drawn = drawnPracticeContour(quietRise);
  assert.equal(drawn.length, 8);
  assert.equal(drawn.includes(2.2), true);
  assert.equal(drawn.includes(null), true);
  assert.equal(classifyTone(drawn), 2);
  assert.equal(classifyTone(drawn), classifyTone(quietRise));
  const note = practiceFeedback({
    who: "model",
    expectedTone: 2,
    heardTone: 4,
    pExpected: 0.2,
    contour: drawn,
  });
  assert.match(note, /shape matches/);
  assert.equal(note.includes("shape is off"), false);
  const axis = practicePlotAxis([drawn, drawnPracticeContour(quietFall)]);
  assert.ok(axis.min < -2.4);
  assert.ok(axis.max > 2.2);
  assert.ok(axis.max - axis.min < 12);
  const longTake = practiceWindowSec(quietFall, 2.6);
  assert.ok(longTake < 2.6);
  assert.ok(longTake > 0.4);
  const range = voicedTimeRange(
    [
      { t: 0.2, hz: null },
      { t: 1.1, hz: 140 },
      { t: 1.5, hz: 220 },
      { t: 2.2, hz: null },
    ],
    2.6,
  );
  assert.ok(range);
  assert.ok(range.start >= 1.0 && range.start < 1.1);
  assert.ok(range.end > 1.5 && range.end <= 1.6);
});

test("practice feedback follows the drawn contour", () => {
  assert.equal(classifyTone(falling), 4);
  assert.equal(classifyTone(rising), 2);
  const wrong = practiceFeedback({
    who: "yours",
    expectedTone: 2,
    heardTone: 2,
    pExpected: 0.9,
    contour: falling,
  });
  assert.match(wrong, /shape is off/);
  assert.equal(wrong.includes("shape matches"), false);
  assert.match(wrong, /yours 4th · falling/);
  const wrongLines = practiceFeedbackLines({
    who: "yours",
    expectedTone: 2,
    heardTone: 2,
    pExpected: 0.9,
    contour: falling,
  });
  assert.deepEqual(wrongLines, [
    "Tone 2 · 2nd · rising",
    "yours 4th · falling",
    "shape is off",
  ]);
  assert.equal(wrongLines.join(" · "), wrong);
  const right = practiceFeedback({
    who: "yours",
    expectedTone: 2,
    heardTone: 2,
    pExpected: 0.8,
    contour: rising,
  });
  assert.match(right, /shape matches/);
  const flat = [0, 0.05, -0.05, 0.1, -0.1, 0, 0.08, -0.04, 0.02, 0];
  assert.equal(classifyTone(flat), 1);
  const flatNote = practiceFeedback({
    who: "yours",
    expectedTone: 2,
    heardTone: 2,
    pExpected: 0.9,
    contour: flat,
  });
  assert.match(flatNote, /yours 1st · flat/);
  assert.match(flatNote, /shape is off/);
  assert.equal(flatNote.includes("shape matches"), false);
});

const story = {
  id: "practice-story",
  title: "Practice",
  level: "HSK1",
  hanzi: "学。",
  sentences: [
    {
      id: "practice-sentence",
      hanzi: "学。",
      pinyin: "xué",
      words: [{ hanzi: "学", pinyin: "xué" }],
    },
  ],
  notes: {},
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
};

test("a character recite is saved beside the sentence take and removed with the story", async () => {
  await fs.mkdir(path.join(dataDir, "stories"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "stories", `${story.id}.json`), JSON.stringify(story));
  const context = {
    params: Promise.resolve({ id: story.id, sentenceId: "practice-sentence", index: "3" }),
  };
  const form = new FormData();
  form.set("file", new Blob([Uint8Array.from([1, 2, 3, 4])], { type: "audio/wav" }), "practice.wav");
  form.set(
    "stt",
    JSON.stringify({
      text: "学",
      duration: 0.4,
      sampleRate: 16000,
      words: [{ text: "学", start: 0, end: 0.4 }],
    }),
  );
  const saved = await PUT(
    new Request("http://localhost/api/stories/practice-story/practice/practice-sentence/3", {
      method: "PUT",
      headers: { authorization: `Bearer ${API_KEY}` },
      body: form,
    }),
    context,
  );
  assert.equal(saved.status, 200);
  const read = await GET(
    new Request("http://localhost/api/stories/practice-story/practice/practice-sentence/3", {
      headers: { authorization: `Bearer ${API_KEY}` },
    }),
    context,
  );
  assert.equal(read.status, 200);
  const body = await read.json();
  assert.equal(body.text, "学");
  await assert.rejects(
    fs.access(path.join(dataDir, "takes", story.id, "practice-sentence.json")),
  );
  const practiceFile = path.join(dataDir, "takes", story.id, "practice", "practice-sentence", "3.json");
  assert.equal((await fs.stat(practiceFile)).isFile(), true);

  assert.equal(await deleteStory(story.id), true);
  await assert.rejects(fs.access(path.join(dataDir, "takes", story.id)));
});
