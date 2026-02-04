import { makeId } from "./util/ids.js";
import { indexToLetters } from "./util/labels.js";
import { clamp } from "./util/math.js";

export const GeometryType = /** @type {const} */ ({
  EUCLIDEAN: "euclidean",
  INVERSIVE_EUCLIDEAN: "inversive_euclidean",
  SPHERICAL: "spherical",
  HYPERBOLIC_POINCARE: "hyperbolic_poincare",
  HYPERBOLIC_HALF_PLANE: "hyperbolic_half_plane",
});

export const ToolType = /** @type {const} */ ({
  LINE: "line",
  CIRCLE: "circle",
  INTERSECT: "intersect",
});

/**
 * @typedef {{
 *  id: string,
 *  label: string,
 *  x: number,
 *  y: number,
 *  z?: number,
 *  locked?: boolean,
 *  style: { color: string, opacity: number }
 * }} Point
 */

/**
 * @typedef {{
 *  id: string,
 *  label: string,
 *  p1: string,
 *  p2: string,
 *  style: { color: string, opacity: number }
 * }} Line
 */

/**
 * @typedef {{
 *  id: string,
 *  label: string,
 *  center: string,
 *  radiusPoint: string,
 *  style: { color: string, opacity: number }
 * }} Circle
 */

/**
 * @typedef {{
 *  points: Point[],
 *  lines: Line[],
 *  circles: Circle[],
 *  nextId: number,
 *  nextPointLabel: number,
 *  nextCurveLabel: number,
 *  starPointId?: string
 * }} ConstructionDoc
 */

/**
 * @typedef {{
 *  kind: "2d",
 *  scale: number,
 *  offsetX: number,
 *  offsetY: number
 * } | {
 *  kind: "sphere",
 *  yaw: number,
 *  pitch: number,
 *  zoom: number
 * }} ViewState
 */

/**
 * @typedef {{
 *  activeGeometry: GeometryType,
 *  activeTool: ToolType,
 *  docs: Record<string, ConstructionDoc>,
 *  views: Record<string, ViewState>,
 *  pending: null | { tool: ToolType.LINE | ToolType.CIRCLE, firstPointId: string } | { tool: ToolType.INTERSECT, firstObject: { kind: "line"|"circle", id: string } },
 *  selection: null | { kind: "line"|"circle", id: string }
 * }} AppState
 */

/** @returns {AppState} */
export function createInitialState() {
  /** @type {AppState} */
  const state = {
    activeGeometry: GeometryType.EUCLIDEAN,
    activeTool: ToolType.LINE,
    docs: Object.create(null),
    views: Object.create(null),
    pending: null,
    selection: null,
  };

  for (const geom of Object.values(GeometryType)) {
    state.docs[geom] = createEmptyDoc(geom);
    state.views[geom] = createDefaultView(geom);
  }

  return state;
}

/** @param {GeometryType} geom */
export function createEmptyDoc(geom) {
  /** @type {ConstructionDoc} */
  const doc = {
    points: [],
    lines: [],
    circles: [],
    nextId: 1,
    nextPointLabel: 0,
    nextCurveLabel: 0,
  };

  if (geom === GeometryType.INVERSIVE_EUCLIDEAN) {
    const id = makeId("p", doc.nextId++);
    doc.starPointId = id;
    doc.points.push({
      id,
      label: "*",
      x: 0,
      y: 0,
      locked: true,
      style: { color: "#111111", opacity: 1 },
    });
  }

  return doc;
}

/** @param {GeometryType} geom */
export function createDefaultView(geom) {
  if (geom === GeometryType.SPHERICAL) {
    /** @type {ViewState} */
    const v = { kind: "sphere", yaw: 0.6, pitch: -0.25, zoom: 1 };
    return v;
  }
  const baseScale =
    geom === GeometryType.HYPERBOLIC_POINCARE
      ? 260
      : geom === GeometryType.HYPERBOLIC_HALF_PLANE
        ? 120
        : 90;
  /** @type {ViewState} */
  const v = { kind: "2d", scale: baseScale, offsetX: 0, offsetY: 0 };
  return v;
}

/** @param {ConstructionDoc} doc */
export function nextPointLabel(doc) {
  const label = indexToLetters(doc.nextPointLabel++, { uppercase: false });
  return label;
}

/** @param {ConstructionDoc} doc */
export function nextCurveLabel(doc) {
  const label = indexToLetters(doc.nextCurveLabel++, { uppercase: true });
  return label;
}

/**
 * @param {ConstructionDoc} doc
 * @param {string} label
 */
export function reservePointLabel(doc, label) {
  if (label === "*") return;
  const idx = lettersToIndex(label);
  if (idx == null) return;
  doc.nextPointLabel = Math.max(doc.nextPointLabel, idx + 1);
}

/**
 * @param {ConstructionDoc} doc
 * @param {string} label
 */
export function reserveCurveLabel(doc, label) {
  const idx = lettersToIndex(label);
  if (idx == null) return;
  doc.nextCurveLabel = Math.max(doc.nextCurveLabel, idx + 1);
}

/**
 * @param {string} s
 * @returns {number | null}
 */
function lettersToIndex(s) {
  if (!/^[a-z]+$/i.test(s)) return null;
  const chars = s.toUpperCase().split("");
  let n = 0;
  for (const ch of chars) {
    const k = ch.charCodeAt(0) - 64; // A=1
    if (k < 1 || k > 26) return null;
    n = n * 26 + k;
  }
  return n - 1;
}

/**
 * @param {ViewState} view
 * @param {number} nextScale
 */
export function set2DScale(view, nextScale) {
  if (view.kind !== "2d") return;
  view.scale = clamp(nextScale, 10, 3000);
}

