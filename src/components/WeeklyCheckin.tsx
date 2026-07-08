import { useState, useEffect } from 'react';
import type { WeeklyCheckin } from '../lib/types';
import { mondayOf } from '../lib/metrics';
import { summarizeCheckins } from '../lib/checkin';

// Subjective weekly load monitoring. Sleep / soreness / energy / stress on a
// 1–5 scale, with an advisory summary. A rough week may SUGGEST easing, but
// this never advances a speed state or relaxes any gate — upward moves stay
// behind the readiness checklist in the Speed plan.

interface Props {
  checkins: Record<string, WeeklyCheckin>;
  today: string;
  onSave: (c: WeeklyCheckin) => void;
}

const FIELDS = [
  { key: 'sleep', label: 'Sleep', hint: '1 poor · 5 great', invert: false },
  { key: 'soreness', label: 'Soreness', hint: '1 none · 5 very sore', invert: true },
  { key: 'energy', label: 'Energy', hint: '1 flat · 5 strong', invert: false },
  { key: 'stress', label: 'Life stress', hint: '1 low · 5 high', invert: true },
] as const;

type FieldKey = typeof FIELDS[number]['key'];

export default function WeeklyCheckin({ checkins, today, onSave }: Props) {
  const weekStart = mondayOf(today);
  const existing = checkins[weekStart];

  const [vals, setVals] = useState<Record<FieldKey, number>>({
    sleep: existing?.sleep ?? 3,
    soreness: existing?.soreness ?? 2,
    energy: existing?.energy ?? 3,
    stress: existing?.stress ?? 2,
  });
  const [note, setNote] = useState(existing?.note ?? '');

  // Reload when the active week rolls over (or a synced value arrives).
  useEffect(() => {
    setVals({
      sleep: existing?.sleep ?? 3,
      soreness: existing?.soreness ?? 2,
      energy: existing?.energy ?? 3,
      stress: existing?.stress ?? 2,
    });
    setNote(existing?.note ?? '');
  }, [weekStart, existing]);

  const summary = summarizeCheckins(checkins);

  function save() {
    onSave({
      weekStart,
      sleep: vals.sleep, soreness: vals.soreness, energy: vals.energy, stress: vals.stress,
      note: note.trim() || undefined,
      updated_at: new Date().toISOString(),
    });
  }

  return (
    <section data-block="checkin" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">WEEKLY CHECK-IN</span>
        <span className="text-[11px] text-slate-700">week of {weekStart.slice(5)}</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {FIELDS.map(f => (
          <div key={f.key} className="flex items-center gap-2.5">
            <div className="w-[86px] shrink-0">
              <div className="text-[12.5px] text-slate-300">{f.label}</div>
              <div className="text-[10px] text-slate-600">{f.hint}</div>
            </div>
            <div className="flex gap-1.5 flex-1">
              {[1, 2, 3, 4, 5].map(n => {
                const active = vals[f.key] === n;
                const worse = f.invert; // soreness/stress: higher is worse → amber when high
                return (
                  <button
                    key={n}
                    onClick={() => setVals(v => ({ ...v, [f.key]: n }))}
                    aria-label={`${f.label} ${n}`}
                    aria-pressed={active}
                    className={`flex-1 h-9 rounded-lg font-display text-[13px] font-semibold tabular-nums border transition ${
                      active
                        ? worse && n >= 4
                          ? 'bg-amber-500/[0.14] text-amber-300 border-amber-500/40'
                          : 'bg-teal-500/[0.12] text-teal-300 border-teal-500/40'
                        : 'bg-transparent text-slate-500 border-border hover:border-slate-600'}`}
                  >{n}</button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <textarea
        value={note}
        onChange={e => setNote(e.target.value.slice(0, 300))}
        rows={2}
        placeholder="Anything worth noting this week? (optional)"
        className="w-full bg-ink border border-border rounded-[10px] px-3 py-2 text-base text-slate-200 leading-relaxed placeholder:text-slate-700 outline-none focus:border-teal-500/50 transition resize-y"
      />

      <button
        onClick={save}
        className="h-10 rounded-[10px] bg-card-alt border border-teal-500/40 text-teal-300 font-display text-[13px] font-semibold hover:border-teal-500/70 transition"
      >{existing ? 'Update this week' : 'Save this week'}</button>

      {summary.latest && (
        <div className="flex flex-col gap-2 border-t border-[#101a2c] pt-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[11.5px] text-slate-500">Recovery read</span>
            <span className={`font-display text-[13px] font-semibold tabular-nums ${
              (summary.freshness ?? 0) >= 60 ? 'text-teal-300' : (summary.freshness ?? 0) >= 35 ? 'text-amber-300' : 'text-rose-300'}`}>
              {summary.freshness}/100
            </span>
            {summary.sorenessTrend && (
              <span className="ml-auto text-[11px] text-slate-600">
                soreness {summary.sorenessTrend === 'up' ? '↑ rising' : summary.sorenessTrend === 'down' ? '↓ easing' : '→ steady'}
              </span>
            )}
          </div>
          {summary.suggestion && (
            <p className="m-0 text-[11.5px] leading-relaxed text-amber-300/90 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-2.5 py-1.5">
              {summary.suggestion}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
