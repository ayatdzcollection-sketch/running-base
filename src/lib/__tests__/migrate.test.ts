import { describe, it, expect } from 'vitest';
import { migrateGlobalState, defaultGlobalState, SCHEMA_VERSION } from '../migrate';

const NOW = '2026-07-07T12:00:00Z';

describe('additive migration (§1 — prove it is safe)', () => {
  it('null/garbage input yields safe defaults (speedState 0 = locked, painCap 3)', () => {
    const g = migrateGlobalState(null, NOW);
    expect(g.schemaVersion).toBe(SCHEMA_VERSION);
    expect(g.speedState).toBe(0);
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

  // ── Phase 2D: legacy (schema ≤2) speed states remap onto the 0–8 tiers ──
  // Old scale: 1 base-only … 7 structured, 8 flare. New: 0 locked … 8 VO₂/race.
  it('remaps every legacy speed state conservatively (schema ≤2 → v3 tiers)', () => {
    const mapping: Array<[number, number]> = [
      [1, 0], // base only → locked
      [2, 1], // buildups
      [3, 2], // short strides
      [4, 3], // flat strides
      [5, 4], // intro hills → hill strides
      [6, 6], // intro threshold → cruise intervals (tempo re-earned)
      [7, 8], // structured speed → VO₂/race
      [8, 0], // flare/deload → relock (re-earn once settled)
    ];
    for (const [oldState, newTier] of mapping) {
      expect(migrateGlobalState({ speedState: oldState }, NOW).speedState).toBe(newTier);
    }
  });

  it('a v3 blob passes through with NO remap (tier taken verbatim)', () => {
    for (const tier of [0, 1, 4, 5, 8]) {
      const g = migrateGlobalState({ schemaVersion: 3, speedState: tier }, NOW);
      expect(g.speedState).toBe(tier);
    }
  });

  it('only adds missing keys — existing values are never overwritten (legacy state remapped)', () => {
    const existing = {
      speedState: 4,               // legacy scale → remaps to tier 3 (flat strides)
      hipSafeFlag: true,
      painCap: 2,
      delayUntil: '2026-08-01',
      acceptedWeeks: { '2026-07-13': [] },
    };
    const g = migrateGlobalState(existing, NOW);
    expect(g.speedState).toBe(3);
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

  it('fills v3 settings (null) and races ([]) without touching other keys', () => {
    const g = migrateGlobalState({ speedState: 3 }, NOW);
    expect(g.settings ?? null).toBeNull();
    expect(g.races).toEqual([]);
    expect(g.speedState).toBe(2); // legacy 3 (short strides) → tier 2
  });

  it('preserves a populated settings/races blob and clamps corrupt shapes', () => {
    const raw = {
      settings: { version: 1, goalMiles: 200 },
      races: [{ id: 'a', date: '2026-06-20', distanceMi: 3.1, timeSec: 1170, updated_at: NOW }],
    };
    const g = migrateGlobalState(raw, NOW);
    expect((g.settings as { goalMiles: number }).goalMiles).toBe(200);
    expect(g.races?.length).toBe(1);
    // corrupt shapes reset, not discarded-wholesale
    const bad = migrateGlobalState({ settings: 'nope', races: 'nope', speedState: 2 }, NOW);
    expect(bad.settings ?? null).toBeNull();
    expect(bad.races).toEqual([]);
    expect(bad.speedState).toBe(1); // legacy 2 (buildups) → tier 1
  });

  it('a populated acceptedWeeks + delayUntil survive migration unchanged', () => {
    const accepted = {
      '2026-07-13': [
        { date: '2026-07-13', dayLabel: 'Mon', kind: 'easy', miles: 4.5, why: 'x' },
        { date: '2026-07-17', dayLabel: 'Fri', kind: 'long', miles: 5.0, why: 'y' },
      ],
    };
    const g = migrateGlobalState({ acceptedWeeks: accepted, delayUntil: '2026-07-20' }, NOW);
    expect(g.acceptedWeeks).toEqual(accepted);
    expect(g.delayUntil).toBe('2026-07-20');
  });

  it('never downgrades a future schemaVersion', () => {
    const g = migrateGlobalState({ schemaVersion: 99 }, NOW);
    expect(g.schemaVersion).toBe(99);
  });

  it('clamps corrupt values without discarding the rest', () => {
    const g = migrateGlobalState({ speedState: 42, painCap: -3, hipSafeFlag: true }, NOW);
    expect(g.speedState).toBe(0);
    expect(g.painCap).toBe(3);
    expect(g.hipSafeFlag).toBe(true);
    const v3bad = migrateGlobalState({ schemaVersion: 3, speedState: 42 }, NOW);
    expect(v3bad.speedState).toBe(0);
  });

  it('default state matches the spec defaults', () => {
    const d = defaultGlobalState(NOW);
    expect(d.speedState).toBe(0); // speed locked — base first
    expect(d.painCap).toBe(3); // research ceiling is 5 — we run tighter
    expect(d.painFreeEasyRunStreak).toBe(0);
    expect(d.readiness).toEqual({});
    expect(d.acceptedWeeks).toEqual({});
  });
});
