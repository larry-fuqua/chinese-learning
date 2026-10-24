import { toneFromPinyin } from "./text";

export type Reading = { hanzi: string; pinyin: string };

export type SpokenTone = {
  dictionaryTone: number;
  spokenTone: number;
  toneNote: string;
};

const TONE_CHARS: Record<string, string> = {
  ā: "a",
  á: "a",
  ǎ: "a",
  à: "a",
  ē: "e",
  é: "e",
  ě: "e",
  è: "e",
  ī: "i",
  í: "i",
  ǐ: "i",
  ì: "i",
  ō: "o",
  ó: "o",
  ǒ: "o",
  ò: "o",
  ū: "u",
  ú: "u",
  ǔ: "u",
  ù: "u",
  ǖ: "v",
  ǘ: "v",
  ǚ: "v",
  ǜ: "v",
  ü: "v",
};

/** Light reading only. A full reading of the same character (了 liǎo, 的 dì) stays. */
const PARTICLE_BASE: Record<string, readonly string[]> = {
  了: ["le"],
  的: ["de"],
  得: ["de"],
  地: ["de"],
  吗: ["ma"],
  呢: ["ne"],
  吧: ["ba"],
  啊: ["a"],
  着: ["zhe"],
  么: ["me"],
};

export function basePinyin(pinyin: string): string {
  let out = "";
  for (const ch of pinyin.toLowerCase()) {
    if (ch >= "1" && ch <= "5") continue;
    out += TONE_CHARS[ch] ?? ch;
  }
  return out.replace(/[^a-z]/g, "");
}

function markNeutral(spoken: number[], notes: string[], index: number, note: string) {
  spoken[index] = 5;
  notes[index] = note;
}

/**
 * Dictionary tone, then neutral syllables, then 3rd-tone sandhi, then 一/不.
 * Neutrals are applied first so they break a 3rd-tone chain.
 * 一 and 不 use the next syllable's tone after that sandhi.
 */
export function spokenTones(chars: Reading[]): SpokenTone[] {
  const dictionaryTone = chars.map((ch) => toneFromPinyin(ch.pinyin));
  const spoken = dictionaryTone.slice();
  const notes = chars.map(() => "");

  chars.forEach((ch, i) => {
    const bases = PARTICLE_BASE[ch.hanzi];
    if (bases?.includes(basePinyin(ch.pinyin))) {
      markNeutral(spoken, notes, i, "neutral particle");
    }
  });

  let runStart = 0;
  while (runStart < chars.length) {
    let runEnd = runStart + 1;
    while (
      runEnd < chars.length &&
      chars[runEnd]?.hanzi === chars[runStart]?.hanzi &&
      chars[runStart]?.hanzi
    ) {
      runEnd++;
    }
    if (runEnd - runStart >= 2) {
      for (let i = runStart + 1; i < runEnd; i += 2) {
        markNeutral(spoken, notes, i, "reduplication");
      }
    }
    runStart = runEnd;
  }

  for (let i = 1; i < chars.length - 1; i++) {
    if (chars[i - 1]?.hanzi !== chars[i + 1]?.hanzi) continue;
    if (chars[i]?.hanzi === "不") {
      markNeutral(spoken, notes, i, "不 in an A-not-A question");
    } else if (chars[i]?.hanzi === "一") {
      markNeutral(spoken, notes, i, "一 between a repeated verb");
    }
  }

  for (let i = 0; i < spoken.length - 1; i++) {
    if (spoken[i] === 3 && spoken[i + 1] === 3) {
      spoken[i] = 2;
      notes[i] = "3rd-tone sandhi";
    }
  }

  for (let i = 0; i < chars.length; i++) {
    if (spoken[i] === 5) continue;
    const next = spoken[i + 1];
    if (next == null || next === 5) continue;
    if (chars[i]?.hanzi === "一") {
      if (i > 0 && chars[i - 1]?.hanzi === "第") continue;
      if (next === 4) {
        spoken[i] = 2;
        notes[i] = "一 before a 4th tone";
      } else {
        spoken[i] = 4;
        notes[i] = "一 before a 1st, 2nd, or 3rd tone";
      }
    } else if (chars[i]?.hanzi === "不" && next === 4) {
      spoken[i] = 2;
      notes[i] = "不 before a 4th tone";
    }
  }

  return chars.map((_, i) => {
    const dictionary = dictionaryTone[i] ?? 5;
    const say = spoken[i] ?? 5;
    return {
      dictionaryTone: dictionary,
      spokenTone: say,
      toneNote: dictionary === say ? "" : notes[i] ?? "",
    };
  });
}

export function toneShort(tone: number): string {
  switch (tone) {
    case 1:
      return "1st";
    case 2:
      return "2nd";
    case 3:
      return "3rd";
    case 4:
      return "4th";
    default:
      return "neutral";
  }
}

export function toneDifferenceLabel(
  dictionaryTone: number,
  spokenTone: number,
  toneNote: string,
): string | null {
  if (dictionaryTone === spokenTone) return null;
  const note = toneNote ? ` (${toneNote})` : "";
  return `dict ${toneShort(dictionaryTone)} vs spoken ${toneShort(spokenTone)}${note}`;
}

export function contourVerdict(opts: {
  userStart: number | null;
  expectedTone: number;
  heardTone: number | null;
}): string {
  if (opts.userStart == null) return " · not in this take";
  if (opts.expectedTone === 5 || opts.heardTone === 5) return " · light / short";
  if (opts.heardTone == null) return " · no clear pitch — try closer to the mic";
  if (opts.heardTone === opts.expectedTone) return " · shape matches";
  return " · shape is off";
}
