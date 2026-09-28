import { useState } from 'react';
import { api, type SeasonRow } from '../data/api.ts';
import { useStore } from '../data/store.tsx';
import { go } from '../app/router.ts';
import { NavBar, Toggle } from '../ui/kit.tsx';

export type DraftSeason = Omit<SeasonRow, 'id'> & { id?: string; on: boolean };

const NAMES: Record<string, string> = { xc: 'Cross country', indoor: 'Indoor track', outdoor: 'Outdoor track', other: 'Other season' };

/** Typical US high school dates for the current school year (editable). */
export function defaultSeason(kind: 'xc' | 'indoor' | 'outdoor'): DraftSeason {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const dates = { xc: [`${y}-08-15`, `${y}-11-14`], indoor: [`${y}-12-01`, `${y + 1}-02-28`], outdoor: [`${y + 1}-03-01`, `${y + 1}-05-31`] }[kind];
  return { kind, label: NAMES[kind], start_date: dates[0], end_date: dates[1], workout_days: [1, 3], on: kind !== 'indoor' };
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function SeasonEditor({ seasons, onChange }: { seasons: DraftSeason[]; onChange: (s: DraftSeason[]) => void }) {
  const set = (i: number, patch: Partial<DraftSeason>) => onChange(seasons.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="stack" style={{ gap: 12 }}>
      {seasons.map((s, i) => (
        <section key={s.id ?? s.kind + i} className="card rows">
          <label className="formrow"><span style={{ fontWeight: 600 }}>{s.label || NAMES[s.kind]}</span><Toggle checked={s.on} onChange={v => set(i, { on: v })} label={`I run ${s.label}`} /></label>
          {s.on && <>
            <label className="formrow"><span>Starts</span><input type="date" value={s.start_date} onChange={e => set(i, { start_date: e.target.value })} /></label>
            <label className="formrow"><span>Ends</span>
              <input type="date" value={s.end_date ?? ''} onChange={e => set(i, { end_date: e.target.value || null })} placeholder="Add date" />
            </label>
            <div className="formrow" style={{ flexWrap: 'wrap', paddingBlock: 10 }}>
              <span>Coach’s hard days</span>
              <div className="hstack" style={{ gap: 4 }}>
                {DAYS.map((d, k) => {
                  const on = s.workout_days.includes(k);
                  return <button key={k} aria-label={`Hard day ${k}`} aria-pressed={on} className={`opt${on ? ' on' : ' soft'}`} style={{ width: 36, height: 44, fontSize: 13, fontWeight: 700 }}
                    onClick={() => set(i, { workout_days: on ? s.workout_days.filter(x => x !== k) : [...s.workout_days, k].sort() })}>{d}</button>;
                })}
              </div>
            </div>
          </>}
        </section>
      ))}
      <p className="small" style={{ padding: '0 16px' }}>Dates are typical ones. Change them to match your school. Don’t know the end yet? Leave it blank.</p>
    </div>
  );
}

export function Seasons() {
  const { loaded, uid, act } = useStore();
  const existing = loaded!.seasons.map(s => ({ ...s, on: true }));
  const kinds = new Set(existing.map(s => s.kind));
  const [seasons, setSeasons] = useState<DraftSeason[]>([...existing, ...(['xc', 'indoor', 'outdoor'] as const).filter(k => !kinds.has(k)).map(k => ({ ...defaultSeason(k), on: false }))]);
  async function save() {
    const ok = await act(async () => {
      for (const s of seasons) {
        if (s.on && s.start_date) await api.saveSeason(uid, { id: s.id, kind: s.kind, label: s.label, start_date: s.start_date, end_date: s.end_date || null, workout_days: s.workout_days });
        else if (!s.on && s.id) await api.deleteSeason(uid, s.id);
      }
    }, 'Seasons saved');
    if (ok) go('plan');
  }
  return (
    <main className="page flow">
      <NavBar title="Seasons" onBack={() => history.back()} right={<button className="btn btn-cap dark" onClick={save}>Save</button>} />
      <p className="body2" style={{ fontSize: 15, lineHeight: '20px' }}>In season your coach leads. Between seasons the app builds you up for the next start date.</p>
      <SeasonEditor seasons={seasons} onChange={setSeasons} />
    </main>
  );
}
