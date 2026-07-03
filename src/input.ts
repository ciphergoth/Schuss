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

// Mouse: x steers, y sets stance (top = tuck, bottom = snowplow), held button
// is full snowplow. Touch: first finger does the same, a second finger is full
// snowplow. Keyboard still works and wins while held. R starts a fresh run.
export function setupInput(onRestart: () => void): () => SkierInput {
  const down = new Set<string>();
  const touches = new Map<number, { x: number; y: number }>(); // non-mouse pointers
  let mouse: { x: number; y: number } | null = null; // last known cursor position
  let mouseBrake = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') onRestart();
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') mouseBrake = true;
    else touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      mouse = { x: e.clientX, y: e.clientY };
    } else if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  });
  const release = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') mouseBrake = false;
    else touches.delete(e.pointerId);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  return () => {
    const key = (...codes: string[]) => codes.some((c) => down.has(c));
    const keySteer = (key('ArrowRight', 'KeyD') ? 1 : 0) - (key('ArrowLeft', 'KeyA') ? 1 : 0);
    const keyStance =
      (key('Space', 'ArrowDown', 'KeyS') ? 1 : 0) - (key('ArrowUp', 'KeyW') ? 1 : 0);

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
    return { steer, stance };
  };
}
