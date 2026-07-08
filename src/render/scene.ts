import * as THREE from 'three';
import { hash2 } from '../sim/rng';
import { CourseDesign } from '../sim/design';
import {
  Palette,
  blendPalette,
  courseWeather,
  courseZones,
  makePalette,
  zonesFromNames,
} from './palette';

export interface SceneSetup {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  // Retint the world for the skier's position and animate the aurora.
  // cave (0..1, terrain.caveAt) is the grotto's dimmer: sky and lights fall
  // toward blue-black, fog closes in, and the snowfall and aurora hold
  // their breath under the roof.
  update: (x: number, y: number, z: number, time: number, cave?: number) => void;
  // A new course brings its own zone sequence and weather — authored when
  // a design is riding, seeded otherwise.
  setCourse: (seed: number, design?: CourseDesign) => void;
  // The sky celebrates with you: a jackpot briefly FLARES the aurora to
  // full blaze wherever you are (strength 0..1, decaying over ~2.5s).
  // atTime is sim time — the same clock update() runs on.
  flare: (strength: number, atTime: number) => void;
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

// Shooting stars: brief streaks across the high sky on a seeded schedule —
// each of a few lanes fires every SHOOT_PERIOD seconds at a seeded moment
// and heading, so the night is quietly alive without ever demanding
// attention. Pure function of (seed, time): deterministic, no state.
const SHOOT_LANES = 3;
export const SHOOT_PERIOD = 26; // per lane; ~one streak somewhere every ~9s
const SHOOT_LIFE = 1.1;

export class ShootingStars {
  private streaks: THREE.Mesh[] = [];
  private material: THREE.MeshBasicMaterial;
  private seed = 1;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.MeshBasicMaterial({
      color: 0xdff4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    for (let j = 0; j < SHOOT_LANES; j++) {
      // A long thin sliver, brightest at the head end via a taper.
      const geo = new THREE.PlaneGeometry(26, 0.5);
      const streak = new THREE.Mesh(geo, this.material.clone());
      streak.frustumCulled = false;
      streak.visible = false;
      this.streaks.push(streak);
      scene.add(streak);
    }
  }

  setSeed(seed: number): void {
    this.seed = seed;
  }

  // How many streaks are mid-flight right now (tests probe the schedule).
  liveCount(): number {
    return this.streaks.filter((s) => s.visible).length;
  }

  update(x: number, y: number, z: number, time: number, dimmer: number): void {
    for (let j = 0; j < SHOOT_LANES; j++) {
      const streak = this.streaks[j]!;
      const k = Math.floor(time / SHOOT_PERIOD);
      // Each lane fires once per period, at a seeded moment inside it.
      const start = k * SHOOT_PERIOD + hash2(this.seed, k, 911 + j) * (SHOOT_PERIOD - SHOOT_LIFE);
      const u = (time - start) / SHOOT_LIFE;
      if (u < 0 || u > 1 || dimmer <= 0) {
        streak.visible = false;
        continue;
      }
      const h1 = hash2(this.seed, k, 917 + j);
      const h2 = hash2(this.seed, k, 919 + j);
      const x0 = (h1 * 2 - 1) * 220;
      const dir = h2 < 0.5 ? 1 : -1;
      const drop = 22 + h2 * 18;
      streak.visible = true;
      streak.position.set(x + x0 + dir * u * 90, y + 150 + h2 * 60 - u * drop, z - 260 - h1 * 80);
      streak.rotation.z = -dir * Math.atan2(drop, 90);
      const mat = streak.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.sin(u * Math.PI) * 0.8 * dimmer;
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

  update(x: number, y: number, z: number, time: number, visibility = 1): void {
    this.points.visible = this.intensity * visibility > 0;
    this.material.opacity = this.intensity * visibility * 0.85;
    if (this.intensity * visibility === 0) return;
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
  const shooting = new ShootingStars(scene);
  const blended = makePalette();

  // The jackpot flare: an envelope that spikes the aurora to full blaze and
  // decays over a couple of seconds. Runs on sim time (the same clock
  // update() gets), so a paused game holds its flare mid-bloom.
  const FLARE_DECAY = 2.5;
  let flareStrength = 0;
  let flareAt = -FLARE_DECAY;
  const flare = (strength: number, atTime: number): void => {
    // A new flare joins whatever is still glowing rather than cutting it.
    const u = (atTime - flareAt) / FLARE_DECAY;
    const live = u >= 0 && u < 1 ? flareStrength * (1 - u) * (1 - u) : 0;
    flareStrength = Math.min(1, Math.max(live, strength));
    flareAt = atTime;
  };

  // The course's atmosphere identity: its own zone sequence and weather.
  let zones: readonly Palette[] = courseZones(1);
  let weather = courseWeather(1);
  let fogPhase = 0;
  const setCourse = (seed: number, design?: CourseDesign): void => {
    zones = design ? zonesFromNames(design.zones) : courseZones(seed);
    weather = design ? design.weather : courseWeather(seed);
    fogPhase = hash2(seed, 4177, 37) * Math.PI * 2;
    snow.intensity = weather.snow;
    shooting.setSeed(seed);
    flareStrength = 0; // a fresh course starts with a calm sky
    flareAt = -FLARE_DECAY;
  };

  // The grotto's own darkness: blue-black, close, lit by its crystals.
  const caveSky = new THREE.Color(0x05070f);

  const update = (x: number, y: number, z: number, time: number, cave = 0): void => {
    blendPalette(z, blended, zones);
    sky.copy(blended.sky);
    // Under the grotto's roof the world outside goes away: the sky falls to
    // blue-black, the fog closes, the lights dim to a glow — and stepping
    // back out through the far portal is the exhale.
    if (cave > 0) sky.lerp(caveSky, cave * 0.92);
    (scene.fog as THREE.Fog).color.copy(sky);
    // Fog banks drift across the course: the palette's visibility swells
    // and closes on a slow, seeded rhythm in z — pure function of position,
    // so the same bank always sits on the same stretch.
    let far = blended.fogFar;
    if (weather.fogBanks > 0) {
      const bank = 0.5 + 0.5 * Math.sin(-z / 210 + fogPhase) * Math.sin(-z / 87 + fogPhase * 1.7);
      far *= 1 - 0.5 * bank * bank;
    }
    far *= 1 - 0.7 * cave;
    (scene.fog as THREE.Fog).far = far;
    hemi.color.copy(blended.hemiSky);
    hemi.groundColor.copy(blended.hemiGround);
    hemi.intensity = blended.hemiIntensity * (1 - 0.55 * cave);
    sun.color.copy(blended.sun);
    sun.intensity = blended.sunIntensity * (1 - 0.85 * cave);
    // A jackpot briefly blazes the aurora wherever the palette left it —
    // the sky celebrating with you — and the grotto's roof hides all of it.
    const fu = (time - flareAt) / FLARE_DECAY;
    const flareEnv = fu >= 0 && fu < 1 ? flareStrength * (1 - fu) * (1 - fu) : 0;
    aurora.update(x, y, z, time, Math.min(1, blended.aurora + flareEnv) * (1 - cave));
    shooting.update(x, y, z, time, 1 - cave);
    snow.update(x, y, z, time, 1 - cave);
  };

  return { scene, sun, update, setCourse, flare };
}
