# Remote access (client device + host backend)

Use this when the browser is on a laptop, phone, or Chromebook, but TTS/STT/grouping should still run on another machine (the host that has `XAI_API_KEY`).

Hear and Recite need **that client device's** mic and speakers. Remote-desktop audio is usually a bad path.

## 1. Host: run the app

On the always-on machine:

```bash
cd chinese-learning
cp .env.example .env.local   # XAI_API_KEY=...
npm install
npm run dev                  # listens on 0.0.0.0:3010
```

Windows: `powershell -File scripts/start-detached.ps1`

Keep the host awake (plugged in, sleep off) while you study.

## 2. Host: publish a URL

Point a tunnel at `http://127.0.0.1:3010`. Cloudflare quick tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:3010
```

Windows (if `cloudflared` is installed): `powershell -File scripts/start-tunnel.ps1` then read `tunnel.log` for the `https://*.trycloudflare.com` URL.

A **named / reserved** hostname stays stable across restarts. A random quick-tunnel URL changes every process; update the client bookmark when it does.

ngrok (reserved domain or random URL) works the same way: target port 3010.

## 3. Client: open the public URL

In the **client device's own browser** (not a remote-desktop session), open the tunnel URL. Allow the microphone when Recite asks.

The page is served from the host; API routes (`/api/tts`, `/api/stt`, `/api/prepare`, `/api/segment`) run there with the host key. Audio capture and playback stay local to the client.

## Fully local on the client instead

If the client can hold the API key, skip the tunnel: clone the repo on that device and follow the README local steps. Then TTS/STT run there, not on the host.

## Do not

- Commit `.env.local` or tunnel logs
- Put the API key in the browser, in the tunnel URL, or in chat
- Expect remote-desktop apps to carry mic/speaker audio for Recite
