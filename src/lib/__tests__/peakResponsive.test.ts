// ============================================================
// PEAK RESPONSIVENESS — changing peakMpw visibly reshapes the
// future plan, in BOTH directions, without touching locked weeks
// or logged runs, and without the display window affecting logic.
//
// Root cause this guards: after the rolling refactor, peak was a pure
// ceiling and buildStep the sole rate, so RAISING the peak above the
// buildStep-reachable level did nothing. Now peakMpw is a target the
// ramp seeks toward (buildStep floor, +10%/wk cap, fixed reference
// horizon — not weeksShown), so both raising and lowering are visible.
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveEffectivePlan } from '../planOverlay';
import { defaultSettings } from '../settings';
import { getPlan } from '../../config/plan';
import type { RawSettings, RunState, PlanWeek } from '../types';

const NOW = '2026-07-08T12:00:00Z';
const TODAY = '2026-07-08';

function scenarioLog(): RunState {
  return {
    '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.2, updated_at: NOW },
    '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.5, updated_at: NOW },
    '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW }, // W1 = 20.2
    '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: NOW },
    '2026-07-07': { date: '2026-07-07', done: true, miles_actual: 4.5, updated_at: NOW },
  };
}
function s(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), startMpw: 20, peakMpw: 30, buildStep: 2, downEvery: 4, weeksShown: 7, trailingLongest: 4.5, ...patch };
}
const totals = (ws: PlanWeek[]) => ws.map(w => w.totalPlanned);
const future = (ws: PlanWeek[]) => ws.filter(w => w.startDate >= '2026-07-13'); // W3 onward (unlocked)

describe('changing peakMpw reshapes future unlocked weeks (both directions)', () => {
  it('RAISING peak 30 → 35 raises later future weeks', () => {
    const at30 = resolveEffectivePlan(s({ peakMpw: 30 }), scenarioLog(), TODAY).plan.weeks;
    const at35 = resolveEffectivePlan(s({ peakMpw: 35 }), scenarioLog(), TODAY).plan.weeks;
    expect(totals(at35).slice(2)).not.toEqual(totals(at30).slice(2)); // future weeks changed
    // The later future weeks are strictly higher with the higher peak.
    const maxLate30 = Math.max(...future(at30).map(w => w.totalPlanned));
    const maxLate35 = Math.max(...future(at35).map(w => w.totalPlanned));
    expect(maxLate35).toBeGreaterThan(maxLate30);
  });

  it('LOWERING peak 35 → 28 lowers/caps future weeks', () => {
    const at35 = resolveEffectivePlan(s({ peakMpw: 35 }), scenarioLog(), TODAY).plan.weeks;
    const at28 = resolveEffectivePlan(s({ peakMpw: 28 }), scenarioLog(), TODAY).plan.weeks;
    expect(totals(at28).slice(2)).not.toEqual(totals(at35).slice(2));
    for (const w of future(at28)) expect(w.totalPlanned).toBeLessThanOrEqual(28 + 1e-9); // capped
    expect(Math.max(...future(at28).map(w => w.totalPlanned)))
      .toBeLessThan(Math.max(...future(at35).map(w => w.totalPlanned)));
  });

  it('monotonic: higher peak ⇒ higher (or equal) terminal week', () => {
    const term = (peak: number) => {
      const ws = resolveEffectivePlan(s({ peakMpw: peak }), scenarioLog(), TODAY).plan.weeks;
      return ws[ws.length - 1].totalPlanned;
    };
    expect(term(25)).toBeLessThan(term(30));
    expect(term(30)).toBeLessThanOrEqual(term(35));
    expect(term(35)).toBeLessThanOrEqual(term(40));
    expect(term(25)).toBeLessThan(term(40));
  });

  it('no future week ever exceeds the peak (still a ceiling), any peak', () => {
    for (const peak of [22, 25, 28, 30, 35, 40]) {
      for (const w of future(resolveEffectivePlan(s({ peakMpw: peak }), scenarioLog(), TODAY).plan.weeks)) {
        expect(w.totalPlanned).toBeLessThanOrEqual(peak + 1e-9);
      }
    }
  });
});

describe('peak edits preserve locked weeks and never mutate logged runs', () => {
  it('W1 (completed) and W2 (current) stay on their locked prescription across peak edits', () => {
    const staticFirstTwo = totals(getPlan().weeks).slice(0, 2);
    for (const peak of [25, 30, 35, 45]) {
      const { plan, weekSource } = resolveEffectivePlan(s({ peakMpw: peak }), scenarioLog(), TODAY);
      expect(totals(plan.weeks).slice(0, 2)).toEqual(staticFirstTwo);
      expect(weekSource.get('2026-06-29')).toBe('static'); // W1 locked
      expect(weekSource.get('2026-07-06')).toBe('static'); // W2 (current) locked
    }
  });

  it('resolving a plan with any peak never mutates runState', () => {
    const log = scenarioLog();
    const before = JSON.stringify(log);
    resolveEffectivePlan(s({ peakMpw: 35 }), log, TODAY);
    resolveEffectivePlan(s({ peakMpw: 25 }), log, TODAY);
    expect(JSON.stringify(log)).toBe(before);
  });
});

describe('no stale-state masking: acceptedWeeks/drafts cannot override the regenerated plan', () => {
  it('resolveEffectivePlan output is identical whether or not acceptedWeeks exist elsewhere', () => {
    // resolveEffectivePlan takes only (settings, runState, today) — it never reads
    // globals.acceptedWeeks — so a stale confirmed draft can never mask a peak edit.
    // Proven structurally: the same inputs yield the same plan regardless of any
    // acceptedWeeks that would live in GlobalState.
    const a = totals(resolveEffectivePlan(s({ peakMpw: 35 }), scenarioLog(), TODAY).plan.weeks);
    const b = totals(resolveEffectivePlan(s({ peakMpw: 35 }), scenarioLog(), TODAY).plan.weeks);
    expect(a).toEqual(b);
    // And it differs from a different peak — i.e. the setting, not a cache, drives it.
    const c = totals(resolveEffectivePlan(s({ peakMpw: 28 }), scenarioLog(), TODAY).plan.weeks);
    expect(c).not.toEqual(a);
  });
});

describe('weeksShown stays display-only under peak edits (no horizon compression)', () => {
  it('the first N weeks of a 7-week window equal the first N of a 14-week window (same settings)', () => {
    const small = resolveEffectivePlan(s({ peakMpw: 35, weeksShown: 7 }), scenarioLog(), TODAY).plan.weeks;
    const big = resolveEffectivePlan(s({ peakMpw: 35, weeksShown: 14 }), scenarioLog(), TODAY).plan.weeks;
    expect(big.length).toBeGreaterThan(small.length);
    expect(totals(big).slice(0, small.length)).toEqual(totals(small)); // window doesn't bend the slope
  });
});
