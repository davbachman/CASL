export const EPS = 1e-9;

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** @param {number} x */
export function acosh(x) {
  // Stable-ish for x >= 1.
  return Math.log(x + Math.sqrt(x * x - 1));
}

/** @param {number} x */
export function atanh(x) {
  return 0.5 * Math.log((1 + x) / (1 - x));
}

/** @param {number} x */
export function tanh(x) {
  const e2x = Math.exp(2 * x);
  return (e2x - 1) / (e2x + 1);
}

