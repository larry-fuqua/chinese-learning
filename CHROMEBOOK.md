# Chromebook (Burger Barn)

Hear/Recite need the Chromebook’s own mic and speakers. Chrome Remote Desktop has not been carrying audio, so do not rely on it for study.

## Fastest: phone-home URL (home PC must stay awake)

On the Windows machine the app is tunneled from `http://127.0.0.1:3010`. Open the trycloudflare URL in **Chrome OS Chrome** (not Linux). Mic and playback stay on the Chromebook; TTS/STT run at home.

If that URL is dead, use Linux below.

Keep the home PC plugged in and set sleep to **Never** until you get back.

## Lasts all morning: run it on Chromebook Linux

Needs Node 20+ in the Linux container (`node -v`). Grok Build is already there.

```bash
sudo apt-get update
sudo apt-get install -y git
cd ~
git clone https://github.com/larry-fuqua/chinese-learning.git
cd chinese-learning
npm install
```

Create `~/.chinese-learning.env` is optional. The app reads `.env.local` in the project:

```bash
nano .env.local
```

Put one line (same SpaceXAI key as the Windows box, from https://console.x.ai ):

```
XAI_API_KEY=paste-key-here
```

Start:

```bash
npm run dev
```

From **Chrome OS Chrome**, open `http://localhost:3010`. If that fails, ChromeOS → Settings → Developers → Linux → Port forwarding → add **3010**. Then try `http://penguin.linux.test:3010` or `http://localhost:3010` again.

First visit seeds the HSK-1 story **小明的一天**. Hear a sentence, then Recite (allow the mic).

## Do not

- Copy `node_modules` from Drive
- Commit `.env.local`
- Expect Remote Desktop to do Hear/Recite
