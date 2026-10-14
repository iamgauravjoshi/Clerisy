# Clerisy website

The product site: plain HTML and CSS, no build step. Vercel serves this folder as it is.

- `index.html` (home), `privacy.html`, `download.html`, `404.html`; `styles.css` is shared.
- `vercel.json`: clean URLs (`/privacy` serves `privacy.html`), long caching for `/assets`, a few security headers.
- `assets/`: the logo, and screenshots of the real app with invented demo data.

## Deploy on Vercel

New project → import this repository → set **Root Directory** to `website` → Framework preset **Other**, no build command,
output directory `.` (the defaults when there's no `package.json`). Each push to `main` redeploys.

## Refresh the screenshots

`node scripts/demo-data.mts <dir>` (from the repository root) writes the demo project into a throwaway profile. Run the app on it
with `npx electron . --user-data-dir=<dir>`, take screenshots at 1440×900 at 2× scale, and save them as WebP in `assets/`.

## Preview locally

Any static server, for example `npx serve website`. Opening the files directly works too, but the root-relative links (`/privacy`)
need a server.
