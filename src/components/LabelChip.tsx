import type { LabelRef } from '../../shared/types';

interface Props {
  label: LabelRef;
  onRemove: (label: LabelRef) => void;
}

export function LabelChip({ label, onRemove }: Props): JSX.Element {
  const title = label.mbid ? 'Click to remove label' : 'Not found on MusicBrainz (searched by name). Click to remove label';
  return (
    <button className={`label-chip ${label.mbid ? '' : 'name-only'}`} onClick={() => onRemove(label)} type="button" title={title}>
      {label.name}
    </button>
  );
}
