# Label Release Tracker v1 Specification

## 1. Product Summary

Label Release Tracker is a web app to discover recent releases for selected record labels.

Core behavior:

1. Find/select labels from MusicBrainz and store them with MBID.
2. Search releases for a configurable date window (`daysBack`, default `7`, includes today).
3. Enrich results with iTunes metadata where available.
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

- `daysBack` (number, `1..365`, default `7`)
- `country` dropdown (default `DE`)
- `sourceMode` dropdown:
  - `hybrid` (default)
  - `musicbrainz`
  - `itunes`

Date window rule:

- `toDate = today` in user timezone
- `fromDate = today - (daysBack - 1)`
- inclusive range: `[fromDate, toDate]`

## 3.3 Result Fields

Each release card shows:

- Album cover (if available)
- Artist
- Album title
- Release date
- 1-3 genres/microgenres (best effort)
- Label(s)
- Type (`Album`, `Single`, `EP`)
- Apple artist link
- Optional Apple album page link

## 4. Data Sources and Provider Strategy

## 4.1 Source Modes

- `hybrid`: MusicBrainz as primary source + iTunes enrichment
- `musicbrainz`: MusicBrainz only
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

- Cover art
- Primary genre
- Apple artist/album links
- Optional type signal (`collectionType`)
- Cover URL is normalized to high-res format (`1200x1200bb.jpg`) when available

## 4.4 Cover Art Archive (MusicBrainz)

Used for:

- Preferred cover source in `hybrid` and `musicbrainz` modes (via release MBID)

Rule:

- If Cover Art Archive has a front image, use the original `image` URL first.
- If not available, fallback to iTunes artwork (when available).
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

Validation:

- keep values with length `2..30` and at least one alphanumeric char

Fallback:

- `Genre unbekannt`

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
  "daysBack": 7,
  "country": "DE",
  "sourceMode": "hybrid",
  "timezone": "Europe/Berlin"
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
      "labels": ["Morr Music"],
      "type": "Album",
      "coverUrl": "...",
      "appleArtistUrl": "...",
      "appleAlbumUrl": "...",
      "sourceDetails": {
        "musicbrainzReleaseId": "...",
        "musicbrainzReleaseGroupId": "...",
        "itunesCollectionId": 1872527079
      },
      "matchedByLabel": ["Morr Music"],
      "matchConfidence": "high",
      "matchedBy": "hybrid"
    }
  ],
  "meta": {
    "sourceMode": "hybrid",
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

## 9. Deployment Specification

## 9.1 Docker

- Multi-stage build:
  1. build frontend + compile backend
  2. runtime image with production dependencies
- Runtime serves:
  - `/api/*` via Express
  - static frontend files from same process

## 9.2 Required Files

- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`

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

### 2026-03-13

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
