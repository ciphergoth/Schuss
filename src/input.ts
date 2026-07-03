import { SkierInput } from './sim/skier';

export function setupInput(onRestart: () => void): () => SkierInput {
  const down = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') onRestart();
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));

  return () => ({
    steer:
      (down.has('ArrowRight') || down.has('KeyD') ? 1 : 0) -
      (down.has('ArrowLeft') || down.has('KeyA') ? 1 : 0),
    brake: down.has('Space') || down.has('ArrowDown') || down.has('KeyS'),
  });
}
