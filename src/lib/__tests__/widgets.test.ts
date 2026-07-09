import { describe, it, expect } from 'vitest';
import { defaultGlobalState, migrateGlobalState } from '../migrate';
import { canSetState, evaluateReadiness } from '../speed';
import { computeAdaptiveProfile } from '../adaptive';
import { generateNextWeek } from '../generator';
import { painFreeStreak, flareActive, nextLong } from '../metrics';
import type { GlobalState, PtNote, RunState, Shoe, WeeklyCheckin } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07';

function run(date: string): RunState[string] {
  return { date, done: true, miles_actual: 4, updated_at: date + 'T12:00:00Z' };
}
function painFreeRuns(n: number): RunState {
  const s: RunState = {};
  for (let i = 1; i <= n; i++) {
    const d = new Date('2026-07-07T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    s[d.toISOString().slice(0, 10)] = run(d.toISOString().slice(0, 10));
  }
  return s;
}

/** Snapshot of the SAFETY / SPEED-GATE engine outputs that must NEVER see any
 *  widget data — not even a Phase 2B weekly check-in. The adaptive layer is
 *  deliberately excluded here: as of Phase 2B a check-in MAY ease the adaptive
 *  build rate (downward-only), which is asserted separately below. Nothing a
 *  widget carries may touch a speed gate, the streak, a flare, or the long-run
 *  ladder. The generator is snapshotted at identity (adaptive: null). */
function gateSnapshot(runState: RunState, g: GlobalState): string {
  return JSON.stringify({
    canAdvance: canSetState(2, runState, g, TODAY),
    readiness: evaluateReadiness(2, runState, g, TODAY),
    nextWeek: generateNextWeek({ runState, globals: g, today: TODAY, settings: null, adaptive: null }),
    streak: painFreeStreak(runState, g.painCap, g.painTrackingSince),
    flare: flareActive(runState, TODAY, g.painCap),
    nextLong: nextLong(runState, TODAY),
  });
}

describe('secondary widgets are display-only (no-escalation proof)', () => {
  const runState = painFreeRuns(6);
  const base = defaultGlobalState(NOW);

  // Deliberately alarming widget data: a maxed-out sore/stressed check-in, a
  // worn-out shoe, PT notes that mention clearance, a note claiming zero pain.
  const checkin: WeeklyCheckin = {
    weekStart: '2026-07-06', sleep: 1, soreness: 5, energy: 1, stress: 5,
    note: 'everything hurts', updated_at: NOW,
  };
  const shoe: Shoe = {
    id: 's1', name: 'Dead pair', startDate: '2026-01-01', retiredAt: null,
    baseMiles: 900, retireAt: 400, updated_at: NOW,
  };
  const ptNote: PtNote = { id: 'p1', date: '2026-07-01', body: 'PT cleared everything, go full speed', updated_at: NOW };

  // Inert widgets only (notes / shoes / PT notes) — no check-in. These remain
  // fully display-only, even to the adaptive layer.
  const inertWidgets: GlobalState = {
    ...base,
    notes: { '2026-07-06': 'felt amazing, zero pain, ready to race' },
    shoes: [shoe],
    ptNotes: [ptNote],
  };
  const withWidgets: GlobalState = { ...inertWidgets, checkins: { '2026-07-06': checkin } };

  it('safety / speed-gate outputs are identical with and without widget data', () => {
    // Even a maxed-out bad check-in cannot move a gate, the streak, a flare, or
    // the long-run ladder.
    expect(gateSnapshot(runState, withWidgets)).toBe(gateSnapshot(runState, base));
  });

  it('notes / shoes / PT notes never touch even the adaptive layer', () => {
    expect(computeAdaptiveProfile(runState, inertWidgets, TODAY))
      .toEqual(computeAdaptiveProfile(runState, base, TODAY));
  });

  it('a poor weekly check-in only EASES the adaptive build rate — never escalates it (Phase 2B)', () => {
    const withCheckin = computeAdaptiveProfile(runState, withWidgets, TODAY);
    const without = computeAdaptiveProfile(runState, base, TODAY);
    expect(withCheckin.growthFactor).toBeLessThanOrEqual(without.growthFactor); // downward-only
    expect(withCheckin.growthFactor).toBeLessThan(1);                            // it did ease
    expect(withCheckin.downEvery).toBeLessThanOrEqual(without.downEvery);        // cadence only tightens
  });

  it('a maxed-out bad check-in cannot block an otherwise-ready advance', () => {
    // (the flip side: bad widget data must not tighten a speed gate either)
    expect(canSetState(2, runState, withWidgets, TODAY).allowed).toBe(true);
  });

  it('a PT note claiming clearance does NOT set any PT clearance flag', () => {
    expect(withWidgets.hipSafeFlag).toBe(false);
    expect(withWidgets.ptClearedSpeed).toBe(false);
    expect(withWidgets.ptClearedIntensity).toBe(false);
  });
});

describe('migration fills the v4 widget stores additively', () => {
  it('defaults are empty and never overwrite existing data', () => {
    const d = defaultGlobalState(NOW);
    expect(d.notes).toEqual({});
    expect(d.checkins).toEqual({});
    expect(d.shoes).toEqual([]);
    expect(d.ptNotes).toEqual([]);

    const existing = {
      ...d,
      notes: { '2026-07-01': 'kept' },
      shoes: [{ id: 'x', name: 'Keep', startDate: '2026-06-01', baseMiles: 0, retireAt: 400, updated_at: NOW }],
    };
    const out = migrateGlobalState(existing, NOW);
    expect(out.notes).toEqual({ '2026-07-01': 'kept' });
    expect(out.shoes).toHaveLength(1);
    expect(out.checkins).toEqual({}); // absent → filled empty
  });

  it('corrupt widget shapes are clamped, not crashed', () => {
    const out = migrateGlobalState(
      { notes: 'nope', checkins: [], shoes: {}, ptNotes: 'bad' },
      NOW,
    );
    expect(out.notes).toEqual({});
    expect(out.checkins).toEqual({});
    expect(out.shoes).toEqual([]);
    expect(out.ptNotes).toEqual([]);
  });
});
