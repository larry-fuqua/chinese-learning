import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chinese-reader-"));
process.env.DATA_DIR = dir;
process.env.BASE_PATH = "/chinese";
process.env.NEXT_PUBLIC_BASE_PATH = "/chinese";
process.env.READER_PASSCODE = "test-passcode";
process.env.READER_SESSION_SECRET = "test-session-secret-0123456789";
process.env.READER_API_KEY = "test-api-key-0123456789";
process.env.XAI_API_KEY = "test-xai-key-do-not-leak";
process.env.READER_LOGIN_MAX_ATTEMPTS = "8";
process.env.READER_LOGIN_GLOBAL_MAX = "200";
process.env.READER_LOGIN_WINDOW_MS = "60000";

export const dataDir = dir;
export const PASSCODE = process.env.READER_PASSCODE;
export const API_KEY = process.env.READER_API_KEY;
export const XAI_KEY = process.env.XAI_API_KEY;

export function setBasePath(value: string) {
  process.env.BASE_PATH = value;
  process.env.NEXT_PUBLIC_BASE_PATH = value;
}

export function bearer(key = API_KEY): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}
