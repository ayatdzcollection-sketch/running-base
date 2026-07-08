// ============================================================
// TRAINING PLAN CONFIG — edit this file to change the plan.
// All calendar dates derive from PLAN_START_DATE. Changing
// that constant shifts the whole schedule automatically.
// ============================================================

/** Monday that kicks off Week 1 of the real block */
export const PLAN_START_DATE = '2026-06-29';

/** Optional easy day before the block officially begins */
export const BONUS_DAY_DATE = '2026-06-26';

/** Block total prescribed miles across the static fallback (Weeks 1–7, Mon–Fri).
 *  Display/reference only — the live plan total is always recomputed from the
 *  resolved (settings-aware) plan via planTotalMiles(). */
export const BLOCK_TOTAL_MILES = 175;

/** Coach mileage award tracking */
export const AWARD = {
  target: 175.3,
  windowStart: '2026-06-26', // 45-day window opens on bonus day
  windowEnd: '2026-08-09',   // cutoff (Week 7 starts Aug 10, just after)
  safePlanDelivery: 143,     // what the governed plan realistically delivers
};

/** HR governors */
export const HR = {
  easyMin: 140,
  easyMax: 150,
  hardCap: 155,
  hrmax: 198,
};

/** Single-session cap rule: no run > this × trailing-30-day longest */
export const CAP_FACTOR = 1.1;

/** Trailing-30-day longest run as of the plan start (unchanged by seed runs) */
export const TRAILING_LONGEST = 4.5;

// ── Weekly mileage ─────────────────────────────────────────
// Each entry lists prescribed miles for the run days, Mon onward. The LAST
// element is the long run and the week's ceiling — nothing else exceeds it.
// (5 elements = the default Mon–Fri week; a shorter/longer array supports the
// settings `daysPerWeek` knob, long run always last.)
export interface WeekConfig {
  miles: number[];
  note?: string;
  isDownWeek?: boolean;
}

// No-settings FALLBACK scaffold. Mirrors the settings-driven engine's rolling
// philosophy (settings.ts → stepWeek): build toward the peak, take a shallow
// absorption week at ~85% of the prior build (never a collapse), then hold at
// the peak. No 'handoff' / 'taper' vocabulary — the rolling plan never ends,
// so the last visible week is just an ordinary peak-hold week.
export const WEEK_CONFIGS: WeekConfig[] = [
  /* W1 */ { miles: [4.0, 4.0, 4.0, 3.5, 4.5] },                                     // 20.0
  /* W2 */ { miles: [4.5, 4.5, 4.0, 4.0, 5.0] },                                     // 22.0
  /* W3 */ { miles: [5.0, 5.0, 5.0, 4.5, 5.5] },                                     // 25.0
  /* W4 */ { miles: [4.0, 4.0, 4.0, 3.5, 5.5], isDownWeek: true, note: 'down week' }, // 21.0 (~84% of W3)
  /* W5 */ { miles: [5.5, 5.5, 5.0, 5.0, 6.0] },                                     // 27.0
  /* W6 */ { miles: [6.0, 6.0, 5.5, 6.0, 6.5], note: 'peak' },                       // 30.0
  /* W7 */ { miles: [6.0, 6.0, 5.5, 5.5, 7.0] },                                     // 30.0 continued
];

// ── Derived plan (computed from config above) ──────────────
import type { PlanDay, PlanWeek, RawSettings } from '../lib/types';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export interface BuiltPlan {
  bonusDay: PlanDay;
  weeks: PlanWeek[];
  allRunDates: Set<string>;
  allDates: Set<string>;
  dateToWeek: Map<string, PlanWeek>;
  dateToDay: Map<string, PlanDay>;
}

/**
 * Pure plan builder from a list of week configs and a start Monday. The static
 * plan (getPlan) and any settings-derived plan both flow through this, so a
 * generated week is structurally indistinguishable from a hand-authored one.
 * The long run is always the LAST run day of the week; remaining weekday slots
 * are rest days. Works for 3–6 run days per week.
 */
export function buildPlan(weekConfigs: WeekConfig[], planStart: string): BuiltPlan {
  const bonusDay: PlanDay = {
    date: BONUS_DAY_DATE,
    weekNum: 0,
    dayLabel: 'Fri',
    type: 'bonus',
    prescribed: null,
    isLongRun: false,
    isDownWeek: false,
  };

  const weeks: PlanWeek[] = weekConfigs.map((cfg, i) => {
    const weekNum = i + 1;
    const weekStart = addDays(planStart, i * 7);
    const runCount = cfg.miles.length;
    const lastRunIdx = runCount - 1;
    const weekEnd = addDays(weekStart, lastRunIdx); // long-run day

    const runDays: PlanDay[] = cfg.miles.map((miles, j) => ({
      date: addDays(weekStart, j),
      weekNum,
      dayLabel: DAY_LABELS[j] ?? `D${j + 1}`,
      type: 'run' as const,
      prescribed: miles,
      isLongRun: j === lastRunIdx,
      isDownWeek: !!cfg.isDownWeek,
      weekNote: cfg.note,
    }));

    // Rest days fill the remaining weekday slots after the run days.
    const restIdx: number[] = [];
    for (let j = runCount; j <= 6; j++) restIdx.push(j);
    const restDays: PlanDay[] = restIdx.map(j => ({
      date: addDays(weekStart, j),
      weekNum,
      dayLabel: DAY_LABELS[j] ?? `D${j + 1}`,
      type: 'rest' as const,
      prescribed: null,
      isLongRun: false,
      isDownWeek: !!cfg.isDownWeek,
      weekNote: cfg.note,
    }));

    const baseLabel = `Week ${weekNum} · ${fmtDate(weekStart)}–${fmtDate(weekEnd)}`;

    return {
      weekNum,
      startDate: weekStart,
      endDate: weekEnd,
      label: cfg.note ? `${baseLabel} (${cfg.note})` : baseLabel,
      allDays: [...runDays, ...restDays],
      runDays,
      totalPlanned: cfg.miles.reduce((a, b) => a + b, 0),
      longRunCap: cfg.miles[lastRunIdx],
      isDownWeek: !!cfg.isDownWeek,
      note: cfg.note,
    };
  });

  const allRunDates = new Set<string>();
  const allDates = new Set<string>();
  const dateToWeek = new Map<string, PlanWeek>();
  const dateToDay = new Map<string, PlanDay>();

  allDates.add(BONUS_DAY_DATE);
  dateToDay.set(BONUS_DAY_DATE, bonusDay);

  for (const week of weeks) {
    for (const day of week.allDays) {
      allDates.add(day.date);
      dateToDay.set(day.date, day);
      dateToWeek.set(day.date, week);
      if (day.type === 'run') allRunDates.add(day.date);
    }
  }

  return { bonusDay, weeks, allRunDates, allDates, dateToWeek, dateToDay };
}

let _plan: BuiltPlan | null = null;

/** The canonical STATIC plan (WEEK_CONFIGS). Never rewritten. */
export function getPlan(): BuiltPlan {
  if (!_plan) _plan = buildPlan(WEEK_CONFIGS, PLAN_START_DATE);
  return _plan;
}

/**
 * Award target/window resolved from settings when present, else the static
 * AWARD constant. Display-only and safety-subordinate — never an engine input.
 */
export function getAward(settings: RawSettings | null | undefined): typeof AWARD {
  if (!settings) return AWARD;
  return {
    target: settings.goalMiles,
    safePlanDelivery: settings.safeDelivery,
    windowStart: AWARD.windowStart,
    windowEnd: AWARD.windowEnd,
  };
}

/** Today's YYYY-MM-DD in local time */
export function todayStr(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
