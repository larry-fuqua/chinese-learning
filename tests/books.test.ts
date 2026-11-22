import "./env";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { POST as addChapter } from "../src/app/api/books/[id]/chapters/route";
import { DELETE as deleteBook, GET as getBook, PUT as putBook } from "../src/app/api/books/[id]/route";
import { GET as listBooks, POST as createBook } from "../src/app/api/books/route";
import { GET as exportStories } from "../src/app/api/stories/export/route";
import { POST as importStories } from "../src/app/api/stories/import/route";
import { DELETE, GET as getStory, PUT } from "../src/app/api/stories/[id]/route";
import { GET as listStories, POST as createStory } from "../src/app/api/stories/route";
import type { BookWithChapters, Story } from "../src/lib/types";
import { API_KEY, XAI_KEY } from "./env";

let dir = "";
const originalFetch = globalThis.fetch;

function authRequest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${API_KEY}`);
  return new Request(url, { ...init, headers });
}

function bookCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function storyCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "books-"));
  process.env.DATA_DIR = dir;
  await fs.writeFile(path.join(dir, ".seeded"), "1");
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await fs.rm(dir, { recursive: true, force: true });
});

function sentence(id: string, hanzi: string): Story["sentences"][number] {
  return { id, hanzi, pinyin: "", words: [{ hanzi: hanzi.replace(/。/g, ""), pinyin: "x" }, { hanzi: "。", pinyin: "" }] };
}

function storyBody(overrides: Partial<Story> = {}): Story {
  return {
    id: "ch-1",
    title: "第一章",
    level: "HSK1",
    hanzi: "我有一只猫。",
    sentences: [sentence("s1", "我有一只猫。")],
    notes: {},
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

test("book routes require auth", async () => {
  const list = await listBooks(new Request("http://localhost/api/books"));
  assert.equal(list.status, 401);
  const one = await getBook(new Request("http://localhost/api/books/hanyu-1"), bookCtx("hanyu-1"));
  assert.equal(one.status, 401);
  const chapter = await addChapter(new Request("http://localhost/api/books/hanyu-1/chapters", { method: "POST" }), bookCtx("hanyu-1"));
  assert.equal(chapter.status, 401);
});

test("books, ordered chapters, paragraphs, and detach on delete", async () => {
  const created = await createBook(
    authRequest("http://localhost/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "hanyu-1", title: "汉语教程", level: "HSK1", description: "First reader" }),
    }),
  );
  assert.equal(created.status, 201);
  const book = (await created.json()) as BookWithChapters;
  assert.equal(book.title, "汉语教程");
  assert.deepEqual(book.chapters, []);

  const missingBook = await createStory(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(storyBody({ bookId: "missing-book", chapterNumber: 1 })),
    }),
  );
  assert.equal(missingBook.status, 400);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(url.includes(XAI_KEY), false);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${XAI_KEY}`);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "模型标题",
                level: "HSK3",
                hanzi: "小明去公园。他看见一只猫。猫很可爱。",
                sentences: [
                  { hanzi: "小明去公园。", pinyin: "a", words: [{ hanzi: "小明", pinyin: "Xiǎomíng" }] },
                  { hanzi: "他看见一只猫。", pinyin: "b", words: [{ hanzi: "猫", pinyin: "māo" }] },
                  { hanzi: "猫很可爱。", pinyin: "c", words: [{ hanzi: "猫", pinyin: "māo" }] },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const bookFile = path.join(dir, "books", "hanyu-1.json");
  const storedBook = JSON.parse(await fs.readFile(bookFile, "utf8")) as { updatedAt: string };
  storedBook.updatedAt = "2020-01-01T00:00:00.000Z";
  await fs.writeFile(bookFile, JSON.stringify(storedBook));

  const first = await addChapter(
    authRequest("http://localhost/api/books/hanyu-1/chapters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "在公园",
        level: "HSK1",
        hanzi: "小明去公园。\n\n他看见一只猫。猫很可爱。",
      }),
    }),
    bookCtx("hanyu-1"),
  );
  const firstRaw = await first.text();
  assert.equal(first.status, 201, firstRaw);
  assert.equal(firstRaw.includes(XAI_KEY), false);
  const chapterOne = JSON.parse(firstRaw) as Story;
  assert.equal(chapterOne.bookId, "hanyu-1");
  assert.equal(chapterOne.chapterNumber, 1);
  assert.equal(chapterOne.chapterTitle, "在公园");
  assert.equal(chapterOne.title, "在公园");
  assert.equal(chapterOne.level, "HSK1");
  assert.match(chapterOne.hanzi, /\n\n/);
  assert.equal(chapterOne.paragraphs?.length, 2);
  assert.equal(chapterOne.paragraphs?.[0]?.length, 1);
  assert.equal(chapterOne.paragraphs?.[1]?.length, 2);
  const touched = JSON.parse(await fs.readFile(bookFile, "utf8")) as { updatedAt: string };
  assert.notEqual(touched.updatedAt, "2020-01-01T00:00:00.000Z");

  const second = await createStory(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        storyBody({
          id: "ch-2",
          title: "第二章",
          bookId: "hanyu-1",
          chapterNumber: 2,
          chapterTitle: "猫",
          hanzi: "我有一只猫。\n它很可爱。",
          sentences: [sentence("s1", "我有一只猫。"), sentence("s2", "它很可爱。")],
        }),
      ),
    }),
  );
  assert.equal(second.status, 201);
  const chapterTwo = (await second.json()) as Story;
  assert.equal(chapterTwo.bookId, "hanyu-1");
  assert.equal(chapterTwo.chapterNumber, 2);
  assert.equal(chapterTwo.paragraphs, undefined);

  const withBreaks = await createStory(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        storyBody({
          id: "breaks",
          title: "分段",
          hanzi: "我有一只猫。\n\n它很可爱。",
          sentences: [sentence("s1", "我有一只猫。"), sentence("s2", "它很可爱。")],
        }),
      ),
    }),
  );
  assert.equal(withBreaks.status, 201);
  const broken = (await withBreaks.json()) as Story;
  assert.equal(broken.bookId, undefined);
  assert.deepEqual(broken.paragraphs, [["s1"], ["s2"]]);
  const listed = await listStories(authRequest("http://localhost/api/stories"));
  const summaries = (await listed.json()) as Record<string, unknown>[];
  const alone = summaries.find((row) => row.id === "breaks");
  assert.deepEqual(Object.keys(alone ?? {}).sort(), ["createdAt", "id", "level", "title", "updatedAt"]);
  const chapterSummary = summaries.find((row) => row.id === "ch-2");
  assert.equal(chapterSummary?.bookId, "hanyu-1");
  assert.equal(chapterSummary?.chapterNumber, 2);

  const badParagraphs = await createStory(
    authRequest("http://localhost/api/stories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(storyBody({ id: "bad-p", paragraphs: [["nope"]] })),
    }),
  );
  assert.equal(badParagraphs.status, 400);

  const duplicate = await addChapter(
    authRequest("http://localhost/api/books/hanyu-1/chapters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(storyBody({ id: "dup", chapterNumber: 1, bookId: "hanyu-1" })),
    }),
    bookCtx("hanyu-1"),
  );
  assert.equal(duplicate.status, 409);

  const wrongBook = await addChapter(
    authRequest("http://localhost/api/books/hanyu-1/chapters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x", level: "HSK1", hanzi: "猫。", bookId: "other" }),
    }),
    bookCtx("hanyu-1"),
  );
  assert.equal(wrongBook.status, 400);

  const fetched = await getBook(authRequest("http://localhost/api/books/hanyu-1"), bookCtx("hanyu-1"));
  const withChapters = (await fetched.json()) as BookWithChapters;
  assert.deepEqual(
    withChapters.chapters.map((chapter) => chapter.chapterNumber),
    [1, 2],
  );
  assert.equal(withChapters.chapters[0]?.chapterTitle, "在公园");
  assert.equal(JSON.stringify(withChapters.chapters).includes("小明去公园"), false);

  const renamed = await putBook(
    authRequest("http://localhost/api/books/hanyu-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "汉语教程 一", level: "HSK2" }),
    }),
    bookCtx("hanyu-1"),
  );
  assert.equal(renamed.status, 200);
  const renamedBook = (await renamed.json()) as BookWithChapters;
  assert.equal(renamedBook.title, "汉语教程 一");
  assert.equal(renamedBook.createdAt, book.createdAt);
  assert.equal(renamedBook.description, undefined);

  const removed = await deleteBook(authRequest("http://localhost/api/books/hanyu-1"), bookCtx("hanyu-1"));
  assert.equal(removed.status, 200);
  const detached = (await removed.json()) as { ok: boolean; detached: string[] };
  assert.equal(detached.ok, true);
  assert.deepEqual(detached.detached.sort(), [chapterOne.id, "ch-2"].sort());
  const still = await getStory(authRequest(`http://localhost/api/stories/${chapterOne.id}`), storyCtx(chapterOne.id));
  const kept = (await still.json()) as Story;
  assert.equal(kept.hanzi, chapterOne.hanzi);
  assert.equal(kept.bookId, undefined);
  assert.equal(kept.chapterNumber, undefined);
  const gone = await getBook(authRequest("http://localhost/api/books/hanyu-1"), bookCtx("hanyu-1"));
  assert.equal(gone.status, 404);

  const imported = await importStories(
    authRequest("http://localhost/api/stories/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        books: [{ id: "reader-1", title: "Reader", level: "HSK2", createdAt: "2026-02-02T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z" }],
        stories: [storyBody({ id: "imported-ch", bookId: "reader-1", chapterNumber: 3, title: "Imported" })],
      }),
    }),
  );
  assert.deepEqual(await imported.json(), { imported: 1, skipped: 0 });
  const exported = await exportStories(authRequest("http://localhost/api/stories/export"));
  const payload = (await exported.json()) as { version: number; books: { id: string }[]; stories: Story[] };
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.books.map((item) => item.id), ["reader-1"]);
  assert.equal(payload.stories.find((item) => item.id === "imported-ch")?.chapterNumber, 3);

  await DELETE(authRequest(`http://localhost/api/stories/${chapterOne.id}`), storyCtx(chapterOne.id));
  const edited = await PUT(
    authRequest("http://localhost/api/stories/ch-2", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(storyBody({ id: "ch-2", title: "不再是章节", hanzi: "它很可爱。" })),
    }),
    storyCtx("ch-2"),
  );
  assert.equal(edited.status, 200);
  assert.equal(((await edited.json()) as Story).bookId, undefined);
});

test("the first request copies story JSON once and does not rewrite it", async () => {
  const storiesDir = path.join(dir, "stories");
  const audioDir = path.join(dir, "audio");
  await fs.mkdir(storiesDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });
  const original = JSON.stringify({
    id: "keep-me",
    title: "留",
    level: "HSK1",
    hanzi: "甲。\n\n乙。",
    sentences: [sentence("s1", "甲。"), sentence("s2", "乙。")],
    notes: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const storyPath = path.join(storiesDir, "keep-me.json");
  await fs.writeFile(storyPath, original);
  await fs.writeFile(path.join(audioDir, "clip.wav"), "not-a-story");

  const first = await getStory(authRequest("http://localhost/api/stories/keep-me"), storyCtx("keep-me"));
  assert.equal(first.status, 200);
  const body = (await first.json()) as Story;
  assert.equal(body.paragraphs, undefined);
  assert.equal(body.hanzi, "甲。\n\n乙。");
  assert.equal(await fs.readFile(storyPath, "utf8"), original);

  const backups = await fs.readdir(path.join(dir, "backups"));
  assert.equal(backups.length, 1);
  assert.match(backups[0] ?? "", /books-paragraphs-v1$/);
  const copied = await fs.readFile(path.join(dir, "backups", backups[0] ?? "", "stories", "keep-me.json"), "utf8");
  assert.equal(copied, original);
  await assert.rejects(fs.access(path.join(dir, "backups", backups[0] ?? "", "audio")));
  await fs.access(path.join(dir, ".migrations", "books-paragraphs-v1"));

  await getStory(authRequest("http://localhost/api/stories/keep-me"), storyCtx("keep-me"));
  assert.deepEqual(await fs.readdir(path.join(dir, "backups")), backups);
  assert.equal(await fs.readFile(storyPath, "utf8"), original);
});

test("an empty data directory records the migration without a backup folder", async () => {
  const response = await listStories(authRequest("http://localhost/api/stories"));
  assert.equal(response.status, 200);
  await fs.access(path.join(dir, ".migrations", "books-paragraphs-v1"));
  await assert.rejects(fs.access(path.join(dir, "backups")));
});
