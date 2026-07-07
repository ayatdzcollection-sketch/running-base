import { describe, it, expect } from 'vitest';
import { buildBackup, parseBackup, mergeStates, applySeed } from '../storage';
import { defaultGlobalState } from '../migrate';
import type { RunState } from '../types';

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
});
