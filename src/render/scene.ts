import * as THREE from 'three';

export interface SceneSetup {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createScene(): SceneSetup {
  const scene = new THREE.Scene();
  const sky = new THREE.Color(0xaeccf2);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 60, 240);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x8899aa, 0.85));

  // Low-ish warm sun: long shadows and visible shading on the terrain facets.
  // Position and target follow the skier each frame so the shadow camera's
  // box stays centered on the action.
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  return { scene, sun };
}
