import assert from "node:assert/strict";
import test from "node:test";
import {
  paragraphGroupsForSentences,
  sentenceGroups,
  splitParagraphBlocks,
  splitSentences,
} from "../src/lib/text";

test("blank lines separate paragraphs and a single newline does not", () => {
  assert.deepEqual(splitParagraphBlocks("甲。\n\n乙。"), ["甲。", "乙。"]);
  assert.deepEqual(splitParagraphBlocks("甲。\r\n\r\n乙。"), ["甲。", "乙。"]);
  assert.deepEqual(splitParagraphBlocks("甲。\n乙。"), ["甲。\n乙。"]);
  assert.deepEqual(splitSentences("甲。\n乙。"), ["甲。", "乙。"]);
});

test("paragraph groups follow sentence counts, and a single paragraph is omitted", () => {
  const sentences = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(paragraphGroupsForSentences("甲。\n\n乙。\n丙。", sentences), [["a"], ["b", "c"]]);
  assert.equal(paragraphGroupsForSentences("甲。乙。", sentences.slice(0, 2)), undefined);
  assert.equal(paragraphGroupsForSentences("甲。\n乙。", sentences.slice(0, 2)), undefined);
});

test("a mismatched sentence count still gives each paragraph a sentence when it can", () => {
  const two = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(paragraphGroupsForSentences("甲\n\n乙\n\n丙", two), [["a"], ["b"]]);
  const five = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  assert.deepEqual(
    paragraphGroupsForSentences("甲。\n\n乙。\n\n丙。", five),
    [
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ],
  );
});

test("stories without paragraph info render as one paragraph", () => {
  const sentences = [
    { id: "a", hanzi: "甲。" },
    { id: "b", hanzi: "乙。" },
  ];
  const grouped = sentenceGroups(sentences);
  assert.equal(grouped.length, 1);
  assert.deepEqual(
    grouped[0]?.map((row) => row.index),
    [0, 1],
  );
  const split = sentenceGroups(sentences, [["a"], ["b"]]);
  assert.equal(split.length, 2);
  assert.equal(split[1]?.[0]?.index, 1);
});
