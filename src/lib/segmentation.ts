/** Shared instructions: context-aware word grouping, not longest-match dictionary. */
export const WORD_SEGMENT_RULES = `Segment clickable words the way a learner should tap them.

Use THIS sentence's meaning. Do not use greedy longest-match from a dictionary.

Group when it is one vocabulary item or name:
- Pronoun + 们: 我们 你们 他们 她们 它们
- Titles: 先生 太太 小姐 老师
- Place/country names: 中国 北京 美国
- Everyday compounds: 今天 天气 公园 看见
- Reduplicated nicknames/kinship: 果果 明明 妈妈 爸爸

Do NOT glue a verb onto the start of its object:
- 看中国 = 看 + 中国  (NOT 看中 + 国). 看中 is only a word when it means "settle on / take a fancy to".
- 在中国 = 在 + 中国
- 是中国人 = 是 + 中国 + 人

Keep punctuation (including quotes “ ” " ') attached to the sentence; never make a quotation mark its own sentence. Punctuation tokens have empty pinyin.

Pinyin: tone marks per syllable (wǒmen, xiānsheng, tàitai, Zhōngguó). Neutral 了 is le.

Examples:
我们是中国人。 → 我们 / 是 / 中国 / 人 / 。
你们好。 → 你们 / 好 / 。
看中国。 → 看 / 中国 / 。
王先生来了。 → 王 / 先生 / 来 / 了 / 。
李太太。 → 李 / 太太 / 。
果果来了。 → 果果 / 来 / 了 / 。
他说：“你好！” → 他 / 说 / ： / “ / 你好 / ！ / ”`;
