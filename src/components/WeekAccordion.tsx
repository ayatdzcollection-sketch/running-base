import { useState } from 'react';
import type { PlanWeek, RunEntry, RunState } from '../lib/types';
import DayRow from './DayRow';

interface Props {
  week: PlanWeek;
  runState: RunState;
  today: string;
  defaultOpen: boolean;
  onUpdate: (date: string, updates: Partial<RunEntry>) => void;
  painCap: number;
}

export default function WeekAccordion({ week, runState, today, defaultOpen, onUpdate, painCap }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Compute week totals
  let loggedMiles = 0;
  let doneCount = 0;
  for (const day of week.runDays) {
    const entry = runState[day.date];
    if (!entry) continue;
    if (entry.miles_actual != null) {
      loggedMiles += entry.miles_actual;
    } else if (entry.done && day.prescribed) {
      loggedMiles += day.prescribed;
    }
    if (entry.done || entry.miles_actual != null) doneCount++;
  }

  const containsToday = week.allDays.some(d => d.date === today);

  return (
    <div className={`card overflow-hidden transition-all
      ${containsToday ? 'ring-1 ring-teal-800/30' : ''}`}>
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02] transition"
      >
        <span className="font-display text-sm font-medium text-slate-300 flex-1 min-w-0 truncate">
          {week.label}
        </span>

        <div className="flex items-center gap-3 shrink-0">
          {week.isDownWeek && (
            <span className="tag tag-sky text-[10px] px-1.5 py-0.5">↓ down</span>
          )}
          {week.note === 'peak' && (
            <span className="tag tag-amber text-[10px] px-1.5 py-0.5">peak</span>
          )}

          {/* Progress dots */}
          <span className="text-xs text-slate-500 tabular-nums">
            {doneCount}/{week.runDays.length}
          </span>

          {/* Miles */}
          <span className="font-display text-sm tabular-nums text-slate-400">
            <span className="text-teal-400">{loggedMiles.toFixed(1)}</span>
            <span className="text-slate-600">/{week.totalPlanned}</span>
          </span>

          <span className={`text-slate-500 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-border px-1 py-1 space-y-0.5">
          {/* Column header */}
          <div className="flex items-center gap-3 px-3 py-1 text-[10px] text-slate-600 uppercase tracking-wider">
            <div className="w-8">Day</div>
            <div className="w-7" />
            <div className="flex-1">Planned</div>
            <div className="w-24 text-right">Actual</div>
            <div className="w-14 text-right">Logged</div>
          </div>

          {week.allDays.map(day => (
            <DayRow
              key={day.date}
              day={day}
              entry={runState[day.date]}
              onUpdate={onUpdate}
              isToday={day.date === today}
              painCap={painCap}
            />
          ))}
        </div>
      )}
    </div>
  );
}
