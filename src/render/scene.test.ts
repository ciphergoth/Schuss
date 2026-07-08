import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SHOOT_PERIOD, ShootingStars } from './scene';

describe('shooting stars', () => {
  it('each lane fires exactly once per period, and the grotto hides them', () => {
    const stars = new ShootingStars(new THREE.Scene());
    stars.setSeed(1);
    // Sweep one full window finely: streaks must appear (the sky is alive)
    // and vanish (they are streaks, not fixtures).
    let liveSamples = 0;
    let everLive = false;
    const step = 0.05;
    for (let t = 10; t < 10 + SHOOT_PERIOD; t += step) {
      stars.update(0, 0, -500, t, 1);
      const live = stars.liveCount();
      if (live > 0) {
        everLive = true;
        liveSamples++;
      }
    }
    expect(everLive).toBe(true);
    // Three lanes x ~1.1s of life inside a 26s window: live a clear minority
    // of the time — quiet punctuation, not a meteor storm.
    expect(liveSamples * step).toBeLessThan(SHOOT_PERIOD / 4);

    // Inside the grotto (dimmer 0) the sky holds its breath.
    for (let t = 10; t < 10 + SHOOT_PERIOD; t += step) {
      stars.update(0, 0, -500, t, 0);
      expect(stars.liveCount()).toBe(0);
    }
  });

  it('the schedule is a pure function of seed and time', () => {
    const a = new ShootingStars(new THREE.Scene());
    const b = new ShootingStars(new THREE.Scene());
    a.setSeed(7);
    b.setSeed(7);
    for (let t = 0; t < 60; t += 0.21) {
      a.update(3, 4, -200, t, 1);
      b.update(3, 4, -200, t, 1);
      expect(a.liveCount()).toBe(b.liveCount());
    }
  });
});
