import type { BuiltPlan } from '../config/plan';
import type { RunState } from '../lib/types';

export interface AwardCfg {
  target: number;
  safePlanDelivery: number;
  windowStart: string;
  windowEnd: string;
}

interface Props {
  runState: RunState;
  plan: BuiltPlan;
  award: AwardCfg;   // resolved from settings — display-only, safety-subordinate
}

export default function AwardTracker({ runState, plan, award }: Props) {
  // Sum effective miles for days within the award window.
  let inWindow = 0;
  function addDay(date: string, prescribed: number | null) {
    if (date < award.windowStart || date > award.windowEnd) return;
    const e = runState[date];
    if (!e) return;
    if (e.miles_actual != null) inWindow += e.miles_actual;
    else if (e.done && prescribed) inWindow += prescribed;
  }

  addDay(plan.bonusDay.date, null);
  for (const week of plan.weeks) {
    for (const day of week.runDays) addDay(day.date, day.prescribed);
  }

  const pct = Math.min(inWindow / award.target, 1);
  const safePct = Math.min(award.safePlanDelivery / award.target, 1);
  const gapToTarget = Math.max(0, award.target - inWindow);

  return (
    <div className="card space-y-3 opacity-80">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-slate-300">
          Coach mileage award
        </h3>
        <span className="text-xs text-slate-600">Jun 26 – Aug 9 · side goal</span>
      </div>

      <div className="relative h-3 bg-ink rounded-full overflow-visible border border-border">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-px h-5 bg-amber-500/60 z-10"
          style={{ left: `${safePct * 100}%` }}
          title={`Safe plan: ~${Math.round(award.safePlanDelivery)} mi`}
        >
          <div className="absolute -top-5 left-1 text-[9px] text-amber-500/70 whitespace-nowrap">
            ~{Math.round(award.safePlanDelivery)}
          </div>
        </div>
        <div
          className="h-full rounded-full bg-teal-600/50 transition-all"
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      <div className="flex items-end justify-between">
        <p className="font-display text-base tabular-nums text-slate-400">
          <span className="text-teal-400">{inWindow.toFixed(1)}</span>
          <span className="text-slate-600"> / {Math.round(award.target)} mi</span>
        </p>
        {gapToTarget > 0
          ? <p className="text-xs text-slate-600 tabular-nums">{gapToTarget.toFixed(1)} to go</p>
          : <p className="text-xs text-teal-500">Target reached</p>}
      </div>

      <p className="text-[11px] text-slate-600 leading-relaxed border-t border-border pt-2">
        Safe plan delivers ~{Math.round(award.safePlanDelivery)} mi in this window (dashed marker).
        Closing the gap needs pushing past 30 mpw with no down weeks — the exact load that flares
        the hip.{' '}
        <strong className="text-slate-500">Not the priority. Don't chase it.</strong>
      </p>
    </div>
  );
}
