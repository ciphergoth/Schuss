import * as THREE from 'three';
import { blendPalette, makePalette } from './palette';

export interface SceneSetup {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  // Retint the world for the skier's position and animate the aurora.
  update: (x: number, y: number, z: number, time: number) => void;
}

// Waving sky ribbons: three additive planes whose columns bob on sine waves
// and whose colors sweep green -> cyan -> violet. Opacity follows the zone
// palette, so they smolder at dusk and blaze in the night zone.
const AURORA_COLS = 48;
const AURORA_RIBBONS = 3;

class Aurora {
  readonly group = new THREE.Group();
  private geometries: THREE.PlaneGeometry[] = [];
  private materials: THREE.MeshBasicMaterial[] = [];

  constructor(scene: THREE.Scene) {
    const color = new THREE.Color();
    for (let r = 0; r < AURORA_RIBBONS; r++) {
      const geo = new THREE.PlaneGeometry(620, 24 + r * 10, AURORA_COLS - 1, 1);
      const pos = geo.getAttribute('position');
      const colors = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        const u = (pos.getX(v) + 310) / 620;
        color.setHSL(0.38 + u * 0.38 + r * 0.06, 0.9, 0.55); // green -> violet
        colors[v * 3] = color.r;
        colors[v * 3 + 1] = color.g;
        colors[v * 3 + 2] = color.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((r - 1) * 90, 120 + r * 35, -80 - r * 60);
      mesh.rotation.x = 0.35; // lean back so it reads as high sky, not a wall
      mesh.frustumCulled = false;
      this.geometries.push(geo);
      this.materials.push(mat);
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  update(x: number, y: number, z: number, time: number, strength: number): void {
    // The aurora rides with the skier like the rest of the sky.
    this.group.position.set(x, y, z - 220);
    for (let r = 0; r < AURORA_RIBBONS; r++) {
      const geo = this.geometries[r]!;
      const pos = geo.getAttribute('position');
      const half = pos.count / 2; // top row then bottom row
      for (let v = 0; v < pos.count; v++) {
        const col = v % half;
        const wave =
          Math.sin(col * 0.35 + time * (0.5 + r * 0.2) + r * 2.1) * 9 +
          Math.sin(col * 0.11 - time * 0.3 + r) * 14;
        const base = v < half ? (24 + r * 10) / 2 : -(24 + r * 10) / 2;
        pos.setY(v, base + wave);
      }
      pos.needsUpdate = true;
      const shimmer = 0.75 + 0.25 * Math.sin(time * (0.9 + r * 0.3) + r * 4);
      this.materials[r]!.opacity = 0.34 * strength * shimmer;
    }
  }
}

export function createScene(): SceneSetup {
  const scene = new THREE.Scene();
  // The palette owns the mood: sky, fog, and lights cross-fade between color
  // zones as the run descends (see palette.ts). Start in dusk.
  const sky = new THREE.Color(0x3d4490);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 110, 520);

  const hemi = new THREE.HemisphereLight(0x93a2ff, 0x2c3260, 0.95);
  scene.add(hemi);

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

  const aurora = new Aurora(scene);
  const blended = makePalette();

  const update = (x: number, y: number, z: number, time: number): void => {
    blendPalette(z, blended);
    sky.copy(blended.sky);
    (scene.fog as THREE.Fog).color.copy(blended.sky);
    (scene.fog as THREE.Fog).far = blended.fogFar;
    hemi.color.copy(blended.hemiSky);
    hemi.groundColor.copy(blended.hemiGround);
    hemi.intensity = blended.hemiIntensity;
    sun.color.copy(blended.sun);
    sun.intensity = blended.sunIntensity;
    aurora.update(x, y, z, time, blended.aurora);
  };

  return { scene, sun, update };
}
