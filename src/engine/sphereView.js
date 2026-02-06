import { clamp } from "./util/math.js";

/** @typedef {{kind:"sphere", yaw:number, pitch:number, zoom:number, roll?:number}} SphereView */
/** @typedef {{x:number,y:number,z:number}} Vec3 */
/** @typedef {{x:number,y:number}} Vec2 */

/**
 * Rotate a point by yaw (around y axis) then pitch (around x axis).
 * @param {SphereView} view
 * @param {Vec3} p
 * @returns {Vec3}
 */
export function rotateToView(view, p) {
  const roll = Number.isFinite(view.roll) ? view.roll : 0;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cx = Math.cos(view.pitch);
  const sx = Math.sin(view.pitch);

  // roll around z: (x,y)
  const x0 = cr * p.x - sr * p.y;
  const y0 = sr * p.x + cr * p.y;
  const z0 = p.z;

  // yaw around y: (x,z)
  const x1 = cy * x0 + sy * z0;
  const z1 = -sy * x0 + cy * z0;
  const y1 = y0;

  // pitch around x: (y,z)
  const y2 = cx * y1 - sx * z1;
  const z2 = sx * y1 + cx * z1;

  return { x: x1, y: y2, z: z2 };
}

/**
 * Inverse rotation from view back to object coordinates.
 * @param {SphereView} view
 * @param {Vec3} p
 * @returns {Vec3}
 */
export function rotateFromView(view, p) {
  const roll = Number.isFinite(view.roll) ? view.roll : 0;
  const cy = Math.cos(-view.yaw);
  const sy = Math.sin(-view.yaw);
  const cx = Math.cos(-view.pitch);
  const sx = Math.sin(-view.pitch);
  const cr = Math.cos(-roll);
  const sr = Math.sin(-roll);

  // inverse pitch around x
  const y1 = cx * p.y - sx * p.z;
  const z1 = sx * p.y + cx * p.z;
  const x1 = p.x;

  // inverse yaw around y
  const x2 = cy * x1 + sy * z1;
  const z2 = -sy * x1 + cy * z1;
  const y2 = y1;

  // inverse roll around z
  const x3 = cr * x2 - sr * y2;
  const y3 = sr * x2 + cr * y2;

  return { x: x3, y: y3, z: z2 };
}

/**
 * @param {SphereView} view
 * @param {number} dxPx
 * @param {number} dyPx
 */
export function rotateByDrag(view, dxPx, dyPx) {
  const speed = 0.0065;
  view.yaw += dxPx * speed;
  view.pitch += dyPx * speed;
  view.pitch = clamp(view.pitch, -Math.PI / 2 + 1e-3, Math.PI / 2 - 1e-3);
}

/**
 * Hyperboloid drag:
 * - vertical drag tilts (pitch)
 * - horizontal drag spins around the model axis (roll)
 *
 * @param {SphereView} view
 * @param {number} dxPx
 * @param {number} dyPx
 */
export function rotateHyperboloidByDrag(view, dxPx, dyPx) {
  const speed = 0.0065;
  const roll = Number.isFinite(view.roll) ? view.roll : 0;
  view.roll = wrapAngle(roll + dxPx * speed);
  view.pitch += dyPx * speed;
  view.pitch = clamp(view.pitch, -Math.PI / 2 + 1e-3, Math.PI / 2 - 1e-3);
}

/** @param {SphereView} view @param {number} wheelDeltaY */
export function zoomSphere(view, wheelDeltaY) {
  const factor = wheelDeltaY > 0 ? 0.92 : 1.08;
  view.zoom = clamp(view.zoom * factor, 0.35, 3);
}

/**
 * Orthographic projection to screen.
 * @param {Vec3} viewPoint
 * @param {{cx:number, cy:number, r:number}} vp
 */
export function projectSphere(viewPoint, vp) {
  return { x: vp.cx + viewPoint.x * vp.r, y: vp.cy - viewPoint.y * vp.r, z: viewPoint.z };
}

/**
 * Map a screen point to a point on the *front* unit sphere in object coordinates.
 * Returns null if outside the sphere disc.
 *
 * @param {SphereView} view
 * @param {Vec2} screen
 * @param {{cx:number, cy:number, r:number}} vp
 * @returns {Vec3 | null}
 */
export function screenToSpherePoint(view, screen, vp) {
  const u = (screen.x - vp.cx) / vp.r;
  const v = -(screen.y - vp.cy) / vp.r;
  const rr = u * u + v * v;
  if (rr > 1) return null;
  const z = Math.sqrt(Math.max(0, 1 - rr));
  const inView = { x: u, y: v, z };
  return rotateFromView(view, inView);
}

/** @param {number} angle */
function wrapAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  let x = (angle + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}
