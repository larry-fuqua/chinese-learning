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
  refLabels: PlotBand;
  user: PlotBand | null;
  userLabels: PlotBand | null;
};

const LABEL_H = 22;
const LABEL_GAP = 6;
const BAND_GAP = 10;

/** Each lane's character labels sit under that lane. Traces never enter a label band. */
export function pitchPlotLayout(opts: {
  width: number;
  height: number;
  showUser: boolean;
}): PitchPlotLayout {
  const gutter = opts.showUser ? 36 : 4;
  const plotWidth = Math.max(1, opts.width - gutter);
  if (!opts.showUser) {
    const refLabels: PlotBand = { top: Math.max(0, opts.height - LABEL_H), height: LABEL_H };
    const plotBottom = Math.max(0, refLabels.top - LABEL_GAP);
    return {
      gutter,
      plotWidth,
      ref: { top: 2, height: Math.max(1, plotBottom - 2) },
      refLabels,
      user: null,
      userLabels: null,
    };
  }
  const chrome = 2 + LABEL_GAP + LABEL_H + BAND_GAP + LABEL_GAP + LABEL_H + 2;
  const band = Math.max(1, (opts.height - chrome) / 2);
  const ref: PlotBand = { top: 2, height: band };
  const refLabels: PlotBand = { top: ref.top + ref.height + LABEL_GAP, height: LABEL_H };
  const user: PlotBand = { top: refLabels.top + refLabels.height + BAND_GAP, height: band };
  const userLabels: PlotBand = { top: user.top + user.height + LABEL_GAP, height: LABEL_H };
  return { gutter, plotWidth, ref, refLabels, user, userLabels };
}

export type LaneTime = { origin: number; span: number };

/**
 * Fit one voice to the plot. The span runs from that voice's first slice
 * to its last, so the sentence fills the lane and each slice keeps its
 * share of that voice's own duration. The other voice's clock is ignored.
 */
export function laneTime(opts: {
  starts: readonly number[];
  ends: readonly number[];
}): LaneTime {
  let origin = Infinity;
  let end = -Infinity;
  const count = Math.min(opts.starts.length, opts.ends.length);
  for (let i = 0; i < count; i++) {
    const start = opts.starts[i]!;
    const stop = opts.ends[i]!;
    if (!Number.isFinite(start) || !Number.isFinite(stop) || !(stop > start)) continue;
    if (start < origin) origin = start;
    if (stop > end) end = stop;
  }
  if (!(end > origin)) return { origin: 0, span: 0.2 };
  return { origin, span: end - origin };
}

export function laneX(time: number, lane: LaneTime, plotLeft: number, plotWidth: number): number {
  return plotLeft + ((time - lane.origin) / (lane.span || 1)) * plotWidth;
}

/** Preferred empty pixels between character labels. */
export const LABEL_MIN_GAP = 12;

/**
 * Keep labels readable when two slices sit close together.
 * Centers start on the slice midpoint. A label steps aside only far enough
 * to leave a gap, and it stays inside the plot. Slice widths are untouched.
 */
export function separateLabelCenters(opts: {
  ideal: readonly number[];
  widths: readonly number[];
  left: number;
  right: number;
  minGap: number;
}): number[] {
  const n = opts.ideal.length;
  if (n === 0) return [];
  const widths = Array.from({ length: n }, (_, i) => Math.max(1, opts.widths[i] ?? 1));
  const available = Math.max(1, opts.right - opts.left);
  const content = widths.reduce((sum, width) => sum + width, 0);
  const gaps = Math.max(0, n - 1);
  let gap = Math.max(0, opts.minGap);
  if (gaps > 0 && content + gap * gaps > available) {
    gap = Math.max(0, (available - content) / gaps);
  }
  const placed = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const half = widths[i]! / 2;
    const lo = opts.left + half;
    const hi = opts.right - half;
    const ideal = opts.ideal[i]!;
    placed[i] = hi >= lo ? Math.min(hi, Math.max(lo, ideal)) : (opts.left + opts.right) / 2;
  }
  const minCenter = (i: number) => placed[i - 1]! + widths[i - 1]! / 2 + gap + widths[i]! / 2;
  const maxCenter = (i: number) => placed[i + 1]! - widths[i + 1]! / 2 - gap - widths[i]! / 2;
  for (let i = 1; i < n; i++) {
    const next = minCenter(i);
    if (placed[i]! < next) placed[i] = next;
  }
  const lastHi = opts.right - widths[n - 1]! / 2;
  if (placed[n - 1]! > lastHi) {
    placed[n - 1] = lastHi;
    for (let i = n - 2; i >= 0; i--) {
      const prev = maxCenter(i);
      if (placed[i]! > prev) placed[i] = prev;
    }
  }
  const firstLo = opts.left + widths[0]! / 2;
  if (placed[0]! < firstLo) {
    placed[0] = firstLo;
    for (let i = 1; i < n; i++) {
      const next = minCenter(i);
      if (placed[i]! < next) placed[i] = next;
    }
  }
  return placed;
}

/** Time at the center of an evenly spaced bin. The same milliseconds per pixel in every slot. */
export function binCenterX(index: number, count: number, x0: number, x1: number): number {
  const n = Math.max(1, count);
  return x0 + ((index + 0.5) / n) * (x1 - x0);
}
