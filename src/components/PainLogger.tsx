import type { RunEntry, SpeedStateNum } from '../lib/types';
import SubjectiveRow from './SubjectiveRow';

interface Props {
  today: string;
  entry: RunEntry | undefined;
  painCap: number;
  speedState: SpeedStateNum;
  onUpdate: (date: string, updates: Partial<RunEntry>) => void;
  // Morning-after settle prompt — only present when a prior pain day is pending.
  morningCheckDate: string | null;
  morningPainDuring: number;
  onMorningAnswer: (settled: boolean) => void;
  /** Inside a coach-led season — surfaces the coach-workout tap. */
  inSeason?: boolean;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PainLogger({
  today, entry, painCap, speedState, onUpdate,
  morningCheckDate, morningPainDuring, onMorningAnswer, inSeason,
}: Props) {
  const morningLabel = morningCheckDate ? DOW[new Date(morningCheckDate + 'T12:00:00Z').getUTCDay()] : '';

  return (
    <section data-block="pain" className="card !rounded-2xl px-[18px] py-4 flex flex-col gap-3">
      <div className="flex justify-between items-baseline gap-2.5">
        <span className="font-display text-[10.5px] font-semibold tracking-[0.12em] text-slate-500">HIP CHECK</span>
        <span className="text-[11px] text-slate-700">optional · one tap · saves with the day</span>
      </div>

      <p className="m-0 text-[13px] text-slate-200">How did the hip feel on today's run?</p>

      {/* Existing chip behavior preserved verbatim (Fine / Niggle 1–3 / Hurt slider). */}
      <SubjectiveRow
        date={today}
        entry={entry}
        painCap={painCap}
        speedState={speedState}
        onUpdate={onUpdate}
        alwaysOpen
        inSeason={inSeason}
      />

      <div className="flex justify-between gap-2 text-[10.5px] leading-tight">
        <span className="text-teal-400">0–{painCap} ok if settled by morning</span>
        <span className="text-amber-400">{painCap + 1}–{painCap + 2} hold</span>
        <span className="text-rose-400">{painCap + 3}+ downgrade</span>
      </div>

      {/* Morning-after settle prompt — appears only when a prior pain day needs it. */}
      {morningCheckDate && (
        <>
          <div className="h-px bg-[#101a2c]" />
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[12.5px] text-slate-400 flex-1 min-w-[180px]">
              Morning check: did {morningLabel}'s hip settle overnight? <span className="text-slate-600">(logged {morningPainDuring}/10)</span>
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => onMorningAnswer(true)}
                className="h-9 px-4 rounded-full font-display text-[12.5px] font-semibold border border-teal-700 text-teal-300 hover:border-teal-500 transition active:scale-95"
              >Yes</button>
              <button
                onClick={() => onMorningAnswer(false)}
                className="h-9 px-4 rounded-full font-display text-[12.5px] font-semibold border border-amber-700 text-amber-300 hover:border-amber-500 transition active:scale-95"
              >Not yet</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
