import { describe, expect, it } from 'vitest';
import { CHANNEL_HALF_WIDTH, CHUNK_LENGTH, GRADE, Terrain, WALL_WIDTH } from './terrain';

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
      const lip = t.height(c + CHANNEL_HALF_WIDTH + WALL_WIDTH, z);
      const beyond = t.height(c + CHANNEL_HALF_WIDTH + WALL_WIDTH + 6, z);
      expect(lip - floor).toBeGreaterThan(5); // rideable bank, real height
      expect(beyond - lip).toBeGreaterThan(6); // and it keeps getting worse
    }
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

  it('places obstacles on the channel floor, away from the walls', () => {
    const t = new Terrain(3);
    for (const index of [2, 5, 12]) {
      const obstacles = t.obstaclesForChunk(index);
      expect(obstacles.length).toBeGreaterThan(0);
      for (const o of obstacles) {
        expect(Math.abs(o.x - t.centerX(o.z))).toBeLessThan(CHANNEL_HALF_WIDTH - 1);
        expect(o.z).toBeLessThanOrEqual(-index * CHUNK_LENGTH);
        expect(o.z).toBeGreaterThan(-(index + 1) * CHUNK_LENGTH);
      }
    }
  });

  it('keeps the first two chunks and the run-in obstacle-free', () => {
    for (const seed of [1, 2, 3]) {
      const t = new Terrain(seed);
      expect(t.obstaclesForChunk(0)).toEqual([]);
      expect(t.obstaclesForChunk(1)).toEqual([]);
      expect(t.obstaclesForChunk(-3)).toEqual([]);
    }
  });

  it('lays pickup lines within the channel', () => {
    const t = new Terrain(1);
    for (const index of [1, 4, 9]) {
      const pickups = t.pickupsForChunk(index);
      expect(pickups.length).toBeGreaterThan(4);
      for (const p of pickups) {
        expect(Math.abs(p.x - t.centerX(p.z))).toBeLessThan(CHANNEL_HALF_WIDTH);
      }
    }
    expect(t.pickupsForChunk(0)).toEqual([]);
  });

  it('gradient matches height differences', () => {
    const t = new Terrain(11);
    const [gx, gz] = t.gradient(5, -73);
    expect(gx).toBeCloseTo((t.height(5.05, -73) - t.height(4.95, -73)) / 0.1, 10);
    expect(gz).toBeCloseTo((t.height(5, -72.95) - t.height(5, -73.05)) / 0.1, 10);
  });
});
