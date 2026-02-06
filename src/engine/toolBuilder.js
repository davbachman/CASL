import { GeometryType } from "./state.js";
import { derive2DCircleCurve, derive2DLineCurve } from "./geometry.js";
import { signedDistanceToCurve } from "./geom2d.js";
import { norm3 } from "./vec3.js";

/**
 * Build a custom tool definition from selected inputs/outputs.
 *
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {string} name
 * @param {Array<{kind:"point"|"line"|"circle", id:string}>} inputs
 * @param {{kind:"point"|"line"|"circle", id:string}} output
 * @returns {{tool: import("./state.js").CustomTool | null, error: string | null}}
 */
export function buildCustomToolDefinition(geom, doc, name, inputs, output) {
  if (inputs.some((ref) => ref.kind === output.kind && ref.id === output.id)) {
    return { tool: null, error: "Output must be derived from inputs." };
  }
  if (output.kind === "point") {
    const outPoint = doc.points.find((p) => p.id === output.id);
    if (outPoint && (!outPoint.constraints || outPoint.constraints.length === 0)) {
      return { tool: null, error: "Output must be derived from inputs." };
    }
  }
  const inputMap = new Map(inputs.map((ref, idx) => [refKey(ref), idx]));
  const nodeMap = new Map();
  /** @type {import("./state.js").ToolStep[]} */
  const steps = [];
  let nodeCounter = 0;
  const circleLineIntersectionRefs = new Map();

  const isFreePoint = (point) => {
    if (!point) return false;
    if (point.locked) return false;
    return !point.constraints || point.constraints.length === 0;
  };

  const buildNode = (ref) => {
    const key = refKey(ref);
    if (nodeMap.has(key)) return nodeMap.get(key);

    const inputIndex = inputMap.get(key);
    if (inputIndex != null) {
      const id = `in${inputIndex}`;
      nodeMap.set(key, id);
      steps.push({ id, kind: ref.kind, op: "input", inputIndex });
      return id;
    }

    if (ref.kind === "point") {
      const point = doc.points.find((p) => p.id === ref.id);
      if (!point) throw new Error("Point not found.");
      if (point.locked || !point.constraints || point.constraints.length === 0) {
        if (!point.locked) {
          const onInput = buildPointOnInputCurveHint(geom, doc, point, inputs, buildNode);
          if (onInput) {
            const id = `n${nodeCounter++}`;
            steps.push({
              id,
              kind: "point",
              op: "point_on",
              curve: onInput.curveNodeId,
              curveHint: onInput.curveHint,
            });
            nodeMap.set(key, id);
            return id;
          }
        }
        const id = `n${nodeCounter++}`;
        if (geom === GeometryType.SPHERICAL) {
          if (point.z == null) throw new Error("Invalid spherical point.");
          const u = norm3({ x: point.x, y: point.y, z: point.z });
          steps.push({ id, kind: "point", op: "point_fixed", x: u.x, y: u.y, z: u.z });
        } else {
          steps.push({ id, kind: "point", op: "point_fixed", x: point.x, y: point.y });
        }
        nodeMap.set(key, id);
        return id;
      }
      if (point.constraints.length >= 2) {
        const a = point.constraints[0];
        const b = point.constraints[1];
        const aNode = buildNode(a);
        const bNode = buildNode(b);
        const id = `n${nodeCounter++}`;
        const hints = [];
        const hintA = buildSingleCurveHint2D(geom, doc, a, point);
        if (hintA) hints.push({ nodeId: aNode, ...hintA });
        const hintB = buildSingleCurveHint2D(geom, doc, b, point);
        if (hintB) hints.push({ nodeId: bNode, ...hintB });
        const curveHints = hints.length > 0 ? hints : undefined;
        const lineRef = buildLineRefHint(geom, doc, point, a, b, aNode, bNode, buildNode);
        const lineSide = buildLineSideHint(geom, doc, point, a, b, buildNode);
        const circleSide = buildCircleSideHint(geom, doc, point, a, b);
        const sphereHint = buildSphereHint(point);
        const orientRef = buildOrientationHint(doc, point, a, b, aNode, bNode, buildNode);
        const avoidPointRef = buildAvoidPointRef(geom, doc, point, a, b, buildNode);
        const circleConstraint = a.kind === "circle" ? a : b.kind === "circle" ? b : null;
        const lineConstraint = a.kind === "line" ? a : b.kind === "line" ? b : null;
        let pairRef = null;
        if (geom !== GeometryType.SPHERICAL && circleConstraint && lineConstraint) {
          const circle = doc.circles.find((c) => c.id === circleConstraint.id);
          if (circle) {
            const centerPoint = doc.points.find((p) => p.id === circle.center);
            if (centerPoint) {
              const existing = circleLineIntersectionRefs.get(circleConstraint.id);
              if (existing) {
                const otherPoint = doc.points.find((p) => p.id === existing.pointId);
                if (otherPoint) {
                  const v1 = { x: otherPoint.x - centerPoint.x, y: otherPoint.y - centerPoint.y };
                  const v2 = { x: point.x - centerPoint.x, y: point.y - centerPoint.y };
                  const cross = v1.x * v2.y - v1.y * v2.x;
                  const dot = v1.x * v2.x + v1.y * v2.y;
                  const angle = Math.atan2(cross, dot);
                  if (Number.isFinite(angle)) {
                    const originNodeId = buildNode({ kind: "point", id: circle.center });
                    pairRef = { originNodeId, otherPointNodeId: existing.nodeId, angle };
                  }
                }
              }
            }
          }
        }
        steps.push({
          id,
          kind: "point",
          op: "intersection",
          a: aNode,
          b: bNode,
          ...(curveHints ? { curveHints } : {}),
          ...(sphereHint ? { sphereHint } : {}),
          ...(lineRef ? { lineRef } : {}),
          ...(lineSide ? { lineSide } : {}),
          ...(circleSide ? { circleSide } : {}),
          ...(orientRef ? { orientRef } : {}),
          ...(pairRef ? { pairRef } : {}),
          ...(avoidPointRef ? { avoidPointRef } : {}),
        });
        nodeMap.set(key, id);
        if (geom !== GeometryType.SPHERICAL && circleConstraint && lineConstraint) {
          circleLineIntersectionRefs.set(circleConstraint.id, { pointId: point.id, nodeId: id });
        }
        return id;
      }
      if (point.constraints.length === 1) {
        const c = point.constraints[0];
        const curveNode = buildNode(c);
        const id = `n${nodeCounter++}`;
        const curveInfo = buildPointOnInputCurveHint(geom, doc, point, inputs, buildNode);
        const lineOffsetRef =
          curveInfo?.lineOffsetRef ??
          (c.kind === "line" ? buildLineOffsetRefForRadiusPoint(geom, doc, point, c, inputs, buildNode) : null);
        const curveHint = curveInfo?.curveHint ?? buildSingleCurveHint2D(geom, doc, c, point) ?? undefined;
        const sphereHint = buildSphereHint(point);
        steps.push({
          id,
          kind: "point",
          op: "point_on",
          curve: curveNode,
          ...(curveHint ? { curveHint } : {}),
          ...(lineOffsetRef ? { lineOffsetRef } : {}),
          ...(sphereHint ? { sphereHint } : {}),
        });
        nodeMap.set(key, id);
        return id;
      }
      throw new Error("Unsupported point definition.");
    }

    if (ref.kind === "line") {
      const line = doc.lines.find((l) => l.id === ref.id);
      if (!line) throw new Error("Line not found.");
      const p1Node = buildNode({ kind: "point", id: line.p1 });
      const p2Node = buildNode({ kind: "point", id: line.p2 });
      const id = `n${nodeCounter++}`;
      steps.push({ id, kind: "line", op: "line", p1: p1Node, p2: p2Node });
      nodeMap.set(key, id);
      return id;
    }

    if (ref.kind === "circle") {
      const circle = doc.circles.find((c) => c.id === ref.id);
      if (!circle) throw new Error("Circle not found.");
      const centerPoint = doc.points.find((p) => p.id === circle.center);
      const radiusPoint = doc.points.find((p) => p.id === circle.radiusPoint);
      const cNode = buildNode({ kind: "point", id: circle.center });
      const radiusKey = refKey({ kind: "point", id: circle.radiusPoint });

      if (
        geom !== GeometryType.SPHERICAL &&
        radiusPoint &&
        isFreePoint(radiusPoint) &&
        !inputMap.has(radiusKey)
      ) {
        if (!centerPoint) throw new Error("Circle center not found.");
        const dx = radiusPoint.x - centerPoint.x;
        const dy = radiusPoint.y - centerPoint.y;
        const r = Math.hypot(dx, dy);
        if (!Number.isFinite(r) || r <= 1e-9) throw new Error("Circle radius must be nonzero.");
        const angle = Math.atan2(dy, dx);
        const id = `n${nodeCounter++}`;
        steps.push({ id, kind: "circle", op: "circle_fixed", center: cNode, radius: r, angle });
        nodeMap.set(key, id);
        return id;
      }

      const rNode = buildNode({ kind: "point", id: circle.radiusPoint });
      const id = `n${nodeCounter++}`;
      steps.push({ id, kind: "circle", op: "circle", center: cNode, radius: rNode });
      nodeMap.set(key, id);
      return id;
    }

    throw new Error("Unsupported geometry.");
  };

  try {
    const outputNode = buildNode(output);
    const tool = {
      id: "",
      name: name.trim() || "Custom Tool",
      inputs: inputs.map((ref) => ({ kind: ref.kind })),
      steps,
      output: { kind: output.kind, nodeId: outputNode },
    };
    return { tool, error: null };
  } catch (err) {
    return { tool: null, error: err instanceof Error ? err.message : "Unable to build tool." };
  }
}

/** @param {{kind:"point"|"line"|"circle", id:string}} ref */
function refKey(ref) {
  return `${ref.kind}:${ref.id}`;
}

/**
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{kind:"line"|"circle", id:string}} constraint
 * @param {{x:number,y:number,z?:number}} point
 */
function buildSingleCurveHint2D(geom, doc, constraint, point) {
  if (geom === GeometryType.SPHERICAL) return null;
  const curve = get2DCurveFromRef(geom, doc, constraint);
  if (!curve) return null;
  return curveHintForPoint(curve, point);
}

/** @param {{x:number,y:number,z?:number}} point */
function buildSphereHint(point) {
  if (point.z == null) return null;
  const u = norm3({ x: point.x, y: point.y, z: point.z });
  return { x: u.x, y: u.y, z: u.z };
}

/**
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{kind:"line"|"circle", id:string}} ref
 */
function get2DCurveFromRef(geom, doc, ref) {
  if (ref.kind === "line") {
    const line = doc.lines.find((l) => l.id === ref.id);
    return line ? derive2DLineCurve(geom, doc, line) : null;
  }
  const circle = doc.circles.find((c) => c.id === ref.id);
  return circle ? derive2DCircleCurve(geom, doc, circle) : null;
}

/**
 * @param {import("./geom2d.js").Curve2D} curve
 * @param {{x:number,y:number}} point
 */
function curveHintForPoint(curve, point) {
  if (curve.kind === "line") {
    const t = lineParamOnCurve(curve, point);
    if (!Number.isFinite(t)) return null;
    return { mode: "line", value: t };
  }
  const ang = Math.atan2(point.y - curve.cy, point.x - curve.cx);
  if (!Number.isFinite(ang)) return null;
  return { mode: "angle", value: ang };
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

/**
 * Build a line-relative hint for circle-line intersections, using the circle's center
 * as the reference point along the line.
 *
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{x:number,y:number}} point
 * @param {{kind:"line"|"circle", id:string}} a
 * @param {{kind:"line"|"circle", id:string}} b
 * @param {string} aNode
 * @param {string} bNode
 * @param {(ref:{kind:"point"|"line"|"circle", id:string}) => string} buildNode
 * @returns {{lineNodeId:string, refPointNodeId:string, value:number} | null}
 */
function buildLineRefHint(geom, doc, point, a, b, aNode, bNode, buildNode) {
  if (geom === GeometryType.SPHERICAL) return null;
  const lineConstraint = a.kind === "line" ? a : b.kind === "line" ? b : null;
  const circleConstraint = a.kind === "circle" ? a : b.kind === "circle" ? b : null;
  if (!lineConstraint || !circleConstraint) return null;
  const line = doc.lines.find((l) => l.id === lineConstraint.id);
  const circle = doc.circles.find((c) => c.id === circleConstraint.id);
  if (!line || !circle) return null;
  const centerPoint = doc.points.find((p) => p.id === circle.center);
  if (!centerPoint) return null;
  const curve = derive2DLineCurve(geom, doc, line);
  if (!curve || curve.kind !== "line") return null;
  const tPoint = lineParamOnCurve(curve, point);
  const tRef = lineParamOnCurve(curve, { x: centerPoint.x, y: centerPoint.y });
  if (!Number.isFinite(tPoint) || !Number.isFinite(tRef)) return null;
  const lineNodeId = lineConstraint === a ? aNode : bNode;
  const refPointNodeId = buildNode({ kind: "point", id: circle.center });
  return { lineNodeId, refPointNodeId, value: tPoint - tRef };
}

/**
 * Choose which side of the other line the circle-line intersection lies on.
 *
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{x:number,y:number}} point
 * @param {{kind:"line"|"circle", id:string}} a
 * @param {{kind:"line"|"circle", id:string}} b
 * @param {(ref:{kind:"point"|"line"|"circle", id:string}) => string} buildNode
 * @returns {{lineNodeId:string, sign:number} | null}
 */
function buildLineSideHint(geom, doc, point, a, b, buildNode) {
  if (geom === GeometryType.SPHERICAL) return null;
  const lineConstraint = a.kind === "line" ? a : b.kind === "line" ? b : null;
  const circleConstraint = a.kind === "circle" ? a : b.kind === "circle" ? b : null;
  if (!lineConstraint || !circleConstraint) return null;
  const circle = doc.circles.find((c) => c.id === circleConstraint.id);
  if (!circle) return null;
  const centerPoint = doc.points.find((p) => p.id === circle.center);
  if (!centerPoint || !centerPoint.constraints) return null;
  const lineConstraints = centerPoint.constraints.filter((c) => c.kind === "line").map((c) => c.id);
  if (lineConstraints.length < 2) return null;
  const otherLineId = lineConstraints.find((id) => id !== lineConstraint.id);
  if (!otherLineId) return null;
  const otherLine = doc.lines.find((l) => l.id === otherLineId);
  if (!otherLine) return null;
  const curve = derive2DLineCurve(geom, doc, otherLine);
  if (!curve || curve.kind !== "line") return null;
  const n = Math.hypot(curve.a, curve.b) || 1;
  let aN = curve.a / n;
  let bN = curve.b / n;
  let cN = curve.c / n;
  if (aN < 0 || (Math.abs(aN) < 1e-12 && bN < 0)) {
    aN = -aN;
    bN = -bN;
    cN = -cN;
  }
  const value = aN * point.x + bN * point.y + cN;
  const sign = Math.sign(value);
  if (!sign) return null;
  const lineNodeId = buildNode({ kind: "line", id: otherLineId });
  return { lineNodeId, sign };
}

/**
 * Choose which side of the center-to-center line an intersection lies on (circle-circle).
 *
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{x:number,y:number}} point
 * @param {{kind:"line"|"circle", id:string}} a
 * @param {{kind:"line"|"circle", id:string}} b
 * @returns {{sign:number} | null}
 */
function buildCircleSideHint(geom, doc, point, a, b) {
  if (geom === GeometryType.SPHERICAL) return null;
  if (a.kind !== "circle" || b.kind !== "circle") return null;
  const circleA = doc.circles.find((c) => c.id === a.id);
  const circleB = doc.circles.find((c) => c.id === b.id);
  if (!circleA || !circleB) return null;
  const cA = doc.points.find((p) => p.id === circleA.center);
  const cB = doc.points.find((p) => p.id === circleB.center);
  if (!cA || !cB) return null;
  const cross = (cB.x - cA.x) * (point.y - cA.y) - (cB.y - cA.y) * (point.x - cA.x);
  const sign = Math.sign(cross);
  if (!sign) return null;
  return { sign };
}

/**
 * Build an orientation hint for circle-circle intersections using a shared ancestor circle center.
 * This helps preserve which bisector (internal/external) was chosen.
 *
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{x:number,y:number}} point
 * @param {{kind:"line"|"circle", id:string}} a
 * @param {{kind:"line"|"circle", id:string}} b
 * @param {string} aNode
 * @param {string} bNode
 * @param {(ref:{kind:"point"|"line"|"circle", id:string}) => string} buildNode
 * @returns {{originNodeId:string, directionNodeId:string, sign:number} | null}
 */
function buildOrientationHint(doc, point, a, b, aNode, bNode, buildNode) {
  if (a.kind !== "circle" || b.kind !== "circle") return null;
  const circleA = doc.circles.find((c) => c.id === a.id);
  const circleB = doc.circles.find((c) => c.id === b.id);
  if (!circleA || !circleB) return null;
  const centerA = doc.points.find((p) => p.id === circleA.center);
  const centerB = doc.points.find((p) => p.id === circleB.center);
  if (!centerA || !centerB) return null;

  const commonCircleId = findCommonCircleConstraint(centerA, centerB);
  if (!commonCircleId) return null;
  const commonCircle = doc.circles.find((c) => c.id === commonCircleId);
  if (!commonCircle) return null;
  const originPoint = doc.points.find((p) => p.id === commonCircle.center);
  if (!originPoint) return null;

  const vDir = { x: centerA.x - originPoint.x, y: centerA.y - originPoint.y };
  const vPt = { x: point.x - originPoint.x, y: point.y - originPoint.y };
  const cross = vDir.x * vPt.y - vDir.y * vPt.x;
  const sign = Math.sign(cross);
  if (!sign) return null;
  const originNodeId = buildNode({ kind: "point", id: commonCircle.center });
  const directionNodeId = aNode;
  return { originNodeId, directionNodeId, sign };
}

/**
 * @param {{constraints?: Array<{kind:"line"|"circle", id:string}>}} pA
 * @param {{constraints?: Array<{kind:"line"|"circle", id:string}>}} pB
 * @returns {string | null}
 */
function findCommonCircleConstraint(pA, pB) {
  if (!pA.constraints || !pB.constraints) return null;
  const aCircles = pA.constraints.filter((c) => c.kind === "circle").map((c) => c.id);
  if (aCircles.length === 0) return null;
  for (const c of pB.constraints) {
    if (c.kind === "circle" && aCircles.includes(c.id)) return c.id;
  }
  return null;
}

/**
 * If a free point lies on an input curve, treat it as a point_on that curve.
 *
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{x:number,y:number,z?:number}} point
 * @param {Array<{kind:"point"|"line"|"circle", id:string}>} inputs
 * @param {(ref:{kind:"point"|"line"|"circle", id:string}) => string} buildNode
 * @returns {{curveNodeId: string, curveHint: {mode:"line"|"angle", value:number}} | null}
 */
function buildPointOnInputCurveHint(geom, doc, point, inputs, buildNode) {
  if (geom === GeometryType.SPHERICAL) return null;
  let best = null;
  let bestDist = Infinity;
  for (const ref of inputs) {
    if (ref.kind !== "line" && ref.kind !== "circle") continue;
    const curve = get2DCurveFromRef(geom, doc, ref);
    if (!curve) continue;
    const dist = Math.abs(signedDistanceToCurve(curve, point));
    if (dist < bestDist) {
      bestDist = dist;
      best = { ref, curve };
    }
  }
  if (!best) return null;
  if (bestDist > 1e-4) return null;
  const curveHint = curveHintForPoint(best.curve, point);
  if (!curveHint) return null;
  const curveNodeId = buildNode(best.ref);
  let lineOffsetRef = null;
  if (best.ref.kind === "line") {
    lineOffsetRef = buildLineOffsetRefForRadiusPoint(geom, doc, point, best.ref, inputs, buildNode);
  }
  return { curveNodeId, curveHint, lineOffsetRef };
}

/**
 * Build a line-offset reference for a point used as a circle radius point.
 *
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{id:string,x:number,y:number}} point
 * @param {{kind:"line", id:string}} lineRef
 * @param {Array<{kind:"point"|"line"|"circle", id:string}>} inputs
 * @param {(ref:{kind:"point"|"line"|"circle", id:string}) => string} buildNode
 * @returns {{originNodeId: string, offset: number} | null}
 */
function buildLineOffsetRefForRadiusPoint(geom, doc, point, lineRef, inputs, buildNode) {
  if (geom === GeometryType.SPHERICAL) return null;
  const circles = doc.circles.filter((c) => c.radiusPoint === point.id);
  if (circles.length === 0) return null;
  const inputPointIds = new Set(inputs.filter((r) => r.kind === "point").map((r) => r.id));
  const circle = circles.find((c) => inputPointIds.has(c.center)) ?? circles[0];
  const centerPoint = doc.points.find((p) => p.id === circle.center);
  if (!centerPoint) return null;
  const line = doc.lines.find((l) => l.id === lineRef.id);
  if (!line) return null;
  const curve = derive2DLineCurve(geom, doc, line);
  if (!curve || curve.kind !== "line") return null;
  const tPoint = lineParamOnCurve(curve, point);
  const tCenter = lineParamOnCurve(curve, centerPoint);
  if (!Number.isFinite(tPoint) || !Number.isFinite(tCenter)) return null;
  const originNodeId = buildNode({ kind: "point", id: circle.center });
  return { originNodeId, offset: tPoint - tCenter };
}

/**
 * If an intersection point should avoid an existing radius point on the line, record it.
 *
 * @param {GeometryType} geom
 * @param {import("./state.js").ConstructionDoc} doc
 * @param {{id:string,x:number,y:number}} point
 * @param {{kind:"line"|"circle", id:string}} a
 * @param {{kind:"line"|"circle", id:string}} b
 * @param {(ref:{kind:"point"|"line"|"circle", id:string}) => string} buildNode
 * @returns {{pointNodeId: string} | null}
 */
function buildAvoidPointRef(geom, doc, point, a, b, buildNode) {
  if (geom === GeometryType.SPHERICAL) return null;
  const lineRef = a.kind === "line" ? a : b.kind === "line" ? b : null;
  const circleRef = a.kind === "circle" ? a : b.kind === "circle" ? b : null;
  if (!lineRef || !circleRef) return null;
  const circle = doc.circles.find((c) => c.id === circleRef.id);
  if (!circle) return null;
  const radiusPoint = doc.points.find((p) => p.id === circle.radiusPoint);
  if (!radiusPoint || radiusPoint.id === point.id) return null;
  const line = doc.lines.find((l) => l.id === lineRef.id);
  if (!line) return null;
  const curve = derive2DLineCurve(geom, doc, line);
  if (!curve || curve.kind !== "line") return null;
  const dist = Math.abs(signedDistanceToCurve(curve, radiusPoint));
  if (dist > 1e-6) return null;
  const pointNodeId = buildNode({ kind: "point", id: radiusPoint.id });
  return { pointNodeId };
}
