import * as THREE from 'three';
import { SkierState } from '../sim/skier';
import { Terrain } from '../sim/terrain';

// Model faces +z in local space; rotation.y turns it toward the sim heading.
export function createSkierView(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.8, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xd42a2a, roughness: 0.8 })
  );
  body.position.y = 0.9;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.9 })
  );
  head.position.y = 1.6;
  group.add(head);

  const skiMaterial = new THREE.MeshStandardMaterial({ color: 0x223a8f, roughness: 0.5 });
  for (const side of [-1, 1]) {
    const ski = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.8), skiMaterial);
    ski.position.set(side * 0.2, 0.03, 0.2);
    group.add(ski);
  }

  scene.add(group);
  return group;
}

export function updateSkierView(
  group: THREE.Group,
  state: SkierState,
  terrain: Terrain,
  steer: number
): void {
  group.position.set(state.x, terrain.height(state.x, state.z), state.z);
  group.rotation.y = Math.atan2(Math.sin(state.heading), -Math.cos(state.heading));
  // Lean into turns; lie flat after a wipeout.
  group.rotation.z = state.crashed ? 1.45 : -steer * 0.3;
}
