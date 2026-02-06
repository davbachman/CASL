import { GeometryType, ToolType, createEmptyDoc, createInitialState } from "./engine/state.js";
import { createHistory } from "./engine/history.js";
import { buildCustomToolDefinition } from "./engine/toolBuilder.js?v=20260205-30";
import { installContextMenu } from "./ui/contextMenu.js";
import { attachCanvasController } from "./engine/inputController.js?v=20260205-30";
import { createRenderer } from "./engine/renderer.js";
import { makeId } from "./engine/util/ids.js";

/**
 * @param {{
 *  canvas: HTMLCanvasElement,
 *  geometrySelect: HTMLSelectElement,
 *  toolListRoot: HTMLDivElement,
 *  undoButton: HTMLButtonElement,
 *  clearButton: HTMLButtonElement,
 *  showStepsButton: HTMLButtonElement,
 *  historyToggleButton: HTMLButtonElement,
 *  buildToolButton: HTMLButtonElement,
 *  customToolList: HTMLDivElement,
 *  customToolsTitle: HTMLDivElement,
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
  deps.statusText.style.display = "none";

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

  const updateShowStepsButton = () => {
    deps.showStepsButton.textContent = state.showSteps ? "Hide Steps" : "Show Steps";
  };

  const updateDebugVisibility = () => {
    for (const geom of Object.values(GeometryType)) {
      const doc = state.docs[geom];
      for (const p of doc.points) {
        if (p.debug) p.hidden = !state.showSteps;
      }
      for (const l of doc.lines) {
        if (l.debug) l.hidden = !state.showSteps;
      }
      for (const c of doc.circles) {
        if (c.debug) c.hidden = !state.showSteps;
      }
    }
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
    const buttons = [
      ...deps.toolListRoot.querySelectorAll("[data-tool]"),
      ...deps.customToolList.querySelectorAll("[data-tool]"),
    ];
    for (const btn of buttons) {
      if (!(btn instanceof HTMLElement)) continue;
      btn.classList.toggle("is-active", btn.dataset.tool === tool);
    }
  };

  const updateToolHint = () => {
    const geomLabel = geometryDisplayName(state.activeGeometry);
    if (state.toolBuilder) {
      const stageHint =
        state.toolBuilder.stage === "inputs"
          ? "Select input geometry, then press Enter."
          : "Select output geometry.";
      const error = state.toolBuilder.error ? ` (${state.toolBuilder.error})` : "";
      deps.toolHint.textContent = `Tool Builder: ${stageHint}${error}`;
      return;
    }

    const customTool = getActiveCustomTool(state);
    if (customTool) {
      const selectedCount = state.toolUse?.inputs.length ?? 0;
      const next = customTool.inputs[selectedCount];
      if (next) {
        const label = next.kind === "point" ? "point" : next.kind === "line" ? "line" : "circle";
        const error = state.toolUseError ? ` (${state.toolUseError})` : "";
        deps.toolHint.textContent = `${geomLabel}: Select ${label} ${selectedCount + 1} of ${
          customTool.inputs.length
        } for ${customTool.name}.${error}`;
      } else {
        deps.toolHint.textContent = `${geomLabel}: Applying ${customTool.name}...`;
      }
      return;
    }

    const hint =
      state.activeTool === "point"
        ? "Create a new point"
        : state.activeTool === ToolType.LINE
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
    state.toolUse = null;
    state.toolUseError = null;
    state.toolUseError = null;
    if (state.activeTool.startsWith("custom:")) {
      const tool = getActiveCustomTool(state);
      if (!tool) state.activeTool = ToolType.LINE;
    }
    ctxMenu.close();
    renderCustomTools();
    updateToolHint();
    updateUndoButton();
    renderer.requestRender(true);
  });

  const handleToolClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tool]") : null;
    if (!(target instanceof HTMLElement)) return;
    const tool = target.dataset.tool;
    if (!tool) return;
    state.activeTool = tool;
    state.pending = null;
    state.selection = null;
    state.toolUse = null;
    state.toolUseError = null;
    state.toolBuilder = null;
    state.toolUseError = null;
    ctxMenu.close();
    setActiveToolButton(tool);
    updateToolHint();
    renderer.requestRender(true);
  };

  deps.toolListRoot.addEventListener("click", handleToolClick);
  deps.customToolList.addEventListener("click", handleToolClick);

  const doUndo = () => {
    ctxMenu.close();
    state.pending = null;
    state.selection = null;
    state.toolUse = null;
    state.toolUseError = null;
    const ok = history.undo(state.activeGeometry);
    if (!ok) return;
    ensureInversiveInfinityPoint(state);
    updateUndoButton();
    renderer.requestRender(true);
  };

  deps.undoButton.addEventListener("click", doUndo);

  const doClear = () => {
    ctxMenu.close();
    state.pending = null;
    state.selection = null;
    state.toolUse = null;
    state.toolUseError = null;
    history.clear(state.activeGeometry);
    state.docs[state.activeGeometry] = createEmptyDoc(state.activeGeometry);
    ensureInversiveInfinityPoint(state);
    updateUndoButton();
    renderer.requestRender(true);
  };

  deps.clearButton.addEventListener("click", doClear);

  deps.showStepsButton.addEventListener("click", () => {
    state.showSteps = !state.showSteps;
    updateDebugVisibility();
    updateShowStepsButton();
    renderer.requestRender(true);
  });
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

  deps.buildToolButton.addEventListener("click", () => {
    const name = window.prompt("Name your new tool:", "");
    if (!name) return;
    state.toolBuilder = { name: name.trim(), stage: "inputs", inputs: [] };
    state.activeTool = ToolType.LINE;
    state.pending = null;
    state.selection = null;
    state.toolUse = null;
    state.toolUseError = null;
    ctxMenu.close();
    setActiveToolButton(state.activeTool);
    updateToolHint();
    renderer.requestRender(true);
  });

  updateToolHint();
  setActiveToolButton(state.activeTool);
  updateUndoButton();
  updateShowStepsButton();
  updateDebugVisibility();
  setHistoryOpen(false);
  renderCustomTools();
  renderer.requestRender(true);

  const tick = () => {
    renderer.drawIfNeeded();
    renderer.getLastRenderInfo();
    renderHistoryIfNeeded();
    if (state.toolBuilder && state.toolBuilder.stage === "finalize") finalizeToolBuilder();
    if (state.toolBuilder || getActiveCustomTool(state)) updateToolHint();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.addEventListener("keydown", (e) => {
    if (isEditableTarget(e.target)) return;
    if (state.toolBuilder) {
      if (e.key === "Escape") {
        state.toolBuilder = null;
        state.toolUseError = null;
        updateToolHint();
        renderer.requestRender(true);
        return;
      }
      if (e.key === "Enter") {
        if (state.toolBuilder.stage === "inputs") {
          if (state.toolBuilder.inputs.length === 0) {
            state.toolBuilder.error = "Select at least one input.";
          } else {
            state.toolBuilder.error = undefined;
            state.toolBuilder.stage = "output";
          }
          updateToolHint();
          renderer.requestRender(true);
        }
      }
    } else if (state.toolUse && e.key === "Escape") {
      state.toolUse = null;
      updateToolHint();
      renderer.requestRender(true);
    }
  });

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

  function finalizeToolBuilder() {
    if (!state.toolBuilder || state.toolBuilder.stage !== "finalize" || !state.toolBuilder.output) return;
    const geom = state.activeGeometry;
    const doc = state.docs[geom];
    const { tool, error } = buildCustomToolDefinition(
      geom,
      doc,
      state.toolBuilder.name,
      state.toolBuilder.inputs,
      state.toolBuilder.output,
    );
    if (!tool || error) {
      state.toolBuilder.stage = "output";
      state.toolBuilder.error = error ?? "Unable to build tool.";
      updateToolHint();
      renderer.requestRender(true);
      return;
    }
    tool.id = makeId("t", state.nextToolId++);
    state.customTools[geom].push(tool);
    state.toolBuilder = null;
    renderCustomTools();
    updateToolHint();
    renderer.requestRender(true);
  }

  function renderCustomTools() {
    const tools = state.customTools[state.activeGeometry] ?? [];
    deps.customToolList.innerHTML = "";
    deps.customToolsTitle.style.display = tools.length > 0 ? "block" : "none";
    for (const tool of tools) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tool-btn";
      btn.dataset.tool = `custom:${tool.id}`;
      btn.textContent = tool.name;
      deps.customToolList.appendChild(btn);
    }
    setActiveToolButton(state.activeTool);
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

/** @param {import("./engine/state.js").AppState} state */
function getActiveCustomTool(state) {
  if (!state.activeTool.startsWith("custom:")) return null;
  const id = state.activeTool.replace("custom:", "");
  return state.customTools[state.activeGeometry]?.find((tool) => tool.id === id) ?? null;
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
  if (step.type === "tool") {
    const outputLabel = getLabelForRef(doc, step.output);
    const inputLabels = step.inputs.map((ref) => getLabelForRef(doc, ref)).filter(Boolean);
    const joined = joinLabels(inputLabels);
    return `Construct ${outputLabel} by applying ${step.toolName} to ${joined}.`;
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

/**
 * @param {import("./engine/state.js").ConstructionDoc} doc
 * @param {{kind:"point"|"line"|"circle", id:string}} ref
 */
function getLabelForRef(doc, ref) {
  if (ref.kind === "point") return getPointLabel(doc, ref.id);
  return getCurveLabel(doc, ref);
}

/** @param {string[]} labels */
function joinLabels(labels) {
  if (labels.length === 0) return "?";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
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
