import { createApp } from "./app.js?v=20260206-64";

const deps = {
  canvas: /** @type {HTMLCanvasElement} */ (document.getElementById("canvas")),
  geometrySelect: /** @type {HTMLSelectElement} */ (document.getElementById("geometrySelect")),
  toolListRoot: /** @type {HTMLDivElement} */ (document.getElementById("toolListRoot")),
  undoButton: /** @type {HTMLButtonElement} */ (document.getElementById("undoBtn")),
  clearButton: /** @type {HTMLButtonElement} */ (document.getElementById("clearBtn")),
  showStepsButton: /** @type {HTMLButtonElement} */ (document.getElementById("showStepsBtn")),
  saveToolsButton: /** @type {HTMLButtonElement} */ (document.getElementById("saveToolsBtn")),
  importToolsButton: /** @type {HTMLButtonElement} */ (document.getElementById("importToolsBtn")),
  saveConstructionButton: /** @type {HTMLButtonElement} */ (document.getElementById("saveConstructionBtn")),
  importConstructionButton: /** @type {HTMLButtonElement} */ (document.getElementById("importConstructionBtn")),
  importToolsInput: /** @type {HTMLInputElement} */ (document.getElementById("importToolsInput")),
  importConstructionInput: /** @type {HTMLInputElement} */ (document.getElementById("importConstructionInput")),
  historyToggleButton: /** @type {HTMLButtonElement} */ (document.getElementById("historyToggleBtn")),
  buildToolButton: /** @type {HTMLButtonElement} */ (document.getElementById("buildToolBtn")),
  customToolList: /** @type {HTMLDivElement} */ (document.getElementById("customToolList")),
  customToolsTitle: /** @type {HTMLDivElement} */ (document.getElementById("customToolsTitle")),
  statusText: /** @type {HTMLDivElement} */ (document.getElementById("statusText")),
  toolHint: /** @type {HTMLDivElement} */ (document.getElementById("toolHint")),
  contextMenu: /** @type {HTMLDivElement} */ (document.getElementById("contextMenu")),
  historyPane: /** @type {HTMLDivElement} */ (document.getElementById("historyPane")),
  historyList: /** @type {HTMLOListElement} */ (document.getElementById("historyList")),
  historyEmpty: /** @type {HTMLDivElement} */ (document.getElementById("historyEmpty")),
  printHistoryButton: /** @type {HTMLButtonElement} */ (document.getElementById("printHistoryBtn")),
};

const app = createApp(deps);

const menuDropdowns = Array.from(document.querySelectorAll(".menu-dropdown"));
const menuSubmenus = Array.from(document.querySelectorAll(".menu-submenu"));
const menuSubmenuParents = Array.from(document.querySelectorAll(".menu-item-parent"));
const menuItems = Array.from(document.querySelectorAll("[data-action]"));
const modelItems = Array.from(document.querySelectorAll('[data-action="set-model"]'));
const showHistoryMenuItem = /** @type {HTMLButtonElement | null} */ (
  document.querySelector('[data-action="show-history"]')
);
const hideHistoryMenuItem = /** @type {HTMLButtonElement | null} */ (
  document.querySelector('[data-action="hide-history"]')
);
const showStepsMenuItem = /** @type {HTMLButtonElement | null} */ (
  document.querySelector('[data-action="show-steps"]')
);
const hideStepsMenuItem = /** @type {HTMLButtonElement | null} */ (
  document.querySelector('[data-action="hide-steps"]')
);

function closeAllMenus() {
  for (const menu of menuDropdowns) menu.open = false;
  for (const submenu of menuSubmenus) submenu.classList.remove("is-open");
}

function setModelSelectionUI() {
  const active = deps.geometrySelect.value;
  for (const item of modelItems) {
    if (!(item instanceof HTMLElement)) continue;
    const selected = item.dataset.geometry === active;
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-checked", String(selected));
  }
}

function isShowingSteps() {
  return app.isShowingSteps();
}

function setViewMenuState() {
  const historyOpen = app.isHistoryOpen();
  if (showHistoryMenuItem) showHistoryMenuItem.disabled = historyOpen;
  if (hideHistoryMenuItem) hideHistoryMenuItem.disabled = !historyOpen;
  const showingSteps = isShowingSteps();
  if (showStepsMenuItem) showStepsMenuItem.disabled = showingSteps;
  if (hideStepsMenuItem) hideStepsMenuItem.disabled = !showingSteps;
}

/**
 * @param {HTMLElement} item
 */
async function runMenuAction(item) {
  const action = item.dataset.action;
  if (!action) return;

  if (action === "save-construction") {
    try {
      await app.saveConstruction();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to save construction.";
      window.alert(`Save construction failed: ${msg}`);
    }
  }
  if (action === "import-construction") app.importConstruction();
  if (action === "save-tools") {
    try {
      await app.saveTools();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to save tools.";
      window.alert(`Save tools failed: ${msg}`);
    }
  }
  if (action === "import-tools") app.importTools();
  if (action === "undo") app.undo();
  if (action === "clear") app.clear();
  if (action === "show-history") app.setHistoryOpen(true);
  if (action === "hide-history") app.setHistoryOpen(false);
  if (action === "show-steps") app.setShowSteps(true);
  if (action === "hide-steps") app.setShowSteps(false);
  if (action === "set-model") {
    const geom = item.dataset.geometry;
    if (geom) app.setGeometry(geom);
  }

  setModelSelectionUI();
  setViewMenuState();
  closeAllMenus();
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (menuDropdowns.some((menu) => menu.contains(target))) return;
  closeAllMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeAllMenus();
});

for (const item of menuItems) {
  if (!(item instanceof HTMLElement)) continue;
  item.addEventListener("click", async () => {
    await runMenuAction(item);
  });
}

for (const item of modelItems) {
  if (!(item instanceof HTMLElement)) continue;
  item.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void runMenuAction(item);
  });
}

for (const parentBtn of menuSubmenuParents) {
  if (!(parentBtn instanceof HTMLElement)) continue;
  parentBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const host = parentBtn.closest(".menu-submenu");
    if (!(host instanceof HTMLElement)) return;
    const shouldOpen = !host.classList.contains("is-open");
    const panel = host.parentElement;
    if (panel) {
      for (const sibling of panel.querySelectorAll(".menu-submenu.is-open")) {
        if (sibling !== host) sibling.classList.remove("is-open");
      }
    }
    host.classList.toggle("is-open", shouldOpen);
  });
}

deps.geometrySelect.addEventListener("change", () => {
  setModelSelectionUI();
});

deps.historyToggleButton.addEventListener("click", () => {
  setViewMenuState();
});

deps.showStepsButton.addEventListener("click", () => {
  setViewMenuState();
});

setModelSelectionUI();
setViewMenuState();
