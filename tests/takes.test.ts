import "./env";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { GET, PUT } from "../src/app/api/stories/[id]/takes/[sentenceId]/route";
import { deleteStory } from "../src/lib/story-store";
import { API_KEY, dataDir } from "./env";

const story = {
  id: "take-story",
  title: "Take",
  level: "HSK1",
  hanzi: "果。",
  sentences: [
    {
      id: "s1",
      hanzi: "果。",
      pinyin: "guǒ",
      words: [{ hanzi: "果", pinyin: "guǒ" }],
    },
  ],
  notes: {},
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
};

function wav(byte: number): Blob {
  return new Blob([Uint8Array.from([byte, byte, byte, byte])], { type: "audio/wav" });
}

function context(sentenceId = "s1") {
  return { params: Promise.resolve({ id: story.id, sentenceId }) };
}

test("the last take is stored on the server and replaces the previous one", async () => {
  await fs.mkdir(path.join(dataDir, "stories"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "stories", `${story.id}.json`), JSON.stringify(story));

  const denied = await GET(new Request("http://localhost/api/stories/take-story/takes/s1"), context());
  assert.equal(denied.status, 401);

  const missing = await GET(
    new Request("http://localhost/api/stories/take-story/takes/s1", {
      headers: { authorization: `Bearer ${API_KEY}` },
    }),
    context(),
  );
  assert.equal(missing.status, 404);

  async function put(byte: number, text: string) {
    const form = new FormData();
    form.append("file", wav(byte), "recite.wav");
    form.append(
      "stt",
      JSON.stringify({
        text,
        duration: 0.4,
        sampleRate: 16000,
        words: [{ text: "果", start: 0.05, end: 0.3 }],
      }),
    );
    return PUT(
      new Request("http://localhost/api/stories/take-story/takes/s1", {
        method: "PUT",
        headers: { authorization: `Bearer ${API_KEY}` },
        body: form,
      }),
      context(),
    );
  }

  const first = await put(1, "果");
  assert.equal(first.status, 200);
  const second = await put(9, "果果");
  assert.equal(second.status, 200);

  const names = await fs.readdir(path.join(dataDir, "takes", story.id));
  assert.deepEqual(names, ["s1.json"]);

  const loaded = await GET(
    new Request("http://localhost/api/stories/take-story/takes/s1", {
      headers: { authorization: `Bearer ${API_KEY}` },
    }),
    context(),
  );
  assert.equal(loaded.status, 200);
  const body = await loaded.json();
  assert.equal(body.text, "果果");
  assert.equal(body.words[0].text, "果");
  assert.equal(Buffer.from(body.audioBase64, "base64")[0], 9);

  const unknown = await PUT(
    new Request("http://localhost/api/stories/take-story/takes/missing", {
      method: "PUT",
      headers: { authorization: `Bearer ${API_KEY}` },
      body: new FormData(),
    }),
    context("missing"),
  );
  assert.equal(unknown.status, 404);

  assert.equal(await deleteStory(story.id), true);
  await assert.rejects(fs.access(path.join(dataDir, "takes", story.id)));
});
