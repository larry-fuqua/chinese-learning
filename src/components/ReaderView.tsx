"use client";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { PitchGraph } from "@/components/PitchGraph";
import { SentenceLine, emptyNote } from "@/components/ReaderHelpers";
import { ReaderNotes } from "@/components/ReaderNotes";
import type { Note, PinyinMode, Story, ToneGraph, Word } from "@/lib/types";
export type ReaderViewProps = {
  story: Story;
  sentence: Story["sentences"][number];
  active: number;
  selectedWord: string | null;
  pinyinMode: PinyinMode;
  speed: number;
  playing: boolean;
  spokenChar: number | null;
  recording: boolean;
  busy: string;
  error: string;
  graph: ToneGraph | null;
  graphSyllable: number;
  playheadT: number | null;
  matchByExpected: Map<number, "ok" | "miss" | "sub">;
  editing: boolean;
  draft: Note | null;
  note: Note | undefined;
  setActive: (n: number | ((i: number) => number)) => void;
  setSelectedWord: (w: string | null) => void;
  setDraft: (d: Note | null | ((d: Note | null) => Note | null)) => void;
  setEditing: (v: boolean) => void;
  setSpeed: (n: number) => void;
  setGraphSyllable: (n: number) => void;
  stopPlayback: () => void;
  playSentence: (index?: number) => Promise<void>;
  playStory: () => Promise<void>;
  toggleRecord: () => Promise<void>;
  cyclePinyin: () => void;
  regroupWords: () => Promise<void>;
  prepareNotes: () => Promise<void>;
  saveNote: () => Promise<void>;
};
export function ReaderView(p: ReaderViewProps) {
  const {
    story, active, selectedWord, pinyinMode, speed, playing, spokenChar,
    recording, busy, error, graph, graphSyllable, playheadT, matchByExpected,
    editing, draft, note,
    setActive, setSelectedWord, setDraft, setEditing, setSpeed, setGraphSyllable,
    stopPlayback, playSentence, playStory, toggleRecord, cyclePinyin,
    regroupWords, prepareNotes, saveNote,
  } = p;
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
                    notes={story.notes}
                    onWord={(word) => {
                      setActive(index);
                      setSelectedWord(word.hanzi);
                      setDraft(
                        story.notes[word.hanzi] ??
                          (word.note
                            ? {
                                pinyin: word.pinyin,
                                gloss: word.note.split(/[.;：:]/)[0]?.trim() || word.note,
                                usage: word.note,
                                source: "ai",
                              }
                            : emptyNote(word)),
                      );
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
        <ReaderNotes
            selectedWord={selectedWord}
            note={note}
            editing={editing}
            draft={draft}
            setDraft={setDraft}
            setEditing={setEditing}
            regroupWords={regroupWords}
            prepareNotes={prepareNotes}
            saveNote={saveNote}
          />
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
