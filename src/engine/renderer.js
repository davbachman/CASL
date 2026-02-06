import { GeometryType } from "./state.js";
import { derive2DCircleCurve, derive2DLineCurve, deriveSphereCircle, deriveSphereGreatCircle } from "./geometry.js";
import { intersectCurves, lineThrough } from "./geom2d.js";
import { samplePoincareCirclePoints, samplePoincareGeodesicPoints } from "./hyperbolicCurves.js";
import { hyperbolicInternalToDisplay2D, hyperboloidToPoincare, poincareToHyperboloid, poincareToKlein } from "./hyperbolicModels.js";
import { hyperboloidViewport } from "./hyperboloidView.js?v=20260206-64";
import { sampleSpherePlanePoints, sphereToStereographic } from "./stereographic.js";
import { initialize2DViewIfNeeded, worldToScreen } from "./view2d.js";
import { projectSphere, rotateFromView, rotateToView } from "./sphereView.js";
import { norm3 } from "./vec3.js";

const HYPERBOLOID_SURFACE_RADIUS = 0.92;

/**
 * @typedef {import("./state.js").AppState} AppState
 */

/** @param {HTMLCanvasElement} canvas @param {AppState} state */
export function createRenderer(canvas, state) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  /** @type {boolean} */
  let dirty = true;
  /** @type {{text: string}} */
  let lastInfo = { text: "" };

  const requestRender = (force = false) => {
    dirty = true;
    if (force) lastInfo.text = "";
  };

  const getLastRenderInfo = () => lastInfo;

  const resizeIfNeeded = () => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      dirty = true;
    }
    return { w, h, dpr };
  };

  const drawIfNeeded = () => {
    const { w, h, dpr } = resizeIfNeeded();
    if (!dirty) return;
    dirty = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const geom = state.activeGeometry;
    const doc = state.docs[geom];
    const view = state.views[geom];

    if (geom === GeometryType.SPHERICAL) {
      drawSphere(ctx, w, h, dpr, state, doc, /** @type {any} */ (view));
    } else if (geom === GeometryType.SPHERICAL_STEREOGRAPHIC) {
      initialize2DViewIfNeeded(/** @type {any} */ (view), w / dpr, h / dpr);
      drawSphericalStereographic(ctx, w, h, dpr, state, doc, /** @type {any} */ (view));
    } else if (geom === GeometryType.HYPERBOLIC_HYPERBOLOID) {
      drawHyperboloid(ctx, w, h, dpr, state, doc, /** @type {any} */ (view));
    } else {
      initialize2DViewIfNeeded(
        /** @type {any} */ (view),
        w / dpr,
        h / dpr,
        geom === GeometryType.HYPERBOLIC_HALF_PLANE ? { offsetY: (h / dpr) * 0.78 } : undefined,
      );
      draw2D(ctx, w, h, dpr, state, doc, /** @type {any} */ (view), geom);
    }

    lastInfo = {
      text:
        geom === GeometryType.SPHERICAL || geom === GeometryType.HYPERBOLIC_HYPERBOLOID
          ? `mode=${geom} points=${doc.points.length} lines=${doc.lines.length} circles=${doc.circles.length}`
          : `mode=${geom} points=${doc.points.length} lines=${doc.lines.length} circles=${doc.circles.length} scale=${Math.round(
              /** @type {any} */ (view).scale,
            )}`,
    };
  };

  return { requestRender, drawIfNeeded, getLastRenderInfo };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} dpr
 * @param {AppState} state
 * @param {any} doc
 * @param {any} view
 * @param {GeometryType} geom
 */
function draw2D(ctx, w, h, dpr, state, doc, view, geom) {
  ctx.save();
  // Work in CSS pixels.
  ctx.scale(dpr, dpr);

  // Background model
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w / dpr, h / dpr);

  if (geom === GeometryType.HYPERBOLIC_POINCARE || geom === GeometryType.HYPERBOLIC_KLEIN) {
    const center = { x: view.offsetX, y: view.offsetY };
    const diskR = view.scale;
    // Shade outside disk.
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, w / dpr, h / dpr);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(center.x, center.y, diskR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(center.x, center.y, diskR, 0, Math.PI * 2);
    ctx.stroke();
  } else if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 1.5;
    // boundary y=0
    const y0 = view.offsetY;
    // Shade the excluded half-plane.
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, y0, w / dpr, h / dpr - y0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w / dpr, y0);
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(w / dpr, y0);
    ctx.stroke();
  }

  // Draw curves (lines/circles)
  for (const circle of doc.circles) {
    if (circle.hidden) continue;
    const curve = derive2DCircleCurve(geom, doc, circle);
    if (!curve) continue;
    const isSelected =
      isToolRefSelected(state, "circle", circle.id) ||
      (state.pending?.tool === "intersect" &&
        state.pending.firstObject.kind === "circle" &&
        state.pending.firstObject.id === circle.id);
    const c0 = doc.points.find((p) => p.id === circle.center);
    const r0 = doc.points.find((p) => p.id === circle.radiusPoint);
    const labelAnchorWorld =
      c0 && r0
        ? {
            x: (c0.x + r0.x) / 2,
            y: (c0.y + r0.y) / 2,
          }
        : null;
    draw2DCircleObject(ctx, view, geom, curve, circle.style, circle.label, isSelected, w / dpr, h / dpr, labelAnchorWorld);
  }

  for (const line of doc.lines) {
    if (line.hidden) continue;
    const curve = derive2DLineCurve(geom, doc, line);
    if (!curve) continue;
    const p1 = doc.points.find((p) => p.id === line.p1);
    const p2 = doc.points.find((p) => p.id === line.p2);
    const definingPointsWorld =
      p1 && p2
        ? {
            p1: { x: p1.x, y: p1.y },
            p2: { x: p2.x, y: p2.y },
          }
        : null;
    const labelAnchorWorld =
      p1 && p2
        ? {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2,
          }
        : null;
    const isSelected =
      isToolRefSelected(state, "line", line.id) ||
      (state.pending?.tool === "intersect" &&
        state.pending.firstObject.kind === "line" &&
        state.pending.firstObject.id === line.id);
    draw2DLineObject(
      ctx,
      view,
      geom,
      curve,
      line.style,
      line.label,
      isSelected,
      w / dpr,
      h / dpr,
      labelAnchorWorld,
      definingPointsWorld,
    );
  }

  // Draw points
  for (const p of doc.points) {
    if (p.hidden) continue;
    const highlight =
      isToolRefSelected(state, "point", p.id) ||
      (state.pending?.tool !== "intersect" && state.pending?.firstPointId === p.id);
    draw2DPoint(ctx, view, geom, p, highlight);
  }

  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} view
 * @param {GeometryType} geom
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {{color:string,opacity:number}} style
 * @param {string} label
 * @param {boolean} isSelected
 * @param {number} cssW
 * @param {number} cssH
 * @param {{x:number,y:number} | null} labelAnchorWorld
 */
function draw2DCircleObject(ctx, view, geom, curve, style, label, isSelected, cssW, cssH, labelAnchorWorld) {
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = isSelected ? 3 : 2;

  if (geom === GeometryType.HYPERBOLIC_KLEIN) {
    const points =
      curve.kind === "line" ? samplePoincareGeodesicPoints(curve, 120) : samplePoincareCirclePoints(curve, 240);
    const display = points.map((p) => hyperbolicInternalToDisplay2D(geom, p));
    drawPolylineWorld(ctx, view, display);
    const labWorld = labelAnchorWorld ? hyperbolicInternalToDisplay2D(geom, labelAnchorWorld) : display[Math.floor(display.length / 2)];
    if (labWorld) {
      const lab = worldToScreen(view, labWorld);
      drawCurveLabel(ctx, label, lab.x, lab.y);
    }
    ctx.restore();
    return;
  }

  if (curve.kind === "line") {
    const seg = clipLineToView(curve, view, cssW, cssH);
    if (seg) {
      const a = worldToScreen(view, seg.a);
      const b = worldToScreen(view, seg.b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const lab = labelAnchorWorld
        ? worldToScreen(view, labelAnchorWorld)
        : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      drawCurveLabel(ctx, label, lab.x, lab.y);
    }
    ctx.restore();
    return;
  }

  const c = worldToScreen(view, { x: curve.cx, y: curve.cy });
  ctx.beginPath();
  ctx.arc(c.x, c.y, curve.r * view.scale, 0, Math.PI * 2);
  ctx.stroke();
  const lab = labelAnchorWorld
    ? worldToScreen(view, labelAnchorWorld)
    : {
        x: c.x + (curve.r * view.scale) / Math.sqrt(2),
        y: c.y - (curve.r * view.scale) / Math.sqrt(2),
      };
  drawCurveLabel(ctx, label, lab.x, lab.y);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} view
 * @param {GeometryType} geom
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {{color:string,opacity:number}} style
 * @param {string} label
 * @param {boolean} isSelected
 * @param {number} cssW
 * @param {number} cssH
 * @param {{x:number,y:number} | null} labelAnchorWorld
 * @param {{p1:{x:number,y:number}, p2:{x:number,y:number}} | null} definingPointsWorld
 */
function draw2DLineObject(
  ctx,
  view,
  geom,
  curve,
  style,
  label,
  isSelected,
  cssW,
  cssH,
  labelAnchorWorld,
  definingPointsWorld,
) {
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = isSelected ? 3 : 2;

  if (geom === GeometryType.HYPERBOLIC_KLEIN) {
    const seg = kleinGeodesicSegment(curve, definingPointsWorld);
    /** @type {Array<{x:number,y:number}>} */
    const displayPoints = [];
    if (seg) {
      const steps = 140;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        displayPoints.push({
          x: seg.a.x + (seg.b.x - seg.a.x) * t,
          y: seg.a.y + (seg.b.y - seg.a.y) * t,
        });
      }
    } else {
      const fallback = samplePoincareGeodesicPoints(curve, 140).map((p) => hyperbolicInternalToDisplay2D(geom, p));
      displayPoints.push(...fallback);
    }
    drawPolylineWorld(ctx, view, displayPoints);
    const labWorld =
      labelAnchorWorld && Number.isFinite(labelAnchorWorld.x) && Number.isFinite(labelAnchorWorld.y)
        ? hyperbolicInternalToDisplay2D(geom, labelAnchorWorld)
        : displayPoints[Math.floor(displayPoints.length / 2)];
    if (labWorld) {
      const lab = worldToScreen(view, labWorld);
      drawCurveLabel(ctx, label, lab.x, lab.y);
    }
    ctx.restore();
    return;
  }

  // Lines/geodesics
  if (geom === GeometryType.HYPERBOLIC_POINCARE) {
    if (curve.kind === "line") {
      // diameter segment inside disk (clip with unit circle)
      const seg = clipLineToUnitDisk(curve);
      if (seg) {
        ctx.beginPath();
        const a = worldToScreen(view, seg.a);
        ctx.moveTo(a.x, a.y);
        const b = worldToScreen(view, seg.b);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const lab = labelAnchorWorld ? worldToScreen(view, labelAnchorWorld) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        drawCurveLabel(ctx, label, lab.x, lab.y);
      }
      ctx.restore();
      return;
    }
    // Circle orthogonal to boundary: draw arc inside disk.
    drawPoincareGeodesicArc(ctx, view, curve, label);
    ctx.restore();
    return;
  }

  if (geom === GeometryType.HYPERBOLIC_HALF_PLANE) {
    if (curve.kind === "line") {
      const seg = clipLineToView(curve, view, cssW, cssH);
      if (seg) {
        const a = worldToScreen(view, seg.a);
        const b = worldToScreen(view, seg.b);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const lab = labelAnchorWorld ? worldToScreen(view, labelAnchorWorld) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        drawCurveLabel(ctx, label, lab.x, lab.y);
      }
      ctx.restore();
      return;
    }
    // Circle geodesic with center on boundary: draw upper semicircle
    drawHalfPlaneGeodesicArc(ctx, view, curve, label, labelAnchorWorld, cssW, cssH, definingPointsWorld);
    ctx.restore();
    return;
  }

  // Euclidean / inversive "lines" may also be circles (inversive geometry).
  if (curve.kind === "circle") {
    const c = worldToScreen(view, { x: curve.cx, y: curve.cy });
    ctx.beginPath();
    ctx.arc(c.x, c.y, curve.r * view.scale, 0, Math.PI * 2);
    ctx.stroke();
    drawCurveLabel(
      ctx,
      label,
      c.x + (curve.r * view.scale) / Math.sqrt(2),
      c.y - (curve.r * view.scale) / Math.sqrt(2),
    );
    ctx.restore();
    return;
  }

  // Euclidean / inversive: draw clipped infinite line.
  const seg = clipLineToView(curve, view, cssW, cssH);
  if (seg) {
    const a = worldToScreen(view, seg.a);
    const b = worldToScreen(view, seg.b);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const lab = labelAnchorWorld ? worldToScreen(view, labelAnchorWorld) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drawCurveLabel(ctx, label, lab.x, lab.y);
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} view
 * @param {GeometryType} geom
 * @param {{id:string,label:string,x:number,y:number,z?:number,style:{color:string,opacity:number},locked?:boolean}} p
 * @param {boolean} highlight
 */
function draw2DPoint(ctx, view, geom, p, highlight) {
  const drawPos = geom === GeometryType.HYPERBOLIC_KLEIN ? poincareToKlein({ x: p.x, y: p.y }) : { x: p.x, y: p.y };
  const s = worldToScreen(view, drawPos);
  ctx.save();
  ctx.globalAlpha = p.style.opacity;
  ctx.fillStyle = p.style.color;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 4.2, 0, Math.PI * 2);
  ctx.fill();

  if (highlight) {
    ctx.strokeStyle = "rgba(37,99,235,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 9.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.globalAlpha = 1;
  ctx.fillText(p.label, s.x + 8, s.y - 8);
  ctx.restore();
}

/**
 * @param {AppState} state
 * @param {"point"|"line"|"circle"} kind
 * @param {string} id
 */
function isToolRefSelected(state, kind, id) {
  if (state.toolBuilder?.inputs?.some((ref) => ref.kind === kind && ref.id === id)) return true;
  if (state.toolUse?.inputs?.some((ref) => ref.kind === kind && ref.id === id)) return true;
  return false;
}

/** @param {CanvasRenderingContext2D} ctx @param {string} label @param {number} x @param {number} y */
function drawCurveLabel(ctx, label, x, y) {
  if (!label) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillText(label, x + 8, y - 6);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} view
 * @param {Array<{x:number,y:number}>} pts
 */
function drawPolylineWorld(ctx, view, pts) {
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const s = worldToScreen(view, pts[i]);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
}

/**
 * Draw Poincaré geodesic arc (orthogonal circle) inside the unit disk.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} view
 * @param {{kind:"circle", cx:number, cy:number, r:number}} circle
 * @param {string} label
 */
function drawPoincareGeodesicArc(ctx, view, circle, label) {
  const boundary = { kind: "circle", cx: 0, cy: 0, r: 1 };
  const hits = intersectCurves(circle, boundary);
  if (hits.length < 2) return;
  const [pA, pB] = hits;
  const a1 = Math.atan2(pA.y - circle.cy, pA.x - circle.cx);
  const a2 = Math.atan2(pB.y - circle.cy, pB.x - circle.cx);
  const delta = ccwDelta(a1, a2);
  const mid = a1 + delta / 2;
  const midPoint = { x: circle.cx + circle.r * Math.cos(mid), y: circle.cy + circle.r * Math.sin(mid) };
  const useA1ToA2 = midPoint.x * midPoint.x + midPoint.y * midPoint.y < 1;

  const start = useA1ToA2 ? a1 : a2;
  const end = useA1ToA2 ? a2 : a1;
  const span = ccwDelta(start, end);
  const steps = Math.max(48, Math.ceil(span * 80));

  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = start + (span * i) / steps;
    const w = { x: circle.cx + circle.r * Math.cos(t), y: circle.cy + circle.r * Math.sin(t) };
    const s = worldToScreen(view, w);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();

  const midIdx = Math.floor(steps / 2);
  const tLab = start + (span * midIdx) / steps;
  const wLab = { x: circle.cx + circle.r * Math.cos(tLab), y: circle.cy + circle.r * Math.sin(tLab) };
  const sLab = worldToScreen(view, wLab);
  drawCurveLabel(ctx, label, sLab.x, sLab.y);
}

/**
 * Draw Half-plane geodesic arc: upper semicircle (or full circle if panned below boundary; we still draw upper half in model coords).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} view
 * @param {{kind:"circle", cx:number, cy:number, r:number}} circle
 * @param {string} label
 * @param {{x:number,y:number} | null} labelAnchorWorld
 * @param {number} cssW
 * @param {number} cssH
 * @param {{p1:{x:number,y:number}, p2:{x:number,y:number}} | null} definingPointsWorld
 */
function drawHalfPlaneGeodesicArc(ctx, view, circle, label, labelAnchorWorld, cssW, cssH, definingPointsWorld) {
  // Sample the arc directly in screen-x to avoid precision issues when
  // world coordinates and circle radii become huge (common for near-vertical geodesics).
  const y0 = view.offsetY; // boundary y=0 in screen coords

  let endpointsScreen = null;
  if (definingPointsWorld) {
    const s1 = worldToScreen(view, definingPointsWorld.p1);
    const s2 = worldToScreen(view, definingPointsWorld.p2);
    // Work in coordinates where the boundary is y=0 and y is the distance above the boundary.
    // Use world y * scale for stability when y0 is large.
    endpointsScreen = halfPlaneGeodesicEndpoints(
      { x: s1.x, y: definingPointsWorld.p1.y * view.scale },
      { x: s2.x, y: definingPointsWorld.p2.y * view.scale },
    );
  }

  if (!endpointsScreen) {
    const sL = worldToScreen(view, { x: circle.cx - circle.r, y: 0 });
    const sR = worldToScreen(view, { x: circle.cx + circle.r, y: 0 });
    endpointsScreen = { left: Math.min(sL.x, sR.x), right: Math.max(sL.x, sR.x) };
  }

  const leftS = endpointsScreen.left;
  const rightS = endpointsScreen.right;
  if (!Number.isFinite(leftS) || !Number.isFinite(rightS) || leftS === rightS) return;

  const stepPx = 2.5;
  const arcStart = Math.max(0, Math.min(leftS, rightS));
  const arcEnd = Math.min(cssW, Math.max(leftS, rightS));
  if (!(arcStart <= arcEnd)) return;
  const steps = Math.max(24, Math.min(2600, Math.ceil((arcEnd - arcStart) / stepPx)));
  const yCullMarginPx = 120;

  ctx.beginPath();
  let penDown = false;
  let hasAny = false;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = arcStart + (arcEnd - arcStart) * t;
    const ySq = (sx - leftS) * (rightS - sx);
    if (!(ySq >= 0)) {
      penDown = false;
      continue;
    }
    const yAbove = Math.sqrt(Math.max(0, ySq));
    const sy = y0 - yAbove;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
      penDown = false;
      continue;
    }
    if (sy < -yCullMarginPx || sy > cssH + yCullMarginPx) {
      penDown = false;
      continue;
    }
    if (!penDown) {
      ctx.moveTo(sx, sy);
      penDown = true;
    } else {
      ctx.lineTo(sx, sy);
    }
    hasAny = true;
  }
  if (hasAny) ctx.stroke();

  const lab = labelAnchorWorld ? worldToScreen(view, labelAnchorWorld) : { x: cssW / 2, y: cssH / 2 };
  drawCurveLabel(ctx, label, lab.x, lab.y);
}

/**
 * Circle geodesic endpoints on the boundary y=0, computed from two points on the circle.
 * Uses a stable quadratic solve based on sum/product of roots to avoid catastrophic cancellation
 * for huge-radius arcs.
 *
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} q
 * @returns {{left:number,right:number} | null}
 */
function halfPlaneGeodesicEndpoints(p, q) {
  const dx = q.x - p.x;
  if (Math.abs(dx) < 1e-12) return null;
  const s1 = p.x * p.x + p.y * p.y;
  const s2 = q.x * q.x + q.y * q.y;
  const S = (s2 - s1) / dx; // sum of roots
  const P = S * p.x - s1; // product of roots
  const disc = S * S - 4 * P;
  const sqrtDisc = Math.sqrt(Math.max(0, disc));

  const big = S >= 0 ? (S + sqrtDisc) / 2 : (S - sqrtDisc) / 2;
  let small = P / big;
  if (!Number.isFinite(small)) small = S - big;

  const left = Math.min(big, small);
  const right = Math.max(big, small);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return { left, right };
}

/**
 * Clip a line to the unit disk (return chord endpoints).
 * @param {{kind:"line", a:number,b:number,c:number}} line
 */
function clipLineToUnitDisk(line) {
  const boundary = { kind: "circle", cx: 0, cy: 0, r: 1 };
  const hits = intersectCurves(line, boundary);
  if (hits.length < 2) return null;
  return { a: hits[0], b: hits[1] };
}

/**
 * Compute the straight Klein geodesic chord for a hyperbolic line.
 *
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {{p1:{x:number,y:number}, p2:{x:number,y:number}} | null} definingPointsWorld
 * @returns {{a:{x:number,y:number}, b:{x:number,y:number}} | null}
 */
function kleinGeodesicSegment(curve, definingPointsWorld) {
  if (definingPointsWorld) {
    const k1 = hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, definingPointsWorld.p1);
    const k2 = hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, definingPointsWorld.p2);
    const chord = lineThrough(k1, k2);
    const seg = chord ? clipLineToUnitDisk(chord) : null;
    if (seg) return seg;
  }

  if (curve.kind === "line") {
    const seg = clipLineToUnitDisk(curve);
    if (!seg) return null;
    return {
      a: hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, seg.a),
      b: hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, seg.b),
    };
  }

  const boundary = { kind: "circle", cx: 0, cy: 0, r: 1 };
  const hits = intersectCurves(curve, boundary);
  if (hits.length < 2) return null;
  return {
    a: hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, hits[0]),
    b: hyperbolicInternalToDisplay2D(GeometryType.HYPERBOLIC_KLEIN, hits[1]),
  };
}

/**
 * Clip line to current view rectangle in world coords.
 * @param {{kind:"line", a:number,b:number,c:number}} line
 * @param {any} view
 * @param {number} cssW
 * @param {number} cssH
 * @returns {{a:{x:number,y:number},b:{x:number,y:number}} | null}
 */
function clipLineToView(line, view, cssW, cssH) {
  // View bounds in world coords.
  const minX = (0 - view.offsetX) / view.scale;
  const maxX = (cssW - view.offsetX) / view.scale;
  const maxY = (0 - view.offsetY) / -view.scale;
  const minY = (cssH - view.offsetY) / -view.scale;

  const edges = [
    { kind: "line", a: 1, b: 0, c: -minX }, // x=minX
    { kind: "line", a: 1, b: 0, c: -maxX }, // x=maxX
    { kind: "line", a: 0, b: 1, c: -minY }, // y=minY
    { kind: "line", a: 0, b: 1, c: -maxY }, // y=maxY
  ];
  /** @type {{x:number,y:number}[]} */
  const pts = [];
  for (const e of edges) {
    const hit = intersectCurves(line, e);
    for (const p of hit) {
      if (p.x >= minX - 1e-6 && p.x <= maxX + 1e-6 && p.y >= minY - 1e-6 && p.y <= maxY + 1e-6) {
        pts.push(p);
      }
    }
  }
  if (pts.length < 2) return null;
  // Choose the two farthest points.
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

/** @param {number} from @param {number} to */
function ccwDelta(from, to) {
  let d = to - from;
  while (d < 0) d += Math.PI * 2;
  while (d >= Math.PI * 2) d -= Math.PI * 2;
  return d;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} dpr
 * @param {AppState} state
 * @param {any} doc
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 */
function drawSphere(ctx, w, h, dpr, state, doc, view) {
  ctx.save();
  ctx.scale(dpr, dpr);

  const cssW = w / dpr;
  const cssH = h / dpr;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);

  const baseR = Math.min(cssW, cssH) * 0.38;
  const r = baseR * view.zoom;
  const vp = { cx: cssW / 2, cy: cssH / 2, r };

  // Sphere shading
  const grad = ctx.createRadialGradient(vp.cx - r * 0.35, vp.cy - r * 0.35, r * 0.2, vp.cx, vp.cy, r);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#d8dde6");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(vp.cx, vp.cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw curves
  for (const circle of doc.circles) {
    if (circle.hidden) continue;
    const plane = deriveSphereCircle(doc, circle);
    if (!plane) continue;
    const isSelected =
      isToolRefSelected(state, "circle", circle.id) ||
      (state.pending?.tool === "intersect" &&
        state.pending.firstObject.kind === "circle" &&
        state.pending.firstObject.id === circle.id);
    drawSpherePlaneCurve(ctx, view, vp, plane, circle.style, circle.label, isSelected);
  }

  for (const line of doc.lines) {
    if (line.hidden) continue;
    const plane = deriveSphereGreatCircle(doc, line);
    if (!plane) continue;
    const isSelected =
      isToolRefSelected(state, "line", line.id) ||
      (state.pending?.tool === "intersect" &&
        state.pending.firstObject.kind === "line" &&
        state.pending.firstObject.id === line.id);
    drawSpherePlaneCurve(ctx, view, vp, plane, line.style, line.label, isSelected);
  }

  // Draw points
  for (const p of doc.points) {
    if (p.z == null) continue;
    if (p.hidden) continue;
    const highlight =
      isToolRefSelected(state, "point", p.id) ||
      (state.pending?.tool !== "intersect" && state.pending?.firstPointId === p.id);
    drawSpherePoint(ctx, view, vp, p, highlight);
  }

  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} dpr
 * @param {AppState} state
 * @param {any} doc
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 */
function drawSphericalStereographic(ctx, w, h, dpr, state, doc, view) {
  ctx.save();
  ctx.scale(dpr, dpr);

  const cssW = w / dpr;
  const cssH = h / dpr;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);

  const s = worldToScreen(view, { x: 0, y: 0 });
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(s.x, s.y, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillText("S", s.x + 8, s.y - 8);

  for (const circle of doc.circles) {
    if (circle.hidden) continue;
    const plane = deriveSphereCircle(doc, circle);
    if (!plane) continue;
    const isSelected =
      isToolRefSelected(state, "circle", circle.id) ||
      (state.pending?.tool === "intersect" &&
        state.pending.firstObject.kind === "circle" &&
        state.pending.firstObject.id === circle.id);
    drawStereographicPlaneCurve(ctx, view, plane, circle.style, circle.label, isSelected, cssW, cssH);
  }

  for (const line of doc.lines) {
    if (line.hidden) continue;
    const plane = deriveSphereGreatCircle(doc, line);
    if (!plane) continue;
    const isSelected =
      isToolRefSelected(state, "line", line.id) ||
      (state.pending?.tool === "intersect" &&
        state.pending.firstObject.kind === "line" &&
        state.pending.firstObject.id === line.id);
    drawStereographicPlaneCurve(ctx, view, plane, line.style, line.label, isSelected, cssW, cssH);
  }

  for (const p of doc.points) {
    if (p.hidden) continue;
    if (p.z == null) continue;
    const screen = projectSphericalPointToStereographicScreen(view, p);
    if (!screen) continue;
    const highlight =
      isToolRefSelected(state, "point", p.id) ||
      (state.pending?.tool !== "intersect" && state.pending?.firstPointId === p.id);
    ctx.save();
    ctx.globalAlpha = p.style.opacity;
    ctx.fillStyle = p.style.color;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
    if (highlight) {
      ctx.strokeStyle = "rgba(37,99,235,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 9.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.font =
      "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillText(p.label, screen.x + 8, screen.y - 8);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} dpr
 * @param {AppState} state
 * @param {any} doc
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 */
function drawHyperboloid(ctx, w, h, dpr, state, doc, view) {
  ctx.save();
  ctx.scale(dpr, dpr);

  const cssW = w / dpr;
  const cssH = h / dpr;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);

  const vp = hyperboloidViewport(view, cssW, cssH);
  drawHyperboloidSurface(ctx, view, vp);

  for (const circle of doc.circles) {
    if (circle.hidden) continue;
    const curve = derive2DCircleCurve(GeometryType.HYPERBOLIC_HYPERBOLOID, doc, circle);
    if (!curve) continue;
    const pts =
      curve.kind === "line" ? samplePoincareGeodesicPoints(curve, 160) : samplePoincareCirclePoints(curve, 220);
    const isSelected =
      isToolRefSelected(state, "circle", circle.id) ||
      (state.pending?.tool === "intersect" &&
        state.pending.firstObject.kind === "circle" &&
        state.pending.firstObject.id === circle.id);
    drawHyperboloidCurve(ctx, view, vp, pts, circle.style, circle.label, isSelected);
  }

  for (const line of doc.lines) {
    if (line.hidden) continue;
    const curve = derive2DLineCurve(GeometryType.HYPERBOLIC_HYPERBOLOID, doc, line);
    if (!curve) continue;
    const pts = samplePoincareGeodesicPoints(curve, 180);
    const isSelected =
      isToolRefSelected(state, "line", line.id) ||
      (state.pending?.tool === "intersect" &&
        state.pending.firstObject.kind === "line" &&
        state.pending.firstObject.id === line.id);
    drawHyperboloidCurve(ctx, view, vp, pts, line.style, line.label, isSelected);
  }

  for (const p of doc.points) {
    if (p.hidden) continue;
    const highlight =
      isToolRefSelected(state, "point", p.id) ||
      (state.pending?.tool !== "intersect" && state.pending?.firstPointId === p.id);
    const s = projectHyperboloidVertex(view, vp, { x: p.x, y: p.y });
    if (!s) continue;
    ctx.save();
    ctx.globalAlpha = s.frontFacing ? p.style.opacity : p.style.opacity * 0.3;
    ctx.fillStyle = p.style.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
    if (highlight) {
      ctx.strokeStyle = "rgba(37,99,235,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 9.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.globalAlpha = 1;
    ctx.fillText(p.label, s.x + 8, s.y - 8);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, scale:number, cameraZ:number}} vp
 */
function drawHyperboloidSurface(ctx, view, vp) {
  const radius = HYPERBOLOID_SURFACE_RADIUS;
  const radialSteps = 54;
  const angularSteps = 180;
  const vertexRows = radialSteps + 1;

  /** @type {Array<Array<{x:number,y:number,vx:number,vy:number,vz:number,nx:number,ny:number,nz:number}>>} */
  const grid = [];
  for (let i = 0; i < vertexRows; i++) {
    const u = i / radialSteps;
    const r = radius * Math.sqrt(u);
    /** @type {Array<{x:number,y:number,vx:number,vy:number,vz:number,nx:number,ny:number,nz:number}>} */
    const row = [];
    for (let j = 0; j < angularSteps; j++) {
      const t = (j / angularSteps) * Math.PI * 2;
      const p = { x: r * Math.cos(t), y: r * Math.sin(t) };
      const h = poincareToHyperboloid(p);
      const v = rotateToView(view, h);
      const den = vp.cameraZ - v.z;
      if (den <= 1e-5) return { rim: [] };
      const k = vp.scale / den;
      const normalWorld = norm3({ x: -h.x, y: -h.y, z: h.z });
      const normalView = rotateToView(view, normalWorld);
      row.push({
        x: vp.cx + v.x * k,
        y: vp.cy - v.y * k,
        vx: v.x,
        vy: v.y,
        vz: v.z,
        nx: normalView.x,
        ny: normalView.y,
        nz: normalView.z,
      });
    }
    grid.push(row);
  }

  /** @type {Array<{a:any,b:any,c:any,depth:number,shade:number,outside:boolean}>} */
  const tris = [];
  const light = norm3({ x: -0.35, y: 0.45, z: 0.82 });

  /** @param {{x:number,y:number,vx:number,vy:number,vz:number,nx:number,ny:number,nz:number}} a
   *  @param {{x:number,y:number,vx:number,vy:number,vz:number,nx:number,ny:number,nz:number}} b
   *  @param {{x:number,y:number,vx:number,vy:number,vz:number,nx:number,ny:number,nz:number}} c
   */
  const pushTri = (a, b, c) => {
    const cx = (a.vx + b.vx + c.vx) / 3;
    const cy = (a.vy + b.vy + c.vy) / 3;
    const cz = (a.vz + b.vz + c.vz) / 3;
    const normalRaw = norm3({
      x: (a.nx + b.nx + c.nx) / 3,
      y: (a.ny + b.ny + c.ny) / 3,
      z: (a.nz + b.nz + c.nz) / 3,
    });
    const toCam = { x: -cx, y: -cy, z: vp.cameraZ - cz };
    const facing = normalRaw.x * toCam.x + normalRaw.y * toCam.y + normalRaw.z * toCam.z;
    const outside = facing >= 0;
    const normal = outside ? normalRaw : { x: -normalRaw.x, y: -normalRaw.y, z: -normalRaw.z };
    const lit = Math.max(0, normal.x * light.x + normal.y * light.y + normal.z * light.z);
    const shade = 0.28 + 0.72 * lit;
    tris.push({ a, b, c, depth: cz, shade, outside });
  };

  for (let i = 0; i < radialSteps; i++) {
    const r0 = grid[i];
    const r1 = grid[i + 1];
    for (let j = 0; j < angularSteps; j++) {
      const j1 = (j + 1) % angularSteps;
      const a = r0[j];
      const b = r1[j];
      const c = r1[j1];
      const d = r0[j1];
      pushTri(a, b, c);
      pushTri(a, c, d);
    }
  }

  tris.sort((m, n) => m.depth - n.depth);
  for (const tri of tris) {
    const r = tri.outside
      ? Math.round(170 + (230 - 170) * tri.shade)
      : Math.round(210 + (255 - 210) * tri.shade);
    const g = tri.outside
      ? Math.round(184 + (238 - 184) * tri.shade)
      : Math.round(220 + (255 - 220) * tri.shade);
    const b = tri.outside
      ? Math.round(205 + (248 - 205) * tri.shade)
      : Math.round(234 + (255 - 234) * tri.shade);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.beginPath();
    ctx.moveTo(tri.a.x, tri.a.y);
    ctx.lineTo(tri.b.x, tri.b.y);
    ctx.lineTo(tri.c.x, tri.c.y);
    ctx.closePath();
    ctx.fill();
  }

  const rim = grid[radialSteps].map((v) => ({ x: v.x, y: v.y }));
  if (rim.length >= 3) drawHyperboloidRim(ctx, rim);
  return { rim };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, scale:number, cameraZ:number}} vp
 * @param {Array<{x:number,y:number}>} points
 * @param {{color:string,opacity:number}} style
 * @param {string} label
 * @param {boolean} isSelected
 */
function drawHyperboloidCurve(ctx, view, vp, points, style, label, isSelected) {
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = isSelected ? 3 : 2;
  const maxR2 = HYPERBOLOID_SURFACE_RADIUS * HYPERBOLOID_SURFACE_RADIUS + 1e-9;

  /** @type {Array<{x:number,y:number,depth:number,normal:{x:number,y:number,z:number},frontFacing:boolean} | null>} */
  const screenPts = [];
  /** @type {boolean[]} */
  const frontMask = [];
  for (const p of points) {
    if (p.x * p.x + p.y * p.y > maxR2) {
      screenPts.push(null);
      frontMask.push(false);
      continue;
    }
    const s = projectHyperboloidVertex(view, vp, p);
    if (!s) {
      screenPts.push(null);
      frontMask.push(false);
      continue;
    }
    screenPts.push(s);
    frontMask.push(s.frontFacing);
  }

  ctx.setLineDash([6, 6]);
  ctx.globalAlpha = style.opacity * 0.25;
  drawPolylineMasked(ctx, screenPts, frontMask, false);

  ctx.setLineDash([]);
  ctx.globalAlpha = style.opacity;
  drawPolylineMasked(ctx, screenPts, frontMask, true);

  /** @type {Array<{x:number,y:number,depth:number,normal:{x:number,y:number,z:number},frontFacing:boolean}>} */
  const visiblePts = [];
  /** @type {Array<{x:number,y:number,depth:number,normal:{x:number,y:number,z:number},frontFacing:boolean}>} */
  const frontPts = [];
  for (const p of screenPts) {
    if (!p) continue;
    visiblePts.push(p);
    if (p.frontFacing) frontPts.push(p);
  }

  if (visiblePts.length > 0) {
    const labelSource = frontPts.length > 0 ? frontPts : visiblePts;
    const mid = labelSource[Math.floor(labelSource.length / 2)];
    drawCurveLabel(ctx, label, mid.x, mid.y);
  }
  ctx.restore();
}

/**
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, scale:number, cameraZ:number}} vp
 * @param {number} radius
 * @param {number} steps
 */
function collectHyperboloidRim(view, vp, radius, steps) {
  /** @type {Array<{x:number,y:number}>} */
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const s = projectHyperboloidVertex(view, vp, { x: radius * Math.cos(t), y: radius * Math.sin(t) });
    if (!s) return [];
    pts.push({ x: s.x, y: s.y });
  }
  return pts;
}

/**
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, scale:number, cameraZ:number}} vp
 * @param {{x:number,y:number}} p
 */
function projectHyperboloidVertex(view, vp, p) {
  const h = poincareToHyperboloid(p);
  const v = rotateToView(view, h);
  const den = vp.cameraZ - v.z;
  if (den <= 1e-5) return null;
  const k = vp.scale / den;
  const normalWorld = norm3({ x: -h.x, y: -h.y, z: h.z });
  const normalView = rotateToView(view, normalWorld);
  const hidden = isHyperboloidPointHidden(view, vp, h);
  return {
    x: vp.cx + v.x * k,
    y: vp.cy - v.y * k,
    depth: v.z,
    normal: normalView,
    frontFacing: !hidden,
  };
}

/**
 * Whether a surface point is occluded by another point on the hyperboloid along
 * the camera ray before reaching that point.
 *
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cameraZ:number}} vp
 * @param {{x:number,y:number,z:number}} h
 */
function isHyperboloidPointHidden(view, vp, h) {
  const cameraView = { x: 0, y: 0, z: vp.cameraZ };
  const cameraWorld = rotateFromView(view, cameraView);
  const dir = { x: h.x - cameraWorld.x, y: h.y - cameraWorld.y, z: h.z - cameraWorld.z };

  const a = minkowskiDot3(dir, dir);
  const b = 2 * minkowskiDot3(cameraWorld, dir);
  const c = minkowskiDot3(cameraWorld, cameraWorld) - 1;
  if (Math.abs(a) < 1e-12) return false;
  const disc = b * b - 4 * a * c;
  if (disc <= 1e-12) return false;
  const sd = Math.sqrt(Math.max(0, disc));
  const t1 = (-b - sd) / (2 * a);
  const t2 = (-b + sd) / (2 * a);
  return hasEarlierIntersection(t1, cameraWorld, dir) || hasEarlierIntersection(t2, cameraWorld, dir);
}

/**
 * @param {number} t
 * @param {{x:number,y:number,z:number}} cameraWorld
 * @param {{x:number,y:number,z:number}} dir
 */
function hasEarlierIntersection(t, cameraWorld, dir) {
  if (!Number.isFinite(t)) return false;
  if (t <= 1e-5 || t >= 1 - 1e-5) return false;
  const q = {
    x: cameraWorld.x + dir.x * t,
    y: cameraWorld.y + dir.y * t,
    z: cameraWorld.z + dir.z * t,
  };
  if (!(q.z > 0)) return false;
  const p = hyperboloidToPoincare(q);
  if (!p) return false;
  const r2 = p.x * p.x + p.y * p.y;
  return r2 <= HYPERBOLOID_SURFACE_RADIUS * HYPERBOLOID_SURFACE_RADIUS + 1e-9;
}

/** @param {{x:number,y:number,z:number}} a @param {{x:number,y:number,z:number}} b */
function minkowskiDot3(a, b) {
  return a.z * b.z - a.x * b.x - a.y * b.y;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x:number,y:number}>} points
 */
function beginClosedPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x:number,y:number}>} rim
 */
function drawHyperboloidRim(ctx, rim) {
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.5;
  beginClosedPath(ctx, rim);
  ctx.stroke();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, r:number}} vp
 * @param {{normal:{x:number,y:number,z:number}, d:number}} plane
 * @param {{color:string,opacity:number}} style
 * @param {string} label
 * @param {boolean} isSelected
 */
function drawSpherePlaneCurve(ctx, view, vp, plane, style, label, isSelected) {
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = isSelected ? 3 : 2;

  const n = norm3(plane.normal);
  const d = plane.d;
  // Find a basis (e1,e2) for the plane.
  const ref = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const e1 = norm3(cross3Safe(ref, n));
  const e2 = cross3Safe(n, e1);

  // For plane n·x = d, circle exists if |d| <= 1.
  const rr = 1 - d * d;
  if (rr < 1e-10) {
    ctx.restore();
    return;
  }
  const r3 = Math.sqrt(rr);
  const center = { x: n.x * d, y: n.y * d, z: n.z * d };

  const steps = 240;
  /** @type {{x:number,y:number,z:number}[]} */
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const p = {
      x: center.x + r3 * (e1.x * Math.cos(t) + e2.x * Math.sin(t)),
      y: center.y + r3 * (e1.y * Math.cos(t) + e2.y * Math.sin(t)),
      z: center.z + r3 * (e1.z * Math.cos(t) + e2.z * Math.sin(t)),
    };
    pts.push(p);
  }

  // Draw back segments lightly, front segments strongly.
  const proj = pts.map((p) => {
    const v = rotateToView(view, p);
    return projectSphere(v, vp);
  });
  const frontMask = proj.map((p) => p.z >= 0);

  ctx.setLineDash([6, 6]);
  ctx.globalAlpha = style.opacity * 0.25;
  drawPolylineMasked(ctx, proj, frontMask, false);

  ctx.setLineDash([]);
  ctx.globalAlpha = style.opacity;
  drawPolylineMasked(ctx, proj, frontMask, true);

  const mid = proj[Math.floor(proj.length / 2)];
  drawCurveLabel(ctx, label, mid.x, mid.y);

  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{kind:"2d", scale:number, offsetX:number, offsetY:number}} view
 * @param {{normal:{x:number,y:number,z:number}, d:number}} plane
 * @param {{color:string,opacity:number}} style
 * @param {string} label
 * @param {boolean} isSelected
 * @param {number} cssW
 * @param {number} cssH
 */
function drawStereographicPlaneCurve(ctx, view, plane, style, label, isSelected, cssW, cssH) {
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = isSelected ? 3 : 2;

  const spherePts = sampleSpherePlanePoints(plane, 440);
  const screenPts = spherePts.map((p) => projectSphericalPointToStereographicScreen(view, p));
  drawScreenPolylineWithBreaks(ctx, screenPts, Math.max(cssW, cssH) * 0.6);

  const finite = screenPts.filter((p) => !!p);
  if (finite.length > 0) {
    const labelPoint = finite[Math.floor(finite.length / 2)];
    drawCurveLabel(ctx, label, labelPoint.x, labelPoint.y);
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{kind:"sphere", yaw:number, pitch:number, zoom:number}} view
 * @param {{cx:number, cy:number, r:number}} vp
 * @param {{id:string,label:string,x:number,y:number,z:number,style:{color:string,opacity:number},locked?:boolean}} p
 * @param {boolean} highlight
 */
function drawSpherePoint(ctx, view, vp, p, highlight) {
  const v = rotateToView(view, { x: p.x, y: p.y, z: p.z });
  const s = projectSphere(v, vp);
  if (s.z < -0.001) ctx.globalAlpha = p.style.opacity * 0.35;
  else ctx.globalAlpha = p.style.opacity;
  ctx.fillStyle = p.style.color;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 4.2, 0, Math.PI * 2);
  ctx.fill();

  if (highlight) {
    ctx.strokeStyle = "rgba(37,99,235,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 9.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillText(p.label, s.x + 8, s.y - 8);
}

/** @param {{x:number,y:number,z:number}} a @param {{x:number,y:number,z:number}} b */
function cross3Safe(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/**
 * Draw a polyline while masking to either front or back hemisphere segments.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x:number,y:number} | null>} pts
 * @param {boolean[]} frontMask
 * @param {boolean} wantFront
 */
function drawPolylineMasked(ctx, pts, frontMask, wantFront) {
  let started = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const ok = !!p && frontMask[i] === wantFront;
    if (!ok) {
      if (started) ctx.stroke();
      started = false;
      continue;
    }
    if (!started) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  if (started) ctx.stroke();
}

/**
 * Draw screen-space polyline while splitting at singular jumps.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x:number,y:number} | null>} pts
 * @param {number} maxJumpPx
 */
function drawScreenPolylineWithBreaks(ctx, pts, maxJumpPx) {
  let started = false;
  /** @type {{x:number,y:number} | null} */
  let prev = null;
  for (const p of pts) {
    if (!p) {
      if (started) ctx.stroke();
      started = false;
      prev = null;
      continue;
    }
    if (!started) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      started = true;
      prev = p;
      continue;
    }
    const jump = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
    if (jump > maxJumpPx) {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      prev = p;
      continue;
    }
    ctx.lineTo(p.x, p.y);
    prev = p;
  }
  if (started) ctx.stroke();
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
