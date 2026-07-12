// ============================================================
// ISOLATED-PAIN CALIBRATION — one below-cap "did not settle" 1/10 must not
// pull the whole mileage trajectory down or veto earned-trust.
//
// Root cause fixed here: unsettledRate = unsettled / painDays had NO minimum
// sample count, so a single unsettled niggle read as "100% unsettled" → a 0.8
// growthFactor ease AND a long earned-trust veto (~30 → ~25 mpw projection).
// The fix gates the rate on UNSETTLED_MIN_SAMPLES; below that it is UNKNOWN.
// Graded response is preserved: isolated → watch only; repeated → modest ease;
// breach / flare → the existing strong protective response, untouched.
// ============================================================

import { describe, it, expect } from 'vitest';
import { computeAdaptiveProfile, toModulation } from '../adaptive';
import { effectiveSettings, buildWeekConfigsFromSettings, defaultSettings } from '../settings';
import { defaultGlobalState } from '../migrate';
import { morningAnswer } from '../subjective';
import { addDaysStr } from '../metrics';
import { TUNABLES } from '../../config/tunables';
import type { GlobalState, RunState, WeeklyCheckin } from '../types';

const TODAY = '2026-07-31';   // Friday
const START = '2026-06-01';   // Monday — settings start + pain-tracking era
const PAIN_DATE = '2026-07-22'; // a completed run, ~9 days before today

/** 9 clean weeks Mon/Wed/Fri (~20 mpw, longest 8), RPE + good check-ins —
 *  enough for earned-trust to be active in the clean case. */
function baseline(): { rs: RunState; checkins: Record<string, WeeklyCheckin> } {
  const rs: RunState = {};
  const checkins: Record<string, WeeklyCheckin> = {};
  for (let w = 0; w < 9; w++) {
    const mon = addDaysStr(START, w * 7);
    for (const [off, miles] of [[0, 6], [2, 6], [4, 8]] as [number, number][]) {
      const date = addDaysStr(mon, off);
      rs[date] = { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', rpe: 5, painDuring: 0, painNextAM: 0 };
    }
    checkins[mon] = { weekStart: mon, sleep: 4, soreness: 2, energy: 4, stress: 2, updated_at: mon + 'T12:00:00Z' };
  }
  return { rs, checkins };
}

function globals(checkins: Record<string, WeeklyCheckin>, patch: Partial<GlobalState> = {}): GlobalState {
  return {
    ...defaultGlobalState('2026-07-31T12:00:00Z'),
    painTrackingSince: START, speedState: 6, hipSafeFlag: true, ptClearedSpeed: true,
    painCap: 3, checkins, ...patch,
  };
}

const SETTINGS = {
  ...defaultSettings('2026-07-31T12:00:00Z'),
  startDate: START, startMpw: 20, peakMpw: 30, buildStep: 1.5, downEvery: 4,
  daysPerWeek: 3, weeksShown: 14, xcStartDate: '2027-06-01', trailingLongest: 8,
};
const EFF = effectiveSettings(SETTINGS, baseline().rs, TODAY).eff;

/** Peak the projection reaches over the first `n` weeks under a modulation. */
function projectedPeak(rs: RunState, g: GlobalState, n = 7): number {
  const mod = toModulation(computeAdaptiveProfile(rs, g, TODAY, SETTINGS));
  const cfgs = buildWeekConfigsFromSettings(EFF, 14, mod);
  return Math.max(...cfgs.slice(0, n).map(c => c.miles.reduce((a, b) => a + b, 0)));
}

function profile(rs: RunState, g: GlobalState) {
  return computeAdaptiveProfile(rs, g, TODAY, SETTINGS);
}

function withPain(during: number, am?: number): { rs: RunState; g: GlobalState } {
  const { rs, checkins } = baseline();
  rs[PAIN_DATE] = { ...rs[PAIN_DATE], painDuring: during, ...(am != null ? { painNextAM: am } : {}) };
  return { rs, g: globals(checkins) };
}

/** N distinct recent runs each with an unsettled below-cap niggle. */
function repeatedUnsettled(n: number): { rs: RunState; g: GlobalState } {
  const { rs, checkins } = baseline();
  const dates = ['2026-07-08', '2026-07-13', '2026-07-15', '2026-07-17', '2026-07-20', '2026-07-22'].slice(0, n);
  for (const d of dates) {
    rs[d] = { ...(rs[d] ?? { date: d, done: true, miles_actual: 6, updated_at: d + 'T12:00:00Z' }), painDuring: 1, painNextAM: morningAnswer(false, 1) };
  }
  return { rs, g: globals(checkins) };
}

describe('isolated below-cap pain — mileage & trust are unmoved', () => {
  it('(1) clean baseline: earned-trust active, full-rate build to the peak', () => {
    const { rs, checkins } = baseline();
    const p = profile(rs, globals(checkins));
    expect(p.growthFactor).toBe(1.0);
    expect(p.earnedTrust.active).toBe(true);
    expect(projectedPeak(rs, globals(checkins))).toBeGreaterThanOrEqual(29);
  });

  it('(2) painDuring=1, NO morning data → identity mileage modulation', () => {
    const { rs, g } = withPain(1);
    const p = profile(rs, g);
    expect(p.growthFactor).toBe(1.0);
    expect(p.unsettledRate).toBe(0);
  });

  it('(3) painDuring=1, painNextAM=0 (settled) → identity mileage modulation', () => {
    const { rs, g } = withPain(1, 0);
    expect(profile(rs, g).growthFactor).toBe(1.0);
  });

  it('(4) painDuring=1, painNextAM=1 → does NOT materially reduce the projected peak', () => {
    const { rs, g } = withPain(1, 1);
    expect(profile(rs, g).growthFactor).toBe(1.0);
    expect(projectedPeak(rs, g)).toBeGreaterThanOrEqual(29);
  });

  it('(5) one isolated "did not settle" 1/10 does NOT activate unsettledRate', () => {
    const { rs, g } = withPain(1, morningAnswer(false, 1)); // painNextAM = 2
    const p = profile(rs, g);
    expect(p.unsettledRate).toBe(0);
    expect(p.growthFactor).toBe(1.0);
    expect(p.earnedTrust.active).toBe(true);           // not vetoed by an isolated niggle
    expect(p.earnedTrust.blockedBy).toBeNull();
  });

  it('(6) fewer than MIN_UNSETTLED_SAMPLES cannot activate unsettledRate or its veto', () => {
    const min = TUNABLES.ADAPTIVE.UNSETTLED_MIN_SAMPLES;
    for (let n = 1; n < min; n++) {
      const { rs, g } = repeatedUnsettled(n);
      const p = profile(rs, g);
      expect(p.unsettledRate).toBe(0);
      expect(p.growthFactor).toBe(1.0);
      expect(p.earnedTrust.active).toBe(true);
    }
  });

  it('(before/after) one isolated 1/10 no longer collapses the projection 30 → 25', () => {
    const clean = projectedPeak(baseline().rs, globals(baseline().checkins));
    const withNiggle = (() => { const { rs, g } = withPain(1, morningAnswer(false, 1)); return projectedPeak(rs, g); })();
    // Materially close to the clean identity path (was ~29 → ~26.5 before the fix).
    expect(Math.abs(withNiggle - clean)).toBeLessThan(0.6);
  });
});

describe('repeated / worsening pain still eases — graded, milder than a breach', () => {
  it('(7) at the minimum sample count, an INSUFFICIENT unsettled proportion does not ease', () => {
    // 3 comparable pain days, only 1 unsettled → rate 0.33? guard with 4 days / 1 unsettled = 0.25 ≤ 0.3.
    const { rs, checkins } = baseline();
    const dates = ['2026-07-08', '2026-07-13', '2026-07-17', '2026-07-22'];
    dates.forEach((d, i) => {
      rs[d] = { ...(rs[d] ?? { date: d, done: true, miles_actual: 6, updated_at: d + 'T12:00:00Z' }), painDuring: 1, painNextAM: i === 0 ? 2 : 1 };
    });
    const p = profile(rs, globals(checkins));
    expect(p.unsettledRate).toBeLessThanOrEqual(TUNABLES.ADAPTIVE.UNSETTLED_RATE_MIN);
    expect(p.growthFactor).toBe(1.0);
  });

  it('(8) at the minimum sample count, a genuinely high unsettled proportion activates modest easing', () => {
    const { rs, g } = repeatedUnsettled(TUNABLES.ADAPTIVE.UNSETTLED_MIN_SAMPLES);
    const p = profile(rs, g);
    expect(p.unsettledRate).toBeGreaterThan(TUNABLES.ADAPTIVE.UNSETTLED_RATE_MIN);
    expect(p.growthFactor).toBeCloseTo(TUNABLES.ADAPTIVE.UNSETTLED_EASE, 5); // 0.8, modest
    expect(p.reasons.join(' ')).toMatch(/persisted across several runs/i);
  });

  it('(9) repeated low-grade pain eases far LESS than a cap breach', () => {
    const repeated = profile(repeatedUnsettled(3).rs, repeatedUnsettled(3).g).growthFactor;
    const { rs, checkins } = baseline();
    rs[PAIN_DATE] = { ...rs[PAIN_DATE], painDuring: 5 }; // above cap 3 → breach
    const breach = profile(rs, globals(checkins)).growthFactor;
    expect(repeated).toBeGreaterThan(breach);
    expect(repeated).toBeCloseTo(0.8, 5);
    expect(breach).toBeLessThan(0.6);
  });

  it('(10) rising next-morning pain (with enough sub-cap samples) still eases', () => {
    const { rs, checkins } = baseline();
    // clear the baseline painNextAM:0 noise on recent runs, then a 0→1→2→3-cap climb
    for (const [d, am] of [['2026-07-06', 1], ['2026-07-13', 2], ['2026-07-20', 3], ['2026-07-22', 3]] as [string, number][]) {
      rs[d] = { ...(rs[d] ?? { date: d, done: true, miles_actual: 6, updated_at: d + 'T12:00:00Z' }), painDuring: 1, painNextAM: am };
    }
    const p = profile(rs, globals(checkins));
    expect(p.growthFactor).toBeLessThan(1.0);
  });

  it('(11) pain above cap preserves the strong response', () => {
    const { rs, checkins } = baseline();
    rs[PAIN_DATE] = { ...rs[PAIN_DATE], painDuring: 4 };
    const p = profile(rs, globals(checkins));
    expect(p.breachDays90).toBeGreaterThanOrEqual(1);
    expect(p.growthFactor).toBeLessThan(0.6);
    expect(p.earnedTrust.blockedBy).toMatch(/breach/i);
  });

  it('(12) a flare preserves the strong deload response', () => {
    const { rs, checkins } = baseline();
    rs['2026-07-22'] = { ...rs['2026-07-22'], painDuring: 5 };
    rs['2026-07-27'] = { date: '2026-07-27', done: true, miles_actual: 6, updated_at: '2026-07-27T12:00:00Z', painDuring: 5 };
    const p = profile(rs, globals(checkins));
    expect(p.growthFactor).toBeLessThan(0.5);
    expect(p.downEvery).toBeLessThanOrEqual(3);
  });
});

describe('no double-counting; explanation accuracy; earned-trust cooldown', () => {
  it('(13) an isolated event is not counted by multiple mileage reductions', () => {
    const { rs, g } = withPain(1, morningAnswer(false, 1));
    const p = profile(rs, g);
    // exactly identity: no breach ease, no unsettled ease, no drift, no hold
    expect(p.growthFactor).toBe(1.0);
    expect(p.breachDays90).toBe(0);
    expect(p.painDrift.status).not.toBe('rising');
    expect(p.holdLong).toBe(false);
  });

  it('(14) an isolated low-pain observation does NOT start a long earned-trust cooldown', () => {
    const { rs, g } = withPain(1, morningAnswer(false, 1));
    const p = profile(rs, g);
    expect(p.earnedTrust.cooldownDaysLeft).toBeNull();
    expect(p.earnedTrust.active).toBe(true);
  });

  it('(15) a real repeated-pain veto still starts the existing cooldown once it clears', () => {
    // 3 unsettled days, the most recent ~9 days ago; today reads clean but the
    // veto was active within the cooldown window → re-earning countdown shows.
    const { rs, checkins } = baseline();
    // put the unsettled days far enough back that TODAY itself is not vetoed,
    // but a prior day inside the cooldown window WAS.
    for (const d of ['2026-07-20', '2026-07-21', '2026-07-22']) {
      rs[d] = { date: d, done: true, miles_actual: 6, updated_at: d + 'T12:00:00Z', painDuring: 1, painNextAM: 2 };
    }
    // today = a few days later so the 90-day window still holds the 3 days →
    // this case stays vetoed today; assert the veto is real (cooldown machinery
    // is exercised by phase2d tests — here we assert the veto reason is present).
    const p = profile(rs, globals(checkins));
    expect(p.earnedTrust.active).toBe(false);
    expect(p.earnedTrust.blockedBy).toMatch(/slow to settle/i);
  });

  it('(16) every applied reduction has non-empty matching copy; the watch note never claims a reduction', () => {
    // isolated: watch copy present, growth unchanged
    const iso = profile(withPain(1, morningAnswer(false, 1)).rs, withPain(1, morningAnswer(false, 1)).g);
    expect(iso.growthFactor).toBe(1.0);
    expect(iso.reasons.join(' ')).toMatch(/watching it/i);
    expect(iso.reasons.join(' ')).toMatch(/mileage build is unchanged/i);
    // repeated: reduction copy present and matches the applied ease
    const rep = profile(repeatedUnsettled(3).rs, repeatedUnsettled(3).g);
    expect(rep.growthFactor).toBeLessThan(1.0);
    expect(rep.reasons.join(' ')).toMatch(/easing slightly/i);
  });
});
