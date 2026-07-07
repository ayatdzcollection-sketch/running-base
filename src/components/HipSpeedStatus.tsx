import { SPEED_STATE_NAMES } from '../lib/speed';
import type { SpeedStateNum } from '../lib/types';

interface Props {
  speedState: SpeedStateNum;
  hipHold: boolean;      // derived: flare or a recent breach in effect
  flare: boolean;
  streak: number;
  pfNeeded: number;
}

// The 7 progression states (flare/deload is the 8th override, shown separately).
const STATE_LABELS = [
  'Base only', 'Buildups', 'Short strides', 'Flat strides',
  'Intro hills', 'Intro threshold', 'Structured speed',
];

export default function HipSpeedStatus({ speedState, hipHold, flare, streak, pfNeeded }: Props) {
  const idx = Math.min(speedState, 7) - 1; // 0-based into the 7 progression states
  const speedLabel = flare ? 'Flare / deload' : STATE_LABELS[idx] ?? SPEED_STATE_NAMES[speedState];
  const nextStateName = speedState < 7 ? STATE_LABELS[speedState] : null;
  const chip = 'inline-flex items-center px-[11px] py-1 rounded-full font-display text-[11px] font-semibold tracking-[0.05em] border';

  return (
    <section data-block="hipspeed" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-[13px]">
      <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">HIP + SPEED STATUS</span>

      <div className="flex gap-2 flex-wrap">
        <span className={`${chip} ${flare ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' : 'bg-teal-500/[0.12] text-teal-300 border-teal-500/35'}`}>
          Speed: {speedLabel}
        </span>
        <span className={`${chip} ${hipHold ? 'bg-amber-500/[0.12] text-amber-300 border-amber-500/30' : 'bg-teal-500/[0.12] text-teal-300 border-teal-500/35'}`}>
          Hip: {hipHold ? 'Hold' : 'Clear'}
        </span>
      </div>

      {/* 7-segment state bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1">
          {STATE_LABELS.map((_, i) => (
            <div key={i} className="flex-1 h-[5px] rounded-[3px]"
              style={{ background: flare ? 'rgba(251,113,133,.22)' : i <= idx ? '#2dd4bf' : '#1e293b' }} />
          ))}
        </div>
        <span className="text-[11.5px] text-slate-500">
          {flare
            ? 'Progression paused — the plan repeats until the hip settles.'
            : `State ${speedState} of 7${nextStateName ? ` · next: ${nextStateName}` : ' · top of the base ladder'}`}
        </span>
      </div>

      <div className="h-px bg-[#101a2c]" />

      {/* Pain-free streak pips */}
      <div className="flex items-center gap-2.5">
        <div className="flex gap-1.5">
          {Array.from({ length: pfNeeded }, (_, i) => (
            <div key={i} className="w-[9px] h-[9px] rounded-full border"
              style={{
                background: i < streak ? '#2dd4bf' : '#1e293b',
                borderColor: i < streak ? '#2dd4bf' : '#334155',
              }} />
          ))}
        </div>
        <span className="text-xs text-slate-400">
          {flare
            ? 'Streak paused — restarts when the hip settles.'
            : streak >= pfNeeded
              ? `Pain-free runs ${pfNeeded} / ${pfNeeded} — next step ready`
              : `Pain-free runs ${streak} / ${pfNeeded} — unlocks the next step`}
        </span>
      </div>
    </section>
  );
}
