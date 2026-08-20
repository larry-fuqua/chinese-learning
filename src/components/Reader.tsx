"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { PitchGraph } from "@/components/PitchGraph";
import { playBuffer, startRecorder, type Recorder } from "@/lib/audio";
import {
  alignUserSyllableTimes,
  buildSyllablePitches,
  extractPitch,
  referenceSyllables,
  syllableTimesFromChars,
} from "@/lib/pitch";
import {
  getStory,
  getTts,
  putTts,
  saveStory,
  upsertNote,
} from "@/lib/storage";
import { compareHanzi, isHan } from "@/lib/text";
import type {
  Note,
  PinyinMode,
  PrepareResponse,
  PitchPoint,
  Sentence,
  Story,
  ToneGraph,
  TtsCache,
  Word,
} from "@/lib/types";
import { decodeToMono } from "@/lib/wav";

const PINYIN_CYCLE: PinyinMode[] = ["off", "word", "line", "all"];

export function Reader({ storyId }: { storyId: string }) {
  const [story, setStory] = useState<Story | null>(null);
  const [missing, setMissing] = useState(false);
  const [active, setActive] = useState(0);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [pinyinMode, setPinyinMode] = useState<PinyinMode>("off");
  const [speed, setSpeed] = useState(0.85);
  const [playing, setPlaying] = useState(false);
  const [spokenChar, setSpokenChar] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [graph, setGraph] = useState<ToneGraph | null>(null);
  const [graphSyllable, setGraphSyllable] = useState(0);
  const [playheadT, setPlayheadT] = useState<number | null>(null);
  const [matches, setMatches] = useState<("ok" | "miss" | "sub" | "extra")[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Note | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const pitchCache = useRef<Map<string, PitchPoint[]>>(new Map());

  useEffect(() => {
    void getStory(storyId).then((found) => {
      if (!found) setMissing(true);
      else setStory(found);
    });
  }, [storyId]);

  const sentence = story?.sentences[active];
  const note = selectedWord && story ? story.notes[selectedWord] : undefined;

  const cyclePinyin = useCallback(() => {
    setPinyinMode((mode) => {
      const i = PINYIN_CYCLE.indexOf(mode);
      return PINYIN_CYCLE[(i + 1) % PINYIN_CYCLE.length];
    });
  }, []);

  const stopPlayback = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPlaying(false);
    setSpokenChar(null);
  }, []);

  const ensureTts = useCallback(
    async (s: Sentence): Promise<TtsCache> => {
      const cached = await getTts(storyId, s.id, speed);
      if (cached) return cached;
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: s.hanzi, speed }),
      });
      const body = (await response.json()) as {
        error?: string;
        audioBase64?: string;
        duration?: number;
        graphChars?: string[];
        charTimes?: [number, number][];
        speed?: number;
      };
      if (!response.ok || !body.audioBase64) {
        throw new Error(body.error || "Could not speak this sentence.");
      }
      const audio = base64ToBuffer(body.audioBase64);
      const cache: TtsCache = {
        audio,
        duration: body.duration ?? 0,
        graphChars: body.graphChars ?? [...s.hanzi],
        charTimes: body.charTimes ?? [],
        speed: body.speed ?? speed,
      };
      await putTts(storyId, s.id, cache);
      return cache;
    },
    [speed, storyId],
  );

  const playSentence = useCallback(
    async (index = active) => {
      if (!story) return;
      const s = story.sentences[index];
      if (!s) return;
      stopPlayback();
      setError("");
      setBusy("Hearing…");
      setActive(index);
      try {
        const tts = await ensureTts(s);
        const refGraph = await loadReferenceGraph(s, tts, story.id, speed, pitchCache.current);
        setGraph(refGraph);
        setGraphSyllable(0);
        setPlayheadT(0);
        const controller = new AbortController();
        abortRef.current = controller;
        setPlaying(true);
        setBusy("");
        const hanIndex = hanCharOffsets(s.hanzi);
        await playBuffer(tts.audio, {
          signal: controller.signal,
          onTime: (t) => {
            setPlayheadT(t);
            const gi = tts.charTimes.findIndex(
              ([start, end]) => t >= start && t < end,
            );
            if (gi >= 0) {
              const ch = tts.graphChars[gi];
              const mapped = hanIndex.get(`${ch}:${countBefore(tts.graphChars, gi, ch)}`);
              setSpokenChar(mapped ?? null);
            }
          },
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Playback failed.");
        }
      } finally {
        setPlaying(false);
        setSpokenChar(null);
        setPlayheadT(null);
        setBusy("");
      }
    },
    [active, ensureTts, stopPlayback, story],
  );

  const playStory = useCallback(async () => {
    if (!story) return;
    for (let i = 0; i < story.sentences.length; i++) {
      await playSentence(i);
      if (abortRef.current === null && i < story.sentences.length - 1) {
        /* user stopped */
        break;
      }
    }
  }, [playSentence, story]);

  const toggleRecord = useCallback(async () => {
    if (!story || !sentence) return;
    if (recording && recorderRef.current) {
      setRecording(false);
      setBusy("Checking…");
      try {
        const take = await recorderRef.current.stop();
        recorderRef.current = null;
        const tts = await ensureTts(sentence);
        const form = new FormData();
        form.append("file", take.wav, "recite.wav");
        form.append(
          "hints",
          sentence.words.map((w) => w.hanzi).filter((h) => /[\u3400-\u9fff]/.test(h)).join(" "),
        );
        const response = await fetch("/api/stt", { method: "POST", body: form });
        const body = (await response.json()) as {
          error?: string;
          text?: string;
          words?: { text: string; start: number; end: number }[];
          duration?: number;
        };
        if (!response.ok) throw new Error(body.error || "Could not hear that.");

        const compared = compareHanzi(sentence.hanzi, body.text ?? "");
        let refPitch = pitchCache.current.get(ttsKey(story.id, sentence.id, speed));
        if (!refPitch) {
          const decoded = await decodeToMono(tts.audio);
          refPitch = extractPitch(decoded.samples, decoded.sampleRate);
          pitchCache.current.set(ttsKey(story.id, sentence.id, speed), refPitch);
        }
        const userPitch = extractPitch(take.samples, take.sampleRate);
        const refTimes = syllableTimesFromChars(
          sentence.hanzi,
          tts.graphChars,
          tts.charTimes,
        );
        const userDuration =
          body.duration ?? take.samples.length / take.sampleRate;
        const userTimes = alignUserSyllableTimes({
          expectedChars: compared.expectedChars,
          heardChars: compared.heardChars,
          sttWords: body.words ?? [],
          userPitch,
          userDuration,
          ttsDuration: tts.duration,
        });
        const syllables = buildSyllablePitches({
          words: sentence.words,
          refTimes,
          userTimes,
          refPitch,
          userPitch,
        });
        setGraph({
          syllables,
          refPitch,
          userPitch,
          duration: Math.max(tts.duration, userDuration),
          heard: body.text ?? "",
        });
        setMatches(compared.matches);
        setGraphSyllable(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Recite failed.");
      } finally {
        setBusy("");
      }
      return;
    }

    setError("");
    setMatches(null);
    try {
      recorderRef.current = await startRecorder();
      setRecording(true);
    } catch {
      setError("Microphone permission is needed to recite.");
    }
  }, [ensureTts, recording, sentence, speed, story]);

  async function saveNote() {
    if (!story || !selectedWord || !draft) return;
    const updated = await upsertNote(story.id, selectedWord, {
      ...draft,
      source: "user",
    });
    if (updated) setStory(updated);
    setEditing(false);
  }

  async function prepareNotes() {
    if (!story) return;
    setBusy("Writing notes…");
    setError("");
    try {
      const response = await fetch("/api/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: story.title,
          level: story.level,
          hanzi: story.hanzi,
        }),
      });
      const body = (await response.json()) as PrepareResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || "Prepare failed.");
      const notes = { ...body.notes, ...keepUserNotes(story) };
      const next: Story = {
        ...story,
        title: story.title,
        sentences: mergeSentences(story.sentences, body.sentences),
        notes,
        hanzi: story.hanzi,
      };
      await saveStory(next);
      setStory(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare notes.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (playing) stopPlayback();
        else void playSentence();
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void toggleRecord();
      } else if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        cyclePinyin();
      } else if (event.key === "Escape") {
        if (recording) void toggleRecord();
        else stopPlayback();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => Math.min((story?.sentences.length ?? 1) - 1, i + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cyclePinyin, playSentence, playing, recording, stopPlayback, story, toggleRecord]);

  useEffect(() => {
    setMatches(null);
    setPlayheadT(null);
    setSpokenChar(null);
    setSelectedWord(null);
    setEditing(false);
    document.getElementById(`sentence-${active}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [active]);

  const matchByExpected = useMemo(() => {
    if (!matches) return new Map<number, "ok" | "miss" | "sub">();
    const map = new Map<number, "ok" | "miss" | "sub">();
    let ei = 0;
    for (const m of matches) {
      if (m === "extra") continue;
      map.set(ei, m);
      ei++;
    }
    return map;
  }, [matches]);

  if (missing) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <p className="hanzi text-2xl">找不到这篇课文。</p>
        <Link href="/" className="mt-4 inline-block text-cinnabar">
          Back to library
        </Link>
      </div>
    );
  }

  if (!story || !sentence) {
    return (
      <div className="px-6 py-16 font-[family-name:var(--font-sans)] text-ink-soft">
        Loading…
      </div>
    );
  }

  return (
    <div className="reader-shell flex h-dvh flex-col overflow-hidden">
      <AppHeader
        title={story.title}
        right={
          <>
            <span className="hidden font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-cinnabar sm:inline">
              {story.level}
            </span>
            <Link
              href={`/new?id=${encodeURIComponent(story.id)}`}
              className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5 font-[family-name:var(--font-sans)] text-sm"
            >
              Edit
            </Link>
            <Link
              href="/"
              className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5 font-[family-name:var(--font-sans)] text-sm"
            >
              Library
            </Link>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-[color-mix(in_oklab,var(--color-ink)_10%,transparent)] px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 font-[family-name:var(--font-sans)] text-sm">
              <button
                type="button"
                onClick={() => (playing ? stopPlayback() : void playSentence())}
                className="rounded-full bg-cinnabar px-4 py-1.5 font-medium text-paper"
              >
                {playing ? "Stop" : "Hear"}
              </button>
              <button
                type="button"
                onClick={() => void toggleRecord()}
                className={`rounded-full px-4 py-1.5 font-medium ${
                  recording
                    ? "bg-ink text-paper"
                    : "border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)]"
                }`}
              >
                {recording ? "Stop & check" : "Recite"}
              </button>
              <button
                type="button"
                onClick={() => void playStory()}
                className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5"
              >
                Hear all
              </button>
              <button
                type="button"
                onClick={cyclePinyin}
                className="rounded-full border border-[color-mix(in_oklab,var(--color-ink)_16%,transparent)] px-3 py-1.5"
              >
                Pinyin: {pinyinMode}
              </button>
              <label className="ml-auto flex items-center gap-2 text-xs text-ink-soft">
                Speed
                <input
                  type="range"
                  min={0.7}
                  max={1.2}
                  step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                />
                <span>{speed.toFixed(2)}</span>
              </label>
            </div>
            {error ? (
              <p className="mt-2 font-[family-name:var(--font-sans)] text-sm text-cinnabar">
                {error}
              </p>
            ) : null}
            {busy ? (
              <p className="mt-2 font-[family-name:var(--font-sans)] text-sm text-ink-soft">
                {busy}
              </p>
            ) : null}
            {recording ? (
              <p className="mt-2 font-[family-name:var(--font-sans)] text-sm text-cinnabar">
                Listening… read the highlighted sentence, then press Stop & check.
              </p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
            <div className="space-y-1">
              {story.sentences.map((s, index) => (
                <button
                  key={s.id}
                  id={`sentence-${index}`}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`sentence-row w-full rounded-r-xl px-3 py-3 text-left ${
                    index === active ? "active" : ""
                  }`}
                >
                  <SentenceLine
                    sentence={s}
                    active={index === active}
                    pinyinMode={pinyinMode}
                    selectedWord={index === active ? selectedWord : null}
                    spokenChar={index === active ? spokenChar : null}
                    matchByExpected={index === active ? matchByExpected : undefined}
                    onWord={(word) => {
                      setActive(index);
                      setSelectedWord(word.hanzi);
                      setDraft(story.notes[word.hanzi] ?? emptyNote(word));
                      setEditing(false);
                    }}
                  />
                </button>
              ))}
            </div>
            <p className="mt-4 pb-2 font-[family-name:var(--font-sans)] text-xs text-ink-soft">
              <kbd>Space</kbd> hear · <kbd>R</kbd> recite · <kbd>P</kbd> pinyin ·{" "}
              <kbd>↑</kbd>
              <kbd>↓</kbd> sentence
            </p>
          </div>
        </section>

        <aside className="flex max-h-[38%] min-h-0 w-full shrink-0 flex-col border-t border-[color-mix(in_oklab,var(--color-ink)_10%,transparent)] bg-[color-mix(in_oklab,white_28%,var(--color-paper))] lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
          <div className="flex shrink-0 items-center justify-between px-4 py-3 lg:px-5">
            <p className="font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.2em] text-ink-soft">
              Notes
            </p>
            <button
              type="button"
              onClick={() => void prepareNotes()}
              className="font-[family-name:var(--font-sans)] text-xs text-cinnabar"
            >
              AI fill gaps
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 lg:px-5">
            {!selectedWord ? (
              <p className="font-[family-name:var(--font-sans)] text-sm leading-relaxed text-ink-soft">
                Click a word for pinyin and usage in this sentence. Notes stay
                here while you scroll the story.
              </p>
            ) : (
              <div>
                <p className="hanzi text-4xl">{selectedWord}</p>
                {editing && draft ? (
                  <div className="mt-3 space-y-2">
                    <input
                      value={draft.pinyin}
                      onChange={(e) => setDraft({ ...draft, pinyin: e.target.value })}
                      className="w-full rounded-md border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/60 px-2 py-1 font-[family-name:var(--font-sans)] text-sm"
                      placeholder="pinyin"
                    />
                    <input
                      value={draft.gloss}
                      onChange={(e) => setDraft({ ...draft, gloss: e.target.value })}
                      className="w-full rounded-md border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/60 px-2 py-1 font-[family-name:var(--font-sans)] text-sm"
                      placeholder="English gloss"
                    />
                    <textarea
                      value={draft.usage}
                      onChange={(e) => setDraft({ ...draft, usage: e.target.value })}
                      rows={5}
                      className="w-full rounded-md border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/60 px-2 py-1 font-[family-name:var(--font-sans)] text-sm"
                      placeholder="How it is used here"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveNote()}
                        className="rounded-full bg-cinnabar px-3 py-1 font-[family-name:var(--font-sans)] text-sm text-paper"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="rounded-full px-3 py-1 font-[family-name:var(--font-sans)] text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-1 font-[family-name:var(--font-sans)] text-lg text-ink-soft">
                      {note?.pinyin || draft?.pinyin}
                    </p>
                    <p className="mt-3 font-[family-name:var(--font-sans)] text-base">
                      {note?.gloss || "No gloss yet."}
                    </p>
                    <p className="mt-2 font-[family-name:var(--font-sans)] text-sm leading-relaxed text-ink-soft">
                      {note?.usage ||
                        "No usage note yet. Add one, or let AI draft key-word notes."}
                    </p>
                    <button
                      type="button"
                      className="mt-4 font-[family-name:var(--font-sans)] text-sm text-cinnabar"
                      onClick={() => {
                        setDraft(
                          note ??
                            emptyNote({
                              hanzi: selectedWord,
                              pinyin: "",
                            }),
                        );
                        setEditing(true);
                      }}
                    >
                      Edit note
                    </button>
                    {note?.source === "user" ? (
                      <p className="mt-2 font-[family-name:var(--font-sans)] text-xs text-moss">
                        Your edit is kept if AI runs again.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="shrink-0">
        {graph ? (
          <PitchGraph
            graph={graph}
            selected={graphSyllable}
            playheadT={playheadT}
            onSelect={setGraphSyllable}
          />
        ) : (
          <div className="bg-graph px-4 py-3 text-center font-[family-name:var(--font-sans)] text-xs tracking-[0.14em] text-paper/50 uppercase">
            Hear a sentence to see its pitch graph
          </div>
        )}
      </div>
    </div>
  );
}

function SentenceLine({
  sentence,
  active,
  pinyinMode,
  selectedWord,
  spokenChar,
  matchByExpected,
  onWord,
}: {
  sentence: Sentence;
  active: boolean;
  pinyinMode: PinyinMode;
  selectedWord: string | null;
  spokenChar: number | null;
  matchByExpected?: Map<number, "ok" | "miss" | "sub">;
  onWord: (word: Word) => void;
}) {
  let hanOffset = 0;
  return (
    <p className="hanzi text-[1.7rem] leading-[2.4] sm:text-[2rem] sm:leading-[2.5]">
      {sentence.words.map((word, wi) => {
        const showRuby =
          pinyinMode === "all" ||
          (pinyinMode === "line" && active) ||
          (pinyinMode === "word" && active && selectedWord === word.hanzi);
        const chars = [...word.hanzi];
        const start = hanOffset;
        const hanCount = chars.filter(isHan).length;
        hanOffset += hanCount;
        return (
          <span
            key={`${sentence.id}-${wi}`}
            role="button"
            tabIndex={-1}
            className={`ruby-word word-btn ${
              selectedWord === word.hanzi && active ? "active" : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onWord(word);
            }}
          >
            {showRuby && word.pinyin ? <rt>{word.pinyin}</rt> : <rt>&nbsp;</rt>}
            <span>
              {chars.map((ch, ci) => {
                const hanBefore =
                  start + chars.slice(0, ci).filter(isHan).length;
                const spoken = spokenChar === hanBefore && isHan(ch);
                const match = isHan(ch) ? matchByExpected?.get(hanBefore) : undefined;
                return (
                  <span
                    key={ci}
                    className={`${spoken ? "spoken" : ""} ${
                      match === "ok"
                        ? "match-ok"
                        : match === "miss" || match === "sub"
                          ? "match-bad"
                          : ""
                    }`}
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          </span>
        );
      })}
    </p>
  );
}

function emptyNote(word: Word): Note {
  return { pinyin: word.pinyin, gloss: "", usage: "", source: "user" };
}

function keepUserNotes(story: Story): Story["notes"] {
  const kept: Story["notes"] = {};
  for (const [key, note] of Object.entries(story.notes)) {
    if (note.source === "user") kept[key] = note;
  }
  return kept;
}

function mergeSentences(current: Sentence[], incoming: Sentence[]): Sentence[] {
  if (!incoming.length) return current;
  return current.map((s, i) => {
    const next = incoming[i];
    if (!next) return s;
    return {
      ...s,
      pinyin: next.pinyin || s.pinyin,
      words: next.words?.length ? next.words : s.words,
    };
  });
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function hanCharOffsets(hanzi: string): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  const counts = new Map<string, number>();
  for (const ch of hanzi) {
    if (!isHan(ch)) continue;
    const seen = counts.get(ch) ?? 0;
    map.set(`${ch}:${seen}`, n);
    counts.set(ch, seen + 1);
    n++;
  }
  return map;
}

function countBefore(chars: string[], index: number, ch: string): number {
  let n = 0;
  for (let i = 0; i < index; i++) if (chars[i] === ch) n++;
  return n;
}

function ttsKey(storyId: string, sentenceId: string, speed: number) {
  return `${storyId}:${sentenceId}:${speed.toFixed(2)}`;
}

async function loadReferenceGraph(
  sentence: Sentence,
  tts: TtsCache,
  storyId: string,
  speed: number,
  cache: Map<string, PitchPoint[]>,
): Promise<ToneGraph> {
  const key = ttsKey(storyId, sentence.id, speed);
  let refPitch = cache.get(key);
  if (!refPitch) {
    const decoded = await decodeToMono(tts.audio);
    refPitch = extractPitch(decoded.samples, decoded.sampleRate);
    cache.set(key, refPitch);
  }
  return {
    syllables: referenceSyllables(
      sentence.words,
      sentence.hanzi,
      tts.graphChars,
      tts.charTimes,
      refPitch,
    ),
    refPitch,
    userPitch: [],
    duration: tts.duration || lastPitchTime(refPitch),
    heard: "",
  };
}

function lastPitchTime(points: PitchPoint[]): number {
  return points.length ? points[points.length - 1].t : 0.2;
}
