import { GeometryType } from "./state.js";
import { circleThrough3, halfPlaneGeodesic, lineThrough, poincareGeodesic } from "./geom2d.js";
import { acosh, clamp, EPS, tanh } from "./util/math.js";
import { cross3, dot3, len3, norm3 } from "./vec3.js";

/** @typedef {{x:number,y:number}} Vec2 */
/** @typedef {{x:number,y:number,z:number}} Vec3 */
/** @typedef {{kind:"line", a:number,b:number,c:number} | {kind:"circle", cx:number,cy:number,r:number}} Curve2D */

/**
 * @param {GeometryType} geom
 * @returns {boolean}
 */
export function isSphere(geom) {
  return geom === GeometryType.SPHERICAL;
}

/** @param {{x:number,y:number}} p */
export function euclidDist(p, q) {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * Hyperbolic distance in the Poincaré disk model (curvature -1).
 * @param {Vec2} p
 * @param {Vec2} q
 */
export function poincareDistance(p, q) {
  const dp = 1 - (p.x * p.x + p.y * p.y);
  const dq = 1 - (q.x * q.x + q.y * q.y);
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const num = 2 * (dx * dx + dy * dy);
  const den = dp * dq;
  if (den <= 0) return Infinity;
  const cosh = 1 + num / den;
  return acosh(Math.max(1, cosh));
}

/**
 * Hyperbolic distance in the upper half-plane model (curvature -1).
 * @param {Vec2} p
 * @param {Vec2} q
 */
export function halfPlaneDistance(p, q) {
  if (p.y <= 0 || q.y <= 0) return Infinity;
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const cosh = 1 + (dx * dx + dy * dy) / (2 * p.y * q.y);
  return acosh(Math.max(1, cosh));
}

/**
 * Spherical distance (angle) on the unit sphere.
 * @param {Vec3} p
 * @param {Vec3} q
 */
export function sphericalDistance(p, q) {
  const d = dot3(p, q);
  return Math.acos(clamp(d, -1, 1));
}

/**
 * Constrain 2D points to the model domain.
 * @param {GeometryType} geom
 * @param {Vec2} p
 * @returns {Vec2 | null}
 */
export function constrain2DPoint(geom, p) {
  if (geom === GeometryType.HYPERBOLIC_POINCARE) {
    const r = Math.hypot(p.x, p.y);
    if (r >= 1) {
      const k = (1 - 1e-6) / (r || 1);
      return { x: p.x * k, y: p.y * k };
    }
  }
  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    if (p.y <= 0) return { x: p.x, y: 1e-6 };
  }
  return p;
}

/**
 * @param {GeometryType} geom
 * @param {{points: Array<{id:string,x:number,y:number,label:string,locked?:boolean,z?:number}>, starPointId?: string}} doc
 * @param {{p1:string,p2:string}} line
 * @returns {Curve2D | null}
 */
export function derive2DLineCurve(geom, doc, line) {
  const p1 = doc.points.find((p) => p.id === line.p1);
  const p2 = doc.points.find((p) => p.id === line.p2);
  if (!p1 || !p2) return null;
  const a = { x: p1.x, y: p1.y };
  const b = { x: p2.x, y: p2.y };

  if (geom === GeometryType.EUCLIDEAN) return lineThrough(a, b);

  if (geom === GeometryType.INVERSIVE_EUCLIDEAN) {
    const starId = doc.starPointId;
    if (!starId) return lineThrough(a, b);
    if (line.p1 === starId || line.p2 === starId) {
      const star = doc.points.find((p) => p.id === starId);
      if (!star) return null;
      const s = { x: star.x, y: star.y };
      const other = line.p1 === starId ? b : a;
      return lineThrough(s, other);
    }
    const star = doc.points.find((p) => p.id === starId);
    if (!star) return null;
    const s = { x: star.x, y: star.y };
    const circle = circleThrough3(a, b, s);
    return circle ?? lineThrough(a, b);
  }

  if (geom === GeometryType.HYPERBOLIC_POINCARE) {
    return poincareGeodesic(a, b);
  }

  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    return halfPlaneGeodesic(a, b);
  }

  return lineThrough(a, b);
}

/**
 * @param {GeometryType} geom
 * @param {{points: Array<{id:string,x:number,y:number,label:string,locked?:boolean,z?:number}>}} doc
 * @param {{center:string,radiusPoint:string}} circle
 * @returns {{kind:"circle", cx:number, cy:number, r:number} | null}
 */
export function derive2DCircleCurve(geom, doc, circle) {
  const c0 = doc.points.find((p) => p.id === circle.center);
  const r0 = doc.points.find((p) => p.id === circle.radiusPoint);
  if (!c0 || !r0) return null;
  const c = { x: c0.x, y: c0.y };
  const q = { x: r0.x, y: r0.y };

  if (geom === GeometryType.HYPERBOLIC_POINCARE) {
    const rho = poincareDistance(c, q);
    const s = tanh(rho / 2);
    const pNormSq = c.x * c.x + c.y * c.y;
    const denom = 1 - s * s * pNormSq;
    if (Math.abs(denom) < 1e-12) return null;
    const cx = ((1 - s * s) * c.x) / denom;
    const cy = ((1 - s * s) * c.y) / denom;
    const r = ((1 - pNormSq) * s) / denom;
    if (!Number.isFinite(r) || r <= 0) return null;
    return { kind: "circle", cx, cy, r: Math.abs(r) };
  }

  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    const rho = halfPlaneDistance(c, q);
    if (!Number.isFinite(rho)) return null;
    const v = c.y;
    const cx = c.x;
    const cy = v * Math.cosh(rho);
    const r = v * Math.sinh(rho);
    if (!Number.isFinite(r) || r <= 0) return null;
    return { kind: "circle", cx, cy, r };
  }

  const r = Math.hypot(c.x - q.x, c.y - q.y);
  if (!Number.isFinite(r) || r <= 0) return null;
  return { kind: "circle", cx: c.x, cy: c.y, r };
}

/**
 * Filter 2D intersection points to the visible model domain.
 * @param {GeometryType} geom
 * @param {Vec2} p
 */
export function is2DPointInDomain(geom, p) {
  if (geom === GeometryType.HYPERBOLIC_POINCARE) return p.x * p.x + p.y * p.y < 1 - 1e-9;
  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) return p.y > 1e-9;
  return true;
}

/**
 * Spherical curve representation as plane n·x = d.
 * Great circles have d = 0.
 *
 * @typedef {{normal: Vec3, d: number}} SpherePlane
 */

/**
 * @param {{points: Array<{id:string,x:number,y:number,z?:number,label:string,locked?:boolean}>}} doc
 * @param {{p1:string,p2:string}} line
 * @returns {SpherePlane | null}
 */
export function deriveSphereGreatCircle(doc, line) {
  const p1 = doc.points.find((p) => p.id === line.p1);
  const p2 = doc.points.find((p) => p.id === line.p2);
  if (!p1 || !p2 || p1.z == null || p2.z == null) return null;
  const a = { x: p1.x, y: p1.y, z: p1.z };
  const b = { x: p2.x, y: p2.y, z: p2.z };
  const n = cross3(a, b);
  if (len3(n) < EPS) return null;
  return { normal: norm3(n), d: 0 };
}

/**
 * @param {{points: Array<{id:string,x:number,y:number,z?:number,label:string,locked?:boolean}>}} doc
 * @param {{center:string,radiusPoint:string}} circle
 * @returns {SpherePlane | null}
 */
export function deriveSphereCircle(doc, circle) {
  const c0 = doc.points.find((p) => p.id === circle.center);
  const r0 = doc.points.find((p) => p.id === circle.radiusPoint);
  if (!c0 || !r0 || c0.z == null || r0.z == null) return null;
  const c = norm3({ x: c0.x, y: c0.y, z: c0.z });
  const q = norm3({ x: r0.x, y: r0.y, z: r0.z });
  const ang = sphericalDistance(c, q);
  const d = Math.cos(ang);
  return { normal: c, d };
}

/**
 * Intersect two planes with the unit sphere.
 * @param {SpherePlane} p1
 * @param {SpherePlane} p2
 * @returns {Vec3[]}
 */
export function intersectSpherePlanes(p1, p2) {
  const n1 = p1.normal;
  const n2 = p2.normal;
  const v = cross3(n1, n2);
  const vLenSq = dot3(v, v);
  if (vLenSq < 1e-14) return [];

  // Point on the intersection line of the two planes.
  // x0 = (d1*(n2×v) + d2*(v×n1)) / |v|^2
  const n2xv = cross3(n2, v);
  const vxN1 = cross3(v, n1);
  const x0 = {
    x: (p1.d * n2xv.x + p2.d * vxN1.x) / vLenSq,
    y: (p1.d * n2xv.y + p2.d * vxN1.y) / vLenSq,
    z: (p1.d * n2xv.z + p2.d * vxN1.z) / vLenSq,
  };

  const A = vLenSq;
  const B = 2 * dot3(x0, v);
  const C = dot3(x0, x0) - 1;
  const disc = B * B - 4 * A * C;
  if (disc < -1e-12) return [];
  if (Math.abs(disc) < 1e-12) {
    const t = -B / (2 * A);
    const p = { x: x0.x + t * v.x, y: x0.y + t * v.y, z: x0.z + t * v.z };
    return [norm3(p)];
  }
  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  const t1 = (-B + sqrtDisc) / (2 * A);
  const t2 = (-B - sqrtDisc) / (2 * A);
  const pA = { x: x0.x + t1 * v.x, y: x0.y + t1 * v.y, z: x0.z + t1 * v.z };
  const pB = { x: x0.x + t2 * v.x, y: x0.y + t2 * v.y, z: x0.z + t2 * v.z };
  return [norm3(pA), norm3(pB)];
}
