import * as THREE from 'three';
import { hash2 } from '../sim/rng';
import { Palette, blendPalette, courseWeather, courseZones, makePalette } from './palette';

export interface SceneSetup {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  // Retint the world for the skier's position and animate the aurora.
  update: (x: number, y: number, z: number, time: number) => void;
  // A new course brings its own zone sequence and weather.
  setCourse: (seed: number) => void;
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

// Snowfall: a box of points that rides with the skier, each flake falling
// on its own seeded track and wrapping within the box. Positions are a pure
// function of (flake, time), so the storm is deterministic and needs no
// per-frame physics.
const SNOW_COUNT = 1400;
const SNOW_BOX = { x: 130, y: 70, z: 160 };

class Snowfall {
  readonly points: THREE.Points;
  private readonly material: THREE.PointsMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly tracks: Float32Array; // per-flake x0, z0, fall speed, sway phase
  intensity = 0;

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SNOW_COUNT * 3), 3)
    );
    this.tracks = new Float32Array(SNOW_COUNT * 4);
    for (let i = 0; i < SNOW_COUNT; i++) {
      this.tracks[i * 4] = hash2(7, i, 1) * SNOW_BOX.x;
      this.tracks[i * 4 + 1] = hash2(7, i, 2) * SNOW_BOX.z;
      this.tracks[i * 4 + 2] = 5 + hash2(7, i, 3) * 5; // fall speed m/s
      this.tracks[i * 4 + 3] = hash2(7, i, 4) * Math.PI * 2;
    }
    this.material = new THREE.PointsMaterial({
      color: 0xf2f6ff,
      size: 0.32,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(x: number, y: number, z: number, time: number): void {
    this.points.visible = this.intensity > 0;
    this.material.opacity = this.intensity * 0.85;
    if (this.intensity === 0) return;
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < SNOW_COUNT; i++) {
      const fall = this.tracks[i * 4 + 2]!;
      const phase = this.tracks[i * 4 + 3]!;
      const fx = this.tracks[i * 4]! + Math.sin(time * 0.8 + phase) * 1.5;
      const fy = ((this.tracks[i * 4]! * 7 - fall * time) % SNOW_BOX.y) + SNOW_BOX.y;
      const fz = this.tracks[i * 4 + 1]!;
      pos.setXYZ(
        i,
        x + (((fx % SNOW_BOX.x) + SNOW_BOX.x) % SNOW_BOX.x) - SNOW_BOX.x / 2,
        y + (fy % SNOW_BOX.y) - SNOW_BOX.y / 4,
        z + (((fz % SNOW_BOX.z) + SNOW_BOX.z) % SNOW_BOX.z) - SNOW_BOX.z / 2
      );
    }
    pos.needsUpdate = true;
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
  const snow = new Snowfall(scene);
  const blended = makePalette();

  // The course's atmosphere identity: its own zone sequence and weather.
  let zones: readonly Palette[] = courseZones(1);
  let weather = courseWeather(1);
  let fogPhase = 0;
  const setCourse = (seed: number): void => {
    zones = courseZones(seed);
    weather = courseWeather(seed);
    fogPhase = hash2(seed, 4177, 37) * Math.PI * 2;
    snow.intensity = weather.snow;
  };

  const update = (x: number, y: number, z: number, time: number): void => {
    blendPalette(z, blended, zones);
    sky.copy(blended.sky);
    (scene.fog as THREE.Fog).color.copy(blended.sky);
    // Fog banks drift across the course: the palette's visibility swells
    // and closes on a slow, seeded rhythm in z — pure function of position,
    // so the same bank always sits on the same stretch.
    let far = blended.fogFar;
    if (weather.fogBanks > 0) {
      const bank = 0.5 + 0.5 * Math.sin(-z / 210 + fogPhase) * Math.sin(-z / 87 + fogPhase * 1.7);
      far *= 1 - 0.5 * bank * bank;
    }
    (scene.fog as THREE.Fog).far = far;
    hemi.color.copy(blended.hemiSky);
    hemi.groundColor.copy(blended.hemiGround);
    hemi.intensity = blended.hemiIntensity;
    sun.color.copy(blended.sun);
    sun.intensity = blended.sunIntensity;
    aurora.update(x, y, z, time, blended.aurora);
    snow.update(x, y, z, time);
  };

  return { scene, sun, update, setCourse };
}
