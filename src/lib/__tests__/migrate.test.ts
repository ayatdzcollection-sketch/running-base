import { describe, it, expect } from 'vitest';
import { migrateGlobalState, defaultGlobalState, SCHEMA_VERSION } from '../migrate';

const NOW = '2026-07-07T12:00:00Z';

describe('additive migration (§1 — prove it is safe)', () => {
  it('null/garbage input yields safe defaults (speedState 1, painCap 3)', () => {
    const g = migrateGlobalState(null, NOW);
    expect(g.schemaVersion).toBe(SCHEMA_VERSION);
    expect(g.speedState).toBe(1);
    expect(g.painCap).toBe(3);
    expect(g.hipSafeFlag).toBe(false);
    expect(g.ptClearedSpeed).toBe(false);
    expect(g.ptClearedIntensity).toBe(false);
    expect(g.delayUntil).toBeNull();
  });

  it('is idempotent: migrate(migrate(x)) === migrate(x)', () => {
    const once = migrateGlobalState({ speedState: 3, painCap: 2 }, NOW);
    const twice = migrateGlobalState(once, NOW);
    expect(twice).toEqual(once);
  });

  it('only adds missing keys — existing values are never overwritten', () => {
    const existing = {
      speedState: 4,
      hipSafeFlag: true,
      painCap: 2,
      delayUntil: '2026-08-01',
      acceptedWeeks: { '2026-07-13': [] },
    };
    const g = migrateGlobalState(existing, NOW);
    expect(g.speedState).toBe(4);
    expect(g.hipSafeFlag).toBe(true);
    expect(g.painCap).toBe(2);
    expect(g.delayUntil).toBe('2026-08-01');
    expect(g.acceptedWeeks).toEqual({ '2026-07-13': [] });
    // missing keys filled with defaults
    expect(g.ptClearedSpeed).toBe(false);
    expect(g.lastFastSessionDate).toBeNull();
  });

  it('preserves unknown keys from future versions (never wipes)', () => {
    const g = migrateGlobalState({ futureField: 'keep me' }, NOW) as unknown as Record<string, unknown>;
    expect(g.futureField).toBe('keep me');
  });

  it('never downgrades a future schemaVersion', () => {
    const g = migrateGlobalState({ schemaVersion: 99 }, NOW);
    expect(g.schemaVersion).toBe(99);
  });

  it('clamps corrupt values without discarding the rest', () => {
    const g = migrateGlobalState({ speedState: 42, painCap: -3, hipSafeFlag: true }, NOW);
    expect(g.speedState).toBe(1);
    expect(g.painCap).toBe(3);
    expect(g.hipSafeFlag).toBe(true);
  });

  it('default state matches the spec defaults', () => {
    const d = defaultGlobalState(NOW);
    expect(d.speedState).toBe(1);
    expect(d.painCap).toBe(3); // research ceiling is 5 — we run tighter
    expect(d.painFreeEasyRunStreak).toBe(0);
    expect(d.readiness).toEqual({});
    expect(d.acceptedWeeks).toEqual({});
  });
});
