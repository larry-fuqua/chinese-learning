"use client";

import type { Note } from "@/lib/types";
import { emptyNote } from "@/components/ReaderHelpers";

export function ReaderNotes(p: {
  selectedWord: string | null;
  note: Note | undefined;
  editing: boolean;
  draft: Note | null;
  setDraft: (d: Note | null | ((d: Note | null) => Note | null)) => void;
  setEditing: (v: boolean) => void;
  regroupWords: () => Promise<void>;
  prepareNotes: () => Promise<void>;
  saveNote: () => Promise<void>;
}) {
  const { selectedWord, note, editing, draft, setDraft, setEditing, regroupWords, prepareNotes, saveNote } = p;
  return (
<aside className="flex max-h-[38%] min-h-0 w-full shrink-0 flex-col border-t border-[color-mix(in_oklab,var(--color-ink)_10%,transparent)] bg-[color-mix(in_oklab,white_28%,var(--color-paper))] lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
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
                <p className="hanzi text-4xl">{selectedWord}</p>
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
                    <p className="mt-1 font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                      Pinyin
                    </p>
                    <p className="font-[family-name:var(--font-sans)] text-lg text-ink-soft">
                      {note?.pinyin || draft?.pinyin}
                    </p>
                    <p className="mt-3 font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                      Meaning
                    </p>
                    <p className="font-[family-name:var(--font-sans)] text-base">
                      {note?.gloss || "No meaning yet."}
                    </p>
                    <p className="mt-3 font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                      Usage in this sentence
                    </p>
                    <p className="font-[family-name:var(--font-sans)] text-sm leading-relaxed text-ink-soft">
                      {note?.usage || "No usage note yet."}
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
  );
}
