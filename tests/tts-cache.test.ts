import "./env";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createHash } from "node:crypto";
import { DELETE } from "../src/app/api/tts/cache/route";
import { POST } from "../src/app/api/tts/route";
import { ttsCacheKey } from "../src/lib/tts-key";
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

test("a contextual reading caches separately and is not sent as the spoken text", async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    const sent = JSON.parse(String(init?.body)) as { text?: string; reading?: string };
    assert.equal(sent.text, "学");
    assert.equal(sent.reading, undefined);
    assert.equal(String(input).includes("test-xai-key-do-not-leak"), false);
    return new Response(
      JSON.stringify({ audio: "UklHRmVhZA==", duration: 0.4 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const withReading = await POST(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "学", speed: 0.85, reading: "xué" }),
    }),
  );
  assert.equal(withReading.status, 200);
  const again = await POST(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "学", speed: 0.85, reading: "xué" }),
    }),
  );
  assert.equal(again.status, 200);
  assert.equal(calls, 1);

  const otherTone = await POST(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "学", speed: 0.85, reading: "xuě" }),
    }),
  );
  assert.equal(otherTone.status, 200);
  assert.equal(calls, 2);

  const plain = createHash("sha256").update(ttsCacheKey("学", 0.85)).digest("hex");
  const toned = createHash("sha256").update(ttsCacheKey("学", 0.85, "xué")).digest("hex");
  const names = await fs.readdir(path.join(dir, "audio"));
  assert.equal(names.includes(`${plain}.json`), false);
  assert.equal(names.includes(`${toned}.json`), true);
});

test("DELETE /api/tts/cache removes audio json and leaves stories", async () => {
  await fs.mkdir(path.join(dir, "audio"), { recursive: true });
  await fs.mkdir(path.join(dir, "stories"), { recursive: true });
  await fs.writeFile(path.join(dir, "audio", "a.json"), "{}");
  await fs.writeFile(path.join(dir, "audio", "b.json"), "{}");
  await fs.writeFile(path.join(dir, "audio", "note.txt"), "keep");
  await fs.writeFile(path.join(dir, "stories", "s.json"), "{}");

  const denied = await DELETE(new Request("http://localhost/api/tts/cache", { method: "DELETE" }));
  assert.equal(denied.status, 401);

  const ok = await DELETE(
    new Request("http://localhost/api/tts/cache", {
      method: "DELETE",
      headers: { authorization: `Bearer ${API_KEY}` },
    }),
  );
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).deleted, 2);
  const audio = await fs.readdir(path.join(dir, "audio"));
  assert.deepEqual(audio.sort(), ["note.txt"]);
  const stories = await fs.readdir(path.join(dir, "stories"));
  assert.deepEqual(stories, ["s.json"]);
});
