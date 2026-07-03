import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Effects } from './fx';
import { createSim } from '../sim/sim';

describe('effects', () => {
  it('bursts particles on a tumble and recycles them as life expires', () => {
    const fx = new Effects(new THREE.Scene());
    const sim = createSim(1);
    expect(fx.particles.liveCount()).toBe(0);
    fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, [{ type: 'tumble' }]);
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
});
