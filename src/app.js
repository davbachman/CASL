import { GeometryType, ToolType, createDefaultView, createEmptyDoc, createInitialState } from "./engine/state.js";
import { createHistory } from "./engine/history.js";
import { buildCustomToolDefinition } from "./engine/toolBuilder.js?v=20260206-33";
import { installContextMenu } from "./ui/contextMenu.js";
import { attachCanvasController } from "./engine/inputController.js?v=20260206-33";
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
 *  saveToolsButton: HTMLButtonElement,
 *  importToolsButton: HTMLButtonElement,
 *  saveConstructionButton: HTMLButtonElement,
 *  importConstructionButton: HTMLButtonElement,
 *  importToolsInput: HTMLInputElement,
 *  importConstructionInput: HTMLInputElement,
 *  historyToggleButton: HTMLButtonElement,
 *  buildToolButton: HTMLButtonElement,
 *  customToolList: HTMLDivElement,
 *  customToolsTitle: HTMLDivElement,
 *  statusText: HTMLDivElement,
 *  toolHint: HTMLDivElement,
 *  contextMenu: HTMLDivElement,
 *  historyPane: HTMLDivElement,
 *  historyList: HTMLOListElement,
 *  historyEmpty: HTMLDivElement,
 *  printHistoryButton: HTMLButtonElement
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

  const clearAllUndo = () => {
    for (const geom of Object.values(GeometryType)) history.clear(geom);
    updateUndoButton();
  };

  const getHistoryLinesForDoc = (doc) => {
    const steps = doc.historySteps ?? [];
    return steps.map((step) => formatHistoryStep(doc, step)).filter((line) => typeof line === "string");
  };

  const getActiveHistoryLines = () => getHistoryLinesForDoc(state.docs[state.activeGeometry]);

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

  deps.saveToolsButton.addEventListener("click", () => {
    const payload = {
      kind: "compass-straightedge-tools",
      version: 1,
      savedAt: new Date().toISOString(),
      customTools: safeClone(state.customTools),
    };
    downloadJsonFile(`tools-${dateStamp()}.json`, payload);
  });

  deps.importToolsButton.addEventListener("click", () => {
    deps.importToolsInput.value = "";
    deps.importToolsInput.click();
  });

  deps.importToolsInput.addEventListener("change", () => {
    void (async () => {
      const file = deps.importToolsInput.files?.[0];
      deps.importToolsInput.value = "";
      if (!file) return;
      try {
        const payload = await readJsonFile(file);
        const rawTools =
          Array.isArray(payload) || payload == null ? payload : (payload.customTools ?? payload.tools ?? null);
        const imported = normalizeCustomTools(rawTools, state.nextToolId);
        if (imported.tools.length === 0) throw new Error("No valid tools found in file.");
        state.customTools.push(...imported.tools);
        state.nextToolId = imported.nextToolId;
        renderCustomTools();
        updateToolHint();
        renderer.requestRender(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to import tools.";
        window.alert(`Import tools failed: ${msg}`);
      }
    })();
  });

  deps.saveConstructionButton.addEventListener("click", () => {
    const payload = {
      kind: "compass-straightedge-construction",
      version: 1,
      savedAt: new Date().toISOString(),
      state: {
        activeGeometry: state.activeGeometry,
        activeTool: state.activeTool,
        showSteps: state.showSteps,
        nextToolId: state.nextToolId,
        docs: safeClone(state.docs),
        views: safeClone(state.views),
        customTools: safeClone(state.customTools),
      },
    };
    downloadJsonFile(`construction-${dateStamp()}.json`, payload);
  });

  deps.importConstructionButton.addEventListener("click", () => {
    deps.importConstructionInput.value = "";
    deps.importConstructionInput.click();
  });

  deps.importConstructionInput.addEventListener("change", () => {
    void (async () => {
      const file = deps.importConstructionInput.files?.[0];
      deps.importConstructionInput.value = "";
      if (!file) return;
      try {
        const payloadRoot = await readJsonFile(file);
        const payload = payloadRoot && typeof payloadRoot === "object" ? (payloadRoot.state ?? payloadRoot) : null;
        if (!payload || typeof payload !== "object") throw new Error("Invalid construction file.");

        const importedDocs = Object.create(null);
        const importedViews = Object.create(null);
        for (const geom of Object.values(GeometryType)) {
          importedDocs[geom] = normalizeConstructionDoc(
            /** @type {GeometryType} */ (geom),
            /** @type {any} */ (payload.docs?.[geom]),
          );
          importedViews[geom] = normalizeViewState(
            /** @type {GeometryType} */ (geom),
            /** @type {any} */ (payload.views?.[geom]),
          );
        }

        const importedTools = normalizeCustomTools(payload.customTools ?? payload.tools ?? [], 1);
        const nextGeometry =
          typeof payload.activeGeometry === "string" && Object.values(GeometryType).includes(payload.activeGeometry)
            ? payload.activeGeometry
            : GeometryType.EUCLIDEAN;

        state.docs = importedDocs;
        state.views = importedViews;
        state.customTools = importedTools.tools;
        state.nextToolId = importedTools.nextToolId;
        state.activeGeometry = /** @type {GeometryType} */ (nextGeometry);
        state.showSteps = !!payload.showSteps;
        state.activeTool = normalizeImportedActiveTool(payload.activeTool, importedTools.idMap, state.customTools);
        state.pending = null;
        state.selection = null;
        state.toolUse = null;
        state.toolUseError = null;
        state.toolBuilder = null;
        ensureInversiveInfinityPoint(state);
        clearAllUndo();
        deps.geometrySelect.value = state.activeGeometry;
        ctxMenu.close();
        renderCustomTools();
        updateDebugVisibility();
        updateShowStepsButton();
        updateToolHint();
        lastHistorySignature = "";
        renderer.requestRender(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to import construction.";
        window.alert(`Import construction failed: ${msg}`);
      }
    })();
  });

  deps.printHistoryButton.addEventListener("click", () => {
    const lines = getActiveHistoryLines();
    printHistoryLines(geometryDisplayName(state.activeGeometry), lines);
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
    const lines = getHistoryLinesForDoc(doc);
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
    state.customTools.push(tool);
    state.toolBuilder = null;
    renderCustomTools();
    updateToolHint();
    renderer.requestRender(true);
  }

  function renderCustomTools() {
    const tools = state.customTools;
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

/** @param {unknown} value */
function safeClone(value) {
  // @ts-ignore - older browsers may not have structuredClone
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function dateStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

/**
 * @param {string} filename
 * @param {unknown} payload
 */
function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * @param {File} file
 * @returns {Promise<any>}
 */
async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

/** @param {string} s */
function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {string} geometryLabel
 * @param {string[]} lines
 */
function printHistoryLines(geometryLabel, lines) {
  const popup = window.open("", "_blank", "width=860,height=700");
  if (!popup) {
    window.alert("Unable to open print window. Please allow pop-ups and try again.");
    return;
  }
  const safeTitle = escapeHtml(`${geometryLabel} Construction History`);
  const content =
    lines.length === 0
      ? "<p>No steps yet.</p>"
      : `<ol>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`;
  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: Georgia, "Times New Roman", serif; margin: 24px; color: #111; }
      h1 { margin: 0 0 12px; font-size: 20px; }
      ol { margin: 0; padding-left: 24px; line-height: 1.45; }
      li { margin-bottom: 8px; }
      p { margin: 0; font-size: 15px; }
      @media print { body { margin: 14mm; } }
    </style>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    ${content}
  </body>
</html>`);
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 100);
}

/**
 * @param {unknown} rawTools
 * @param {number} nextToolIdStart
 */
function normalizeCustomTools(rawTools, nextToolIdStart) {
  /** @type {Array<import("./engine/state.js").CustomTool>} */
  const tools = [];
  /** @type {Map<string, string>} */
  const idMap = new Map();
  const list = Array.isArray(rawTools) ? rawTools : [];
  let nextToolId = Math.max(1, Math.floor(nextToolIdStart || 1));

  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    const normalized = normalizeCustomTool(raw);
    if (!normalized) continue;
    const sourceId = raw && typeof raw === "object" && typeof raw.id === "string" ? raw.id : `legacy_${i + 1}`;
    const nextId = makeId("t", nextToolId++);
    normalized.id = nextId;
    tools.push(normalized);
    idMap.set(sourceId, nextId);
  }

  return { tools, idMap, nextToolId };
}

/** @param {unknown} raw */
function normalizeCustomTool(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Custom Tool";
  if (!Array.isArray(raw.inputs) || !Array.isArray(raw.steps)) return null;
  if (!raw.output || typeof raw.output !== "object") return null;
  if (!isGeomRefKind(raw.output.kind) || typeof raw.output.nodeId !== "string" || !raw.output.nodeId) return null;
  const inputs = raw.inputs
    .map((input) =>
      input && typeof input === "object" && isGeomRefKind(input.kind) ? { kind: input.kind } : null,
    )
    .filter((input) => !!input);
  return {
    id: "",
    name,
    inputs,
    steps: safeClone(raw.steps),
    output: { kind: raw.output.kind, nodeId: raw.output.nodeId },
  };
}

/** @param {unknown} kind */
function isGeomRefKind(kind) {
  return kind === "point" || kind === "line" || kind === "circle";
}

/**
 * @param {GeometryType} geom
 * @param {unknown} rawDoc
 * @returns {import("./engine/state.js").ConstructionDoc}
 */
function normalizeConstructionDoc(geom, rawDoc) {
  const fallback = createEmptyDoc(geom);
  if (!rawDoc || typeof rawDoc !== "object") return fallback;
  const doc = safeClone(rawDoc);
  if (!Array.isArray(doc.points) || !Array.isArray(doc.lines) || !Array.isArray(doc.circles)) return fallback;
  if (!Array.isArray(doc.historySteps)) doc.historySteps = [];
  if (!Number.isFinite(doc.nextId) || doc.nextId < 1) doc.nextId = 1;
  if (!Number.isFinite(doc.nextPointLabel) || doc.nextPointLabel < 0) doc.nextPointLabel = 0;
  if (!Number.isFinite(doc.nextCurveLabel) || doc.nextCurveLabel < 0) doc.nextCurveLabel = 0;

  if (geom === GeometryType.INVERSIVE_EUCLIDEAN) {
    const star = typeof doc.starPointId === "string" ? doc.points.find((p) => p?.id === doc.starPointId) : null;
    if (!star) {
      const locked = doc.points.find((p) => p && p.locked);
      if (locked && typeof locked.id === "string") {
        doc.starPointId = locked.id;
      } else {
        const id = makeId("p", doc.nextId++);
        doc.points.unshift({
          id,
          label: "∞",
          x: 0,
          y: 0,
          locked: true,
          style: { color: "#111111", opacity: 1 },
        });
        doc.starPointId = id;
      }
    }
  }

  return doc;
}

/**
 * @param {GeometryType} geom
 * @param {unknown} rawView
 * @returns {import("./engine/state.js").ViewState}
 */
function normalizeViewState(geom, rawView) {
  const fallback = createDefaultView(geom);
  if (!rawView || typeof rawView !== "object") return fallback;
  if (geom === GeometryType.SPHERICAL) {
    if (rawView.kind !== "sphere") return fallback;
    const yaw = Number.isFinite(rawView.yaw) ? rawView.yaw : fallback.yaw;
    const pitch = Number.isFinite(rawView.pitch) ? rawView.pitch : fallback.pitch;
    const zoomRaw = Number.isFinite(rawView.zoom) ? rawView.zoom : fallback.zoom;
    const zoom = Math.min(4, Math.max(0.2, zoomRaw));
    return { kind: "sphere", yaw, pitch, zoom };
  }
  if (rawView.kind !== "2d") return fallback;
  const scaleRaw = Number.isFinite(rawView.scale) ? rawView.scale : fallback.scale;
  const scale = Math.min(3000, Math.max(10, scaleRaw));
  const offsetX = Number.isFinite(rawView.offsetX) ? rawView.offsetX : fallback.offsetX;
  const offsetY = Number.isFinite(rawView.offsetY) ? rawView.offsetY : fallback.offsetY;
  return { kind: "2d", scale, offsetX, offsetY };
}

/**
 * @param {unknown} rawActiveTool
 * @param {Map<string, string>} idMap
 * @param {Array<import("./engine/state.js").CustomTool>} customTools
 */
function normalizeImportedActiveTool(rawActiveTool, idMap, customTools) {
  if (rawActiveTool === ToolType.POINT) return ToolType.POINT;
  if (rawActiveTool === ToolType.LINE) return ToolType.LINE;
  if (rawActiveTool === ToolType.CIRCLE) return ToolType.CIRCLE;
  if (rawActiveTool === ToolType.INTERSECT) return ToolType.INTERSECT;
  if (typeof rawActiveTool === "string" && rawActiveTool.startsWith("custom:")) {
    const oldId = rawActiveTool.replace("custom:", "");
    const mapped = idMap.get(oldId);
    if (mapped && customTools.some((tool) => tool.id === mapped)) return `custom:${mapped}`;
  }
  return ToolType.LINE;
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
  return state.customTools.find((tool) => tool.id === id) ?? null;
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
