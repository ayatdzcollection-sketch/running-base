import { useState, useEffect, memo } from 'react';
import type { RunEntry } from '../lib/types';

interface Props {
  date: string;
  entry: RunEntry | undefined;
  painCap: number;
  speedState: number;
  onUpdate: (date: string, updates: Partial<RunEntry>) => void;
  /** Today's card shows the chips inline; week-history rows stay collapsible. */
  alwaysOpen?: boolean;
}

type Chip = 'fine' | 'niggle' | 'hurt';

// Chips are presets over the real 0–10 painDuring field — every threshold
// (cap breach, two-in-seven flare, week-over-week trend) keeps working
// because actual numbers are still stored underneath.
//   Fine   → 0                 (pain-free)
//   Niggle → painCap           (tolerable, at the ceiling, not a breach)
//   Hurt   → painCap + 1        (a breach; reveals a slider for the exact value)
function chipFor(painDuring: number | null | undefined, cap: number): Chip | null {
  if (painDuring == null) return null;
  if (painDuring <= 0) return 'fine';
  if (painDuring <= cap) return 'niggle';
  return 'hurt';
}

const CHIP_STYLE: Record<Chip, { on: string; label: string }> = {
  fine:   { on: 'border-teal-600 bg-teal-950/60 text-teal-300',   label: 'Fine' },
  niggle: { on: 'border-amber-600 bg-amber-950/50 text-amber-300', label: 'Niggle' },
  hurt:   { on: 'border-rose-600 bg-rose-950/50 text-rose-300',    label: 'Hurt' },
};

const SubjectiveRow = memo(function SubjectiveRow({
  date, entry, painCap, speedState, onUpdate, alwaysOpen,
}: Props) {
  const [open, setOpen] = useState(!!alwaysOpen);
  const [detail, setDetail] = useState(false);

  const selected = chipFor(entry?.painDuring, painCap);
  const stridesAllowed = speedState >= 2; // no low-dose work exists at state 1
  const hasData = selected != null || entry?.rpe != null || !!entry?.didStrides;

  function pick(chip: Chip) {
    if (chip === selected) { onUpdate(date, { painDuring: null }); return; } // tap again to clear
    if (chip === 'fine') onUpdate(date, { painDuring: 0 });
    else if (chip === 'niggle') onUpdate(date, { painDuring: painCap });
    else onUpdate(date, {
      painDuring: entry?.painDuring != null && entry.painDuring > painCap
        ? entry.painDuring : painCap + 1,
    });
  }

  // Collapsible affordance (week-history rows only)
  const header = !alwaysOpen && (
    <button
      onClick={() => setOpen(o => !o)}
      className="text-[11px] text-slate-600 hover:text-slate-400 transition py-0.5"
    >
      {open ? '▴' : '▸'} how did it go?
      {!open && hasData && (
        <span className="ml-1.5 text-slate-500">
          {selected && CHIP_STYLE[selected].label}
          {entry?.didStrides && ' · strides'}
        </span>
      )}
    </button>
  );

  return (
    <div className={alwaysOpen ? '' : 'pl-11'}>
      {header}

      {open && (
        <div className="space-y-1.5 pt-1 pb-1">
          {/* One-tap pain chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-600 mr-0.5">How's the hip?</span>
            {(['fine', 'niggle', 'hurt'] as Chip[]).map(chip => (
              <button
                key={chip}
                onClick={() => pick(chip)}
                className={`text-[11px] rounded-full border px-2.5 py-1 transition
                  ${selected === chip
                    ? CHIP_STYLE[chip].on
                    : 'border-border text-slate-500 hover:border-slate-500'}`}
              >
                {CHIP_STYLE[chip].label}
              </button>
            ))}
            {stridesAllowed && (
              <button
                onClick={() => onUpdate(date, { didStrides: !entry?.didStrides })}
                className={`text-[11px] rounded-full border px-2.5 py-1 transition ml-1
                  ${entry?.didStrides
                    ? 'border-teal-700 bg-teal-950/60 text-teal-400'
                    : 'border-border text-slate-500 hover:border-slate-500'}`}
              >
                strides {entry?.didStrides ? '✓' : ''}
              </button>
            )}
          </div>

          {/* Exact number only when it matters (Hurt) */}
          {selected === 'hurt' && (
            <label className="flex items-center gap-2 text-[11px] text-rose-300/90">
              pain
              <input
                type="range"
                min={0} max={10} step={1}
                value={entry?.painDuring ?? painCap + 1}
                onChange={e => onUpdate(date, { painDuring: parseInt(e.target.value, 10) })}
                className="flex-1 accent-rose-500"
              />
              <span className="tabular-nums font-display w-8 text-right">
                {entry?.painDuring ?? painCap + 1}/10
              </span>
            </label>
          )}

          {/* Quiet reassurance — removes the felt obligation to fill anything in */}
          {selected == null && (
            <p className="text-[10px] text-slate-700">Nothing to report = pain-free. Only tap if something's off.</p>
          )}

          {/* Optional detail (RPE + stride note), tucked away — no gate reads these */}
          <div>
            <button
              onClick={() => setDetail(d => !d)}
              className="text-[10px] text-slate-700 hover:text-slate-500 transition"
            >
              {detail ? '– less' : '+ detail'}
            </button>
            {detail && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <MiniNum
                  label="RPE"
                  value={entry?.rpe ?? null}
                  onCommit={v => onUpdate(date, { rpe: v })}
                />
                {entry?.didStrides && (
                  <StrideNote
                    value={entry?.strideNote ?? ''}
                    onCommit={v => onUpdate(date, { strideNote: v || null })}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ── Tiny controlled-on-blur number input (RPE only now) ──────

interface MiniNumProps {
  label: string;
  value: number | null;
  onCommit: (v: number | null) => void;
}

function MiniNum({ label, value, onCommit }: MiniNumProps) {
  const [local, setLocal] = useState(value != null ? String(value) : '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setLocal(value != null ? String(value) : '');
  }, [value, focused]);

  return (
    <label className="flex items-center gap-1 text-[11px] text-slate-600">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={10}
        step={1}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = parseInt(local, 10);
          onCommit(isNaN(n) ? null : Math.min(10, Math.max(1, n)));
        }}
        placeholder="–"
        className="w-12 bg-ink border border-border rounded px-1.5 py-1 text-[11px] text-right
                   tabular-nums font-display outline-none transition
                   placeholder:text-slate-700 text-slate-300 focus:border-teal-500/50"
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
