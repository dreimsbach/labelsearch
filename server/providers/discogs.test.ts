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

  it('prefers large primary image and falls back to normalized thumb size', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({
      id: 78,
      title: 'With Image',
      artists_sort: 'Artist',
      released: '2026-01-01',
      images: [{ type: 'primary', uri: 'https://i.discogs.com/example/rs:fit/g:sm/q:90/h:600/w:600/abc.jpeg' }],
      thumb: 'https://i.discogs.com/example/rs:fit/g:sm/q:40/h:150/w:150/abc.jpeg',
      formats: [],
      tracklist: []
    });

    const withImage = await fetchDiscogsRelease(78);
    expect(withImage.thumb).toBe('https://i.discogs.com/example/rs:fit/g:sm/q:90/h:600/w:600/abc.jpeg');

    vi.mocked(fetchJson).mockResolvedValueOnce({
      id: 79,
      title: 'Thumb Only',
      artists_sort: 'Artist',
      released: '2026-01-01',
      thumb: 'https://i.discogs.com/example/rs:fit/g:sm/q:40/h:150/w:150/abc.jpeg',
      formats: [],
      tracklist: []
    });

    const thumbOnly = await fetchDiscogsRelease(79);
    expect(thumbOnly.thumb).toBe('https://i.discogs.com/example/rs:fit/g:sm/q:90/h:600/w:600/abc.jpeg');
  }, 12000);
});
