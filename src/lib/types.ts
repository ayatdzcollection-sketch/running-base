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
  /** Date (YYYY-MM-DD) pain tracking began for this athlete. Runs BEFORE this
   *  never count as "proven pain-free" toward speed progression — they predate
   *  the pain feature, so we can't assume they were pain-free. Set once, on the
   *  first load after the pain layer existed. */
  painTrackingSince: string | null;
  painCap: number;                     // default 3; research ceiling is 5
  lastFastSessionDate: string | null;
  lastLongRunDate: string | null;
  delayUntil: string | null;           // upward transitions blocked until past
  /** Cached readiness snapshot (live values recomputed each render). */
  readiness: Record<string, boolean>;
  /** Confirmed generator output, keyed by week start (Mon, YYYY-MM-DD).
   *  Additive — the static plan config is never rewritten. */
  acceptedWeeks: Record<string, ProposedDay[]>;
  // ── v3 additive (all optional; null/absent = original behavior) ──
  /** User plan settings (Stage B). null = pure static plan. */
  settings?: RawSettings | null;
  /** Logged race results (Stage F). Display-only — never an engine input. */
  races?: RaceResult[];
  // ── v4 additive home widgets (all optional; absent = feature unused) ──
  // None of these is ever read by the speed ladder, pain gate, HR caps, or the
  // long-run cap. They are human-facing journals and advisory displays only.
  /** Free-text daily notes, keyed by date (YYYY-MM-DD). Never parsed. */
  notes?: Record<string, string>;
  /** Weekly subjective check-ins, keyed by weekStart (Mon YYYY-MM-DD).
   *  Display-only — a poor week may SUGGEST easing, but never auto-advances a
   *  speed state or relaxes any gate. */
  checkins?: Record<string, WeeklyCheckin>;
  /** Shoe rotation. Mileage is advisory only; never feeds the cap/gate math. */
  shoes?: Shoe[];
  /** Local PT/coach notes-to-self. NOT messaging — nothing is sent anywhere,
   *  and PT clearances are never settable from here (they stay a manual toggle
   *  in the Speed plan). */
  ptNotes?: PtNote[];
  updated_at: string;
}

// ── v4: weekly check-in (subjective load monitoring, display-only) ──
export interface WeeklyCheckin {
  weekStart: string;     // Monday YYYY-MM-DD
  sleep: number;         // 1–5 (5 = slept great)
  soreness: number;      // 1–5 (5 = very sore) — higher is worse
  energy: number;        // 1–5 (5 = full of energy)
  stress: number;        // 1–5 (5 = high life stress) — higher is worse
  note?: string;
  updated_at: string;
}

// ── v4: shoe rotation (advisory mileage tracking) ──
export interface Shoe {
  id: string;
  name: string;
  startDate: string;         // miles counted from this date (YYYY-MM-DD)
  retiredAt?: string | null; // null/absent = still in rotation
  baseMiles: number;         // miles already on the shoe before tracking began
  retireAt: number;          // advisory retirement threshold (miles)
  updated_at: string;
}

// ── v4: local PT / coach note (a private log, NOT a message thread) ──
export interface PtNote {
  id: string;
  date: string;              // YYYY-MM-DD
  body: string;
  updated_at: string;
}

// ── v3: plan settings (raw, as typed by the user) ────────────
// Every consumer reads the CLAMPED effective view (see lib/settings.ts);
// raw is persisted verbatim so the user never loses their input.
export interface RawSettings {
  version: 1;
  // award (display-only, safety-subordinate)
  goalMiles: number;
  safeDelivery: number;
  // plan shape
  daysPerWeek: number;   // run days/week (3–6)
  blockWeeks: number;    // 4–12
  downEvery: number;     // down week after N build weeks (3–4)
  startDate: string;     // Monday YYYY-MM-DD
  startMpw: number;      // first week's miles
  peakMpw: number;       // ceiling the build aims at
  buildStep: number;     // absolute mpw added per build week
  trailingLongest: number; // "starting longest run" seed for the long-run ladder
  // governors (steppers allow a wide range; effectiveSettings clamps to safe)
  hrEasyMin: number;
  hrEasyMax: number;
  hrHardCap: number;
  hrMax: number;
  capPct: number;        // long-run cap as % of trailing-30 longest
  pfNeeded: number;      // pain-free streak to unlock the next speed step
  adaptive: boolean;     // race-adaptive preference (inert this block; see FLAGS)
  // home layout
  layoutOrder: string[]; // block ids in display order
  layoutOff: string[];   // hidden block ids
  updated_at: string;
}

// ── v3: race results (display-only projections) ──────────────
export interface RaceResult {
  id: string;
  date: string;          // YYYY-MM-DD or short label
  distanceMi: number;
  timeSec: number;
  label?: string;
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
