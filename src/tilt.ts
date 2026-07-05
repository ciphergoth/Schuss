// Tilt controls: the phone IS the mouse. Roll (steering-wheel twist) is
// steer, pitch (top edge away/toward you) is stance, and the attitude the
// phone is held at when the game unpauses becomes neutral — hold it however
// you like, and re-unpause to recalibrate.
//
// Everything works off the GRAVITY DIRECTION in screen coordinates, never
// raw Euler yaw: turning your chair doesn't steer, the compass can't drift
// into the controls, and landscape has no gimbal trouble. All functions are
// pure — nobody can tilt a phone in CI, so the math carries the tests.
//
// Device-feel constants, in one place for tuning on real hardware:
const DEG = Math.PI / 180;
export const STEER_RANGE = 28 * DEG; // roll for full deflection
export const PITCH_RANGE = 20 * DEG; // pitch for full tuck/brake
export const TILT_DEAD_ZONE = 0.08; // fraction of range around neutral
export const EDGE_START = 35 * DEG; // beyond this, the warning sound rises
export const FAR_TILT = 60 * DEG; // beyond this (sustained), the game pauses
export const FAR_HOLD_S = 0.4; // how long "far" must persist to pause

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// World-up expressed in DEVICE coordinates from deviceorientation's beta
// (x rotation) and gamma (y rotation). Alpha (yaw) cancels out of gravity.
export function upFromOrientation(betaDeg: number, gammaDeg: number): Vec3 {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  return {
    x: -Math.cos(b) * Math.sin(g),
    y: Math.sin(b),
    z: Math.cos(b) * Math.cos(g),
  };
}

// Rotate a device-frame vector into SCREEN coordinates (x right, y toward
// the top edge as currently displayed, z out of the screen) given the
// screen orientation angle (0 / 90 / 180 / 270).
export function toScreen(v: Vec3, screenAngleDeg: number): Vec3 {
  const a = screenAngleDeg * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: v.x * cos + v.y * sin, y: v.y * cos - v.x * sin, z: v.z };
}

// Roll: how far up leans out of the screen's vertical plane (the
// steering-wheel angle, valid at any pitch). Pitch: where up sits in the
// screen's y-z plane (top edge toward/away from you).
function rollOf(up: Vec3): number {
  return Math.asin(Math.max(-1, Math.min(1, up.x)));
}

function pitchOf(up: Vec3): number {
  return Math.atan2(up.y, up.z);
}

// Dead zone + saturation, in the exact style of pointerAxis.
function axis(delta: number, range: number): number {
  const raw = delta / range;
  const magnitude = Math.abs(raw);
  if (magnitude < TILT_DEAD_ZONE) return 0;
  return Math.sign(raw) * Math.min((magnitude - TILT_DEAD_ZONE) / (1 - TILT_DEAD_ZONE), 1);
}

// Steer and stance relative to the calibrated attitude. Rolling the right
// edge down steers right; tipping the top edge away is tuck (stance -1),
// pulling it toward you is brake.
export function tiltAxes(up: Vec3, ref: Vec3): { steer: number; stance: number } {
  const steer = axis(-(rollOf(up) - rollOf(ref)), STEER_RANGE);
  const stance = axis(pitchOf(up) - pitchOf(ref), PITCH_RANGE);
  return { steer, stance };
}

// Total angular deviation from the calibrated attitude, radians.
export function tiltDeviation(up: Vec3, ref: Vec3): number {
  const dot = up.x * ref.x + up.y * ref.y + up.z * ref.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

// The envelope: in it, controls; at its edge, the warning sings; far past
// it (held for FAR_HOLD_S), the game pauses — putting the phone down IS
// the pause gesture.
export function tiltZone(deviation: number): { zone: 'in' | 'edge' | 'far'; edgeLevel: number } {
  if (deviation >= FAR_TILT) return { zone: 'far', edgeLevel: 1 };
  if (deviation <= EDGE_START) return { zone: 'in', edgeLevel: 0 };
  return { zone: 'edge', edgeLevel: (deviation - EDGE_START) / (FAR_TILT - EDGE_START) };
}

// The left thumb's invisible joystick: drag direction from the touch-down
// point, held, maps to the trick keys. Up = frontflip (W = -1), down =
// backflip (S = +1), left/right = spin (A/D). Screen y grows downward.
export const TRICK_DRAG_PX = 24;

export function trickFromDrag(dx: number, dy: number): { spin: number; flip: number } {
  if (Math.hypot(dx, dy) < TRICK_DRAG_PX) return { spin: 0, flip: 0 };
  if (Math.abs(dx) > Math.abs(dy)) return { spin: Math.sign(dx), flip: 0 };
  return { spin: 0, flip: Math.sign(dy) };
}
