import { describe, expect, it } from 'vitest';
import { pointerAxis } from './input';

describe('pointerAxis', () => {
  const W = 1000;

  it('is zero at the center and inside the dead zone', () => {
    expect(pointerAxis(500, W)).toBe(0);
    expect(pointerAxis(512, W)).toBe(0);
    expect(pointerAxis(488, W)).toBe(0);
  });

  it('ramps up toward the edges and saturates before them', () => {
    const mid = pointerAxis(640, W);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(pointerAxis(900, W)).toBe(1);
    expect(pointerAxis(100, W)).toBe(-1);
  });

  it('is antisymmetric around the center', () => {
    expect(pointerAxis(700, W)).toBeCloseTo(-pointerAxis(300, W), 12);
  });

  it('stays within [-1, 1] for any pointer position', () => {
    for (let x = -200; x <= 1200; x += 37) {
      expect(Math.abs(pointerAxis(x, W))).toBeLessThanOrEqual(1);
    }
  });
});
