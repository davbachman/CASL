import { GeometryType, ToolType, nextCurveLabel, nextPointLabel } from "./state.js";
import {
  constrain2DPoint,
  derive2DCircleCurve,
  derive2DLineCurve,
  deriveSphereCircle,
  deriveSphereGreatCircle,
  intersectSpherePlanes,
  is2DPointInDomain,
  isSphere,
} from "./geometry.js";
import { intersectCurves, signedDistanceToCurve } from "./geom2d.js";
import { samplePoincareCirclePoints, samplePoincareGeodesicPoints } from "./hyperbolicCurves.js";
import {
  clampToPoincareDisk,
  hyperbolicDisplay2DToInternal,
  hyperbolicInternalToDisplay2D,
  poincareTranslate,
  poincareTranslateInverse,
} from "./hyperbolicModels.js?v=20260208-88";
import { hyperboloidViewport, projectPoincareOnHyperboloid, screenToHyperboloidPoincare } from "./hyperboloidView.js?v=20260208-88";
import {
  perspectiveDisplayDomainMinY,
  perspectiveDisplayLineFromWorldLine,
  perspectiveDisplayToWorld,
  perspectiveWorldToDisplay,
} from "./perspectiveView.js?v=20260208-88";
import { sampleSpherePlanePoints, sphereToStereographic, stereographicToSphere } from "./stereographic.js";
import { makeId } from "./util/ids.js";
import { initialize2DViewIfNeeded, pan2D, screenToWorld, worldToScreen, zoom2DAt } from "./view2d.js";
import { projectSphere, rotateByDrag, rotateHyperboloidByDrag, rotateToView, screenToSpherePoint, zoomSphere } from "./sphereView.js";
import { dot3, norm3 } from "./vec3.js";

/**
 * @typedef {import("./state.js").AppState} AppState
 */

/** @param {GeometryType} geom */
function isOrbitalGeometry(geom) {
  return geom === GeometryType.SPHERICAL || geom === GeometryType.HYPERBOLIC_HYPERBOLOID;
}

/** @param {GeometryType} geom */
function usesFixedFramePanGeometry(geom) {
  return (
    geom === GeometryType.EUCLIDEAN_PERSPECTIVE ||
    geom === GeometryType.HYPERBOLIC_POINCARE ||
    geom === GeometryType.HYPERBOLIC_KLEIN ||
    geom === GeometryType.HYPERBOLIC_HALF_PLANE
  );
}

/**
 * Shift the displayed hyperbolic origin without rotating the rendered surface.
 *
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number, roll?:number, chartOffsetX?:number, chartOffsetY?:number}} view
 * @param {number} dxPx
 * @param {number} dyPx
 */
function panHyperboloidOrigin(view, dxPx, dyPx) {
  const speed = 0.0015 / Math.max(0.25, view.zoom);
  const delta = clampToPoincareDisk({ x: dxPx * speed, y: -dyPx * speed });
  const o = getChartOffset(view);
  const shifted = poincareTranslate(o, delta);
  view.chartOffsetX = shifted.x;
  view.chartOffsetY = shifted.y;
}

/**
 * @param {{chartOffsetX?:number, chartOffsetY?:number}} view
 * @returns {{x:number,y:number}}
 */
function getChartOffset(view) {
  return {
    x: Number.isFinite(view?.chartOffsetX) ? view.chartOffsetX : 0,
    y: Number.isFinite(view?.chartOffsetY) ? view.chartOffsetY : 0,
  };
}

/**
 * @param {{chartOffsetX?:number, chartOffsetY?:number}} view
 * @param {number} dxPx
 * @param {number} dyPx
 * @param {number} scale
 */
function panHyperbolic2DOrigin(view, dxPx, dyPx, scale) {
  const speed = 1 / Math.max(120, scale || 1);
  const delta = clampToPoincareDisk({ x: dxPx * speed, y: -dyPx * speed });
  const o = getChartOffset(view);
  const shifted = poincareTranslate(o, delta);
  view.chartOffsetX = shifted.x;
  view.chartOffsetY = shifted.y;
}

/**
 * Half-plane origin pan uses the half-plane isometries:
 * x-translation and positive y-dilation.
 *
 * @param {{chartOffsetX?:number, chartOffsetY?:number, scale:number}} view
 * @param {number} dxPx
 * @param {number} dyPx
 */
function panHalfPlaneOrigin(view, dxPx, dyPx) {
  const speed = 1 / Math.max(80, view.scale || 1);
  const o = getChartOffset(view);
  view.chartOffsetX = o.x + dxPx * speed;
  const nextLogScale = o.y - dyPx * speed * 0.7;
  // Keep exponentials numerically stable while allowing broad panning.
  view.chartOffsetY = Math.max(-6, Math.min(6, nextLogScale));
}

/**
 * Clamp display-space y used for perspective panning away from the singular horizon
 * and from the lower clipping boundary.
 *
 * @param {{scale:number}} view
 * @param {number} displayY
 * @returns {number}
 */
function clampPerspectiveDisplayYForPan(view, displayY) {
  const minY = perspectiveDisplayDomainMinY() + 1e-4;
  const guardPx = 36;
  const guardWorld = guardPx / Math.max(1, view.scale || 1);
  const maxY = -Math.max(0.4, guardWorld);
  if (maxY <= minY) return (minY + maxY) * 0.5;
  return Math.max(minY, Math.min(maxY, displayY));
}

/**
 * Keep perspective panning "under cursor" by preserving the same internal model
 * point between two pointer positions.
 *
 * @param {{chartOffsetX?:number, chartOffsetY?:number, scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} fromPos
 * @param {{x:number,y:number}} toPos
 */
function panPerspectiveOrigin(view, fromPos, toPos) {
  const fromDisplayRaw = screenToWorld(view, fromPos);
  const toDisplayRaw = screenToWorld(view, toPos);
  const fromDisplay = { x: fromDisplayRaw.x, y: clampPerspectiveDisplayYForPan(view, fromDisplayRaw.y) };
  const toDisplay = { x: toDisplayRaw.x, y: clampPerspectiveDisplayYForPan(view, toDisplayRaw.y) };
  const fromShown = perspectiveDisplayToWorld(fromDisplay);
  const toShown = perspectiveDisplayToWorld(toDisplay);
  const o = getChartOffset(view);

  // If either side is outside perspective display domain, fall back to
  // approximate linear panning so drag still works.
  if (!fromShown || !toShown) {
    const dxPx = toPos.x - fromPos.x;
    const dyPx = toPos.y - fromPos.y;
    const speed = 1 / Math.max(40, view.scale || 1);
    view.chartOffsetX = o.x + dxPx * speed;
    view.chartOffsetY = o.y - dyPx * speed;
    return;
  }

  const anchorInternal = { x: fromShown.x - o.x, y: fromShown.y - o.y };
  view.chartOffsetX = toShown.x - anchorInternal.x;
  view.chartOffsetY = toShown.y - anchorInternal.y;
}

/**
 * Apply origin shift (view-level pan) to a model point.
 *
 * @param {GeometryType} geom
 * @param {{chartOffsetX?:number, chartOffsetY?:number}} view
 * @param {{x:number,y:number}} p
 * @returns {{x:number,y:number}}
 */
function applyOriginShift(geom, view, p) {
  const t = getChartOffset(view);
  if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) {
    return { x: p.x + t.x, y: p.y + t.y };
  }
  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    const scaleY = Math.exp(t.y);
    return { x: p.x * scaleY + t.x, y: Math.max(1e-9, p.y * scaleY) };
  }
  if (geom === GeometryType.HYPERBOLIC_POINCARE || geom === GeometryType.HYPERBOLIC_KLEIN) {
    return poincareTranslate(p, t);
  }
  return p;
}

/**
 * Remove origin shift (view-level pan) from a model point.
 *
 * @param {GeometryType} geom
 * @param {{chartOffsetX?:number, chartOffsetY?:number}} view
 * @param {{x:number,y:number}} p
 * @returns {{x:number,y:number}}
 */
function removeOriginShift(geom, view, p) {
  const t = getChartOffset(view);
  if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) {
    return { x: p.x - t.x, y: p.y - t.y };
  }
  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    const scaleY = Math.exp(t.y);
    const denom = Math.max(1e-9, scaleY);
    return { x: (p.x - t.x) / denom, y: p.y / denom };
  }
  if (geom === GeometryType.HYPERBOLIC_POINCARE || geom === GeometryType.HYPERBOLIC_KLEIN) {
    return poincareTranslateInverse(p, t);
  }
  return p;
}

/**
 * Domain checks are performed in the model space that is currently displayed.
 * For perspective, that means checking after the pan-origin shift is applied.
 *
 * @param {GeometryType} geom
 * @param {{chartOffsetX?:number, chartOffsetY?:number}} view
 * @param {{x:number,y:number}} p
 * @returns {boolean}
 */
function isPointInDisplayedDomain(geom, view, p) {
  if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) {
    return is2DPointInDomain(geom, applyOriginShift(geom, view, p));
  }
  return is2DPointInDomain(geom, p);
}

/**
 * Curve solving should use the underlying geometry domain, not display clipping.
 * Perspective keeps Euclidean incidences even when intermediate points are off-screen.
 *
 * @param {GeometryType} geom
 * @param {{x:number,y:number}} p
 * @returns {boolean}
 */
function isPointInOperationDomain(geom, p) {
  if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) return true;
  return is2DPointInDomain(geom, p);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *  getState: () => AppState,
 *  requestRender: () => void,
 *  openContextMenu: (pos: {x:number,y:number}, target: {kind:"point"|"line"|"circle", id:string}) => void,
 *  closeContextMenu: () => void,
 *  pushHistory: () => void
 * }} deps
 */
export function attachCanvasController(canvas, deps) {
  /** @type {null | {kind:"pan"} | {kind:"point", pointId:string} } */
  let action = null;
  /** @type {{x:number,y:number} | null} */
  let downAt = null;
  /** @type {boolean} */
  let moved = false;
  /** @type {boolean} */
  let didPushHistoryForAction = false;
  const dragThresholdPx = 3;

  const getCSSPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const ensureViewInit = () => {
    const state = deps.getState();
    const geom = state.activeGeometry;
    const view = state.views[geom];
    if (isOrbitalGeometry(geom)) return;
    const rect = canvas.getBoundingClientRect();
    initialize2DViewIfNeeded(
      /** @type {any} */ (view),
      rect.width,
      rect.height,
      geom === GeometryType.HYPERBOLIC_HALF_PLANE
        ? { offsetY: rect.height * 0.78 }
        : geom === GeometryType.EUCLIDEAN_PERSPECTIVE
          ? { offsetY: rect.height * 0.5 }
          : undefined,
    );
    if (usesFixedFramePanGeometry(geom)) {
      // @ts-ignore - runtime extension set in view2d initializer
      if (!Number.isFinite(view.modelOffsetX)) view.modelOffsetX = view.offsetX;
      // @ts-ignore - runtime extension set in view2d initializer
      if (!Number.isFinite(view.modelOffsetY)) view.modelOffsetY = view.offsetY;
      // @ts-ignore - runtime extension for origin panning
      if (!Number.isFinite(view.chartOffsetX)) view.chartOffsetX = 0;
      // @ts-ignore - runtime extension for origin panning
      if (!Number.isFinite(view.chartOffsetY)) view.chartOffsetY = 0;
      // Keep a fixed display frame for these models; panning is modeled by chart offsets.
      // @ts-ignore - runtime extension set in view2d initializer
      view.offsetX = view.modelOffsetX;
      // @ts-ignore - runtime extension set in view2d initializer
      view.offsetY = view.modelOffsetY;
    }
  };

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    ensureViewInit();
    const state = deps.getState();
    const geom = state.activeGeometry;
    const pos = getCSSPos(e);
    const hit = hitTestAny(state, geom, pos, canvas);
    if (!hit) return;
    state.selection = hit;
    deps.requestRender();

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
    didPushHistoryForAction = false;

    const state = deps.getState();
    const geom = state.activeGeometry;
    const hitPoint = hitTestPoint(state, geom, pos, canvas);
    if (hitPoint) {
      action = { kind: "point", pointId: hitPoint.id };
      state.selection = { kind: "point", id: hitPoint.id };
      deps.requestRender();
    } else action = { kind: "pan" };
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
      if (geom === GeometryType.HYPERBOLIC_HYPERBOLOID) {
        if (e.shiftKey) rotateHyperboloidByDrag(/** @type {any} */ (view), dx, dy);
        else panHyperboloidOrigin(/** @type {any} */ (view), dx, dy);
      } else if (
        geom === GeometryType.HYPERBOLIC_POINCARE ||
        geom === GeometryType.HYPERBOLIC_KLEIN
      ) {
        panHyperbolic2DOrigin(/** @type {any} */ (view), dx, dy, view.scale);
      } else if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
        panHalfPlaneOrigin(/** @type {any} */ (view), dx, dy);
      } else if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) {
        panPerspectiveOrigin(/** @type {any} */ (view), downAt, pos);
      } else if (usesFixedFramePanGeometry(geom)) {
        pan2D(/** @type {any} */ (view), dx, dy);
      } else if (isOrbitalGeometry(geom)) rotateByDrag(/** @type {any} */ (view), dx, dy);
      else pan2D(/** @type {any} */ (view), dx, dy);
      downAt = pos;
      deps.requestRender();
      return;
    }

    if (action.kind === "point") {
      const p = doc.points.find((pt) => pt.id === action.pointId);
      if (!p || p.locked) return;
      if (!didPushHistoryForAction) {
        deps.pushHistory();
        didPushHistoryForAction = true;
      }
      if (geom === GeometryType.SPHERICAL) {
        const rect = canvas.getBoundingClientRect();
        const vp = sphereViewport(/** @type {any} */ (view), rect.width, rect.height);
        const q = screenToSpherePoint(/** @type {any} */ (view), pos, vp);
        if (!q) return;
        const constrained = applySphereConstraints(doc, p, q);
        p.x = constrained.x;
        p.y = constrained.y;
        p.z = constrained.z;
        enforceSphereConstraints(doc);
      } else if (geom === GeometryType.SPHERICAL_STEREOGRAPHIC) {
        const q = screenToStereographicSpherePoint(/** @type {any} */ (view), pos);
        if (!q) return;
        const constrained = applySphereConstraints(doc, p, q);
        p.x = constrained.x;
        p.y = constrained.y;
        p.z = constrained.z;
        enforceSphereConstraints(doc);
      } else if (geom === GeometryType.HYPERBOLIC_HYPERBOLOID) {
        const rect = canvas.getBoundingClientRect();
        const vp = hyperboloidViewport(/** @type {any} */ (view), rect.width, rect.height);
        const q = screenToHyperboloidPoincare(/** @type {any} */ (view), pos, vp);
        if (!q) return;
        const constrained = apply2DConstraints(geom, /** @type {any} */ (view), doc, p, q);
        p.x = constrained.x;
        p.y = constrained.y;
        enforce2DConstraints(geom, /** @type {any} */ (view), doc);
      } else {
        const wPos = screenToModelPoint2D(geom, /** @type {any} */ (view), pos);
        if (!wPos) return;
        const constrained = constrain2DPoint(geom, wPos);
        if (!constrained) return;
        const snapped = apply2DConstraints(geom, /** @type {any} */ (view), doc, p, constrained);
        p.x = snapped.x;
        p.y = snapped.y;
        enforce2DConstraints(geom, /** @type {any} */ (view), doc);
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
      const clickedRef = hitTestAny(state, geom, pos, canvas);
      state.selection = clickedRef;
      if (state.toolBuilder) {
        handleToolBuilderClick(state, geom, pos, canvas);
        deps.requestRender();
      } else {
        const customTool = getActiveCustomTool(state);
        if (customTool) {
          handleCustomToolClick(state, geom, doc, view, pos, canvas, customTool, deps.pushHistory);
          deps.requestRender();
        } else if (state.activeTool === ToolType.INTERSECT) {
          const obj = hitTestCurve(state, geom, pos, canvas);
          if (obj) onIntersectClick(state, geom, doc, obj, view, canvas, deps.pushHistory);
          deps.requestRender();
        } else if (
          state.activeTool === ToolType.POINT ||
          state.activeTool === ToolType.LINE ||
          state.activeTool === ToolType.CIRCLE
        ) {
          const hit = getOrCreatePointAtClick(state, geom, doc, view, pos, canvas, deps.pushHistory);
          if (hit) {
            state.selection = { kind: "point", id: hit.id };
            if (state.activeTool === ToolType.LINE) onLineClick(state, doc, hit.id, hit.created, deps.pushHistory);
            if (state.activeTool === ToolType.CIRCLE) onCircleClick(state, doc, hit.id, hit.created, deps.pushHistory);
          }
          deps.requestRender();
        } else {
          // No active tool: click only selects geometry for edit/delete.
          deps.requestRender();
        }
      }
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

      if (isOrbitalGeometry(geom)) {
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
      if (pt.hidden) continue;
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
  if (geom === GeometryType.SPHERICAL_STEREOGRAPHIC) {
    const v2d = /** @type {any} */ (view);
    let best = null;
    let bestD = Infinity;
    for (const pt of doc.points) {
      if (pt.hidden) continue;
      if (pt.z == null) continue;
      const s = projectSphericalPointToStereographicScreen(v2d, { x: pt.x, y: pt.y, z: pt.z });
      if (!s) continue;
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) {
        bestD = d;
        best = pt;
      }
    }
    return bestD <= threshold ? best : null;
  }
  if (geom === GeometryType.HYPERBOLIC_HYPERBOLOID) {
    const rect = canvas.getBoundingClientRect();
    const vp = hyperboloidViewport(/** @type {any} */ (view), rect.width, rect.height);
    let best = null;
    let bestD = Infinity;
    for (const pt of doc.points) {
      if (pt.hidden) continue;
      const s = projectPoincareOnHyperboloid(/** @type {any} */ (view), vp, { x: pt.x, y: pt.y });
      if (!s) continue;
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
    if (pt.hidden) continue;
    const s = projectModelPointToScreen2D(geom, v2d, { x: pt.x, y: pt.y });
    if (!s) continue;
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
      if (line.hidden) continue;
      const plane = deriveSphereGreatCircle(doc, line);
      if (!plane) continue;
      const d = Math.abs(dot3(plane.normal, x) - plane.d);
      if (d < bestD) {
        bestD = d;
        best = { kind: "line", id: line.id };
      }
    }
    for (const circle of doc.circles) {
      if (circle.hidden) continue;
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
  if (geom === GeometryType.SPHERICAL_STEREOGRAPHIC) {
    const v2d = /** @type {any} */ (view);
    /** @type {null | {kind:"line"|"circle", id:string}} */
    let best = null;
    let bestDPx = thresholdPx;
    for (const line of doc.lines) {
      if (line.hidden) continue;
      const plane = deriveSphereGreatCircle(doc, line);
      if (!plane) continue;
      const dPx = distanceToStereographicSphereCurvePx(v2d, pos, plane);
      if (dPx < bestDPx) {
        bestDPx = dPx;
        best = { kind: "line", id: line.id };
      }
    }
    for (const circle of doc.circles) {
      if (circle.hidden) continue;
      const plane = deriveSphereCircle(doc, circle);
      if (!plane) continue;
      const dPx = distanceToStereographicSphereCurvePx(v2d, pos, plane);
      if (dPx < bestDPx) {
        bestDPx = dPx;
        best = { kind: "circle", id: circle.id };
      }
    }
    return best;
  }
  if (geom === GeometryType.HYPERBOLIC_HYPERBOLOID) {
    const rect = canvas.getBoundingClientRect();
    const vp = hyperboloidViewport(/** @type {any} */ (view), rect.width, rect.height);
    /** @type {null | {kind:"line"|"circle", id:string}} */
    let best = null;
    let bestDPx = thresholdPx;
    for (const line of doc.lines) {
      if (line.hidden) continue;
      const curve = derive2DLineCurve(geom, doc, line);
      if (!curve) continue;
      const dPx = distanceToHyperboloidCurvePx(/** @type {any} */ (view), vp, pos, curve, true);
      if (dPx < bestDPx) {
        bestDPx = dPx;
        best = { kind: "line", id: line.id };
      }
    }
    for (const circle of doc.circles) {
      if (circle.hidden) continue;
      const curve = derive2DCircleCurve(geom, doc, circle);
      if (!curve) continue;
      const dPx = distanceToHyperboloidCurvePx(/** @type {any} */ (view), vp, pos, curve, false);
      if (dPx < bestDPx) {
        bestDPx = dPx;
        best = { kind: "circle", id: circle.id };
      }
    }
    return best;
  }
  if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) {
    const v2d = /** @type {any} */ (view);
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    /** @type {null | {kind:"line"|"circle", id:string}} */
    let best = null;
    let bestDPx = thresholdPx;
    for (const line of doc.lines) {
      if (line.hidden) continue;
      const curve = derive2DLineCurve(geom, doc, line);
      if (!curve) continue;
      const dPx = distanceToPerspectiveCurvePx(v2d, pos, curve, cssW, cssH);
      if (dPx < bestDPx) {
        bestDPx = dPx;
        best = { kind: "line", id: line.id };
      }
    }
    for (const circle of doc.circles) {
      if (circle.hidden) continue;
      const curve = derive2DCircleCurve(geom, doc, circle);
      if (!curve) continue;
      const dPx = distanceToPerspectiveCurvePx(v2d, pos, curve, cssW, cssH);
      if (dPx < bestDPx) {
        bestDPx = dPx;
        best = { kind: "circle", id: circle.id };
      }
    }
    return best;
  }
  if (geom === GeometryType.HYPERBOLIC_KLEIN) {
    const v2d = /** @type {any} */ (view);
    /** @type {null | {kind:"line"|"circle", id:string}} */
    let best = null;
    let bestDPx = thresholdPx;
    for (const line of doc.lines) {
      if (line.hidden) continue;
      const curve = derive2DLineCurve(geom, doc, line);
      if (!curve) continue;
      const dPx = distanceToKleinCurvePx(v2d, pos, curve, true);
      if (dPx < bestDPx) {
        bestDPx = dPx;
        best = { kind: "line", id: line.id };
      }
    }
    for (const circle of doc.circles) {
      if (circle.hidden) continue;
      const curve = derive2DCircleCurve(geom, doc, circle);
      if (!curve) continue;
      const dPx = distanceToKleinCurvePx(v2d, pos, curve, false);
      if (dPx < bestDPx) {
        bestDPx = dPx;
        best = { kind: "circle", id: circle.id };
      }
    }
    return best;
  }

  const v2d = /** @type {any} */ (view);
  const w = screenToModelPoint2D(geom, v2d, pos);
  if (!w) return null;
  if (!isPointInDisplayedDomain(geom, v2d, w)) return null;

  /** @type {null | {kind:"line"|"circle", id:string}} */
  let best = null;
  let bestDPx = Infinity;

  for (const line of doc.lines) {
    if (line.hidden) continue;
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
    if (circle.hidden) continue;
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
 * @param {() => void} pushHistory
 * @returns {{id:string, created:boolean} | null}
 */
function getOrCreatePointAtClick(state, geom, doc, view, pos, canvas, pushHistory) {
  const hit = hitTestPoint(state, geom, pos, canvas);
  if (hit) return { id: hit.id, created: false };

  if (geom === GeometryType.SPHERICAL) {
    const rect = canvas.getBoundingClientRect();
    const vp = sphereViewport(/** @type {any} */ (view), rect.width, rect.height);
    const p = screenToSpherePoint(/** @type {any} */ (view), pos, vp);
    if (!p) return null;
    const snapped = snapSpherePointToCurves(doc, /** @type {any} */ (view), vp, pos, p);
    pushHistory();
    const id = createSpherePoint(doc, snapped?.point ?? p, snapped ? [snapped.constraint] : undefined);
    recordPointStep(doc, id, snapped?.constraint);
    return { id, created: true };
  }
  if (geom === GeometryType.SPHERICAL_STEREOGRAPHIC) {
    const p = screenToStereographicSpherePoint(/** @type {any} */ (view), pos);
    if (!p) return null;
    const snapped = snapSpherePointToCurvesStereographic(doc, /** @type {any} */ (view), pos, p);
    pushHistory();
    const id = createSpherePoint(doc, snapped?.point ?? p, snapped ? [snapped.constraint] : undefined);
    recordPointStep(doc, id, snapped?.constraint);
    return { id, created: true };
  }
  if (geom === GeometryType.HYPERBOLIC_HYPERBOLOID) {
    const rect = canvas.getBoundingClientRect();
    const vp = hyperboloidViewport(/** @type {any} */ (view), rect.width, rect.height);
    const p = screenToHyperboloidPoincare(/** @type {any} */ (view), pos, vp);
    if (!p || !is2DPointInDomain(geom, p)) return null;
    const snapped = snapHyperboloidPointToCurves(doc, /** @type {any} */ (view), vp, pos, p);
    pushHistory();
    const id = create2DPoint(doc, snapped?.point ?? p, snapped ? [snapped.constraint] : undefined);
    recordPointStep(doc, id, snapped?.constraint);
    return { id, created: true };
  }

  const v2d = /** @type {any} */ (view);
  const w = screenToModelPoint2D(geom, v2d, pos);
  if (!w) return null;
  if (!isPointInDisplayedDomain(geom, v2d, w)) return null;
  const snapped =
    geom === GeometryType.HYPERBOLIC_KLEIN
      ? snapKleinPointToCurves(doc, v2d, pos, w)
      : snap2DPointToCurves(geom, doc, v2d, pos, w);
  pushHistory();
  const id = create2DPoint(doc, snapped?.point ?? w, snapped ? [snapped.constraint] : undefined);
  recordPointStep(doc, id, snapped?.constraint);
  return { id, created: true };
}

/**
 * @param {any} doc
 * @param {{x:number,y:number}} w
 * @param {Array<{kind:"line"|"circle", id:string}> | undefined} constraints
 * @param {Array<{id:string, mode:"line"|"angle", value:number}> | undefined} intersectionHints
 */
function create2DPoint(doc, w, constraints, intersectionHints) {
  const id = makeId("p", doc.nextId++);
  const label = nextPointLabel(doc);
  doc.points.push({
    id,
    label,
    x: w.x,
    y: w.y,
    constraints: constraints && constraints.length > 0 ? constraints : undefined,
    intersectionHints: intersectionHints && intersectionHints.length > 0 ? intersectionHints : undefined,
    style: { color: "#111111", opacity: 1 },
  });
  return id;
}

/**
 * @param {any} doc
 * @param {{x:number,y:number}} w
 * @param {Array<{kind:"line"|"circle", id:string}> | undefined} constraints
 * @param {Array<{id:string, mode:"line"|"angle", value:number}> | undefined} intersectionHints
 */
function createHidden2DPoint(doc, w, constraints, intersectionHints) {
  const id = makeId("p", doc.nextId++);
  doc.points.push({
    id,
    label: "",
    x: w.x,
    y: w.y,
    constraints: constraints && constraints.length > 0 ? constraints : undefined,
    intersectionHints: intersectionHints && intersectionHints.length > 0 ? intersectionHints : undefined,
    hidden: true,
    style: { color: "#111111", opacity: 1 },
  });
  return id;
}

/**
 * @param {any} doc
 * @param {{x:number,y:number,z:number}} p
 * @param {Array<{kind:"line"|"circle", id:string}> | undefined} constraints
 */
function createSpherePoint(doc, p, constraints) {
  const id = makeId("p", doc.nextId++);
  const label = nextPointLabel(doc);
  const u = norm3(p);
  doc.points.push({
    id,
    label,
    x: u.x,
    y: u.y,
    z: u.z,
    constraints: constraints && constraints.length > 0 ? constraints : undefined,
    style: { color: "#111111", opacity: 1 },
  });
  return id;
}

/**
 * @param {any} doc
 * @param {{x:number,y:number,z:number}} p
 * @param {Array<{kind:"line"|"circle", id:string}> | undefined} constraints
 */
function createHiddenSpherePoint(doc, p, constraints) {
  const id = makeId("p", doc.nextId++);
  const u = norm3(p);
  doc.points.push({
    id,
    label: "",
    x: u.x,
    y: u.y,
    z: u.z,
    constraints: constraints && constraints.length > 0 ? constraints : undefined,
    hidden: true,
    style: { color: "#111111", opacity: 1 },
  });
  return id;
}

/** @param {any} doc @param {string} p1 @param {string} p2 */
function createHiddenLine(doc, p1, p2) {
  const id = makeId("l", doc.nextId++);
  doc.lines.push({
    id,
    label: "",
    p1,
    p2,
    hidden: true,
    style: { color: "#0b57d0", opacity: 1 },
  });
  return id;
}

/** @param {any} doc @param {string} p1 @param {string} p2 */
function createVisibleLine(doc, p1, p2) {
  const id = makeId("l", doc.nextId++);
  const label = nextCurveLabel(doc);
  doc.lines.push({
    id,
    label,
    p1,
    p2,
    style: { color: "#0b57d0", opacity: 1 },
  });
  return id;
}

/** @param {any} doc @param {string} center @param {string} radiusPoint */
function createHiddenCircle(doc, center, radiusPoint) {
  const id = makeId("c", doc.nextId++);
  doc.circles.push({
    id,
    label: "",
    center,
    radiusPoint,
    hidden: true,
    style: { color: "#b31412", opacity: 1 },
  });
  return id;
}

/** @param {any} doc @param {string} center @param {string} radiusPoint */
function createVisibleCircle(doc, center, radiusPoint) {
  const id = makeId("c", doc.nextId++);
  const label = nextCurveLabel(doc);
  doc.circles.push({
    id,
    label,
    center,
    radiusPoint,
    style: { color: "#b31412", opacity: 1 },
  });
  return id;
}

/** @param {AppState} state @param {any} doc @param {string} pointId */
function onLineClick(state, doc, pointId, historyAlreadyPushed, pushHistory) {
  if (!state.pending || state.pending.tool !== ToolType.LINE) {
    state.pending = { tool: ToolType.LINE, firstPointId: pointId };
    return;
  }

  const first = state.pending.firstPointId;
  const second = pointId;
  state.pending = null;
  if (first === second) return;

  if (!historyAlreadyPushed) pushHistory();
  const id = makeId("l", doc.nextId++);
  const label = nextCurveLabel(doc);
  doc.lines.push({
    id,
    label,
    p1: first,
    p2: second,
    style: { color: "#0b57d0", opacity: 1 },
  });
  recordLineStep(doc, id);
}

/** @param {AppState} state @param {any} doc @param {string} pointId */
function onCircleClick(state, doc, pointId, historyAlreadyPushed, pushHistory) {
  if (!state.pending || state.pending.tool !== ToolType.CIRCLE) {
    state.pending = { tool: ToolType.CIRCLE, firstPointId: pointId };
    return;
  }

  const center = state.pending.firstPointId;
  const radiusPoint = pointId;
  state.pending = null;
  if (center === radiusPoint) return;

  if (!historyAlreadyPushed) pushHistory();
  const id = makeId("c", doc.nextId++);
  const label = nextCurveLabel(doc);
  doc.circles.push({
    id,
    label,
    center,
    radiusPoint,
    style: { color: "#b31412", opacity: 1 },
  });
  recordCircleStep(doc, id);
}

/**
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {{kind:"line"|"circle", id:string}} obj
 * @param {any} view
 * @param {HTMLCanvasElement} canvas
 * @param {() => void} pushHistory
 */
function onIntersectClick(state, geom, doc, obj, view, canvas, pushHistory) {
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

  if (isSphere(geom)) {
    const lineA = a.kind === "line" ? doc.lines.find((l) => l.id === a.id) : null;
    const circleA = a.kind === "circle" ? doc.circles.find((c) => c.id === a.id) : null;
    const lineB = b.kind === "line" ? doc.lines.find((l) => l.id === b.id) : null;
    const circleB = b.kind === "circle" ? doc.circles.find((c) => c.id === b.id) : null;
    const planeA = lineA ? deriveSphereGreatCircle(doc, lineA) : circleA ? deriveSphereCircle(doc, circleA) : null;
    const planeB = lineB ? deriveSphereGreatCircle(doc, lineB) : circleB ? deriveSphereCircle(doc, circleB) : null;
    if (!planeA || !planeB) return;
    const hits = intersectSpherePlanes(planeA, planeB);
    const newPts =
      geom === GeometryType.SPHERICAL
        ? (() => {
            const rect = canvas.getBoundingClientRect();
            const vp = sphereViewport(/** @type {any} */ (view), rect.width, rect.height);
            return filterNewSpherePoints(doc, /** @type {any} */ (view), vp, hits, 10);
          })()
        : filterNewSpherePointsStereographic(doc, /** @type {any} */ (view), hits, 10);
    if (newPts.length > 0) pushHistory();
    const constraints = [
      { kind: a.kind, id: a.id },
      { kind: b.kind, id: b.id },
    ];
    for (const p of newPts) {
      const id = createSpherePoint(doc, p, constraints);
      recordIntersectionStep(doc, id, a, b);
    }
    return;
  }

  const lineA = a.kind === "line" ? doc.lines.find((l) => l.id === a.id) : null;
  const circleA = a.kind === "circle" ? doc.circles.find((c) => c.id === a.id) : null;
  const lineB = b.kind === "line" ? doc.lines.find((l) => l.id === b.id) : null;
  const circleB = b.kind === "circle" ? doc.circles.find((c) => c.id === b.id) : null;
  const curveA = lineA ? derive2DLineCurve(geom, doc, lineA) : circleA ? derive2DCircleCurve(geom, doc, circleA) : null;
  const curveB = lineB ? derive2DLineCurve(geom, doc, lineB) : circleB ? derive2DCircleCurve(geom, doc, circleB) : null;
  if (!curveA || !curveB) return;

  const hits = intersectCurves(curveA, curveB).filter((p) => isPointInDisplayedDomain(geom, view, p));
  const newPts = filterNew2DPoints(geom, doc, /** @type {any} */ (view), hits, 10, canvas);
  if (newPts.length > 0) pushHistory();
  const constraints = [
    { kind: a.kind, id: a.id },
    { kind: b.kind, id: b.id },
  ];
  for (const p of newPts) {
    const hints = buildIntersectionHints(geom, doc, constraints, p);
    const id = create2DPoint(doc, p, constraints, hints);
    recordIntersectionStep(doc, id, a, b);
  }
}

/**
 * Handle clicks during tool-building mode.
 *
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {{x:number,y:number}} pos
 * @param {HTMLCanvasElement} canvas
 */
function handleToolBuilderClick(state, geom, pos, canvas) {
  const builder = state.toolBuilder;
  if (!builder) return;
  const hit = hitTestAny(state, geom, pos, canvas);
  if (!hit) return;
  builder.error = undefined;
  if (builder.stage === "inputs") {
    const idx = builder.inputs.findIndex((ref) => ref.kind === hit.kind && ref.id === hit.id);
    if (idx >= 0) builder.inputs.splice(idx, 1);
    else builder.inputs.push(hit);
    return;
  }
  if (builder.stage === "output") {
    builder.output = hit;
    builder.stage = "finalize";
  }
}

/**
 * Handle clicks while using a custom tool.
 *
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {any} view
 * @param {{x:number,y:number}} pos
 * @param {HTMLCanvasElement} canvas
 * @param {import("./state.js").CustomTool} tool
 * @param {() => void} pushHistory
 */
function handleCustomToolClick(state, geom, doc, view, pos, canvas, tool, pushHistory) {
  if (!state.toolUse || state.toolUse.toolId !== tool.id) {
    state.toolUse = { toolId: tool.id, inputs: [] };
  }
  state.toolUseError = null;
  const pending = state.toolUse;
  const next = tool.inputs[pending.inputs.length];
  if (!next) return;
  let hit = null;
  if (next.kind === "point") {
    const pt = hitTestPoint(state, geom, pos, canvas);
    if (pt) hit = { kind: "point", id: pt.id };
  } else {
    hit = hitTestCurve(state, geom, pos, canvas);
  }
  if (!hit || hit.kind !== next.kind) return;
  if (pending.inputs.some((ref) => ref.kind === hit.kind && ref.id === hit.id)) return;
  pending.inputs.push(hit);
  if (pending.inputs.length < tool.inputs.length) return;
  pushHistory();
  const result = applyCustomTool(state, geom, doc, tool, pending.inputs, view);
  if (result.output) recordToolStep(doc, tool.name, result.output, pending.inputs);
  if (!result.output && result.error) state.toolUseError = result.error;
  state.toolUse = null;
}

/**
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {any} view
 * @param {{x:number,y:number}[]} hits
 * @param {number} thresholdPx
 * @param {HTMLCanvasElement} canvas
 */
function filterNew2DPoints(geom, doc, view, hits, thresholdPx, canvas) {
  const rect = canvas.getBoundingClientRect();
  const hyperVp =
    geom === GeometryType.HYPERBOLIC_HYPERBOLOID ? hyperboloidViewport(/** @type {any} */ (view), rect.width, rect.height) : null;
  const project = (p) => {
    if (geom === GeometryType.HYPERBOLIC_HYPERBOLOID) {
      const s = projectPoincareOnHyperboloid(/** @type {any} */ (view), /** @type {any} */ (hyperVp), p);
      return s ? { x: s.x, y: s.y } : null;
    }
    if (geom === GeometryType.HYPERBOLIC_KLEIN) {
      const drawPoint = hyperbolicInternalToDisplay2D(geom, p);
      return worldToScreen(/** @type {any} */ (view), drawPoint);
    }
    return projectModelPointToScreen2D(geom, /** @type {any} */ (view), p);
  };

  /** @type {{x:number,y:number}[]} */
  const out = [];
  for (const p of hits) {
    const s = project(p);
    if (!s) continue;
    const isNearExisting = doc.points.some((q) => {
      if (q.hidden) return false;
      const qs = project({ x: q.x, y: q.y });
      if (!qs) return false;
      return Math.hypot(qs.x - s.x, qs.y - s.y) <= thresholdPx;
    });
    if (isNearExisting) continue;
    const isNearOut = out.some((q) => {
      const qs = project(q);
      if (!qs) return false;
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
      if (q.hidden) return false;
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
 * @param {any} doc
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number,z:number}[]} hits
 * @param {number} thresholdPx
 */
function filterNewSpherePointsStereographic(doc, view, hits, thresholdPx) {
  /** @type {{x:number,y:number,z:number}[]} */
  const out = [];
  for (const p0 of hits) {
    const p = norm3(p0);
    const s = projectSphericalPointToStereographicScreen(view, p);
    if (!s) continue;
    const isNearExisting = doc.points.some((q) => {
      if (q.hidden) return false;
      if (q.z == null) return false;
      const qs = projectSphericalPointToStereographicScreen(view, { x: q.x, y: q.y, z: q.z });
      if (!qs) return false;
      return Math.hypot(qs.x - s.x, qs.y - s.y) <= thresholdPx;
    });
    if (isNearExisting) continue;
    const isNearOut = out.some((q) => {
      const qs = projectSphericalPointToStereographicScreen(view, q);
      if (!qs) return false;
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

/**
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} pos
 * @returns {{x:number,y:number,z:number} | null}
 */
function screenToStereographicSpherePoint(view, pos) {
  const world = screenToWorld(view, pos);
  if (!world) return null;
  return stereographicToSphere(world);
}

/**
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number,z:number}} p
 * @returns {{x:number,y:number} | null}
 */
function projectSphericalPointToStereographicScreen(view, p) {
  const plane = sphereToStereographic(p);
  if (!plane) return null;
  return worldToScreen(view, plane);
}

/**
 * Apply curve constraints to a dragged 2D point.
 *
 * @param {GeometryType} geom
 * @param {{chartOffsetX?:number, chartOffsetY?:number}} view
 * @param {any} doc
 * @param {{constraints?: Array<{kind:"line"|"circle", id:string}>}} point
 * @param {{x:number,y:number}} w
 * @returns {{x:number,y:number}}
 */
function apply2DConstraints(geom, view, doc, point, w) {
  const constraints = point.constraints;
  if (!constraints || constraints.length === 0) return w;
  const allowOffscreenIntersections = geom === GeometryType.EUCLIDEAN_PERSPECTIVE && (point.hidden || point.debug);
  const inDomain = allowOffscreenIntersections
    ? (p) => isPointInOperationDomain(geom, p)
    : (p) => isPointInDisplayedDomain(geom, view, p);

  if (constraints.length >= 2) {
    const a = get2DCurveFromConstraint(geom, doc, constraints[0]);
    const b = get2DCurveFromConstraint(geom, doc, constraints[1]);
    if (a && b) {
      const hits = intersectCurves(a, b).filter(inDomain);
      if (hits.length > 0) {
        let candidates = hits;
        if (hits.length > 1) {
          const keyA = `${constraints[0].kind}:${constraints[0].id}`;
          const keyB = `${constraints[1].kind}:${constraints[1].id}`;
          const pairKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
          const siblingPoints = (doc.points ?? []).filter((other) => {
            if (other.id === point.id) return false;
            if (!other.constraints || other.constraints.length < 2) return false;
            const otherA = `${other.constraints[0].kind}:${other.constraints[0].id}`;
            const otherB = `${other.constraints[1].kind}:${other.constraints[1].id}`;
            const otherPairKey = otherA < otherB ? `${otherA}|${otherB}` : `${otherB}|${otherA}`;
            return otherPairKey === pairKey;
          });
          if (siblingPoints.length > 0) {
            const sepEps2 = 1e-10;
            const filtered = hits.filter((h) =>
              siblingPoints.every((s) => {
                const dx = h.x - s.x;
                const dy = h.y - s.y;
                return dx * dx + dy * dy > sepEps2;
              }),
            );
            if (filtered.length > 0) candidates = filtered;
            else if (hits.length > 1) {
              let best = hits[0];
              let bestDistSq = -Infinity;
              for (const h of hits) {
                let minDistSq = Infinity;
                for (const s of siblingPoints) {
                  const dx = h.x - s.x;
                  const dy = h.y - s.y;
                  const d2 = dx * dx + dy * dy;
                  if (d2 < minDistSq) minDistSq = d2;
                }
                if (minDistSq > bestDistSq) {
                  bestDistSq = minDistSq;
                  best = h;
                }
              }
              candidates = [best];
            }
          }
        }
        const hints = point.intersectionHints;
        if (hints && hints.length > 0) {
          const hintMap = new Map(hints.map((h) => [h.id, h]));
          let best = null;
          let bestScore = Infinity;
          for (const h of candidates) {
            let score = 0;
            let used = false;
            const hA = hintMap.get(constraints[0].id);
            if (hA) {
              const d = curveParamDiff(a, hA, h);
              if (d != null) {
                score += d * d;
                used = true;
              }
            }
            const hB = hintMap.get(constraints[1].id);
            if (hB) {
              const d = curveParamDiff(b, hB, h);
              if (d != null) {
                score += d * d;
                used = true;
              }
            }
            if (used && score < bestScore) {
              bestScore = score;
              best = h;
            }
          }
          if (best) return best;
        }
        let best = candidates[0];
        let bestD = Infinity;
        for (const h of candidates) {
          const dx = h.x - w.x;
          const dy = h.y - w.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = h;
          }
        }
        return best;
      }
    }
  }

  /** @type {{x:number,y:number} | null} */
  let best = null;
  let bestD = Infinity;
  for (const c of constraints) {
    if (c.kind === "line") {
      const line = doc.lines.find((l) => l.id === c.id);
      if (!line) continue;
      const curve = derive2DLineCurve(geom, doc, line);
      if (!curve) continue;
      const proj = projectWorldToCurve(curve, w);
      if (!proj || !inDomain(proj)) continue;
      const d = (proj.x - w.x) * (proj.x - w.x) + (proj.y - w.y) * (proj.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = proj;
      }
      continue;
    }
    const circle = doc.circles.find((ci) => ci.id === c.id);
    if (!circle) continue;
    const curve = derive2DCircleCurve(geom, doc, circle);
    if (!curve) continue;
    const proj = projectWorldToCurve(curve, w);
    if (!proj || !inDomain(proj)) continue;
    const d = (proj.x - w.x) * (proj.x - w.x) + (proj.y - w.y) * (proj.y - w.y);
    if (d < bestD) {
      bestD = d;
      best = proj;
    }
  }
  return best ?? w;
}

/**
 * Apply curve constraints to a dragged spherical point.
 *
 * @param {any} doc
 * @param {{constraints?: Array<{kind:"line"|"circle", id:string}>}} point
 * @param {{x:number,y:number,z:number}} p
 * @returns {{x:number,y:number,z:number}}
 */
function applySphereConstraints(doc, point, p) {
  const constraints = point.constraints;
  if (!constraints || constraints.length === 0) return p;

  if (constraints.length >= 2) {
    const a = getSpherePlaneFromConstraint(doc, constraints[0]);
    const b = getSpherePlaneFromConstraint(doc, constraints[1]);
    if (a && b) {
      const hits = intersectSpherePlanes(a, b);
      if (hits.length > 0) {
        let best = norm3(hits[0]);
        let bestDot = dot3(best, p);
        for (let i = 1; i < hits.length; i++) {
          const h = norm3(hits[i]);
          const d = dot3(h, p);
          if (d > bestDot) {
            bestDot = d;
            best = h;
          }
        }
        return best;
      }
    }
  }

  /** @type {{x:number,y:number,z:number} | null} */
  let best = null;
  let bestDot = -Infinity;
  for (const c of constraints) {
    if (c.kind === "line") {
      const line = doc.lines.find((l) => l.id === c.id);
      if (!line) continue;
      const plane = deriveSphereGreatCircle(doc, line);
      if (!plane) continue;
      const proj = closestPointOnSpherePlaneCircle(p, plane);
      const dot = dot3(p, proj);
      if (dot > bestDot) {
        bestDot = dot;
        best = proj;
      }
      continue;
    }
    const circle = doc.circles.find((ci) => ci.id === c.id);
    if (!circle) continue;
    const plane = deriveSphereCircle(doc, circle);
    if (!plane) continue;
    const proj = closestPointOnSpherePlaneCircle(p, plane);
    const dot = dot3(p, proj);
    if (dot > bestDot) {
      bestDot = dot;
      best = proj;
    }
  }
  return best ?? p;
}

/**
 * Build per-constraint intersection hints to keep identity stable when curves move.
 *
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {Array<{kind:"line"|"circle", id:string}>} constraints
 * @param {{x:number,y:number}} p
 * @returns {Array<{id:string, mode:"line"|"angle", value:number}> | undefined}
 */
function buildIntersectionHints(geom, doc, constraints, p) {
  /** @type {Array<{id:string, mode:"line"|"angle", value:number}>} */
  const out = [];
  for (const c of constraints) {
    const curve = get2DCurveFromConstraint(geom, doc, c);
    if (!curve) continue;
    if (curve.kind === "line") {
      const value = lineParamOnCurve(curve, p);
      if (!Number.isFinite(value)) continue;
      out.push({ id: c.id, mode: "line", value });
    } else {
      const value = Math.atan2(p.y - curve.cy, p.x - curve.cx);
      if (!Number.isFinite(value)) continue;
      out.push({ id: c.id, mode: "angle", value });
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {{id:string, mode:"line"|"angle", value:number}} hint
 * @param {{x:number,y:number}} p
 * @returns {number | null}
 */
function curveParamDiff(curve, hint, p) {
  if (hint.mode === "line") {
    if (curve.kind !== "line") return null;
    const t = lineParamOnCurve(curve, p);
    if (!Number.isFinite(t)) return null;
    return t - hint.value;
  }
  if (curve.kind !== "circle") return null;
  const ang = Math.atan2(p.y - curve.cy, p.x - curve.cx);
  if (!Number.isFinite(ang)) return null;
  return angleDiff(ang, hint.value);
}

/**
 * @param {{kind:"line", a:number,b:number,c:number}} line
 * @param {{x:number,y:number}} p
 */
function lineParamOnCurve(line, p) {
  const n = Math.hypot(line.a, line.b) || 1;
  let a = line.a / n;
  let b = line.b / n;
  let c = line.c / n;
  if (a < 0 || (Math.abs(a) < 1e-12 && b < 0)) {
    a = -a;
    b = -b;
    c = -c;
  }
  const ref = { x: -a * c, y: -b * c };
  const dir = { x: -b, y: a };
  return (p.x - ref.x) * dir.x + (p.y - ref.y) * dir.y;
}

/** @param {number} a @param {number} b */
function angleDiff(a, b) {
  let d = a - b;
  while (d <= -Math.PI) d += Math.PI * 2;
  while (d > Math.PI) d -= Math.PI * 2;
  return d;
}

/**
 * @param {any} doc
 * @returns {import("./state.js").HistoryStep[]}
 */
function ensureHistorySteps(doc) {
  if (!doc.historySteps) doc.historySteps = [];
  return doc.historySteps;
}

/**
 * @param {any} doc
 * @param {string} pointId
 * @param {{kind:"line"|"circle", id:string} | undefined} on
 */
function recordPointStep(doc, pointId, on) {
  const steps = ensureHistorySteps(doc);
  if (on) {
    steps.push({ type: "point", pointId, on: { kind: on.kind, id: on.id } });
  } else {
    steps.push({ type: "point", pointId });
  }
}

/**
 * @param {any} doc
 * @param {string} lineId
 */
function recordLineStep(doc, lineId) {
  const steps = ensureHistorySteps(doc);
  steps.push({ type: "line", lineId });
}

/**
 * @param {any} doc
 * @param {string} circleId
 */
function recordCircleStep(doc, circleId) {
  const steps = ensureHistorySteps(doc);
  steps.push({ type: "circle", circleId });
}

/**
 * @param {any} doc
 * @param {string} pointId
 * @param {{kind:"line"|"circle", id:string}} a
 * @param {{kind:"line"|"circle", id:string}} b
 */
function recordIntersectionStep(doc, pointId, a, b) {
  const steps = ensureHistorySteps(doc);
  steps.push({ type: "intersection", pointId, a: { kind: a.kind, id: a.id }, b: { kind: b.kind, id: b.id } });
}

/**
 * @param {any} doc
 * @param {string} toolName
 * @param {{kind:"point"|"line"|"circle", id:string}} output
 * @param {Array<{kind:"point"|"line"|"circle", id:string}>} inputs
 */
function recordToolStep(doc, toolName, output, inputs) {
  const steps = ensureHistorySteps(doc);
  steps.push({ type: "tool", toolName, output, inputs });
}

/** @param {AppState} state */
function getActiveCustomTool(state) {
  if (!state.activeTool || !state.activeTool.startsWith("custom:")) return null;
  const id = state.activeTool.replace("custom:", "");
  return state.customTools.find((tool) => tool.id === id) ?? null;
}

/**
 * Apply a custom tool to selected inputs.
 *
 * @param {AppState} state
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {import("./state.js").CustomTool} tool
 * @param {Array<{kind:"point"|"line"|"circle", id:string}>} inputs
 * @param {any} view
 * @returns {{output: {kind:"point"|"line"|"circle", id:string} | null, error: string | null}}
 */
function applyCustomTool(state, geom, doc, tool, inputs, view) {
  /** @type {Map<string, {kind:"point"|"line"|"circle", id:string}>} */
  const nodeMap = new Map();
  /** @type {{points:string[], lines:string[], circles:string[]}} */
  const created = { points: [], lines: [], circles: [] };
  /** @type {Map<string, Array<{x:number,y:number}>>} */
  const intersectionReuse = new Map();
  /** @type {Map<string, Array<{x:number,y:number,z:number}>>} */
  const sphereIntersectionReuse = new Map();
  const debugColor = "#2e7d32";
  let debugIndex = 1;
  let errorMessage = null;
  const showSteps = !!state.showSteps;

  const cleanup = () => {
    doc.points = doc.points.filter((p) => !created.points.includes(p.id));
    doc.lines = doc.lines.filter((l) => !created.lines.includes(l.id));
    doc.circles = doc.circles.filter((c) => !created.circles.includes(c.id));
  };

  const addPoint = (id, hidden) => {
    if (hidden) created.points.push(id);
  };
  const addLine = (id, hidden) => {
    if (hidden) created.lines.push(id);
  };
  const addCircle = (id, hidden) => {
    if (hidden) created.circles.push(id);
  };
  const nextDebugLabel = () => String(debugIndex++);
  const createDebug2DPoint = (w, constraints, intersectionHints) => {
    const id = makeId("p", doc.nextId++);
    doc.points.push({
      id,
      label: nextDebugLabel(),
      x: w.x,
      y: w.y,
      constraints: constraints && constraints.length > 0 ? constraints : undefined,
      intersectionHints: intersectionHints && intersectionHints.length > 0 ? intersectionHints : undefined,
      hidden: !showSteps,
      debug: true,
      style: { color: debugColor, opacity: 1 },
    });
    return id;
  };
  const createDebugSpherePoint = (p, constraints) => {
    const id = makeId("p", doc.nextId++);
    const u = norm3(p);
    doc.points.push({
      id,
      label: nextDebugLabel(),
      x: u.x,
      y: u.y,
      z: u.z,
      constraints: constraints && constraints.length > 0 ? constraints : undefined,
      hidden: !showSteps,
      debug: true,
      style: { color: debugColor, opacity: 1 },
    });
    return id;
  };
  const createDebugLine = (p1, p2) => {
    const id = makeId("l", doc.nextId++);
    doc.lines.push({
      id,
      label: nextDebugLabel(),
      p1,
      p2,
      hidden: !showSteps,
      debug: true,
      style: { color: debugColor, opacity: 1 },
    });
    return id;
  };
  const createDebugCircle = (center, radiusPoint) => {
    const id = makeId("c", doc.nextId++);
    doc.circles.push({
      id,
      label: nextDebugLabel(),
      center,
      radiusPoint,
      hidden: !showSteps,
      debug: true,
      style: { color: debugColor, opacity: 1 },
    });
    return id;
  };

  try {
    for (const step of tool.steps) {
      if (step.op === "input") {
        const ref = inputs[step.inputIndex];
        if (!ref || ref.kind !== step.kind) throw new Error("Input mismatch.");
        nodeMap.set(step.id, ref);
        continue;
      }

      if (step.kind === "line" && step.op === "line") {
        const p1 = nodeMap.get(step.p1);
        const p2 = nodeMap.get(step.p2);
        if (!p1 || !p2 || p1.kind !== "point" || p2.kind !== "point") throw new Error("Line inputs missing.");
        const isOutput = tool.output.kind === "line" && tool.output.nodeId === step.id;
        const id = isOutput ? createVisibleLine(doc, p1.id, p2.id) : createDebugLine(p1.id, p2.id);
        addLine(id, !isOutput);
        nodeMap.set(step.id, { kind: "line", id });
        continue;
      }

      if (step.kind === "circle" && step.op === "circle_fixed") {
        if (isSphere(geom)) throw new Error("Fixed-radius circles not supported on sphere.");
        const c = nodeMap.get(step.center);
        if (!c || c.kind !== "point") throw new Error("Circle center missing.");
        const centerPoint = doc.points.find((p) => p.id === c.id);
        if (!centerPoint) throw new Error("Circle center missing.");
        const angle = Number.isFinite(step.angle) ? step.angle : 0;
        const radius = step.radius;
        if (!Number.isFinite(radius) || radius <= 1e-9) throw new Error("Invalid circle radius.");
        const radiusPos = {
          x: centerPoint.x + radius * Math.cos(angle),
          y: centerPoint.y + radius * Math.sin(angle),
        };
        const radiusPointId = createHidden2DPoint(doc, radiusPos, undefined, undefined);
        addPoint(radiusPointId, true);
        const isOutput = tool.output.kind === "circle" && tool.output.nodeId === step.id;
        const id = isOutput ? createVisibleCircle(doc, c.id, radiusPointId) : createDebugCircle(c.id, radiusPointId);
        addCircle(id, !isOutput);
        nodeMap.set(step.id, { kind: "circle", id });
        continue;
      }

      if (step.kind === "circle" && step.op === "circle") {
        const c = nodeMap.get(step.center);
        const r = nodeMap.get(step.radius);
        if (!c || !r || c.kind !== "point" || r.kind !== "point") throw new Error("Circle inputs missing.");
        const isOutput = tool.output.kind === "circle" && tool.output.nodeId === step.id;
        const id = isOutput ? createVisibleCircle(doc, c.id, r.id) : createDebugCircle(c.id, r.id);
        addCircle(id, !isOutput);
        nodeMap.set(step.id, { kind: "circle", id });
        continue;
      }

      if (step.kind === "point" && step.op === "point_fixed") {
        const isOutput = tool.output.kind === "point" && tool.output.nodeId === step.id;
        if (isSphere(geom)) {
          if (typeof step.z !== "number") throw new Error("Invalid spherical point.");
          const id = isOutput
            ? createSpherePoint(doc, { x: step.x, y: step.y, z: step.z }, undefined)
            : createDebugSpherePoint({ x: step.x, y: step.y, z: step.z }, undefined);
          addPoint(id, !isOutput);
          nodeMap.set(step.id, { kind: "point", id });
        } else {
          const id = isOutput
            ? create2DPoint(doc, { x: step.x, y: step.y }, undefined, undefined)
            : createDebug2DPoint({ x: step.x, y: step.y }, undefined, undefined);
          addPoint(id, !isOutput);
          nodeMap.set(step.id, { kind: "point", id });
        }
        continue;
      }

      if (step.kind === "point" && step.op === "intersection") {
        const a = nodeMap.get(step.a);
        const b = nodeMap.get(step.b);
        if (!a || !b) throw new Error("Intersection inputs missing.");
        const constraints = [
          { kind: a.kind, id: a.id },
          { kind: b.kind, id: b.id },
        ];

        if (isSphere(geom)) {
          const planeA = getSpherePlaneFromConstraint(doc, constraints[0]);
          const planeB = getSpherePlaneFromConstraint(doc, constraints[1]);
          if (!planeA || !planeB) throw new Error("Invalid spherical constraints.");
          const key = step.a < step.b ? `${step.a}|${step.b}` : `${step.b}|${step.a}`;
          const avoid = sphereIntersectionReuse.get(key) ?? null;
          const hit = pickSphereIntersection(planeA, planeB, step.sphereHint, avoid);
          if (!hit) throw new Error("No intersection.");
          if (avoid) avoid.push(hit);
          else sphereIntersectionReuse.set(key, [hit]);
          const isOutput = tool.output.kind === "point" && tool.output.nodeId === step.id;
          const id = isOutput ? createSpherePoint(doc, hit, constraints) : createDebugSpherePoint(hit, constraints);
          addPoint(id, !isOutput);
          nodeMap.set(step.id, { kind: "point", id });
          continue;
        }

        const curveA = get2DCurveFromConstraint(geom, doc, constraints[0]);
        const curveB = get2DCurveFromConstraint(geom, doc, constraints[1]);
        if (!curveA || !curveB) throw new Error("Invalid constraints.");
        const hintA = step.curveHints?.find((h) => h.nodeId === step.a) ?? null;
        const hintB = step.curveHints?.find((h) => h.nodeId === step.b) ?? null;
        const lineRef = buildLineRefForStep(step, nodeMap, doc, geom);
        const lineSide = buildLineSideForStep(step, nodeMap, doc, geom);
        const circleSide = buildCircleSideForStep(step, nodeMap, doc, geom);
        const orientRef = buildOrientRefForStep(step, nodeMap, doc);
        const pairRef = buildPairRefForStep(step, nodeMap, doc);
        let preHits = null;
        if (geom === GeometryType.EUCLIDEAN) {
          const lineCurve = curveA.kind === "line" ? curveA : curveB.kind === "line" ? curveB : null;
          const circleConstraint = constraints.find((c) => c.kind === "circle");
          if (lineCurve && circleConstraint) {
            const circleObj = doc.circles.find((c) => c.id === circleConstraint.id);
            if (circleObj) {
              const centerPoint = doc.points.find((p) => p.id === circleObj.center);
              const radiusPoint = doc.points.find((p) => p.id === circleObj.radiusPoint);
              if (centerPoint && radiusPoint) {
                const distToLine = Math.abs(signedDistanceToCurve(lineCurve, radiusPoint));
                if (distToLine <= 1e-6) {
                  const distSigned = lineCurve.a * centerPoint.x + lineCurve.b * centerPoint.y + lineCurve.c;
                  const x0 = centerPoint.x - lineCurve.a * distSigned;
                  const y0 = centerPoint.y - lineCurve.b * distSigned;
                  const other = { x: 2 * x0 - radiusPoint.x, y: 2 * y0 - radiusPoint.y };
                  const dx = other.x - radiusPoint.x;
                  const dy = other.y - radiusPoint.y;
                  if (dx * dx + dy * dy > 1e-12) {
                    preHits = [
                      { x: radiusPoint.x, y: radiusPoint.y },
                      { x: other.x, y: other.y },
                    ];
                  }
                }
              }
            }
          }
        }
        const key = step.a < step.b ? `${step.a}|${step.b}` : `${step.b}|${step.a}`;
        const avoidReuse = intersectionReuse.get(key) ?? null;
        const avoidPoint = buildAvoidPointForStep(step, nodeMap, doc);
        const avoid =
          avoidPoint && avoidReuse ? [avoidPoint, ...avoidReuse] : avoidPoint ? [avoidPoint] : avoidReuse ?? null;
        const hit = pick2DIntersection(
          geom,
          curveA,
          curveB,
          hintA,
          hintB,
          lineRef,
          lineSide,
          circleSide,
          orientRef,
          pairRef,
          avoid,
          preHits,
        );
        if (!hit) throw new Error("No intersection.");
        if (avoidReuse) avoidReuse.push(hit);
        else intersectionReuse.set(key, [hit]);
        const intersectionHints = buildIntersectionHintsForStep(step, constraints);
        const isOutput = tool.output.kind === "point" && tool.output.nodeId === step.id;
        const id = isOutput
          ? create2DPoint(doc, hit, constraints, intersectionHints)
          : createDebug2DPoint(hit, constraints, intersectionHints);
        addPoint(id, !isOutput);
        nodeMap.set(step.id, { kind: "point", id });
        continue;
      }

      if (step.kind === "point" && step.op === "point_on") {
        const c = nodeMap.get(step.curve);
        if (!c) throw new Error("Point-on input missing.");
        const constraint = { kind: c.kind, id: c.id };
        if (isSphere(geom)) {
          const plane = getSpherePlaneFromConstraint(doc, constraint);
          if (!plane) throw new Error("Invalid spherical curve.");
          const hit = step.sphereHint ? closestPointOnSpherePlaneCircle(step.sphereHint, plane) : defaultPointOnSpherePlane(plane);
          const isOutput = tool.output.kind === "point" && tool.output.nodeId === step.id;
          const id = isOutput ? createSpherePoint(doc, hit, [constraint]) : createDebugSpherePoint(hit, [constraint]);
          addPoint(id, !isOutput);
          nodeMap.set(step.id, { kind: "point", id });
          continue;
        }

        const curve = get2DCurveFromConstraint(geom, doc, constraint);
        if (!curve) throw new Error("Invalid curve.");
        let hint = step.curveHint;
        if (curve.kind === "line" && step.lineOffsetRef) {
          const lineOffset = buildLineOffsetForStep(step, nodeMap, doc);
          if (lineOffset) {
            const tCenter = lineParamOnCurve(curve, lineOffset.origin);
            if (Number.isFinite(tCenter)) {
              hint = { mode: "line", value: tCenter + lineOffset.offset };
            }
          }
        }
        const hit = pointOnCurve2D(curve, hint);
        const isOutput = tool.output.kind === "point" && tool.output.nodeId === step.id;
        const id = isOutput ? create2DPoint(doc, hit, [constraint]) : createDebug2DPoint(hit, [constraint]);
        addPoint(id, !isOutput);
        nodeMap.set(step.id, { kind: "point", id });
        continue;
      }
    }

    const outputRef = nodeMap.get(tool.output.nodeId);
    if (!outputRef) throw new Error("Output missing.");
    return { output: outputRef, error: null };
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Unable to apply tool.";
    // Keep debug geometry for inspection; user can undo to clear.
    // cleanup();
    return { output: null, error: errorMessage };
  }
}

/**
 * @param {GeometryType} geom
 * @param {import("./geom2d.js").Curve2D} curveA
 * @param {import("./geom2d.js").Curve2D} curveB
 * @param {{mode:"line"|"angle", value:number} | null} hintA
 * @param {{mode:"line"|"angle", value:number} | null} hintB
 * @param {{lineCurve:{kind:"line", a:number,b:number,c:number}, refPoint:{x:number,y:number}, value:number} | null} lineRef
 * @param {{lineCurve:{kind:"line", a:number,b:number,c:number}, sign:number} | null} lineSide
 * @param {{centerA:{x:number,y:number}, centerB:{x:number,y:number}, sign:number} | null} circleSide
 * @param {{origin:{x:number,y:number}, direction:{x:number,y:number}, sign:number} | null} orientRef
 * @param {{origin:{x:number,y:number}, other:{x:number,y:number}, angle:number} | null} pairRef
 * @param {Array<{x:number,y:number}> | null} avoidPoints
 * @param {Array<{x:number,y:number}> | null} preHits
 * @returns {{x:number,y:number} | null}
 */
function pick2DIntersection(
  geom,
  curveA,
  curveB,
  hintA,
  hintB,
  lineRef,
  lineSide,
  circleSide,
  orientRef,
  pairRef,
  avoidPoints,
  preHits,
) {
  const rawHits = preHits ?? intersectCurves(curveA, curveB);
  const hits = rawHits.filter((p) => isPointInOperationDomain(geom, p));
  if (hits.length === 0) return null;
  let candidates = hits;
  if (avoidPoints && avoidPoints.length > 0) {
    const sepEps2 = 1e-10;
    const filtered = hits.filter((h) =>
      avoidPoints.every((p) => {
        const dx = h.x - p.x;
        const dy = h.y - p.y;
        return dx * dx + dy * dy > sepEps2;
      }),
    );
    if (filtered.length > 0) candidates = filtered;
    else if (hits.length > 1) {
      let best = hits[0];
      let bestDistSq = -Infinity;
      for (const h of hits) {
        let minDistSq = Infinity;
        for (const p of avoidPoints) {
          const dx = h.x - p.x;
          const dy = h.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < minDistSq) minDistSq = d2;
        }
        if (minDistSq > bestDistSq) {
          bestDistSq = minDistSq;
          best = h;
        }
      }
      candidates = [best];
    }
  }
  if (lineSide) {
    const filtered = candidates.filter((h) => {
      const value = lineSide.lineCurve.a * h.x + lineSide.lineCurve.b * h.y + lineSide.lineCurve.c;
      const sign = Math.sign(value);
      return sign !== 0 && sign === lineSide.sign;
    });
    if (filtered.length === 1) return filtered[0];
    if (filtered.length > 1) candidates = filtered;
  }
  if (circleSide) {
    const filtered = candidates.filter((h) => {
      const cross =
        (circleSide.centerB.x - circleSide.centerA.x) * (h.y - circleSide.centerA.y) -
        (circleSide.centerB.y - circleSide.centerA.y) * (h.x - circleSide.centerA.x);
      const sign = Math.sign(cross);
      return sign !== 0 && sign === circleSide.sign;
    });
    if (filtered.length === 1) return filtered[0];
    if (filtered.length > 1) candidates = filtered;
  }
  if (orientRef) {
    const filtered = candidates.filter((h) => {
      const vDir = { x: orientRef.direction.x - orientRef.origin.x, y: orientRef.direction.y - orientRef.origin.y };
      const vPt = { x: h.x - orientRef.origin.x, y: h.y - orientRef.origin.y };
      const cross = vDir.x * vPt.y - vDir.y * vPt.x;
      const sign = Math.sign(cross);
      return sign !== 0 && sign === orientRef.sign;
    });
    if (filtered.length === 1) return filtered[0];
    if (filtered.length > 1) candidates = filtered;
  }
  if (!hintA && !hintB && !lineRef && !pairRef) return candidates[0];
  let best = candidates[0];
  let bestScore = Infinity;
  const pairOrigin = pairRef ? pairRef.origin : null;
  const pairOther = pairRef ? pairRef.other : null;
  const pairAngle = pairRef ? pairRef.angle : 0;
  const pairVec =
    pairOrigin && pairOther
      ? { x: pairOther.x - pairOrigin.x, y: pairOther.y - pairOrigin.y }
      : null;
  for (const h of candidates) {
    let score = 0;
    let used = false;
    if (hintA) {
      const d = curveParamDiff(curveA, hintA, h);
      if (d != null) {
        score += d * d;
        used = true;
      }
    }
    if (hintB) {
      const d = curveParamDiff(curveB, hintB, h);
      if (d != null) {
        score += d * d;
        used = true;
      }
    }
    if (lineRef) {
      const t = lineParamOnCurve(lineRef.lineCurve, h);
      const tRef = lineParamOnCurve(lineRef.lineCurve, lineRef.refPoint);
      if (Number.isFinite(t) && Number.isFinite(tRef)) {
        const d = (t - tRef) - lineRef.value;
        score += d * d;
        used = true;
      }
    }
    if (pairRef && pairOrigin && pairVec) {
      const vPt = { x: h.x - pairOrigin.x, y: h.y - pairOrigin.y };
      const cross = pairVec.x * vPt.y - pairVec.y * vPt.x;
      const dot = pairVec.x * vPt.x + pairVec.y * vPt.y;
      if (Number.isFinite(cross) && Number.isFinite(dot)) {
        const ang = Math.atan2(cross, dot);
        const d = angleDiff(ang, pairAngle);
        score += d * d;
        used = true;
      }
    }
    if (used && score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

/**
 * @param {{normal:{x:number,y:number,z:number}, d:number}} planeA
 * @param {{normal:{x:number,y:number,z:number}, d:number}} planeB
 * @param {{x:number,y:number,z:number} | undefined} hint
 * @param {Array<{x:number,y:number,z:number}> | null} avoidPoints
 * @returns {{x:number,y:number,z:number} | null}
 */
function pickSphereIntersection(planeA, planeB, hint, avoidPoints) {
  const hits = intersectSpherePlanes(planeA, planeB);
  if (!hits || hits.length === 0) return null;
  let candidates = hits.map((h) => norm3(h));
  if (avoidPoints && avoidPoints.length > 0) {
    const filtered = candidates.filter((h) => avoidPoints.every((a) => dot3(h, a) < 1 - 1e-8));
    if (filtered.length > 0) candidates = filtered;
  }
  if (!hint) return candidates[0];
  let best = candidates[0];
  let bestDot = dot3(best, hint);
  for (let i = 1; i < candidates.length; i++) {
    const u = candidates[i];
    const d = dot3(u, hint);
    if (d > bestDot) {
      bestDot = d;
      best = u;
    }
  }
  return best;
}

/**
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {{mode:"line"|"angle", value:number} | undefined} hint
 * @returns {{x:number,y:number}}
 */
function pointOnCurve2D(curve, hint) {
  if (curve.kind === "line") {
    const n = Math.hypot(curve.a, curve.b) || 1;
    const a = curve.a / n;
    const b = curve.b / n;
    const c = curve.c / n;
    const ref = { x: -a * c, y: -b * c };
    const dir = { x: -b, y: a };
    const t = hint && hint.mode === "line" ? hint.value : 0;
    return { x: ref.x + dir.x * t, y: ref.y + dir.y * t };
  }
  const ang = hint && hint.mode === "angle" ? hint.value : 0;
  return { x: curve.cx + curve.r * Math.cos(ang), y: curve.cy + curve.r * Math.sin(ang) };
}

/**
 * @param {{normal:{x:number,y:number,z:number}, d:number}} plane
 * @returns {{x:number,y:number,z:number}}
 */
function defaultPointOnSpherePlane(plane) {
  return closestPointOnSpherePlaneCircle({ x: 1, y: 0, z: 0 }, plane);
}

/**
 * @param {{curveHints?: Array<{ nodeId: string, mode: "line" | "angle", value: number }>}} step
 * @param {Array<{kind:"line"|"circle", id:string}>} constraints
 */
function buildIntersectionHintsForStep(step, constraints) {
  if (!step.curveHints || step.curveHints.length === 0) return undefined;
  const out = [];
  for (const h of step.curveHints) {
    const idx = h.nodeId === step.a ? 0 : h.nodeId === step.b ? 1 : -1;
    if (idx === -1) continue;
    const ref = constraints[idx];
    out.push({ id: ref.id, mode: h.mode, value: h.value });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Build line-relative hint for selecting circle-line intersections.
 *
 * @param {{lineRef?: { lineNodeId: string, refPointNodeId: string, value: number }}} step
 * @param {Map<string, {kind:"point"|"line"|"circle", id:string}>} nodeMap
 * @param {any} doc
 * @param {GeometryType} geom
 * @returns {{lineCurve:{kind:"line", a:number,b:number,c:number}, refPoint:{x:number,y:number}, value:number} | null}
 */
function buildLineRefForStep(step, nodeMap, doc, geom) {
  if (!step.lineRef) return null;
  const lineNode = nodeMap.get(step.lineRef.lineNodeId);
  const refNode = nodeMap.get(step.lineRef.refPointNodeId);
  if (!lineNode || lineNode.kind !== "line") return null;
  if (!refNode || refNode.kind !== "point") return null;
  const line = doc.lines.find((l) => l.id === lineNode.id);
  if (!line) return null;
  const curve = derive2DLineCurve(geom, doc, line);
  if (!curve || curve.kind !== "line") return null;
  const refPoint = doc.points.find((p) => p.id === refNode.id);
  if (!refPoint) return null;
  return {
    lineCurve: curve,
    refPoint: { x: refPoint.x, y: refPoint.y },
    value: step.lineRef.value,
  };
}

/**
 * Build line-side hint for selecting circle-line intersections relative to the other input line.
 *
 * @param {{lineSide?: { lineNodeId: string, sign: number }}} step
 * @param {Map<string, {kind:"point"|"line"|"circle", id:string}>} nodeMap
 * @param {any} doc
 * @param {GeometryType} geom
 * @returns {{lineCurve:{kind:"line", a:number,b:number,c:number}, sign:number} | null}
 */
function buildLineSideForStep(step, nodeMap, doc, geom) {
  if (!step.lineSide) return null;
  const lineNode = nodeMap.get(step.lineSide.lineNodeId);
  if (!lineNode || lineNode.kind !== "line") return null;
  const line = doc.lines.find((l) => l.id === lineNode.id);
  if (!line) return null;
  const curve = derive2DLineCurve(geom, doc, line);
  if (!curve || curve.kind !== "line") return null;
  const n = Math.hypot(curve.a, curve.b) || 1;
  let a = curve.a / n;
  let b = curve.b / n;
  let c = curve.c / n;
  if (a < 0 || (Math.abs(a) < 1e-12 && b < 0)) {
    a = -a;
    b = -b;
    c = -c;
  }
  return { lineCurve: { kind: "line", a, b, c }, sign: step.lineSide.sign };
}

/**
 * Build circle side hint for choosing between circle-circle intersections.
 *
 * @param {{circleSide?: { sign: number }, a: string, b: string}} step
 * @param {Map<string, {kind:"point"|"line"|"circle", id:string}>} nodeMap
 * @param {any} doc
 * @param {GeometryType} geom
 * @returns {{centerA:{x:number,y:number}, centerB:{x:number,y:number}, sign:number} | null}
 */
function buildCircleSideForStep(step, nodeMap, doc, geom) {
  if (isSphere(geom)) return null;
  if (!step.circleSide) return null;
  const aNode = nodeMap.get(step.a);
  const bNode = nodeMap.get(step.b);
  if (!aNode || !bNode) return null;
  if (aNode.kind !== "circle" || bNode.kind !== "circle") return null;
  const circleA = doc.circles.find((c) => c.id === aNode.id);
  const circleB = doc.circles.find((c) => c.id === bNode.id);
  if (!circleA || !circleB) return null;
  const cA = doc.points.find((p) => p.id === circleA.center);
  const cB = doc.points.find((p) => p.id === circleB.center);
  if (!cA || !cB) return null;
  return {
    centerA: { x: cA.x, y: cA.y },
    centerB: { x: cB.x, y: cB.y },
    sign: step.circleSide.sign,
  };
}

/**
 * Build orientation hint for selecting circle-circle intersections using a shared origin.
 *
 * @param {{orientRef?: { originNodeId: string, directionNodeId: string, sign: number }}} step
 * @param {Map<string, {kind:"point"|"line"|"circle", id:string}>} nodeMap
 * @param {any} doc
 * @returns {{origin:{x:number,y:number}, direction:{x:number,y:number}, sign:number} | null}
 */
function buildOrientRefForStep(step, nodeMap, doc) {
  if (!step.orientRef) return null;
  const originNode = nodeMap.get(step.orientRef.originNodeId);
  const dirNode = nodeMap.get(step.orientRef.directionNodeId);
  if (!originNode || originNode.kind !== "point") return null;
  if (!dirNode || dirNode.kind !== "point") return null;
  const originPoint = doc.points.find((p) => p.id === originNode.id);
  const dirPoint = doc.points.find((p) => p.id === dirNode.id);
  if (!originPoint || !dirPoint) return null;
  return {
    origin: { x: originPoint.x, y: originPoint.y },
    direction: { x: dirPoint.x, y: dirPoint.y },
    sign: step.orientRef.sign,
  };
}

/**
 * Build pair hint for selecting circle-line intersections relative to a prior point on the same circle.
 *
 * @param {{pairRef?: { originNodeId: string, otherPointNodeId: string, angle: number }}} step
 * @param {Map<string, {kind:"point"|"line"|"circle", id:string}>} nodeMap
 * @param {any} doc
 * @returns {{origin:{x:number,y:number}, other:{x:number,y:number}, angle:number} | null}
 */
function buildPairRefForStep(step, nodeMap, doc) {
  if (!step.pairRef) return null;
  const originNode = nodeMap.get(step.pairRef.originNodeId);
  const otherNode = nodeMap.get(step.pairRef.otherPointNodeId);
  if (!originNode || originNode.kind !== "point") return null;
  if (!otherNode || otherNode.kind !== "point") return null;
  const originPoint = doc.points.find((p) => p.id === originNode.id);
  const otherPoint = doc.points.find((p) => p.id === otherNode.id);
  if (!originPoint || !otherPoint) return null;
  return {
    origin: { x: originPoint.x, y: originPoint.y },
    other: { x: otherPoint.x, y: otherPoint.y },
    angle: step.pairRef.angle,
  };
}

/**
 * Build line-offset hint for point-on-line steps relative to an origin point.
 *
 * @param {{lineOffsetRef?: { originNodeId: string, offset: number }}} step
 * @param {Map<string, {kind:"point"|"line"|"circle", id:string}>} nodeMap
 * @param {any} doc
 * @returns {{origin:{x:number,y:number}, offset:number} | null}
 */
function buildLineOffsetForStep(step, nodeMap, doc) {
  if (!step.lineOffsetRef) return null;
  const originNode = nodeMap.get(step.lineOffsetRef.originNodeId);
  if (!originNode || originNode.kind !== "point") return null;
  const originPoint = doc.points.find((p) => p.id === originNode.id);
  if (!originPoint) return null;
  return { origin: { x: originPoint.x, y: originPoint.y }, offset: step.lineOffsetRef.offset };
}

/**
 * Build avoid-point hint for selecting the "other" intersection.
 *
 * @param {{avoidPointRef?: { pointNodeId: string }}} step
 * @param {Map<string, {kind:"point"|"line"|"circle", id:string}>} nodeMap
 * @param {any} doc
 * @returns {{x:number,y:number} | null}
 */
function buildAvoidPointForStep(step, nodeMap, doc) {
  if (!step.avoidPointRef) return null;
  const pointNode = nodeMap.get(step.avoidPointRef.pointNodeId);
  if (!pointNode || pointNode.kind !== "point") return null;
  const p = doc.points.find((pt) => pt.id === pointNode.id);
  if (!p) return null;
  return { x: p.x, y: p.y };
}

/**
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {{kind:"line"|"circle", id:string}} constraint
 * @returns {import("./geom2d.js").Curve2D | null}
 */
function get2DCurveFromConstraint(geom, doc, constraint) {
  if (constraint.kind === "line") {
    const line = doc.lines.find((l) => l.id === constraint.id);
    return line ? derive2DLineCurve(geom, doc, line) : null;
  }
  const circle = doc.circles.find((c) => c.id === constraint.id);
  return circle ? derive2DCircleCurve(geom, doc, circle) : null;
}

/**
 * @param {any} doc
 * @param {{kind:"line"|"circle", id:string}} constraint
 * @returns {{normal:{x:number,y:number,z:number}, d:number} | null}
 */
function getSpherePlaneFromConstraint(doc, constraint) {
  if (constraint.kind === "line") {
    const line = doc.lines.find((l) => l.id === constraint.id);
    return line ? deriveSphereGreatCircle(doc, line) : null;
  }
  const circle = doc.circles.find((c) => c.id === constraint.id);
  return circle ? deriveSphereCircle(doc, circle) : null;
}

/**
 * Re-project all constrained 2D points onto their curves (keeps constraints consistent
 * when other defining points move).
 *
 * @param {GeometryType} geom
 * @param {{chartOffsetX?:number, chartOffsetY?:number}} view
 * @param {any} doc
 */
function enforce2DConstraints(geom, view, doc) {
  for (const pt of doc.points) {
    if (pt.locked || !pt.constraints || pt.constraints.length === 0) continue;
    const snapped = apply2DConstraints(geom, view, doc, pt, { x: pt.x, y: pt.y });
    pt.x = snapped.x;
    pt.y = snapped.y;
  }
}

/**
 * Re-project all constrained spherical points onto their curves.
 *
 * @param {any} doc
 */
function enforceSphereConstraints(doc) {
  for (const pt of doc.points) {
    if (pt.locked || !pt.constraints || pt.constraints.length === 0) continue;
    if (pt.z == null) continue;
    const snapped = applySphereConstraints(doc, pt, { x: pt.x, y: pt.y, z: pt.z });
    pt.x = snapped.x;
    pt.y = snapped.y;
    pt.z = snapped.z;
  }
}

/**
 * Convert screen-space click to internal 2D model coordinates.
 *
 * @param {GeometryType} geom
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} pos
 * @returns {{x:number,y:number} | null}
 */
function screenToModelPoint2D(geom, view, pos) {
  const raw = screenToWorld(view, pos);
  if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) {
    const worldShown = perspectiveDisplayToWorld(raw);
    if (!worldShown) return null;
    return removeOriginShift(geom, view, worldShown);
  }
  if (geom === GeometryType.HYPERBOLIC_KLEIN) {
    const shown = hyperbolicDisplay2DToInternal(geom, raw);
    if (!shown) return null;
    return removeOriginShift(geom, view, shown);
  }
  if (geom === GeometryType.HYPERBOLIC_POINCARE || geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    return removeOriginShift(geom, view, raw);
  }
  return raw;
}

/**
 * Convert internal 2D model point to screen-space for distance checks.
 *
 * @param {GeometryType} geom
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} p
 * @returns {{x:number,y:number} | null}
 */
function projectModelPointToScreen2D(geom, view, p) {
  if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) {
    const shifted = applyOriginShift(geom, view, p);
    const display = perspectiveWorldToDisplay(shifted);
    if (!display) return null;
    return worldToScreen(view, display);
  }
  if (geom === GeometryType.HYPERBOLIC_KLEIN) {
    const shifted = applyOriginShift(geom, view, p);
    const display = hyperbolicInternalToDisplay2D(geom, shifted);
    return worldToScreen(view, display);
  }
  if (geom === GeometryType.HYPERBOLIC_POINCARE || geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    return worldToScreen(view, applyOriginShift(geom, view, p));
  }
  return worldToScreen(view, p);
}

/**
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} posScreen
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {boolean} geodesic
 */
function distanceToKleinCurvePx(view, posScreen, curve, geodesic) {
  if (geodesic) {
    const seg = kleinGeodesicSegmentFromCurve(curve, view);
    if (seg) {
      const a = worldToScreen(view, seg.a);
      const b = worldToScreen(view, seg.b);
      return distancePointToSegment(posScreen, a, b);
    }
  }
  const internalPts =
    geodesic || curve.kind === "line" ? samplePoincareGeodesicPoints(curve, 150) : samplePoincareCirclePoints(curve, 230);
  if (internalPts.length < 2) return Infinity;
  const screenPts = internalPts.map((p) => {
    const shifted = applyOriginShift(GeometryType.HYPERBOLIC_KLEIN, view, p);
    const d = hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, shifted);
    return worldToScreen(view, d);
  });
  return distanceToScreenPolyline(posScreen, screenPts);
}

/**
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number, chartOffsetX?:number, chartOffsetY?:number}} view
 * @returns {{a:{x:number,y:number}, b:{x:number,y:number}} | null}
 */
function kleinGeodesicSegmentFromCurve(curve, view) {
  if (curve.kind === "line") {
    const seg = clipLineToUnitDisk(curve);
    if (!seg) return null;
    return {
      a: hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, applyOriginShift(GeometryType.HYPERBOLIC_KLEIN, view, seg.a)),
      b: hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, applyOriginShift(GeometryType.HYPERBOLIC_KLEIN, view, seg.b)),
    };
  }
  const boundary = { kind: "circle", cx: 0, cy: 0, r: 1 };
  const hits = intersectCurves(curve, boundary);
  if (hits.length < 2) return null;
  return {
    a: hyperbolicInternalToDisplay2D(
      GeometryType.HYPERBOLIC_KLEIN,
      applyOriginShift(GeometryType.HYPERBOLIC_KLEIN, view, hits[0]),
    ),
    b: hyperbolicInternalToDisplay2D(
      GeometryType.HYPERBOLIC_KLEIN,
      applyOriginShift(GeometryType.HYPERBOLIC_KLEIN, view, hits[1]),
    ),
  };
}

/**
 * @param {{kind:"line", a:number,b:number,c:number}} line
 * @returns {{a:{x:number,y:number},b:{x:number,y:number}} | null}
 */
function clipLineToUnitDisk(line) {
  const boundary = { kind: "circle", cx: 0, cy: 0, r: 1 };
  const hits = intersectCurves(line, boundary);
  if (hits.length < 2) return null;
  return { a: hits[0], b: hits[1] };
}

/**
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, scale:number, cameraZ:number}} vp
 * @param {{x:number,y:number}} posScreen
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {boolean} geodesic
 */
function distanceToHyperboloidCurvePx(view, vp, posScreen, curve, geodesic) {
  const internalPts =
    geodesic || curve.kind === "line" ? samplePoincareGeodesicPoints(curve, 180) : samplePoincareCirclePoints(curve, 240);
  if (internalPts.length < 2) return Infinity;
  const screenPts = [];
  for (const p of internalPts) {
    const s = projectPoincareOnHyperboloid(view, vp, p);
    if (!s) continue;
    screenPts.push({ x: s.x, y: s.y });
  }
  return distanceToScreenPolyline(posScreen, screenPts);
}

/**
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number, chartOffsetX?:number, chartOffsetY?:number}} view
 * @param {{x:number,y:number}} posScreen
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {number} cssW
 * @param {number} cssH
 */
function distanceToPerspectiveCurvePx(view, posScreen, curve, cssW, cssH) {
  if (curve.kind === "line") {
    const shifted = perspectiveShiftedLine(curve, view);
    const displayLine = perspectiveDisplayLineFromWorldLine(shifted);
    if (!displayLine) return Infinity;
    const seg = clipLineToViewRect(displayLine, view, cssW, cssH);
    if (!seg) return Infinity;
    const a = worldToScreen(view, seg.a);
    const b = worldToScreen(view, seg.b);
    return distancePointToSegment(posScreen, a, b);
  }

  /** @type {Array<{x:number,y:number} | null>} */
  const screenPts = [];
  const steps = 280;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const w = { x: curve.cx + curve.r * Math.cos(t), y: curve.cy + curve.r * Math.sin(t) };
    screenPts.push(projectModelPointToScreen2D(GeometryType.EUCLIDEAN_PERSPECTIVE, view, w));
  }
  return distanceToScreenPolylineWithBreaks(posScreen, screenPts);
}

/**
 * @param {{kind:"line", a:number,b:number,c:number}} line
 * @param {{chartOffsetX?:number, chartOffsetY?:number}} view
 * @returns {{kind:"line", a:number,b:number,c:number}}
 */
function perspectiveShiftedLine(line, view) {
  const t = getChartOffset(view);
  return { kind: "line", a: line.a, b: line.b, c: line.c - line.a * t.x - line.b * t.y };
}

/**
 * Clip line to current 2D view rectangle in world/display coordinates.
 *
 * @param {{kind:"line", a:number,b:number,c:number}} line
 * @param {{scale:number, offsetX:number, offsetY:number}} view
 * @param {number} cssW
 * @param {number} cssH
 * @returns {{a:{x:number,y:number},b:{x:number,y:number}} | null}
 */
function clipLineToViewRect(line, view, cssW, cssH) {
  const minX = (0 - view.offsetX) / view.scale;
  const maxX = (cssW - view.offsetX) / view.scale;
  const maxY = (0 - view.offsetY) / -view.scale;
  const minY = (cssH - view.offsetY) / -view.scale;

  const edges = [
    { kind: "line", a: 1, b: 0, c: -minX },
    { kind: "line", a: 1, b: 0, c: -maxX },
    { kind: "line", a: 0, b: 1, c: -minY },
    { kind: "line", a: 0, b: 1, c: -maxY },
  ];
  /** @type {{x:number,y:number}[]} */
  const pts = [];
  for (const e of edges) {
    const hits = intersectCurves(line, e);
    for (const p of hits) {
      if (p.x >= minX - 1e-6 && p.x <= maxX + 1e-6 && p.y >= minY - 1e-6 && p.y <= maxY + 1e-6) {
        pts.push(p);
      }
    }
  }
  if (pts.length < 2) return null;
  let bestI = 0;
  let bestJ = 1;
  let bestD = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = dx * dx + dy * dy;
      if (d > bestD) {
        bestD = d;
        bestI = i;
        bestJ = j;
      }
    }
  }
  return { a: pts[bestI], b: pts[bestJ] };
}

/**
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} posScreen
 * @param {{normal:{x:number,y:number,z:number}, d:number}} plane
 */
function distanceToStereographicSphereCurvePx(view, posScreen, plane) {
  const spherePts = sampleSpherePlanePoints(plane, 420);
  /** @type {Array<{x:number,y:number} | null>} */
  const screenPts = spherePts.map((p) => projectSphericalPointToStereographicScreen(view, p));
  return distanceToScreenPolylineWithBreaks(posScreen, screenPts);
}

/**
 * @param {{x:number,y:number}} pos
 * @param {Array<{x:number,y:number}>} polyline
 */
function distanceToScreenPolyline(pos, polyline) {
  if (!polyline || polyline.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const d = distancePointToSegment(pos, polyline[i - 1], polyline[i]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * @param {{x:number,y:number}} pos
 * @param {Array<{x:number,y:number} | null>} polyline
 */
function distanceToScreenPolylineWithBreaks(pos, polyline) {
  let best = Infinity;
  /** @type {{x:number,y:number} | null} */
  let prev = null;
  for (const curr of polyline) {
    if (!curr) {
      prev = null;
      continue;
    }
    if (prev) {
      const jump = Math.hypot(curr.x - prev.x, curr.y - prev.y);
      if (jump <= 800) {
        const d = distancePointToSegment(pos, prev, curr);
        if (d < best) best = d;
      }
    }
    prev = curr;
  }
  return best;
}

/**
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 */
function distancePointToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const vv = vx * vx + vy * vy;
  if (vv <= 1e-12) return Math.hypot(wx, wy);
  let t = (wx * vx + wy * vy) / vv;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const cx = a.x + vx * t;
  const cy = a.y + vy * t;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Snap in Klein display while keeping internal Poincare coordinates.
 *
 * @param {any} doc
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} posScreen
 * @param {{x:number,y:number}} w
 */
function snapKleinPointToCurves(doc, view, posScreen, w) {
  return snap2DPointToCurves(GeometryType.HYPERBOLIC_KLEIN, doc, view, posScreen, w);
}

/**
 * Snap in hyperboloid display while keeping internal Poincare coordinates.
 *
 * @param {any} doc
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, scale:number, cameraZ:number}} vp
 * @param {{x:number,y:number}} posScreen
 * @param {{x:number,y:number}} w
 * @returns {{point:{x:number,y:number}, constraint:{kind:"line"|"circle", id:string}} | null}
 */
function snapHyperboloidPointToCurves(doc, view, vp, posScreen, w) {
  const snapPx = 24;
  /** @type {{point:{x:number,y:number}, constraint:{kind:"line"|"circle", id:string}} | null} */
  let best = null;
  let bestDPx = snapPx;

  const consider = (curve, constraint) => {
    const proj = projectWorldToCurve(curve, w);
    if (!proj || !is2DPointInDomain(GeometryType.HYPERBOLIC_HYPERBOLOID, proj)) return;
    const s = projectPoincareOnHyperboloid(view, vp, proj);
    if (!s) return;
    const dPx = Math.hypot(s.x - posScreen.x, s.y - posScreen.y);
    if (dPx <= bestDPx) {
      bestDPx = dPx;
      best = { point: proj, constraint };
    }
  };

  for (const line of doc.lines) {
    if (line.hidden) continue;
    const curve = derive2DLineCurve(GeometryType.HYPERBOLIC_HYPERBOLOID, doc, line);
    if (!curve) continue;
    consider(curve, { kind: "line", id: line.id });
  }
  for (const circle of doc.circles) {
    if (circle.hidden) continue;
    const curve = derive2DCircleCurve(GeometryType.HYPERBOLIC_HYPERBOLOID, doc, circle);
    if (!curve) continue;
    consider(curve, { kind: "circle", id: circle.id });
  }
  return best;
}

/**
 * Snap a newly created 2D point to the nearest existing curve (line or circle) if the click is close.
 *
 * @param {GeometryType} geom
 * @param {any} doc
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} posScreen
 * @param {{x:number,y:number}} w
 * @returns {{x:number,y:number} | null}
 */
function snap2DPointToCurves(geom, doc, view, posScreen, w) {
  const snapPx = 24;
  /** @type {{point:{x:number,y:number}, constraint:{kind:"line"|"circle", id:string}} | null} */
  let best = null;
  let bestDPx = snapPx;

  const consider = (curve, constraint) => {
    const proj = projectWorldToCurve(curve, w);
    if (!proj) return;
    if (!isPointInDisplayedDomain(geom, view, proj)) return;
    const projScreen = projectModelPointToScreen2D(geom, view, proj);
    if (!projScreen) return;
    const dPx = Math.hypot(projScreen.x - posScreen.x, projScreen.y - posScreen.y);
    if (dPx <= bestDPx) {
      bestDPx = dPx;
      best = { point: proj, constraint };
    }
  };

  for (const line of doc.lines) {
    if (line.hidden) continue;
    const curve = derive2DLineCurve(geom, doc, line);
    if (!curve) continue;
    consider(curve, { kind: "line", id: line.id });
  }
  for (const circle of doc.circles) {
    if (circle.hidden) continue;
    const curve = derive2DCircleCurve(geom, doc, circle);
    if (!curve) continue;
    consider(curve, { kind: "circle", id: circle.id });
  }

  return best;
}

/**
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {{x:number,y:number}} p
 * @returns {{x:number,y:number} | null}
 */
function projectWorldToCurve(curve, p) {
  if (curve.kind === "line") {
    const distSigned = curve.a * p.x + curve.b * p.y + curve.c;
    return { x: p.x - curve.a * distSigned, y: p.y - curve.b * distSigned };
  }
  const vx = p.x - curve.cx;
  const vy = p.y - curve.cy;
  const n = Math.hypot(vx, vy);
  if (n < 1e-12) return null;
  const k = curve.r / n;
  return { x: curve.cx + vx * k, y: curve.cy + vy * k };
}

/**
 * Snap a newly created spherical point to the nearest existing circle/great-circle if the click is close.
 *
 * @param {any} doc
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, r:number}} vp
 * @param {{x:number,y:number}} posScreen
 * @param {{x:number,y:number,z:number}} p
 * @returns {{x:number,y:number,z:number} | null}
 */
function snapSpherePointToCurves(doc, view, vp, posScreen, p) {
  const snapPx = 24;
  /** @type {{point:{x:number,y:number,z:number}, constraint:{kind:"line"|"circle", id:string}} | null} */
  let best = null;
  let bestDPx = snapPx;

  const considerPlane = (plane, constraint) => {
    const proj = closestPointOnSpherePlaneCircle(p, plane);
    const vProj = rotateToView(view, proj);
    const sProj = projectSphere(vProj, vp);
    const dPx = Math.hypot(sProj.x - posScreen.x, sProj.y - posScreen.y);
    if (dPx <= bestDPx) {
      bestDPx = dPx;
      best = { point: proj, constraint };
    }
  };

  for (const line of doc.lines) {
    if (line.hidden) continue;
    const plane = deriveSphereGreatCircle(doc, line);
    if (!plane) continue;
    considerPlane(plane, { kind: "line", id: line.id });
  }
  for (const circle of doc.circles) {
    if (circle.hidden) continue;
    const plane = deriveSphereCircle(doc, circle);
    if (!plane) continue;
    considerPlane(plane, { kind: "circle", id: circle.id });
  }

  return best;
}

/**
 * @param {any} doc
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{x:number,y:number}} posScreen
 * @param {{x:number,y:number,z:number}} p
 * @returns {{x:number,y:number,z:number} | null}
 */
function snapSpherePointToCurvesStereographic(doc, view, posScreen, p) {
  const snapPx = 24;
  /** @type {{point:{x:number,y:number,z:number}, constraint:{kind:"line"|"circle", id:string}} | null} */
  let best = null;
  let bestDPx = snapPx;

  const considerPlane = (plane, constraint) => {
    const proj = closestPointOnSpherePlaneCircle(p, plane);
    const sProj = projectSphericalPointToStereographicScreen(view, proj);
    if (!sProj) return;
    const dPx = Math.hypot(sProj.x - posScreen.x, sProj.y - posScreen.y);
    if (dPx <= bestDPx) {
      bestDPx = dPx;
      best = { point: proj, constraint };
    }
  };

  for (const line of doc.lines) {
    if (line.hidden) continue;
    const plane = deriveSphereGreatCircle(doc, line);
    if (!plane) continue;
    considerPlane(plane, { kind: "line", id: line.id });
  }
  for (const circle of doc.circles) {
    if (circle.hidden) continue;
    const plane = deriveSphereCircle(doc, circle);
    if (!plane) continue;
    considerPlane(plane, { kind: "circle", id: circle.id });
  }

  return best;
}

/**
 * Closest point on the spherical circle defined by plane n·x = d and |x|=1.
 * @param {{x:number,y:number,z:number}} x
 * @param {{normal:{x:number,y:number,z:number}, d:number}} plane
 * @returns {{x:number,y:number,z:number}}
 */
function closestPointOnSpherePlaneCircle(x, plane) {
  const n = norm3(plane.normal);
  const d = plane.d;
  const t = dot3(n, x);
  const v = { x: x.x - n.x * t, y: x.y - n.y * t, z: x.z - n.z * t };
  const vLen = Math.hypot(v.x, v.y, v.z);
  let u;
  if (vLen < 1e-12) {
    const ref = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const cx = n.y * ref.z - n.z * ref.y;
    const cy = n.z * ref.x - n.x * ref.z;
    const cz = n.x * ref.y - n.y * ref.x;
    const cLen = Math.hypot(cx, cy, cz) || 1;
    u = { x: cx / cLen, y: cy / cLen, z: cz / cLen };
  } else {
    u = { x: v.x / vLen, y: v.y / vLen, z: v.z / vLen };
  }
  const r = Math.sqrt(Math.max(0, 1 - d * d));
  return { x: n.x * d + u.x * r, y: n.y * d + u.y * r, z: n.z * d + u.z * r };
}
