import { Terrain, WALL_WIDTH } from './terrain';

export interface SkierInput {
  steer: number; // -1 (left) .. 1 (right); the mouse, always
  stance: number; // -1 (full tuck) .. 0 (neutral) .. 1 (full snowplow); the mouse, always
  jump?: number; // one-shot: from the input layer a release SIGNAL; the sim
  // rewrites it to the banked charge before the skier sees it
  charge?: number; // 0..1 charge for render feedback (main injects sim.charge)
  boost?: boolean; // burn the tank / bank jump charge (the one held button)
  trickSpin?: number; // -1..1 from the dedicated trick keys (A/D)
  trickFlip?: number; // -1..1 from the trick keys: W = -1 = frontflip (nose
  // over), S = +1 = backflip (nose up) — push forward to flip forward
}

export interface SkierState {
  x: number;
  z: number;
  y: number; // world height; equals terrain height while grounded
  vy: number; // vertical velocity; terrain-following in full contact
  heading: number; // radians; 0 = straight downhill (-z), positive = toward +x
  headingRef: number; // lagged "follow the course" reference: eases toward the
  // live course heading with HEADING_LAG_TAU, so neutral steering TRAILS the
  // bends and a slalom demands active input instead of auto-following
  speed: number; // horizontal m/s along the heading
  airTime: number; // seconds airborne this jump; 0 = grounded
  tumbling: number; // seconds of tumble remaining; 0 = on skis
  // A flight is a SEQUENCE of trick segments, split at direction reversals.
  // spin/flip are the running NET orientation (for rendering and the land-
  // facing-forward gate); spinCur/flipCur are the current OPEN segment (for
  // commit and banking); the turn counts and sequence string are what past
  // segments banked. See stepSkier's air block and sim.ts's landing judge.
  spin: number; // net yaw this flight (radians)
  flip: number; // net pitch this flight (radians)
  spinCur: number; // current spin segment, signed radians (reset at each reversal)
  flipCur: number; // current flip segment, signed radians
  spinTurns: number; // whole spin turns banked from closed segments (both directions)
  frontTurns: number; // whole frontflip turns banked
  backTurns: number; // whole backflip turns banked
  sequence: string; // banked segment tokens in order, e.g. 'L1R1' — repetition + variety
  parallel: boolean; // this flight ever spun AND flipped at once (vs serial)
  gap: number; // ballistic daylight the legs are currently bridging (< LEG_REACH)
}

const G = 9.81;
const FRICTION = 0.05; // neutral-stance snow friction coefficient
const PLOW_FRICTION = 0.6; // at full snowplow
// Crud is viscous, not Coulomb: resistance scales with speed, so it fades as
// you slow (gravity always wins; zero force at rest) — a constant coefficient
// once exceeded the slope pull and skiers ground to a halt mid-patch. The
// linear+quadratic mix keeps the full-crud crawl at ~7 m/s on the mean grade
// but bites much harder at race pace: ~8 m/s^2 at 15 m/s, ~16 at 25.
const CRUD_LINEAR = 0.33; // per second, at full stickiness
const CRUD_QUAD = 0.012; // per meter, at full stickiness
const DRAG = 0.0035; // neutral quadratic air drag; top speed around 29 m/s
const TUCK_DRAG_CUT = 0.5; // full tuck halves drag: top speed around 41 m/s
const TUCK_TURN_CUT = 0.4; // full tuck costs 40% of turn authority
const BOOST_ACCEL = 5.5; // m/s^2 while burning the tank — rocket territory
// Steering is position-to-direction: the stick/cursor sets a TARGET heading
// relative to the course direction (center = follow the track, but a LAGGED
// version — see HEADING_LAG_TAU), and the heading eases toward it. Rate control
// (cursor = rotation speed) integrates small errors into wild weaving —
// pilot-induced oscillation.
const MAX_STEER_OFFSET = 1.15; // radians of target offset at full deflection
const STEER_GAIN = 4; // per second: how eagerly heading chases the target
// Neutral steering follows a LAGGED course heading, not the instantaneous one:
// "forward" eases toward the live course direction with this time constant, so
// it trails the bends by ~a couple of seconds. Auto-follow made slaloms dull —
// now centering the mouse drifts wide through a bend and you have to steer INTO
// it. First-order (exponential) lag, so tight/fast slaloms both delay AND
// soften the reference, throwing the racing line back on the player.
const HEADING_LAG_TAU = 1.5; // seconds
const TURN_RATE = 2.6; // rad/s ceiling on heading change
// Gravity's cross-heading component rotates the velocity, not just the
// speed: banked floors carry you around their turn, walls nose you back to
// the floor, and a traverse bleeds toward the fall line. dHeading/dt =
// aPerp/speed, capped so crawling speeds pivot instead of whipping.
const GRAVITY_TURN_CAP = 1.0; // rad/s
export const SKIER_RADIUS = 0.4;
// The body's vertical reach, for hazards whose danger hangs in the air (a
// jelly's tentacles): the skier occupies [y, y + SKIER_HEIGHT].
export const SKIER_HEIGHT = 1.9;

// Contact is a position tolerance, not a force: the body is ballistic (never
// pulled down harder than g), and the legs bridge up to LEG_REACH of daylight
// between body and snow. A virtual gap integrates the true ballistic
// separation; within reach the skis stay planted (suspension absorbing
// moguls), past it the air is real. Replaces the old super-g glue.
const LEG_REACH = 0.35;
// Steepest launch the track's built features can produce (kicker lips are
// ~0.31). Terrain steeper than this sheds the skier instead of ramping them:
// banks are walls, not vert ramps.
const LAUNCH_MAX_VY_RATIO = 0.35;
// Jump: a released charge pops the skier off the snow, as an impulse on top
// of the current velocity. Energy is linear in hold time, so vy goes with
// sqrt(charge): the human marker (charge 0.5, a 3s hold) releases 3.8 m/s —
// the strongest human jump, exactly the old full pop — and the fuel-gated
// superhuman half of the bar climbs to 5.4 (~1.5m of rise). The sim owns
// the charge accounting (see sim.ts).
const JUMP_POP_MAX = 5.4;
// Invisible outer barrier where the bank steepens past ~55 degrees: hitting
// it caroms you back into the course (grounded or flying). Banks up to there
// are rideable; the near-vertical zone beyond is a wall, not a vert ramp.
// Offset from the (variable) floor edge, so it breathes with the course.
const BOUNCE_MARGIN = WALL_WIDTH - 2;
const BOUNCE_DAMP = 0.7;
// A skier crawling uphill-facing pivots toward the fall line instead of
// being stranded at zero speed forever.
const FALL_LINE_RATE = 1.6;

// Punishment is light by design: a tree hit costs a stumble and a beat of
// comedy, never the run — and now deliberately gentle. You keep most of
// your speed (0.6), the beat is short (0.7s), and the skid bleeds little
// (0.25), so a hit is a wobble to recover from, not a run-killer.
const TUMBLE_TIME = 0.7; // seconds without control after a hit
const TUMBLE_SPEED_KEEP = 0.6;
const TUMBLE_FRICTION = 0.25;
const AIR_TURN_FACTOR = 0.5; // reduced but real steering mid-air

// Tricks live on their own keys (WASD), which do nothing else — the mouse
// NEVER changes meaning: it steers on snow and aims your landing in the air,
// even mid-trick. Trick keys only engage in real air (kickers, big launches —
// not incidental roller hops). The landing judges committed rotation — bring
// it round to whole turns or tumble; small rotation always bails safe. Spins
// are lenient (landing a bit sideways is skiable); flips commit early
// (landing pitched 90 degrees is a faceplant, not a stumble).
const MIN_TRICK_AIR = 0.35; // seconds aloft before the trick keys engage
// Difficulty is rotation TIME: harder tricks turn slower, so they need more
// air — and they pay more (see sim.ts). Easiest to hardest: spin, frontflip,
// backflip.
const SPIN_RATE = 6; // full 360 in ~1.05s
const FRONTFLIP_RATE = 5; // ~1.26s per rotation
const BACKFLIP_RATE = 4.2; // ~1.5s per rotation — the money trick
// Spin AND flip at once (a PARALLEL combo) locks both axes to one rate — the
// flip's — slowed a touch, so doing both together is a little slower, and so
// harder, than either axis alone. Serial tricks keep their full solo rates.
const PARALLEL_SLOWDOWN = 0.85;
export const TRICK_COMMIT = 3.6; // radians of spin (~200 deg) before you must complete
export const FLIP_COMMIT = 1.4; // radians of flip (~80 deg) before you must complete
// Land within tolerance of the correct facing, on every rotated axis, or it
// isn't landed: past commit that's a tumble, under commit a safe bail that
// pays nothing. ONE gate for payout and bail alike — the sim gates payment
// on these same constants. Spins are lenient (a bit sideways is skiable);
// flips less so.
export const SPIN_TOLERANCE = 0.9; // radians; ~52 degrees
export const FLIP_TOLERANCE = 0.75; // ~43 degrees: a 90-deg pitch still faceplants

export function createSkier(): SkierState {
  return {
    x: 0,
    z: 0,
    y: 0,
    vy: 0,
    heading: 0,
    headingRef: 0,
    speed: 0,
    airTime: 0,
    tumbling: 0,
    spin: 0,
    flip: 0,
    spinCur: 0,
    flipCur: 0,
    spinTurns: 0,
    frontTurns: 0,
    backTurns: 0,
    sequence: '',
    parallel: false,
    gap: 0,
  };
}

// How far a rotation is from "clean" (any whole number of full turns).
export function residual(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Whole turns in a single segment, but ONLY if it landed within tolerance of
// that many turns: a 350° segment is a 360 (1), a lone 180° is a nothing (0).
// This is what stops a 180-one-way + 180-the-other from scoring two turns.
const TWO_PI = 2 * Math.PI;
function wholeTurns(rot: number, tol: number): number {
  const n = Math.round(Math.abs(rot) / TWO_PI);
  return Math.abs(Math.abs(rot) - n * TWO_PI) <= tol ? n : 0;
}

// Close the current spin segment: bank its whole turns and record it in the
// sequence (L/R by direction), so a reversal starts a fresh trick.
function bankSpin(state: SkierState): void {
  const t = wholeTurns(state.spinCur, SPIN_TOLERANCE);
  if (t > 0) {
    state.spinTurns += t;
    state.sequence += (state.spinCur < 0 ? 'L' : 'R') + t;
  }
  state.spinCur = 0;
}

// Close the current flip segment — front and back are different tricks.
function bankFlip(state: SkierState): void {
  const t = wholeTurns(state.flipCur, FLIP_TOLERANCE);
  if (t > 0) {
    if (state.flipCur > 0) {
      state.backTurns += t;
      state.sequence += 'B' + t;
    } else {
      state.frontTurns += t;
      state.sequence += 'F' + t;
    }
  }
  state.flipCur = 0;
}

// Ease the heading toward the steering target: proportional, rate-limited,
// no overshoot. Self-centering — steer 0 follows the course, but the LAGGED
// course (state.headingRef), so bends have to be actively steered. A skier
// up on a bank additionally gets nosed back toward the floor: centering the
// heading alone would happily cruise parallel INSIDE the sticky wall forever
// (the "insists on skiing the wall" bug). Full deflection out-muscles the
// recovery, so deliberate wall-riding still works.
const BANK_RECOVERY = 0.55; // radians of target bias at full strength

function steerToward(
  state: SkierState,
  terrain: Terrain,
  input: SkierInput,
  maxRate: number,
  dt: number
): void {
  const tuck = Math.max(0, -input.stance);
  const d = state.x - terrain.centerX(state.z);
  const over = Math.abs(d) - terrain.channelHalfWidth(state.z);
  const recovery = over > 0 ? -Math.sign(d) * Math.min(1, over / 6) * BANK_RECOVERY : 0;
  const target =
    state.headingRef + // the LAGGED course heading — the SAME reference on the
    // ground and in the air, so steering doesn't lurch across the transition;
    // bends must be steered (even to line up a star mid-flight)
    terrain.hipAim(state.x, state.z) + // hip pads bend the course line itself
    input.steer * MAX_STEER_OFFSET * (1 - TUCK_TURN_CUT * tuck) +
    recovery;
  const diff = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
  const rate = Math.max(-maxRate, Math.min(maxRate, STEER_GAIN * diff));
  state.heading += rate * dt;
}

// A solid hit at (ox, oz): start the tumble and carom the skier sideways
// past the thing. Shared by static obstacles (below) and the sim's moving
// hazards (sim.ts), so a drone hits exactly like a crystal.
export function hitSkier(state: SkierState, ox: number, oz: number, r: number): void {
  state.tumbling = TUMBLE_TIME;
  state.speed *= TUMBLE_SPEED_KEEP;
  state.airTime = 0;
  state.gap = 0;
  const perpX = Math.cos(state.heading);
  const perpZ = Math.sin(state.heading);
  const side = perpX * (state.x - ox) + perpZ * (state.z - oz) >= 0 ? 1 : -1;
  state.x = ox + perpX * side * (r + 0.05);
  state.z = oz + perpZ * side * (r + 0.05);
}

// Obstacles are solid cylinders: overlap in the horizontal plane only counts
// below their top, so a jump has to genuinely clear them. A hit starts a
// tumble and caroms the skier sideways past the obstacle.
function collideObstacles(state: SkierState, terrain: Terrain): void {
  for (const obstacle of terrain.obstaclesNear(state.z)) {
    const dx = obstacle.x - state.x;
    const dz = obstacle.z - state.z;
    const r = obstacle.radius + SKIER_RADIUS;
    if (dx * dx + dz * dz >= r * r) continue;
    if (state.y >= terrain.height(obstacle.x, obstacle.z) + obstacle.height) continue;
    hitSkier(state, obstacle.x, obstacle.z, r);
    return;
  }
}

// Carom off the invisible barrier just outside the rideable walls: clamp back
// to the limit and reflect the heading across the local track direction.
function bounceOffBounds(state: SkierState, terrain: Terrain): void {
  const center = terrain.centerX(state.z);
  const limit = terrain.channelHalfWidth(state.z) + BOUNCE_MARGIN;
  const d = state.x - center;
  if (Math.abs(d) <= limit) return;
  state.x = center + Math.sign(d) * limit;
  const trackHeading = terrain.trackHeading(state.z);
  const diff = state.heading - trackHeading;
  state.heading = trackHeading - Math.atan2(Math.sin(diff), Math.cos(diff));
  state.speed *= BOUNCE_DAMP;
  // The wall absorbs upward momentum: a carom must not convert a climb into
  // flight (this was the moon-shot: climb vy + reflected heading = launch).
  state.vy = Math.min(state.vy, 0);
}

export function stepSkier(
  state: SkierState,
  terrain: Terrain,
  input: SkierInput,
  dt: number,
  boosting: boolean // burning the tank this step (the sim decides eligibility)
): void {
  // Ease the "follow the course" reference toward the live course heading, so
  // it lags the bends (HEADING_LAG_TAU). Runs every step — grounded, airborne,
  // even tumbling — so the reference is a continuous function of time.
  const courseHeading = terrain.trackHeading(state.z);
  const lagDiff = Math.atan2(
    Math.sin(courseHeading - state.headingRef),
    Math.cos(courseHeading - state.headingRef)
  );
  state.headingRef += lagDiff * (1 - Math.exp(-dt / HEADING_LAG_TAU));

  if (state.tumbling > 0) {
    // No control while tumbling: skid straight ahead under heavy friction,
    // glued to the snow, then pop back up. Collisions are ignored — you're
    // already down.
    state.tumbling = Math.max(0, state.tumbling - dt);
    state.speed = Math.max(0, state.speed - TUMBLE_FRICTION * G * dt);
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += -Math.cos(state.heading) * state.speed * dt;
    bounceOffBounds(state, terrain);
    const groundY = terrain.height(state.x, state.z);
    state.vy = (groundY - state.y) / dt; // keep following, so recovery doesn't relaunch
    state.y = groundY;
    return;
  }

  if (state.airTime > 0) {
    // Ballistic: gravity on vy, air drag on speed. The mouse keeps its
    // everyday meaning — gently aiming the landing, tucking for drag — while
    // the dedicated trick keys rotate you, and only in real air. Digital keys
    // need no hover deadband.
    const airTuck = Math.max(0, -input.stance);
    // Air uses the SAME lagged reference as the ground (no lurch at the
    // transition): the mouse aims the landing, and lining a star up in a bend
    // is a deliberate steer, not an automatic follow.
    steerToward(state, terrain, input, TURN_RATE * AIR_TURN_FACTOR, dt);
    if (state.airTime > MIN_TRICK_AIR) {
      const spinInput = input.trickSpin ?? 0;
      const flipInput = input.trickFlip ?? 0; // positive = backflip (S)
      const flipRate = flipInput > 0 ? BACKFLIP_RATE : FRONTFLIP_RATE;
      // Parallel combo: spinning WHILE flipping locks BOTH axes to one rate
      // (the flip's, slowed by PARALLEL_SLOWDOWN) so they land in lockstep
      // and the combo is a touch slower — harder — than either alone. Any
      // overlap this flight marks it parallel (vs a serial spin-then-flip).
      const both = spinInput !== 0 && flipInput !== 0;
      if (both) state.parallel = true;
      const lockedRate = flipRate * PARALLEL_SLOWDOWN;
      // A reversal (input opposes the open segment) closes that segment and
      // starts a new trick; then accumulate into both the net and the segment.
      if (spinInput !== 0) {
        if (state.spinCur !== 0 && Math.sign(spinInput) !== Math.sign(state.spinCur)) {
          bankSpin(state);
        }
        const d = (both ? lockedRate : SPIN_RATE) * spinInput * dt;
        state.spin += d;
        state.spinCur += d;
      }
      if (flipInput !== 0) {
        if (state.flipCur !== 0 && Math.sign(flipInput) !== Math.sign(state.flipCur)) {
          bankFlip(state);
        }
        const d = (both ? lockedRate : flipRate) * flipInput * dt;
        state.flip += d;
        state.flipCur += d;
      }
    }
    state.speed = Math.max(
      0,
      state.speed - DRAG * (1 - TUCK_DRAG_CUT * airTuck) * state.speed * state.speed * dt
    );
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += -Math.cos(state.heading) * state.speed * dt;
    bounceOffBounds(state, terrain);
    state.vy -= G * dt;
    state.y += state.vy * dt;
    state.airTime += dt;
    collideObstacles(state, terrain);
    if (state.tumbling > 0) return;
    const ground = terrain.height(state.x, state.z);
    if (state.y <= ground) {
      state.y = ground;
      state.airTime = 0;
      // Landing is an inelastic collision with the slope: the velocity
      // component into the surface is absorbed, the component along it
      // survives. Landing on a descending face converts fall into speed;
      // zeroing vy instead caused the perpetual-bounce bug.
      const dirX = Math.sin(state.heading);
      const dirZ = -Math.cos(state.heading);
      let vx = dirX * state.speed;
      let vz = dirZ * state.speed;
      const [lgx, lgz] = terrain.gradient(state.x, state.z);
      const nl = Math.hypot(lgx, 1, lgz);
      const nx = -lgx / nl;
      const ny = 1 / nl;
      const nz = -lgz / nl;
      const into = vx * nx + state.vy * ny + vz * nz;
      if (into < 0) {
        vx -= into * nx;
        vz -= into * nz;
        state.vy -= into * ny;
      }
      const horizontal = Math.hypot(vx, vz);
      if (horizontal > 0.1) state.heading = Math.atan2(vx, -vz);
      state.speed = horizontal;

      // Commit is judged on the CURRENT (open) segment — how far into the
      // move in progress you are — while "clean" is the NET facing (you must
      // land forward / feet-down). Past commit and not facing clean = a
      // tumble; under commit = a safe bail. So you can spin one way then the
      // other and land forward, but you can't bail out of a big committed
      // rotation by wrenching the stick back.
      const spinClean = Math.abs(residual(state.spin)) <= SPIN_TOLERANCE;
      const flipClean = Math.abs(residual(state.flip)) <= FLIP_TOLERANCE;
      const blownSpin = Math.abs(state.spinCur) > TRICK_COMMIT && !spinClean;
      const blownFlip = Math.abs(state.flipCur) > FLIP_COMMIT && !flipClean;
      // Close the open segments so the banked turns and sequence are final
      // for the scorer (sim.ts).
      bankSpin(state);
      bankFlip(state);
      if (blownSpin || blownFlip) {
        state.tumbling = TUMBLE_TIME;
        state.speed *= TUMBLE_SPEED_KEEP;
      }
    }
    return;
  }

  const plow = Math.max(0, input.stance);
  const tuck = Math.max(0, -input.stance);

  // Turning authority ramps up with speed (skis can't pivot while
  // stationary); a tuck narrows the target range inside steerToward. The
  // reference is the LAGGED course heading, so bends must be steered.
  // Glacier ice halves the edges' bite: turns arrive late there.
  const grip = terrain.gripAt(state.z);
  steerToward(state, terrain, input, TURN_RATE * Math.min(state.speed / 4, 1) * grip, dt);

  // The banked-turn force: the slope's pull perpendicular to the skis
  // rotates the heading (see GRAVITY_TURN_CAP). This is what makes a
  // superelevated sweeper actually steer you and a wall ride carve back
  // down instead of relying on the recovery bias alone.
  const [gx, gz] = terrain.gradient(state.x, state.z);
  const aPerp = -G * (gx * Math.cos(state.heading) + gz * Math.sin(state.heading));
  state.heading +=
    Math.max(-GRAVITY_TURN_CAP, Math.min(GRAVITY_TURN_CAP, aPerp / Math.max(state.speed, 2))) * dt;

  const dirX = Math.sin(state.heading);
  const dirZ = -Math.cos(state.heading);

  // Gravity component along the direction of travel, minus snow friction and
  // air drag. Friction can stop the skier but never pushes them backwards.
  // Snowplow scales friction up; tuck cuts drag.
  const slopeAccel = -G * (gx * dirX + gz * dirZ);
  // Ice also bites the brakes less: friction (the plow's included) scales
  // with grip. Less friction can only help the drainage guarantee.
  const muG = (FRICTION + plow * (PLOW_FRICTION - FRICTION)) * G * grip;
  const stickiness = terrain.stickinessAt(state.x, state.z);
  const friction =
    muG +
    stickiness * (CRUD_LINEAR * state.speed + CRUD_QUAD * state.speed * state.speed) +
    DRAG * (1 - TUCK_DRAG_CUT * tuck) * state.speed * state.speed;
  const thrust = boosting ? BOOST_ACCEL : 0;
  state.speed = Math.max(0, state.speed + (slopeAccel + thrust - friction) * dt);

  // Crawling with the slope not clearly beating friction: pivot toward the
  // fall line so no state is ever a dead end (e.g. stalled facing up a wall).
  // The margin must exceed static friction or the pivot parks one degree
  // short of moving. Crud is viscous — zero force at rest — so it never
  // enters the static picture.
  if (state.speed < 1 && slopeAccel < muG + 0.5) {
    const fallLine = Math.atan2(-gx, gz);
    const diff = Math.atan2(Math.sin(fallLine - state.heading), Math.cos(fallLine - state.heading));
    const step = FALL_LINE_RATE * dt;
    state.heading += Math.max(-step, Math.min(step, diff));
  }

  state.x += dirX * state.speed * dt;
  state.z += dirZ * state.speed * dt;
  bounceOffBounds(state, terrain);

  // Contact by leg reach, not super-g glue: the body is ballistic, and the
  // legs bridge daylight up to LEG_REACH before the air is real. The gap
  // integrates true ballistic separation; concave ground closes it again
  // (the suspension re-compressing — a non-event, no flutter, no landing).
  // Nothing here ever pulls the skier down harder than gravity.
  const ground = terrain.height(state.x, state.z);
  const followVy = (ground - state.y) / dt;
  const ballisticVy = state.vy - G * dt;
  if (state.gap > 0 || ballisticVy > followVy) {
    if (state.gap === 0) {
      // Moment of separation. The glued vy is a kinematic constraint, not
      // paid-for momentum: riding up a steep bank it can dwarf anything the
      // skier's kinetic energy could produce (the moon-shot bug). Leaving
      // the ground repartitions velocity, never adds it.
      const vyLaunch = Math.min(ballisticVy, state.speed * LAUNCH_MAX_VY_RATIO);
      if (vyLaunch > 0) {
        const scale = state.speed / Math.hypot(state.speed, vyLaunch);
        state.speed *= scale;
        state.vy = vyLaunch * scale;
      } else {
        state.vy = ballisticVy;
      }
    } else {
      state.vy = ballisticVy;
    }
    state.gap += (state.vy - followVy) * dt;
    if (state.gap >= LEG_REACH) {
      // Legs at full stretch: the air is real, and the body was truly up
      // here all along.
      state.y = ground + state.gap;
      state.gap = 0;
      state.airTime = dt;
      return;
    }
    if (state.gap <= 0) {
      // The ground came back up to meet the skis: suspension absorbed it.
      state.gap = 0;
      state.vy = followVy;
    }
    state.y = ground;
  } else {
    state.gap = 0;
    state.y = ground;
    state.vy = followVy;
  }

  // A released jump charge pops the skier, as an impulse on top of the
  // current velocity. No airTime is granted here: the leg band decides —
  // a small pop's gap gets reabsorbed without ever counting as air, and a
  // real pop blows through LEG_REACH within a few steps.
  const jump = input.jump ?? 0;
  if (jump > 0) {
    state.vy += JUMP_POP_MAX * Math.sqrt(jump);
  }

  collideObstacles(state, terrain);
}
