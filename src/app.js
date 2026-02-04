import { GeometryType, ToolType, createInitialState } from "./engine/state.js";
import { installContextMenu } from "./ui/contextMenu.js";
import { attachCanvasController } from "./engine/inputController.js";
import { createRenderer } from "./engine/renderer.js";

/**
 * @param {{
 *  canvas: HTMLCanvasElement,
 *  geometrySelect: HTMLSelectElement,
 *  toolButtons: NodeListOf<HTMLButtonElement>,
 *  statusText: HTMLDivElement,
 *  toolHint: HTMLDivElement,
 *  contextMenu: HTMLDivElement
 * }} deps
 */
export function createApp(deps) {
  const state = createInitialState();
  const renderer = createRenderer(deps.canvas, state);

  const ctxMenu = installContextMenu(deps.contextMenu, {
    getState: () => state,
    requestRender: () => renderer.requestRender(),
  });

  attachCanvasController(deps.canvas, {
    getState: () => state,
    requestRender: () => renderer.requestRender(),
    openContextMenu: ctxMenu.openAt,
    closeContextMenu: ctxMenu.close,
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

  updateToolHint();
  setActiveToolButton(state.activeTool);
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

