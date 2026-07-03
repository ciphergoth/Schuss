import { Terrain } from './terrain';
import { SKIER_RADIUS, SkierInput, SkierState, createSkier, stepSkier } from './skier';

// Fixed timestep: the simulation only ever advances in SIM_DT increments, so a
// given seed plus a given input sequence always produces the same run.
export const SIM_DT = 1 / 120;

// Things worth celebrating (or commiserating), for the fx and audio layers.
export type SimEvent =
  | { type: 'nearMiss'; x: number; z: number }
  | { type: 'landing'; airTime: number }
  | { type: 'pickup'; x: number; z: number; gem: boolean }
  | { type: 'tumble' };

export interface Sim {
  terrain: Terrain;
  skier: SkierState;
  time: number;
  boost: number; // 0..1 tank — rewards fill it, burning it is the speed
  boosting: boolean; // burning right now (render/audio read this)
  nearMissCooldown: number;
  collected: Set<string>; // pickup ids gathered this run
}

// The SSX economy: the run is measured in speed and distance, and every
// reward exists to feed the boost tank.
const BOOST_GEM = 0.25;
const BOOST_COIN = 0.07;
const BOOST_NEAR_MISS = 0.08;
const BOOST_LANDING_PER_AIR = 0.12; // per second of landed hangtime
const BOOST_LANDING_MAX = 0.25;
const BOOST_DRAIN = 0.3; // per second while burning
const NEAR_MISS_RING = 1.1; // meters beyond a collision that still count
const NEAR_MISS_MIN_SPEED = 12;
const NEAR_MISS_COOLDOWN = 0.6;
const MIN_STYLISH_AIR = 0.25; // seconds; shorter hops don't reward
const PICKUP_RADIUS = 1.3;

export function createSim(seed: number): Sim {
  const terrain = new Terrain(seed);
  const skier = createSkier();
  skier.y = terrain.height(skier.x, skier.z);
  return {
    terrain,
    skier,
    time: 0,
    boost: 0,
    boosting: false,
    nearMissCooldown: 0,
    collected: new Set(),
  };
}

function earnBoost(sim: Sim, amount: number): void {
  sim.boost = Math.min(1, sim.boost + amount);
}

export function stepSim(sim: Sim, input: SkierInput): SimEvent[] {
  const events: SimEvent[] = [];
  const s = sim.skier;
  const airBefore = s.airTime;
  const wasTumbling = s.tumbling > 0;

  // Burn boost only where it acts: on the snow, on your feet.
  sim.boosting = (input.boost ?? false) && sim.boost > 0 && s.airTime === 0 && s.tumbling === 0;
  if (sim.boosting) sim.boost = Math.max(0, sim.boost - BOOST_DRAIN * SIM_DT);

  stepSkier(s, sim.terrain, input, SIM_DT, sim.boosting);
  sim.time += SIM_DT;
  sim.nearMissCooldown = Math.max(0, sim.nearMissCooldown - SIM_DT);

  if (s.tumbling > 0 && !wasTumbling) {
    events.push({ type: 'tumble' });
  }

  if (airBefore > MIN_STYLISH_AIR && s.airTime === 0 && s.tumbling === 0) {
    earnBoost(sim, Math.min(BOOST_LANDING_MAX, airBefore * BOOST_LANDING_PER_AIR));
    events.push({ type: 'landing', airTime: airBefore });
  }

  const grounded = s.airTime === 0 && s.tumbling === 0;
  if (grounded && s.speed > NEAR_MISS_MIN_SPEED && sim.nearMissCooldown === 0) {
    for (const obstacle of sim.terrain.obstaclesNear(s.z)) {
      const d = Math.hypot(obstacle.x - s.x, obstacle.z - s.z);
      if (d < obstacle.radius + SKIER_RADIUS + NEAR_MISS_RING) {
        earnBoost(sim, BOOST_NEAR_MISS);
        sim.nearMissCooldown = NEAR_MISS_COOLDOWN;
        events.push({ type: 'nearMiss', x: obstacle.x, z: obstacle.z });
        break;
      }
    }
  }

  // Pickups: coins along the floor, gems floating in kicker flight arcs.
  // Collection is 3D — gems genuinely require being up there.
  if (s.tumbling === 0) {
    for (const pickup of sim.terrain.pickupsNear(s.z)) {
      if (sim.collected.has(pickup.id)) continue;
      const dx = pickup.x - s.x;
      const dz = pickup.z - s.z;
      const dy = pickup.y - (s.y + 1.0); // roughly chest height
      if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && Math.abs(dy) < 1.5) {
        sim.collected.add(pickup.id);
        earnBoost(sim, pickup.gem ? BOOST_GEM : BOOST_COIN);
        events.push({ type: 'pickup', x: pickup.x, z: pickup.z, gem: pickup.gem });
      }
    }
  }

  return events;
}

export function distanceSkied(sim: Sim): number {
  return Math.max(0, -sim.skier.z);
}
