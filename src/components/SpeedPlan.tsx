import { useState } from 'react';
import type { GlobalState, RunState, SpeedStateNum } from '../lib/types';
import {
  SPEED_STATE_NAMES, SPEED_TYPES, MAX_SPEED_TIER, typeStatus,
  evaluateReadiness, canSetState, type TypeStatus, type SpeedType,
} from '../lib/speed';
import type { SpeedGuard } from '../lib/speedGuard';

interface Props {
  runState: RunState;
  globals: GlobalState;
  today: string;
  /** Phase 2D guard: active blockers + the tier usable today. */
  guard: SpeedGuard;
  onUpdateGlobals: (patch: Partial<GlobalState>) => void;
}

const DOT: Record<TypeStatus, string> = { allowed: '#2dd4bf', delayed: '#f59e0b', locked: '#334155' };
const CHIP: Record<TypeStatus, string> = {
  allowed: 'bg-teal-500/[0.12] text-teal-300 border-teal-500/35',
  delayed: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  locked: 'bg-slate-500/10 text-slate-500 border-border',
};

function unlockLine(t: SpeedType, status: TypeStatus, suppressed: boolean): string {
  if (status === 'allowed') {
    return suppressed
      ? 'Earned, but paused this week by a hold signal — nothing is lost'
      : `Available now: ${t.maxFreq}, ${t.fastVolume}`;
  }
  if (status === 'delayed') return 'Unlocked, but on a delay window. Resumes when the delay passes';
  const gate = t.extraGateLabel ? ` + ${t.extraGateLabel}` : '';
  return `Unlocks at tier ${t.unlockState}${gate}`;
}

export default function SpeedPlan({ runState, globals, today, guard, onUpdateGlobals }: Props) {
  const [rung, setRung] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

  const settings = globals.settings ?? null;
  const state = globals.speedState;
  const flare = guard.blockers.some(b => b.key === 'flare');
  const hardHold = guard.holdTier;
  const upTarget = Math.min(state + 1, MAX_SPEED_TIER) as SpeedStateNum;
  const readiness = state < MAX_SPEED_TIER ? evaluateReadiness(upTarget, runState, globals, today, settings) : null;
  const upCheck = state < MAX_SPEED_TIER ? canSetState(upTarget, runState, globals, today, settings) : null;
  // A new unlock also needs a blocker-free week (HOLD_TIER freezes the ladder).
  const up = upCheck && (!upCheck.allowed || !hardHold)
    ? upCheck
    : upCheck && { allowed: false, reason: `this week is held: ${guard.blockers.map(b => b.label).join(' · ')}` };

  function setSpeedState(target: SpeedStateNum) {
    const check = canSetState(target, runState, globals, today, settings);
    if (check.allowed && (target < state || !hardHold)) onUpdateGlobals({ speedState: target });
  }
  function setClearance(key: 'hipSafeFlag' | 'ptClearedSpeed' | 'ptClearedIntensity', v: boolean) {
    if (v && !window.confirm('Only turn this on after your PT has explicitly cleared it. Confirm?')) return;
    onUpdateGlobals({ [key]: v });
  }

  return (
    <section data-block="speed" className="card !rounded-2xl px-2 py-1.5 flex flex-col">
      <div className="flex items-baseline justify-between gap-2.5 px-2.5 pt-2 pb-2">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">SPEED PLAN · WHAT UNLOCKS NEXT</span>
        <span className={`tag ${flare ? 'tag-rose' : 'tag-amber'} text-[10px]`}>tier {state}/8</span>
      </div>

      {/* Active blockers — why speed is held below the earned tier right now.
          Calm framing: "protecting you", never "behind". */}
      {guard.blockers.length > 0 && (
        <div className="mx-2.5 mb-2 rounded-xl bg-amber-500/[0.06] border border-amber-500/20 px-3 py-2.5 flex flex-col gap-1">
          <span className="font-display text-[10px] font-semibold tracking-[0.1em] text-amber-300">
            SPEED HOLDS THIS WEEK · usable tier {guard.effectiveTier}
          </span>
          {guard.blockers.map(b => (
            <p key={b.key} className="m-0 text-[11px] leading-snug text-slate-400">
              <span className="text-amber-300/90">{b.label}:</span> {b.detail}
            </p>
          ))}
        </div>
      )}

      {/* Ready-to-advance CTA — surfaced here so progression isn't buried. */}
      {!flare && state < MAX_SPEED_TIER && up?.allowed && (
        <button
          onClick={() => setSpeedState(upTarget)}
          className="mx-2.5 mb-2 rounded-xl bg-teal-500/[0.12] border border-teal-500/40 px-3 py-2.5 text-left transition hover:border-teal-500/70"
        >
          <span className="font-display text-[12.5px] font-semibold text-teal-300">Ready — advance to {SPEED_STATE_NAMES[upTarget].replace(' allowed', '')}</span>
          <span className="block text-[11px] text-slate-500">Readiness is all green. Tap to unlock the next rung. You can always step back down.</span>
        </button>
      )}

      {/* Ladder */}
      {SPEED_TYPES.map((t, i) => {
        const rawStatus = flare ? 'locked' : typeStatus(t, globals, today);
        // Suppression: earned but currently held below the effective tier.
        const suppressed = rawStatus === 'allowed' && t.unlockState > guard.effectiveTier;
        const status = rawStatus;
        const caution = t.requires?.includes('hipSafe');
        const open = rung === t.key;
        return (
          <div key={t.key} className={i === 0 ? '' : 'border-t border-[#101a2c]'}>
            <button
              onClick={() => setRung(r => (r === t.key ? null : t.key))}
              aria-expanded={open}
              className="w-full flex items-center gap-2 px-2.5 py-[11px] text-left"
            >
              <span className="shrink-0 w-[7px] h-[7px] rounded-full" style={{ background: suppressed ? '#f59e0b' : DOT[status] }} />
              <span className={`font-display text-[13px] font-semibold ${status === 'locked' ? 'text-slate-500' : 'text-slate-200'}`}>{t.name}</span>
              {caution && <span className="text-[11px] text-rose-400">⚑</span>}
              <span className={`ml-auto inline-flex px-2 py-[3px] rounded-full font-display text-[10px] font-semibold tracking-[0.1em] uppercase border ${suppressed ? CHIP.delayed : CHIP[status]}`}>
                {suppressed ? 'held' : status}
              </span>
              <span className="shrink-0 w-3 text-center text-[10px] text-slate-600">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <div className="flex flex-col gap-1.5 pl-6 pr-2.5 pb-3">
                <div className="flex gap-1.5 flex-wrap">
                  <span className={`inline-flex px-2 py-0.5 rounded-full font-display text-[10px] font-semibold tracking-[0.08em] border ${t.lowDose ? 'bg-teal-500/[0.07] text-teal-300 border-teal-500/20' : 'bg-slate-500/[0.08] text-slate-500 border-border'}`}>
                    {t.bucket === 'neuromuscular' ? 'neuromuscular · not counted as hard'
                      : t.bucket === 'light' ? 'light · ½ hard unit'
                      : 'hard workout · 1 unit'}
                  </span>
                  {caution && <span className="inline-flex px-2 py-0.5 rounded-full font-display text-[10px] font-semibold tracking-[0.08em] bg-rose-500/10 text-rose-400 border border-rose-500/30">HIP CAUTION</span>}
                </div>
                <p className="m-0 text-[12.5px] leading-relaxed text-slate-400">{t.plain}</p>
                <p className={`m-0 text-[11.5px] leading-snug ${caution ? 'text-rose-400/85' : status === 'allowed' && !suppressed ? 'text-teal-300' : 'text-slate-600'}`}>{unlockLine(t, status, suppressed)}</p>
              </div>
            )}
          </div>
        );
      })}

      {/* Manage state (controls kept, tucked below the ladder) */}
      <div className="border-t border-[#101a2c] mt-1">
        <button onClick={() => setManage(m => !m)} aria-expanded={manage} className="w-full flex items-center justify-between px-2.5 py-2.5 text-left">
          <span className="text-[11px] text-slate-500">Manage state, clearances &amp; delay</span>
          <span className="text-[10px] text-slate-600">{manage ? '▾' : '▸'}</span>
        </button>
        {manage && (
          <div className="px-2.5 pb-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => state > 0 && setSpeedState((state - 1) as SpeedStateNum)} disabled={state <= 0}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500 disabled:opacity-30 transition">↓ step down</button>
              <button onClick={() => state < MAX_SPEED_TIER && up?.allowed && setSpeedState(upTarget)} disabled={state >= MAX_SPEED_TIER || !up?.allowed}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${up?.allowed ? 'border-teal-700 text-teal-300 hover:border-teal-500' : 'border-border text-slate-600 disabled:opacity-40'}`}>↑ advance to {Math.min(state + 1, MAX_SPEED_TIER)}</button>
              {state > 0 && (
                <button onClick={() => onUpdateGlobals({ speedState: 0 })} className="ml-auto rounded-lg border border-rose-900 px-3 py-1.5 text-xs text-rose-400 hover:border-rose-700 transition">flare → lock speed</button>
              )}
            </div>
            {up && !up.allowed && state < MAX_SPEED_TIER && <p className="text-[11px] text-slate-600 leading-relaxed">Locked: {up.reason}</p>}
            <p className="text-[11px] text-slate-600">Current: tier {state} · {SPEED_STATE_NAMES[state]}. Downward anytime; upward needs the checklist all-green and no active holds.</p>

            {readiness && (
              <div className="flex flex-col gap-1.5">
                <button onClick={() => setShowChecklist(s => !s)} className="text-[11px] text-slate-500 hover:text-slate-300 transition text-left">
                  {showChecklist ? '▾' : '▸'} readiness for tier {upTarget}
                  <span className={readiness.allGreen ? 'text-teal-400 ml-1' : 'text-amber-400 ml-1'}>{readiness.items.filter(i => i.ok).length}/{readiness.items.length} green</span>
                </button>
                {showChecklist && (
                  <ul className="flex flex-col gap-1">
                    {readiness.items.map(item => (
                      <li key={item.key} className="flex items-start gap-2 text-[11px]">
                        <span className={item.ok ? 'text-teal-400' : 'text-rose-400'}>{item.ok ? '✓' : '✗'}</span>
                        <span className="text-slate-500">{item.label} <span className="text-slate-700">· {item.detail}</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="rounded-lg bg-ink border border-border px-3 py-2.5 flex flex-col gap-2">
              <p className="text-[10px] text-slate-600 uppercase tracking-wider">PT clearances &amp; delay</p>
              <GateToggle label="Hip-safe flag" hint="you + PT agree the hip tolerates load" value={globals.hipSafeFlag} onChange={v => setClearance('hipSafeFlag', v)} />
              <GateToggle label="PT cleared speed" hint="needed with hip-safe for hill strides (3→4)" value={globals.ptClearedSpeed} onChange={v => setClearance('ptClearedSpeed', v)} />
              <GateToggle label="PT cleared intensity" hint="needed for VO₂/race work (7→8)" value={globals.ptClearedIntensity} onChange={v => setClearance('ptClearedIntensity', v)} />
              <label className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>Delay speed until<span className="text-slate-700 block text-[10px]">upward moves blocked before this date</span></span>
                <input type="date" value={globals.delayUntil ?? ''} onChange={e => onUpdateGlobals({ delayUntil: e.target.value || null })}
                  className="bg-ink border border-border rounded px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-teal-500/50 transition [color-scheme:dark]" />
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function GateToggle({ label, hint, value, onChange }: {
  label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
      <span>{label}<span className="text-slate-700 block text-[10px]">{hint}</span></span>
      <button onClick={() => onChange(!value)} role="switch" aria-checked={value} aria-label={label}
        className={`w-9 h-5 rounded-full border transition relative shrink-0 ${value ? 'bg-teal-900/60 border-teal-700' : 'bg-ink border-border'}`}>
        <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${value ? 'left-[18px] bg-teal-400' : 'left-0.5 bg-slate-600'}`} />
      </button>
    </div>
  );
}
