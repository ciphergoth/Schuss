import { hash2, mulberry32 } from './rng';

// World layout: +y is up, the skier travels toward -z. The slope is an endless
// corridor along z, generated chunk by chunk. Chunk i covers
// z in [-(i+1) * CHUNK_LENGTH, -i * CHUNK_LENGTH).
export const CHUNK_LENGTH = 40;
export const CORRIDOR_HALF_WIDTH = 30;

export const GRADE = 0.35; // average drop per meter of z

export interface Tree {
  x: number;
  z: number;
  radius: number; // collision radius of the trunk
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class Terrain {
  private chunkTrees = new Map<number, Tree[]>();

  constructor(readonly seed: number) {}

  // Value noise in [0, 1): hashed lattice values, smoothly interpolated.
  private noise(x: number, z: number, octave: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = smoothstep(x - ix);
    const fz = smoothstep(z - iz);
    const s = this.seed ^ (octave * 0x9e3779b9);
    const n00 = hash2(s, ix, iz);
    const n10 = hash2(s, ix + 1, iz);
    const n01 = hash2(s, ix, iz + 1);
    const n11 = hash2(s, ix + 1, iz + 1);
    return (n00 * (1 - fx) + n10 * fx) * (1 - fz) + (n01 * (1 - fx) + n11 * fx) * fz;
  }

  height(x: number, z: number): number {
    // Rolls are the jump ramps; moguls stay gentle so they read as texture
    // rather than launching the skier off every bump.
    const rolls = (this.noise(x / 30, z / 30, 1) - 0.5) * 2 * 1.2;
    const moguls = (this.noise(x / 10, z / 10, 2) - 0.5) * 2 * 0.15;
    return GRADE * z + rolls + moguls;
  }

  // Numeric gradient so physics and rendering can never disagree with height().
  gradient(x: number, z: number): [number, number] {
    const e = 0.05;
    return [
      (this.height(x + e, z) - this.height(x - e, z)) / (2 * e),
      (this.height(x, z + e) - this.height(x, z - e)) / (2 * e),
    ];
  }

  // Negative indices are the slope uphill of the start line: valid terrain,
  // forest walls, but never any interior trees (index > 0 guards that).
  chunkIndexAt(z: number): number {
    return Math.floor(-z / CHUNK_LENGTH);
  }

  treesForChunk(index: number): Tree[] {
    const cached = this.chunkTrees.get(index);
    if (cached) return cached;

    const rng = mulberry32(Math.floor(hash2(this.seed, index, 7919) * 2 ** 31));
    const trees: Tree[] = [];
    const zTop = -index * CHUNK_LENGTH; // uphill edge of the chunk

    // Interior trees, slowly getting denser as the run goes on. Chunk 0 stays
    // empty so every run starts in the open.
    if (index > 0) {
      const count = Math.min(6 + Math.floor(index / 3), 16);
      for (let t = 0; t < count; t++) {
        trees.push({
          x: (rng() * 2 - 1) * (CORRIDOR_HALF_WIDTH - 3),
          z: zTop - rng() * CHUNK_LENGTH,
          radius: 0.4 + rng() * 0.4,
        });
      }
    }

    // Two staggered rows of forest wall on each side mark the edge of the run.
    for (const side of [-1, 1]) {
      for (let k = 0; k < CHUNK_LENGTH / 4; k++) {
        for (const offset of [0, 3]) {
          trees.push({
            x: side * (CORRIDOR_HALF_WIDTH + offset + (rng() * 2 - 1) * 1.2),
            z: zTop - k * 4 - rng() * 2 - (offset ? 2 : 0),
            radius: 0.6,
          });
        }
      }
    }

    this.chunkTrees.set(index, trees);
    return trees;
  }

  // All trees that could possibly collide with something at this z.
  treesNear(z: number): Tree[] {
    const center = this.chunkIndexAt(z);
    const trees: Tree[] = [];
    for (let i = center - 1; i <= center + 1; i++) {
      trees.push(...this.treesForChunk(i));
    }
    return trees;
  }
}
