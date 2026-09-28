// Engine types. The engine is pure: data in, a snapshot out. The web app,
// the Claude connector and the tests all call the same functions, so what
// Claude reports is exactly what the runner sees.

export type ISODate = string; // YYYY-MM-DD, the runner's local calendar day

export interface Profile {
  displayName: string;
  birthYear?: number | null;
  experienceYears?: number | null;
  daysPerWeek: number;        // 3–7 run days a week
  longRunDay: number;         // 0 = Mon … 6 = Sun
  startMpw: number;           // weekly miles when they joined
  startLongest: number;       // longest run in the month before joining
  goalMpw?: number | null;    // optional ceiling the runner chose
  hrEasyMax?: number | null;
  planStart: ISODate;
}

export type SeasonKind = 'xc' | 'indoor' | 'outdoor' | 'other';
export interface Season {
  id: string;
  kind: SeasonKind;
  label: string;
  startDate: ISODate;
  endDate?: ISODate | null;   // null = end not set yet
  workoutDays: number[];      // coach's hard days, 0 = Mon
}

export interface Meet {
  id: string;
  date: ISODate;
  name: string;
  distanceMi?: number | null;
}

export type ActivityKind = 'easy' | 'long' | 'workout' | 'race' | 'cross' | 'other';
export interface Activity {
  id: string;
  date: ISODate;
  distanceMi: number;
  durationS?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  kind: ActivityKind;
  source: 'watch' | 'manual' | 'claude' | 'import';
  distanceEstimated?: boolean; // checked off; distance taken from the plan
  rpe?: number | null;
  notes?: string | null;
}

export type DayStatus = 'rest' | 'skipped' | 'sick' | 'injured' | 'travel';
export interface DayMark {
  date: ISODate;
  status: DayStatus;
}

export interface CheckIn {
  date: ISODate;
  moment: 'post_run' | 'morning';
  pain?: number | null;       // 0–10
  painArea?: string | null;
  rpe?: number | null;
}

export type InjuryArea = 'foot' | 'ankle' | 'shin' | 'knee' | 'thigh' | 'hip' | 'back' | 'other';
export type Outcome = 'run' | 'easy' | 'cross' | 'stop';
export interface Injury {
  id: string;
  area: InjuryArea;
  startedOn: ISODate;
  outcome: Outcome;
  likely?: string | null;
  status: 'active' | 'resolved';
  stage: number;              // comeback stage, 0 = not started
  stageSince?: ISODate | null;
  clearedByClinician?: boolean;
}

export interface Shoe {
  id: string;
  name: string;
  startDate: ISODate;
  baseMiles: number;
  retireAt: number;
  retiredAt?: ISODate | null;
}

/** A day of the plan changed on purpose. Future days only; past days are facts. */
export type OverrideKind = 'easy' | 'long' | 'rest' | 'cross' | 'workout';
export interface PlanOverride {
  date: ISODate;
  kind: OverrideKind;
  miles?: number | null;
  note?: string | null;
  source: 'app' | 'claude';
}

export interface Note {
  id: string;
  date: ISODate;
  body: string;
  source: 'app' | 'claude' | 'import';
}

export interface RunnerData {
  profile: Profile;
  seasons: Season[];
  meets: Meet[];
  activities: Activity[];
  days: DayMark[];
  checkins: CheckIn[];
  injuries: Injury[];
  shoes: Shoe[];
  speedLevel: number;
  speedLevelSince?: ISODate | null;
  overrides?: PlanOverride[];
  notes?: Note[];
  /** True when a watch has sent a run in the last 14 days. Days with no
   *  run then count as rest (the watch would have sent it), not unknown. */
  watchConnected?: boolean;
}
