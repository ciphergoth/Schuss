import { Terrain } from './terrain';
import {
  FLIP_COMMIT,
  FLIP_TOLERANCE,
  SKIER_RADIUS,
  SPIN_TOLERANCE,
  TRICK_COMMIT,
  SkierInput,
  SkierState,
  createSkier,
  residual,
  stepSkier,
} from './skier';

// Fixed timestep: the simulation only ever advances in SIM_DT increments, so a
// given seed plus a given input sequence always produces the same run.
export const SIM_DT = 1 / 120;

// Things worth celebrating (or commiserating), for the fx and audio layers.
export type SimEvent =
  | { type: 'nearMiss'; x: number; z: number }
  | { type: 'landing'; airTime: number }
  | { type: 'pickup'; x: number; z: number }
  | { type: 'bonus'; x: number; z: number; mult: number } // trick-bonus star grabbed
  | { type: 'trick'; spins: number; flips: number; flipBack: boolean; mult: number; points: number }
  | { type: 'sector'; speed: number; points: number } // 250m pace grade
  | { type: 'tumble'; trick: boolean }; // trick: blown rotation vs plain crash

export interface Sim {
  terrain: Terrain;
  skier: SkierState;
  time: number;
  boost: number; // 0..1 tank — rewards fill it, burning it is the speed
  boosting: boolean; // burning right now (render/audio read this)
  trickMult: number; // armed by a bonus star; multiplies the next trick's POINTS
  score: number; // the ledger of glory: trick points + sector pace, uncapped
  nextSectorZ: number; // where the next 250m pace grade lands
  sectorStartTime: number;
  nearMissCooldown: number;
  collected: Set<string>; // pickup + bonus ids gathered this run
}

// The economy has two ledgers doing different jobs. The BOOST TANK is the
// mechanical loop: coins and tricks fill it (flat, capped), burning it is
// speed. The SCORE is the uncapped ledger of glory: tricks pay big points
// (multiplied by bonus stars — that's where the x5 jackpot lives), and every
// 250m sector grades your pace SAVAGELY, so fuel burned into a fast sector
// converts to points. Tricks -> fuel -> speed -> points: one economy.
const BOOST_COIN = 0.035;
const POINTS_COIN = 50;
const POINTS_PER_SPIN = 500;
const POINTS_PER_FRONTFLIP = 800;
const POINTS_PER_BACKFLIP = 1100;
export const SECTOR_LENGTH = 250;
const SECTOR_MIN_SPEED = 12; // average m/s before a sector pays anything
// Savage: points = 25 * (avg - 12)^2.2 — a 20 m/s sector ~2400, a
// full-boost 30 m/s sector ~20000, worth several big tricks.
const SECTOR_COEFF = 25;
const SECTOR_EXP = 2.2;
// Trick pay follows difficulty (slower rotation = more air needed = more
// money): spin < frontflip < backflip. Mixing TYPES in one flight is the
// hardest thing of all — variety multiplies, repetition merely adds.
const BOOST_PER_SPIN = 0.15;
const BOOST_PER_FRONTFLIP = 0.2;
const BOOST_PER_BACKFLIP = 0.26;
const COMBO_MULT = 1.35; // spin AND flip landed in the same flight
const BOOST_TRICK_CAP = 0.65; // per landing
const BOOST_DRAIN = 0.15; // per second while burning
const NEAR_MISS_RING = 1.1; // meters beyond a collision that still count
const NEAR_MISS_MIN_SPEED = 12;
const NEAR_MISS_COOLDOWN = 0.6;
const MIN_STYLISH_AIR = 0.25; // seconds; shorter hops don't reward
const PICKUP_RADIUS = 1.3;
const BONUS_RADIUS = 1.7; // stars are generous — reaching them was the feat

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
    trickMult: 1,
    score: 0,
    nextSectorZ: -SECTOR_LENGTH,
    sectorStartTime: 0,
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
    // Rotation still on the clock at the moment of tumbling = a blown trick.
    const trick = Math.abs(s.spin) > TRICK_COMMIT || Math.abs(s.flip) > FLIP_COMMIT;
    if (trick) sim.trickMult = 1; // a blown attempt still spends the star
    events.push({ type: 'tumble', trick });
  }

  // Any return to the snow settles the flight's rotation ledger. A rotation
  // only counts if it arrived within tolerance of the correct facing (45
  // degrees) — the same bar the landing judge tumbles by past commit. Under
  // commit a wide residual is a safe bail, not a payday: without this gate
  // a 185-degree spin rounded up to a paid 360.
  if (airBefore > 0 && s.airTime === 0) {
    const spinClean = Math.abs(residual(s.spin)) <= SPIN_TOLERANCE;
    const flipClean = Math.abs(residual(s.flip)) <= FLIP_TOLERANCE;
    const turns = spinClean ? Math.round(Math.abs(s.spin) / (2 * Math.PI)) : 0;
    const flipTurns = flipClean ? Math.round(Math.abs(s.flip) / (2 * Math.PI)) : 0;
    const flipBack = s.flip > 0; // positive pitch lifts the tips: backflip (S)
    if (s.tumbling === 0) {
      if (airBefore > MIN_STYLISH_AIR) events.push({ type: 'landing', airTime: airBefore });
      if (turns >= 1 || flipTurns >= 1) {
        // Fuel is flat and capped — the mechanical loop.
        const perFlip = flipBack ? BOOST_PER_BACKFLIP : BOOST_PER_FRONTFLIP;
        let fuel = turns * BOOST_PER_SPIN + flipTurns * perFlip;
        if (turns >= 1 && flipTurns >= 1) fuel *= COMBO_MULT; // variety bonus
        earnBoost(sim, Math.min(BOOST_TRICK_CAP, fuel));
        // Points are uncapped and star-multiplied — the ledger of glory.
        const perFlipPts = flipBack ? POINTS_PER_BACKFLIP : POINTS_PER_FRONTFLIP;
        let points = turns * POINTS_PER_SPIN + flipTurns * perFlipPts;
        if (turns >= 1 && flipTurns >= 1) points *= COMBO_MULT;
        points = Math.round(points * sim.trickMult);
        sim.score += points;
        events.push({
          type: 'trick',
          spins: turns,
          flips: flipTurns,
          flipBack,
          mult: sim.trickMult,
          points,
        });
        // The star is spent by the attempt it multiplied. It survives plain
        // landings and crashes, staying armed until a trick settles.
        sim.trickMult = 1;
      }
    }
    s.spin = 0;
    s.flip = 0;
  }

  const grounded = s.airTime === 0 && s.tumbling === 0;
  if (grounded && s.speed > NEAR_MISS_MIN_SPEED && sim.nearMissCooldown === 0) {
    for (const obstacle of sim.terrain.obstaclesNear(s.z)) {
      const d = Math.hypot(obstacle.x - s.x, obstacle.z - s.z);
      if (d < obstacle.radius + SKIER_RADIUS + NEAR_MISS_RING) {
        sim.nearMissCooldown = NEAR_MISS_COOLDOWN;
        events.push({ type: 'nearMiss', x: obstacle.x, z: obstacle.z });
        break;
      }
    }
  }

  // Coins along the floor. Collection is 3D.
  if (s.tumbling === 0) {
    for (const pickup of sim.terrain.pickupsNear(s.z)) {
      if (sim.collected.has(pickup.id)) continue;
      const dx = pickup.x - s.x;
      const dz = pickup.z - s.z;
      const dy = pickup.y - (s.y + 1.0); // roughly chest height
      if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && Math.abs(dy) < 1.5) {
        sim.collected.add(pickup.id);
        earnBoost(sim, BOOST_COIN);
        sim.score += POINTS_COIN;
        events.push({ type: 'pickup', x: pickup.x, z: pickup.z });
      }
    }

    // Bonus stars high over the kickers: grabbing one arms the multiplier.
    for (const star of sim.terrain.bonusesNear(s.z)) {
      if (sim.collected.has(star.id)) continue;
      const dx = star.x - s.x;
      const dz = star.z - s.z;
      const dy = star.y - (s.y + 1.0);
      if (dx * dx + dz * dz < BONUS_RADIUS * BONUS_RADIUS && Math.abs(dy) < BONUS_RADIUS) {
        sim.collected.add(star.id);
        sim.trickMult = Math.max(sim.trickMult, star.mult);
        events.push({ type: 'bonus', x: star.x, z: star.z, mult: star.mult });
      }
    }
  }

  // Sector pace grade: every 250m of course, average speed converts to
  // points on a savage curve. This is where burned boost becomes score.
  if (s.z <= sim.nextSectorZ) {
    const elapsed = sim.time - sim.sectorStartTime;
    const avg = SECTOR_LENGTH / Math.max(elapsed, 0.001);
    const over = Math.max(0, avg - SECTOR_MIN_SPEED);
    const points = Math.round(SECTOR_COEFF * Math.pow(over, SECTOR_EXP));
    sim.score += points;
    events.push({ type: 'sector', speed: avg, points });
    sim.nextSectorZ -= SECTOR_LENGTH;
    sim.sectorStartTime = sim.time;
  }

  return events;
}

export function distanceSkied(sim: Sim): number {
  return Math.max(0, -sim.skier.z);
}
