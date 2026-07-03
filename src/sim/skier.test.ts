import { describe, expect, it } from 'vitest';
import { SIM_DT, Sim, createSim, distanceSkied, stepSim } from './sim';
import { SkierInput } from './skier';

const COAST: SkierInput = { steer: 0, stance: 0 };

function run(sim: Sim, seconds: number, input: SkierInput): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) stepSim(sim, input);
}

// Move the skier somewhere on the mountain, keeping state self-consistent:
// y on the terrain and vy following the slope at the given speed — otherwise
// the first step correctly rules them airborne (ground falls away under a
// skier with vy=0) and they hop over whatever the test aimed them at.
function teleport(sim: Sim, x: number, z: number, speed = 0): void {
  const s = sim.skier;
  s.x = x;
  s.z = z;
  s.speed = speed;
  s.y = sim.terrain.height(x, z);
  const [gx, gz] = sim.terrain.gradient(x, z);
  s.vy = speed * (gx * Math.sin(s.heading) + gz * -Math.cos(s.heading));
}

describe('skier', () => {
  it('accelerates downhill from rest without drifting sideways', () => {
    const sim = createSim(1);
    run(sim, 4, COAST);
    expect(sim.skier.tumbling).toBe(0);
    expect(sim.skier.speed).toBeGreaterThan(5);
    expect(distanceSkied(sim)).toBeGreaterThan(15);
    expect(sim.skier.x).toBe(0); // heading never changed, so no lateral motion
  });

  it('is deterministic for a given seed and input sequence', () => {
    const a = createSim(9);
    const b = createSim(9);
    for (let i = 0; i < 1200; i++) {
      const input: SkierInput = { steer: i % 240 < 120 ? 1 : -1, stance: i % 500 < 50 ? 1 : 0 };
      stepSim(a, input);
      stepSim(b, input);
    }
    expect(a.skier).toEqual(b.skier);
    expect(a.time).toBe(b.time);
    expect(a.flow).toBe(b.flow);
    expect(a.score).toBe(b.score);
  });

  it('steering right curves the path toward +x', () => {
    const sim = createSim(1);
    run(sim, 3, COAST);
    run(sim, 1, { steer: 1, stance: 0 });
    expect(sim.skier.heading).toBeGreaterThan(0.5);
    expect(sim.skier.x).toBeGreaterThan(1);
  });

  it('snowplow slows the skier down', () => {
    const free = createSim(1);
    const braked = createSim(1);
    run(free, 3, COAST);
    run(braked, 3, COAST);
    run(free, 2, COAST);
    run(braked, 2, { steer: 0, stance: 1 });
    expect(braked.skier.speed).toBeLessThan(free.skier.speed - 3);
  });

  it('half snowplow brakes less than full snowplow', () => {
    const half = createSim(1);
    const full = createSim(1);
    run(half, 3, COAST);
    run(full, 3, COAST);
    run(half, 2, { steer: 0, stance: 0.5 });
    run(full, 2, { steer: 0, stance: 1 });
    expect(full.skier.speed).toBeLessThan(half.skier.speed);
  });

  it('tuck raises top speed', () => {
    const coasting = createSim(1);
    const tucked = createSim(1);
    // Start well uphill of the start line: the slope there has no interior
    // trees, so a long straight run can't crash.
    teleport(coasting, 0, 800);
    teleport(tucked, 0, 800);
    run(coasting, 20, COAST);
    run(tucked, 20, { steer: 0, stance: -1 });
    expect(coasting.skier.tumbling).toBe(0);
    expect(tucked.skier.tumbling).toBe(0);
    expect(tucked.skier.speed).toBeGreaterThan(coasting.skier.speed + 3);
  });

  it('tuck reduces turn authority', () => {
    const neutral = createSim(1);
    const tucked = createSim(1);
    run(neutral, 3, COAST);
    run(tucked, 3, COAST);
    run(neutral, 1, { steer: 1, stance: 0 });
    run(tucked, 1, { steer: 1, stance: -1 });
    expect(tucked.skier.heading).toBeLessThan(neutral.skier.heading * 0.75);
  });

  it('launches off rollers at speed and lands again', () => {
    const sim = createSim(1);
    // Tree-free slope uphill of the start line, fast in a tuck.
    teleport(sim, 0, 800, 30);
    let sawAir = 0;
    let maxHeightAboveGround = 0;
    for (let i = 0; i < Math.round(15 / SIM_DT); i++) {
      stepSim(sim, { steer: 0, stance: -1 });
      if (sim.skier.airTime > 0) {
        sawAir = Math.max(sawAir, sim.skier.airTime);
        maxHeightAboveGround = Math.max(
          maxHeightAboveGround,
          sim.skier.y - sim.terrain.height(sim.skier.x, sim.skier.z)
        );
      }
    }
    expect(sawAir).toBeGreaterThan(0.1); // real hangtime, not a single-step blip
    expect(maxHeightAboveGround).toBeGreaterThan(0.1);
    expect(maxHeightAboveGround).toBeLessThan(15); // and not launched to the moon
  });

  it('stays glued to the terrain at low speed', () => {
    const sim = createSim(3);
    run(sim, 2, COAST); // still slow after 2s
    const { skier } = sim;
    expect(skier.y).toBeCloseTo(sim.terrain.height(skier.x, skier.z), 6);
  });

  it('tumbles on a tree hit, loses most speed, then recovers', () => {
    const sim = createSim(1);
    const tree = sim.terrain.treesForChunk(2)[0]!;
    // 3m uphill of the tree, aimed straight at it, slow enough to stay
    // grounded (fast skiers can launch off a mogul and clear trees entirely).
    teleport(sim, tree.x, tree.z + 3, 10);
    run(sim, 0.6, COAST);
    expect(sim.skier.tumbling).toBeGreaterThan(0);
    expect(sim.skier.speed).toBeLessThan(5);
    // Pushed clear of the trunk, not stuck inside it.
    expect(Math.hypot(tree.x - sim.skier.x, tree.z - sim.skier.z)).toBeGreaterThan(tree.radius);

    // No steering authority while tumbling.
    const headingDuringTumble = sim.skier.heading;
    run(sim, 0.3, { steer: 1, stance: 0 });
    expect(sim.skier.heading).toBe(headingDuringTumble);

    // Back on skis and accelerating again — the run never ended.
    run(sim, 3, COAST);
    expect(sim.skier.tumbling).toBe(0);
    expect(sim.skier.speed).toBeGreaterThan(1);
  });
});
