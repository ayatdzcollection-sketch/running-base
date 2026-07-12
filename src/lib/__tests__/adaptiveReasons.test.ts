// ============================================================
// M2 — a growth reduction is never silent.
//
// A single pain-cap breach aged 15–90 days multiplies growthFactor by 0.85
// but previously pushed NO reason, so the body-response banner rendered with
// an empty bullet list. These tests pin: every pain-history reduction carries
// a concise, matching reason.
// ============================================================

import { describe, it, expect } from 'vitest';
import { computeAdaptiveProfile } from '../adaptive';
import { defaultGlobalState } from '../migrate';
import { addDaysStr } from '../metrics';
import type { RunState } from '../types';

const NOW = '2026-07-07T12:00:00Z';
const TODAY = '2026-07-07';

function run(date: string, miles: number, extra: Partial<RunState[string]> = {}): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z', ...extra };
}

/** Solid recent adherence (9 runs in the last 14 days) so no other easing fires. */
function cleanRecent(log: RunState): RunState {
  for (const d of ['2026-06-24', '2026-06-25', '2026-06-26', '2026-06-29', '2026-06-30',
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06']) {
    log[d] = run(d, 4);
  }
  return log;
}

describe('(13) an older pain-history reduction always includes a non-empty reason', () => {
  it('one breach 30 days ago: growthFactor 0.85 AND a visible pain-history reason', () => {
    const log = cleanRecent({ '2026-06-07': run('2026-06-07', 4, { painDuring: 4 }) }); // breach (cap 3)
    const p = computeAdaptiveProfile(log, defaultGlobalState(NOW), TODAY, null);
    expect(p.growthFactor).toBeCloseTo(0.85, 5);
    expect(p.reasons.length).toBeGreaterThan(0);
    expect(p.reasons.join(' ')).toMatch(/pain day above your cap/i);
  });

  it('a RECENT breach keeps the existing two-week line (no duplicate 90-day line)', () => {
    const recent = addDaysStr(TODAY, -2); // not one of the cleanRecent dates
    const log = cleanRecent({});
    log[recent] = run(recent, 4, { painDuring: 4 });
    const p = computeAdaptiveProfile(log, defaultGlobalState(NOW), TODAY, null);
    expect(p.growthFactor).toBeLessThan(1);
    expect(p.reasons.join(' ')).toMatch(/pain day in the last two weeks/i);
    expect(p.reasons.join(' ')).not.toMatch(/pain day above your cap in the last 90 days/i);
  });

  it('invariant: any pain-driven reduction ⇒ reasons is non-empty (banner never renders blank)', () => {
    const scenarios: RunState[] = [
      cleanRecent({ '2026-06-07': run('2026-06-07', 4, { painDuring: 4 }) }),          // old lone breach
      cleanRecent({ [addDaysStr(TODAY, -3)]: run(addDaysStr(TODAY, -3), 4, { painDuring: 5 }) }), // recent breach
      cleanRecent({
        '2026-05-20': run('2026-05-20', 4, { painDuring: 4 }),
        '2026-06-01': run('2026-06-01', 4, { painDuring: 4 }),
        '2026-06-10': run('2026-06-10', 4, { painDuring: 4 }),
      }), // several old breaches
    ];
    for (const log of scenarios) {
      const p = computeAdaptiveProfile(log, defaultGlobalState(NOW), TODAY, null);
      if (p.growthFactor < 1 - 1e-9) {
        expect(p.reasons.length).toBeGreaterThan(0);
      }
    }
  });
});
