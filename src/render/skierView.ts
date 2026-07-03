import * as THREE from 'three';
import { SkierInput, SkierState } from '../sim/skier';

// Two-segment legs with a solvable pose: the thigh pitches forward by phi and
// the knee flexes by 2*phi, which keeps the ankle exactly under the hip, so
// the pelvis height is just ANKLE_Y + (THIGH + SHIN) * cos(phi). One scalar
// sweeps the whole range from standing to full tuck with skis on the snow.
export const THIGH = 0.42;
export const SHIN = 0.42;
export const ANKLE_Y = 0.06;
const HIP_X = 0.13;
const NEUTRAL_PHI = 0.18;

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

export interface SkierView {
  group: THREE.Group;
  pelvis: THREE.Group;
  torso: THREE.Group;
  legs: [Leg, Leg]; // [left, right]
  skis: [THREE.Mesh, THREE.Mesh]; // [left, right]
  pose: { tuck: number; plow: number }; // smoothed toward the input stance
}

function limb(width: number, length: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, length, width), material);
  mesh.position.y = -length / 2;
  return mesh;
}

function buildLeg(side: -1 | 1, pants: THREE.Material): Leg {
  const hip = new THREE.Group();
  hip.position.set(side * HIP_X, 0, 0);
  hip.add(limb(0.15, THIGH, pants));
  const knee = new THREE.Group();
  knee.position.y = -THIGH;
  knee.add(limb(0.13, SHIN, pants));
  hip.add(knee);
  return { hip, knee };
}

export function createSkierView(scene: THREE.Scene): SkierView {
  const jacket = new THREE.MeshStandardMaterial({ color: 0xd42a2a, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x1c2a4a, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.9 });
  const skiMaterial = new THREE.MeshStandardMaterial({ color: 0x223a8f, roughness: 0.5 });

  const group = new THREE.Group();
  const pelvis = new THREE.Group();
  group.add(pelvis);

  const legs: [Leg, Leg] = [buildLeg(-1, pants), buildLeg(1, pants)];
  for (const leg of legs) pelvis.add(leg.hip);

  const torso = new THREE.Group();
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.55, 0.2), jacket);
  chest.position.y = 0.28;
  torso.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), skin);
  head.position.y = 0.68;
  torso.add(head);
  for (const side of [-1, 1]) {
    const arm = limb(0.09, 0.42, jacket);
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.21, 0.5, 0);
    shoulder.rotation.z = side * -0.45;
    shoulder.add(arm);
    torso.add(shoulder);
  }
  pelvis.add(torso);

  const buildSki = (side: -1 | 1): THREE.Mesh => {
    const ski = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.8), skiMaterial);
    ski.position.set(side * (HIP_X + 0.07), 0.03, 0.2);
    group.add(ski);
    return ski;
  };
  const skis: [THREE.Mesh, THREE.Mesh] = [buildSki(-1), buildSki(1)];

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });
  scene.add(group);
  return { group, pelvis, torso, legs, skis, pose: { tuck: 0, plow: 0 } };
}

export function updateSkierView(
  view: SkierView,
  state: SkierState,
  input: SkierInput,
  dt: number
): void {
  const { group, pelvis, torso, legs, skis, pose } = view;

  group.position.set(state.x, state.y, state.z);
  group.rotation.y = Math.atan2(Math.sin(state.heading), -Math.cos(state.heading));
  // Lean into turns. A tumble is a forward somersault: the timer runs to zero,
  // so tumbling * 10 spins ~2 turns and lands exactly upright.
  group.rotation.x = state.tumbling * 10;
  group.rotation.z = -input.steer * 0.3;

  // Ease the pose toward the input stance, frame-rate independently. Airborne,
  // the knees come up regardless of stance.
  const k = 1 - Math.exp(-12 * dt);
  const tuckTarget = state.airTime > 0 ? Math.max(0.6, -input.stance) : Math.max(0, -input.stance);
  pose.tuck += (tuckTarget - pose.tuck) * k;
  pose.plow += (Math.max(0, input.stance) - pose.plow) * k;

  const phi = NEUTRAL_PHI + 0.75 * pose.tuck + 0.2 * pose.plow;
  const splay = 0.22 * pose.plow;
  const legDrop = (THIGH + SHIN) * Math.cos(phi);
  pelvis.position.y = ANKLE_Y + legDrop;
  for (const [i, leg] of legs.entries()) {
    const side = i === 0 ? -1 : 1;
    leg.hip.rotation.x = -phi;
    leg.hip.rotation.z = side * splay;
    leg.knee.rotation.x = 2 * phi;
  }
  torso.rotation.x = 0.25 + 1.05 * pose.tuck + 0.15 * pose.plow;

  // Skis track the splayed feet; snowplow wedges the tips together.
  const skiX = HIP_X + 0.07 + Math.sin(splay) * legDrop;
  for (const [i, ski] of skis.entries()) {
    const side = i === 0 ? -1 : 1;
    ski.position.x = side * skiX;
    ski.rotation.y = -side * 0.35 * pose.plow;
  }
}
