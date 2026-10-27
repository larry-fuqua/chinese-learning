import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./story-store";
import { ttsCacheKey } from "./tts-key";

export type CachedTts = {
  audioBase64: string;
  duration: number;
  graphChars: string[];
  charTimes: [number, number][];
  speed: number;
};

function cacheFile(text: string, speed: number, reading = ""): string {
  const hash = createHash("sha256").update(ttsCacheKey(text, speed, reading)).digest("hex");
  return path.join(dataDir(), "audio", `${hash}.json`);
}

export async function readTtsCache(
  text: string,
  speed: number,
  reading = "",
): Promise<CachedTts | undefined> {
  try {
    const raw = await fs.readFile(cacheFile(text, speed, reading), "utf8");
    const parsed = JSON.parse(raw) as CachedTts;
    if (!parsed?.audioBase64 || typeof parsed.duration !== "number") return undefined;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

export async function clearTtsCache(): Promise<number> {
  const dir = path.join(dataDir(), "audio");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  let deleted = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    await fs.unlink(path.join(dir, name));
    deleted++;
  }
  return deleted;
}

export async function writeTtsCache(
  text: string,
  speed: number,
  payload: CachedTts,
  reading = "",
): Promise<void> {
  const file = cacheFile(text, speed, reading);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload));
  await fs.rename(tmp, file);
}
