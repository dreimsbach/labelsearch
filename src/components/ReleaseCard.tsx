import { useState } from 'react';
import type { Release } from '../../shared/types';

interface Props {
  release: Release;
}

const APPLE_MUSIC_ICON_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Apple_Music_icon.svg/500px-Apple_Music_icon.svg.png';

function normalizeCoverUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  return url.replace(/\/\d+x\d+bb(?:-\d+)?\.jpg(?:\?.*)?$/i, '/1200x1200bb.jpg');
}

function toAppleDesktopUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  return url.startsWith('https://music.apple.com/') ? url.replace('https://', 'music://') : url;
}

export function ReleaseCard({ release }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);
  const imageUrl = normalizeCoverUrl(release.coverUrl);
  const appleArtistDesktopUrl = toAppleDesktopUrl(release.appleArtistUrl);
  const appleAlbumDesktopUrl = toAppleDesktopUrl(release.appleAlbumUrl);
  const hasAppleLinks = Boolean(appleArtistDesktopUrl || appleAlbumDesktopUrl);

  async function copyArtistAlbum(): Promise<void> {
    const value = `${release.artist} ${release.title}`.trim();
    if (!value) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="release-card">
      <div className="cover-wrap">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${release.title} cover`}
            className="cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="cover placeholder">No cover</div>
        )}
      </div>
      <div className="release-content">
        <h3>{release.artist}</h3>
        <p className="muted">{release.title}</p>
        <p className="meta">{release.releaseDate}</p>
        <p className="meta">Label: {release.labels.join(', ')}</p>
        <p className="meta">Genres: {release.genres.join(', ')}</p>
        {(release.styles?.length ?? 0) > 0 && <p className="meta">Styles: {release.styles?.join(', ')}</p>}
        <div className="links">
          {appleArtistDesktopUrl && (
            <a href={appleArtistDesktopUrl} className="icon-link" aria-label="Apple Artist (App)" title="Apple Artist (App)">
              <img src={APPLE_MUSIC_ICON_URL} alt="" aria-hidden="true" loading="lazy" decoding="async" />
            </a>
          )}
          {appleAlbumDesktopUrl && (
            <a href={appleAlbumDesktopUrl} className="icon-link" aria-label="Apple Album (App)" title="Apple Album (App)">
              <img src={APPLE_MUSIC_ICON_URL} alt="" aria-hidden="true" loading="lazy" decoding="async" />
            </a>
          )}
          {!hasAppleLinks && (
            <button type="button" className="fallback-copy-btn" onClick={() => void copyArtistAlbum()}>
              {copied ? 'Copied' : 'Copy Artist + Album'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
