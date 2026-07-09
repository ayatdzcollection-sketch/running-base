// ============================================================
// PHASE 2A — body-response signals wired into the adaptive engine.
//
// Proves the one-way safety contract: easy-run RPE trend, sub-threshold pain
// drift, and long-run readiness can only HOLD / REDUCE / DELOAD the plan. None
// loosens a cap, raises the peak, or makes the plan more aggressive. Sparse or
// missing data does nothing. A real pain breach stays stronger than any drift.
// factor=1 / no-hold is byte-identity; factor<1 or holdLong is never larger.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  computeAdaptiveProfile, toModulation,
  easyRunRpeTrend, painDriftSignal, longRunReadiness,
} from '../adaptive';
import { buildWeekConfigsFromSettings, defaultSettings } from '../settings';
import { resolveEffectivePlan } from '../planOverlay';
import { assessPeakFeasibility } from '../feasibility';
import { generateNextWeek } from '../generator';
import { defaultGlobalState } from '../migrate';
import { nextLongFrom, addDaysStr } from '../metrics';
import { TUNABLES } from '../../config/tunables';
import { PLAN_START_DATE } from '../../config/plan';
import type { GlobalState, RawSettings, RunEntry, RunState } from '../types';
import type { WeekConfig } from '../../config/plan';

const A = TUNABLES.ADAPTIVE;
const NOW = '2026-07-31T12:00:00Z';
const TODAY = '2026-07-31';

function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}
function run(date: string, miles: number, extra: Partial<RunEntry> = {}): RunEntry {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}
const total = (c: WeekConfig) => c.miles.reduce((a, b) => a + b, 0);
const long = (c: WeekConfig) => c.miles[c.miles.length - 1];

function settingsFor(patch: Partial<RawSettings> = {}): RawSettings {
  return {
    ...defaultSettings(NOW),
    startMpw: 20, peakMpw: 40, buildStep: 2, downEvery: 4, weeksShown: 12,
    trailingLongest: 4.5, ...patch,
  };
}

/** N weeks of clean daily easy runs ending the week before TODAY. No rpe / pain,
 *  so on their own every Phase-2A signal is insufficient (identity). */
function adheredLog(weeks: number): RunState {
  const s: RunState = {};
  for (let w = 1; w <= weeks; w++) {
    for (const off of [0, 1, 2, 3, 4]) {
      const d = addDaysStr(TODAY, -w * 7 + off);
      s[d] = run(d, 4);
    }
  }
  return s;
}
/** Place rpe'd runs on distinct recent dates, oldest first. */
function rpeRuns(rpes: number[]): RunState {
  const s: RunState = {};
  const n = rpes.length;
  for (let i = 0; i < n; i++) {
    const d = addDaysStr(TODAY, -(n - i) * 3);
    s[d] = run(d, 4, { rpe: rpes[i] });
  }
  return s;
}
/** Place runs with next-morning soreness (no during-run pain) on distinct recent
 *  dates, oldest first — isolates the sub-threshold DRIFT signal from the
 *  existing overnight-unsettled signal (which keys on painDuring > 0). */
function painRuns(vals: Array<number | null>): RunState {
  const s: RunState = {};
  const n = vals.length;
  for (let i = 0; i < n; i++) {
    const d = addDaysStr(TODAY, -(n - i) * 4);
    s[d] = run(d, 4, { painDuring: 0, painNextAM: vals[i] });
  }
  return s;
}

// ════════════════════════════════════════════════════════════
// 1–3. Easy-run RPE fatigue trend (pure detector)
// ════════════════════════════════════════════════════════════
describe('easyRunRpeTrend — easy-run fatigue', () => {
  it('(1) rising easy-run RPE is detected across comparable runs', () => {
    const t = easyRunRpeTrend(rpeRuns([3, 3, 4, 5, 6, 6]), TODAY);
    expect(t.status).toBe('rising');
    expect(t.samples).toBe(6);
    expect(t.delta).toBeGreaterThanOrEqual(A.RPE_RISE_MIN);
  });

  it('(2) stable easy-run RPE is NOT rising', () => {
    const t = easyRunRpeTrend(rpeRuns([4, 4, 4, 4, 4]), TODAY);
    expect(t.status).toBe('stable');
    expect(t.delta).toBeLessThan(A.RPE_RISE_MIN);
  });

  it('improving easy-run RPE is NOT rising (never speeds the plan up)', () => {
    const t = easyRunRpeTrend(rpeRuns([6, 6, 5, 4, 3]), TODAY);
    expect(t.status).toBe('stable');
    expect(t.delta).toBeLessThan(0);
  });

  it('(3) sparse RPE data is insufficient — no trend even if the few points rise', () => {
    expect(easyRunRpeTrend(rpeRuns([3, 6]), TODAY).status).toBe('insufficient');
    expect(easyRunRpeTrend(rpeRuns([3, 5, 7]), TODAY).status).toBe('insufficient'); // 3 < RPE_MIN_SAMPLES
  });

  it('intentional hard sessions / races (RPE ≥ 8) are excluded from the easy trend', () => {
    // three easy runs + a spike hard session; only the easy ones count → sparse
    const log: RunState = { ...rpeRuns([3, 3, 4]), [addDaysStr(TODAY, -1)]: run(addDaysStr(TODAY, -1), 6, { rpe: 9 }) };
    const t = easyRunRpeTrend(log, TODAY);
    expect(t.samples).toBe(3);            // the RPE-9 session is not an easy run
    expect(t.status).toBe('insufficient');
  });

  it('old runs outside the window are excluded', () => {
    const log = { ...rpeRuns([3, 3]), [addDaysStr(TODAY, -60)]: run(addDaysStr(TODAY, -60), 4, { rpe: 8 }) };
    expect(easyRunRpeTrend(log, TODAY).samples).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════
// 4–5. Sub-threshold next-morning pain drift (pure detector)
// ════════════════════════════════════════════════════════════
describe('painDriftSignal — sub-threshold next-AM pain drift', () => {
  it('(4) rising painNextAM below the hard cap is detected (0 → 1 → 2)', () => {
    const d = painDriftSignal(painRuns([0, 0, 1, 2, 2]), TODAY, 3);
    expect(d.status).toBe('rising');
    expect(d.delta).toBeGreaterThanOrEqual(A.PAIN_DRIFT_RISE_MIN);
  });

  it('flat sub-threshold pain does not drift', () => {
    expect(painDriftSignal(painRuns([1, 1, 1, 1]), TODAY, 3).status).toBe('stable');
  });

  it('(5) MISSING painNextAM is unknown, never counted as zero', () => {
    // 2 real readings + 3 missing → only 2 samples (missing skipped), so insufficient.
    const d = painDriftSignal(painRuns([2, 2, null, null, null]), TODAY, 3);
    expect(d.samples).toBe(2);           // NOT 5 — nulls are not zeros
    expect(d.status).toBe('insufficient');
  });

  it('breaches (> cap) are excluded — drift is sub-threshold only', () => {
    // painNextAM 5 is a breach (cap 3); it must not feed the milder drift math.
    const d = painDriftSignal(painRuns([1, 1, 5]), TODAY, 3);
    expect(d.samples).toBe(2);
  });

  it('sparse next-AM data is insufficient', () => {
    expect(painDriftSignal(painRuns([0, 2]), TODAY, 3).status).toBe('insufficient');
  });
});

// ════════════════════════════════════════════════════════════
// 7–8. Long-run readiness gate (pure detector)
// ════════════════════════════════════════════════════════════
describe('longRunReadiness — how the last long run felt', () => {
  const lr = (extra: Partial<RunEntry>) => ({ ...adheredLog(2), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, extra) });

  it('(7) high RPE on the last long run → hold', () => {
    const r = longRunReadiness(lr({ rpe: A.LR_RPE_HIGH }), TODAY);
    expect(r.status).toBe('hold');
    expect(r.reason).toMatch(/high RPE/i);
  });
  it('(7) elevated painDuring on the last long run → hold', () => {
    expect(longRunReadiness(lr({ painDuring: A.LR_PAIN_DURING_HIGH }), TODAY).status).toBe('hold');
  });
  it('(7) elevated next-AM pain after the last long run → hold', () => {
    expect(longRunReadiness(lr({ painNextAM: A.LR_PAIN_NEXTAM_HIGH }), TODAY).status).toBe('hold');
  });
  it('(8) a good long run (low RPE, no pain) → ok, never a step-up', () => {
    expect(longRunReadiness(lr({ rpe: 3 }), TODAY).status).toBe('ok');
  });
  it('a long run with no readiness data logged → insufficient (no guessing)', () => {
    expect(longRunReadiness(lr({}), TODAY).status).toBe('insufficient');
  });
  it('no recent long run at all → insufficient', () => {
    expect(longRunReadiness({}, TODAY).status).toBe('insufficient');
  });
});

// ════════════════════════════════════════════════════════════
// Folding into computeAdaptiveProfile / toModulation
// ════════════════════════════════════════════════════════════
describe('computeAdaptiveProfile — Phase 2A folding (downward-only)', () => {
  const base = settingsFor();

  it('clean/adhered signals stay identity (growthFactor 1, no hold)', () => {
    const p = computeAdaptiveProfile(adheredLog(3), globals(), TODAY, base);
    expect(p.growthFactor).toBe(1.0);
    expect(p.holdLong).toBe(false);
    expect(p.downEvery).toBe(base.downEvery);
  });

  it('(1) rising easy-run RPE reduces the growth factor with an explanation', () => {
    const log = { ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) };
    const p = computeAdaptiveProfile(log, globals(), TODAY, base);
    expect(p.growthFactor).toBeLessThan(1.0);
    expect(p.growthFactor).toBeCloseTo(A.RPE_EASE, 5); // shallow: exactly one ease step
    expect(p.reasons.join(' ')).toMatch(/easy runs have felt harder/i);
  });

  it('(2/3) stable or sparse RPE does not reduce the plan', () => {
    expect(computeAdaptiveProfile({ ...adheredLog(3), ...rpeRuns([4, 4, 4, 4, 4]) }, globals(), TODAY, base).growthFactor).toBe(1.0);
    expect(computeAdaptiveProfile({ ...adheredLog(3), ...rpeRuns([3, 7]) }, globals(), TODAY, base).growthFactor).toBe(1.0);
  });

  it('(4) rising sub-threshold pain drift eases the build AND tightens the down-week cadence', () => {
    const log = { ...adheredLog(3), ...painRuns([0, 0, 1, 2, 2]) };
    const p = computeAdaptiveProfile(log, globals({ painCap: 3 }), TODAY, base);
    expect(p.growthFactor).toBeLessThan(1.0);
    expect(p.growthFactor).toBeCloseTo(A.PAIN_DRIFT_EASE, 5); // shallow, not a severe deload
    expect(p.downEvery).toBeLessThanOrEqual(A.PAIN_DRIFT_DOWNEVERY);
    expect(p.reasons.join(' ')).toMatch(/next-morning soreness has crept up/i);
  });

  it('(6) a real pain breach is a STRONGER response than sub-threshold drift', () => {
    const drift = computeAdaptiveProfile({ ...adheredLog(3), ...painRuns([0, 0, 1, 2, 2]) }, globals({ painCap: 3 }), TODAY, base);
    const breachLog = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 4, { painDuring: 6 }) };
    const breach = computeAdaptiveProfile(breachLog, globals({ painCap: 3 }), TODAY, base);
    expect(breach.growthFactor).toBeLessThan(drift.growthFactor);
    expect(breach.breachDays90).toBeGreaterThanOrEqual(1);
  });

  it('(7) a poorly-tolerated last long run sets holdLong WITHOUT reducing weekly growth', () => {
    const log = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { rpe: A.LR_RPE_HIGH }) };
    const p = computeAdaptiveProfile(log, globals(), TODAY, base);
    expect(p.holdLong).toBe(true);
    expect(p.growthFactor).toBe(1.0); // holds the long run only; weekly mileage may still build
    expect(p.reasons.join(' ')).toMatch(/holding the long run/i);
  });

  it('(8) a good last long run does not hold and does not accelerate anything', () => {
    const log = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { rpe: 3, painNextAM: 0 }) };
    const p = computeAdaptiveProfile(log, globals(), TODAY, base);
    expect(p.holdLong).toBe(false);
    expect(p.growthFactor).toBe(1.0);
  });

  it('toModulation carries growthFactor, downEvery, and holdLong', () => {
    const log = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { rpe: A.LR_RPE_HIGH }) };
    const m = toModulation(computeAdaptiveProfile(log, globals(), TODAY, base));
    expect(m).toEqual({ growthFactor: 1, downEvery: base.downEvery, holdLong: true });
  });
});

// ════════════════════════════════════════════════════════════
// Plan-level: real signals reshape the rolling plan (one-way)
// ════════════════════════════════════════════════════════════
describe('rolling plan — real body signals only ever hold/reduce', () => {
  const base = settingsFor();
  const identity = buildWeekConfigsFromSettings(base);
  const modOf = (log: RunState, g = globals()) => toModulation(computeAdaptiveProfile(log, g, TODAY, base));

  it('(11) clean signals → byte-identical plan (identity)', () => {
    const clean = modOf(adheredLog(3));
    expect(clean).toEqual({ growthFactor: 1, downEvery: base.downEvery, holdLong: false });
    expect(buildWeekConfigsFromSettings(base, undefined, clean)).toEqual(identity);
  });

  it('(8/11) a good long run leaves the plan identical (good signals never accelerate)', () => {
    const goodLong = modOf({ ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { rpe: 3, painNextAM: 0 }) });
    expect(buildWeekConfigsFromSettings(base, undefined, goodLong)).toEqual(identity);
  });

  it('(1/12) rising RPE never produces a larger week, and reduces at least one build week', () => {
    const eased = buildWeekConfigsFromSettings(base, undefined, modOf({ ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) }));
    let anyReduced = false;
    for (let i = 0; i < identity.length; i++) {
      expect(total(eased[i])).toBeLessThanOrEqual(total(identity[i]) + 1e-9);
      if (total(eased[i]) < total(identity[i]) - 1e-9) anyReduced = true;
    }
    expect(anyReduced).toBe(true);
  });

  it('(7/12) a bad long run holds the long-run ladder while weekly mileage still progresses', () => {
    const held = buildWeekConfigsFromSettings(base, undefined, modOf({ ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { rpe: A.LR_RPE_HIGH }) }));
    let anyLongHeldLower = false;
    for (let i = 0; i < identity.length; i++) {
      expect(long(held[i])).toBeLessThanOrEqual(long(identity[i]) + 1e-9);       // long never steps past identity
      expect(total(held[i])).toBeLessThanOrEqual(total(identity[i]) + 1e-9);      // week never larger than identity
      if (long(held[i]) < long(identity[i]) - 1e-9) anyLongHeldLower = true;
    }
    expect(anyLongHeldLower).toBe(true);
    // weekly mileage still progresses modestly (a mid-horizon build week > week 1)
    expect(total(held[4])).toBeGreaterThan(total(held[0]));
  });

  it('(9) new signals never loosen the +10%/week growth cap', () => {
    const eased = buildWeekConfigsFromSettings(base, undefined, modOf({ ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) }));
    let lastBuild = total(eased[0]);
    for (let i = 1; i < eased.length; i++) {
      if (eased[i].isDownWeek) continue;
      expect(total(eased[i])).toBeLessThanOrEqual(lastBuild * TUNABLES.WEEKLY_GROWTH_MAX + 0.5 + 1e-9);
      lastBuild = total(eased[i]);
    }
  });

  it('(10) new signals never loosen the long-run 110% ladder', () => {
    for (const log of [
      { ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) },
      { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { rpe: A.LR_RPE_HIGH }) },
      { ...adheredLog(3), ...painRuns([0, 0, 1, 2, 2]) },
    ]) {
      const cfgs = buildWeekConfigsFromSettings(base, undefined, modOf(log, globals({ painCap: 3 })));
      let prev = base.trailingLongest;
      for (const c of cfgs) {
        expect(long(c)).toBeLessThanOrEqual(nextLongFrom(prev) + 1e-9);
        if (!c.isDownWeek) prev = long(c);
      }
    }
  });

  it('(15) weeksShown stays display-only under a real (fatigued + hold) modulation', () => {
    const mod = modOf({ ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { rpe: A.LR_RPE_HIGH }) });
    const short = buildWeekConfigsFromSettings(base, 7, mod);
    const long20 = buildWeekConfigsFromSettings(base, 20, mod);
    for (let i = 0; i < 7; i++) expect(long20[i]).toEqual(short[i]);
  });

  it('(19) no fake taper appears under modulation — final week is never a taper', () => {
    const mod = modOf({ ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) });
    const cfgs = buildWeekConfigsFromSettings(base, 12, mod);
    expect(cfgs.every(c => c.note !== 'taper')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Preservation: locked weeks & logged runs (13, 14) with a real mod
// ════════════════════════════════════════════════════════════
describe('resolveEffectivePlan — preservation under a real modulation', () => {
  // startDate = PLAN_START_DATE so W1/W2 lock against the static scaffold.
  const base = settingsFor({ startDate: PLAN_START_DATE, xcStartDate: addDaysStr(PLAN_START_DATE, 20 * 7) });
  const LOCK_TODAY = addDaysStr(PLAN_START_DATE, 8); // inside week 2
  const LOG: RunState = {
    [PLAN_START_DATE]: run(PLAN_START_DATE, 4),
    [addDaysStr(PLAN_START_DATE, 1)]: run(addDaysStr(PLAN_START_DATE, 1), 4),
    [addDaysStr(PLAN_START_DATE, 7)]: run(addDaysStr(PLAN_START_DATE, 7), 4, { rpe: A.LR_RPE_HIGH }),
  };
  const badLongMod = toModulation(computeAdaptiveProfile(LOG, globals(), LOCK_TODAY, base));

  it('(14) locked weeks are identical with or without modulation', () => {
    const plain = resolveEffectivePlan(base, LOG, LOCK_TODAY);
    const eased = resolveEffectivePlan(base, LOG, LOCK_TODAY, { modulation: badLongMod });
    for (const ws of [PLAN_START_DATE, addDaysStr(PLAN_START_DATE, 7)]) {
      const a = plain.plan.weeks.find(w => w.startDate === ws)!;
      const b = eased.plan.weeks.find(w => w.startDate === ws)!;
      expect(b.totalPlanned).toBe(a.totalPlanned);
      expect(b.runDays.map(d => d.prescribed)).toEqual(a.runDays.map(d => d.prescribed));
    }
  });

  it('(13) the run log is never mutated by plan resolution', () => {
    const snapshot = JSON.parse(JSON.stringify(LOG));
    resolveEffectivePlan(base, LOG, LOCK_TODAY, { modulation: badLongMod });
    expect(LOG).toEqual(snapshot);
  });

  it('(12/14) future unlocked weeks are held/eased (≤ identity), locked weeks untouched', () => {
    const plain = resolveEffectivePlan(base, LOG, LOCK_TODAY);
    const eased = resolveEffectivePlan(base, LOG, LOCK_TODAY, { modulation: badLongMod });
    // a future week (well past the locked head)
    const futStart = addDaysStr(PLAN_START_DATE, 6 * 7);
    const a = plain.plan.weeks.find(w => w.startDate === futStart)!;
    const b = eased.plan.weeks.find(w => w.startDate === futStart)!;
    expect(b.longRunCap).toBeLessThanOrEqual(a.longRunCap + 1e-9); // long-run hold reaches future weeks
  });
});

// ════════════════════════════════════════════════════════════
// Feasibility (18) & generator (20) honor the modulation
// ════════════════════════════════════════════════════════════
describe('feasibility diagnostic under modulation (18)', () => {
  const base = settingsFor({ startMpw: 20, peakMpw: 35, buildStep: 2, xcStartDate: '2026-09-14' });

  it('an unreachable peak stays flagged; maxSafeReachable is the UNMODULATED ceiling', () => {
    const holdMod = { growthFactor: 0.6, downEvery: base.downEvery, holdLong: true };
    const plain = assessPeakFeasibility(base);
    const eased = assessPeakFeasibility(base, holdMod);
    expect(eased.maxSafeReachable).toBe(plain.maxSafeReachable);       // safety ceiling unchanged
    expect(eased.reachedByPlan).toBeLessThanOrEqual(plain.reachedByPlan + 1e-9); // body-adjusted reaches ≤
  });
});

describe('generator honors holdLong (20)', () => {
  const g = globals({ painCap: 3 });
  const LOG: RunState = {
    '2026-07-27': run('2026-07-27', 4), '2026-07-28': run('2026-07-28', 4),
    '2026-07-29': run('2026-07-29', 4), '2026-07-30': run('2026-07-30', 4.5),
    '2026-07-31': run('2026-07-31', 4.5),
  };

  it('holdLong clamps the generated long run to the recent longest (no ladder step)', () => {
    const normal = generateNextWeek({ runState: LOG, globals: g, today: TODAY });
    const held = generateNextWeek({ runState: LOG, globals: g, today: TODAY, adaptive: { growthFactor: 1, downEvery: 4, holdLong: true } });
    expect(held.days[4].miles!).toBeLessThanOrEqual(normal.days[4].miles!);
    expect(held.notes.join(' ')).toMatch(/long run held/i);
  });

  it('no holdLong (undefined) is identical to no adaptation — the generator is unchanged', () => {
    const normal = generateNextWeek({ runState: LOG, globals: g, today: TODAY });
    const same = generateNextWeek({ runState: LOG, globals: g, today: TODAY, adaptive: { growthFactor: 1, downEvery: 4 } });
    expect(same.days[4].miles).toBe(normal.days[4].miles);
    expect(same.totalMiles).toBeCloseTo(normal.totalMiles, 5);
  });
});

// ════════════════════════════════════════════════════════════
// FOLLOW-UP: missing RPE is UNKNOWN — never easy, never zero, never bad.
// RPE is only entered occasionally, so the RPE signal must stay inactive
// unless there are enough EXPLICIT entries. Missing entries must not count
// toward the sample size, bias the trend, or produce the RPE banner text.
// ════════════════════════════════════════════════════════════
describe('missing RPE is unknown — RPE only acts on explicit entries', () => {
  const base = settingsFor();
  const RPE_REASON = /easy runs have felt harder|RPE trending up/i;
  // Explicit rpe runs on recent dates that DON'T collide with adheredLog's dates
  // (adheredLog fills −7..−3, −14..−10, −21..−17; −1/−2 are free).
  const explicitRpe = (pairs: Array<[number, number]>): RunState => {
    const s: RunState = {};
    for (const [daysAgo, r] of pairs) { const d = addDaysStr(TODAY, -daysAgo); s[d] = run(d, 4, { rpe: r }); }
    return s;
  };

  it('(1) runs with missing RPE do not count toward RPE_MIN_SAMPLES', () => {
    // ~15 runs with NO rpe + exactly 2 explicit rpe entries → samples must be 2.
    const log = { ...adheredLog(3), ...explicitRpe([[1, 6], [2, 3]]) };
    const t = easyRunRpeTrend(log, TODAY);
    expect(t.samples).toBe(2);              // NOT ~17 — missing rpe is skipped
    expect(t.status).toBe('insufficient');
  });

  it('(2) mostly-missing RPE + one or two explicit high entries does NOT trigger a trend', () => {
    const log = { ...adheredLog(3), ...explicitRpe([[6, 7], [1, 7]]) }; // 2 explicit, both high, but < threshold
    expect(easyRunRpeTrend(log, TODAY).status).toBe('insufficient');
    const p = computeAdaptiveProfile(log, globals(), TODAY, base);
    expect(p.growthFactor).toBe(1.0);       // RPE signal inactive
    expect(p.reasons.join(' ')).not.toMatch(RPE_REASON);
  });

  it('(3) enough EXPLICIT rising RPE entries DOES trigger the RPE adjustment', () => {
    const log = { ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) };
    expect(easyRunRpeTrend(log, TODAY).status).toBe('rising');
    const p = computeAdaptiveProfile(log, globals(), TODAY, base);
    expect(p.growthFactor).toBeCloseTo(A.RPE_EASE, 5);
    expect(p.reasons.join(' ')).toMatch(RPE_REASON);
  });

  it('(4) enough EXPLICIT stable RPE entries does NOT trigger the RPE adjustment', () => {
    const log = { ...adheredLog(3), ...rpeRuns([4, 4, 4, 4, 4]) };
    expect(easyRunRpeTrend(log, TODAY).status).toBe('stable');
    const p = computeAdaptiveProfile(log, globals(), TODAY, base);
    expect(p.growthFactor).toBe(1.0);
    expect(p.reasons.join(' ')).not.toMatch(RPE_REASON);
  });

  it('(5) missing RPE on the long run does NOT trigger a long-run hold', () => {
    // long run logged with NO rpe and no pain → unknown, not bad
    const noData = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8) };
    expect(longRunReadiness(noData, TODAY).status).toBe('insufficient');
    expect(computeAdaptiveProfile(noData, globals(), TODAY, base).holdLong).toBe(false);
    // long run with NO rpe but a GOOD next-AM reading → ok, still no hold
    const okData = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { painNextAM: 0 }) };
    expect(longRunReadiness(okData, TODAY).status).toBe('ok');
    expect(computeAdaptiveProfile(okData, globals(), TODAY, base).holdLong).toBe(false);
  });

  it('(6) missing RPE on the long run still lets painDuring/painNextAM trigger a hold', () => {
    const nextAM = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { painNextAM: A.LR_PAIN_NEXTAM_HIGH }) };
    expect(longRunReadiness(nextAM, TODAY).status).toBe('hold');
    expect(longRunReadiness(nextAM, TODAY).reason).toMatch(/soreness/i); // NOT attributed to RPE
    expect(computeAdaptiveProfile(nextAM, globals(), TODAY, base).holdLong).toBe(true);

    const during = { ...adheredLog(3), [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 8, { painDuring: A.LR_PAIN_DURING_HIGH }) };
    expect(longRunReadiness(during, TODAY).status).toBe('hold');
    expect(computeAdaptiveProfile(during, globals(), TODAY, base).holdLong).toBe(true);
  });

  it('(7) a no-RPE log produces the SAME plan as identity modulation', () => {
    const noRpe = adheredLog(3); // never any rpe
    const mod = toModulation(computeAdaptiveProfile(noRpe, globals(), TODAY, base));
    expect(mod).toEqual({ growthFactor: 1, downEvery: base.downEvery, holdLong: false });
    expect(buildWeekConfigsFromSettings(base, undefined, mod)).toEqual(buildWeekConfigsFromSettings(base));
  });

  it('(8) banner reason only mentions RPE when EXPLICIT RPE caused the adjustment', () => {
    // pain drift eases the plan, but with NO rpe entries the reason must not blame RPE
    const driftOnly = { ...adheredLog(3), ...painRuns([0, 0, 1, 2, 2]) };
    const pd = computeAdaptiveProfile(driftOnly, globals({ painCap: 3 }), TODAY, base);
    expect(pd.growthFactor).toBeLessThan(1);          // the plan IS eased…
    expect(pd.reasons.join(' ')).not.toMatch(RPE_REASON); // …but not attributed to RPE
    expect(pd.reasons.join(' ')).toMatch(/soreness/i);
    // and when explicit RPE really is rising, the RPE reason DOES appear
    const rpeUp = { ...adheredLog(3), ...rpeRuns([3, 3, 4, 5, 6, 6]) };
    expect(computeAdaptiveProfile(rpeUp, globals(), TODAY, base).reasons.join(' ')).toMatch(RPE_REASON);
  });
});
