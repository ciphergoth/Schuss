import { describe, expect, it } from 'vitest';
import { GATE_POINTS, SlalomGate, Terrain, hazardX } from './terrain';
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

describe('patrol drones', () => {
  function findDrone(t: Terrain) {
    for (let i = 8; i < 800; i++) {
      const h = t.hazardsForChunk(i)[0];
      if (h) return h;
    }
    throw new Error('no drone on this mountain');
  }

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
