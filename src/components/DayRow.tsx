import { useState, useEffect, memo } from 'react';
import type { PlanDay, RunEntry } from '../lib/types';
import SubjectiveRow from './SubjectiveRow';

interface Props {
  day: PlanDay;
  entry: RunEntry | undefined;
  onUpdate: (date: string, updates: Partial<RunEntry>) => void;
  isToday: boolean;
  painCap: number;
  speedState: number;
}

// memo prevents re-render of sibling rows when one field changes
const DayRow = memo(function DayRow({ day, entry, onUpdate, isToday, painCap, speedState }: Props) {
  const [localMiles, setLocalMiles] = useState(
    entry?.miles_actual != null ? String(entry.miles_actual) : ''
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setLocalMiles(entry?.miles_actual != null ? String(entry.miles_actual) : '');
    }
  }, [entry?.miles_actual, focused]);

  function handleBlur() {
    setFocused(false);
    const num = parseFloat(localMiles);
    onUpdate(day.date, { miles_actual: isNaN(num) ? null : Math.max(0, num) });
  }

  const done = !!entry?.done;
  const isRest = day.type === 'rest';
  const isBonus = day.type === 'bonus';

  // Effective miles for display
  const effective =
    entry?.miles_actual != null
      ? entry.miles_actual
      : done && day.prescribed
      ? day.prescribed
      : null;

  return (
    <div
      className={`px-3 py-2.5 rounded-lg
                  ${isToday ? 'bg-teal-950/30 ring-1 ring-teal-800/40' : 'hover:bg-white/[0.02]'}
                  transition-colors`}
    >
    <div className="flex items-center gap-3">
      {/* Day label */}
      <div className="w-8 shrink-0">
        <span className={`font-display text-xs font-medium
          ${isToday ? 'text-teal-400' : isRest ? 'text-slate-600' : 'text-slate-400'}`}>
          {day.dayLabel}
        </span>
      </div>

      {/* Done toggle (only for run/bonus days) */}
      {isRest ? (
        <div className="w-7 h-7 shrink-0" /> /* spacer */
      ) : (
        <button
          onClick={() => onUpdate(day.date, { done: !done })}
          aria-label={done ? 'Mark undone' : 'Mark done'}
          className={`w-7 h-7 rounded-full border flex items-center justify-center
                      text-sm transition-all active:scale-90 shrink-0
                      ${done
                        ? 'border-teal-500 bg-teal-500/20 text-teal-400'
                        : 'border-border text-slate-700 hover:border-slate-500'}`}
        >
          {done && '✓'}
        </button>
      )}

      {/* Prescribed distance */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {isRest ? (
          <span className="text-xs text-slate-700">Rest</span>
        ) : isBonus ? (
          <span className="text-sm text-slate-500 tabular-nums">–</span>
        ) : (
          <span className={`font-display text-sm tabular-nums
            ${day.isLongRun ? 'text-amber-400/80' : 'text-slate-400'}`}>
            {day.prescribed} mi
            {day.isLongRun && (
              <span className="ml-1 text-amber-500/50 text-xs">long</span>
            )}
          </span>
        )}
      </div>

      {/* Actual miles input (run days only) */}
      {!isRest && (
        <div className="w-24 shrink-0">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="30"
            value={localMiles}
            onChange={e => setLocalMiles(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            placeholder="actual"
            className="w-full bg-ink border border-border rounded px-2 py-1.5
                       text-xs text-slate-300 font-display tabular-nums
                       placeholder:text-slate-700 outline-none
                       focus:border-teal-500/50 transition text-right"
          />
        </div>
      )}

      {/* Effective miles display */}
      <div className="w-14 text-right shrink-0">
        {effective != null ? (
          <span className={`font-display text-sm tabular-nums
            ${done ? 'text-teal-400' : 'text-slate-400'}`}>
            {effective.toFixed(1)}
          </span>
        ) : (
          <span className="text-slate-700 text-sm">–</span>
        )}
      </div>
    </div>

    {/* Optional subjective log — collapsed by default, never forced */}
    {!isRest && (done || entry?.miles_actual != null || isToday) && (
      <SubjectiveRow
        date={day.date}
        entry={entry}
        painCap={painCap}
        speedState={speedState}
        onUpdate={onUpdate}
      />
    )}
    </div>
  );
});

export default DayRow;
