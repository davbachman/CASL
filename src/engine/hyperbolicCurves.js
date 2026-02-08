import { intersectCurves } from "./geom2d.js";
import { isInsidePoincareDisk } from "./hyperbolicModels.js?v=20260208-88";

/** @typedef {{x:number,y:number}} Vec2 */
/** @typedef {{kind:"line", a:number,b:number,c:number} | {kind:"circle", cx:number,cy:number,r:number}} Curve2D */

/**
 * Sample a Poincare geodesic (line or circle-arc orthogonal to boundary).
 *
 * @param {Curve2D} curve
 * @param {number} [stepsHint]
 * @returns {Vec2[]}
 */
export function samplePoincareGeodesicPoints(curve, stepsHint = 140) {
  if (curve.kind === "line") {
    const seg = clipLineToUnitDisk(curve);
    if (!seg) return [];
    const steps = Math.max(24, stepsHint);
    /** @type {Vec2[]} */
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push({
        x: seg.a.x + (seg.b.x - seg.a.x) * t,
        y: seg.a.y + (seg.b.y - seg.a.y) * t,
      });
    }
    return out;
  }

  const boundary = { kind: "circle", cx: 0, cy: 0, r: 1 };
  const hits = intersectCurves(curve, boundary);
  if (hits.length < 2) return [];
  const pA = hits[0];
  const pB = hits[1];
  const a1 = Math.atan2(pA.y - curve.cy, pA.x - curve.cx);
  const a2 = Math.atan2(pB.y - curve.cy, pB.x - curve.cx);
  const delta = ccwDelta(a1, a2);
  const mid = a1 + delta / 2;
  const midPoint = { x: curve.cx + curve.r * Math.cos(mid), y: curve.cy + curve.r * Math.sin(mid) };
  const useA1ToA2 = isInsidePoincareDisk(midPoint);
  const start = useA1ToA2 ? a1 : a2;
  const end = useA1ToA2 ? a2 : a1;
  const span = ccwDelta(start, end);
  const steps = Math.max(36, Math.ceil(span * 70), stepsHint);
  /** @type {Vec2[]} */
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + (span * i) / steps;
    const p = { x: curve.cx + curve.r * Math.cos(t), y: curve.cy + curve.r * Math.sin(t) };
    if (!isInsidePoincareDisk(p)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Sample a Euclidean circle in the Poincare disk (used for hyperbolic circles in this chart).
 *
 * @param {{kind:"circle", cx:number,cy:number,r:number}} circle
 * @param {number} [steps]
 * @returns {Vec2[]}
 */
export function samplePoincareCirclePoints(circle, steps = 220) {
  /** @type {Vec2[]} */
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const p = { x: circle.cx + circle.r * Math.cos(t), y: circle.cy + circle.r * Math.sin(t) };
    if (!isInsidePoincareDisk(p)) continue;
    out.push(p);
  }
  return out;
}

/**
 * @param {{kind:"line", a:number,b:number,c:number}} line
 * @returns {{a:Vec2,b:Vec2} | null}
 */
function clipLineToUnitDisk(line) {
  const boundary = { kind: "circle", cx: 0, cy: 0, r: 1 };
  const hits = intersectCurves(line, boundary);
  if (hits.length < 2) return null;
  return { a: hits[0], b: hits[1] };
}

/** @param {number} from @param {number} to */
function ccwDelta(from, to) {
  let d = to - from;
  while (d < 0) d += Math.PI * 2;
  while (d >= Math.PI * 2) d -= Math.PI * 2;
  return d;
}
