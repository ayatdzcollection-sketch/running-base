import { useState } from 'react';
import type { RawSettings, RunState } from '../lib/types';
import { effectiveSettings, resetToRecentActuals, type ClampNote } from '../lib/settings';

// Every knob that shapes the plan, grouped like the design's Settings sheet.
// Steppers allow the full range the user might type; effectiveSettings() clamps
// the values the engine actually uses and we surface each clamp inline.

interface FieldDef {
  key: keyof RawSettings;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  info: string;
  type?: 'date';
}

interface GroupDef {
  id: string;
  title: string;
  fields: FieldDef[];
  summary: (s: RawSettings) => string;
}

const GROUPS: GroupDef[] = [
  {
    id: 'goal', title: 'Goal',
    summary: s => `${Math.round(s.goalMiles)} mi · safe ${Math.round(s.safeDelivery)}`,
    fields: [
      { key: 'goalMiles', label: 'Season mileage goal', unit: 'mi', min: 100, max: 300, step: 5,
        info: 'Your season mileage target. It only moves the award marker. It never pushes daily runs above the cap.' },
      { key: 'safeDelivery', label: 'Safe plan delivers', unit: 'mi', min: 60, max: 300, step: 1,
        info: "What the safe plan realistically adds up to. Sets where the amber 'safe' line sits on the award bar." },
    ],
  },
  {
    id: 'schedule', title: 'Schedule',
    summary: s => `${s.daysPerWeek} days · ${s.blockWeeks} wks`,
    fields: [
      { key: 'daysPerWeek', label: 'Run days / week', unit: 'days', min: 3, max: 6, step: 1,
        info: 'How many days you run each week. Fewer days means more rest; each run may stretch a little to hold weekly volume.' },
      { key: 'blockWeeks', label: 'Block length', unit: 'weeks', min: 4, max: 12, step: 1,
        info: 'How many weeks the base block runs before the plan re-evaluates from scratch.' },
      { key: 'downEvery', label: 'Down week every', unit: 'weeks', min: 3, max: 6, step: 1,
        info: "How often a lighter 'down' week drops in so your body absorbs the work. Lower = recover more often." },
      { key: 'startDate', label: 'Start date', type: 'date', min: 0, max: 0, step: 0,
        info: 'The Monday week 1 begins. Every date, week, and the award window shifts with it.' },
    ],
  },
  {
    id: 'volume', title: 'Volume',
    summary: s => `${s.startMpw}→${s.peakMpw} mi · seed ${s.trailingLongest.toFixed(1)}`,
    fields: [
      { key: 'startMpw', label: 'Starting week', unit: 'mi', min: 8, max: 80, step: 1,
        info: "Your first week's total miles. The build grows upward from here." },
      { key: 'peakMpw', label: 'Peak week', unit: 'mi', min: 12, max: 100, step: 1,
        info: "The biggest week the plan will ever build toward. It won't exceed this." },
      { key: 'buildStep', label: 'Weekly build step', unit: 'mi', min: 0.5, max: 4, step: 0.5,
        info: 'How fast weekly miles grow. Smaller steps = gentler, safer progression.' },
      { key: 'trailingLongest', label: 'Starting longest run', unit: 'mi', min: 2, max: 15, step: 0.5,
        info: "Your longest recent run. Today's long-run ceiling is a percentage of this number." },
    ],
  },
  {
    id: 'governors', title: 'Governors',
    summary: s => `${s.hrEasyMin}–${s.hrEasyMax} · cap ${s.hrHardCap} · ${s.capPct}%`,
    fields: [
      { key: 'hrEasyMin', label: 'Easy HR floor', unit: 'bpm', min: 100, max: 175, step: 1,
        info: "The floor of your easy heart-rate window. Below it you're barely working." },
      { key: 'hrEasyMax', label: 'Easy HR ceiling', unit: 'bpm', min: 110, max: 185, step: 1,
        info: 'The top of your easy window. Staying under it is what keeps easy days easy.' },
      { key: 'hrHardCap', label: 'Hard cap HR', unit: 'bpm', min: 120, max: 195, step: 1,
        info: "The hard line on an easy run. Cross it and you're training too hard for base building." },
      { key: 'hrMax', label: 'Max HR', unit: 'bpm', min: 160, max: 220, step: 1,
        info: 'Your maximum heart rate. Used to turn the easy band into a % of effort.' },
      { key: 'capPct', label: 'Long-run cap', unit: '%', min: 105, max: 130, step: 1,
        info: '110% = today can be at most 10% longer than your longest recent run. The core safety rule.' },
    ],
  },
  {
    id: 'hipspeed', title: 'Hip & speed',
    summary: s => `unlock at ${s.pfNeeded} runs`,
    fields: [
      { key: 'pfNeeded', label: 'Pain-free runs to unlock', unit: 'runs', min: 2, max: 8, step: 1,
        info: 'How many pain-free runs in a row before the next speed step unlocks. Higher = more cautious.' },
    ],
  },
];

function fmt(v: number, step: number): string {
  return step < 1 ? v.toFixed(1) : String(Math.round(v));
}

export default function SettingsPanel({
  raw, runState, today, onChange, onFullReset, onSeasonReset, onClose, layoutSection,
}: {
  raw: RawSettings;
  runState: RunState;
  today: string;
  onChange: (patch: Partial<RawSettings>) => void;
  onFullReset: () => void;
  onSeasonReset: () => void;
  onClose: () => void;
  layoutSection?: React.ReactNode;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [resetArm, setResetArm] = useState('');
  const [seasonArm, setSeasonArm] = useState('');

  const { clamps } = effectiveSettings(raw, runState, today);
  const clampByField = new Map<string, ClampNote>();
  for (const c of clamps) clampByField.set(c.field, c);

  // Preview what a season reset would seed, so the user sees the new starting
  // mileage (from recent training) before confirming.
  const resetPreview = resetToRecentActuals(raw, runState, today, raw.updated_at);

  const bump = (f: FieldDef, dir: 1 | -1) => {
    const cur = Number(raw[f.key]);
    const next = Math.min(f.max, Math.max(f.min, Math.round((cur + dir * f.step) * 100) / 100));
    onChange({ [f.key]: next } as Partial<RawSettings>);
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Plan settings"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-auto
                 bg-ink/90 backdrop-blur-sm px-4 py-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-[18px] border border-border bg-[#0a101e] p-5
                   flex flex-col gap-3.5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-display text-lg font-semibold text-slate-200">Plan settings</h2>
            <span className="text-[11.5px] leading-snug text-slate-500">
              Every knob that shapes the plan. Saved to this device.
            </span>
          </div>
          <button
            onClick={onClose} aria-label="Close settings"
            className="shrink-0 grid place-items-center w-8 h-8 rounded-[9px] border border-border
                       text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
          >✕</button>
        </div>

        {layoutSection}

        {GROUPS.map(g => {
          const isOpen = !!open[g.id];
          return (
            <div key={g.id} className="rounded-xl border border-border bg-[#0b1220] overflow-hidden">
              <button
                onClick={() => setOpen(o => ({ ...o, [g.id]: !o[g.id] }))}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
              >
                <span className="font-display text-[13px] font-semibold text-slate-200 shrink-0">{g.title}</span>
                <span className="flex-1 min-w-0 text-[11.5px] text-slate-500 text-right truncate">{g.summary(raw)}</span>
                <span className="shrink-0 w-3 text-center text-[10px] text-slate-600">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="px-3.5 pb-1.5">
                  {g.fields.map(f => {
                    const clamp = clampByField.get(f.key as string);
                    const showInfo = infoKey === f.key;
                    return (
                      <div key={f.key as string} className="flex flex-col gap-1.5 py-2 border-b border-[#101a2c] last:border-0">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className="text-[13px] text-slate-200">{f.label}</span>
                            <button
                              onClick={() => setInfoKey(k => (k === f.key ? null : (f.key as string)))}
                              aria-label={`Explain ${f.label}`}
                              className="shrink-0 text-slate-600 hover:text-slate-400 transition"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                              </svg>
                            </button>
                          </div>
                          {f.type === 'date' ? (
                            <input
                              type="date" value={String(raw.startDate)}
                              onChange={e => onChange({ startDate: e.target.value })}
                              className="shrink-0 bg-ink border border-border rounded-[9px] px-2.5 py-2
                                         text-[12.5px] text-slate-200 font-display [color-scheme:dark]"
                            />
                          ) : (
                            <div className="shrink-0 flex items-center gap-2">
                              <button onClick={() => bump(f, -1)} aria-label={`Decrease ${f.label}`}
                                className="w-[34px] h-[34px] rounded-[9px] bg-[#0b1220] border border-border text-slate-400 text-base leading-none hover:border-slate-600 transition">−</button>
                              <span className="min-w-[76px] text-center font-display text-[13px] font-semibold tabular-nums text-slate-200">
                                {fmt(Number(raw[f.key]), f.step)}{f.unit ? ` ${f.unit}` : ''}
                              </span>
                              <button onClick={() => bump(f, 1)} aria-label={`Increase ${f.label}`}
                                className="w-[34px] h-[34px] rounded-[9px] bg-[#0b1220] border border-border text-slate-400 text-base leading-none hover:border-slate-600 transition">+</button>
                            </div>
                          )}
                        </div>
                        {showInfo && (
                          <p className="m-0 text-[11.5px] leading-relaxed text-sky-300/90 bg-sky-500/[0.06] border border-sky-500/20 rounded-lg px-2.5 py-1.5">
                            {f.info}
                          </p>
                        )}
                        {clamp && (
                          <p className="m-0 text-[11.5px] leading-relaxed text-amber-300/90 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                            Applied {fmt(clamp.applied, f.step)}{f.unit ? ` ${f.unit}` : ''}: {clamp.reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Rebuild upcoming plan — clears confirmed draft weeks, regenerates the
            future. Completed weeks stay locked; logged runs are never touched. */}
        <div className="rounded-xl border border-border bg-[#0b1220] px-3.5 py-3 flex flex-col gap-2">
          <span className="text-[12.5px] text-slate-300">Rebuild upcoming plan</span>
          <span className="text-[11px] leading-relaxed text-slate-500">
            Changing a setting already reshapes upcoming weeks. This clears any confirmed draft
            weeks and regenerates the future cleanly from these settings. Type{' '}
            <span className="font-mono text-slate-400">reset</span> to confirm. Completed weeks stay
            locked and your logged runs are never deleted.
          </span>
          <div className="flex gap-2">
            <input
              value={resetArm} onChange={e => setResetArm(e.target.value)}
              placeholder="type reset"
              className="flex-1 min-w-0 bg-ink border border-border rounded-[9px] px-3 py-2 text-[12.5px] text-slate-200 font-mono placeholder:text-slate-700 outline-none focus:border-slate-600"
            />
            <button
              disabled={resetArm.trim().toLowerCase() !== 'reset'}
              onClick={() => { onFullReset(); setResetArm(''); }}
              className={`shrink-0 px-3.5 rounded-[9px] font-display text-[12.5px] font-semibold transition ${
                resetArm.trim().toLowerCase() === 'reset'
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/40 cursor-pointer'
                  : 'bg-transparent text-slate-600 border border-border cursor-not-allowed'
              }`}
            >Rebuild</button>
          </div>
        </div>

        {/* Season reset — start a fresh base block from RECENT training. */}
        <div className="rounded-xl border border-border bg-[#0b1220] px-3.5 py-3 flex flex-col gap-2">
          <span className="text-[12.5px] text-slate-300">Start a new base block</span>
          <span className="text-[11px] leading-relaxed text-slate-500">
            After a season or a break, restart base from where you are now. It would start at{' '}
            <span className="text-slate-300 font-semibold">~{resetPreview.startMpw} mi/week</span>{' '}
            (from your recent training, not an old peak), with the long run seeded at{' '}
            <span className="text-slate-300">{resetPreview.trailingLongest.toFixed(1)} mi</span> and
            week 1 on {resetPreview.startDate}. Speed resets to base and PT clearances clear, so both
            are re-earned. Type <span className="font-mono text-slate-400">new base</span> to confirm.
            Your logged runs are kept, and completed weeks are never rewritten.
          </span>
          <div className="flex gap-2">
            <input
              value={seasonArm} onChange={e => setSeasonArm(e.target.value)}
              placeholder="type new base"
              className="flex-1 min-w-0 bg-ink border border-border rounded-[9px] px-3 py-2 text-[12.5px] text-slate-200 font-mono placeholder:text-slate-700 outline-none focus:border-slate-600"
            />
            <button
              disabled={seasonArm.trim().toLowerCase() !== 'new base'}
              onClick={() => { onSeasonReset(); setSeasonArm(''); }}
              className={`shrink-0 px-3.5 rounded-[9px] font-display text-[12.5px] font-semibold transition ${
                seasonArm.trim().toLowerCase() === 'new base'
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/40 cursor-pointer'
                  : 'bg-transparent text-slate-600 border border-border cursor-not-allowed'
              }`}
            >New base</button>
          </div>
        </div>

        <button
          onClick={onClose}
          className="h-[46px] rounded-xl bg-amber-500 text-ink font-display text-sm font-semibold"
        >Done</button>
      </div>
    </div>
  );
}
