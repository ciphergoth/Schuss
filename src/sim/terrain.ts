import { hash2, mulberry32 } from './rng';

// World layout: +y is up, the skier travels toward -z. The course is an
// SSX-style walled channel floating in the sky: a curving centerline with a
// U-shaped cross-section whose banked walls are rideable near the floor and
// steepen into containment further out. Chunk i covers
// z in [-(i+1) * CHUNK_LENGTH, -i * CHUNK_LENGTH).
export const CHUNK_LENGTH = 40;
export const WALL_WIDTH = 10; // rideable bank beyond the floor edge

export const GRADE = 0.35; // average drop per meter of z

// ---------------------------------------------------------------------------
// SECTIONS: every 400m the course takes on a personality — the Narrows
// squeeze, the Bowl blows open, the Plunge steepens, the Steps terrace, the
// Sweeper throws banked S-turns. Every generator parameter derives from the
// section, and continuous quantities cross-fade over the last 60m of each
// section so the heightfield never jumps. Section 0 (and everything uphill)
// is always 'cruise': runs open gently and physics tests keep their lab.
// The framework is deliberately extensible: a finish-line section or a
// section with moving hazards is just another SectionSpec later.
// ---------------------------------------------------------------------------
export const SECTION_LENGTH = 400;
const SECTION_BLEND = 0.15; // fraction of the section that fades into the next

export type SectionType = 'cruise' | 'narrows' | 'bowl' | 'plunge' | 'steps' | 'sweeper';

interface SectionSpec {
  half: number; // mean floor half-width
  swing: number; // breathing around the mean
  curveAmp: number; // centerline wander amplitude
  rollerScale: number; // how loud the built-in rollers are
  extraDrop: number; // extra meters lost across the section (plunge)
  terraced: boolean; // steps: fixed terrace drops instead of smooth grade
  kickerChance: number; // per-chunk odds of a kicker
  kickerKinds: readonly JumpKind[]; // sizes this section deals
  obstacleChance: number;
  obstacleCount: number;
  crudThreshold: number; // higher = cleaner snow (patch noise cutoff)
}

const TERRACE_LENGTH = 50;
const TERRACE_DROP = 3.5;
const TERRACE_EDGE = 6;
const TERRACE_TOTAL = (SECTION_LENGTH / TERRACE_LENGTH) * TERRACE_DROP;

const SECTION_SPECS: Record<SectionType, SectionSpec> = {
  // The baseline course this game grew up on.
  cruise: {
    half: 15,
    swing: 4,
    curveAmp: 22,
    rollerScale: 1,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0.25,
    kickerKinds: ['S', 'M', 'M', 'L'],
    obstacleChance: 0.3,
    obstacleCount: 1,
    crudThreshold: 0.62,
  },
  // High walls, no room, pure nerve. Nothing in the corridor but you.
  narrows: {
    half: 7,
    swing: 1,
    curveAmp: 13,
    rollerScale: 0.8,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0,
    kickerKinds: [],
    obstacleChance: 0,
    obstacleCount: 0,
    crudThreshold: 0.95,
  },
  // The playground: wide open, obstacle slaloms, kickers of every size.
  bowl: {
    half: 27,
    swing: 4,
    curveAmp: 10,
    rollerScale: 1,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0.35,
    kickerKinds: ['S', 'M', 'L'],
    obstacleChance: 0.8,
    obstacleCount: 3,
    crudThreshold: 0.55,
  },
  // The grade breaks away mid-section: raw speed, clean snow, big Ls only.
  plunge: {
    half: 17,
    swing: 3,
    curveAmp: 26,
    rollerScale: 0.7,
    extraDrop: 70,
    terraced: false,
    kickerChance: 0.12,
    kickerKinds: ['L'],
    obstacleChance: 0,
    obstacleCount: 0,
    crudThreshold: 0.78,
  },
  // Giant terraces; every edge is a launch with a landing below.
  steps: {
    half: 15,
    swing: 3,
    curveAmp: 8,
    rollerScale: 0.35,
    extraDrop: 0,
    terraced: true,
    kickerChance: 0,
    kickerKinds: [],
    obstacleChance: 0,
    obstacleCount: 0,
    crudThreshold: 0.7,
  },
  // Big banked S-turns where carving the wall is the racing line.
  sweeper: {
    half: 13,
    swing: 2,
    curveAmp: 20,
    rollerScale: 0.8,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0.18,
    kickerKinds: ['S', 'M'],
    obstacleChance: 0.25,
    obstacleCount: 1,
    crudThreshold: 0.62,
  },
};

const SECTION_ORDER: readonly SectionType[] = [
  'cruise',
  'narrows',
  'bowl',
  'plunge',
  'steps',
  'sweeper',
];

// Superelevation: floor cross-slope per unit of centerline curvature, capped
// so the bank helps the carve without becoming a wall of its own.
const BANK_GAIN = 9;
const BANK_MAX_SLOPE = 0.26;

// The sweeper's deliberate S-curve: the wandering noise is too lazy to bend
// hard enough to bank, so sweeper sections add real sine turns — two full
// S's per section, eased in and out at the boundaries.
const SWEEP_AMP = 30;
const SWEEP_WAVELENGTH = 200;
const SWEEP_EASE = 70;

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
  y: number; // absolute height; coins hug the floor
}

// SSX-style trick bonuses: stars on the arc a lip-popped jump flies. x3 takes
// a decent pop; x5 demands the pop AND real speed. Grabbing one arms a points
// multiplier that waits for the next trick attempt.
export interface TrickBonus {
  id: string;
  x: number;
  z: number;
  y: number;
  mult: 3 | 5;
}

// Kickers now come in personalities: three sizes, plus an optional step-down
// landing — the ground past the lip falls away for float and a soft catch.
// (Hip kickers — yawed ramps that throw the flight across the track — wait
// on a physics addition: a pure heightfield yaw can't redirect a kinematic
// skier's heading, so the "throw" would be a lie.)
export type JumpKind = 'S' | 'M' | 'L';

interface JumpGeometry {
  rampLength: number;
  lipHeight: number;
}

const JUMP_GEOMETRY: Record<JumpKind, JumpGeometry> = {
  S: { rampLength: 10, lipHeight: 1.5 },
  M: { rampLength: 14, lipHeight: 2.2 },
  L: { rampLength: 19, lipHeight: 3.2 },
};

export interface Jump {
  zLip: number; // the edge you fly off; the ramp rises toward it from +z
  xOffset: number; // kicker center relative to the track centerline
  halfWidth: number; // lateral half-size of the full-height core
  kind: JumpKind;
  rampLength: number;
  lipHeight: number;
  stepDown: number; // extra drop scooped out of the landing (0 = flat kicker)
}

const JUMP_EDGE = 1.8; // soft shoulder from full height to flat floor
const SCOOP_EDGE = 5; // step-down landings get wide, gentle shoulders

// Star placement per kicker size, tuned against simulated flight arcs (see
// boost.test's rideKicker): distance past the lip along the flight line and
// height above the lip. The x3 rewards any clean lip pop; the x5 is placed
// where only a popped jump still at speed is flying.
const STAR_TABLE: Record<JumpKind, { d3: number; h3: number; d5: number; h5: number }> = {
  // The S flies low and flat, so its stars sit far rather than high.
  S: { d3: 17, h3: 0.8, d5: 25, h5: 0.2 },
  M: { d3: 13, h3: 1.6, d5: 24, h5: 0.5 },
  L: { d3: 18, h3: 1.6, d5: 28, h5: 0.4 },
};

// Course curve: how fast the centerline wanders (amplitude is per-section).
const CURVE_WAVELENGTH = 260;
// The first stretch (and everything uphill of the start) stays straight so
// runs begin gently — and so physics tests have a predictable lab.
const STRAIGHT_UNTIL = 40;
const CURVE_RAMP = 80;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export class Terrain {
  private chunkObstacles = new Map<number, Obstacle[]>();
  private chunkPickups = new Map<number, Pickup[]>();
  private chunkBonuses = new Map<number, TrickBonus[]>();
  private chunkJumps = new Map<number, Jump | null>();
  private sectionTypes = new Map<number, SectionType>();
  private sectionDrops = new Map<number, number>();

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

  // Which section a z belongs to; negative indices are the uphill run-in.
  sectionIndexAt(z: number): number {
    return Math.floor(-z / SECTION_LENGTH);
  }

  // The personality of section s. Deterministic, never repeats its
  // predecessor (a Narrows into a Narrows would just be one long Narrows).
  sectionType(s: number): SectionType {
    if (s <= 0) return 'cruise';
    const cached = this.sectionTypes.get(s);
    if (cached) return cached;
    const prev = this.sectionType(s - 1);
    const roll = Math.floor(hash2(this.seed, s, 6011) * SECTION_ORDER.length);
    let type = SECTION_ORDER[roll % SECTION_ORDER.length]!;
    if (type === prev) type = SECTION_ORDER[(roll + 1) % SECTION_ORDER.length]!;
    this.sectionTypes.set(s, type);
    return type;
  }

  private spec(s: number): SectionSpec {
    return SECTION_SPECS[this.sectionType(s)];
  }

  // A section-driven scalar, cross-faded through the tail of each section so
  // width, curve and grade never step discontinuously.
  private sectionParam(z: number, pick: (spec: SectionSpec) => number): number {
    const u = -z / SECTION_LENGTH;
    if (u <= 0) return pick(SECTION_SPECS.cruise);
    const s = Math.floor(u);
    const f = u - s;
    const a = pick(this.spec(s));
    if (f < 1 - SECTION_BLEND) return a;
    const b = pick(this.spec(s + 1));
    return a + (b - a) * smoothstep((f - (1 - SECTION_BLEND)) / SECTION_BLEND);
  }

  // Total extra height lost to plunges and terraces in sections above s.
  private dropBefore(s: number): number {
    if (s <= 0) return 0;
    const cached = this.sectionDrops.get(s);
    if (cached !== undefined) return cached;
    const spec = this.spec(s - 1);
    const drop = this.dropBefore(s - 1) + spec.extraDrop + (spec.terraced ? TERRACE_TOTAL : 0);
    this.sectionDrops.set(s, drop);
    return drop;
  }

  // Extra drop accrued inside the current section: an S-curve for plunges
  // (steepest mid-section, easing out at both ends — C1 by construction) and
  // the terrace staircase for steps.
  private sectionDrop(z: number): number {
    const s = this.sectionIndexAt(z);
    if (s < 0) return 0;
    const spec = this.spec(s);
    let drop = this.dropBefore(s);
    const local = -z - s * SECTION_LENGTH;
    if (spec.extraDrop > 0) {
      drop += spec.extraDrop * smoothstep(local / SECTION_LENGTH);
    }
    if (spec.terraced) {
      const k = Math.floor(local / TERRACE_LENGTH);
      const within = local - k * TERRACE_LENGTH;
      const edge = clamp01((within - (TERRACE_LENGTH - TERRACE_EDGE)) / TERRACE_EDGE);
      drop += TERRACE_DROP * (k + smoothstep(edge));
    }
    return drop;
  }

  // Sweeper sections carve deliberate S-turns on top of the noise wander;
  // zero (with zero slope) at both section boundaries by construction.
  private sweeperSwing(z: number): number {
    const s = this.sectionIndexAt(z);
    if (s < 1 || this.sectionType(s) !== 'sweeper') return 0;
    const local = -z - s * SECTION_LENGTH;
    const ease =
      smoothstep(clamp01(local / SWEEP_EASE)) *
      smoothstep(clamp01((SECTION_LENGTH - local) / SWEEP_EASE));
    return ease * SWEEP_AMP * Math.sin((local / SWEEP_WAVELENGTH) * Math.PI * 2);
  }

  // Where the middle of the track is at this z.
  centerX(z: number): number {
    const t = Math.min(1, Math.max(0, (-z - STRAIGHT_UNTIL) / CURVE_RAMP));
    if (t === 0) return 0;
    const amp = this.sectionParam(z, (spec) => spec.curveAmp);
    return (
      smoothstep(t) * (this.noise1(z / CURVE_WAVELENGTH, 1) - 0.5) * 2 * amp + this.sweeperSwing(z)
    );
  }

  // How wide the skiable floor is at this z.
  channelHalfWidth(z: number): number {
    const half = this.sectionParam(z, (spec) => spec.half);
    const swing = this.sectionParam(z, (spec) => spec.swing);
    return half + (this.noise1(z / 140, 4) - 0.5) * 2 * swing;
  }

  // The direction the course itself is heading at this z (heading convention:
  // 0 = straight down -z).
  trackHeading(z: number): number {
    return Math.atan2(this.centerX(z - 1) - this.centerX(z + 1), 2);
  }

  // Signed centerline curvature; drives the banking.
  private curvature(z: number): number {
    return (this.centerX(z - 4) - 2 * this.centerX(z) + this.centerX(z + 4)) / 16;
  }

  // THE GOLDEN PATH: the intended line through the course, as an offset from
  // the centerline. Every generator derives from it — kickers sit on it, the
  // crud-free corridor follows it. It is deliberately unmarked: reading the
  // clean snow and the kicker gates to find it IS the game. Coins sit off it
  // as paid detours.
  planOffset(z: number): number {
    return (this.noise1(z / 90, 6) - 0.5) * 2 * Math.max(1, this.channelHalfWidth(z) - 6);
  }

  // Height of the track's spine: mean grade, section drops (plunges,
  // terraces) plus big rollers. Rollers are sharp enough that crests
  // genuinely launch a fast skier — the track's built-in kickers.
  private baseY(z: number): number {
    const rollers = this.sectionParam(z, (spec) => spec.rollerScale);
    return GRADE * z - this.sectionDrop(z) + (this.noise1(z / 55, 2) - 0.5) * 2 * 3.2 * rollers;
  }

  // Does this chunk roll a kicker? Odds depend on its section — some
  // sections deal none at all.
  private rollsJump(index: number): boolean {
    if (index < 3) return false;
    const zLip = -index * CHUNK_LENGTH - 24;
    const chance = SECTION_SPECS[this.sectionType(this.sectionIndexAt(zLip))].kickerChance;
    return hash2(this.seed, index, 31337) < chance;
  }

  jumpForChunk(index: number): Jump | null {
    const cached = this.chunkJumps.get(index);
    if (cached !== undefined) return cached;
    // No consecutive jump chunks: a fast flight covers up to ~40m, so
    // back-to-back kickers could be overflown entirely — the plan never
    // schedules a feature you can accidentally skip.
    if (!this.rollsJump(index) || this.rollsJump(index - 1)) {
      this.chunkJumps.set(index, null);
      return null;
    }
    const zLip = -index * CHUNK_LENGTH - 24;
    const section = SECTION_SPECS[this.sectionType(this.sectionIndexAt(zLip))];
    const halfChannel = this.channelHalfWidth(zLip);
    // The opening section deals only the classic flat M: the first kicker a
    // run meets is the tutorial kicker (and the physics tests' venue).
    const opening = zLip > -SECTION_LENGTH;
    const kinds =
      opening || section.kickerKinds.length === 0 ? ['M' as const] : section.kickerKinds;
    const kind = kinds[Math.floor(hash2(this.seed, index, 4451) * kinds.length)]!;
    const { rampLength, lipHeight } = JUMP_GEOMETRY[kind];
    const halfWidth = 3.0 + hash2(this.seed, index, 31338) * 1.5;
    const maxOffset = Math.max(0, halfChannel - halfWidth - JUMP_EDGE - 0.5);
    // The kicker sits on the golden path: following the plan lines you up.
    const xOffset = Math.max(-maxOffset, Math.min(maxOffset, this.planOffset(zLip)));
    const variantRoll = hash2(this.seed, index, 7333);
    const stepDown = !opening && kind !== 'S' && variantRoll < 0.3 ? lipHeight * 1.6 : 0;
    const jump: Jump = { zLip, xOffset, halfWidth, kind, rampLength, lipHeight, stepDown };
    this.chunkJumps.set(index, jump);
    return jump;
  }

  // The kicker's contribution to the heightfield: the ramp rising to the lip
  // (in the ramp's own, possibly hip-yawed frame) and, for step-downs, the
  // landing scooped out past the lip. The scoop can spill into the next
  // chunk, so shapes from this chunk's jump AND the uphill neighbor's apply.
  private kickerShape(d: number, z: number): number {
    const index = this.chunkIndexAt(z);
    let y = 0;
    for (const i of [index, index - 1]) {
      const jump = this.jumpForChunk(i);
      if (!jump) continue;
      const p = d - jump.xOffset; // lateral offset from the kicker core
      const q = z - jump.zLip; // uphill distance from the lip
      if (q >= 0 && q <= jump.rampLength) {
        const rise = 1 - q / jump.rampLength;
        const lateral = Math.abs(p) - jump.halfWidth;
        if (lateral < JUMP_EDGE) {
          const fade = lateral <= 0 ? 1 : smoothstep(1 - lateral / JUMP_EDGE);
          y += jump.lipHeight * rise * rise * fade;
        }
      }
      // Step-down scoop: the floor past the lip falls away and gently
      // returns, so the flight floats and the catch is soft.
      if (jump.stepDown > 0 && q < 0) {
        const v = -q;
        const depth = smoothstep(clamp01(v / 10)) - smoothstep(clamp01((v - 24) / 14));
        if (depth > 0) {
          const lateral = Math.abs(p) - (jump.halfWidth + 2);
          if (lateral < SCOOP_EDGE) {
            const fade = lateral <= 0 ? 1 : smoothstep(1 - lateral / SCOOP_EDGE);
            y -= jump.stepDown * depth * fade;
          }
        }
      }
    }
    return y;
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
      if (u < 0 || u > jump.rampLength + 22) continue;
      if (Math.abs(d - jump.xOffset) < jump.halfWidth + 2) return true;
    }
    return false;
  }

  // Slow crud: 0 = fast racing snow, 1 = full sticky. The banks are made of
  // it (drifting wide costs speed, never stops you), and seeded patches
  // dapple the floor as the thing you steer around — denser in the open
  // Bowls, nearly absent in the Narrows and the Plunge. Three guarantees:
  // kicker ramps and their approaches stay clean, and a clean racing line
  // always snakes through — crud never walls off the whole course. (Crud
  // BELOW a kicker's flight path is fair game: jump it.)
  stickinessAt(x: number, z: number): number {
    const d = x - this.centerX(z);
    const wall = Math.min(1, Math.max(0, (Math.abs(d) - this.channelHalfWidth(z)) / 4));
    let patch = 0;
    if (z < -80 && this.kickerShape(d, z) === 0 && !this.inJumpLane(d, z)) {
      const threshold = this.sectionParam(z, (spec) => spec.crudThreshold);
      const n = this.noise2(x / 13, z / 13, 5);
      patch = smoothstep(Math.min(1, Math.max(0, (n - threshold) / 0.1)));
      // The guaranteed clean corridor IS the golden path.
      const laneDist = Math.abs(d - this.planOffset(z));
      patch *= smoothstep(Math.min(1, Math.max(0, (laneDist - 3.5) / 2)));
    }
    return Math.max(wall, patch);
  }

  height(x: number, z: number): number {
    const d = x - this.centerX(z);
    const a = Math.abs(d);
    const half = this.channelHalfWidth(z);
    // Floor: gentle mogul texture plus any kicker shape, superelevated
    // through curves (the bank tilts into the turn, so carving the wall is
    // the racing line through a sweeper). Walls: quadratic bank that keeps
    // steepening past the rideable zone, so the course contains you without
    // any artificial clamp.
    let y = this.baseY(z) + (this.noise2(x / 9, z / 9, 3) - 0.5) * 2 * 0.12;
    y += this.kickerShape(d, z);
    const bankSlope = Math.max(
      -BANK_MAX_SLOPE,
      Math.min(BANK_MAX_SLOPE, -BANK_GAIN * this.curvature(z))
    );
    y += bankSlope * Math.max(-half, Math.min(half, d));
    const over = a - half;
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
    // Chunks 0-5 stay empty so every run starts in the open.
    if (index >= 6) {
      const spec = SECTION_SPECS[this.sectionType(this.sectionIndexAt(zTop - CHUNK_LENGTH / 2))];
      const rng = mulberry32(Math.floor(hash2(this.seed, index, 7919) * 2 ** 31));
      const jump = this.jumpForChunk(index);
      const count = hash2(this.seed, index, 857) < spec.obstacleChance ? spec.obstacleCount : 0;
      for (let t = 0; t < count; t++) {
        const z = zTop - rng() * CHUNK_LENGTH;
        const d = (rng() * 2 - 1) * (this.channelHalfWidth(z) - 2.5);
        const radius = 0.45 + rng() * 0.35;
        const kind = rng() < 0.5 ? 'crystal' : 'bollard';
        // Never on a kicker's footprint: an obstacle hidden on a ramp face
        // (or in a step-down's landing) would punish exactly the commitment
        // the jump invites.
        if (
          jump &&
          z > jump.zLip - 40 &&
          z < jump.zLip + jump.rampLength + 3 &&
          Math.abs(d - jump.xOffset) < jump.halfWidth + 8
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

  // Coins sweep across the racing line in sparse clusters OFF the plan —
  // temptations, not breadcrumbs; figuring out the golden path is gameplay.
  // Bowls are richer, the Narrows nearly bare.
  pickupsForChunk(index: number): Pickup[] {
    const cached = this.chunkPickups.get(index);
    if (cached) return cached;

    const pickups: Pickup[] = [];
    if (index > 0) {
      const zMid = -index * CHUNK_LENGTH - CHUNK_LENGTH / 2;
      const type = this.sectionType(this.sectionIndexAt(zMid));
      const chance = type === 'bowl' ? 0.9 : type === 'narrows' ? 0.35 : 0.7;
      const rng = mulberry32(Math.floor(hash2(this.seed, index, 104729) * 2 ** 31));
      if (rng() < chance) {
        const zCluster = -index * CHUNK_LENGTH - 8 - rng() * (CHUNK_LENGTH - 16);
        const side = rng() < 0.5 ? -1 : 1;
        const detour = side * (4.5 + rng() * 4.5);
        for (let k = 0; k < 3; k++) {
          const z = zCluster - k * 3;
          const bound = Math.max(1, this.channelHalfWidth(z) - 3);
          const x =
            this.centerX(z) + Math.max(-bound, Math.min(bound, this.planOffset(z) + detour));
          pickups.push({ id: `${index}:${k}`, x, z, y: this.height(x, z) + 1.1 });
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

  // Trick-bonus stars past each kicker, along the lip's flight direction.
  bonusesForChunk(index: number): TrickBonus[] {
    const cached = this.chunkBonuses.get(index);
    if (cached) return cached;

    const bonuses: TrickBonus[] = [];
    const jump = this.jumpForChunk(index);
    if (jump) {
      const core = this.centerX(jump.zLip) + jump.xOffset;
      const yLip = this.height(core, jump.zLip + 0.02);
      const heading = this.trackHeading(jump.zLip);
      const along = (dist: number) => ({
        x: core + Math.sin(heading) * dist,
        z: jump.zLip - Math.cos(heading) * dist,
      });
      // Both stars sit ON the arc of a jump popped at the lip (which flies
      // nearly flat past it), so the reward is for TIMING, not for hopping
      // early — a pre-ramp hop crests before the lip and is meters below
      // these by the time it reaches them. Difficulty is distance: the x5
      // needs the lip pop AND real speed to still be up there. Placement
      // scales with the kicker (see STAR_TABLE).
      const stars = STAR_TABLE[jump.kind];
      bonuses.push({ id: `b${index}:3`, ...along(stars.d3), y: yLip + stars.h3, mult: 3 });
      bonuses.push({ id: `b${index}:5`, ...along(stars.d5), y: yLip + stars.h5, mult: 5 });
    }
    this.chunkBonuses.set(index, bonuses);
    return bonuses;
  }

  bonusesNear(z: number): TrickBonus[] {
    const center = this.chunkIndexAt(z);
    const bonuses: TrickBonus[] = [];
    for (let i = center - 1; i <= center + 1; i++) {
      bonuses.push(...this.bonusesForChunk(i));
    }
    return bonuses;
  }
}
