import { GeometryType, ToolType, nextCurveLabel, nextPointLabel } from "./state.js";
import { constrain2DPoint, derive2DCircleCurve, derive2DLineCurve, deriveSphereCircle, deriveSphereGreatCircle, intersectSpherePlanes, is2DPointInDomain } from "./geometry.js";
import { intersectCurves, signedDistanceToCurve } from "./geom2d.js";
import { makeId } from "./util/ids.js";
import { initialize2DViewIfNeeded, pan2D, screenToWorld, worldToScreen, zoom2DAt } from "./view2d.js";
import { projectSphere, rotateByDrag, rotateToView, screenToSpherePoint, zoomSphere } from "./sphereView.js";
import { dot3, norm3 } from "./vec3.js";

/**
 * @typedef {import("./state.js").AppState} AppState
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *  getState: () => AppState,
 *  requestRender: () => void,
 *  openContextMenu: (pos: {x:number,y:number}, target: {kind:"point"|"line"|"circle", id:string}) => void,
 *  closeContextMenu: () => void
 * }} deps
 */
export function attachCanvasController(canvas, deps) {
  /** @type {null | {kind:"pan"} | {kind:"point", pointId:string} } */
  let action = null;
  /** @type {{x:number,y:number} | null} */
  let downAt = null;
  /** @type {boolean} */
  let moved = false;
  const dragThresholdPx = 3;

  const getCSSPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const ensureViewInit = () => {
    const state = deps.getState();
    const geom = state.activeGeometry;
    const view = state.views[geom];
    if (geom === GeometryType.SPHERICAL) return;
    const rect = canvas.getBoundingClientRect();
    initialize2DViewIfNeeded(
      /** @type {any} */ (view),
      rect.width,
      rect.height,
      geom === GeometryType.HYPERBOLIC_HALF_PLANE ? { offsetY: rect.height * 0.78 } : undefined,
    );
  };

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    ensureViewInit();
    const state = deps.getState();
    const geom = state.activeGeometry;
    const pos = getCSSPos(e);
    const hit = hitTestAny(state, geom, pos, canvas);
    if (!hit) return;

    const pane = canvas.parentElement;
    const paneRect = pane ? pane.getBoundingClientRect() : canvas.getBoundingClientRect();
    deps.openContextMenu({ x: e.clientX - paneRect.left, y: e.clientY - paneRect.top }, hit);
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    deps.closeContextMenu();
    ensureViewInit();
    canvas.setPointerCapture(e.pointerId);
    const pos = getCSSPos(e);
    downAt = pos;
    moved = false;

    const state = deps.getState();
    const geom = state.activeGeometry;

    const hitPoint = hitTestPoint(state, geom, pos, canvas);
    if (hitPoint) action = { kind: "point", pointId: hitPoint.id };
    else action = { kind: "pan" };
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!action || !downAt) return;
    const pos = getCSSPos(e);
    const dx = pos.x - downAt.x;
    const dy = pos.y - downAt.y;
    if (!moved && Math.hypot(dx, dy) >= dragThresholdPx) moved = true;

    if (!moved) return;

    const state = deps.getState();
    const geom = state.activeGeometry;
    const doc = state.docs[geom];
    const view = state.views[geom];

    if (action.kind === "pan") {
      if (geom === GeometryType.SPHERICAL) rotateByDrag(/** @type {any} */ (view), dx, dy);
      else pan2D(/** @type {any} */ (view), dx, dy);
      downAt = pos;
      deps.requestRender();
      return;
    }

    if (action.kind === "point") {
      const p = doc.points.find((pt) => pt.id === action.pointId);
      if (!p || p.locked) return;
      if (geom === GeometryType.SPHERICAL) {
        const rect = canvas.getBoundingClientRect();
        const vp = sphereViewport(/** @type {any} */ (view), rect.width, rect.height);
        const q = screenToSpherePoint(/** @type {any} */ (view), pos, vp);
        if (!q) return;
        p.x = q.x;
        p.y = q.y;
        p.z = q.z;
      } else {
        const wPos = screenToWorld(/** @type {any} */ (view), pos);
        const constrained = constrain2DPoint(geom, wPos);
        if (!constrained) return;
        p.x = constrained.x;
        p.y = constrained.y;
      }
      deps.requestRender();
      return;
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
    if (!action || !downAt) return;
    const pos = getCSSPos(e);

    const state = deps.getState();
    const geom = state.activeGeometry;
    const doc = state.docs[geom];
    const view = state.views[geom];

    if (!moved) {
      // Treat as a click
      if (state.activeTool === ToolType.INTERSECT) {
        const obj = hitTestCurve(state, geom, pos, canvas);
        if (obj) onIntersectClick(state, geom, doc, obj, view, canvas);
      } else {
        const pointId = getOrCreatePointAtClick(state, geom, doc, view, pos, canvas);
        if (pointId) {
          if (state.activeTool === ToolType.LINE) onLineClick(state, doc, pointId);
          if (state.activeTool === ToolType.CIRCLE) onCircleClick(state, doc, pointId);
        }
      }
      deps.requestRender();
    }

    action = null;
    downAt = null;
    moved = false;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      ensureViewInit();
      const state = deps.getState();
      const geom = state.activeGeometry;
      const view = state.views[geom];

      if (geom === GeometryType.SPHERICAL) {
        zoomSphere(/** @type {any} */ (view), e.deltaY);
      } else {
        const pos = getCSSPos(e);
        const factor = Math.exp(-e.deltaY * 0.0014);
        zoom2DAt(/** @type {any} */ (view), factor, pos);
      }
      deps.requestRender();
    },
    { passive: false },
  );
}

/**
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {{x:number,y:number}} pos
 * @param {HTMLCanvasElement} canvas
 * @returns {{kind:"point"|"line"|"circle", id:string} | null}
 */
function hitTestAny(state, geom, pos, canvas) {
  const p = hitTestPoint(state, geom, pos, canvas);
  if (p) return { kind: "point", id: p.id };
  return hitTestCurve(state, geom, pos, canvas);
}

/**
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {{x:number,y:number}} pos
 * @param {HTMLCanvasElement} canvas
 */
function hitTestPoint(state, geom, pos, canvas) {
  const doc = state.docs[geom];
  const view = state.views[geom];
  const threshold = 10;

  if (geom === GeometryType.SPHERICAL) {
    const rect = canvas.getBoundingClientRect();
    const vp = sphereViewport(/** @type {any} */ (view), rect.width, rect.height);
    let best = null;
    let bestD = Infinity;
    for (const pt of doc.points) {
      if (pt.z == null) continue;
      const v = rotateToView(/** @type {any} */ (view), { x: pt.x, y: pt.y, z: pt.z });
      const s = projectSphere(v, vp);
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) {
        bestD = d;
        best = pt;
      }
    }
    return bestD <= threshold ? best : null;
  }

  const v2d = /** @type {any} */ (view);
  let best = null;
  let bestD = Infinity;
  for (const pt of doc.points) {
    const s = worldToScreen(v2d, { x: pt.x, y: pt.y });
    const d = Math.hypot(s.x - pos.x, s.y - pos.y);
    if (d < bestD) {
      bestD = d;
      best = pt;
    }
  }
  return bestD <= threshold ? best : null;
}

/**
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {{x:number,y:number}} pos
 * @param {HTMLCanvasElement} canvas
 * @returns {{kind:"line"|"circle", id:string} | null}
 */
function hitTestCurve(state, geom, pos, canvas) {
  const doc = state.docs[geom];
  const view = state.views[geom];
  const thresholdPx = 8;

  if (geom === GeometryType.SPHERICAL) {
    const rect = canvas.getBoundingClientRect();
    const vp = sphereViewport(/** @type {any} */ (view), rect.width, rect.height);
    const x = screenToSpherePoint(/** @type {any} */ (view), pos, vp);
    if (!x) return null;
    let best = null;
    let bestD = Infinity;
    for (const line of doc.lines) {
      const plane = deriveSphereGreatCircle(doc, line);
      if (!plane) continue;
      const d = Math.abs(dot3(plane.normal, x) - plane.d);
      if (d < bestD) {
        bestD = d;
        best = { kind: "line", id: line.id };
      }
    }
    for (const circle of doc.circles) {
      const plane = deriveSphereCircle(doc, circle);
      if (!plane) continue;
      const d = Math.abs(dot3(plane.normal, x) - plane.d);
      if (d < bestD) {
        bestD = d;
        best = { kind: "circle", id: circle.id };
      }
    }
    return bestD <= 0.05 ? best : null;
  }

  const v2d = /** @type {any} */ (view);
  const w = screenToWorld(v2d, pos);
  if (!is2DPointInDomain(geom, w)) return null;

  /** @type {null | {kind:"line"|"circle", id:string}} */
  let best = null;
  let bestDPx = Infinity;

  for (const line of doc.lines) {
    const curve = derive2DLineCurve(geom, doc, line);
    if (!curve) continue;
    const dWorld = Math.abs(signedDistanceToCurve(curve, w));
    const dPx = dWorld * v2d.scale;
    if (dPx < bestDPx) {
      bestDPx = dPx;
      best = { kind: "line", id: line.id };
    }
  }

  for (const circle of doc.circles) {
    const curve = derive2DCircleCurve(geom, doc, circle);
    if (!curve) continue;
    const dWorld = Math.abs(signedDistanceToCurve(curve, w));
    const dPx = dWorld * v2d.scale;
    if (dPx < bestDPx) {
      bestDPx = dPx;
      best = { kind: "circle", id: circle.id };
    }
  }

  return bestDPx <= thresholdPx ? best : null;
}

/**
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {any} view
 * @param {{x:number,y:number}} pos
 * @param {HTMLCanvasElement} canvas
 * @returns {string | null}
 */
function getOrCreatePointAtClick(state, geom, doc, view, pos, canvas) {
  const hit = hitTestPoint(state, geom, pos, canvas);
  if (hit) return hit.id;

  if (geom === GeometryType.SPHERICAL) {
    const rect = canvas.getBoundingClientRect();
    const vp = sphereViewport(/** @type {any} */ (view), rect.width, rect.height);
    const p = screenToSpherePoint(/** @type {any} */ (view), pos, vp);
    if (!p) return null;
    return createSpherePoint(doc, p);
  }

  const v2d = /** @type {any} */ (view);
  const w = screenToWorld(v2d, pos);
  if (!is2DPointInDomain(geom, w)) return null;
  return create2DPoint(doc, w);
}

/** @param {any} doc @param {{x:number,y:number}} w */
function create2DPoint(doc, w) {
  const id = makeId("p", doc.nextId++);
  const label = nextPointLabel(doc);
  doc.points.push({
    id,
    label,
    x: w.x,
    y: w.y,
    style: { color: "#111111", opacity: 1 },
  });
  return id;
}

/** @param {any} doc @param {{x:number,y:number,z:number}} p */
function createSpherePoint(doc, p) {
  const id = makeId("p", doc.nextId++);
  const label = nextPointLabel(doc);
  const u = norm3(p);
  doc.points.push({
    id,
    label,
    x: u.x,
    y: u.y,
    z: u.z,
    style: { color: "#111111", opacity: 1 },
  });
  return id;
}

/** @param {AppState} state @param {any} doc @param {string} pointId */
function onLineClick(state, doc, pointId) {
  if (!state.pending || state.pending.tool !== ToolType.LINE) {
    state.pending = { tool: ToolType.LINE, firstPointId: pointId };
    return;
  }

  const first = state.pending.firstPointId;
  const second = pointId;
  state.pending = null;
  if (first === second) return;

  const id = makeId("l", doc.nextId++);
  const label = nextCurveLabel(doc);
  doc.lines.push({
    id,
    label,
    p1: first,
    p2: second,
    style: { color: "#0b57d0", opacity: 1 },
  });
}

/** @param {AppState} state @param {any} doc @param {string} pointId */
function onCircleClick(state, doc, pointId) {
  if (!state.pending || state.pending.tool !== ToolType.CIRCLE) {
    state.pending = { tool: ToolType.CIRCLE, firstPointId: pointId };
    return;
  }

  const center = state.pending.firstPointId;
  const radiusPoint = pointId;
  state.pending = null;
  if (center === radiusPoint) return;

  const id = makeId("c", doc.nextId++);
  const label = nextCurveLabel(doc);
  doc.circles.push({
    id,
    label,
    center,
    radiusPoint,
    style: { color: "#b31412", opacity: 1 },
  });
}

/**
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {{kind:"line"|"circle", id:string}} obj
 */
function onIntersectClick(state, geom, doc, obj, view, canvas) {
  if (!state.pending || state.pending.tool !== ToolType.INTERSECT) {
    state.pending = { tool: ToolType.INTERSECT, firstObject: obj };
    state.selection = obj;
    return;
  }

  const a = state.pending.firstObject;
  const b = obj;
  state.pending = null;
  state.selection = null;
  if (a.kind === b.kind && a.id === b.id) return;

  if (geom === GeometryType.SPHERICAL) {
    const lineA = a.kind === "line" ? doc.lines.find((l) => l.id === a.id) : null;
    const circleA = a.kind === "circle" ? doc.circles.find((c) => c.id === a.id) : null;
    const lineB = b.kind === "line" ? doc.lines.find((l) => l.id === b.id) : null;
    const circleB = b.kind === "circle" ? doc.circles.find((c) => c.id === b.id) : null;
    const planeA = lineA ? deriveSphereGreatCircle(doc, lineA) : circleA ? deriveSphereCircle(doc, circleA) : null;
    const planeB = lineB ? deriveSphereGreatCircle(doc, lineB) : circleB ? deriveSphereCircle(doc, circleB) : null;
    if (!planeA || !planeB) return;
    const hits = intersectSpherePlanes(planeA, planeB);
    const rect = canvas.getBoundingClientRect();
    const vp = sphereViewport(/** @type {any} */ (view), rect.width, rect.height);
    const newPts = filterNewSpherePoints(doc, /** @type {any} */ (view), vp, hits, 10);
    for (const p of newPts) createSpherePoint(doc, p);
    return;
  }

  const lineA = a.kind === "line" ? doc.lines.find((l) => l.id === a.id) : null;
  const circleA = a.kind === "circle" ? doc.circles.find((c) => c.id === a.id) : null;
  const lineB = b.kind === "line" ? doc.lines.find((l) => l.id === b.id) : null;
  const circleB = b.kind === "circle" ? doc.circles.find((c) => c.id === b.id) : null;
  const curveA = lineA ? derive2DLineCurve(geom, doc, lineA) : circleA ? derive2DCircleCurve(geom, doc, circleA) : null;
  const curveB = lineB ? derive2DLineCurve(geom, doc, lineB) : circleB ? derive2DCircleCurve(geom, doc, circleB) : null;
  if (!curveA || !curveB) return;

  const hits = intersectCurves(curveA, curveB).filter((p) => is2DPointInDomain(geom, p));
  const newPts = filterNew2DPoints(doc, /** @type {any} */ (view), hits, 10);
  for (const p of newPts) create2DPoint(doc, p);
}

/**
 * @param {any} doc
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}[]} hits
 * @param {number} thresholdPx
 */
function filterNew2DPoints(doc, view, hits, thresholdPx) {
  /** @type {{x:number,y:number}[]} */
  const out = [];
  for (const p of hits) {
    const s = worldToScreen(view, p);
    const isNearExisting = doc.points.some((q) => {
      const qs = worldToScreen(view, { x: q.x, y: q.y });
      return Math.hypot(qs.x - s.x, qs.y - s.y) <= thresholdPx;
    });
    if (isNearExisting) continue;
    const isNearOut = out.some((q) => {
      const qs = worldToScreen(view, q);
      return Math.hypot(qs.x - s.x, qs.y - s.y) <= thresholdPx;
    });
    if (isNearOut) continue;
    out.push(p);
  }
  return out;
}

/**
 * @param {any} doc
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, r:number}} vp
 * @param {{x:number,y:number,z:number}[]} hits
 * @param {number} thresholdPx
 */
function filterNewSpherePoints(doc, view, vp, hits, thresholdPx) {
  /** @type {{x:number,y:number,z:number}[]} */
  const out = [];
  for (const p0 of hits) {
    const p = norm3(p0);
    const v = rotateToView(view, p);
    const s = projectSphere(v, vp);
    const isNearExisting = doc.points.some((q) => {
      if (q.z == null) return false;
      const qv = rotateToView(view, { x: q.x, y: q.y, z: q.z });
      const qs = projectSphere(qv, vp);
      return Math.hypot(qs.x - s.x, qs.y - s.y) <= thresholdPx;
    });
    if (isNearExisting) continue;
    const isNearOut = out.some((q) => {
      const qv = rotateToView(view, q);
      const qs = projectSphere(qv, vp);
      return Math.hypot(qs.x - s.x, qs.y - s.y) <= thresholdPx;
    });
    if (isNearOut) continue;
    out.push(p);
  }
  return out;
}

/**
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {number} cssW
 * @param {number} cssH
 */
function sphereViewport(view, cssW, cssH) {
  const baseR = Math.min(cssW, cssH) * 0.38;
  return { cx: cssW / 2, cy: cssH / 2, r: baseR * view.zoom };
}
