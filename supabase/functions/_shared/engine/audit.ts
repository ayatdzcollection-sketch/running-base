// Engine self-check. Runs invariants against a runner's real data: if any
// fails, the engine (not the runner) has a bug. The tests run the same checks.
import { addDays, weekStart } from './dates.ts';
import { weekFacts } from './facts.ts';
import { planWeek } from './plan.ts';
import { RULES, peakFor, ENGINE_VERSION } from './rules.ts';
import type { ISODate, RunnerData } from './types.ts';

export interface AuditFinding {
  check: string;
  week: ISODate;
  detail: string;
}

export interface AuditResult {
  engineVersion: string;
  weeksChecked: number;
  passed: string[];
  findings: AuditFinding[];
}

const CHECKS = {
  sum: 'Days add up to the week (within half a mile)',
  longCap: 'No run is longer than the long-run limit',
  longShare: 'Long run is at most its share of the week and longer than easy days',
  minRun: 'No planned run is shorter than 2 miles',
  coachDown: 'No app lighter weeks in coach mode',
  peak: 'Weekly targets never exceed the ceiling',
  silence: 'Days with no data never change the plan',
  jump: 'Replayed on its own Monday, no week plans more than 15% above the biggest recent known week',
} as const;

export function auditEngine(data: RunnerData, today: ISODate, weeksBack = 12, weeksAhead = 4): AuditResult {
  const findings: AuditFinding[] = [];
  const p = data.profile;
  const peak = peakFor(p.experienceYears, p.goalMpw, p.birthYear, today);
  const start = [weekStart(p.planStart), addDays(weekStart(today), -7 * weeksBack)].sort()[1];
  const end = addDays(weekStart(today), 7 * weeksAhead);
  let n = 0;
  for (let w = start; w <= end; w = addDays(w, 7)) {
    n++;
    const plan = planWeek(data, w, w < weekStart(today) ? w : today);
    const days = plan.days;
    const runs = days.filter(d => d.miles && d.kind !== 'meet' && d.kind !== 'cross');
    const changed = days.some(d => d.override);
    if (plan.phase.kind === 'build' && plan.target != null && !changed) {
      const sum = runs.reduce((s, d) => s + (d.miles ?? 0), 0);
      const hasMeet = days.some(d => d.kind === 'meet');
      if (!hasMeet && Math.abs(sum - plan.target) > 0.5 + 1e-9 && sum > RULES.MIN_RUN_MI * 3) findings.push({ check: CHECKS.sum, week: w, detail: `Days add to ${sum}, target ${plan.target}.` });
      if (plan.target > peak + 1e-9) findings.push({ check: CHECKS.peak, week: w, detail: `Target ${plan.target} over ceiling ${peak}.` });
      const long = days.find(d => d.kind === 'long');
      const easyMax = Math.max(0, ...days.filter(d => d.kind === 'easy').map(d => d.miles ?? 0));
      if (long && long.miles! > Math.max(RULES.MIN_RUN_MI, plan.target * RULES.LONG_SHARE_FEW_DAYS) + 0.5) findings.push({ check: CHECKS.longShare, week: w, detail: `Long ${long.miles} of ${plan.target}.` });
      if (long && long.miles! <= easyMax) findings.push({ check: CHECKS.longShare, week: w, detail: `Long ${long.miles} not longer than easy ${easyMax}.` });
      for (const d of runs) if ((d.miles ?? 0) < RULES.MIN_RUN_MI && !d.override) findings.push({ check: CHECKS.minRun, week: w, detail: `${d.date}: ${d.miles} mi.` });
    }
    if (plan.phase.kind === 'coach') for (const d of runs) if ((d.miles ?? 0) < RULES.MIN_RUN_MI && !d.override) findings.push({ check: CHECKS.minRun, week: w, detail: `${d.date}: ${d.miles} mi.` });
    for (const d of runs) if ((d.miles ?? 0) > plan.longCap + 1e-9 && !d.override) findings.push({ check: CHECKS.longCap, week: w, detail: `${d.date}: ${d.miles} mi over cap ${plan.longCap}.` });
    if (plan.phase.kind === 'coach' && plan.isDown) findings.push({ check: CHECKS.coachDown, week: w, detail: 'Coach week marked lighter.' });

    // Replay: planned on its own Monday, never >15% over the biggest known week before it.
    if (w <= weekStart(today) && plan.phase.kind === 'build' && plan.baseTarget != null && !plan.isDown) {
      const recent = [1, 2, 3].map(i => weekFacts(data, addDays(w, -7 * i), w)).filter(f => f.finished && f.reliability !== 'none');
      if (recent.some(f => f.reliability === 'full')) {
        const capV = Math.round(Math.max(...recent.map(f => f.miles)) * RULES.MAX_OVER_VERIFIED * 2) / 2;
        if (plan.baseTarget > Math.max(capV, RULES.MIN_RUN_MI * 2) + 1e-9) findings.push({ check: CHECKS.jump, week: w, detail: `Planned ${plan.baseTarget}, cap ${capV}.` });
      }
    }
  }

  // Silence: add explicit "unknown" by removing nothing, then compare plans
  // after dropping any day marks from the future. Simplest real test: the
  // plan for the next 4 weeks must not change if we pretend today is up to
  // 3 weeks later with no new data (the usual week and caps must hold).
  const now = planWeek(data, weekStart(today), today);
  for (const k of [1, 2, 3]) {
    const later = addDays(today, 7 * k);
    const again = planWeek(data, weekStart(later), later);
    if (now.phase.kind === 'coach' && again.phase.kind === 'coach' && again.target !== now.target) {
      findings.push({ check: CHECKS.silence, week: weekStart(later), detail: `Usual week drifted ${now.target} → ${again.target} with no new data.` });
    }
    if (again.longCap < now.longCap - 1e-9) findings.push({ check: CHECKS.silence, week: weekStart(later), detail: `Long-run cap fell ${now.longCap} → ${again.longCap} with no new data.` });
  }

  const failed = new Set(findings.map(f => f.check));
  return { engineVersion: ENGINE_VERSION, weeksChecked: n, passed: Object.values(CHECKS).filter(c => !failed.has(c)), findings };
}
