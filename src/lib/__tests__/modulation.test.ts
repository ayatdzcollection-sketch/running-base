// ============================================================
// ADAPTIVE MODULATION HOOK (pre-Phase-2A).
//
// The displayed rolling plan now ACCEPTS an optional AdaptiveModulation, but the
// app still passes none — so behavior is unchanged today. These tests pin the
// contract Phase 2A will build on:
//   • identity (no mod / factor 1) is byte-identical to the current plan
//   • a factor < 1 only ever SLOWS the build (never a larger week)
//   • locked/completed weeks are never modulated
//   • no safety floor is loosened (peak ceiling, +10%/wk, long-run ladder)
//   • weeksShown stays display-only even with modulation
//   • the feasibility diagnostic stays consistent (identity today)
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildWeekConfigsFromSettings, defaultSettings } from '../settings';
import { resolveEffectivePlan } from '../planOverlay';
import { assessPeakFeasibility, type PeakFeasibility } from '../feasibility';
import { nextLongFrom } from '../metrics';
import { TUNABLES } from '../../config/tunables';
import type { AdaptiveModulation } from '../adaptive';
import type { RawSettings, RunState } from '../types';
import type { WeekConfig } from '../../config/plan';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07';

function effFrom(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), startMpw: 20, peakMpw: 40, buildStep: 2, downEvery: 4, weeksShown: 12, trailingLongest: 4.5, ...patch };
}
const total = (c: WeekConfig) => c.miles.reduce((a, b) => a + b, 0);
const long = (c: WeekConfig) => c.miles[c.miles.length - 1];

// A run log that locks Week 1 (complete) and Week 2 (Monday logged).
const LOG: RunState = {
  '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.0, updated_at: NOW },
  '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: NOW },
  '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: NOW },
  '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.5, updated_at: NOW },
  '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW },
  '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: NOW },
};

describe('AdaptiveModulation — identity (Phase-2A hook, no behavior change today)', () => {
  const base = effFrom();
  const plain = buildWeekConfigsFromSettings(base);

  it('factor 1.0 (null modulation) is byte-identical to the current plan', () => {
    expect(buildWeekConfigsFromSettings(base, undefined, null)).toEqual(plain);
  });

  it('an explicit identity mod (factor 1, downEvery = setting) is byte-identical', () => {
    const identity: AdaptiveModulation = { growthFactor: 1, downEvery: base.downEvery };
    expect(buildWeekConfigsFromSettings(base, undefined, identity)).toEqual(plain);
  });

  it('a loose downEvery (≥ the setting) cannot slow the cadence — identity', () => {
    const loose: AdaptiveModulation = { growthFactor: 1, downEvery: 99 };
    expect(buildWeekConfigsFromSettings(base, undefined, loose)).toEqual(plain);
  });

  it('resolveEffectivePlan without modulation is unchanged (the app default)', () => {
    const a = resolveEffectivePlan(base, LOG, TODAY);
    const b = resolveEffectivePlan(base, LOG, TODAY, { modulation: { growthFactor: 1, downEvery: base.downEvery } });
    expect(b.plan.weeks.map(w => w.totalPlanned)).toEqual(a.plan.weeks.map(w => w.totalPlanned));
  });
});

describe('AdaptiveModulation — a factor < 1 only ever slows the build', () => {
  const base = effFrom();
  const plain = buildWeekConfigsFromSettings(base);
  const eased = buildWeekConfigsFromSettings(base, undefined, { growthFactor: 0.5, downEvery: base.downEvery });

  it('never produces a larger week than identity, week by week', () => {
    expect(eased).toHaveLength(plain.length);
    for (let i = 0; i < plain.length; i++) {
      expect(total(eased[i])).toBeLessThanOrEqual(total(plain[i]) + 1e-9);
    }
  });

  it('never exceeds the peak ceiling', () => {
    for (const c of eased) expect(total(c)).toBeLessThanOrEqual(base.peakMpw + 0.5 + 1e-9);
  });

  it('never breaks the +10%/week growth cap (measured vs the last BUILD week)', () => {
    let lastBuild = total(eased[0]);
    for (let i = 1; i < eased.length; i++) {
      if (eased[i].isDownWeek) continue;
      expect(total(eased[i])).toBeLessThanOrEqual(lastBuild * TUNABLES.WEEKLY_GROWTH_MAX + 0.5 + 1e-9);
      lastBuild = total(eased[i]);
    }
  });

  it('does not loosen the long-run cap — the ladder is unchanged and still ≤110%/step', () => {
    // growthFactor scales weekly VOLUME only; the long-run ladder is identical to
    // identity and still obeys nextLongFrom.
    for (let i = 0; i < eased.length; i++) expect(long(eased[i])).toBe(long(plain[i]));
    let prev = base.trailingLongest;
    for (const c of eased) {
      expect(long(c)).toBeLessThanOrEqual(nextLongFrom(prev) + 1e-9);
      if (!c.isDownWeek) prev = long(c);
    }
  });

  it('is monotonic in the factor — smaller factor, never-larger weeks', () => {
    const f7 = buildWeekConfigsFromSettings(base, undefined, { growthFactor: 0.7, downEvery: base.downEvery });
    const f4 = buildWeekConfigsFromSettings(base, undefined, { growthFactor: 0.4, downEvery: base.downEvery });
    for (let i = 0; i < base.weeksShown; i++) {
      expect(total(f4[i])).toBeLessThanOrEqual(total(f7[i]) + 1e-9);
    }
  });
});

describe('AdaptiveModulation — locked weeks are never modulated', () => {
  const base = effFrom();
  it('a factor < 1 leaves locked (completed/current) weeks identical', () => {
    const plain = resolveEffectivePlan(base, LOG, TODAY);
    const eased = resolveEffectivePlan(base, LOG, TODAY, { modulation: { growthFactor: 0.4, downEvery: base.downEvery } });
    for (const ws of ['2026-06-29', '2026-07-06']) { // locked W1 & W2
      const a = plain.plan.weeks.find(w => w.startDate === ws)!;
      const b = eased.plan.weeks.find(w => w.startDate === ws)!;
      expect(b.totalPlanned).toBe(a.totalPlanned);
      expect(b.runDays.map(d => d.prescribed)).toEqual(a.runDays.map(d => d.prescribed));
    }
  });

  it('but future unlocked weeks are eased (≤ identity)', () => {
    const plain = resolveEffectivePlan(base, LOG, TODAY);
    const eased = resolveEffectivePlan(base, LOG, TODAY, { modulation: { growthFactor: 0.4, downEvery: base.downEvery } });
    const fut = '2026-07-20'; // W4, unlocked
    const a = plain.plan.weeks.find(w => w.startDate === fut)!;
    const b = eased.plan.weeks.find(w => w.startDate === fut)!;
    expect(b.totalPlanned).toBeLessThanOrEqual(a.totalPlanned + 1e-9);
  });
});

describe('AdaptiveModulation — down-week cadence may only tighten', () => {
  const base = effFrom({ downEvery: 4, weeksShown: 12 });
  const countDowns = (cfgs: WeekConfig[]) => cfgs.filter(c => c.isDownWeek).length;

  it('a tighter downEvery inserts at least as many absorption weeks', () => {
    const plain = buildWeekConfigsFromSettings(base);
    const tight = buildWeekConfigsFromSettings(base, undefined, { growthFactor: 1, downEvery: 3 });
    expect(countDowns(tight)).toBeGreaterThanOrEqual(countDowns(plain));
  });
});

describe('AdaptiveModulation — weeksShown stays display-only under modulation', () => {
  const base = effFrom({ weeksShown: 7 });
  const mod: AdaptiveModulation = { growthFactor: 0.6, downEvery: base.downEvery };

  it('the first N weeks are identical whether the window is 7 or 20', () => {
    const short = buildWeekConfigsFromSettings(base, 7, mod);
    const long20 = buildWeekConfigsFromSettings(base, 20, mod);
    for (let i = 0; i < 7; i++) expect(long20[i]).toEqual(short[i]);
  });
});

describe('AdaptiveModulation — feasibility diagnostic stays consistent', () => {
  const base = effFrom({ startMpw: 12, peakMpw: 45, buildStep: 2, xcStartDate: '2026-10-19' });

  it('an identity mod does not change the assessment', () => {
    const a = assessPeakFeasibility(base);
    const b = assessPeakFeasibility(base, { growthFactor: 1, downEvery: base.downEvery });
    const strip = (f: PeakFeasibility) => ({ ...f, reasons: f.reasons.length, suggestions: f.suggestions.length });
    expect(strip(b)).toEqual(strip(a));
  });

  it('easing the build never RAISES what the plan reaches (reachedByPlan) and never RAISES the safety ceiling', () => {
    const plain = assessPeakFeasibility(base);
    const eased = assessPeakFeasibility(base, { growthFactor: 0.5, downEvery: base.downEvery });
    expect(eased.reachedByPlan).toBeLessThanOrEqual(plain.reachedByPlan + 1e-9);
    // maxSafeReachable is the UNMODULATED population ceiling — unchanged by easing.
    expect(eased.maxSafeReachable).toBe(plain.maxSafeReachable);
  });
});
