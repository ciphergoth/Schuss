import { SECTION_LENGTH, Terrain } from './terrain';
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
  | {
      type: 'trick';
      spins: number; // total spin turns (both directions)
      flips: number; // total flip turns (front + back)
      // The scored tricks in the order they were done, for the banner to spell
      // out (so L360-then-R360 reads as two tricks, not a squashed 720).
      segments: { kind: 'spinL' | 'spinR' | 'front' | 'back'; turns: number }[];
      parallel: boolean; // spin+flip at once (sub-additive combo)
      variety: boolean; // >=2 different tricks in sequence (the complexity bonus)
      mult: number;
      points: number;
      repeat: boolean; // exact same segment sequence as the last: docked pay
    }
  | { type: 'sector'; speed: number; points: number } // 250m pace grade
  | { type: 'finish'; time: number; score: number } // crossed the line
  | { type: 'tumble'; trick: boolean }; // trick: blown rotation vs plain crash

export interface Sim {
  terrain: Terrain;
  skier: SkierState;
  time: number;
  boost: number; // 0..1 tank — rewards fill it, burning it is the speed
  boosting: boolean; // burning right now (render/audio read this)
  charge: number; // jump charge, 0..1 of the bar; the sim owns it (sim-time,
  // deterministic). 0..CHARGE_HUMAN fills freely; the superhuman half only
  // fills while there is fuel burning. Released as vy = 5.4 * sqrt(charge).
  trickMult: number; // armed by a bonus star; multiplies the next trick's POINTS
  lastTrick: string | null; // signature of the last landed trick (repeat check)
  finishedAt: number | null; // sim time the line was crossed; score locks there
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
// Scoring sectors ARE the terrain sections now (one rhythm): every section
// boundary is a graded pace line, and the glowing arc there marks both. The
// grade is average SPEED (length cancels in avg = length/time), so aligning
// to 400m needs no re-tuning of the curve — it just means 8 graded lines a
// course instead of ~13.
export const SECTOR_LENGTH = SECTION_LENGTH;
const SECTOR_MIN_SPEED = 12; // average m/s before a sector pays anything
// Savage: points = 25 * (avg - 12)^2.2 — a 20 m/s sector ~2400, a
// full-boost 30 m/s sector ~20000, worth several big tricks.
const SECTOR_COEFF = 25;
const SECTOR_EXP = 2.2;
// Trick pay follows difficulty (slower rotation = more air needed = more
// money): spin < frontflip < backflip. But two tricks in one flight is where
// the real money is, and HOW they combine matters.
const BOOST_PER_SPIN = 0.15;
const BOOST_PER_FRONTFLIP = 0.2;
const BOOST_PER_BACKFLIP = 0.26;
// A flight is a sequence of trick segments. VARIETY — two or more DIFFERENT
// tricks in that sequence (spin-left, spin-right, frontflip, backflip all
// count as different) — is the showpiece: the plain sum times a complexity
// bonus. A PARALLEL combo (spin AND flip AT ONCE, the slower locked-rate
// maneuver) is instead sub-additive: the smaller axis pays at a discount, so
// it beats either alone but not their sum. Repetition of the exact same
// sequence docks the points.
const VARIETY_MULT = 1.35; // serial variety: (base sum) x this
const PARALLEL_SECOND = 0.6; // parallel: bigger axis + this x smaller axis
const REPEAT_FACTOR = 0.7; // exact same sequence as last time: the judges are bored
const BOOST_TRICK_CAP = 0.65; // per landing

// A parallel combo's two axes, folded sub-additively: more than either alone,
// less than their sum. (One axis zero = a solo, just the sum.)
export function parallelCombine(a: number, b: number): number {
  if (a === 0 || b === 0) return a + b;
  return Math.max(a, b) + PARALLEL_SECOND * Math.min(a, b);
}
const BOOST_DRAIN = 0.15; // per second while burning
// The jump bar: 6 seconds of hold to a full superhuman charge, with the
// strongest HUMAN jump at the halfway marker (3s). Energy is linear in hold
// time throughout — one law, no kink — so the human half is exactly the old
// charge curve, and the half beyond the marker is paid for in boost: it
// only fills while fuel is in the tank (the held button is already burning
// it; that burn IS the price of superhuman legs).
export const CHARGE_FULL_S = 6;
export const CHARGE_HUMAN = 0.5;
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
    charge: 0,
    trickMult: 1,
    lastTrick: null,
    finishedAt: null,
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
  const grounded0 = s.airTime === 0 && s.tumbling === 0;
  sim.boosting = (input.boost ?? false) && sim.boost > 0 && grounded0;
  if (sim.boosting) sim.boost = Math.max(0, sim.boost - BOOST_DRAIN * SIM_DT);

  // The jump charge banks in sim time while the button is held on the snow.
  // The human half is free; the superhuman half only fills while fuel burns.
  if ((input.boost ?? false) && grounded0) {
    const next = sim.charge + SIM_DT / CHARGE_FULL_S;
    if (sim.charge < CHARGE_HUMAN) sim.charge = Math.min(CHARGE_HUMAN, next);
    else if (sim.boost > 0) sim.charge = Math.min(1, next);
  }
  // Release: the banked charge becomes the pop (spent either way — a
  // release mid-air fizzles). A crash always fumbles the charge.
  let skierInput = input;
  if ((input.jump ?? 0) > 0) {
    skierInput = { ...input, jump: grounded0 ? sim.charge : 0 };
    sim.charge = 0;
  }
  if (s.tumbling > 0) sim.charge = 0;

  stepSkier(s, sim.terrain, skierInput, SIM_DT, sim.boosting);
  sim.time += SIM_DT;
  sim.nearMissCooldown = Math.max(0, sim.nearMissCooldown - SIM_DT);

  if (s.tumbling > 0 && !wasTumbling) {
    // Rotation still on the clock at the moment of tumbling = a blown trick.
    const trick = Math.abs(s.spin) > TRICK_COMMIT || Math.abs(s.flip) > FLIP_COMMIT;
    if (trick) sim.trickMult = 1; // a blown attempt still spends the star
    events.push({ type: 'tumble', trick });
  }

  // Crossing the line ends the run: the score locks, and the outrun beyond
  // is pure ceremony — no pay, no penalties, just skiing it out.
  if (sim.finishedAt === null && sim.terrain.pastFinish(s.z)) {
    sim.finishedAt = sim.time;
    events.push({ type: 'finish', time: sim.time, score: sim.score });
  }
  const scoring = sim.finishedAt === null;

  // Any return to the snow settles the flight's rotation ledger. A rotation
  // only counts if it arrived within tolerance of the correct facing — the
  // SAME bar the landing judge tumbles by past commit; one gate for payout
  // and bail alike. Under commit a wide residual is a safe bail, not a
  // payday: without this gate a 185-degree spin rounded up to a paid 360.
  if (airBefore > 0 && s.airTime === 0) {
    // The flight's segments were banked by the landing judge (skier.ts). A
    // whole turn on an axis only counts if the NET facing on that axis is
    // clean (you landed forward / feet-down) — the same gate that tumbles by
    // past commit; under commit a wide residual is a safe bail, not a payday.
    const spinClean = Math.abs(residual(s.spin)) <= SPIN_TOLERANCE;
    const flipClean = Math.abs(residual(s.flip)) <= FLIP_TOLERANCE;
    const spinTurns = spinClean ? s.spinTurns : 0;
    const frontTurns = flipClean ? s.frontTurns : 0;
    const backTurns = flipClean ? s.backTurns : 0;
    const seq = s.sequence;
    if (s.tumbling === 0) {
      if (airBefore > MIN_STYLISH_AIR) events.push({ type: 'landing', airTime: airBefore });
      if (scoring && (spinTurns >= 1 || frontTurns >= 1 || backTurns >= 1)) {
        const spinPts = spinTurns * POINTS_PER_SPIN;
        const flipPts = frontTurns * POINTS_PER_FRONTFLIP + backTurns * POINTS_PER_BACKFLIP;
        const spinFuel = spinTurns * BOOST_PER_SPIN;
        const flipFuel = frontTurns * BOOST_PER_FRONTFLIP + backTurns * BOOST_PER_BACKFLIP;
        // How many DIFFERENT tricks landed clean, from the sequence tokens:
        // spin-left, spin-right, frontflip, backflip. Two or more = variety.
        const types =
          (spinClean && seq.includes('L') ? 1 : 0) +
          (spinClean && seq.includes('R') ? 1 : 0) +
          (flipClean && seq.includes('F') ? 1 : 0) +
          (flipClean && seq.includes('B') ? 1 : 0);
        // Parallel (spin AND flip at once) is the sub-additive combine; serial
        // variety (>=2 different tricks in sequence) is the complexity bonus.
        // Parallel takes precedence — a simultaneous combo isn't a sequence.
        const parallel = s.parallel && spinTurns >= 1 && frontTurns + backTurns >= 1;
        const variety = !parallel && types >= 2;
        let points: number;
        let fuel: number;
        if (parallel) {
          points = parallelCombine(spinPts, flipPts);
          fuel = parallelCombine(spinFuel, flipFuel);
        } else {
          points = spinPts + flipPts;
          fuel = spinFuel + flipFuel;
          if (variety) {
            points *= VARIETY_MULT;
            fuel *= VARIETY_MULT;
          }
        }
        // Fuel is flat and capped — the mechanical loop, never docked.
        earnBoost(sim, Math.min(BOOST_TRICK_CAP, fuel));
        // Points are uncapped and star-multiplied. Repeating the EXACT same
        // flight (segment sequence + parallel-ness) as last time docks the
        // base pay before the star multiplies it.
        const signature = seq + (parallel ? '|P' : '');
        const repeat = sim.lastTrick === signature;
        if (repeat) points *= REPEAT_FACTOR;
        sim.lastTrick = signature;
        points = Math.round(points * sim.trickMult);
        sim.score += points;
        // Decode the scored sequence, in order, for the banner. Only segments
        // on a clean axis count (a bailed axis scored 0).
        const segments: { kind: 'spinL' | 'spinR' | 'front' | 'back'; turns: number }[] = [];
        for (const m of seq.matchAll(/([LRFB])(\d+)/g)) {
          const letter = m[1];
          if ((letter === 'L' || letter === 'R') && !spinClean) continue;
          if ((letter === 'F' || letter === 'B') && !flipClean) continue;
          segments.push({
            kind:
              letter === 'L'
                ? 'spinL'
                : letter === 'R'
                  ? 'spinR'
                  : letter === 'F'
                    ? 'front'
                    : 'back',
            turns: Number(m[2]),
          });
        }
        events.push({
          type: 'trick',
          spins: spinTurns,
          flips: frontTurns + backTurns,
          segments,
          parallel,
          variety,
          mult: sim.trickMult,
          points,
          repeat,
        });
        // The star is spent by the attempt it multiplied. It survives plain
        // landings and crashes, staying armed until a trick settles.
        sim.trickMult = 1;
      }
    }
    s.spin = 0;
    s.flip = 0;
    s.spinCur = 0;
    s.flipCur = 0;
    s.spinTurns = 0;
    s.frontTurns = 0;
    s.backTurns = 0;
    s.sequence = '';
    s.parallel = false;
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

  // Sector pace grade: at every section boundary (400m), average speed
  // converts to points on a savage curve. This is where burned boost
  // becomes score — and the arc marks the line you were just graded on.
  if (scoring && s.z <= sim.nextSectorZ) {
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
