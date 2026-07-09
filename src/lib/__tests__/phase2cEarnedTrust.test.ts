// ============================================================
// PHASE 2C — earned-trust growth (the one and only UPWARD signal).
//
// Proves the asymmetric safety contract:
//   • Earned SLOWLY — needs MIN_CLEAN_WEEKS clean completed weeks, MIN_ADHERENCE
//     adherence, a present + non-rising easy-run RPE trend, AND MIN_CHECKIN_WEEKS
//     present + good weekly check-ins. Missing RPE or missing check-ins are
//     UNKNOWN → trust is simply not earned (never granted from absent data).
//   • Revoked INSTANTLY — any single warning (break, pain breach, pain drift,
//     rising RPE, cautionary/poor recovery, long-run hold, or any downward
//     modulation) disables it for that computation.
//   • It only widens the week-over-week VOLUME growth ceiling (default +10%/wk →
//     the earned cap), hard-limited by HARD_CEILING. It NEVER loosens the
//     long-run ladder, the peak ceiling, the pain gate, or a completed-week lock.
//   • When inactive it is byte-identical to Phase 2B.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  assessEarnedTrust, computeAdaptiveProfile, toModulation,
  type EarnedTrustInput, type RpeTrend, type PainDrift, type RecoverySignal,
} from '../adaptive';
import { buildWeekConfigsFromSettings, defaultSettings, returnFromBreak } from '../settings';
import { resolveEffectivePlan } from '../planOverlay';
import { assessPeakFeasibility } from '../feasibility';
import { defaultGlobalState } from '../migrate';
import { addDaysStr, mondayOf, nextLongFrom } from '../metrics';
import { TUNABLES } from '../../config/tunables';
import { PLAN_START_DATE } from '../../config/plan';
import type { GlobalState, RawSettings, RunEntry, RunState, WeeklyCheckin } from '../types';
import type { WeekConfig } from '../../config/plan';

const ET = TUNABLES.ADAPTIVE.EARNED_TRUST;
const EARNED_CAP = Math.min(ET.GROWTH_MAX, ET.HARD_CEILING);
const DEFAULT_CAP = TUNABLES.WEEKLY_GROWTH_MAX;
const NOW = '2026-07-31T12:00:00Z';
const TODAY = '2026-07-31';
const CURR = mondayOf(TODAY);
const PREV = addDaysStr(CURR, -7);

const total = (c: WeekConfig) => c.miles.reduce((a, b) => a + b, 0);
const long = (c: WeekConfig) => c.miles[c.miles.length - 1];

function run(date: string, miles: number, extra: Partial<RunEntry> = {}): RunEntry {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}
function globals(patch: Partial<GlobalState> = {}): GlobalState {
  return { ...defaultGlobalState(NOW), ...patch };
}
function settingsFor(patch: Partial<RawSettings> = {}): RawSettings {
  return {
    ...defaultSettings(NOW), startMpw: 20, peakMpw: 40, buildStep: 2, downEvery: 4, weeksShown: 10,
    trailingLongest: 4.5, startDate: '2026-07-06', xcStartDate: '2027-01-01', ...patch,
  };
}
function ci(weekStart: string, p: Partial<WeeklyCheckin> = {}): WeeklyCheckin {
  return { weekStart, sleep: 3, soreness: 2, energy: 3, stress: 2, updated_at: weekStart + 'T00:00:00Z', ...p };
}
function checkins(...cs: WeeklyCheckin[]): Record<string, WeeklyCheckin> {
  const r: Record<string, WeeklyCheckin> = {}; for (const c of cs) r[c.weekStart] = c; return r;
}
const goodCheckins = () => checkins(ci(CURR), ci(PREV));

/** A clean, earned-trust-ELIGIBLE run log: `priorWeeks` full clean calendar
 *  weeks before this week PLUS Mon..today of the current week (for adherence),
 *  every run tagged with a stable easy-run RPE. On its own (with good check-ins)
 *  this activates earned-trust; strip the rpe or the check-ins and it must not. */
function earnedLog(priorWeeks = 4, rpe = 4): RunState {
  const s: RunState = {};
  for (let w = 1; w <= priorWeeks; w++) {
    const mon = addDaysStr(CURR, -7 * w);
    for (const off of [0, 1, 2, 3, 4]) { const d = addDaysStr(mon, off); s[d] = run(d, 4, { rpe }); }
  }
  for (const off of [0, 1, 2, 3, 4]) { const d = addDaysStr(CURR, off); if (d <= TODAY) s[d] = run(d, 4, { rpe }); }
  return s;
}
/** Same weeks/adherence but NO rpe recorded (missing optional data). */
function cleanNoRpe(priorWeeks = 4): RunState {
  const s: RunState = {};
  for (let w = 1; w <= priorWeeks; w++) {
    const mon = addDaysStr(CURR, -7 * w);
    for (const off of [0, 1, 2, 3, 4]) { const d = addDaysStr(mon, off); s[d] = run(d, 4); }
  }
  for (const off of [0, 1, 2, 3, 4]) { const d = addDaysStr(CURR, off); if (d <= TODAY) s[d] = run(d, 4); }
  return s;
}

const base = settingsFor();
const identity = buildWeekConfigsFromSettings(base);
const profOf = (log: RunState, g: GlobalState) => computeAdaptiveProfile(log, g, TODAY, base);
const modOf = (log: RunState, g: GlobalState) => toModulation(profOf(log, g));

// A clean/eligible EarnedTrustInput; each test toggles ONE field to isolate a rule.
const RPE_STABLE: RpeTrend = { status: 'stable', samples: 5, olderMean: 4, recentMean: 4, delta: 0 };
const RPE_RISING: RpeTrend = { status: 'rising', samples: 5, olderMean: 3, recentMean: 5, delta: 2 };
const RPE_NONE: RpeTrend = { status: 'insufficient', samples: 1, olderMean: 0, recentMean: 0, delta: 0 };
const DRIFT_FLAT: PainDrift = { status: 'stable', samples: 3, olderMean: 0, recentMean: 0, delta: 0 };
const DRIFT_RISING: PainDrift = { status: 'rising', samples: 4, olderMean: 0, recentMean: 2, delta: 2 };
const REC_NORMAL: RecoverySignal = { status: 'normal', weeksConsidered: 2, cautionWeeks: 0, repeated: false, latestFlags: null };
const REC_NONE: RecoverySignal = { status: 'insufficient', weeksConsidered: 0, cautionWeeks: 0, repeated: false, latestFlags: null };
const REC_POOR: RecoverySignal = { status: 'poor', weeksConsidered: 2, cautionWeeks: 2, repeated: true, latestFlags: null };
const REC_CAUTION: RecoverySignal = { status: 'caution', weeksConsidered: 1, cautionWeeks: 1, repeated: false, latestFlags: null };

function etInput(patch: Partial<EarnedTrustInput> = {}): EarnedTrustInput {
  return {
    onBreak: false, cleanWeeks: 4, adherence: 0.9, growthFactor: 1, holdLong: false,
    breachDays90: 0, unsettledRate: 0, rpeTrend: RPE_STABLE, painDrift: DRIFT_FLAT, recovery: REC_NORMAL,
    ...patch,
  };
}

// ════════════════════════════════════════════════════════════
// assessEarnedTrust — the pure verdict (precise rule coverage)
// ════════════════════════════════════════════════════════════
describe('assessEarnedTrust — evidence gates', () => {
  it('the fully-clean input activates trust at the earned cap', () => {
    const e = assessEarnedTrust(etInput());
    expect(e.active).toBe(true);
    expect(e.growthMax).toBe(EARNED_CAP);
    expect(e.blockedBy).toBeNull();
    expect(e.reason).toMatch(/earned-trust active/i);
  });

  it('(1) no data at all → inactive, default cap, framed as "not yet earned"', () => {
    const e = assessEarnedTrust(etInput({ cleanWeeks: 0, adherence: 0, rpeTrend: RPE_NONE, recovery: REC_NONE }));
    expect(e.active).toBe(false);
    expect(e.growthMax).toBe(DEFAULT_CAP);
    expect(e.blockedBy).toBeNull();
    expect(e.reason).toMatch(/normal safety cap active/i);
  });

  it('(2) missing RPE (insufficient trend) → inactive even with everything else clean', () => {
    expect(assessEarnedTrust(etInput({ rpeTrend: RPE_NONE })).active).toBe(false);
  });

  it('(3) missing check-ins (insufficient recovery) → inactive even with everything else clean', () => {
    expect(assessEarnedTrust(etInput({ recovery: REC_NONE })).active).toBe(false);
    // one lone check-in is not "enough evidence" either
    const oneWeek: RecoverySignal = { ...REC_NORMAL, weeksConsidered: 1 };
    expect(assessEarnedTrust(etInput({ recovery: oneWeek })).active).toBe(false);
  });

  it('(5) too few clean weeks / weak adherence → inactive (earn slowly)', () => {
    expect(assessEarnedTrust(etInput({ cleanWeeks: ET.MIN_CLEAN_WEEKS - 1 })).active).toBe(false);
    expect(assessEarnedTrust(etInput({ adherence: ET.MIN_ADHERENCE - 0.05 })).active).toBe(false);
  });

  it('(7) a recovery window that once dipped to caution (even if recovered) is not clean evidence', () => {
    const recovered: RecoverySignal = { status: 'normal', weeksConsidered: 3, cautionWeeks: 1, repeated: false, latestFlags: null };
    expect(assessEarnedTrust(etInput({ recovery: recovered })).active).toBe(false);
  });
});

describe('assessEarnedTrust — instant-revocation vetoes', () => {
  const cases: Array<[string, Partial<EarnedTrustInput>, RegExp]> = [
    ['(16) break mode', { onBreak: true }, /break mode/i],
    ['(11) pain breach', { breachDays90: 1, growthFactor: 0.85 }, /pain-cap breach/i],
    ['(17) forced deload (a breach in 90d)', { breachDays90: 2, growthFactor: 0.7 }, /pain-cap breach/i],
    ['unsettled pain', { unsettledRate: 0.5, growthFactor: 0.8 }, /slow to settle/i],
    ['(12) pain drift', { painDrift: DRIFT_RISING, growthFactor: 0.85 }, /soreness is drifting up/i],
    ['(13) rising RPE', { rpeTrend: RPE_RISING, growthFactor: 0.85 }, /rpe is trending up/i],
    ['(14) poor recovery', { recovery: REC_POOR, growthFactor: 0.7 }, /poor recovery/i],
    ['(14) cautionary recovery', { recovery: REC_CAUTION, growthFactor: 0.85 }, /cautionary recovery/i],
    ['(15) long-run hold', { holdLong: true }, /long run needs another/i],
    ['residual easing backstop', { growthFactor: 0.85 }, /caution signal is easing/i],
  ];
  for (const [name, patch, re] of cases) {
    it(`${name} disables earned-trust with a specific reason`, () => {
      const e = assessEarnedTrust(etInput(patch));
      expect(e.active).toBe(false);
      expect(e.growthMax).toBe(DEFAULT_CAP);
      expect(e.blockedBy).toMatch(re);
      expect(e.reason).toMatch(/paused/i);
    });
  }

  it('the earned cap never exceeds the hard ceiling, by definition', () => {
    expect(assessEarnedTrust(etInput()).growthMax).toBeLessThanOrEqual(ET.HARD_CEILING + 1e-9);
    expect(EARNED_CAP).toBeLessThanOrEqual(ET.HARD_CEILING + 1e-9);
  });
});

// ════════════════════════════════════════════════════════════
// computeAdaptiveProfile — folding into the real profile / modulation
// ════════════════════════════════════════════════════════════
describe('computeAdaptiveProfile — earned-trust from a real log', () => {
  it('(4) enough clean recent evidence activates earned-trust (cap in the modulation)', () => {
    const p = profOf(earnedLog(), globals({ checkins: goodCheckins() }));
    expect(p.earnedTrust.active).toBe(true);
    expect(p.earnedTrust.cleanWeeks).toBeGreaterThanOrEqual(ET.MIN_CLEAN_WEEKS);
    expect(p.growthFactor).toBe(1); // earned-trust never eases; it widens the cap
    const mod = toModulation(p);
    expect(mod.earnedGrowthMax).toBe(EARNED_CAP);
    expect(p.reasons.join(' ')).toMatch(/earned-trust active/i);
    expect(p.headline).toMatch(/earned/i);
  });

  it('(2) missing RPE → no earned-trust (clean weeks + check-ins alone are not enough)', () => {
    const p = profOf(cleanNoRpe(), globals({ checkins: goodCheckins() }));
    expect(p.rpeTrend.status).toBe('insufficient');
    expect(p.earnedTrust.active).toBe(false);
    expect(toModulation(p).earnedGrowthMax).toBeUndefined();
  });

  it('(3) missing check-ins → no earned-trust (clean weeks + RPE alone are not enough)', () => {
    const p = profOf(earnedLog(), globals()); // no checkins map
    expect(p.recovery.status).toBe('insufficient');
    expect(p.earnedTrust.active).toBe(false);
    expect(toModulation(p).earnedGrowthMax).toBeUndefined();
  });

  it('(5) one clean week + one check-in does NOT activate (earn slowly)', () => {
    const p = profOf(earnedLog(1), globals({ checkins: checkins(ci(CURR)) }));
    expect(p.earnedTrust.active).toBe(false);
  });

  it('(23) missing optional data does not punish — default progression is intact', () => {
    const p = profOf(cleanNoRpe(), globals());
    expect(p.growthFactor).toBe(1);
    expect(p.earnedTrust.active).toBe(false);
    // byte-identical to the no-modulation default plan
    expect(buildWeekConfigsFromSettings(base, undefined, toModulation(p))).toEqual(identity);
  });

  it('(22) a caution signal overrides earned-trust: eligible weeks + rising RPE → eased, not widened', () => {
    // Same eligible log/check-ins, but the recent RPE is now rising.
    const risingRpe = earnedLog();
    for (const off of [0, 1, 2]) { // make the recent current-week runs feel harder
      const d = addDaysStr(CURR, off); risingRpe[d] = run(d, 4, { rpe: 7 });
    }
    const p = profOf(risingRpe, globals({ checkins: goodCheckins() }));
    expect(p.rpeTrend.status).toBe('rising');
    expect(p.earnedTrust.active).toBe(false);              // trust revoked
    expect(p.growthFactor).toBeLessThan(1);                // caution wins
    expect(toModulation(p).earnedGrowthMax).toBeUndefined();
  });

  it('(11) a real pain breach revokes earned-trust', () => {
    const breached = earnedLog();
    const bd = addDaysStr(TODAY, -3);
    breached[bd] = run(bd, 4, { painDuring: 6 }); // above the default cap
    const p = profOf(breached, globals({ painCap: 3, checkins: goodCheckins() }));
    expect(p.earnedTrust.active).toBe(false);
    expect(p.earnedTrust.blockedBy).toMatch(/pain/i);
  });

  it('(16) break mode revokes earned-trust', () => {
    const p = profOf(earnedLog(), globals({ checkins: goodCheckins(), breakStart: addDaysStr(TODAY, -2) }));
    expect(p.earnedTrust.active).toBe(false);
    expect(p.earnedTrust.blockedBy).toMatch(/break/i);
  });
});

// ════════════════════════════════════════════════════════════
// Plan level — earned-trust widens the weekly cap, but bounds everything else
// ════════════════════════════════════════════════════════════
describe('rolling plan under active earned-trust', () => {
  const earnedMod = modOf(earnedLog(), globals({ checkins: goodCheckins() }));
  const eased = buildWeekConfigsFromSettings(base, undefined, earnedMod);

  it('the modulation genuinely carries the earned cap (so these tests bite)', () => {
    expect(earnedMod.earnedGrowthMax).toBe(EARNED_CAP);
  });

  it('(6) earned-trust builds modestly ABOVE the default on build weeks, never below', () => {
    let anyLarger = false;
    for (let i = 0; i < identity.length; i++) {
      expect(total(eased[i])).toBeGreaterThanOrEqual(total(identity[i]) - 1e-9);
      if (total(eased[i]) > total(identity[i]) + 1e-9) anyLarger = true;
    }
    expect(anyLarger).toBe(true);
    // "modest": each build week's growth stays within the earned cap (+ rounding)
    let lastBuild = total(eased[0]);
    for (let i = 1; i < eased.length; i++) {
      if (eased[i].isDownWeek || eased[i].note === 'maintain') continue;
      expect(total(eased[i])).toBeLessThanOrEqual(lastBuild * EARNED_CAP + 0.5 + 1e-9);
      lastBuild = total(eased[i]);
    }
  });

  it('(7) even a malformed oversized cap is re-clamped to the hard ceiling', () => {
    const oversized = { growthFactor: 1, downEvery: 4, holdLong: false, earnedGrowthMax: 1.5 };
    const cfgs = buildWeekConfigsFromSettings(base, undefined, oversized);
    let lastBuild = total(cfgs[0]);
    for (let i = 1; i < cfgs.length; i++) {
      if (cfgs[i].isDownWeek || cfgs[i].note === 'maintain') continue;
      expect(total(cfgs[i])).toBeLessThanOrEqual(lastBuild * ET.HARD_CEILING + 0.5 + 1e-9);
      lastBuild = total(cfgs[i]);
    }
  });

  it('(8) earned-trust never loosens the long-run ladder (long column identical to default, ≤110%/step)', () => {
    let prev = base.trailingLongest;
    for (let i = 0; i < identity.length; i++) {
      expect(long(eased[i])).toBe(long(identity[i]));           // exactly the default ladder
      expect(long(eased[i])).toBeLessThanOrEqual(nextLongFrom(prev) + 1e-9);
      if (!eased[i].isDownWeek && eased[i].note !== 'maintain') prev = long(eased[i]);
    }
  });

  it('(9) earned-trust never exceeds peakMpw', () => {
    const lowPeak = settingsFor({ peakMpw: 30 });
    const cfgs = buildWeekConfigsFromSettings(lowPeak, undefined, earnedMod);
    for (const c of cfgs) expect(total(c)).toBeLessThanOrEqual(30 + 1e-9);
  });

  it('(18) scheduled down weeks remain down weeks under earned-trust', () => {
    // downEvery 4 → index 3 (week 4) and index 7 (week 8) are scheduled downs.
    for (const i of [3, 7]) {
      expect(eased[i].isDownWeek).toBe(true);
      expect(total(eased[i])).toBeLessThan(total(eased[i - 1])); // a genuine dip off the build
    }
  });

  it('(19) weeksShown stays display-only — first N weeks identical when the window grows', () => {
    const short = buildWeekConfigsFromSettings(base, 7, earnedMod);
    const long12 = buildWeekConfigsFromSettings(base, 12, earnedMod);
    for (let i = 0; i < 7; i++) expect(long12[i]).toEqual(short[i]);
  });

  it('no fake taper appears under earned-trust', () => {
    expect(eased.every(c => c.note !== 'taper')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Preservation — locked weeks, logged runs, return-from-break (10, 24, 25)
// ════════════════════════════════════════════════════════════
describe('preservation under active earned-trust', () => {
  const lockBase = settingsFor({ startDate: PLAN_START_DATE, xcStartDate: addDaysStr(PLAN_START_DATE, 30 * 7) });
  const LOCK_TODAY = addDaysStr(PLAN_START_DATE, 8); // inside week 2
  const CUR_WK = mondayOf(LOCK_TODAY);
  // Build an eligible log anchored to the locked scenario's "today".
  function earnedLogAt(todayStr: string): RunState {
    const cur = mondayOf(todayStr);
    const s: RunState = {};
    for (let w = 1; w <= 4; w++) { const m = addDaysStr(cur, -7 * w); for (const o of [0,1,2,3,4]) { const d = addDaysStr(m, o); s[d] = run(d, 4, { rpe: 4 }); } }
    for (const o of [0,1,2,3,4]) { const d = addDaysStr(cur, o); if (d <= todayStr) s[d] = run(d, 4, { rpe: 4 }); }
    return s;
  }
  const LOG = earnedLogAt(LOCK_TODAY);
  const g = globals({ checkins: checkins(ci(CUR_WK), ci(addDaysStr(CUR_WK, -7))) });
  const earnedMod = toModulation(computeAdaptiveProfile(LOG, g, LOCK_TODAY, lockBase));

  it('the modulation is genuinely active (so the test bites)', () => {
    expect(earnedMod.earnedGrowthMax).toBe(EARNED_CAP);
  });

  it('(10/24) locked weeks are identical with or without earned-trust', () => {
    const plain = resolveEffectivePlan(lockBase, LOG, LOCK_TODAY);
    const widened = resolveEffectivePlan(lockBase, LOG, LOCK_TODAY, { modulation: earnedMod });
    for (const ws of [PLAN_START_DATE, addDaysStr(PLAN_START_DATE, 7)]) {
      const a = plain.plan.weeks.find(w => w.startDate === ws)!;
      const b = widened.plan.weeks.find(w => w.startDate === ws)!;
      expect(b.totalPlanned).toBe(a.totalPlanned);
      expect(b.runDays.map(d => d.prescribed)).toEqual(a.runDays.map(d => d.prescribed));
    }
  });

  it('(10) a future unlocked week IS widened (≥ the default), proving earned-trust reaches the plan', () => {
    const plain = resolveEffectivePlan(lockBase, LOG, LOCK_TODAY);
    const widened = resolveEffectivePlan(lockBase, LOG, LOCK_TODAY, { modulation: earnedMod });
    const futStart = addDaysStr(PLAN_START_DATE, 8 * 7);
    const a = plain.plan.weeks.find(w => w.startDate === futStart)!;
    const b = widened.plan.weeks.find(w => w.startDate === futStart)!;
    expect(b.totalPlanned).toBeGreaterThanOrEqual(a.totalPlanned - 1e-9);
  });

  it('(24) the run log is never mutated by plan resolution', () => {
    const snapshot = JSON.parse(JSON.stringify(LOG));
    resolveEffectivePlan(lockBase, LOG, LOCK_TODAY, { modulation: earnedMod });
    expect(LOG).toEqual(snapshot);
  });

  it('(25) return-from-break: an earned mod does not re-baseline to the old static plan', () => {
    const reseedStart = addDaysStr(PLAN_START_DATE, 30 * 7);
    const TODAY_RS = addDaysStr(reseedStart, -3);
    const { settings: reseeded } = returnFromBreak(
      settingsFor({ startDate: PLAN_START_DATE }), {}, TODAY_RS, addDaysStr(TODAY_RS, -30), NOW,
    );
    // Force the reseeded start onto a clean, low seed so the test is unambiguous.
    const reseed = { ...reseeded, startMpw: 8, peakMpw: 30, trailingLongest: 4, xcStartDate: addDaysStr(reseeded.startDate, 40 * 7) };
    const bodyMod = { growthFactor: 1, downEvery: reseed.downEvery, holdLong: false, earnedGrowthMax: EARNED_CAP };
    const plain = resolveEffectivePlan(reseed, {}, TODAY_RS);
    const widened = resolveEffectivePlan(reseed, {}, TODAY_RS, { modulation: bodyMod });
    // Week 0 seeds from the conservative reseeded startMpw (~8), NOT the static 20.
    expect(plain.plan.weeks[0].totalPlanned).toBeLessThan(15);
    expect(widened.plan.weeks[0].totalPlanned).toBe(plain.plan.weeks[0].totalPlanned); // seed is mod-independent
    // A later build week under earned-trust is ≥ the plain plan (widened, not reset).
    expect(widened.plan.weeks[6].totalPlanned).toBeGreaterThanOrEqual(plain.plan.weeks[6].totalPlanned - 1e-9);
  });
});

// ════════════════════════════════════════════════════════════
// Byte-identical guarantee when inactive (21)
// ════════════════════════════════════════════════════════════
describe('(21) inactive earned-trust ⇒ Phase 2B behavior is byte-identical', () => {
  it('toModulation omits earnedGrowthMax entirely when inactive', () => {
    const mod = modOf(cleanNoRpe(), globals()); // clean weeks but no rpe / no check-ins → inactive
    expect('earnedGrowthMax' in mod).toBe(false);
    expect(mod).toEqual({ growthFactor: 1, downEvery: base.downEvery, holdLong: false });
    expect(buildWeekConfigsFromSettings(base, undefined, mod)).toEqual(identity);
  });

  it('a null/absent modulation is unchanged from the pure scaffold', () => {
    expect(buildWeekConfigsFromSettings(base, undefined, null)).toEqual(identity);
    expect(buildWeekConfigsFromSettings(base)).toEqual(identity);
  });
});

// ════════════════════════════════════════════════════════════
// Feasibility (20, 26) — distinguishes the default-safe vs earned path
// ════════════════════════════════════════════════════════════
describe('peak feasibility with earned-trust (20, 26)', () => {
  // 8 build weeks before XC: default safe max ~32 mi, earned safe max ~35 mi.
  const feas = (peak: number) => settingsFor({ peakMpw: peak, startDate: '2026-07-06', xcStartDate: '2026-08-31', weeksShown: 12 });
  const earnedMod = { growthFactor: 1, downEvery: 4, holdLong: false, earnedGrowthMax: EARNED_CAP };

  it('(26) peak 30 is feasible on the default cap; earned adds no note', () => {
    const f = assessPeakFeasibility(feas(30));
    expect(f.feasible).toBe(true);
    expect(f.earnedNote).toBeNull();
    expect(f.maxSafeReachableEarned).toBeGreaterThanOrEqual(f.maxSafeReachable);
  });

  it('(20) a peak reachable ONLY under the earned cap is flagged with the earned route', () => {
    const eff = feas(34);
    const f = assessPeakFeasibility(eff);
    expect(f.feasible).toBe(false);          // not under the default +10%/wk
    expect(f.feasibleEarned).toBe(true);     // but yes under the earned cap
    expect(f.maxSafeReachableEarned).toBeGreaterThan(f.maxSafeReachable);
    // Inactive now → the note frames earning trust as a conditional route.
    expect(f.earnedTrustActive).toBe(false);
    expect(f.earnedNote).toMatch(/earning trust|wider \+\d+%\/wk cap/i);
    // Active now → the note warns it holds only while trust stays clean.
    const fa = assessPeakFeasibility(eff, earnedMod);
    expect(fa.earnedTrustActive).toBe(true);
    expect(fa.earnedNote).toMatch(/only while earned-trust stays active/i);
    expect(fa.earnedNote).toMatch(/falls back to the safer/i);
  });

  it('(26) peak 36 is unreachable even under the earned cap; the note says so and nothing is forced', () => {
    const f = assessPeakFeasibility(feas(36));
    expect(f.feasible).toBe(false);
    expect(f.feasibleEarned).toBe(false);
    expect(f.earnedNote).toMatch(/even the earned .* cap only reaches/i);
    // The plan never forces the target: its actual build tops out below it.
    expect(f.reachedByPlan).toBeLessThan(36);
  });

  it('feasibility never assumes earned-trust from missing data (inactive mod ⇒ default reachedByPlan)', () => {
    const eff = feas(34);
    const plain = assessPeakFeasibility(eff);            // no mod
    const active = assessPeakFeasibility(eff, { growthFactor: 1, downEvery: 4, holdLong: false, earnedGrowthMax: EARNED_CAP });
    // reachedByPlan tracks the plan actually shown: wider when earned-trust is active.
    expect(active.reachedByPlan).toBeGreaterThanOrEqual(plain.reachedByPlan);
    // maxSafeReachable (the default-cap ceiling) is identical regardless.
    expect(active.maxSafeReachable).toBe(plain.maxSafeReachable);
  });
});
