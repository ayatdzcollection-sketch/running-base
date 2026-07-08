// ============================================================
// MAINTENANCE MODE — XC/coach-season phase.
//
// Before xcStartDate the plan BUILDS toward the peak (summer base).
// On/after xcStartDate it MAINTAINS: volume holds near the last build
// level (never building past the peak), the long run holds, scheduled
// down weeks still apply, and it never collapses. Coach-primary.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  defaultSettings, migrateSettings, buildWeekConfigsFromSettings, resetToRecentActuals,
} from '../settings';
import { addDaysStr } from '../metrics';
import { WEEK_CONFIGS } from '../../config/plan';
import type { RawSettings } from '../types';

const NOW = '2026-07-08T12:00:00Z';
function s(patch: Partial<RawSettings> = {}): RawSettings {
  return { ...defaultSettings(NOW), startMpw: 20, peakMpw: 30, buildStep: 1, downEvery: 4, trailingLongest: 4.5, ...patch };
}
const totals = (cfgs: { miles: number[] }[]) => cfgs.map(c => c.miles.reduce((a, b) => a + b, 0));
const longs = (cfgs: { miles: number[] }[]) => cfgs.map(c => c.miles[c.miles.length - 1]);

describe('xcStartDate wiring (default / migrate)', () => {
  it('defaults xcStartDate to just after the base block (mid-August)', () => {
    const d = defaultSettings(NOW);
    expect(d.xcStartDate).toBe(addDaysStr(d.startDate, WEEK_CONFIGS.length * 7)); // 2026-08-17
  });
  it('migrates an older settings blob by filling xcStartDate additively', () => {
    const m = migrateSettings({ startMpw: 20, peakMpw: 30 }, NOW);
    expect(m!.xcStartDate).toBe(defaultSettings(NOW).xcStartDate);
    // idempotent
    expect(migrateSettings(m, NOW)).toEqual(m);
  });
});

describe('build until XC season, then maintain', () => {
  it('the default 7-week block ends BEFORE the default XC date, so it still hands off (no maintenance)', () => {
    const cfgs = buildWeekConfigsFromSettings(s({ blockWeeks: 7 }));
    expect(cfgs.some(c => c.note === 'maintain')).toBe(false);
    expect(cfgs[cfgs.length - 1].note).toBe('handoff');
  });

  it('an extended block builds to the peak, then holds it flat through XC season', () => {
    // 12-week block, default xcStartDate 2026-08-17 → weeks 8+ are maintenance.
    const eff = s({ blockWeeks: 12, peakMpw: 30 });
    const cfgs = buildWeekConfigsFromSettings(eff);
    const t = totals(cfgs);
    const maintIdx = cfgs
      .map((c, i) => ({ c, i, ws: addDaysStr(eff.startDate, i * 7) }))
      .filter(x => x.ws >= eff.xcStartDate);

    // Peak is actually reached by the time XC season begins.
    const preMaintMax = Math.max(...t.slice(0, maintIdx[0].i));
    expect(preMaintMax).toBeGreaterThanOrEqual(30 - 1e-9);

    // Maintenance (non-down) weeks hold flat at the peak and are labeled 'maintain'
    // (except the final week, which is the 'handoff').
    const flatMaint = maintIdx.filter(x => !x.c.isDownWeek && x.i !== cfgs.length - 1);
    for (const x of flatMaint) {
      expect(t[x.i]).toBeLessThanOrEqual(30 + 1e-9);         // never past the peak
      expect(t[x.i]).toBeGreaterThan(30 * 0.75);             // held near the top, not cut
      expect(x.c.note).toBe('maintain');
    }
    // No week collapses; the final week is a handoff near the peak.
    expect(t[t.length - 1]).toBeGreaterThan(30 * 0.75);
    expect(cfgs[cfgs.length - 1].note).toBe('handoff');
  });

  it('maintenance holds the long run flat (no ladder step in-season)', () => {
    const eff = s({ blockWeeks: 12, peakMpw: 40 });
    const cfgs = buildWeekConfigsFromSettings(eff);
    const l = longs(cfgs);
    const maintStart = cfgs.findIndex((_, i) => addDaysStr(eff.startDate, i * 7) >= eff.xcStartDate);
    // Long runs are non-decreasing while building, then flat once maintaining.
    const inSeason = l.slice(maintStart);
    for (let i = 1; i < inSeason.length; i++) expect(inSeason[i]).toBeLessThanOrEqual(inSeason[0] + 1e-9);
  });

  it('if XC season starts before the block, the whole plan maintains flat (never builds)', () => {
    const cfgs = buildWeekConfigsFromSettings(s({ blockWeeks: 6, xcStartDate: '2026-06-01', startMpw: 20 }));
    const t = totals(cfgs);
    // Flat (within rounding), no runaway build, exactly one scheduled down dip.
    const builds = t.filter((_, i) => !cfgs[i].isDownWeek);
    for (const v of builds) expect(Math.abs(v - builds[0])).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(cfgs.filter(c => c.isDownWeek).length).toBe(1);
    expect(cfgs[cfgs.length - 1].note).toBe('handoff');
  });
});

describe('long run can never exceed the peak week', () => {
  it('a low peak with a high starting-long seed caps the long run at the peak (no over-peak week)', () => {
    const cfgs = buildWeekConfigsFromSettings(s({ startMpw: 11, peakMpw: 12, blockWeeks: 8, trailingLongest: 12 }));
    for (const c of cfgs) {
      const total = c.miles.reduce((a, b) => a + b, 0);
      const long = c.miles[c.miles.length - 1];
      expect(long).toBeLessThanOrEqual(12 + 1e-9);
      expect(total).toBeLessThanOrEqual(12 + 0.5 + 1e-9);
    }
  });
});

describe('season reset moves the XC line so a fresh base block builds again', () => {
  it('resetToRecentActuals sets xcStartDate just after the new block start', () => {
    const reset = resetToRecentActuals(s({ blockWeeks: 7 }), {}, '2026-09-01', NOW);
    expect(reset.xcStartDate).toBe(addDaysStr(reset.startDate, 7 * 7));
    expect(reset.xcStartDate > reset.startDate).toBe(true); // not instantly in-season
  });
});
