import * as THREE from 'three';
import { CHUNK_LENGTH, CORRIDOR_HALF_WIDTH, GRADE, Terrain } from '../sim/terrain';
import { hash2 } from '../sim/rng';

// Ground is wider than the tree corridor so the forest walls never sit on the
// edge of the mesh.
const GROUND_WIDTH = (CORRIDOR_HALF_WIDTH + 15) * 2;
const CHUNKS_AHEAD = 6;
const CHUNKS_BEHIND = 2;

// Snow tint by deviation from the mean slope: flat snow is warm white, the
// steep sides of rolls and moguls shade toward blue-gray. This is what makes
// the terrain relief readable at a distance.
const SNOW_FLAT = new THREE.Color(0xf7faff);
const SNOW_STEEP = new THREE.Color(0xc3d2e6);

export class ChunkRenderer {
  private chunks = new Map<number, THREE.Group>();
  private snow = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    flatShading: true,
  });
  // A few foliage tones; picked per tree so the forest reads as layers.
  private foliages = [0x143f21, 0x1d5a2f, 0x2d6e3e].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true })
  );
  private trunk = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain
  ) {}

  update(centerChunk: number): void {
    const lo = centerChunk - CHUNKS_BEHIND;
    const hi = centerChunk + CHUNKS_AHEAD;
    for (let i = lo; i <= hi; i++) {
      if (!this.chunks.has(i)) this.chunks.set(i, this.build(i));
    }
    for (const [i, group] of this.chunks) {
      if (i < lo || i > hi) {
        this.scene.remove(group);
        group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) obj.geometry.dispose();
        });
        this.chunks.delete(i);
      }
    }
  }

  private build(index: number): THREE.Group {
    const group = new THREE.Group();

    // Ground: a grid displaced by the sim's height function, non-indexed so
    // flat shading gives visible facets for depth perception.
    let geo: THREE.BufferGeometry = new THREE.PlaneGeometry(GROUND_WIDTH, CHUNK_LENGTH, 30, 14);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -(index + 0.5) * CHUNK_LENGTH);
    geo = geo.toNonIndexed();
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const vertexColor = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      pos.setY(v, this.terrain.height(x, z));
      const [gx, gz] = this.terrain.gradient(x, z);
      const deviation = Math.hypot(gx, gz - GRADE);
      vertexColor.lerpColors(SNOW_FLAT, SNOW_STEEP, Math.min(deviation / 0.22, 1));
      colors[v * 3] = vertexColor.r;
      colors[v * 3 + 1] = vertexColor.g;
      colors[v * 3 + 2] = vertexColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, this.snow);
    ground.receiveShadow = true;
    group.add(ground);

    for (const tree of this.terrain.treesForChunk(index)) {
      const snow = this.terrain.height(tree.x, tree.z);
      // Deterministic per-tree cosmetics, independent of the sim.
      const jitter = hash2(this.terrain.seed, Math.round(tree.x * 10), Math.round(tree.z * 10));
      const height = (2.5 + tree.radius * 3) * (0.8 + jitter * 0.5);
      const foliage =
        this.foliages[Math.floor(jitter * this.foliages.length) % this.foliages.length]!;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(tree.radius * 2.4, height, 7), foliage);
      cone.position.set(tree.x, snow + 0.4 + height / 2, tree.z);
      cone.castShadow = true;
      group.add(cone);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(tree.radius * 0.5, tree.radius * 0.5, 1, 6),
        this.trunk
      );
      stem.position.set(tree.x, snow + 0.3, tree.z);
      stem.castShadow = true;
      group.add(stem);
    }

    this.scene.add(group);
    return group;
  }
}
