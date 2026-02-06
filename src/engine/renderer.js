import { GeometryType } from "./state.js";
import { derive2DCircleCurve, derive2DLineCurve, deriveSphereCircle, deriveSphereGreatCircle } from "./geometry.js";
import { intersectCurves } from "./geom2d.js";
import { initialize2DViewIfNeeded, worldToScreen } from "./view2d.js";
import { projectSphere, rotateToView } from "./sphereView.js";
import { norm3 } from "./vec3.js";

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
        geom === GeometryType.SPHERICAL
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

  if (geom === GeometryType.HYPERBOLIC_POINCARE) {
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
    draw2DPoint(ctx, view, p, highlight);
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
 * @param {{id:string,label:string,x:number,y:number,z?:number,style:{color:string,opacity:number},locked?:boolean}} p
 * @param {boolean} highlight
 */
function draw2DPoint(ctx, view, p, highlight) {
  const s = worldToScreen(view, { x: p.x, y: p.y });
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
 * @param {{x:number,y:number,z:number}[]} pts
 * @param {boolean[]} frontMask
 * @param {boolean} wantFront
 */
function drawPolylineMasked(ctx, pts, frontMask, wantFront) {
  let started = false;
  for (let i = 0; i < pts.length; i++) {
    const ok = frontMask[i] === wantFront;
    if (!ok) {
      if (started) ctx.stroke();
      started = false;
      continue;
    }
    const p = pts[i];
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
