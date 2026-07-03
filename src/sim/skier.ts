import { CHANNEL_HALF_WIDTH, Terrain, WALL_WIDTH } from './terrain';

export interface SkierInput {
  steer: number; // -1 (left) .. 1 (right)
  stance: number; // -1 (full tuck) .. 0 (neutral) .. 1 (full snowplow)
  jump?: number; // one-shot: 0..1 charge strength released this step
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
}

const G = 9.81;
const FRICTION = 0.05; // neutral-stance snow friction coefficient
const PLOW_FRICTION = 0.6; // at full snowplow
const DRAG = 0.0035; // neutral quadratic air drag; top speed around 29 m/s
const TUCK_DRAG_CUT = 0.5; // full tuck halves drag: top speed around 41 m/s
const TUCK_TURN_CUT = 0.4; // full tuck costs 40% of turn authority
const TURN_RATE = 2.6; // rad/s at full turning authority
export const SKIER_RADIUS = 0.4;

// Don't go airborne over every pebble: the terrain has to fall away from the
// ballistic path by this much extra downward acceleration (m/s^2, on top of
// gravity) before ground contact breaks. Compared per-step, scaled by dt.
const LAUNCH_EXTRA_ACCEL = 6;
// Jump: released brake charge pops the skier off the snow.
const JUMP_POP_MIN = 3.2;
const JUMP_POP_MAX = 6.6;
// Invisible outer barrier just past the rideable wall: hitting it caroms you
// back into the course (grounded or flying) instead of onto the endless
// mathematical super-wall outside the ribbon.
const BOUNCE_LIMIT = CHANNEL_HALF_WIDTH + WALL_WIDTH + 2;
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

export function createSkier(): SkierState {
  return { x: 0, z: 0, y: 0, vy: 0, heading: 0, speed: 0, airTime: 0, tumbling: 0 };
}

// Carom off the invisible barrier just outside the rideable walls: clamp back
// to the limit and reflect the heading across the local track direction.
function bounceOffBounds(state: SkierState, terrain: Terrain): void {
  const center = terrain.centerX(state.z);
  const d = state.x - center;
  if (Math.abs(d) <= BOUNCE_LIMIT) return;
  state.x = center + Math.sign(d) * BOUNCE_LIMIT;
  const trackHeading = Math.atan2(terrain.centerX(state.z - 1) - terrain.centerX(state.z + 1), 2);
  const diff = state.heading - trackHeading;
  state.heading = trackHeading - Math.atan2(Math.sin(diff), Math.cos(diff));
  state.speed *= BOUNCE_DAMP;
}

export function stepSkier(
  state: SkierState,
  terrain: Terrain,
  input: SkierInput,
  dt: number,
  flowBoost: number // 0..1; earned flow cuts drag, so skiing well is fast
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
    state.y = terrain.height(state.x, state.z);
    state.vy = 0;
    return;
  }

  if (state.airTime > 0) {
    // Ballistic: no friction, gravity on vy, a sliver of air steering.
    // No obstacle collisions — clearing one in flight is earned.
    state.heading += TURN_RATE * AIR_TURN_FACTOR * input.steer * dt;
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += -Math.cos(state.heading) * state.speed * dt;
    bounceOffBounds(state, terrain);
    state.vy -= G * dt;
    state.y += state.vy * dt;
    state.airTime += dt;
    const ground = terrain.height(state.x, state.z);
    if (state.y <= ground) {
      state.y = ground;
      state.vy = 0;
      state.airTime = 0;
    }
    return;
  }

  const plow = Math.max(0, input.stance);
  const tuck = Math.max(0, -input.stance);

  // Turning authority ramps up with speed (skis can't pivot while stationary)
  // and drops in a tuck (speed is a trade against control).
  const turnFactor = Math.min(state.speed / 4, 1) * (1 - TUCK_TURN_CUT * tuck);
  state.heading += TURN_RATE * turnFactor * input.steer * dt;

  const dirX = Math.sin(state.heading);
  const dirZ = -Math.cos(state.heading);

  // Gravity component along the direction of travel, minus snow friction and
  // air drag. Friction can stop the skier but never pushes them backwards.
  // Snowplow scales friction up; tuck cuts drag.
  const [gx, gz] = terrain.gradient(state.x, state.z);
  const slopeAccel = -G * (gx * dirX + gz * dirZ);
  const friction =
    (FRICTION + plow * (PLOW_FRICTION - FRICTION)) * G +
    DRAG * (1 - TUCK_DRAG_CUT * tuck) * (1 - 0.3 * flowBoost) * state.speed * state.speed;
  state.speed = Math.max(0, state.speed + (slopeAccel - friction) * dt);

  // Crawling with the slope not clearly beating friction: pivot toward the
  // fall line so no state is ever a dead end (e.g. stalled facing up a wall).
  // The margin must exceed static friction or the pivot parks one degree
  // short of moving and the deadlock survives, just rotated.
  if (state.speed < 1 && slopeAccel < FRICTION * G + 0.5) {
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
    state.vy = ballisticVy;
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

  for (const obstacle of terrain.obstaclesNear(state.z)) {
    const dx = obstacle.x - state.x;
    const dz = obstacle.z - state.z;
    const r = obstacle.radius + SKIER_RADIUS;
    if (dx * dx + dz * dz < r * r) {
      state.tumbling = TUMBLE_TIME;
      state.speed *= TUMBLE_SPEED_KEEP;
      // Carom sideways off the obstacle: place the skier beside it,
      // perpendicular to their heading, so the tumble slides past instead
      // of through. Pick the side the skier was already favoring.
      const perpX = Math.cos(state.heading);
      const perpZ = Math.sin(state.heading);
      const side = perpX * -dx + perpZ * -dz >= 0 ? 1 : -1;
      state.x = obstacle.x + perpX * side * (r + 0.05);
      state.z = obstacle.z + perpZ * side * (r + 0.05);
      return;
    }
  }
}
