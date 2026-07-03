import * as THREE from 'three';

export interface SceneSetup {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createScene(): SceneSetup {
  const scene = new THREE.Scene();
  // Dusk race palette: indigo sky, hazy horizon, warm low light — the course
  // floats against it like an SSX night event.
  const sky = new THREE.Color(0x3d4490);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 110, 520);

  scene.add(new THREE.HemisphereLight(0x93a2ff, 0x2c3260, 0.95));

  // Low warm key light: long shadows and visible shading on the track facets.
  // Position and target follow the skier each frame so the shadow camera's
  // box stays centered on the action.
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.7);
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
