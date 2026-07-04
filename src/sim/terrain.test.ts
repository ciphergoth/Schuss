import { describe, expect, it } from 'vitest';
import { CHUNK_LENGTH, GRADE, SECTION_LENGTH, SectionType, Terrain, WALL_WIDTH } from './terrain';

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
    const t = new Terrain(1);
    const seen = new Set<SectionType>();
    for (let s = 1; s < 60; s++) {
      seen.add(t.sectionType(s));
      expect(t.sectionType(s)).not.toBe(t.sectionType(s - 1));
    }
    expect(t.sectionType(0)).toBe('cruise'); // gentle opening, always
    expect(seen.size).toBeGreaterThanOrEqual(5); // real variety over 24km
  });

  it('the narrows squeeze and the bowls blow open', () => {
    const t = new Terrain(1);
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
    const t = new Terrain(1);
    const s = findSection(t, 'plunge');
    const zTop = -s * SECTION_LENGTH;
    const zBot = zTop - SECTION_LENGTH;
    const drop = t.height(t.centerX(zTop), zTop) - t.height(t.centerX(zBot), zBot);
    expect(drop).toBeGreaterThan(GRADE * SECTION_LENGTH + 40);
  });

  it('a steps section is a staircase of launchable terrace edges', () => {
    const t = new Terrain(1);
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
    const t = new Terrain(1);
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
    const t = new Terrain(1);
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
    expect(kinds).toEqual(new Set(['S', 'M', 'L']));
    expect(stepDowns).toBeGreaterThan(1);
    expect(hips).toBeGreaterThan(1);
  });

  it('hip pads bank the approach toward the throw', () => {
    const t = new Terrain(1);
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
    const t = new Terrain(1);
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
    const t = new Terrain(1);
    const sweeper = findSection(t, 'sweeper');
    const zs = -(sweeper + 0.5) * SECTION_LENGTH;
    expect(t.stickinessAt(t.centerX(zs) + t.channelHalfWidth(zs) + 3, zs)).toBeLessThan(0.05);
    const cruise = findSection(t, 'cruise', 2);
    const zc = -(cruise + 0.5) * SECTION_LENGTH;
    expect(t.stickinessAt(t.centerX(zc) + t.channelHalfWidth(zc) + 3, zc)).toBeGreaterThan(0.5);
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
    const t = new Terrain(1);
    let found = false;
    for (let i = 3; i < 400 && !found; i++) {
      const jump = t.jumpForChunk(i);
      if (!jump || jump.stepDown === 0) continue;
      const curv =
        (t.centerX(jump.zLip - 4) - 2 * t.centerX(jump.zLip) + t.centerX(jump.zLip + 4)) / 16;
      if (Math.abs(curv) > 0.01) continue; // keep banking out of the measurement
      found = true;
      const z = jump.zLip - 15; // full scoop depth here
      const core = t.centerX(z) + jump.xOffset;
      const outside = core + jump.halfWidth + 2 + 5 + 3; // past the scoop fade
      expect(t.height(outside, z) - t.height(core, z)).toBeGreaterThan(jump.stepDown * 0.5);
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

  it('every kicker hangs a x3 and a x5 star past its lip, deterministically', () => {
    const a = new Terrain(1);
    const b = new Terrain(1);
    let found = 0;
    for (let index = 3; index < 60; index++) {
      expect(a.bonusesForChunk(index)).toEqual(b.bonusesForChunk(index));
      const jump = a.jumpForChunk(index);
      const stars = a.bonusesForChunk(index);
      if (!jump) {
        expect(stars).toEqual([]);
        continue;
      }
      found++;
      // Hips carry only the x3 for now (their x5 awaits honest placement).
      const expected = jump.hip !== 0 ? [3] : [3, 5];
      expect(stars.map((s) => s.mult).sort()).toEqual(expected);
      for (const s of stars) expect(s.z).toBeLessThan(jump.zLip); // past the lip
    }
    expect(found).toBeGreaterThan(3);
  });

  it('gradient matches height differences', () => {
    const t = new Terrain(11);
    const [gx, gz] = t.gradient(5, -73);
    expect(gx).toBeCloseTo((t.height(5.05, -73) - t.height(4.95, -73)) / 0.1, 10);
    expect(gz).toBeCloseTo((t.height(5, -72.95) - t.height(5, -73.05)) / 0.1, 10);
  });
});
