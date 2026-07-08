// ============================================================
// PEAK FEASIBILITY — the diagnostic never lets the engine cheat, and
// correctly reports when a target peak can't be safely reached before XC.
// ============================================================

import { describe, it, expect } from 'vitest';
import { assessPeakFeasibility } from '../feasibility';
import { resolveEffectivePlan } from '../planOverlay';
import { defaultSettings, effectiveSettings } from '../settings';
import { nextLongFrom } from '../metrics';
import type { RawSettings, RunState, PlanWeek } from '../types';

const NOW = '2026-07-08T12:00:00Z';
const TODAY = '2026-07-08';

function scenarioLog(): RunState {
  return {
    '2026-06-29': { date: '2026-06-29', done: true, miles_actual: 4.2, updated_at: NOW },
    '2026-06-30': { date: '2026-06-30', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-01': { date: '2026-07-01', done: true, miles_actual: 4.0, updated_at: NOW },
    '2026-07-02': { date: '2026-07-02', done: true, miles_actual: 3.5, updated_at: NOW },
    '2026-07-03': { date: '2026-07-03', done: true, miles_actual: 4.5, updated_at: NOW },
    '2026-07-06': { date: '2026-07-06', done: true, miles_actual: 4.5, updated_at: NOW },
    '2026-07-07': { date: '2026-07-07', done: true, miles_actual: 4.5, updated_at: NOW },
  };
}
function s(patch: Partial<RawSettings> = {}): RawSettings {
  return {
    ...defaultSettings(NOW), startMpw: 20, downEvery: 4, weeksShown: 7, trailingLongest: 4.5,
    startDate: '2026-06-29', xcStartDate: '2026-08-17', buildStep: 2, peakMpw: 30, ...patch,
  };
}
const eff = (patch: Partial<RawSettings> = {}) => effectiveSettings(s(patch), {}, TODAY).eff;
const totals = (ws: PlanWeek[]) => ws.map(w => w.totalPlanned);

describe('detects an infeasible peak (safety caps prevent reaching it before XC)', () => {
  it('peak 30 before XC is feasible and delivered', () => {
    const f = assessPeakFeasibility(eff({ peakMpw: 30 }));
    expect(f.feasible).toBe(true);
    expect(f.delivering).toBe(true);
    expect(f.reasons).toEqual([]);
  });

  it('peak 35 before XC is infeasible (7 build weeks cannot safely reach it)', () => {
    const f = assessPeakFeasibility(eff({ peakMpw: 35 }));
    expect(f.feasible).toBe(false);
    expect(f.limiter).toBe('time');
    expect(f.reasons.length).toBeGreaterThan(0);
    expect(f.suggestions.length).toBeGreaterThan(0);
  });

  it('reports the safe reachable peak (~30–32) and the target', () => {
    const f = assessPeakFeasibility(eff({ peakMpw: 35 }));
    expect(f.targetPeak).toBe(35);
    expect(f.maxSafeReachable).toBeGreaterThanOrEqual(30);
    expect(f.maxSafeReachable).toBeLessThan(35);      // genuinely short of the target
    expect(f.reachedByPlan).toBeGreaterThanOrEqual(29);
    expect(f.reachedByPlan).toBeLessThan(35);
  });
});

describe('weeksShown does NOT affect feasibility (it is display-only)', () => {
  it('the assessment is identical for a 7- and a 20-week display window', () => {
    const a = assessPeakFeasibility(eff({ peakMpw: 35, weeksShown: 7 }));
    const b = assessPeakFeasibility(eff({ peakMpw: 35, weeksShown: 20 }));
    expect(a.feasible).toBe(b.feasible);
    expect(a.maxSafeReachable).toBe(b.maxSafeReachable);
    expect(a.buildWeeks).toBe(b.buildWeeks);
  });
});

describe('the diagnostic never lets the engine break a safety cap to hit an infeasible peak', () => {
  it('no week exceeds peakMpw even when the target is infeasible', () => {
    const weeks = resolveEffectivePlan(s({ peakMpw: 35 }), scenarioLog(), TODAY).plan.weeks;
    for (const w of weeks) expect(w.totalPlanned).toBeLessThanOrEqual(35 + 1e-9);
  });

  it('no build week grows more than +10% over the last build week', () => {
    const weeks = resolveEffectivePlan(s({ peakMpw: 35, buildStep: 4 }), scenarioLog(), TODAY).plan.weeks;
    const t = totals(weeks);
    let lastBuild = t[1];
    for (let i = 2; i < weeks.length; i++) {
      if (weeks[i].isDownWeek) continue;
      expect(t[i]).toBeLessThanOrEqual(lastBuild * 1.1 + 0.5 + 1e-9);
      lastBuild = t[i];
    }
  });

  it('the long-run ladder still obeys ≤110%/step under an infeasible peak', () => {
    const weeks = resolveEffectivePlan(s({ peakMpw: 35 }), scenarioLog(), TODAY).plan.weeks;
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i].longRunCap).toBeLessThanOrEqual(nextLongFrom(weeks[i - 1].longRunCap) + 1e-9);
    }
  });

  it('assessing feasibility never mutates settings or run state', () => {
    const raw = s({ peakMpw: 35 });
    const rawSnap = JSON.stringify(raw);
    const log = scenarioLog();
    const logSnap = JSON.stringify(log);
    assessPeakFeasibility(effectiveSettings(raw, log, TODAY).eff);
    expect(JSON.stringify(raw)).toBe(rawSnap);
    expect(JSON.stringify(log)).toBe(logSnap);
  });
});

describe('completed weeks stay locked and logged runs are preserved under an infeasible peak', () => {
  it('W1/W2 keep their locked prescription; the plan builds then maintains, never a fake handoff/taper', () => {
    const { plan, weekSource } = resolveEffectivePlan(s({ peakMpw: 35 }), scenarioLog(), TODAY);
    expect(weekSource.get('2026-06-29')).toBe('static');
    expect(weekSource.get('2026-07-06')).toBe('static');
    for (const w of plan.weeks) expect(w.note).not.toBe('handoff');
    for (const w of plan.weeks) expect(w.note).not.toBe('taper');
  });
});

describe('fixes can make a previously infeasible target feasible (under the rules)', () => {
  it('adding a run day fixes a DISTRIBUTION-limited peak (3 days → 4 days)', () => {
    const three = assessPeakFeasibility(eff({ peakMpw: 28, daysPerWeek: 3 }));
    expect(three.feasible).toBe(false);
    expect(three.limiter).toBe('distribution');
    const four = assessPeakFeasibility(eff({ peakMpw: 28, daysPerWeek: 4 }));
    expect(four.feasible).toBe(true);
  });

  it('moving the XC date later fixes a TIME-limited peak (Aug 17 → Oct 19)', () => {
    const early = assessPeakFeasibility(eff({ peakMpw: 35, xcStartDate: '2026-08-17' }));
    expect(early.feasible).toBe(false);
    const later = assessPeakFeasibility(eff({ peakMpw: 35, xcStartDate: '2026-10-19' }));
    expect(later.feasible).toBe(true);
    expect(later.buildWeeks).toBeGreaterThan(early.buildWeeks);
  });

  it('with no XC boundary the target is always feasible (rolling plan)', () => {
    const f = assessPeakFeasibility(eff({ peakMpw: 50, xcStartDate: '' }));
    expect(f.hasBoundary).toBe(false);
    expect(f.feasible).toBe(true);
  });
});

describe('feasible-but-underdelivering (buildstep floor too low)', () => {
  it('a reachable peak with a tiny build step flags the build step, not the peak', () => {
    const f = assessPeakFeasibility(eff({ peakMpw: 28, buildStep: 0.5 }));
    expect(f.feasible).toBe(true);
    expect(f.delivering).toBe(false);
    expect(f.limiter).toBe('buildstep');
  });
});

// ── Run-days as a feasibility route ──────────────────────────
// The solver probes whether ONE more run day (a higher distribution ceiling)
// would help. It suggests it only when it genuinely does — never a blanket
// "add days". Uses RAW settings (no clamp) to control the long-run seed.

function raw(patch: Partial<RawSettings> = {}): RawSettings {
  return {
    ...defaultSettings(NOW), startMpw: 20, downEvery: 4, weeksShown: 7, trailingLongest: 4.5,
    startDate: '2026-06-29', xcStartDate: '2026-08-17', buildStep: 2, daysPerWeek: 4, peakMpw: 32, ...patch,
  };
}

describe('run-days route: adding a day is offered only when it actually helps', () => {
  it('a DISTRIBUTION-limited peak reports a days route that makes it feasible (4d → 5d)', () => {
    const four = assessPeakFeasibility(raw({ peakMpw: 32, daysPerWeek: 4 }));
    expect(four.feasible).toBe(false);
    expect(four.limiter).toBe('distribution');
    expect(four.daysRoute).not.toBeNull();
    expect(four.daysRoute!.toDays).toBe(5);
    expect(four.daysRoute!.feasible).toBe(true);
    // and actually switching to 5 days is feasible
    expect(assessPeakFeasibility(raw({ peakMpw: 32, daysPerWeek: 5 })).feasible).toBe(true);
    // the suggestion text names the route
    expect(four.suggestions.some(x => /Add a 5th easy day/.test(x))).toBe(true);
  });

  it('the same target with 5 days reaches a HIGHER safe max than with 4 days', () => {
    const four = assessPeakFeasibility(raw({ peakMpw: 40, daysPerWeek: 4 }));
    const five = assessPeakFeasibility(raw({ peakMpw: 40, daysPerWeek: 5 }));
    expect(five.maxSafeReachable).toBeGreaterThan(four.maxSafeReachable);
  });

  it('a TIME-limited peak does NOT falsely offer a days route (peak 35, 5 days)', () => {
    const f = assessPeakFeasibility(raw({ peakMpw: 35, daysPerWeek: 5 }));
    expect(f.feasible).toBe(false);
    expect(f.limiter).toBe('time');
    expect(f.daysRoute).toBeNull();
    // it honestly says more days won't help
    expect(f.reasons.some(x => /More run days won't raise this/.test(x))).toBe(true);
  });

  it('at 6 days there is no further days route to offer (range maxed)', () => {
    const f = assessPeakFeasibility(raw({ peakMpw: 45, daysPerWeek: 6 }));
    expect(f.daysRoute).toBeNull();
  });

  it('assessing the days route never mutates settings', () => {
    const r = raw({ peakMpw: 32, daysPerWeek: 4 });
    const snap = JSON.stringify(r);
    assessPeakFeasibility(r);
    expect(JSON.stringify(r)).toBe(snap);
  });

  it('weeksShown does not change the days route (display-only)', () => {
    const a = assessPeakFeasibility(raw({ peakMpw: 32, daysPerWeek: 4, weeksShown: 7 }));
    const b = assessPeakFeasibility(raw({ peakMpw: 32, daysPerWeek: 4, weeksShown: 20 }));
    expect(a.daysRoute?.toDays).toBe(b.daysRoute?.toDays);
    expect(a.daysRoute?.reachable).toBe(b.daysRoute?.reachable);
    expect(a.maxSafeReachable).toBe(b.maxSafeReachable);
  });
});

describe('switching to more run days distributes safely (engine, not the diagnostic)', () => {
  it('a 6-day plan keeps every easy day ≤ the long run and does not jump week-over-week', () => {
    const weeks = resolveEffectivePlan(s({ peakMpw: 35, daysPerWeek: 6 }), scenarioLog(), TODAY).plan.weeks;
    // Future (settings-sourced) weeks use 6 days; locked W1/W2 keep their static 5-day prescription.
    for (const w of weeks.filter(x => x.startDate >= '2026-07-13')) {
      const miles = w.runDays.map(d => d.prescribed ?? 0);
      const long = miles[miles.length - 1];
      for (const m of miles) expect(m).toBeLessThanOrEqual(long + 1e-9); // no easy/added day above the long run
      expect(w.runDays.length).toBe(6);
    }
    const t = totals(weeks);
    let lastBuild = t[1];
    for (let i = 2; i < weeks.length; i++) {
      if (weeks[i].isDownWeek) continue;
      expect(t[i]).toBeLessThanOrEqual(lastBuild * 1.1 + 0.5 + 1e-9); // no uncontrolled jump
      lastBuild = t[i];
    }
  });

  it('changing days/week does not mutate the run log', () => {
    const log = scenarioLog();
    const snap = JSON.stringify(log);
    resolveEffectivePlan(s({ daysPerWeek: 5 }), log, TODAY);
    resolveEffectivePlan(s({ daysPerWeek: 6 }), log, TODAY);
    expect(JSON.stringify(log)).toBe(snap);
  });
});
