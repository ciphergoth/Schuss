import { hash2, mulberry32 } from './rng';

// World layout: +y is up, the skier travels toward -z. The course is an
// SSX-style walled channel floating in the sky: a curving centerline with a
// U-shaped cross-section whose banked walls are rideable near the floor and
// steepen into containment further out. Chunk i covers
// z in [-(i+1) * CHUNK_LENGTH, -i * CHUNK_LENGTH).
export const CHUNK_LENGTH = 40;
// The floor breathes: tight canyons open into wide playgrounds.
export const BASE_HALF_WIDTH = 15;
export const WIDTH_SWING = 5; // half-width ranges BASE +- SWING (10..20)
export const MAX_HALF_WIDTH = BASE_HALF_WIDTH + WIDTH_SWING;
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
  y: number; // absolute height; gems float in flight arcs, coins hug the floor
  gem: boolean; // gems are the airborne reward: worth more, need a jump
}

export interface Jump {
  zLip: number; // the edge you fly off; the ramp rises toward it from +z
  xOffset: number; // kicker center relative to the track centerline
  halfWidth: number; // lateral half-size of the full-height core
}

// The speed the golden path is designed around: gem arcs are computed from
// the flight you fly arriving at a kicker at this speed. Faster overshoots
// the early gems slightly, slower undershoots the late ones — arrive on-plan
// and the whole arc threads.
export const PLAN_SPEED = 20;

// Kicker geometry: a concave ramp (steepening toward the lip) then a sheer
// drop. Kickers are features, not toll booths: each occupies a slice of the
// floor at a seeded offset, something you steer toward to take the air.
export const JUMP_RAMP_LENGTH = 14;
export const JUMP_LIP_HEIGHT = 2.2;
const JUMP_EDGE = 1.8; // soft shoulder from full height to flat floor

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

  // How wide the skiable floor is at this z.
  channelHalfWidth(z: number): number {
    return BASE_HALF_WIDTH + (this.noise1(z / 140, 4) - 0.5) * 2 * WIDTH_SWING;
  }

  // The direction the course itself is heading at this z (heading convention:
  // 0 = straight down -z).
  trackHeading(z: number): number {
    return Math.atan2(this.centerX(z - 1) - this.centerX(z + 1), 2);
  }

  // THE GOLDEN PATH: the intended line through the course, as an offset from
  // the centerline. Every generator derives from it — kickers sit on it, the
  // crud-free corridor follows it, coins trace it, gem arcs assume you fly
  // off its kickers at PLAN_SPEED. Ski it and the course pays; leave it and
  // crud, distance, and missed rewards are the price.
  planOffset(z: number): number {
    return (this.noise1(z / 90, 6) - 0.5) * 2 * (this.channelHalfWidth(z) - 6);
  }

  // Height of the track's spine: mean grade plus big rollers. Sharp enough
  // (amplitude vs wavelength) that crests genuinely launch a fast skier —
  // these are the track's built-in kickers.
  private baseY(z: number): number {
    return GRADE * z + (this.noise1(z / 55, 2) - 0.5) * 2 * 3.2;
  }

  // A ski jump every few chunks, deterministic per seed. The whole ramp fits
  // inside its chunk, so height() only ever consults one chunk's jump.
  private hasJumpSeed(index: number): boolean {
    return index >= 3 && hash2(this.seed, index, 31337) < 0.25;
  }

  jumpForChunk(index: number): Jump | null {
    // No consecutive jump chunks: a fast flight covers up to ~40m, so
    // back-to-back kickers could be overflown entirely — the plan never
    // schedules a feature you can accidentally skip.
    if (!this.hasJumpSeed(index) || this.hasJumpSeed(index - 1)) return null;
    const zLip = -index * CHUNK_LENGTH - 24;
    const halfWidth = 3.0 + hash2(this.seed, index, 31338) * 1.5;
    const maxOffset = Math.max(0, this.channelHalfWidth(zLip) - halfWidth - JUMP_EDGE - 0.5);
    // The kicker sits on the golden path: following the plan lines you up.
    const xOffset = Math.max(-maxOffset, Math.min(maxOffset, this.planOffset(zLip)));
    return { zLip, xOffset, halfWidth };
  }

  private jumpHeight(d: number, z: number): number {
    const jump = this.jumpForChunk(this.chunkIndexAt(z));
    if (!jump) return 0;
    const u = z - jump.zLip; // distance uphill of the lip
    if (u < 0 || u > JUMP_RAMP_LENGTH) return 0;
    const rise = 1 - u / JUMP_RAMP_LENGTH;
    // Full height across the kicker's core, soft shoulders down to the floor.
    const lateral = Math.abs(d - jump.xOffset) - jump.halfWidth;
    if (lateral >= JUMP_EDGE) return 0;
    const fade = lateral <= 0 ? 1 : smoothstep(1 - lateral / JUMP_EDGE);
    return JUMP_LIP_HEIGHT * rise * rise * fade;
  }

  // Is this point on the clean approach to (or the ramp of) a kicker? Crud
  // must never gate a jump you've committed to. The approach lane extends
  // uphill past the ramp, possibly into the previous chunk.
  private inJumpLane(d: number, z: number): boolean {
    const index = this.chunkIndexAt(z);
    for (const i of [index, index + 1]) {
      const jump = this.jumpForChunk(i);
      if (!jump) continue;
      const u = z - jump.zLip;
      if (u < 0 || u > JUMP_RAMP_LENGTH + 22) continue;
      if (Math.abs(d - jump.xOffset) < jump.halfWidth + 2) return true;
    }
    return false;
  }

  // Slow crud: 0 = fast racing snow, 1 = full sticky. The banks are made of
  // it (drifting wide costs speed, never stops you), and seeded patches
  // dapple the floor as the thing you steer around. Three guarantees:
  // kicker ramps and their approaches stay clean, and a clean racing line
  // always snakes through — crud never walls off the whole course. (Crud
  // BELOW a kicker's flight path is fair game: jump it.)
  stickinessAt(x: number, z: number): number {
    const d = x - this.centerX(z);
    const wall = Math.min(1, Math.max(0, (Math.abs(d) - this.channelHalfWidth(z)) / 4));
    let patch = 0;
    if (z < -80 && this.jumpHeight(d, z) === 0 && !this.inJumpLane(d, z)) {
      const n = this.noise2(x / 13, z / 13, 5);
      patch = smoothstep(Math.min(1, Math.max(0, (n - 0.62) / 0.1)));
      // The guaranteed clean corridor IS the golden path.
      const laneDist = Math.abs(d - this.planOffset(z));
      patch *= smoothstep(Math.min(1, Math.max(0, (laneDist - 3.5) / 2)));
    }
    return Math.max(wall, patch);
  }

  height(x: number, z: number): number {
    const d = x - this.centerX(z);
    const a = Math.abs(d);
    // Floor: gentle mogul texture plus any kicker ramp. Walls: quadratic bank
    // that keeps steepening past the rideable zone, so the course contains
    // you without any artificial clamp.
    let y = this.baseY(z) + (this.noise2(x / 9, z / 9, 3) - 0.5) * 2 * 0.12;
    y += this.jumpHeight(d, z);
    const over = a - this.channelHalfWidth(z);
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
      const jump = this.jumpForChunk(index);
      // Obstacles are nearly extinct: at most one, in roughly a third of the
      // chunks past the opening stretch. Crud is the steering challenge; the
      // course gets decorated with fun instead later.
      const count = index >= 6 && hash2(this.seed, index, 857) < 0.3 ? 1 : 0;
      for (let t = 0; t < count; t++) {
        const z = zTop - rng() * CHUNK_LENGTH;
        const d = (rng() * 2 - 1) * (this.channelHalfWidth(z) - 2.5);
        const radius = 0.45 + rng() * 0.35;
        const kind = rng() < 0.5 ? 'crystal' : 'bollard';
        // Never on a kicker's footprint: an obstacle hidden on a ramp face
        // would punish exactly the commitment the jump invites.
        if (
          jump &&
          z > jump.zLip - 3 &&
          z < jump.zLip + JUMP_RAMP_LENGTH + 3 &&
          Math.abs(d - jump.xOffset) < jump.halfWidth + 3
        ) {
          continue;
        }
        obstacles.push({
          x: this.centerX(z) + d,
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

  // Coins sweep across the racing line; gems hang in the flight arc past
  // each kicker lip — jump as you come off and thread them for the reward.
  pickupsForChunk(index: number): Pickup[] {
    const cached = this.chunkPickups.get(index);
    if (cached) return cached;

    const pickups: Pickup[] = [];
    if (index > 0) {
      // Coins are temptations, not breadcrumbs: figuring out the golden path
      // is gameplay (read the clean snow, sight the kicker gates), so coins
      // sit in sparse clusters OFF the plan — a paid detour, not a guide.
      const rng = mulberry32(Math.floor(hash2(this.seed, index, 104729) * 2 ** 31));
      if (rng() < 0.7) {
        const zCluster = -index * CHUNK_LENGTH - 8 - rng() * (CHUNK_LENGTH - 16);
        const side = rng() < 0.5 ? -1 : 1;
        const detour = side * (4.5 + rng() * 4.5);
        for (let k = 0; k < 3; k++) {
          const z = zCluster - k * 3;
          const bound = this.channelHalfWidth(z) - 3;
          const x =
            this.centerX(z) + Math.max(-bound, Math.min(bound, this.planOffset(z) + detour));
          pickups.push({ id: `${index}:${k}`, x, z, y: this.height(x, z) + 1.1, gem: false });
        }
      }

      const jump = this.jumpForChunk(index);
      if (jump) {
        // Gems sit on the exact ballistic arc of a skier who takes this
        // kicker on-plan at PLAN_SPEED, mirroring the sim's launch caps.
        const core = this.centerX(jump.zLip) + jump.xOffset;
        const yLip = this.height(core, jump.zLip + 0.02);
        const riseTowardLip =
          (this.height(core, jump.zLip + 0.02) - this.height(core, jump.zLip + 1)) / 0.98;
        let v = PLAN_SPEED;
        let vy = Math.min(riseTowardLip, 0.35) * PLAN_SPEED;
        if (vy > 0) {
          const scale = v / Math.hypot(v, vy);
          v *= scale;
          vy *= scale;
        }
        const heading = this.trackHeading(jump.zLip);
        for (let k = 0; k < 3; k++) {
          const t = 0.16 * (k + 1);
          pickups.push({
            id: `${index}:g${k}`,
            x: core + Math.sin(heading) * v * t,
            z: jump.zLip - Math.cos(heading) * v * t,
            y: yLip + vy * t - 4.905 * t * t,
            gem: true,
          });
        }
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
