import "./env";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import * as exporter from "../src/app/api/stories/export/route";
import { DELETE, GET as getStory, PUT } from "../src/app/api/stories/[id]/route";
import * as importer from "../src/app/api/stories/import/route";
import * as stories from "../src/app/api/stories/route";
import { MAX_STORY_BYTES } from "../src/lib/http";
import type { Story } from "../src/lib/types";
import { API_KEY, XAI_KEY, bearer } from "./env";

let dir = "";
const originalFetch = globalThis.fetch;

function authRequest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${API_KEY}`);
  return new Request(url, { ...init, headers });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "stories-"));
  process.env.DATA_DIR = dir;
  await fs.writeFile(path.join(dir, ".seeded"), "1");
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await fs.rm(dir, { recursive: true, force: true });
});

function fullStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "cat-story",
    title: "一只猫",
    level: "HSK1",
    hanzi: "我有一只猫。",
    sentences: [
      {
        id: "s1",
        hanzi: "我有一只猫。",
        pinyin: "Wǒ yǒu yī zhī māo.",
        words: [
          { hanzi: "我", pinyin: "wǒ" },
          { hanzi: "有", pinyin: "yǒu" },
          { hanzi: "一只", pinyin: "yī zhī" },
          { hanzi: "猫", pinyin: "māo" },
          { hanzi: "。", pinyin: "" },
        ],
      },
    ],
    notes: {
      猫: { pinyin: "māo", gloss: "cat", usage: "一只猫", source: "user" },
    },
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

test("CRUD, list shape, validation, and import/export", async () => {
  const created = await stories.POST(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fullStory()),
    }),
  );
  assert.equal(created.status, 201);
  const story = (await created.json()) as Story;
  assert.equal(story.id, "cat-story");
  assert.equal(story.notes["猫"]?.gloss, "cat");
  assert.notEqual(story.updatedAt, "2026-01-02T00:00:00.000Z");

  const duplicate = await stories.POST(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fullStory()),
    }),
  );
  assert.equal(duplicate.status, 409);

  const list = await stories.GET(authRequest("http://localhost/api/stories"));
  assert.equal(list.status, 200);
  const summaries = (await list.json()) as Record<string, string>[];
  assert.equal(summaries.length, 1);
  assert.deepEqual(Object.keys(summaries[0] ?? {}).sort(), [
    "createdAt",
    "id",
    "level",
    "title",
    "updatedAt",
  ]);
  assert.equal(JSON.stringify(summaries).includes("我有一只猫"), false);

  const fetched = await getStory(authRequest("http://localhost/api/stories/cat-story"), ctx("cat-story"));
  assert.equal(fetched.status, 200);
  assert.equal(((await fetched.json()) as Story).sentences[0]?.words[3]?.pinyin, "māo");

  const replaced = await PUT(
    authRequest("http://localhost/api/stories/cat-story", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fullStory({ title: "两只猫", hanzi: "我有两只猫。", createdAt: "1999-01-01T00:00:00.000Z" })),
    }),
    ctx("cat-story"),
  );
  assert.equal(replaced.status, 200);
  const next = (await replaced.json()) as Story;
  assert.equal(next.title, "两只猫");
  assert.equal(next.createdAt, story.createdAt);
  assert.notEqual(next.updatedAt, story.updatedAt);

  const mismatch = await PUT(
    authRequest("http://localhost/api/stories/cat-story", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fullStory({ id: "other-id" })),
    }),
    ctx("cat-story"),
  );
  assert.equal(mismatch.status, 400);

  const missingSentences = await PUT(
    authRequest("http://localhost/api/stories/cat-story", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "两只猫", level: "HSK1", hanzi: "我有两只猫。" }),
    }),
    ctx("cat-story"),
  );
  assert.equal(missingSentences.status, 400);

  const badLevel = await stories.POST(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "猫", level: "hsk1", hanzi: "猫。" }),
    }),
  );
  assert.equal(badLevel.status, 400);
  assert.match((await badLevel.json()).error, /level/);

  const missingHanzi = await stories.POST(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "猫", level: "HSK1" }),
    }),
  );
  assert.equal(missingHanzi.status, 400);

  const removed = await DELETE(authRequest("http://localhost/api/stories/cat-story"), ctx("cat-story"));
  assert.equal(removed.status, 200);
  const gone = await getStory(authRequest("http://localhost/api/stories/cat-story"), ctx("cat-story"));
  assert.equal(gone.status, 404);

  const imported = await importer.POST(
    authRequest("http://localhost/api/stories/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        stories: [fullStory(), { id: "skip-me" }, fullStory({ id: "dog-story", title: "狗" })],
      }),
    }),
  );
  assert.equal(imported.status, 200);
  assert.deepEqual(await imported.json(), { imported: 2, skipped: 1 });

  const exported = await exporter.GET(authRequest("http://localhost/api/stories/export"));
  const payload = (await exported.json()) as { version: number; stories: Story[] };
  assert.equal(payload.version, 1);
  assert.deepEqual(
    payload.stories.map((item) => item.id).sort(),
    ["cat-story", "dog-story"],
  );
  assert.equal(payload.stories.find((item) => item.id === "cat-story")?.sentences.length, 1);

  const badVersion = await importer.POST(
    authRequest("http://localhost/api/stories/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2, stories: [] }),
    }),
  );
  assert.equal(badVersion.status, 400);
});

test("rejects oversized story bodies", async () => {
  const response = await stories.POST(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(MAX_STORY_BYTES + 1),
    }),
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /exceeds/);
});

test("fresh data directory seeds the sample story once", async () => {
  await fs.rm(path.join(dir, ".seeded"));
  const first = await stories.GET(authRequest("http://localhost/api/stories"));
  const rows = (await first.json()) as { id: string }[];
  assert.deepEqual(rows.map((row) => row.id), ["sample-xiaoming"]);
  await DELETE(authRequest("http://localhost/api/stories/sample-xiaoming"), ctx("sample-xiaoming"));
  const second = await stories.GET(authRequest("http://localhost/api/stories"));
  assert.deepEqual(await second.json(), []);
});

test("minimal POST runs prepare and does not leak the xAI key", async () => {
  const calls: { url: string; authorization: string | null; body: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get("authorization"), body: String(init?.body ?? "") });
    assert.equal(url.includes(XAI_KEY), false);
    assert.equal(JSON.stringify(init ?? {}).includes("XAI_API_KEY="), false);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "模型标题",
                level: "HSK3",
                hanzi: "我有一只猫。",
                sentences: [
                  {
                    hanzi: "我有一只猫。",
                    pinyin: "Wǒ yǒu yī zhī māo.",
                    words: [
                      { hanzi: "我", pinyin: "wǒ" },
                      { hanzi: "有", pinyin: "yǒu" },
                      { hanzi: "一只", pinyin: "yī zhī" },
                      { hanzi: "猫", pinyin: "māo" },
                      { hanzi: "。", pinyin: "" },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const response = await stories.POST(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "我的猫", level: "HSK1", hanzi: "我有一只猫。" }),
    }),
  );
  const raw = await response.text();
  assert.equal(response.status, 201, raw);
  assert.equal(raw.includes(XAI_KEY), false);
  const story = JSON.parse(raw) as Story;
  assert.equal(story.title, "我的猫");
  assert.equal(story.level, "HSK1");
  assert.equal(story.hanzi, "我有一只猫。");
  assert.equal(story.sentences.length, 1);
  assert.equal(story.sentences[0]?.words.find((word) => word.hanzi === "猫")?.pinyin, "māo");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(calls[0]?.authorization, `Bearer ${XAI_KEY}`);
  assert.match(calls[0]?.body ?? "", /我有一只猫/);

  globalThis.fetch = async () => new Response(`upstream leaked ${XAI_KEY}`, { status: 502 });
  const failed = await stories.POST(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "失败", level: "HSK2", hanzi: "今天天气很好。" }),
    }),
  );
  const failedBody = await failed.text();
  assert.equal(failed.status, 502);
  assert.equal(failedBody.includes(XAI_KEY), false);
  assert.match(failedBody, /redacted/);
});

test("a full story POST does not call xAI", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("xAI should not be called");
  };
  const response = await stories.POST(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fullStory({ id: "no-model" })),
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(called, false);
});

test("bearer header is required when no session cookie is sent", async () => {
  const response = await stories.GET(new Request("http://localhost/api/stories"));
  assert.equal(response.status, 401);
  const ok = await stories.GET(
    new Request("http://localhost/api/stories", { headers: bearer() }),
  );
  assert.equal(ok.status, 200);
});
