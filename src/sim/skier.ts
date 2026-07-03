import { Terrain } from './terrain';

export interface SkierInput {
  steer: number; // -1 (left) .. 1 (right)
  stance: number; // -1 (full tuck) .. 0 (neutral) .. 1 (full snowplow)
}

export interface SkierState {
  x: number;
  z: number;
  heading: number; // radians; 0 = straight downhill (-z), positive = toward +x
  speed: number; // m/s along the heading
  tumbling: number; // seconds of tumble remaining; 0 = on skis
}

const G = 9.81;
const FRICTION = 0.05; // neutral-stance snow friction coefficient
const PLOW_FRICTION = 0.6; // at full snowplow
const DRAG = 0.0035; // neutral quadratic air drag; top speed around 29 m/s
const TUCK_DRAG_CUT = 0.5; // full tuck halves drag: top speed around 41 m/s
const TUCK_TURN_CUT = 0.4; // full tuck costs 40% of turn authority
const TURN_RATE = 1.6; // rad/s at full turning authority
export const SKIER_RADIUS = 0.4;

// Punishment is light by design: a tree hit costs most of your speed and a
// moment of comedy, never the run.
const TUMBLE_TIME = 1.3; // seconds without control after a hit
const TUMBLE_SPEED_KEEP = 0.25;
const TUMBLE_FRICTION = 0.35;

export function createSkier(): SkierState {
  return { x: 0, z: 0, heading: 0, speed: 0, tumbling: 0 };
}

export function stepSkier(
  state: SkierState,
  terrain: Terrain,
  input: SkierInput,
  dt: number
): void {
  if (state.tumbling > 0) {
    // No control while tumbling: skid straight ahead under heavy friction,
    // then pop back up. Collisions are ignored — you're already down.
    state.tumbling = Math.max(0, state.tumbling - dt);
    state.speed = Math.max(0, state.speed - TUMBLE_FRICTION * G * dt);
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += -Math.cos(state.heading) * state.speed * dt;
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
    DRAG * (1 - TUCK_DRAG_CUT * tuck) * state.speed * state.speed;
  state.speed = Math.max(0, state.speed + (slopeAccel - friction) * dt);

  state.x += dirX * state.speed * dt;
  state.z += dirZ * state.speed * dt;

  for (const tree of terrain.treesNear(state.z)) {
    const dx = tree.x - state.x;
    const dz = tree.z - state.z;
    const r = tree.radius + SKIER_RADIUS;
    if (dx * dx + dz * dz < r * r) {
      state.tumbling = TUMBLE_TIME;
      state.speed *= TUMBLE_SPEED_KEEP;
      // Carom sideways off the trunk: place the skier beside the tree,
      // perpendicular to their heading, so the tumble slides past it instead
      // of through it. Pick the side the skier was already favoring.
      const perpX = Math.cos(state.heading);
      const perpZ = Math.sin(state.heading);
      const side = perpX * -dx + perpZ * -dz >= 0 ? 1 : -1;
      state.x = tree.x + perpX * side * (r + 0.05);
      state.z = tree.z + perpZ * side * (r + 0.05);
      return;
    }
  }
}
