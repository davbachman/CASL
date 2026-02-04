# Subagents (Roles)

This repo is organized so work can be split cleanly across “subagents” (roles):

## UI subagent

Owns:

- `index.html`, `styles.css`
- `src/ui/*`
- menu/tool UX and interaction affordances

## Engine (back-end) subagent

Owns:

- `src/engine/state.js` (data model + labels)
- `src/engine/geometry.js`, `src/engine/geom2d.js`, `src/engine/vec2.js`, `src/engine/vec3.js`
- `src/engine/renderer.js` (drawing)
- `src/engine/inputController.js` (tools, snapping, dragging, view controls)

## Project management subagent

Owns:

- `docs/*`
- feature roadmap and scope control (especially tool-building mode)

