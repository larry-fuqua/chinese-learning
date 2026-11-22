/** Fixed speed for a single-character practice clip, so the speed slider does not fork the cache. */
export const PRACTICE_TTS_SPEED = 0.85;

/**
 * Disk key for synthesized speech.
 * Sentence audio omits `reading` and stays `eve|zh|24000|<speed>|<text>`.
 * A practice clip appends the contextual pinyin, so the key is
 * voice + character + contextual pinyin (speed fixed at PRACTICE_TTS_SPEED).
 */
export function ttsCacheKey(text: string, speed: number, reading = ""): string {
  const base = `eve|zh|24000|${speed.toFixed(2)}|${text}`;
  return reading ? `${base}|${reading}` : base;
}
