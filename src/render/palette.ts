import * as THREE from 'three';

// The endless course skis through color worlds: every ZONE_LENGTH meters the
// sky, fog, and light cross-fade into the next palette. Pure function of z,
// so the same run always looks the same.

export const ZONE_LENGTH = 600;
const BLEND = 80; // meters of cross-fade at each zone boundary

export interface Palette {
  name: string;
  sky: THREE.Color; // background + fog
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  sun: THREE.Color;
  sunIntensity: number;
  fogFar: number;
  aurora: number; // 0..1 how loud the sky ribbons are here
}

const palette = (
  name: string,
  sky: number,
  hemiSky: number,
  hemiGround: number,
  hemiIntensity: number,
  sun: number,
  sunIntensity: number,
  fogFar: number,
  aurora: number
): Palette => ({
  name,
  sky: new THREE.Color(sky),
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
  hemiIntensity,
  sun: new THREE.Color(sun),
  sunIntensity,
  fogFar,
  aurora,
});

export const ZONES: readonly Palette[] = [
  // The original race: indigo dusk, warm low sun.
  palette('dusk', 0x3d4490, 0x93a2ff, 0x2c3260, 0.95, 0xffd9a8, 1.7, 520, 0.25),
  // Deep night: the neon course glows against near-black, aurora at full.
  palette('neon night', 0x11132e, 0x5560ff, 0x141034, 0.8, 0xaebcff, 1.1, 430, 1.0),
  // Rose dawn: hot pink horizon, gold key light.
  palette('rose dawn', 0x9c4a72, 0xffb9cf, 0x4a2c50, 1.0, 0xffc07a, 1.9, 560, 0.15),
  // Emerald hour: teal alien glow, the absurd zone.
  palette('emerald', 0x1f6e63, 0xa8ffe9, 0x14403a, 1.0, 0xffeab0, 1.5, 500, 0.55),
];

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Which zone plus how far into the cross-fade toward the next.
export function zoneMix(z: number): { a: Palette; b: Palette; t: number } {
  const u = Math.max(0, -z) / ZONE_LENGTH;
  const k = Math.floor(u);
  const frac = u - k;
  const edge = 1 - BLEND / ZONE_LENGTH;
  const a = ZONES[k % ZONES.length]!;
  const b = ZONES[(k + 1) % ZONES.length]!;
  const t = frac <= edge ? 0 : smoothstep((frac - edge) / (1 - edge));
  return { a, b, t };
}

// Lerp the full palette into `out` (no per-frame allocation).
export function blendPalette(z: number, out: Palette): Palette {
  const { a, b, t } = zoneMix(z);
  out.sky.lerpColors(a.sky, b.sky, t);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.sun.lerpColors(a.sun, b.sun, t);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
  out.fogFar = a.fogFar + (b.fogFar - a.fogFar) * t;
  out.aurora = a.aurora + (b.aurora - a.aurora) * t;
  out.name = t < 0.5 ? a.name : b.name;
  return out;
}

export function makePalette(): Palette {
  return palette('blend', 0, 0, 0, 0, 0, 0, 0, 0);
}
