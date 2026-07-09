import type { AdaptiveProfile } from '../lib/adaptive';

// Shows how the runner's own response personalizes their plan. Transparent and
// motivating, and honest about which direction it moves. As of Phase 2C it
// moves in EITHER direction, but asymmetrically: it can ease the build or hold
// the long run (Phase 2A/2B), OR — only when recent training is provably clean —
// let the build use a slightly wider weekly cap (Phase 2C earned-trust). It
// never loosens a hard safety cap (long-run, pain, peak). This modulation shapes
// BOTH the displayed rolling plan and the weeks you Generate. Display + reasons only.

const TONE: Record<AdaptiveProfile['readiness'], { chip: string; bar: string }> = {
  building: { chip: 'bg-teal-500/10 text-teal-300 border-teal-500/30', bar: '#2dd4bf' },
  steady:   { chip: 'bg-teal-500/10 text-teal-300 border-teal-500/30', bar: '#2dd4bf' },
  cautious: { chip: 'bg-amber-500/10 text-amber-300 border-amber-500/30', bar: '#f59e0b' },
  hold:     { chip: 'bg-rose-500/10 text-rose-300 border-rose-500/30', bar: '#fb7185' },
};

export default function AdaptiveInsight({ profile }: { profile: AdaptiveProfile }) {
  const earned = profile.earnedTrust.active;
  // Earned-trust reads as a confident "building" state (emerald) rather than the
  // ordinary teal, to distinguish "wider earned cap" from plain full-rate.
  const tone = earned
    ? { chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', bar: '#34d399' }
    : TONE[profile.readiness];
  const pct = Math.round(profile.growthFactor * 100);

  return (
    <section data-block="adaptive" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">TRAINING RESPONSE</span>
        <span className="text-[11px] text-slate-700">shapes your rolling plan</span>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={`inline-flex items-center px-[11px] py-1 rounded-full font-display text-[11px] font-semibold tracking-[0.05em] border ${tone.chip}`}>
          {profile.headline}
        </span>
        {/* Phase 2D: earned-trust status chip — always visible, four states. */}
        <span className={`inline-flex items-center px-[9px] py-1 rounded-full font-display text-[10px] font-semibold tracking-[0.08em] border ${
          earned ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
          : profile.earnedTrust.blockedBy ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
          : profile.earnedTrust.cooldownDaysLeft != null ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
          : 'bg-slate-500/10 text-slate-400 border-border'}`}>
          {earned ? 'EARNED-TRUST · ACTIVE'
            : profile.earnedTrust.blockedBy ? 'EARNED-TRUST · PAUSED'
            : profile.earnedTrust.cooldownDaysLeft != null ? `EARNED-TRUST · RE-EARNING (${profile.earnedTrust.cooldownDaysLeft}d)`
            : 'EARNED-TRUST · NOT YET'}
        </span>
      </div>

      {/* Earned-trust callout — calm, confidence-framed (not a reward). */}
      {earned && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5 flex flex-col gap-1">
          <span className="font-display text-[10px] font-semibold tracking-[0.1em] text-emerald-300">
            SLIGHTLY WIDER WEEKLY CAP
          </span>
          <p className="m-0 text-[11.5px] leading-snug text-slate-400">
            Recent training has been clean, so the build can use a slightly wider weekly cap
            (+{Math.round((profile.earnedTrust.growthMax - 1) * 100)}% vs the usual +10%). Still capped by the
            long-run, pain, recovery, and peak rules — and it pauses the moment any of those signals worsen.
          </p>
        </div>
      )}

      {/* Phase 2D clarity: WHY trust is inactive — the pause reason, the
          cooldown countdown, or exactly what evidence is still missing. */}
      {!earned && (
        <div className="rounded-lg border border-border bg-ink px-3 py-2.5 flex flex-col gap-1">
          <span className="font-display text-[10px] font-semibold tracking-[0.1em] text-slate-500">
            {profile.earnedTrust.blockedBy ? 'WHY TRUST IS PAUSED'
              : profile.earnedTrust.cooldownDaysLeft != null ? 'RE-EARNING AFTER A WARNING'
              : 'WHAT EARNS THE WIDER CAP'}
          </span>
          <p className="m-0 text-[11.5px] leading-snug text-slate-500">{profile.earnedTrust.reason}</p>
          {profile.earnedTrust.missing.length > 0 && (
            <ul className="m-0 mt-0.5 pl-4 list-disc marker:text-slate-600 flex flex-col gap-0.5">
              {profile.earnedTrust.missing.map((m, i) => (
                <li key={i} className="text-[11px] leading-snug text-slate-500">{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Build-rate bar: how much of the normal (already-capped) step is in play. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2 text-[11.5px] text-slate-500 tabular-nums">
          <span>Build rate</span>
          <span className="font-display text-slate-300 font-semibold">{pct}%</span>
          <span className="text-slate-600">of the normal safe step</span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: tone.bar }} />
        </div>
      </div>

      {/* Signals from the runner's own log. */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Signal label="clean weeks" value={String(profile.cleanWeeks)} />
        <Signal label="pain days / 90" value={String(profile.breachDays90)} />
        <Signal label="adherence" value={`${Math.round(profile.adherence * 100)}%`} />
      </div>

      <div className="flex flex-col gap-1 border-t border-[#101a2c] pt-2.5">
        {profile.reasons.map((r, i) => (
          <p key={i} className="m-0 text-[11.5px] leading-snug text-slate-500">{r}</p>
        ))}
        <p className="m-0 text-[11px] leading-snug text-slate-600">
          {earned
            ? 'Earned-trust only widens the weekly volume step a little — it never raises the long-run cap, the peak, or unlocks speed. It reverts to the normal cap instantly if pain, recovery, or RPE signals worsen. Locked and completed weeks are never changed.'
            : 'This shapes your upcoming rolling plan and the weeks you Generate — easing the build or holding the long run, never raising your hard caps or unlocking speed. Locked and completed weeks are never changed.'}
        </p>
      </div>
    </section>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink border border-border py-2">
      <div className="font-display text-base font-semibold tabular-nums text-slate-200">{value}</div>
      <div className="text-[10px] text-slate-600">{label}</div>
    </div>
  );
}
