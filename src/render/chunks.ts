import * as THREE from 'three';
import { CHUNK_LENGTH, SECTION_LENGTH, Terrain, WALL_WIDTH, jumpDrift } from '../sim/terrain';
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
const SNOW_CRUD = new THREE.Color(0x8494cf); // slow crud: dusty periwinkle

// Flat five-pointed star, the classic prize shape.
function starGeometry(radius: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

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
  private pickupMeshes = new Map<string, THREE.Object3D>();
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
  private goldStar = new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide });
  private magenta = new THREE.MeshBasicMaterial({ color: 0xff3ddc, side: THREE.DoubleSide });
  private goldHalo = new THREE.MeshBasicMaterial({
    color: 0xffe9a8,
    transparent: true,
    opacity: 0.55,
  });
  private magentaHalo = new THREE.MeshBasicMaterial({
    color: 0xff9df0,
    transparent: true,
    opacity: 0.55,
  });
  private neons = NEON_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  private gateGlows = NEON_COLORS.map(
    (c) =>
      new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
  );
  private beamGold = new THREE.MeshBasicMaterial({
    color: 0xffd34d,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private beamMagenta = new THREE.MeshBasicMaterial({
    color: 0xff3ddc,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private balloons = BALLOON_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })
  );
  private beacon = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  private basket = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain
  ) {}

  // Swap to a new course (next seed): tear down every chunk and rebuild
  // against the new terrain as the update loop asks for it.
  setTerrain(terrain: Terrain): void {
    for (const [, group] of this.chunks) {
      this.scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
    }
    this.chunks.clear();
    this.pickupMeshes.clear();
    this.terrain = terrain;
  }

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
        for (const b of this.terrain.bonusesForChunk(i)) this.pickupMeshes.delete(b.id);
        this.chunks.delete(i);
      }
    }
    // Spin the discs, bob everything gently; hide the ones already grabbed.
    for (const [id, mesh] of this.pickupMeshes) {
      mesh.visible = !collected.has(id);
      mesh.rotation.y = time * 3;
      const baseY = mesh.userData.baseY as number;
      mesh.position.y = baseY + Math.sin(time * 2.2 + mesh.position.x) * 0.14;
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
      // What you see is what slows you: crud tint tracks the sim's friction.
      c.lerpColors(SNOW_FLOOR, SNOW_CRUD, this.terrain.stickinessAt(x, z));
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

    // Striped bollards trace the floor edge.
    const bollardGeo = stripedPole(0.16, 1.5, this.red, this.white);
    for (const side of [-1, 1]) {
      for (let k = 0; k < CHUNK_LENGTH / 8; k++) {
        const z = zTop - 4 - k * 8;
        const x = this.terrain.centerX(z) + side * (this.terrain.channelHalfWidth(z) + 1.5);
        const marker = new THREE.Mesh(bollardGeo, this.striped);
        marker.position.set(x, this.terrain.height(x, z) + 0.75, z);
        marker.castShadow = true;
        group.add(marker);
      }
    }

    // Ski jumps announce themselves: a pair of tall neon poles at the lip
    // edges, one color per kicker, visible from hundreds of meters uphill so
    // you can pick your line early — plus runway studs lighting the approach
    // like an airstrip, funneling you onto the ramp.
    const jump = this.terrain.jumpForChunk(index);
    if (jump) {
      // A hip's core curves along the rider's drift line; poles and studs
      // follow it so the lit runway IS the line to ride.
      const coreAt = (u: number) => jump.xOffset + jumpDrift(jump, u);
      // Poles grow with the kicker: an L reads as a bigger event from afar.
      const poleHeight = 8 + jump.lipHeight * 1.5;
      const neonGeo = new THREE.CylinderGeometry(0.22, 0.22, poleHeight, 6);
      const neon = this.neons[index % this.neons.length]!;
      for (const side of [-1, 1]) {
        const x = this.terrain.centerX(jump.zLip) + coreAt(0) + side * (jump.halfWidth + 0.6);
        const pole = new THREE.Mesh(neonGeo, neon);
        pole.position.set(x, this.terrain.height(x, jump.zLip) + poleHeight / 2, jump.zLip);
        group.add(pole);
      }
      // Runway studs light the approach corridor.
      const studGeo = new THREE.SphereGeometry(0.2, 6, 6);
      for (let u = 4; u <= jump.rampLength + 14; u += 6) {
        const z = jump.zLip + u;
        for (const side of [-1, 1]) {
          const x = this.terrain.centerX(z) + coreAt(u) + side * (jump.halfWidth + 0.5);
          const stud = new THREE.Mesh(studGeo, neon);
          stud.position.set(x, this.terrain.height(x, z) + 0.2, z);
          group.add(stud);
        }
      }
    }

    // The FINISH gate: checkered pillars and bars across the whole channel
    // where the course ends, visible from far up the final plunge.
    if (index * CHUNK_LENGTH === this.terrain.courseLength) {
      const zf = -this.terrain.courseLength;
      const cX = this.terrain.centerX(zf);
      const floorY = this.terrain.height(cX, zf);
      const span = this.terrain.channelHalfWidth(zf) + 2;
      const black = new THREE.Color(0x15151c);
      const pillarGeo = stripedPole(0.5, 13, black, this.white);
      for (const side of [-1, 1]) {
        const x = cX + side * span;
        const pillar = new THREE.Mesh(pillarGeo, this.striped);
        pillar.position.set(x, this.terrain.height(x, zf) + 6.5, zf);
        pillar.castShadow = true;
        group.add(pillar);
      }
      for (const barY of [10.4, 11.6]) {
        const bar = new THREE.Mesh(
          stripedPole(0.55, span * 2, black, this.white).rotateZ(Math.PI / 2),
          this.striped
        );
        bar.position.set(cX, floorY + barY, zf);
        group.add(bar);
      }
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(span + 1, 1.3, 8, 40, Math.PI),
        this.gateGlows[2]!
      );
      halo.position.set(cX, floorY + 0.3, zf);
      group.add(halo);
    }

    // Section-boundary gates: a glowing neon arc spans the channel where one
    // section personality gives way to the next, every 400m — the course's
    // structure made visible. None past the finish — the outrun is over.
    // A gate lives in the chunk whose [zTop, zTop - CHUNK_LENGTH) span holds
    // it, boundary included at the top (matching chunkIndexAt).
    for (
      let k = Math.max(1, Math.ceil(-zTop / SECTION_LENGTH));
      k * SECTION_LENGTH < Math.min(-zTop + CHUNK_LENGTH, this.terrain.courseLength);
      k++
    ) {
      const zg = -k * SECTION_LENGTH;
      const cX = this.terrain.centerX(zg);
      const floorY = this.terrain.height(cX, zg);
      const radius = this.terrain.channelHalfWidth(zg) + 2.5;
      const color = this.neons[k % this.neons.length]!;
      const glow = this.gateGlows[k % this.gateGlows.length]!;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.4, 8, 40, Math.PI), color);
      arc.position.set(cX, floorY + 0.3, zg);
      group.add(arc);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(radius, 1.1, 8, 40, Math.PI), glow);
      halo.position.copy(arc.position);
      group.add(halo);
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

    // Coins along the floor.
    for (const p of this.terrain.pickupsForChunk(index)) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), this.gold);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(p.x, p.y, p.z);
      mesh.userData.baseY = p.y;
      group.add(mesh);
      this.pickupMeshes.set(p.id, mesh);
    }

    // Trick-bonus stars past the kicker lip: gold x3, bigger magenta x5,
    // each with a halo ring, riding its own light beam up from the snow so
    // the flight line reads from hundreds of meters out.
    for (const b of this.terrain.bonusesForChunk(index)) {
      const big = b.mult === 5;
      const holder = new THREE.Group();
      const star = new THREE.Mesh(
        starGeometry(big ? 1.25 : 0.9),
        big ? this.magenta : this.goldStar
      );
      holder.add(star);
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(big ? 1.7 : 1.25, 0.07, 8, 32),
        big ? this.magentaHalo : this.goldHalo
      );
      holder.add(halo);
      holder.position.set(b.x, b.y, b.z);
      holder.userData.baseY = b.y;
      group.add(holder);
      this.pickupMeshes.set(b.id, holder);

      const snowY = this.terrain.height(b.x, b.z);
      const beamLen = b.y - snowY;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.22, beamLen, 6),
        big ? this.beamMagenta : this.beamGold
      );
      beam.position.set(b.x, snowY + beamLen / 2, b.z);
      group.add(beam);
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
