export interface RunEntry {
  date: string;          // YYYY-MM-DD
  done: boolean;
  miles_actual: number | null;
  updated_at: string;    // ISO 8601
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
