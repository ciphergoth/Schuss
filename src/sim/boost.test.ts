import { describe, expect, it } from 'vitest';
import { SIM_DT, Sim, SimEvent, createSim, stepSim } from './sim';
import { SKIER_RADIUS } from './skier';
import { PLAN_SPEED } from './terrain';

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
    expect(sim.boost).toBe(0); // fuel requires coins, gems, or (later) tricks
  });

  it('coins fill the tank', () => {
    const sim = createSim(1);
    // Find a coin cluster and ski straight through it.
    let coin = null;
    for (let index = 1; index < 30 && !coin; index++) {
      coin = sim.terrain.pickupsForChunk(index).find((p) => !p.gem) ?? null;
    }
    expect(coin).not.toBeNull();
    teleport(sim, coin!.x, coin!.z + 2, 12);
    runCollecting(sim, 1);
    expect(sim.boost).toBeGreaterThan(0.05);
  });

  it('skiing the golden path at plan speed threads the gem arc', () => {
    const sim = createSim(1);
    let index = 3;
    while (!sim.terrain.jumpForChunk(index)) index++;
    const { zLip, xOffset } = sim.terrain.jumpForChunk(index)!;
    // On the kicker line at the speed the course is designed around.
    sim.skier.heading = sim.terrain.trackHeading(zLip + 16);
    teleport(sim, sim.terrain.centerX(zLip) + xOffset, zLip + 16, PLAN_SPEED);
    const events = runCollecting(sim, 3);
    const gems = events.filter((e) => e.type === 'pickup' && e.gem).length;
    expect(gems).toBeGreaterThanOrEqual(2); // the arc genuinely threads
    expect(sim.boost).toBeGreaterThan(0.2); // two gems' worth in the tank
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
      events.push(...stepSim(sim, { steer: 1, stance: 0 }));
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
      events.push(...stepSim(sim, { steer: 1, stance: 0 }));
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
    for (let i = 0; i < 10 && sim.skier.airTime > 0; i++) stepSim(sim, { steer: 1, stance: 0 });
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBe(0);
    expect(events.some((e) => e.type === 'trick')).toBe(false);
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
      stepSim(sim, { steer: 1, stance: -1, boost: true });
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
