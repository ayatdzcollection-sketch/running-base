import type { ISODate } from './types.ts';

// Calendar math on YYYY-MM-DD strings, anchored at noon UTC so no time zone
// or daylight-saving shift can move a date.
const at = (d: ISODate) => new Date(d + 'T12:00:00Z');

export function addDays(d: ISODate, n: number): ISODate {
  const x = at(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday */
export function dow(d: ISODate): number {
  return (at(d).getUTCDay() + 6) % 7;
}

/** Monday of the week containing d */
export function weekStart(d: ISODate): ISODate {
  return addDays(d, -dow(d));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000);
}

export function inRange(d: ISODate, from: ISODate, to: ISODate): boolean {
  return d >= from && d <= to;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function fmtShort(d: ISODate): string {
  const x = at(d);
  return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`;
}
export function dayName(d: ISODate): string {
  return DAYS[dow(d)];
}
export function fmtRange(a: ISODate, b: ISODate): string {
  const x = at(a), y = at(b);
  return x.getUTCMonth() === y.getUTCMonth()
    ? `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()} – ${y.getUTCDate()}`
    : `${fmtShort(a)} – ${fmtShort(b)}`;
}

/** Round to the nearest half mile (plans read better that way). */
export const half = (x: number) => Math.round(x * 2) / 2;
export const round1 = (x: number) => Math.round(x * 10) / 10;
