import { describe, expect, it } from 'vitest';
import {
  CHUNK_LENGTH,
  COURSE_LENGTH,
  FINISH_APRON,
  GRADE,
  Hazard,
  SECTION_LENGTH,
  SectionType,
  Terrain,
  WALL_WIDTH,
  WYRM_SEGMENTS,
  hazardCircles,
  jellyPose,
} from './terrain';

// Find the first section of a given type (searching a long way downhill).
function findSection(t: Terrain, type: SectionType, from = 1, to = 80): number {
  for (let s = from; s < to; s++) {
    if (t.sectionType(s) === type) return s;
  }
  throw new Error(`no ${type} section in ${from}..${to}`);
}

describe('terrain', () => {
  it('is a pure function of the seed', () => {
    const a = new Terrain(42);
    const b = new Terrain(42);
    for (let i = 0; i < 50; i++) {
      const x = ((i * 37) % 60) - 30;
      const z = -i * 11;
      expect(a.height(x, z)).toBe(b.height(x, z));
      expect(a.centerX(z)).toBe(b.centerX(z));
    }
    expect(a.obstaclesForChunk(5)).toEqual(b.obstaclesForChunk(5));
    expect(a.pickupsForChunk(5)).toEqual(b.pickupsForChunk(5));
    for (let s = 0; s < 30; s++) expect(a.sectionType(s)).toBe(b.sectionType(s));
  });

  it('differs between seeds', () => {
    expect(new Terrain(1).height(3, -50)).not.toBe(new Terrain(2).height(3, -50));
  });

  it('slopes downhill toward -z along the centerline', () => {
    const t = new Terrain(7);
    expect(t.height(t.centerX(-200), -200)).toBeLessThan(t.height(t.centerX(0), 0) - 40);
  });

  it('is straight near the start and uphill, curving further down', () => {
    const t = new Terrain(7);
    expect(t.centerX(0)).toBe(0);
    expect(t.centerX(800)).toBe(0); // uphill physics-lab stays straight
    let curved = false;
    for (let z = -200; z > -2000; z -= 100) {
      if (Math.abs(t.centerX(z)) > 5) curved = true;
    }
    expect(curved).toBe(true);
  });

  it('walls rise steeply enough to contain the skier', () => {
    const t = new Terrain(3);
    for (const z of [-100, -500, -1234]) {
      const c = t.centerX(z);
      const floor = t.height(c, z);
      const lip = t.height(c + t.channelHalfWidth(z) + WALL_WIDTH, z);
      const beyond = t.height(c + t.channelHalfWidth(z) + WALL_WIDTH + 6, z);
      expect(lip - floor).toBeGreaterThan(5); // rideable bank, real height
      expect(beyond - lip).toBeGreaterThan(6); // and it keeps getting worse
    }
  });

  it('sections give every run personality, and never twice in a row', () => {
    const t = new Terrain(1, Infinity);
    const seen = new Set<SectionType>();
    for (let s = 1; s < 60; s++) {
      seen.add(t.sectionType(s));
      expect(t.sectionType(s)).not.toBe(t.sectionType(s - 1));
    }
    expect(t.sectionType(0)).toBe('cruise'); // gentle opening, always
    expect(seen.size).toBeGreaterThanOrEqual(5); // real variety over 24km
  });

  it('the narrows squeeze and the bowls blow open', () => {
    const t = new Terrain(1, Infinity);
    const narrows = findSection(t, 'narrows');
    const bowl = findSection(t, 'bowl');
    const mid = (s: number) => -(s + 0.5) * SECTION_LENGTH;
    expect(t.channelHalfWidth(mid(narrows))).toBeLessThan(9);
    expect(t.channelHalfWidth(mid(bowl))).toBeGreaterThan(22);
    // And the floor never collapses or sprawls beyond reason anywhere.
    for (let z = -50; z > -8000; z -= 25) {
      const w = t.channelHalfWidth(z);
      expect(w).toBeGreaterThan(5.5);
      expect(w).toBeLessThan(31.5);
    }
  });

  it('a plunge drops far more than the mean grade', () => {
    const t = new Terrain(1, Infinity);
    const s = findSection(t, 'plunge');
    const zTop = -s * SECTION_LENGTH;
    const zBot = zTop - SECTION_LENGTH;
    const drop = t.height(t.centerX(zTop), zTop) - t.height(t.centerX(zBot), zBot);
    expect(drop).toBeGreaterThan(GRADE * SECTION_LENGTH + 40);
  });

  it('a steps section is a staircase of launchable terrace edges', () => {
    const t = new Terrain(1, Infinity);
    const s = findSection(t, 'steps');
    const zTop = -s * SECTION_LENGTH;
    let edges = 0;
    let lastEdge = -100;
    for (let local = 30; local < SECTION_LENGTH - 30; local += 1) {
      const z = zTop - local;
      const c = t.centerX(z);
      const slope = t.height(c, z + 0.5) - t.height(c, z - 0.5);
      if (slope > 0.75 && local - lastEdge > 20) {
        edges++;
        lastEdge = local;
      }
    }
    expect(edges).toBeGreaterThanOrEqual(5);
  });

  it('sweepers bank the floor into the turn', () => {
    const t = new Terrain(1, Infinity);
    const s = findSection(t, 'sweeper');
    const zTop = -s * SECTION_LENGTH;
    // Find the sharpest bend in the meat of the section.
    let bestZ = 0;
    let bestCurv = 0;
    for (let local = 80; local < SECTION_LENGTH - 80; local += 5) {
      const z = zTop - local;
      const curv = (t.centerX(z - 4) - 2 * t.centerX(z) + t.centerX(z + 4)) / 16;
      if (Math.abs(curv) > Math.abs(bestCurv)) {
        bestCurv = curv;
        bestZ = z;
      }
    }
    const [gx] = t.gradient(t.centerX(bestZ), bestZ);
    expect(Math.abs(bestCurv)).toBeGreaterThan(0.015); // it really bends
    expect(Math.abs(gx)).toBeGreaterThan(0.12); // the floor really tilts
    expect(gx * bestCurv).toBeLessThan(0); // and into the turn, not out of it
    expect(Math.abs(gx)).toBeLessThan(GRADE); // still skiable
  });

  it('kickers come in sizes and personalities', () => {
    const t = new Terrain(1, Infinity);
    const kinds = new Set<string>();
    let stepDowns = 0;
    let hips = 0;
    let jumps = 0;
    for (let i = 3; i < 400; i++) {
      const jump = t.jumpForChunk(i);
      if (!jump) continue;
      jumps++;
      kinds.add(jump.kind);
      if (jump.stepDown > 0) stepDowns++;
      if (jump.hip !== 0) hips++;
      expect(jump.stepDown === 0 || jump.hip === 0).toBe(true); // never both
    }
    expect(jumps).toBeGreaterThan(15);
    expect(kinds).toEqual(new Set(['S', 'M', 'L', 'XL']));
    expect(stepDowns).toBeGreaterThan(1);
    expect(hips).toBeGreaterThan(1);
  });

  it('hip pads bank the approach toward the throw', () => {
    const t = new Terrain(1, Infinity); // hips are rare; hunt the endless mountain
    let found = false;
    for (let i = 3; i < 400 && !found; i++) {
      const jump = t.jumpForChunk(i);
      if (!jump || jump.hip === 0) continue;
      found = true;
      const z = jump.zLip + 4; // on the ramp, tilt fully built
      const core = t.centerX(z) + jump.xOffset;
      const [gx] = t.gradient(core, z);
      // Surface falls toward the throw side: gravity slings the launch.
      expect(gx * jump.hip).toBeLessThan(-0.2);
    }
    expect(found).toBe(true);
  });

  it('hip stars hang off the drifted, thrown line, not the straight core', () => {
    const t = new Terrain(1, Infinity);
    let found = false;
    for (let i = 3; i < 400 && !found; i++) {
      const jump = t.jumpForChunk(i);
      if (!jump || jump.hip === 0) continue;
      found = true;
      const b3 = t.bonusesForChunk(i).find((b) => b.mult === 3)!;
      const straightX = t.centerX(b3.z) + jump.xOffset;
      expect((b3.x - straightX) * jump.hip).toBeGreaterThan(6);
    }
    expect(found).toBe(true);
  });

  it('sweeper berms are clean racing snow; other banks stay crud', () => {
    const t = new Terrain(1, Infinity);
    const sweeper = findSection(t, 'sweeper');
    const zs = -(sweeper + 0.5) * SECTION_LENGTH;
    expect(t.stickinessAt(t.centerX(zs) + t.channelHalfWidth(zs) + 3, zs)).toBeLessThan(0.05);
    const cruise = findSection(t, 'cruise', 2);
    const zc = -(cruise + 0.5) * SECTION_LENGTH;
    expect(t.stickinessAt(t.centerX(zc) + t.channelHalfWidth(zc) + 3, zc)).toBeGreaterThan(0.5);
  });

  it('a course has an arc: cruise opening, plunge finale, empty outrun', () => {
    for (const seed of [1, 2, 5]) {
      const t = new Terrain(seed); // default course length
      const last = COURSE_LENGTH / SECTION_LENGTH - 1;
      expect(t.sectionType(0)).toBe('cruise');
      expect(t.sectionType(last)).toBe('plunge'); // the finale
      expect(t.sectionType(last - 1)).not.toBe('plunge'); // earned, not doubled
      expect(t.sectionType(last + 1)).toBe('cruise'); // the outrun
      // The outrun asks nothing of you and offers nothing.
      const firstOutrunChunk = COURSE_LENGTH / CHUNK_LENGTH;
      for (let i = firstOutrunChunk; i < firstOutrunChunk + 10; i++) {
        expect(t.obstaclesForChunk(i)).toEqual([]);
        expect(t.pickupsForChunk(i)).toEqual([]);
        expect(t.jumpForChunk(i)).toBeNull();
        expect(t.bonusesForChunk(i)).toEqual([]);
      }
      // Outrun snow is clean celebratory racing snow.
      const zOut = -COURSE_LENGTH - 100;
      expect(t.stickinessAt(t.centerX(zOut) + 3, zOut)).toBe(0);
    }
  });

  it('a clean apron runs the last stretch into the gate: land before, not through', () => {
    const apronStart = COURSE_LENGTH - FINISH_APRON;
    for (const seed of [1, 2, 3, 5, 8]) {
      const t = new Terrain(seed);
      const finishChunk = COURSE_LENGTH / CHUNK_LENGTH;
      // Walk every chunk that could reach into the apron (and a few past the
      // line) and assert nothing worth doing lives in the run-in to the flag.
      for (let i = finishChunk - 4; i <= finishChunk + 2; i++) {
        const jump = t.jumpForChunk(i);
        if (jump) {
          // A lip may sit just outside the apron, but never inside it: even
          // its flight has to land you on the ground before the gate.
          expect(t.finishApron(jump.zLip)).toBe(false);
        }
        for (const o of t.obstaclesForChunk(i)) expect(t.finishApron(o.z)).toBe(false);
        for (const p of t.pickupsForChunk(i)) expect(t.finishApron(p.z)).toBe(false);
        for (const b of t.bonusesForChunk(i)) expect(t.finishApron(b.z)).toBe(false);
      }
      // Snow inside the apron is clean racing snow, right up to the line.
      for (let z = -apronStart; z >= -COURSE_LENGTH; z -= 10) {
        expect(t.stickinessAt(t.centerX(z), z)).toBe(0);
      }
    }
  });

  it('the first kicker of every run is the classic flat M', () => {
    for (const seed of [1, 2, 3, 4]) {
      const t = new Terrain(seed);
      let index = 3;
      while (!t.jumpForChunk(index) && index < 30) index++;
      const jump = t.jumpForChunk(index);
      if (!jump) continue;
      if (jump.zLip > -SECTION_LENGTH) {
        expect(jump.kind).toBe('M');
        expect(jump.stepDown).toBe(0);
      }
    }
  });

  it('a step-down kicker scoops its landing out of the floor', () => {
    const t = new Terrain(1, Infinity);
    let found = false;
    for (let i = 3; i < 400 && !found; i++) {
      const jump = t.jumpForChunk(i);
      if (!jump || jump.stepDown === 0) continue;
      // Measure on calm floor: a plunge already breaks the grade away, so its
      // scoop reads shallow against a floor that's itself dropping (the plunge
      // supplies the float for free), and banking tilts the lateral profile.
      if (t.sectionType(Math.floor(-jump.zLip / SECTION_LENGTH)) === 'plunge') continue;
      const curv =
        (t.centerX(jump.zLip - 4) - 2 * t.centerX(jump.zLip) + t.centerX(jump.zLip + 4)) / 16;
      if (Math.abs(curv) > 0.01) continue; // keep banking out of the measurement
      found = true;
      // ~8m past the lip: near the deepest scoop, before the grade (steeper
      // than CARVE_SLOPE by design) catches the carve back up to the floor.
      const z = jump.zLip - 8;
      const core = t.centerX(z) + jump.xOffset;
      const outside = core + jump.halfWidth + 2 + 5 + 3; // past the scoop fade
      expect(t.height(outside, z) - t.height(core, z)).toBeGreaterThan(1);
    }
    expect(found).toBe(true);
  });

  it('keeps the floor gentler than the mean grade suggests', () => {
    // Cross-slope on the floor should be small: the channel is skiable.
    const t = new Terrain(9);
    for (const z of [-80, -400, -900]) {
      const c = t.centerX(z);
      const [gx] = t.gradient(c, z);
      expect(Math.abs(gx)).toBeLessThan(GRADE);
    }
  });

  it('places sparse obstacles on the channel floor, away from the walls', () => {
    const t = new Terrain(3);
    let total = 0;
    for (let index = 5; index < 60; index++) {
      for (const o of t.obstaclesForChunk(index)) {
        total++;
        expect(Math.abs(o.x - t.centerX(o.z))).toBeLessThan(t.channelHalfWidth(o.z) - 1);
        expect(o.z).toBeLessThanOrEqual(-index * CHUNK_LENGTH);
        expect(o.z).toBeGreaterThan(-(index + 1) * CHUNK_LENGTH);
      }
    }
    expect(total).toBeGreaterThan(3); // present (bowls bring slaloms)
    expect(total).toBeLessThan(90); // but not a forest
  });

  it('slow crud: sticky banks, floor patches, clean ramps and run-in', () => {
    const t = new Terrain(1);
    // Banks are made of crud.
    for (const z of [-150, -600]) {
      const c = t.centerX(z);
      expect(t.stickinessAt(c + t.channelHalfWidth(z) + 4, z)).toBeGreaterThan(0.9);
    }
    // The run-in is clean everywhere on the floor.
    for (let x = -10; x <= 10; x += 2) expect(t.stickinessAt(x, -30)).toBe(0);
    // Patches exist somewhere on the racing floor.
    let found = 0;
    for (let z = -100; z > -3000; z -= 7) {
      if (t.stickinessAt(t.centerX(z) + ((z * 7) % 9), z) > 0.5) found++;
    }
    expect(found).toBeGreaterThan(5);
    // Kicker ramps are always fast snow.
    let index = 3;
    while (!t.jumpForChunk(index)) index++;
    const j = t.jumpForChunk(index)!;
    const core = t.centerX(j.zLip) + j.xOffset;
    expect(t.stickinessAt(core, j.zLip + 5)).toBe(0);
  });

  it('keeps the opening chunks and the run-in obstacle-free', () => {
    for (const seed of [1, 2, 3]) {
      const t = new Terrain(seed);
      for (const index of [0, 1, 2, 3, 4, 5, -3]) {
        expect(t.obstaclesForChunk(index)).toEqual([]);
      }
    }
  });

  it('keeps all pickups within the channel', () => {
    const t = new Terrain(1);
    for (let index = 1; index < 40; index++) {
      for (const p of t.pickupsForChunk(index)) {
        expect(Math.abs(p.x - t.centerX(p.z))).toBeLessThan(t.channelHalfWidth(p.z) + 1);
      }
    }
    expect(t.pickupsForChunk(0)).toEqual([]);
  });

  it('places deterministic ski jumps along the course', () => {
    const a = new Terrain(1);
    const b = new Terrain(1);
    const jumpChunks: number[] = [];
    for (let i = 0; i < 60; i++) {
      expect(a.jumpForChunk(i)).toEqual(b.jumpForChunk(i));
      if (a.jumpForChunk(i)) jumpChunks.push(i);
    }
    expect(jumpChunks.length).toBeGreaterThan(3);
    expect(a.jumpForChunk(0)).toBeNull(); // never in the run-in
  });

  it('kickers are steerable features: sheer at their core, flat floor beside', () => {
    const t = new Terrain(1);
    let index = 3;
    while (!t.jumpForChunk(index)) index++;
    const jump = t.jumpForChunk(index)!; // the opening kicker: flat M
    const core = t.centerX(jump.zLip) + jump.xOffset;
    const dropAtCore = t.height(core, jump.zLip + 0.05) - t.height(core, jump.zLip - 0.05);
    expect(dropAtCore).toBeGreaterThan(jump.lipHeight * 0.8);
    // A couple of meters past the shoulder the floor doesn't notice the jump.
    const beside = core + jump.halfWidth + 4;
    const dropBeside = t.height(beside, jump.zLip + 0.05) - t.height(beside, jump.zLip - 0.05);
    expect(Math.abs(dropBeside)).toBeLessThan(0.3);
    // And the kicker never crowds the walls.
    expect(Math.abs(jump.xOffset) + jump.halfWidth).toBeLessThan(t.channelHalfWidth(jump.zLip) - 1);
  });

  it('crud never walls off the course: a clean line always exists', () => {
    const t = new Terrain(1);
    for (let z = -100; z > -3000; z -= 10) {
      const c = t.centerX(z);
      const half = t.channelHalfWidth(z) - 1;
      let cleanest = Infinity;
      for (let d = -half; d <= half; d += 0.5) {
        cleanest = Math.min(cleanest, t.stickinessAt(c + d, z));
      }
      expect(cleanest).toBeLessThan(0.05);
    }
  });

  it('kicker approaches are crud-free', () => {
    const t = new Terrain(1);
    for (let index = 3; index < 60; index++) {
      const jump = t.jumpForChunk(index);
      if (!jump) continue;
      for (let u = 0; u <= jump.rampLength + 14; u += 2) {
        for (const dd of [-jump.halfWidth, 0, jump.halfWidth]) {
          const z = jump.zLip + u;
          expect(t.stickinessAt(t.centerX(z) + jump.xOffset + dd, z)).toBe(0);
        }
      }
    }
  });

  it('kickers sit on the golden path and never come consecutively', () => {
    const t = new Terrain(1);
    let found = 0;
    for (let i = 3; i < 90; i++) {
      const jump = t.jumpForChunk(i);
      if (!jump) continue;
      found++;
      expect(t.jumpForChunk(i + 1)).toBeNull(); // no overfly-able features
      const maxOffset = t.channelHalfWidth(jump.zLip) - jump.halfWidth - 2.3;
      const plan = Math.max(-maxOffset, Math.min(maxOffset, t.planOffset(jump.zLip)));
      expect(Math.abs(jump.xOffset - plan)).toBeLessThan(0.6);
    }
    expect(found).toBeGreaterThan(3);
  });

  it('coins are sparse off-plan temptations, not a breadcrumb trail', () => {
    const t = new Terrain(1);
    let offPlan = 0;
    let coins = 0;
    for (let index = 1; index < 20; index++) {
      const chunkCoins = t.pickupsForChunk(index);
      expect(chunkCoins.length).toBeLessThanOrEqual(3); // clusters, not a line
      coins += chunkCoins.length;
      for (const p of chunkCoins) {
        if (Math.abs(p.x - (t.centerX(p.z) + t.planOffset(p.z))) > 2.5) offPlan++;
      }
    }
    expect(coins).toBeGreaterThan(10); // they do exist
    expect(offPlan / coins).toBeGreaterThan(0.6); // and mostly pay you to leave the plan
  });

  it('kickers hang a VARIED star loadout past the lip, deterministically', () => {
    const a = new Terrain(1);
    const b = new Terrain(1);
    let found = 0;
    const loadouts = new Set<string>();
    for (let index = 3; index < 200; index++) {
      expect(a.bonusesForChunk(index)).toEqual(b.bonusesForChunk(index)); // pure
      const jump = a.jumpForChunk(index);
      const stars = a.bonusesForChunk(index);
      if (!jump) {
        expect(stars).toEqual([]);
        continue;
      }
      found++;
      const mults = stars.map((s) => s.mult).sort();
      loadouts.add(mults.join(','));
      // Hips and small lips (S/M) carry only the x3 for now (their x5 awaits
      // honest placement); big lips (L/XL) deal one of the four varied
      // loadouts, so the magenta star always means a reachable superhuman arc.
      const big = jump.kind === 'L' || jump.kind === 'XL';
      const valid = jump.hip !== 0 ? [[3]] : big ? [[], [3], [5], [3, 5]] : [[], [3]];
      expect(valid).toContainEqual(mults);
      for (const s of stars) expect(s.z).toBeLessThan(jump.zLip); // past the lip
    }
    expect(found).toBeGreaterThan(3);
    // The whole point: not every kicker is the same gate anymore.
    expect(loadouts.size).toBeGreaterThan(2);
  });

  it('the last jump of the course carries no star — its contract could never cash', () => {
    const finishChunk = Math.ceil(COURSE_LENGTH / CHUNK_LENGTH);
    for (const seed of [1, 2, 3, 7, 42, 99]) {
      const t = new Terrain(seed);
      let lastJump = -1;
      let earlierStarred = false;
      for (let i = 3; i <= finishChunk; i++) {
        if (!t.jumpForChunk(i)) continue;
        if (lastJump >= 0 && t.bonusesForChunk(lastJump).length > 0) earlierStarred = true;
        lastJump = i;
      }
      // A star arms a contract that pays on the NEXT trick; the final jump has
      // no next lip before the line, so it never carries one.
      expect(lastJump).toBeGreaterThan(0);
      expect(t.bonusesForChunk(lastJump)).toEqual([]);
      // ...but jumps with a lip still downrange keep their stars.
      expect(earlierStarred).toBe(true);
    }
  });

  it('no star sits a short distance behind the last jump — its contract needs a reachable cash venue', () => {
    // A star hangs up to ~50m downrange and you fly its whole arc before
    // touching down, so a following kicker only a chunk or two ahead gets
    // overflown; near the line that means the star can never cash. Every
    // starred jump must therefore have a following kicker comfortably beyond
    // the star's reach (well past the bare 2-chunk no-overfly spacing), not
    // merely SOME lip before the finish.
    const finishChunk = Math.ceil(COURSE_LENGTH / CHUNK_LENGTH);
    let checked = 0;
    for (const seed of [1, 2, 3, 5, 7, 11, 42, 99]) {
      const t = new Terrain(seed);
      for (let i = 3; i <= finishChunk; i++) {
        if (t.bonusesForChunk(i).length === 0) continue;
        const lip = -i * CHUNK_LENGTH - 24;
        let cashVenue = false;
        for (let j = i + 1; j <= finishChunk; j++) {
          if (!t.jumpForChunk(j)) continue;
          if (lip - (-j * CHUNK_LENGTH - 24) >= 3 * CHUNK_LENGTH) cashVenue = true;
        }
        expect(cashVenue).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('the tour: nine sections, nine different personalities, no repeats', () => {
    const everyType: SectionType[] = [
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
    for (const seed of [1, 2, 5, 12]) {
      const t = new Terrain(seed);
      const last = COURSE_LENGTH / SECTION_LENGTH - 1;
      const run: SectionType[] = [];
      for (let s = 0; s <= last; s++) run.push(t.sectionType(s));
      // The whole course is every idea the mountain has, exactly once each:
      // every section justifies itself with something new.
      expect([...run].sort()).toEqual([...everyType].sort());
      expect(run[0]).toBe('cruise'); // the gentle opening
      expect(run[last]).toBe('plunge'); // the finale
    }
    // The deal is deterministic per seed, and seeds actually reshuffle it.
    const deal = (seed: number): string => {
      const t = new Terrain(seed);
      return Array.from({ length: 7 }, (_, i) => t.sectionType(i + 1)).join('>');
    };
    expect(deal(7)).toBe(deal(7));
    expect(deal(1)).not.toBe(deal(2));
    // The endless test mountain continues past the tour with shuffled full
    // decks: everything stays reachable at depth, and no seam ever repeats.
    const endless = new Terrain(3, Infinity);
    const deep = new Set<SectionType>();
    for (let s = 8; s < 17; s++) deep.add(endless.sectionType(s)); // one full block
    expect(deep.size).toBe(everyType.length);
    for (let s = 1; s < 60; s++) {
      expect(endless.sectionType(s)).not.toBe(endless.sectionType(s - 1));
    }
  });

  it('a canyon weaves and banks: the esses are the section', () => {
    const t = new Terrain(4, Infinity);
    let s = 1;
    while (t.sectionType(s) !== 'canyon') s++;
    const z0 = -s * SECTION_LENGTH;
    // The centerline really swings mid-section...
    let lo = 1e9;
    let hi = -1e9;
    for (let z = z0 - 100; z > z0 - 300; z -= 4) {
      const c = t.centerX(z);
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
    expect(hi - lo).toBeGreaterThan(25); // CANYON_AMP is a real weave
    // ...and the floor superelevates through the bends: somewhere in the
    // section the cross-slope approaches the banking cap.
    let maxCross = 0;
    for (let z = z0 - 100; z > z0 - 300; z -= 4) {
      const c = t.centerX(z);
      const cross = Math.abs(t.height(c + 5, z) - t.height(c - 5, z)) / 10;
      maxCross = Math.max(maxCross, cross);
    }
    expect(maxCross).toBeGreaterThan(0.18);
  });

  it('glacier ice halves the bite and cross-fades back to snow', () => {
    const t = new Terrain(4, Infinity);
    let s = 1;
    while (t.sectionType(s) !== 'glacier') s++;
    const mid = -s * SECTION_LENGTH - SECTION_LENGTH / 2;
    expect(t.gripAt(mid)).toBeCloseTo(0.45, 5);
    // Neighbors are snow, and the boundary blends — no step.
    const before = t.gripAt(-s * SECTION_LENGTH + 100);
    expect(before).toBe(t.sectionType(s - 1) === 'glacier' ? 0.45 : 1);
    const a = t.gripAt(mid + SECTION_LENGTH / 2 + 1);
    const b = t.gripAt(mid + SECTION_LENGTH / 2 - 1);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it('powder buries everything but the groomed ribbon', () => {
    const t = new Terrain(4, Infinity);
    let s = 1;
    while (t.sectionType(s) !== 'powder') s++;
    // Sample mid-section: the plan lane is clean, the field is deep.
    let lane = 0;
    let laneN = 0;
    let field = 0;
    let fieldN = 0;
    for (let z = -s * SECTION_LENGTH - 80; z > -(s + 1) * SECTION_LENGTH + 80; z -= 7) {
      const center = t.centerX(z);
      lane += t.stickinessAt(center + t.planOffset(z), z);
      laneN++;
      for (const off of [-11, 11]) {
        const d = t.planOffset(z) + off;
        if (Math.abs(d) < t.channelHalfWidth(z) - 1) {
          field += t.stickinessAt(center + d, z);
          fieldN++;
        }
      }
    }
    expect(lane / laneN).toBeLessThan(0.1); // the ribbon is groomed
    expect(field / fieldN).toBeGreaterThan(0.6); // the field is drag
  });

  it('the course carries BOTH setpieces: falls that only steepen the floor', () => {
    const firstKinds = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const t = new Terrain(seed);
      // The waterfall AND the cascades, one seeded into each half of the run.
      expect(t.setpieces.map((sp) => sp.kind).sort()).toEqual(['cascades', 'waterfall']);
      firstKinds.add(t.setpieces[0]!.kind);
      const [early, late] = t.setpieces;
      expect(early!.z).toBeLessThanOrEqual(-0.25 * COURSE_LENGTH); // first landmark...
      expect(early!.z).toBeGreaterThanOrEqual(-0.4 * COURSE_LENGTH);
      expect(late!.z).toBeLessThanOrEqual(-0.55 * COURSE_LENGTH); // ...second landmark...
      expect(late!.z).toBeGreaterThanOrEqual(-0.7 * COURSE_LENGTH); // ...never the finale
      for (const sp of t.setpieces) {
        // The spine drops the full setpiece height across the span...
        const above = t.spineY(sp.z + 5);
        const below = t.spineY(sp.z - sp.span - 5);
        const grade = 0.35 * (sp.span + 10);
        expect(above - below).toBeGreaterThan(grade + 9); // falls on top of grade
        // ...and every meter of it goes DOWNHILL: a fall face can only
        // steepen the floor, so drainage inherits it for free.
        for (let z = sp.z + 10; z > sp.z - sp.span - 10; z -= 0.5) {
          expect(t.spineY(z)).toBeGreaterThanOrEqual(t.spineY(z - 0.5));
        }
        // The falls are the feature: no kickers or obstacles compete.
        for (let i = Math.floor(-(sp.z + 30) / 40); i * 40 < -(sp.z - sp.span - 40); i++) {
          const jump = t.jumpForChunk(i);
          if (jump) expect(jump.zLip < sp.z + 30 && jump.zLip > sp.z - sp.span - 50).toBe(false);
        }
      }
    }
    // The seeded order varies: sometimes the waterfall leads, sometimes the
    // cascades do.
    expect(firstKinds).toEqual(new Set(['waterfall', 'cascades']));
  });

  it('star contracts draw seeded demands from their tier pools', () => {
    const gold = ['spinL', 'spinR', 'front', 'back', 'spin2'];
    const magenta = ['mix', 'parallel', 'flip2'];
    const a = new Terrain(7);
    const b = new Terrain(7);
    const seen = new Set<string>();
    for (let index = 1; index < 120; index++) {
      for (const star of a.bonusesForChunk(index)) {
        // Gold asks for one named thing; magenta asks for composition —
        // the bigger multiplier is priced in difficulty.
        expect(star.mult === 3 ? gold : magenta).toContain(star.demand);
        seen.add(star.demand);
      }
      expect(a.bonusesForChunk(index)).toEqual(b.bonusesForChunk(index)); // pure
    }
    // The demands vary across the mountain — contracts are not one note.
    expect(seen.size).toBeGreaterThan(3);
  });

  it('slalom gates ride the narrows esses and nothing else', () => {
    const a = new Terrain(1, Infinity);
    const b = new Terrain(1, Infinity);
    const narrows = findSection(a, 'narrows');
    let gates = 0;
    for (let i = 0; i < 400; i++) {
      expect(a.gatesForChunk(i)).toEqual(b.gatesForChunk(i)); // pure
      for (const g of a.gatesForChunk(i)) {
        gates++;
        // Only the narrows deal gates...
        expect(a.sectionType(a.sectionIndexAt(g.z))).toBe('narrows');
        // ...centered on the swinging centerline, gap well inside the floor.
        expect(Math.abs(g.x - a.centerX(g.z))).toBeLessThan(2);
        expect(Math.abs(g.x - a.centerX(g.z)) + g.halfGap).toBeLessThan(
          a.channelHalfWidth(g.z) + 0.5
        );
      }
    }
    expect(gates).toBeGreaterThan(8); // several per narrows over 16km
    // A single narrows section carries a real chain's worth of gates.
    let inSection = 0;
    for (
      let i = Math.floor((narrows * SECTION_LENGTH) / CHUNK_LENGTH) - 1;
      i < ((narrows + 1) * SECTION_LENGTH) / CHUNK_LENGTH + 1;
      i++
    ) {
      inSection += a.gatesForChunk(i).filter((g) => a.sectionIndexAt(g.z) === narrows).length;
    }
    expect(inSection).toBeGreaterThanOrEqual(4);
    expect(inSection).toBeLessThanOrEqual(6);
    // The course build keeps gates out of the finish apron.
    const course = new Terrain(1);
    for (let i = 0; i < COURSE_LENGTH / CHUNK_LENGTH + 5; i++) {
      for (const g of course.gatesForChunk(i)) expect(course.finishApron(g.z)).toBe(false);
    }
  });

  it('the menagerie: each creature kind keeps to its sections, clear of everything else', () => {
    const a = new Terrain(1, Infinity);
    const b = new Terrain(1, Infinity);
    const homes: Record<string, SectionType[]> = {
      drone: ['bowl', 'glacier'],
      wyrm: ['powder'],
      jelly: ['cruise', 'bowl'],
      tumbler: ['steps'],
    };
    const seen = new Set<string>();
    for (let i = 0; i < 800; i++) {
      expect(a.hazardsForChunk(i)).toEqual(b.hazardsForChunk(i)); // pure
      for (const h of a.hazardsForChunk(i)) {
        seen.add(h.kind);
        // Every creature keeps to its home sections...
        expect(homes[h.kind]).toContain(a.sectionType(a.sectionIndexAt(h.z)));
        // ...its activity stays inside the floor (clean snow to dodge onto)...
        expect(h.amp + h.radius).toBeLessThan(a.channelHalfWidth(h.z) - 3);
        // ...never sharing space with a kicker's ramp or the uphill landing,
        // never next door to another act...
        expect(a.jumpForChunk(i)).toBeNull();
        expect(a.jumpForChunk(i - 1)).toBeNull();
        expect(a.hazardsForChunk(i - 1)).toEqual([]);
        // ...and it owns its chunk: no static obstacle hides in the dodge.
        expect(a.obstaclesForChunk(i)).toEqual([]);
        // The choreography is a pure function of time, and every collision
        // circle stays near the anchor (hazardsNear's scan reaches it) and
        // above the snow in a sane band.
        for (const t of [1.7, 8.3, 61.2]) {
          expect(hazardCircles(h, t)).toEqual(hazardCircles(h, t));
          for (const c of hazardCircles(h, t)) {
            expect(Math.abs(c.z - h.z)).toBeLessThan(36);
            expect(Math.abs(c.x - h.x0)).toBeLessThanOrEqual(h.amp + 1e-9);
            expect(c.top).toBeGreaterThan(c.bottom);
            expect(c.bottom).toBeGreaterThanOrEqual(0);
          }
        }
      }
      // Never in the opening stretch.
      if (i < 8) expect(a.hazardsForChunk(i)).toEqual([]);
    }
    // The whole cast shows up somewhere on the endless mountain.
    expect(seen).toEqual(new Set(['drone', 'wyrm', 'jelly', 'tumbler']));
  });

  it('creature choreography: humps dive, bells breathe, boulders bounce', () => {
    const t = new Terrain(1, Infinity);
    const byKind = new Map<string, Hazard>();
    for (let i = 8; i < 800; i++) {
      for (const h of t.hazardsForChunk(i)) if (!byKind.has(h.kind)) byKind.set(h.kind, h);
    }
    const wyrm = byKind.get('wyrm')!;
    const jelly = byKind.get('jelly')!;
    const tumbler = byKind.get('tumbler')!;

    // The wyrm surfaces and dives: the emerged-arc count varies with time,
    // and it is never the whole body (there is always a gap to ski).
    const counts = new Set<number>();
    for (let time = 0; time < 12; time += 0.25) {
      const n = hazardCircles(wyrm, time).length;
      counts.add(n);
      expect(n).toBeLessThan(WYRM_SEGMENTS);
    }
    expect(counts.size).toBeGreaterThan(2);

    // The jelly's clearance breathes across head height: sometimes it
    // blocks a skier (SKIER_HEIGHT ~1.9), sometimes it lifts clear.
    let blocked = 0;
    let open = 0;
    for (let time = 0; time < 8; time += 0.1) {
      const p = jellyPose(jelly, time);
      if (p.clearance > 1.95) open++;
      else blocked++;
    }
    expect(blocked).toBeGreaterThan(5);
    expect(open).toBeGreaterThan(5);

    // The tumbler patrols downhill, hops, and takes its seam break: the
    // circle vanishes while it reforms, and its bounce leaves the ground.
    let grounded = 0;
    let airborne = 0;
    let absent = 0;
    for (let time = 0; time < 30; time += 0.1) {
      const circles = hazardCircles(tumbler, time);
      if (circles.length === 0) absent++;
      else if (circles[0]!.bottom > 1) airborne++;
      else grounded++;
    }
    expect(absent).toBeGreaterThan(3);
    expect(airborne).toBeGreaterThan(10);
    expect(grounded).toBeGreaterThan(10);
  });

  it('the grotto: a roofed stretch mid-run that keeps itself clear', () => {
    for (const seed of [1, 2, 5]) {
      const t = new Terrain(seed);
      // Between the two fall setpieces' windows, clear of both.
      expect(t.grotto.z).toBeLessThanOrEqual(-0.44 * COURSE_LENGTH);
      expect(t.grotto.z).toBeGreaterThanOrEqual(-0.5 * COURSE_LENGTH);
      // caveAt breathes: 0 in the open, 1 deep inside, 0 again past the end.
      expect(t.caveAt(t.grotto.z + 5)).toBe(0);
      expect(t.caveAt(t.grotto.z - t.grotto.span / 2)).toBe(1);
      expect(t.caveAt(t.grotto.z - t.grotto.span - 5)).toBe(0);
      // Portals ease rather than snap.
      const brow = t.caveAt(t.grotto.z - 5);
      expect(brow).toBeGreaterThan(0);
      expect(brow).toBeLessThan(1);
      // Nothing launches into (or lurks in) the dark: no kickers whose
      // throw reaches the roof, no obstacles or stars under it.
      const first = Math.floor(-(t.grotto.z + 70) / CHUNK_LENGTH);
      const last = Math.ceil(-(t.grotto.z - t.grotto.span) / CHUNK_LENGTH);
      for (let i = first; i <= last; i++) {
        const jump = t.jumpForChunk(i);
        if (jump) {
          expect(jump.zLip < t.grotto.z + 70 && jump.zLip > t.grotto.z - t.grotto.span - 20).toBe(
            false
          );
        }
        for (const o of t.obstaclesForChunk(i)) {
          expect(o.z < t.grotto.z && o.z > t.grotto.z - t.grotto.span).toBe(false);
        }
      }
      // The heightfield is untouched: a cave is atmosphere, not terrain —
      // the floor mid-grotto still drains like ordinary floor (same mean
      // grade class as anywhere else on the spine).
      const zc = t.grotto.z - t.grotto.span / 2;
      const [, gz] = t.gradient(t.centerX(zc), zc);
      expect(gz).toBeGreaterThan(0.05); // downhill toward -z
    }
  });

  it('gradient matches height differences', () => {
    const t = new Terrain(11);
    const [gx, gz] = t.gradient(5, -73);
    expect(gx).toBeCloseTo((t.height(5.05, -73) - t.height(4.95, -73)) / 0.1, 10);
    expect(gz).toBeCloseTo((t.height(5, -72.95) - t.height(5, -73.05)) / 0.1, 10);
  });
});
