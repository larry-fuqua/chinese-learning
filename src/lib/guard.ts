import { NextResponse } from "next/server";
import { isRequestAuthed } from "./auth";

const PRIVATE = { "Cache-Control": "private, no-store" };

export function unauthorized(request: Request): NextResponse | null {
  if (isRequestAuthed(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
}

export function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE });
}
