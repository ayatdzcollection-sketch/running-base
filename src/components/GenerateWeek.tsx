import { useState } from 'react';
import type { GlobalState, ProposedDay, RawSettings, RunState, WeekProposal } from '../lib/types';
import { generateWeeks, checkAcceptedWeeks, type AcceptedWeekConflict } from '../lib/generator';
import { nextLong } from '../lib/metrics';
import { TUNABLES } from '../config/tunables';

interface Props {
  runState: RunState;
  globals: GlobalState;
  today: string;
  settings: RawSettings | null;
  onUpdateGlobals: (patch: Partial<GlobalState>) => void;
}

const COUNTS = [1, 2, 4];

// Proposes upcoming weeks from actual completed training, one to several at a
// time. Never auto-commits: drafts are editable and only save on confirm.
// Accepted weeks store additively in globals.acceptedWeeks — the static plan is
// never rewritten, and any accepted week that later conflicts with a safety
// gate is flagged (never silently changed) with a safer suggestion.
export default function GenerateWeek({ runState, globals, today, settings, onUpdateGlobals }: Props) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<WeekProposal[]>([]);
  const [count, setCount] = useState(1);
  const [savedMsg, setSavedMsg] = useState('');

  const acceptedKeys = Object.keys(globals.acceptedWeeks).sort();
  const conflicts = checkAcceptedWeeks(globals.acceptedWeeks, runState, globals, today);
  const cap = nextLong(runState, today);

  function generate() {
    setSavedMsg('');
    setDrafts(generateWeeks({ runState, globals, today, settings, count }).proposals);
  }

  function bumpDay(wi: number, di: number, delta: number) {
    setDrafts(ds => ds.map((p, i) => {
      if (i !== wi) return p;
      const days = p.days.map((d, j) => {
        if (j !== di || d.miles == null) return d;
        return { ...d, miles: Math.max(0, Math.round((d.miles + delta) / TUNABLES.HALF_STEP) * TUNABLES.HALF_STEP) };
      });
      return { ...p, days, totalMiles: days.reduce((s, d) => s + (d.miles ?? 0), 0) };
    }));
  }

  function removeDraft(wi: number) {
    setDrafts(ds => ds.filter((_, i) => i !== wi));
  }

  function confirmAll() {
    if (!drafts.length) return;
    const merged = { ...globals.acceptedWeeks };
    for (const p of drafts) merged[p.weekStart] = p.days; // manual edits kept verbatim
    onUpdateGlobals({ acceptedWeeks: merged });
    setSavedMsg(`${drafts.length} week${drafts.length > 1 ? 's' : ''} confirmed — locked into the plan ✓`);
    setDrafts([]);
  }

  function applySafer(c: AcceptedWeekConflict) {
    onUpdateGlobals({ acceptedWeeks: { ...globals.acceptedWeeks, [c.weekStart]: c.suggested } });
  }

  return (
    <div className="card space-y-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-1 py-1 text-left hover:opacity-80 transition"
      >
        <span className="flex items-center gap-2">
          <h3 className="font-display text-sm font-semibold text-slate-300">Generate future weeks</h3>
          {conflicts.length > 0 && (
            <span className="tag tag-amber text-[9px] px-1.5 py-0.5">{conflicts.length} to review</span>
          )}
        </span>
        <span className="text-slate-600 text-xs">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {/* Conflicts with previously-accepted weeks */}
          {conflicts.map(c => (
            <div key={c.weekStart} className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-amber-300">Week of {c.weekStart} conflicts with your current safety gates</p>
              {c.reasons.map((r, i) => (
                <p key={i} className="text-[11px] text-amber-400/80 leading-relaxed">· {r}</p>
              ))}
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span>Long: <span className="tabular-nums text-slate-400">{c.original.find(d => d.kind === 'long')?.miles ?? '–'}</span> → <span className="tabular-nums text-teal-400">{c.suggested.find(d => d.kind === 'long')?.miles ?? '–'} mi</span></span>
                <button
                  onClick={() => applySafer(c)}
                  className="ml-auto rounded-md border border-teal-700 px-2.5 py-1 text-[11px] text-teal-300 hover:border-teal-500 transition"
                >Use safer version</button>
              </div>
            </div>
          ))}

          <p className="text-[11px] text-slate-600 leading-relaxed">
            Built from your actual completed training, obeying the speed state. Continues the build,
            forces a down week on cadence, and never lets a long run exceed the {settings?.capPct ?? 110}% cap.
            Nothing saves until you confirm; your edits are kept.
          </p>

          {/* Count selector */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Weeks:</span>
            {COUNTS.map(c => (
              <button
                key={c}
                onClick={() => setCount(c)}
                className={`w-9 h-8 rounded-lg font-display text-xs font-semibold transition ${
                  count === c
                    ? 'bg-teal-500/[0.12] text-teal-300 border border-teal-500/40'
                    : 'bg-transparent text-slate-500 border border-border hover:border-slate-600'}`}
              >{c}</button>
            ))}
            <button
              onClick={generate}
              className="ml-auto rounded-lg border border-teal-800 px-3 py-2 text-xs text-teal-400 hover:border-teal-600 transition-all active:scale-[0.98]"
            >
              {drafts.length ? 'Regenerate' : `Preview ${count} week${count > 1 ? 's' : ''}`}
            </button>
          </div>

          {/* Draft weeks */}
          {drafts.map((p, wi) => (
            <div key={p.weekStart} className="rounded-xl border border-sky-500/40 border-dashed bg-[#070c15] px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-xs font-semibold text-slate-300">Week of {p.weekStart}</span>
                <span className="tag tag-sky text-[9px] px-1.5 py-0.5">{p.isDownWeek ? 'DRAFT · DOWN' : 'DRAFT'}</span>
                <span className="ml-auto font-display text-xs tabular-nums text-teal-400">{p.totalMiles.toFixed(1)} mi</span>
              </div>

              {p.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-400/90 leading-relaxed">⚠ {w}</p>
              ))}

              <div className="space-y-1">
                {p.days.filter(d => d.kind !== 'rest').map((d) => {
                  const di = p.days.indexOf(d);
                  return <DraftRow key={d.date} day={d} onDec={() => bumpDay(wi, di, -0.5)} onInc={() => bumpDay(wi, di, 0.5)} overCap={d.kind === 'long' && d.miles != null && d.miles > cap} cap={cap} />;
                })}
              </div>

              <button
                onClick={() => removeDraft(wi)}
                className="text-[11px] text-slate-500 hover:text-rose-400 underline transition"
              >Remove this draft week</button>
            </div>
          ))}

          {drafts.length > 0 && (
            <button
              onClick={confirmAll}
              className="w-full rounded-xl bg-amber-500 py-3 text-sm font-display font-semibold text-ink active:scale-[0.98] transition"
            >
              Confirm {drafts.length} week{drafts.length > 1 ? 's' : ''}
            </button>
          )}

          {savedMsg && (
            <div className="rounded-lg border border-teal-500/30 bg-teal-500/[0.08] px-3 py-2.5 text-[13px] text-teal-300 text-center">
              {savedMsg}
            </div>
          )}

          {/* Accepted weeks */}
          {acceptedKeys.length > 0 && (
            <div className="space-y-2 border-t border-border pt-2">
              <p className="text-[10px] text-slate-600 uppercase tracking-wider">Confirmed weeks</p>
              {acceptedKeys.map(ws => (
                <AcceptedWeek
                  key={ws}
                  weekStart={ws}
                  days={globals.acceptedWeeks[ws]}
                  onRemove={() => {
                    const next = { ...globals.acceptedWeeks };
                    delete next[ws];
                    onUpdateGlobals({ acceptedWeeks: next });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DraftRow({ day, onDec, onInc, overCap, cap }: {
  day: ProposedDay; onDec: () => void; onInc: () => void; overCap: boolean; cap: number;
}) {
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-[#101a2c] last:border-0">
      <div className="flex items-center gap-2">
        <span className="w-9 font-display text-[12.5px] font-semibold text-slate-400">{day.dayLabel}</span>
        {day.kind === 'long' && <span className="tag tag-amber text-[9px] px-1.5 py-0">LONG</span>}
        {day.kind === 'threshold' && <span className="tag tag-rose text-[9px] px-1.5 py-0">threshold</span>}
        {day.strides && <span className="tag tag-teal text-[9px] px-1.5 py-0">+ strides</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={onDec} className="w-8 h-8 rounded-lg bg-card-alt border border-border text-slate-400 text-base leading-none hover:border-slate-600 transition">−</button>
          <span className="w-11 text-center font-display text-sm font-semibold tabular-nums text-slate-200">{day.miles?.toFixed(1) ?? '–'}</span>
          <button onClick={onInc} className="w-8 h-8 rounded-lg bg-card-alt border border-border text-slate-400 text-base leading-none hover:border-slate-600 transition">+</button>
        </div>
      </div>
      <p className={`text-[11px] leading-snug ${overCap ? 'text-rose-400' : 'text-slate-600'}`}>
        {overCap ? `Above the current ${cap} mi ceiling — your call, but it breaks the cap.` : day.why}
      </p>
    </div>
  );
}

function AcceptedWeek({ weekStart, days, onRemove }: {
  weekStart: string; days: ProposedDay[]; onRemove: () => void;
}) {
  const [show, setShow] = useState(false);
  const total = days.reduce((s, d) => s + (d.miles ?? 0), 0);
  return (
    <div className="rounded-lg bg-ink border border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <button onClick={() => setShow(s => !s)} className="text-xs text-slate-400 hover:text-slate-200 transition flex-1 text-left">
          {show ? '▴' : '▸'} {weekStart} · <span className="tabular-nums text-teal-500">{total.toFixed(1)} mi</span>
        </button>
        <button onClick={onRemove} className="text-[10px] text-slate-700 hover:text-rose-400 transition">remove</button>
      </div>
      {show && (
        <div className="mt-1.5 space-y-0.5">
          {days.map(d => (
            <p key={d.date} className="text-[10px] text-slate-500 tabular-nums">
              {d.dayLabel} — {d.kind === 'rest' ? 'rest' : `${d.miles ?? '–'} mi ${d.kind}${d.strides ? ' + strides' : ''}`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
