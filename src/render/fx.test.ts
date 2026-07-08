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

  it('orbit sparkles are a score afterglow, not an armed-star status light', () => {
    const fx = new Effects(new THREE.Scene());
    const sim = createSim(1);
    // An armed contract alone spawns nothing — quiet screen while nothing happens.
    sim.contract = { mult: 5, demand: 'mix' };
    fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, []);
    expect(fx.sparks.liveCount()).toBe(0);
    // A landed trick earns the orbit for a couple of seconds.
    fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, [
      {
        type: 'trick',
        spins: 1,
        flips: 0,
        segments: [{ kind: 'spinR', turns: 1 }],
        parallel: false,
        variety: false,
        grabbed: false,
        mult: 5,
        points: 2500,
        repeat: false,
      },
    ]);
    fx.update(sim, { steer: 0, stance: 0 }, 1 / 60, []);
    expect(fx.sparks.liveCount()).toBeGreaterThan(0);
  });
});
