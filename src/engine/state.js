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
  POINT: "point",
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
 *  constraints?: Array<{kind: "line" | "circle", id: string}>,
 *  intersectionHints?: Array<{id: string, mode: "line" | "angle", value: number}>,
 *  hidden?: boolean,
 *  debug?: boolean,
 *  style: { color: string, opacity: number }
 * }} Point
 */

/**
 * @typedef {{
 *  id: string,
 *  label: string,
 *  p1: string,
 *  p2: string,
 *  hidden?: boolean,
 *  debug?: boolean,
 *  style: { color: string, opacity: number }
 * }} Line
 */

/**
 * @typedef {{
 *  id: string,
 *  label: string,
 *  center: string,
 *  radiusPoint: string,
 *  hidden?: boolean,
 *  debug?: boolean,
 *  style: { color: string, opacity: number }
 * }} Circle
 */

/**
 * @typedef {{
 *  points: Point[],
 *  lines: Line[],
 *  circles: Circle[],
 *  historySteps?: Array<HistoryStep>,
 *  nextId: number,
 *  nextPointLabel: number,
 *  nextCurveLabel: number,
 *  starPointId?: string
 * }} ConstructionDoc
 */

/**
 * @typedef {(
 *  { type: "point", pointId: string, on?: { kind: "line" | "circle", id: string } } |
 *  { type: "line", lineId: string } |
 *  { type: "circle", circleId: string } |
 *  { type: "intersection", pointId: string, a: { kind: "line" | "circle", id: string }, b: { kind: "line" | "circle", id: string } } |
 *  { type: "tool", toolName: string, output: { kind: "point" | "line" | "circle", id: string }, inputs: Array<{ kind: "point" | "line" | "circle", id: string }> }
 * )} HistoryStep
 */

/**
 * @typedef {{
 *  id: string,
 *  name: string,
 *  inputs: Array<{ kind: "point" | "line" | "circle" }>,
 *  steps: ToolStep[],
 *  output: { kind: "point" | "line" | "circle", nodeId: string }
 * }} CustomTool
 */

/**
 * @typedef {(
 *  { id: string, kind: "point", op: "input", inputIndex: number } |
 *  { id: string, kind: "line", op: "input", inputIndex: number } |
 *  { id: string, kind: "circle", op: "input", inputIndex: number } |
 *  { id: string, kind: "line", op: "line", p1: string, p2: string } |
 *  { id: string, kind: "circle", op: "circle", center: string, radius: string } |
 *  { id: string, kind: "circle", op: "circle_fixed", center: string, radius: number, angle: number } |
 *  { id: string, kind: "point", op: "point_fixed", x: number, y: number, z?: number } |
 *  { id: string, kind: "point", op: "intersection", a: string, b: string, curveHints?: Array<{ nodeId: string, mode: "line" | "angle", value: number }>, sphereHint?: { x: number, y: number, z: number }, lineRef?: { lineNodeId: string, refPointNodeId: string, value: number }, lineSide?: { lineNodeId: string, sign: number }, circleSide?: { sign: number }, orientRef?: { originNodeId: string, directionNodeId: string, sign: number }, pairRef?: { originNodeId: string, otherPointNodeId: string, angle: number }, avoidPointRef?: { pointNodeId: string } } |
 *  { id: string, kind: "point", op: "point_on", curve: string, curveHint?: { mode: "line" | "angle", value: number }, lineOffsetRef?: { originNodeId: string, offset: number }, sphereHint?: { x: number, y: number, z: number } }
 * )} ToolStep
 */

/**
 * @typedef {{
 *  name: string,
 *  stage: "inputs" | "output" | "finalize",
 *  inputs: Array<{ kind: "point" | "line" | "circle", id: string }>,
 *  output?: { kind: "point" | "line" | "circle", id: string },
 *  error?: string
 * }} ToolBuilderState
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
 *  activeTool: string,
 *  docs: Record<string, ConstructionDoc>,
 *  views: Record<string, ViewState>,
 *  customTools: Record<string, CustomTool[]>,
 *  toolBuilder: ToolBuilderState | null,
 *  toolUse: null | { toolId: string, inputs: Array<{ kind: "point" | "line" | "circle", id: string }> },
 *  toolUseError?: string | null,
 *  showSteps: boolean,
 *  nextToolId: number,
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
    customTools: Object.create(null),
    toolBuilder: null,
    toolUse: null,
    toolUseError: null,
    showSteps: false,
    nextToolId: 1,
    pending: null,
    selection: null,
  };

  for (const geom of Object.values(GeometryType)) {
    state.docs[geom] = createEmptyDoc(geom);
    state.views[geom] = createDefaultView(geom);
    state.customTools[geom] = [];
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
    historySteps: [],
    nextId: 1,
    nextPointLabel: 0,
    nextCurveLabel: 0,
  };

  if (geom === GeometryType.INVERSIVE_EUCLIDEAN) {
    const id = makeId("p", doc.nextId++);
    doc.starPointId = id;
    doc.points.push({
      id,
      label: "∞",
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
  if (label === "*" || label === "∞") return;
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
