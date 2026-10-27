import { classifyTone } from "./pitch";
import { contourVerdict } from "./sandhi";
import { toneName } from "./text";

/** Clean-clip contour when it has pitch; otherwise the sentence slice. */
export function toneGraphModel(
  slice: readonly (number | null)[],
  practice: readonly (number | null)[] | null,
): (number | null)[] {
  if (practice && practice.some((value) => value != null)) return [...practice];
  return [...slice];
}

/** The recite contour, or null until this character has been recited. */
export function toneGraphUser(
  practice: readonly (number | null)[] | null,
): (number | null)[] | null {
  if (!practice || !practice.some((value) => value != null)) return null;
  return [...practice];
}

/**
 * Tone line for the contour drawn on the character graph.
 * The shape class is taken from that contour, so the words follow the line.
 */
/** One short clause per line, so a verdict such as "shape is off" stays intact. */
export function practiceFeedbackLines(opts: {
  who: "model" | "yours";
  expectedTone: number;
  heardTone: number | null;
  pExpected: number | null;
  contour: readonly (number | null)[];
}): string[] {
  const shape = classifyTone([...opts.contour]);
  const heard = shape != null && shape !== 5 ? shape : opts.heardTone;
  const drawnAgrees = shape != null && shape !== 5 && shape === opts.expectedTone;
  const drawnDisagrees = shape != null && shape !== 5 && shape !== opts.expectedTone;
  const verdict =
    opts.expectedTone !== 5 && drawnDisagrees
      ? " · shape is off"
      : contourVerdict({
          present: true,
          expectedTone: opts.expectedTone,
          heardTone: heard,
          pExpected: drawnAgrees ? 1 : opts.pExpected,
          shapeTone: shape,
        });
  const lines = [`Tone ${opts.expectedTone} · ${toneName(opts.expectedTone)}`];
  if (heard != null) lines.push(`${opts.who} ${toneName(heard)}`);
  const detail = verdict.replace(/^ · /, "").trim();
  if (detail) lines.push(detail);
  return lines;
}

export function practiceFeedback(opts: {
  who: "model" | "yours";
  expectedTone: number;
  heardTone: number | null;
  pExpected: number | null;
  contour: readonly (number | null)[];
}): string {
  return practiceFeedbackLines(opts).join(" · ");
}
