import {
  clampToPoincareDisk,
  hyperboloidToPoincare,
  poincareToHyperboloid,
  poincareTranslate,
  poincareTranslateInverse,
} from "./hyperbolicModels.js?v=20260208-88";
import { rotateFromView, rotateToView } from "./sphereView.js";

/** @typedef {{x:number,y:number}} Vec2 */
/** @typedef {{x:number,y:number,z:number}} Vec3 */
/** @typedef {{kind:"sphere", yaw:number, pitch:number, zoom:number, roll?:number, chartOffsetX?:number, chartOffsetY?:number}} OrbitalView */
/** @typedef {{cx:number, cy:number, scale:number, cameraZ:number}} HyperboloidViewport */

const CAMERA_Z = 30;
const FIT_RADIUS = 0.92;
const FIT_MARGIN_PX = 18;

/**
 * @param {OrbitalView} view
 * @param {number} cssW
 * @param {number} cssH
 * @returns {HyperboloidViewport}
 */
export function hyperboloidViewport(view, cssW, cssH) {
  const cx = cssW / 2;
  const cy = cssH * 0.47;
  const base = Math.min(cssW, cssH) * 0.44;
  const minScale = Math.max(52, Math.min(cssW, cssH) * 0.16);
  const bounds = computeProjectionBounds(view, FIT_RADIUS, CAMERA_Z, 196);
  if (!bounds) {
    return { cx, cy, scale: Math.max(minScale, base) * view.zoom, cameraZ: CAMERA_Z };
  }
  const limLeft = bounds.minU < 0 ? (cx - FIT_MARGIN_PX) / (-bounds.minU) : Infinity;
  const limRight = bounds.maxU > 0 ? (cssW - cx - FIT_MARGIN_PX) / bounds.maxU : Infinity;
  const limTop = bounds.minV < 0 ? (cy - FIT_MARGIN_PX) / (-bounds.minV) : Infinity;
  const limBottom = bounds.maxV > 0 ? (cssH - cy - FIT_MARGIN_PX) / bounds.maxV : Infinity;
  const fitScale = Math.min(limLeft, limRight, limTop, limBottom);
  const safeBase = Number.isFinite(fitScale) ? fitScale * 0.96 : base;
  const scale = Math.max(minScale, Math.min(base, safeBase)) * view.zoom;
  return { cx, cy, scale, cameraZ: CAMERA_Z };
}

/**
 * Project a Poincare-disk point onto the rendered hyperboloid view.
 *
 * @param {OrbitalView} view
 * @param {HyperboloidViewport} vp
 * @param {Vec2} p
 * @returns {{x:number,y:number,depth:number} | null}
 */
export function projectPoincareOnHyperboloid(view, vp, p) {
  const t = {
    x: Number.isFinite(view.chartOffsetX) ? view.chartOffsetX : 0,
    y: Number.isFinite(view.chartOffsetY) ? view.chartOffsetY : 0,
  };
  const shifted = clampToPoincareDisk(poincareTranslate(p, t));
  const h = poincareToHyperboloid(shifted);
  const v = rotateToView(view, h);
  const den = vp.cameraZ - v.z;
  if (den <= 1e-5) return null;
  const k = vp.scale / den;
  return { x: vp.cx + v.x * k, y: vp.cy - v.y * k, depth: v.z };
}

/**
 * Inverse map from screen position to Poincare disk coordinates via
 * perspective-ray intersection with the rotated hyperboloid.
 *
 * @param {OrbitalView} view
 * @param {Vec2} screen
 * @param {HyperboloidViewport} vp
 * @returns {Vec2 | null}
 */
export function screenToHyperboloidPoincare(view, screen, vp) {
  const u = (screen.x - vp.cx) / vp.scale;
  const v = -(screen.y - vp.cy) / vp.scale;

  const a = rotateFromView(view, { x: u, y: v, z: -1 });
  const b = rotateFromView(view, { x: 0, y: 0, z: vp.cameraZ });

  const qa = minkowskiNorm(a);
  const qb = 2 * minkowskiDot(a, b);
  const qc = minkowskiNorm(b) - 1;

  /** @type {number[]} */
  const roots = [];
  if (Math.abs(qa) < 1e-12) {
    if (Math.abs(qb) < 1e-12) return null;
    roots.push(-qc / qb);
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return null;
    const sd = Math.sqrt(Math.max(0, disc));
    roots.push((-qb - sd) / (2 * qa), (-qb + sd) / (2 * qa));
  }

  let best = null;
  let bestT = Infinity;
  for (const t of roots) {
    if (!Number.isFinite(t) || t <= 1e-8) continue;
    const inView = { x: u * t, y: v * t, z: vp.cameraZ - t };
    const world = rotateFromView(view, inView);
    if (!(world.z > 0)) continue;
    const p = hyperboloidToPoincare(world);
    if (!p) continue;
    if (t < bestT) {
      bestT = t;
      best = p;
    }
  }
  if (!best) return null;
  const t = {
    x: Number.isFinite(view.chartOffsetX) ? view.chartOffsetX : 0,
    y: Number.isFinite(view.chartOffsetY) ? view.chartOffsetY : 0,
  };
  return clampToPoincareDisk(poincareTranslateInverse(best, t));
}

/** @param {Vec3} a @param {Vec3} b */
function minkowskiDot(a, b) {
  return a.z * b.z - a.x * b.x - a.y * b.y;
}

/** @param {Vec3} v */
function minkowskiNorm(v) {
  return minkowskiDot(v, v);
}

/**
 * Fit scale so a projected ring near the chart boundary remains inside viewport.
 *
 * @param {OrbitalView} view
 * @param {number} cssW
 * @param {number} cssH
 * @param {number} radius
 * @param {number} cameraZ
 */
function computeProjectionBounds(view, radius, cameraZ, steps) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let hasAny = false;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const p = { x: radius * Math.cos(t), y: radius * Math.sin(t) };
    const h = poincareToHyperboloid(p);
    const v = rotateToView(view, h);
    const den = cameraZ - v.z;
    if (den <= 1e-5) continue;
    const u = v.x / den;
    const yProj = -v.y / den;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (yProj < minV) minV = yProj;
    if (yProj > maxV) maxV = yProj;
    hasAny = true;
  }
  if (!hasAny) return null;
  return { minU, maxU, minV, maxV };
}
