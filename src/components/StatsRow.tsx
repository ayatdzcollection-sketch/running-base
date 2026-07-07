import { getPlan } from '../config/plan';
import type { RunState } from '../lib/types';
import { BLOCK_TOTAL_MILES } from '../config/plan';

interface Props {
  runState: RunState;
  today: string; // kept for API compatibility
  /** Live long-run ceiling from trailing-30-day actuals. */
  nextLong: number;
}

export default function StatsRow({ runState, nextLong }: Props) {
  const plan = getPlan();

  // Effective miles per day
  function effectiveMiles(date: string, prescribed: number | null): number {
    const e = runState[date];
    if (!e) return 0;
    if (e.miles_actual != null) return e.miles_actual;
    if (e.done && prescribed) return prescribed;
    return 0;
  }

  // Total logged across all run days + bonus
  let totalLogged = effectiveMiles(plan.bonusDay.date, null);
  for (const week of plan.weeks) {
    for (const day of week.runDays) {
      totalLogged += effectiveMiles(day.date, day.prescribed);
    }
  }

  // Long-run ceiling is live-computed from actuals (was the static Friday number)

  // Completed run days
  let completedDays = 0;
  let totalRunDays = 0;
  const bonusEntry = runState[plan.bonusDay.date];
  if (bonusEntry?.done || bonusEntry?.miles_actual != null) completedDays++;
  totalRunDays++; // bonus counts
  for (const week of plan.weeks) {
    totalRunDays += week.runDays.length;
    for (const day of week.runDays) {
      const e = runState[day.date];
      if (e?.done || e?.miles_actual != null) completedDays++;
    }
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat
        label="Total logged"
        value={`${totalLogged.toFixed(1)}`}
        sub={`/ ${BLOCK_TOTAL_MILES} mi`}
        accent="teal"
      />
      <Stat
        label="Next long"
        value={`${nextLong} mi`}
        sub="live ceiling"
        accent="amber"
      />
      <Stat
        label="Block"
        value="7 wks"
        sub={`${completedDays}/${totalRunDays} days`}
        accent="slate"
      />
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  sub: string;
  accent: 'teal' | 'amber' | 'slate';
}

function Stat({ label, value, sub, accent }: StatProps) {
  const accentCls = {
    teal: 'text-teal-400',
    amber: 'text-amber-400',
    slate: 'text-slate-300',
  }[accent];

  return (
    <div className="card px-3 py-3 text-center">
      <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-display text-lg font-semibold tabular-nums leading-none ${accentCls}`}>
        {value}
      </p>
      <p className="text-[10px] text-slate-600 mt-0.5 tabular-nums">{sub}</p>
    </div>
  );
}
