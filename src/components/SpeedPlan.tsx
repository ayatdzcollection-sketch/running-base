import { useState } from 'react';
import type { GlobalState, RunState, SpeedStateNum } from '../lib/types';
import {
  SPEED_STATE_NAMES, SPEED_TYPES, typeStatus,
  evaluateReadiness, canSetState,
} from '../lib/speed';
import { painFreeStreak } from '../lib/metrics';

interface Props {
  runState: RunState;
  globals: GlobalState;
  today: string;
  onUpdateGlobals: (patch: Partial<GlobalState>) => void;
}

export default function SpeedPlan({ runState, globals, today, onUpdateGlobals }: Props) {
  const [open, setOpen] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

  const settings = globals.settings ?? null;
  const state = globals.speedState;
  const streak = painFreeStreak(runState, globals.painCap);
  const upTarget = Math.min(state + 1, 8) as SpeedStateNum;
  const readiness = state < 8 ? evaluateReadiness(upTarget, runState, globals, today, settings) : null;
  const up = state < 7 ? canSetState(upTarget, runState, globals, today, settings) : null;

  function setState(target: SpeedStateNum) {
    const check = canSetState(target, runState, globals, today, settings);
    if (check.allowed) onUpdateGlobals({ speedState: target });
  }

  // Turning a clearance ON is a safety decision — confirm it reflects real PT
  // sign-off. Turning OFF applies immediately; the app effect then downgrades
  // the state if a gate is now unmet.
  function setClearance(key: 'hipSafeFlag' | 'ptClearedSpeed' | 'ptClearedIntensity', v: boolean) {
    if (v && !window.confirm('Only turn this on after your PT has explicitly cleared it. Confirm?')) return;
    onUpdateGlobals({ [key]: v });
  }

  return (
    <div className="card space-y-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-1 py-1 text-left hover:opacity-80 transition"
      >
        <span className="flex items-center gap-2">
          <h3 className="font-display text-sm font-semibold text-slate-300">Speed Plan</h3>
          <span className={`tag text-[10px] px-1.5 py-0.5 ${state === 8 ? 'tag-rose' : state === 1 ? 'tag-teal' : 'tag-amber'}`}>
            state {state} · {SPEED_STATE_NAMES[state]}
          </span>
        </span>
        <span className="text-slate-600 text-xs">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4 border-t border-border pt-3">

          {/* State controls */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => state > 1 && setState((state - 1) as SpeedStateNum)}
                disabled={state <= 1}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-slate-400
                           hover:border-slate-500 disabled:opacity-30 transition"
              >
                ↓ step down
              </button>
              <button
                onClick={() => state < 7 && setState(upTarget)}
                disabled={state >= 7 || !up?.allowed}
                className={`rounded-lg border px-3 py-1.5 text-xs transition
                  ${up?.allowed
                    ? 'border-teal-700 text-teal-400 hover:border-teal-500'
                    : 'border-border text-slate-600 disabled:opacity-40'}`}
              >
                ↑ advance to {Math.min(state + 1, 7)}
              </button>
              {state !== 8 && (
                <button
                  onClick={() => setState(8)}
                  className="ml-auto rounded-lg border border-rose-900 px-3 py-1.5 text-xs
                             text-rose-400 hover:border-rose-700 transition"
                >
                  flare → deload
                </button>
              )}
              {state === 8 && (
                <button
                  onClick={() => setState(1)}
                  className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs
                             text-slate-400 hover:border-slate-500 transition"
                >
                  exit deload → base
                </button>
              )}
            </div>
            {up && !up.allowed && state < 7 && (
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Locked: {up.reason}
              </p>
            )}
            <p className="text-[11px] text-slate-600">
              Downward anytime. Upward needs the checklist all-green. Pain-free streak: <span className="text-slate-400 tabular-nums">{streak}</span>
            </p>
          </div>

          {/* Readiness checklist */}
          {readiness && (
            <div className="space-y-1.5">
              <button
                onClick={() => setShowChecklist(s => !s)}
                className="text-[11px] text-slate-500 hover:text-slate-300 transition"
              >
                {showChecklist ? '▴' : '▸'} readiness checklist for state {upTarget}
                <span className={readiness.allGreen ? 'text-teal-500 ml-1' : 'text-amber-500 ml-1'}>
                  {readiness.items.filter(i => i.ok).length}/{readiness.items.length} green
                </span>
              </button>
              {showChecklist && (
                <ul className="space-y-1">
                  {readiness.items.map(item => (
                    <li key={item.key} className="flex items-start gap-2 text-[11px]">
                      <span className={item.ok ? 'text-teal-500' : 'text-rose-400'}>
                        {item.ok ? '✓' : '✗'}
                      </span>
                      <span className="text-slate-500">
                        {item.label} <span className="text-slate-700">— {item.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* PT gates + delay */}
          <div className="space-y-2 rounded-lg bg-ink border border-border px-3 py-2.5">
            <p className="text-[10px] text-slate-600 uppercase tracking-wider">Gates & delay</p>
            <GateToggle
              label="Hip-safe flag"
              hint="you + PT agree the hip tolerates load"
              value={globals.hipSafeFlag}
              onChange={v => setClearance('hipSafeFlag', v)}
            />
            <GateToggle
              label="PT cleared speed"
              hint="needed with hip-safe for hills (4→5)"
              value={globals.ptClearedSpeed}
              onChange={v => setClearance('ptClearedSpeed', v)}
            />
            <GateToggle
              label="PT cleared intensity"
              hint="needed for structured speed (6→7)"
              value={globals.ptClearedIntensity}
              onChange={v => setClearance('ptClearedIntensity', v)}
            />
            <label className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>
                Delay speed until
                <span className="text-slate-700 block text-[10px]">upward moves blocked before this date</span>
              </span>
              <input
                type="date"
                value={globals.delayUntil ?? ''}
                onChange={e => onUpdateGlobals({ delayUntil: e.target.value || null })}
                className="bg-ink border border-border rounded px-2 py-1 text-[11px]
                           text-slate-300 outline-none focus:border-teal-500/50 transition"
              />
            </label>
          </div>

          {/* Per-type cards */}
          <div className="space-y-2">
            {SPEED_TYPES.map(t => {
              const status = typeStatus(t, globals, today);
              return (
                <div
                  key={t.key}
                  className={`rounded-lg border px-3 py-2.5 space-y-1.5
                    ${status === 'allowed'
                      ? t.lowDose ? 'border-teal-900/50 bg-teal-950/20' : 'border-amber-900/50 bg-amber-950/15'
                      : status === 'delayed' ? 'border-sky-900/50 bg-sky-950/15 opacity-80'
                      : 'border-border bg-ink opacity-60'}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-xs font-semibold text-slate-300">{t.name}</span>
                    {t.lowDose && <span className="tag tag-teal text-[9px] px-1 py-0">low-dose</span>}
                    {!t.lowDose && <span className="tag tag-amber text-[9px] px-1 py-0">workout</span>}
                    <span className={`ml-auto tag text-[9px] px-1.5 py-0.5
                      ${status === 'allowed' ? 'tag-teal' : status === 'delayed' ? 'tag-sky' : 'tag-rose'}`}>
                      {status === 'allowed' ? 'Allowed' : status === 'delayed' ? 'Delayed' : 'Locked'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{t.plain}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-slate-600">
                    <span>Trains: <span className="text-slate-500">{t.trains}</span></span>
                    <span>Max: <span className="text-slate-500">{t.maxFreq} · {t.fastVolume}</span></span>
                    <span className="col-span-2">
                      Unlocks: <span className="text-slate-500">
                        state {t.unlockState}{t.extraGateLabel ? ` + ${t.extraGateLabel}` : ''}
                      </span>
                    </span>
                    <span className="col-span-2">
                      Downgrades on: <span className="text-rose-400/80">{t.downgrade}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-600 leading-relaxed border-t border-border pt-2">
            Strides are short controlled accelerations with full recovery — an add-on, not a
            workout, so they carry far less fatigue and injury cost than intervals
            (mechanistic / coaching consensus, not proven by trial). State 8 locks everything
            and supersedes all other permissions.
          </p>
        </div>
      )}
    </div>
  );
}

function GateToggle({ label, hint, value, onChange }: {
  label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-500 cursor-pointer">
      <span>
        {label}
        <span className="text-slate-700 block text-[10px]">{hint}</span>
      </span>
      <button
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        className={`w-9 h-5 rounded-full border transition relative shrink-0
          ${value ? 'bg-teal-900/60 border-teal-700' : 'bg-ink border-border'}`}
      >
        <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all
          ${value ? 'left-[18px] bg-teal-400' : 'left-0.5 bg-slate-600'}`} />
      </button>
    </label>
  );
}
