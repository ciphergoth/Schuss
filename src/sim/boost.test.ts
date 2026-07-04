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
    expect(sim.score).toBe(0); // and the run-in is before the first sector
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
    expect(sim.score).toBe(50 * sim.collected.size); // coins pay pocket change
  });

  it('a bonus star multiplies the next trick POINTS; fuel stays flat', () => {
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
    const star = sim.terrain.bonusesForChunk(index).find((b) => b.mult === 5)!;
    sim.nextSectorZ = -1e9; // teleporting would make the sector clock a lie
    // Fly through the x5 (the x3 hangs behind the start), spin a 360, land.
    const s = sim.skier;
    s.x = star.x;
    s.z = star.z + 2;
    s.y = star.y - 0.6;
    s.heading = sim.terrain.trackHeading(star.z);
    s.speed = 15;
    s.vy = -1;
    s.airTime = 0.4;
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0 && Math.abs(s.spin) < 2 * Math.PI - 0.15) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(events.some((e) => e.type === 'bonus' && e.mult === 5)).toBe(true);
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.mult).toBe(5);
    expect(sim.score).toBe(2500); // 500 for the 360, x5 — the jackpot ledger
    expect(sim.boost).toBeCloseTo(0.15, 5); // fuel is NOT multiplied
    expect(sim.trickMult).toBe(1); // spent by the trick it multiplied
  });

  it('the x5 star hangs further out than the x3, both well off the snow', () => {
    const sim = createSim(1);
    let index = 3;
    while (!sim.terrain.jumpForChunk(index)) index++;
    const jump = sim.terrain.jumpForChunk(index)!;
    const stars = sim.terrain.bonusesForChunk(index);
    const b3 = stars.find((b) => b.mult === 3)!;
    const b5 = stars.find((b) => b.mult === 5)!;
    // Difficulty is distance along the flight: the x5 needs to still be
    // flying where the x3 line has already landed.
    const past = (b: { z: number }) => jump.zLip - b.z;
    expect(past(b5)).toBeGreaterThan(past(b3) + 5);
    // Both far above the snow beneath them: grounded skiers can't graze them.
    expect(b3.y - sim.terrain.height(b3.x, b3.z)).toBeGreaterThan(2.5);
    expect(b5.y - sim.terrain.height(b5.x, b5.z)).toBeGreaterThan(4);
  });

  // Ride the kicker's line from uphill at a given speed, releasing a
  // full-charge jump when z first passes releaseAt (grounded). Returns the
  // bonus multipliers collected during the flight past the lip.
  function rideKicker(speed: number, releaseOffset: number | null): number[] {
    const sim = createSim(1);
    let index = 3;
    while (!sim.terrain.jumpForChunk(index)) index++;
    const jump = sim.terrain.jumpForChunk(index)!;
    const t = sim.terrain;
    const s = sim.skier;
    const z0 = jump.zLip + 54;
    s.x = t.centerX(z0) + jump.xOffset;
    s.z = z0;
    s.heading = t.trackHeading(z0);
    s.speed = speed;
    s.y = t.height(s.x, s.z);
    let fired = false;
    const mults: number[] = [];
    for (let i = 0; i < Math.round(8 / SIM_DT); i++) {
      const doJump =
        !fired && releaseOffset !== null && s.z <= jump.zLip + releaseOffset && s.airTime === 0;
      if (doJump) fired = true;
      for (const e of stepSim(sim, { steer: 0, stance: 0, jump: doJump ? 1 : 0 })) {
        if (e.type === 'bonus') mults.push(e.mult);
      }
      if (s.z < jump.zLip - 30) break;
    }
    return mults;
  }

  it('the x5 rewards a jump timed at the lip, not a hop before the ramp', () => {
    // Full-charge pop 1m before the lip, at speed: the flat fast arc threads
    // both stars.
    expect(rideKicker(26, 1)).toContain(5);
    // The same pop released before the ramp even starts crests early and
    // sinks below the x5 line — the exploit this placement retires.
    expect(rideKicker(26, 16)).not.toContain(5);
    // And no pop at all gets neither: the natural lip launch drops away.
    expect(rideKicker(21, null)).toEqual([]);
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

  it('a half-spin bail lands safe but pays nothing (no round-up to 360)', () => {
    const sim = createSim(1);
    sim.trickMult = 3;
    launch(sim);
    // Rotate to ~190 degrees — under commit, but Math.round would have
    // called it a full turn and paid it before the facing gate.
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 3.3) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 });
    }
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBe(0); // under commit: safe
    expect(events.some((e) => e.type === 'trick')).toBe(false);
    expect(sim.score).toBe(0);
    expect(sim.boost).toBe(0);
    expect(sim.trickMult).toBe(3); // nothing settled; the star keeps waiting
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

  it('harder tricks pay more, in fuel and in points', () => {
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
      return { fuel: sim.boost, points: sim.score };
    };
    const spin = land({ steer: 0, stance: 0, trickSpin: 1 });
    const front = land({ steer: 0, stance: 0, trickFlip: -1 }); // W
    const back = land({ steer: 0, stance: 0, trickFlip: 1 }); // S
    expect(back.fuel).toBeGreaterThan(front.fuel);
    expect(front.fuel).toBeGreaterThan(spin.fuel);
    expect(spin.fuel).toBeGreaterThan(0.1);
    expect(spin.points).toBe(500);
    expect(front.points).toBe(800);
    expect(back.points).toBe(1100);
  });

  it('an armed star survives trickless landings and waits for the trick', () => {
    const sim = createSim(1);
    sim.trickMult = 5;
    launch(sim);
    while (sim.skier.airTime > 0) stepSim(sim, COAST); // land, no trick
    expect(sim.skier.tumbling).toBe(0);
    expect(sim.trickMult).toBe(5); // no attempt, no spend
    // The next flight's 360 collects the full x5.
    launch(sim);
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 2 * Math.PI - 0.15) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 });
    }
    while (sim.skier.airTime > 0) stepSim(sim, COAST);
    expect(sim.score).toBe(2500);
    expect(sim.trickMult).toBe(1);
  });

  it('a blown trick spends the star; a plain crash keeps it', () => {
    const blown = createSim(1);
    blown.trickMult = 3;
    launch(blown);
    while (blown.skier.airTime > 0 && Math.abs(blown.skier.spin) < 4.2) {
      stepSim(blown, { steer: 0, stance: 0, trickSpin: 1 });
    }
    while (blown.skier.airTime > 0) stepSim(blown, COAST);
    expect(blown.skier.tumbling).toBeGreaterThan(0);
    expect(blown.trickMult).toBe(1); // the attempt happened; the star is gone
    // An obstacle hit is not a trick attempt: the star rides out the tumble.
    const crashed = createSim(1);
    let oi = 5;
    while (crashed.terrain.obstaclesForChunk(oi).length === 0) oi++;
    const obstacle = crashed.terrain.obstaclesForChunk(oi)[0]!;
    teleport(crashed, obstacle.x, obstacle.z + 3, 10);
    crashed.trickMult = 3;
    const events = runCollecting(crashed, 0.5);
    expect(events.some((e) => e.type === 'tumble' && !e.trick)).toBe(true);
    expect(crashed.trickMult).toBe(3);
  });

  it('a mixed combo scores the variety bonus', () => {
    const sim = createSim(1);
    launch(sim, 18, 3);
    while (
      sim.skier.airTime > 0 &&
      Math.min(Math.abs(sim.skier.spin), Math.abs(sim.skier.flip)) < 2 * Math.PI - 0.12
    ) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1, trickFlip: 1 }); // 360 + backflip
    }
    while (sim.skier.airTime > 0) stepSim(sim, COAST);
    expect(sim.skier.tumbling).toBe(0);
    expect(sim.score).toBe(2160); // (500 + 1100) x 1.35
  });

  it('sectors grade pace savagely: fast pays big, slow pays nothing', () => {
    const race = (speed: number, input: SkierInput) => {
      const sim = createSim(1);
      teleport(sim, 0, -1, speed);
      for (let i = 0; i < Math.round(60 / SIM_DT); i++) {
        const sector = stepSim(sim, input).find((e) => e.type === 'sector');
        if (sector && sector.type === 'sector') return sector;
      }
      throw new Error('never crossed the sector line');
    };
    // Coasting at race pace: the savage curve makes this worth several tricks.
    const fast = race(29, COAST);
    expect(fast.points).toBeGreaterThan(3000);
    expect(fast.speed).toBeGreaterThan(15);
    // Below the pay floor a sector is worth exactly nothing. Backdating the
    // sector clock pins the average without racing a knife-edge crawl.
    const slow = createSim(1);
    teleport(slow, 0, -8, 15);
    slow.nextSectorZ = -10;
    slow.sectorStartTime = slow.time - 25; // 250m in 25s: 10 m/s average
    const sector = runCollecting(slow, 1).find((e) => e.type === 'sector');
    expect(sector && sector.type === 'sector' && sector.points).toBe(0);
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
