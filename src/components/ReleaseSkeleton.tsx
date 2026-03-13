export function ReleaseSkeleton(): JSX.Element {
  return (
    <article className="release-card skeleton-card" aria-hidden="true">
      <div className="cover-wrap">
        <div className="cover skeleton-block" />
      </div>
      <div className="release-content">
        <div className="skeleton-line large" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </div>
    </article>
  );
}
