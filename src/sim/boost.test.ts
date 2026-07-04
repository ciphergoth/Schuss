import { describe, expect, it } from 'vitest';
import { SIM_DT, Sim, SimEvent, createSim, stepSim } from './sim';
import { SKIER_RADIUS, SkierInput } from './skier';

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

describe('boost economy', () => {
  it('near-misses celebrate but pay no boost', () => {
    const sim = createSim(1);
    let oi = 5;
    while (sim.terrain.obstaclesForChunk(oi).length === 0) oi++;
    const obstacle = sim.terrain.obstaclesForChunk(oi)[0]!;
    // Pass 0.8m outside the collision circle — inside the near-miss ring.
    teleport(sim, obstacle.x + obstacle.radius + SKIER_RADIUS + 0.8, obstacle.z + 2, 13);
    const events = runCollecting(sim, 0.5);
    expect(sim.skier.tumbling).toBe(0);
    expect(events.some((e) => e.type === 'nearMiss')).toBe(true);
    expect(sim.boost).toBe(0);
  });

  it('merely racing never fills the tank', () => {
    const sim = createSim(1);
    teleport(sim, 0, 800, 25); // straight run-in: rollers, launches, landings
    stepSim(sim, { steer: 0, stance: 0, jump: 1 }); // even a deliberate jump
    const events = runCollecting(sim, 8);
    expect(events.some((e) => e.type === 'landing')).toBe(true);
    expect(sim.boost).toBe(0); // fuel requires coins or tricks
  });

  it('coins fill the tank', () => {
    const sim = createSim(1);
    // Find a coin cluster and ski straight through it.
    let coin = null;
    for (let index = 1; index < 30 && !coin; index++) {
      coin = sim.terrain.pickupsForChunk(index)[0] ?? null;
    }
    expect(coin).not.toBeNull();
    teleport(sim, coin!.x, coin!.z + 2, 12);
    runCollecting(sim, 1);
    expect(sim.boost).toBeGreaterThan(0.05);
  });

  it('a bonus star arms a multiplier that pays out on the next landed trick', () => {
    const sim = createSim(1);
    // A kicker whose landing zone is obstacle-free: the flight coasts ~25m.
    let index = 3;
    while (
      !sim.terrain.jumpForChunk(index) ||
      sim.terrain.obstaclesForChunk(index).length > 0 ||
      sim.terrain.obstaclesForChunk(index + 1).length > 0
    ) {
      index++;
    }
    const star = sim.terrain.bonusesForChunk(index).find((b) => b.mult === 3)!;
    // Fly through the star, then spin a 360 and land it.
    const s = sim.skier;
    s.x = star.x;
    s.z = star.z + 2;
    s.y = star.y - 0.6; // through the x3's window but sinking below the x5's
    s.heading = sim.terrain.trackHeading(star.z);
    s.speed = 15;
    s.vy = 0;
    s.airTime = 0.4;
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0 && Math.abs(s.spin) < 2 * Math.PI - 0.15) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(events.some((e) => e.type === 'bonus' && e.mult === 3)).toBe(true);
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.mult).toBe(3);
    expect(sim.boost).toBeCloseTo(0.45, 5); // 0.15 x3 — a plain 360, tripled
    expect(sim.trickMult).toBe(1); // spent on touchdown
  });

  it('the x5 star hangs higher than the x3', () => {
    const sim = createSim(1);
    let index = 3;
    while (!sim.terrain.jumpForChunk(index)) index++;
    const stars = sim.terrain.bonusesForChunk(index);
    const b3 = stars.find((b) => b.mult === 3)!;
    const b5 = stars.find((b) => b.mult === 5)!;
    expect(b5.y).toBeGreaterThan(b3.y + 1.5);
    // Both far above the snow beneath them: grounded skiers can't graze them.
    expect(b3.y - sim.terrain.height(b3.x, b3.z)).toBeGreaterThan(2.5);
    expect(b5.y - sim.terrain.height(b5.x, b5.z)).toBeGreaterThan(4);
  });

  it('a tumble still fires its event but keeps the tank', () => {
    const sim = createSim(1);
    let oi = 5;
    while (sim.terrain.obstaclesForChunk(oi).length === 0) oi++;
    const obstacle = sim.terrain.obstaclesForChunk(oi)[0]!;
    teleport(sim, obstacle.x, obstacle.z + 3, 10);
    sim.boost = 0.8;
    const events = runCollecting(sim, 0.5);
    expect(events.some((e) => e.type === 'tumble')).toBe(true);
    expect(sim.boost).toBe(0.8); // losing your speed is punishment enough
  });

  it('burning boost accelerates hard and drains the tank slowly', () => {
    const plain = createSim(1);
    const burner = createSim(1);
    teleport(plain, 0, 800, 20);
    teleport(burner, 0, 800, 20);
    burner.boost = 1;
    for (let i = 0; i < Math.round(3 / SIM_DT); i++) {
      stepSim(plain, COAST);
      stepSim(burner, { steer: 0, stance: 0, boost: true });
    }
    expect(burner.skier.speed).toBeGreaterThan(plain.skier.speed + 3);
    // Big tank: 3s of burning leaves roughly half (full tank ~6.7s).
    expect(burner.boost).toBeGreaterThan(0.4);
    expect(burner.boost).toBeLessThan(0.65);
  });

  // Put the skier high in the air off a launch — steering now spins them.
  function launch(sim: Sim, height = 14, vy = 2): void {
    teleport(sim, 0, 800, 15);
    sim.skier.y += height;
    sim.skier.airTime = 0.01;
    sim.skier.vy = vy;
  }

  it('steering through a full 360 in the air lands, pays boost, fires a trick', () => {
    const sim = createSim(1);
    launch(sim);
    const events: SimEvent[] = [];
    // Spin until just short of a full turn (no boost button needed), then
    // stop and ride it down.
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 2 * Math.PI - 0.15) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBe(0);
    expect(events.find((e) => e.type === 'trick')).toBeDefined();
    expect(sim.boost).toBeGreaterThan(0.1);
    expect(sim.skier.spin).toBe(0); // ledger settled on landing
  });

  it('landing mid-spin (past commit) is a wipeout and pays nothing', () => {
    const sim = createSim(1);
    launch(sim);
    const events: SimEvent[] = [];
    // Spin well past the half-turn commit, then land sideways.
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 4.0) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'trick')).toBe(false);
    expect(sim.boost).toBe(0);
  });

  it('a small spin under the commit threshold always lands clean', () => {
    const sim = createSim(1);
    launch(sim);
    // A brief quarter-ish turn, then bail — must land safely, no reward.
    for (let i = 0; i < 10 && sim.skier.airTime > 0; i++)
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 });
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBe(0);
    expect(events.some((e) => e.type === 'trick')).toBe(false);
  });

  it('harder tricks rotate slower: spin faster than frontflip faster than backflip', () => {
    const rotate = (input: SkierInput) => {
      const sim = createSim(1);
      launch(sim);
      for (let i = 0; i < Math.round(1 / SIM_DT); i++) stepSim(sim, input);
      return Math.max(Math.abs(sim.skier.spin), Math.abs(sim.skier.flip));
    };
    const spun = rotate({ steer: 0, stance: 0, trickSpin: 1 });
    const front = rotate({ steer: 0, stance: 0, trickFlip: -1 }); // W
    const back = rotate({ steer: 0, stance: 0, trickFlip: 1 }); // S
    expect(spun).toBeGreaterThan(front);
    expect(front).toBeGreaterThan(back);
  });

  it('combo sync: spinning while flipping locks both rotations together', () => {
    const sim = createSim(1);
    launch(sim);
    for (let i = 0; i < Math.round(1 / SIM_DT); i++) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1, trickFlip: 1 });
    }
    // Same rate on both axes: the combo can land as one clean package.
    expect(Math.abs(sim.skier.spin)).toBeCloseTo(Math.abs(sim.skier.flip), 6);
  });

  it('a mixed combo pays more than the sum of its tricks', () => {
    const sim = createSim(1);
    launch(sim, 18, 3); // room for the slow synced rotation
    while (
      sim.skier.airTime > 0 &&
      Math.min(Math.abs(sim.skier.spin), Math.abs(sim.skier.flip)) < 2 * Math.PI - 0.12
    ) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1, trickFlip: 1 }); // 360 + backflip
    }
    while (sim.skier.airTime > 0) stepSim(sim, COAST);
    expect(sim.skier.tumbling).toBe(0);
    // Un-multiplied sum is 0.15 + 0.26 = 0.41; the variety bonus beats it.
    expect(sim.boost).toBeGreaterThan(0.5);
  });

  it('harder tricks pay more: backflip > frontflip > spin', () => {
    const land = (input: SkierInput) => {
      const sim = createSim(1);
      launch(sim, 18, 3); // extra hangtime for the slow rotations
      while (
        sim.skier.airTime > 0 &&
        Math.max(Math.abs(sim.skier.spin), Math.abs(sim.skier.flip)) < 2 * Math.PI - 0.12
      ) {
        stepSim(sim, input);
      }
      while (sim.skier.airTime > 0) stepSim(sim, COAST);
      expect(sim.skier.tumbling).toBe(0);
      return sim.boost;
    };
    const spin = land({ steer: 0, stance: 0, trickSpin: 1 });
    const front = land({ steer: 0, stance: 0, trickFlip: -1 }); // W
    const back = land({ steer: 0, stance: 0, trickFlip: 1 }); // S
    expect(back).toBeGreaterThan(front);
    expect(front).toBeGreaterThan(spin);
    expect(spin).toBeGreaterThan(0.1);
  });

  it('landing mid-flip is a wipeout', () => {
    const sim = createSim(1);
    launch(sim);
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.flip) < Math.PI) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickFlip: -1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'trick')).toBe(false);
    expect(sim.boost).toBe(0);
  });

  it('a small flip under the commit threshold bails safe', () => {
    const sim = createSim(1);
    launch(sim);
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.flip) < 0.9) {
      stepSim(sim, { steer: 0, stance: 0, trickFlip: -1 });
    }
    while (sim.skier.airTime > 0) stepSim(sim, COAST);
    expect(sim.skier.tumbling).toBe(0);
  });

  it('mouse steering in the air aims, never spins (tricks live on WASD)', () => {
    const sim = createSim(1);
    launch(sim);
    const headingBefore = sim.skier.heading;
    // Aim right for half a second of flight (holding it the whole flight
    // would carry you clear across the course and off the far barrier).
    for (let i = 0; i < Math.round(0.5 / SIM_DT); i++) stepSim(sim, { steer: 1, stance: 0 });
    expect(sim.skier.spin).toBe(0); // no rotation without the button
    expect(sim.skier.heading).toBeGreaterThan(headingBefore + 0.2); // but it steered
    while (sim.skier.airTime > 0) stepSim(sim, COAST);
    expect(sim.skier.tumbling).toBe(0);
  });

  it('the bug: tucking + boosting through real air never flips you out', () => {
    // The reported random wipeout — holding tuck (stance) for speed while
    // airborne used to accumulate a flip and crash on landing.
    const sim = createSim(1);
    launch(sim);
    while (sim.skier.airTime > 0) {
      stepSim(sim, { steer: 0, stance: -1, boost: true }); // full tuck + boost, no steer
    }
    expect(sim.skier.tumbling).toBe(0);
  });

  it('no spin accrues in the first moments of air (incidental hops are safe)', () => {
    const sim = createSim(1);
    launch(sim);
    // Even holding hard steer + tuck, nothing rotates until you've been up
    // long enough to be off a real jump.
    while (sim.skier.airTime > 0 && sim.skier.airTime < 0.34) {
      stepSim(sim, { steer: 1, stance: -1, boost: true, trickSpin: 1, trickFlip: -1 });
      expect(sim.skier.spin).toBe(0);
    }
    expect(sim.skier.airTime).toBeGreaterThan(0.3); // did reach real air
  });

  it('an empty tank gives nothing', () => {
    const plain = createSim(1);
    const pretender = createSim(1);
    teleport(plain, 0, 800, 20);
    teleport(pretender, 0, 800, 20);
    for (let i = 0; i < Math.round(2 / SIM_DT); i++) {
      stepSim(plain, COAST);
      stepSim(pretender, { steer: 0, stance: 0, boost: true });
    }
    expect(pretender.boost).toBe(0);
    expect(pretender.skier.speed).toBeCloseTo(plain.skier.speed, 6);
    expect(pretender.boosting).toBe(false);
  });
});
