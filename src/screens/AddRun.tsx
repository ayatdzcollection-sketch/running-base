import { useState } from 'react';
import { api, type ActivityRow } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { Icon, Seg, Sheet, Toggle } from '../ui/kit.tsx';

type Kind = 'easy' | 'long' | 'workout' | 'race';
const KINDS: { value: Kind; label: string }[] = [
  { value: 'easy', label: 'Easy' }, { value: 'long', label: 'Long' }, { value: 'workout', label: 'Team workout' }, { value: 'race', label: 'Race' },
];

function parseTime(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.some(x => Number.isNaN(x))) return null;
  if (parts.length === 1) return Math.round(parts[0] * 60);            // minutes
  if (parts.length === 2) return parts[0] * 60 + parts[1];             // mm:ss
  return parts[0] * 3600 + parts[1] * 60 + parts[2];                   // h:mm:ss
}
const fmtTime = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

export function AddRunSheet({ date, edit, onClose }: { date?: string; edit?: ActivityRow; onClose: () => void }) {
  const { uid, today, act, toast } = useStore();
  const [kind, setKind] = useState<Kind>((edit?.kind as Kind) ?? 'easy');
  const [day, setDay] = useState(edit?.date ?? date ?? today);
  const [miles, setMiles] = useState(edit ? String(edit.distance_mi) : '');
  const [time, setTime] = useState(fmtTime(edit?.duration_s ?? null));
  const [hurt, setHurt] = useState(false);

  async function save() {
    const m = Number(miles.replace(',', '.'));
    if (!(m > 0 && m < 60)) return toast('Enter the miles you ran.');
    if (day > today) return toast('That day hasn’t happened yet.');
    const duration_s = parseTime(time);
    const ok = await act(() => edit
      ? api.updateRun(uid, edit.id, { date: day, distance_mi: m, duration_s, kind, distance_estimated: false })
      : api.addRuns(uid, [{ date: day, distance_mi: m, duration_s, kind }]), edit ? 'Run updated' : 'Run added');
    if (ok) { onClose(); if (hurt) go('injury'); }
  }
  async function noRun() {
    const ok = await act(() => api.markDays(uid, [day], 'rest'), 'Marked as a rest day');
    if (ok) onClose();
  }
  async function remove() {
    if (!edit || !confirm('Delete this run?')) return;
    if (await act(() => api.deleteRun(uid, edit.id), 'Run deleted')) onClose();
  }

  return (
    <Sheet onClose={onClose} label={edit ? 'Edit run' : 'Add a run'}>
      <div className="hstack" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-cap" onClick={onClose}>Cancel</button>
        <span style={{ fontWeight: 600 }}>{edit ? 'Edit run' : 'Add a run'}</span>
        <button className="btn btn-cap dark" onClick={save}>Save</button>
      </div>
      <Seg label="Run type" value={kind} options={KINDS} onChange={setKind} />
      <section className="card rows">
        <label className="formrow"><span>Date</span><input type="date" value={day} max={today} onChange={e => setDay(e.target.value)} /></label>
        <label className="formrow"><span>Miles</span><input inputMode="decimal" placeholder="0.0" value={miles} onChange={e => setMiles(e.target.value)} autoFocus={!edit} /></label>
        <label className="formrow"><span>Time</span><input inputMode="numeric" placeholder="Optional, e.g. 42:10" value={time} onChange={e => setTime(e.target.value)} /></label>
      </section>
      {!edit && <section className="card"><label className="formrow"><span>Something hurt</span><Toggle checked={hurt} onChange={setHurt} label="Something hurt" /></label></section>}
      {edit
        ? <button className="btn btn-danger" onClick={remove}>Delete run</button>
        : <button className="btn btn-gray" onClick={noRun}>No run this day (rest)</button>}
      <div className="hstack" style={{ gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 18, background: 'var(--blue-t)' }}>
        <Icon name="spark" color="var(--blue)" />
        <p style={{ fontSize: 15, lineHeight: '20px', color: 'var(--blue-d)' }}>Faster: tell Claude “I ran 6 with the team Tuesday and 5 easy Wednesday.” It adds them for you.</p>
      </div>
    </Sheet>
  );
}
