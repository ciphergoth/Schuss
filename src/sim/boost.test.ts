import { describe, expect, it } from 'vitest';
import { SIM_DT, Sim, SimEvent, createSim, parallelCombine, stepSim } from './sim';
import { SKIER_RADIUS, SkierInput } from './skier';

const COAST = { steer: 0, stance: 0 };

function runCollecting(sim: Sim, seconds: number, input = COAST): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) events.push(...stepSim(sim, input));
  return events;
}

describe('parallelCombine', () => {
  const a = 500; // spin
  const b = 1100; // backflip

  it('a solo axis is just its own value', () => {
    expect(parallelCombine(a, 0)).toBe(a);
    expect(parallelCombine(0, b)).toBe(b);
  });

  it('pays more than either alone but less than the sum', () => {
    const p = parallelCombine(a, b);
    expect(p).toBeGreaterThan(Math.max(a, b));
    expect(p).toBeLessThan(a + b);
    expect(p).toBe(1400); // 1100 + 0.6*500
  });
});

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
    teleport(sim, 0, 800, 25); // straight run-in, fast
    sim.charge = 0.5; // even a deliberate full-human jump...
    stepSim(sim, { steer: 0, stance: 0, jump: 1 });
    const events = runCollecting(sim, 8);
    expect(events.some((e) => e.type === 'landing')).toBe(true);
    expect(sim.boost).toBe(0); // ...earns no fuel: that takes coins or tricks
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

  it('a star grab deals its contract at touchdown; the grab flight pays base', () => {
    const sim = createSim(1);
    // A kicker whose landing zone is obstacle-free: the flight coasts ~25m.
    let index = 3;
    while (
      !sim.terrain.jumpForChunk(index) ||
      !sim.terrain.bonusesForChunk(index).some((b) => b.mult === 5) ||
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
    // The trick done WHILE grabbing pays plain base: the star's value is
    // deferred — its contract is revealed at touchdown, for the NEXT trick.
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.mult).toBe(1);
    expect(sim.score).toBe(500);
    expect(sim.boost).toBeCloseTo(0.15, 5); // fuel is never multiplied
    expect(events.some((e) => e.type === 'contract' && e.mult === 5)).toBe(true);
    expect(sim.contract).toEqual({ mult: 5, demand: star.demand });
    expect(sim.pendingContract).toBeNull();
  });

  it('the x5 star hangs further out than the x3, both well off the snow', () => {
    const sim = createSim(1);
    // A big lip that hangs BOTH stars (the x5 lives on L/XL now).
    let index = 3;
    while (true) {
      const m = sim.terrain.bonusesForChunk(index).map((b) => b.mult);
      if (sim.terrain.jumpForChunk(index) && m.includes(3) && m.includes(5)) break;
      index++;
    }
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
  function rideKicker(
    speed: number,
    releaseOffset: number | null,
    venue?: number,
    charge = 1 // banked jump charge spent at the release (1 = superhuman)
  ): number[] {
    // Venue hunting happens on the endless mountain: a finite course only
    // deals ~80 chunks, and a rare venue class (a threadable hip, say) can
    // simply not roll before the finish line.
    const sim = createSim(1, Infinity);
    let index = venue ?? 3;
    while (!sim.terrain.jumpForChunk(index)) index++;
    const jump = sim.terrain.jumpForChunk(index)!;
    const t = sim.terrain;
    const s = sim.skier;
    const z0 = jump.zLip + 54;
    s.x = t.centerX(z0) + jump.xOffset;
    s.z = z0;
    s.heading = t.trackHeading(z0);
    s.headingRef = t.trackHeading(z0); // a rider already tracking the course
    s.speed = speed;
    s.y = t.height(s.x, s.z);
    // vy must match the slope (leg-band contact treats a zeroed vy as a
    // step-function launch — the same artifact teleport() guards against).
    const [gx, gz] = t.gradient(s.x, s.z);
    s.vy = speed * (gx * Math.sin(s.heading) + gz * -Math.cos(s.heading));
    let fired = false;
    const mults: number[] = [];
    for (let i = 0; i < Math.round(8 / SIM_DT); i++) {
      const doJump =
        !fired && releaseOffset !== null && s.z <= jump.zLip + releaseOffset && s.airTime === 0;
      if (doJump) {
        fired = true;
        sim.charge = charge; // banked as if held for the right stretch
      }
      for (const e of stepSim(sim, { steer: 0, stance: 0, jump: doJump ? 1 : 0 })) {
        if (e.type === 'bonus') mults.push(e.mult);
      }
      if (s.z < jump.zLip - 60) break; // arc stars hang 30-50m downrange
    }
    return mults;
  }

  // Find a venue where the tier's own reference ride actually threads its
  // star. Approach terrain (crud, bends, grade swings) shifts real flights
  // off the hand-integrated reference arc by a few meters on many venues —
  // players make that up with pace and steering (CLAUDE.md documents the
  // soft gating; PHYSICS.md carries the calibration item) — so the gate
  // laws are pinned where the instrument is on-reference. The search
  // SUCCEEDING is itself an assertion: the mountain keeps dealing stars a
  // reference rider can thread.
  function findThreadableVenue(mult: 3 | 5, speed: number, charge: number, hip: boolean): number {
    const t = createSim(1, Infinity).terrain;
    for (let index = 3; index < 600; index++) {
      const jump = t.jumpForChunk(index);
      if (!jump || (jump.hip !== 0) !== hip) continue;
      // Plunge venues gate SOFTLY by design (the breakaway grade floats
      // even an unpopped flight through the human arc — speed is free
      // downhill there), so the gate laws are pinned on hard-gating ground.
      if (t.sectionType(t.sectionIndexAt(jump.zLip)) === 'plunge') continue;
      if (!t.bonusesForChunk(index).some((b) => b.mult === mult)) continue;
      if (rideKicker(speed, 1, index, charge).includes(mult)) return index;
    }
    throw new Error(`no threadable x${mult} venue in 600 chunks`);
  }

  it('the x5 needs superhuman + pace; its venue pays nothing to a dawdler', () => {
    const venue = findThreadableVenue(5, 25, 1, false);
    // A human pop at cruise pace falls beneath the superhuman arc: the x5
    // is never a consolation prize...
    expect(rideKicker(20, 1, venue, 0.5)).not.toContain(5);
    // ...and dawdling off the lip without a pop earns nothing at all.
    expect(rideKicker(17, null, venue, 0)).toEqual([]);
  });

  it('the x3 rides the human arc; no pop, no gold', () => {
    const venue = findThreadableVenue(3, 20, 0.5, false);
    expect(rideKicker(17, null, venue, 0)).toEqual([]);
  });

  it('hip pads sling a fast rider across the track into the x3', () => {
    // Hands-off at race pace: the banked corner does the aiming and the
    // slung line threads the x3 — the search proves such pads exist. (The
    // hip x5 is withheld until the popped-off-the-curve flight is measured;
    // see terrain.ts.)
    const venue = findThreadableVenue(3, 24, 1, true);
    // Too slow: slung sideways, paid nothing.
    expect(rideKicker(17, null, venue, 0)).toEqual([]);
  });

  it('the x5 rewards a jump timed at the lip, not a hop before the ramp', () => {
    const venue = findThreadableVenue(5, 25, 1, false);
    // The same pop released before the ramp even starts crests early and
    // sinks below the x5 arc — the exploit this placement retires.
    expect(rideKicker(25, 16, venue)).not.toContain(5);
    // And no pop at all gets neither: the natural lip launch drops away.
    expect(rideKicker(20, null, venue, 0)).toEqual([]);
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
    sim.contract = { mult: 3, demand: 'spinR' };
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
    // A bail is not an attempt: the contract keeps waiting.
    expect(sim.contract).toEqual({ mult: 3, demand: 'spinR' });
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

  it('a parallel combo pays more than either alone but less than the sum', () => {
    const sim = createSim(1);
    launch(sim, 18, 3); // room for the slow synced rotation
    while (
      sim.skier.airTime > 0 &&
      Math.min(Math.abs(sim.skier.spin), Math.abs(sim.skier.flip)) < 2 * Math.PI - 0.12
    ) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1, trickFlip: 1 }); // spin AND backflip at once
    }
    while (sim.skier.airTime > 0) stepSim(sim, COAST);
    expect(sim.skier.tumbling).toBe(0);
    // Fuel sum would be 0.15 + 0.26 = 0.41; parallel is sub-additive — more
    // than the backflip alone (0.26), less than the sum.
    expect(sim.boost).toBeGreaterThan(0.26);
    expect(sim.boost).toBeLessThan(0.41);
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

  it('an armed contract survives trickless landings; delivering the demand pays it', () => {
    const sim = createSim(1);
    sim.contract = { mult: 5, demand: 'spinR' };
    launch(sim);
    while (sim.skier.airTime > 0) stepSim(sim, COAST); // land, no trick
    expect(sim.skier.tumbling).toBe(0);
    expect(sim.contract).not.toBeNull(); // no attempt, no settle
    // The next flight's right-hand 360 IS the demand: the x5 pays.
    launch(sim);
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 2 * Math.PI - 0.15) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.contract).toBe('paid');
    expect(sim.score).toBe(2500);
    expect(sim.contract).toBeNull();
  });

  it('a trick that misses the demand pays base and the contract dies', () => {
    const sim = createSim(1);
    sim.contract = { mult: 5, demand: 'back' }; // asks for a backflip...
    launch(sim);
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 2 * Math.PI - 0.15) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 })); // ...gets a spin
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.contract).toBe('missed');
    expect(trick && trick.type === 'trick' && trick.mult).toBe(1);
    expect(sim.score).toBe(500); // the trick gets its due; the star pays nothing
    expect(sim.contract).toBeNull(); // the attempt settled it
  });

  it('a magenta composition demand pays the jackpot only for the composition', () => {
    const sim = createSim(1);
    sim.contract = { mult: 5, demand: 'mix' };
    // Spin a 360, then backflip, in one tall flight: serial variety.
    launch(sim, 26, 4);
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 2 * Math.PI - 0.15) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 });
    }
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.flip) < 2 * Math.PI - 0.12) {
      stepSim(sim, { steer: 0, stance: 0, trickFlip: 1 });
    }
    while (sim.skier.airTime > 0) stepSim(sim, COAST);
    // (500 + 1100) x 1.35 variety = 2160, x5 contract = 10800.
    expect(sim.score).toBe(10800);
    expect(sim.contract).toBeNull();
  });

  it('a blown trick settles the contract; a plain crash keeps it', () => {
    const blown = createSim(1);
    blown.contract = { mult: 3, demand: 'spinR' };
    launch(blown);
    while (blown.skier.airTime > 0 && Math.abs(blown.skier.spin) < 4.2) {
      stepSim(blown, { steer: 0, stance: 0, trickSpin: 1 });
    }
    while (blown.skier.airTime > 0) stepSim(blown, COAST);
    expect(blown.skier.tumbling).toBeGreaterThan(0);
    expect(blown.contract).toBeNull(); // the attempt happened; the deal is off
    // An obstacle hit is not a trick attempt: the contract rides out the tumble.
    const crashed = createSim(1);
    let oi = 5;
    while (crashed.terrain.obstaclesForChunk(oi).length === 0) oi++;
    const obstacle = crashed.terrain.obstaclesForChunk(oi)[0]!;
    teleport(crashed, obstacle.x, obstacle.z + 3, 10);
    crashed.contract = { mult: 3, demand: 'spinR' };
    const events = runCollecting(crashed, 0.5);
    expect(events.some((e) => e.type === 'tumble' && !e.trick)).toBe(true);
    expect(crashed.contract).toEqual({ mult: 3, demand: 'spinR' });
  });

  it('a pending contract arms at touchdown even when the landing goes wrong', () => {
    const sim = createSim(1);
    // Carrying an armed contract AND grabbing a new star mid-flight, then
    // blowing the trick: the blown attempt kills the armed one, but the
    // grabbed star's contract still arms — the arc ride was the feat.
    sim.contract = { mult: 3, demand: 'front' };
    sim.pendingContract = { mult: 5, demand: 'mix' };
    launch(sim);
    while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 4.2) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }); // blown: lands sideways
    }
    const events: SimEvent[] = [];
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'contract' && e.mult === 5)).toBe(true);
    expect(sim.contract).toEqual({ mult: 5, demand: 'mix' });
    expect(sim.pendingContract).toBeNull();
  });

  it('repeating your last trick docks the pay; variety restores it', () => {
    const sim = createSim(1);
    const spin360 = (): SimEvent[] => {
      launch(sim);
      const events: SimEvent[] = [];
      while (sim.skier.airTime > 0 && Math.abs(sim.skier.spin) < 2 * Math.PI - 0.15) {
        events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
      }
      while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
      return events;
    };
    const backflip = (): void => {
      launch(sim, 18, 3);
      while (sim.skier.airTime > 0 && Math.abs(sim.skier.flip) < 2 * Math.PI - 0.12) {
        stepSim(sim, { steer: 0, stance: 0, trickFlip: 1 });
      }
      while (sim.skier.airTime > 0) stepSim(sim, COAST);
    };
    spin360();
    expect(sim.score).toBe(500); // fresh trick, full pay
    const events = spin360();
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.repeat).toBe(true);
    expect(sim.score).toBe(850); // the encore pays 70%: +350
    backflip();
    expect(sim.score).toBe(1950); // variety restores full pay: +1100
    spin360();
    expect(sim.score).toBe(2450); // the spin is fresh again after the flip
  });

  it('a parallel combo scores between the bigger trick and the full sum', () => {
    const sim = createSim(1);
    launch(sim, 18, 3);
    const events: SimEvent[] = [];
    while (
      sim.skier.airTime > 0 &&
      Math.min(Math.abs(sim.skier.spin), Math.abs(sim.skier.flip)) < 2 * Math.PI - 0.12
    ) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1, trickFlip: 1 })); // at once
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBe(0);
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.parallel).toBe(true);
    // spin 500 + backflip 1100. Parallel: 1100 + 0.6*500 = 1400 (sum is 1600).
    expect(sim.score).toBe(1400);
  });

  it('a serial spin-then-flip scores the sum plus a complexity bonus', () => {
    const sim = createSim(1);
    launch(sim, 70, 9); // lots of air: a full spin, THEN a full backflip
    const events: SimEvent[] = [];
    const nearTurn = (v: number) => Math.abs(v) >= 2 * Math.PI - 0.12;
    // Phase 1: spin only, to just short of a full turn.
    while (sim.skier.airTime > 0 && !nearTurn(sim.skier.spin)) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    // Phase 2: backflip only, no overlap — this makes it SERIAL, not parallel.
    while (sim.skier.airTime > 0 && !nearTurn(sim.skier.flip)) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickFlip: 1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBe(0);
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.parallel).toBe(false);
    // spin 500 + backflip 1100, serial: (500 + 1100) * 1.35 = 2160 — beats the
    // sum, and beats the same two tricks done in parallel (1400).
    expect(sim.score).toBe(2160);
  });

  // Spin one full turn, reverse, spin a full turn back — landing forward.
  function spin360Both(sim: Sim): SimEvent[] {
    launch(sim, 45, 6); // room for two full spins
    const events: SimEvent[] = [];
    const near = (v: number) => Math.abs(v) >= 2 * Math.PI - 0.12;
    while (sim.skier.airTime > 0 && !near(sim.skier.spinCur)) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    while (sim.skier.airTime > 0 && sim.skier.spinCur > -(2 * Math.PI - 0.12)) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: -1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    return events;
  }

  it('a 360 one way then a 360 the other counts BOTH and earns variety', () => {
    const sim = createSim(1);
    const trick = spin360Both(sim).find((e) => e.type === 'trick');
    expect(sim.skier.tumbling).toBe(0);
    expect(trick && trick.type === 'trick' && trick.spins).toBe(2);
    expect(trick && trick.type === 'trick' && trick.variety).toBe(true);
    // The two directions land as two ordered segments (spun +/right first).
    expect(trick && trick.type === 'trick' && trick.segments).toEqual([
      { kind: 'spinR', turns: 1 },
      { kind: 'spinL', turns: 1 },
    ]);
    // Two spins (1000) x variety 1.35 = 1350 — the signed accumulator used to
    // cancel these to a flat zero.
    expect(sim.score).toBe(1350);
  });

  it('a half-turn each way is a wiggle, not a trick — scores nothing', () => {
    const sim = createSim(1);
    launch(sim, 20, 3);
    const events: SimEvent[] = [];
    const half = (v: number) => Math.abs(v) >= Math.PI - 0.1;
    while (sim.skier.airTime > 0 && !half(sim.skier.spinCur)) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    while (sim.skier.airTime > 0 && sim.skier.spinCur > -(Math.PI - 0.1)) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: -1 }));
    }
    while (sim.skier.airTime > 0) events.push(...stepSim(sim, COAST));
    expect(sim.skier.tumbling).toBe(0);
    expect(events.find((e) => e.type === 'trick')).toBeUndefined();
    expect(sim.score).toBe(0);
  });

  it('repeating the EXACT same sequence docks only the repeat', () => {
    const sim = createSim(1);
    const first = spin360Both(sim).find((e) => e.type === 'trick');
    const afterFirst = sim.score;
    const second = spin360Both(sim).find((e) => e.type === 'trick');
    expect(first && first.type === 'trick' && first.repeat).toBe(false);
    expect(second && second.type === 'trick' && second.repeat).toBe(true);
    // The repeat pays 70% of the first's 1350 = 945.
    expect(sim.score - afterFirst).toBe(945);
  });

  it('crossing the line fires finish once, locks the score, ends the pay', () => {
    const sim = createSim(1);
    const t = sim.terrain;
    teleport(sim, t.centerX(-t.courseLength + 30), -t.courseLength + 30, 25);
    sim.nextSectorZ = -1e9; // isolate the finish from sector pay
    sim.score = 12345;
    const events = runCollecting(sim, 5);
    const fins = events.filter((e) => e.type === 'finish');
    expect(fins.length).toBe(1);
    const atLine = fins[0] && fins[0].type === 'finish' ? fins[0].score : -1;
    expect(atLine).toBeGreaterThanOrEqual(12345); // approach coins may pay
    expect(sim.finishedAt).not.toBeNull();
    expect(sim.score).toBe(atLine); // and past the line, nothing does
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
    slow.sectorStartTime = slow.time - 40; // 400m in 40s: 10 m/s average
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
