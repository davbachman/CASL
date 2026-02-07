/** @typedef {{x:number,y:number}} Vec2 */
/** @typedef {{kind:"line",a:number,b:number,c:number}} Line2D */

const CAMERA_Y = -10;
const CAMERA_Z = 10;
const EPS = 1e-9;

/**
 * Project XY-plane geometry (z=0) from camera C=(0,-10,10) onto the XZ-plane
 * (y=0). Returned 2D coords are (X, Z-10), so the horizon is y=0.
 *
 * @param {Vec2} p
 * @returns {Vec2 | null}
 */
export function perspectiveWorldToDisplay(p) {
  const den = p.y - CAMERA_Y;
  if (!(den > EPS)) return null;
  const x = (CAMERA_Z * p.x) / den;
  const z = (CAMERA_Z * p.y) / den;
  const y = z - CAMERA_Z;
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
  const den = d.y;
  const x = (-CAMERA_Z * d.x) / den;
  const y = (CAMERA_Z * CAMERA_Y) / den + CAMERA_Y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * @returns {number}
 */
export function perspectiveSkew() {
  return CAMERA_Z / (CAMERA_Z - CAMERA_Y);
}

/**
 * Exact image line in display coordinates for a world-space line under the
 * perspective homography used above.
 *
 * @param {Line2D} line
 * @returns {Line2D | null}
 */
export function perspectiveDisplayLineFromWorldLine(line) {
  const a = -CAMERA_Z * line.a;
  const b = line.c - CAMERA_Z * line.b;
  const c = CAMERA_Y * CAMERA_Z * line.b;
  const n = Math.hypot(a, b);
  if (!(n > EPS)) return null;
  return { kind: "line", a: a / n, b: b / n, c: c / n };
}
