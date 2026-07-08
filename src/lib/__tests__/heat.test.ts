import { describe, it, expect } from 'vitest';
import { heatIndexF, heatGuidance } from '../heat';

describe('heatIndexF', () => {
  it('is near the air temperature in cool, dry conditions', () => {
    expect(heatIndexF(68, 40)).toBeGreaterThan(60);
    expect(heatIndexF(68, 40)).toBeLessThan(75);
  });
  it('exceeds air temperature in hot, humid conditions', () => {
    const hi = heatIndexF(90, 70);
    expect(hi).toBeGreaterThan(95);   // apparent temp well above 90
    expect(hi).toBeLessThan(115);
  });
  it('rises monotonically with humidity when hot', () => {
    expect(heatIndexF(92, 80)).toBeGreaterThan(heatIndexF(92, 40));
  });
  it('rises monotonically with temperature at fixed humidity', () => {
    expect(heatIndexF(95, 50)).toBeGreaterThan(heatIndexF(85, 50));
  });
});

describe('heatGuidance', () => {
  it('mild conditions add no drift and no pace penalty', () => {
    const g = heatGuidance(65, 45);
    expect(g.level).toBe('mild');
    expect(g.hrDriftBpm).toBe(0);
    expect(g.paceAddSecPerMi).toBe(0);
  });
  it('hot conditions escalate the level and the estimates', () => {
    const g = heatGuidance(92, 70);
    expect(['high', 'extreme']).toContain(g.level);
    expect(g.hrDriftBpm).toBeGreaterThan(0);
    expect(g.paceAddSecPerMi).toBeGreaterThan(0);
  });
  it('extreme heat advises rescheduling / moving indoors rather than pushing', () => {
    const g = heatGuidance(105, 75);
    expect(g.level).toBe('extreme');
    expect(g.advice.toLowerCase()).toMatch(/indoor|reschedul|cooler|rest day/);
  });
  it('estimates are bounded (never fabricate an absurd drift)', () => {
    const g = heatGuidance(120, 95);
    expect(g.hrDriftBpm).toBeLessThanOrEqual(18);
    expect(g.paceAddSecPerMi).toBeLessThanOrEqual(75);
  });
});
