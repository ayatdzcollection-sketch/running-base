import { useState } from 'react';
import type { RunState, Shoe } from '../lib/types';
import { shoeReport, type PrescribedLookup } from '../lib/shoes';
import { newId } from '../lib/uid';

// Shoe rotation with advisory mileage. Miles come from your logged runs; the
// retirement threshold is a rule of thumb. Nothing here blocks logging or feeds
// the cap / gate math — it is a maintenance reminder, not a training input.

interface Props {
  shoes: Shoe[];
  runState: RunState;
  today: string;
  /** Planned miles per date (plan.dateToDay), so ✓-done days with no typed
   *  distance credit the shoe at their prescription — same rule as the week
   *  and block totals. */
  prescribedFor?: PrescribedLookup;
  onSave: (s: Shoe) => void;
  onDelete: (id: string) => void;
}

const STATUS = {
  ok: { chip: 'bg-teal-500/10 text-teal-300 border-teal-500/30', bar: '#2dd4bf', label: 'good' },
  watch: { chip: 'bg-amber-500/10 text-amber-300 border-amber-500/30', bar: '#f59e0b', label: 'watch' },
  retire: { chip: 'bg-rose-500/10 text-rose-300 border-rose-500/30', bar: '#fb7185', label: 'retire soon' },
} as const;

export default function ShoeTracker({ shoes, runState, today, prescribedFor, onSave, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [baseMiles, setBaseMiles] = useState('0');
  const [retireAt, setRetireAt] = useState('400');

  const report = shoeReport(shoes, runState, prescribedFor);

  function add() {
    const nm = name.trim();
    if (!nm) return;
    onSave({
      id: newId('shoe'),
      name: nm.slice(0, 40),
      startDate: startDate || today,
      retiredAt: null,
      baseMiles: Math.max(0, parseFloat(baseMiles) || 0),
      retireAt: Math.max(0, parseFloat(retireAt) || 0),
      updated_at: new Date().toISOString(),
    });
    setName(''); setBaseMiles('0'); setRetireAt('400'); setStartDate(today); setAdding(false);
  }

  function toggleRetire(s: Shoe) {
    onSave({ ...s, retiredAt: s.retiredAt ? null : today, updated_at: new Date().toISOString() });
  }

  return (
    <section data-block="shoes" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">SHOE MILEAGE</span>
        <span className="text-[11px] text-slate-700">advisory only</span>
      </div>

      {report.length === 0 && !adding && (
        <p className="m-0 text-[12px] leading-relaxed text-slate-500">
          Add a pair to track its mileage from your logged runs. Most shoes last roughly 300–500 miles — a reminder, never a rule.
        </p>
      )}

      {report.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {report.map(({ shoe, miles, status, pct }) => {
            const tone = STATUS[status];
            const retired = !!shoe.retiredAt;
            return (
              <div key={shoe.id} className={`flex flex-col gap-1.5 ${retired ? 'opacity-55' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="font-display text-[13px] font-semibold text-slate-200 truncate">{shoe.name}</span>
                  {retired
                    ? <span className="tag text-[9px] px-1.5 py-0 bg-slate-500/10 text-slate-500 border border-border">retired</span>
                    : <span className={`tag text-[9px] px-1.5 py-0 border ${tone.chip}`}>{tone.label}</span>}
                  <span className="ml-auto font-display text-[12.5px] font-semibold tabular-nums text-slate-300">
                    {miles.toFixed(0)}<span className="text-slate-600"> / {shoe.retireAt} mi</span>
                  </span>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.min(100, Math.round(pct * 100))}%`, background: retired ? '#475569' : tone.bar }} />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10.5px] text-slate-600">since {shoe.startDate.slice(5)}{shoe.baseMiles ? ` · +${shoe.baseMiles} base` : ''}</span>
                  <button onClick={() => toggleRetire(shoe)} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300 transition">
                    {retired ? 'un-retire' : 'retire'}
                  </button>
                  <button onClick={() => onDelete(shoe.id)} aria-label={`Remove ${shoe.name}`} className="text-[11px] text-slate-600 hover:text-rose-400 transition">remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="flex flex-col gap-2 border-t border-[#101a2c] pt-3">
          <input
            value={name} onChange={e => setName(e.target.value)} placeholder="Shoe name (e.g. Pegasus 41)"
            className="w-full bg-ink border border-border rounded-[10px] px-3 py-2 text-base text-slate-200 placeholder:text-slate-700 outline-none focus:border-teal-500/50 transition"
          />
          <div className="flex gap-2">
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-[10.5px] text-slate-600">in rotation since</span>
              <input type="date" value={startDate} max={today} onChange={e => setStartDate(e.target.value || today)}
                className="bg-ink border border-border rounded-lg px-2 py-1.5 text-[12.5px] text-slate-300 tabular-nums outline-none focus:border-teal-500/50 transition [color-scheme:dark]" />
            </label>
            <label className="w-[76px] flex flex-col gap-1">
              <span className="text-[10.5px] text-slate-600">base mi</span>
              <input inputMode="decimal" value={baseMiles} onChange={e => setBaseMiles(e.target.value)}
                className="bg-ink border border-border rounded-lg px-2 py-1.5 text-[13px] text-slate-300 tabular-nums outline-none focus:border-teal-500/50 transition" />
            </label>
            <label className="w-[76px] flex flex-col gap-1">
              <span className="text-[10.5px] text-slate-600">retire at</span>
              <input inputMode="decimal" value={retireAt} onChange={e => setRetireAt(e.target.value)}
                className="bg-ink border border-border rounded-lg px-2 py-1.5 text-[13px] text-slate-300 tabular-nums outline-none focus:border-teal-500/50 transition" />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={add} disabled={!name.trim()}
              className="flex-1 h-9 rounded-[10px] bg-card-alt border border-teal-500/40 text-teal-300 font-display text-[13px] font-semibold hover:border-teal-500/70 disabled:opacity-40 transition">Add shoe</button>
            <button onClick={() => setAdding(false)}
              className="h-9 px-4 rounded-[10px] border border-border text-slate-500 font-display text-[13px] hover:border-slate-600 transition">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="h-9 rounded-[10px] border border-dashed border-border text-slate-400 font-display text-[12.5px] font-semibold hover:border-slate-600 hover:text-slate-300 transition">
          + Add a pair
        </button>
      )}

      <p className="m-0 text-[10.5px] leading-relaxed text-slate-600">
        Mileage is summed from your logged runs since each shoe's start date — a ✓-done day with no typed
        distance counts at its planned miles, same as the week total. Advisory only — it never blocks
        logging or changes your plan.
      </p>
    </section>
  );
}
