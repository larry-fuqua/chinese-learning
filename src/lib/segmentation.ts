/** Full-story grouping + pinyin. Notes are manual. */
export const WORD_SEGMENT_RULES = `Read the WHOLE text. Group characters into words as they are used in this story, and give tone-marked pinyin for those words.

Use the story's meaning. Do not rewrite the Chinese. Do not longest-match a dictionary.

Do not add English notes, glosses, hints, or brace comments. Words are hanzi + pinyin only.

Punctuation including quotes stays in its sentence (never a quote-only sentence). Punctuation tokens have empty pinyin.`;
