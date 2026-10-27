import "./env";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { POST } from "../src/app/api/stories/[id]/definitions/route";
import { definitionKey } from "../src/lib/definitions";
import { deleteStory } from "../src/lib/story-store";
import { canDefineWord } from "../src/lib/text";
import { API_KEY, dataDir } from "./env";

const story = {
  id: "def-story",
  title: "Definitions",
  level: "HSK1",
  hanzi: "我是中学生。",
  sentences: [
    {
      id: "def-sentence",
      hanzi: "我是中学生。",
      pinyin: "wǒ shì zhōng xué shēng",
      words: [
        { hanzi: "我", pinyin: "wǒ" },
        { hanzi: "是", pinyin: "shì" },
        { hanzi: "中学生", pinyin: "zhōng xué shēng" },
      ],
    },
  ],
  notes: {},
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
};

function context() {
  return { params: Promise.resolve({ id: story.id }) };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/stories/def-story/definitions", {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context(),
  );
}

test("punctuation and other non-Han tokens are not defined", async () => {
  assert.equal(canDefineWord("中学生"), true);
  assert.equal(canDefineWord("，"), false);
  assert.equal(canDefineWord("。"), false);
  assert.equal(canDefineWord("13"), false);
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("no", { status: 500 });
  };
  try {
    const comma = await post({ sentenceId: "def-sentence", hanzi: "，" });
    assert.equal(comma.status, 400);
    const digits = await post({ sentenceId: "def-sentence", hanzi: "13" });
    assert.equal(digits.status, 400);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("a missing definition is generated once and reused for the same word and sentence", async () => {
  await fs.mkdir(path.join(dataDir, "stories"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "stories", `${story.id}.json`), JSON.stringify(story));
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    const url = String(input);
    assert.equal(url, "https://api.x.ai/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-xai-key-do-not-leak");
    const sent = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    assert.match(sent.messages[1].content, /中学生/);
    assert.match(sent.messages[1].content, /zhōng xué shēng/);
    assert.match(sent.messages[1].content, /我是中学生/);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                gloss: "middle-school student",
                usage: "In this sentence it names what the speaker is.",
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const first = await post({ sentenceId: "def-sentence", hanzi: "中学生", pinyin: "zhōng xué shēng" });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.gloss, "middle-school student");
    assert.equal(body.source, "ai");
    assert.equal(JSON.stringify(body).includes("test-xai-key-do-not-leak"), false);
    assert.equal(calls, 1);

    const second = await post({ sentenceId: "def-sentence", hanzi: "中学生", pinyin: "zhōng xué shēng" });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).gloss, "middle-school student");
    assert.equal(calls, 1);

    const hash = (await import("node:crypto")).createHash("sha256");
    const file = hash.update(definitionKey(story.id, "def-sentence", "中学生")).digest("hex");
    const stored = JSON.parse(
      await fs.readFile(path.join(dataDir, "definitions", story.id, `${file}.json`), "utf8"),
    );
    assert.equal(stored.source, "ai");
  } finally {
    globalThis.fetch = original;
    await deleteStory(story.id);
  }
});

test("an existing gloss is reused and an edit is stored without calling the model", async () => {
  const noted = {
    ...story,
    id: "def-noted",
    notes: {
      是: { pinyin: "shì", gloss: "to be", usage: "Links the speaker to the noun.", source: "sample" },
    },
  };
  await fs.mkdir(path.join(dataDir, "stories"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "stories", `${noted.id}.json`), JSON.stringify(noted));
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("no", { status: 500 });
  };
  const notedContext = { params: Promise.resolve({ id: noted.id }) };
  try {
    const reused = await POST(
      new Request("http://localhost/api/stories/def-noted/definitions", {
        method: "POST",
        headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ sentenceId: "def-sentence", hanzi: "是" }),
      }),
      notedContext,
    );
    assert.equal(reused.status, 200);
    const reusedBody = await reused.json();
    assert.equal(reusedBody.gloss, "to be");
    assert.equal(reusedBody.source, "sample");
    assert.equal(calls, 0);

    const edited = await POST(
      new Request("http://localhost/api/stories/def-noted/definitions", {
        method: "POST",
        headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          sentenceId: "def-sentence",
          hanzi: "是",
          pinyin: "shì",
          gloss: "is",
          usage: "The speaker uses it as a linking verb.",
          save: true,
        }),
      }),
      notedContext,
    );
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).source, "user");
    assert.equal(calls, 0);

    const again = await POST(
      new Request("http://localhost/api/stories/def-noted/definitions", {
        method: "POST",
        headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ sentenceId: "def-sentence", hanzi: "是" }),
      }),
      notedContext,
    );
    const againBody = await again.json();
    assert.equal(againBody.gloss, "is");
    assert.equal(againBody.source, "user");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    await deleteStory(noted.id);
    await assert.rejects(fs.access(path.join(dataDir, "definitions", noted.id)));
  }
});
