import * as THREE from 'three';
import { CHANNEL_HALF_WIDTH, CHUNK_LENGTH, Terrain, WALL_WIDTH } from '../sim/terrain';
import { hash2, mulberry32 } from '../sim/rng';

// The course renders as a ribbon that follows the centerline — beyond its
// edges there is nothing but sky, city, and clouds far below. SSX rules.
const RIBBON_HALF_WIDTH = CHANNEL_HALF_WIDTH + WALL_WIDTH + 3;
const CHUNKS_AHEAD = 7;
const CHUNKS_BEHIND = 2;

const SNOW_FLOOR = new THREE.Color(0xf4f9ff);
const SNOW_WALL = new THREE.Color(0x9fd8ee); // walls read as blue ice

// Candy-striped marker: a cylinder with horizontal color bands baked into
// vertex colors.
function stripedPole(
  radius: number,
  height: number,
  bandA: THREE.Color,
  bandB: THREE.Color
): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.CylinderGeometry(radius, radius, height, 8, 7);
  geo = geo.toNonIndexed();
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    const band = Math.floor((pos.getY(v) + height / 2) / (height / 7));
    const c = band % 2 === 0 ? bandA : bandB;
    colors[v * 3] = c.r;
    colors[v * 3 + 1] = c.g;
    colors[v * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class ChunkRenderer {
  private chunks = new Map<number, THREE.Group>();
  private pickupMeshes = new Map<string, THREE.Mesh>();
  private snow = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    flatShading: true,
  });
  private underside = new THREE.MeshBasicMaterial({ color: 0x131b45 });
  private striped = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  private crystal = new THREE.MeshStandardMaterial({
    color: 0xaee2ff,
    emissive: 0x1a3c55,
    roughness: 0.3,
    flatShading: true,
  });
  private banner = new THREE.MeshBasicMaterial({ color: 0xff8b1a });
  private pole = new THREE.MeshStandardMaterial({ color: 0xe8ecff, roughness: 0.5 });
  private gold = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  private city = new THREE.MeshBasicMaterial({ color: 0x10173a });
  private cloud = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
  });
  private red = new THREE.Color(0xff3b30);
  private white = new THREE.Color(0xffffff);
  private orange = new THREE.Color(0xff8b1a);

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain
  ) {}

  update(centerChunk: number, collected: ReadonlySet<string>, time: number): void {
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
        for (const p of this.terrain.pickupsForChunk(i)) this.pickupMeshes.delete(p.id);
        this.chunks.delete(i);
      }
    }
    // Spin the discs; hide the ones already grabbed.
    for (const [id, mesh] of this.pickupMeshes) {
      mesh.visible = !collected.has(id);
      mesh.rotation.y = time * 3;
    }
  }

  private build(index: number): THREE.Group {
    const group = new THREE.Group();
    const zTop = -index * CHUNK_LENGTH;
    const zMid = zTop - CHUNK_LENGTH / 2;
    const rng = mulberry32(Math.floor(hash2(this.terrain.seed, index, 52361) * 2 ** 31));

    // Track ribbon: a grid in track space (offset from centerline x along z),
    // so the mesh follows the course through its curves.
    // Enough z-resolution that kicker ramps and lips read as built geometry.
    let geo: THREE.BufferGeometry = new THREE.PlaneGeometry(
      RIBBON_HALF_WIDTH * 2,
      CHUNK_LENGTH,
      30,
      28
    );
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, zMid);
    geo = geo.toNonIndexed();
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const d = pos.getX(v);
      const z = pos.getZ(v);
      const x = this.terrain.centerX(z) + d;
      pos.setX(v, x);
      pos.setY(v, this.terrain.height(x, z));
      const wall = Math.min(1, Math.max(0, (Math.abs(d) - CHANNEL_HALF_WIDTH) / WALL_WIDTH));
      c.lerpColors(SNOW_FLOOR, SNOW_WALL, wall);
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, this.snow);
    ground.receiveShadow = true;
    group.add(ground);

    // Dark slab underneath so the course reads as a floating structure.
    const skirt = new THREE.Mesh(geo.clone().translate(0, -2.4, 0), this.underside);
    group.add(skirt);

    // Striped bollards along both lips.
    const bollardGeo = stripedPole(0.16, 1.5, this.red, this.white);
    for (const side of [-1, 1]) {
      for (let k = 0; k < CHUNK_LENGTH / 8; k++) {
        const z = zTop - 4 - k * 8;
        const x = this.terrain.centerX(z) + side * (CHANNEL_HALF_WIDTH + 1.5);
        const marker = new THREE.Mesh(bollardGeo, this.striped);
        marker.position.set(x, this.terrain.height(x, z) + 0.75, z);
        marker.castShadow = true;
        group.add(marker);
      }
    }

    // Tall striped poles flag each kicker's lip.
    const jump = this.terrain.jumpForChunk(index);
    if (jump) {
      const lipPole = stripedPole(0.2, 2.6, this.red, this.white);
      for (const side of [-1, 1]) {
        const x = this.terrain.centerX(jump.zLip) + side * (CHANNEL_HALF_WIDTH - 0.5);
        const marker = new THREE.Mesh(lipPole, this.striped);
        marker.position.set(x, this.terrain.height(x, jump.zLip) + 1.3, jump.zLip);
        marker.castShadow = true;
        group.add(marker);
      }
    }

    // A banner arch every few chunks.
    if (index % 3 === 0) {
      const zA = zTop - 20;
      const cX = this.terrain.centerX(zA);
      const floorY = this.terrain.height(cX, zA);
      const span = (CHANNEL_HALF_WIDTH + 2) * 2;
      for (const side of [-1, 1]) {
        const x = cX + (side * span) / 2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 8, 8), this.pole);
        pole.position.set(x, this.terrain.height(x, zA) + 4, zA);
        pole.castShadow = true;
        group.add(pole);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(span, 1.1, 0.25), this.banner);
      bar.position.set(cX, floorY + 7.4, zA);
      group.add(bar);
    }

    // Obstacles: ice crystals and fat striped bollards on the floor. Visual
    // size derives from the sim's collision height so what you see is what
    // you have to clear.
    for (const o of this.terrain.obstaclesForChunk(index)) {
      const y = this.terrain.height(o.x, o.z);
      let mesh: THREE.Mesh;
      if (o.kind === 'crystal') {
        mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(o.radius * 2, 0), this.crystal);
        mesh.scale.y = o.height / (o.radius * 4); // icosahedron spans 2x its radius
        mesh.rotation.y = o.x * 7; // deterministic variety
      } else {
        mesh = new THREE.Mesh(
          stripedPole(o.radius * 1.3, o.height, this.orange, this.white),
          this.striped
        );
      }
      mesh.position.set(o.x, y + o.height / 2, o.z);
      mesh.castShadow = true;
      group.add(mesh);
    }

    // Pickup discs along the racing line.
    for (const p of this.terrain.pickupsForChunk(index)) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), this.gold);
      disc.rotation.z = Math.PI / 2;
      disc.position.set(p.x, this.terrain.height(p.x, p.z) + 1.1, p.z);
      group.add(disc);
      this.pickupMeshes.set(p.id, disc);
    }

    // The absurd part: city skyline and clouds drifting far below the course.
    const baseY = this.terrain.height(this.terrain.centerX(zMid), zMid);
    const towers = 4 + Math.floor(rng() * 4);
    for (let t = 0; t < towers; t++) {
      const side = rng() < 0.5 ? -1 : 1;
      const w = 14 + rng() * 26;
      const h = 45 + rng() * 110;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), this.city);
      tower.position.set(
        this.terrain.centerX(zMid) + side * (110 + rng() * 320),
        baseY - 170 + h / 2,
        zTop - rng() * CHUNK_LENGTH * 1.5
      );
      group.add(tower);
    }
    for (let n = 0; n < 3; n++) {
      const puff = new THREE.Mesh(new THREE.CircleGeometry(12 + rng() * 20, 12), this.cloud);
      puff.rotation.x = -Math.PI / 2;
      puff.position.set(
        this.terrain.centerX(zMid) + (rng() * 2 - 1) * 220,
        baseY - 55 - rng() * 40,
        zTop - rng() * CHUNK_LENGTH
      );
      group.add(puff);
    }

    this.scene.add(group);
    return group;
  }
}
