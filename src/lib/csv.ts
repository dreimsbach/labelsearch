export function parseLabelText(text: string): string[] {
  const rows: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    rows.push(line.replace(/^"(.*)"$/, '$1').trim());
  }

  return [...new Set(rows)];
}
