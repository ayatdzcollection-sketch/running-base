// ============================================================
// PLAN ENGINE — progression / regeneration behavior.
//
// Guards the base-block scaffold (resolveEffectivePlan → stepWeek) against the
// four regressions that produced the collapsing plan
// (20 → 22 → 22.5 → 16.5 → 17 → 17.5 → 12):
//   1. completed weeks stay locked; logged runs are never mutated
//   2. season goal / "safe plan delivers" never cap future weekly targets
//   3. the week after a down week resumes the BUILD trajectory (not the dip)
//   4. editing Peak week re-solves the future toward that target
//   5. the final week is a handoff near the peak, never a forced taper collapse
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveEffectivePlan, planTotalMiles } from '../planOverlay';
import { defaultSettings } from '../settings';
import type { RawSettings, RunState, PlanWeek } from '../types';

const NOW = '2026-07-08T12:00:00Z';
const TODAY = '2026-07-08'; // Wednesday of Week 2 — the real current scenario.

function raw(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), ...patch };
}

/** The real user scenario: Week 1 completed at 20.2, Week 2 in progress. */
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

/** Base-scenario settings: start 20, peak 30, +1 nominal step, down every 4. */
function scenarioSettings(patch: Partial<RawSettings> = {}): RawSettings {
  return raw({ startMpw: 20, peakMpw: 30, buildStep: 1, downEvery: 4, weeksShown: 7, trailingLongest: 4.5, ...patch });
}

function totals(weeks: PlanWeek[]): number[] {
  return weeks.map(w => w.totalPlanned);
}
function futureWeeks(weeks: PlanWeek[]): PlanWeek[] {
  return weeks.filter(w => w.startDate >= '2026-07-13'); // W3 onward (unlocked)
}

// ── 1. Completed weeks locked, logged runs preserved ─────────

describe('completed weeks stay locked and logged runs are preserved', () => {
  it('keeps W1 and W2 on their original prescription regardless of settings', () => {
    const staticFirstTwo = totals(resolveEffectivePlan(null, scenarioLog(), TODAY).plan.weeks).slice(0, 2);
    const { plan, weekSource } = resolveEffectivePlan(scenarioSettings({ peakMpw: 45 }), scenarioLog(), TODAY);
    expect(totals(plan.weeks).slice(0, 2)).toEqual(staticFirstTwo);       // unchanged by a big peak edit
    expect(weekSource.get('2026-06-29')).toBe('static');                   // W1 locked
    expect(weekSource.get('2026-07-06')).toBe('static');                   // W2 (current) locked
  });

  it('editing the peak only rewrites FUTURE unlocked weeks', () => {
    // A high buildStep + a long horizon so peak actually matters in the window.
    const a = resolveEffectivePlan(scenarioSettings({ peakMpw: 30, buildStep: 3, weeksShown: 12, xcStartDate: '2027-01-01' }), scenarioLog(), TODAY).plan.weeks;
    const b = resolveEffectivePlan(scenarioSettings({ peakMpw: 40, buildStep: 3, weeksShown: 12, xcStartDate: '2027-01-01' }), scenarioLog(), TODAY).plan.weeks;
    expect(totals(a).slice(0, 2)).toEqual(totals(b).slice(0, 2));          // W1+W2 identical (locked)
    expect(totals(a).slice(2)).not.toEqual(totals(b).slice(2));            // W3+ changed
  });

  it('never mutates runState (no logged run deleted or rewritten), even on full reset', () => {
    const log = scenarioLog();
    const before = JSON.stringify(log);
    resolveEffectivePlan(scenarioSettings({ peakMpw: 40, weeksShown: 10, daysPerWeek: 4 }), log, TODAY);
    resolveEffectivePlan(scenarioSettings(), log, TODAY, { fullReset: true });
    expect(JSON.stringify(log)).toBe(before);
  });
});

// ── 2. Season goal / "safe plan delivers" are display-only ───

describe('season goal and safe-plan-delivers never cap future weekly targets', () => {
  it('lowering goalMiles / safeDelivery leaves every weekly target unchanged', () => {
    const generous = resolveEffectivePlan(scenarioSettings({ goalMiles: 300, safeDelivery: 300 }), scenarioLog(), TODAY).plan.weeks;
    const stingy = resolveEffectivePlan(scenarioSettings({ goalMiles: 100, safeDelivery: 60 }), scenarioLog(), TODAY).plan.weeks;
    expect(totals(stingy)).toEqual(totals(generous)); // safe/goal do not shrink weeks
  });

  it('the block total is free to exceed "safe plan delivers" (it is a forecast, not a cap)', () => {
    const { plan } = resolveEffectivePlan(scenarioSettings({ safeDelivery: 120 }), scenarioLog(), TODAY);
    expect(planTotalMiles(plan)).toBeGreaterThan(120); // ~20+22+24+18.5+26+28+29.5 ≈ 168
  });
});

// ── 3. Down week is temporary absorption; the build resumes ──

describe('post-down-week progression resumes upward from the trajectory', () => {
  it('the week after the down week is higher than the down week AND at/above the pre-down build', () => {
    const { plan } = resolveEffectivePlan(scenarioSettings(), scenarioLog(), TODAY);
    const weeks = plan.weeks;
    const downIdx = weeks.findIndex(w => w.isDownWeek);
    expect(downIdx).toBeGreaterThan(0);
    const before = weeks[downIdx - 1].totalPlanned;
    const down = weeks[downIdx].totalPlanned;
    const after = weeks[downIdx + 1].totalPlanned;
    expect(down).toBeLessThan(before);            // it really is a dip
    expect(after).toBeGreaterThan(down);          // ...that we climb back out of
    expect(after).toBeGreaterThanOrEqual(before); // resuming the trajectory, not the dip
  });

  it('the down week sits at the UPPER end of the 75–85% deload band (nudged up: a light absorption week, not a collapse)', () => {
    const { plan } = resolveEffectivePlan(scenarioSettings(), scenarioLog(), TODAY);
    const weeks = plan.weeks;
    const downIdx = weeks.findIndex(w => w.isDownWeek);
    const ratio = weeks[downIdx].totalPlanned / weeks[downIdx - 1].totalPlanned;
    // SCHEDULED_DOWN_CUT is 0.15 → ~85%. Guard the whole band, and specifically
    // that the down week was nudged UP into its upper half (> 0.8), so a future
    // deepening of the cut can't silently slip back to the old ~77% dip.
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThanOrEqual(0.9);
  });

  it('future build weeks respect the +10%/week ceiling vs the last BUILD week', () => {
    const weeks = resolveEffectivePlan(scenarioSettings(), scenarioLog(), TODAY).plan.weeks;
    let lastBuild = weeks[0].totalPlanned;
    for (let i = 1; i < weeks.length; i++) {
      if (weeks[i].isDownWeek) continue;
      expect(weeks[i].totalPlanned).toBeLessThanOrEqual(lastBuild * 1.1 + 0.5);
      lastBuild = weeks[i].totalPlanned;
    }
  });
});

// ── 4. Editing Peak is a ceiling in the rolling model ───────

describe('Peak week acts as a rolling ceiling, not a block-compressing target', () => {
  it('the plan climbs toward the peak at the buildStep rate and never exceeds it', () => {
    // buildStep=1 mi/wk + a down week means peak≈30 is reached ~week 10, not
    // by week 7. The visible window shows the honest climb.
    const weeks = resolveEffectivePlan(scenarioSettings({ peakMpw: 30 }), scenarioLog(), TODAY).plan.weeks;
    for (const w of futureWeeks(weeks)) expect(w.totalPlanned).toBeLessThanOrEqual(30 + 1e-9);
    // The future is monotonically non-decreasing on build weeks — no collapse.
    const buildTotals = futureWeeks(weeks).filter(w => !w.isDownWeek).map(w => w.totalPlanned);
    for (let i = 1; i < buildTotals.length; i++) expect(buildTotals[i]).toBeGreaterThanOrEqual(buildTotals[i - 1] - 1e-9);
  });

  it('over a long enough horizon, the plan reaches peakMpw and holds it (rolling)', () => {
    // Aggressive buildStep + XC out of the way so the plan hits peak.
    const weeks = resolveEffectivePlan(
      scenarioSettings({ peakMpw: 30, buildStep: 2, weeksShown: 20, xcStartDate: '2027-01-01' }),
      scenarioLog(), TODAY,
    ).plan.weeks;
    const maxTotal = Math.max(...weeks.map(w => w.totalPlanned));
    expect(maxTotal).toBeCloseTo(30, 0);
  });

  it('raising the peak allows higher terminal targets; lowering caps sooner', () => {
    // Push XC out so both plans build freely; use buildStep=2 so both reach.
    const long = { weeksShown: 20, buildStep: 2, xcStartDate: '2027-01-01' };
    const low = resolveEffectivePlan(scenarioSettings({ ...long, peakMpw: 25 }), scenarioLog(), TODAY).plan.weeks;
    const high = resolveEffectivePlan(scenarioSettings({ ...long, peakMpw: 40 }), scenarioLog(), TODAY).plan.weeks;
    const maxOf = (ws: PlanWeek[]) => Math.max(...ws.map(w => w.totalPlanned));
    expect(maxOf(high)).toBeGreaterThan(maxOf(low));
    expect(maxOf(low)).toBeLessThanOrEqual(25 + 1e-9);
    expect(maxOf(high)).toBeLessThanOrEqual(40 + 1e-9);
  });

  it('no week ever exceeds the peak ceiling', () => {
    for (const peak of [22, 25, 30, 40]) {
      const weeks = resolveEffectivePlan(
        scenarioSettings({ peakMpw: peak, weeksShown: 20, xcStartDate: '2027-01-01' }),
        scenarioLog(), TODAY,
      ).plan.weeks;
      for (const w of futureWeeks(weeks)) expect(w.totalPlanned).toBeLessThanOrEqual(peak + 1e-9);
    }
  });
});

// ── 5. The last visible week is NOT a special case (rolling) ─

describe('the last visible week is an ordinary week, not a forced taper/handoff', () => {
  it('the last week carries no stale block-boundary note', () => {
    const { plan } = resolveEffectivePlan(scenarioSettings(), scenarioLog(), TODAY);
    const last = plan.weeks[plan.weeks.length - 1];
    expect(last.note).not.toBe('taper');
    expect(last.note).not.toBe('handoff');
    // It just extends the trajectory — nowhere near a collapse.
    expect(last.totalPlanned).toBeGreaterThan(20);
  });

  it('changing the planning window does not change the training logic — only the horizon', () => {
    // The first N weeks of a longer window are identical to the whole shorter window.
    const short = resolveEffectivePlan(scenarioSettings({ weeksShown: 7 }), scenarioLog(), TODAY).plan.weeks;
    const long = resolveEffectivePlan(scenarioSettings({ weeksShown: 12 }), scenarioLog(), TODAY).plan.weeks;
    expect(long.length).toBe(12);
    expect(short.length).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(long[i].totalPlanned).toBeCloseTo(short[i].totalPlanned, 5);
      expect(long[i].longRunCap).toBeCloseTo(short[i].longRunCap, 5);
      expect(long[i].isDownWeek).toBe(short[i].isDownWeek);
    }
  });
});

// ── 6. End-to-end acceptance: the directional shape ──────────

describe('acceptance scenario — directionally sane progression', () => {
  it('builds up, dips once for a down week, resumes upward — no collapse (rolling plan)', () => {
    const { plan } = resolveEffectivePlan(scenarioSettings(), scenarioLog(), TODAY);
    const t = totals(plan.weeks);
    // Rolling model with buildStep=1: ~[20, 22, 24, 20.5(down), 25, 26, 27].
    // Peak (30) is a ceiling — reached later in the rolling plan, not compressed.
    expect(t[0]).toBeCloseTo(20, 0);         // locked completed week
    expect(t[2]).toBeGreaterThan(t[1]);      // W3 builds over W2
    expect(t[3]).toBeLessThan(t[2]);         // W4 down week dips
    expect(t[4]).toBeGreaterThan(t[3]);      // W5 resumes upward
    expect(t[4]).toBeGreaterThan(t[1]);      // ...above the pre-down level
    expect(t[5]).toBeGreaterThanOrEqual(t[4]); // W6 keeps building
    expect(t[6]).toBeGreaterThanOrEqual(t[5] - 1e-9); // W7 keeps building (or holds)
    // Exactly one scheduled down week inside the 7-week window (rolling cadence).
    expect(plan.weeks.filter(w => w.isDownWeek).length).toBe(1);
  });
});

// ── 6b. Hip/pain state never suppresses the base mileage plan ──
// The displayed plan is settings-driven only; pain/hip context gates SPEED
// separately (generator/todaySpeed), it must not shrink easy aerobic volume.

describe('base mileage is independent of logged hip/pain state', () => {
  it('adding painful (over-cap) subjective fields to the completed weeks leaves every future target unchanged', () => {
    const clean = scenarioLog();
    const painful: RunState = {};
    for (const [k, v] of Object.entries(clean)) {
      painful[k] = { ...v, painDuring: 8, painNextAM: 7 }; // way over any cap
    }
    const a = totals(resolveEffectivePlan(scenarioSettings(), clean, TODAY).plan.weeks);
    const b = totals(resolveEffectivePlan(scenarioSettings(), painful, TODAY).plan.weeks);
    expect(b).toEqual(a); // easy mileage keeps building; only speed is gated elsewhere
  });
});

// ── 7. The no-settings STATIC fallback obeys the same philosophy ──
// A user who never opens Settings sees WEEK_CONFIGS directly. That scaffold
// must not collapse at Week 7 either — the rolling model has no forced final
// taper or handoff, so the last week is just a normal peak-hold week.

describe('static fallback plan (no settings) builds and holds, never tapers', () => {
  it('the final static week is a normal peak-level week — not a taper, not a forced handoff', () => {
    const weeks = resolveEffectivePlan(null, scenarioLog(), TODAY).plan.weeks;
    const last = weeks[weeks.length - 1];
    expect(last.note).not.toBe('taper');
    expect(last.note).not.toBe('handoff');
    expect(last.isDownWeek).toBe(false);
    // Still at (or above) the largest total in the window — no collapse.
    const maxTotal = Math.max(...weeks.map(w => w.totalPlanned));
    expect(last.totalPlanned).toBeGreaterThanOrEqual(maxTotal - 1e-9);
  });

  it('the static plan has exactly one down week, in the upper 75–85% deload band', () => {
    const weeks = resolveEffectivePlan(null, scenarioLog(), TODAY).plan.weeks;
    const downs = weeks.filter(w => w.isDownWeek);
    expect(downs.length).toBe(1);                 // W4 only — no second taper collapse
    const downIdx = weeks.findIndex(w => w.isDownWeek);
    const ratio = weeks[downIdx].totalPlanned / weeks[downIdx - 1].totalPlanned;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThanOrEqual(0.9);
  });

  it('static totals climb, dip once, resume, and finish at the peak', () => {
    const t = totals(resolveEffectivePlan(null, scenarioLog(), TODAY).plan.weeks);
    // [20, 22, 25, 21(down), 27, 30(peak), 30(handoff)]
    expect(t[2]).toBeGreaterThan(t[1]);        // builds
    expect(t[3]).toBeLessThan(t[2]);           // down week dips
    expect(t[4]).toBeGreaterThan(t[3]);        // resumes upward
    expect(t[4]).toBeGreaterThan(t[1]);        // above the pre-down level
    expect(t[6]).toBeGreaterThanOrEqual(t[5] - 1e-9); // finishes at/above the peak week
  });
});
