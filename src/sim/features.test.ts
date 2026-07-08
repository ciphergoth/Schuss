import { describe, expect, it } from 'vitest';
import {
  GATE_POINTS,
  HazardKind,
  SlalomGate,
  Terrain,
  hazardX,
  jellyPose,
  wyrmSegment,
} from './terrain';
import { SIM_DT, Sim, SimEvent, createSim, stepSim } from './sim';

// Course-feature behavior: slalom gate chains and patrol-drone hits, driven
// through the real stepSim loop on real generated terrain.

const NEUTRAL = { steer: 0, stance: 0 };

// Park the skier on the snow at (x, z), rolling with the course.
function placeSkier(sim: Sim, x: number, z: number, speed: number): void {
  const s = sim.skier;
  s.x = x;
  s.z = z;
  s.y = sim.terrain.height(x, z);
  s.vy = 0;
  s.gap = 0;
  s.airTime = 0;
  s.tumbling = 0;
  s.speed = speed;
  s.heading = sim.terrain.trackHeading(z);
  s.headingRef = s.heading;
}

// Step until the skier crosses zTarget (or the step budget runs out),
// collecting every event on the way.
function stepAcross(sim: Sim, zTarget: number, maxSeconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < maxSeconds && sim.skier.z > zTarget; t += SIM_DT) {
    events.push(...stepSim(sim, NEUTRAL));
  }
  return events;
}

function allGates(t: Terrain, chunks: number): SlalomGate[] {
  const gates: SlalomGate[] = [];
  for (let i = 0; i < chunks; i++) gates.push(...t.gatesForChunk(i));
  return gates.sort((a, b) => b.z - a.z); // uphill (earliest) first
}

describe('slalom gates', () => {
  it('threading escalates the chain; a miss quietly resets it', () => {
    const sim = createSim(1, Infinity);
    sim.nextSectorZ = -1e9; // keep sector pay out of the score arithmetic
    const gates = allGates(sim.terrain, 400);
    expect(gates.length).toBeGreaterThanOrEqual(3);
    const [g1, g2, g3] = gates as [SlalomGate, SlalomGate, SlalomGate];

    // Gate 1, threaded dead center: chain 1, base pay.
    placeSkier(sim, g1.x, g1.z + 3, 20);
    let events = stepAcross(sim, g1.z - 1, 2);
    let gate = events.find((e) => e.type === 'gate');
    expect(gate).toMatchObject({ type: 'gate', chain: 1, points: GATE_POINTS });
    expect(sim.score).toBe(GATE_POINTS);

    // Gate 2, threaded: the chain escalates the pay.
    placeSkier(sim, g2.x, g2.z + 3, 20);
    events = stepAcross(sim, g2.z - 1, 2);
    gate = events.find((e) => e.type === 'gate');
    expect(gate).toMatchObject({ type: 'gate', chain: 2, points: GATE_POINTS * 2 });
    expect(sim.score).toBe(GATE_POINTS * 3);

    // Gate 3, missed wide: the chain breaks — no points lost, none gained,
    // and the miss announces only the broken chain.
    placeSkier(sim, g3.x + g3.halfGap + 2.5, g3.z + 3, 20);
    events = stepAcross(sim, g3.z - 1, 2);
    expect(events.find((e) => e.type === 'gate')).toBeUndefined();
    expect(events.find((e) => e.type === 'gateMiss')).toMatchObject({ chain: 2 });
    expect(sim.gateChain).toBe(0);
    expect(sim.score).toBe(GATE_POINTS * 3);
  });

  it('a gate settles exactly once', () => {
    const sim = createSim(1, Infinity);
    sim.nextSectorZ = -1e9;
    const g = allGates(sim.terrain, 400)[0]!;
    placeSkier(sim, g.x, g.z + 3, 20);
    stepAcross(sim, g.z - 1, 2);
    expect(sim.gateChain).toBe(1);
    // Re-crossing the same line (teleported back uphill) pays nothing new.
    placeSkier(sim, g.x, g.z + 3, 20);
    const events = stepAcross(sim, g.z - 1, 2);
    expect(events.find((e) => e.type === 'gate')).toBeUndefined();
    expect(sim.gateChain).toBe(1);
  });
});

describe('air grabs', () => {
  // Fly a clean 360, with and without the grab held; compare the ledgers.
  function fly360(grab: boolean): Sim {
    const sim = createSim(2, Infinity);
    sim.nextSectorZ = -1e9;
    const s = sim.skier;
    placeSkier(sim, sim.terrain.centerX(-200), -200, 18);
    s.y += 4; // tossed high enough for a full rotation
    s.vy = 3;
    s.airTime = 0.4;
    while (s.airTime > 0 && Math.abs(s.spin) < 2 * Math.PI - 0.15) {
      stepSim(sim, { steer: 0, stance: 0, trickSpin: 1, boost: grab });
    }
    while (s.airTime > 0) stepSim(sim, { steer: 0, stance: 0, boost: grab });
    return sim;
  }

  it('a held grab styles the points x1.2 and never touches the fuel', () => {
    const plain = fly360(false);
    const styled = fly360(true);
    expect(plain.score).toBe(500);
    expect(styled.score).toBe(600);
    // Fuel is mechanics, the tweak is glory: identical tanks.
    expect(styled.boost).toBe(plain.boost);
    // And a grabbed 360 is a different trick from a plain one: doing one
    // after the other is variety, not an AGAIN? repeat.
    expect(styled.lastTrick).not.toBe(plain.lastTrick);
  });
});

describe('showboat galleries', () => {
  it('a trick landed in front of the crowd pays the crowd bonus', () => {
    const sim = createSim(1, Infinity);
    sim.nextSectorZ = -1e9;
    let gallery = null;
    for (let i = 6; i < 500 && !gallery; i++) {
      gallery = sim.terrain.galleriesForChunk(i)[0] ?? null;
    }
    expect(gallery).not.toBeNull();
    // Toss a 360 that lands inside GALLERY_RANGE of the crowd.
    const s = sim.skier;
    placeSkier(sim, sim.terrain.centerX(gallery!.z + 12), gallery!.z + 12, 16);
    s.y += 4;
    s.vy = 3;
    s.airTime = 0.4;
    const events: SimEvent[] = [];
    while (s.airTime > 0 && Math.abs(s.spin) < 2 * Math.PI - 0.15) {
      events.push(...stepSim(sim, { steer: 0, stance: 0, trickSpin: 1 }));
    }
    while (s.airTime > 0) events.push(...stepSim(sim, NEUTRAL));
    const trick = events.find((e) => e.type === 'trick');
    expect(trick && trick.type === 'trick' && trick.crowd?.points).toBe(125); // 25% of 500
    expect(sim.score).toBe(625);
    expect(Math.abs(s.z - gallery!.z)).toBeLessThan(30); // it really was in front of them
  });
});

describe('patrol drones', () => {
  function findCreature(t: Terrain, kind: HazardKind) {
    for (let i = 8; i < 800; i++) {
      const h = t.hazardsForChunk(i)[0];
      if (h && h.kind === kind) return h;
    }
    throw new Error(`no ${kind} on this mountain`);
  }
  const findDrone = (t: Terrain) => findCreature(t, 'drone');

  it('hitting the sweep is an ordinary obstacle hit: brief tumble, most speed kept', () => {
    const sim = createSim(1, Infinity);
    sim.nextSectorZ = -1e9;
    const h = findDrone(sim.terrain);
    // Aim the run so the skier meets the patrol at its center-crossing:
    // the drone passes x0 when the sine's phase is a multiple of pi.
    const tCross = ((2 * Math.PI - h.phase) / (2 * Math.PI)) * h.period + h.period;
    sim.time = tCross - 0.1;
    expect(Math.abs(hazardX(h, tCross) - h.x0)).toBeLessThan(0.01);
    placeSkier(sim, h.x0, h.z + 2, 20);
    const events: SimEvent[] = [];
    for (let t = 0; t < 0.5; t += SIM_DT) events.push(...stepSim(sim, NEUTRAL));
    const tumble = events.find((e) => e.type === 'tumble');
    expect(tumble).toMatchObject({ type: 'tumble', trick: false });
    expect(sim.skier.speed).toBeLessThan(20 * 0.65); // TUMBLE_SPEED_KEEP + skid
  });

  it('a low jelly blocks; a contracted one lets you pass beneath', () => {
    // Blocked: meet the jelly at its pulse minimum (tentacles at their
    // lowest — clearance well under head height).
    const blockedSim = createSim(1, Infinity);
    blockedSim.nextSectorZ = -1e9;
    const jelly = findCreature(blockedSim.terrain, 'jelly');
    const pp = 2.1 + jelly.aux * 0.9;
    // pulse = 0.5 + 0.5 sin(2pi t / pp + phase*5): minimum at sin = -1.
    const wrap = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const tLow = (pp * wrap(1.5 * Math.PI - jelly.phase * 5)) / (Math.PI * 2) + 4 * pp;
    expect(jellyPose(jelly, tLow).clearance).toBeLessThan(1.3);
    blockedSim.time = tLow - 0.1;
    const at = jellyPose(jelly, tLow);
    placeSkier(blockedSim, at.x, at.z + 2, 20);
    let events: SimEvent[] = [];
    for (let t = 0; t < 0.4; t += SIM_DT) events.push(...stepSim(blockedSim, NEUTRAL));
    expect(events.find((e) => e.type === 'tumble')).toBeDefined();

    // Open: same crossing, timed for the pulse maximum — the tentacles are
    // above head height and the pass under is clean (and celebrated).
    const openSim = createSim(1, Infinity);
    openSim.nextSectorZ = -1e9;
    const tHigh = (pp * wrap(0.5 * Math.PI - jelly.phase * 5)) / (Math.PI * 2) + 4 * pp;
    expect(jellyPose(jelly, tHigh).clearance).toBeGreaterThan(2.3);
    openSim.time = tHigh - 0.1;
    const at2 = jellyPose(jelly, tHigh);
    placeSkier(openSim, at2.x, at2.z + 2, 20);
    events = [];
    for (let t = 0; t < 0.4; t += SIM_DT) events.push(...stepSim(openSim, NEUTRAL));
    expect(events.find((e) => e.type === 'tumble')).toBeUndefined();
    expect(events.find((e) => e.type === 'nearMiss')).toBeDefined(); // the shave pays
  });

  it('an emerged wyrm hump hits; the powder swallows the rest', () => {
    const sim = createSim(1, Infinity);
    sim.nextSectorZ = -1e9;
    const wyrm = findCreature(sim.terrain, 'wyrm');
    // Find a moment when the head segment is well emerged.
    let tUp = 0;
    for (let t = 5; t < 20; t += 0.05) {
      if (wyrmSegment(wyrm, 0, t).lift > 0.8) {
        tUp = t;
        break;
      }
    }
    expect(tUp).toBeGreaterThan(0);
    sim.time = tUp;
    const seg = wyrmSegment(wyrm, 0, tUp);
    placeSkier(sim, seg.x, seg.z, 0); // parked right on the surfacing arc
    const events: SimEvent[] = [];
    for (let t = 0; t < 0.2; t += SIM_DT) events.push(...stepSim(sim, NEUTRAL));
    expect(events.find((e) => e.type === 'tumble')).toBeDefined();
  });

  it('the same run misses the drone when the schedule is elsewhere', () => {
    const sim = createSim(1, Infinity);
    sim.nextSectorZ = -1e9;
    const h = findDrone(sim.terrain);
    // Same approach line, but timed for the sweep's far extreme.
    const tFar = ((Math.PI / 2 - h.phase) / (2 * Math.PI)) * h.period + 2 * h.period;
    expect(Math.abs(hazardX(h, tFar) - h.x0)).toBeGreaterThan(h.amp * 0.99);
    sim.time = tFar - 0.1;
    placeSkier(sim, h.x0, h.z + 2, 20);
    const events: SimEvent[] = [];
    for (let t = 0; t < 0.3; t += SIM_DT) events.push(...stepSim(sim, NEUTRAL));
    expect(events.find((e) => e.type === 'tumble')).toBeUndefined();
    expect(sim.skier.tumbling).toBe(0);
  });
});
