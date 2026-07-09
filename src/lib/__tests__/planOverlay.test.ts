import { describe, it, expect } from 'vitest';
import { resolveEffectivePlan, isWeekLocked, planTotalMiles } from '../planOverlay';
import { getPlan, PLAN_START_DATE } from '../../config/plan';
import { defaultSettings, returnFromBreak } from '../settings';
import { addDaysStr } from '../metrics';
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

  it('never mutates runState while resolving', () => {
    const before = JSON.stringify(LOG);
    resolveEffectivePlan(raw({ startMpw: 22 }), LOG, TODAY);
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

  it('the long-run ladder is continuous across the locked→settings boundary (no jump)', () => {
    const { plan } = resolveEffectivePlan(raw({ startMpw: 30, peakMpw: 50, buildStep: 3, trailingLongest: 12 }), LOG, TODAY);
    // Walk every consecutive week: no long run ever exceeds ~110% of the prior,
    // even where a settings week follows a locked static week.
    for (let i = 1; i < plan.weeks.length; i++) {
      const prev = plan.weeks[i - 1].longRunCap;
      const cur = plan.weeks[i].longRunCap;
      expect(cur).toBeLessThanOrEqual(prev * 1.1 + 0.5);
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

// ── Fix 1: a reseeded (Return-from-break) plan must NOT be overwritten by the
// original static summer block when its weeks lock. Regression for the audit's
// top finding: WEEK_CONFIGS[i] was spliced by display index regardless of the
// reseeded startDate, re-baselining a conservative 12 mi return onto the 20 mi W1.
describe('return-from-break reseed is not overwritten by the static block (Fix 1)', () => {
  // A ~20 mi/wk block the athlete completed BEFORE the break.
  const preBreakLog: RunState = {
    '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.5, updated_at: NOW },
    '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW },
  };
  const breakStart = '2026-07-06';
  const returnDay = '2026-08-05'; // 30-day break → 60% conservative reseed
  // xcStartDate far out so maintenance never muddies the build assertions.
  const returned = returnFromBreak(
    raw({ startMpw: 20, peakMpw: 30, weeksShown: 6, buildStep: 1, downEvery: 4, xcStartDate: '2026-12-31' }),
    preBreakLog, returnDay, breakStart, NOW,
  ).settings;
  const start = returned.startDate;
  // A few days into reseeded week 0, with a run logged in it → week 0 is locked.
  const laterToday = addDaysStr(start, 3);
  const log: RunState = {
    ...preBreakLog,
    [start]: { date: start, done: true, miles_actual: 5, updated_at: NOW },
  };

  it('reseeds a conservative start below the original static Week 1, on a future Monday', () => {
    expect(start).not.toBe(PLAN_START_DATE);
    expect(returned.startMpw).toBeLessThan(20);          // 60% of ~20 ≈ 12
    expect(returned.startMpw).toBeGreaterThanOrEqual(6);
  });

  it('the locked reseeded week keeps the reseeded target, NOT WEEK_CONFIGS[0] (20 mi)', () => {
    const { plan, weekSource } = resolveEffectivePlan(returned, log, laterToday);
    const w0 = plan.weeks.find(w => w.startDate === start)!;
    const staticW1 = getPlan().weeks[0].totalPlanned; // 20.0
    expect(w0.totalPlanned).toBeLessThan(staticW1 - 1e-9);           // never the 20 mi summer W1
    expect(w0.totalPlanned).toBeGreaterThanOrEqual(returned.startMpw - 2);
    expect(w0.totalPlanned).toBeLessThanOrEqual(returned.startMpw + 0.5);
    expect(weekSource.get(start)).toBe('settings');                 // generated, not spliced static
  });

  it('carry.traj does not jump to 20 — future weeks continue from the reseeded baseline', () => {
    const { plan } = resolveEffectivePlan(returned, log, laterToday);
    const w1 = plan.weeks.find(w => w.startDate === addDaysStr(start, 7))!;
    // A +10%-capped step off the reseeded ~12, nowhere near the static ramp's W2 (22).
    // With the bug present this resumed from 20+, so w1 would exceed 20.
    expect(w1.totalPlanned).toBeLessThan(returned.startMpw * 1.1 + 1.5);
    expect(w1.totalPlanned).toBeGreaterThanOrEqual(returned.startMpw - 0.5);
  });

  it('logged runs are preserved unchanged through the reseeded resolve', () => {
    const before = JSON.stringify(log);
    resolveEffectivePlan(returned, log, laterToday);
    expect(JSON.stringify(log)).toBe(before);
  });
});
