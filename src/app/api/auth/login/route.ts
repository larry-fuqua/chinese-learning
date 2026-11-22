import {
  checkLoginAllowed,
  clearLoginFailures,
  clientIp,
  recordLoginFailure,
  safeEqualString,
  sessionCookie,
  sessionSecret,
  signSession,
} from "@/lib/auth";
import { errorJson, readJsonLimited } from "@/lib/http";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = checkLoginAllowed(ip);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfter),
          "Cache-Control": "private, no-store",
        },
      },
    );
  }

  const body = await readJsonLimited(request, 8 * 1024);
  if (!body.ok) {
    recordLoginFailure(ip);
    return errorJson(body.status, body.error);
  }
  const passcode =
    body.value && typeof body.value === "object" && !Array.isArray(body.value)
      ? (body.value as { passcode?: unknown }).passcode
      : undefined;
  if (typeof passcode !== "string") {
    recordLoginFailure(ip);
    return errorJson(400, "passcode is required.");
  }

  const expected = process.env.READER_PASSCODE ?? "";
  if (!expected) return errorJson(503, "Login is not configured.");
  if (!sessionSecret()) return errorJson(503, "Session signing is not configured.");

  if (!safeEqualString(passcode, expected)) {
    recordLoginFailure(ip);
    return errorJson(401, "Invalid passcode.");
  }

  clearLoginFailures(ip);
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
  response.headers.set("Set-Cookie", sessionCookie(signSession()));
  return response;
}
