interface Props {
  capPct: number;
  hrBand: string;
  hrHardCap: number;
}

const RULES = (capPct: number, hrBand: string, hrHardCap: number) => [
  { title: 'Long-run cap', body: `No single run exceeds ${capPct}% of your longest in the last 30 days. The gauge is the cap.` },
  { title: 'HR ceiling, not pace', body: `${hrBand} bpm, hard cap ${hrHardCap}. If the talk test fails, slow down. Pace is irrelevant this block.` },
  { title: 'No speed until cleared', body: 'Every rung of the ladder waits for pain-free runs, not motivation.' },
  { title: 'Flare = repeat, not push', body: 'Any flare eases the plan back a week. Repeating a week is the plan working, not failing.' },
];

export default function GuardrailPanel({ capPct, hrBand, hrHardCap }: Props) {
  return (
    <section data-block="guardrails" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">WHY THIS IS SAFE</span>
      <div className="flex flex-col gap-[11px]">
        {RULES(capPct, hrBand, hrHardCap).map(r => (
          <div key={r.title} className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold text-slate-200">{r.title}</span>
            <span className="text-xs leading-relaxed text-slate-500">{r.body}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
