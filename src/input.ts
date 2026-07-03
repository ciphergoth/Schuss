import { SkierInput } from './sim/skier';

// Analog steering from pointer x: a small dead zone around the screen center,
// then a linear ramp that saturates at SATURATION of the half-viewport width,
// so full carve doesn't require reaching the screen edge.
const DEAD_ZONE = 0.06;
const SATURATION = 0.55;

export function steerFromPointerX(clientX: number, viewportWidth: number): number {
  const half = viewportWidth / 2;
  const raw = (clientX - half) / (half * SATURATION);
  const magnitude = Math.abs(raw);
  if (magnitude < DEAD_ZONE) return 0;
  return Math.sign(raw) * Math.min((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
}

// Mouse: position steers, held button brakes. Touch: first finger steers,
// a second finger brakes. Keyboard still works and wins while held.
// Any pointer press restarts after a wipeout.
export function setupInput(onRestart: () => void, isCrashed: () => boolean): () => SkierInput {
  const down = new Set<string>();
  const touches = new Map<number, number>(); // pointerId -> clientX, non-mouse pointers
  let mouseSteer = 0;
  let mouseActive = false;
  let mouseBrake = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') onRestart();
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));

  window.addEventListener('pointerdown', (e) => {
    if (isCrashed()) {
      onRestart();
      return;
    }
    if (e.pointerType === 'mouse') mouseBrake = true;
    else touches.set(e.pointerId, e.clientX);
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      mouseActive = true;
      mouseSteer = steerFromPointerX(e.clientX, window.innerWidth);
    } else if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, e.clientX);
    }
  });
  const release = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') mouseBrake = false;
    else touches.delete(e.pointerId);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  return () => {
    const keySteer =
      (down.has('ArrowRight') || down.has('KeyD') ? 1 : 0) -
      (down.has('ArrowLeft') || down.has('KeyA') ? 1 : 0);
    const firstTouch = touches.values().next();
    const steer =
      keySteer !== 0
        ? keySteer
        : !firstTouch.done
          ? steerFromPointerX(firstTouch.value, window.innerWidth)
          : mouseActive
            ? mouseSteer
            : 0;
    const brake =
      down.has('Space') ||
      down.has('ArrowDown') ||
      down.has('KeyS') ||
      mouseBrake ||
      touches.size >= 2;
    return { steer, brake };
  };
}
