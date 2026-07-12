// ============================================================
// H3 — the Today surface is rolling: no hardcoded end date.
//
// Before this patch a fixed PLAN_END ('2026-08-14') made the Today card show
// "Block complete / 7 weeks done" forever after mid-August — even for a plan
// reseeded via Return-from-break in the autumn. These tests resolve the plan
// for post-August dates and render the real TodayCard (static SSR markup) to
// prove a valid day renders and no completion dead-end remains.
// ============================================================

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TodayCard from '../../components/TodayCard';
import { resolveEffectivePlan } from '../planOverlay';
import { clampWeeksShown, defaultSettings } from '../settings';
import type { PlanDay, RawSettings } from '../types';

const NOW = '2026-06-28T12:00:00Z';

/** Mirror App's window extension: the resolved count always covers today. */
function planCountFor(settings: RawSettings, today: string): number {
  const weeksToToday = Math.floor(
    (Date.parse(today + 'T12:00:00Z') - Date.parse(settings.startDate + 'T12:00:00Z')) / (7 * 86_400_000),
  ) + 1;
  return Math.max(clampWeeksShown(settings.weeksShown), weeksToToday);
}

function render(day: PlanDay | null, today: string): string {
  return renderToStaticMarkup(
    <TodayCard
      today={today} day={day} week={null} entry={undefined} onUpdate={() => {}}
      planStart="2026-06-26" nextLong={10} trailingLongest={9}
      hrBand="140–150" hrHardCap={155} todaySpeed={null}
    />,
  );
}

const DEAD_END = /block complete|plan complete|7 weeks done/i;

describe('(7) Today resolves and renders after 2026-08-14', () => {
  it('a maintenance-phase run day on 2026-08-20 renders as a normal run card', () => {
    const s = defaultSettings(NOW); // startDate 2026-06-29, weeksShown 7, XC 2026-08-17
    const today = '2026-08-20';     // Thursday, after the old PLAN_END
    const { plan } = resolveEffectivePlan(s, {}, today, { count: planCountFor(s, today) });
    const day = plan.dateToDay.get(today) ?? null;
    expect(day).not.toBeNull();
    expect(day!.type).toBe('run');
    const html = render(day, today);
    expect(html).toMatch(/Easy run|Long run/);
    expect(html).toContain('mi');
    expect(html).not.toMatch(DEAD_END);
  });

  it('a weekend after the old end date is still just a rest day', () => {
    const s = defaultSettings(NOW);
    const today = '2026-08-22'; // Saturday
    const { plan } = resolveEffectivePlan(s, {}, today, { count: planCountFor(s, today) });
    const day = plan.dateToDay.get(today) ?? null;
    expect(day?.type).toBe('rest');
    const html = render(day, today);
    expect(html).toContain('Rest day');
    expect(html).toContain('Saturday');
    expect(html).not.toMatch(DEAD_END);
  });
});

describe('(8) a post-break autumn reseed renders normally', () => {
  it('an October restart (startDate 2026-10-05) shows a run day on 2026-10-06', () => {
    const s: RawSettings = {
      ...defaultSettings(NOW),
      startDate: '2026-10-05', startMpw: 12, trailingLongest: 3,
      weeksShown: 8, xcStartDate: '2027-02-01',
    };
    const today = '2026-10-06'; // Tuesday of reseeded week 1
    const { plan } = resolveEffectivePlan(s, {}, today, { count: planCountFor(s, today) });
    const day = plan.dateToDay.get(today) ?? null;
    expect(day).not.toBeNull();
    expect(day!.type).toBe('run');
    const html = render(day, today);
    expect(html).toMatch(/Easy run|Long run/);
    expect(html).not.toMatch(DEAD_END);
  });
});

describe('(9) no fixed completion state overrides a valid plan', () => {
  it('a date beyond the resolvable window gets a neutral no-day card, never a completion', () => {
    const html = render(null, '2027-06-01');
    expect(html).toContain('No planned day');
    expect(html).toContain('Tuesday');
    expect(html).not.toMatch(DEAD_END);
  });
});
