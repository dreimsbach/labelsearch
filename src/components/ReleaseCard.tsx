import type { Release } from '../../shared/types';

interface Props {
  release: Release;
}

function coverUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  return url.replace(/\/\d+x\d+bb\.jpg$/i, '/1200x1200bb.jpg');
}

export function ReleaseCard({ release }: Props): JSX.Element {
  const imageUrl = coverUrl(release.coverUrl);

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
        <h3>{release.title}</h3>
        <p className="muted">{release.artist}</p>
        <p className="meta">{release.releaseDate}</p>
        <p className="meta">Type: {release.type}</p>
        <p className="meta">Label: {release.labels.join(', ')}</p>
        <p className="meta">Genres: {release.genres.join(', ')}</p>
        <div className="links">
          {release.appleArtistUrl && (
            <a href={release.appleArtistUrl} target="_blank" rel="noreferrer">
              Apple Artist
            </a>
          )}
          {release.appleAlbumUrl && (
            <a href={release.appleAlbumUrl} target="_blank" rel="noreferrer">
              Album Page
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
