import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { displayPinyin, pinyinSyllablesForWord, splitPinyinSyllables } from "../src/lib/pinyin";

const cases = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests/fixtures/pinyin_split_cases.json"), "utf8"),
) as { hanzi: string; pinyin: string; expected: string[]; deployed: string[] }[];

const storyWords: { hanzi: string; stored: string; fixed: string[] }[] = [
  { hanzi: "果果", stored: "Guǒguo", fixed: ["Guǒ", "guo"] },
  { hanzi: "一年级", stored: "yìniánjí", fixed: ["yì", "nián", "jí"] },
  { hanzi: "美国人", stored: "Měiguórén", fixed: ["Měi", "guó", "rén"] },
  { hanzi: "美国", stored: "Měiguó", fixed: ["Měi", "guó"] },
  { hanzi: "家人", stored: "jiārén", fixed: ["jiā", "rén"] },
  { hanzi: "中国人", stored: "Zhōngguórén", fixed: ["Zhōng", "guó", "rén"] },
  { hanzi: "没关系", stored: "méiguānxi", fixed: ["méi", "guān", "xi"] },
  { hanzi: "北京人", stored: "Běijīngrén", fixed: ["Běi", "jīng", "rén"] },
];

test("every pinyin split case matches the reference", () => {
  assert.equal(cases.length, 27);
  for (const item of cases) {
    assert.deepEqual(pinyinSyllablesForWord(item.hanzi, item.pinyin), item.expected, item.hanzi);
    assert.deepEqual(displayPinyin(item.hanzi, item.pinyin), item.expected.join(" "), item.hanzi);
  }
});

test("story words that the greedy splitter broke now show one syllable per character", () => {
  for (const word of storyWords) {
    assert.notDeepEqual(splitPinyinSyllables(word.stored), word.fixed, word.hanzi);
    assert.deepEqual(pinyinSyllablesForWord(word.hanzi, word.stored), word.fixed, word.hanzi);
    assert.equal(displayPinyin(word.hanzi, word.stored), word.fixed.join(" "));
  }
});
