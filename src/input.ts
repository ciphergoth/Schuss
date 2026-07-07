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

// A snapshot for the ?debug on-device readout: is the sensor streaming, is
// touch landing, and what does that produce.
export interface InputDebug {
  tiltEvents: number; // valid orientation readings so far (a heartbeat)
  lastBeta: number | null;
  lastGamma: number | null;
  hasReading: boolean; // a reading has landed (tiltUp set)
  hasRef: boolean; // calibrated (tiltRef set)
  tiltMode: boolean;
  pointerEvents: number; // pointer events reaching the window (another heartbeat)
  steer: number;
  stance: number;
}

export interface InputSource {
  read: () => SkierInput; // consumes one-shot events (jump); sim stepping only
  peek: () => SkierInput; // current state, safe to call from anywhere
  acted: () => boolean; // has a real (trusted) user input landed this run?
  resetActed: () => void; // a fresh run must earn its "played" flag again
  setTiltMode: (on: boolean) => void; // phone-as-mouse: tilt steers, thumbs work
  startTiltListening: () => void; // bind deviceorientation (call in the grant gesture)
  waitForTilt: (timeoutMs: number) => Promise<boolean>; // resolves once a real reading lands
  debugSnapshot: () => InputDebug; // live input state for the ?debug readout
  calibrateTilt: () => void; // current attitude becomes neutral (on unpause)
  tiltDeviation: () => number; // radians off the calibrated attitude (envelope)
}

// Mouse: x steers, y sets stance (top = tuck, bottom = snowplow) — the y axis
// owns braking. Any mouse button is boost/charge (same as Space). On a phone
// the tilt IS the mouse and the thumbs are the buttons; there is NO
// finger-steering fallback, so a non-mouse pointer does nothing until tilt
// mode is live. R starts a fresh run.
//
// Jump: hold Space (or Shift / any mouse button) to charge, release to pop. The
// input layer only reports held/released — the SIM owns the charge meter
// (sim-time and deterministic; see sim.ts CHARGE_FULL_S).
export function setupInput(): InputSource {
  const down = new Set<string>();
  let mouse: { x: number; y: number } | null = null; // last known cursor position

  // Tilt mode: the phone IS the mouse. World-up is tracked in screen
  // coordinates; the attitude at unpause is calibrated as neutral. Thumbs
  // take over the buttons — left half is the trick pad, right half is
  // boost/charge — the only touch control scheme (no finger-steering).
  let tiltMode = false;
  let tiltUp: Vec3 | null = null; // latest attitude, screen frame
  let tiltRef: Vec3 | null = null; // calibrated neutral
  let tiltCalibratePending = false; // unpaused before the first event arrived
  let trickPad: { id: number; x0: number; y0: number; spin: number; flip: number } | null = null;
  let chargeTouch: number | null = null;

  // The orientation listener is added at GRANT time (startTiltListening),
  // not here: iOS is markedly more reliable when deviceorientation is bound
  // in the same user gesture as requestPermission. Bound at page load it
  // sometimes never fires at all — the silent dead-tilt run.
  let orientationBound = false;
  let tiltReadyWaiters: Array<() => void> = [];
  let tiltEvents = 0; // a heartbeat: bumps on every valid reading (see waitForTilt / the liveness watchdog)
  let lastBeta: number | null = null; // raw sensor values, for the ?debug readout
  let lastGamma: number | null = null;
  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    tiltEvents++;
    lastBeta = e.beta;
    lastGamma = e.gamma;
    tiltUp = toScreen(upFromOrientation(e.beta, e.gamma), screen.orientation?.angle ?? 0);
    if (tiltCalibratePending) {
      tiltRef = tiltUp;
      tiltCalibratePending = false;
    }
    // First real reading: wake anyone waiting on it (the drop-in blocks
    // until the sensor is actually streaming, so a stalled sensor can't
    // strand the player in an unsteerable run).
    if (tiltReadyWaiters.length) {
      const waiters = tiltReadyWaiters;
      tiltReadyWaiters = [];
      for (const w of waiters) w();
    }
    // Tilt steering counts as playing (a tilt-only run must be able to set
    // a BEST) — but only real movement off neutral: a phone lying on a
    // table streams events too, and that's the idle self-play the acted
    // flag exists to reject.
    if (e.isTrusted && tiltMode && tiltRef && tiltDeviation(tiltUp, tiltRef) > 0.05) acted = true;
  };

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

  // A raw pointer tally for the ?debug readout: counts every pointer event
  // reaching the window in the CAPTURE phase, so nothing downstream (a
  // panel's stopPropagation) can hide it. A frozen tally while you tap means
  // touches stopped reaching the page — the wedge, caught in the act.
  let pointerEvents = 0;
  const countPointer = () => pointerEvents++;
  window.addEventListener('pointerdown', countPointer, true);
  window.addEventListener('pointermove', countPointer, true);

  // Mouse buttons are boost+charge; keep the right-click context menu out of the way.
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
  // releasing pops. Space, Shift, and any mouse button all are it.
  const isBoostKey = (code: string) =>
    code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight';

  window.addEventListener('keydown', (e) => {
    noteActivity(e);
    if (isBoostKey(e.code)) beginCharge();
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    if (isBoostKey(e.code)) releaseCharge();
    down.delete(e.code);
  });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      beginCharge(); // any mouse button is boost/charge (Space); the y axis owns braking
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
    }
    // A non-mouse pointer before tilt is live does nothing: the phone can't
    // steer without motion access, so there is no finger-steering fallback.
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      mouse = { x: e.clientX, y: e.clientY };
    } else if (trickPad && trickPad.id === e.pointerId) {
      const held = trickFromDrag(e.clientX - trickPad.x0, e.clientY - trickPad.y0);
      trickPad.spin = held.spin;
      trickPad.flip = held.flip;
    }
  });
  const release = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      releaseCharge();
    } else {
      if (chargeTouch === e.pointerId) {
        chargeTouch = null;
        releaseCharge();
      }
      if (trickPad && trickPad.id === e.pointerId) trickPad = null;
    }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  const current = (): SkierInput => {
    const key = (...codes: string[]) => codes.some((c) => down.has(c));

    // The mouse is required and NEVER changes meaning: x steers, y is stance,
    // buttons boost. On a phone the tilt replaces it. WASD exists only
    // for tricks — unambiguous digital keys, active only in real air (the sim
    // gates them).
    let steer: number;
    let stance: number;
    if (tiltMode && tiltUp && tiltRef) {
      const axes = tiltAxes(tiltUp, tiltRef);
      steer = axes.steer;
      stance = axes.stance;
    } else {
      steer = mouse ? pointerAxis(mouse.x, window.innerWidth) : 0;
      stance = mouse ? pointerAxis(mouse.y, window.innerHeight) : 0;
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
    startTiltListening: () => {
      if (orientationBound) return;
      orientationBound = true;
      window.addEventListener('deviceorientation', onOrientation);
    },
    waitForTilt: (timeoutMs: number) =>
      new Promise<boolean>((resolve) => {
        if (tiltUp) return resolve(true); // sensor already streaming
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };
        tiltReadyWaiters.push(() => done(true));
        setTimeout(() => done(false), timeoutMs);
      }),
    debugSnapshot: () => {
      const c = current();
      return {
        tiltEvents,
        lastBeta,
        lastGamma,
        hasReading: tiltUp !== null,
        hasRef: tiltRef !== null,
        tiltMode,
        pointerEvents,
        steer: c.steer,
        stance: c.stance,
      };
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
