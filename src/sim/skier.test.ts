import { describe, expect, it } from 'vitest';
import { SIM_DT, Sim, createSim, distanceSkied, stepSim } from './sim';
import { SkierInput } from './skier';

const COAST: SkierInput = { steer: 0, brake: false };

function run(sim: Sim, seconds: number, input: SkierInput): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) stepSim(sim, input);
}

describe('skier', () => {
  it('accelerates downhill from rest without drifting sideways', () => {
    const sim = createSim(1);
    run(sim, 4, COAST);
    expect(sim.skier.crashed).toBe(false);
    expect(sim.skier.speed).toBeGreaterThan(5);
    expect(distanceSkied(sim)).toBeGreaterThan(15);
    expect(sim.skier.x).toBe(0); // heading never changed, so no lateral motion
  });

  it('is deterministic for a given seed and input sequence', () => {
    const a = createSim(9);
    const b = createSim(9);
    for (let i = 0; i < 1200; i++) {
      const input: SkierInput = { steer: i % 240 < 120 ? 1 : -1, brake: i % 500 < 50 };
      stepSim(a, input);
      stepSim(b, input);
    }
    expect(a.skier).toEqual(b.skier);
    expect(a.time).toBe(b.time);
  });

  it('steering right curves the path toward +x', () => {
    const sim = createSim(1);
    run(sim, 3, COAST);
    run(sim, 1, { steer: 1, brake: false });
    expect(sim.skier.heading).toBeGreaterThan(0.5);
    expect(sim.skier.x).toBeGreaterThan(1);
  });

  it('braking slows the skier down', () => {
    const free = createSim(1);
    const braked = createSim(1);
    run(free, 3, COAST);
    run(braked, 3, COAST);
    run(free, 2, COAST);
    run(braked, 2, { steer: 0, brake: true });
    expect(braked.skier.speed).toBeLessThan(free.skier.speed - 3);
  });

  it('crashes into a tree and stays down', () => {
    const sim = createSim(1);
    const tree = sim.terrain.treesForChunk(2)[0]!;
    sim.skier.x = tree.x;
    sim.skier.z = tree.z + 5; // 5m uphill of the tree, aimed straight at it
    sim.skier.speed = 15;
    run(sim, 1, COAST);
    expect(sim.skier.crashed).toBe(true);
    const { x, z } = sim.skier;
    run(sim, 1, COAST);
    expect(sim.skier.x).toBe(x);
    expect(sim.skier.z).toBe(z);
    expect(sim.skier.speed).toBe(0);
  });
});
