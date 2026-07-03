import * as THREE from 'three';
import { CHUNK_LENGTH, CORRIDOR_HALF_WIDTH, Terrain } from '../sim/terrain';

// Ground is wider than the tree corridor so the forest walls never sit on the
// edge of the mesh.
const GROUND_WIDTH = (CORRIDOR_HALF_WIDTH + 15) * 2;
const CHUNKS_AHEAD = 6;
const CHUNKS_BEHIND = 2;

export class ChunkRenderer {
  private chunks = new Map<number, THREE.Group>();
  private snow = new THREE.MeshStandardMaterial({
    color: 0xf4f9ff,
    roughness: 1,
    flatShading: true,
  });
  private foliage = new THREE.MeshStandardMaterial({
    color: 0x1d5a2f,
    roughness: 1,
    flatShading: true,
  });
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
    for (let v = 0; v < pos.count; v++) {
      pos.setY(v, this.terrain.height(pos.getX(v), pos.getZ(v)));
    }
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, this.snow));

    for (const tree of this.terrain.treesForChunk(index)) {
      const ground = this.terrain.height(tree.x, tree.z);
      const height = 2.5 + tree.radius * 3;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(tree.radius * 2.4, height, 7),
        this.foliage
      );
      cone.position.set(tree.x, ground + 0.4 + height / 2, tree.z);
      group.add(cone);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(tree.radius * 0.5, tree.radius * 0.5, 1, 6),
        this.trunk
      );
      stem.position.set(tree.x, ground + 0.3, tree.z);
      group.add(stem);
    }

    this.scene.add(group);
    return group;
  }
}
