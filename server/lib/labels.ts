const LABEL_NOISE_RE = /\b(records?|recordings?|music|musik|ltd|limited|inc|gmbh|llc|label|the)\b/g;

/** "Erased Tapes Records Ltd." -> "erased tapes" */
export function normalizeLabelName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(LABEL_NOISE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Exact label check after normalization. Provider label strings can list several
 * labels ("Etoile Audio/Nonesuch"), each part is compared on its own.
 * Fuzzy provider search ("Latency" also hits "Low Latency FM") is filtered out here.
 */
export function labelMatches(wanted: string, actual?: string): boolean {
  if (!actual) {
    return false;
  }
  const target = normalizeLabelName(wanted);
  if (!target) {
    return false;
  }
  return [actual, ...actual.split(/\s*[/,;|]\s*/)].some((part) => normalizeLabelName(part) === target);
}
