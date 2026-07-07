import { useState, useEffect } from 'react';
import type { PlanDay, PlanWeek, RunEntry } from '../lib/types';
import type { TodaySpeedRow } from '../lib/todaySpeed';
import CapGauge from './CapGauge';
import SubjectiveRow from './SubjectiveRow';

interface Props {
  today: string;
  day: PlanDay | null;
  /** kept for API compatibility; the ceiling now comes from nextLong */
  week: PlanWeek | null;
  entry: RunEntry | undefined;
  onUpdate: (date: string, updates: Partial<RunEntry>) => void;
  planStart: string;
  planEnd: string;
  /** Live ceiling computed from trailing-30-day actuals (§2). */
  nextLong: number;
  trailingLongest: number;
  painCap: number;
  speedState: number;
  /** Today's optional speed dose (Stage D); null = nothing shown. */
  todaySpeed?: TodaySpeedRow | null;
}

export default function TodayCard({
  today, day, entry, onUpdate, planStart, planEnd,
  nextLong, trailingLongest, painCap, speedState, todaySpeed,
}: Props) {
  const [localMiles, setLocalMiles] = useState(
    entry?.miles_actual != null ? String(entry.miles_actual) : ''
  );
  const [focused, setFocused] = useState(false);

  // Sync local input when parent state changes (e.g. Supabase pull), but not while typing
  useEffect(() => {
    if (!focused) {
      setLocalMiles(entry?.miles_actual != null ? String(entry.miles_actual) : '');
    }
  }, [entry?.miles_actual, focused]);

  function handleBlur() {
    setFocused(false);
    const num = parseFloat(localMiles);
    onUpdate(today, { miles_actual: isNaN(num) ? null : Math.max(0, num) });
  }

  // ── Before / after plan ──────────────────────────────────
  if (today < planStart) {
    return (
      <div className="card text-center py-8 space-y-2">
        <p className="text-slate-400 text-sm">Plan starts</p>
        <p className="font-display text-2xl font-semibold text-slate-200">Monday Jun 29</p>
        <p className="text-slate-500 text-sm">Today is a free day. Bonus day is Jun 26.</p>
      </div>
    );
  }
  if (today > planEnd) {
    return (
      <div className="card text-center py-8 space-y-2">
        <p className="text-2xl">🏁</p>
        <p className="font-display text-xl font-semibold text-slate-200">Block complete</p>
        <p className="text-slate-500 text-sm">7 weeks done. XC season — go.</p>
      </div>
    );
  }

  // ── Bonus day ────────────────────────────────────────────
  if (day?.type === 'bonus') {
    return (
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <span className="tag tag-sky">Bonus day</span>
          <span className="text-slate-500 text-sm">Fri Jun 26</span>
        </div>
        <p className="font-display text-lg text-slate-200">
          Optional easy 3–4 mi. Real plan starts Monday.
        </p>
        <MilesRow
          localMiles={localMiles}
          done={!!entry?.done}
          onToggle={() => onUpdate(today, { done: !entry?.done })}
          onMilesChange={setLocalMiles}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          prescribed={null}
        />
      </div>
    );
  }

  // ── Rest day ─────────────────────────────────────────────
  if (!day || day.type === 'rest') {
    const dow = new Date(today + 'T12:00:00Z').getUTCDay();
    const label = dow === 6 ? 'Saturday' : 'Sunday';
    return (
      <div className="card text-center py-8 space-y-2">
        <span className="tag tag-teal mx-auto">Rest day</span>
        <p className="font-display text-xl font-semibold text-slate-200 mt-2">{label}</p>
        <p className="text-slate-500 text-sm">Off. Let it absorb. Strength work if cleared.</p>
      </div>
    );
  }

  // ── Run day ──────────────────────────────────────────────
  const prescribed = day.prescribed ?? 0;
  // Live ceiling from trailing-30-day actuals (§2) — replaces the
  // hard-coded Friday number. Clamp the displayed target if the static
  // plan runs ahead of what recent volume supports.
  const cap = nextLong;
  const clamped = prescribed > cap;
  const target = clamped ? cap : prescribed;
  const isLong = day.isLongRun;

  const fmtDay = `${day.dayLabel} ${fmtDateShort(today)}`;

  return (
    <div className="card space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`tag ${isLong ? 'tag-amber' : 'tag-teal'}`}>
          {isLong ? 'Long run' : 'Easy run'}
        </span>
        {day.isDownWeek && <span className="tag tag-sky">Down week</span>}
        <span className="text-slate-500 text-sm ml-auto">{fmtDay}</span>
      </div>

      {/* Distance */}
      <div className="flex items-end gap-3">
        <span className="font-display text-5xl font-semibold tabular-nums text-slate-100">
          {target}
        </span>
        <span className="font-display text-xl text-slate-400 mb-1">mi</span>
        {isLong && (
          <span className="text-xs text-amber-400/80 mb-2 ml-1">← ceiling {cap} mi</span>
        )}
      </div>

      {/* Calm clamp reason when the plan ran ahead of recent volume */}
      {clamped && (
        <p className="text-xs text-sky-300/90 bg-sky-950/30 border border-sky-900/40 rounded-lg px-3 py-2 leading-relaxed">
          Your recent longest is {trailingLongest} mi, so today's ceiling is {cap} mi.
          The ladder is paused until you rebuild. That's the rule working, not a downgrade.
        </p>
      )}

      {/* HR reminder */}
      <div className="rounded-lg bg-ink border border-border px-3 py-2 text-xs text-slate-400 leading-relaxed">
        <span className="text-rose-300 font-semibold">HR governor:</span>{' '}
        keep 140–150 bpm · hard cap 155 · talk-test not enough
      </div>

      {/* Today's optional speed dose (Stage D) */}
      {todaySpeed && (
        <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
          todaySpeed.dose === 'low'
            ? 'bg-teal-500/[0.06] border border-teal-500/20'
            : 'bg-card-alt border border-border'}`}>
          <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full font-display
            text-[9.5px] font-semibold tracking-wider ${
            todaySpeed.dose === 'low'
              ? 'bg-teal-500/[0.12] text-teal-300 border border-teal-500/30'
              : 'bg-slate-500/10 text-slate-500 border border-border'}`}>
            {todaySpeed.dose === 'low' ? 'OPTIONAL' : 'N/A'}
          </span>
          <div className="min-w-0 flex flex-col">
            <span className={`font-display text-[12.5px] font-semibold ${
              todaySpeed.dose === 'low' ? 'text-slate-200' : 'text-slate-400'}`}>
              {todaySpeed.name}
            </span>
            <span className="text-[11.5px] leading-snug text-slate-500">{todaySpeed.detail}</span>
          </div>
        </div>
      )}

      {/* Gauge + actions */}
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <CapGauge current={target} cap={cap} actual={entry?.miles_actual} />
        <div className="flex-1 w-full space-y-3">
          <MilesRow
            localMiles={localMiles}
            done={!!entry?.done}
            onToggle={() => onUpdate(today, { done: !entry?.done })}
            onMilesChange={setLocalMiles}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            prescribed={target}
          />
        </div>
      </div>

      {/* Optional subjective log — the tendon governor. Chips inline here. */}
      <SubjectiveRow
        date={today}
        entry={entry}
        painCap={painCap}
        speedState={speedState}
        onUpdate={onUpdate}
        alwaysOpen
      />
    </div>
  );
}

// ── Shared miles/done row ────────────────────────────────────

interface MilesRowProps {
  localMiles: string;
  done: boolean;
  prescribed: number | null;
  onToggle: () => void;
  onMilesChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

function MilesRow({
  localMiles, done, prescribed,
  onToggle, onMilesChange, onFocus, onBlur,
}: MilesRowProps) {
  return (
    <div className="flex items-center gap-3">
      {/* Done toggle */}
      <button
        onClick={onToggle}
        aria-label={done ? 'Mark undone' : 'Mark done'}
        className={`w-12 h-12 rounded-full border-2 flex items-center justify-center
                    text-xl transition-all active:scale-95 shrink-0
                    ${done
                      ? 'border-teal-500 bg-teal-500/20 text-teal-400'
                      : 'border-border text-slate-600 hover:border-slate-500'}`}
      >
        {done ? '✓' : '○'}
      </button>

      {/* Miles input */}
      <div className="flex-1 relative">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          max="30"
          value={localMiles}
          onChange={e => onMilesChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={prescribed != null ? `${prescribed} planned` : 'miles run'}
          className="w-full bg-ink border border-border rounded-lg px-4 py-3
                     text-slate-200 font-display tabular-nums text-base
                     placeholder:text-slate-700 outline-none
                     focus:border-teal-500/60 transition"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-sm pointer-events-none">
          mi
        </span>
      </div>
    </div>
  );
}

function fmtDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
