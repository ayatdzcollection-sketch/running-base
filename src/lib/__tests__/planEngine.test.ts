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
  return raw({ startMpw: 20, peakMpw: 30, buildStep: 1, downEvery: 4, blockWeeks: 7, trailingLongest: 4.5, ...patch });
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
    const a = resolveEffectivePlan(scenarioSettings({ peakMpw: 30 }), scenarioLog(), TODAY).plan.weeks;
    const b = resolveEffectivePlan(scenarioSettings({ peakMpw: 40 }), scenarioLog(), TODAY).plan.weeks;
    expect(totals(a).slice(0, 2)).toEqual(totals(b).slice(0, 2));          // W1+W2 identical
    expect(totals(a).slice(2)).not.toEqual(totals(b).slice(2));            // W3+ changed
  });

  it('never mutates runState (no logged run deleted or rewritten), even on full reset', () => {
    const log = scenarioLog();
    const before = JSON.stringify(log);
    resolveEffectivePlan(scenarioSettings({ peakMpw: 40, blockWeeks: 10, daysPerWeek: 4 }), log, TODAY);
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

// ── 4. Editing Peak re-solves the future toward the target ───

describe('editing Peak week regenerates future weeks intelligently', () => {
  it('the plan climbs toward the peak and hands off near it (peak 30 → handoff ≥ 27)', () => {
    const weeks = resolveEffectivePlan(scenarioSettings({ peakMpw: 30 }), scenarioLog(), TODAY).plan.weeks;
    const maxFuture = Math.max(...futureWeeks(weeks).map(w => w.totalPlanned));
    expect(maxFuture).toBeGreaterThanOrEqual(27);       // actually reaches near the peak
    expect(maxFuture).toBeLessThanOrEqual(30 + 1e-9);   // never exceeds it
    expect(weeks[weeks.length - 1].totalPlanned).toBeGreaterThanOrEqual(27); // handoff near peak
  });

  it('raising the peak raises the late-week targets; lowering it lowers them', () => {
    const low = resolveEffectivePlan(scenarioSettings({ peakMpw: 25 }), scenarioLog(), TODAY).plan.weeks;
    const mid = resolveEffectivePlan(scenarioSettings({ peakMpw: 30 }), scenarioLog(), TODAY).plan.weeks;
    const high = resolveEffectivePlan(scenarioSettings({ peakMpw: 40 }), scenarioLog(), TODAY).plan.weeks;
    const handoff = (ws: PlanWeek[]) => ws[ws.length - 1].totalPlanned;
    expect(handoff(low)).toBeLessThan(handoff(mid));
    expect(handoff(mid)).toBeLessThan(handoff(high));
  });

  it('no week ever exceeds the peak ceiling', () => {
    for (const peak of [22, 25, 30, 40]) {
      const weeks = resolveEffectivePlan(scenarioSettings({ peakMpw: peak }), scenarioLog(), TODAY).plan.weeks;
      for (const w of futureWeeks(weeks)) expect(w.totalPlanned).toBeLessThanOrEqual(peak + 1e-9);
    }
  });
});

// ── 5. No unconfigured Week-7 collapse ───────────────────────

describe('the final week is a handoff, not a collapse', () => {
  it('the last week is not a taper and is near the peak, not cut to a fraction of it', () => {
    const { plan } = resolveEffectivePlan(scenarioSettings(), scenarioLog(), TODAY);
    const last = plan.weeks[plan.weeks.length - 1];
    expect(last.note).not.toBe('taper');
    expect(last.isDownWeek).toBe(false);
    expect(last.totalPlanned).toBeGreaterThan(20); // nowhere near the old ~12 collapse
    // The handoff is the largest (or tied) future week, not the smallest.
    const maxFuture = Math.max(...futureWeeks(plan.weeks).map(w => w.totalPlanned));
    expect(last.totalPlanned).toBeGreaterThanOrEqual(maxFuture - 1e-9);
  });
});

// ── 6. End-to-end acceptance: the directional shape ──────────

describe('acceptance scenario — directionally sane progression', () => {
  it('builds up, dips once for a down week, resumes, and hands off near peak (never collapses)', () => {
    const { plan } = resolveEffectivePlan(scenarioSettings(), scenarioLog(), TODAY);
    const t = totals(plan.weeks);
    // [~20, ~22, ~24, ~20.5(down), ~26, ~28, ~29.5(handoff)] — assert the SHAPE.
    expect(t[0]).toBeCloseTo(20, 0);         // locked completed week
    expect(t[2]).toBeGreaterThan(t[1]);      // W3 builds over W2
    expect(t[3]).toBeLessThan(t[2]);         // W4 down week dips
    expect(t[4]).toBeGreaterThan(t[3]);      // W5 resumes upward
    expect(t[4]).toBeGreaterThan(t[1]);      // ...above the pre-down level
    expect(t[5]).toBeGreaterThanOrEqual(t[4]); // W6 keeps building
    expect(t[6]).toBeGreaterThanOrEqual(27); // W7 hands off near peak 30
    // Exactly one scheduled down week across the 7-week block.
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
// must not collapse at Week 7 either — a summer base block has no race, so the
// final week hands off at the peak rather than tapering.

describe('static fallback plan (no settings) builds and hands off, never tapers', () => {
  it('the final static week is a handoff near the peak, not a taper/down collapse', () => {
    const weeks = resolveEffectivePlan(null, scenarioLog(), TODAY).plan.weeks;
    const last = weeks[weeks.length - 1];
    expect(last.note).toBe('handoff');
    expect(last.note).not.toBe('taper');
    expect(last.isDownWeek).toBe(false);
    // Handoff is the largest (or tied-largest) week, not a fraction of the peak.
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
