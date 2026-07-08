import { useState, useEffect } from 'react';

// Daily free-text notes, keyed by date. Purely human — how the run felt,
// terrain, weather, anything. Never parsed by any gate or metric.

interface Props {
  notes: Record<string, string>;
  today: string;
  onSave: (date: string, text: string) => void;
  onDelete: (date: string) => void;
}

const MAX = 600;

export default function DailyNotes({ notes, today, onSave, onDelete }: Props) {
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState(notes[today] ?? '');

  // When the selected date changes, load that day's saved note into the draft.
  useEffect(() => { setDraft(notes[date] ?? ''); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = Object.entries(notes)
    .filter(([, v]) => v.trim())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)); // newest first

  const saved = (notes[date] ?? '') === draft.trim() && draft.trim() !== '';
  function save() {
    const text = draft.trim().slice(0, MAX);
    if (!text) return;
    onSave(date, text);
  }

  return (
    <section data-block="notes" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">DAILY NOTES</span>
        <span className="text-[11px] text-slate-700">just for you</span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={today}
            onChange={e => setDate(e.target.value || today)}
            className="bg-ink border border-border rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-300 font-display tabular-nums outline-none focus:border-teal-500/50 transition [color-scheme:dark]"
          />
          {date === today && <span className="text-[11px] text-slate-600">today</span>}
        </div>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, MAX))}
          rows={3}
          placeholder="How did it feel? Legs, terrain, weather, mood…"
          className="w-full bg-ink border border-border rounded-[10px] px-3 py-2.5 text-base text-slate-200 leading-relaxed placeholder:text-slate-700 outline-none focus:border-teal-500/50 transition resize-y"
        />
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] text-slate-700 tabular-nums">{draft.length}/{MAX}</span>
          <button
            onClick={save}
            disabled={!draft.trim() || saved}
            className="ml-auto h-9 px-4 rounded-[10px] bg-card-alt border border-teal-500/40 text-teal-300 font-display text-[13px] font-semibold hover:border-teal-500/70 disabled:opacity-40 disabled:hover:border-teal-500/40 transition"
          >{saved ? 'Saved' : notes[date] ? 'Update note' : 'Save note'}</button>
        </div>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-col border-t border-[#101a2c] pt-1">
          {entries.slice(0, 6).map(([d, text]) => (
            <div key={d} className="flex items-start gap-2.5 py-2 border-b border-[#101a2c] last:border-0">
              <button
                onClick={() => setDate(d)}
                className={`shrink-0 font-display text-[11px] font-semibold tabular-nums mt-0.5 transition ${d === date ? 'text-teal-300' : 'text-slate-500 hover:text-slate-300'}`}
              >{d.slice(5)}</button>
              <p className="m-0 flex-1 min-w-0 text-[12.5px] leading-relaxed text-slate-400 whitespace-pre-wrap break-words">{text}</p>
              <button
                onClick={() => onDelete(d)}
                aria-label={`Delete note for ${d}`}
                className="shrink-0 text-[11px] text-slate-600 hover:text-rose-400 transition mt-0.5"
              >remove</button>
            </div>
          ))}
          {entries.length > 6 && <p className="m-0 pt-2 text-[11px] text-slate-600">+{entries.length - 6} more earlier notes</p>}
        </div>
      )}
    </section>
  );
}
