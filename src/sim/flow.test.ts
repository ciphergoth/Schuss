import { describe, expect, it } from 'vitest';
import { SIM_DT, Sim, SimEvent, createSim, stepSim } from './sim';
import { SKIER_RADIUS, stepSkier } from './skier';

const COAST = { steer: 0, stance: 0 };

function runCollecting(sim: Sim, seconds: number, input = COAST): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) events.push(...stepSim(sim, input));
  return events;
}

function teleport(sim: Sim, x: number, z: number, speed: number): void {
  const s = sim.skier;
  s.x = x;
  s.z = z;
  s.speed = speed;
  s.y = sim.terrain.height(x, z);
  const [gx, gz] = sim.terrain.gradient(x, z);
  s.vy = speed * (gx * Math.sin(s.heading) + gz * -Math.cos(s.heading));
}

describe('flow', () => {
  it('near-missing an obstacle at speed builds flow and score', () => {
    const sim = createSim(1);
    const obstacle = sim.terrain.obstaclesForChunk(2)[0]!;
    // Pass 0.8m outside the collision circle — inside the near-miss ring.
    teleport(sim, obstacle.x + obstacle.radius + SKIER_RADIUS + 0.8, obstacle.z + 2, 13);
    const events = runCollecting(sim, 0.5);
    expect(sim.skier.tumbling).toBe(0);
    expect(events.some((e) => e.type === 'nearMiss')).toBe(true);
    expect(sim.flow).toBeGreaterThan(0.1);
    expect(sim.score).toBeGreaterThan(0);
  });

  it('landing real air time scores points', () => {
    const sim = createSim(1);
    teleport(sim, 0, 800, 25); // straight obstacle-free run-in, fast
    stepSim(sim, { steer: 0, stance: 0, jump: 1 }); // full-charge jump
    const events = runCollecting(sim, 4);
    expect(events.some((e) => e.type === 'landing')).toBe(true);
    expect(sim.score).toBeGreaterThan(0);
  });

  it('a tumble zeroes flow', () => {
    const sim = createSim(1);
    const obstacle = sim.terrain.obstaclesForChunk(2)[0]!;
    teleport(sim, obstacle.x, obstacle.z + 3, 10);
    sim.flow = 0.8;
    const events = runCollecting(sim, 0.5);
    expect(events.some((e) => e.type === 'tumble')).toBe(true);
    expect(sim.flow).toBe(0);
  });

  it('flow decays when nothing stylish is happening', () => {
    const sim = createSim(3);
    sim.flow = 0.5;
    runCollecting(sim, 2);
    expect(sim.flow).toBeLessThan(0.45);
    expect(sim.flow).toBeGreaterThan(0.3);
  });

  it('flow boost makes the skier faster', () => {
    const plain = createSim(1);
    const boosted = createSim(1);
    teleport(plain, 0, 800, 25);
    teleport(boosted, 0, 800, 25);
    for (let i = 0; i < Math.round(6 / SIM_DT); i++) {
      stepSkier(plain.skier, plain.terrain, COAST, SIM_DT, 0);
      stepSkier(boosted.skier, boosted.terrain, COAST, SIM_DT, 1);
    }
    expect(boosted.skier.speed).toBeGreaterThan(plain.skier.speed + 1);
  });
});
