# Chinese pronunciation reader

A local (or tunneled) web app for simplified-Chinese reading practice: stories, word grouping + pinyin, TTS, recite, and a pitch graph that compares your recording to the model.

TTS, STT, and grouping run on the machine that holds your [xAI API key](https://console.x.ai). The browser on whatever device you open uses that device's mic and speakers.

## Requirements

- Node 20+
- An xAI API key (`XAI_API_KEY`)

## Local (one machine)

```bash
git clone https://github.com/larry-fuqua/chinese-learning.git
cd chinese-learning
cp .env.example .env.local   # then paste your key
npm install
npm run dev                  # http://localhost:3010
```

Open `http://localhost:3010` in a browser on that same machine. First visit seeds an HSK-1 sample story. Hear a sentence, then Recite (allow the mic).

The default port is **3010**. Change it in `package.json` if that port is already in use.

Do not commit `.env.local`.

## Another device, same backend

Run the app on an always-on machine (the one with the API key), then tunnel it. Mic and speakers stay on the client; `/api/tts`, `/api/stt`, and grouping stay on the host.

See [docs/remote.md](docs/remote.md).

Windows helpers (optional, host only):

- `scripts/start-detached.ps1` — start the Next dev server detached
- `scripts/start-tunnel.ps1` — Cloudflare quick tunnel to `http://127.0.0.1:3010`

## License

MIT. Not affiliated with xAI.
