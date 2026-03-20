import { useEffect, useMemo, useState } from 'react';
import type { LabelRef, LabelSearchResult, Release, SourceMode, TimeMode } from '../shared/types';
import { LabelChip } from './components/LabelChip';
import { ReleaseCard } from './components/ReleaseCard';
import { ReleaseSkeleton } from './components/ReleaseSkeleton';
import { searchLabels, searchReleasesForLabels, dedupeReleases } from './lib/api';
import { parseLabelText } from './lib/csv';
import { loadLabels, loadResults, loadSettings, saveLabels, saveResults, saveSettings } from './lib/storage';

const COUNTRIES = ['DE', 'US', 'GB', 'FR', 'JP'];

function formatLabelChoice(label: LabelSearchResult): string {
  const info = [label.country, label.disambiguation].filter(Boolean).join(' · ');
  return info ? `${label.name} (${info})` : label.name;
}

function pickBestLabelCandidate(candidates: LabelSearchResult[], query: string, country: string): LabelSearchResult | null {
  const normalized = query.trim().toLowerCase();
  const exact = candidates.filter((entry) => entry.name.toLowerCase() === normalized);
  if (exact.length === 1) {
    return exact[0];
  }
  const countryMatch = exact.find((entry) => entry.country === country);
  if (countryMatch) {
    return countryMatch;
  }
  return candidates[0] ?? null;
}

export function App(): JSX.Element {
  const [labels, setLabels] = useState<LabelRef[]>(() => loadLabels());
  const [releases, setReleases] = useState<Release[]>(() => loadResults());

  const initial = loadSettings();
  const [timeMode, setTimeMode] = useState<TimeMode>(initial.timeMode);
  const [timeValue, setTimeValue] = useState(initial.timeValue);
  const [country, setCountry] = useState(initial.country);
  const [sourceMode, setSourceMode] = useState<SourceMode>(initial.sourceMode);
  const [discogsToken, setDiscogsToken] = useState(initial.discogsToken);

  const [labelQuery, setLabelQuery] = useState('');
  const [labelSearchResults, setLabelSearchResults] = useState<LabelSearchResult[]>([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState<LabelSearchResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [partialFailures, setPartialFailures] = useState<string[]>([]);

  useEffect(() => {
    saveLabels(labels);
  }, [labels]);

  useEffect(() => {
    saveResults(releases);
  }, [releases]);

  useEffect(() => {
    saveSettings({ timeMode, timeValue, country, sourceMode, discogsToken });
  }, [timeMode, timeValue, country, sourceMode, discogsToken]);

  const canSearch = labels.length > 0 && !loading;

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
    if (!selectedSearchResult) {
      return;
    }

    const exists = labels.some((entry) => entry.mbid === selectedSearchResult.id);
    if (exists) {
      return;
    }

    setLabels((prev) => [...prev, { mbid: selectedSearchResult.id, name: selectedSearchResult.name }]);
  }

  async function resolveLabelName(name: string): Promise<LabelRef | null> {
    const candidates = await searchLabels(name);
    const chosen = pickBestLabelCandidate(candidates, name, country);
    if (!chosen) {
      return null;
    }

    return {
      mbid: chosen.id,
      name: chosen.name
    };
  }

  async function uploadFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const names = parseLabelText(text);
      if (names.length === 0) {
        return;
      }

      setLoading(true);
      setProgress({ current: 0, total: names.length });

      const resolved: LabelRef[] = [];
      const unresolved: string[] = [];

      for (let i = 0; i < names.length; i += 1) {
        const entry = names[i];
        try {
          const label = await resolveLabelName(entry);
          if (label) {
            resolved.push(label);
          } else {
            unresolved.push(entry);
          }
        } catch {
          unresolved.push(entry);
        }

        setProgress({ current: i + 1, total: names.length });
      }

      if (unresolved.length > 0) {
        setPartialFailures(unresolved.map((entry) => `No MBID match for "${entry}"`));
      }

      setLabels((prev) => {
        const map = new Map(prev.map((item) => [item.mbid, item]));
        resolved.forEach((entry) => map.set(entry.mbid, entry));
        return [...map.values()];
      });
    } finally {
      setLoading(false);
      setProgress({ current: 0, total: 0 });
    }
  }

  async function runSearch(targetLabels: LabelRef[]): Promise<void> {
    if (targetLabels.length === 0) {
      return;
    }

    setLoading(true);
    setError(null);
    setPartialFailures([]);
    setProgress({ current: 0, total: targetLabels.length });
    setReleases([]);

    const combined: Release[] = [];
    const failures: string[] = [];

    try {
      for (let i = 0; i < targetLabels.length; i += 1) {
        const label = targetLabels[i];
        try {
          const response = await searchReleasesForLabels(
            [label],
            timeMode,
            timeValue,
            country,
            sourceMode,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            discogsToken.trim() || undefined
          );
          combined.push(...response.releases);
          setReleases(dedupeReleases(combined));
          response.meta.partialFailures.forEach((entry) => failures.push(`${entry.label.name}: ${entry.message}`));
          setPartialFailures([...failures]);
        } catch (searchError) {
          failures.push(`${label.name}: ${searchError instanceof Error ? searchError.message : 'search failed'}`);
          setPartialFailures([...failures]);
        }
        setProgress({ current: i + 1, total: targetLabels.length });
      }

      const merged = dedupeReleases(combined);
      setReleases(merged);
      setPartialFailures(failures);
    } finally {
      setLoading(false);
    }
  }

  async function searchDirectly(): Promise<void> {
    if (selectedSearchResult) {
      await runSearch([{ mbid: selectedSearchResult.id, name: selectedSearchResult.name }]);
      return;
    }

    if (!labelQuery.trim()) {
      return;
    }

    try {
      const found = await searchLabels(labelQuery.trim());
      const selected = found[0] ?? null;

      if (!selected) {
        setError('No label found for direct search');
        return;
      }

      setSelectedSearchResult(selected);
      const labelRef = { mbid: selected.id, name: selected.name };
      await runSearch([labelRef]);
    } catch (directError) {
      setError(directError instanceof Error ? directError.message : 'Direct search failed');
    }
  }

  const emptyState = useMemo(() => !loading && releases.length === 0, [loading, releases.length]);

  return (
    <div className="page">
      <header className="hero">
        <h1>Find releases by record label</h1>
        <p>Label-based search with selectable primary source (MusicBrainz, Discogs, iTunes) plus enrichment for links, covers and metadata. Slow because of rate limits!</p>
      </header>

      <main className="layout">
        <section className="panel controls" aria-label="Search controls">
          <details className="instructions-collapsible" aria-label="Instructions">
            <summary>Instructions & import format</summary>
            <ol>
              <li>Search a label and add it to your list, or upload a label file.</li>
              <li>Set range value + mode (Days or Year), country, and source mode.</li>
              <li>Use direct search or search all labels from your list.</li>
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
              placeholder="Enter music label"
            />
          </div>

          <div className="input-row grid-row">
            <div>
              <label htmlFor="time-value" className="label-placeholder">
                Value
              </label>
              <input
                id="time-value"
                type="number"
                min={timeMode === 'days' ? 1 : 1900}
                max={timeMode === 'days' ? 3650 : 2100}
                value={timeValue}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setTimeValue(Number.isFinite(next) && next > 0 ? Math.trunc(next) : timeMode === 'days' ? 7 : new Date().getFullYear());
                }}
              />
            </div>

            <div>
              <label htmlFor="range-mode">Day/Year Switch</label>
              <select
                id="range-mode"
                aria-label="Range mode"
                value={timeMode}
                onChange={(event) => {
                  const nextMode = event.target.value as TimeMode;
                  setTimeMode(nextMode);
                  if (nextMode === 'days' && (timeValue < 1 || timeValue > 3650)) {
                    setTimeValue(7);
                  }
                  if (nextMode === 'year' && (timeValue < 1900 || timeValue > 2100)) {
                    setTimeValue(new Date().getFullYear());
                  }
                }}
              >
                <option value="days">Days</option>
                <option value="year">Year</option>
              </select>
            </div>

            <div>
              <label htmlFor="country">Country</label>
              <select id="country" value={country} onChange={(event) => setCountry(event.target.value)}>
                {COUNTRIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="source">Source</label>
              <select id="source" value={sourceMode} onChange={(event) => setSourceMode(event.target.value as SourceMode)}>
                <option value="hybrid">Hybrid (MB + iTunes)</option>
                <option value="musicbrainz">MusicBrainz only</option>
                <option value="discogs">Discogs only</option>
              </select>
            </div>

            <div>
              <label htmlFor="discogs-token">Discogs Token (optional)</label>
              <input
                id="discogs-token"
                type="password"
                value={discogsToken}
                onChange={(event) => setDiscogsToken(event.target.value)}
                placeholder="Use personal token for higher limits"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="button-row button-row-main">
            <button
              type="button"
              className="btn primary"
              onClick={searchDirectly}
              disabled={loading || (!labelQuery.trim() && !selectedSearchResult)}
            >
              {selectedSearchResult ? 'Search with selected label' : 'Search directly'}
            </button>
            <button className="btn primary" type="button" onClick={() => runSearch(labels)} disabled={!canSearch}>
              Find from list
            </button>
          </div>

          <div className="button-row button-row-secondary">
            <button type="button" className="btn secondary" onClick={() => runLabelLookup(labelQuery)}>
              Find label
            </button>
            <button type="button" className="btn secondary" onClick={addSelectedToList} disabled={!selectedSearchResult}>
              Add to list
            </button>
            <label className="btn secondary file-btn">
              Upload List
              <input
                type="file"
                accept=".txt,.csv,text/plain,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void uploadFile(file);
                    event.target.value = '';
                  }
                }}
              />
            </label>
            <button className="btn secondary" type="button" onClick={exportLabelsList} disabled={labels.length === 0}>
              Export List
            </button>
            <button className="btn danger subtle" type="button" onClick={() => setLabels([])} disabled={loading || labels.length === 0}>
              Clear all
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

          <div>
            <h2>Label list ({labels.length})</h2>
            <div className="chips">
              {labels.map((label) => (
                <LabelChip key={label.mbid} label={label} onRemove={(mbid) => setLabels((prev) => prev.filter((entry) => entry.mbid !== mbid))} />
              ))}
            </div>
          </div>

          {progress.total > 0 && (
            <p className="progress">Progress: {progress.current} / {progress.total}</p>
          )}

          {error && <p className="error">{error}</p>}
          {partialFailures.length > 0 && (
            <ul className="warning-list">
              {partialFailures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel releases" aria-label="Releases">
          <div className="section-header">
            <h2>Releases</h2>
            <p>{releases.length} results</p>
          </div>

          {loading && releases.length === 0 && (
            <div className="release-grid">
              {Array.from({ length: 6 }).map((_, index) => (
                <ReleaseSkeleton key={index} />
              ))}
            </div>
          )}

          {loading && releases.length > 0 && (
            <div className="loading-more" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <p>
                Loading more releases... ({progress.current}/{progress.total})
              </p>
            </div>
          )}

          {emptyState && <p className="empty">No releases in this range yet.</p>}

          {releases.length > 0 && (
            <div className="release-grid">
              {releases.map((release) => (
                <ReleaseCard key={`${release.id}-${release.releaseDate}`} release={release} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
