import type { MissedAssessment } from '../lib/missedDays';

// Advisory-only companion to WeekProgress: appears when the current week has
// missed run days, says what the plan does about them (usually: nothing — by
// design), and disappears once the week has no missed days to explain. It has
// no buttons that add miles anywhere: missed volume is never made up.
export default function MissedDaysCard({ a }: { a: MissedAssessment }) {
  const tone =
    a.kind === 'flare' ? 'border-rose-900/50 bg-rose-950/20'
    : a.kind === 'reentry' ? 'border-amber-900/50 bg-amber-950/20'
    : 'border-border bg-card-alt/40';
  const headTone =
    a.kind === 'flare' ? 'text-rose-300'
    : a.kind === 'reentry' ? 'text-amber-300'
    : 'text-slate-300';

  return (
    <section data-block="missed" className={`rounded-2xl border px-[18px] py-3.5 space-y-1.5 ${tone}`}>
      <div className="flex items-center gap-2">
        <span className={`text-[12.5px] font-display font-semibold leading-snug ${headTone}`}>
          {a.headline}
        </span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-slate-500">{a.detail}</p>
      {a.kind === 'resume' && (
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Why no make-up runs: redistributed easy miles and rest-day catch-ups are the most common
          self-inflicted load spike (Koop/CTS · RunnersConnect · CARA). Consistency wins the block, not any one day.
        </p>
      )}
    </section>
  );
}
