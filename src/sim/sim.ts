import { Terrain } from './terrain';
import { SKIER_RADIUS, SkierInput, SkierState, createSkier, stepSkier } from './skier';

// Fixed timestep: the simulation only ever advances in SIM_DT increments, so a
// given seed plus a given input sequence always produces the same run.
export const SIM_DT = 1 / 120;

// Things worth celebrating (or commiserating), for the fx and audio layers.
export type SimEvent =
  | { type: 'nearMiss'; x: number; z: number }
  | { type: 'landing'; airTime: number }
  | { type: 'pickup'; x: number; z: number }
  | { type: 'tumble' };

export interface Sim {
  terrain: Terrain;
  skier: SkierState;
  time: number;
  flow: number; // 0..1 — earned by skiing well, spent as a drag-cutting boost
  score: number; // style points
  nearMissCooldown: number;
  collected: Set<string>; // pickup ids gathered this run
}

// Flow tuning: reward loop over penalty loop.
const FLOW_DECAY = 0.05; // per second
const CARVE_TRICKLE = 0.04; // per second of hard carving at speed
const NEAR_MISS_RING = 1.1; // meters beyond a collision that still count
const NEAR_MISS_MIN_SPEED = 12;
const NEAR_MISS_COOLDOWN = 0.6;
const MIN_STYLISH_AIR = 0.25; // seconds; shorter hops don't score
const PICKUP_RADIUS = 1.3;

export function createSim(seed: number): Sim {
  const terrain = new Terrain(seed);
  const skier = createSkier();
  skier.y = terrain.height(skier.x, skier.z);
  return {
    terrain,
    skier,
    time: 0,
    flow: 0,
    score: 0,
    nearMissCooldown: 0,
    collected: new Set(),
  };
}

export function stepSim(sim: Sim, input: SkierInput): SimEvent[] {
  const events: SimEvent[] = [];
  const s = sim.skier;
  const airBefore = s.airTime;
  const wasTumbling = s.tumbling > 0;

  stepSkier(s, sim.terrain, input, SIM_DT, sim.flow);
  sim.time += SIM_DT;
  sim.nearMissCooldown = Math.max(0, sim.nearMissCooldown - SIM_DT);

  if (s.tumbling > 0 && !wasTumbling) {
    sim.flow = 0;
    events.push({ type: 'tumble' });
  }

  if (airBefore > MIN_STYLISH_AIR && s.airTime === 0 && s.tumbling === 0) {
    sim.score += Math.round(airBefore * 50 * (1 + sim.flow));
    sim.flow = Math.min(1, sim.flow + Math.min(0.25, airBefore * 0.15));
    events.push({ type: 'landing', airTime: airBefore });
  }

  const grounded = s.airTime === 0 && s.tumbling === 0;
  if (grounded && s.speed > NEAR_MISS_MIN_SPEED && sim.nearMissCooldown === 0) {
    for (const obstacle of sim.terrain.obstaclesNear(s.z)) {
      const d = Math.hypot(obstacle.x - s.x, obstacle.z - s.z);
      if (d < obstacle.radius + SKIER_RADIUS + NEAR_MISS_RING) {
        sim.flow = Math.min(1, sim.flow + 0.15);
        sim.score += Math.round(25 * (1 + sim.flow));
        sim.nearMissCooldown = NEAR_MISS_COOLDOWN;
        events.push({ type: 'nearMiss', x: obstacle.x, z: obstacle.z });
        break;
      }
    }
  }

  // Pickups: floating discs along the racing line, grabbed on the ground or
  // in flight (jumping through a line is the stylish way).
  if (s.tumbling === 0) {
    for (const pickup of sim.terrain.pickupsNear(s.z)) {
      if (sim.collected.has(pickup.id)) continue;
      const dx = pickup.x - s.x;
      const dz = pickup.z - s.z;
      if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
        sim.collected.add(pickup.id);
        sim.score += 10;
        sim.flow = Math.min(1, sim.flow + 0.04);
        events.push({ type: 'pickup', x: pickup.x, z: pickup.z });
      }
    }
  }

  if (grounded && s.speed > 15 && Math.abs(input.steer) > 0.5) {
    sim.flow = Math.min(1, sim.flow + CARVE_TRICKLE * SIM_DT);
  }
  sim.flow = Math.max(0, sim.flow - FLOW_DECAY * SIM_DT);

  return events;
}

export function distanceSkied(sim: Sim): number {
  return Math.max(0, -sim.skier.z);
}
