/** @typedef {{x:number,y:number}} Vec2 */
/** @typedef {{kind:"line",a:number,b:number,c:number}} Line2D */

const PERSPECTIVE_SKEW = 0.5;
const PERSPECTIVE_DEPTH = 20;
const EPS = 1e-9;

/**
 * Projective map from perspective-world coordinates to display-plane coordinates.
 * Model domain is y < 0 (construction region below the horizon).
 * The perspective pole lies above the horizon, so finite circles in the
 * construction region render as ellipses in typical usage.
 *
 * @param {Vec2} p
 * @returns {Vec2 | null}
 */
export function perspectiveWorldToDisplay(p) {
  const den = 1 - PERSPECTIVE_SKEW * p.y;
  if (!(den > EPS)) return null;
  const x = p.x / den;
  const y = -PERSPECTIVE_DEPTH / den;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * Inverse map from display-plane coordinates to perspective-world coordinates.
 *
 * @param {Vec2} d
 * @returns {Vec2 | null}
 */
export function perspectiveDisplayToWorld(d) {
  if (!(d.y < -EPS)) return null;
  const clippedY = Math.max(-PERSPECTIVE_DEPTH + EPS, d.y);
  const den = -PERSPECTIVE_DEPTH / clippedY;
  if (!(den > EPS)) return null;
  const x = d.x * den;
  const y = (1 - den) / PERSPECTIVE_SKEW;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * @returns {number}
 */
export function perspectiveSkew() {
  return PERSPECTIVE_SKEW;
}

/**
 * Exact image line in display coordinates for a world-space line under the
 * perspective homography used above.
 *
 * @param {Line2D} line
 * @returns {Line2D | null}
 */
export function perspectiveDisplayLineFromWorldLine(line) {
  const a = -line.a * PERSPECTIVE_DEPTH * PERSPECTIVE_SKEW;
  const b = line.b + line.c * PERSPECTIVE_SKEW;
  const c = line.b * PERSPECTIVE_DEPTH;
  const n = Math.hypot(a, b);
  if (!(n > EPS)) return null;
  return { kind: "line", a: a / n, b: b / n, c: c / n };
}
