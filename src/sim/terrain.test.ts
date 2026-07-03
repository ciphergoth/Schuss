import { describe, expect, it } from 'vitest';
import { CHUNK_LENGTH, CORRIDOR_HALF_WIDTH, Terrain } from './terrain';

describe('terrain', () => {
  it('is a pure function of the seed', () => {
    const a = new Terrain(42);
    const b = new Terrain(42);
    for (let i = 0; i < 50; i++) {
      const x = ((i * 37) % 60) - 30;
      const z = -i * 11;
      expect(a.height(x, z)).toBe(b.height(x, z));
    }
    expect(a.treesForChunk(5)).toEqual(b.treesForChunk(5));
  });

  it('differs between seeds', () => {
    expect(new Terrain(1).height(3, -50)).not.toBe(new Terrain(2).height(3, -50));
  });

  it('slopes downhill toward -z', () => {
    const t = new Terrain(7);
    expect(t.height(0, -200)).toBeLessThan(t.height(0, 0) - 40);
  });

  it('keeps the starting chunk clear of interior trees', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const tree of new Terrain(seed).treesForChunk(0)) {
        expect(Math.abs(tree.x)).toBeGreaterThan(CORRIDOR_HALF_WIDTH - 2);
      }
    }
  });

  it('places trees inside their own chunk', () => {
    const t = new Terrain(3);
    const index = 4;
    const trees = t.treesForChunk(index);
    expect(trees.length).toBeGreaterThan(10);
    for (const tree of trees) {
      expect(tree.z).toBeLessThanOrEqual(-index * CHUNK_LENGTH);
      expect(tree.z).toBeGreaterThan(-(index + 1) * CHUNK_LENGTH - 6);
      expect(Math.abs(tree.x)).toBeLessThan(CORRIDOR_HALF_WIDTH + 6);
    }
  });

  it('gradient matches height differences', () => {
    const t = new Terrain(11);
    const [gx, gz] = t.gradient(5, -73);
    expect(gx).toBeCloseTo((t.height(5.05, -73) - t.height(4.95, -73)) / 0.1, 10);
    expect(gz).toBeCloseTo((t.height(5, -72.95) - t.height(5, -73.05)) / 0.1, 10);
  });
});
