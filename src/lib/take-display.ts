/** Which saved recording, if any, is allowed onto the You lane. */
export function visibleUserTake<T>(opts: {
  session: T | null;
  saved: T | null;
  showSaved: boolean;
}): { take: T | null; previous: boolean } {
  if (opts.session) return { take: opts.session, previous: false };
  if (opts.showSaved && opts.saved) return { take: opts.saved, previous: true };
  return { take: null, previous: false };
}

/**
 * Transcript line for the voice that is selected.
 * A saved take from disk is named as the previous take.
 */
export function heardCaption(opts: {
  track: "model" | "yours";
  referenceText: string;
  userText: string;
  previous: boolean;
}): string {
  if (opts.track === "model") {
    const text = opts.referenceText.trim();
    return text ? `Heard: ${text}` : "";
  }
  const text = opts.userText.trim();
  if (!text) return "";
  return opts.previous ? `Previous take · Heard: ${text}` : `Heard: ${text}`;
}
