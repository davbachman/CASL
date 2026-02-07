import { GeometryType } from "./state.js";

/** @typedef {{x:number,y:number}} Vec2 */
/** @typedef {{x:number,y:number,z:number}} Vec3 */

const DISK_EPS = 1e-9;

/** @param {Vec2} p */
export function isInsidePoincareDisk(p) {
  return p.x * p.x + p.y * p.y < 1 - DISK_EPS;
}

/** @param {Vec2} p */
export function clampToPoincareDisk(p) {
  const r = Math.hypot(p.x, p.y);
  if (r < 1 - DISK_EPS) return { x: p.x, y: p.y };
  const k = (1 - DISK_EPS) / (r || 1);
  return { x: p.x * k, y: p.y * k };
}

/**
 * Disk automorphism (Möbius map) that sends 0 to `t`.
 * Complex form: f_t(z) = (z + t) / (1 + conj(t) z).
 *
 * @param {Vec2} z
 * @param {Vec2} t
 * @returns {Vec2}
 */
export function poincareTranslate(z, t) {
  const tx = Number.isFinite(t?.x) ? t.x : 0;
  const ty = Number.isFinite(t?.y) ? t.y : 0;
  if (Math.abs(tx) < 1e-14 && Math.abs(ty) < 1e-14) return { x: z.x, y: z.y };

  const a = z.x + tx;
  const b = z.y + ty;
  const u = 1 + tx * z.x + ty * z.y;
  const v = tx * z.y - ty * z.x;
  const den = u * u + v * v;
  if (!(den > 1e-14)) return clampToPoincareDisk({ x: z.x, y: z.y });

  const x = (a * u + b * v) / den;
  const y = (b * u - a * v) / den;
  return clampToPoincareDisk({ x, y });
}

/**
 * Inverse disk automorphism for `poincareTranslate`.
 *
 * @param {Vec2} z
 * @param {Vec2} t
 * @returns {Vec2}
 */
export function poincareTranslateInverse(z, t) {
  return poincareTranslate(z, { x: -(t?.x ?? 0), y: -(t?.y ?? 0) });
}

/**
 * Cayley transform from Poincare disk to upper half-plane.
 * @param {Vec2} p
 */
export function poincareToHalfPlane(p) {
  const den = p.x * p.x + (1 - p.y) * (1 - p.y);
  if (den <= 1e-12) return { x: 0, y: 1e6 };
  const x = (2 * p.x) / den;
  let y = (1 - p.x * p.x - p.y * p.y) / den;
  if (!(y > 0)) y = 1e-9;
  return { x, y };
}

/**
 * Inverse Cayley transform from upper half-plane to Poincare disk.
 * @param {Vec2} p
 */
export function halfPlaneToPoincare(p) {
  const y = p.y > 1e-9 ? p.y : 1e-9;
  const den = p.x * p.x + (1 + y) * (1 + y);
  if (den <= 1e-12) return { x: 0, y: 0 };
  let xOut = (2 * p.x) / den;
  let yOut = (p.x * p.x + y * y - 1) / den;
  const r2 = xOut * xOut + yOut * yOut;
  if (r2 >= 1) {
    const r = Math.sqrt(r2) || 1;
    const k = (1 - DISK_EPS) / r;
    xOut *= k;
    yOut *= k;
  }
  return { x: xOut, y: yOut };
}

/**
 * Beltrami-Klein from Poincare disk.
 * @param {Vec2} p
 */
export function poincareToKlein(p) {
  const r2 = p.x * p.x + p.y * p.y;
  const den = 1 + r2;
  if (den <= 1e-12) return { x: 0, y: 0 };
  return { x: (2 * p.x) / den, y: (2 * p.y) / den };
}

/**
 * Poincare disk from Beltrami-Klein.
 * @param {Vec2} k
 */
export function kleinToPoincare(k) {
  const r2 = k.x * k.x + k.y * k.y;
  if (r2 >= 1) return null;
  const den = 1 + Math.sqrt(Math.max(0, 1 - r2));
  if (den <= 1e-12) return null;
  return { x: k.x / den, y: k.y / den };
}

/**
 * Hyperboloid coordinates from Poincare disk coordinates.
 * Upper sheet z^2 - x^2 - y^2 = 1, z > 0.
 *
 * @param {Vec2} p
 * @returns {Vec3}
 */
export function poincareToHyperboloid(p) {
  const r2 = p.x * p.x + p.y * p.y;
  const den = 1 - r2;
  if (den <= 1e-12) {
    const k = 1e6;
    return { x: p.x * k, y: p.y * k, z: k };
  }
  return {
    x: (2 * p.x) / den,
    y: (2 * p.y) / den,
    z: (1 + r2) / den,
  };
}

/**
 * Poincare disk from hyperboloid coordinates.
 * @param {Vec3} h
 */
export function hyperboloidToPoincare(h) {
  const den = h.z + 1;
  if (den <= 1e-12) return null;
  return clampToPoincareDisk({ x: h.x / den, y: h.y / den });
}

/** @param {GeometryType} geom */
export function isHyperbolicGeometry(geom) {
  return (
    geom === GeometryType.HYPERBOLIC_POINCARE ||
    geom === GeometryType.HYPERBOLIC_HALF_PLANE ||
    geom === GeometryType.HYPERBOLIC_KLEIN ||
    geom === GeometryType.HYPERBOLIC_HYPERBOLOID
  );
}

/** @param {GeometryType} geom */
export function usesPoincareInternalChart(geom) {
  return (
    geom === GeometryType.HYPERBOLIC_POINCARE ||
    geom === GeometryType.HYPERBOLIC_KLEIN ||
    geom === GeometryType.HYPERBOLIC_HYPERBOLOID
  );
}

/**
 * Convert a hyperbolic model point to internal Poincare chart coordinates.
 *
 * @param {GeometryType} geom
 * @param {Vec2} p
 */
export function hyperbolicToPoincarePoint(geom, p) {
  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) return halfPlaneToPoincare(p);
  return clampToPoincareDisk(p);
}

/**
 * Convert internal Poincare chart point to a hyperbolic model point.
 *
 * @param {GeometryType} geom
 * @param {Vec2} p
 */
export function poincareToHyperbolicPoint(geom, p) {
  const inDisk = clampToPoincareDisk(p);
  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) return poincareToHalfPlane(inDisk);
  return inDisk;
}

/**
 * Convert internal hyperbolic point to display plane coordinates for 2D rendering.
 *
 * @param {GeometryType} geom
 * @param {Vec2} p
 */
export function hyperbolicInternalToDisplay2D(geom, p) {
  if (geom === GeometryType.HYPERBOLIC_KLEIN) return poincareToKlein(p);
  return p;
}

/**
 * Convert display-plane coordinate to internal hyperbolic point for 2D input.
 *
 * @param {GeometryType} geom
 * @param {Vec2} p
 */
export function hyperbolicDisplay2DToInternal(geom, p) {
  if (geom === GeometryType.HYPERBOLIC_KLEIN) {
    const mapped = kleinToPoincare(p);
    return mapped ? clampToPoincareDisk(mapped) : null;
  }
  return p;
}
