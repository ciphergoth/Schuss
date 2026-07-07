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

// THE COURSE is a run you can finish — and there is exactly ONE: nine
// sections, nine DIFFERENT personalities, 3.6km. Every section justifies
// itself with something new; nothing ever repeats within a run. It has an
// arc — a gentle cruise opening (section 0, as ever), a mixed middle that
// deals each of the other seven types exactly once (see sectionType), and
// a forced PLUNGE finale into the checkered gate at the line. Past the
// line the mountain becomes a clean celebratory outrun: cruise terrain,
// nothing to hit, nothing left to collect. Tests that need arbitrary depth
// can construct Terrain with courseLength Infinity (an endless mountain).
export const COURSE_LENGTH = SECTION_LENGTH * 9;

// The FINISH APRON: the last stretch of the plunge before the line is kept
// as empty as the outrun — no kicker lips, no stars, no obstacles, coins,
// or crud patches inside it. A fast flight covers ~40m, so an apron this
// deep guarantees your final trick has landed and you're rolling on your
// skis well before you cross under the checkered flag. The gate is a finish
// line, not one last jump; nothing worth doing should still be in the air.
export const FINISH_APRON = 80;

// A kicker THROWS things forward: its flight lands ~40m downrange and its
// bonus star hangs 30-50m out on the reference arc. So a lip clears a deeper
// margin than a static obstacle — everything it launches (arc and star) has
// to come to rest before the apron, not just the lip itself.
const KICKER_THROW = 70;

// The one course announces itself by name — over the start gate, on the
// HUD clock line, and at the ceremony.
export const COURSE_NAME = 'The Grand Tour';

export type SectionType =
  'cruise' | 'narrows' | 'bowl' | 'plunge' | 'steps' | 'sweeper' | 'canyon' | 'glacier' | 'powder';

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
  bermRoom: number; // meters of bank kept crud-free: the rideable berm line
  grip: number; // 1 = snow; below 1 the edges bite less (ice: less
  // friction, less turn authority). Drag-only stickiness can't express a
  // faster-than-snow surface, so grip is its own channel.
}

const TERRACE_LENGTH = 50;
const TERRACE_DROP = 3.5;
const TERRACE_EDGE = 6;
const TERRACE_TOTAL = (SECTION_LENGTH / TERRACE_LENGTH) * TERRACE_DROP;

const SECTION_SPECS: Record<SectionType, SectionSpec> = {
  // The baseline course this game grew up on.
  cruise: {
    half: 15,
    swing: 7,
    curveAmp: 24,
    rollerScale: 1,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0.4,
    kickerKinds: ['S', 'M', 'L', 'XL'],
    obstacleChance: 0.3,
    obstacleCount: 1,
    crudThreshold: 0.62,
    bermRoom: 0,
    grip: 1,
  },
  // High walls, no room, pure nerve. Nothing in the corridor but you.
  narrows: {
    half: 7,
    swing: 1.2,
    curveAmp: 17,
    rollerScale: 0.8,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0,
    kickerKinds: [],
    obstacleChance: 0,
    obstacleCount: 0,
    crudThreshold: 0.95,
    bermRoom: 0,
    grip: 1,
  },
  // The playground: wide open, obstacle slaloms, kickers of every size.
  // Rollers run calmer here than in cruise: across 27m of floor the bank
  // and roller slopes stack, and the drainage guarantee has to hold at
  // the far edges too.
  bowl: {
    half: 27,
    swing: 4,
    curveAmp: 12,
    rollerScale: 0.75,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0.45,
    kickerKinds: ['S', 'M', 'L', 'L', 'XL'],
    obstacleChance: 0.8,
    obstacleCount: 3,
    crudThreshold: 0.55,
    bermRoom: 0,
    grip: 1,
  },
  // The grade breaks away mid-section: raw speed, clean snow, big Ls only.
  plunge: {
    half: 17,
    swing: 6,
    curveAmp: 26,
    rollerScale: 0.7,
    extraDrop: 70,
    terraced: false,
    kickerChance: 0.2,
    kickerKinds: ['L', 'XL'],
    obstacleChance: 0,
    obstacleCount: 0,
    crudThreshold: 0.78,
    bermRoom: 0,
    grip: 1,
  },
  // Giant terraces; every edge is a launch with a landing below.
  steps: {
    half: 15,
    swing: 6,
    curveAmp: 12,
    rollerScale: 0.35,
    extraDrop: 0,
    terraced: true,
    kickerChance: 0,
    kickerKinds: [],
    obstacleChance: 0,
    obstacleCount: 0,
    crudThreshold: 0.7,
    bermRoom: 0,
    grip: 1,
  },
  // Big banked S-turns where carving the wall is the racing line.
  // Rollers run quiet: at each S-turn's bank flip the transition already
  // spends most of the grade at the floor edges, and the drainage
  // guarantee must survive the flip. A sweeper is about the carve anyway.
  // extraDrop pays for the superelevation transient: while the bank rises
  // under the outer lane (the ease-in/out derivative peak, ~0.05 of grade
  // at the 12m arm), the floor there flattened below the drainage budget —
  // archetype reshuffles surfaced sub-friction pockets ~40m into sweepers.
  // A steeper sweeper keeps every lane draining AND feeds the carve.
  sweeper: {
    half: 13,
    swing: 4,
    curveAmp: 20,
    rollerScale: 0.5,
    extraDrop: 30,
    terraced: false,
    kickerChance: 0.3,
    kickerKinds: ['S', 'M', 'L'],
    obstacleChance: 0.25,
    obstacleCount: 1,
    crudThreshold: 0.62,
    bermRoom: 5,
    grip: 1,
  },
  // The pipe: a tight gorge whose esses run banked at the cap — wall to
  // wall is the only line. Clean snow, no clutter; the walls ARE the
  // feature. Carries the sweeper's extraDrop for the same reason (the bank
  // transient must stay inside the drainage budget) — a canyon dives.
  canyon: {
    half: 10,
    swing: 1.5,
    curveAmp: 14,
    rollerScale: 0.4,
    extraDrop: 30,
    terraced: false,
    kickerChance: 0.15,
    kickerKinds: ['S', 'M'],
    obstacleChance: 0,
    obstacleCount: 0,
    crudThreshold: 0.95,
    bermRoom: 6,
    grip: 1,
  },
  // Blue ice: fast, clean, and slippery — the edges bite less, so turns
  // arrive late and speed is nearly free. Crystal gardens to thread.
  glacier: {
    half: 16,
    swing: 5,
    curveAmp: 22,
    rollerScale: 0.5,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0.25,
    kickerKinds: ['M', 'L'],
    obstacleChance: 0.5,
    obstacleCount: 2,
    crudThreshold: 0.97,
    bermRoom: 0,
    grip: 0.45,
  },
  // Deep powder with one groomed ribbon: the golden path is the ONLY fast
  // line (crudThreshold 0 turns the whole floor to drag except the clean
  // corridor stickinessAt always keeps along the plan). Line discipline as
  // a section. Powder is drag, not friction — it can slow you, never trap
  // you, so the drainage guarantee is untouched.
  powder: {
    half: 20,
    swing: 6,
    curveAmp: 18,
    rollerScale: 0.6,
    extraDrop: 0,
    terraced: false,
    kickerChance: 0.2,
    kickerKinds: ['S', 'M', 'L'],
    obstacleChance: 0.3,
    obstacleCount: 1,
    crudThreshold: 0,
    bermRoom: 0,
    grip: 1,
  },
};

const SECTION_ORDER: readonly SectionType[] = [
  'cruise',
  'narrows',
  'bowl',
  'plunge',
  'steps',
  'sweeper',
  'canyon',
  'glacier',
  'powder',
];

// THE TOUR: the course's mixed middle (sections 1..7) is ONE seeded
// shuffle of the seven types that aren't already pinned to the arc (cruise
// opens the run, plunge closes it), so every section of the course is a
// personality you haven't ridden yet — pure novelty, front to back. (This
// replaced first the nine ARCHETYPE courses — nine menu entries reweighting
// one shared deck, not nine ideas — and then an 8km double-deck mega course
// whose second helping of every idea was padding, not variety. All the
// ideas, once each, is the whole show.) A shuffle of distinct types is
// repeat-free by construction, and with cruise and plunge out of the deck
// both joints are safe unpatched. The endless test mountain continues past
// the tour with shuffled FULL decks (heads patched against the previous
// tail), so every type stays reachable at any depth.
const TOUR_TYPES: readonly SectionType[] = SECTION_ORDER.filter(
  (t) => t !== 'cruise' && t !== 'plunge'
);

// Superelevation: floor cross-slope per unit of centerline curvature, capped
// so the bank helps the carve without becoming a wall of its own.
const BANK_GAIN = 9;
const BANK_MAX_SLOPE = 0.26;
// Superelevation lever arm (see height()). Deliberately just UNDER the
// sweeper's 13m half-width: the bank plateaus before the wall base, so
// the low side never digs a V-gutter against the rising wall — a gutter
// whose along-slope flattened at bank fades was a genuine skier trap.
const BANK_ARM = 12;

// Deliberate S-curves: the wandering noise is too lazy to bend hard enough to
// bank, so some sections add real sine turns, eased in and out at the
// boundaries (zero, with zero slope, at each). Sweepers flow — long, banked
// S's you carve. Narrows SNAP — a tighter, sharper slalom is the whole point
// of the pinched corridor; the shorter wavelength reads as a real turn, and
// the ±20m banking stencil filters its sharpest so the bank still fits the
// drainage budget. The bends ARE the narrows' feature (so it gets no forced
// kickers — see jumpForChunk).
const SWEEP_AMP = 30;
const SWEEP_WAVELENGTH = 200;
// Ease long enough that the bank's rise under the outer lane (arm x
// d(crossSlope)/dz at the smoothstep's steepest point) stays well inside
// the drainage budget alongside the sweeper's extraDrop.
const SWEEP_EASE = 90;
const NARROWS_AMP = 15;
const NARROWS_WAVELENGTH = 115;
// Canyons carve between the two: tighter than a sweeper's flow, longer
// than the narrows' snap — the esses run banked at the cap and the pipe's
// walls are the racing line.
const CANYON_AMP = 24;
const CANYON_WAVELENGTH = 170;

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
// a decent pop; x5 demands the pop AND real speed. Grabbing one deals a
// CONTRACT, revealed at touchdown: the multiplier pays on the NEXT trick,
// and only if that trick delivers the star's named demand — so the
// multiplied base is never trivial, and the jackpot is always attached to
// a real showpiece. Gold asks for one named thing; magenta asks for
// composition, pricing its bigger multiplier in difficulty.
export type ContractDemand =
  | 'spinL' // a clean left-spin segment
  | 'spinR'
  | 'front'
  | 'back'
  | 'spin2' // 720+ of spin
  | 'flip2' // two or more flip rotations
  | 'mix' // serial variety: two+ DIFFERENT tricks in one flight
  | 'parallel'; // spin AND flip at once

const GOLD_DEMANDS: ContractDemand[] = ['spinL', 'spinR', 'front', 'back', 'spin2'];
const MAGENTA_DEMANDS: ContractDemand[] = ['mix', 'parallel', 'flip2'];

export interface TrickBonus {
  id: string;
  x: number;
  z: number;
  y: number;
  mult: 3 | 5;
  demand: ContractDemand;
}

// Kickers now come in personalities: three sizes, plus an optional step-down
// landing (the ground past the lip falls away for float and a soft catch)
// or a HIP — the approach pad tilts into a banked corner, and the
// gravity-turn physics slings the launch heading sideways across the track.
// No fake geometry: the throw is the cross-slope force, honestly earned.
export type JumpKind = 'S' | 'M' | 'L' | 'XL';

interface JumpGeometry {
  rampLength: number;
  lipHeight: number;
}

const JUMP_GEOMETRY: Record<JumpKind, JumpGeometry> = {
  S: { rampLength: 10, lipHeight: 1.5 },
  M: { rampLength: 14, lipHeight: 2.2 },
  L: { rampLength: 19, lipHeight: 3.2 },
  XL: { rampLength: 25, lipHeight: 4.3 }, // a booter — a proper big-air launch
};

export interface Jump {
  zLip: number; // the edge you fly off; the ramp rises toward it from +z
  xOffset: number; // kicker center relative to the track centerline
  halfWidth: number; // lateral half-size of the full-height core
  kind: JumpKind;
  rampLength: number;
  lipHeight: number;
  stepDown: number; // extra drop scooped out of the landing (0 = flat kicker)
  hip: number; // banked-pad throw direction: -1 / 0 / +1 (toward -x / straight / +x)
}

const JUMP_EDGE = 1.8; // soft shoulder from full height to flat floor
const SCOOP_EDGE = 5; // step-down landings get wide, gentle shoulders
// The max-gap guarantee: never ski more than this many chunks (~160m, ~8s at
// cruise pace) with NOTHING happening — no kicker, no bend to ride, no
// staircase. When the natural per-chunk rolls leave a longer dead stretch, a
// kicker is planted to fill it. A moving corridor is never boring; a straight
// empty one is, so this is the floor under every section, narrows included.
const MAX_FEATURE_GAP = 4;
// |centerline curvature| (1/m) that reads as a bend you actually carve — a
// feature in its own right, so an active turn resets the gap the way a kicker
// does (per design: a bend counts). Set in the clean gap between the sweeper's
// deliberate S-turns (~0.054) and every other section's lazy noise wander
// (≤0.008): only a real carve exempts a stretch from the jump guarantee, so
// gentle drift elsewhere still gets kickers rather than passing for a feature.
const BEND_CURV = 0.02;
// The carved landing floor always descends at least this steeply — with
// the mogul texture's worst counter-slope (~0.04) subtracted it still
// clears twice snow friction, so a skier who lands dead in the carve
// drains out the bottom. Must stay well below the mean grade (0.35) so
// the rolled base always catches the carve from above and the landing
// rejoins the floor on a downhill crossing.
const CARVE_SLOPE = 0.15;
// Hip pads: the approach tilts up to HIP_TILT cross-slope by the lip over a
// HIP_LANE run-up; gravity's cross-slope turn converts that into a launch
// heading thrown ~HIP_THROW radians across the track at plan-ish speeds
// (slower = thrown harder, which is physics being a good game designer).
const HIP_TILT = 0.38;
const HIP_LANE = 20;
const HIP_THROW = 0.3;
// Riding the pad slides the skier ~this far toward the throw side by the
// lip (measured by simulated rides; self-limiting where the tilt fades).
// The whole pad — core, lip, tilt — bends along that drift line, so the
// slung rider still exits over a true lip; stars hang off the drifted exit.
const HIP_DRIFT = 7.5;

// Star placement is COMPUTED, not tabulated: each star sits on the reference
// flight integrated against the real heightfield — the flight you fly
// arriving at the lip on-plan and releasing the pop right there. The x3
// rides the human-pop arc at cruise pace; the x5 rides the superhuman
// (boost-charged) arc at race pace. Grade changes, section transitions and
// hip drift are all automatically on-arc, and the placement stays correct
// through physics changes because it IS the physics.
const STAR3_SPEED = 20; // arrive at cruise...
const STAR3_CHARGE = 0.5; // ...with a full human pop
const STAR3_TIME = 1.5; // seconds into that flight
const STAR5_SPEED = 25; // arrive at real race pace (boost territory)...
const STAR5_CHARGE = 1; // ...with a superhuman, fuel-burned pop
const STAR5_TIME = 1.9; // deep downrange: slower flights are meters under it
const POP_MAX = 5.4; // mirrors skier.ts JUMP_POP_MAX
const POP_CAP_RATIO = 0.35; // mirrors skier.ts LAUNCH_MAX_VY_RATIO
// Hip flights converge onto the aim corridor's equilibrium line; this is
// the measured effective angle of that line from the drifted exit.
const HIP_ARC_ANGLE = 0.17;

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

// Where a jump's core line sits laterally (relative to xOffset) at q meters
// uphill of the lip: flat kickers run straight, hip pads bend along the
// rider's drift. Shared by the heightfield, the steering aim, and the
// render layer's runway lights.
export function jumpDrift(jump: Jump, q: number): number {
  if (jump.hip === 0) return 0;
  return jump.hip * HIP_DRIFT * clamp01(1 - q / (jump.rampLength + HIP_LANE));
}

export interface Setpiece {
  kind: 'waterfall' | 'cascades';
  z: number; // where the (first) edge breaks
  span: number; // meters from the first edge to the last face's foot
  falls: readonly [number, number, number][]; // [zTop, drop, face] each
}

// THE GROTTO: the course's third landmark — a stretch where the channel
// runs under an ice roof. Pure atmosphere on the sim side: the heightfield
// is untouched (the floor through a cave is just floor, so drainage and
// physics can't tell), but the interior is kept clear of kickers and
// obstacles: in the dark, with the roof low, nothing may launch you or
// ambush you — the cave itself is the feature. caveAt(z) is the render
// layer's dimmer (0 outside, easing to 1 inside).
export interface Grotto {
  z: number; // the mouth: where the roof begins
  span: number; // meters of covered channel
}
const GROTTO_SPAN = 90;
const GROTTO_FADE = 14; // meters of portal ease at each end

// SLALOM GATES: the narrows' own economy. The pinched corridor is empty and
// fast by design — the snapping esses are its feature — so the gates ride
// those esses: one at each bend apex, centered on the swinging centerline.
// Threading a gate pays GATE_POINTS x the running chain (150, 300, 450...);
// missing one quietly resets the chain — no tumble, no speed loss, the
// punishment is only the forgone escalation. Score only, never fuel: the
// tank fills from tricks and coins alone.
export interface SlalomGate {
  id: string;
  x: number; // center of the gap
  z: number;
  halfGap: number; // thread within this of x
}
export const GATE_HEIGHT = 2.6; // fly over the poles and it's not a thread
export const GATE_POINTS = 150; // x chain

// MOVING HAZARDS: patrol drones sweeping the wide sections — the bowl's
// playground and the glacier's open ice. Each rides a fixed z, gliding
// laterally on a seeded sine, a pure function of (seed, time): same seed,
// same schedule, deterministic to the step. Hitting one is an ordinary
// obstacle hit (brief tumble, keep most speed); slipping past close pays
// the same near-miss celebration as a grazed crystal. They never share a
// chunk with a kicker's launch or landing, never ride a setpiece, and
// their sweep stays inside the floor.
export interface Hazard {
  id: string;
  z: number;
  x0: number; // sweep center (the track centerline at z)
  amp: number; // sweep half-width
  period: number; // seconds per full back-and-forth
  phase: number;
  radius: number; // collision radius
  height: number; // collision height above the snow
}

// Where a hazard is right now — shared by the sim's collision and the
// render layer's drone, so what you see is exactly what hits you.
export function hazardX(h: Hazard, time: number): number {
  return h.x0 + h.amp * Math.sin((time * Math.PI * 2) / h.period + h.phase);
}

export class Terrain {
  private chunkObstacles = new Map<number, Obstacle[]>();
  private chunkPickups = new Map<number, Pickup[]>();
  private chunkBonuses = new Map<number, TrickBonus[]>();
  private chunkJumps = new Map<number, Jump | null>();
  private chunkGates = new Map<number, SlalomGate[]>();
  private chunkHazards = new Map<number, Hazard[]>();
  private chunkSinceFeat = new Map<number, number>();
  private tour: SectionType[] | undefined;
  private blockDeals = new Map<number, SectionType[]>();
  private sectionDrops = new Map<number, number>();

  // THE SETPIECES: the mega course carries BOTH landmarks — the WATERFALL
  // (one 10m dive over a 16m face) and the CASCADES (three 5m falls in 30m
  // rhythm) — one seeded into each half of the run, in seeded order. Pure
  // added downhill on the spine, so the walls, banking, star arcs, and the
  // drainage guarantee inherit them for free — a fall face only ever
  // steepens the floor. Landmarks, not a distribution.
  readonly setpieces: readonly Setpiece[];

  // The grotto sits between the two fall setpieces (they land in 25-40% and
  // 55-70% of the run), so the three landmarks pace the whole descent.
  readonly grotto: Grotto;

  constructor(
    readonly seed: number,
    readonly courseLength = COURSE_LENGTH
  ) {
    // Endless test mountains still get exactly one pair, on the course span.
    const span = Number.isFinite(courseLength) ? courseLength : COURSE_LENGTH;
    const zEarly = -(0.25 + 0.15 * hash2(seed, 8887, 1)) * span;
    const zLate = -(0.55 + 0.15 * hash2(seed, 8887, 3)) * span;
    const waterfall = (z: number): Setpiece => ({
      kind: 'waterfall',
      z,
      span: 16,
      falls: [[z, 10, 16]],
    });
    const cascades = (z: number): Setpiece => ({
      kind: 'cascades',
      z,
      span: 70,
      falls: [
        [z, 5, 10],
        [z - 30, 5, 10],
        [z - 60, 5, 10],
      ],
    });
    this.setpieces =
      hash2(seed, 8887, 2) < 0.5
        ? [waterfall(zEarly), cascades(zLate)]
        : [cascades(zEarly), waterfall(zLate)];
    // The grotto's window (44-50% in) clears the early setpiece's foot and
    // the late one's approach margin for every seed.
    this.grotto = { z: -(0.44 + 0.06 * hash2(seed, 8887, 4)) * span, span: GROTTO_SPAN };
  }

  // How deep under the grotto's roof this z is: 0 in the open, easing to 1
  // through each portal. The render layer's darkness, snowfall, and aurora
  // all breathe with it; the sim itself never reads it.
  caveAt(z: number): number {
    const into = this.grotto.z - z; // meters past the mouth
    if (into <= 0 || into >= this.grotto.span) return 0;
    return (
      smoothstep(clamp01(into / GROTTO_FADE)) *
      smoothstep(clamp01((this.grotto.span - into) / GROTTO_FADE))
    );
  }

  // Is this z inside the grotto's keep-clear zone? Wider than the roof
  // itself: a kicker THROWS ~KICKER_THROW downrange, so nothing may launch
  // a flight (or hang a star) into the dark from just uphill of the mouth.
  private nearGrotto(z: number): boolean {
    return z < this.grotto.z + KICKER_THROW && z > this.grotto.z - this.grotto.span - 20;
  }

  // The last section of the course; the finish line sits at its far edge.
  private lastSection(): number {
    return Math.ceil(this.courseLength / SECTION_LENGTH) - 1;
  }

  // Is this z past the finish line (on the celebratory outrun)?
  pastFinish(z: number): boolean {
    return -z >= this.courseLength;
  }

  // Is this z inside the clean finish apron — the last FINISH_APRON metres
  // before the line, or anywhere past it? Everywhere the apron reaches asks
  // nothing of you and offers nothing: no lips to pop, nothing to hit or
  // collect, clean snow all the way to the gate. A superset of pastFinish
  // used to gate feature placement (never terrain shape or the scoring lock,
  // which key off the line itself).
  finishApron(z: number): boolean {
    return -z >= this.courseLength - FINISH_APRON;
  }

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

  // The personality of section s: THE TOUR. Section 0 is always cruise,
  // the final section is always the plunge finale, everything past the
  // line is outrun cruise — and the middle (1..7) is the seeded shuffle of
  // the other seven types, once each. Nine sections, nine different ideas;
  // nothing ever repeats within the course (a Narrows into a Narrows would
  // just be one long Narrows, and a second helping of anything is padding).
  sectionType(s: number): SectionType {
    if (s <= 0) return 'cruise';
    if (s > this.lastSection()) return 'cruise'; // the outrun
    if (s === this.lastSection()) return 'plunge'; // the finale
    if (s <= TOUR_TYPES.length) return this.tourDeal()[s - 1]!;
    // Past the tour only the endless test mountain continues: keep dealing
    // shuffled full decks so every type stays reachable at any depth.
    const block = Math.floor((s - 1 - TOUR_TYPES.length) / SECTION_ORDER.length);
    return this.blockDeal(block)[(s - 1 - TOUR_TYPES.length) % SECTION_ORDER.length]!;
  }

  // The course's one middle deal: the seven unpinned types, shuffled. No
  // joint needs patching — cruise and plunge aren't in the deck, so the
  // head can't echo the opening and the tail can't double the finale.
  private tourDeal(): SectionType[] {
    return (this.tour ??= this.shuffled(TOUR_TYPES, 1));
  }

  // An endless-mountain block: one shuffled full deck of the nine types.
  // Internally repeat-free (distinct cards); the head is patched against
  // the previous tail (or the tour's last card) by a same-deck neighbor
  // swap, which is distinct by construction and can't create a new repeat.
  private blockDeal(block: number): SectionType[] {
    const cached = this.blockDeals.get(block);
    if (cached) return cached;
    const deal = this.shuffled(SECTION_ORDER, 100 + block);
    const prev =
      block === 0
        ? this.tourDeal()[TOUR_TYPES.length - 1]!
        : this.blockDeal(block - 1)[SECTION_ORDER.length - 1]!;
    if (deal[0] === prev) [deal[0], deal[1]] = [deal[1]!, deal[0]!];
    this.blockDeals.set(block, deal);
    return deal;
  }

  private shuffled(types: readonly SectionType[], salt: number): SectionType[] {
    const rng = mulberry32(Math.floor(hash2(this.seed, 7307, salt) * 2 ** 31));
    const deck = [...types];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    return deck;
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

  // Deliberate S-turns laid on top of the noise wander; zero (with zero slope)
  // at both section boundaries by construction. Sweepers flow, narrows snap —
  // same machinery, different amplitude and wavelength.
  private sweeperSwing(z: number): number {
    const s = this.sectionIndexAt(z);
    if (s < 1) return 0;
    const type = this.sectionType(s);
    const [amp, wavelength] =
      type === 'sweeper'
        ? [SWEEP_AMP, SWEEP_WAVELENGTH]
        : type === 'narrows'
          ? [NARROWS_AMP, NARROWS_WAVELENGTH]
          : type === 'canyon'
            ? [CANYON_AMP, CANYON_WAVELENGTH]
            : [0, 1];
    if (amp === 0) return 0;
    const local = -z - s * SECTION_LENGTH;
    const ease =
      smoothstep(clamp01(local / SWEEP_EASE)) *
      smoothstep(clamp01((SECTION_LENGTH - local) / SWEEP_EASE));
    return ease * amp * Math.sin((local / wavelength) * Math.PI * 2);
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

  // Signed centerline curvature; drives the banking. The wide stencil is
  // deliberate: it reads the ~100m+ trend of the bend, so the bank doesn't
  // flip with every noise wiggle. A fast bank flip is a drainage hazard —
  // its transition moves the floor edges up along-track at arm * dBank/dz,
  // and rail-to-rail in 20m cancels the whole grade. The 200m sweeper sine
  // passes through at ~87% strength; sub-80m wiggles lose most of theirs.
  private curvature(z: number): number {
    return (this.centerX(z - 20) - 2 * this.centerX(z) + this.centerX(z + 20)) / 400;
  }

  // THE GOLDEN PATH: the intended line through the course, as an offset from
  // the centerline. Every generator derives from it — kickers sit on it, the
  // crud-free corridor follows it. It is deliberately unmarked: reading the
  // clean snow and the kicker gates to find it IS the game. Coins sit off it
  // as paid detours.
  planOffset(z: number): number {
    return (this.noise1(z / 90, 6) - 0.5) * 2 * Math.max(1, this.channelHalfWidth(z) - 6);
  }

  // The smooth spine of the course: mean grade plus section drops (plunges,
  // terraces) plus the course's signature setpieces, without the roller
  // noise. Star placement measures flight heights in this frame — a popped
  // arc is the same height RELATIVE TO THE SLOPE on a gentle cruise and a
  // steep plunge alike.
  spineY(z: number): number {
    return GRADE * z - this.sectionDrop(z) - this.setpieceDrop(z);
  }

  // The setpieces' added downhill (see the setpieces field): every fall
  // face is pure extra drop on the spine, so a fall can only ever steepen
  // the floor.
  private setpieceDrop(z: number): number {
    let drop = 0;
    for (const sp of this.setpieces) {
      for (const [top, d, face] of sp.falls) {
        drop += d * smoothstep(clamp01((top - z) / face));
      }
    }
    return drop;
  }

  // Is this z on (or hard against) a setpiece? Its faces are the feature:
  // no kickers or obstacles compete with the falls.
  private onSetpiece(z: number): boolean {
    return this.setpieces.some((sp) => z < sp.z + 30 && z > sp.z - sp.span - 50);
  }

  // Height of the track's spine plus big rollers. Under leg-reach contact
  // rollers are rhythm, not flight — their curvature can't out-drop gravity
  // by more than the legs absorb. Air belongs to built edges and the pop.
  // Amplitude and wavelength are sized so a roller backside always leaves
  // a net downhill grade of at least ~0.12 (measured by drainage.test.ts;
  // the fractal noise's slope runs ~3.7x amplitude/wavelength): the floor
  // keeps draining and a stopped skier always restarts. The old 3.2/55m
  // rollers could locally cancel the 0.35 grade to below snow friction —
  // a skier who stopped there was parked forever.
  private baseY(z: number): number {
    const rollers = this.sectionParam(z, (spec) => spec.rollerScale);
    return this.spineY(z) + (this.noise1(z / 85, 2) - 0.5) * 2 * 2.5 * rollers;
  }

  // Does this chunk roll a kicker? Odds depend on its section — some
  // sections deal none at all.
  private rollsJump(index: number): boolean {
    if (index < 3) return false;
    const zLip = -index * CHUNK_LENGTH - 24;
    // Nothing this lip throws — flight or star — may reach the apron, so
    // gate on the far (downrange) end of its throw, not the lip itself:
    // land before the gate, not through it.
    if (this.finishApron(zLip - KICKER_THROW)) return false;
    if (this.onSetpiece(zLip)) return false; // the falls ARE the feature here
    if (this.nearGrotto(zLip)) return false; // nothing launches into the dark
    const chance = SECTION_SPECS[this.sectionType(this.sectionIndexAt(zLip))].kickerChance;
    return hash2(this.seed, index, 31337) < chance;
  }

  // Does this chunk actively bend? A real turn is a feature you steer through,
  // so it resets the no-feature gap the same as a kicker (design: bends count).
  private bendsAt(index: number): boolean {
    const z = -index * CHUNK_LENGTH - CHUNK_LENGTH / 2;
    const h = 12;
    const curv = (this.centerX(z - h) - 2 * this.centerX(z) + this.centerX(z + h)) / (h * h);
    return Math.abs(curv) > BEND_CURV;
  }

  // What the max-gap guarantee counts as "something happening": a kicker
  // launches you, a bend turns you, a staircase (terraced section) is all
  // launchable edges — and the setpiece's falls most of all. Any of these
  // keeps a stretch from going dead (and nothing gets FORCED onto the
  // falls, since a setpiece chunk already counts as featured).
  private featureAt(index: number): boolean {
    if (this.jumpForChunk(index) !== null) return true;
    if (this.bendsAt(index)) return true;
    const zLip = -index * CHUNK_LENGTH - 24;
    if (this.onSetpiece(zLip)) return true;
    if (this.nearGrotto(zLip)) return true; // the cave is the feature
    return SECTION_SPECS[this.sectionType(this.sectionIndexAt(zLip))].terraced;
  }

  // Chunks since the last feature, walking backward. Memoized; the recursion
  // is strictly decreasing and bottoms out at the gate.
  private chunksSinceFeature(index: number): number {
    if (index < 3) return MAX_FEATURE_GAP; // seed the guarantee at the start
    const cached = this.chunkSinceFeat.get(index);
    if (cached !== undefined) return cached;
    const v = this.featureAt(index) ? 0 : this.chunksSinceFeature(index - 1) + 1;
    this.chunkSinceFeat.set(index, v);
    return v;
  }

  jumpForChunk(index: number): Jump | null {
    const cached = this.chunkJumps.get(index);
    if (cached !== undefined) return cached;
    const zLip = -index * CHUNK_LENGTH - 24;
    // No consecutive jump chunks: a fast flight covers up to ~40m, so
    // back-to-back kickers could be overflown entirely — the plan never
    // schedules a feature you can accidentally skip. Checked against the
    // PLACED neighbour, so a forced kicker blocks adjacency too.
    const clearBehind = index < 1 || this.jumpForChunk(index - 1) === null;
    const natural = this.rollsJump(index) && clearBehind;
    // The max-gap guarantee: when nothing has happened for MAX_FEATURE_GAP
    // chunks — no kicker, no bend, no staircase — plant a kicker to fill the
    // dead stretch. Sections whose personality already fills the space carry
    // themselves and never get a forced kicker: a staircase (terraced), a
    // sweeper's carve, a narrows slalom — their own features hold the floor.
    const type = this.sectionType(this.sectionIndexAt(zLip));
    const selfFeatured =
      SECTION_SPECS[type].terraced || type === 'sweeper' || type === 'narrows' || type === 'canyon';
    const forced =
      !natural &&
      clearBehind &&
      index >= 3 &&
      !this.finishApron(zLip - KICKER_THROW) && // no forced kicker throwing into the run-in
      !this.onSetpiece(zLip) && // never force a kicker onto the falls
      !this.nearGrotto(zLip) && // nor into the grotto's dark
      !this.bendsAt(index) &&
      !selfFeatured &&
      this.chunksSinceFeature(index - 1) + 1 >= MAX_FEATURE_GAP;
    if (!natural && !forced) {
      this.chunkJumps.set(index, null);
      return null;
    }
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
    // Sweeper and canyon esses superelevate the floor hard; a scooped
    // landing or a tilted hip pad on that ground is two banks fighting
    // (the ess's cross-slope drowns the scoop and cancels the pad's
    // throw). Those sections deal plain kickers only.
    const sectionType = this.sectionType(this.sectionIndexAt(zLip));
    const banked = sectionType === 'sweeper' || sectionType === 'canyon';
    // Scoop depth is capped: every extra meter of drop is a meter the
    // carved landing floor must dissipate before it rejoins the grade.
    const stepDown =
      !opening && !banked && kind !== 'S' && variantRoll < 0.3 ? Math.min(lipHeight * 1.6, 3.5) : 0;
    // Hips throw toward the center so the slung flight stays over the floor;
    // they need lateral room for the landing, and they don't roll in
    // plunges — the mid-plunge grade swing bends flights off any fixed
    // sling line (plunges are for speed and big Ls anyway).
    const inPlunge = sectionType === 'plunge';
    const hip =
      !opening && !inPlunge && !banked && stepDown === 0 && halfChannel >= 13 && variantRoll > 0.75
        ? Math.abs(xOffset) > 1
          ? -Math.sign(xOffset)
          : hash2(this.seed, index, 9257) < 0.5
            ? -1
            : 1
        : 0;
    const jump: Jump = { zLip, xOffset, halfWidth, kind, rampLength, lipHeight, stepDown, hip };
    this.chunkJumps.set(index, jump);
    return jump;
  }

  // The kicker's contribution to the heightfield: the ramp rising to the lip
  // (in the ramp's own, possibly hip-yawed frame) and, for step-downs, the
  // landing carved out past the lip. The carve can run tens of meters into
  // the chunks below, so shapes from this chunk's jump and TWO uphill
  // neighbors' apply.
  private kickerShape(d: number, z: number): number {
    const index = this.chunkIndexAt(z);
    let y = 0;
    for (const i of [index, index - 1, index - 2]) {
      const jump = this.jumpForChunk(i);
      if (!jump) continue;
      const q = z - jump.zLip; // uphill distance from the lip
      // Hips bend the whole pad along the rider's drift line; a flat
      // kicker's core runs straight (drift 0).
      const p = d - jump.xOffset - jumpDrift(jump, q); // offset from the (curved) core
      if (q >= 0 && q <= jump.rampLength) {
        const rise = 1 - q / jump.rampLength;
        const lateral = Math.abs(p) - jump.halfWidth;
        if (lateral < JUMP_EDGE) {
          const fade = lateral <= 0 ? 1 : smoothstep(1 - lateral / JUMP_EDGE);
          y += jump.lipHeight * rise * rise * fade;
        }
      }
      // Hip pad: the approach and ramp tilt progressively into a banked
      // corner (raised on the side away from the throw). The tilt fades out
      // past the lip, under where the flight has already left — GENTLY,
      // and only within its own corridor. The old shape plateaued across
      // the whole track and faded in 6m: the entire low-side floor rose
      // ~2.9m over 6m past every hip, a 48% wall no slow skier could climb
      // and no lateral line could avoid — the classic inescapable valley.
      // With a lateral fade the fade-out tongue is a local ridge you drain
      // off sideways, and 18m of fade keeps its face shallow.
      if (jump.hip !== 0) {
        const build = smoothstep(clamp01((jump.rampLength + HIP_LANE - q) / HIP_LANE));
        const fadeOut = q < 0 ? smoothstep(clamp01((q + 20) / 18)) : 1;
        const tilt = HIP_TILT * build * fadeOut;
        if (tilt > 0) {
          const w = jump.halfWidth + JUMP_EDGE + 2;
          const lateral = Math.abs(p) - w;
          const latFade = lateral <= 0 ? 1 : smoothstep(1 - Math.min(1, lateral / 8));
          y += -jump.hip * tilt * Math.max(-w, Math.min(w, p)) * latFade;
        }
      }

      // Step-down landing: a CARVED floor, not a subtracted dip. The carve
      // is its own line — dropping stepDown over the first 10m, then always
      // descending at CARVE_SLOPE — and the floor is simply the lower of
      // the carve and the rolled base, so the base always catches it from
      // above and the landing rejoins the grade on a DOWNHILL crossing.
      // The old shape climbed back to the base over 14m — up to a 55% wall
      // on an L, a basin no slow lander could leave. A carve can't form a
      // basin: its floor drains by definition, everywhere.
      if (jump.stepDown > 0 && q < 0) {
        const v = -q;
        const carve =
          this.baseY(jump.zLip) - jump.stepDown * smoothstep(clamp01(v / 10)) - CARVE_SLOPE * v;
        const below = carve - this.baseY(z);
        if (below < 0) {
          const lateral = Math.abs(p) - (jump.halfWidth + 2);
          if (lateral < SCOOP_EDGE) {
            const fade = lateral <= 0 ? 1 : smoothstep(1 - lateral / SCOOP_EDGE);
            y += below * fade;
          }
        }
      }
    }
    return y;
  }

  // How much a hip pad is steering the course line here: the pad's thrown
  // direction, faded across its corridor (which widens past the lip, under
  // the slung flight). The skier's neutral steering follows the course, and
  // on a hip pad the course bends across the track — same mechanism that
  // carries neutral steering around a sweeper's rotating trackHeading. The
  // banked surface (kickerShape) provides the matching physical force.
  hipAim(x: number, z: number): number {
    const index = this.chunkIndexAt(z);
    for (const i of [index - 1, index, index + 1]) {
      const jump = this.jumpForChunk(i);
      if (!jump || jump.hip === 0) continue;
      const q = z - jump.zLip;
      if (q > jump.rampLength + HIP_LANE || q < -45) continue;
      const build = smoothstep(clamp01((jump.rampLength + HIP_LANE - q) / HIP_LANE));
      const p = x - this.centerX(z) - jump.xOffset - jumpDrift(jump, q);
      const w = jump.halfWidth + 4 + Math.max(0, -q) * 0.5;
      const lateral = 1 - smoothstep(clamp01((Math.abs(p) - w) / 3));
      // Follow the pad's curved core LINE, not a blind offset: the throw
      // eases off (or reverses) as the rider gets ahead of the line, so
      // slow riders don't spiral past it.
      const correct = 0.35 * Math.max(-1, Math.min(1, p / 7));
      const aim = (jump.hip * HIP_THROW - correct) * build * lateral;
      if (aim !== 0) return aim;
    }
    return 0;
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
  // How well the edges bite here: 1 on snow, below 1 on glacier ice (less
  // friction, less turn authority — skier.ts scales both). Cross-fades at
  // section boundaries like every other section scalar.
  gripAt(z: number): number {
    return this.sectionParam(z, (spec) => spec.grip);
  }

  stickinessAt(x: number, z: number): number {
    const d = x - this.centerX(z);
    // Sections with berm room keep the first stretch of bank crud-free:
    // with gravity-turn physics carrying riders along banks, the berm is a
    // line you choose, not a punishment.
    const berm = this.sectionParam(z, (spec) => spec.bermRoom);
    const wall = Math.min(1, Math.max(0, (Math.abs(d) - this.channelHalfWidth(z) - berm) / 4));
    let patch = 0;
    if (z < -80 && !this.finishApron(z) && this.kickerShape(d, z) === 0 && !this.inJumpLane(d, z)) {
      const threshold = this.sectionParam(z, (spec) => spec.crudThreshold);
      const n = this.noise2(x / 13, z / 13, 5);
      patch = smoothstep(Math.min(1, Math.max(0, (n - threshold) / 0.1)));
      // The guaranteed clean corridor IS the golden path.
      const laneDist = Math.abs(d - this.planOffset(z));
      patch *= smoothstep(Math.min(1, Math.max(0, (laneDist - 3.5) / 2)));
      // Berm sections keep patches off the outer floor and the berm itself:
      // the high line must be genuinely rideable.
      const bermness = Math.min(1, berm / 5);
      patch *=
        1 -
        bermness *
          smoothstep(Math.min(1, Math.max(0, (Math.abs(d) - (this.channelHalfWidth(z) - 3)) / 2)));
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
    // Mogul texture rides everywhere, including carved landings. Its SLOPE
    // is what matters for drainage — the old 0.12m/9m texture swung ±0.10,
    // silently eating the whole net-downhill margin the rollers left.
    let y = this.baseY(z) + (this.noise2(x / 12, z / 12, 3) - 0.5) * 2 * 0.07;
    y += this.kickerShape(d, z);
    const bankSlope = Math.max(
      -BANK_MAX_SLOPE,
      Math.min(BANK_MAX_SLOPE, -BANK_GAIN * this.curvature(z))
    );
    // The bank's lever arm caps at BANK_ARM: the racing corridor gets the
    // full superelevation (every section's half-width but the bowl's fits
    // inside it), while a 27m bowl's outer floor rides at constant lift.
    // An uncapped arm turns every bank transition into along-track slope
    // (d * dBank/dz) — at bowl edges that beat the grade and made flats.
    const arm = Math.min(half, BANK_ARM);
    y += bankSlope * Math.max(-arm, Math.min(arm, d));
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
    // Chunks 0-5 stay empty so every run starts in the open; the finish
    // apron and the outrun past it stay empty so every run ends clean and
    // ends in celebration (gate the chunk by its downrange edge, so no
    // obstacle strays into the run-in to the flag).
    if (index >= 6 && !this.finishApron(zTop - CHUNK_LENGTH)) {
      const spec = SECTION_SPECS[this.sectionType(this.sectionIndexAt(zTop - CHUNK_LENGTH / 2))];
      const rng = mulberry32(Math.floor(hash2(this.seed, index, 7919) * 2 ** 31));
      const jump = this.jumpForChunk(index);
      // A patrol drone owns its chunk: dodging the sweep is the whole game
      // there, and a static crystal hiding in a drone's shadow would punish
      // the dodge the drone just demanded.
      const patrolled = this.hazardsForChunk(index).length > 0;
      const count =
        !patrolled && hash2(this.seed, index, 857) < spec.obstacleChance ? spec.obstacleCount : 0;
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
          z < jump.zLip + jump.rampLength + HIP_LANE + 3 &&
          Math.abs(d - jump.xOffset) < jump.halfWidth + 8
        ) {
          continue;
        }
        // Never on the setpiece's falls — flying blind off a waterfall
        // into a bollard would punish riding the landmark — and never in
        // the grotto's dark, where an unlit crystal is an ambush.
        if (this.onSetpiece(z) || this.nearGrotto(z)) continue;
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
    // Nothing left to collect once the run-in to the gate begins (gate by
    // the chunk's downrange edge, matching obstacles).
    if (index > 0 && !this.finishApron(-index * CHUNK_LENGTH - CHUNK_LENGTH)) {
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
      if (jump.hip !== 0) {
        // Hips pay the x3 for riding the sling; their x5 is withheld until the
        // popped-off-the-curve flight is measured well enough to place it
        // honestly (the flat x5 reference arc is meters off a hip's reality).
        bonuses.push(this.star(index, jump, 3));
      } else if (jump.kind === 'L' || jump.kind === 'XL') {
        // Big lips deal a VARIED star loadout, so a star means something:
        // usually both, but some gold-only, some magenta-only (a pro gate),
        // and some none at all — a pure-air jump you take for the trick
        // points, not a gate.
        const roll = hash2(this.seed, index, 5171);
        if (roll >= 0.15 && roll < 0.5) {
          bonuses.push(this.star(index, jump, 3));
        } else if (roll >= 0.5) {
          bonuses.push(this.star(index, jump, 3));
          bonuses.push(this.star(index, jump, 5));
        } else if (roll >= 0.05) {
          bonuses.push(this.star(index, jump, 5));
        }
        // roll < 0.05: no star — a pure-air jump.
      } else {
        // Small lips (S/M): the superhuman x5 arc lands meters out of reach
        // off a short ramp, so — like the hip x5 — it's WITHHELD until the
        // flight off these lips is measured well enough to place it honestly.
        // They carry the gold x3 (which the human arc threads) most of the
        // time; a few are pure-air jumps taken for the trick points alone.
        if (hash2(this.seed, index, 5171) >= 0.1) {
          bonuses.push(this.star(index, jump, 3));
        }
      }
    }
    this.chunkBonuses.set(index, bonuses);
    return bonuses;
  }

  // A star and its contract. The demand is drawn from the tier's pool on an
  // independent hash (salted by mult so a chunk's gold and magenta differ),
  // so adding demands didn't reshuffle any existing course.
  private star(index: number, jump: Jump, mult: 3 | 5): TrickBonus {
    const pool = mult === 3 ? GOLD_DEMANDS : MAGENTA_DEMANDS;
    const demand = pool[Math.floor(hash2(this.seed, index, 6011 + mult) * pool.length)]!;
    return { id: `b${index}:${mult}`, mult, demand, ...this.starOnArc(jump, mult) };
  }

  // Integrate the reference flight off this kicker's lip and return the
  // point on it where the star hangs. The reference rider arrives on the
  // core line at the star's speed and releases the star's pop exactly at
  // the lip; hips launch from the drifted exit along the aim corridor's
  // equilibrium line. Ballistic at constant horizontal speed against the
  // real heightfield — pure, deterministic, and immune to grade changes.
  private starOnArc(jump: Jump, mult: 3 | 5): { x: number; z: number; y: number } {
    const speed = mult === 3 ? STAR3_SPEED : STAR5_SPEED;
    const charge = mult === 3 ? STAR3_CHARGE : STAR5_CHARGE;
    const flightTime = mult === 3 ? STAR3_TIME : STAR5_TIME;
    const track = this.trackHeading(jump.zLip);
    const heading = track + jump.hip * HIP_ARC_ANGLE;
    const core = this.centerX(jump.zLip) + jump.xOffset;
    let x = core + jump.hip * HIP_DRIFT * Math.cos(track);
    let z = jump.zLip + jump.hip * HIP_DRIFT * Math.sin(track);
    // Launch state: the ramp's exit slope (sampled 1m back up the approach)
    // carries the terrain part of vy, capped exactly like the sim's
    // moon-shot guard, and the pop rides on top.
    let y = this.height(x, z + 0.02);
    // Exit slope per meter of approach, sampled along the (possibly hip-
    // curved) CORE LINE the rider actually rides — never across the tilted
    // pad. NEGATIVE on lips whose ramp doesn't out-climb the local grade
    // (plunges); the real skier carries that glue into the pop, so does
    // the reference.
    const upX = this.centerX(jump.zLip + 1) + jump.xOffset + jumpDrift(jump, 1);
    const rise = y - this.height(upX, jump.zLip + 1);
    let vy = Math.min(speed * rise, speed * POP_CAP_RATIO) + POP_MAX * Math.sqrt(charge);
    // The leg band delays the real launch by ~a tenth: the flight begins a
    // little downstream, a little lower, already decayed.
    const bandDelay = 0.12;
    x += Math.sin(heading) * speed * bandDelay;
    z -= Math.cos(heading) * speed * bandDelay;
    y += (vy - 4.9 * bandDelay) * bandDelay;
    vy -= 9.81 * bandDelay;
    // Coarse march to the arc's own landing (or the horizon), then hang the
    // star at the target time — or at 3/4 of the flight when the venue cuts
    // the arc short, so short-flight lips keep their star meaningfully
    // airborne instead of dumped in the landing zone. The horizontal path
    // flies under the same guidance as a real neutral flight: heading eases
    // toward the course line (which hipAim bends across the track), with
    // the air-steering gain and rate cap mirrored from skier.ts.
    const step = 0.05;
    let h = heading;
    const path: [number, number, number][] = [];
    for (let t = 0; t < 2.5; t += step) {
      const target = this.trackHeading(z) + this.hipAim(x, z);
      const diff = Math.atan2(Math.sin(target - h), Math.cos(target - h));
      h += Math.max(-1.3, Math.min(1.3, 4 * diff)) * step;
      x += Math.sin(h) * speed * step;
      z -= Math.cos(h) * speed * step;
      y += vy * step;
      vy -= 9.81 * step;
      if (y <= this.height(x, z) + 0.5) break;
      path.push([x, y, z]);
    }
    const target = Math.min(Math.round(flightTime / step), Math.ceil(path.length * 0.75));
    const point = path[Math.max(0, target - 1)] ?? [x, y, z];
    // The star centers where the chest passes (collection is y + 1).
    return { x: point[0], z: point[2], y: point[1] + 1 };
  }

  bonusesNear(z: number): TrickBonus[] {
    const center = this.chunkIndexAt(z);
    const bonuses: TrickBonus[] = [];
    for (let i = center - 1; i <= center + 1; i++) {
      bonuses.push(...this.bonusesForChunk(i));
    }
    return bonuses;
  }

  // Slalom gates ride the narrows' snapping esses: one gate at each bend
  // apex (the sine's extremes), centered on the swinging centerline with a
  // little seeded jitter. The apexes near the section's ends are skipped —
  // the ease dampens the swing there and a gate on a straight is a cone in
  // a parking lot. Seeded, cached, and pure like every other generator.
  gatesForChunk(index: number): SlalomGate[] {
    const cached = this.chunkGates.get(index);
    if (cached) return cached;
    const gates: SlalomGate[] = [];
    const zTop = -index * CHUNK_LENGTH;
    // A chunk can straddle a section boundary; check both sections.
    const sections = new Set([
      this.sectionIndexAt(zTop - 0.01),
      this.sectionIndexAt(zTop - CHUNK_LENGTH),
    ]);
    for (const s of sections) {
      if (s < 1 || this.sectionType(s) !== 'narrows') continue;
      // Apexes of sin(local / wavelength * 2pi) at local = L/4 + k * L/2.
      for (let k = 0; ; k++) {
        const local = NARROWS_WAVELENGTH / 4 + k * (NARROWS_WAVELENGTH / 2);
        if (local > SECTION_LENGTH - 60) break; // the blend tail unwinds the swing
        if (local < 40) continue; // so does the head's ease-in
        const z = -(s * SECTION_LENGTH + local);
        if (z > zTop || z <= zTop - CHUNK_LENGTH) continue; // not this chunk's
        if (this.finishApron(z)) continue;
        const jitter = (hash2(this.seed, s * 31 + k, 6841) * 2 - 1) * 1.4;
        gates.push({ id: `g${s}:${k}`, x: this.centerX(z) + jitter, z, halfGap: 3.1 });
      }
    }
    this.chunkGates.set(index, gates);
    return gates;
  }

  gatesNear(z: number): SlalomGate[] {
    const center = this.chunkIndexAt(z);
    const gates: SlalomGate[] = [];
    for (let i = center - 1; i <= center + 1; i++) {
      gates.push(...this.gatesForChunk(i));
    }
    return gates;
  }

  // Patrol drones: at most one per chunk, only in the wide-open sections
  // (bowl, glacier), never sharing space with a kicker's ramp OR the
  // previous chunk's landing zone, never on a setpiece or in the grotto,
  // and never in the opening stretch — the first drone a run meets should
  // be read from a distance, not met at the gate.
  hazardsForChunk(index: number): Hazard[] {
    const cached = this.chunkHazards.get(index);
    if (cached) return cached;
    const hazards: Hazard[] = [];
    const zTop = -index * CHUNK_LENGTH;
    const z = zTop - CHUNK_LENGTH / 2 + (hash2(this.seed, index, 7351) * 2 - 1) * 6;
    const type = this.sectionType(this.sectionIndexAt(z));
    const chance = type === 'bowl' ? 0.55 : type === 'glacier' ? 0.4 : 0;
    if (
      index >= 8 &&
      chance > 0 &&
      !this.finishApron(zTop - CHUNK_LENGTH) &&
      hash2(this.seed, index, 7369) < chance &&
      this.jumpForChunk(index) === null &&
      this.jumpForChunk(index - 1) === null && // the uphill lip lands here
      !this.onSetpiece(z) &&
      !this.nearGrotto(z)
    ) {
      const half = this.channelHalfWidth(z);
      if (half >= 10) {
        hazards.push({
          id: `h${index}`,
          z,
          x0: this.centerX(z),
          // The sweep stays well inside the floor: there is always clean
          // snow to dodge onto at both ends of the patrol.
          amp: Math.min(half - 4.5, 15),
          period: 7 + hash2(this.seed, index, 7393) * 4,
          phase: hash2(this.seed, index, 7417) * Math.PI * 2,
          radius: 0.9,
          height: 2.3,
        });
      }
    }
    this.chunkHazards.set(index, hazards);
    return hazards;
  }

  hazardsNear(z: number): Hazard[] {
    const center = this.chunkIndexAt(z);
    const hazards: Hazard[] = [];
    for (let i = center - 1; i <= center + 1; i++) {
      hazards.push(...this.hazardsForChunk(i));
    }
    return hazards;
  }
}
