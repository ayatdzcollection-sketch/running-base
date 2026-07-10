// ============================================================
// H4 — accepted (confirmed) generated weeks ARE the displayed plan.
//
// GenerateWeek says a confirmed week is "locked into the plan"; before this
// patch resolveEffectivePlan ignored acceptedWeeks, so the week accordion and
// Today card kept showing the settings ramp while the speed-day classifier
// used the accepted day kinds — two surfaces, two stories. These tests pin
// the splice: totals and day kinds match the accepted days, the surfaces
// agree, and completed history / logged runs are never rewritten.
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveEffectivePlan } from '../planOverlay';
import { computeTodaySpeed, todaySpeedReasons } from '../todaySpeed';
import { defaultSettings } from '../settings';
import { defaultGlobalState } from '../migrate';
import { getPlan } from '../../config/plan';
import type { GlobalState, ProposedDay, RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07'; // Tuesday of Week 2

function run(date: string, miles: number): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z' };
}

/** Week 1 fully logged (locks it) + one run this week. */
function log(): RunState {
  return {
    '2026-06-29': run('2026-06-29', 4.0),
    '2026-06-30': run('2026-06-30', 4.0),
    '2026-07-01': run('2026-07-01', 4.0),
    '2026-07-02': run('2026-07-02', 3.5),
    '2026-07-03': run('2026-07-03', 4.5),
    '2026-07-06': run('2026-07-06', 4.5),
  };
}

const ACCEPTED_WS = '2026-07-13';
const ACCEPTED: ProposedDay[] = [
  { date: '2026-07-13', dayLabel: 'Mon', kind: 'easy', miles: 4.5, why: 'easy' },
  { date: '2026-07-14', dayLabel: 'Tue', kind: 'threshold', miles: 3, why: 'cruise intervals' },
  { date: '2026-07-15', dayLabel: 'Wed', kind: 'easy', miles: 4, why: 'easy' },
  { date: '2026-07-16', dayLabel: 'Thu', kind: 'easy', miles: 3.5, why: 'easy' },
  { date: '2026-07-17', dayLabel: 'Fri', kind: 'long', miles: 5.5, why: 'long' },
  { date: '2026-07-18', dayLabel: 'Sat', kind: 'rest', miles: null, why: 'rest' },
  { date: '2026-07-19', dayLabel: 'Sun', kind: 'rest', miles: null, why: 'rest' },
];
const ACCEPTED_TOTAL = 4.5 + 3 + 4 + 3.5 + 5.5; // 20.5

function globalsWithAccepted(): GlobalState {
  return {
    ...defaultGlobalState(NOW),
    painTrackingSince: '2026-06-01',
    acceptedWeeks: { [ACCEPTED_WS]: ACCEPTED },
  };
}

describe('(10) accepted week appears in the displayed plan with its totals and day kinds', () => {
  const settings = defaultSettings(NOW);

  it('the week accordion data (PlanWeek) matches the accepted week exactly', () => {
    const { plan, weekSource } = resolveEffectivePlan(settings, log(), TODAY, {
      acceptedWeeks: { [ACCEPTED_WS]: ACCEPTED },
    });
    const week = plan.weeks.find(w => w.startDate === ACCEPTED_WS);
    expect(week).toBeDefined();
    expect(week!.totalPlanned).toBeCloseTo(ACCEPTED_TOTAL, 5);
    expect(weekSource.get(ACCEPTED_WS)).toBe('accepted');
    expect(week!.label).toMatch(/accepted/);
    // Day kinds survive into the displayed days.
    expect(plan.dateToDay.get('2026-07-14')?.kind).toBe('threshold');
    expect(plan.dateToDay.get('2026-07-14')?.prescribed).toBe(3);
    expect(plan.dateToDay.get('2026-07-17')?.isLongRun).toBe(true);
    expect(plan.dateToDay.get('2026-07-17')?.prescribed).toBe(5.5);
    expect(plan.dateToDay.get('2026-07-18')?.type).toBe('rest');
  });

  it('the static (no-settings) plan splices accepted weeks on its grid too', () => {
    const { plan, weekSource } = resolveEffectivePlan(null, log(), TODAY, {
      acceptedWeeks: { [ACCEPTED_WS]: ACCEPTED },
    });
    const week = plan.weeks.find(w => w.startDate === ACCEPTED_WS);
    expect(week!.totalPlanned).toBeCloseTo(ACCEPTED_TOTAL, 5);
    expect(weekSource.get(ACCEPTED_WS)).toBe('accepted');
    expect(plan.dateToDay.get('2026-07-14')?.kind).toBe('threshold');
    // Non-accepted static weeks are byte-identical to the canonical plan.
    const canonical = getPlan();
    expect(plan.weeks[0].totalPlanned).toBe(canonical.weeks[0].totalPlanned);
  });

  it('the settings ladder continues THROUGH the accepted week (no long-run jump after it)', () => {
    const { plan } = resolveEffectivePlan(settings, log(), TODAY, {
      acceptedWeeks: { [ACCEPTED_WS]: ACCEPTED },
    });
    const nextWeek = plan.weeks.find(w => w.startDate === '2026-07-20');
    expect(nextWeek).toBeDefined();
    // Long run steps ≤ 110% (half-step) from the ACCEPTED long (5.5 → ≤ 6.0).
    expect(nextWeek!.longRunCap).toBeLessThanOrEqual(6.0 + 1e-9);
  });

  it('a break still suppresses future accepted weeks (paused plan projects nothing)', () => {
    const { plan } = resolveEffectivePlan(settings, log(), TODAY, {
      acceptedWeeks: { [ACCEPTED_WS]: ACCEPTED },
      breakStart: '2026-07-10',
    });
    expect(plan.weeks.find(w => w.startDate === ACCEPTED_WS)).toBeUndefined();
  });
});

describe('(11) Today surface and speed-day classification agree on the accepted day kind', () => {
  it('an accepted threshold day: plan day kind = threshold AND todaySpeed treats it as the speed session', () => {
    const g = globalsWithAccepted();
    const today = '2026-07-14'; // the accepted threshold day
    const { plan } = resolveEffectivePlan(defaultSettings(NOW), log(), today, {
      acceptedWeeks: g.acceptedWeeks,
    });
    // What the Today card renders:
    expect(plan.dateToDay.get(today)?.kind).toBe('threshold');
    // What the speed layer decides (no add-on — the workout IS the speed):
    const row = computeTodaySpeed({ runState: log(), globals: g, today, plan, acceptedWeeks: g.acceptedWeeks });
    expect(row).toBeNull();
    expect(todaySpeedReasons({ runState: log(), globals: g, today, plan, acceptedWeeks: g.acceptedWeeks }))
      .toContain('threshold day is the speed session');
  });
});

describe('(12) accepted weeks never rewrite completed history or logged runs', () => {
  it('weeks before the accepted week are identical with and without the splice; runState untouched', () => {
    const settings = defaultSettings(NOW);
    const state = log();
    const before = JSON.stringify(state);
    const plain = resolveEffectivePlan(settings, state, TODAY).plan;
    const spliced = resolveEffectivePlan(settings, state, TODAY, {
      acceptedWeeks: { [ACCEPTED_WS]: ACCEPTED },
    }).plan;
    for (const w of plain.weeks) {
      if (w.startDate >= ACCEPTED_WS) continue; // the accepted week itself may differ
      const s = spliced.weeks.find(x => x.startDate === w.startDate);
      expect(s?.totalPlanned).toBe(w.totalPlanned);
      expect(s?.longRunCap).toBe(w.longRunCap);
    }
    expect(JSON.stringify(state)).toBe(before);
  });
});
