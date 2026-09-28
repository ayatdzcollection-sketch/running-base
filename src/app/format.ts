const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const at = (d: string) => new Date(d + 'T12:00:00Z');

export const longDate = (d: string) => `${DAYS[(at(d).getUTCDay() + 6) % 7]}, ${MONTHS[at(d).getUTCMonth()]} ${at(d).getUTCDate()}`;
export const shortDay = (d: string) => `${DAYS[(at(d).getUTCDay() + 6) % 7].slice(0, 3)}, ${MONTHS[at(d).getUTCMonth()].slice(0, 3)} ${at(d).getUTCDate()}`;
export const monthShort = (d: string) => MONTHS[at(d).getUTCMonth()].slice(0, 3);
export const dayLetter = (d: string) => 'MTWTFSS'[(at(d).getUTCDay() + 6) % 7];
export const mi = (x: number | null | undefined) => (x == null ? '–' : Number.isInteger(x) ? String(x) : x.toFixed(1));
export const about = (x: number | null | undefined) => (x == null ? '–' : String(Math.round(x)));
export function pace(distance: number, seconds: number | null | undefined) {
  if (!seconds || !distance) return null;
  const s = Math.round(seconds / distance);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /mi`;
}
export function duration(seconds: number | null | undefined) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export const isStandalone = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
