import { describe, expect, it, vi } from 'vitest';
import { computeDateRange } from './date.js';

describe('computeDateRange', () => {
  it('includes today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T10:00:00Z'));
    const value = computeDateRange('days', 7, 'Europe/Berlin');
    expect(value.toDate).toBe('2026-03-13');
    expect(value.fromDate).toBe('2026-03-07');
    vi.useRealTimers();
  });

  it('returns full year range', () => {
    const value = computeDateRange('year', 2026, 'Europe/Berlin');
    expect(value.fromDate).toBe('2026-01-01');
    expect(value.toDate).toBe('2026-12-31');
  });
});
