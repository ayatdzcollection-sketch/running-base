import type { BuiltPlan } from '../config/plan';
import type { PlanWeek, RunState } from '../lib/types';

interface Props {
  runState: RunState;
  plan: BuiltPlan;
  today: string;
  week: PlanWeek | null;
  blockTotalTarget: number;
}

function effective(runState: RunState, date: string, prescribed: number | null): number | null {
  const e = runState[date];
  if (!e) return null;
  if (e.miles_actual != null) return e.miles_actual;
  if (e.done && prescribed != null) return prescribed;
  return null;
}

export default function WeekProgress({ runState, plan, today, week, blockTotalTarget }: Props) {
  const curWeek = week ?? plan.weeks[plan.weeks.length - 1];

  let weekDone = 0;
  let runsLeft = 0;
  for (const d of curWeek.runDays) {
    const v = effective(runState, d.date, d.prescribed);
    if (v != null) weekDone += v;
    else if (d.date >= today) runsLeft++;
  }

  // Block totals.
  let blockLogged = 0;
  let daysDone = 0;
  let totalRunDays = 1; // bonus day
  const bonus = effective(runState, plan.bonusDay.date, null);
  if (bonus != null) { blockLogged += bonus; daysDone++; }
  for (const w of plan.weeks) {
    for (const d of w.runDays) {
      totalRunDays++;
      const v = effective(runState, d.date, d.prescribed);
      if (v != null) { blockLogged += v; daysDone++; }
    }
  }

  const weekPct = Math.min(100, (weekDone / curWeek.totalPlanned) * 100);
  const isCurrent = week != null;

  return (
    <section data-block="week" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-[11px]">
      <div className="flex justify-between items-baseline gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">
          {isCurrent ? `THIS WEEK — ${curWeek.weekNum} OF ${plan.weeks.length}` : 'THE BLOCK'}
        </span>
        <span className="text-[11.5px] text-slate-500">
          {runsLeft} run day{runsLeft === 1 ? '' : 's'} left
        </span>
      </div>

      <div className="flex items-baseline gap-[7px] tabular-nums">
        <span className="font-display text-3xl font-semibold leading-none text-teal-300">{weekDone.toFixed(1)}</span>
        <span className="font-display text-sm text-slate-500">/ {curWeek.totalPlanned} mi</span>
        <span className="ml-auto text-[11.5px] text-slate-500">long run {curWeek.runDays[curWeek.runDays.length - 1]?.dayLabel} · {curWeek.longRunCap.toFixed(1)} mi</span>
      </div>

      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-teal-400 transition-[width] duration-500" style={{ width: `${weekPct}%` }} />
      </div>

      <div className="flex justify-between gap-2.5 text-[11.5px] text-slate-500 tabular-nums">
        <span>block <span className="text-slate-300">{blockLogged.toFixed(1)}</span> / {Math.round(blockTotalTarget)} mi</span>
        <span><span className="text-slate-300">{daysDone}</span> of {totalRunDays} days logged</span>
      </div>
    </section>
  );
}
