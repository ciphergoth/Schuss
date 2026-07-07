import * as THREE from 'three';
import { hash2, mulberry32 } from '../sim/rng';

// The course skis through color worlds: every ZONE_LENGTH meters the sky,
// fog, and light cross-fade into the next palette. Which worlds — and what
// weather rides along — is the course's own: each seed draws its zone
// sequence from the library, so an all-cold ice course and a golden-hour
// course are different places before the terrain even registers. Pure
// function of (seed, z): the same course always looks the same.

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

// The classic four — still the default timeline (and the tests' fixture).
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

// The full library the course sequences draw from: the classic four plus
// four more moods.
export const LIBRARY: readonly Palette[] = [
  ...ZONES,
  // Golden hour: everything amber, long soft light.
  palette('golden hour', 0xb06a38, 0xffd9a0, 0x5c3a24, 1.05, 0xffca70, 2.0, 560, 0.1),
  // Blizzard white: pale and close, the world swallowed.
  palette('blizzard', 0x9aa4b8, 0xdfe6f2, 0x6a7488, 1.1, 0xe8ecf5, 1.0, 320, 0.0),
  // Violet storm: bruised purple sky, electric mood.
  palette('violet storm', 0x3a2350, 0x9a7cff, 0x241536, 0.85, 0xd0b4ff, 1.3, 440, 0.7),
  // Ice blue: cold clear glacier light.
  palette('ice blue', 0x5b7fa8, 0xcfe6ff, 0x2e4258, 1.05, 0xdff1ff, 1.6, 620, 0.35),
];

// The course's zone timeline: the mega course tours the WHOLE library —
// all eight palettes in a seeded order (8km crosses ~13 zones, so every
// world appears before the cycle comes back around). Deterministic per
// seed.
export function courseZones(seed: number): Palette[] {
  const rng = mulberry32(Math.floor(hash2(seed, 4177, 23) * 2 ** 31));
  const deck = [...LIBRARY];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

// The course's weather: snowfall intensity (0 clear / 0.5 flurries / 1
// heavy) and whether fog banks drift across the track.
export function courseWeather(seed: number): { snow: number; fogBanks: number } {
  const roll = hash2(seed, 4177, 29);
  const snow = roll < 0.45 ? 0 : roll < 0.8 ? 0.5 : 1;
  const fogBanks = hash2(seed, 4177, 31) < 0.3 ? 1 : 0;
  return { snow, fogBanks };
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Which zone plus how far into the cross-fade toward the next.
export function zoneMix(
  z: number,
  zones: readonly Palette[] = ZONES
): { a: Palette; b: Palette; t: number } {
  const u = Math.max(0, -z) / ZONE_LENGTH;
  const k = Math.floor(u);
  const frac = u - k;
  const edge = 1 - BLEND / ZONE_LENGTH;
  const a = zones[k % zones.length]!;
  const b = zones[(k + 1) % zones.length]!;
  const t = frac <= edge ? 0 : smoothstep((frac - edge) / (1 - edge));
  return { a, b, t };
}

// Lerp the full palette into `out` (no per-frame allocation).
export function blendPalette(z: number, out: Palette, zones: readonly Palette[] = ZONES): Palette {
  const { a, b, t } = zoneMix(z, zones);
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
