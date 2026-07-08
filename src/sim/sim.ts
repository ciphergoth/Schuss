import { CourseDesign } from './design';
import {
  CROWD_FACTOR,
  ContractDemand,
  GALLERY_RANGE,
  GATE_HEIGHT,
  GATE_POINTS,
  SECTION_LENGTH,
  Terrain,
  hazardCircles,
} from './terrain';
import {
  FLIP_COMMIT,
  FLIP_TOLERANCE,
  SKIER_HEIGHT,
  SKIER_RADIUS,
  SPIN_TOLERANCE,
  TRICK_COMMIT,
  SkierInput,
  SkierState,
  createSkier,
  hitSkier,
  residual,
  stepSkier,
} from './skier';

// Fixed timestep: the simulation only ever advances in SIM_DT increments, so a
// given seed plus a given input sequence always produces the same run.
export const SIM_DT = 1 / 120;

// A star's deal: the multiplier pays on the next trick, if it delivers the
// demand. Grabbing the star (even on a trickless arc ride) is what earns it;
// touchdown is when it's revealed.
export interface Contract {
  mult: 3 | 5;
  demand: ContractDemand;
}

// Things worth celebrating (or commiserating), for the fx and audio layers.
export type SimEvent =
  | { type: 'nearMiss'; x: number; z: number }
  | { type: 'landing'; airTime: number }
  | { type: 'pickup'; x: number; z: number }
  | { type: 'bonus'; x: number; z: number; mult: number } // trick-bonus star grabbed
  | { type: 'contract'; mult: number; demand: ContractDemand } // revealed at touchdown
  | {
      type: 'trick';
      spins: number; // total spin turns (both directions)
      flips: number; // total flip turns (front + back)
      // The scored tricks in the order they were done, for the banner to spell
      // out (so L360-then-R360 reads as two tricks, not a squashed 720).
      segments: { kind: 'spinL' | 'spinR' | 'front' | 'back'; turns: number }[];
      parallel: boolean; // spin+flip at once (sub-additive combo)
      variety: boolean; // >=2 different tricks in sequence (the complexity bonus)
      grabbed: boolean; // the GRAB was held through the flight (styled: base x1.2)
      mult: number; // the contract's multiplier if this trick paid it, else 1
      points: number;
      repeat: boolean; // exact same segment sequence as the last: docked pay
      contract?: 'paid' | 'missed'; // how this attempt settled an armed contract
      // Landed in front of a gallery: the crowd's bonus and where they are
      // (for the confetti and the cheer).
      crowd?: { x: number; z: number; points: number };
    }
  | { type: 'sector'; speed: number; points: number } // 250m pace grade
  | { type: 'finish'; time: number; score: number } // crossed the line
  | { type: 'gate'; x: number; z: number; chain: number; points: number } // slalom gate threaded
  | { type: 'gateMiss'; chain: number } // a running chain broke (chain = what it was)
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
  // The star economy is a contract chain: a grabbed star's contract is
  // PENDING until touchdown (it never multiplies the flight it was grabbed
  // on), then ARMED for the next trick attempt — which pays the multiplier
  // only by delivering the demand. Settling either way clears it; plain
  // landings and crashes keep it waiting; a newer grab replaces it.
  contract: Contract | null; // armed: judges the next trick attempt
  pendingContract: Contract | null; // grabbed mid-flight, revealed at touchdown
  lastTrick: string | null; // signature of the last landed trick (repeat check)
  finishedAt: number | null; // sim time the line was crossed; score locks there
  score: number; // the ledger of glory: trick points + sector pace, uncapped
  gateChain: number; // consecutive slalom gates threaded; a miss resets it
  nextSectorZ: number; // where the next 250m pace grade lands
  sectorStartTime: number;
  nearMissCooldown: number;
  collected: Set<string>; // pickup + bonus ids gathered this run
}

// The economy has two ledgers doing different jobs. The BOOST TANK is the
// mechanical loop: coins and tricks fill it (flat, capped), burning it is
// speed. The SCORE is the uncapped ledger of glory: tricks pay big points,
// bonus stars deal CONTRACTS (the x3/x5 pays on the NEXT trick, only if it
// delivers the star's named demand — the jackpot is always attached to a
// real showpiece, never a lazy 360), and every sector grades your pace
// SAVAGELY, so fuel burned into a fast sector converts to points.
// Tricks -> fuel -> speed -> points: one economy.
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
// The GRAB: holding the boost button in real air (where it has no other
// job) tweaks the body over the skis. Held for a real beat, it styles the
// whole flight: base points x1.2 — SCORE only, never fuel (style is glory,
// not propulsion) — and a grabbed sequence is a different trick from a
// plain one for the repeat check.
const GRAB_MULT = 1.2;
const GRAB_MIN_S = 0.25; // a micro-tap isn't a grab
const BOOST_TRICK_CAP = 0.65; // per landing

// A parallel combo's two axes, folded sub-additively: more than either alone,
// less than their sum. (One axis zero = a solo, just the sum.)
export function parallelCombine(a: number, b: number): number {
  if (a === 0 || b === 0) return a + b;
  return Math.max(a, b) + PARALLEL_SECOND * Math.min(a, b);
}

// Does a settled flight deliver a contract's demand? Judged on the same
// clean-axis facts the payout uses — a bailed axis satisfies nothing.
export function demandMet(
  demand: ContractDemand,
  flight: {
    seq: string; // banked segment tokens, e.g. "R1B2" (letter + whole turns)
    spinClean: boolean;
    flipClean: boolean;
    spinTurns: number;
    flipTurns: number;
    variety: boolean;
    parallel: boolean;
  }
): boolean {
  switch (demand) {
    case 'spinL':
      return flight.spinClean && /L[1-9]/.test(flight.seq);
    case 'spinR':
      return flight.spinClean && /R[1-9]/.test(flight.seq);
    case 'front':
      return flight.flipClean && /F[1-9]/.test(flight.seq);
    case 'back':
      return flight.flipClean && /B[1-9]/.test(flight.seq);
    case 'spin2':
      return flight.spinTurns >= 2;
    case 'flip2':
      return flight.flipTurns >= 2;
    case 'mix':
      return flight.variety;
    case 'parallel':
      return flight.parallel;
  }
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

export function createSim(seed: number, courseLength?: number, design?: CourseDesign): Sim {
  const terrain = new Terrain(seed, courseLength, design);
  const skier = createSkier();
  skier.y = terrain.height(skier.x, skier.z);
  return {
    terrain,
    skier,
    time: 0,
    boost: 0,
    boosting: false,
    charge: 0,
    contract: null,
    pendingContract: null,
    lastTrick: null,
    finishedAt: null,
    score: 0,
    gateChain: 0,
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
  const zBefore = s.z;

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

  // Moving hazards collide like obstacles, but against where the creature
  // IS right now (a pure function of sim.time, so what the render layer
  // shows is exactly what hits — including what ISN'T there: a submerged
  // wyrm hump, a lifted jelly tentacle). Each circle carries a vertical
  // band above its snow; the skier's body spans SKIER_HEIGHT. Checked here,
  // before the tumble ledger below, so a creature hit fires the same tumble
  // event a crystal does.
  if (s.tumbling === 0) {
    outer: for (const h of sim.terrain.hazardsNear(s.z)) {
      for (const c of hazardCircles(h, sim.time)) {
        const dx = c.x - s.x;
        const dz = c.z - s.z;
        const r = c.r + SKIER_RADIUS;
        if (dx * dx + dz * dz >= r * r) continue;
        const gy = sim.terrain.height(c.x, c.z);
        if (s.y >= gy + c.top || s.y + SKIER_HEIGHT <= gy + c.bottom) continue;
        hitSkier(s, c.x, c.z, r);
        break outer;
      }
    }
  }

  if (s.tumbling > 0 && !wasTumbling) {
    // Rotation still on the clock at the moment of tumbling = a blown trick.
    const trick = Math.abs(s.spin) > TRICK_COMMIT || Math.abs(s.flip) > FLIP_COMMIT;
    if (trick) sim.contract = null; // a blown attempt still settles the contract
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
        const grabbed = s.grab >= GRAB_MIN_S;
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
        // The grab styles the points, never the fuel: the tank is mechanics,
        // the tweak is glory.
        if (grabbed) points *= GRAB_MULT;
        // Fuel is flat and capped — the mechanical loop, never docked.
        earnBoost(sim, Math.min(BOOST_TRICK_CAP, fuel));
        // The armed contract settles on this attempt either way: deliver
        // the demand and the multiplier pays; anything else and it's gone.
        let mult = 1;
        let contractResult: 'paid' | 'missed' | undefined;
        if (sim.contract) {
          const flipTurns = frontTurns + backTurns;
          if (
            demandMet(sim.contract.demand, {
              seq,
              spinClean,
              flipClean,
              spinTurns,
              flipTurns,
              variety,
              parallel,
            })
          ) {
            mult = sim.contract.mult;
            contractResult = 'paid';
          } else {
            contractResult = 'missed';
          }
          sim.contract = null;
        }
        // Points are uncapped. Repeating the EXACT same flight (segment
        // sequence + parallel-ness) as last time docks the base pay before
        // the contract multiplies it — UNLESS this trick just cashed a star
        // contract, which DEMANDED that exact trick: docking the showpiece the
        // star asked for (and flashing AGAIN?) would punish obeying the star,
        // so a paid contract is never a repeat.
        const signature = seq + (parallel ? '|P' : '') + (grabbed ? '|G' : '');
        const repeat = contractResult !== 'paid' && sim.lastTrick === signature;
        if (repeat) points *= REPEAT_FACTOR;
        sim.lastTrick = signature;
        points = Math.round(points * mult);
        sim.score += points;
        // SHOWBOATING: a trick landed in front of a gallery pays a crowd
        // bonus on top — a cut of the multiplied points, because the crowd
        // loves the jackpot most of all. One crowd per landing.
        let crowd: { x: number; z: number; points: number } | undefined;
        for (const g of sim.terrain.galleriesNear(s.z)) {
          if (Math.abs(g.z - s.z) > GALLERY_RANGE) continue;
          const bonus = Math.round(points * CROWD_FACTOR);
          if (bonus > 0) {
            sim.score += bonus;
            crowd = { x: g.x, z: g.z, points: bonus };
          }
          break;
        }
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
          grabbed,
          mult,
          points,
          repeat,
          contract: contractResult,
          crowd,
        });
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
    s.grab = 0;

    // Touchdown reveals the grabbed star's contract — for the NEXT trick.
    // It arms after this flight's attempt settled (a trick done while
    // grabbing pays base), and even a crashed landing deals it: the arc
    // ride was the feat.
    if (sim.pendingContract) {
      sim.contract = sim.pendingContract;
      sim.pendingContract = null;
      events.push({ type: 'contract', mult: sim.contract.mult, demand: sim.contract.demand });
    }
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
    // Slipping past a creature celebrates like grazing a crystal — and so
    // does slipping UNDER one (a contracted jelly): any live circle shaved
    // horizontally counts; the whoosh is the reward for the close call.
    if (sim.nearMissCooldown === 0) {
      outer: for (const h of sim.terrain.hazardsNear(s.z)) {
        for (const c of hazardCircles(h, sim.time)) {
          const d = Math.hypot(c.x - s.x, c.z - s.z);
          if (d < c.r + SKIER_RADIUS + NEAR_MISS_RING) {
            sim.nearMissCooldown = NEAR_MISS_COOLDOWN;
            events.push({ type: 'nearMiss', x: c.x, z: c.z });
            break outer;
          }
        }
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

    // Bonus stars high over the kickers: grabbing one deals its contract.
    // Mid-flight it stays pending until touchdown; a star met on the snow
    // (landing-aware placement can hang them low) arms on the spot. A newer
    // grab replaces whatever was held — you flew through it on purpose.
    for (const star of sim.terrain.bonusesNear(s.z)) {
      if (sim.collected.has(star.id)) continue;
      const dx = star.x - s.x;
      const dz = star.z - s.z;
      const dy = star.y - (s.y + 1.0);
      if (dx * dx + dz * dz < BONUS_RADIUS * BONUS_RADIUS && Math.abs(dy) < BONUS_RADIUS) {
        sim.collected.add(star.id);
        const contract: Contract = { mult: star.mult, demand: star.demand };
        if (s.airTime > 0) {
          sim.pendingContract = contract;
        } else {
          sim.contract = contract;
          events.push({ type: 'contract', mult: contract.mult, demand: contract.demand });
        }
        events.push({ type: 'bonus', x: star.x, z: star.z, mult: star.mult });
      }
    }
  }

  // Slalom gates settle on the crossing step: thread the gap (on your feet,
  // under the pole tops) and the chain escalates the pay; anything else —
  // wide, over the poles, or tumbling through — just resets the chain. The
  // punishment is only the forgone escalation: no tumble, no lost speed.
  if (s.z < zBefore) {
    for (const g of sim.terrain.gatesNear(s.z)) {
      if (zBefore <= g.z || s.z > g.z) continue; // not crossed this step
      if (sim.collected.has(g.id)) continue;
      sim.collected.add(g.id);
      const threaded =
        s.tumbling === 0 &&
        Math.abs(s.x - g.x) <= g.halfGap &&
        s.y <= sim.terrain.height(g.x, g.z) + GATE_HEIGHT;
      if (threaded) {
        sim.gateChain += 1;
        const points = scoring ? GATE_POINTS * sim.gateChain : 0;
        sim.score += points;
        events.push({ type: 'gate', x: g.x, z: g.z, chain: sim.gateChain, points });
      } else {
        if (sim.gateChain > 0) events.push({ type: 'gateMiss', chain: sim.gateChain });
        sim.gateChain = 0;
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
