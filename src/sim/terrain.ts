import { hash2, mulberry32 } from './rng';

// World layout: +y is up, the skier travels toward -z. The course is an
// SSX-style walled channel floating in the sky: a curving centerline with a
// U-shaped cross-section whose banked walls are rideable near the floor and
// steepen into containment further out. Chunk i covers
// z in [-(i+1) * CHUNK_LENGTH, -i * CHUNK_LENGTH).
export const CHUNK_LENGTH = 40;
export const CHANNEL_HALF_WIDTH = 14; // half-width of the skiable floor
export const WALL_WIDTH = 10; // rideable bank beyond the floor edge

export const GRADE = 0.35; // average drop per meter of z

// Course curve: how far the centerline wanders and how fast.
const CURVE_AMP = 22;
const CURVE_WAVELENGTH = 260;
// The first stretch (and everything uphill of the start) stays straight so
// runs begin gently — and so physics tests have a predictable lab.
const STRAIGHT_UNTIL = 40;
const CURVE_RAMP = 80;

export interface Obstacle {
  x: number;
  z: number;
  radius: number; // collision radius
  height: number; // collision height above the snow; jumps must clear it
  kind: 'crystal' | 'bollard';
}

export interface Pickup {
  id: string;
  x: number;
  z: number;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class Terrain {
  private chunkObstacles = new Map<number, Obstacle[]>();
  private chunkPickups = new Map<number, Pickup[]>();

  constructor(readonly seed: number) {}

  // 1D value noise in [0, 1).
  private noise1(t: number, octave: number): number {
    const it = Math.floor(t);
    const ft = smoothstep(t - it);
    const s = this.seed ^ (octave * 0x9e3779b9);
    return hash2(s, it, 0) * (1 - ft) + hash2(s, it + 1, 0) * ft;
  }

  // 2D value noise in [0, 1).
  private noise2(x: number, z: number, octave: number): number {
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

  // Where the middle of the track is at this z.
  centerX(z: number): number {
    const t = Math.min(1, Math.max(0, (-z - STRAIGHT_UNTIL) / CURVE_RAMP));
    if (t === 0) return 0;
    return smoothstep(t) * (this.noise1(z / CURVE_WAVELENGTH, 1) - 0.5) * 2 * CURVE_AMP;
  }

  // Height of the track's spine: mean grade plus big rollers. Sharp enough
  // (amplitude vs wavelength) that crests genuinely launch a fast skier —
  // these are the track's built-in kickers.
  private baseY(z: number): number {
    return GRADE * z + (this.noise1(z / 55, 2) - 0.5) * 2 * 3.2;
  }

  height(x: number, z: number): number {
    const d = x - this.centerX(z);
    const a = Math.abs(d);
    // Floor: gentle mogul texture. Walls: quadratic bank that keeps
    // steepening past the rideable zone, so the course contains you without
    // any artificial clamp.
    let y = this.baseY(z) + (this.noise2(x / 9, z / 9, 3) - 0.5) * 2 * 0.12;
    const over = a - CHANNEL_HALF_WIDTH;
    if (over > 0) {
      y += 0.09 * over * over * (1 + Math.max(0, over - WALL_WIDTH) * 0.3);
    }
    return y;
  }

  // Numeric gradient so physics and rendering can never disagree with height().
  gradient(x: number, z: number): [number, number] {
    const e = 0.05;
    return [
      (this.height(x + e, z) - this.height(x - e, z)) / (2 * e),
      (this.height(x, z + e) - this.height(x, z - e)) / (2 * e),
    ];
  }

  // Negative indices are the straight run-in above the start line: valid
  // track, no obstacles, no pickups.
  chunkIndexAt(z: number): number {
    return Math.floor(-z / CHUNK_LENGTH);
  }

  obstaclesForChunk(index: number): Obstacle[] {
    const cached = this.chunkObstacles.get(index);
    if (cached) return cached;

    const obstacles: Obstacle[] = [];
    const zTop = -index * CHUNK_LENGTH;
    // Chunks 0 and 1 stay empty so every run starts in the open.
    if (index > 1) {
      const rng = mulberry32(Math.floor(hash2(this.seed, index, 7919) * 2 ** 31));
      const count = Math.min(3 + Math.floor(index / 4), 7);
      for (let t = 0; t < count; t++) {
        const z = zTop - rng() * CHUNK_LENGTH;
        const radius = 0.45 + rng() * 0.35;
        const kind = rng() < 0.5 ? 'crystal' : 'bollard';
        obstacles.push({
          x: this.centerX(z) + (rng() * 2 - 1) * (CHANNEL_HALF_WIDTH - 2.5),
          z,
          radius,
          height: kind === 'crystal' ? radius * 4.6 : 2.4,
          kind,
        });
      }
    }
    this.chunkObstacles.set(index, obstacles);
    return obstacles;
  }

  // All obstacles that could possibly collide with something at this z.
  obstaclesNear(z: number): Obstacle[] {
    const center = this.chunkIndexAt(z);
    const obstacles: Obstacle[] = [];
    for (let i = center - 1; i <= center + 1; i++) {
      obstacles.push(...this.obstaclesForChunk(i));
    }
    return obstacles;
  }

  // A line of floating score discs sweeping across the racing line.
  pickupsForChunk(index: number): Pickup[] {
    const cached = this.chunkPickups.get(index);
    if (cached) return cached;

    const pickups: Pickup[] = [];
    if (index > 0) {
      const rng = mulberry32(Math.floor(hash2(this.seed, index, 104729) * 2 ** 31));
      const from = (rng() * 2 - 1) * (CHANNEL_HALF_WIDTH - 4);
      const to = (rng() * 2 - 1) * (CHANNEL_HALF_WIDTH - 4);
      const count = 7;
      for (let k = 0; k < count; k++) {
        const t = k / (count - 1);
        const z = -index * CHUNK_LENGTH - 4 - t * (CHUNK_LENGTH - 8);
        pickups.push({
          id: `${index}:${k}`,
          x: this.centerX(z) + from + (to - from) * smoothstep(t),
          z,
        });
      }
    }
    this.chunkPickups.set(index, pickups);
    return pickups;
  }

  pickupsNear(z: number): Pickup[] {
    const center = this.chunkIndexAt(z);
    const pickups: Pickup[] = [];
    for (let i = center - 1; i <= center + 1; i++) {
      pickups.push(...this.pickupsForChunk(i));
    }
    return pickups;
  }
}
