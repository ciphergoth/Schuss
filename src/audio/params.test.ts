import { describe, expect, it } from 'vitest';
import { mix } from './params';

describe('audio mix params', () => {
  it('is silent at rest', () => {
    const p = mix(0, 0, 0);
    expect(p.windGain).toBe(0);
    expect(p.carveGain).toBe(0);
  });

  it('wind rises with speed and the filter opens', () => {
    const slow = mix(5, 0, 0);
    const fast = mix(30, 0, 0);
    expect(fast.windGain).toBeGreaterThan(slow.windGain);
    expect(fast.windFreq).toBeGreaterThan(slow.windFreq);
  });

  it('tuck adds wind roar', () => {
    expect(mix(30, 0, -1).windGain).toBeGreaterThan(mix(30, 0, 0).windGain);
  });

  it('carving and snowplow are audible, coasting straight is not', () => {
    expect(mix(20, 0, 0).carveGain).toBe(0);
    expect(mix(20, 1, 0).carveGain).toBeGreaterThan(0.1);
    expect(mix(20, 0, 1).carveGain).toBeGreaterThan(mix(20, 1, 0).carveGain);
  });

  it('stays within sane bounds at extremes', () => {
    for (const speed of [0, 20, 40, 100]) {
      for (const steer of [-1, 0, 1]) {
        for (const stance of [-1, 0, 1]) {
          const p = mix(speed, steer, stance);
          expect(p.windGain).toBeGreaterThanOrEqual(0);
          expect(p.windGain).toBeLessThanOrEqual(0.6);
          expect(p.carveGain).toBeLessThanOrEqual(0.4);
          expect(p.windFreq).toBeGreaterThanOrEqual(150);
          expect(p.windFreq).toBeLessThanOrEqual(1950);
        }
      }
    }
  });
});
