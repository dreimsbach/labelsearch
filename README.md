# Label Release Tracker

Modern web app to find new releases of your record labels. Primary sources: **Deezer** and **MusicBrainz** (optional **Discogs** for vinyl-only labels), enriched with **iTunes** (Apple Music links, genre) and **Cover Art Archive**.

## Features

- Label management with MusicBrainz MBID resolution; labels without a MusicBrainz match are kept by name (dashed chip) and still searched on Deezer/Discogs
- Search window config with selector:
  - `Days` mode (default `7`): searches the last N days including today
  - `Year` mode (e.g. `2026`): searches all releases in that year
- Country dropdown (default `DE`, iTunes storefront with `US` fallback)
- Source checkboxes:
  - `Deezer` (default on): fast, best coverage for new digital releases
  - `MusicBrainz` (default on): curated, exact label IDs
  - `Discogs` (default off): for vinyl-only labels; slow and lags for brand-new releases. Optional token input appears when selected.
- One streamed search request: cards appear label by label and get Apple links/covers as soon as enrichment finishes; `Cancel` stops a running search
- Duplicate releases across sources and labels are merged into one card (title + artist, featured artists and ` - EP` suffixes tolerated, dates within 14 days)
- Partial failures are shown per label and source; one failing source never hides results of the others
- Server-side provider cache (persisted to `data/cache.json`): a repeated search is answered almost instantly
- Release grid with cover, artist, title, release date, genres (1-3), styles (Discogs), label(s)
- Apple Music desktop-app deep links (`music://`) for artist + album when available, otherwise a copy `Artist + Album` button
- TXT/CSV upload for batch label import (line-based, supports comment lines starting with `#`)
- Export of current label list as `.txt` in import-compatible format (includes comment header)
- Local persistence via `localStorage`
- Responsive UI for desktop/tablet/mobile
- Collapsible on-page instruction section explaining workflow and import format

## How the search works

Per label, all selected sources run in parallel:

- **Deezer**: `label:"<name>"` album search, walked newest-ingested first (Deezer ids grow over time). Album details are checked for an exact label match (after removing words like `Records`/`Ltd.`) and the date window. The walk stops after 10 albums released more than 180 days before the window, which is usually 20-40 requests per label.
- **MusicBrainz**: `laid:<MBID> AND date:[from TO to]`, only exact dates in `Days` mode.
- **Discogs**: exact label id (via MusicBrainz URL relation or exact name), label release listing filtered by year, then release details for the exact date.

Every provider has its own rate limiter (Deezer 40/5 s, MusicBrainz 1/1.1 s, iTunes 20/min, Discogs 55/min with token, 22/min without). Throttling responses pause that provider and are retried with `Retry-After`/backoff.

Measured on 2026-11-13 (four releases out that day on Erased Tapes, Nonesuch, Latency, CINTH): Deezer + MusicBrainz found 3/4 in ~21 s for all four labels; the old Discogs-only mode found 0/4. CINTH's EP is only on Apple Music, whose label API needs a paid Apple Developer account.

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Testing: Vitest
- Container: Docker (multi-stage) + docker-compose

## Project Structure

- `src/`: frontend app and UI components
- `server/`: API, provider integrations, matching logic
- `shared/`: shared API/types between frontend and backend
- `docs/SPEC.md`: product + technical specification
- `AGENTS.md`: persistent maintenance rules (docs/deploy sync requirements)

## Quick Start

### Prerequisites

- Node.js 22+
- npm

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API in dev (proxied by Vite): `http://localhost:8787`

### Quality Checks

```bash
npm run check
npm run test
npm run build
```

### Production (without Docker)

```bash
npm run build
npm start
```

App/API run on `http://localhost:8787`.

## Docker

### Build and Run

```bash
docker compose up --build
```

Then open `http://localhost:8787`.

Image build/runtime uses `node:22-alpine` (multi-stage) to keep the final container smaller.

The provider cache lives in `/app/data` (`CACHE_FILE_PATH=/app/data/cache.json`); `docker-compose.yml` mounts the named volume `labelsearch-data` there so it survives restarts.

### Health Check

```bash
curl http://localhost:8787/api/health
```

### GitHub Actions (Docker Hub Push Only)

The repository includes a workflow at `.github/workflows/dockerhub-push.yml` that:

- runs on pushes to `main`, on git tag pushes, and manually via `workflow_dispatch`
- builds the Docker image
- pushes to Docker Hub only (no server deploy step)
- publishes tags:
  - `drmsbh/labelsearch:latest` for `main`
  - `drmsbh/labelsearch:<git-tag>` for git tag pushes (for example `v1.2.0`)

Docker image name is configured in the workflow via `IMAGE_NAME` (currently `drmsbh/labelsearch`).

Required GitHub repository secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

## Environment Variables

- `PORT` (default: `8787`)
- `NODE_ENV` (default: `production` in container)
- `MB_USER_AGENT` (optional; defaults to the neutral placeholder `example-app/0.0.0`)
- `LOG_FILE_PATH` (optional; default `./logs/app.log`)
- `DISCOGS_TOKEN` (optional; improves Discogs rate limits)
- `DISCOGS_USER_AGENT` (optional; defaults to the neutral placeholder `example-app/0.0.0`)
- `CACHE_FILE_PATH` (optional; default `./data/cache.json`, `/app/data/cache.json` in the container; set to an empty value to keep the cache in memory only)
- Default User-Agents deliberately contain no traceable data (no e-mail, repo link, URL or name). Set your own value via env only if you want to.
- Request-level token precedence: token entered in UI (`discogsToken`) is used first; if empty, backend falls back to env `DISCOGS_TOKEN`.

## API Endpoints

- `GET /api/health`
- `GET /api/labels/search?q=<term>&limit=<n>`
- `POST /api/releases/stream` (NDJSON event stream, used by the UI)
- `POST /api/releases/search` (same search, single JSON response)

Request body: `{ labels: [{ name, mbid? }], timeMode, timeValue, country, sources: ["deezer","musicbrainz","discogs"], timezone, discogsToken? }`. The legacy `sourceMode` field is still accepted.

Request/response details are documented in [docs/SPEC.md](docs/SPEC.md).

## Notes

- Discogs tokens are sent as `Authorization` header and redacted from errors/logs.
- If enrichment (iTunes, Cover Art Archive) fails, releases are still shown.
- Cover priority: Deezer -> Discogs -> Cover Art Archive -> iTunes. Apple artwork URLs are normalized to a high-resolution variant.
- Year searches for old years cannot use the Deezer early stop and are capped at 400 album lookups per label.
- Server writes structured logs to console and file (`LOG_FILE_PATH`, default `logs/app.log`).

## Changelog

### 2026-11-13

- Reworked search for reliability and speed: Deezer + MusicBrainz are the default sources and run in parallel per label; Discogs is optional and uses exact label ids instead of fuzzy label search.
- Source dropdown replaced by source checkboxes (`sources` in the API; `sourceMode` still accepted).
- New streamed endpoint `POST /api/releases/stream`; the UI sends one request, renders label by label and can cancel.
- Per-provider rate limiters with `Retry-After` handling, single retry layer, persistent provider cache (`CACHE_FILE_PATH`, Docker volume `/app/data`).
- Labels without a MusicBrainz match are kept by name instead of being dropped on import.
- Better dedupe across sources (featured artists, ` - EP` suffix, small date drift) and iTunes matching for multi-artist credits.
- Fixed: MusicBrainz year-only dates leaking into day searches, Discogs token in URLs/logs, date window depending on server timezone.
- Default User-Agents for MusicBrainz and Discogs (code and `docker-compose.yml`) are now the neutral placeholder `example-app/0.0.0` without any traceable contact data.

### 2026-03-20

- Added new primary source mode `discogs` in API and UI (`Discogs only`).
- Implemented Discogs label search flow with exact date filtering from release detail field `released`.
- Added Discogs enrichment fields for primary mode: `styles`, `trackCount`, and deterministic type inference (`Album`/`EP`/`Single`).
- Release cards now render `Styles` when available, alongside `Genres`.
- Added tests for Discogs primary search behavior (including `Smallville` 2026 and exact-day matching) and Discogs track counting rules.
- Added Apple link enrichment in `discogs` mode via iTunes matching (artist/album links in cards when matched).
- Added Discogs request throttling + retry behavior for `429` and a clearer user-facing partial-failure message for Discogs rate limits.
- Added optional Discogs token input in the UI; request token now overrides env token for that search.
- Multi-label searches now render release cards incrementally and show a spinner hint while more results are still loading.
- Switched default source mode to `discogs` and removed user-selectable `itunes only` mode; iTunes remains active for Apple link enrichment.

### 2026-03-19

- Added GitHub Actions workflow `.github/workflows/dockerhub-push.yml` for Docker Hub push-only CI.
- Workflow now builds and pushes `drmsbh/labelsearch` image tags (`latest` on `main`, `<git-tag>` on tag push).
- Documented required GitHub Secrets for Docker Hub authentication.
- Switched Docker build/runtime base images to `node:22-alpine` and `npm ci` for a leaner, reproducible container build.
- Updated Docker tag strategy: `main` pushes publish `latest`; git tag pushes publish the same tag name.
- Added workflow-level `IMAGE_NAME` variable to control Docker Hub repository name centrally.

### 2026-03-13

- Added server-side file logging (default `logs/app.log`) for startup, HTTP requests, and provider/search errors.
- Added `LOG_FILE_PATH` environment variable and docker-compose default (`/app/logs/app.log`).
- Aligned per-card action row to the bottom so Apple icons / copy fallback button sit on the same visual baseline across cards.
- Added card-level fallback action: if no Apple links exist, show a button to copy `Artist + Album` to clipboard.
- Increased Apple icon button size for better tap/click usability.
- Mobile controls panel is no longer sticky; search/filter section now scrolls with the page.
- Switched Apple app icon buttons to use the provided Wikimedia Apple Music icon asset URL.
- Updated Apple app links to use a unified Apple Music-style icon for both artist and album actions.
- Replaced Apple link text in release cards with compact icon buttons (artist/album) while keeping app deep links.
- Removed explicit Apple web fallback links from cards; only direct app links are shown.
- Apple Music links now provide direct desktop-app deep links (`music://...`) with explicit web fallback links.
- Restored Apple Music links in release cards while keeping reduced core metadata layout.
- Reduced release card UI to core fields only: album title, artist, release date, label, genre.
- Normalized MusicBrainz/CAA cover usage to explicit `front-1200` URL to avoid very large original cover files.
- Added multi-source enrichment fallback (iTunes -> Deezer -> Discogs) for links/covers/genre.
- Added deep MusicBrainz metadata mapping: status, country, barcode, packaging, media format, and track count.
- Added external links rendering on release cards (Apple, Deezer, Discogs, official links from MusicBrainz relations).
- Added optional Discogs env vars (`DISCOGS_TOKEN`, `DISCOGS_USER_AGENT`).
- Added export for the current label list (`Export List`) with re-upload compatible format.
- Upgraded cover handling to high-res Apple artwork URLs (`1200x1200bb.jpg`).
- Fixed form control overflow so dropdowns stay within their grid container.
- Import now supports comments (`#...`) and ignores leading/trailing whitespace in label rows.
- Export writes the same structure with a comment header line and plain text label rows.
- Import/export format is a plain text list (quotes optional, not required).
- Added an in-app instruction panel with usage steps and import file example.
- Improved cover quality/accuracy by preferring Cover Art Archive original images with iTunes fallback.
- Set iTunes fallback artwork target size to `1200x1200bb.jpg`.
- Added runtime cover URL normalization in the card renderer to avoid stale `100x100` display links.
- Refined control layout: instructions moved to collapsible details and button groups optimized for clearer action priority.
- Updated direct-search UX: selected label from lookup is now used explicitly via `Search with selected label`; otherwise first result is used.
- Added range selector with `Days` / `Year` mode (`7 Days` default).
- Fixed range selector layout overlap by switching to a stable flex-based control layout.
- Improved mid-size responsive controls: filter row switches to a two-column layout with full-width source selector.
- Adjusted mid-size control grid to explicit 2x2 placement: `[empty][Range]` then `[Country][Source]`.
- Fixed remaining range/filter overlap by making the control grid two-column by default (mobile stays one-column).
