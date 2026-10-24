# Story API

Base URL when the app is behind the homebrain proxy:

```text
https://homebrain.tail956d87.ts.net/chinese
```

Every path below is under that prefix (`/chinese/api/...`). A local server with `BASE_PATH` empty uses the same paths without `/chinese`.

## Auth

Send the shared key from `READER_API_KEY`:

```http
Authorization: Bearer $READER_API_KEY
```

The browser session cookie (`reader_session`) is also accepted. These routes do **not** accept the passcode itself.

| Route | Auth |
| --- | --- |
| `GET /api/health` | none |
| `POST /api/auth/login` | passcode in the JSON body |
| everything else under `/api` | bearer key or session cookie |

Unauthenticated calls get `401 {"error":"Unauthorized"}`.

There is no xAI key in this API. `XAI_API_KEY` stays on the server. Minimal creates call xAI from the server to fill sentences, pinyin, and words.

Request bodies are limited to **1 MB**. Larger bodies return `400`.

## Health

```bash
curl -fsS "$BASE/api/health"
```

```json
{ "ok": true }
```

## List

`GET /api/stories`

Returns summaries only, newest `updatedAt` first. A brand-new data directory includes the bundled sample `sample-xiaoming` until it is deleted.

```bash
curl -fsS "$BASE/api/stories" \
  -H "Authorization: Bearer $READER_API_KEY"
```

```json
[
  {
    "id": "sample-xiaoming",
    "title": "小明的一天",
    "level": "HSK1",
    "createdAt": "2026-08-17T00:00:00.000Z",
    "updatedAt": "2026-08-17T00:00:00.000Z"
  }
]
```

`level` is `HSK1`, `HSK2`, `HSK3`, or `other`.

A chapter also includes `bookId`, `chapterNumber`, and `chapterTitle` when that story belongs to a book. Standalone stories omit those keys.

## Read one

`GET /api/stories/:id`

```bash
curl -fsS "$BASE/api/stories/sample-xiaoming" \
  -H "Authorization: Bearer $READER_API_KEY"
```

`404` if the id is unknown. `400` if the id is not a safe token (`^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$`).

## Create

`POST /api/stories`

`201` with the stored story. `409` if `id` already exists. `400` on validation errors.

### Minimal body

Only the raw text. The server runs the same prepare pipeline as **Prepare with AI** (xAI grouping and pinyin, with a local sentence split if the model returns no sentences). The caller's `title` and `level` are kept.

```bash
curl -fsS "$BASE/api/stories" \
  -H "Authorization: Bearer $READER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"我的猫","level":"HSK1","hanzi":"我有一只猫。它很可爱。"}'
```

```json
{
  "title": "我的猫",
  "level": "HSK1",
  "hanzi": "我有一只猫。"
}
```

| Field | Rule |
| --- | --- |
| `title` | required string, 1–200 chars |
| `level` | required: `HSK1`, `HSK2`, `HSK3`, or `other` |
| `hanzi` | required simplified Chinese |
| `id` | optional. Generated when omitted |
| `bookId` | optional. Must be an existing book, and must be sent with `chapterNumber` |
| `chapterNumber` | optional integer 1–9999. Required together with `bookId` |
| `chapterTitle` | optional. With `bookId` on `POST /api/books/:id/chapters`, defaults to `title` |

`400` if the book does not exist. `409` if that book already has the chapter number. Adding a chapter refreshes the book's `updatedAt`. Blank lines in `hanzi` (`\n\n`) are stored as `paragraphs` (groups of sentence ids). A single newline stays inside one paragraph. Stories with no `paragraphs` field are one paragraph.

If `XAI_API_KEY` is missing the response is `503`. If xAI fails, the status and a redacted `error` / `detail` are returned and nothing is stored.

### Full story

Send `sentences` (non-empty) to store the story as-is. xAI is not called.

```bash
curl -fsS "$BASE/api/stories" \
  -H "Authorization: Bearer $READER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @story.json
```

## Replace

`PUT /api/stories/:id`

Replaces the story. `sentences` is required (this does not re-run prepare). `createdAt` on the server is kept. `updatedAt` is set to now. `404` if the id does not exist. `400` if the body `id` does not match the URL.

```bash
curl -fsS -X PUT "$BASE/api/stories/cat-story" \
  -H "Authorization: Bearer $READER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @story.json
```

## Delete

`DELETE /api/stories/:id`

```bash
curl -fsS -X DELETE "$BASE/api/stories/cat-story" \
  -H "Authorization: Bearer $READER_API_KEY"
```

```json
{ "ok": true }
```

`404` if it is already gone.

## Import and export

These match the library buttons. Export is the full library, not the summary list.

```bash
curl -fsS "$BASE/api/stories/export" \
  -H "Authorization: Bearer $READER_API_KEY" \
  -o chinese-reader-stories.json

curl -fsS "$BASE/api/stories/import" \
  -H "Authorization: Bearer $READER_API_KEY" \
  -H "Content-Type: application/json" \
  -d @chinese-reader-stories.json
```

Import body:

```json
{ "version": 1, "stories": [], "books": [] }
```

`version` must be `1` when present. `books` is optional. Stories missing `id`, `hanzi`, or `sentences` are skipped. Books in the file are upserted first. The response counts stories only:

```json
{ "imported": 2, "skipped": 1 }
```

Existing ids are overwritten. Timestamps in the file are kept when they are valid ISO strings.

Export always includes `books` (an empty array when there are none). Each book is the book record, not a copy of its chapter text. Chapters are the stories whose `bookId` points at the book.

## Story schema

```json
{
  "id": "cat-story",
  "title": "我的猫",
  "level": "HSK1",
  "bundled": false,
  "hanzi": "我有一只猫。",
  "sentences": [
    {
      "id": "s1",
      "hanzi": "我有一只猫。",
      "pinyin": "Wǒ yǒu yī zhī māo.",
      "words": [
        { "hanzi": "我", "pinyin": "wǒ" },
        { "hanzi": "有", "pinyin": "yǒu" },
        { "hanzi": "一只", "pinyin": "yī zhī" },
        { "hanzi": "猫", "pinyin": "māo", "note": "optional hint" },
        { "hanzi": "。", "pinyin": "" }
      ]
    }
  ],
  "notes": {
    "猫": {
      "pinyin": "māo",
      "gloss": "cat",
      "usage": "一只猫 one cat.",
      "source": "user"
    }
  },
  "createdAt": "2026-10-24T00:00:00.000Z",
  "updatedAt": "2026-10-24T00:00:00.000Z"
}
```

`notes.source` is `ai`, `user`, or `sample`. `bundled` is optional. `words[].note` is optional.

Optional chapter and paragraph fields:

```json
{
  "bookId": "hanyu-1",
  "chapterNumber": 2,
  "chapterTitle": "在公园",
  "paragraphs": [["s1"], ["s2", "s3"]]
}
```

`paragraphs` lists every sentence id exactly once, in reading order, split into groups. Omit it when the story is a single paragraph. `bookId` and `chapterNumber` are stored together.

## Books

A book is one library entry. Its chapters are stories, in `chapterNumber` order, so the story list is not one row per chapter.

### Create a book

`POST /api/books` → `201` with the book and `chapters: []`. `409` if `id` is already used.

```bash
curl -fsS "$BASE/api/books" \
  -H "Authorization: Bearer $READER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"hanyu-1","title":"汉语教程","level":"HSK1","description":"First reader"}'
```

```json
{
  "id": "hanyu-1",
  "title": "汉语教程",
  "level": "HSK1",
  "description": "First reader",
  "createdAt": "2026-10-24T00:00:00.000Z",
  "updatedAt": "2026-10-24T00:00:00.000Z",
  "chapters": []
}
```

`GET /api/books` returns the same shape, newest `updatedAt` first, each with `chapters` in order. `GET /api/books/:id` returns one. `PUT /api/books/:id` replaces title, level, and description and keeps `createdAt`.

### Add a chapter

Either `POST /api/stories` with `bookId` and `chapterNumber`, or `POST /api/books/:id/chapters`. The chapters route takes the same body as creating a story. `bookId` comes from the URL (`400` if the body disagrees). `chapterNumber` defaults to one past the last chapter. `chapterTitle` defaults to `title`.

A missing book on this route is `404`. A missing book on `POST /api/stories` is `400`. A duplicate chapter number is `409`.

This chapter keeps a blank line between paragraphs:

```bash
curl -fsS "$BASE/api/books/hanyu-1/chapters" \
  -H "Authorization: Bearer $READER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"在公园","level":"HSK1","chapterTitle":"在公园","hanzi":"小明去公园。\n\n他看见一只猫。猫很可爱。"}'
```

The stored story is a normal story plus:

```json
{
  "bookId": "hanyu-1",
  "chapterNumber": 1,
  "chapterTitle": "在公园",
  "hanzi": "小明去公园。\n\n他看见一只猫。猫很可爱。",
  "paragraphs": [["<first sentence id>"], ["<second sentence id>", "<third sentence id>"]]
}
```

`GET /api/books/hanyu-1` then lists that chapter summary (`id`, `title`, `chapterNumber`, `chapterTitle`, `level`, `createdAt`, `updatedAt`) and does not inline the sentences.

### Delete a book

`DELETE /api/books/:id` removes the book only. Each chapter stays as its own story, with `bookId`, `chapterNumber`, and `chapterTitle` removed. The text is not deleted.

```json
{ "ok": true, "detached": ["chapter-id"] }
```

The library asks for confirmation and says that chapters remain as separate stories.

## TTS cache

Character timings are not stored on the story. Hear reads xAI `graph_chars` and `graph_times` (seconds, one pair per input character) from `DATA_DIR/audio/<hash>.json`, or calls xAI and writes that file. The pitch graph compares a contour to the spoken tone after tone sandhi and neutral tone. Playback slices keep the token start, minus 30 ms, and extend the end to the energy dip before the next character, or through the pause before punctuation. A story file does not need to be rewritten for that.

`DELETE /api/tts/cache` removes only the audio JSON files. The next Hear fetches timestamps again. Stories and books stay in place. Same auth as the other routes.

```json
{ "deleted": 3 }
```

## Migration

Story files are still one JSON file per story under `DATA_DIR/stories/`. Books are `DATA_DIR/books/<id>.json`. Nothing is rewritten in place: a story with no `paragraphs` field still renders as one paragraph, and a story with no `bookId` stays standalone.

The first request after this upgrade, before anything is written, copies existing `stories/*.json` and `books/*.json` to `DATA_DIR/backups/<timestamp>-books-paragraphs-v1/`. The copy runs once (marker `DATA_DIR/.migrations/books-paragraphs-v1`). TTS files in `audio/` are not copied; they can be generated again. Deleting every story still does not reseed the sample.

## Errors

```json
{ "error": "title is required." }
```

Some upstream failures also include `detail` (secrets removed, truncated).

| Status | When |
| --- | --- |
| 400 | validation, bad JSON, body over 1 MB, bad id |
| 401 | missing or wrong bearer / session |
| 404 | unknown story or book |
| 409 | create with an id that exists, or a chapter number already used in that book |
| 429 | too many login attempts (`POST /api/auth/login` only) |
| 502 | prepare ran but produced no sentences, or xAI returned an error |
| 503 | `XAI_API_KEY`, `READER_PASSCODE`, or `READER_SESSION_SECRET` is not set |
