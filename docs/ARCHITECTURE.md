# Architecture

This project is intentionally **no-dependency** (HTML/CSS/ES modules) so it can be served from any static server.

## High-level layout

- `index.html`: app shell (menu bar, tool sidebar, canvas pane).
- `styles.css`: layout + simple UI styling.
- `src/app.js`: wires UI events to engine + renderer.
- `src/engine/`: “back-end” logic (state, geometry math, rendering, input).
- `src/ui/`: UI widgets that don’t depend on geometry (currently: context menu).

## Data model

Each geometry has its own “document”:

- Points: `{id,label,x,y,(z),style}`
- Lines: `{id,label,p1,p2,style}`
- Circles: `{id,label,center,radiusPoint,style}`

Lines/circles are **defined by point references**, so dragging points automatically updates all derived objects.

## Rendering

- 2D models are drawn on a 2D canvas with a shared pan/zoom transform.
- The sphere is drawn on the same canvas using simple 3D math + orthographic projection; drag rotates, wheel zooms.

## Future extension: tool-building mode

The construction engine stores objects as references to points, so a future “tool-building mode” can record:

- inputs (selected objects)
- a sequence of construction steps (line / circle / intersect)
- outputs (created objects)

without changing how the renderer works.

