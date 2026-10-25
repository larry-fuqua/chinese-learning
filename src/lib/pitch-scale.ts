export type PitchAxis = { min: number; max: number };

/** Used when a sentence has too little voiced pitch to set an axis. */
export const PITCH_AXIS_FALLBACK: PitchAxis = { min: -4.5, max: 4.5 };

/**
 * One semitone axis for every character. Built from the contours that are
 * drawn, widened to at least four semitones so a small rise stays small.
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
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * (values.length - 1)))];
  let min = at(0.05);
  let max = at(0.95);
  if (!(max > min)) return { ...PITCH_AXIS_FALLBACK };
  if (max - min < 4) {
    const mid = (min + max) / 2;
    min = mid - 2;
    max = mid + 2;
  }
  return { min, max };
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

/** Time at the center of an evenly spaced bin. The same milliseconds per pixel in every slot. */
export function binCenterX(index: number, count: number, x0: number, x1: number): number {
  const n = Math.max(1, count);
  return x0 + ((index + 0.5) / n) * (x1 - x0);
}
