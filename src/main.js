import { createApp } from "./app.js?v=20260205-32";

createApp({
  canvas: /** @type {HTMLCanvasElement} */ (document.getElementById("canvas")),
  geometrySelect: /** @type {HTMLSelectElement} */ (document.getElementById("geometrySelect")),
  toolListRoot: /** @type {HTMLDivElement} */ (document.getElementById("toolListRoot")),
  undoButton: /** @type {HTMLButtonElement} */ (document.getElementById("undoBtn")),
  clearButton: /** @type {HTMLButtonElement} */ (document.getElementById("clearBtn")),
  showStepsButton: /** @type {HTMLButtonElement} */ (document.getElementById("showStepsBtn")),
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
});
