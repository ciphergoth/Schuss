import { SkierInput } from './sim/skier';

// Analog axis from a pointer coordinate: a small dead zone around the viewport
// center, then a linear ramp that saturates at SATURATION of the half-extent,
// so full deflection doesn't require reaching the screen edge.
const DEAD_ZONE = 0.06;
const SATURATION = 0.55;

export function pointerAxis(clientPos: number, viewportExtent: number): number {
  const half = viewportExtent / 2;
  const raw = (clientPos - half) / (half * SATURATION);
  const magnitude = Math.abs(raw);
  if (magnitude < DEAD_ZONE) return 0;
  return Math.sign(raw) * Math.min((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
}

export interface InputSource {
  read: () => SkierInput; // consumes one-shot events (jump); sim stepping only
  peek: () => SkierInput; // current state, safe to call from anywhere
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
    if (e.code === 'KeyR') onRestart();
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
    const keySteer = (key('ArrowRight', 'KeyD') ? 1 : 0) - (key('ArrowLeft', 'KeyA') ? 1 : 0);
    const keyStance = (key('ArrowDown', 'KeyS') ? 1 : 0) - (key('ArrowUp', 'KeyW') ? 1 : 0);

    const firstTouch = touches.values().next();
    const pointer = !firstTouch.done ? firstTouch.value : mouse;

    const steer =
      keySteer !== 0 ? keySteer : pointer ? pointerAxis(pointer.x, window.innerWidth) : 0;
    const stance =
      keyStance !== 0
        ? keyStance
        : mouseBrake || touches.size >= 2
          ? 1
          : pointer
            ? pointerAxis(pointer.y, window.innerHeight)
            : 0;
    const charge =
      chargeStart === null ? 0 : Math.min(1, (performance.now() - chargeStart) / MAX_CHARGE_MS);
    return { steer, stance, charge, boost: chargeStart !== null };
  };

  return {
    peek: current,
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
