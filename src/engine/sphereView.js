import { clamp } from "./util/math.js";

/** @typedef {{kind:"sphere", yaw:number, pitch:number, zoom:number}} SphereView */
/** @typedef {{x:number,y:number,z:number}} Vec3 */
/** @typedef {{x:number,y:number}} Vec2 */

/**
 * Rotate a point by yaw (around y axis) then pitch (around x axis).
 * @param {SphereView} view
 * @param {Vec3} p
 * @returns {Vec3}
 */
export function rotateToView(view, p) {
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cx = Math.cos(view.pitch);
  const sx = Math.sin(view.pitch);

  // yaw around y: (x,z)
  const x1 = cy * p.x + sy * p.z;
  const z1 = -sy * p.x + cy * p.z;
  const y1 = p.y;

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
  const cy = Math.cos(-view.yaw);
  const sy = Math.sin(-view.yaw);
  const cx = Math.cos(-view.pitch);
  const sx = Math.sin(-view.pitch);

  // inverse pitch around x
  const y1 = cx * p.y - sx * p.z;
  const z1 = sx * p.y + cx * p.z;
  const x1 = p.x;

  // inverse yaw around y
  const x2 = cy * x1 + sy * z1;
  const z2 = -sy * x1 + cy * z1;

  return { x: x2, y: y1, z: z2 };
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

