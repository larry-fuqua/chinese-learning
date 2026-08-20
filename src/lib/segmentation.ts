/** Sentence-level grouping + pinyin. The model sees the sentence; no dictionary, no example zoo. */
export const WORD_SEGMENT_RULES = `For EACH sentence, group characters into words as they are used in that sentence, and give tone-marked pinyin for those words.

Use the sentence's meaning. Do not rewrite the Chinese. Do not look up a longest dictionary match.

Pinyin must match this sentence:
- 的 / 地 / 得 as grammar particles (的 in 我的, 地 in 高兴地说, 得 in 跑得快) are light de — never dì or dé.
- 地 meaning earth/ground is dì. 得 meaning get/obtain is dé.
- Neutral 了 is le.

Punctuation including quotes stays in the sentence (never a quote-only sentence). Punctuation tokens have empty pinyin.`;
