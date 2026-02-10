# AGENTS.md

Scope: repository root (applies to entire tree).

Purpose: operational instructions for future Codex agents.

Repo structure (authoritative)
- `index.html`: DOM shell, top menus, tool/sidebar, canvas, history pane.
- `styles.css`: UI/layout styling only.
- `src/main.js`: bootstraps app + menu dispatch via `data-action`.
- `src/app.js`: app orchestration, geometry switching, history, import/export, reset/delete flows.
- `src/engine/*`: geometry/state/render/input/tool-building logic.
- `src/ui/contextMenu.js`: right-click editor UI.
- `docs/*`: advisory docs; may lag current code.

Core invariants
1. `src/engine/state.js` is the source of truth for `GeometryType`, `ToolType`, and state shape.
2. `AppState.docs[geom]` holds one `ConstructionDoc` per geometry; do not merge docs across geometries.
3. `Line`/`Circle` objects store point references (`p1/p2`, `center/radiusPoint`), not cached curve equations.
4. Object IDs are monotonic (`makeId` + `nextId`); cascade deletion depends on numeric suffix ordering.
5. Inversive model requires a locked `∞` point and `doc.starPointId`.
6. Cross-model conversion must preserve incidences; use `convertDocForModelSwitch` + `sanitizeConvertedDoc`.
7. Hyperbolic conversions must route through Poincare chart transforms in `src/engine/hyperbolicModels.js`.
8. After any mutation/remap, history/object refs must remain valid (`sanitizeConvertedDoc` behavior).
9. `state.showSteps` controls visibility of debug intermediates; hidden means not rendered.
10. Menu behavior is selector-driven; keep `index.html` `data-action` values aligned with `src/main.js`.
11. Geometry/model status text is always shown in top toolbar `#statusText`; sidebar `#toolHint` contains tool guidance only.
12. `state.multiSelection` is the canonical shift-selection list; renderer highlighting and group-drag behavior must use this list.
13. Custom tool overflow must stay inside the sidebar scroll container (`.sidebar`/`#customToolList`), not spill below the panel.
14. Intersection branch picking for tool replay/constraint enforcement must avoid collapsing sibling points onto the same intersection when alternate branches exist.

Interaction rules
- Active tool may be empty (`""`): canvas clicks select existing geometry instead of constructing.
- `Shift+click` toggles points/lines/circles in `state.multiSelection`.
- In 2D models, dragging a selected point that belongs to a multi-selection moves all unlocked defining points from the selected refs, then re-enforces constraints.
- `Delete` removes selected element and all later-created dependent/chronological objects in active geometry.
- `Escape` exits tool-builder/tool-use transient states.
- Hyperboloid: plain drag pans origin; Shift-drag rotates model.

Rendering/model rules
- `view.kind === "sphere"` only for spherical and hyperboloid models; others use `view.kind === "2d"`.
- Model-domain clipping is mandatory (disk, half-plane boundary, perspective ground region, hyperboloid rim).
- Keep hyperboloid axis vertical (`enforceHyperboloidAxis` forces yaw semantics).
- Euclidean perspective uses camera `(0,-40,10)` projection with world-domain `y>0`; horizon stays anchored at viewport mid-height.
- Perspective inverse mapping must satisfy round-trip with forward mapping (notably, inverse `x` uses `CAMERA_Y`, not `CAMERA_Z`).
- Perspective line rendering/hit testing must use the exact transformed line (`perspectiveDisplayLineFromWorldLine`) with chart-offset-aware coefficients; avoid finite sampling for line pick accuracy.
- Perspective pan is pointer-anchored but must clamp display-y away from the horizon singularity during inverse solves.
- In perspective, interaction/display filters use displayed-domain checks, but geometric solving for hidden/debug tool intermediates may use full operation-domain intersections to preserve incidences.

Change hygiene rules
- Keep module export names stable across `src/engine/*` imports; update all callers in the same change.
- Keep cache-busting query suffixes coherent when entry-module imports are modified.
- Preserve no-dependency architecture (plain HTML/CSS/ES modules).

Unknown
- Automated test command: unknown.
- Lint/format command: unknown.
- CI deploy workflow: GitHub Pages via `.github/workflows/deploy-pages.yml`.
