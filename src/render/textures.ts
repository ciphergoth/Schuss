import * as THREE from 'three';
import { mulberry32 } from '../sim/rng';

// Runtime-generated surface textures. Still no binary assets and no DOM —
// these are DataTextures computed from a fixed seed at startup — but they buy
// the ground what flat vertex color never could: grain, mottling, and glints.
// Purely cosmetic: the sim's heightfield and friction know nothing of them.

// Meters of course per texture repeat. Small enough that the grain reads at
// skiing distance, large enough that the tiling never shows as a grid.
export const SNOW_TILE = 9;

const SIZE = 256; // power of two: mipmaps keep the far course calm

// Tileable fractal value noise in [0,1]: wrapping lattices of seeded values,
// bilinearly sampled with smoothstep, summed over octaves.
function fractalNoise(seed: number, octaves: { cells: number; weight: number }[]): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  let total = 0;
  for (const { cells, weight } of octaves) {
    total += weight;
    const rand = mulberry32(seed * 7919 + cells);
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const gx = (x / SIZE) * cells;
        const gy = (y / SIZE) * cells;
        const x0 = Math.floor(gx) % cells;
        const y0 = Math.floor(gy) % cells;
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const fx = gx - Math.floor(gx);
        const fy = gy - Math.floor(gy);
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const a = lattice[y0 * cells + x0]!;
        const b = lattice[y0 * cells + x1]!;
        const c = lattice[y1 * cells + x0]!;
        const d = lattice[y1 * cells + x1]!;
        out[y * SIZE + x]! +=
          (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * weight;
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

function makeTexture(
  data: Uint8Array<ArrayBuffer>,
  colorSpace: string,
  anisotropy: number
): THREE.Texture {
  const tex = new THREE.DataTexture(data, SIZE, SIZE);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = colorSpace as THREE.ColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export interface SnowTextures {
  map: THREE.Texture; // near-white mottling + glint pixels; multiplies vertex color
  bumpMap: THREE.Texture; // fine grain relief for the raking key light
}

export function makeSnowTextures(anisotropy = 1): SnowTextures {
  // COLOR: near-white with a cool mottle in the dips, so the vertex-color
  // palette (crud periwinkle, glacier blue) still owns the hue, and sparse
  // full-white glint pixels that catch the sun (and, at their brightest,
  // the bloom threshold) like real snow crystals.
  const mottle = fractalNoise(11, [
    { cells: 8, weight: 0.55 },
    { cells: 21, weight: 0.3 },
    { cells: 55, weight: 0.15 },
  ]);
  const color = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = 0.86 + 0.14 * mottle[i]!; // subtle: value stays within 14%
    color[i * 4] = Math.round(242 * v);
    color[i * 4 + 1] = Math.round(247 * v);
    color[i * 4 + 2] = Math.round(255 * Math.min(1, v + 0.03)); // dips go cool
    color[i * 4 + 3] = 255;
  }
  const glintRand = mulberry32(4242);
  for (let n = 0; n < 700; n++) {
    const i = Math.floor(glintRand() * SIZE * SIZE);
    color[i * 4] = color[i * 4 + 1] = color[i * 4 + 2] = 255;
  }

  // BUMP: independent, finer-grained noise — chopped crystal relief that the
  // low key light rakes across. flatShading keeps the faceted look; the bump
  // rides on top of each facet.
  const grain = fractalNoise(23, [
    { cells: 34, weight: 0.45 },
    { cells: 89, weight: 0.55 },
  ]);
  const bump = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const g = Math.round(255 * grain[i]!);
    bump[i * 4] = bump[i * 4 + 1] = bump[i * 4 + 2] = g;
    bump[i * 4 + 3] = 255;
  }

  return {
    map: makeTexture(color, THREE.SRGBColorSpace, anisotropy),
    bumpMap: makeTexture(bump, THREE.NoColorSpace, anisotropy),
  };
}
