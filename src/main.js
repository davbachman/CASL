import { createApp } from "./app.js";

createApp({
  canvas: /** @type {HTMLCanvasElement} */ (document.getElementById("canvas")),
  geometrySelect: /** @type {HTMLSelectElement} */ (document.getElementById("geometrySelect")),
  toolButtons: /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll(".tool-btn")
  ),
  undoButton: /** @type {HTMLButtonElement} */ (document.getElementById("undoBtn")),
  statusText: /** @type {HTMLDivElement} */ (document.getElementById("statusText")),
  toolHint: /** @type {HTMLDivElement} */ (document.getElementById("toolHint")),
  contextMenu: /** @type {HTMLDivElement} */ (document.getElementById("contextMenu")),
});
