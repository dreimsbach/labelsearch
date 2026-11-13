import { useEffect, useMemo, useRef, useState } from 'react';
import { mergeReleases } from '../shared/merge';
import type { FeedSettings, FeedState, LabelRef, LabelSearchResult, Release, SourceId } from '../shared/types';
import { LabelChip } from './components/LabelChip';
import { ReleaseCard } from './components/ReleaseCard';
import { ReleaseSkeleton } from './components/ReleaseSkeleton';
import { getFeed, searchLabels, startFeedRun, streamReleases, updateFeedConfig } from './lib/api';
import { parseLabelText } from './lib/csv';
import { labelKey, markLegacyMigrated, takeLastVisit, takeLegacyConfig } from './lib/storage';

const COUNTRIES = ['DE', 'US', 'GB', 'FR', 'JP'];
const POLL_RUNNING_MS = 2_000;
const POLL_IDLE_MS = 60_000;
const SETTINGS_SAVE_DELAY_MS = 500;
const MAX_DAYS = 31;

const SOURCE_OPTIONS: Array<{ id: SourceId; label: string; hint: string }> = [
  { id: 'deezer', label: 'Deezer', hint: 'fastest, best for new digital releases' },
  { id: 'musicbrainz', label: 'MusicBrainz', hint: 'curated, exact label IDs' },
  { id: 'discogs', label: 'Discogs', hint: 'vinyl-only labels, slow' }
];

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

interface AdhocSearch {
  label: LabelRef;
  releases: Release[];
  failures: string[];
  loading: boolean;
}

type ImportMode = 'add' | 'replace';

function formatLabelChoice(label: LabelSearchResult): string {
  const info = [label.country, label.disambiguation].filter(Boolean).join(' · ');
  return info ? `${label.name} (${info})` : label.name;
}

/** Exact name match only (country breaks ties); otherwise the label is kept by name. */
function pickBestLabelCandidate(candidates: LabelSearchResult[], query: string, country: string): LabelSearchResult | null {
  const normalized = query.trim().toLowerCase();
  const exact = candidates.filter((entry) => entry.name.toLowerCase() === normalized);
  return exact.find((entry) => entry.country === country) ?? exact[0] ?? null;
}

function mergeLabelLists(current: LabelRef[], incoming: LabelRef[]): LabelRef[] {
  const result = [...current];
  for (const entry of incoming) {
    const exists = result.some((item) => labelKey(item) === labelKey(entry) || item.name.toLowerCase() === entry.name.toLowerCase());
    if (!exists) {
      result.push(entry);
    }
  }
  return result;
}

function formatNextRun(feed: FeedState): string | null {
  const { schedule } = feed;
  if (!schedule.enabled || !schedule.nextRunDay) {
    return null;
  }
  return `next refresh ${dayFormat.format(new Date(`${schedule.nextRunDay}T12:00:00Z`))}, ${schedule.time}`;
}

export function App(): JSX.Element {
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previousVisit] = useState<string | null>(() => takeLastVisit());
  const [adhoc, setAdhoc] = useState<AdhocSearch | null>(null);

  const [labelQuery, setLabelQuery] = useState('');
  const [labelSearchResults, setLabelSearchResults] = useState<LabelSearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<LabelSearchResult | null>(null);

  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);

  const adhocAbort = useRef<AbortController | null>(null);
  const settingsTimer = useRef<number | undefined>(undefined);

  const loaded = feed !== null;
  const running = feed?.run.running ?? false;
  const importing = importProgress.total > 0;
  const labels = feed?.labels ?? [];
  const settings = feed?.settings;

  // Initial load, including the one-time move of browser-stored labels to the server.
  useEffect(() => {
    void (async () => {
      try {
        let state = await getFeed();
        const legacy = takeLegacyConfig();
        if (legacy && state.labels.length === 0) {
          state = await updateFeedConfig(legacy);
        }
        markLegacyMigrated();
        setFeed(state);
      } catch (loadFailure) {
        setLoadError(loadFailure instanceof Error ? loadFailure.message : 'Could not load feed');
      }
    })();
  }, []);

  // Poll quickly while a refresh runs, slowly otherwise to pick up the daily run.
  // Labels and settings stay local: they may hold edits that are still being saved.
  useEffect(() => {
    if (!loaded) {
      return undefined;
    }
    const timer = window.setInterval(
      () => {
        getFeed()
          .then((state) => setFeed((prev) => (prev ? { ...state, labels: prev.labels, settings: prev.settings } : state)))
          .catch(() => undefined);
      },
      running ? POLL_RUNNING_MS : POLL_IDLE_MS
    );
    return () => window.clearInterval(timer);
  }, [loaded, running]);

  async function saveLabels(next: LabelRef[]): Promise<void> {
    setFeed((prev) => (prev ? { ...prev, labels: next } : prev));
    try {
      const state = await updateFeedConfig({ labels: next });
      setFeed((prev) => (prev ? { ...prev, labels: state.labels } : state));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save labels');
    }
  }

  function changeSettings(patch: Partial<FeedSettings>): void {
    if (!settings) {
      return;
    }
    const next = { ...settings, ...patch };
    setFeed((prev) => (prev ? { ...prev, settings: next } : prev));
    window.clearTimeout(settingsTimer.current);
    settingsTimer.current = window.setTimeout(() => {
      updateFeedConfig({ settings: next }).catch((saveError) =>
        setError(saveError instanceof Error ? saveError.message : 'Could not save settings')
      );
    }, SETTINGS_SAVE_DELAY_MS);
  }

  function toggleSource(source: SourceId): void {
    if (!settings) {
      return;
    }
    const sources = settings.sources.includes(source) ? settings.sources.filter((entry) => entry !== source) : [...settings.sources, source];
    if (sources.length > 0) {
      changeSettings({ sources });
    }
  }

  async function refreshNow(): Promise<void> {
    setError(null);
    closeAdhoc();
    try {
      // Settings edits may still sit in the debounce timer; save them before the run reads them.
      if (settings) {
        window.clearTimeout(settingsTimer.current);
        await updateFeedConfig({ settings });
      }
      setFeed(await startFeedRun());
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Could not start refresh');
    }
  }

  function exportLabelsList(): void {
    if (labels.length === 0) {
      return;
    }

    const day = new Date().toISOString().slice(0, 10);
    const list = labels.map((label) => label.name.trim()).join('\n');
    const content = [`#Labels export ${day}`, list].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `labels-${day}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async function runLabelLookup(query: string): Promise<void> {
    if (!query.trim()) {
      setLabelSearchResults([]);
      setSelectedSearchResult(null);
      return;
    }

    try {
      const found = await searchLabels(query.trim());
      setLabelSearchResults(found);
      setSelectedSearchResult(found[0] ?? null);
      setError(null);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Label search failed');
    }
  }

  function addSelectedToList(): void {
    if (selectedSearchResult) {
      void saveLabels(mergeLabelLists(labels, [{ mbid: selectedSearchResult.id, name: selectedSearchResult.name }]));
    }
  }

  async function resolveLabelName(name: string): Promise<LabelRef> {
    const candidates = await searchLabels(name).catch(() => []);
    const chosen = pickBestLabelCandidate(candidates, name, settings?.country ?? 'DE');
    // Without an exact MusicBrainz match the label is kept by name: Deezer and Discogs search by name anyway.
    return chosen ? { mbid: chosen.id, name: chosen.name } : { name };
  }

  async function importFile(file: File, mode: ImportMode): Promise<void> {
    const names = parseLabelText(await file.text());
    if (names.length === 0) {
      setError('No labels found in file');
      return;
    }
    if (mode === 'replace' && labels.length > 0 && !window.confirm(`Replace all ${labels.length} labels with ${names.length} labels from "${file.name}"?`)) {
      return;
    }

    setError(null);
    setNotices([]);
    setImportProgress({ current: 0, total: names.length });

    try {
      const resolved: LabelRef[] = [];
      for (let i = 0; i < names.length; i += 1) {
        resolved.push(await resolveLabelName(names[i]));
        setImportProgress({ current: i + 1, total: names.length });
      }

      const nameOnly = resolved.filter((entry) => !entry.mbid).map((entry) => entry.name);
      if (nameOnly.length > 0) {
        setNotices([`Not found on MusicBrainz, kept by name (${nameOnly.length}): ${nameOnly.join(', ')}`]);
      }
      await saveLabels(mode === 'replace' ? mergeLabelLists([], resolved) : mergeLabelLists(labels, resolved));
    } finally {
      setImportProgress({ current: 0, total: 0 });
    }
  }

  function clearLabels(): void {
    if (window.confirm(`Remove all ${labels.length} labels?`)) {
      void saveLabels([]);
    }
  }

  async function runAdhocSearch(label: LabelRef): Promise<void> {
    if (!settings) {
      return;
    }
    adhocAbort.current?.abort();
    const controller = new AbortController();
    adhocAbort.current = controller;
    setError(null);
    setAdhoc({ label, releases: [], failures: [], loading: true });

    const byId = new Map<string, Release>();
    try {
      await streamReleases(
        {
          labels: [label],
          timeMode: 'days',
          timeValue: settings.days,
          country: settings.country,
          sources: settings.sources,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        (event) => {
          if (event.type === 'releases') {
            event.releases.forEach((release) => byId.set(release.id, release));
            setAdhoc((prev) => (prev ? { ...prev, releases: mergeReleases([...byId.values()]) } : prev));
          } else if (event.type === 'failure') {
            setAdhoc((prev) => (prev ? { ...prev, failures: [...prev.failures, event.failure.message] } : prev));
          } else if (event.type === 'error') {
            setError(event.message);
          }
        },
        controller.signal
      );
    } catch (searchError) {
      if (!controller.signal.aborted) {
        setError(searchError instanceof Error ? searchError.message : 'Search failed');
      }
    } finally {
      if (adhocAbort.current === controller) {
        adhocAbort.current = null;
        setAdhoc((prev) => (prev ? { ...prev, loading: false } : prev));
      }
    }
  }

  function closeAdhoc(): void {
    adhocAbort.current?.abort();
    adhocAbort.current = null;
    setAdhoc(null);
  }

  async function searchDirectly(): Promise<void> {
    if (selectedSearchResult) {
      await runAdhocSearch({ mbid: selectedSearchResult.id, name: selectedSearchResult.name });
      return;
    }
    if (!labelQuery.trim()) {
      return;
    }
    try {
      const selected = (await searchLabels(labelQuery.trim()))[0];
      if (!selected) {
        // Unknown on MusicBrainz: still search Deezer/Discogs by name.
        await runAdhocSearch({ name: labelQuery.trim() });
        return;
      }
      setSelectedSearchResult(selected);
      await runAdhocSearch({ mbid: selected.id, name: selected.name });
    } catch (directError) {
      setError(directError instanceof Error ? directError.message : 'Direct search failed');
    }
  }

  const feedReleases = useMemo(() => feed?.snapshot?.releases ?? feed?.run.releases ?? [], [feed]);
  const releases = adhoc ? adhoc.releases : feedReleases;
  const isNew = (release: Release): boolean =>
    !adhoc && Boolean(previousVisit && release.firstSeenAt && release.firstSeenAt > previousVisit);
  const newCount = adhoc ? 0 : feedReleases.filter(isNew).length;
  const feedFailures = running ? (feed?.run.failures ?? []) : (feed?.snapshot?.meta.partialFailures ?? []);
  const showSkeleton = releases.length === 0 && (adhoc ? adhoc.loading : running || !loaded);
  const nextRun = feed ? formatNextRun(feed) : null;

  if (loadError) {
    return (
      <div className="page">
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>New releases from your labels</h1>
        <p>
          Checked automatically via Deezer and MusicBrainz (optionally Discogs), with Apple Music links
          {feed?.schedule.enabled ? `; refreshed every day at ${feed.schedule.time}.` : '.'}
        </p>
      </header>

      <main className="layout">
        <section className="panel controls" aria-label="Labels and settings">
          <details className="instructions-collapsible" aria-label="Instructions">
            <summary>How it works & import format</summary>
            <ol>
              <li>Build your label list: search and add labels, or import a file (add to or replace the list).</li>
              <li>Pick how many recent days to check, country and sources. They are saved and used by the daily refresh.</li>
              <li>Each refresh checks only those recent days and adds what it finds; releases stay in the list for a while, so it grows into a history.</li>
              <li>Open the page any time to see the latest results. "New" marks releases found since your last visit.</li>
              <li>"Search directly" runs a one-off search for a single label without changing the feed.</li>
            </ol>
            <p>Use one label per line. Empty lines are ignored. Lines starting with <code>#</code> are comments.</p>
            <pre>
{`#Rock Music
Run for Cover Records
Smallville
Subpop`}
            </pre>
          </details>

          <div className="input-row">
            <label htmlFor="label-query">Label</label>
            <input
              id="label-query"
              value={labelQuery}
              onChange={(event) => {
                setLabelQuery(event.target.value);
                setSelectedSearchResult(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void runLabelLookup(labelQuery);
                }
              }}
              placeholder="Enter music label"
            />
          </div>

          <div className="button-row button-row-secondary">
            <button type="button" className="btn secondary" onClick={() => runLabelLookup(labelQuery)} disabled={!labelQuery.trim()}>
              Find label
            </button>
            <button type="button" className="btn secondary" onClick={addSelectedToList} disabled={!selectedSearchResult || !loaded}>
              Add to list
            </button>
            <button type="button" className="btn secondary" onClick={searchDirectly} disabled={!loaded || (!labelQuery.trim() && !selectedSearchResult)}>
              {selectedSearchResult ? 'Search selected label' : 'Search directly'}
            </button>
          </div>

          {labelSearchResults.length > 0 && (
            <div className="result-list" role="listbox" aria-label="Label search results">
              {labelSearchResults.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`search-result ${selectedSearchResult?.id === entry.id ? 'active' : ''}`}
                  onClick={() => setSelectedSearchResult(entry)}
                >
                  {formatLabelChoice(entry)}
                </button>
              ))}
            </div>
          )}

          {settings && (
            <>
              <div className="input-row grid-row">
                <div>
                  <label htmlFor="days">Check last days</label>
                  <input
                    id="days"
                    type="number"
                    min={1}
                    max={MAX_DAYS}
                    value={settings.days}
                    onChange={(event) => {
                      const next = Math.trunc(Number(event.target.value));
                      if (Number.isFinite(next) && next >= 1 && next <= MAX_DAYS) {
                        changeSettings({ days: next });
                      }
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="country">Country</label>
                  <select id="country" value={settings.country} onChange={(event) => changeSettings({ country: event.target.value })}>
                    {COUNTRIES.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <fieldset className="source-picker">
                <legend>Sources</legend>
                <div className="source-chips">
                  {SOURCE_OPTIONS.map((option) => {
                    const active = settings.sources.includes(option.id);
                    return (
                      <label key={option.id} className={`source-chip ${active ? 'active' : ''}`} title={option.hint}>
                        <input type="checkbox" checked={active} onChange={() => toggleSource(option.id)} />
                        <span aria-hidden="true" className="source-chip-mark">
                          {active ? '✓' : '+'}
                        </span>
                        {option.label}
                      </label>
                    );
                  })}
                </div>
                <p className="source-hint">
                  {SOURCE_OPTIONS.map((option) => `${option.label}: ${option.hint}`).join(' · ')}
                  {settings.sources.includes('discogs') &&
                    !feed?.discogsTokenConfigured &&
                    '. Discogs runs without a token; set DISCOGS_TOKEN on the server for higher limits.'}
                </p>
              </fieldset>
            </>
          )}

          <div className="label-list">
            <h2>Label list ({labels.length})</h2>
            <div className="button-row button-row-secondary">
              <label className={`btn secondary file-btn ${importing || !loaded ? 'disabled' : ''}`}>
                Add from file
                <input
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  disabled={importing || !loaded}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void importFile(file, 'add');
                      event.target.value = '';
                    }
                  }}
                />
              </label>
              <label className={`btn secondary file-btn ${importing || !loaded ? 'disabled' : ''}`}>
                Replace from file
                <input
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  disabled={importing || !loaded}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void importFile(file, 'replace');
                      event.target.value = '';
                    }
                  }}
                />
              </label>
              <button className="btn secondary" type="button" onClick={exportLabelsList} disabled={labels.length === 0}>
                Export
              </button>
              <button className="btn danger subtle" type="button" onClick={clearLabels} disabled={importing || labels.length === 0}>
                Clear all
              </button>
            </div>
            {importing && (
              <p className="progress">
                Resolving labels on MusicBrainz: {importProgress.current} / {importProgress.total}
              </p>
            )}
            <div className="chips">
              {labels.map((label) => (
                <LabelChip
                  key={labelKey(label)}
                  label={label}
                  onRemove={(removed) => void saveLabels(labels.filter((entry) => labelKey(entry) !== labelKey(removed)))}
                />
              ))}
            </div>
          </div>

          {error && <p className="error">{error}</p>}
          {notices.length > 0 && (
            <ul className="warning-list">
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          )}
          {!adhoc && feedFailures.length > 0 && (
            <details className="failure-details">
              <summary>{feedFailures.length} source problem(s) in the last refresh</summary>
              <ul className="warning-list">
                {feedFailures.map((failure, index) => (
                  <li key={`${failure.label.name}-${index}`}>
                    {failure.label.name}: {failure.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="panel releases" aria-label="Releases">
          {adhoc ? (
            <div className="section-header">
              <div>
                <h2>Direct search: {adhoc.label.name}</h2>
                <p>
                  {adhoc.loading ? 'Searching…' : `${adhoc.releases.length} results`}
                  {adhoc.failures.length > 0 && ` · ${adhoc.failures.join(' · ')}`}
                </p>
              </div>
              <button type="button" className="btn secondary" onClick={closeAdhoc}>
                Back to feed
              </button>
            </div>
          ) : (
            <div className="section-header">
              <div>
                <h2>Releases</h2>
                <p>
                  {feed?.snapshot
                    ? `${feed.snapshot.releases.length} releases (kept ${feed.retentionDays} days) · last ${feed.settings.days} days checked ${dateTimeFormat.format(new Date(feed.snapshot.finishedAt))}`
                    : 'Not refreshed yet'}
                  {nextRun && ` · ${nextRun}`}
                </p>
                {newCount > 0 && <p className="new-count">{newCount} new since your last visit</p>}
              </div>
              <button type="button" className="btn primary" onClick={refreshNow} disabled={!loaded || running || labels.length === 0}>
                {running ? 'Refreshing…' : 'Refresh now'}
              </button>
            </div>
          )}

          {!adhoc && running && (
            <div className="loading-more" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <p>
                Refreshing {feed?.run.completed ?? 0} / {feed?.run.total ?? 0} labels
                {feed?.snapshot ? ', showing previous results until done' : ''}
              </p>
            </div>
          )}
          {!adhoc && feed?.run.error && <p className="error">Last refresh failed: {feed.run.error}</p>}

          {showSkeleton && (
            <div className="release-grid">
              {Array.from({ length: 6 }).map((_, index) => (
                <ReleaseSkeleton key={index} />
              ))}
            </div>
          )}

          {!showSkeleton && releases.length === 0 && (
            <p className="empty">
              {adhoc ? 'No releases for this label in the selected range.' : labels.length === 0 ? 'Add labels to start your feed.' : 'No releases in this range yet.'}
            </p>
          )}

          {releases.length > 0 && (
            <div className="release-grid">
              {releases.map((release) => (
                <ReleaseCard key={`${release.id}-${release.releaseDate}`} release={release} isNew={isNew(release)} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
