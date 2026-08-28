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
  arms: [THREE.Group, THREE.Group]; // shoulder pivots [left, right] — the grab reaches
  pose: { tuck: number; plow: number; glow: number; grab: number }; // smoothed render state
  glowMats: { mat: THREE.MeshStandardMaterial; intensity: number }[];
  // The scarf: a chain of lagged segments off the neck, animated by wind
  // (speed) and whipped by rotation — spin direction made readable in cloth.
  scarf: { segments: THREE.Group[]; phase: number; lastSpin: number };
}

// Limbs are tapered hexagonal prisms, not boxes: flat-shaded so the low-poly
// facets stay, but the taper reads as a body instead of scaffolding.
function limb(topR: number, botR: number, length: number, material: THREE.Material): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(topR, botR, length, 6);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = -length / 2;
  return mesh;
}

function buildLeg(side: -1 | 1, pants: THREE.Material): Leg {
  const hip = new THREE.Group();
  hip.position.set(side * HIP_X, 0, 0);
  hip.add(limb(0.085, 0.062, THIGH, pants));
  const knee = new THREE.Group();
  knee.position.y = -THIGH;
  knee.add(limb(0.06, 0.046, SHIN, pants));
  hip.add(knee);
  return { hip, knee };
}

const SCARF_SEGMENTS = 5;
const SCARF_SEG_LEN = 0.16;

export function createSkierView(scene: THREE.Scene): SkierView {
  const jacket = new THREE.MeshStandardMaterial({
    color: 0xd42a2a,
    roughness: 0.8,
    flatShading: true,
  });
  const pants = new THREE.MeshStandardMaterial({
    color: 0x1c2a4a,
    roughness: 0.9,
    flatShading: true,
  });
  const skin = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.9 });
  const skiMaterial = new THREE.MeshStandardMaterial({ color: 0x223a8f, roughness: 0.5 });
  const helmet = new THREE.MeshStandardMaterial({
    color: 0xeef2f8,
    roughness: 0.35,
    flatShading: true,
  });
  const goggleBand = new THREE.MeshStandardMaterial({ color: 0x131a2e, roughness: 0.6 });
  // The lens carries a constant cyan ember — the face reads at dusk and in
  // the grotto without waiting for the air glow.
  const lens = new THREE.MeshStandardMaterial({
    color: 0x0c2a3a,
    emissive: new THREE.Color(0x2ee6ff),
    emissiveIntensity: 0.7,
    roughness: 0.25,
  });
  const pole = new THREE.MeshStandardMaterial({ color: 0x525c74, roughness: 0.4 });
  const scarfMat = new THREE.MeshStandardMaterial({
    color: 0xffd34d,
    roughness: 0.8,
    flatShading: true,
  });

  // In real air the skier lights up from within — reading your own rotation
  // against a dark sky (or a fireworks barrage) is how tricks get landed,
  // so the figure must outshine everything behind it. The skis glow hottest:
  // they're the needle you read the angle from; the gold scarf streams as a
  // lit ribbon so the whip direction reads too.
  jacket.emissive = new THREE.Color(0xff6a4a);
  pants.emissive = new THREE.Color(0x4a7aff);
  skiMaterial.emissive = new THREE.Color(0x2ee6ff);
  scarfMat.emissive = new THREE.Color(0xffd34d);
  const glowMats = [
    { mat: jacket, intensity: 0.55 },
    { mat: pants, intensity: 0.7 },
    { mat: scarfMat, intensity: 0.8 },
    // Hot enough to cross the bloom threshold in the air: the skis get a
    // real halo, and they're the needle you read the rotation from.
    { mat: skiMaterial, intensity: 2.1 },
  ];
  for (const { mat } of glowMats) mat.emissiveIntensity = 0;

  const group = new THREE.Group();
  const pelvis = new THREE.Group();
  group.add(pelvis);

  const legs: [Leg, Leg] = [buildLeg(-1, pants), buildLeg(1, pants)];
  for (const leg of legs) pelvis.add(leg.hip);

  const torso = new THREE.Group();
  // Chest: a tapered hexagonal prism — shoulders wider than the waist.
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.145, 0.55, 6), jacket);
  chest.position.y = 0.28;
  torso.add(chest);

  // The head wears a helmet: face below, shell above, goggle band with a lit
  // lens across the front (the model's forward is local +z — ski tips ahead).
  const head = new THREE.Group();
  head.position.y = 0.68;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), skin);
  head.add(face);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.148, 10, 8), helmet);
  shell.position.y = 0.025;
  shell.scale.y = 0.92;
  head.add(shell);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.075, 0.03), goggleBand);
  band.position.set(0, 0.015, 0.1);
  head.add(band);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.055, 0.02), lens);
  visor.position.set(0, 0.015, 0.125);
  head.add(visor);
  torso.add(head);

  // The scarf roots at the neck and trails behind (-z): a chain of flattened
  // segments, each pivoting at the tail of the one before. updateSkierView
  // owns the animation; here they just hang.
  const scarfSegments: THREE.Group[] = [];
  let scarfParent: THREE.Object3D = torso;
  for (let k = 0; k < SCARF_SEGMENTS; k++) {
    const seg = new THREE.Group();
    seg.position.set(0, k === 0 ? 0.58 : 0, k === 0 ? -0.1 : -SCARF_SEG_LEN);
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(0.12 - k * 0.008, 0.035, SCARF_SEG_LEN),
      scarfMat
    );
    cloth.position.z = -SCARF_SEG_LEN / 2;
    seg.add(cloth);
    scarfParent.add(seg);
    scarfParent = seg;
    scarfSegments.push(seg);
  }

  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = limb(0.055, 0.042, 0.42, jacket);
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.21, 0.5, 0);
    // A slight inward hang: hands ahead of the hips, poles clearly TWO —
    // the old 0.45 angle converged both hands (and poles) at the sternum.
    shoulder.rotation.z = side * -0.22;
    shoulder.add(arm);
    // The hand: a glove at the arm's end holding a pole, tilted so the tip
    // trails behind the boots — the silhouette every skier is missing
    // without one.
    const hand = new THREE.Group();
    hand.position.y = -0.44;
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.075), pants);
    hand.add(glove);
    const poleShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.02, 0.95, 5), pole);
    poleShaft.position.y = -0.4;
    const basket = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.055, 6), pole);
    basket.position.y = -0.78;
    const poleTilt = new THREE.Group();
    poleTilt.rotation.x = 0.5; // tip back toward -z
    poleTilt.add(poleShaft);
    poleTilt.add(basket);
    hand.add(poleTilt);
    shoulder.add(hand);
    torso.add(shoulder);
    arms.push(shoulder);
  }
  pelvis.add(torso);

  const buildSki = (side: -1 | 1): THREE.Mesh => {
    const ski = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.8), skiMaterial);
    ski.position.set(side * (HIP_X + 0.07), 0.03, 0.2);
    // Upturned tip: the small angled shovel that makes a plank read as a ski.
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.24), skiMaterial);
    tip.position.set(0, 0.045, 0.98);
    tip.rotation.x = -0.42;
    ski.add(tip);
    // Boot: the dark block that ties leg to plank in silhouette.
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.3), pants);
    boot.position.set(0, 0.09, 0.02);
    ski.add(boot);
    group.add(ski);
    return ski;
  };
  const skis: [THREE.Mesh, THREE.Mesh] = [buildSki(-1), buildSki(1)];

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });
  scene.add(group);
  return {
    group,
    pelvis,
    torso,
    legs,
    skis,
    arms: [arms[0]!, arms[1]!],
    pose: { tuck: 0, plow: 0, glow: 0, grab: 0 },
    glowMats,
    scarf: { segments: scarfSegments, phase: 0, lastSpin: 0 },
  };
}

export function updateSkierView(
  view: SkierView,
  state: SkierState,
  input: SkierInput,
  dt: number
): void {
  const { group, pelvis, torso, legs, skis, pose } = view;

  group.position.set(state.x, state.y, state.z);
  // Trick spin composes with heading in HEADING-space (positive = rightward,
  // same as steering) — adding it in rotation-space mirrored the keys, so D
  // spun you visually left. Trick flip shares the pitch axis with the tumble
  // somersault (tumbling * 10 runs the timer to zero, landing upright).
  const facing = state.heading + state.spin;
  group.rotation.y = Math.atan2(Math.sin(facing), -Math.cos(facing));
  group.rotation.x = state.tumbling > 0 ? state.tumbling * 10 : state.flip;
  group.rotation.z = -input.steer * 0.3;

  // Ease the pose toward the input stance, frame-rate independently. Airborne,
  // the knees come up regardless of stance.
  const k = 1 - Math.exp(-12 * dt);

  // The air glow: on fast in real air, off fast on the snow (and off while
  // tumbling — the crash reads better unlit).
  const glowTarget = state.airTime > 0.2 && state.tumbling === 0 ? 1 : 0;
  view.pose.glow += (glowTarget - view.pose.glow) * k;
  for (const { mat, intensity } of view.glowMats) {
    mat.emissiveIntensity = view.pose.glow * intensity;
  }
  const tuckTarget = state.airTime > 0 ? Math.max(0.6, -input.stance) : Math.max(0, -input.stance);
  pose.tuck += (tuckTarget - pose.tuck) * k;
  pose.plow += (Math.max(0, input.stance) - pose.plow) * k;

  // The GRAB: in real air with the button held, the right hand reaches down
  // to the ski and the left arm throws out for balance — the classic tweak,
  // readable in silhouette against the sky.
  const grabTarget = state.airTime > 0.2 && state.tumbling === 0 && (input.boost ?? false) ? 1 : 0;
  pose.grab += (grabTarget - pose.grab) * k;
  const [armL, armR] = view.arms; // base rotation.z: +0.22 left, -0.22 right
  armL.rotation.z = 0.22 - 1.1 * pose.grab; // left arm throws out wide
  armR.rotation.z = -0.22 + 0.25 * pose.grab; // right arm tucks in...
  armR.rotation.x = 1.25 * pose.grab; // ...and reaches down the ski line

  // A held jump charge sinks the skier into a preload crouch.
  const phi = NEUTRAL_PHI + 0.75 * pose.tuck + 0.2 * pose.plow + 0.55 * (input.charge ?? 0);
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

  // The scarf: hangs at rest, streams straight back with speed, and WHIPS
  // when the body rotates — spin rate feeds both the flutter tempo and its
  // amplitude, so mid-trick the gold ribbon lashes in the turn's direction
  // and reads against the sky. Pure render-side animation off sim state.
  const scarf = view.scarf;
  const spinRate = dt > 0 ? Math.min(12, Math.abs(state.spin - scarf.lastSpin) / dt) : 0;
  scarf.lastSpin = state.spin;
  const wind = Math.min(1, state.speed / 20); // streams properly by cruise pace
  scarf.phase += dt * (3 + state.speed * 0.35 + spinRate * 1.6);
  const flutter = 0.1 + 0.32 * wind + Math.min(0.55, spinRate * 0.09);
  for (const [k, seg] of scarf.segments.entries()) {
    // Base pitch: -1.15 (hanging down the back) easing to -0.1 (streaming).
    const sway = 0.35 + k * 0.28; // the free end moves most
    seg.rotation.x = -1.15 + 1.05 * wind + Math.sin(scarf.phase - k * 1.1) * flutter * sway;
    seg.rotation.y = Math.sin(scarf.phase * 0.63 - k * 0.8) * flutter * sway * 0.55;
  }
}
