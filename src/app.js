import { GeometryType, ToolType, createDefaultView, createEmptyDoc, createInitialState } from "./engine/state.js";
import { createHistory } from "./engine/history.js";
import { buildCustomToolDefinition } from "./engine/toolBuilder.js?v=20260207-80";
import {
  hyperbolicInternalToDisplay2D,
  hyperbolicToPoincarePoint,
  isHyperbolicGeometry,
  poincareToHyperbolicPoint,
} from "./engine/hyperbolicModels.js?v=20260207-80";
import { installContextMenu } from "./ui/contextMenu.js";
import { attachCanvasController } from "./engine/inputController.js?v=20260207-80";
import { createRenderer } from "./engine/renderer.js?v=20260207-80";
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
  for (const geom of Object.values(GeometryType)) {
    enforceHyperboloidAxis(state.views[geom], /** @type {GeometryType} */ (geom));
  }
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

    if (!state.activeTool) {
      deps.toolHint.textContent = `${geomLabel}: Select a geometry element, then press Delete to remove it.`;
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

  const applyGeometryChange = (next) => {
    const prev = state.activeGeometry;
    if (prev !== next) {
      const convertedDoc = convertDocForModelSwitch(prev, next, state.docs[prev], state.docs[next]);
      if (convertedDoc) {
        state.docs[next] = convertedDoc;
        history.clear(next);
        fit2DViewToDoc(deps.canvas, state.views[next], next, convertedDoc);
      }
    }
    state.activeGeometry = next;
    enforceHyperboloidAxis(state.views[next], next);
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
  };

  deps.geometrySelect.addEventListener("change", () => {
    applyGeometryChange(/** @type {GeometryType} */ (deps.geometrySelect.value));
  });

  const handleToolClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tool]") : null;
    if (!(target instanceof HTMLElement)) return;
    const tool = target.dataset.tool;
    if (!tool) return;
    state.activeTool = state.activeTool === tool ? "" : tool;
    state.pending = null;
    state.selection = null;
    state.toolUse = null;
    state.toolUseError = null;
    state.toolBuilder = null;
    state.toolUseError = null;
    ctxMenu.close();
    setActiveToolButton(state.activeTool);
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

  const doDeleteSelection = () => {
    const selection = state.selection;
    if (!selection) return;
    const doc = state.docs[state.activeGeometry];
    if (!selectionExistsInDoc(doc, selection)) {
      state.selection = null;
      renderer.requestRender(true);
      return;
    }
    if (selection.kind === "point") {
      const point = doc.points.find((p) => p.id === selection.id);
      if (point?.locked) return;
    }
    ctxMenu.close();
    state.pending = null;
    state.toolUse = null;
    state.toolUseError = null;
    state.toolBuilder = null;
    history.push(state.activeGeometry);
    const removed = removeSelectionCascadeFromDoc(doc, selection);
    if (!removed) {
      history.undo(state.activeGeometry);
      return;
    }
    state.selection = null;
    ensureInversiveInfinityPoint(state);
    updateUndoButton();
    updateToolHint();
    renderer.requestRender(true);
  };

  const doReset = () => {
    const confirmed = window.confirm("Are you sure? All work will be lost.");
    if (!confirmed) return;
    ctxMenu.close();
    state.activeGeometry = GeometryType.EUCLIDEAN;
    state.activeTool = ToolType.LINE;
    state.pending = null;
    state.selection = null;
    state.toolUse = null;
    state.toolUseError = null;
    state.toolBuilder = null;
    state.customTools = [];
    state.nextToolId = 1;
    state.showSteps = false;
    for (const geom of Object.values(GeometryType)) {
      state.docs[geom] = createEmptyDoc(/** @type {GeometryType} */ (geom));
      state.views[geom] = createDefaultView(/** @type {GeometryType} */ (geom));
      enforceHyperboloidAxis(state.views[geom], /** @type {GeometryType} */ (geom));
      history.clear(/** @type {GeometryType} */ (geom));
    }
    ensureInversiveInfinityPoint(state);
    deps.geometrySelect.value = state.activeGeometry;
    setActiveToolButton(state.activeTool);
    renderCustomTools();
    updateDebugVisibility();
    updateShowStepsButton();
    updateToolHint();
    updateUndoButton();
    lastHistorySignature = "";
    renderer.requestRender(true);
  };

  const setShowSteps = (show) => {
    if (state.showSteps === show) return;
    state.showSteps = show;
    updateDebugVisibility();
    updateShowStepsButton();
    renderer.requestRender(true);
  };

  const toggleShowSteps = () => {
    setShowSteps(!state.showSteps);
  };

  const saveTools = async () => {
    const payload = {
      kind: "compass-straightedge-tools",
      version: 1,
      savedAt: new Date().toISOString(),
      customTools: safeClone(state.customTools),
    };
    await saveJsonFileWithDialog(`tools-${dateStamp()}.json`, payload);
  };

  const openImportToolsDialog = () => {
    deps.importToolsInput.value = "";
    deps.importToolsInput.click();
  };

  const saveConstruction = async () => {
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
    await saveJsonFileWithDialog(`construction-${dateStamp()}.json`, payload);
  };

  const openImportConstructionDialog = () => {
    deps.importConstructionInput.value = "";
    deps.importConstructionInput.click();
  };

  deps.showStepsButton.addEventListener("click", toggleShowSteps);

  deps.saveToolsButton.addEventListener("click", () => {
    void saveTools().catch((err) => {
      const msg = err instanceof Error ? err.message : "Unable to save tools.";
      window.alert(`Save tools failed: ${msg}`);
    });
  });

  deps.importToolsButton.addEventListener("click", openImportToolsDialog);

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
    void saveConstruction().catch((err) => {
      const msg = err instanceof Error ? err.message : "Unable to save construction.";
      window.alert(`Save construction failed: ${msg}`);
    });
  });

  deps.importConstructionButton.addEventListener("click", openImportConstructionDialog);

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

  const isHistoryOpen = () => !deps.historyPane.hidden;
  const toggleHistoryOpen = () => setHistoryOpen(!isHistoryOpen());

  deps.historyToggleButton.addEventListener("click", toggleHistoryOpen);

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
    enforceHyperboloidAxis(state.views[state.activeGeometry], state.activeGeometry);
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
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      doDeleteSelection();
      return;
    }
    if (state.toolBuilder) {
      if (e.key === "Escape") {
        state.toolBuilder = null;
        state.pending = null;
        state.toolUse = null;
        state.toolUseError = null;
        updateToolHint();
        setActiveToolButton(state.activeTool);
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

  return {
    undo: doUndo,
    deleteSelection: doDeleteSelection,
    clear: doClear,
    reset: doReset,
    saveTools,
    importTools: openImportToolsDialog,
    saveConstruction,
    importConstruction: openImportConstructionDialog,
    setGeometry: (geom) => {
      deps.geometrySelect.value = geom;
      applyGeometryChange(geom);
    },
    setShowSteps,
    isShowingSteps: () => state.showSteps,
    setHistoryOpen,
    isHistoryOpen,
  };
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
 * Save JSON content using the platform save dialog when available.
 *
 * @param {string} filename
 * @param {unknown} payload
 */
async function saveJsonFileWithDialog(filename, payload) {
  const json = JSON.stringify(payload, null, 2);
  const modernSaved = await tryModernSavePicker(filename, json);
  if (modernSaved === "saved" || modernSaved === "cancelled") return;

  const legacySaved = await tryLegacySavePicker(filename, json);
  if (legacySaved === "saved" || legacySaved === "cancelled") return;

  if (modernSaved === "blocked") {
    throw new Error("Native save dialog is blocked in this browser context.");
  }

  if (isSafariBrowser()) {
    const opened = openSafariSaveHelper(filename, json);
    if (opened) return;
  }

  downloadJsonFile(filename, payload);
}

/**
 * @param {string} filename
 * @param {string} json
 * @returns {Promise<"saved"|"cancelled"|"unsupported"|"blocked">}
 */
async function tryModernSavePicker(filename, json) {
  // @ts-ignore - not all browsers expose this type
  const picker = window.showSaveFilePicker;
  if (typeof picker !== "function") return "unsupported";
  try {
    const handle = await picker({
      suggestedName: filename,
      types: [
        {
          description: "JSON File",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return "saved";
  } catch (err) {
    if (isAbortError(err)) return "cancelled";
    if (isPermissionError(err)) return "blocked";
    throw err;
  }
}

/**
 * @param {string} filename
 * @param {string} json
 * @returns {Promise<"saved"|"cancelled"|"unsupported">}
 */
async function tryLegacySavePicker(filename, json) {
  // @ts-ignore - legacy Chromium API
  const picker = window.chooseFileSystemEntries;
  if (typeof picker !== "function") return "unsupported";
  try {
    // @ts-ignore - legacy Chromium API shape
    const handle = await picker({
      type: "save-file",
      suggestedName: filename,
      accepts: [
        {
          description: "JSON File",
          extensions: ["json"],
          mimeTypes: ["application/json"],
        },
      ],
    });

    if (typeof handle.createWritable === "function") {
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return "saved";
    }
    if (typeof handle.createWriter === "function") {
      const writer = await handle.createWriter();
      await new Promise((resolve, reject) => {
        writer.onerror = reject;
        writer.onwriteend = resolve;
        writer.write(0, new Blob([json], { type: "application/json" }));
      });
      if (typeof writer.close === "function") writer.close();
      return "saved";
    }
    return "unsupported";
  } catch (err) {
    if (isAbortError(err)) return "cancelled";
    throw err;
  }
}

/** @param {unknown} err */
function isAbortError(err) {
  return !!(err && typeof err === "object" && "name" in err && err.name === "AbortError");
}

/** @param {unknown} err */
function isPermissionError(err) {
  return !!(
    err &&
    typeof err === "object" &&
    "name" in err &&
    (err.name === "NotAllowedError" || err.name === "SecurityError")
  );
}

function isSafariBrowser() {
  const ua = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  const safariVendor = vendor.includes("Apple");
  const isSafariUA = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);
  return safariVendor && isSafariUA;
}

/**
 * Safari fallback helper window with explicit download-as instructions.
 *
 * @param {string} filename
 * @param {string} json
 * @returns {boolean}
 */
function openSafariSaveHelper(filename, json) {
  const popup = window.open("", "_blank", "width=760,height=620");
  if (!popup) return false;

  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(filename)} - Save</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 18px; color: #111827; }
      h1 { margin: 0 0 10px; font-size: 18px; }
      p { margin: 8px 0; line-height: 1.35; }
      .actions { margin: 12px 0 14px; display: flex; gap: 10px; flex-wrap: wrap; }
      a, button { font: inherit; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; background: #fff; cursor: pointer; text-decoration: none; color: #111827; }
      a:hover, button:hover { border-color: #94a3b8; background: #f8fafc; }
      pre { white-space: pre-wrap; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; padding: 10px; max-height: 62vh; overflow: auto; font-size: 12px; }
      .note { color: #475569; font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>Save JSON in Safari</h1>
    <p>Choose one option below:</p>
    <p class="note">1) Click <b>Download JSON</b>, then save from Safari Downloads.</p>
    <p class="note">2) Right-click <b>Download JSON</b> and choose <b>Download Linked File As...</b> to choose filename/location now.</p>
    <div class="actions">
      <a id="downloadLink" href="#">Download JSON</a>
      <button type="button" id="copyBtn">Copy JSON</button>
    </div>
    <pre id="jsonBody"></pre>
    <script>
      const text = ${JSON.stringify(json)};
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.getElementById("downloadLink");
      link.href = url;
      link.download = ${JSON.stringify(filename)};
      document.getElementById("jsonBody").textContent = text;
      document.getElementById("copyBtn").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text); alert("JSON copied."); }
        catch { alert("Clipboard copy failed. You can still select/copy from the text below."); }
      });
      window.addEventListener("beforeunload", () => URL.revokeObjectURL(url));
    </script>
  </body>
</html>`);
  popup.document.close();
  popup.focus();
  return true;
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
  if (geom === GeometryType.SPHERICAL || geom === GeometryType.HYPERBOLIC_HYPERBOLOID) {
    if (rawView.kind !== "sphere") return fallback;
    const yaw =
      geom === GeometryType.HYPERBOLIC_HYPERBOLOID
        ? 0
        : Number.isFinite(rawView.yaw)
          ? rawView.yaw
          : fallback.yaw;
    const pitch = Number.isFinite(rawView.pitch) ? rawView.pitch : fallback.pitch;
    const zoomRaw = Number.isFinite(rawView.zoom) ? rawView.zoom : fallback.zoom;
    const roll =
      Number.isFinite(rawView.roll)
        ? rawView.roll
        : geom === GeometryType.HYPERBOLIC_HYPERBOLOID && Number.isFinite(rawView.yaw)
          ? rawView.yaw
          : Number.isFinite(fallback.roll)
            ? fallback.roll
            : 0;
    const zoom = Math.min(4, Math.max(0.2, zoomRaw));
    return { kind: "sphere", yaw, pitch, zoom, roll };
  }
  if (rawView.kind !== "2d") return fallback;
  const scaleRaw = Number.isFinite(rawView.scale) ? rawView.scale : fallback.scale;
  const scale = Math.min(3000, Math.max(10, scaleRaw));
  const offsetX = Number.isFinite(rawView.offsetX) ? rawView.offsetX : fallback.offsetX;
  const offsetY = Number.isFinite(rawView.offsetY) ? rawView.offsetY : fallback.offsetY;
  return { kind: "2d", scale, offsetX, offsetY };
}

/**
 * Keep hyperboloid axis vertical in screen space by locking yaw to 0.
 *
 * @param {import("./engine/state.js").ViewState} view
 * @param {GeometryType} geom
 */
function enforceHyperboloidAxis(view, geom) {
  if (geom !== GeometryType.HYPERBOLIC_HYPERBOLOID) return;
  if (!view || view.kind !== "sphere") return;
  view.yaw = 0;
  if (!Number.isFinite(view.roll)) view.roll = 0;
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

/**
 * Convert docs when switching between equivalent models in the same geometry family.
 *
 * @param {GeometryType} from
 * @param {GeometryType} to
 * @param {import("./engine/state.js").ConstructionDoc} sourceDoc
 * @param {import("./engine/state.js").ConstructionDoc} targetDoc
 */
function convertDocForModelSwitch(from, to, sourceDoc, targetDoc) {
  if (from === to) return null;
  if (!isCrossModelConvertible(from, to)) return null;

  if (isPlainEuclideanModel(from) && to === GeometryType.INVERSIVE_EUCLIDEAN) {
    return convertEuclideanToInversiveDoc(sourceDoc, targetDoc);
  }
  if (from === GeometryType.INVERSIVE_EUCLIDEAN && isPlainEuclideanModel(to)) {
    return convertInversiveToEuclideanDoc(sourceDoc);
  }
  if (isPlainEuclideanModel(from) && isPlainEuclideanModel(to)) {
    return safeClone(sourceDoc);
  }
  if (isHyperbolicGeometry(from) && isHyperbolicGeometry(to)) {
    return convertHyperbolicDoc(sourceDoc, from, to);
  }
  if (isSphericalModel(from) && isSphericalModel(to)) {
    return safeClone(sourceDoc);
  }
  return null;
}

/**
 * @param {GeometryType} from
 * @param {GeometryType} to
 */
function isCrossModelConvertible(from, to) {
  const euclideanFamily = isEuclideanFamilyModel(from) && isEuclideanFamilyModel(to);
  const sphericalFamily = isSphericalModel(from) && isSphericalModel(to);
  const hyperbolicFamily = isHyperbolicGeometry(from) && isHyperbolicGeometry(to);
  return euclideanFamily || sphericalFamily || hyperbolicFamily;
}

/** @param {GeometryType} geom */
function isPlainEuclideanModel(geom) {
  return geom === GeometryType.EUCLIDEAN || geom === GeometryType.EUCLIDEAN_PERSPECTIVE;
}

/** @param {GeometryType} geom */
function isEuclideanFamilyModel(geom) {
  return isPlainEuclideanModel(geom) || geom === GeometryType.INVERSIVE_EUCLIDEAN;
}

/** @param {GeometryType} geom */
function isSphericalModel(geom) {
  return geom === GeometryType.SPHERICAL || geom === GeometryType.SPHERICAL_STEREOGRAPHIC;
}

/**
 * @param {import("./engine/state.js").ConstructionDoc} sourceDoc
 * @param {import("./engine/state.js").ConstructionDoc} targetDoc
 */
function convertEuclideanToInversiveDoc(sourceDoc, targetDoc) {
  const center = getInversiveCenter(targetDoc);
  const converted = convertMapped2DDoc(sourceDoc, (p) => invertPointAtCenter(p, center));
  const starId = makeId("p", converted.nextId++);
  converted.starPointId = starId;
  converted.points.push({
    id: starId,
    label: "∞",
    x: center.x,
    y: center.y,
    locked: true,
    style: { color: "#111111", opacity: 1 },
  });
  return converted;
}

/**
 * @param {import("./engine/state.js").ConstructionDoc} sourceDoc
 */
function convertInversiveToEuclideanDoc(sourceDoc) {
  const starId = sourceDoc.starPointId ?? null;
  const center = getInversiveCenter(sourceDoc);
  const out = safeClone(sourceDoc);
  out.starPointId = undefined;
  out.points = [];
  out.lines = [];
  out.circles = [];

  /** @type {Map<string, string>} */
  const pointIdMap = new Map();
  for (const point of sourceDoc.points ?? []) {
    if (starId && point.id === starId) continue;
    const mapped = invertPointAtCenter({ x: point.x, y: point.y }, center);
    if (!mapped) continue;
    const nextPoint = { ...point, x: mapped.x, y: mapped.y };
    delete nextPoint.z;
    nextPoint.intersectionHints = undefined;
    out.points.push(nextPoint);
    pointIdMap.set(point.id, point.id);
  }

  let helperCenterPointId = null;
  const ensureCenterHelperPoint = () => {
    if (helperCenterPointId) return helperCenterPointId;
    const helperId = makeId("p", out.nextId++);
    out.points.push({
      id: helperId,
      label: "",
      x: center.x,
      y: center.y,
      hidden: true,
      style: { color: "#111111", opacity: 1 },
    });
    helperCenterPointId = helperId;
    return helperCenterPointId;
  };

  for (const line of sourceDoc.lines ?? []) {
    const p1Mapped = pointIdMap.get(line.p1);
    const p2Mapped = pointIdMap.get(line.p2);
    if (p1Mapped && p2Mapped) {
      out.lines.push({ ...line, p1: p1Mapped, p2: p2Mapped });
      continue;
    }
    if (starId && (line.p1 === starId || line.p2 === starId)) {
      const other = line.p1 === starId ? p2Mapped : p1Mapped;
      if (!other) continue;
      const helper = ensureCenterHelperPoint();
      out.lines.push({ ...line, p1: other, p2: helper });
    }
  }

  for (const circle of sourceDoc.circles ?? []) {
    const centerMapped = pointIdMap.get(circle.center);
    const radiusMapped = pointIdMap.get(circle.radiusPoint);
    if (centerMapped && radiusMapped) {
      out.circles.push({ ...circle, center: centerMapped, radiusPoint: radiusMapped });
      continue;
    }
    if (starId && circle.center === starId && radiusMapped) {
      const helper = ensureCenterHelperPoint();
      out.circles.push({ ...circle, center: helper, radiusPoint: radiusMapped });
    }
  }

  return sanitizeConvertedDoc(out);
}

/**
 * @param {import("./engine/state.js").ConstructionDoc} sourceDoc
 * @param {(p:{x:number,y:number}) => {x:number,y:number} | null} mapPoint
 */
function convertMapped2DDoc(sourceDoc, mapPoint) {
  const out = safeClone(sourceDoc);
  out.points = [];
  out.lines = safeClone(sourceDoc.lines ?? []);
  out.circles = safeClone(sourceDoc.circles ?? []);
  out.starPointId = undefined;

  for (const point of sourceDoc.points ?? []) {
    const mapped = mapPoint({ x: point.x, y: point.y });
    if (!mapped) continue;
    const nextPoint = { ...point, x: mapped.x, y: mapped.y };
    delete nextPoint.z;
    nextPoint.intersectionHints = undefined;
    out.points.push(nextPoint);
  }

  return sanitizeConvertedDoc(out);
}

/**
 * Convert between hyperbolic model coordinates while preserving object incidences.
 *
 * @param {import("./engine/state.js").ConstructionDoc} sourceDoc
 * @param {GeometryType} from
 * @param {GeometryType} to
 */
function convertHyperbolicDoc(sourceDoc, from, to) {
  if (from === to) return safeClone(sourceDoc);
  const out = safeClone(sourceDoc);
  out.points = [];
  out.lines = safeClone(sourceDoc.lines ?? []);
  out.circles = safeClone(sourceDoc.circles ?? []);
  out.starPointId = undefined;

  for (const point of sourceDoc.points ?? []) {
    const inPoincare = hyperbolicToPoincarePoint(from, { x: point.x, y: point.y });
    if (!inPoincare) continue;
    const mapped = poincareToHyperbolicPoint(to, inPoincare);
    const nextPoint = { ...point, x: mapped.x, y: mapped.y };
    delete nextPoint.z;
    nextPoint.intersectionHints = undefined;
    out.points.push(nextPoint);
  }

  return sanitizeConvertedDoc(out);
}

/**
 * @param {import("./engine/state.js").ConstructionDoc} doc
 */
function sanitizeConvertedDoc(doc) {
  const pointIds = new Set((doc.points ?? []).map((point) => point.id));
  doc.lines = (doc.lines ?? []).filter((line) => pointIds.has(line.p1) && pointIds.has(line.p2));
  doc.circles = (doc.circles ?? []).filter(
    (circle) => pointIds.has(circle.center) && pointIds.has(circle.radiusPoint),
  );

  const lineIds = new Set(doc.lines.map((line) => line.id));
  const circleIds = new Set(doc.circles.map((circle) => circle.id));
  const curveExists = (ref) => (ref.kind === "line" ? lineIds.has(ref.id) : circleIds.has(ref.id));
  const objectExists = (ref) =>
    ref.kind === "point" ? pointIds.has(ref.id) : ref.kind === "line" ? lineIds.has(ref.id) : circleIds.has(ref.id);

  for (const point of doc.points) {
    if (!Array.isArray(point.constraints) || point.constraints.length === 0) {
      point.constraints = undefined;
    } else {
      point.constraints = point.constraints.filter((ref) => curveExists(ref));
      if (point.constraints.length === 0) point.constraints = undefined;
    }
    point.intersectionHints = undefined;
  }

  const steps = Array.isArray(doc.historySteps) ? doc.historySteps : [];
  doc.historySteps = steps.filter((step) => {
    if (step.type === "point") return pointIds.has(step.pointId) && (!step.on || curveExists(step.on));
    if (step.type === "line") return lineIds.has(step.lineId);
    if (step.type === "circle") return circleIds.has(step.circleId);
    if (step.type === "intersection") return pointIds.has(step.pointId) && curveExists(step.a) && curveExists(step.b);
    if (step.type === "tool") {
      return objectExists(step.output) && step.inputs.every((ref) => objectExists(ref));
    }
    return false;
  });

  doc.nextId = Math.max(1, doc.nextId ?? 1, getNextIdFromObjects(doc.points, doc.lines, doc.circles));
  return doc;
}

/**
 * @param {Array<{id:string}>} points
 * @param {Array<{id:string}>} lines
 * @param {Array<{id:string}>} circles
 */
function getNextIdFromObjects(points, lines, circles) {
  const all = [...(points ?? []), ...(lines ?? []), ...(circles ?? [])];
  let maxId = 0;
  for (const obj of all) {
    const num = extractNumericId(obj.id);
    if (num > maxId) maxId = num;
  }
  return maxId + 1;
}

/** @param {string} id */
function extractNumericId(id) {
  if (typeof id !== "string" || id.length < 2) return 0;
  const n = Number.parseInt(id.slice(1), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Delete the selected object and everything created after it.
 *
 * @param {import("./engine/state.js").ConstructionDoc} doc
 * @param {{kind:"point"|"line"|"circle", id:string}} selection
 * @returns {boolean}
 */
function removeSelectionCascadeFromDoc(doc, selection) {
  if (!doc || !selection?.id) return false;

  /** @type {Set<string>} */
  const removePoints = new Set();
  /** @type {Set<string>} */
  const removeLines = new Set();
  /** @type {Set<string>} */
  const removeCircles = new Set();

  const addByRef = (ref) => {
    if (ref.kind === "point") removePoints.add(ref.id);
    else if (ref.kind === "line") removeLines.add(ref.id);
    else removeCircles.add(ref.id);
  };
  addByRef(selection);

  const selectedOrder = extractNumericId(selection.id);
  if (selectedOrder > 0) {
    for (const p of doc.points ?? []) {
      if (extractNumericId(p.id) >= selectedOrder) removePoints.add(p.id);
    }
    for (const l of doc.lines ?? []) {
      if (extractNumericId(l.id) >= selectedOrder) removeLines.add(l.id);
    }
    for (const c of doc.circles ?? []) {
      if (extractNumericId(c.id) >= selectedOrder) removeCircles.add(c.id);
    }
  }

  const steps = Array.isArray(doc.historySteps) ? doc.historySteps : [];
  let startIndex = -1;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const created =
      step.type === "point"
        ? { kind: "point", id: step.pointId }
        : step.type === "line"
          ? { kind: "line", id: step.lineId }
          : step.type === "circle"
            ? { kind: "circle", id: step.circleId }
            : step.type === "intersection"
              ? { kind: "point", id: step.pointId }
              : step.type === "tool"
                ? step.output
                : null;
    if (!created) continue;
    if (created.kind === selection.kind && created.id === selection.id) {
      startIndex = i;
      break;
    }
  }
  if (startIndex >= 0) {
    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === "point" || step.type === "intersection") removePoints.add(step.pointId);
      if (step.type === "line") removeLines.add(step.lineId);
      if (step.type === "circle") removeCircles.add(step.circleId);
      if (step.type === "tool") addByRef(step.output);
    }
  }

  const hadTargets = removePoints.size > 0 || removeLines.size > 0 || removeCircles.size > 0;
  if (!hadTargets) return false;

  doc.points = (doc.points ?? []).filter((p) => !removePoints.has(p.id));
  doc.lines = (doc.lines ?? []).filter((l) => !removeLines.has(l.id));
  doc.circles = (doc.circles ?? []).filter((c) => !removeCircles.has(c.id));
  sanitizeConvertedDoc(doc);
  return true;
}

/**
 * @param {import("./engine/state.js").ConstructionDoc} doc
 * @param {{kind:"point"|"line"|"circle", id:string}} selection
 */
function selectionExistsInDoc(doc, selection) {
  if (!doc || !selection?.id) return false;
  if (selection.kind === "point") return (doc.points ?? []).some((p) => p.id === selection.id);
  if (selection.kind === "line") return (doc.lines ?? []).some((l) => l.id === selection.id);
  return (doc.circles ?? []).some((c) => c.id === selection.id);
}

/**
 * Unit-circle inversion around center `c`: c + (p-c)/|p-c|^2.
 *
 * @param {{x:number,y:number}} p
 * @param {{x:number,y:number}} c
 */
function invertPointAtCenter(p, c) {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= 1e-12) return { x: c.x + 1e6, y: c.y };
  return { x: c.x + dx / d2, y: c.y + dy / d2 };
}

/**
 * @param {import("./engine/state.js").ConstructionDoc} inversiveDoc
 */
function getInversiveCenter(inversiveDoc) {
  const starId = inversiveDoc?.starPointId;
  const star = starId ? inversiveDoc.points?.find((point) => point.id === starId) : null;
  if (!star) return { x: 0, y: 0 };
  return { x: star.x, y: star.y };
}

/**
 * Keep transformed geometry visible after switching paired models.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import("./engine/state.js").ViewState} view
 * @param {GeometryType} geom
 * @param {import("./engine/state.js").ConstructionDoc} doc
 */
function fit2DViewToDoc(canvas, view, geom, doc) {
  if (!view || view.kind !== "2d") return;
  const sourcePoints = (doc.points ?? []).filter((point) => {
    if (point.hidden) return false;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    if (geom === GeometryType.INVERSIVE_EUCLIDEAN && doc.starPointId && point.id === doc.starPointId) return false;
    return true;
  });
  const points = sourcePoints
    .map((point) => {
      if (geom === GeometryType.SPHERICAL_STEREOGRAPHIC) {
        if (!Number.isFinite(point.z)) return null;
        return sphereToStereographicPoint({ x: point.x, y: point.y, z: point.z });
      }
      if (geom === GeometryType.HYPERBOLIC_KLEIN) return hyperbolicInternalToDisplay2D(geom, { x: point.x, y: point.y });
      return { x: point.x, y: point.y };
    })
    .filter((point) => !!point);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  if (points.length === 0) {
    if (geom === GeometryType.HYPERBOLIC_POINCARE || geom === GeometryType.HYPERBOLIC_KLEIN) {
      view.scale = Math.min(width, height) * 0.42;
      view.offsetX = width / 2;
      view.offsetY = height / 2;
      // @ts-ignore - runtime extension set in view2d initializer
      view.modelOffsetX = view.offsetX;
      // @ts-ignore - runtime extension set in view2d initializer
      view.modelOffsetY = view.offsetY;
      // @ts-ignore - runtime extension set in view2d initializer
      view.initialized = true;
    } else if (geom === GeometryType.EUCLIDEAN_PERSPECTIVE) {
      view.offsetX = width / 2;
      view.offsetY = height * 0.35;
      // @ts-ignore - runtime extension set in view2d initializer
      view.modelOffsetX = view.offsetX;
      // @ts-ignore - runtime extension set in view2d initializer
      view.modelOffsetY = view.offsetY;
      // @ts-ignore - runtime extension set in view2d initializer
      view.initialized = true;
    }
    return;
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  // Keep the full unit-disk boundary visible for disk models.
  if (geom === GeometryType.HYPERBOLIC_POINCARE || geom === GeometryType.HYPERBOLIC_KLEIN) {
    minX = Math.min(minX, -1);
    maxX = Math.max(maxX, 1);
    minY = Math.min(minY, -1);
    maxY = Math.max(maxY, 1);
  }

  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const margin = 80;
  const scaleX = (width - margin * 2) / spanX;
  const scaleY = (height - margin * 2) / spanY;
  const maxScale =
    geom === GeometryType.HYPERBOLIC_POINCARE || geom === GeometryType.HYPERBOLIC_KLEIN ? Math.min(width, height) * 0.46 : 600;
  const nextScale = Math.max(20, Math.min(maxScale, Math.min(scaleX, scaleY) || view.scale));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  view.scale = nextScale;
  view.offsetX = width / 2 - cx * nextScale;
  view.offsetY = height / 2 + cy * nextScale;
  // Keep fixed-frame models in a consistent projection frame.
  if (
    geom === GeometryType.EUCLIDEAN_PERSPECTIVE ||
    geom === GeometryType.HYPERBOLIC_POINCARE ||
    geom === GeometryType.HYPERBOLIC_KLEIN ||
    geom === GeometryType.HYPERBOLIC_HALF_PLANE
  ) {
    // @ts-ignore - runtime extension set in view2d initializer
    view.modelOffsetX = view.offsetX;
    // @ts-ignore - runtime extension set in view2d initializer
    view.modelOffsetY = view.offsetY;
  } else {
    // @ts-ignore - runtime extension set in view2d initializer
    if (!Number.isFinite(view.modelOffsetX)) view.modelOffsetX = width / 2;
    // @ts-ignore - runtime extension set in view2d initializer
    if (!Number.isFinite(view.modelOffsetY))
      view.modelOffsetY =
        geom === GeometryType.EUCLIDEAN_PERSPECTIVE
          ? height * 0.35
          : geom === GeometryType.HYPERBOLIC_HALF_PLANE
            ? height * 0.78
            : height / 2;
  }
  // @ts-ignore - runtime extension set in view2d initializer
  view.initialized = true;
}

/** @param {GeometryType} geom */
function geometryDisplayName(geom) {
  switch (geom) {
    case GeometryType.EUCLIDEAN:
      return "Euclidean";
    case GeometryType.EUCLIDEAN_PERSPECTIVE:
      return "Euclidean (Perspective)";
    case GeometryType.INVERSIVE_EUCLIDEAN:
      return "Inversive Euclidean";
    case GeometryType.SPHERICAL:
      return "Spherical";
    case GeometryType.SPHERICAL_STEREOGRAPHIC:
      return "Spherical (Stereographic)";
    case GeometryType.HYPERBOLIC_POINCARE:
      return "Hyperbolic (Poincaré)";
    case GeometryType.HYPERBOLIC_HALF_PLANE:
      return "Hyperbolic (Half-plane)";
    case GeometryType.HYPERBOLIC_KLEIN:
      return "Hyperbolic (Klein)";
    case GeometryType.HYPERBOLIC_HYPERBOLOID:
      return "Hyperbolic (Hyperboloid)";
    default:
      return geom;
  }
}

/**
 * @param {{x:number,y:number,z:number}} p
 * @returns {{x:number,y:number} | null}
 */
function sphereToStereographicPoint(p) {
  const den = 1 - p.z;
  if (den <= 1e-9) return null;
  const x = p.x / den;
  const y = p.y / den;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
  return { x, y };
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
