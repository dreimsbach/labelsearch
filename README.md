# Label Release Tracker

Modern web app to track record-label releases using **MusicBrainz (label-accurate search)** with multi-source enrichment (**iTunes, Deezer, Discogs**).

## Features

- Label management with MBID-backed selection
- Search window config with selector:
  - `Days` mode (default `7`): searches the last N days including today
  - `Year` mode (e.g. `2026`): searches all releases in that year
- Country dropdown (default `DE`)
- Source mode dropdown:
  - `hybrid` (default): MusicBrainz search + iTunes enrichment
  - `musicbrainz`
  - `itunes`
- Direct search behavior:
  - without selected candidate: uses the first label result for input query
  - with selected candidate from result list: button switches to `Search with selected label`
- Release grid with:
  - cover
  - artist
  - title
  - release date
  - genres (1-3, fallback strategy)
  - label(s)
  - intentionally reduced UI detail set (no extra metadata block in cards)
  - Apple Music desktop-app deep links (`music://`) for artist + album when available (icon buttons)
- TXT/CSV upload for batch label import (line-based, supports comment lines starting with `#`)
- Export of current label list as `.txt` in import-compatible format (includes comment header)
- Local persistence via `localStorage`
- Responsive UI for desktop/tablet/mobile
- Cover priority in `hybrid/musicbrainz`: Cover Art Archive (MB, forced to `front-1200`) -> Deezer -> iTunes -> Discogs
- Collapsible on-page instruction section explaining workflow and import format
- Improved action button hierarchy (primary search actions + secondary utility actions)

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

### Health Check

```bash
curl http://localhost:8787/api/health
```

## Environment Variables

- `PORT` (default: `8787`)
- `NODE_ENV` (default: `production` in container)
- `MB_USER_AGENT` (recommended for MusicBrainz requests)
- `LOG_FILE_PATH` (optional; default `./logs/app.log`)
- `DISCOGS_TOKEN` (optional; improves Discogs rate limits)
- `DISCOGS_USER_AGENT` (optional; defaults to app User-Agent)

## API Endpoints

- `GET /api/health`
- `GET /api/labels/search?q=<term>&limit=<n>`
- `POST /api/releases/search`

Request/response details are documented in [docs/SPEC.md](/Users/dreimsbach/repos/labelsearch/docs/SPEC.md).

## Notes

- MusicBrainz requests are throttled (~1 req/s).
- External fallback matching (Deezer/Discogs) uses strict artist/title/date checks (date must be within ±7 days).
- If enrichment providers fail, MusicBrainz release entries are still shown.
- Cover selection in `hybrid/musicbrainz` prefers Cover Art Archive by MB release ID to reduce incorrect iTunes artwork matches.
- Cover rendering normalizes Apple artwork URLs at runtime to a high-resolution variant.
- Server writes structured logs to console and file (`LOG_FILE_PATH`, default `logs/app.log`).

## Changelog

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
