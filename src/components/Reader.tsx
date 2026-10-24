"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { playBuffer, playSlice, startRecorder, type Recorder } from "@/lib/audio";
import {
  alignUserSyllableTimes,
  buildSyllablePitches,
  extractPitch,
} from "@/lib/pitch";
import { getBook, getStory, saveStory, upsertNote } from "@/lib/storage";
import { compareHanzi, glueOrphanPunct, isHan } from "@/lib/text";
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
import {
  emptyNote,
  mergeSentences,
  base64ToBuffer,
  loadReferenceGraph,
  decodeReference,
} from "@/components/ReaderHelpers";
import { ReaderView } from "@/components/ReaderView";
import type { ReplayTrack } from "@/components/PitchGraph";
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
  const [replayTrack, setReplayTrack] = useState<ReplayTrack>("model");
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [playingTrack, setPlayingTrack] = useState<ReplayTrack | null>(null);
  const [hasUserAudio, setHasUserAudio] = useState(false);
  const [matches, setMatches] = useState<("ok" | "miss" | "sub" | "extra")[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Note | null>(null);
  const [chapterNav, setChapterNav] = useState<{
    bookTitle?: string;
    previous?: { id: string; label: string };
    next?: { id: string; label: string };
  }>({});
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const pitchCache = useRef<Map<string, PitchPoint[]>>(new Map());
  const playGen = useRef(0);
  const modelAudioRef = useRef<ArrayBuffer | null>(null);
  const userAudioRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null);
  useEffect(() => {
    void getStory(storyId)
      .then((found) => {
        if (!found) setMissing(true);
        else setStory({ ...found, sentences: glueOrphanPunct(found.sentences) });
      })
      .catch(() => setMissing(true));
  }, [storyId]);
  useEffect(() => {
    if (!story?.bookId) {
      setChapterNav({});
      return;
    }
    const bookId = story.bookId;
    const storyIdInBook = story.id;
    void getBook(bookId)
      .then((book) => {
        if (!book) {
          setChapterNav({});
          return;
        }
        const index = book.chapters.findIndex((chapter) => chapter.id === storyIdInBook);
        const labelOf = (chapter: (typeof book.chapters)[number]) =>
          `${chapter.chapterNumber}. ${chapter.chapterTitle || chapter.title}`;
        setChapterNav({
          bookTitle: book.title,
          previous: index > 0 ? { id: book.chapters[index - 1]!.id, label: labelOf(book.chapters[index - 1]!) } : undefined,
          next:
            index >= 0 && index < book.chapters.length - 1
              ? { id: book.chapters[index + 1]!.id, label: labelOf(book.chapters[index + 1]!) }
              : undefined,
        });
      })
      .catch(() => setChapterNav({}));
  }, [story]);
  const sentence = story?.sentences[active];
  const note = selectedWord && story ? story.notes[selectedWord] : undefined;
  const cyclePinyin = useCallback(() => {
    setPinyinMode((mode) => {
      const i = PINYIN_CYCLE.indexOf(mode);
      return PINYIN_CYCLE[(i + 1) % PINYIN_CYCLE.length];
    });
  }, []);
  const endIfCurrent = useCallback((gen: number) => {
    if (playGen.current !== gen) return;
    setPlaying(false);
    setSpokenChar(null);
    setPlayheadT(null);
    setReplayIndex(null);
    setPlayingTrack(null);
    setBusy("");
  }, []);
  const stopPlayback = useCallback(() => {
    playGen.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPlaying(false);
    setSpokenChar(null);
    setPlayheadT(null);
    setReplayIndex(null);
    setPlayingTrack(null);
    setBusy("");
  }, []);
  const ensureTts = useCallback(
    async (s: Sentence): Promise<TtsCache> => {
      const response = await apiFetch("/api/tts", {
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
      return cache;
    },
    [speed],
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
      const gen = ++playGen.current;
      try {
        const tts = await ensureTts(s);
        if (playGen.current !== gen) return;
        const refGraph = await loadReferenceGraph(s, tts, story.id, speed, pitchCache.current);
        if (playGen.current !== gen) return;
        modelAudioRef.current = tts.audio;
        userAudioRef.current = null;
        setHasUserAudio(false);
        setReplayTrack("model");
        setGraph(refGraph);
        setGraphSyllable(0);
        setPlayheadT(0);
        const controller = new AbortController();
        abortRef.current = controller;
        setPlaying(true);
        setBusy("");
        await playBuffer(tts.audio, {
          signal: controller.signal,
          onTime: (t) => {
            if (playGen.current !== gen) return;
            setPlayheadT(t);
            let spoken: number | null = null;
            refGraph.syllables.forEach((syllable, i) => {
              if (syllable.end > syllable.start && t >= syllable.start && t < syllable.end) {
                spoken = i;
              }
            });
            setSpokenChar(spoken);
          },
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError" && playGen.current === gen) {
          setError(err instanceof Error ? err.message : "Playback failed.");
        }
      } finally {
        endIfCurrent(gen);
      }
    },
    [active, endIfCurrent, ensureTts, speed, stopPlayback, story],
  );
  const replaySyllable = useCallback(
    async (index: number, alternate: boolean) => {
      const syllable = graph?.syllables[index];
      if (!syllable) return;
      const track: ReplayTrack = alternate
        ? replayTrack === "model"
          ? "yours"
          : "model"
        : replayTrack;
      const start = track === "yours" ? syllable.userStart : syllable.start;
      const end = track === "yours" ? syllable.userEnd : syllable.end;
      if (start == null || end == null || !(end > start)) {
        setError(
          track === "yours"
            ? "No recording for that character."
            : "No original timing for that character.",
        );
        return;
      }
      const source = track === "yours" ? userAudioRef.current : modelAudioRef.current;
      if (!source) {
        setError(
          track === "yours" ? "Record a take to replay your audio." : "Hear the sentence first.",
        );
        return;
      }
      stopPlayback();
      setError("");
      setGraphSyllable(index);
      const gen = ++playGen.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setReplayIndex(index);
      setPlayingTrack(track);
      setPlaying(true);
      try {
        await playSlice(source, start, end, {
          padSec: 0,
          signal: controller.signal,
          onTime: (t) => {
            if (playGen.current === gen) setPlayheadT(t);
          },
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError" && playGen.current === gen) {
          setError(err instanceof Error ? err.message : "Playback failed.");
        }
      } finally {
        endIfCurrent(gen);
      }
    },
    [endIfCurrent, graph, replayTrack, stopPlayback],
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
        const response = await apiFetch("/api/stt", { method: "POST", body: form });
        const body = (await response.json()) as {
          error?: string;
          text?: string;
          words?: { text: string; start: number; end: number }[];
          duration?: number;
        };
        if (!response.ok) throw new Error(body.error || "Could not hear that.");
        const compared = compareHanzi(sentence.hanzi, body.text ?? "");
        const { refPitch, duration, windows } = await decodeReference(
          sentence,
          tts,
          story.id,
          speed,
          pitchCache.current,
        );
        const userPitch = extractPitch(take.samples, take.sampleRate);
        const userDuration =
          body.duration ?? take.samples.length / take.sampleRate;
        const userTimes = alignUserSyllableTimes({
          expectedChars: compared.expectedChars,
          expectedText: sentence.hanzi,
          heardChars: compared.heardChars,
          sttWords: body.words ?? [],
          userPitch,
          userDuration,
          ttsDuration: duration,
          samples: take.samples,
          sampleRate: take.sampleRate,
        });
        const syllables = buildSyllablePitches({
          words: sentence.words,
          refTimes: windows,
          userTimes,
          refPitch,
          userPitch,
        });
        setGraph({
          syllables,
          refPitch,
          userPitch,
          duration: Math.max(duration, userDuration),
          heard: body.text ?? "",
        });
        modelAudioRef.current = tts.audio;
        userAudioRef.current = { samples: take.samples, sampleRate: take.sampleRate };
        setHasUserAudio(true);
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
  async function regroupWords() {
    if (!story) return;
    setBusy("Grouping words…");
    setError("");
    try {
      const response = await apiFetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hanzi: story.hanzi }),
      });
      const body = (await response.json()) as {
        sentences?: Story["sentences"];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not regroup words.");
      if (!body.sentences?.length) throw new Error("No sentences returned.");
      const next: Story = {
        ...story,
        sentences: body.sentences,
        notes: story.notes,
      };
      await saveStory(next);
      setStory(next);
      setSelectedWord(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not regroup words.");
    } finally {
      setBusy("");
    }
  }
  async function prepareNotes() {
    if (!story) return;
    setBusy("Writing notes…");
    setError("");
    try {
      const response = await apiFetch("/api/prepare", {
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
      const next: Story = {
        ...story,
        title: story.title,
        sentences: mergeSentences(story.sentences, body.sentences),
        notes: story.notes,
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
    <ReaderView
      story={story}
      sentence={sentence}
      active={active}
      selectedWord={selectedWord}
      pinyinMode={pinyinMode}
      speed={speed}
      playing={playing}
      spokenChar={spokenChar}
      recording={recording}
      busy={busy}
      error={error}
      graph={graph}
      graphSyllable={graphSyllable}
      playheadT={playheadT}
      replayTrack={replayTrack}
      setReplayTrack={setReplayTrack}
      replayIndex={replayIndex}
      playingTrack={playingTrack}
      hasUserAudio={hasUserAudio}
      replaySyllable={(index, alternate) => void replaySyllable(index, alternate)}
      matchByExpected={matchByExpected}
      editing={editing}
      draft={draft}
      note={note}
      setActive={setActive}
      setSelectedWord={setSelectedWord}
      setDraft={setDraft}
      setEditing={setEditing}
      setSpeed={setSpeed}
      setGraphSyllable={setGraphSyllable}
      stopPlayback={stopPlayback}
      playSentence={playSentence}
      playStory={playStory}
      toggleRecord={toggleRecord}
      cyclePinyin={cyclePinyin}
      regroupWords={regroupWords}
      prepareNotes={prepareNotes}
      saveNote={saveNote}
      bookTitle={chapterNav.bookTitle}
      previousChapter={chapterNav.previous}
      nextChapter={chapterNav.next}
    />
  );
}
