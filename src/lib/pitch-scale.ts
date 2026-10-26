export type PitchAxis = { min: number; max: number };

/** Used when a sentence has too little voiced pitch to set an axis. */
export const PITCH_AXIS_FALLBACK: PitchAxis = { min: -4.5, max: 4.5 };

/** Fraction of the data span kept empty above and below the contours. */
const AXIS_PAD_RATIO = 0.1;
/** Floor so a nearly flat sentence still has a visible line, not a one-pixel stroke. */
const AXIS_PAD_MIN = 0.4;

/**
 * One semitone axis for every character on screen. The sentence's own
 * minimum and maximum fill the plot, with padding so a peak is not clipped.
 * Model and You share whatever contours are passed in.
 */
export function sharedPitchAxis(
  contours: readonly (readonly (number | null)[])[],
): PitchAxis {
  const values: number[] = [];
  for (const contour of contours) {
    for (const value of contour) {
      if (value != null && Number.isFinite(value)) values.push(value);
    }
  }
  if (values.length < 2) return { ...PITCH_AXIS_FALLBACK };
  values.sort((a, b) => a - b);
  const lo = values[0]!;
  const hi = values[values.length - 1]!;
  if (!(hi > lo)) return { min: lo - 1.5, max: hi + 1.5 };
  const pad = Math.max(AXIS_PAD_MIN, (hi - lo) * AXIS_PAD_RATIO);
  return { min: lo - pad, max: hi + pad };
}

export function semitoneToY(value: number, height: number, axis: PitchAxis): number {
  const span = axis.max - axis.min || 1;
  return height - ((value - axis.min) / span) * height;
}

export function sentencePxPerSec(widthPx: number, spanSec: number): number {
  if (!(widthPx > 0) || !(spanSec > 0)) return 0;
  return widthPx / spanSec;
}

export function slotWidth(start: number, end: number, spanSec: number, widthPx: number): number {
  if (!(spanSec > 0) || !(end > start)) return 0;
  return ((end - start) / spanSec) * widthPx;
}

/**
 * End time of the tracks actually drawn. A hidden recording does not stretch
 * the sentence, and the longest visible end spans the plot width.
 */
export function visibleTimeSpan(ends: readonly number[]): number {
  let span = 0;
  for (const end of ends) {
    if (Number.isFinite(end) && end > span) span = end;
  }
  return span > 0 ? span : 0.2;
}

/**
 * One time scale for every character in the per-character box.
 * The longest syllable fills the box; shorter ones stay proportional.
 */
export function characterPxPerSec(boxPx: number, durations: readonly number[]): number {
  let max = 0;
  for (const duration of durations) {
    if (duration > max) max = duration;
  }
  if (!(boxPx > 0) || !(max > 0)) return 0;
  return boxPx / max;
}

export type PlotBand = { top: number; height: number };

export type PitchPlotLayout = {
  gutter: number;
  plotWidth: number;
  ref: PlotBand;
  user: PlotBand | null;
  labels: PlotBand;
};

const LABEL_H = 22;
const LABEL_GAP = 6;
const BAND_GAP = 8;

/** Character labels sit in their own band under the plot. Traces never enter it. */
export function pitchPlotLayout(opts: {
  width: number;
  height: number;
  showUser: boolean;
}): PitchPlotLayout {
  const gutter = opts.showUser ? 36 : 4;
  const plotWidth = Math.max(1, opts.width - gutter);
  const labels: PlotBand = { top: Math.max(0, opts.height - LABEL_H), height: LABEL_H };
  const plotBottom = Math.max(0, labels.top - LABEL_GAP);
  if (!opts.showUser) {
    return {
      gutter,
      plotWidth,
      ref: { top: 2, height: Math.max(1, plotBottom - 2) },
      user: null,
      labels,
    };
  }
  const inner = Math.max(2, plotBottom - 2 - BAND_GAP);
  const band = inner / 2;
  return {
    gutter,
    plotWidth,
    ref: { top: 2, height: band },
    user: { top: 2 + band + BAND_GAP, height: band },
    labels,
  };
}

/** Time at the center of an evenly spaced bin. The same milliseconds per pixel in every slot. */
export function binCenterX(index: number, count: number, x0: number, x1: number): number {
  const n = Math.max(1, count);
  return x0 + ((index + 0.5) / n) * (x1 - x0);
}
