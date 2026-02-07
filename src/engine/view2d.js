import { clamp } from "./util/math.js";

/** @typedef {{kind:"2d", scale:number, offsetX:number, offsetY:number}} View2D */
/** @typedef {{x:number,y:number}} Vec2 */

/** @param {View2D} view @param {Vec2} p */
export function worldToScreen(view, p) {
  return {
    x: p.x * view.scale + view.offsetX,
    y: -p.y * view.scale + view.offsetY,
  };
}

/** @param {View2D} view @param {Vec2} p */
export function screenToWorld(view, p) {
  return {
    x: (p.x - view.offsetX) / view.scale,
    y: -(p.y - view.offsetY) / view.scale,
  };
}

/** @param {View2D} view @param {number} dxPx @param {number} dyPx */
export function pan2D(view, dxPx, dyPx) {
  view.offsetX += dxPx;
  view.offsetY += dyPx;
}

/**
 * Zoom (scale) about a fixed screen anchor point.
 * @param {View2D} view
 * @param {number} factor
 * @param {Vec2} anchorScreen
 */
export function zoom2DAt(view, factor, anchorScreen) {
  const before = screenToWorld(view, anchorScreen);
  view.scale = clamp(view.scale * factor, 10, 6000);
  const after = worldToScreen(view, before);
  view.offsetX += anchorScreen.x - after.x;
  view.offsetY += anchorScreen.y - after.y;
}

/**
 * @param {View2D} view
 * @param {number} widthPx
 * @param {number} heightPx
 * @param {{offsetY?: number}} [opts]
 */
export function initialize2DViewIfNeeded(view, widthPx, heightPx, opts) {
  // @ts-ignore - untyped extension
  if (view.initialized) return;
  view.offsetX = widthPx / 2;
  view.offsetY = typeof opts?.offsetY === "number" ? opts.offsetY : heightPx / 2;
  // @ts-ignore - untyped extension used by fixed-frame models
  view.modelOffsetX = view.offsetX;
  // @ts-ignore - untyped extension used by fixed-frame models
  view.modelOffsetY = view.offsetY;
  // @ts-ignore - untyped extension
  view.initialized = true;
}
