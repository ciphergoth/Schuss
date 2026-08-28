import type { ContractDemand, HazardKind, JumpKind, SectionType } from './terrain';

// =============================================================================
// THE COURSE DESIGN: "The Grand Tour", drawn by hand.
//
// The procedural generator survives as the ENDLESS TEST MOUNTAIN (any
// ?seed=N other than the default, and every physics/drainage test), but the
// course players ride is authored here: every bend, every width change,
// every kicker, star loadout, obstacle, coin line, creature, and gallery is
// a decision, not a dice roll. Star POSITIONS stay computed (terrain.
// starOnArc integrates the reference flight against the real heightfield —
// that is physics, not chance); what the designer picks is which lips carry
// which multipliers and demands.
//
// Coordinates: `at` is meters FROM THE START GATE (positive, downhill), so
// the design reads top-to-bottom like the run. Terrain converts to world z
// (z = -at). Lateral offsets are meters from the track centerline, +x right.
//
// THE ARC (one line per act):
//   0-400    cruise   THE DROP-IN    teach: one kicker, one dodge, one jelly
//   400-800  bowl     THE FAIRGROUND playground: every kicker size, the
//                                    rhythm double, galleries, the XL gate
//   800-1200 narrows  THE NEEDLE     empty, fast, five gates on the esses
//   1200-1600 sweeper THE SERPENTINE waterfall entry, banked flow, a yeti
//   1600-2000 glacier BLUE MIRROR    ice speed, THE GROTTO, a hip off the ice
//   2000-2400 powder  THE QUILT      hush, the cascades, the wyrm
//   2400-2800 steps   THE ORGAN      terraces and tumblers, rhythm skiing
//   2800-3200 canyon  THE SHOULDERS  wall-to-wall tension, apex coins
//   3200-3600 plunge  THE SCREAMER   the big send, one last hit, the flag
// =============================================================================

// A 1D design curve: hand-authored control points interpolated with a
// monotone cubic (Fritsch–Carlson), so the curve passes THROUGH every point
// with no overshoot — a designed width of 7 never dips to 6 on its own.
export type CurvePoint = readonly [at: number, value: number];

export function curve1d(points: readonly CurvePoint[], at: number): number {
  const n = points.length;
  if (at <= points[0]![0]) return points[0]![1];
  if (at >= points[n - 1]![0]) return points[n - 1]![1];
  let i = 0;
  while (points[i + 1]![0] < at) i++;
  const [x0, y0] = points[i]!;
  const [x1, y1] = points[i + 1]!;
  const h = x1 - x0;
  const d = (y1 - y0) / h;
  // Fritsch–Carlson tangents: harmonic means of neighbor secants, zeroed
  // where the data turns, so designed extremes hold with no overshoot.
  const dPrev = i > 0 ? (y0 - points[i - 1]![1]) / (x0 - points[i - 1]![0]) : d;
  const dNext = i + 2 < n ? (points[i + 2]![1] - y1) / (points[i + 2]![0] - x1) : d;
  const tangent = (a: number, b: number): number => (a * b <= 0 ? 0 : (2 * a * b) / (a + b));
  const m0 = i === 0 ? d : tangent(dPrev, d);
  const m1 = i + 2 === n ? d : tangent(d, dNext);
  const t = (at - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * m1
  );
}

export interface DesignedJump {
  at: number; // the lip
  x: number; // lateral offset of the pad's core
  kind: JumpKind;
  stepDown?: boolean;
  hip?: -1 | 1;
  pair?: 'lead' | 'follow';
  // The star loadout this lip carries (positions computed on the arc).
  stars: readonly { mult: 3 | 5; demand: ContractDemand }[];
}

export interface DesignedObstacle {
  at: number;
  x: number;
  kind: 'crystal' | 'bollard';
  radius: number;
}

export interface DesignedCoinLine {
  at: number; // first coin; the line runs downhill from here
  x: number;
  n: number; // coins, 3m apart
}

export interface DesignedHazard {
  at: number;
  kind: HazardKind;
  amp: number;
  period: number;
  phase: number;
  aux: number;
}

export interface DesignedGallery {
  at: number;
  side: -1 | 1;
}

export interface CourseDesign {
  sections: readonly SectionType[]; // exactly 9: [0] cruise, [8] plunge
  zones: readonly string[]; // palette names, in order (8)
  weather: { snow: number; fogBanks: number };
  bends: readonly CurvePoint[]; // centerline wander (esses layer on top)
  widths: readonly CurvePoint[]; // floor half-width
  line: readonly CurvePoint[]; // the golden path (crud corridor follows it)
  waterfallAt: number;
  cascadesAt: number;
  grottoAt: number;
  jumps: readonly DesignedJump[];
  obstacles: readonly DesignedObstacle[];
  coins: readonly DesignedCoinLine[];
  hazards: readonly DesignedHazard[];
  galleries: readonly DesignedGallery[];
}

export const GRAND_TOUR: CourseDesign = {
  // The tour order is the emotional arc: teach, play, squeeze, flow,
  // wonder, hush, rhythm, tension, release.
  sections: [
    'cruise',
    'bowl',
    'narrows',
    'sweeper',
    'glacier',
    'powder',
    'steps',
    'canyon',
    'plunge',
  ],
  // Color follows mood: warm fairground, storm-lit needle, ice-blue mirror
  // (the grotto dims it to black), blizzard rolling over the quilt,
  // alien emerald organ, rose-lit canyon, and a neon night finale so the
  // finish barrage owns the sky.
  zones: [
    'dusk',
    'golden hour',
    'violet storm',
    'ice blue',
    'blizzard',
    'emerald',
    'rose dawn',
    'neon night',
  ],
  weather: { snow: 0.5, fogBanks: 0 }, // flurries, full visibility: a
  // designed course wants to be READ from two hundred meters out

  // The wander: gentle S through the drop-in, broad fairground swings,
  // near-still through the needle and the organ (their own features bend),
  // long fast arcs across the mirror, one last big carve into a dead-
  // straight run at the flag. The narrows/sweeper/canyon esses are LAYERED
  // on top of this by the section machinery — these points are the trend
  // line the esses swing around.
  bends: [
    [0, 0],
    [60, 0],
    [140, 6],
    [260, -10],
    [380, 4],
    [500, 18],
    [650, -14],
    [780, 6],
    [900, 0],
    [1100, -6],
    [1210, 0],
    [1350, 10],
    [1500, -8],
    [1620, 4],
    [1760, 10],
    [1900, -14],
    [2000, -4],
    [2100, 10],
    [2250, -8],
    [2400, 0],
    [2550, 6],
    [2700, -6],
    [2820, 0],
    [3150, 0],
    [3300, 16],
    [3420, -8],
    [3520, 0],
    [3800, 0],
  ],

  // The breath of the course: open, blow WIDE for the fairground, slam to
  // the needle's 7m, settle for the flow, pinch a little through the
  // grotto's portals, spread for the quilt, and hold a fast 17-18 to the
  // line so the finale is about speed, not steering.
  widths: [
    [0, 15],
    [200, 15],
    [420, 21],
    [560, 27],
    [760, 22],
    [850, 9],
    [950, 7],
    [1150, 7],
    [1240, 12],
    [1320, 13],
    [1560, 13],
    [1650, 16],
    [1705, 14],
    [1780, 16],
    [1900, 17],
    [2050, 20],
    [2350, 20],
    [2460, 15],
    [2750, 15],
    [2860, 10],
    [3140, 10],
    [3260, 17],
    [3450, 18],
    [3800, 16],
  ],

  // The golden path: the clean corridor and the kicker line agree — follow
  // the plan and every lip arrives under your skis.
  line: [
    [0, 0],
    [190, 0],
    [420, 4],
    [455, 6],
    [520, -3],
    [585, -9],
    [650, -8],
    [776, -8],
    [850, 0],
    [1374, 0],
    [1859, 0],
    [1950, 4],
    [2299, -3],
    [2450, 0],
    [3305, 0],
    [3800, 0],
  ],

  // The three landmarks, placed inside the windows the generator honors
  // (waterfall 25-40% in, cascades 55-70%, grotto 44-50%): the waterfall
  // dives you INTO the serpentine, the grotto is the blue mirror's heart,
  // and the cascades stair-step the quilt.
  waterfallAt: 1260,
  cascadesAt: 2140,
  grottoAt: 1660,

  // Fourteen lips under THE RHYTHM RULE. A star's contract pays on the
  // NEXT trick, so its real cash venue is the literal NEXT LIP — and the
  // first plan kept getting that backwards (flip demands hung ON the soft
  // stepdown instead of on the lip whose venue it is; the send's deal had
  // no venue a fast rider could reach at all). The law now:
  //   1. Every starred lip's next lip sits 100-250m downrange — far enough
  //      to land and recharge, close enough that the deal stays alive in
  //      your head. One designed exception: the hip's deal rides the whole
  //      quilt (405m of hush) to the L — the course's single long
  //      anticipation, placed in its quietest act.
  //   2. The venue's air fits the demand: flip2/parallel need an XL or a
  //      step-down L to cash; spin2/mix need L-class air; singles cash off
  //      any popped M.
  //   3. A desert is entered CLEAN: the last lip before the needle, the
  //      canyon, and the line carries no stars, so no contract ever drags
  //      through a jumpless act (the old plan hung a x5 on the bowl's exit
  //      and let it die 750m later in the narrows).
  //   4. The finale is measured against the BURNER, not the cruiser: the
  //      send at 3232 with the victory L at 3439 leaves the worst-case
  //      175m flight landing short of the victory ramp (base 3420), so
  //      every pace still gets its cash attempt before the line.
  // Chunk math: each lip's in-chunk offset must be >= its ramp length (the
  // heightfield scans one chunk of approach). Demands sequence gold's whole
  // pool before repeating. Every placement below is tuned against the
  // reference riders (`pnpm ride`): the double's spacing fits the REAL
  // popped-M landing (~60m at bowl pace), and no flight lands on the
  // cascades' faces (which is why the quilt keeps exactly one lip, after
  // the falls).
  jumps: [
    { at: 190, x: 0, kind: 'M', stars: [] }, // the tutorial: learn the lip first
    { at: 335, x: -4, kind: 'S', stars: [] }, // pop practice, pure air
    {
      at: 455,
      x: 6,
      kind: 'M',
      stars: [
        { mult: 3, demand: 'front' },
        { mult: 5, demand: 'parallel' },
      ],
    }, // the fairground opens the book: both deals cash on the booter's air
    { at: 585, x: -9, kind: 'XL', stars: [{ mult: 3, demand: 'back' }] }, // THE BOOTER:
    // the venue with air for anything, carrying its own deal into the double
    { at: 700, x: -8, kind: 'M', pair: 'lead', stars: [{ mult: 3, demand: 'spinL' }] }, // the
    // double: grab on the first hit, land at the follow's ramp base...
    { at: 776, x: -8, kind: 'M', pair: 'follow', stars: [] }, // ...deliver on the second.
    // Clean into the needle: the gates are its whole economy
    { at: 1374, x: 0, kind: 'M', stars: [{ mult: 3, demand: 'spinR' }] }, // out of the
    // waterfall, into the flow: deal and venue two beats apart
    { at: 1494, x: 0, kind: 'M', stars: [] }, // the venue; clean into the grotto's dark
    { at: 1894, x: 4, kind: 'M', hip: -1, stars: [{ mult: 3, demand: 'spin2' }] }, // slung off
    // the ice — the deal rides the quilt to the big L (the one long carry)
    {
      at: 2299,
      x: -3,
      kind: 'L',
      stars: [
        { mult: 3, demand: 'spinL' },
        { mult: 5, demand: 'flip2' },
      ],
    }, // the quilt's big hit: both deals cash in the organ's soft catch
    { at: 2539, x: 0, kind: 'L', stepDown: true, stars: [{ mult: 3, demand: 'back' }] }, // the
    // organ's step-down: float for the flip2, its own deal two terraces on
    { at: 2660, x: 0, kind: 'M', stars: [] }, // the venue; clean into the canyon
    {
      at: 3232,
      x: 0,
      kind: 'XL',
      stars: [
        { mult: 3, demand: 'spin2' },
        { mult: 5, demand: 'mix' },
      ],
    }, // THE SEND: demands the victory L's air can actually hold
    { at: 3439, x: 0, kind: 'L', stars: [] }, // the victory hit; the line locks the score
  ],

  // Six obstacles, each a deliberate cue: a gate-pair to weave in the
  // drop-in, barrels walling the wrong side of the double's line, one
  // crystal pinching the XL approach honest.
  obstacles: [
    // The drop-in weave, between the S's landing and the fairground's first
    // ramp (and out of the jelly's chunk).
    { at: 370, x: 4, kind: 'crystal', radius: 0.6 },
    { at: 378, x: -6, kind: 'bollard', radius: 0.7 },
    { at: 395, x: -1, kind: 'crystal', radius: 0.55 },

    { at: 600, x: 12, kind: 'bollard', radius: 0.75 }, // walling the wrong side
    { at: 608, x: 9, kind: 'bollard', radius: 0.7 }, //  of the booter's line
    { at: 688, x: 13, kind: 'crystal', radius: 0.65 },
  ],

  // Coin lines: detours in the open sections, bank rewards at every
  // serpentine apex, a glowing line straight through the grotto's dark,
  // brink-lines on the organ, apex coins high on the canyon walls, and a
  // last speed line down the screamer. None in the needle — the gates are
  // its whole economy.
  coins: [
    { at: 120, x: 5, n: 4 },
    { at: 160, x: -6, n: 3 },
    { at: 215, x: 0, n: 3 },
    { at: 450, x: 10, n: 3 },
    { at: 540, x: -14, n: 4 },
    { at: 720, x: 6, n: 4 },
    { at: 1250, x: 10, n: 3 },
    { at: 1350, x: -10, n: 3 },
    { at: 1450, x: 10, n: 3 },
    { at: 1550, x: -10, n: 3 },
    { at: 1620, x: 0, n: 5 },
    { at: 1690, x: 0, n: 5 },
    { at: 1730, x: 0, n: 3 },
    { at: 2030, x: 0, n: 4 },
    { at: 2100, x: 2, n: 3 },
    { at: 2180, x: 0, n: 3 },
    { at: 2230, x: 0, n: 3 },
    { at: 2447, x: 0, n: 3 },
    { at: 2620, x: -4, n: 3 }, // between the step-down's landing and the venue's ramp
    { at: 2730, x: 4, n: 3 },
    { at: 2842, x: 7, n: 3 },
    { at: 2927, x: -7, n: 3 },
    { at: 3097, x: -7, n: 3 },
    { at: 3155, x: 0, n: 5 }, // the canyon-exit speed line, before the send's ramp
    { at: 3180, x: 0, n: 4 },
  ],

  // Seven creatures, one act at a time, each in its home biome and each
  // clear of every lip's approach and landing: the jelly greets the
  // fairground, the yeti owns a serpentine straight, one drone sweeps the
  // mirror past the grotto, the wyrm swims the quilt with a second yeti
  // deeper in, and the tumblers work the organ.
  hazards: [
    { at: 401, kind: 'jelly', amp: 8, period: 12, phase: 0.5, aux: 0.4 },
    { at: 1440, kind: 'yeti', amp: 8, period: 9, phase: 0.2, aux: 0.5 }, // between the flow lips
    { at: 1790, kind: 'drone', amp: 11, period: 9, phase: 1.2, aux: 0.3 },
    { at: 2065, kind: 'wyrm', amp: 12, period: 11, phase: 2.1, aux: 0.5 },
    { at: 2380, kind: 'yeti', amp: 9, period: 9, phase: 3.4, aux: 0.8 },
    { at: 2445, kind: 'tumbler', amp: 4, period: 8, phase: 0.15, aux: 0.35 }, // above the step-down
    { at: 2745, kind: 'tumbler', amp: 5, period: 8, phase: 0.65, aux: 0.7 }, // below the venue
  ],

  // Ten galleries, one at every landing worth playing to — including the
  // tutorial's (the first cheer teaches the mechanic) — plus one camped on
  // the organ's best terrace.
  // Every gallery sits inside GALLERY_RANGE of where the reference rider
  // actually touches down (cruiser AND popper), not where a designer
  // guessed a landing might be.
  galleries: [
    { at: 238, side: -1 }, // the tutorial's landing: the first cheer teaches the mechanic
    { at: 520, side: 1 },
    { at: 642, side: -1 }, // the booter's landing
    { at: 818, side: 1 }, // the follow's landing, waving you into the needle
    { at: 1422, side: 1 },
    { at: 1542, side: -1 },
    { at: 1996, side: -1 }, // where cruiser and popper hip flights both come down
    { at: 2390, side: 1 },
    { at: 2600, side: -1 },
    { at: 3340, side: -1 }, // the send's landing
  ],
};
