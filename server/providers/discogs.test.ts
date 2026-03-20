import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/http.js', () => ({
  fetchJson: vi.fn()
}));

import { fetchJson } from '../lib/http.js';
import { fetchDiscogsRelease } from './discogs.js';

describe('discogs provider', () => {
  it('counts only real track entries in tracklist', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      id: 77,
      title: 'Sample',
      artists_sort: 'Artist',
      released: '2026-01-01',
      genres: ['Electronic'],
      styles: ['Deep House'],
      formats: [
        {
          name: 'Vinyl',
          descriptions: ['12"', '33 ⅓ RPM']
        }
      ],
      tracklist: [
        { type_: 'heading', title: 'Side A' },
        { type_: 'track', title: 'A1' },
        { type_: 'track', title: '' },
        { type_: 'track', title: 'A2' }
      ]
    });

    const detail = await fetchDiscogsRelease(77);
    expect(detail.trackCount).toBe(2);
    expect(detail.formatDescriptions).toEqual(['12"', '33 ⅓ RPM']);
  });
});
