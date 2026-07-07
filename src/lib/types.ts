export interface RunEntry {
  date: string;          // YYYY-MM-DD
  done: boolean;
  miles_actual: number | null;
  updated_at: string;    // ISO 8601
  // ── v2 additive fields — all optional so pre-existing entries stay valid ──
  rpe?: number | null;          // 1–10 session effort
  painDuring?: number | null;   // 0–10 hip/soreness during the run
  painNextAM?: number | null;   // 0–10 next morning
  didStrides?: boolean | null;  // low-dose stride add-on, logged separately
  strideNote?: string | null;
}

export type RunState = Record<string, RunEntry>;

export interface PlanDay {
  date: string;
  weekNum: number;       // 1–7, 0 for bonus
  dayLabel: string;      // 'Mon' … 'Sun'
  type: 'run' | 'rest' | 'bonus';
  prescribed: number | null;
  isLongRun: boolean;
  isDownWeek: boolean;
  weekNote?: string;
}

export interface PlanWeek {
  weekNum: number;
  startDate: string;
  endDate: string;
  label: string;
  allDays: PlanDay[];   // Mon–Sun (7 days)
  runDays: PlanDay[];   // Mon–Fri only
  totalPlanned: number;
  longRunCap: number;   // Friday miles = the week ceiling
  isDownWeek: boolean;
  note?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

// ── v2: global training state (speed layer) ─────────────────
// Stored under its own localStorage key + its own Supabase table,
// so the original per-day run log is never rewritten.

/** 1 base-only … 7 structured speed, 8 = flare/deload override */
export type SpeedStateNum = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface GlobalState {
  schemaVersion: number;
  speedState: SpeedStateNum;
  hipSafeFlag: boolean;
  ptClearedSpeed: boolean;
  ptClearedIntensity: boolean;
  /** Snapshot only — the live value is always recomputed from the run log. */
  painFreeEasyRunStreak: number;
  painCap: number;                     // default 3; research ceiling is 5
  lastFastSessionDate: string | null;
  lastLongRunDate: string | null;
  delayUntil: string | null;           // upward transitions blocked until past
  /** Cached readiness snapshot (live values recomputed each render). */
  readiness: Record<string, boolean>;
  /** Confirmed generator output, keyed by week start (Mon, YYYY-MM-DD).
   *  Additive — the static plan config is never rewritten. */
  acceptedWeeks: Record<string, ProposedDay[]>;
  updated_at: string;
}

// ── v2: generator output ─────────────────────────────────────

export type ProposedKind = 'easy' | 'long' | 'rest' | 'threshold';

export interface StrideSpec {
  reps: number;
  durationS: number;
  recoveryS: number;
}

export interface ProposedDay {
  date: string;
  dayLabel: string;
  kind: ProposedKind;
  miles: number | null;
  /** Optional low-dose stride add-on attached to an easy day. */
  strides?: StrideSpec;
  why: string;
}

export interface WeekProposal {
  weekStart: string;      // Monday YYYY-MM-DD
  days: ProposedDay[];
  totalMiles: number;
  isDownWeek: boolean;
  warnings: string[];     // flags that need eyes but don't block
  notes: string[];        // plain-English reasoning summary
}
