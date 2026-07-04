import { Terrain, WALL_WIDTH } from './terrain';

export interface SkierInput {
  steer: number; // -1 (left) .. 1 (right); the mouse, always
  stance: number; // -1 (full tuck) .. 0 (neutral) .. 1 (full snowplow); the mouse, always
  jump?: number; // one-shot: 0..1 charge strength released this step
  charge?: number; // 0..1 jump charge currently held; render feedback only
  boost?: boolean; // burn the tank (Shift / right mouse)
  trickSpin?: number; // -1..1 from the dedicated trick keys (A/D)
  trickFlip?: number; // -1..1 from the trick keys: W = -1 = frontflip (nose
  // over), S = +1 = backflip (nose up) — push forward to flip forward
}

export interface SkierState {
  x: number;
  z: number;
  y: number; // world height; equals terrain height while grounded
  vy: number; // vertical velocity; terrain-following while grounded
  heading: number; // radians; 0 = straight downhill (-z), positive = toward +x
  speed: number; // horizontal m/s along the heading
  airTime: number; // seconds airborne this jump; 0 = grounded
  tumbling: number; // seconds of tumble remaining; 0 = on skis
  spin: number; // trick yaw accumulated this flight (radians)
  flip: number; // trick pitch accumulated this flight (radians)
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
// relative to the course direction (center = follow the track), and the
// heading eases toward it. Rate control (cursor = rotation speed) integrates
// small errors into wild weaving — pilot-induced oscillation.
const MAX_STEER_OFFSET = 1.15; // radians of target offset at full deflection
const STEER_GAIN = 4; // per second: how eagerly heading chases the target
const TURN_RATE = 2.6; // rad/s ceiling on heading change
export const SKIER_RADIUS = 0.4;

// Don't go airborne over every pebble: the terrain has to fall away from the
// ballistic path by this much extra downward acceleration (m/s^2, on top of
// gravity) before ground contact breaks. Compared per-step, scaled by dt.
const LAUNCH_EXTRA_ACCEL = 6;
// Steepest launch the track's built features can produce (kicker lips are
// ~0.31). Terrain steeper than this sheds the skier instead of ramping them:
// banks are walls, not vert ramps.
const LAUNCH_MAX_VY_RATIO = 0.35;
// Jump: a released charge pops the skier off the snow. Deliberately modest —
// a hop for line adjustments and a little extra off a lip; real air comes
// from the terrain (and, later, purpose-built ski jumps).
const JUMP_POP_MIN = 1.8;
const JUMP_POP_MAX = 3.8;
// Invisible outer barrier where the bank steepens past ~55 degrees: hitting
// it caroms you back into the course (grounded or flying). Banks up to there
// are rideable; the near-vertical zone beyond is a wall, not a vert ramp.
// Offset from the (variable) floor edge, so it breathes with the course.
const BOUNCE_MARGIN = WALL_WIDTH - 2;
const BOUNCE_DAMP = 0.7;
// A skier crawling uphill-facing pivots toward the fall line instead of
// being stranded at zero speed forever.
const FALL_LINE_RATE = 1.6;

// Punishment is light by design: a tree hit costs most of your speed and a
// moment of comedy, never the run.
const TUMBLE_TIME = 1.3; // seconds without control after a hit
const TUMBLE_SPEED_KEEP = 0.25;
const TUMBLE_FRICTION = 0.35;
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
export const TRICK_COMMIT = 3.3; // radians of spin (~half-turn) before you must complete
export const FLIP_COMMIT = 1.2; // radians of flip (~70 deg) before you must complete
export const SPIN_TOLERANCE = 0.7; // radians from a whole turn to land clean
export const FLIP_TOLERANCE = 0.55;

export function createSkier(): SkierState {
  return {
    x: 0,
    z: 0,
    y: 0,
    vy: 0,
    heading: 0,
    speed: 0,
    airTime: 0,
    tumbling: 0,
    spin: 0,
    flip: 0,
  };
}

// How far a rotation is from "clean" (any whole number of full turns).
function residual(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Ease the heading toward the steering target: proportional, rate-limited,
// no overshoot. Self-centering — steer 0 means "follow the course". A skier
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
    terrain.trackHeading(state.z) +
    input.steer * MAX_STEER_OFFSET * (1 - TUCK_TURN_CUT * tuck) +
    recovery;
  const diff = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
  const rate = Math.max(-maxRate, Math.min(maxRate, STEER_GAIN * diff));
  state.heading += rate * dt;
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
    state.tumbling = TUMBLE_TIME;
    state.speed *= TUMBLE_SPEED_KEEP;
    state.airTime = 0;
    const perpX = Math.cos(state.heading);
    const perpZ = Math.sin(state.heading);
    const side = perpX * -dx + perpZ * -dz >= 0 ? 1 : -1;
    state.x = obstacle.x + perpX * side * (r + 0.05);
    state.z = obstacle.z + perpZ * side * (r + 0.05);
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
    steerToward(state, terrain, input, TURN_RATE * AIR_TURN_FACTOR, dt);
    if (state.airTime > MIN_TRICK_AIR) {
      const spinInput = input.trickSpin ?? 0;
      const flipInput = input.trickFlip ?? 0; // positive = backflip (S)
      const flipRate = flipInput > 0 ? BACKFLIP_RATE : FRONTFLIP_RATE;
      // Combo sync: spinning WHILE flipping slows the spin to the flip's
      // rate, so both rotations complete in lockstep and can land together.
      const spinRate = flipInput !== 0 ? flipRate : SPIN_RATE;
      state.spin += spinRate * spinInput * dt;
      state.flip += flipRate * flipInput * dt;
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

      // The landing judges COMMITTED rotation per axis: past the commit
      // threshold you must arrive within tolerance of whole turns or wipe
      // out. Anything under commit always lands clean.
      const blownSpin =
        Math.abs(state.spin) > TRICK_COMMIT && Math.abs(residual(state.spin)) > SPIN_TOLERANCE;
      const blownFlip =
        Math.abs(state.flip) > FLIP_COMMIT && Math.abs(residual(state.flip)) > FLIP_TOLERANCE;
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
  // stationary); a tuck narrows the target range inside steerToward.
  steerToward(state, terrain, input, TURN_RATE * Math.min(state.speed / 4, 1), dt);

  const dirX = Math.sin(state.heading);
  const dirZ = -Math.cos(state.heading);

  // Gravity component along the direction of travel, minus snow friction and
  // air drag. Friction can stop the skier but never pushes them backwards.
  // Snowplow scales friction up; tuck cuts drag.
  const [gx, gz] = terrain.gradient(state.x, state.z);
  const slopeAccel = -G * (gx * dirX + gz * dirZ);
  const muG = (FRICTION + plow * (PLOW_FRICTION - FRICTION)) * G;
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

  // Stick to the terrain unless it falls away meaningfully faster than
  // gravity can pull us down from the current vertical velocity — then we're
  // airborne. The threshold keeps small bumps from popping the skier off the
  // snow; real crests and jumps clear it easily.
  const ground = terrain.height(state.x, state.z);
  const followVy = (ground - state.y) / dt;
  const ballisticVy = state.vy - G * dt;
  if (followVy < ballisticVy - LAUNCH_EXTRA_ACCEL * dt) {
    // The glued vy is a kinematic constraint, not paid-for momentum: riding
    // up a steep bank it can dwarf anything the skier's kinetic energy could
    // produce, and inheriting it raw launched skiers 100m over the course.
    // Leaving the ground repartitions velocity, never adds it: the upward
    // component is limited to the steepest built feature's envelope, and the
    // total magnitude is capped at the pre-launch speed.
    const vyLaunch = Math.min(ballisticVy, state.speed * LAUNCH_MAX_VY_RATIO);
    if (vyLaunch > 0) {
      const scale = state.speed / Math.hypot(state.speed, vyLaunch);
      state.speed *= scale;
      state.vy = vyLaunch * scale;
    } else {
      state.vy = ballisticVy;
    }
    state.y += state.vy * dt;
    state.airTime = dt;
    return;
  }
  state.y = ground;
  state.vy = followVy;

  // A released jump charge pops the skier off the snow.
  const jump = input.jump ?? 0;
  if (jump > 0) {
    state.vy = Math.max(state.vy, 0) + JUMP_POP_MIN + (JUMP_POP_MAX - JUMP_POP_MIN) * jump;
    state.y += state.vy * dt;
    state.airTime = dt;
    return;
  }

  collideObstacles(state, terrain);
}
