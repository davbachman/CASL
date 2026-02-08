# Compass & Straightedge Lab

An educational, no-dependency web app for exploring ruler-and-compass constructions in several geometries:

- Euclidean
- Inversive Euclidean (lines are circles through a fixed point `∞`)
- Spherical (unit sphere, rotatable)
- Hyperbolic (Poincaré disk)
- Hyperbolic (Upper half-plane)

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Deploy on GitHub Pages

This project is configured to deploy automatically from the `main` branch using GitHub Actions.

### 1. Create a new GitHub repository

- In GitHub, create a new **public** repo.
- Do **not** initialize it with a README or license (your local repo already has files).

### 2. Connect this local repo to GitHub

Replace `<YOUR_GITHUB_USERNAME>` and `<YOUR_REPO_NAME>`:

```bash
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
git push -u origin main
```

### 3. Enable Pages deployment

- Open your repo on GitHub.
- Go to `Settings` -> `Pages`.
- Under **Build and deployment**, set **Source** to `GitHub Actions` (if it is not already set).

### 4. Wait for the first deploy

- Go to the `Actions` tab and open the workflow run named `Deploy GitHub Pages`.
- After it succeeds, your app will be published at:
  - `https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPO_NAME>/`

### 5. (Optional) Use a custom domain

- In `Settings` -> `Pages`, set your custom domain.
- Configure DNS at your domain provider:
  - `CNAME` for a subdomain (`www` style) to `<YOUR_GITHUB_USERNAME>.github.io`
  - For apex/root domains, add the `A`/`AAAA` records GitHub Pages lists.

## Notes

- Points are draggable; dependent lines/circles update live.
- Right-click an element to edit label/color/opacity.
- Tool-building mode is intentionally **not** implemented yet (planned for a later request).
