import { describe, it, expect } from 'vitest';
import { activeShoeOn, shoeMileage, shoeStatus, shoeReport } from '../shoes';
import type { RunState, Shoe } from '../types';

function run(date: string, miles: number | null): RunState[string] {
  return { date, done: true, miles_actual: miles, updated_at: date + 'T12:00:00Z' };
}
function shoe(p: Partial<Shoe> & { id: string; startDate: string }): Shoe {
  return { name: p.id, retiredAt: null, baseMiles: 0, retireAt: 400, updated_at: '2026-01-01T00:00:00Z', ...p };
}

describe('activeShoeOn', () => {
  const a = shoe({ id: 'a', startDate: '2026-06-01' });
  const b = shoe({ id: 'b', startDate: '2026-06-20' });

  it('picks the most-recently-started shoe at or before the date', () => {
    expect(activeShoeOn([a, b], '2026-06-10')?.id).toBe('a');
    expect(activeShoeOn([a, b], '2026-06-25')?.id).toBe('b'); // b started later
  });
  it('ignores shoes not yet in rotation', () => {
    expect(activeShoeOn([b], '2026-06-01')).toBeNull();
  });
  it('ignores shoes retired before the date', () => {
    const retired = shoe({ id: 'r', startDate: '2026-06-01', retiredAt: '2026-06-15' });
    expect(activeShoeOn([retired], '2026-06-20')).toBeNull();
    expect(activeShoeOn([retired], '2026-06-10')?.id).toBe('r');
  });
});

describe('shoeMileage', () => {
  it('attributes each run to the current shoe and adds baseMiles', () => {
    const shoes = [
      shoe({ id: 'a', startDate: '2026-06-01', baseMiles: 10 }),
      shoe({ id: 'b', startDate: '2026-06-20' }),
    ];
    const state: RunState = {
      '2026-06-05': run('2026-06-05', 4),   // → a
      '2026-06-10': run('2026-06-10', 5),   // → a
      '2026-06-25': run('2026-06-25', 6),   // → b
    };
    const m = shoeMileage(shoes, state);
    expect(m.get('a')).toBe(10 + 4 + 5);
    expect(m.get('b')).toBe(6);
  });

  it('ignores runs with no logged distance and leaves pre-rotation runs unattributed', () => {
    const shoes = [shoe({ id: 'a', startDate: '2026-06-10' })];
    const state: RunState = {
      '2026-06-01': run('2026-06-01', 4),    // before shoe a → unattributed
      '2026-06-12': run('2026-06-12', null), // no miles, no lookup → ignored
      '2026-06-13': run('2026-06-13', 3),    // → a
    };
    expect(shoeMileage(shoes, state).get('a')).toBe(3);
  });

  it('credits a ✓-done day with no typed distance at its PLANNED miles (the week-total rule)', () => {
    const shoes = [shoe({ id: 'a', startDate: '2026-06-10' })];
    const state: RunState = {
      '2026-06-12': run('2026-06-12', null),  // done, distance not typed
      '2026-06-13': run('2026-06-13', 3.2),   // typed actual wins over the plan
    };
    const prescribed = (date: string) =>
      date === '2026-06-12' ? 4 : date === '2026-06-13' ? 4 : null;
    expect(shoeMileage(shoes, state, prescribed).get('a')).toBe(4 + 3.2);
  });

  it('a done day the plan has no prescription for still counts nothing', () => {
    const shoes = [shoe({ id: 'a', startDate: '2026-06-10' })];
    const state: RunState = { '2026-06-12': run('2026-06-12', null) };
    expect(shoeMileage(shoes, state, () => null).get('a')).toBe(0);
  });

  it('an un-done day is never credited, even with a prescription', () => {
    const shoes = [shoe({ id: 'a', startDate: '2026-06-10' })];
    const state: RunState = {
      '2026-06-12': { date: '2026-06-12', done: false, miles_actual: null, updated_at: 'x' },
    };
    expect(shoeMileage(shoes, state, () => 4).get('a')).toBe(0);
  });
});

describe('shoeStatus', () => {
  it('flags watch at 85% and retire at 100% of the threshold', () => {
    expect(shoeStatus(100, 400)).toBe('ok');
    expect(shoeStatus(340, 400)).toBe('watch'); // exactly 85%
    expect(shoeStatus(400, 400)).toBe('retire');
    expect(shoeStatus(500, 400)).toBe('retire');
  });
  it('never divides by zero when no threshold is set', () => {
    expect(shoeStatus(999, 0)).toBe('ok');
  });
});

describe('shoeReport', () => {
  it('reports rounded miles, status, and a progress fraction', () => {
    const shoes = [shoe({ id: 'a', startDate: '2026-06-01', retireAt: 400 })];
    const state: RunState = { '2026-06-05': run('2026-06-05', 4.25) };
    const [r] = shoeReport(shoes, state);
    expect(r.miles).toBe(4.3);            // rounded to 0.1 mi for display
    expect(r.status).toBe('ok');
    expect(r.pct).toBeCloseTo(4.3 / 400, 5); // bar tracks the displayed miles
  });
  it('a retired shoe never shows a retire warning', () => {
    const shoes = [shoe({ id: 'a', startDate: '2026-06-01', retireAt: 100, baseMiles: 500, retiredAt: '2026-06-30' })];
    expect(shoeReport(shoes, {})[0].status).toBe('ok');
  });
});
