import { useState } from 'react';
import type { RaceResult } from '../lib/types';
import {
  predictionTable, fmtTime, STD_DISTANCES, PROTO_DIST_MI,
} from '../lib/races';

// DISPLAY-ONLY race log + Riegel projections. Adapting the plan from races is
// gated OFF this base block (see FLAGS.RACE_ADAPTIVE_TRAINING); the toggle here
// only records the preference and only ever informs paces in LATER blocks —
// it never raises the HR cap, the long-run cap, or unlocks a speed state.

interface Props {
  races: RaceResult[];
  adaptive: boolean;
  onSaveRace: (r: RaceResult) => void;
  onSetAdaptive: (v: boolean) => void;
}

const DIST_OPTS = [
  { key: 'mile', label: 'Mile' },
  { key: '3200', label: '3200 m' },
  { key: '5k', label: '5K' },
];

function parseTime(v: string): number {
  const parts = v.trim().split(':');
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  if (parts.length === 1) return parseFloat(parts[0]);
  return NaN;
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return 'r-' + Date.now().toString(36);
}

function todayISO(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

export default function RaceLog({ races, adaptive, onSaveRace, onSetAdaptive }: Props) {
  const [dist, setDist] = useState('5k');
  const [time, setTime] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const preds = predictionTable(races);
  const hasRace = races.length > 0;
  const latest = hasRace ? [...races].sort((a, b) => (a.date < b.date ? 1 : -1))[0] : null;
  const fiveKPred = preds.find(p => p.key === '5k');

  function save() {
    const sec = parseTime(time);
    if (!Number.isFinite(sec) || sec <= 0) return;
    onSaveRace({
      id: newId(),
      date: todayISO(),
      distanceMi: PROTO_DIST_MI[dist],
      timeSec: Math.round(sec),
      label: DIST_OPTS.find(o => o.key === dist)?.label,
      updated_at: new Date().toISOString(),
    });
    setTime('');
  }

  const latestLabel = latest
    ? `${STD_DISTANCES.find(s => Math.abs(s.miles - latest.distanceMi) < 0.05)?.label ?? latest.label ?? ''} · ${fmtTime(latest.timeSec)}${latest.date ? ` · ${latest.date}` : ''}`
    : '';

  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">RACES &amp; PROJECTION</span>
        <span className="text-[11px] text-slate-700">informs paces, not this block</span>
      </div>

      {hasRace && (
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] text-slate-400">
            Last effort: <span className="text-slate-200 font-semibold">{latestLabel}</span>
          </span>
          <div className="flex flex-col">
            {preds.map(p => (
              <div key={p.key} className="flex items-center gap-2.5 py-2 border-b border-[#101a2c] last:border-0">
                <span className={`w-16 font-display text-[12.5px] font-semibold ${p.logged ? 'text-sky-300' : 'text-slate-400'}`}>{p.label}</span>
                <span className={`w-14 font-display text-[13px] font-semibold tabular-nums ${p.logged ? 'text-slate-200' : 'text-slate-300'}`}>{fmtTime(p.timeSec)}</span>
                <span className="flex-1 text-[11.5px] text-slate-500 tabular-nums">{fmtTime(p.paceSecPerMi)} /mi</span>
                {p.logged && <span className="tag tag-sky text-[9px] px-1.5 py-0">LOGGED</span>}
              </div>
            ))}
          </div>
          {fiveKPred && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] text-slate-400">~{fmtTime(fiveKPred.paceSecPerMi)} /mi at 5K effort</span>
              <span className="text-[11.5px] leading-snug text-slate-600">
                ~{fmtTime(fiveKPred.paceSecPerMi + 70)}–{fmtTime(fiveKPred.paceSecPerMi + 120)} /mi easy. Reference only; you run by HR this block
              </span>
            </div>
          )}
        </div>
      )}

      <div className="h-px bg-[#101a2c]" />

      {/* Log a race */}
      <div className="flex flex-col gap-2">
        <span className="text-[11.5px] text-slate-500">Log a recent race or all-out time trial</span>
        <div className="flex gap-1.5">
          {DIST_OPTS.map(o => (
            <button
              key={o.key}
              onClick={() => setDist(o.key)}
              className={`flex-1 h-9 rounded-lg font-display text-[12.5px] font-semibold transition ${
                dist === o.key
                  ? 'bg-sky-500/[0.12] text-sky-300 border border-sky-500/40'
                  : 'bg-transparent text-slate-500 border border-border hover:border-slate-600'}`}
            >{o.label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={time}
            onChange={e => setTime(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            inputMode="numeric"
            placeholder="mm:ss"
            className="flex-1 min-w-0 h-11 bg-ink border border-border rounded-[10px] px-3.5 text-[15px] text-slate-200 font-display tabular-nums placeholder:text-slate-700 outline-none focus:border-sky-500/50 transition"
          />
          <button
            onClick={save}
            className="shrink-0 h-11 px-4 rounded-[10px] bg-card-alt border border-sky-500/40 text-sky-300 font-display text-[13px] font-semibold hover:border-sky-500/70 transition"
          >{hasRace ? 'Update result' : 'Save result'}</button>
        </div>
      </div>

      <div className="h-px bg-[#101a2c]" />

      {/* Adapt from races (inert this block) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className="text-[13px] text-slate-200">Adapt the plan from races</span>
            <button onClick={() => setInfoOpen(o => !o)} aria-label="Explain this setting" className="shrink-0 text-slate-600 hover:text-slate-400 transition">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            </button>
          </div>
          <div className="shrink-0 flex gap-1.5 w-[132px]">
            <button
              onClick={() => onSetAdaptive(true)}
              className={`flex-1 h-9 rounded-lg font-display text-[12.5px] font-semibold transition ${
                adaptive ? 'bg-teal-500/[0.12] text-teal-300 border border-teal-500/40' : 'bg-transparent text-slate-500 border border-border'}`}
            >On</button>
            <button
              onClick={() => onSetAdaptive(false)}
              className={`flex-1 h-9 rounded-lg font-display text-[12.5px] font-semibold transition ${
                !adaptive ? 'bg-slate-500/[0.14] text-slate-300 border border-slate-600' : 'bg-transparent text-slate-500 border border-border'}`}
            >Off</button>
          </div>
        </div>
        {infoOpen && (
          <p className="m-0 text-[11.5px] leading-relaxed text-sky-300/90 bg-sky-500/[0.06] border border-sky-500/20 rounded-lg px-2.5 py-1.5">
            When on, a new race updates your goal projection and the paces used in blocks AFTER this
            base phase. It never raises the HR cap or the long-run cap, and never unlocks speed.
            Those gates always win.
          </p>
        )}
      </div>
    </div>
  );
}
