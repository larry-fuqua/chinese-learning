import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { apiUrl, cookiePath, normalizeBasePath, safeNextPath } from "../src/lib/base-path";
import { setBasePath } from "./env";

test("normalizeBasePath accepts a single prefix and rejects junk", () => {
  assert.equal(normalizeBasePath(""), "");
  assert.equal(normalizeBasePath("/"), "");
  assert.equal(normalizeBasePath("/chinese"), "/chinese");
  assert.equal(normalizeBasePath("/chinese/"), "/chinese");
  assert.equal(normalizeBasePath("chinese"), "/chinese");
  assert.throws(() => normalizeBasePath("/chinese/../etc"), /Invalid BASE_PATH/);
  assert.throws(() => normalizeBasePath("https://evil.example"), /Invalid BASE_PATH/);
  assert.throws(() => normalizeBasePath("//evil"), /Invalid BASE_PATH/);
});

test("api paths, cookie path, and post-login redirects include BASE_PATH", () => {
  setBasePath("/chinese");
  assert.equal(apiUrl("/api/health"), "/chinese/api/health");
  assert.equal(apiUrl("/api/stories"), "/chinese/api/stories");
  assert.equal(apiUrl("api/tts"), "/chinese/api/tts");
  assert.equal(cookiePath(), "/chinese");
  assert.equal(safeNextPath("/read/abc"), "/chinese/read/abc");
  assert.equal(safeNextPath("/chinese/read/abc"), "/chinese/read/abc");
  assert.equal(safeNextPath("//evil.example"), "/chinese/");
  assert.equal(safeNextPath("https://evil.example"), "/chinese/");
  assert.equal(safeNextPath("/login"), "/chinese/");

  setBasePath("");
  assert.equal(apiUrl("/api/health"), "/api/health");
  assert.equal(cookiePath(), "/");
  assert.equal(safeNextPath("/read/abc"), "/read/abc");
  setBasePath("/chinese");
});

test("client story requests use the prefixed export URL", async () => {
  setBasePath("/chinese");
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ version: 1, stories: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const { listStories } = await import("../src/lib/storage.ts");
    await listStories();
    assert.deepEqual(urls, ["/chinese/api/stories/export"]);
  } finally {
    globalThis.fetch = original;
    setBasePath("/chinese");
  }
});

test("next config bakes BASE_PATH into basePath and the public env", async () => {
  process.env.BASE_PATH = "/chinese/";
  const mod = await import(`../next.config.ts?test=${Date.now()}`);
  const config = mod.default as {
    basePath?: string;
    output?: string;
    env?: { NEXT_PUBLIC_BASE_PATH?: string };
  };
  assert.equal(config.basePath, "/chinese");
  assert.equal(config.output, "standalone");
  assert.equal(config.env?.NEXT_PUBLIC_BASE_PATH, "/chinese");
});
