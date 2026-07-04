import { SkierInput } from './sim/skier';

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
}

// Mouse: x steers, y sets stance (top = tuck, bottom = snowplow), held button
// is full snowplow — the mouse owns braking. Touch: first finger works like
// the mouse position, a second finger is full snowplow. Keyboard steering and
// stance still work and win while held. R starts a fresh run.
//
// Jump is its own control: hold Space to charge (the skier crouches), release
// to pop — bigger with a longer hold. No stance side effect.
const MAX_CHARGE_MS = 800;

export function setupInput(onRestart: () => void): InputSource {
  const down = new Set<string>();
  const touches = new Map<number, { x: number; y: number }>(); // non-mouse pointers
  let mouse: { x: number; y: number } | null = null; // last known cursor position
  let mouseBrake = false;

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
  let chargeStart: number | null = null;
  let pendingJump = 0;

  const beginCharge = () => {
    if (chargeStart === null) chargeStart = performance.now();
  };
  const releaseCharge = () => {
    if (chargeStart === null) return;
    pendingJump = Math.max(0.15, Math.min(1, (performance.now() - chargeStart) / MAX_CHARGE_MS));
    chargeStart = null;
  };

  // SSX-style single button: holding burns boost AND preloads the jump;
  // releasing pops. Space, Shift, and the right mouse button all are it.
  const isBoostKey = (code: string) =>
    code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight';

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') {
      onRestart();
      acted = false; // the fresh run must earn its "played" flag again
    } else {
      noteActivity(e);
    }
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
    } else {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      mouse = { x: e.clientX, y: e.clientY };
    } else if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  });
  const release = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 2) releaseCharge();
      else mouseBrake = false;
    } else {
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

    const steer = pointer ? pointerAxis(pointer.x, window.innerWidth) : 0;
    const stance =
      mouseBrake || touches.size >= 2
        ? 1
        : pointer
          ? pointerAxis(pointer.y, window.innerHeight)
          : 0;
    const charge =
      chargeStart === null ? 0 : Math.min(1, (performance.now() - chargeStart) / MAX_CHARGE_MS);
    const trickSpin = (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0);
    // Push forward to flip forward: W = frontflip, S (pull back) = backflip.
    const trickFlip = (key('KeyS') ? 1 : 0) - (key('KeyW') ? 1 : 0);
    return { steer, stance, charge, boost: chargeStart !== null, trickSpin, trickFlip };
  };

  return {
    peek: current,
    acted: () => acted,
    read: () => {
      const input = current();
      if (pendingJump > 0) {
        input.jump = pendingJump;
        pendingJump = 0;
      }
      return input;
    },
  };
}
