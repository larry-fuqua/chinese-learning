import type { Story } from "./types";

export const SAMPLE_STORY: Story = {
  id: "sample-xiaoming",
  title: "小明的一天",
  level: "HSK1",
  bundled: true,
  hanzi: [
    "今天天气很好。",
    "小明去公园。",
    "他看见一只猫。",
    "猫很可爱。",
    "小明说：“你好！”",
    "猫看着他。",
    "小明很高兴。",
    "他回家了。",
  ].join("\n"),
  sentences: [
    {
      id: "s1",
      hanzi: "今天天气很好。",
      pinyin: "Jīntiān tiānqì hěn hǎo.",
      words: [
        { hanzi: "今天", pinyin: "jīntiān" },
        { hanzi: "天气", pinyin: "tiānqì" },
        { hanzi: "很", pinyin: "hěn" },
        { hanzi: "好", pinyin: "hǎo" },
        { hanzi: "。", pinyin: "" },
      ],
    },
    {
      id: "s2",
      hanzi: "小明去公园。",
      pinyin: "Xiǎomíng qù gōngyuán.",
      words: [
        { hanzi: "小明", pinyin: "Xiǎomíng" },
        { hanzi: "去", pinyin: "qù" },
        { hanzi: "公园", pinyin: "gōngyuán" },
        { hanzi: "。", pinyin: "" },
      ],
    },
    {
      id: "s3",
      hanzi: "他看见一只猫。",
      pinyin: "Tā kànjiàn yì zhī māo.",
      words: [
        { hanzi: "他", pinyin: "tā" },
        { hanzi: "看见", pinyin: "kànjiàn" },
        { hanzi: "一", pinyin: "yì" },
        { hanzi: "只", pinyin: "zhī" },
        { hanzi: "猫", pinyin: "māo" },
        { hanzi: "。", pinyin: "" },
      ],
    },
    {
      id: "s4",
      hanzi: "猫很可爱。",
      pinyin: "Māo hěn kě'ài.",
      words: [
        { hanzi: "猫", pinyin: "māo" },
        { hanzi: "很", pinyin: "hěn" },
        { hanzi: "可爱", pinyin: "kě'ài" },
        { hanzi: "。", pinyin: "" },
      ],
    },
    {
      id: "s5",
      hanzi: "小明说：“你好！”",
      pinyin: "Xiǎomíng shuō: “Nǐ hǎo!”",
      words: [
        { hanzi: "小明", pinyin: "Xiǎomíng" },
        { hanzi: "说", pinyin: "shuō" },
        { hanzi: "：", pinyin: "" },
        { hanzi: "“", pinyin: "" },
        { hanzi: "你好", pinyin: "nǐ hǎo" },
        { hanzi: "！", pinyin: "" },
        { hanzi: "”", pinyin: "" },
      ],
    },
    {
      id: "s6",
      hanzi: "猫看着他。",
      pinyin: "Māo kànzhe tā.",
      words: [
        { hanzi: "猫", pinyin: "māo" },
        { hanzi: "看着", pinyin: "kànzhe" },
        { hanzi: "他", pinyin: "tā" },
        { hanzi: "。", pinyin: "" },
      ],
    },
    {
      id: "s7",
      hanzi: "小明很高兴。",
      pinyin: "Xiǎomíng hěn gāoxìng.",
      words: [
        { hanzi: "小明", pinyin: "Xiǎomíng" },
        { hanzi: "很", pinyin: "hěn" },
        { hanzi: "高兴", pinyin: "gāoxìng" },
        { hanzi: "。", pinyin: "" },
      ],
    },
    {
      id: "s8",
      hanzi: "他回家了。",
      pinyin: "Tā huí jiā le.",
      words: [
        { hanzi: "他", pinyin: "tā" },
        { hanzi: "回家", pinyin: "huíjiā" },
        { hanzi: "了", pinyin: "le" },
        { hanzi: "。", pinyin: "" },
      ],
    },
  ],
  notes: {
    今天: {
      pinyin: "jīntiān",
      gloss: "today",
      usage: "Time word. Usually goes near the start: 今天天气很好.",
      source: "sample",
    },
    天气: {
      pinyin: "tiānqì",
      gloss: "weather",
      usage:
        "Everyday weather (nice today, raining). Not 气候, which means climate over a long period.",
      source: "sample",
    },
    小明: {
      pinyin: "Xiǎomíng",
      gloss: "Xiao Ming (a common boy's name in textbooks)",
      usage: "小 + given name is a familiar nickname. Treat it as one name, not “little” + Ming.",
      source: "sample",
    },
    公园: {
      pinyin: "gōngyuán",
      gloss: "park",
      usage: "A public park. 公 public + 园 garden.",
      source: "sample",
    },
    看见: {
      pinyin: "kànjiàn",
      gloss: "to see / to catch sight of",
      usage:
        "Resultative: 看 (look) + 见 (perceive). You looked and successfully saw. Contrast 看 “look / watch”.",
      source: "sample",
    },
    只: {
      pinyin: "zhī",
      gloss: "measure word for certain animals",
      usage:
        "一只猫 one cat. 一 often becomes yì (4th tone) before a 1st-tone measure word.",
      source: "sample",
    },
    可爱: {
      pinyin: "kě'ài",
      gloss: "cute / lovable",
      usage: "可 + 爱 “worthy of love”. Common for animals, kids, objects.",
      source: "sample",
    },
    你好: {
      pinyin: "nǐ hǎo",
      gloss: "hello",
      usage: "The default greeting. Both syllables 3rd tone; 你 is often a rising 2nd in natural speech (tone sandhi).",
      source: "sample",
    },
    看着: {
      pinyin: "kànzhe",
      gloss: "looking at (ongoing)",
      usage: "着 (zhe) marks a continuing state: the cat is looking at him.",
      source: "sample",
    },
    高兴: {
      pinyin: "gāoxìng",
      gloss: "happy / glad",
      usage: "很高兴 is the usual HSK-1 pattern. 高 high + 兴 interest/mood.",
      source: "sample",
    },
    回家: {
      pinyin: "huíjiā",
      gloss: "to go home / return home",
      usage: "回 return + 家 home. 了 here just marks that it happened.",
      source: "sample",
    },
    了: {
      pinyin: "le",
      gloss: "aspect particle (completed / change)",
      usage:
        "Neutral tone. In 他回家了 it marks a completed change: he went home (and that’s the new situation).",
      source: "sample",
    },
  },
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
};
