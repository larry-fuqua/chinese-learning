"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAlignment } from "@/lib/align-client";
import type { AlignSpan } from "@/lib/align-audio";
import { apiFetch } from "@/lib/api-fetch";
import { playBuffer, playSlice, startRecorder, type Recorder } from "@/lib/audio";
import { buildSyllablePitches, buildTakeGraph } from "@/lib/pitch";
import { visibleUserTake } from "@/lib/take-display";
import { bufferToBase64, decodeToMono } from "@/lib/wav";
import { getBook, getStory, saveStory, upsertNote } from "@/lib/storage";
import { compareHanzi, glueOrphanPunct, isHan } from "@/lib/text";
import type { CharSpan } from "@/lib/align-audio";
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
  const [savedTakeAvailable, setSavedTakeAvailable] = useState(false);
  const [showingPreviousTake, setShowingPreviousTake] = useState(false);
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
  const storyRef = useRef<Story | null>(null);
  const sentenceRef = useRef<Sentence | undefined>(undefined);
  type ModelSlice = {
    sentenceId: string;
    audio: ArrayBuffer;
    refPitch: PitchPoint[];
    windows: CharSpan[];
    duration: number;
  };
  type TakeSlice = {
    sentenceId: string;
    samples: Float32Array;
    sampleRate: number;
    text: string;
    words: { text: string; start: number; end: number }[];
    duration: number;
    faSpans: AlignSpan[] | null;
  };
  const modelSliceRef = useRef<ModelSlice | null>(null);
  const sessionTakeRef = useRef<TakeSlice | null>(null);
  const savedTakeRef = useRef<TakeSlice | null>(null);
  const showSavedRef = useRef(false);
  const publishRef = useRef<() => void>(() => {});
  publishRef.current = () => {
    const current = sentenceRef.current;
    if (!current) return;
    const model = modelSliceRef.current?.sentenceId === current.id ? modelSliceRef.current : null;
    const session = sessionTakeRef.current?.sentenceId === current.id ? sessionTakeRef.current : null;
    const saved = savedTakeRef.current?.sentenceId === current.id ? savedTakeRef.current : null;
    const visible = visibleUserTake({ session, saved, showSaved: showSavedRef.current });
    const take = visible.take;
    setShowingPreviousTake(visible.previous);
    if (model) modelAudioRef.current = model.audio;
    if (take) {
      userAudioRef.current = { samples: take.samples, sampleRate: take.sampleRate };
      setHasUserAudio(true);
      setMatches(compareHanzi(current.hanzi, take.text).matches);
      setGraph(
        buildTakeGraph({
          words: current.words,
          hanzi: current.hanzi,
          samples: take.samples,
          sampleRate: take.sampleRate,
          heard: take.text,
          heardChars: compareHanzi(current.hanzi, take.text).heardChars,
          sttWords: take.words,
          duration: take.duration,
          refPitch: model?.refPitch,
          refTimes: model?.windows,
          refDuration: model?.duration,
          faSpans: take.faSpans,
        }),
      );
      return;
    }
    userAudioRef.current = null;
    setHasUserAudio(false);
    setMatches(null);
    if (!model) {
      setGraph(null);
      return;
    }
    setGraph({
      syllables: buildSyllablePitches({
        words: current.words,
        refTimes: model.windows,
        userTimes: [],
        refPitch: model.refPitch,
        userPitch: [],
      }),
      refPitch: model.refPitch,
      userPitch: [],
      duration: model.duration,
      heard: "",
    });
  };
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
  storyRef.current = story;
  sentenceRef.current = sentence;
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
        const decoded = await decodeReference(s, tts, story.id, speed, pitchCache.current);
        if (playGen.current !== gen) return;
        modelSliceRef.current = {
          sentenceId: s.id,
          audio: tts.audio,
          refPitch: decoded.refPitch,
          windows: decoded.windows,
          duration: decoded.duration,
        };
        modelAudioRef.current = tts.audio;
        setReplayTrack("model");
        publishRef.current();
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
            decoded.windows.forEach((window, i) => {
              if (window.end > window.start && t >= window.start && t < window.end) {
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
        const { refPitch, duration, windows } = await decodeReference(
          sentence,
          tts,
          story.id,
          speed,
          pitchCache.current,
        );
        const userDuration = body.duration ?? take.samples.length / take.sampleRate;
        const audioBase64 = bufferToBase64(await take.wav.arrayBuffer());
        const faSpans = await fetchAlignment({
          hanzi: sentence.hanzi,
          words: sentence.words,
          audioBase64,
        });
        modelSliceRef.current = {
          sentenceId: sentence.id,
          audio: tts.audio,
          refPitch,
          windows,
          duration,
        };
        sessionTakeRef.current = {
          sentenceId: sentence.id,
          samples: take.samples,
          sampleRate: take.sampleRate,
          text: body.text ?? "",
          words: body.words ?? [],
          duration: userDuration,
          faSpans,
        };
        showSavedRef.current = false;
        setShowingPreviousTake(false);
        publishRef.current();
        setGraphSyllable(0);
        const save = new FormData();
        save.append("file", take.wav, "recite.wav");
        save.append(
          "stt",
          JSON.stringify({
            text: body.text ?? "",
            duration: userDuration,
            sampleRate: take.sampleRate,
            words: body.words ?? [],
          }),
        );
        const saved = await apiFetch(
          `/api/stories/${story.id}/takes/${encodeURIComponent(sentence.id)}`,
          { method: "PUT", body: save },
        );
        if (!saved.ok) {
          const errBody = (await saved.json()) as { error?: string };
          throw new Error(errBody.error || "Could not save this take.");
        }
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
  useEffect(() => {
    const currentStory = storyRef.current;
    const current = sentenceRef.current;
    if (!currentStory || !current) return;
    const storyId = currentStory.id;
    const sentenceId = current.id;
    if (modelSliceRef.current?.sentenceId !== sentenceId) modelSliceRef.current = null;
    if (sessionTakeRef.current?.sentenceId !== sentenceId) sessionTakeRef.current = null;
    if (savedTakeRef.current?.sentenceId !== sentenceId) savedTakeRef.current = null;
    showSavedRef.current = false;
    setShowingPreviousTake(false);
    setSavedTakeAvailable(false);
    publishRef.current();
    let cancelled = false;
    void (async () => {
      const response = await apiFetch(
        `/api/stories/${storyId}/takes/${encodeURIComponent(sentenceId)}`,
      );
      if (cancelled || sentenceRef.current?.id !== sentenceId) return;
      if (!response.ok) {
        if (!cancelled) setSavedTakeAvailable(false);
        return;
      }
      const body = (await response.json()) as {
        audioBase64?: string;
        text?: string;
        words?: { text: string; start: number; end: number }[];
        duration?: number;
      };
      if (!body.audioBase64) return;
      const decoded = await decodeToMono(base64ToBuffer(body.audioBase64));
      if (cancelled || sentenceRef.current?.id !== sentenceId) return;
      const current = sentenceRef.current;
      const faSpans = current
        ? await fetchAlignment({
            hanzi: current.hanzi,
            words: current.words,
            audioBase64: body.audioBase64,
          })
        : null;
      if (cancelled || sentenceRef.current?.id !== sentenceId) return;
      savedTakeRef.current = {
        sentenceId,
        samples: decoded.samples,
        sampleRate: decoded.sampleRate,
        text: body.text ?? "",
        words: body.words ?? [],
        duration: body.duration ?? decoded.samples.length / decoded.sampleRate,
        faSpans,
      };
      if (!cancelled) setSavedTakeAvailable(true);
      publishRef.current();
    })().catch(() => {
      if (!cancelled) setError("Could not load the saved take.");
    });
    return () => {
      cancelled = true;
    };
  }, [story?.id, sentence?.id]);
  const togglePreviousTake = useCallback(() => {
    showSavedRef.current = !showSavedRef.current;
    setShowingPreviousTake(showSavedRef.current);
    publishRef.current();
  }, []);
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
      savedTakeAvailable={savedTakeAvailable}
      showingPreviousTake={showingPreviousTake}
      togglePreviousTake={togglePreviousTake}
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
