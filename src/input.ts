import { SkierInput } from './sim/skier';
import {
  THUMB_ZONE,
  tiltAxes,
  tiltDeviation,
  toScreen,
  trickFromDrag,
  upFromOrientation,
  Vec3,
} from './tilt';

// Analog axis from a pointer coordinate: a small dead zone around the viewport
// center, then a linear ramp that saturates at SATURATION of the half-extent,
// so full deflection doesn't require reaching the screen edge.
const DEAD_ZONE = 0.06;
const SATURATION = 0.55;

export function pointerAxis(clientPos: number, viewportExtent: number): number {
  if (viewportExtent <= 0) return 0; // degenerate viewport = no deflection, not NaN
  const half = viewportExtent / 2;
  const raw = (clientPos - half) / (half * SATURATION);
  const magnitude = Math.abs(raw);
  if (magnitude < DEAD_ZONE) return 0;
  return Math.sign(raw) * Math.min((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
}

export interface InputSource {
  read: () => SkierInput; // consumes one-shot events (jump); sim stepping only
  peek: () => SkierInput; // current state, safe to call from anywhere
  acted: () => boolean; // has a real (trusted) user input landed this run?
  resetActed: () => void; // a fresh run must earn its "played" flag again
  setTiltMode: (on: boolean) => void; // phone-as-mouse: tilt steers, thumbs work
  calibrateTilt: () => void; // current attitude becomes neutral (on unpause)
  tiltDeviation: () => number; // radians off the calibrated attitude (envelope)
}

// Mouse: x steers, y sets stance (top = tuck, bottom = snowplow), held button
// is full snowplow — the mouse owns braking. Touch: first finger works like
// the mouse position, a second finger is full snowplow. Keyboard steering and
// stance still work and win while held. R starts a fresh run.
//
// Jump: hold Space (or Shift / right mouse) to charge, release to pop. The
// input layer only reports held/released — the SIM owns the charge meter
// (sim-time and deterministic; see sim.ts CHARGE_FULL_S).
export function setupInput(onRestart: () => void): InputSource {
  const down = new Set<string>();
  const touches = new Map<number, { x: number; y: number }>(); // non-mouse pointers
  let mouse: { x: number; y: number } | null = null; // last known cursor position
  let mouseBrake = false;

  // Tilt mode: the phone IS the mouse. World-up is tracked in screen
  // coordinates; the attitude at unpause is calibrated as neutral. Thumbs
  // take over the buttons — left half is the trick pad, right half is
  // boost/charge — replacing the legacy touch scheme entirely.
  let tiltMode = false;
  let tiltUp: Vec3 | null = null; // latest attitude, screen frame
  let tiltRef: Vec3 | null = null; // calibrated neutral
  let tiltCalibratePending = false; // unpaused before the first event arrived
  let trickPad: { id: number; x0: number; y0: number; spin: number; flip: number } | null = null;
  let chargeTouch: number | null = null;

  window.addEventListener('deviceorientation', (e) => {
    if (e.beta === null || e.gamma === null) return;
    tiltUp = toScreen(upFromOrientation(e.beta, e.gamma), screen.orientation?.angle ?? 0);
    if (tiltCalibratePending) {
      tiltRef = tiltUp;
      tiltCalibratePending = false;
    }
    // Tilt steering counts as playing (a tilt-only run must be able to set
    // a BEST) — but only real movement off neutral: a phone lying on a
    // table streams events too, and that's the idle self-play the acted
    // flag exists to reject.
    if (e.isTrusted && tiltMode && tiltRef && tiltDeviation(tiltUp, tiltRef) > 0.05) acted = true;
  });

  // A run only counts as PLAYED once a real user input lands: an idle tab
  // self-piloting downhill (or a debug script poking the sim) must never
  // set a persistent best score. isTrusted separates real gestures from
  // synthetic events; R resets the flag along with the run.
  let acted = false;
  const noteActivity = (e: Event) => {
    if (e.isTrusted) acted = true;
  };
  window.addEventListener('pointermove', noteActivity);
  window.addEventListener('pointerdown', noteActivity);

  // Right mouse button is boost+charge; keep the context menu out of the way.
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  let holding = false;
  let pendingJump = false; // a release happened; the sim spends its charge

  const beginCharge = () => {
    holding = true;
  };
  const releaseCharge = () => {
    if (!holding) return;
    holding = false;
    pendingJump = true;
  };

  // SSX-style single button: holding burns boost AND preloads the jump;
  // releasing pops. Space, Shift, and the right mouse button all are it.
  const isBoostKey = (code: string) =>
    code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight';

  window.addEventListener('keydown', (e) => {
    // R asks to restart (the game layer confirms and calls resetActed when
    // it actually happens); it doesn't count as playing the run.
    if (e.code === 'KeyR') onRestart();
    else noteActivity(e);
    if (isBoostKey(e.code)) beginCharge();
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    if (isBoostKey(e.code)) releaseCharge();
    down.delete(e.code);
  });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 2) beginCharge();
      else mouseBrake = true;
    } else if (tiltMode) {
      // Thumb zones: the right edge of the screen is the boost/charge
      // button, the left edge is the trick pad (an invisible joystick from
      // the touch-down point). The middle band is nothing here — main
      // treats a center tap as the pause button.
      if (e.clientX > window.innerWidth * (1 - THUMB_ZONE)) {
        if (chargeTouch === null) {
          chargeTouch = e.pointerId;
          beginCharge();
        }
      } else if (e.clientX < window.innerWidth * THUMB_ZONE && !trickPad) {
        trickPad = { id: e.pointerId, x0: e.clientX, y0: e.clientY, spin: 0, flip: 0 };
      }
    } else {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      mouse = { x: e.clientX, y: e.clientY };
    } else if (trickPad && trickPad.id === e.pointerId) {
      const held = trickFromDrag(e.clientX - trickPad.x0, e.clientY - trickPad.y0);
      trickPad.spin = held.spin;
      trickPad.flip = held.flip;
    } else if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  });
  const release = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 2) releaseCharge();
      else mouseBrake = false;
    } else {
      if (chargeTouch === e.pointerId) {
        chargeTouch = null;
        releaseCharge();
      }
      if (trickPad && trickPad.id === e.pointerId) trickPad = null;
      touches.delete(e.pointerId);
    }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  const current = (): SkierInput => {
    const key = (...codes: string[]) => codes.some((c) => down.has(c));

    // The mouse is required and NEVER changes meaning: x steers, y is stance,
    // buttons brake/boost. WASD exists only for tricks — unambiguous digital
    // keys, active only in real air (the sim gates them).
    const firstTouch = touches.values().next();
    const pointer = !firstTouch.done ? firstTouch.value : mouse;

    let steer: number;
    let stance: number;
    if (tiltMode && tiltUp && tiltRef) {
      const axes = tiltAxes(tiltUp, tiltRef);
      steer = axes.steer;
      stance = axes.stance;
    } else {
      steer = pointer ? pointerAxis(pointer.x, window.innerWidth) : 0;
      stance =
        mouseBrake || touches.size >= 2
          ? 1
          : pointer
            ? pointerAxis(pointer.y, window.innerHeight)
            : 0;
    }
    const trickSpin = (trickPad?.spin || 0) + (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0);
    // Push forward to flip forward: W = frontflip, S (pull back) = backflip.
    const trickFlip = (trickPad?.flip || 0) + (key('KeyS') ? 1 : 0) - (key('KeyW') ? 1 : 0);
    return { steer, stance, boost: holding, trickSpin, trickFlip };
  };

  return {
    peek: current,
    acted: () => acted,
    resetActed: () => {
      acted = false;
    },
    setTiltMode: (on: boolean) => {
      tiltMode = on;
    },
    calibrateTilt: () => {
      if (tiltUp) tiltRef = tiltUp;
      else tiltCalibratePending = true; // permission granted, no event yet
    },
    tiltDeviation: () => (tiltMode && tiltUp && tiltRef ? tiltDeviation(tiltUp, tiltRef) : 0),
    read: () => {
      const input = current();
      if (pendingJump) {
        input.jump = 1; // a release signal; the sim supplies the magnitude
        pendingJump = false;
      }
      return input;
    },
  };
}
