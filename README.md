# Compass & Straightedge Lab

An educational, no-dependency web app for exploring ruler-and-compass constructions in several geometries:

- Euclidean
- Inversive Euclidean (lines are circles through a fixed point `*`)
- Spherical (unit sphere, rotatable)
- Hyperbolic (Poincaré disk)
- Hyperbolic (Upper half-plane)

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Notes

- Points are draggable; dependent lines/circles update live.
- Right-click an element to edit label/color/opacity.
- Tool-building mode is intentionally **not** implemented yet (planned for a later request).

