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
 *  statusText: HTMLDivElement,
 *  toolHint: HTMLDivElement,
 *  contextMenu: HTMLDivElement
 * }} deps
 */
export function createApp(deps) {
  const state = createInitialState();
  ensureInversiveInfinityPoint(state);
  const history = createHistory(state);
  const renderer = createRenderer(deps.canvas, state);

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

  updateToolHint();
  setActiveToolButton(state.activeTool);
  updateUndoButton();
  renderer.requestRender(true);

  const tick = () => {
    renderer.drawIfNeeded();
    const { text } = renderer.getLastRenderInfo();
    deps.statusText.textContent = text;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
