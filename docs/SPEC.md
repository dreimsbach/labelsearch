# Label Release Tracker v2 Specification

## 1. Product Summary

Label Release Tracker is a web app to discover recent releases for selected record labels.

Core behavior:

1. Manage a label list. Labels are resolved to a MusicBrainz MBID when possible; labels without a MusicBrainz match are kept by name.
2. Search releases for a configurable date window with mode selector (`Days` default `7`, or `Year`).
3. Query the selected primary sources per label in parallel (default: Deezer + MusicBrainz, optional Discogs), merge duplicates, and enrich with iTunes (Apple links, cover, genre) and Cover Art Archive.
4. Stream results label by label into a modern, responsive, card-based overview.

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
- Incremental result rendering: cards appear as soon as a label's first results are streamed; enriched versions (Apple links, cover) replace them in place
- In-results loading indicator signaling that more results are incoming
- `Cancel` replaces `Find from list` while a search runs; starting a new search aborts the running one
- Empty state when no releases found
- Error state for API/provider failures; partial failures are listed per label and source
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
  - each name is resolved via MusicBrainz (exact name preferred, then country match, then first result)
  - names without a MusicBrainz match are kept as name-only labels (chip with dashed border) and listed as a notice; Deezer and Discogs still search them by name
- Export current label list as text file (`.txt`) for later re-import
- Import format is line-based text and supports comment lines (prefix `#`)
- Label rows are plain lines (no quotes required), leading/trailing whitespace is ignored
- Export format follows the same line-based structure and includes a comment header line
- Label identity in the list: MBID when known, otherwise the lower-cased name

## 3.2 Search Configuration

Fields:

- `rangeValue` (number)
- `rangeMode` selector:
  - `days` (default): searches last `rangeValue` days including today
  - `year`: searches full calendar year `rangeValue` (e.g. `2026`)
- `country` dropdown (default `DE`), used as iTunes storefront (fallback `US`)
- range fields in one row: `Range` (value), `Unit` (Days/Year), `Country`
- `sources` toggle chips (multi-select, at least one required; a one-line hint below explains each source):
  - `deezer` (default on)
  - `musicbrainz` (default on)
  - `discogs` (default off)
- `discogsToken` (optional; only shown and sent when Discogs is selected)

Date window rule:

- For `days` mode:
  - `toDate = today` in user timezone
  - `fromDate = toDate - (rangeValue - 1)` days (calendar arithmetic in UTC, independent of server timezone)
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

## 4.1 Source Selection and Rationale

Measured on 2026-11-13 with four releases out that day (Erased Tapes, Nonesuch, Latency, CINTH), searching by label only:

| Source | Found | Notes |
|---|---|---|
| Deezer | 3/4 | label field on albums, `label:"…"` search, no auth, fast |
| MusicBrainz | 2/4 | exact label IDs, curated, ~1 req/s |
| Discogs | 0/4 | user-submitted, digital releases appear days/weeks late |

Rejected alternatives:

- Spotify Web API: since Feb 2026 dev-mode apps need Premium, search returns max 10 results and the album `label` field was removed.
- Apple Music API (`record-labels/{id}?views=latest-releases`): best fit, but requires a paid Apple Developer membership. Can be added as another source later.

Each selected source runs per label in parallel (`Promise.allSettled`); one failing source never drops results of the others.

## 4.2 MusicBrainz

Used for:

- Label search and MBID resolution (also for name-only labels: exact normalized name match, otherwise skipped)
- Label-accurate release retrieval
- Discogs label id via label URL relations (`inc=url-rels`)

User-Agent: `MB_USER_AGENT`, default `example-app/0.0.0` (neutral placeholder, no traceable contact data). The same placeholder is the Discogs default (`DISCOGS_USER_AGENT`).

Query pattern:

- `laid:<MBID> AND date:[YYYY-MM-DD TO YYYY-MM-DD]`, paginated (100 per page, max 500)
- `days` mode keeps only releases with an exact `YYYY-MM-DD` date inside the window (year-only dates such as `2026` are dropped)
- `year` mode keeps releases whose date starts with the year

Operational rules:

- Rate limit: 1 request per 1.1 s; `503` is treated as throttling
- Timeout 30 s (MB search can take >20 s for busy labels)

## 4.3 Deezer (primary)

Used for:

- Label-based release discovery
- Cover (`cover_xl`), genres, record type, track count, UPC, Deezer album link

Algorithm per label:

1. `GET /search/album?q=label:"<name>"` (100 per page, up to 10 pages). The search is fuzzy (`Latency` also hits `Low Latency FM`).
2. Sort album ids descending: Deezer ids grow with ingestion time, so the newest catalog entries come first.
3. Fetch `/album/{id}` in batches of 10 and keep albums whose `label` matches exactly (see 5.1) and whose `release_date` lies in the window.
4. Stop after 10 consecutive matching albums released more than 180 days before `fromDate`. The lookback is long because pre-orders are ingested months ahead (e.g. Fujita, ingested ~August for a November release).
5. Hard cap: 200 detail lookups in `days` mode, 400 in `year` mode (old years cannot use the early stop efficiently).

Operational rules:

- Rate limit: 40 requests / 5 s (Deezer allows 50 / 5 s)
- Quota errors arrive as HTTP 200 with `error.code = 4`; they are treated as throttling
- Album details are cached (1 day for releases younger than 30 days, else 30 days); label search results 1 hour

Typical cost: 7–100 requests and 4–15 s per label on a cold cache.

## 4.4 Discogs (optional)

Used for:

- Vinyl-only labels that are not on streaming services
- styles metadata (`styles[]`), track-count extraction (`tracklist[]`), format-based type inference

Algorithm per label:

1. Discogs label id: MusicBrainz label URL relation if the label has an MBID, otherwise `database/search?type=label` with exact (then normalized) name match. No match → per-source failure.
2. `GET /labels/{id}/releases` (exact label, paginated, max 10 pages), keep entries whose `year` is in the window's years.
3. Fetch `/releases/{id}` for up to 150 candidates (newest ids first) and filter by `released`:
   - `days` mode requires an exact `YYYY-MM-DD`
   - `year` mode falls back to `YYYY-01-01`

Operational rules:

- Token from request (`discogsToken`) takes precedence over env `DISCOGS_TOKEN`; sent as `Authorization: Discogs token=…` header (never in URLs or logs)
- Rate limit: 55 / min with token, 22 / min without
- Release details cached (1 day for fresh releases, else 14 days), label listings 6 hours, label ids 30 days

## 4.5 iTunes (enrichment)

Used for:

- Apple artist/album links (card actions)
- Primary genre (placed first)
- Cover fallback, normalized to `1200x1200bb.jpg`

Rules:

- Search `artist + title` in the selected country, fallback `US`
- Strict match first (see 5.2), then loose match
- Rate limit: 20 requests / min; `403`/`429` are treated as throttling
- Results cached 24 h (empty results 6 h)
- Enrichment failures never drop a release

## 4.6 Cover Art Archive (enrichment)

- Used only when no cover came from Deezer/Discogs and the release has a MusicBrainz id
- If the release has a front image, use `https://coverartarchive.org/release/<MBID>/front-1200`
- Cached 30 days (missing covers 12 hours)

## 4.7 Request Handling, Rate Limits and Cache

- One sliding-window `RateLimiter` per provider (FIFO). Concurrent work is allowed, only request starts are spaced.
- `fetchJson` is the single retry layer:
  - throttling statuses (`429`, `503`, provider-specific `403`) pause the provider limiter for `Retry-After` or exponential backoff (1 s, 2 s, 4 s … max 20 s) and retry
  - `500/502/504`, network errors and timeouts are retried with backoff
  - other `4xx` fail immediately
  - default 3 retries, 10 s timeout
- Search concurrency: 4 labels at once, 3 enrichments per label at once; provider limiters cap the real request rate.
- Cache: in-memory read-through cache with in-flight dedupe, persisted as JSON to `CACHE_FILE_PATH` (default `data/cache.json`, empty value disables persistence). Max 50,000 entries, saved debounced (5 s) and on `SIGINT`/`SIGTERM`.
- A repeated search with a warm cache completes without external requests (measured: 7 labels, 34 s cold → <0.1 s warm).

## 5. Matching, Mapping, and Dedupe Rules

## 5.1 Label Matching

Provider label strings are compared exactly after normalization:

- lowercase, remove diacritics, `&` → `and`, punctuation → space
- remove generic words: `records`, `recordings`, `music`, `musik`, `ltd`, `limited`, `inc`, `gmbh`, `llc`, `label`, `the`
- combined strings are split on `/ , ; |` and each part is compared (`Etoile Audio/Nonesuch` matches `Nonesuch`)

Examples: `Erased Tapes Records Ltd.` = `Erased Tapes`; `Low Latency FM` ≠ `Latency`.

## 5.2 iTunes Match Scoring

Strict candidate score:

- `+60` exact artist match (normalized)
- `+30` exact title match (normalized)
- `+10` release date within `±2` days
- accept only if score `>= 80`; tie-breaker: smallest date distance

Loose fallback (for credits like `Popol Vuh, james K, ML Buch & Lorenzo Senni` vs `Popol Vuh`):

- normalized artist and title contain each other, and date within `±7` days; closest date wins

Normalization (also used for dedupe):

- lowercase, remove diacritics
- remove ` - EP` / ` - Single` suffixes, bracketed metadata and noise tokens (deluxe/remaster/explicit/edition/version)
- collapse whitespace

## 5.3 Dedupe

Implemented once in `shared/merge.ts` and used by server and client.

Two releases are the same when:

- normalized titles are equal, and
- normalized artists are equal or one contains the other as whole words (`DJ Seinfeld` / `DJ Seinfeld & Peter Xan`), and
- release dates are at most 14 days apart

On duplicate:

- the first entry wins per field (source order: Deezer, MusicBrainz, Discogs), gaps are filled from the others
- labels, matched-by-label, `foundBy`, external links (by URL) are merged
- genres: first non-fallback list wins

The client keys streamed releases by `label + release id`, so a release found for two labels keeps both label names.

## 5.4 Type Mapping

- Deezer `record_type`: `ep` → `EP`, `single` → `Single` (or `EP` if title contains `EP`), `album`/`compile` → `Album`
- MusicBrainz: `primary-type` Album/Single/EP, secondary type `EP` → `EP`, fallback `Single`
- Discogs:
  1. Title contains `EP` (word boundary) or format descriptions contain `EP` -> `EP`
  2. Format descriptions contain `Single` or `45 RPM` -> `Single`
  3. If trackCount known: `<= 2` -> `Single`, `3..6` -> `EP`, `>= 7` -> `Album`
  4. Format descriptions contain `LP` or `Album` -> `Album`
  5. Fallback -> `Single`

## 5.5 Genre Mapping

Priority order (max 3, deduped case-insensitive):

1. iTunes `primaryGenreName`
2. Deezer genres / MusicBrainz genres and tags / Discogs genres

Validation: keep values with length `2..30` and at least one alphanumeric char. Fallback: `Genre unbekannt`.

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

## 6.3 Search request body

Used by both search endpoints:

```json
{
  "labels": [{ "name": "Erased Tapes", "mbid": "0cd6e3cb-aea6-4060-9ebd-21b534a864a6" }, { "name": "CINTH" }],
  "timeMode": "days",
  "timeValue": 7,
  "country": "DE",
  "sources": ["deezer", "musicbrainz"],
  "timezone": "Europe/Berlin",
  "discogsToken": "optional-user-token"
}
```

- `labels`: 1–500 entries, `mbid` optional
- `sources`: subset of `deezer`, `musicbrainz`, `discogs`; empty/missing → default `["deezer","musicbrainz"]`
- legacy `sourceMode` is still accepted when `sources` is missing: `hybrid` → default sources, `musicbrainz` → `["musicbrainz"]`, `discogs` → `["discogs"]`

## 6.4 `POST /api/releases/stream` (used by the UI)

Response: `application/x-ndjson`, one `SearchEvent` per line:

- `{ "type": "start", "fromDate", "toDate", "totalLabels" }`
- `{ "type": "releases", "label", "releases": Release[] }`: first the merged raw results of a label, later the enriched versions with the **same ids** (upsert)
- `{ "type": "failure", "failure": { "label", "source", "message" } }`
- `{ "type": "labelDone", "label", "completed", "totalLabels" }`
- `{ "type": "done", "meta": SearchMeta }`
- `{ "type": "error", "message" }`

Closing the connection aborts processing of labels not yet started.

## 6.5 `POST /api/releases/search`

Same request body, non-streaming response:

```json
{
  "releases": [
    {
      "id": "deezer-1034548662",
      "artist": "Masayoshi Fujita",
      "title": "Forest of Tranquility",
      "releaseDate": "2026-11-13",
      "genres": ["Ambient", "Electro"],
      "styles": [],
      "labels": ["Erased Tapes"],
      "type": "Album",
      "trackCount": 9,
      "coverUrl": "https://cdn-images.dzcdn.net/...",
      "appleArtistUrl": "https://music.apple.com/...",
      "appleAlbumUrl": "https://music.apple.com/...",
      "deezerAlbumUrl": "https://www.deezer.com/album/1034548662",
      "externalLinks": [
        { "label": "Deezer", "url": "https://www.deezer.com/album/1034548662", "source": "deezer" },
        { "label": "MusicBrainz", "url": "https://musicbrainz.org/release/...", "source": "musicbrainz" }
      ],
      "sourceDetails": {
        "deezerAlbumId": 1034548662,
        "musicbrainzReleaseId": "...",
        "itunesCollectionId": 123
      },
      "matchedByLabel": ["Erased Tapes"],
      "foundBy": ["deezer", "musicbrainz"]
    }
  ],
  "meta": {
    "sources": ["deezer", "musicbrainz"],
    "timeMode": "days",
    "timeValue": 7,
    "country": "DE",
    "fromDate": "2026-11-07",
    "toDate": "2026-11-13",
    "searchedAt": "2026-11-13T09:00:00.000Z",
    "partialFailures": [{ "label": { "name": "Nonesuch" }, "source": "musicbrainz", "message": "MusicBrainz rate limit reached. Retry in a minute." }]
  }
}
```

Removed fields compared to v1: `matchedBy`, `matchConfidence` (replaced by `foundBy`).

## 7. Persistence

Browser `localStorage` (all access wrapped in try/catch):

- `labelsearch.labels` (`{ name, mbid? }[]`)
- `labelsearch.settings` (`timeMode`, `timeValue`, `country`, `sources`, `discogsToken`); old settings with `sourceMode` migrate to the default sources
- `labelsearch.lastResults`

Server: provider cache file `CACHE_FILE_PATH` (see 4.7).

## 8. Non-Functional Requirements

- No authentication in v1
- Continue on partial provider failure (report per label and source)
- Never drop a release because enrichment failed
- Tokens never appear in request URLs, error messages or logs
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
- Provider cache at `/app/data/cache.json` (`CACHE_FILE_PATH`), declared as volume `/app/data`; `docker-compose.yml` mounts the named volume `labelsearch-data` so the cache survives container restarts.

## 9.2 Required Files

- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`

## 9.3 Runtime Logging

- Default log file path: `logs/app.log` (project root)
- Can be overridden via env var `LOG_FILE_PATH`
- Logged events:
  - server startup and cache load (entry count)
  - HTTP request summary (`method`, `path`, `status`, `durationMs`)
  - per-label source failures, iTunes enrichment failures, Discogs detail caps

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
  - label matching (exact after normalization, fuzzy noise rejected)
  - Deezer discovery: window filter, pre-order ingests, early stop, cache reuse
  - search orchestration: cross-source merge, streaming raw → enriched with stable ids, per-source failures, name-only labels, multi-label merge, Discogs year/day filtering and 429 hint
  - rate limiter spacing, `fetchJson` retry/no-retry/redaction
  - dedupe (suffixes, date drift, featured artists, reissues)
  - iTunes strict/loose matching, type mapping, genre fallback, date range inclusion of today
- Build test: production frontend + backend compile
- Container test:
  - image builds
  - `/api/health` responds in running container

## 11. Changelog

### 2026-11-13 (Release v0.3.0)

- Release `v0.3.0` (package version `0.3.0`; `0.2.0` was already used by an earlier tag) containing the v2 search rework and source chips below.

### 2026-11-13

- v2 provider architecture: Deezer (`label:"…"` search, id-descending walk with early stop, exact label match) and MusicBrainz as default primary sources, queried per label in parallel; Discogs becomes an optional source using exact label ids (MusicBrainz URL relation or exact name) instead of fuzzy label+year search.
- Replaced `sourceMode` with `sources` (toggle chips in one row with a one-line hint; range, unit and country share one row); legacy `sourceMode` still accepted by the API.
- Added `POST /api/releases/stream` (NDJSON events, raw then enriched results with stable ids); the UI uses one streamed request instead of one request per label, and can cancel.
- Added per-provider sliding-window rate limiters and a single retry layer honoring `Retry-After`; removed the nested Discogs retry loop.
- Added persistent provider cache (`CACHE_FILE_PATH`, default `data/cache.json`), Docker volume `/app/data`.
- Labels without MusicBrainz match are kept as name-only labels (`mbid` optional).
- MusicBrainz `days` mode ignores year-only dates; MB results paginated; 30 s timeout.
- iTunes enrichment for all sources with strict + loose matching (multi-artist credits); Cover Art Archive only as cover fallback.
- Dedupe moved to `shared/merge.ts`: title + artist containment + ≤14 days, ` - EP` suffix ignored; `matchedBy`/`matchConfidence` replaced by `foundBy`.
- Discogs token sent as `Authorization` header; tokens redacted from error messages.
- Fixed `days` window computation depending on the server timezone.
- Outbound User-Agent rule: defaults for MusicBrainz (`MB_USER_AGENT`) and Discogs (`DISCOGS_USER_AGENT`) are the neutral placeholder `example-app/0.0.0`; defaults and `docker-compose.yml` must not contain traceable data (e-mail, repo link, URL, names).

### 2026-03-20

- Added new source mode `discogs` for primary Discogs label-based release search.
- Added exact date filtering in Discogs mode using release detail field `released`.
- Extended release schema with optional `styles` and documented Discogs track-count extraction from `tracklist`.
- Added deterministic Discogs type inference rules (`Album`/`EP`/`Single`).
- Updated UI spec to show `Styles` when available on release cards.
- Added Apple link enrichment behavior for `discogs` mode via iTunes matching.
- Added Discogs rate-limit mitigation rules (request throttling + retries) and clearer partial-failure messaging for `429`.
- Added optional `discogsToken` request field and UI input; request token takes precedence over env `DISCOGS_TOKEN`.
- Updated search UX to stream release cards incrementally during multi-label runs and show an in-panel spinner while loading continues.

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
