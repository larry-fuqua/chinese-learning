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
{ "version": 1, "stories": [] }
```

`version` must be `1` when present. Stories missing `id`, `hanzi`, or `sentences` are skipped. Response:

```json
{ "imported": 2, "skipped": 1 }
```

Existing ids are overwritten. Timestamps in the file are kept when they are valid ISO strings.

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

## Errors

```json
{ "error": "title is required." }
```

Some upstream failures also include `detail` (secrets removed, truncated).

| Status | When |
| --- | --- |
| 400 | validation, bad JSON, body over 1 MB, bad id |
| 401 | missing or wrong bearer / session |
| 404 | unknown story |
| 409 | create with an id that exists |
| 429 | too many login attempts (`POST /api/auth/login` only) |
| 502 | prepare ran but produced no sentences, or xAI returned an error |
| 503 | `XAI_API_KEY`, `READER_PASSCODE`, or `READER_SESSION_SECRET` is not set |
