import { useState } from 'react';
import type { GlobalState, ProposedDay, RunState, WeekProposal } from '../lib/types';
import { generateNextWeek } from '../lib/generator';
import { nextLong } from '../lib/metrics';

interface Props {
  runState: RunState;
  globals: GlobalState;
  today: string;
  onUpdateGlobals: (patch: Partial<GlobalState>) => void;
}

// Proposes the upcoming week from actual completed training. Never
// auto-commits: the preview is editable and only saves on confirm.
// Accepted weeks are stored additively in globals.acceptedWeeks — the
// original static plan is never rewritten.
export default function GenerateWeek({ runState, globals, today, onUpdateGlobals }: Props) {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<WeekProposal | null>(null);
  const [savedMsg, setSavedMsg] = useState('');

  const acceptedKeys = Object.keys(globals.acceptedWeeks).sort();

  function generate() {
    setSavedMsg('');
    setProposal(generateNextWeek({ runState, globals, today }));
  }

  function editMiles(i: number, raw: string) {
    if (!proposal) return;
    const v = parseFloat(raw);
    const days = proposal.days.map((d, j) =>
      j === i ? { ...d, miles: isNaN(v) ? null : Math.max(0, v) } : d,
    );
    const totalMiles = days.reduce((s, d) => s + (d.miles ?? 0), 0);
    setProposal({ ...proposal, days, totalMiles });
  }

  function confirm() {
    if (!proposal) return;
    // Manual edits are preserved verbatim — the athlete has the final word.
    onUpdateGlobals({
      acceptedWeeks: { ...globals.acceptedWeeks, [proposal.weekStart]: proposal.days },
    });
    setSavedMsg(`Week of ${proposal.weekStart} saved ✓ — it syncs with your other state.`);
    setProposal(null);
  }

  const cap = nextLong(runState, today);
  const overCapEdit = proposal?.days.some(d => d.kind === 'long' && d.miles != null && d.miles > cap);

  return (
    <div className="card space-y-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-1 py-1 text-left hover:opacity-80 transition"
      >
        <h3 className="font-display text-sm font-semibold text-slate-300">Generate next week</h3>
        <span className="text-slate-600 text-xs">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Proposes the upcoming week from your actual completed training, obeying the speed
            state. Nothing saves until you confirm; your edits are kept. Completed weeks are
            never rewritten, and the award total can never raise volume.
          </p>

          <button
            onClick={generate}
            className="w-full rounded-lg border border-teal-800 py-2 text-xs text-teal-400
                       hover:border-teal-600 transition-all active:scale-[0.98]"
          >
            {proposal ? 'Regenerate proposal' : 'Propose next week'}
          </button>

          {proposal && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-xs text-slate-300">
                  Week of {proposal.weekStart}
                </span>
                {proposal.isDownWeek && <span className="tag tag-sky text-[10px] px-1.5 py-0.5">↓ down week</span>}
                <span className="ml-auto font-display text-xs tabular-nums text-teal-400">
                  {proposal.totalMiles.toFixed(1)} mi
                </span>
              </div>

              {proposal.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-400/90 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2 leading-relaxed">
                  ⚠ {w}
                </p>
              ))}

              <div className="space-y-1">
                {proposal.days.map((d, i) => (
                  <PreviewRow key={d.date} day={d} onEdit={raw => editMiles(i, raw)} />
                ))}
              </div>

              {overCapEdit && (
                <p className="text-[11px] text-rose-400 leading-relaxed">
                  Your edit puts the long run above the current safe ceiling ({cap} mi).
                  It will save — your call — but it breaks the trailing-30-day rule.
                </p>
              )}

              <div className="space-y-1 border-t border-border pt-2">
                {proposal.notes.map((n, i) => (
                  <p key={i} className="text-[10px] text-slate-600 leading-relaxed">· {n}</p>
                ))}
              </div>

              <button
                onClick={confirm}
                className="w-full rounded-lg border border-teal-700 bg-teal-950/40 py-2.5
                           text-sm text-teal-300 hover:border-teal-500
                           transition-all active:scale-[0.98]"
              >
                Confirm & save this week
              </button>
            </div>
          )}

          {savedMsg && <p className="text-xs text-teal-500">{savedMsg}</p>}

          {acceptedKeys.length > 0 && (
            <div className="space-y-2 border-t border-border pt-2">
              <p className="text-[10px] text-slate-600 uppercase tracking-wider">Accepted weeks</p>
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

function PreviewRow({ day, onEdit }: { day: ProposedDay; onEdit: (raw: string) => void }) {
  const kindTag =
    day.kind === 'long' ? 'tag-amber' :
    day.kind === 'threshold' ? 'tag-rose' :
    day.kind === 'easy' ? 'tag-teal' : '';

  return (
    <div className="rounded-lg bg-ink border border-border px-3 py-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-display text-xs text-slate-400 w-8">{day.dayLabel}</span>
        {day.kind === 'rest' ? (
          <span className="text-xs text-slate-600">Rest</span>
        ) : (
          <>
            <span className={`tag ${kindTag} text-[9px] px-1.5 py-0`}>
              {day.kind}{day.strides ? ' + strides' : ''}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              defaultValue={day.miles ?? ''}
              onBlur={e => onEdit(e.target.value)}
              className="ml-auto w-16 bg-[#0a101e] border border-border rounded px-2 py-1
                         text-xs text-slate-300 font-display tabular-nums text-right
                         outline-none focus:border-teal-500/50 transition"
            />
            <span className="text-[10px] text-slate-600">mi</span>
          </>
        )}
      </div>
      <p className="text-[10px] text-slate-600 leading-relaxed">{day.why}</p>
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
        <button onClick={onRemove} className="text-[10px] text-slate-700 hover:text-rose-400 transition">
          remove
        </button>
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
