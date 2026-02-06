import { cross3, norm3 } from "./vec3.js";

/** @typedef {{x:number,y:number,z:number}} Vec3 */
/** @typedef {{x:number,y:number}} Vec2 */

const POLE_EPS = 1e-9;
const MAX_PLANE_COORD = 1e6;

/**
 * Stereographic projection from the north pole onto z=0.
 *
 * @param {Vec3} p
 * @returns {Vec2 | null}
 */
export function sphereToStereographic(p) {
  const denom = 1 - p.z;
  if (denom <= POLE_EPS) return null;
  const x = p.x / denom;
  const y = p.y / denom;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > MAX_PLANE_COORD || Math.abs(y) > MAX_PLANE_COORD) return null;
  return { x, y };
}

/**
 * Inverse stereographic projection from z=0 plane to the unit sphere.
 *
 * @param {Vec2} w
 * @returns {Vec3}
 */
export function stereographicToSphere(w) {
  const r2 = w.x * w.x + w.y * w.y;
  const den = 1 + r2;
  return norm3({
    x: (2 * w.x) / den,
    y: (2 * w.y) / den,
    z: (r2 - 1) / den,
  });
}

/**
 * Sample points on the spherical curve defined by plane n·x = d and |x|=1.
 *
 * @param {{normal:Vec3, d:number}} plane
 * @param {number} steps
 * @returns {Vec3[]}
 */
export function sampleSpherePlanePoints(plane, steps = 360) {
  const n = norm3(plane.normal);
  const d = plane.d;
  const rr = 1 - d * d;
  if (rr <= 1e-10) return [];

  const ref = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const e1 = norm3(cross3(ref, n));
  const e2 = cross3(n, e1);
  const radius = Math.sqrt(rr);
  const center = { x: n.x * d, y: n.y * d, z: n.z * d };

  /** @type {Vec3[]} */
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    out.push({
      x: center.x + radius * (e1.x * ct + e2.x * st),
      y: center.y + radius * (e1.y * ct + e2.y * st),
      z: center.z + radius * (e1.z * ct + e2.z * st),
    });
  }
  return out;
}
