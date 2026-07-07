import { useState, useEffect, memo } from 'react';
import type { RunEntry } from '../lib/types';

interface Props {
  date: string;
  entry: RunEntry | undefined;
  painCap: number;
  onUpdate: (date: string, updates: Partial<RunEntry>) => void;
}

// Compact, collapsible "How did it go?" row. Optional — never blocks the
// daily flow. Values commit on blur; the network write upstream is debounced,
// so typing never re-renders the whole tree or spams Supabase.
const SubjectiveRow = memo(function SubjectiveRow({ date, entry, painCap, onUpdate }: Props) {
  const hasData =
    entry?.rpe != null || entry?.painDuring != null ||
    entry?.painNextAM != null || !!entry?.didStrides;
  const [open, setOpen] = useState(false);

  const breach =
    (entry?.painDuring != null && entry.painDuring > painCap) ||
    (entry?.painNextAM != null && entry.painNextAM > painCap);

  return (
    <div className="pl-11">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] text-slate-600 hover:text-slate-400 transition py-0.5"
      >
        {open ? '▴' : '▸'} how did it go?
        {!open && hasData && (
          <span className="ml-1.5 text-slate-500">
            {entry?.rpe != null && `RPE ${entry.rpe}`}
            {entry?.painDuring != null && ` · pain ${entry.painDuring}`}
            {entry?.painNextAM != null && `/${entry.painNextAM} AM`}
            {entry?.didStrides && ' · strides'}
            {breach && <span className="text-rose-400"> ⚠</span>}
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-wrap items-center gap-2 pb-2 pt-1">
          <MiniNum
            label="RPE"
            min={1} max={10}
            value={entry?.rpe ?? null}
            onCommit={v => onUpdate(date, { rpe: v })}
          />
          <MiniNum
            label="pain"
            min={0} max={10}
            warnAbove={painCap}
            value={entry?.painDuring ?? null}
            onCommit={v => onUpdate(date, { painDuring: v })}
          />
          <MiniNum
            label="next AM"
            min={0} max={10}
            warnAbove={painCap}
            value={entry?.painNextAM ?? null}
            onCommit={v => onUpdate(date, { painNextAM: v })}
          />
          <button
            onClick={() => onUpdate(date, { didStrides: !entry?.didStrides })}
            className={`text-[11px] rounded-md border px-2 py-1 transition
              ${entry?.didStrides
                ? 'border-teal-700 bg-teal-950/60 text-teal-400'
                : 'border-border text-slate-600 hover:border-slate-500'}`}
          >
            strides {entry?.didStrides ? '✓' : ''}
          </button>
          {entry?.didStrides && (
            <StrideNote
              value={entry?.strideNote ?? ''}
              onCommit={v => onUpdate(date, { strideNote: v || null })}
            />
          )}
        </div>
      )}
    </div>
  );
});

// ── Tiny controlled-on-blur number input ─────────────────────

interface MiniNumProps {
  label: string;
  min: number;
  max: number;
  warnAbove?: number;
  value: number | null;
  onCommit: (v: number | null) => void;
}

function MiniNum({ label, min, max, warnAbove, value, onCommit }: MiniNumProps) {
  const [local, setLocal] = useState(value != null ? String(value) : '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setLocal(value != null ? String(value) : '');
  }, [value, focused]);

  const num = parseInt(local, 10);
  const warn = warnAbove != null && !isNaN(num) && num > warnAbove;

  return (
    <label className="flex items-center gap-1 text-[11px] text-slate-600">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = parseInt(local, 10);
          onCommit(isNaN(n) ? null : Math.min(max, Math.max(min, n)));
        }}
        placeholder="–"
        className={`w-12 bg-ink border rounded px-1.5 py-1 text-[11px] text-right
                    tabular-nums font-display outline-none transition
                    placeholder:text-slate-700
                    ${warn ? 'border-rose-700 text-rose-300' : 'border-border text-slate-300 focus:border-teal-500/50'}`}
      />
    </label>
  );
}

function StrideNote({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setLocal(value);
  }, [value, focused]);
  return (
    <input
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onCommit(local.trim()); }}
      placeholder="stride note (e.g. 4×15s)"
      maxLength={80}
      className="flex-1 min-w-[120px] bg-ink border border-border rounded px-2 py-1
                 text-[11px] text-slate-400 placeholder:text-slate-700
                 outline-none focus:border-teal-500/50 transition"
    />
  );
}

export default SubjectiveRow;
