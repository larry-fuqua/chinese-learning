/** Full-story grouping + pinyin + optional usage hints. No particle special-cases. */
export const WORD_SEGMENT_RULES = `Read the WHOLE text. Group characters into words as they are used in this story, and give tone-marked pinyin for those words.

Use the story's meaning. Do not rewrite the Chinese. Do not longest-match a dictionary.

When a word group would help a learner, add a short English usage hint. Prefer a "note" field on that word. You may also put the hint in braces after the pinyin, e.g. gāoxìng de {happily; 地 marks the adverb}.
Only add a hint when it earns its keep: grammar particles, a reading that isn't the obvious one, a set phrase, a name, a contrast. Skip 的/是/了 unless the usage is easy to miss.

Punctuation including quotes stays in its sentence (never a quote-only sentence). Punctuation tokens have empty pinyin.`;
