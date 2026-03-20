# Label Release Tracker v1 Specification

## 1. Product Summary

Label Release Tracker is a web app to discover recent releases for selected record labels.

Core behavior:

1. Find/select labels from MusicBrainz and store them with MBID.
2. Search releases for a configurable date window with mode selector (`Days` default `7`, or `Year`).
3. Enrich results with multi-source metadata (iTunes, Deezer, Discogs) where available.
4. Present releases in a modern, responsive, card-based overview.

## 2. UX and Visual Requirements

## 2.1 Visual Direction

- Clean, modern, high-contrast design
- AOTY-inspired release listing, but not a direct clone
- Custom design tokens and component styling (not raw default controls)

## 2.2 Responsive Layout

Breakpoints:

- Mobile: `<= 640px`
- Tablet: `641px - 1024px`
- Desktop: `> 1024px`

Behavior:

- Desktop: two-column layout (`controls` + `results`)
- Tablet/mobile: single-column flow
- Mobile controls remain easy to access (sticky behavior)

## 2.3 Required UX States

- Loading state with skeleton cards
- Empty state when no releases found
- Error state for API/provider failures
- Progress display for list search/import (`x / n`)
- Collapsible instruction section explaining search workflow and import format
- Button hierarchy with clear primary actions (search) and secondary utility actions
- Keyboard-accessible form fields and actionable elements
- Visible focus styles and sufficient color contrast

## 3. Functional Specification

## 3.1 Label Input and Management

- Direct label input field
- Label lookup via MusicBrainz search endpoint
- Candidate selection with disambiguation context (`country`, `disambiguation`)
- Direct-search rule:
  - default: use first label result for current input query
  - when user selected a lookup candidate: primary button changes to `Search with selected label` and searches with that candidate
- Add selected label to persistent list
- Remove individual labels by clicking chip
- Clear entire label list
- Upload label list from `TXT/CSV`
- Export current label list as text file (`.txt`) for later re-import
- Import format is line-based text and supports comment lines (prefix `#`)
- Label rows are plain lines (no quotes required), leading/trailing whitespace is ignored
- Export format follows the same line-based structure and includes a comment header line

## 3.2 Search Configuration

Fields:

- `rangeValue` (number)
- `rangeMode` selector:
  - `days` (default): searches last `rangeValue` days including today
  - `year`: searches full calendar year `rangeValue` (e.g. `2026`)
- `country` dropdown (default `DE`)
- `discogsToken` (optional; user-provided request token)
- `sourceMode` dropdown:
  - `hybrid` (default)
  - `musicbrainz`
  - `discogs`
  - `itunes`

Date window rule:

- For `days` mode:
  - `toDate = today` in user timezone
  - `fromDate = today - (rangeValue - 1)`
  - inclusive range: `[fromDate, toDate]`
- For `year` mode:
  - `fromDate = YYYY-01-01`
  - `toDate = YYYY-12-31`

## 3.3 Result Fields

Each release card shows:

- Album cover (if available)
- Artist
- Album title
- Release date
- 1-3 genres/microgenres (best effort)
- styles (when available)
- Label(s)
- No additional detail/link section in card UI (core fields only)
- Apple artist icon link (`music://` desktop app deep link)
- Optional Apple album icon link (`music://` desktop app deep link)
- If no Apple links are available, show fallback button to copy `Artist + " " + Album title` to clipboard

## 4. Data Sources and Provider Strategy

## 4.1 Source Modes

- `hybrid`: MusicBrainz as primary source + iTunes/Deezer/Discogs enrichment
- `musicbrainz`: MusicBrainz only
- `discogs`: Discogs label search as primary source (exact day filtering via release detail endpoint)
- `itunes`: iTunes only (best-effort label matching)

## 4.2 MusicBrainz

Used for:

- Label search and MBID resolution
- Label-accurate release retrieval

Query pattern:

- `laid:<MBID> AND date:[YYYY-MM-DD TO YYYY-MM-DD]`

Operational rule:

- Global throttle ~1 request per second

## 4.3 iTunes

Used for:

- Cover art fallback
- Primary genre
- Apple artist/album links
- Optional type signal (`collectionType`)
- Cover URL is normalized to high-res format (`1200x1200bb.jpg`) when available

## 4.4 Deezer

Used for:

- Cover art fallback
- Deezer album link
- Optional fallback genre

Lookup strategy:

- staged query fallback: `artist+title` -> `title` -> `artist`
- strict candidate acceptance via normalized artist/title + date proximity (`±7` days)

## 4.5 Discogs

Used for:

- Primary label-based release retrieval in `discogs` mode
- Discogs release link fallback
- Cover art fallback
- styles metadata (`styles[]`)
- track-count extraction (`tracklist[]`)

Lookup strategy:

- staged query fallback: `artist+release_title` -> `release_title` -> `artist`
- strict candidate acceptance via normalized artist/title + date proximity (`±7` days)
- `DISCOGS_TOKEN` optional for higher reliability/rate limits
- in `discogs` mode:
  - query `/database/search` by `label` + `year` (supports pagination)
  - fetch `/releases/{id}` per candidate
  - use `released` (YYYY-MM-DD) for exact window filtering
  - if `released` is missing/unparseable: exclude in `days` mode; use year fallback (`YYYY-01-01`) in `year` mode
  - enrich matched entries with Apple artist/album links via iTunes candidate matching when confidence threshold is met
  - provider requests are queued/throttled and retried for Discogs `429` responses (paced for unauthenticated vs authenticated limits)

## 4.6 Cover Art Archive (MusicBrainz)

Used for:

- Preferred cover source in `hybrid` and `musicbrainz` modes (via release MBID)

Rule:

- If Cover Art Archive has a front image, use `https://coverartarchive.org/release/<MBID>/front-1200`.
- If not available, fallback chain is: Deezer -> iTunes -> Discogs.
- At render time, Apple artwork URLs are normalized to a high-resolution variant to avoid stale low-res display links.

## 5. Matching, Mapping, and Dedupe Rules

## 5.1 iTunes Match Scoring

Candidate score:

- `+60` exact artist match (normalized)
- `+30` exact title match (normalized)
- `+10` release date within `±2` days

Acceptance:

- Accept candidate only if score `>= 80`
- Tie-breaker: smallest date distance

Normalization:

- lowercase
- remove diacritics
- remove bracketed metadata and noise tokens (e.g. deluxe/remaster/explicit)
- collapse whitespace

## 5.2 Dedupe

Release identity key:

- normalized `artist + title + releaseDate(YYYY-MM-DD)`

On duplicate:

- merge labels
- merge matched-by-label list
- keep best available enrichment fields
- merge external links by URL (deduped)

## 5.3 Type Mapping

Priority order:

1. MB `primary-type=Album` -> `Album`
2. MB `primary-type=Single` -> `Single`
3. MB `secondary-types` contains `EP` -> `EP`
4. iTunes `collectionType=album` and title contains `EP` -> `EP`
5. iTunes `collectionType=album` -> `Album`
6. fallback -> `Single`

## 5.4 Genre Mapping

Priority order (max 3, deduped case-insensitive):

1. iTunes `primaryGenreName`
2. MusicBrainz `genres[].name`
3. MusicBrainz `tags[].name`
4. Deezer/Discogs fallback genre when present

Validation:

- keep values with length `2..30` and at least one alphanumeric char

Fallback:

- `Genre unbekannt`

## 5.5 Discogs Type Mapping

For `sourceMode=discogs`, map release type with deterministic rules:

1. Title contains `EP` (word boundary) or format descriptions contain `EP` -> `EP`
2. Format descriptions contain `Single` or `45 RPM` -> `Single`
3. If trackCount known:
   - `<= 2` -> `Single`
   - `3..6` -> `EP`
   - `>= 7` -> `Album`
4. Format descriptions contain `LP` or `Album` -> `Album`
5. Fallback -> `Single`

## 6. API Contract

## 6.1 `GET /api/health`

Response:

```json
{ "ok": true, "now": "2026-03-13T13:41:02.392Z" }
```

## 6.2 `GET /api/labels/search`

Query params:

- `q` (string, required)
- `limit` (optional, max 20)

Response:

```json
{
  "labels": [
    {
      "id": "08f89084-e63e-45ea-937e-b800ca8a60f5",
      "name": "Morr Music",
      "country": "DE",
      "disambiguation": null
    }
  ]
}
```

## 6.3 `POST /api/releases/search`

Request body:

```json
{
  "labels": [{ "mbid": "...", "name": "Morr Music" }],
  "timeMode": "days",
  "timeValue": 7,
  "country": "DE",
  "sourceMode": "hybrid",
  "timezone": "Europe/Berlin",
  "discogsToken": "optional-user-token"
}
```

Response body:

```json
{
  "releases": [
    {
      "id": "...",
      "artist": "The Notwist",
      "title": "News from Planet Zombie",
      "releaseDate": "2026-03-13",
      "genres": ["Indie-Pop"],
      "styles": ["Deep House", "Tech House"],
      "labels": ["Morr Music"],
      "type": "Album",
      "status": "Official",
      "country": "DE",
      "barcode": "1234567890123",
      "packaging": "None",
      "trackCount": 12,
      "mediaFormat": "Digital Media",
      "coverUrl": "...",
      "appleArtistUrl": "...",
      "appleAlbumUrl": "...",
      "deezerAlbumUrl": "...",
      "discogsReleaseUrl": "...",
      "externalLinks": [
        { "label": "Official", "url": "https://...", "source": "musicbrainz" },
        { "label": "Apple Album", "url": "https://...", "source": "itunes" }
      ],
      "sourceDetails": {
        "musicbrainzReleaseId": "...",
        "musicbrainzReleaseGroupId": "...",
        "itunesCollectionId": 1872527079,
        "deezerAlbumId": 123456,
        "discogsReleaseId": 1234567
      },
      "matchedByLabel": ["Morr Music"],
      "matchConfidence": "high",
      "matchedBy": "discogs"
    }
  ],
  "meta": {
    "sourceMode": "hybrid",
    "timeMode": "days",
    "timeValue": 7,
    "country": "DE",
    "fromDate": "2026-03-07",
    "toDate": "2026-03-13",
    "searchedAt": "2026-03-13T13:00:00.000Z",
    "partialFailures": []
  }
}
```

## 7. Persistence

Stored in browser `localStorage`:

- `labelsearch.labels`
- `labelsearch.settings`
- `labelsearch.lastResults`

## 8. Non-Functional Requirements

- No authentication in v1
- Continue on partial provider failure (report per-label errors)
- Do not drop MB releases when iTunes enrichment fails
- Must run in Docker as a single deployable container
- Server writes structured operational logs to console and file (`LOG_FILE_PATH`, default `logs/app.log`)

## 9. Deployment Specification

## 9.1 Docker

- Multi-stage build:
  1. build frontend + compile backend on `node:22-alpine`
  2. runtime image with production dependencies on `node:22-alpine`
- Dependency install in container stages uses `npm ci` (`--omit=dev` in runtime stage).
- Runtime serves:
  - `/api/*` via Express
  - static frontend files from same process

## 9.2 Required Files

- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`

## 9.3 Runtime Logging

- Default log file path: `logs/app.log` (project root)
- Can be overridden via env var `LOG_FILE_PATH`
- Logged events:
  - server startup
  - HTTP request summary (`method`, `path`, `status`, `durationMs`)
  - provider/search failures and partial label failures

## 9.4 CI/CD Container Publishing

- GitHub Actions workflow file: `.github/workflows/dockerhub-push.yml`
- Trigger:
  - push to `main`
  - push of any git tag (`*`)
  - manual run via `workflow_dispatch`
- Behavior:
  - build Docker image from repository `Dockerfile`
  - push image to Docker Hub only
  - no remote server deployment step in CI
- Docker image name is set via workflow environment variable `IMAGE_NAME` (current value: `drmsbh/labelsearch`).
- Published image/tags:
  - `<IMAGE_NAME>:latest` on `main` branch pushes
  - `<IMAGE_NAME>:<git-tag>` on git tag pushes
- Required repository secrets:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`

## 10. Testing Specification

Required checks:

- Typecheck: shared and server/frontend TS consistency
- Unit tests:
  - match scoring
  - date range inclusion of today
  - type mapping
  - genre fallback
- Build test: production frontend + backend compile
- Container test:
  - image builds
  - `/api/health` responds in running container

## 11. Changelog

### 2026-03-20

- Added new source mode `discogs` for primary Discogs label-based release search.
- Added exact date filtering in Discogs mode using release detail field `released`.
- Extended release schema with optional `styles` and documented Discogs track-count extraction from `tracklist`.
- Added deterministic Discogs type inference rules (`Album`/`EP`/`Single`).
- Updated UI spec to show `Styles` when available on release cards.
- Added Apple link enrichment behavior for `discogs` mode via iTunes matching.
- Added Discogs rate-limit mitigation rules (request throttling + retries) and clearer partial-failure messaging for `429`.
- Added optional `discogsToken` request field and UI input; request token takes precedence over env `DISCOGS_TOKEN`.

### 2026-03-19

- Added deployment-spec section for CI container publishing via GitHub Actions.
- Defined push-only workflow behavior (Docker Hub publish only, no remote deploy step).
- Added required Docker Hub secrets and published tag contract (`latest` on `main`, `<git-tag>` on tag push).
- Updated Docker base images to `node:22-alpine` for build and runtime stages and standardized on `npm ci`.
- Updated CI publishing contract: `main` branch publishes `latest`; git tags publish the same tag name.
- Added workflow-level `IMAGE_NAME` configuration point for Docker Hub repository naming.

### 2026-03-13

- Added structured backend logging to file + console (`LOG_FILE_PATH`, default `logs/app.log`).
- Added request and provider-failure logging requirements.
- Updated docker-compose runtime env with `LOG_FILE_PATH=/app/logs/app.log`.
- Updated card layout to bottom-align action controls (Apple icon links or copy fallback button) across mixed content heights.
- Added no-link fallback action in cards: copy `Artist + Album` to clipboard.
- Increased Apple Music icon-button size in release cards for improved touch usability.
- Updated mobile layout behavior: controls/search panel is not sticky and scrolls with content.
- Updated Apple icon source to the provided Wikimedia Apple Music icon URL in card action buttons.
- Unified Apple app actions to a single Apple Music-style icon (artist and album both use the Apple Music icon).
- Changed Apple links in cards to icon-only buttons (artist/album), preserving desktop deep-link behavior.
- Removed Apple web fallback links from card UI; Apple links are app-deep-links only.
- Updated Apple link behavior: card now exposes direct Apple Music desktop-app links (`music://`) and separate web fallback links.
- Restored Apple artist/album links in the card UI while keeping the reduced core field set.
- Reduced result card UI to five core fields only: album title, artist, release date, label(s), genre(s).
- Updated CAA cover rule to force `front-1200` instead of original large image URLs.
- Added robust multi-source enrichment strategy in `hybrid`: MusicBrainz primary data + iTunes/Deezer/Discogs fallback providers.
- Added staged fallback search flow (`artist+title` -> `title` -> `artist`) for Deezer and Discogs.
- Added strict external candidate acceptance rule: normalized artist/title + release date proximity (`±7` days) required.
- Added new release fields: `status`, `country`, `barcode`, `packaging`, `trackCount`, `mediaFormat`, `deezerAlbumUrl`, `discogsReleaseUrl`, `externalLinks`.
- Updated cover selection strategy to `CAA -> Deezer -> iTunes -> Discogs`.
- Extended `sourceDetails` with `deezerAlbumId` and `discogsReleaseId`; extended `matchedBy` with hybrid fallback markers.
- Added label list export requirement (compatible with TXT/CSV import flow).
- Added high-res cover normalization rule for iTunes artwork URLs (`1200x1200bb.jpg`).
- Added UI layout fix requirement for control overflow in the filter grid.
- Added comment support for import (`#...`) and aligned export structure with comment-capable format.
- Simplified import/export label format to plain text lines without required quotes; trim whitespace on import and export `.txt`.
- Added an in-app instruction section with workflow steps and import file example.
- Updated cover strategy: prefer Cover Art Archive artwork (MB release ID), fallback to high-res iTunes.
- Refined cover strategy: prefer original CAA image and use `1200x1200bb.jpg` for iTunes fallback artwork.
- Added runtime cover URL normalization to prevent old cached `100x100` Apple image links from rendering low-res covers.
- Refined controls layout: instruction panel is collapsible and action buttons are grouped by priority.
- Updated direct-search behavior to use selected lookup candidate when present; otherwise first result.
- Added time range selector with `Days` and `Year` modes (default `7 Days`) and corresponding backend range logic.
- Fixed range selector control layout to prevent overlap in compact widths.
- Updated responsive control layout for medium widths: two-column filter grid with full-width source selector row.
- Updated medium-width control placement to explicit 2x2 arrangement: `[empty][Range]` and `[Country][Source]`.
- Fixed remaining overlap by standardizing filter controls to a two-column grid (except one-column mobile layout).
