// ============================================================
// ENGINE STRESS AUDIT
//
// Fuzzes the whole plan engine over thousands of settings
// combinations (grid + seeded random + adversarial edges) and
// asserts a battery of SANITY invariants on every generated plan.
// The point: prove that NO settings combination — however weird —
// can produce a nonsensical plan again (the collapsing 22→16.5→…→12
// regression, a week above the peak, a long-run jump, a NaN, a
// down week that never recovers, a Week-7 taper, etc.).
//
// Two surfaces are stressed:
//   • buildWeekConfigsFromSettings — the pure scaffold builder, driven
//     with WIDE raw values (peak forced ≥ start, the one precondition
//     the clamp layer guarantees) to hammer the stepWeek/splitWeek math.
//   • resolveEffectivePlan — the full path through effectiveSettings()
//     clamps + locked-week preservation, across several run logs, also
//     asserting runState is never mutated and locked weeks never change.
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildWeekConfigsFromSettings, effectiveSettings, defaultSettings, clampBlockWeeks } from '../settings';
import { resolveEffectivePlan } from '../planOverlay';
import { getPlan, type WeekConfig } from '../../config/plan';
import { nextLongFrom, addDaysStr } from '../metrics';
import { TUNABLES } from '../../config/tunables';
import type { RawSettings, RunState } from '../types';

const NOW = '2026-06-01T12:00:00Z';
const EPS = 1e-6;

// ── A normalized view of one week for the invariant checker ──
interface WeekView { total: number; long: number; days: number; note?: string; isDown: boolean; source: 'static' | 'settings'; }

function fromConfigs(cfgs: WeekConfig[]): WeekView[] {
  return cfgs.map(c => ({
    total: c.miles.reduce((a, b) => a + b, 0),
    long: c.miles[c.miles.length - 1],
    days: c.miles.length,
    note: c.note,
    isDown: !!c.isDownWeek,
    maxDay: Math.max(...c.miles),
    source: 'settings' as const,
    miles: c.miles,
  })) as unknown as WeekView[];
}

/**
 * Run every sanity invariant over a list of weeks. Returns a list of human
 * violation strings (empty = clean). `peak` is the ceiling that settings weeks
 * must respect; `daysExpected` is the clamped run-day count.
 */
function violations(
  weeks: (WeekView & { maxDay?: number; miles?: number[] })[],
  peak: number,
  daysExpected: number,
): string[] {
  const out: string[] = [];
  const settingsWeeks = weeks.filter(w => w.source === 'settings');
  let lastBuild = -1; // last non-down week's total (the trajectory reference)

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const isSettings = w.source === 'settings';

    // (A) finite, non-negative totals & day miles
    if (!Number.isFinite(w.total) || w.total < 0) out.push(`W${i + 1}: bad total ${w.total}`);
    if (!Number.isFinite(w.long) || w.long < 0) out.push(`W${i + 1}: bad long ${w.long}`);
    if (w.miles) for (const m of w.miles) if (!Number.isFinite(m) || m < 0) out.push(`W${i + 1}: bad day mile ${m}`);

    // (B) settings weeks never exceed the peak ceiling
    if (isSettings && w.total > peak + 0.5 + EPS) out.push(`W${i + 1}: total ${w.total} > peak ${peak}`);

    // (C) a week is never smaller than its long run
    if (w.total < w.long - EPS) out.push(`W${i + 1}: total ${w.total} < long ${w.long}`);

    // (D) run-day count and long-run-is-the-max-day (settings weeks)
    if (isSettings) {
      if (w.days !== daysExpected) out.push(`W${i + 1}: days ${w.days} != ${daysExpected}`);
      if (w.maxDay != null && w.maxDay > w.long + EPS) out.push(`W${i + 1}: an easy day ${w.maxDay} exceeds long ${w.long}`);
    }

    // (F) long-run ladder continuity — never above 110% (+ half-step) of prior
    if (i > 0) {
      const prevLong = weeks[i - 1].long;
      if (w.long > nextLongFrom(prevLong) + EPS) out.push(`W${i + 1}: long ${w.long} jumps past ${nextLongFrom(prevLong)} from ${prevLong}`);
    }

    // Note vocabulary is bounded — no stray 'taper' can reappear
    if (w.note && !['down week', 'peak', 'handoff', 'maintain'].includes(w.note)) out.push(`W${i + 1}: unexpected note '${w.note}'`);
    if (w.note === 'taper') out.push(`W${i + 1}: taper note reappeared`);

    if (isSettings) {
      if (w.isDown) {
        // (G-down) a scheduled down week is a dip that never collapses: below the
        // last build, but still ≥60% of it (not a crater), and never the 1st/last.
        if (lastBuild > 0) {
          if (w.total > lastBuild + 0.5 + EPS) out.push(`W${i + 1}: 'down' ${w.total} not below build ${lastBuild}`);
          if (w.total < 0.6 * lastBuild - EPS) out.push(`W${i + 1}: down week ${w.total} collapsed below 60% of ${lastBuild}`);
        }
        if (i === 0) out.push(`W${i + 1}: down week cannot be the first week`);
        if (i === weeks.length - 1) out.push(`W${i + 1}: down week cannot be the final week`);
      } else {
        // (G-build) non-down weeks never grow more than +10% over the last build.
        if (lastBuild > 0 && w.total > lastBuild * TUNABLES.WEEKLY_GROWTH_MAX + 0.5 + EPS) {
          out.push(`W${i + 1}: build ${w.total} exceeds +10% of last build ${lastBuild}`);
        }
        lastBuild = w.total;
      }
    } else if (!w.isDown) {
      lastBuild = w.total; // locked build weeks still advance the reference
    }
  }

  // (I) the FINAL week is never a taper/down collapse — it hands off / maintains
  // near the top, never cut to a fraction of the block's biggest week.
  const last = weeks[weeks.length - 1];
  if (last && weeks.length > 1) {
    if (last.isDown) out.push(`final week is a down week`);
    if (last.note === 'taper') out.push(`final week is a taper`);
    const maxTotal = Math.max(...settingsWeeks.map(w => w.total), ...weeks.map(w => w.total));
    if (last.total < 0.6 * maxTotal - EPS) out.push(`final week ${last.total} collapsed below 60% of max ${maxTotal}`);
  }

  // (M) consecutive 'maintain' weeks are FLAT (hold, not drift) and ≤ peak.
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].note === 'maintain' && weeks[i - 1].note === 'maintain') {
      if (Math.abs(weeks[i].total - weeks[i - 1].total) > 0.6 + EPS) out.push(`W${i + 1}: maintain drifted ${weeks[i - 1].total}→${weeks[i].total}`);
    }
    if (weeks[i].note === 'maintain' && weeks[i].total > peak + 0.5 + EPS) out.push(`W${i + 1}: maintain ${weeks[i].total} > peak ${peak}`);
  }

  return out;
}

// ── Combo → raw settings ─────────────────────────────────────
function rawFrom(base: Partial<RawSettings>): RawSettings {
  return { ...defaultSettings(NOW), ...base };
}

// mulberry32 — deterministic PRNG so the fuzz is reproducible (no Math.random).
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('engine stress — the pure scaffold builder never yields a nonsensical plan', () => {
  it('deterministic grid of settings combinations all pass the sanity invariants', () => {
    const START = [10, 20, 45, 70];
    const PEAK = [12, 30, 55, 100];
    const STEP = [0.5, 1, 2, 4];
    const DOWN = [2, 3, 4, 6];
    const WEEKS = [1, 2, 4, 7, 10, 12];
    const DAYS = [3, 4, 5, 6];
    const SEED = [2, 4.5, 9, 15];
    const XC_OFFSET = [-7, 0, 28, 49, 9999]; // days from start → maintenance boundary

    const bad: string[] = [];
    let n = 0;
    for (const startMpw of START)
    for (const peakRaw of PEAK)
    for (const buildStep of STEP)
    for (const downEvery of DOWN)
    for (const blockWeeks of WEEKS)
    for (const daysPerWeek of DAYS)
    for (const trailingLongest of SEED)
    for (const xcOff of XC_OFFSET) {
      const startDate = '2026-06-29';
      const peakMpw = Math.max(peakRaw, startMpw); // the one precondition the clamp guarantees
      const eff = rawFrom({
        startDate, startMpw, peakMpw, buildStep, downEvery, blockWeeks, daysPerWeek, trailingLongest,
        xcStartDate: addDaysStr(startDate, xcOff),
      });
      const cfgs = buildWeekConfigsFromSettings(eff);
      const days = Math.round(Math.min(6, Math.max(3, daysPerWeek)));
      const v = violations(fromConfigs(cfgs), peakMpw, days);
      n++;
      if (v.length) bad.push(`[start${startMpw} peak${peakMpw} step${buildStep} down${downEvery} wk${blockWeeks} d${daysPerWeek} seed${trailingLongest} xc${xcOff}] ${v.slice(0, 3).join('; ')}`);
    }
    expect(n).toBeGreaterThan(5000);
    expect(bad.slice(0, 15)).toEqual([]); // show the first offenders if any
  });

  it('seeded random fuzz (4000 combos) all pass the sanity invariants', () => {
    const rnd = mulberry32(0xC0FFEE);
    const pick = (lo: number, hi: number, q = 0.5) => Math.round((lo + rnd() * (hi - lo)) / q) * q;
    const bad: string[] = [];
    for (let k = 0; k < 4000; k++) {
      const startMpw = pick(6, 90, 1);
      const peakMpw = Math.max(pick(8, 120, 1), startMpw);
      const buildStep = pick(0, 8, 0.5);
      const downEvery = pick(2, 7, 1);
      const blockWeeks = pick(1, 12, 1);
      const daysPerWeek = pick(3, 6, 1);
      const trailingLongest = pick(2, 18, 0.5);
      const startDate = '2026-06-29';
      const xcOff = Math.round((rnd() * 130 - 14)); // -14 .. +116 days
      const eff = rawFrom({
        startDate, startMpw, peakMpw, buildStep, downEvery, blockWeeks, daysPerWeek, trailingLongest,
        xcStartDate: addDaysStr(startDate, xcOff),
      });
      const cfgs = buildWeekConfigsFromSettings(eff);
      const days = Math.round(Math.min(6, Math.max(3, daysPerWeek)));
      const v = violations(fromConfigs(cfgs), peakMpw, days);
      if (v.length) bad.push(`#${k} [start${startMpw} peak${peakMpw} step${buildStep} down${downEvery} wk${blockWeeks} d${daysPerWeek} seed${trailingLongest} xc${xcOff}] ${v.slice(0, 2).join('; ')}`);
    }
    expect(bad.slice(0, 15)).toEqual([]);
  });

  it('adversarial edge cases produce a sane (possibly flat) plan, never garbage', () => {
    const edges: Partial<RawSettings>[] = [
      { startMpw: 8, peakMpw: 8, blockWeeks: 1, daysPerWeek: 3, buildStep: 4, trailingLongest: 2 },
      { startMpw: 80, peakMpw: 80, blockWeeks: 12, downEvery: 2, daysPerWeek: 6, buildStep: 0.5 },
      { startMpw: 20, peakMpw: 100, blockWeeks: 12, buildStep: 8, downEvery: 3, trailingLongest: 15 },
      { startMpw: 20, peakMpw: 21, blockWeeks: 8, buildStep: 4, downEvery: 4 }, // near-flat build
      { startMpw: 30, peakMpw: 30, blockWeeks: 6, xcStartDate: '2026-06-01' }, // all maintenance
      { startMpw: 12, peakMpw: 60, blockWeeks: 10, xcStartDate: '2026-07-13' }, // maintenance mid-build
      { startMpw: 15, peakMpw: 40, blockWeeks: 2, downEvery: 2 }, // shortest multi-week
    ];
    for (const e of edges) {
      const eff = rawFrom({ startDate: '2026-06-29', ...e });
      const cfgs = buildWeekConfigsFromSettings(eff);
      const days = Math.round(Math.min(6, Math.max(3, eff.daysPerWeek)));
      const v = violations(fromConfigs(cfgs), eff.peakMpw, days);
      expect(v, JSON.stringify(e)).toEqual([]);
      expect(cfgs.length).toBe(clampBlockWeeks(eff.blockWeeks));
    }
  });
});

// ── Full path: effectiveSettings clamps + locked-week preservation ──

function planToViews(planWeeks: ReturnType<typeof resolveEffectivePlan>['plan']['weeks'], src: Map<string, 'static' | 'settings'>): (WeekView & { maxDay: number; miles: number[] })[] {
  return planWeeks.map(w => {
    const miles = w.runDays.map(d => d.prescribed ?? 0);
    return {
      total: w.totalPlanned, long: w.longRunCap, days: w.runDays.length,
      note: w.note, isDown: w.isDownWeek, source: src.get(w.startDate) ?? 'settings',
      maxDay: miles.length ? Math.max(...miles) : 0, miles,
    };
  });
}

describe('engine stress — resolveEffectivePlan preserves locks, never mutates state, stays sane', () => {
  // A few representative run logs, incl. a completed week + partial current week.
  const logs: Record<string, RunState> = {
    empty: {},
    w1done: {
      '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.2, updated_at: NOW },
      '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: NOW },
      '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: NOW },
      '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.5, updated_at: NOW },
      '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW },
    },
    w1w2partial: {
      '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.2, updated_at: NOW },
      '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW },
      '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, painDuring: 2, updated_at: NOW },
    },
  };
  const TODAY = '2026-07-08'; // Wed of Week 2

  it('grid of settings × run logs: locks preserved, runState untouched, plan sane', () => {
    const START = [12, 20, 40];
    const PEAK = [22, 30, 60];
    const STEP = [0.5, 2, 4];
    const DOWN = [3, 4];
    const WEEKS = [4, 7, 10];
    const DAYS = [4, 5];
    const XC = ['2026-08-17', '2026-07-20', '2026-09-30']; // after / during / far after

    const bad: string[] = [];
    const staticFirstTwo = getPlan().weeks.slice(0, 2).map(w => w.totalPlanned);

    for (const [logName, log] of Object.entries(logs))
    for (const startMpw of START)
    for (const peakMpw of PEAK)
    for (const buildStep of STEP)
    for (const downEvery of DOWN)
    for (const blockWeeks of WEEKS)
    for (const daysPerWeek of DAYS)
    for (const xcStartDate of XC) {
      const raw = rawFrom({ startMpw, peakMpw, buildStep, downEvery, blockWeeks, daysPerWeek, xcStartDate });
      const snapshot = JSON.stringify(log);
      const { plan, weekSource } = resolveEffectivePlan(raw, log, TODAY);
      const eff = effectiveSettings(raw, log, TODAY).eff;
      const days = Math.round(Math.min(6, Math.max(3, daysPerWeek)));

      // runState must never be mutated by resolving a plan.
      if (JSON.stringify(log) !== snapshot) bad.push(`[${logName}] runState mutated`);

      // Locked weeks (W1/W2 when the log covers them) keep the static prescription.
      if (logName !== 'empty') {
        const w1 = plan.weeks.find(w => w.startDate === '2026-06-29');
        const w2 = plan.weeks.find(w => w.startDate === '2026-07-06');
        if (w1 && weekSource.get('2026-06-29') !== 'static') bad.push(`[${logName}] W1 not locked`);
        if (w1 && Math.abs(w1.totalPlanned - staticFirstTwo[0]) > EPS) bad.push(`[${logName}] W1 total changed`);
        if (w2 && Math.abs(w2.totalPlanned - staticFirstTwo[1]) > EPS) bad.push(`[${logName}] W2 total changed`);
      }

      const v = violations(planToViews(plan.weeks, weekSource), eff.peakMpw, days);
      if (v.length) bad.push(`[${logName} start${startMpw} peak${peakMpw} step${buildStep} down${downEvery} wk${blockWeeks} d${daysPerWeek} xc${xcStartDate}] ${v.slice(0, 2).join('; ')}`);
    }
    expect(bad.slice(0, 15)).toEqual([]);
  });
});
