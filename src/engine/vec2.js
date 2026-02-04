/** @typedef {{x:number,y:number}} Vec2 */

/** @param {number} x @param {number} y @returns {Vec2} */
export function v2(x, y) {
  return { x, y };
}

/** @param {Vec2} a @param {Vec2} b */
export function add2(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** @param {Vec2} a @param {Vec2} b */
export function sub2(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** @param {Vec2} a @param {number} s */
export function scale2(a, s) {
  return { x: a.x * s, y: a.y * s };
}

/** @param {Vec2} a @param {Vec2} b */
export function dot2(a, b) {
  return a.x * b.x + a.y * b.y;
}

/** @param {Vec2} a @param {Vec2} b */
export function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

/** @param {Vec2} a */
export function len2(a) {
  return Math.hypot(a.x, a.y);
}

/** @param {Vec2} a */
export function len2Sq(a) {
  return a.x * a.x + a.y * a.y;
}

/** @param {Vec2} a */
export function norm2(a) {
  const l = len2(a);
  if (l === 0) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

