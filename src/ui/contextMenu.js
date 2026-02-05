/**
 * @typedef {import("../engine/state.js").AppState} AppState
 */

/**
 * @param {HTMLDivElement} host
 * @param {{
 *  getState: () => AppState,
 *  requestRender: () => void,
 *  pushHistory: () => void
 * }} deps
 */
export function installContextMenu(host, deps) {
  /** @type {null | {kind:"point"|"line"|"circle", id:string}} */
  let openTarget = null;

  const close = () => {
    openTarget = null;
    host.classList.add("is-hidden");
    host.innerHTML = "";
  };

  const openAt = (client, target) => {
    const state = deps.getState();
    const doc = state.docs[state.activeGeometry];

    const element = findElement(doc, target);
    if (!element) return;

    openTarget = target;
    host.classList.remove("is-hidden");
    host.style.left = `${client.x}px`;
    host.style.top = `${client.y}px`;
    host.innerHTML = "";

    const title = document.createElement("div");
    title.className = "ctx-title";
    title.textContent = `${target.kind.toUpperCase()} • ${element.label}`;
    host.appendChild(title);

    const labelRow = row("Label");
    const labelInput = document.createElement("input");
    labelInput.className = "ctx-input";
    labelInput.value = element.label;
    labelInput.disabled = target.kind === "point" && element.locked === true;
    labelRow.value.appendChild(labelInput);
    host.appendChild(labelRow.root);

    const colorRow = row("Color");
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "ctx-color";
    colorInput.value = normalizeColor(element.style?.color) ?? "#111111";
    colorRow.value.appendChild(colorInput);
    host.appendChild(colorRow.root);

    const opacityRow = row("Opacity");
    const opacityInput = document.createElement("input");
    opacityInput.type = "range";
    opacityInput.min = "0";
    opacityInput.max = "1";
    opacityInput.step = "0.01";
    opacityInput.className = "ctx-range";
    opacityInput.value = String(element.style?.opacity ?? 1);
    opacityRow.value.appendChild(opacityInput);
    host.appendChild(opacityRow.root);

    const actions = document.createElement("div");
    actions.className = "ctx-actions";
    const closeBtn = document.createElement("button");
    closeBtn.className = "ctx-btn";
    closeBtn.textContent = "Close";
    closeBtn.type = "button";
    closeBtn.addEventListener("click", close);

    const applyBtn = document.createElement("button");
    applyBtn.className = "ctx-btn primary";
    applyBtn.textContent = "Apply";
    applyBtn.type = "button";
    applyBtn.addEventListener("click", () => {
      applyEdits(labelInput.value, colorInput.value, Number(opacityInput.value));
      close();
    });

    actions.appendChild(closeBtn);
    actions.appendChild(applyBtn);
    host.appendChild(actions);

    const applyEdits = (label, color, opacity) => {
      const st = deps.getState();
      const d = st.docs[st.activeGeometry];
      const el = findElement(d, target);
      if (!el) return;

      const nextOpacity = clamp(opacity, 0, 1);
      const nextLabel = label.trim() || el.label;
      const canEditLabel = !(target.kind === "point" && el.locked === true);
      const curStyle = el.style ?? { color: "#111111", opacity: 1 };
      const nextStyle = { color, opacity: nextOpacity };

      const didChange =
        (canEditLabel && nextLabel !== el.label) ||
        nextStyle.color !== curStyle.color ||
        nextStyle.opacity !== curStyle.opacity;

      if (didChange) deps.pushHistory();
      if (canEditLabel) el.label = nextLabel;
      el.style = nextStyle;
      deps.requestRender();
    };

    labelInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        applyEdits(labelInput.value, colorInput.value, Number(opacityInput.value));
        close();
      } else if (e.key === "Escape") {
        close();
      }
    });
  };

  document.addEventListener("pointerdown", (e) => {
    if (!openTarget) return;
    if (e.target instanceof Node && host.contains(e.target)) return;
    close();
  });

  window.addEventListener("resize", () => {
    if (openTarget) close();
  });

  return { openAt, close };
}

/**
 * @param {any} doc
 * @param {{kind:"point"|"line"|"circle", id:string}} target
 */
function findElement(doc, target) {
  if (target.kind === "point") return doc.points.find((p) => p.id === target.id) ?? null;
  if (target.kind === "line") return doc.lines.find((l) => l.id === target.id) ?? null;
  return doc.circles.find((c) => c.id === target.id) ?? null;
}

function row(label) {
  const root = document.createElement("div");
  root.className = "ctx-row";
  const l = document.createElement("label");
  l.textContent = label;
  const value = document.createElement("div");
  value.style.flex = "1";
  value.style.display = "flex";
  value.style.justifyContent = "flex-end";
  root.appendChild(l);
  root.appendChild(value);
  return { root, value };
}

/** @param {string | undefined} color */
function normalizeColor(color) {
  if (!color) return null;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  return null;
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
