import * as THREE from 'three';
import { SkierState } from '../sim/skier';
import { Terrain } from '../sim/terrain';

export function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 6, 12);
  return camera;
}

// Third-person follow: sit behind the skier's heading, stay above the terrain,
// and smooth all motion with an exponential lerp so camera speed is
// frame-rate independent.
export function updateCamera(
  camera: THREE.PerspectiveCamera,
  state: SkierState,
  terrain: Terrain,
  dt: number
): void {
  const dirX = Math.sin(state.heading);
  const dirZ = -Math.cos(state.heading);
  const skierY = terrain.height(state.x, state.z);

  const target = new THREE.Vector3(state.x - dirX * 9, 0, state.z - dirZ * 9);
  target.y = Math.max(terrain.height(target.x, target.z) + 2.5, skierY + 4);

  camera.position.lerp(target, 1 - Math.exp(-4 * dt));
  camera.lookAt(state.x + dirX * 4, skierY + 1.2, state.z + dirZ * 4);
}
