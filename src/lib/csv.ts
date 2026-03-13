export function parseLabelText(text: string): string[] {
  const rows = text
    .split(/\r?\n/)
    .flatMap((line) => line.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);

  return [...new Set(rows)];
}
