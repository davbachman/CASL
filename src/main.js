import { createApp } from "./app.js?v=20260206-34";

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

createApp(deps);

const menuDropdowns = Array.from(document.querySelectorAll(".menu-dropdown"));
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
  return deps.showStepsButton.textContent?.trim().toLowerCase() === "hide steps";
}

function setViewMenuState() {
  const historyOpen = !deps.historyPane.hidden;
  if (showHistoryMenuItem) showHistoryMenuItem.disabled = historyOpen;
  if (hideHistoryMenuItem) hideHistoryMenuItem.disabled = !historyOpen;
  const showingSteps = isShowingSteps();
  if (showStepsMenuItem) showStepsMenuItem.disabled = showingSteps;
  if (hideStepsMenuItem) hideStepsMenuItem.disabled = !showingSteps;
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
  item.addEventListener("click", () => {
    const action = item.dataset.action;
    if (!action) return;

    if (action === "save-construction") deps.saveConstructionButton.click();
    if (action === "import-construction") deps.importConstructionButton.click();
    if (action === "save-tools") deps.saveToolsButton.click();
    if (action === "import-tools") deps.importToolsButton.click();
    if (action === "undo") deps.undoButton.click();
    if (action === "clear") deps.clearButton.click();
    if (action === "show-history" && deps.historyPane.hidden) deps.historyToggleButton.click();
    if (action === "hide-history" && !deps.historyPane.hidden) deps.historyToggleButton.click();
    if (action === "show-steps" && !isShowingSteps()) deps.showStepsButton.click();
    if (action === "hide-steps" && isShowingSteps()) deps.showStepsButton.click();
    if (action === "set-model") {
      const geom = item.dataset.geometry;
      if (geom && deps.geometrySelect.value !== geom) {
        deps.geometrySelect.value = geom;
        deps.geometrySelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    setModelSelectionUI();
    setViewMenuState();
    closeAllMenus();
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
