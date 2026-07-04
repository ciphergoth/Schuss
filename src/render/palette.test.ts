import { describe, expect, it } from 'vitest';
import { ZONES, ZONE_LENGTH, blendPalette, makePalette, zoneMix } from './palette';

describe('palette zones', () => {
  it('cycles through every zone as the run descends', () => {
    const seen = new Set<string>();
    for (let z = -1; z > -ZONE_LENGTH * ZONES.length; z -= 50) {
      seen.add(zoneMix(z).a.name);
    }
    expect(seen.size).toBe(ZONES.length);
  });

  it('holds steady mid-zone and blends only near the boundary', () => {
    expect(zoneMix(-ZONE_LENGTH / 2).t).toBe(0);
    expect(zoneMix(-ZONE_LENGTH + 5).t).toBeGreaterThan(0.5);
  });

  it('is continuous across a zone boundary', () => {
    const before = makePalette();
    const after = makePalette();
    blendPalette(-ZONE_LENGTH + 0.01, before);
    blendPalette(-ZONE_LENGTH - 0.01, after);
    expect(Math.abs(before.sky.r - after.sky.r)).toBeLessThan(0.02);
    expect(Math.abs(before.sunIntensity - after.sunIntensity)).toBeLessThan(0.05);
    expect(Math.abs(before.fogFar - after.fogFar)).toBeLessThan(3);
  });

  it('the run-in and uphill stay in the first zone', () => {
    expect(zoneMix(0).a.name).toBe(ZONES[0]!.name);
    expect(zoneMix(500).a.name).toBe(ZONES[0]!.name);
    expect(zoneMix(500).t).toBe(0);
  });
});
