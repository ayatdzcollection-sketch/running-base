import { describe, it, expect } from 'vitest';
import {
  defaultSettings, migrateSettings, effectiveSettings,
  buildWeekConfigsFromSettings, requiredStreakFor, resetToRecentActuals,
} from '../settings';
import { nextLongFrom, trailing30Longest } from '../metrics';
import type { RawSettings, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07';

function raw(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), ...patch };
}

describe('migrateSettings — additive, idempotent, prototype-compatible', () => {
  it('null in → null out (settings absent = static plan)', () => {
    expect(migrateSettings(null, NOW)).toBeNull();
    expect(migrateSettings(undefined, NOW)).toBeNull();
  });

  it('is idempotent', () => {
    const once = migrateSettings({ goalMiles: 200, capPct: 130 }, NOW);
    const twice = migrateSettings(once, NOW);
    expect(twice).toEqual(once);
  });

  it('converts the prototype layoutOff Record<string,boolean> to a string[]', () => {
    const m = migrateSettings({ layoutOff: { notes: true, coach: true, week: false } }, NOW);
    expect(m!.layoutOff.sort()).toEqual(['coach', 'notes']);
  });

  it('keeps a string[] layoutOff as-is and drops non-strings', () => {
    const m = migrateSettings({ layoutOff: ['a', 'b', 3] }, NOW);
    expect(m!.layoutOff).toEqual(['a', 'b']);
  });
});

describe('effectiveSettings — safety clamps (raise blocked, lower honored)', () => {
  const empty: RunState = {};

  it('clamps capPct down to 110 and reports it', () => {
    const { eff, clamps } = effectiveSettings(raw({ capPct: 130 }), empty, TODAY);
    expect(eff.capPct).toBe(110);
    expect(clamps.some(c => c.field === 'capPct')).toBe(true);
  });

  it('honors a MORE conservative capPct (100 stays 100)', () => {
    const { eff, clamps } = effectiveSettings(raw({ capPct: 100 }), empty, TODAY);
    expect(eff.capPct).toBe(100);
    expect(clamps.some(c => c.field === 'capPct')).toBe(false);
  });

  it('clamps HR intensity caps down to the governors (195 → 155)', () => {
    const { eff } = effectiveSettings(raw({ hrHardCap: 195, hrEasyMax: 175 }), empty, TODAY);
    expect(eff.hrHardCap).toBe(155);
    expect(eff.hrEasyMax).toBe(150);
  });

  it('lowering HR caps is honored (hardCap 150 stays 150)', () => {
    const { eff } = effectiveSettings(raw({ hrHardCap: 150 }), empty, TODAY);
    expect(eff.hrHardCap).toBe(150);
  });

  it('clamps the starting-longest seed to the safe next step from logged runs', () => {
    // Empty log → trailing fallback 4.5 → next step 5.0.
    const { eff } = effectiveSettings(raw({ trailingLongest: 15 }), empty, TODAY);
    expect(eff.trailingLongest).toBe(nextLongFrom(4.5)); // 5.0
  });

  it('clamps startMpw to +10% over the last sustained week', () => {
    const { eff, clamps } = effectiveSettings(raw({ startMpw: 80 }), empty, TODAY);
    // No history → max(0, static W1=20) × 1.1 = 22.
    expect(eff.startMpw).toBeCloseTo(22, 5);
    expect(clamps.some(c => c.field === 'startMpw')).toBe(true);
  });

  it('never lets peak fall below the starting week', () => {
    const { eff } = effectiveSettings(raw({ startMpw: 20, peakMpw: 10 }), empty, TODAY);
    expect(eff.peakMpw).toBeGreaterThanOrEqual(eff.startMpw);
  });
});

describe('buildWeekConfigsFromSettings — safety baked into the shape', () => {
  it('default settings build a plan whose long runs never exceed the ladder step', () => {
    const cfgs = buildWeekConfigsFromSettings(defaultSettings(NOW));
    let prevLong = defaultSettings(NOW).trailingLongest;
    for (const c of cfgs) {
      const long = c.miles[c.miles.length - 1];
      expect(long).toBeLessThanOrEqual(nextLongFrom(prevLong) + 1e-9);
      if (!c.isDownWeek) prevLong = long;
    }
  });

  it('build weeks never grow more than ~10% over the last BUILD week (a down week is absorption, not a new baseline)', () => {
    const cfgs = buildWeekConfigsFromSettings(raw({ startMpw: 20, peakMpw: 60, buildStep: 4, blockWeeks: 6, downEvery: 4 }));
    const totals = cfgs.map(c => c.miles.reduce((a, b) => a + b, 0));
    // The invariant is week-over-week growth vs the last real BUILD week — the
    // week after a down week may legitimately jump back up toward the trajectory
    // (resuming a previously-tolerated load), which is NOT a >10% overload.
    let lastBuild = totals[0];
    for (let i = 1; i < totals.length; i++) {
      if (cfgs[i].isDownWeek) continue; // absorption week — a dip, not growth
      expect(totals[i]).toBeLessThanOrEqual(lastBuild * 1.1 + 0.5);
      lastBuild = totals[i];
    }
  });

  it('inserts down weeks on the configured cadence and HANDS OFF at the peak (no forced final taper)', () => {
    const cfgs = buildWeekConfigsFromSettings(raw({ blockWeeks: 7, downEvery: 3 }));
    // A scheduled down week still appears on the cadence...
    expect(cfgs.some(c => c.note === 'down week')).toBe(true);
    // ...but the FINAL week is a handoff near the peak, never a taper collapse.
    const last = cfgs[cfgs.length - 1];
    expect(last.note).toBe('handoff');
    expect(last.isDownWeek).toBe(false);
    // No collapse: the handoff is not cut below the scheduled down weeks.
    const lastTotal = last.miles.reduce((a, b) => a + b, 0);
    const downTotals = cfgs.filter(c => c.isDownWeek).map(c => c.miles.reduce((a, b) => a + b, 0));
    for (const dt of downTotals) expect(lastTotal).toBeGreaterThan(dt);
  });

  it('peakMpw binds — no week total exceeds it', () => {
    const cfgs = buildWeekConfigsFromSettings(raw({ startMpw: 20, peakMpw: 22, buildStep: 5, blockWeeks: 8, downEvery: 4 }));
    for (const c of cfgs) {
      expect(c.miles.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(22 + 1e-9);
    }
  });

  it('daysPerWeek shapes the run/rest layout (4 days → 4 run entries, long last)', () => {
    const cfgs = buildWeekConfigsFromSettings(raw({ daysPerWeek: 4 }));
    expect(cfgs[0].miles).toHaveLength(4);
  });
});

describe('resetToRecentActuals — fresh base from recent training, not old peak', () => {
  const NOW2 = '2026-07-07T12:00:00Z';
  const run = (date: string, miles: number): RunState[string] =>
    ({ date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z' });
  // An OLD peak week (~40 mpw) months ago, then a REDUCED recent week (~10 mpw).
  const brokenSeason: RunState = {
    '2026-04-06': run('2026-04-06', 8), '2026-04-08': run('2026-04-08', 8), '2026-04-10': run('2026-04-10', 8),
    '2026-04-11': run('2026-04-11', 8), '2026-04-12': run('2026-04-12', 8), // old peak week = 40
    '2026-06-29': run('2026-06-29', 3), '2026-07-01': run('2026-07-01', 3), '2026-07-03': run('2026-07-03', 4), // recent = 10
  };

  it('seeds startMpw from the RECENT sustained week (~80%), not the old peak', () => {
    const s = resetToRecentActuals(defaultSettings(NOW2), brokenSeason, '2026-07-07', NOW2);
    expect(s.startMpw).toBeLessThanOrEqual(12);        // ~80% of recent 10, nowhere near 40
    expect(s.startMpw).toBeGreaterThanOrEqual(8);
  });

  it('sets the start date to the upcoming Monday and seeds the long run from recent longest', () => {
    const s = resetToRecentActuals(defaultSettings(NOW2), brokenSeason, '2026-07-07', NOW2);
    expect(s.startDate).toBe('2026-07-13');
    expect(s.trailingLongest).toBeLessThanOrEqual(4);  // recent longest ~4, not the old 8
  });

  it('carries over preferences (goal, days/week, block length, governors)', () => {
    const custom = { ...defaultSettings(NOW2), goalMiles: 200, daysPerWeek: 4, blockWeeks: 10, capPct: 108 };
    const s = resetToRecentActuals(custom, brokenSeason, '2026-07-07', NOW2);
    expect(s.goalMiles).toBe(200);
    expect(s.daysPerWeek).toBe(4);
    expect(s.blockWeeks).toBe(10);
    expect(s.capPct).toBe(108);
  });

  it('with no logged history, falls back to a conservative floor', () => {
    const s = resetToRecentActuals(null, {}, '2026-07-07', NOW2);
    expect(s.startMpw).toBeLessThanOrEqual(15);
    expect(s.startDate).toBe('2026-07-13');
  });

  it("the first long run of a reset block still obeys the trailing-30-day cap", () => {
    const s = resetToRecentActuals(defaultSettings(NOW2), brokenSeason, '2026-07-07', NOW2);
    const cfgs = buildWeekConfigsFromSettings(s);
    const firstLong = cfgs[0].miles[cfgs[0].miles.length - 1];
    const cap = nextLongFrom(trailing30Longest(brokenSeason, '2026-07-07'));
    expect(firstLong).toBeLessThanOrEqual(cap + 1e-9);
  });
});

describe('requiredStreakFor — stricter of user pref and built-in', () => {
  it('raises to the built-in minimum when pfNeeded is lower', () => {
    expect(requiredStreakFor(5, raw({ pfNeeded: 2 }))).toBe(4); // built-in for 5 is 4
  });
  it('honors a stricter user requirement', () => {
    expect(requiredStreakFor(2, raw({ pfNeeded: 6 }))).toBe(6); // built-in for 2 is 3
  });
  it('falls back to the built-in when settings are null', () => {
    expect(requiredStreakFor(3, null)).toBe(3);
  });
});
