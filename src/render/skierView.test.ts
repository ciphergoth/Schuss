// The rig runs headless: Three.js scene-graph math needs no WebGL, so pose
// invariants are testable without a browser.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ANKLE_Y, SHIN, SkierView, createSkierView, updateSkierView } from './skierView';
import { SkierInput, createSkier } from '../sim/skier';
import { Terrain } from '../sim/terrain';

const terrain = new Terrain(1);

function settled(input: SkierInput): SkierView {
  const view = createSkierView(new THREE.Scene());
  const state = createSkier();
  state.y = terrain.height(state.x, state.z);
  // Plenty of frames for the pose easing to converge.
  for (let i = 0; i < 300; i++) updateSkierView(view, state, input, 1 / 60);
  return view;
}

function ankleWorldY(view: SkierView, legIndex: 0 | 1): number {
  view.group.updateMatrixWorld(true);
  return view.legs[legIndex].knee.localToWorld(new THREE.Vector3(0, -SHIN, 0)).y;
}

describe('skier rig', () => {
  it('keeps ankles at snow level in every stance', () => {
    const snow = terrain.height(0, 0);
    for (const stance of [-1, -0.5, 0, 0.5, 1]) {
      const view = settled({ steer: 0, stance });
      for (const leg of [0, 1] as const) {
        expect(ankleWorldY(view, leg)).toBeCloseTo(snow + ANKLE_Y, 1);
      }
    }
  });

  it('tuck crouches: pelvis drops and knees flex', () => {
    const neutral = settled({ steer: 0, stance: 0 });
    const tucked = settled({ steer: 0, stance: -1 });
    expect(tucked.pelvis.position.y).toBeLessThan(neutral.pelvis.position.y - 0.2);
    expect(tucked.legs[0].knee.rotation.x).toBeGreaterThan(neutral.legs[0].knee.rotation.x + 1);
  });

  it('snowplow wedges the ski tips inward and splays the feet', () => {
    const neutral = settled({ steer: 0, stance: 0 });
    const plowed = settled({ steer: 0, stance: 1 });
    expect(plowed.skis[0].rotation.y).toBeGreaterThan(0.2); // left tip toward +x
    expect(plowed.skis[1].rotation.y).toBeLessThan(-0.2); // right tip toward -x
    expect(plowed.skis[1].position.x).toBeGreaterThan(neutral.skis[1].position.x + 0.05);
  });

  it('tumbling somersaults the skier and recovery lands upright', () => {
    const view = createSkierView(new THREE.Scene());
    const state = { ...createSkier(), tumbling: 0.6 };
    updateSkierView(view, state, { steer: 0, stance: 0 }, 1 / 60);
    expect(Math.abs(view.group.rotation.x)).toBeGreaterThan(1);
    state.tumbling = 0;
    updateSkierView(view, state, { steer: 0, stance: 0 }, 1 / 60);
    expect(view.group.rotation.x).toBe(0);
  });
});
