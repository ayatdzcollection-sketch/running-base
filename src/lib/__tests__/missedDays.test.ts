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
    expect(a.headline).toMatch(/skipping it costs nothing/i);
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
    expect(a.catchup ?? null).toBeNull();
  });
});

// ── 1b. The bounded Saturday catch-up ────────────────────────
// Static W2 (Jul 6–10): [4.5, 4.5, 4, 4, 5] — long Fri 5, largest easy 4.5,
// total 22, rest Sat 7/11 + Sun 7/12.

describe('saturday catch-up (bounded, opt-in)', () => {
  const staticPlan = (runState: RunState, today: string) =>
    resolveEffectivePlan(null, runState, today);
  const weekOf = (rs: RunState, today: string) =>
    staticPlan(rs, today).plan.dateToWeek.get('2026-07-08')!;

  it('one missed easy day → its miles on Saturday, nothing absorbed', () => {
    const rs: RunState = { '2026-07-06': run('2026-07-06', 4.5) }; // Mon logged; Tue 4.5 missed
    const a = assessMissedDays(weekOf(rs, '2026-07-08'), rs, '2026-07-08', {
      flare: false, breach: false, inSeason: false, nextLong: 5.5,
    })!;
    expect(a.catchup).toMatchObject({
      date: '2026-07-11', dayLabel: 'Sat', miles: 4.5, absorbed: 0, longRunSwap: false,
    });
    expect(a.catchup!.weekAfter).toBeCloseTo(22, 5);
  });

  it('two missed easy days → capped at the largest planned easy day, rest absorbed', () => {
    const a = assessMissedDays(weekOf({}, '2026-07-08'), {}, '2026-07-08', {
      flare: false, breach: false, inSeason: false, nextLong: 5.5,
    })!; // Mon 4.5 + Tue 4.5 missed = 9
    expect(a.catchup!.miles).toBeCloseTo(4.5, 5);      // never a mega-run
    expect(a.catchup!.absorbed).toBeCloseTo(4.5, 5);   // the cap is the feature
    expect(a.catchup!.weekAfter).toBeCloseTo(17.5, 5);
  });

  it('the Frandsen session ceiling binds below the easy-day cap', () => {
    const rs: RunState = { '2026-07-06': run('2026-07-06', 4.5) };
    const a = assessMissedDays(weekOf(rs, '2026-07-09'), rs, '2026-07-09', {
      flare: false, breach: false, inSeason: false, nextLong: 3.5,
    })!;
    expect(a.catchup!.miles).toBeCloseTo(3.5, 5);
  });

  it('a missed LONG run moves at its planned size — the endorsed swap', () => {
    const rs: RunState = {
      '2026-07-06': run('2026-07-06', 4.5), '2026-07-07': run('2026-07-07', 4.5),
      '2026-07-08': run('2026-07-08', 4), '2026-07-09': run('2026-07-09', 4),
    }; // Fri 7/10 long (5) missed; today is Saturday itself
    const a = assessMissedDays(weekOf(rs, '2026-07-11'), rs, '2026-07-11', {
      flare: false, breach: false, inSeason: false, nextLong: 5.5,
    })!;
    expect(a.catchup).toMatchObject({ date: '2026-07-11', miles: 5, longRunSwap: true });
  });

  it('long + easy missed → swap only, the easy miles stay absorbed', () => {
    const rs: RunState = {
      '2026-07-06': run('2026-07-06', 4.5), '2026-07-07': run('2026-07-07', 4.5),
      '2026-07-08': run('2026-07-08', 4),
    }; // Thu 4 + Fri long 5 missed
    const a = assessMissedDays(weekOf(rs, '2026-07-11'), rs, '2026-07-11', {
      flare: false, breach: false, inSeason: false, nextLong: 5.5,
    })!;
    expect(a.catchup!.miles).toBeCloseTo(5, 5);
    expect(a.catchup!.absorbed).toBeCloseTo(4, 5);
    expect(a.catchup!.longRunSwap).toBe(true);
  });

  it('3+ missed days → no catch-up (re-entry, never cramming)', () => {
    const a = assessMissedDays(weekOf({}, '2026-07-09'), {}, '2026-07-09', {
      flare: false, breach: false, inSeason: false, nextLong: 5.5,
    })!;
    expect(a.kind).toBe('reentry');
    expect(a.catchup ?? null).toBeNull();
  });

  it('a recent breach blocks the catch-up (recovery outranks mileage)', () => {
    const rs: RunState = { '2026-07-06': run('2026-07-06', 4.5) };
    const a = assessMissedDays(weekOf(rs, '2026-07-09'), rs, '2026-07-09', {
      flare: false, breach: true, inSeason: false, nextLong: 5.5,
    })!;
    expect(a.kind).toBe('resume');
    expect(a.catchup ?? null).toBeNull();
  });

  it('coach season blocks the catch-up (the coach owns the load)', () => {
    const rs: RunState = { '2026-07-06': run('2026-07-06', 4.5) };
    const a = assessMissedDays(weekOf(rs, '2026-07-09'), rs, '2026-07-09', {
      flare: false, breach: false, inSeason: true, nextLong: 5.5,
    })!;
    expect(a.catchup ?? null).toBeNull();
  });

  it('Sunday is never offered: once Saturday passes, the week closes', () => {
    const rs: RunState = { '2026-07-06': run('2026-07-06', 4.5) };
    const a = assessMissedDays(weekOf(rs, '2026-07-12'), rs, '2026-07-12', {
      flare: false, breach: false, inSeason: false, nextLong: 5.5,
    })!;
    expect(a.catchup ?? null).toBeNull();
  });

  it('an already-logged Saturday consumes the slot', () => {
    const rs: RunState = {
      '2026-07-06': run('2026-07-06', 4.5),
      '2026-07-11': run('2026-07-11', 3),
    };
    const a = assessMissedDays(weekOf(rs, '2026-07-09'), rs, '2026-07-09', {
      flare: false, breach: false, inSeason: false, nextLong: 5.5,
    })!;
    expect(a.catchup ?? null).toBeNull();
  });

  it('a remainder below MIN_SUGGEST is not worth a run', () => {
    const rs: RunState = { '2026-07-06': run('2026-07-06', 4.5) };
    const a = assessMissedDays(weekOf(rs, '2026-07-09'), rs, '2026-07-09', {
      flare: false, breach: false, inSeason: false, nextLong: 1.0,
    })!;
    expect(a.catchup ?? null).toBeNull();
  });

  it('a 6-run-day week has no free Saturday — Sunday stays sacred', () => {
    // startDate ≠ PLAN_START_DATE so the locked current week is engine-built
    // (6 run days), not the canonical 5-day static splice.
    const raw: RawSettings = {
      ...defaultSettings(NOW), startDate: '2026-06-22', daysPerWeek: 6,
      startMpw: 24, peakMpw: 30, trailingLongest: 5,
    };
    const rs: RunState = { '2026-07-06': run('2026-07-06', 4) }; // Tue missed
    const { plan } = resolveEffectivePlan(raw, rs, '2026-07-09');
    const week = plan.dateToWeek.get('2026-07-09')!;
    expect(week.runDays).toHaveLength(6);
    const a = assessMissedDays(week, rs, '2026-07-09', {
      flare: false, breach: false, inSeason: false, nextLong: 5.5,
    })!;
    expect(a.catchup ?? null).toBeNull();
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

  // ── The boundary: an ENGINE-built current week is anchored from its Monday ──
  // Non-canonical start (2026-06-22) → every week is engine-generated, so the
  // re-entry boundary is the current in-progress week itself, not the first
  // unlocked one. Grid: W1 6/22, W2 6/29 (badly missed), W3 7/6 (current).

  const RESEEDED: Partial<RawSettings> = { startDate: '2026-06-22' };
  /** W1 (6/22, 20 mi) fully done; W2 (6/29) = one 4-mile run. */
  const RESEEDED_RS: RunState = {
    '2026-06-22': run('2026-06-22', 4.0),
    '2026-06-23': run('2026-06-23', 4.0),
    '2026-06-24': run('2026-06-24', 4.0),
    '2026-06-25': run('2026-06-25', 3.5),
    '2026-06-26': run('2026-06-26', 4.5),
    '2026-06-29': run('2026-06-29', 4.0),
  };

  it('an engine-built current week takes the anchor on its own blank Monday', () => {
    const { plan } = resolveEffectivePlan(settings(RESEEDED), RESEEDED_RS, '2026-07-06');
    const w3 = plan.weeks.find(w => w.startDate === '2026-07-06')!;
    const { plan: basePlan } = resolveEffectivePlan(
      settings(RESEEDED),
      { ...RESEEDED_RS, '2026-06-30': run('2026-06-30', 5), '2026-07-01': run('2026-07-01', 5), '2026-07-02': run('2026-07-02', 8) },
      '2026-07-06',
    );
    const w3base = basePlan.weeks.find(w => w.startDate === '2026-07-06')!;
    // Anchored: re-enter near REENTRY_FLOOR of the trajectory instead of the
    // paper resume the fully-trained twin gets.
    expect(w3.totalPlanned).toBeLessThan(w3base.totalPlanned - 2);
    expect(w3.totalPlanned).toBeGreaterThanOrEqual(15);
  });

  it('the anchor holds steady mid-week: logging runs never shifts the current week', () => {
    const monday = resolveEffectivePlan(settings(RESEEDED), RESEEDED_RS, '2026-07-06')
      .plan.weeks.find(w => w.startDate === '2026-07-06')!;
    const midweek: RunState = { ...RESEEDED_RS, '2026-07-06': run('2026-07-06', 3.5) };
    const wednesday = resolveEffectivePlan(settings(RESEEDED), midweek, '2026-07-08')
      .plan.weeks.find(w => w.startDate === '2026-07-08' ? false : w.startDate === '2026-07-06')!;
    expect(wednesday.totalPlanned).toBeCloseTo(monday.totalPlanned, 5);
    expect(wednesday.longRunCap).toBeCloseTo(monday.longRunCap, 5);
  });

  it('every real cut is recorded so the UI can explain it (never silent)', () => {
    const { reentries } = resolveEffectivePlan(settings(RESEEDED), RESEEDED_RS, '2026-07-06');
    expect(reentries).toHaveLength(1);
    const r = reentries[0];
    expect(r.weekStart).toBe('2026-07-06');
    expect(r.judgedWeekStart).toBe('2026-06-29');
    expect(r.actual).toBeCloseTo(4, 5);
    expect(r.prescribed).toBeGreaterThan(20);
    expect(r.to).toBeLessThan(r.from);
    expect(r.maintain).toBe(false);
  });

  it('identity: full adherence emits no re-entry records', () => {
    const { reentries } = resolveEffectivePlan(settings(), { ...W1_DONE, ...W2_DONE }, TODAY);
    expect(reentries).toHaveLength(0);
  });

  it('season-entry after a short week: eased re-entry, flagged maintain, never silent', () => {
    // The reported scenario: last build week badly missed, coach season starts
    // the next Monday. The first season week re-enters reduced — anchored off
    // max(actual×1.1, 0.8×traj) plus one governed rebuild step — never the
    // full paper hold, and never without a record.
    const { plan, reentries } = resolveEffectivePlan(
      settings({ ...RESEEDED, xcStartDate: '2026-07-06' }), RESEEDED_RS, '2026-07-06',
    );
    const w3 = plan.weeks.find(w => w.startDate === '2026-07-06')!;
    expect(w3.note).toBe('maintain');
    // traj 22 → anchored 17.6 → first rebuild step +1.5 → ≈ 19, well below 22.
    expect(w3.totalPlanned).toBeGreaterThanOrEqual(17.5);
    expect(w3.totalPlanned).toBeLessThanOrEqual(19.5);
    expect(reentries).toHaveLength(1);
    expect(reentries[0].maintain).toBe(true);
  });

  it('season weeks CLIMB back to the pre-cut hold (≤ +10%/wk), then hold — never past it', () => {
    // "I want it to hold at 32 and I'll build to that over the season": the cut
    // is a starting point, not the season's ceiling. Here the hold is 22 (the
    // pre-cut trajectory); anchored re-entry 17.6 → ~19 → ~20.5 → 22 → 22 flat.
    const { plan } = resolveEffectivePlan(
      settings({ ...RESEEDED, xcStartDate: '2026-07-06', weeksShown: 10 }), RESEEDED_RS, '2026-07-06',
    );
    const season = plan.weeks.filter(w => w.startDate >= '2026-07-06' && w.note === 'maintain');
    expect(season.length).toBeGreaterThanOrEqual(4);
    const totals = season.map(w => w.totalPlanned);
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1] - 1e-9);        // monotonic recovery
      expect(totals[i]).toBeLessThanOrEqual(totals[i - 1] * 1.1 + 0.5 + 1e-9); // governed rate
      expect(totals[i]).toBeLessThanOrEqual(22 + 0.5);                        // hold is the ceiling
    }
    // It actually gets back to the hold and stays there.
    expect(totals[totals.length - 1]).toBeGreaterThanOrEqual(21.5);
    expect(totals[totals.length - 2]).toBeGreaterThanOrEqual(21.5);
  });

  it('once the anchored week completes, the next boundary judges IT, not the old miss', () => {
    // Run the anchored W3 fully at its (reduced) prescription → the following
    // Monday, W4 builds off the anchored trajectory with no fresh anchor.
    const { plan } = resolveEffectivePlan(settings(RESEEDED), RESEEDED_RS, '2026-07-06');
    const w3 = plan.weeks.find(w => w.startDate === '2026-07-06')!;
    const rs: RunState = { ...RESEEDED_RS };
    for (const d of w3.runDays) rs[d.date] = run(d.date, d.prescribed ?? 0);
    const { plan: nextWeekPlan } = resolveEffectivePlan(settings(RESEEDED), rs, '2026-07-13');
    const w4 = nextWeekPlan.weeks.find(w => w.startDate === '2026-07-13')!;
    // A build step up from the anchored level — recovery, not a second cut.
    expect(w4.totalPlanned).toBeGreaterThan(w3.totalPlanned);
    expect(w4.totalPlanned).toBeLessThan(w3.totalPlanned * 1.1 + 0.5 + 1e-9);
  });
});
