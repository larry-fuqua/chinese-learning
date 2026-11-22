import { classifyTone } from "./pitch";
import { sharedPitchAxis, type PitchAxis } from "./pitch-scale";
import { contourVerdict } from "./sandhi";
import { toneName } from "./text";

/** Bins of quiet kept on either side of the voiced run so the stroke is not flush to the edge. */
export const PRACTICE_VOICE_PAD = 1;

export type VoicedSpan = { start: number; end: number };

/** Inclusive bin window around the voiced samples, padded and clamped to the contour. */
export function voicedSpan(
  contour: readonly (number | null)[],
  pad = PRACTICE_VOICE_PAD,
): VoicedSpan | null {
  let start = -1;
  let end = -1;
  for (let i = 0; i < contour.length; i++) {
    if (contour[i] == null) continue;
    if (start < 0) start = i;
    end = i;
  }
  if (start < 0 || end < start) return null;
  return {
    start: Math.max(0, start - pad),
    end: Math.min(contour.length - 1, end + pad),
  };
}

/**
 * The contour actually drawn for a practice clip: the voiced run plus a small pad.
 * Silence outside that run is dropped so a long take is not stretched past the box.
 */
export function drawnPracticeContour(
  contour: readonly (number | null)[],
  pad = PRACTICE_VOICE_PAD,
): (number | null)[] {
  const span = voicedSpan(contour, pad);
  if (!span) return [...contour];
  return contour.slice(span.start, span.end + 1);
}

/** One semitone axis for the practice lines on screen. The sentence axis is not used. */
export function practicePlotAxis(
  contours: readonly (readonly (number | null)[])[],
): PitchAxis {
  return sharedPitchAxis(contours);
}

/**
 * Time span of the voiced pitch, plus a short pad.
 * A practice clip is re-binned across this span so silence does not stretch the tone.
 */
export function voicedTimeRange(
  points: readonly { t: number; hz: number | null }[],
  duration: number,
  padSec = 0.05,
): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const point of points) {
    if (point.hz == null || !(point.hz > 0) || !Number.isFinite(point.t)) continue;
    if (point.t < start) start = point.t;
    if (point.t > end) end = point.t;
  }
  if (!(end > start)) return null;
  const limit = duration > 0 ? duration : end + padSec;
  const lo = Math.max(0, start - padSec);
  const hi = Math.min(limit, end + padSec);
  if (!(hi > lo)) return null;
  return { start: lo, end: hi };
}

/** Seconds covered by the drawn window, so a quiet lead-in is not graded as the tone. */
export function practiceWindowSec(contour: readonly (number | null)[], duration: number): number {
  const span = voicedSpan(contour);
  if (!span || contour.length < 1 || !(duration > 0)) return Math.max(duration, 0);
  const fraction = (span.end - span.start + 1) / contour.length;
  return Math.max(0.05, duration * fraction);
}

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
