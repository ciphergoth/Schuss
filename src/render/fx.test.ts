import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Effects } from './fx';
import { createSim } from '../sim/sim';

describe('effects', () => {
  it('bursts particles on a tumble and recycles them as life expires', () => {
    const fx = new Effects(new THREE.Scene());
    const sim = createSim(1);
    expect(fx.particles.liveCount()).toBe(0);
    fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, [{ type: 'tumble', trick: false }]);
    expect(fx.particles.liveCount()).toBeGreaterThan(50);
    for (let i = 0; i < 200; i++) fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, []);
    expect(fx.particles.liveCount()).toBe(0);
  });

  it('sprays snow while carving at speed, not while coasting straight', () => {
    const fx = new Effects(new THREE.Scene());
    const sim = createSim(1);
    sim.skier.speed = 20;
    fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, []);
    expect(fx.particles.liveCount()).toBe(0);
    fx.update(sim, { steer: 1, stance: 0 }, 1 / 60, []);
    expect(fx.particles.liveCount()).toBeGreaterThan(0);
  });

  it('a jackpot sector queues fireworks that bloom over the next seconds', () => {
    const fx = new Effects(new THREE.Scene());
    const sim = createSim(1);
    fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, [{ type: 'sector', speed: 28, points: 12000 }]);
    expect(fx.pyro.liveCount()).toBe(0); // shells still on their fuses
    let peak = 0;
    for (let i = 0; i < 180; i++) {
      fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, []);
      peak = Math.max(peak, fx.pyro.liveCount());
    }
    expect(peak).toBeGreaterThan(300); // the barrage happened
  });

  it('an armed star trails sparkles until it is spent', () => {
    const fx = new Effects(new THREE.Scene());
    const sim = createSim(1);
    sim.trickMult = 5;
    fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, []);
    expect(fx.sparks.liveCount()).toBeGreaterThan(0);
  });
});
