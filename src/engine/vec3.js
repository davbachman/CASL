/** @typedef {{x:number,y:number,z:number}} Vec3 */

/** @param {number} x @param {number} y @param {number} z @returns {Vec3} */
export function v3(x, y, z) {
  return { x, y, z };
}

/** @param {Vec3} a @param {Vec3} b */
export function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** @param {Vec3} a @param {Vec3} b */
export function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** @param {Vec3} a @param {number} s */
export function scale3(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/** @param {Vec3} a @param {Vec3} b */
export function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** @param {Vec3} a @param {Vec3} b */
export function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** @param {Vec3} a */
export function len3(a) {
  return Math.hypot(a.x, a.y, a.z);
}

/** @param {Vec3} a */
export function norm3(a) {
  const l = len3(a);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

