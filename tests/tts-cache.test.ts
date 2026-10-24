import "./env";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "../src/app/api/tts/route";
import { API_KEY } from "./env";

let dir = "";
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "tts-"));
  process.env.DATA_DIR = dir;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await fs.rm(dir, { recursive: true, force: true });
});

test("TTS caches audio on disk and does not send the xAI key back", async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    const url = String(input);
    assert.equal(url, "https://api.x.ai/v1/tts");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-xai-key-do-not-leak");
    assert.equal(url.includes("test-xai-key-do-not-leak"), false);
    return new Response(
      JSON.stringify({
        audio: "UklHRmFrZQ==",
        duration: 1.2,
        audio_timestamps: { graph_chars: ["猫"], graph_times: [[0, 1.2]] },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const first = await POST(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "猫。", speed: 0.85 }),
    }),
  );
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.audioBase64, "UklHRmFrZQ==");
  assert.equal(JSON.stringify(body).includes("test-xai-key-do-not-leak"), false);
  assert.equal(calls, 1);

  const second = await POST(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "猫。", speed: 0.85 }),
    }),
  );
  assert.equal(second.status, 200);
  assert.equal((await second.json()).audioBase64, "UklHRmFrZQ==");
  assert.equal(calls, 1);

  const files = await fs.readdir(path.join(dir, "audio"));
  assert.equal(files.length, 1);
});
