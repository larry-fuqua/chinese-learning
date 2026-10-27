import "./env";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { GET as health } from "../src/app/api/health/route";
import { POST as prepare } from "../src/app/api/prepare/route";
import { POST as segment } from "../src/app/api/segment/route";
import { GET as listStories } from "../src/app/api/stories/route";
import { POST as stt } from "../src/app/api/stt/route";
import { POST as tts } from "../src/app/api/tts/route";
import { SESSION_MAX_AGE, resetLoginRateLimits, safeEqualString, signSession } from "../src/lib/auth";
import { API_KEY, PASSCODE, setBasePath } from "./env";

function cookiePair(setCookie: string | null): string {
  assert.ok(setCookie, "expected Set-Cookie");
  return setCookie.split(";")[0] ?? "";
}

async function loginAs(passcode: string, ip = "203.0.113.10") {
  return login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ passcode }),
    }),
  );
}

beforeEach(() => {
  resetLoginRateLimits();
  setBasePath("/chinese");
  process.env.READER_LOGIN_MAX_ATTEMPTS = "8";
});

afterEach(() => {
  resetLoginRateLimits();
});

test("safeEqualString compares full values", () => {
  assert.equal(safeEqualString("test-passcode", "test-passcode"), true);
  assert.equal(safeEqualString("test-passcode", "test-passcode-extra"), false);
  assert.equal(safeEqualString("a", "ab"), false);
  assert.equal(safeEqualString("", "test-passcode"), false);
});

test("health is public", async () => {
  const response = await health();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("wrong passcode is rejected and correct passcode sets a scoped session cookie", async () => {
  const bad = await loginAs("nope", "203.0.113.20");
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("set-cookie"), null);
  assert.equal((await bad.json()).error, "Invalid passcode.");

  const good = await loginAs(PASSCODE, "203.0.113.20");
  assert.equal(good.status, 200);
  const setCookie = good.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.match(setCookie, /reader_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\/chinese(?:;|$)/);
  assert.match(setCookie, new RegExp(`Max-Age=${SESSION_MAX_AGE}`));
  assert.equal((await good.json()).ok, true);
});

test("login cookie path follows BASE_PATH", async () => {
  setBasePath("");
  const response = await loginAs(PASSCODE, "203.0.113.21");
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /Path=\/;/);
  setBasePath("/chinese");
});

test("login is rate limited", async () => {
  process.env.READER_LOGIN_MAX_ATTEMPTS = "3";
  const ip = "203.0.113.30";
  for (let i = 0; i < 3; i++) {
    const response = await loginAs("wrong", ip);
    assert.equal(response.status, 401);
  }
  const blocked = await loginAs(PASSCODE, ip);
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers.get("retry-after") ?? "", /^[1-9]/);
  const body = await blocked.json();
  assert.match(body.error, /Too many login attempts/);
});

test("story and model routes reject anonymous callers", async () => {
  const stories = await listStories(new Request("http://localhost/api/stories"));
  assert.equal(stories.status, 401);

  const prepared = await prepare(
    new Request("http://localhost/api/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hanzi: "猫" }),
    }),
  );
  assert.equal(prepared.status, 401);

  const segmented = await segment(
    new Request("http://localhost/api/segment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hanzi: "猫" }),
    }),
  );
  assert.equal(segmented.status, 401);

  const speech = await tts(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "猫" }),
    }),
  );
  assert.equal(speech.status, 401);

  const form = new FormData();
  form.set("file", new Blob(["x"]), "recite.wav");
  const heard = await stt(new Request("http://localhost/api/stt", { method: "POST", body: form }));
  assert.equal(heard.status, 401);
});

test("bearer key and session cookie both authorize, bad credentials do not", async () => {
  const anon = await listStories(new Request("http://localhost/api/stories"));
  assert.equal(anon.status, 401);

  const wrong = await listStories(
    new Request("http://localhost/api/stories", {
      headers: { authorization: "Bearer not-the-key" },
    }),
  );
  assert.equal(wrong.status, 401);

  const withBearer = await listStories(
    new Request("http://localhost/api/stories", { headers: { authorization: `Bearer ${API_KEY}` } }),
  );
  assert.equal(withBearer.status, 200);

  const loggedIn = await loginAs(PASSCODE, "203.0.113.40");
  const withCookie = await listStories(
    new Request("http://localhost/api/stories", { headers: { cookie: cookiePair(loggedIn.headers.get("set-cookie")) } }),
  );
  assert.equal(withCookie.status, 200);

  const expired = signSession(Date.now() - 10_000, 1_000);
  const stale = await listStories(
    new Request("http://localhost/api/stories", { headers: { cookie: `reader_session=${expired}` } }),
  );
  assert.equal(stale.status, 401);

  const token = cookiePair(loggedIn.headers.get("set-cookie")).split("=")[1] ?? "";
  const tampered = await listStories(
    new Request("http://localhost/api/stories", {
      headers: { cookie: `reader_session=${token.slice(0, -2)}aa` },
    }),
  );
  assert.equal(tampered.status, 401);
});

test("logout clears the session cookie", async () => {
  setBasePath("/chinese");
  const response = await logout();
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /reader_session=/);
  assert.match(setCookie, /Max-Age=0/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\/chinese/);
});

test("protected route modules call unauthorized and public ones do not", () => {
  const root = path.join(process.cwd(), "src/app/api");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") files.push(full);
    }
  };
  walk(root);
  const publicRoutes = new Set([
    path.normalize("health/route.ts"),
    path.normalize("auth/login/route.ts"),
    path.normalize("auth/logout/route.ts"),
  ]);
  assert.ok(files.length >= 8);
  for (const file of files) {
    const rel = path.normalize(path.relative(root, file));
    const source = fs.readFileSync(file, "utf8");
    if (publicRoutes.has(rel)) {
      assert.equal(source.includes("unauthorized("), false, rel);
    } else {
      assert.equal(source.includes("unauthorized("), true, rel);
    }
  }
  const layout = fs.readFileSync(path.join(process.cwd(), "src/app/(reader)/layout.tsx"), "utf8");
  assert.match(layout, /authDecision/);
  assert.match(layout, /redirect\("\/login"\)/);
});
