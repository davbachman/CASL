# Roadmap

## Next: tool-building mode (not implemented yet)

Goal: allow users to create *new tools* from sequences of primitive steps (line/circle/intersect), with declared inputs/outputs.

Suggested approach:

1. Add a “Tool-building mode” toggle in the UI.
2. In that mode, record an ordered list of primitive operations plus references to inputs/outputs.
3. Allow saving named tools and replaying them on new inputs.

## Nice-to-haves

- Delete elements + undo/redo
- Export/import constructions (JSON)
- Better selection UX (hover highlight, multi-select)
- Optional grid/axes overlays for Euclidean / inversive views
- Numeric coordinate display and/or measurement readouts

