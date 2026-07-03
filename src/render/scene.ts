import * as THREE from 'three';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const sky = new THREE.Color(0xbfdcff);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 60, 240);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x8899aa, 1.1));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  sun.position.set(40, 80, -30);
  scene.add(sun);

  return scene;
}
