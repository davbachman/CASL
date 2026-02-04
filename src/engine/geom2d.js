import { EPS } from "./util/math.js";
import { cross2, dot2, len2, sub2 } from "./vec2.js";

/** @typedef {{x:number,y:number}} Vec2 */
/** @typedef {{kind:"line", a:number, b:number, c:number}} Line2D */
/** @typedef {{kind:"circle", cx:number, cy:number, r:number}} Circle2D */
/** @typedef {Line2D | Circle2D} Curve2D */

/** @param {Vec2} p @param {Vec2} q @returns {Line2D | null} */
export function lineThrough(p, q) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const n = Math.hypot(dx, dy);
  if (n < EPS) return null;
  // Normal vector (a,b) perpendicular to direction (dx,dy)
  const a = dy / n;
  const b = -dx / n;
  const c = -(a * p.x + b * p.y);
  return { kind: "line", a, b, c };
}

/**
 * Circle through 3 points; null if (nearly) collinear.
 * @param {Vec2} p1
 * @param {Vec2} p2
 * @param {Vec2} p3
 * @returns {Circle2D | null}
 */
export function circleThrough3(p1, p2, p3) {
  const a = p2.x - p1.x;
  const b = p2.y - p1.y;
  const c = p3.x - p1.x;
  const d = p3.y - p1.y;
  const e = a * (p1.x + p2.x) + b * (p1.y + p2.y);
  const f = c * (p1.x + p3.x) + d * (p1.y + p3.y);
  const g = 2 * (a * (p3.y - p2.y) - b * (p3.x - p2.x));
  if (Math.abs(g) < 1e-10) return null;
  const cx = (d * e - b * f) / g;
  const cy = (a * f - c * e) / g;
  const r = Math.hypot(p1.x - cx, p1.y - cy);
  if (!Number.isFinite(r)) return null;
  return { kind: "circle", cx, cy, r };
}

/** @param {Line2D} l1 @param {Line2D} l2 @returns {Vec2[]} */
export function intersectLineLine(l1, l2) {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-12) return [];
  const x = (l1.b * l2.c - l2.b * l1.c) / det;
  const y = (l2.a * l1.c - l1.a * l2.c) / det;
  return [{ x, y }];
}

/** @param {Line2D} line @param {Circle2D} circle @returns {Vec2[]} */
export function intersectLineCircle(line, circle) {
  // Project center onto line, then use perpendicular distance.
  const { a, b, c } = line;
  const { cx, cy, r } = circle;
  const distSigned = a * cx + b * cy + c;
  const dist = Math.abs(distSigned);
  const tol = 1e-12 * Math.max(1, r);
  if (dist > r + tol) return [];

  const x0 = cx - a * distSigned;
  const y0 = cy - b * distSigned;
  if (Math.abs(dist - r) < tol) return [{ x: x0, y: y0 }];

  // Stable-ish when r ≈ dist and values are large: r^2 - dist^2 = (r-dist)(r+dist).
  const hSq = (r - dist) * (r + dist);
  const h = Math.sqrt(Math.max(0, hSq));
  // Direction along the line (perpendicular to normal)
  const dx = -b;
  const dy = a;
  return [
    { x: x0 + dx * h, y: y0 + dy * h },
    { x: x0 - dx * h, y: y0 - dy * h },
  ];
}

/** @param {Circle2D} c1 @param {Circle2D} c2 @returns {Vec2[]} */
export function intersectCircleCircle(c1, c2) {
  const p0 = { x: c1.cx, y: c1.cy };
  const p1 = { x: c2.cx, y: c2.cy };
  const d = len2(sub2(p1, p0));
  if (d < 1e-12) return [];
  const r0 = c1.r;
  const r1 = c2.r;
  const tol = 1e-12 * Math.max(1, r0, r1, d);
  if (d > r0 + r1 + tol) return [];
  if (d < Math.abs(r0 - r1) - tol) return [];

  // More stable than r0^2 - r1^2 when radii are huge and close:
  const rDiff = r0 - r1;
  const rSum = r0 + r1;
  const a = (d * d + rDiff * rSum) / (2 * d);
  const hSq = (r0 - a) * (r0 + a);
  const h = Math.sqrt(Math.max(0, hSq));
  const vx = (p1.x - p0.x) / d;
  const vy = (p1.y - p0.y) / d;
  const xm = p0.x + a * vx;
  const ym = p0.y + a * vy;
  if (h <= tol) return [{ x: xm, y: ym }];
  return [
    { x: xm + -vy * h, y: ym + vx * h },
    { x: xm - -vy * h, y: ym - vx * h },
  ];
}

/**
 * Generic intersection.
 * @param {Curve2D} a
 * @param {Curve2D} b
 * @returns {Vec2[]}
 */
export function intersectCurves(a, b) {
  if (a.kind === "line" && b.kind === "line") return intersectLineLine(a, b);
  if (a.kind === "line" && b.kind === "circle") return intersectLineCircle(a, b);
  if (a.kind === "circle" && b.kind === "line") return intersectLineCircle(b, a);
  return intersectCircleCircle(/** @type {Circle2D} */ (a), /** @type {Circle2D} */ (b));
}

/**
 * Return the signed distance from point p to curve.
 * For lines: signed distance to line.
 * For circles: radial distance (positive outside).
 *
 * @param {Curve2D} curve
 * @param {Vec2} p
 */
export function signedDistanceToCurve(curve, p) {
  if (curve.kind === "line") return curve.a * p.x + curve.b * p.y + curve.c;
  return Math.hypot(p.x - curve.cx, p.y - curve.cy) - curve.r;
}

/**
 * Circle orthogonal to the unit circle through p and q (Poincaré geodesic).
 * If p,q collinear with origin, returns a line.
 *
 * @param {Vec2} p
 * @param {Vec2} q
 * @returns {Curve2D | null}
 */
export function poincareGeodesic(p, q) {
  const det = cross2(p, q);
  if (Math.abs(det) < 1e-12) {
    return lineThrough(p, q);
  }
  const b1 = (p.x * p.x + p.y * p.y + 1) / 2;
  const b2 = (q.x * q.x + q.y * q.y + 1) / 2;
  const cx = (b1 * q.y - b2 * p.y) / det;
  const cy = (p.x * b2 - q.x * b1) / det;
  const rSq = cx * cx + cy * cy - 1;
  if (rSq <= 0) return null;
  return { kind: "circle", cx, cy, r: Math.sqrt(rSq) };
}

/**
 * Half-plane geodesic through p and q: vertical line or circle with center on boundary y=0.
 * @param {Vec2} p
 * @param {Vec2} q
 * @returns {Curve2D | null}
 */
export function halfPlaneGeodesic(p, q) {
  const dx = q.x - p.x;
  if (Math.abs(dx) < 1e-10) {
    return { kind: "line", a: 1, b: 0, c: -p.x };
  }
  // (qx^2+qy^2) - (px^2+py^2) with less cancellation:
  const num = dx * (q.x + p.x) + (q.y - p.y) * (q.y + p.y);
  const a = num / (2 * dx);
  const r = Math.hypot(p.x - a, p.y);
  if (!Number.isFinite(r) || r < EPS) return null;
  return { kind: "circle", cx: a, cy: 0, r };
}
