import { Terrain } from './terrain';

export interface SkierInput {
  steer: number; // -1 (left) .. 1 (right)
  brake: boolean;
}

export interface SkierState {
  x: number;
  z: number;
  heading: number; // radians; 0 = straight downhill (-z), positive = toward +x
  speed: number; // m/s along the heading
  crashed: boolean;
}

const G = 9.81;
const FRICTION = 0.05; // rolling snow friction coefficient
const BRAKE_FRICTION = 0.6;
const DRAG = 0.0035; // quadratic air drag; sets top speed around 29 m/s
const TURN_RATE = 1.6; // rad/s at full turning authority
export const SKIER_RADIUS = 0.4;

export function createSkier(): SkierState {
  return { x: 0, z: 0, heading: 0, speed: 0, crashed: false };
}

export function stepSkier(
  state: SkierState,
  terrain: Terrain,
  input: SkierInput,
  dt: number
): void {
  if (state.crashed) return;

  // Turning authority ramps up with speed: skis can't pivot while stationary.
  const turnFactor = Math.min(state.speed / 4, 1);
  state.heading += TURN_RATE * turnFactor * input.steer * dt;

  const dirX = Math.sin(state.heading);
  const dirZ = -Math.cos(state.heading);

  // Gravity component along the direction of travel, minus snow friction and
  // air drag. Friction can stop the skier but never pushes them backwards.
  const [gx, gz] = terrain.gradient(state.x, state.z);
  const slopeAccel = -G * (gx * dirX + gz * dirZ);
  const friction = (input.brake ? BRAKE_FRICTION : FRICTION) * G + DRAG * state.speed * state.speed;
  state.speed = Math.max(0, state.speed + (slopeAccel - friction) * dt);

  state.x += dirX * state.speed * dt;
  state.z += dirZ * state.speed * dt;

  for (const tree of terrain.treesNear(state.z)) {
    const dx = tree.x - state.x;
    const dz = tree.z - state.z;
    const r = tree.radius + SKIER_RADIUS;
    if (dx * dx + dz * dz < r * r) {
      state.crashed = true;
      state.speed = 0;
      return;
    }
  }
}
