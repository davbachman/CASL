import { GeometryType, ToolType, createInitialState } from "./engine/state.js";
import { createHistory } from "./engine/history.js";
import { installContextMenu } from "./ui/contextMenu.js";
import { attachCanvasController } from "./engine/inputController.js";
import { createRenderer } from "./engine/renderer.js";

/**
 * @param {{
 *  canvas: HTMLCanvasElement,
 *  geometrySelect: HTMLSelectElement,
 *  toolButtons: NodeListOf<HTMLButtonElement>,
 *  undoButton: HTMLButtonElement,
 *  historyToggleButton: HTMLButtonElement,
 *  statusText: HTMLDivElement,
 *  toolHint: HTMLDivElement,
 *  contextMenu: HTMLDivElement,
 *  historyPane: HTMLDivElement,
 *  historyList: HTMLOListElement,
 *  historyEmpty: HTMLDivElement
 * }} deps
 */
export function createApp(deps) {
  const state = createInitialState();
  ensureInversiveInfinityPoint(state);
  const history = createHistory(state);
  const renderer = createRenderer(deps.canvas, state);
  let lastHistorySignature = "";

  const setHistoryOpen = (open) => {
    deps.historyPane.classList.toggle("is-collapsed", !open);
    deps.historyPane.style.display = open ? "flex" : "none";
    deps.historyPane.hidden = !open;
    deps.historyToggleButton.setAttribute("aria-expanded", String(open));
    deps.historyToggleButton.textContent = open ? "Hide History" : "History";
  };

  const updateUndoButton = () => {
    deps.undoButton.disabled = !history.canUndo(state.activeGeometry);
  };

  const pushHistory = () => {
    history.push(state.activeGeometry);
    updateUndoButton();
  };

  const ctxMenu = installContextMenu(deps.contextMenu, {
    getState: () => state,
    requestRender: () => renderer.requestRender(),
    pushHistory,
  });

  attachCanvasController(deps.canvas, {
    getState: () => state,
    requestRender: () => renderer.requestRender(),
    openContextMenu: ctxMenu.openAt,
    closeContextMenu: ctxMenu.close,
    pushHistory,
  });

  const setActiveToolButton = (tool) => {
    for (const btn of deps.toolButtons) {
      btn.classList.toggle("is-active", btn.dataset.tool === tool);
    }
  };

  const updateToolHint = () => {
    const geomLabel = geometryDisplayName(state.activeGeometry);
    const hint =
      state.activeTool === ToolType.LINE
        ? "Click two points to create a line/geodesic."
        : state.activeTool === ToolType.CIRCLE
          ? "Click center, then a radius point to create a circle."
          : "Click two lines/circles to create intersection point(s).";
    deps.toolHint.textContent = `${geomLabel}: ${hint}`;
  };

  deps.geometrySelect.addEventListener("change", () => {
    const next = /** @type {GeometryType} */ (deps.geometrySelect.value);
    state.activeGeometry = next;
    state.pending = null;
    state.selection = null;
    ctxMenu.close();
    updateToolHint();
    updateUndoButton();
    renderer.requestRender(true);
  });

  for (const btn of deps.toolButtons) {
    btn.addEventListener("click", () => {
      const tool = /** @type {ToolType} */ (btn.dataset.tool);
      state.activeTool = tool;
      state.pending = null;
      state.selection = null;
      ctxMenu.close();
      setActiveToolButton(tool);
      updateToolHint();
      renderer.requestRender(true);
    });
  }

  const doUndo = () => {
    ctxMenu.close();
    state.pending = null;
    state.selection = null;
    const ok = history.undo(state.activeGeometry);
    if (!ok) return;
    ensureInversiveInfinityPoint(state);
    updateUndoButton();
    renderer.requestRender(true);
  };

  deps.undoButton.addEventListener("click", doUndo);
  window.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
    if (e.key.toLowerCase() !== "z") return;
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    doUndo();
  });

  deps.historyToggleButton.addEventListener("click", () => {
    const isOpen = !deps.historyPane.hidden;
    setHistoryOpen(!isOpen);
  });

  updateToolHint();
  setActiveToolButton(state.activeTool);
  updateUndoButton();
  setHistoryOpen(false);
  renderer.requestRender(true);

  const tick = () => {
    renderer.drawIfNeeded();
    const { text } = renderer.getLastRenderInfo();
    deps.statusText.textContent = text;
    renderHistoryIfNeeded();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  function renderHistoryIfNeeded() {
    const doc = state.docs[state.activeGeometry];
    const steps = doc.historySteps ?? [];
    const lines = steps.map((step) => formatHistoryStep(doc, step)).filter(Boolean);
    const signature = lines.join("\n");
    if (signature === lastHistorySignature) return;
    lastHistorySignature = signature;
    deps.historyList.innerHTML = "";
    if (lines.length === 0) {
      deps.historyEmpty.style.display = "block";
      return;
    }
    deps.historyEmpty.style.display = "none";
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      deps.historyList.appendChild(li);
    }
  }
}

/** @param {GeometryType} geom */
function geometryDisplayName(geom) {
  switch (geom) {
    case GeometryType.EUCLIDEAN:
      return "Euclidean";
    case GeometryType.INVERSIVE_EUCLIDEAN:
      return "Inversive Euclidean";
    case GeometryType.SPHERICAL:
      return "Spherical";
    case GeometryType.HYPERBOLIC_POINCARE:
      return "Hyperbolic (Poincaré)";
    case GeometryType.HYPERBOLIC_HALF_PLANE:
      return "Hyperbolic (Half-plane)";
    default:
      return geom;
  }
}

/**
 * @param {import("./engine/state.js").ConstructionDoc} doc
 * @param {import("./engine/state.js").HistoryStep} step
 */
function formatHistoryStep(doc, step) {
  if (step.type === "point") {
    const pLabel = getPointLabel(doc, step.pointId);
    if (step.on) {
      const curveLabel = getCurveLabel(doc, step.on);
      const kindWord = step.on.kind === "line" ? "line" : "circle";
      return `Let ${pLabel} be a point on the ${kindWord} ${curveLabel}.`;
    }
    return `Let ${pLabel} be a point.`;
  }
  if (step.type === "line") {
    const line = doc.lines.find((l) => l.id === step.lineId);
    if (!line) return null;
    const pLabel = getPointLabel(doc, line.p1);
    const qLabel = getPointLabel(doc, line.p2);
    return `Construct the line ${line.label} through ${pLabel} and ${qLabel}.`;
  }
  if (step.type === "circle") {
    const circle = doc.circles.find((c) => c.id === step.circleId);
    if (!circle) return null;
    const centerLabel = getPointLabel(doc, circle.center);
    const radiusLabel = getPointLabel(doc, circle.radiusPoint);
    return `Construct the circle ${circle.label} with center ${centerLabel} through the point ${radiusLabel}.`;
  }
  if (step.type === "intersection") {
    const pLabel = getPointLabel(doc, step.pointId);
    const aLabel = getCurveLabel(doc, step.a);
    const bLabel = getCurveLabel(doc, step.b);
    return `Let ${pLabel} be the intersection point of ${aLabel} and ${bLabel}.`;
  }
  return null;
}

/** @param {import("./engine/state.js").ConstructionDoc} doc @param {string} id */
function getPointLabel(doc, id) {
  const p = doc.points.find((pt) => pt.id === id);
  return p?.label ?? "?";
}

/**
 * @param {import("./engine/state.js").ConstructionDoc} doc
 * @param {{kind:"line"|"circle", id:string}} ref
 */
function getCurveLabel(doc, ref) {
  if (ref.kind === "line") return doc.lines.find((l) => l.id === ref.id)?.label ?? "?";
  return doc.circles.find((c) => c.id === ref.id)?.label ?? "?";
}

/** @param {import("./engine/state.js").AppState} state */
function ensureInversiveInfinityPoint(state) {
  const doc = state.docs[GeometryType.INVERSIVE_EUCLIDEAN];
  if (!doc?.starPointId) return;
  const star = doc.points.find((p) => p.id === doc.starPointId);
  if (!star) return;
  star.label = "∞";
}

/** @param {EventTarget | null} target */
function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}
