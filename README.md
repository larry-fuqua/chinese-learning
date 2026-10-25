# Chinese pronunciation reader

A local (or tunneled) web app for simplified-Chinese reading practice: stories, word grouping + pinyin, TTS, recite, and a pitch graph that compares your recording to the model.

TTS, STT, and grouping run on the machine that holds your [xAI API key](https://console.x.ai). The browser on whatever device you open uses that device's mic and speakers.

## Requirements

- Node 20+
- An xAI API key (`XAI_API_KEY`), used only on the server
- A shared UI passcode (`READER_PASSCODE`) and a session secret (`READER_SESSION_SECRET`)
- A bearer key (`READER_API_KEY`) if another bot will add stories

## Local (one machine)

```bash
git clone https://github.com/larry-fuqua/chinese-learning.git
cd chinese-learning
cp .env.example .env.local
# Fill in XAI_API_KEY, READER_PASSCODE, READER_SESSION_SECRET, READER_API_KEY.
# For http://localhost:3010/ leave BASE_PATH empty.
npm install
npm run dev                  # http://localhost:3010
```

Open the app, enter the passcode, then hear a sentence and Recite (allow the mic). The first server start seeds an HSK-1 sample story. Stories are stored on the server under `DATA_DIR` (default `./data`), not in the browser.

The dev server and `npm start` listen on port **3010**. The Docker server uses `PORT` (default 3010).

Do not commit `.env.local` or `data/`.

### Move an old browser library

Older builds kept stories in this browser's IndexedDB (`chinese-reader`). Export that library to a JSON file **before** opening this version. On load, the app deletes the `chinese-reader` database if it is still there, so a stale local copy does not linger (for example on a Chromebook). File Import still accepts `{"version":1,"stories":[...]}` and writes it to the server. Export downloads the server library in that shape, plus a `books` array.

## Another device, same backend

Run the app on an always-on machine (the one with the API key), then tunnel it. Mic and speakers stay on the client; `/api/tts`, `/api/stt`, and grouping stay on the host.

See [docs/remote.md](docs/remote.md).

Windows helpers (optional, host only):

- `scripts/start-detached.ps1` — start the Next dev server detached
- `scripts/start-tunnel.ps1` — Cloudflare quick tunnel to `http://127.0.0.1:3010`

## Self-host (homebrain)

The production app is a Next.js standalone server in Docker. It is meant to sit behind a private Tailscale HTTPS proxy that **forwards the `/chinese` prefix unchanged**:

`https://homebrain.tail956d87.ts.net/chinese/` → `http://127.0.0.1:3010/chinese/`

Do not strip `/chinese` in the proxy. Pages, `/_next` assets, `/api/*`, and the session cookie are all scoped to that prefix. `BASE_PATH` is baked in at image build time; change it only by rebuilding.

```bash
cp .env.example .env
# set XAI_API_KEY, READER_PASSCODE, READER_SESSION_SECRET, READER_API_KEY
docker compose up -d --build
```

| | |
| --- | --- |
| Published port | `HOST_PORT` (default **3010**) → container `PORT` (default **3010**) |
| Volume | named volume `reader-data` mounted at **`/data`** (`DATA_DIR`) |
| Process user | uid **1001** (`nextjs`) |
| Health | `GET /chinese/api/health` → `200 {"ok":true}` with no auth |

A named volume is created writable by uid 1001. For a bind mount (`./data:/data`), `chown 1001:1001` that directory first. Stories live in `/data/stories/*.json`. Books live in `/data/books/*.json`. Cached TTS audio lives in `/data/audio/`. The first request after upgrading to books copies existing story and book JSON into `/data/backups/<timestamp>-books-paragraphs-v1/` and leaves the originals in place. The audio cache is not copied.

Character timings are not stored in the story JSON. Word pinyin is stored as the author wrote it; the reader splits it into one syllable per character when it draws the ruby and the pitch label, so those story files are not rewritten. The graph applies Mandarin tone sandhi when it draws the expected contour.

Both the model voice and a recording are timed by forced alignment: the Next server sends the known sentence and the wav to the `align` service, which runs torchaudio MMS_FA on CPU. The spans are plain token times. The same waveform trim as before then cuts each character at the energy dip and gives a pause to the neighbouring character. If the sidecar is down, Hear falls back to the cached xAI timestamps and a recording falls back to the transcript times, and the server logs that. Speech-to-text is only used to check what was said. The last recite take for each sentence (audio and transcript) is kept in the data volume, one file per sentence.

The pitch line is semitones against that speaker's median, on one axis for the whole sentence, and it breaks across a real silence. A character's width matches its duration. The tone label is a small logistic model trained on the app's AI voice; AISHELL-3 is held out. It is not trained on the learner's recordings. `DELETE /api/tts/cache` with the bearer key or a session cookie drops the audio JSON only. See [docs/story-api.md](docs/story-api.md).

The align container is on the Compose network only (no host port). It loads the MMS_FA weights once, about 1.2 GB, into the `align-models` volume. Expect roughly 3 GB of RAM for that process. The first start downloads the weights.

Next redirects a trailing slash (`/chinese/`) to `/chinese`. The proxy can forward either path.

Check:

```bash
curl -fsS http://127.0.0.1:3010/chinese/api/health
```

Then open `https://homebrain.tail956d87.ts.net/chinese/` and sign in with `READER_PASSCODE`. The session cookie is HttpOnly, Secure, SameSite=Lax, path `/chinese`, and lasts 90 days.

`XAI_API_KEY` stays in the server environment. It is not sent to the browser, put in URLs, or written to logs. Upstream error text is redacted before it is returned.

Story API for another bot: [docs/story-api.md](docs/story-api.md).

### Environment

| Name | Required | Purpose |
| --- | --- | --- |
| `XAI_API_KEY` | yes, for TTS, STT, prepare, segment, and minimal story POST | xAI key. Server only. |
| `READER_PASSCODE` | yes, for the web UI | Shared passcode. Compared in constant time. |
| `READER_SESSION_SECRET` | yes | HMAC secret for the session cookie. At least 16 characters. |
| `READER_API_KEY` | yes, for the story API | `Authorization: Bearer` key. Compared in constant time. |
| `BASE_PATH` | deploy: `/chinese` | Prefix. Empty serves at `/`. Rebuild after changing it. |
| `DATA_DIR` | deploy: `/data` | Story JSON and TTS cache. Mount a volume here. |
| `PORT` | default `3010` in Docker | Port inside the container. |
| `HOST_PORT` | default `3010` | Host port in `docker-compose.yml` only. |
| `ALIGN_URL` | Compose: `http://align:8000` | Forced-alignment sidecar. Empty skips it and keeps token timings. |

Login attempts are rate-limited (8 failures per IP and 40 globally per 15 minutes, then HTTP 429).

## Tests

```bash
npm test
```

## License

The application code is MIT. Not affiliated with xAI.

The MMS_FA acoustic model and aligner weights, downloaded by the `align` service from torchaudio, are **CC-BY-NC 4.0**. They are for personal, non-commercial use. This repository does not redistribute those weights. See the [torchaudio MMS_FA bundle](https://pytorch.org/audio/stable/generated/torchaudio.pipelines.MMS_FA.html) and the [CC-BY-NC 4.0 licence](https://creativecommons.org/licenses/by-nc/4.0/).
