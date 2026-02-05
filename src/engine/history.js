import { GeometryType } from "./state.js";

/**
 * @typedef {import("./state.js").AppState} AppState
 * @typedef {import("./state.js").GeometryType} GeometryType
 */

/**
 * Per-geometry undo history for construction docs.
 *
 * We intentionally track only `docs` (not views/tool selection) so undo stays focused
 * on constructions + point drags and behaves consistently across models.
 *
 * @param {AppState} state
 * @param {{maxDepth?: number}} [opts]
 */
export function createHistory(state, opts) {
  const maxDepth = Math.max(1, Math.min(1000, opts?.maxDepth ?? 200));

  /** @type {Record<string, any[]>} */
  const stacks = Object.create(null);
  for (const geom of Object.values(GeometryType)) stacks[geom] = [];

  /** @param {any} value */
  const clone = (value) => {
    // @ts-ignore - older browsers may not have structuredClone
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };

  /**
   * @param {GeometryType} geom
   * @returns {boolean}
   */
  const canUndo = (geom) => stacks[geom].length > 0;

  /** @param {GeometryType} geom */
  const push = (geom) => {
    stacks[geom].push(clone(state.docs[geom]));
    if (stacks[geom].length > maxDepth) stacks[geom].splice(0, stacks[geom].length - maxDepth);
  };

  /**
   * @param {GeometryType} geom
   * @returns {boolean}
   */
  const undo = (geom) => {
    const snap = stacks[geom].pop();
    if (!snap) return false;
    state.docs[geom] = snap;
    return true;
  };

  /** @param {GeometryType} geom */
  const clear = (geom) => {
    stacks[geom] = [];
  };

  return { push, undo, canUndo, clear };
}

