import { useState } from 'react';
import type { PtNote } from '../lib/types';
import { newId } from '../lib/uid';

// A PRIVATE, LOCAL log for what your coach or PT told you — "cleared strides",
// "recheck the hip in 2 weeks", etc. This is deliberately NOT a message thread:
// nothing is sent anywhere and no one receives anything. It also never sets a
// PT clearance — those stay a manual toggle in the Speed plan, decided by you.
// Keeping the record here just means you don't lose track of guidance between
// appointments.

interface Props {
  notes: PtNote[];
  today: string;
  onAdd: (n: PtNote) => void;
  onDelete: (id: string) => void;
}

export default function CoachNotes({ notes, today, onAdd, onDelete }: Props) {
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');

  const sorted = [...notes].sort((a, b) => (a.date < b.date ? 1 : -1));

  function add() {
    const text = body.trim();
    if (!text) return;
    onAdd({ id: newId('pt'), date: date || today, body: text.slice(0, 600), updated_at: new Date().toISOString() });
    setBody(''); setDate(today);
  }

  return (
    <section data-block="coach" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">COACH / PT LOG</span>
        <span className="text-[11px] text-slate-700">private to this device</span>
      </div>

      <p className="m-0 text-[11.5px] leading-relaxed text-slate-500 bg-ink border border-border rounded-lg px-2.5 py-2">
        A place to jot what your coach or PT said. Nothing is sent to anyone — this is a personal log.
        Clearances are still set by you in the Speed plan, never from a note here.
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)}
            className="bg-ink border border-border rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-300 tabular-nums outline-none focus:border-sky-500/50 transition [color-scheme:dark]" />
          <span className="text-[11px] text-slate-600">appointment / call date</span>
        </div>
        <textarea
          value={body} onChange={e => setBody(e.target.value.slice(0, 600))} rows={3}
          placeholder="e.g. PT cleared easy strides. Recheck hip flexor in 2 weeks. Keep hills off until then."
          className="w-full bg-ink border border-border rounded-[10px] px-3 py-2.5 text-base text-slate-200 leading-relaxed placeholder:text-slate-700 outline-none focus:border-sky-500/50 transition resize-y"
        />
        <button onClick={add} disabled={!body.trim()}
          className="h-9 rounded-[10px] bg-card-alt border border-sky-500/40 text-sky-300 font-display text-[13px] font-semibold hover:border-sky-500/70 disabled:opacity-40 transition">
          Save to log
        </button>
      </div>

      {sorted.length > 0 && (
        <div className="flex flex-col border-t border-[#101a2c] pt-1">
          {sorted.map(n => (
            <div key={n.id} className="flex items-start gap-2.5 py-2 border-b border-[#101a2c] last:border-0">
              <span className="shrink-0 font-display text-[11px] font-semibold tabular-nums text-sky-300/80 mt-0.5">{n.date.slice(5)}</span>
              <p className="m-0 flex-1 min-w-0 text-[12.5px] leading-relaxed text-slate-400 whitespace-pre-wrap break-words">{n.body}</p>
              <button onClick={() => onDelete(n.id)} aria-label={`Delete note from ${n.date}`}
                className="shrink-0 text-[11px] text-slate-600 hover:text-rose-400 transition mt-0.5">remove</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
