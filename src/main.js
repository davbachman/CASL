import { createApp } from "./app.js?v=20260205";

createApp({
  canvas: /** @type {HTMLCanvasElement} */ (document.getElementById("canvas")),
  geometrySelect: /** @type {HTMLSelectElement} */ (document.getElementById("geometrySelect")),
  toolButtons: /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll(".tool-btn")
  ),
  undoButton: /** @type {HTMLButtonElement} */ (document.getElementById("undoBtn")),
  historyToggleButton: /** @type {HTMLButtonElement} */ (document.getElementById("historyToggleBtn")),
  statusText: /** @type {HTMLDivElement} */ (document.getElementById("statusText")),
  toolHint: /** @type {HTMLDivElement} */ (document.getElementById("toolHint")),
  contextMenu: /** @type {HTMLDivElement} */ (document.getElementById("contextMenu")),
  historyPane: /** @type {HTMLDivElement} */ (document.getElementById("historyPane")),
  historyList: /** @type {HTMLOListElement} */ (document.getElementById("historyList")),
  historyEmpty: /** @type {HTMLDivElement} */ (document.getElementById("historyEmpty")),
});
