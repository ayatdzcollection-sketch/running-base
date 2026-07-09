import { SPEED_STATE_NAMES } from '../lib/speed';
import type { SpeedStateNum } from '../lib/types';

interface Props {
  speedState: SpeedStateNum;
  hipHold: boolean;      // derived: flare or a recent breach in effect
  flare: boolean;
  streak: number;
  pfNeeded: number;
  /** Phase 2D: the tier usable TODAY (stored tier minus active blockers). */
  effectiveTier?: SpeedStateNum;
  /** First active blocker's label when speed is being held below the tier. */
  heldBy?: string | null;
}

// The 9 ladder tiers (0–8). Flare/deload is an override shown separately.
const TIER_LABELS = [
  'Locked', 'Buildups', 'Short strides', 'Flat strides', 'Hill strides',
  'Light fartlek', 'Cruise intervals', 'Tempo', 'VO₂ / race',
];

export default function HipSpeedStatus({
  speedState, hipHold, flare, streak, pfNeeded, effectiveTier, heldBy,
}: Props) {
  const tier = Math.min(Math.max(speedState, 0), 8);
  const eff = effectiveTier != null ? Math.min(effectiveTier, tier) : tier;
  const suppressed = !flare && eff < tier;
  const speedLabel = flare ? 'Flare / deload' : TIER_LABELS[tier] ?? SPEED_STATE_NAMES[speedState];
  const nextTierName = tier < 8 ? TIER_LABELS[tier + 1] : null;
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
        {suppressed && (
          <span className={`${chip} bg-amber-500/[0.12] text-amber-300 border-amber-500/30`}>
            Held at: {TIER_LABELS[eff]}
          </span>
        )}
      </div>

      {/* 8-segment tier bar (tiers 1–8; tier 0 = nothing lit) */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1">
          {TIER_LABELS.slice(1).map((_, i) => {
            const t = i + 1; // tier this segment represents
            const lit = !flare && t <= tier;
            const dimmed = lit && suppressed && t > eff;
            return (
              <div key={t} className="flex-1 h-[5px] rounded-[3px]"
                style={{
                  background: flare ? 'rgba(251,113,133,.22)'
                    : dimmed ? 'rgba(245,158,11,.35)'
                    : lit ? '#2dd4bf' : '#1e293b',
                }} />
            );
          })}
        </div>
        <span className="text-[11.5px] text-slate-500">
          {flare
            ? 'Progression paused. The plan repeats until the hip settles.'
            : suppressed
              ? `Tier ${tier} earned · temporarily held at ${TIER_LABELS[eff]}${heldBy ? ` (${heldBy.toLowerCase()})` : ''}. Nothing is lost — it resumes when the signal clears.`
              : `Tier ${tier} of 8${nextTierName ? ` · next: ${nextTierName}` : ' · top of the ladder'}`}
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
            ? 'Streak paused. Restarts when the hip settles.'
            : streak >= pfNeeded
              ? `Pain-free runs ${pfNeeded} / ${pfNeeded} · next step ready`
              : `Pain-free runs ${streak} / ${pfNeeded} · unlocks the next step`}
        </span>
      </div>
    </section>
  );
}
