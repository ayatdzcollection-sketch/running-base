import { describe, it, expect } from 'vitest';
import { resolveEffectivePlan, isWeekLocked, planTotalMiles } from '../planOverlay';
import { getPlan, PLAN_START_DATE } from '../../config/plan';
import { defaultSettings } from '../settings';
import type { RawSettings, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07'; // Tuesday of Week 2

function raw(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), ...patch };
}

// Week 1 fully logged; Week 2 has Monday logged.
const LOG: RunState = {
  '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.0, updated_at: NOW },
  '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: NOW },
  '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: NOW },
  '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.7, updated_at: NOW },
  '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW },
  '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: NOW },
};

describe('isWeekLocked', () => {
  it('locks past and current weeks', () => {
    expect(isWeekLocked('2026-06-29', LOG, TODAY)).toBe(true); // Week 1 (past)
    expect(isWeekLocked('2026-07-06', LOG, TODAY)).toBe(true); // current week
  });
  it('does not lock a clean future week', () => {
    expect(isWeekLocked('2026-07-20', {}, TODAY)).toBe(false);
  });
  it('locks a future week that has a logged run', () => {
    const withFuture: RunState = { '2026-07-22': { date: '2026-07-22', done: true, miles_actual: 5, updated_at: NOW } };
    expect(isWeekLocked('2026-07-20', withFuture, TODAY)).toBe(true);
  });
});

describe('resolveEffectivePlan', () => {
  it('no settings → byte-identical to the static getPlan()', () => {
    const { plan } = resolveEffectivePlan(null, LOG, TODAY);
    expect(plan).toBe(getPlan()); // same memoized reference
  });

  it('locked weeks keep their STATIC prescription verbatim after regeneration', () => {
    const staticPlan = getPlan();
    const { plan, weekSource } = resolveEffectivePlan(raw({ startMpw: 22, peakMpw: 30 }), LOG, TODAY);
    // Week 1 (2026-06-29) and Week 2 (2026-07-06) are locked.
    const w1 = plan.weeks.find(w => w.startDate === '2026-06-29')!;
    const w2 = plan.weeks.find(w => w.startDate === '2026-07-06')!;
    expect(w1.runDays.map(d => d.prescribed)).toEqual(
      staticPlan.weeks[0].runDays.map(d => d.prescribed));
    expect(w2.runDays.map(d => d.prescribed)).toEqual(
      staticPlan.weeks[1].runDays.map(d => d.prescribed));
    expect(weekSource.get('2026-06-29')).toBe('static');
    expect(weekSource.get('2026-07-06')).toBe('static');
  });

  it('future unlocked weeks are regenerated from settings', () => {
    const staticPlan = getPlan();
    const { plan, weekSource } = resolveEffectivePlan(raw({ startMpw: 26, peakMpw: 40, buildStep: 2 }), LOG, TODAY);
    // Week 3 (2026-07-13) is a clean future week → settings-sourced and different.
    const w3 = plan.weeks.find(w => w.startDate === '2026-07-13')!;
    expect(weekSource.get('2026-07-13')).toBe('settings');
    expect(w3.totalPlanned).not.toEqual(staticPlan.weeks[2].totalPlanned);
  });

  it('fullReset regenerates every week but never mutates runState', () => {
    const before = JSON.stringify(LOG);
    const { plan } = resolveEffectivePlan(raw({ startMpw: 22 }), LOG, TODAY, { fullReset: true });
    // Even Week 1 is now settings-sourced.
    const w1 = plan.weeks.find(w => w.startDate === '2026-06-29')!;
    expect(w1.runDays.length).toBeGreaterThan(0);
    expect(JSON.stringify(LOG)).toBe(before); // runState untouched
  });

  it('regenerated future long runs still obey the ~110% ladder', () => {
    const { plan } = resolveEffectivePlan(raw({ startMpw: 40, peakMpw: 80, buildStep: 8, trailingLongest: 15 }), LOG, TODAY);
    // trailingLongest is clamped; every long run stays on the safe ladder.
    let prev = 0;
    for (const w of plan.weeks) {
      if (w.startDate < '2026-07-13') continue; // only future settings weeks
      const long = w.longRunCap;
      if (prev > 0) expect(long).toBeLessThanOrEqual(prev * 1.1 + 0.5);
      prev = long;
    }
  });

  it('planTotalMiles sums the resolved plan', () => {
    const { plan } = resolveEffectivePlan(null, LOG, TODAY);
    expect(planTotalMiles(plan)).toBeCloseTo(
      getPlan().weeks.reduce((s, w) => s + w.totalPlanned, 0), 5);
  });

  it('start date default matches the plan constant', () => {
    expect(defaultSettings(NOW).startDate).toBe(PLAN_START_DATE);
  });
});
