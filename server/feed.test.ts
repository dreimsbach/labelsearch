import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/logger.js', () => ({
  logWarn: vi.fn(async () => undefined),
  logInfo: vi.fn(async () => undefined),
  logError: vi.fn(async () => undefined)
}));

import type { Release } from '../shared/types.js';
import { Feed, isRunDue, nextRunDay, sanitizeLabels, sanitizeSettings, scheduleFromEnv, stampFirstSeen, type ScheduleConfig } from './feed.js';
import { escapeLucene } from './providers/musicbrainz.js';
import type { searchReleases } from './release-service.js';

const berlin6: ScheduleConfig = { enabled: true, time: '06:00', timezone: 'Europe/Berlin' };

function release(title: string, overrides: Partial<Release> = {}): Release {
  return {
    id: `deezer-${title}`,
    artist: 'Artist',
    title,
    releaseDate: '2026-11-13',
    genres: [],
    labels: ['Label'],
    type: 'Album',
    sourceDetails: {},
    matchedByLabel: ['Label'],
    foundBy: ['deezer'],
    ...overrides
  };
}

describe('schedule', () => {
  it('is due once per local day after the configured time', () => {
    // 05:30 UTC = 06:30 in Berlin (CET)
    expect(isRunDue(new Date('2026-11-13T05:30:00Z'), berlin6)).toBe(true);
    expect(isRunDue(new Date('2026-11-13T04:30:00Z'), berlin6)).toBe(false);
    expect(isRunDue(new Date('2026-11-13T05:30:00Z'), berlin6, '2026-11-13')).toBe(false);
    // catches up later the same day after downtime
    expect(isRunDue(new Date('2026-11-13T20:00:00Z'), berlin6, '2026-11-12')).toBe(true);
  });

  it('uses the local day of the schedule timezone', () => {
    // 23:30 UTC on the 13th is already the 14th in Berlin
    expect(isRunDue(new Date('2026-11-13T23:30:00Z'), berlin6, '2026-11-13')).toBe(false);
    expect(nextRunDay(new Date('2026-11-13T23:30:00Z'), berlin6, '2026-11-13')).toBe('2026-11-14');
    expect(nextRunDay(new Date('2026-11-13T10:00:00Z'), berlin6, '2026-11-13')).toBe('2026-11-14');
    expect(nextRunDay(new Date('2026-11-13T04:00:00Z'), berlin6, '2026-11-12')).toBe('2026-11-13');
  });

  it('reads the schedule from env', () => {
    expect(scheduleFromEnv({})).toEqual(berlin6);
    expect(scheduleFromEnv({ SCHEDULE_TIME: '7:30', SCHEDULE_TIMEZONE: 'UTC' })).toEqual({ enabled: true, time: '07:30', timezone: 'UTC' });
    expect(scheduleFromEnv({ SCHEDULE_TIME: 'off' }).enabled).toBe(false);
    expect(scheduleFromEnv({ SCHEDULE_TIME: '25:00' }).enabled).toBe(false);
  });
});

describe('stampFirstSeen', () => {
  it('keeps the first sighting and prunes old history', () => {
    const history: Record<string, string> = {
      'artist::known': '2026-11-10T05:00:00.000Z',
      'artist::ancient': '2024-01-01T05:00:00.000Z'
    };
    const stamped = stampFirstSeen([release('Known'), release('Fresh - EP')], history, '2026-11-13T05:00:00.000Z');

    expect(stamped.map((entry) => entry.firstSeenAt)).toEqual(['2026-11-10T05:00:00.000Z', '2026-11-13T05:00:00.000Z']);
    expect(history['artist::fresh']).toBe('2026-11-13T05:00:00.000Z');
    expect(history['artist::ancient']).toBeUndefined();
  });
});

describe('sanitize', () => {
  it('dedupes labels and drops empty names', () => {
    expect(
      sanitizeLabels([{ name: ' Dial ' }, { name: 'dial' }, { name: '' }, { name: 'Erased Tapes', mbid: 'x' }, { name: 'Erased Tapes Records', mbid: 'x' }])
    ).toEqual([{ name: 'Dial', mbid: undefined }, { name: 'Erased Tapes', mbid: 'x' }]);
  });

  it('keeps settings in valid ranges', () => {
    const current = { timeMode: 'days' as const, timeValue: 7, country: 'DE', sources: ['deezer' as const] };
    expect(sanitizeSettings({ timeValue: 99999 }, current).timeValue).toBe(7);
    expect(sanitizeSettings({ country: 'gb', sources: [] }, current)).toMatchObject({ country: 'GB', sources: ['deezer'] });
    expect(sanitizeSettings({ timeMode: 'year', timeValue: 2025 }, current)).toMatchObject({ timeMode: 'year', timeValue: 2025 });
  });

  it('escapes Lucene syntax in MusicBrainz label queries', () => {
    expect(escapeLucene('o*rs')).toBe('o\\*rs');
    expect(escapeLucene('Scissor & Thread')).toBe('Scissor & Thread');
    expect(escapeLucene('Mister: Saturday!')).toBe('Mister\\: Saturday\\!');
  });
});

describe('Feed', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function fakeSearch(results: Release[][]): typeof searchReleases {
    let call = 0;
    return vi.fn(async (input, emit) => {
      const releases = results[Math.min(call, results.length - 1)];
      call += 1;
      emit({ type: 'releases', label: input.labels[0], releases });
      emit({ type: 'labelDone', label: input.labels[0], completed: input.labels.length, totalLabels: input.labels.length });
      return { releases, fromDate: '2026-11-07', toDate: '2026-11-13', partialFailures: [] };
    });
  }

  it('stores a snapshot, keeps firstSeenAt across runs and persists to disk', async () => {
    dir = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), 'feed-'));
    const filePath = path.join(dir, 'state.json');
    let now = new Date('2026-11-12T05:00:00Z');
    const search = fakeSearch([[release('Old')], [release('Old'), release('New')]]);
    const feed = new Feed({ filePath, schedule: berlin6, search, now: () => now });

    await feed.updateConfig({ labels: [{ name: 'Dial' }], settings: { country: 'GB' } });
    expect(feed.startRun('manual')).toBe(true);
    expect(feed.startRun('manual')).toBe(false);
    await feed.whenIdle();

    now = new Date('2026-11-13T05:00:00Z');
    feed.startRun('manual');
    await feed.whenIdle();

    const reloaded = new Feed({ filePath, schedule: berlin6, search, now: () => now });
    await reloaded.load();
    const state = reloaded.getState();
    expect(state.labels).toEqual([{ name: 'Dial' }]);
    expect(state.settings.country).toBe('GB');
    expect(state.snapshot?.releases.map((entry) => [entry.title, entry.firstSeenAt])).toEqual([
      ['Old', '2026-11-12T05:00:00.000Z'],
      ['New', '2026-11-13T05:00:00.000Z']
    ]);
    expect(vi.mocked(search).mock.calls[0][0]).toMatchObject({ country: 'GB', timezone: 'Europe/Berlin', labels: [{ name: 'Dial' }] });
  });

  it('runs the schedule once per day', async () => {
    const now = new Date('2026-11-13T05:30:00Z');
    const search = fakeSearch([[release('A')]]);
    const feed = new Feed({ schedule: berlin6, search, now: () => now });
    await feed.updateConfig({ labels: [{ name: 'Dial' }] });

    feed.tick();
    await feed.whenIdle();
    feed.tick();
    await feed.whenIdle();

    expect(search).toHaveBeenCalledTimes(1);
    expect(feed.getState().snapshot?.trigger).toBe('schedule');
    expect(feed.getState().schedule.nextRunDay).toBe('2026-11-14');
  });

  it('keeps the previous snapshot when a run fails', async () => {
    const search = vi.fn().mockResolvedValueOnce({ releases: [release('A')], fromDate: 'x', toDate: 'y', partialFailures: [] }).mockRejectedValueOnce(new Error('boom'));
    const feed = new Feed({ schedule: berlin6, search });
    await feed.updateConfig({ labels: [{ name: 'Dial' }] });

    feed.startRun('manual');
    await feed.whenIdle();
    feed.startRun('manual');
    await feed.whenIdle();

    const state = feed.getState();
    expect(state.snapshot?.releases).toHaveLength(1);
    expect(state.run).toMatchObject({ running: false, error: 'boom' });
  });
});
