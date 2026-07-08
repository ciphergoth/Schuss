import { describe, expect, it } from 'vitest';
import { GRAND_TOUR, curve1d } from './design';
import {
  COURSE_LENGTH,
  CHUNK_LENGTH,
  FINISH_APRON,
  GRADE,
  SECTION_LENGTH,
  Terrain,
  hazardCircles,
} from './terrain';

// THE DESIGN RULEBOOK: every fairness rule the generators used to enforce
// by construction, applied to the authored course as assertions. A designed
// course answers to the same law — it just chooses within it.

const t = new Terrain(1, COURSE_LENGTH, GRAND_TOUR);
const design = GRAND_TOUR;

const onFalls = (at: number, margin = 0): boolean =>
  (at > design.waterfallAt - 30 - margin && at < design.waterfallAt + 16 + 50 + margin) ||
  (at > design.cascadesAt - 30 - margin && at < design.cascadesAt + 70 + 50 + margin);
const inGrottoKeepClear = (at: number): boolean =>
  at > design.grottoAt - 70 && at < design.grottoAt + 90 + 20;

describe('the Grand Tour design', () => {
  it('has the full nine-personality arc with authored zones', () => {
    expect(design.sections).toHaveLength(9);
    expect(design.sections[0]).toBe('cruise');
    expect(design.sections[8]).toBe('plunge');
    expect(new Set(design.sections).size).toBe(9); // every idea exactly once
    expect(design.zones).toHaveLength(8);
    expect(new Set(design.zones).size).toBe(8); // every world exactly once
    for (let s = 0; s < 9; s++) expect(t.sectionType(s)).toBe(design.sections[s]);
    expect(t.sectionType(9)).toBe('cruise'); // the outrun
  });

  it('keeps the landmarks in their canonical windows', () => {
    expect(design.waterfallAt / COURSE_LENGTH).toBeGreaterThanOrEqual(0.25);
    expect(design.waterfallAt / COURSE_LENGTH).toBeLessThanOrEqual(0.4);
    expect(design.cascadesAt / COURSE_LENGTH).toBeGreaterThanOrEqual(0.55);
    expect(design.cascadesAt / COURSE_LENGTH).toBeLessThanOrEqual(0.7);
    expect(design.grottoAt / COURSE_LENGTH).toBeGreaterThanOrEqual(0.44);
    expect(design.grottoAt / COURSE_LENGTH).toBeLessThanOrEqual(0.5);
    // The spine still drops every fall's full height, downhill-only.
    for (const sp of t.setpieces) {
      for (let z = sp.z + 10; z > sp.z - sp.span - 10; z -= 0.5) {
        expect(t.spineY(z)).toBeGreaterThanOrEqual(t.spineY(z - 0.5));
      }
    }
  });

  it('the floor breathes inside the buildable envelope, start straight', () => {
    for (let at = 0; at <= 3800; at += 10) {
      const w = curve1d(design.widths, at);
      expect(w).toBeGreaterThan(5.5);
      expect(w).toBeLessThan(31.5);
    }
    // The start gate opens onto straight snow (the countdown's lab).
    expect(t.centerX(0)).toBe(0);
    expect(t.centerX(-40)).toBe(0);
    expect(t.centerX(200)).toBe(0); // and uphill of the gate
    // The banked-turn budget: the authored wander (plus the section esses)
    // never out-banks the cap by construction — verify the floor cross-
    // slope stays skiable everywhere on the racing floor. Kicker pads are
    // exempt (their shoulders are steep on purpose; the drainage law
    // already documents the lip exemption).
    for (let at = 50; at < 3600; at += 15) {
      const onPad = design.jumps.some((j) => at > j.at - 35 && at < j.at + 30);
      if (onPad) continue;
      const z = -at;
      const c = t.centerX(z);
      const [gx] = t.gradient(c, z);
      expect(Math.abs(gx)).toBeLessThan(GRADE);
    }
  });

  it('every lip fits its chunk, and only the pair shares neighbors', () => {
    const chunks = new Map<number, (typeof design.jumps)[number]>();
    for (const j of design.jumps) {
      const index = Math.floor(j.at / CHUNK_LENGTH);
      expect(chunks.has(index)).toBe(false); // one lip per chunk
      chunks.set(index, j);
      // The heightfield scans one chunk of approach: the ramp must fit
      // between the lip and its chunk's top edge.
      const local = j.at - index * CHUNK_LENGTH;
      const ramp = t.jumpForChunk(index)!.rampLength;
      expect(local).toBeGreaterThanOrEqual(ramp);
      // Terrain agrees with the spec.
      expect(t.jumpForChunk(index)!.zLip).toBe(-j.at);
      expect(t.jumpForChunk(index)!.kind).toBe(j.kind);
    }
    // No two ramp faces overlap, and consecutive-chunk lips are designed
    // flow (the pair, or the follow-into-XL exit) — never accidents.
    const sorted = [...design.jumps].sort((a, b) => a.at - b.at);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const prevLip = prev.at;
      const curBase = cur.at - t.jumpForChunk(Math.floor(cur.at / CHUNK_LENGTH))!.rampLength;
      expect(curBase).toBeGreaterThan(prevLip); // ramps never interleave
    }
  });

  it('nothing throws into the grotto, the falls, or the apron', () => {
    const KICKER_THROW = 70;
    for (const j of design.jumps) {
      expect(j.at + KICKER_THROW).toBeLessThanOrEqual(COURSE_LENGTH - FINISH_APRON);
      expect(inGrottoKeepClear(j.at + KICKER_THROW) && inGrottoKeepClear(j.at)).toBe(false);
      // A lip may sit near a fall only if it IS the feature's exit — the
      // design keeps them fully apart instead.
      expect(onFalls(j.at)).toBe(false);
      // No flight launches from just uphill into the roof either.
      expect(j.at < design.grottoAt && j.at + KICKER_THROW > design.grottoAt).toBe(false);
    }
  });

  it('stars: designed loadouts survive the cash-venue law, hips carry only gold', () => {
    let seen = 0;
    for (const j of design.jumps) {
      const index = Math.floor(j.at / CHUNK_LENGTH);
      const dealt = t.bonusesForChunk(index);
      // Every designed star is actually dealt (none silently withheld by
      // the no-cash-venue guard) — the design must only promise deals the
      // course can pay.
      expect(dealt).toHaveLength(j.stars.length);
      seen += dealt.length;
      if (j.hip) for (const s of j.stars) expect(s.mult).toBe(3);
      for (const b of dealt) {
        expect(-b.z).toBeGreaterThan(j.at); // downrange of the lip
        expect(-b.z).toBeLessThan(COURSE_LENGTH - FINISH_APRON); // never in the apron
      }
    }
    expect(seen).toBeGreaterThanOrEqual(10);
    // The last jump seals the deal drought: no stars, nothing to cash.
    const last = [...design.jumps].sort((a, b) => a.at - b.at).pop()!;
    expect(last.stars).toHaveLength(0);
  });

  it('obstacles never ambush: off ramps, landings, hazard chunks, and the dark', () => {
    for (const o of design.obstacles) {
      expect(onFalls(o.at)).toBe(false);
      expect(inGrottoKeepClear(o.at)).toBe(false);
      expect(Math.abs(o.x)).toBeLessThan(curve1d(design.widths, o.at) - 1.5); // on the floor
      for (const j of design.jumps) {
        const jump = t.jumpForChunk(Math.floor(j.at / CHUNK_LENGTH))!;
        const inZ = o.at > j.at - 40 && o.at < j.at + jump.rampLength + 23;
        const inX = Math.abs(o.x - j.x) < jump.halfWidth + 5;
        expect(inZ && inX).toBe(false); // never on a footprint or landing line
      }
      for (const h of design.hazards) {
        expect(Math.floor(o.at / CHUNK_LENGTH)).not.toBe(Math.floor(h.at / CHUNK_LENGTH));
      }
    }
  });

  it('creatures: home biomes, floor-bounded sweeps, clear of lips and landmarks', () => {
    const homes: Record<string, string[]> = {
      drone: ['bowl', 'glacier'],
      wyrm: ['powder'],
      jelly: ['cruise', 'bowl'],
      tumbler: ['steps'],
      yeti: ['sweeper', 'powder'],
    };
    const chunks = new Set<number>();
    for (const h of design.hazards) {
      const index = Math.floor(h.at / CHUNK_LENGTH);
      expect(chunks.has(index)).toBe(false);
      expect(chunks.has(index - 1)).toBe(false); // one act at a time
      chunks.add(index);
      expect(homes[h.kind]).toContain(t.sectionType(Math.floor(h.at / SECTION_LENGTH)));
      expect(h.amp + 1.1).toBeLessThan(curve1d(design.widths, h.at) - 3); // room to dodge
      expect(onFalls(h.at)).toBe(false);
      expect(inGrottoKeepClear(h.at)).toBe(false);
      expect(h.at + 36).toBeLessThan(COURSE_LENGTH - FINISH_APRON);
      // Its activity zone never overlaps a lip's approach or landing.
      for (const j of design.jumps) {
        const jump = t.jumpForChunk(Math.floor(j.at / CHUNK_LENGTH))!;
        const clear = h.at + 15 < j.at - jump.rampLength - 22 || h.at - 15 > j.at + 45;
        expect(clear).toBe(true);
      }
      // And the built circles honor the same purity bounds as the wild ones.
      const built = t.hazardsForChunk(index)[0]!;
      for (const time of [2.3, 47.7]) {
        for (const c of hazardCircles(built, time)) {
          expect(Math.abs(c.z - built.z)).toBeLessThan(36);
          expect(Math.abs(c.x - built.x0)).toBeLessThanOrEqual(built.amp + 1e-9);
        }
      }
    }
  });

  it('coins and galleries stay on skiable ground and out of the apron', () => {
    for (const c of design.coins) {
      for (let k = 0; k < c.n; k++) {
        const at = c.at + k * 3;
        expect(Math.abs(c.x)).toBeLessThan(curve1d(design.widths, at) - 1);
        expect(at).toBeLessThan(COURSE_LENGTH - FINISH_APRON);
      }
    }
    for (const g of design.galleries) {
      expect(g.at).toBeLessThan(COURSE_LENGTH - FINISH_APRON);
      const index = Math.floor(g.at / CHUNK_LENGTH);
      const built = t.galleriesForChunk(index)[0]!;
      // Off the racing floor, on the bank.
      expect(Math.abs(built.x - t.centerX(built.z))).toBeGreaterThan(
        t.channelHalfWidth(built.z) + 1
      );
    }
  });

  it('the gates ride the needle, centered on their apexes', () => {
    let gates = 0;
    for (let i = 0; i < COURSE_LENGTH / CHUNK_LENGTH; i++) {
      for (const g of t.gatesForChunk(i)) {
        gates++;
        expect(t.sectionType(Math.floor(-g.z / SECTION_LENGTH))).toBe('narrows');
        expect(Math.abs(g.x - t.centerX(g.z))).toBeLessThan(0.01); // dead-centered
      }
    }
    expect(gates).toBe(5); // one chain, five links
  });

  it('the designed floor still drains: no stopped skier stays stopped', () => {
    // The drainage guarantee, sampled across the authored course on five
    // lanes (kicker ramp faces exempt, as documented).
    const FRICTION = 0.05;
    for (let at = 60; at < COURSE_LENGTH - 5; at += 7) {
      const z = -at;
      for (const lane of [-0.8, -0.4, 0, 0.4, 0.8]) {
        const x = t.centerX(z) + lane * (t.channelHalfWidth(z) - 1);
        const [gx, gz] = t.gradient(x, z);
        const steepest = Math.hypot(gx, gz);
        // On a kicker ramp face the lip is the exemption; skip footprints.
        const onRamp = design.jumps.some(
          (j) => at > j.at - 30 && at < j.at + 26 && Math.abs(x - t.centerX(z) - j.x) < 12
        );
        if (onRamp) continue;
        expect(steepest).toBeGreaterThan(FRICTION * 1.35);
      }
    }
  });

  it('the design is what ships: the sim rides it deterministically', () => {
    const a = new Terrain(1, COURSE_LENGTH, GRAND_TOUR);
    const b = new Terrain(1, COURSE_LENGTH, GRAND_TOUR);
    for (let i = 0; i < 95; i++) {
      expect(a.jumpForChunk(i)).toEqual(b.jumpForChunk(i));
      expect(a.bonusesForChunk(i)).toEqual(b.bonusesForChunk(i));
      expect(a.hazardsForChunk(i)).toEqual(b.hazardsForChunk(i));
      expect(a.obstaclesForChunk(i)).toEqual(b.obstaclesForChunk(i));
      expect(a.pickupsForChunk(i)).toEqual(b.pickupsForChunk(i));
    }
    for (let z = 0; z > -3700; z -= 13) {
      expect(a.height(3, z)).toBe(b.height(3, z));
    }
  });
});
