import type { ReentryRecord } from '../lib/planOverlay';

// Explains a missed-week re-entry cut while the week it shaped is live. The
// adjustment itself happens in the engine (planOverlay's anchor); this card
// exists because a silently changed number reads as a bug, however protective
// it is. Display-only.
export default function ReentryNotice({ r, weekTotal }: { r: ReentryRecord; weekTotal: number | null }) {
  const pct = Math.round((r.actual / r.prescribed) * 100);
  const shown = weekTotal != null ? weekTotal.toFixed(1) : r.to.toFixed(1);
  return (
    <section data-block="reentry" className="rounded-2xl border border-sky-900/50 bg-sky-950/20 px-[18px] py-3.5 space-y-1.5">
      <span className="text-[12.5px] font-display font-semibold text-sky-300 leading-snug">
        {r.maintain
          ? `Re-entering at ${shown} mi — climbing back to the ${r.from.toFixed(1)} mi hold.`
          : `This week re-entered at ${shown} mi.`}
      </span>
      <p className="text-[11.5px] leading-relaxed text-slate-500 m-0">
        Last week logged {r.actual.toFixed(1)} of {r.prescribed.toFixed(1)} planned ({pct}%). After a week that
        far under plan, jumping straight back to the paper number is the classic overuse spike — so the plan
        re-enters at whichever is higher: what you ran +10%, or 80% of your build trajectory
        ({r.from.toFixed(1)} → {r.to.toFixed(1)}).{' '}
        {r.maintain
          ? `Season weeks now step back up (≤ +10%/wk) until the ${r.from.toFixed(1)} mi hold is reached, then hold — the hold itself never rises in season. Practice sets your real load; at season's end the plan re-anchors to what you actually logged.`
          : 'Build weeks step back up from here automatically.'}
      </p>
    </section>
  );
}
