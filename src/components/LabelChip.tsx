import type { LabelRef } from '../../shared/types';

interface Props {
  label: LabelRef;
  onRemove: (mbid: string) => void;
}

export function LabelChip({ label, onRemove }: Props): JSX.Element {
  return (
    <button className="label-chip" onClick={() => onRemove(label.mbid)} type="button" title="Click to remove label">
      {label.name}
    </button>
  );
}
