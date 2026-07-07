import { describe, it, expect } from 'vitest';
import { buildBackup, parseBackup, mergeStates, mergeGlobalStates, applySeed } from '../storage';
import { defaultGlobalState } from '../migrate';
import type { GlobalState, RaceResult, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';

const RUNS: RunState = {
  '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: NOW },
};

describe('backup / restore compatibility', () => {
  it('v2 round-trip preserves runs and globals', () => {
    const g = { ...defaultGlobalState(NOW), speedState: 3 as const };
    const text = JSON.stringify(buildBackup(RUNS, g));
    const parsed = parseBackup(text);
    expect(parsed.runs).toEqual(RUNS);
    expect(parsed.globals?.speedState).toBe(3);
  });

  it('still restores the ORIGINAL v1 flat export (no globals)', () => {
    const text = JSON.stringify(RUNS); // pre-update export format
    const parsed = parseBackup(text);
    expect(parsed.runs).toEqual(RUNS);
    expect(parsed.globals).toBeNull();
  });

  it('rejects arrays and non-objects', () => {
    expect(() => parseBackup('[1,2]')).toThrow();
    expect(() => parseBackup('"nope"')).toThrow();
  });
});

describe('merge & seed still protect existing data', () => {
  it('newer local entry wins over older remote', () => {
    const local: RunState = {
      '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 5, updated_at: '2026-07-06T20:00:00Z' },
    };
    const remote = [
      { date: '2026-07-06', done: false, miles_actual: null, updated_at: '2026-07-06T10:00:00Z' },
    ];
    expect(mergeStates(local, remote)['2026-07-06'].miles_actual).toBe(5);
  });

  it('remote entries with v2 fields merge without touching other days', () => {
    const local: RunState = { ...RUNS };
    const remote = [
      { date: '2026-07-07', done: true, miles_actual: 4, updated_at: NOW, rpe: 5, painDuring: 1 },
    ];
    const merged = mergeStates(local, remote);
    expect(merged['2026-07-06']).toEqual(RUNS['2026-07-06']); // untouched
    expect(merged['2026-07-07'].rpe).toBe(5);
  });

  it('applySeed never overwrites an existing entry', () => {
    const existing: RunState = {
      '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.2, updated_at: '2026-06-29T18:00:00Z' },
    };
    const seeded = applySeed(existing);
    expect(seeded['2026-06-29'].miles_actual).toBe(4.2);
  });

  it('a newer remote row stripped of v2 fields keeps local subjective data', () => {
    const local: RunState = {
      '2026-07-06': {
        date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: '2026-07-06T12:00:00Z',
        rpe: 4, painDuring: 2,
      },
    };
    // Legacy-column fallback path: newer updated_at, no subjective columns.
    const remote = [
      { date: '2026-07-06', done: true, miles_actual: 5, updated_at: '2026-07-06T20:00:00Z' },
    ];
    const merged = mergeStates(local, remote);
    expect(merged['2026-07-06'].miles_actual).toBe(5); // newer core wins
    expect(merged['2026-07-06'].painDuring).toBe(2);    // local pain preserved
    expect(merged['2026-07-06'].rpe).toBe(4);
  });
});

describe('mergeGlobalStates — field-aware, non-destructive', () => {
  const race = (id: string, updated_at: string): RaceResult =>
    ({ id, date: '2026-06-20', distanceMi: 3.1, timeSec: 1170, updated_at });

  function g(patch: Partial<GlobalState>): GlobalState {
    return { ...defaultGlobalState(NOW), ...patch };
  }

  it('keeps locally-newer settings under a remotely-newer blob', () => {
    const settings = (goalMiles: number, updated_at: string) =>
      ({ version: 1, goalMiles, updated_at } as unknown as GlobalState['settings']);
    const local = g({ updated_at: '2026-07-06T10:00:00Z', settings: settings(180, '2026-07-06T18:00:00Z') });
    const remote = g({ updated_at: '2026-07-07T10:00:00Z', settings: settings(150, '2026-07-05T10:00:00Z') });
    const merged = mergeGlobalStates(local, remote);
    expect(merged.updated_at).toBe('2026-07-07T10:00:00Z');       // newer blob is base
    expect((merged.settings as { goalMiles: number }).goalMiles).toBe(180); // but local settings win
  });

  it('merges races by id, newest updated_at wins, and keeps device-only entries', () => {
    const local = g({ races: [race('a', '2026-07-06T10:00:00Z'), race('b', '2026-07-01T10:00:00Z')] });
    const remote = g({ races: [race('a', '2026-07-07T10:00:00Z'), race('c', '2026-07-02T10:00:00Z')] });
    const merged = mergeGlobalStates(local, remote);
    const ids = merged.races!.map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(merged.races!.find(r => r.id === 'a')!.updated_at).toBe('2026-07-07T10:00:00Z');
  });

  it('unions acceptedWeeks (local wins ties)', () => {
    const local = g({ acceptedWeeks: { '2026-07-13': [{ date: '2026-07-13', dayLabel: 'Mon', kind: 'easy', miles: 5, why: 'local' }] } });
    const remote = g({ acceptedWeeks: { '2026-07-13': [{ date: '2026-07-13', dayLabel: 'Mon', kind: 'easy', miles: 4, why: 'remote' }], '2026-07-20': [] } });
    const merged = mergeGlobalStates(local, remote);
    expect(Object.keys(merged.acceptedWeeks).sort()).toEqual(['2026-07-13', '2026-07-20']);
    expect(merged.acceptedWeeks['2026-07-13'][0].why).toBe('local'); // local wins the tie
  });
});
