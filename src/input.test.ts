import { describe, expect, it } from 'vitest';
import { steerFromPointerX } from './input';

describe('steerFromPointerX', () => {
  const W = 1000;

  it('is zero at the center and inside the dead zone', () => {
    expect(steerFromPointerX(500, W)).toBe(0);
    expect(steerFromPointerX(512, W)).toBe(0);
    expect(steerFromPointerX(488, W)).toBe(0);
  });

  it('ramps up toward the edges and saturates before them', () => {
    const mid = steerFromPointerX(640, W);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(steerFromPointerX(900, W)).toBe(1);
    expect(steerFromPointerX(100, W)).toBe(-1);
  });

  it('is antisymmetric around the center', () => {
    expect(steerFromPointerX(700, W)).toBeCloseTo(-steerFromPointerX(300, W), 12);
  });

  it('stays within [-1, 1] for any pointer position', () => {
    for (let x = -200; x <= 1200; x += 37) {
      expect(Math.abs(steerFromPointerX(x, W))).toBeLessThanOrEqual(1);
    }
  });
});
