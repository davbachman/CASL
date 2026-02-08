# Compass & Straightedge Lab

Compass & Straightedge Lab is a no-dependency browser app for geometric constructions across Euclidean, spherical, and hyperbolic models, including model switching and user-defined custom tools.

## Features At A Glance

- Construct points, lines/geodesics, circles, and intersections.
- Work in 9 models:
- Euclidean Standard
- Euclidean Perspective
- Euclidean Inversive
- Spherical Standard
- Spherical Stereographic
- Hyperbolic Poincare Disk
- Hyperbolic Half Plane
- Hyperbolic Klein
- Hyperbolic Hyperboloid
- Drag points and keep incidence constraints live.
- Pan and zoom every model.
- Use right-click context editing for labels, colors, and opacity.
- Build reusable custom tools from existing constructions.
- Export/import tools and full constructions as JSON.
- View textual construction history and print it.
- Undo per active model’s construction document.
- Toggle debug/intermediate custom-tool steps with Show Steps.

## Run Locally

From the repository root:

```bash
python3 -m http.server 8000
```

Then open:

`http://localhost:8000`

No build step and no npm dependencies are required for runtime.

## Interface Tour

### Top Menu Bar

- `File`
- `Save Construction`
- `Import Construction`
- `Save Tools`
- `Import Tools`
- `Geometry`
- Euclidean: `Standard`, `Perspective`, `Inversive`
- Spherical: `Standard`, `Stereographic`
- Hyperbolic: `Poincare Disk`, `Half Plane`, `Klein`, `Hyperboloid`
- `Edit`
- `Undo` (also `Cmd/Ctrl+Z`)
- `Delete`
- `Clear` (active geometry only)
- `Reset` (all geometries + tools; confirmation required)
- `View`
- `Show History` / `Hide History`
- `Show Steps` / `Hide Steps`
- Status text on the right always shows current geometry/model:
- `Geometry: <family> | Model: <model>`

### Left Sidebar

- Core tools:
- `Point`
- `Line`
- `Circle`
- `Intersect`
- `Build Tool` button for creating custom tools.
- `Custom Tools` list appears when tools exist.
- Tool hint area:
- Shows guidance for the active tool.
- Shows custom-tool input progress.
- Shows tool-builder stage and validation errors.

### Canvas

- Main interactive drawing surface.
- Left click for tool actions and selection.
- Drag points to move them subject to constraints.
- Drag background to pan (model-dependent behavior).
- Mouse wheel to zoom.
- Right-click point/line/circle to open style editor.

### History Pane (Right)

- Collapsible construction-history panel.
- Lists natural-language construction steps for active geometry.
- `Print History` opens a print-friendly page.

## Construction Workflow

### Point Tool

- Click empty space to create a point.
- Click near an existing curve to create a constrained point on that curve.
- Click an existing point to select/reuse it (no duplicate).

### Line Tool

- Click first point.
- Click second point.
- Creates a line/geodesic according to the active model.

### Circle Tool

- Click center point.
- Click radius point.
- Creates model-appropriate circle.

### Intersect Tool

- Click first line/circle.
- Click second line/circle.
- Creates all valid visible intersection point(s) not already near existing points.

### Selection Mode (No Active Tool)

- Click an already active tool button again to deactivate tools.
- In this mode, canvas clicks select existing geometry only.
- Useful for deletion and style editing without creating objects.

## Editing, Styles, And Deletion

### Right-Click Context Menu

- Available on points, lines, and circles.
- Editable fields:
- `Label`
- `Color`
- `Opacity`
- `Apply` commits changes.
- `Close` discards.
- `Enter` in label input applies.
- `Escape` closes menu.
- Locked points (for example `∞` in inversive model) cannot be relabeled.

### Delete Behavior

- Select an object, then press `Delete`/`Backspace` or use `Edit -> Delete`.
- Deletion is cascading:
- Removes selected object.
- Removes chronologically later objects/dependents created after it.
- This preserves construction consistency.

### Undo, Clear, Reset

- `Undo` reverts construction changes in the active geometry.
- Undo tracks construction docs, including point drags.
- View pan/zoom and tool selection are not part of undo snapshots.
- `Clear` wipes only the active geometry’s construction.
- `Reset` restores the entire app:
- all geometries reset
- custom tools removed
- show-steps disabled
- active geometry/tool reset to defaults

## Model Behavior

### Euclidean Standard

- Classical plane model.
- Lines are straight Euclidean lines.
- Circles are Euclidean circles.

### Euclidean Perspective

- World geometry lives in the XY plane with domain `y > 0`.
- Projection uses camera `(0, -40, 10)` onto the XZ view plane.
- Horizon line is fixed at viewport mid-height.
- Visible ground region is clipped below the horizon to model-valid depth.
- Lines render as exact projective images under the model homography.
- Euclidean circles generally appear as ellipses in the display.
- Panning is pointer-anchored to keep geometry under the cursor while dragging.

### Euclidean Inversive

- Maintains a locked infinity point `∞`.
- “Lines” are represented inversively:
- lines through `∞` remain Euclidean lines
- other lines become circles through `∞`
- Circle/line behavior follows inversive transformations while preserving incidences.

### Spherical Standard

- Unit sphere model in 3D.
- Lines are great circles.
- Circles are sphere-plane intersections.
- Front/back visibility is rendered with depth-aware styling.

### Spherical Stereographic

- Spherical geometry shown in stereographic chart.
- Same underlying spherical incidences as Standard spherical.
- Marker `S` at chart origin denotes the south-pole image.
- Curves crossing projection singularities are rendered with break handling.

### Hyperbolic Poincare Disk

- Domain is the open unit disk.
- Geodesics are diameters or circular arcs orthogonal to boundary.
- Outside-disk region is shaded and clipped.

### Hyperbolic Half Plane

- Domain is upper half-plane (`y > 0`).
- Boundary line (`y = 0`) is drawn and lower region shaded.
- Geodesics are vertical lines or semicircles orthogonal to boundary.

### Hyperbolic Klein

- Domain is open unit disk.
- Geodesics display as straight chords.
- Internally maps via Poincare chart to preserve incidences.

### Hyperbolic Hyperboloid

- 3D hyperboloid surface view with projected rendering.
- Drag background to pan origin on chart.
- `Shift` + drag background to rotate view.
- Geodesics/curves are rendered with front/back occlusion cues.
- Hyperboloid axis is constrained to stay vertically aligned.

## Panning And Zooming By Model

- Standard 2D models: drag background pans viewport.
- Fixed-frame models (`Euclidean Perspective`, `Hyperbolic Poincare`, `Hyperbolic Half Plane`, `Hyperbolic Klein`):
- drag changes model-origin offsets while frame anchoring stays stable.
- Spherical Standard: drag background rotates the sphere view.
- Hyperboloid: plain drag pans chart origin; `Shift` + drag rotates view.
- Mouse wheel zooms all models.

## Custom Tools

Custom tools let you turn a finished construction fragment into a reusable operation.

### Build A Tool

1. Click `Build Tool`.
2. Enter a name.
3. Input stage:
- click any points/lines/circles to include as inputs
- click again to toggle an input off
- press `Enter` when done selecting inputs
4. Output stage:
- click exactly one point/line/circle to define output
5. Finalize:
- tool is validated and added to `Custom Tools`
- if invalid, tool-builder returns to output stage with an error message

### Use A Custom Tool

1. Click the custom tool button in sidebar.
2. Provide inputs in required order/type as prompted.
3. On final input, tool is applied and output object is created.

### Tool Builder / Tool Use Controls

- `Escape` cancels tool-builder mode.
- `Escape` cancels in-progress custom-tool input selection.
- Tool hints always indicate expected next input and errors.

### Show Steps (Debug Intermediates)

- `View -> Show Steps` reveals intermediate debug objects generated by custom tools.
- `Hide Steps` hides these intermediates.
- Final tool output remains visible regardless.

## History

- Every construction action appends a step description in active geometry history.
- History includes:
- point creation
- line/circle creation
- intersections
- custom-tool applications
- `Print History` opens a printable page in a new window.

## Import/Export

### Save/Import Tools

- Saves custom tools to JSON with metadata:
- kind: `compass-straightedge-tools`
- version: `1`
- Import accepts:
- direct tool arrays
- objects containing `customTools` or `tools`
- Imported tools are normalized and re-IDed to avoid collisions.

### Save/Import Construction

- Saves full app state to JSON:
- active geometry/tool
- show-steps state
- all docs
- all views
- custom tools
- Import normalizes docs/views and repairs model-required invariants (for example inversive `∞` point).
- Cross-model data structures are sanitized to keep references valid.

## Geometry Switching And Conversion

- Switching among models in the same family attempts automatic conversion:
- Euclidean Standard <-> Euclidean Perspective <-> Inversive
- Spherical Standard <-> Stereographic
- Hyperbolic models among Poincare/Half Plane/Klein/Hyperboloid
- Conversions preserve incidences where possible and sanitize invalid references.
- Non-convertible family switches do not merge constructions across families.

## Keyboard And Mouse Reference

- `Cmd/Ctrl + Z`: undo (when focus is not in text input)
- `Delete` or `Backspace`: delete selected object with cascade
- `Enter`: advance tool-builder from input stage to output stage
- `Escape`: cancel tool-builder or active custom-tool input collection
- Left click: construct/select
- Left drag on point: move point
- Left drag on background: pan/rotate depending on model
- Wheel: zoom
- Right click object: open style/label context editor

## Browser Notes

- Saving uses native save dialogs when available.
- Falls back to download-based save.
- Safari includes a helper save window fallback for JSON.
- Pop-up blockers can affect print/save helper windows.

## Deploy On GitHub Pages

This repo includes `.github/workflows/deploy-pages.yml`, which deploys on pushes to `main`.

### 1. Create Repository

- Create a public GitHub repository.
- Do not initialize it with extra starter files if this repo is already local.

### 2. Push This Project

Replace placeholders:

```bash
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
git push -u origin main
```

### 3. Enable GitHub Pages

- In GitHub, open `Settings -> Pages`.
- Under Build and deployment, set Source to `GitHub Actions`.

### 4. Verify Deployment

- Open `Actions` tab and watch `Deploy GitHub Pages`.
- After success, app URL is:
- `https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPO_NAME>/`

### 5. Optional Custom Domain

- Configure domain in `Settings -> Pages`.
- Add required DNS records at your DNS provider.
