// ============================================================
// MISSED DAYS — absorb, never make up.
//
// Two layers under test:
//   1. assessMissedDays — the advisory read of the CURRENT week (skip 1–2,
//      re-entry copy at 3+, reassurance on down weeks, recovery-first on
//      flare). Display-only; it must never invent redistribution.
//   2. The RE-ENTRY ANCHOR in resolveEffectivePlan — after a substantially
//      missed completed week (< MISSED.REENTRY_TRIGGER of prescription), the
//      first future week re-enters at max(actual × 1.1, trajectory ×
//      REENTRY_FLOOR) instead of leaping back to the paper trajectory.
//      Downward-only, fires once, identity when adherence is adequate.
// ============================================================

import { describe, it, expect } from 'vitest';
import { assessMissedDays } from '../missedDays';
import { resolveEffectivePlan } from '../planOverlay';
import { defaultSettings } from '../settings';
import { TUNABLES } from '../../config/tunables';
import type { ProposedDay, RawSettings, RunState } from '../types';

const NOW = '2026-06-01T12:00:00Z';

function run(date: string, miles: number | null, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: miles != null, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}

// ── 1. The advisory assessment ───────────────────────────────

describe('assessMissedDays (advisory, display-only)', () => {
  const staticPlan = (runState: RunState, today: string) =>
    resolveEffectivePlan(null, runState, today);

  it('null when nothing is missed', () => {
    const { plan } = staticPlan({}, '2026-07-06'); // Monday — nothing behind us yet
    const week = plan.dateToWeek.get('2026-07-06')!;
    expect(assessMissedDays(week, {}, '2026-07-06', { flare: false })).toBeNull();
  });

  it('null when every past day is logged', () => {
    const rs: RunState = {
      '2026-07-06': run('2026-07-06', 4.5),
      '2026-07-07': run('2026-07-07', 4.5),
    };
    const { plan } = staticPlan(rs, '2026-07-08');
    const week = plan.dateToWeek.get('2026-07-08')!;
    expect(assessMissedDays(week, rs, '2026-07-08', { flare: false })).toBeNull();
  });

  it('one missed easy day → resume: skip it, never make it up', () => {
    const rs: RunState = { '2026-07-06': run('2026-07-06', 4.5) }; // Tue 7/7 missed
    const { plan } = staticPlan(rs, '2026-07-08');
    const week = plan.dateToWeek.get('2026-07-08')!;
    const a = assessMissedDays(week, rs, '2026-07-08', { flare: false })!;
    expect(a.kind).toBe('resume');
    expect(a.missed).toHaveLength(1);
    expect(a.missed[0].date).toBe('2026-07-07');
    expect(a.missedMiles).toBeCloseTo(4.5, 5);
    expect(a.daysLeft).toBe(3); // Wed, Thu, Fri
    expect(a.headline).toMatch(/don't make it up/i);
  });

  it('two missed days still → resume (the evidence line is at RESUME_MAX_MISSED)', () => {
    const { plan } = staticPlan({}, '2026-07-08'); // Mon + Tue both missed
    const week = plan.dateToWeek.get('2026-07-08')!;
    const a = assessMissedDays(week, {}, '2026-07-08', { flare: false })!;
    expect(TUNABLES.MISSED.RESUME_MAX_MISSED).toBe(2);
    expect(a.missed).toHaveLength(2);
    expect(a.kind).toBe('resume');
  });

  it('three missed days → re-entry guidance (never cramming)', () => {
    const { plan } = staticPlan({}, '2026-07-09'); // Mon–Wed missed
    const week = plan.dateToWeek.get('2026-07-09')!;
    const a = assessMissedDays(week, {}, '2026-07-09', { flare: false })!;
    expect(a.kind).toBe('reentry');
    expect(a.detail).toMatch(/re-enters next week/i);
    expect(a.detail).not.toMatch(/make.*up/i);
  });

  it('a missed day on a down week is reassurance, not work', () => {
    const { plan } = staticPlan({}, '2026-07-22'); // Wed of static W4 (down)
    const week = plan.dateToWeek.get('2026-07-22')!;
    expect(week.isDownWeek).toBe(true);
    const a = assessMissedDays(week, {}, '2026-07-22', { flare: false })!;
    expect(a.kind).toBe('downweek');
  });

  it('flare outranks everything: recovery first', () => {
    const { plan } = staticPlan({}, '2026-07-08');
    const week = plan.dateToWeek.get('2026-07-08')!;
    const a = assessMissedDays(week, {}, '2026-07-08', { flare: true })!;
    expect(a.kind).toBe('flare');
  });
});

// ── 2. The re-entry anchor ───────────────────────────────────

describe('missed-week re-entry anchor (resolveEffectivePlan)', () => {
  const TODAY = '2026-07-15'; // Wed of Week 3 (2026-07-13)

  function settings(patch: Partial<RawSettings> = {}): RawSettings {
    return {
      ...defaultSettings(NOW),
      startDate: '2026-06-29',
      startMpw: 20, peakMpw: 30, buildStep: 1.5,
      downEvery: 6, weeksShown: 7, daysPerWeek: 5, trailingLongest: 4.5,
      xcStartDate: '2027-06-28',
      ...patch,
    };
  }

  /** Week 1 completed exactly as prescribed (static 20 mi). */
  const W1_DONE: RunState = {
    '2026-06-29': run('2026-06-29', 4.0),
    '2026-06-30': run('2026-06-30', 4.0),
    '2026-07-01': run('2026-07-01', 4.0),
    '2026-07-02': run('2026-07-02', 3.5),
    '2026-07-03': run('2026-07-03', 4.5),
  };
  /** Week 2 completed fully (static 22 mi). */
  const W2_DONE: RunState = {
    '2026-07-06': run('2026-07-06', 4.5),
    '2026-07-07': run('2026-07-07', 4.5),
    '2026-07-08': run('2026-07-08', 4.0),
    '2026-07-09': run('2026-07-09', 4.0),
    '2026-07-10': run('2026-07-10', 5.0),
  };

  function firstFutureWeek(rs: RunState, patch: Partial<RawSettings> = {}) {
    const { plan } = resolveEffectivePlan(settings(patch), rs, TODAY);
    // W4 (2026-07-20) is the first unlocked week (W3 is current → locked).
    return plan.weeks.find(w => w.startDate === '2026-07-20')!;
  }

  it('baseline: full adherence → the build continues from the paper trajectory', () => {
    const w4 = firstFutureWeek({ ...W1_DONE, ...W2_DONE });
    // traj 25 (locked static W3) + buildStep 1.5 → 26.5.
    expect(w4.totalPlanned).toBeGreaterThan(25.5);
    expect(w4.isDownWeek).toBe(false);
  });

  it('a substantially missed completed week re-anchors the first future week', () => {
    // Week 2: one 4-mile run out of 22 prescribed (ratio ~0.18 < 0.6 trigger).
    const rs: RunState = { ...W1_DONE, '2026-07-06': run('2026-07-06', 4.0) };
    const w4 = firstFutureWeek(rs);
    const base = firstFutureWeek({ ...W1_DONE, ...W2_DONE });
    // Anchor: max(4 × 1.1, 25 × 0.8) = 20 → next build ≈ 22, well below the
    // paper resume (≈26.5) but far above a from-zero restart.
    expect(w4.totalPlanned).toBeLessThan(base.totalPlanned - 3);
    expect(w4.totalPlanned).toBeGreaterThanOrEqual(20 - 0.5);
    expect(w4.totalPlanned).toBeLessThanOrEqual(22 + 0.5);
  });

  it('a fully missed week re-anchors to the floor (80% of trajectory), not zero', () => {
    const w4 = firstFutureWeek({ ...W1_DONE }); // week 2 has no entries at all
    expect(w4.totalPlanned).toBeGreaterThanOrEqual(25 * TUNABLES.MISSED.REENTRY_FLOOR - 2.1);
    expect(w4.totalPlanned).toBeLessThan(25);
  });

  it('identity: ~80% completion is enough — no anchor at or above the trigger', () => {
    // Week 2: 18 of 22 (ratio 0.82).
    const rs: RunState = {
      ...W1_DONE,
      '2026-07-06': run('2026-07-06', 4.5),
      '2026-07-07': run('2026-07-07', 4.5),
      '2026-07-08': run('2026-07-08', 4.0),
      '2026-07-10': run('2026-07-10', 5.0),
    };
    const base = firstFutureWeek({ ...W1_DONE, ...W2_DONE });
    expect(firstFutureWeek(rs).totalPlanned).toBeCloseTo(base.totalPlanned, 5);
  });

  it('done-without-miles days are credited at their prescription (never read as 0)', () => {
    const rs: RunState = {
      ...W1_DONE,
      '2026-07-06': run('2026-07-06', null, { done: true }),
      '2026-07-07': run('2026-07-07', null, { done: true }),
      '2026-07-08': run('2026-07-08', null, { done: true }),
      '2026-07-09': run('2026-07-09', null, { done: true }),
      '2026-07-10': run('2026-07-10', null, { done: true }),
    };
    const base = firstFutureWeek({ ...W1_DONE, ...W2_DONE });
    expect(firstFutureWeek(rs).totalPlanned).toBeCloseTo(base.totalPlanned, 5);
  });

  it('an explicitly accepted first future week is respected untouched', () => {
    const rs: RunState = { ...W1_DONE, '2026-07-06': run('2026-07-06', 4.0) };
    const days: ProposedDay[] = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']
      .map((date, i) => ({
        date, dayLabel: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i],
        kind: i === 4 ? ('long' as const) : ('easy' as const), miles: 4, why: 'accepted',
      }));
    const { plan, weekSource } = resolveEffectivePlan(settings(), rs, TODAY, {
      acceptedWeeks: { '2026-07-20': days },
    });
    const w4 = plan.weeks.find(w => w.startDate === '2026-07-20')!;
    expect(weekSource.get('2026-07-20')).toBe('accepted');
    expect(w4.totalPlanned).toBeCloseTo(20, 5);
  });

  it('downward-only: the anchor never raises a week above the un-anchored plan', () => {
    const base = firstFutureWeek({ ...W1_DONE, ...W2_DONE });
    for (const partial of [2, 6, 10, 14, 18]) {
      const rs: RunState = { ...W1_DONE, '2026-07-06': run('2026-07-06', partial) };
      expect(firstFutureWeek(rs).totalPlanned).toBeLessThanOrEqual(base.totalPlanned + 1e-9);
    }
  });
});
