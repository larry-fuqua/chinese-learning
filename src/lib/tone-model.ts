import model from "./tone-model.json";

/** Accept a contour when P(expected tone) is at least this. Neutral tone is not scored. */
export const TONE_ACCEPT_AT = model.acceptAt;

const CLASSES = model.classes;
const COEF = model.coef;
const INTERCEPT = model.intercept;

function mean(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Highest-degree coefficient first, matching numpy.polyfit. */
function polyfit(xs: number[], ys: number[], degree: number): number[] {
  const n = degree + 1;
  const xtx = Array.from({ length: n }, () => Array(n).fill(0));
  const xty = Array(n).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const powers: number[] = [];
    let xp = 1;
    for (let k = 0; k <= degree; k++) {
      powers.push(xp);
      xp *= xs[i];
    }
    for (let row = 0; row < n; row++) {
      const pr = powers[degree - row];
      xty[row] += pr * ys[i];
      for (let col = 0; col < n; col++) xtx[row][col] += pr * powers[degree - col];
    }
  }
  const matrix = xtx.map((row, index) => [...row, xty[index]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    const swap = matrix[col];
    matrix[col] = matrix[pivot];
    matrix[pivot] = swap;
    const div = matrix[col][col] || 1e-12;
    for (let row = col + 1; row < n; row++) {
      const factor = matrix[row][col] / div;
      for (let k = col; k <= n; k++) matrix[row][k] -= factor * matrix[col][k];
    }
  }
  const beta = Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let value = matrix[row][n];
    for (let col = row + 1; col < n; col++) value -= matrix[row][col] * beta[col];
    beta[row] = value / (matrix[row][row] || 1e-12);
  }
  return beta;
}

/**
 * Ten features from the contour that is drawn. `prevScaledMean` is the previous
 * character's mean after the same range scale, or 0 for the first character.
 */
export function contourFeatures(
  contour: (number | null)[],
  rangeSt: number,
  durationSec: number,
  prevScaledMean: number,
): { x: number[] | null; nextPrev: number } {
  const raw = contour.filter((value): value is number => value != null);
  const k = Math.max(0.8, Math.min(1.6, rangeSt / 8));
  const nextPrev = raw.length ? mean(raw) / k : prevScaledMean;
  if (raw.length < 4) return { x: null, nextPrev };
  const scaled = raw.map((value) => value / k);
  const segments: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Math.floor((scaled.length * i) / 5);
    const end = Math.max(Math.floor((scaled.length * (i + 1)) / 5), start + 1);
    segments.push(mean(scaled.slice(start, end)));
  }
  const axis = scaled.map((_, index) => index / scaled.length);
  const slope = polyfit(axis, scaled, 1)[0];
  const curve = polyfit(axis, scaled, 2)[0];
  const height = mean(scaled);
  return {
    x: [
      ...segments,
      height,
      slope,
      curve,
      height - prevScaledMean,
      Math.min(durationSec, 0.5),
    ],
    nextPrev,
  };
}

export function toneProbabilities(features: number[]): { classes: number[]; proba: number[] } {
  const scores = INTERCEPT.map((bias, index) => {
    const row = COEF[index] ?? [];
    let score = bias;
    for (let i = 0; i < features.length; i++) score += (row[i] ?? 0) * features[i];
    return score;
  });
  const max = Math.max(...scores);
  const exp = scores.map((score) => Math.exp(score - max));
  const total = exp.reduce((sum, value) => sum + value, 0) || 1;
  return { classes: [...CLASSES], proba: exp.map((value) => value / total) };
}

export function gradeContour(
  contour: (number | null)[],
  rangeSt: number,
  durationSec: number,
  prevScaledMean: number,
  expectedTone: number,
): { tone: number | null; pExpected: number | null; nextPrev: number } {
  const features = contourFeatures(contour, rangeSt, durationSec, prevScaledMean);
  if (!features.x) return { tone: null, pExpected: null, nextPrev: features.nextPrev };
  const { classes, proba } = toneProbabilities(features.x);
  let best = 0;
  for (let i = 1; i < proba.length; i++) {
    if (proba[i] > proba[best]) best = i;
  }
  const expectedIndex = classes.indexOf(expectedTone);
  return {
    tone: classes[best] ?? null,
    pExpected: expectedIndex >= 0 ? proba[expectedIndex] : null,
    nextPrev: features.nextPrev,
  };
}
