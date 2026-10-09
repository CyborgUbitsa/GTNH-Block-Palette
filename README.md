# GTNH Block Palette

Pick a colour and find the GT: New Horizons blocks that look closest to it.
The site is fully static: all search runs in the browser, no server needed.

## Repository layout

| Path | What it is |
|---|---|
| `dist/` | The published site: `index.html`, hashed JS/CSS, block data and texture atlases. |
| `web/` | Page sources (`index.html` template, `app.js`, `style.css`), copied into `dist/` by the bake. |
| `site.config.json` | Footer text/links and where block reports are sent. Inlined into `dist/index.html` at bake time. |
| `worker/report-worker.js` | Optional Cloudflare Worker that forwards reports to Discord without exposing the webhook. |
| `.github/workflows/pages.yml` | Deploys `dist/` to GitHub Pages on push to `main`. |

`dist/` is produced by a local bake pipeline that reads the modpack's jars; the jars,
extracted textures and pipeline scripts are not part of this repository.

## Updating the site

1. Rebake locally (writes `dist/`).
2. Commit and push. The workflow publishes `dist/` within a minute or two.

Changing only `site.config.json` or `web/` also needs a rebake, since both are copied into `dist/`.

## Block reports

Set `report.mode` in `site.config.json`:

- `none`: the report dialog shows text for the user to copy.
- `worker`: POST to the Cloudflare Worker in `worker/` (recommended; see the file header for deploy steps).
- `discord`: POST straight to a Discord webhook. Simple, but the webhook URL is public.

## Credits

Fan-made tool, not affiliated with GT: New Horizons. All textures belong to their
respective mod authors and are shown here for reference only.
