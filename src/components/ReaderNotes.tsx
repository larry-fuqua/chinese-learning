"use client";

import { useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/types";
import { emptyNote } from "@/components/ReaderHelpers";

export function ReaderNotes(p: {
  sentenceId: string;
  selectedWord: string | null;
  note: Note | undefined;
  pinyin: string;
  definitionPending: boolean;
  editing: boolean;
  draft: Note | null;
  setDraft: (d: Note | null | ((d: Note | null) => Note | null)) => void;
  setEditing: (v: boolean) => void;
  regroupWords: () => Promise<void>;
  prepareNotes: () => Promise<void>;
  saveNote: () => Promise<void>;
}) {
  const {
    sentenceId,
    selectedWord,
    note,
    pinyin,
    definitionPending,
    editing,
    draft,
    setDraft,
    setEditing,
    regroupWords,
    prepareNotes,
    saveNote,
  } = p;
  const openNotes = useRef(new Map<string, boolean>());
  const asideRef = useRef<HTMLElement>(null);
  const noteKey = `${sentenceId}|${selectedWord ?? ""}`;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(openNotes.current.get(noteKey) ?? false);
  }, [noteKey]);
  useEffect(() => {
    if (!selectedWord) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    asideRef.current?.scrollIntoView({ block: "nearest" });
  }, [noteKey, selectedWord]);

  function toggleOpen() {
    setExpanded((value) => {
      const next = !value;
      openNotes.current.set(noteKey, next);
      if (!next) setEditing(false);
      return next;
    });
  }

  const reading = note?.pinyin || pinyin;
  const showAuto = note?.source === "ai" && Boolean(note.gloss);

  return (
    <aside
      ref={asideRef}
      className="flex w-full shrink-0 flex-col border-t border-[color-mix(in_oklab,var(--color-ink)_10%,transparent)] bg-[color-mix(in_oklab,white_28%,var(--color-paper))] lg:min-h-0 lg:w-80 lg:overflow-hidden lg:border-l lg:border-t-0"
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-3 lg:px-5">
        <p className="font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.2em] text-ink-soft">
          Notes
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void regroupWords()}
            className="font-[family-name:var(--font-sans)] text-xs text-cinnabar"
          >
            Regroup words
          </button>
          <button
            type="button"
            onClick={() => void prepareNotes()}
            className="font-[family-name:var(--font-sans)] text-xs text-cinnabar"
          >
            AI fill gaps
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 lg:px-5">
        {!selectedWord ? (
          <p className="font-[family-name:var(--font-sans)] text-sm leading-relaxed text-ink-soft">
            Click a word for pinyin and usage in this sentence. Notes stay
            here while you scroll the story.
          </p>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {expanded ? <p className="hanzi text-4xl leading-none">{selectedWord}</p> : null}
                <p
                  className={`font-[family-name:var(--font-sans)] text-lg text-ink ${expanded ? "mt-2" : ""}`}
                >
                  {reading || "…"}
                </p>
              </div>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls="word-note-details"
                onClick={toggleOpen}
                className="shrink-0 font-[family-name:var(--font-sans)] text-xs text-ink-soft underline-offset-2 hover:underline"
              >
                {expanded ? "Less" : "More"}
              </button>
            </div>
            {expanded ? (
              <div id="word-note-details">
                {editing && draft ? (
                  <div className="mt-3 space-y-2">
                    <label className="block font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                      Pinyin
                      <input
                        value={draft.pinyin}
                        onChange={(e) => setDraft({ ...draft, pinyin: e.target.value })}
                        className="mt-1 w-full rounded-md border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/60 px-2 py-1 font-[family-name:var(--font-sans)] text-sm normal-case tracking-normal text-ink"
                        placeholder="pinyin"
                      />
                    </label>
                    <label className="block font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                      Meaning
                      <input
                        value={draft.gloss}
                        onChange={(e) => setDraft({ ...draft, gloss: e.target.value })}
                        className="mt-1 w-full rounded-md border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/60 px-2 py-1 font-[family-name:var(--font-sans)] text-sm normal-case tracking-normal text-ink"
                        placeholder="meaning in this sentence"
                      />
                    </label>
                    <label className="block font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                      Usage in this sentence
                      <textarea
                        value={draft.usage}
                        onChange={(e) => setDraft({ ...draft, usage: e.target.value })}
                        rows={5}
                        className="mt-1 w-full rounded-md border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/60 px-2 py-1 font-[family-name:var(--font-sans)] text-sm normal-case tracking-normal text-ink"
                        placeholder="How it is used here"
                      />
                    </label>
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
                    <p className="mt-3 font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                      Meaning
                      {showAuto ? (
                        <span className="ml-2 font-[family-name:var(--font-sans)] text-[10px] normal-case tracking-normal text-ink-soft">
                          auto
                        </span>
                      ) : null}
                    </p>
                    <p className="font-[family-name:var(--font-sans)] text-base">
                      {note?.gloss
                        ? note.gloss
                        : definitionPending
                          ? "…"
                          : "No meaning yet."}
                    </p>
                    <p className="mt-3 font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                      Usage in this sentence
                    </p>
                    <p className="font-[family-name:var(--font-sans)] text-sm leading-relaxed text-ink-soft">
                      {note?.usage
                        ? note.usage
                        : definitionPending
                          ? "…"
                          : "No usage note yet."}
                    </p>
                    <button
                      type="button"
                      className="mt-4 font-[family-name:var(--font-sans)] text-sm text-cinnabar"
                      onClick={() => {
                        setDraft(
                          note ??
                            emptyNote({
                              hanzi: selectedWord,
                              pinyin: reading,
                            }),
                        );
                        setEditing(true);
                      }}
                    >
                      Edit
                    </button>
                    {note?.source === "user" ? (
                      <p className="mt-2 font-[family-name:var(--font-sans)] text-xs text-moss">
                        Your edit is kept if AI runs again.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
