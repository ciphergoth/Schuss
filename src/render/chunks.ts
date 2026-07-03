import * as THREE from 'three';
import { CHUNK_LENGTH, Terrain, WALL_WIDTH } from '../sim/terrain';
import { hash2, mulberry32 } from '../sim/rng';

// The course renders as a ribbon that follows the centerline — beyond its
// edges there is nothing but sky, city, and clouds far below. SSX rules.
// The ribbon clips just past the bounce barrier: rendering further up the
// mathematical super-wall turned the course into a 100m canyon that hid the
// entire skyline.
const RIBBON_WALL_MARGIN = WALL_WIDTH + 1;
const NEON_COLORS = [0x2ee6ff, 0xff3ddc, 0xffe14d, 0x7dff5a];
const BALLOON_COLORS = [0xff5a48, 0xffc63d, 0x51d0ff, 0xb96bff, 0x6cf29a];
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
  private gem = new THREE.MeshBasicMaterial({ color: 0x5df2ff });
  private neons = NEON_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  private balloons = BALLOON_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })
  );
  private beacon = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  private basket = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });

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

    // Track ribbon: a normalized grid in track space — each row spans the
    // local floor-plus-wall width, so the mesh follows the course through
    // curves AND breathes with the variable channel width.
    // Enough z-resolution that kicker ramps and lips read as built geometry.
    let geo: THREE.BufferGeometry = new THREE.PlaneGeometry(2, CHUNK_LENGTH, 30, 28);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, zMid);
    geo = geo.toNonIndexed();
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const z = pos.getZ(v);
      const halfSpan = this.terrain.channelHalfWidth(z) + RIBBON_WALL_MARGIN;
      const d = pos.getX(v) * halfSpan;
      const x = this.terrain.centerX(z) + d;
      pos.setX(v, x);
      pos.setY(v, this.terrain.height(x, z));
      const wall = Math.min(
        1,
        Math.max(0, (Math.abs(d) - this.terrain.channelHalfWidth(z)) / WALL_WIDTH)
      );
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

    // Striped bollards trace the floor edge; tall neon poles rise above them
    // every other slot so the course outline reads from hundreds of meters.
    const bollardGeo = stripedPole(0.16, 1.5, this.red, this.white);
    const neonGeo = new THREE.CylinderGeometry(0.14, 0.14, 9, 6);
    for (const side of [-1, 1]) {
      for (let k = 0; k < CHUNK_LENGTH / 8; k++) {
        const z = zTop - 4 - k * 8;
        const edge = this.terrain.channelHalfWidth(z);
        const x = this.terrain.centerX(z) + side * (edge + 1.5);
        const marker = new THREE.Mesh(bollardGeo, this.striped);
        marker.position.set(x, this.terrain.height(x, z) + 0.75, z);
        marker.castShadow = true;
        group.add(marker);
        if (k % 2 === 0) {
          const neonX = this.terrain.centerX(z) + side * (edge + 3);
          const neon = new THREE.Mesh(
            neonGeo,
            this.neons[(index + k + (side === 1 ? 1 : 0)) % this.neons.length]!
          );
          neon.position.set(neonX, this.terrain.height(neonX, z) + 4.5, z);
          group.add(neon);
        }
      }
    }

    // Tall striped poles flag the actual edges of each kicker.
    const jump = this.terrain.jumpForChunk(index);
    if (jump) {
      const lipPole = stripedPole(0.2, 2.6, this.red, this.white);
      for (const side of [-1, 1]) {
        const x = this.terrain.centerX(jump.zLip) + jump.xOffset + side * (jump.halfWidth + 0.6);
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
      const span = (this.terrain.channelHalfWidth(zA) + 2) * 2;
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

    // Coins along the racing line, bigger cyan gems in the kicker arcs.
    for (const p of this.terrain.pickupsForChunk(index)) {
      const mesh = p.gem
        ? new THREE.Mesh(new THREE.OctahedronGeometry(0.65, 0), this.gem)
        : new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), this.gold);
      if (!p.gem) mesh.rotation.z = Math.PI / 2;
      mesh.position.set(p.x, p.y, p.z);
      group.add(mesh);
      this.pickupMeshes.set(p.id, mesh);
    }

    // The absurd part: a city close and tall enough to actually see — some
    // towers rise past course level, beacons blinking gold at their tops —
    // plus hot-air balloons drifting beside the track and clouds below.
    const baseY = this.terrain.height(this.terrain.centerX(zMid), zMid);
    const towers = 4 + Math.floor(rng() * 4);
    for (let t = 0; t < towers; t++) {
      const side = rng() < 0.5 ? -1 : 1;
      const w = 12 + rng() * 22;
      const h = 60 + rng() * 160;
      const x = this.terrain.centerX(zMid) + side * (60 + rng() * 220);
      const z = zTop - rng() * CHUNK_LENGTH * 1.5;
      const top = baseY - 130 + h;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), this.city);
      tower.position.set(x, baseY - 130 + h / 2, z);
      group.add(tower);
      if (top > baseY - 20 && rng() < 0.7) {
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 6), this.beacon);
        light.position.set(x, top + 1, z);
        group.add(light);
      }
    }
    if (rng() < 0.4) {
      const balloon = new THREE.Group();
      const envelope = new THREE.Mesh(
        new THREE.SphereGeometry(4, 10, 10),
        this.balloons[Math.floor(rng() * this.balloons.length)]!
      );
      envelope.scale.y = 1.2;
      balloon.add(envelope);
      const basket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), this.basket);
      basket.position.y = -6;
      balloon.add(basket);
      const side = rng() < 0.5 ? -1 : 1;
      balloon.position.set(
        this.terrain.centerX(zMid) + side * (40 + rng() * 60),
        baseY + 8 + rng() * 26,
        zMid - rng() * CHUNK_LENGTH
      );
      group.add(balloon);
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
