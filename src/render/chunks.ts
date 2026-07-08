import * as THREE from 'three';
import {
  CHUNK_LENGTH,
  GATE_HEIGHT,
  Hazard,
  SECTION_LENGTH,
  Terrain,
  WALL_WIDTH,
  WYRM_SEGMENTS,
  hazardX,
  jellyPose,
  jumpDrift,
  tumblerPose,
  wyrmSegment,
} from '../sim/terrain';
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
const SNOW_ICE = new THREE.Color(0x9fd8ff); // glacier: the GRIP channel made visible

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

// A true checkerboard panel: a plane subdivided into cols x rows cells,
// each face flooded one of two colors so the grid reads as a checkered
// flag. An optional wave ripples it along its width so a strung banner or a
// flown flag flutters instead of hanging as a flat board. Per-FACE coloring
// (centroid decides the cell) keeps the squares crisp — a per-vertex rule
// would smear every cell edge, since grid vertices are shared between cells.
function checkerPanel(
  width: number,
  height: number,
  cols: number,
  rows: number,
  a: THREE.Color,
  b: THREE.Color,
  wave = 0
): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.PlaneGeometry(width, height, cols, rows);
  if (wave !== 0) {
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      p.setZ(i, Math.sin(p.getX(i) * 0.7 + p.getY(i) * 0.25) * wave);
    }
    geo.computeVertexNormals();
  }
  geo = geo.toNonIndexed();
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const cw = width / cols;
  const ch = height / rows;
  for (let f = 0; f < pos.count; f += 3) {
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3 + width / 2;
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3 + height / 2;
    const cell = (Math.floor(cx / cw) + Math.floor(cy / ch)) % 2;
    const c = cell === 0 ? a : b;
    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = c.r;
      colors[(f + k) * 3 + 1] = c.g;
      colors[(f + k) * 3 + 2] = c.b;
    }
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
  // Checkered-flag cloth: vertex-colored and DOUBLE-SIDED so the flag reads
  // as fabric from both the approach and the outrun once you cross it.
  private checkerCloth = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
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
  private flagMast = new THREE.MeshStandardMaterial({ color: 0xcfd6e0, roughness: 0.5 });
  private beacon = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  private basket = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
  // Section-signature props: each personality dresses its own stretch.
  private pineTrunk = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.9 });
  private pineDark = new THREE.MeshStandardMaterial({
    color: 0x1e4d3a,
    roughness: 0.9,
    flatShading: true,
  });
  private pineSnow = new THREE.MeshStandardMaterial({
    color: 0xeaf4ff,
    roughness: 1,
    flatShading: true,
  });
  private amber = new THREE.MeshBasicMaterial({ color: 0xffa02e });
  private pennants = NEON_COLORS.map(
    (c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })
  );
  private searchBeam = new THREE.MeshBasicMaterial({
    color: 0xbfe9ff,
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // The grotto: near-black vaulted ice, lit by its own crystals.
  private caveRock = new THREE.MeshStandardMaterial({
    color: 0x2a3468,
    emissive: 0x0c1440,
    roughness: 0.85,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  private caveGlowA = new THREE.MeshBasicMaterial({ color: 0x7df2ff });
  private caveGlowB = new THREE.MeshBasicMaterial({ color: 0xb96bff });
  // Patrol drones: dark shell, warning-amber glow ring and underbeam.
  private droneShell = new THREE.MeshStandardMaterial({
    color: 0x232a52,
    roughness: 0.4,
    flatShading: true,
  });
  private droneGlow = new THREE.MeshBasicMaterial({ color: 0xffb02e });
  private droneBeam = new THREE.MeshBasicMaterial({
    color: 0xffb02e,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // The wyrm: deep-sea teal with a glowing spine, at home under the powder.
  private wyrmSkin = new THREE.MeshStandardMaterial({
    color: 0x1d6157,
    emissive: 0x0a2f2a,
    roughness: 0.7,
    flatShading: true,
  });
  private wyrmEye = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  // The jelly: additive light, barely a body at all.
  private jellyTent = new THREE.MeshBasicMaterial({
    color: 0xb9e8ff,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // Every live creature registers an animator; update() drives them all on
  // sim time, so the choreography you watch is the sim's own (hazardCircles
  // and these poses share the same pure functions).
  private creatureAnims = new Map<string, (time: number) => void>();

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
    this.creatureAnims.clear();
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
        for (const h of this.terrain.hazardsForChunk(i)) this.creatureAnims.delete(h.id);
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
    // The menagerie moves on the sim's own clock: every creature's animator
    // runs the same pure pose functions the collision circles do, so the
    // shape you watch is the shape that hits.
    for (const [, animate] of this.creatureAnims) animate(time);
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
      // What you see is what slows you: crud tint tracks the sim's friction,
      // and glacier blue tracks the GRIP channel — where the floor reads icy,
      // the edges genuinely bite less.
      c.lerpColors(SNOW_FLOOR, SNOW_CRUD, this.terrain.stickinessAt(x, z));
      c.lerp(SNOW_ICE, 0.75 * (1 - this.terrain.gripAt(z)));
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

    // The FINISH gate: a CHECKERED-FLAG finish line — black-and-white
    // pillars and bars across the whole channel, a big checkered banner
    // strung between the pillars waving over the line, and a race flag flown
    // from each pillar top. Visible from far up the final plunge.
    if (index * CHUNK_LENGTH === this.terrain.courseLength) {
      const zf = -this.terrain.courseLength;
      const cX = this.terrain.centerX(zf);
      const floorY = this.terrain.height(cX, zf);
      const span = this.terrain.channelHalfWidth(zf) + 2;
      const black = new THREE.Color(0x15151c);
      const pillarGeo = stripedPole(0.5, 13, black, this.white);
      const pillarTop = floorY + 13;
      for (const side of [-1, 1]) {
        const x = cX + side * span;
        const pillar = new THREE.Mesh(pillarGeo, this.striped);
        pillar.position.set(x, this.terrain.height(x, zf) + 6.5, zf);
        pillar.castShadow = true;
        group.add(pillar);
        // A checkered race flag flown from a short mast at the pillar top,
        // fluttering out over the channel.
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), this.flagMast);
        mast.position.set(x, pillarTop + 1.5, zf);
        group.add(mast);
        const flag = new THREE.Mesh(
          checkerPanel(2.6, 1.6, 4, 3, black, this.white, 0.35),
          this.checkerCloth
        );
        // Fly it inward over the track from the top of the mast.
        flag.position.set(x - side * 1.4, pillarTop + 2.4, zf);
        group.add(flag);
      }
      for (const barY of [10.4, 11.6]) {
        const bar = new THREE.Mesh(
          stripedPole(0.55, span * 2, black, this.white).rotateZ(Math.PI / 2),
          this.striped
        );
        bar.position.set(cX, floorY + barY, zf);
        group.add(bar);
      }
      // The hero: a broad checkered banner strung across the whole channel
      // just below the bars, waving over the line so THE FLAG is the last
      // thing you pass under.
      const bannerH = 2.6;
      const cell = 1.1;
      const banner = new THREE.Mesh(
        checkerPanel(
          span * 2,
          bannerH,
          Math.max(6, Math.round((span * 2) / cell)),
          Math.max(2, Math.round(bannerH / cell)),
          black,
          this.white,
          0.5
        ),
        this.checkerCloth
      );
      banner.position.set(cX, floorY + 8.4, zf);
      group.add(banner);
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

    // Slalom gates in the narrows: paired candy poles with a pennant line
    // strung between their tips — triangular flags hanging over the gap
    // itself, so THE GATE is the thing with the flags on (they used to hang
    // on a separate bunting line overhead, and read as scenery while the
    // bare poles read as bollards). The sim pays the chain.
    for (const g of this.terrain.gatesForChunk(index)) {
      const neon = this.neons[(index + Math.round(g.z)) % this.neons.length]!;
      const poleGeo = stripedPole(0.14, GATE_HEIGHT, this.red, this.white);
      const tipYs: number[] = [];
      for (const side of [-1, 1]) {
        const x = g.x + side * g.halfGap;
        const y = this.terrain.height(x, g.z);
        const pole = new THREE.Mesh(poleGeo, this.striped);
        pole.position.set(x, y + GATE_HEIGHT / 2, g.z);
        pole.castShadow = true;
        group.add(pole);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 6), neon);
        tip.position.set(x, y + GATE_HEIGHT + 0.2, g.z);
        group.add(tip);
        tipYs.push(y + GATE_HEIGHT + 0.2);
      }
      // The string and its flags: a thin bar joining the two tips, three
      // pennants hanging into it. Passing under the flags IS threading the
      // gate. The narrows floor banks, so the tips sit at DIFFERENT heights —
      // the line must tilt to actually join them (a flat bar at the mean
      // height touches neither pole and reads as a funny-angled float), and
      // each pennant hangs from its own point along that slope.
      const midY = (tipYs[0]! + tipYs[1]!) / 2;
      const dy = tipYs[1]! - tipYs[0]!;
      const span = Math.hypot(g.halfGap * 2, dy);
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, span, 5), this.flagMast);
      line.position.set(g.x, midY, g.z);
      line.rotation.z = Math.atan2(dy, g.halfGap * 2) - Math.PI / 2;
      group.add(line);
      const flagGeo = new THREE.ConeGeometry(0.3, 0.9, 3);
      for (let k = -1; k <= 1; k++) {
        const flag = new THREE.Mesh(
          flagGeo,
          this.pennants[(k + 1 + index) % this.pennants.length]!
        );
        flag.rotation.x = Math.PI; // hang point-down from the line
        // Follow the tilted line: interpolate the tip heights at this offset.
        const lineY = midY + k * 0.55 * (dy / 2);
        flag.position.set(g.x + k * g.halfGap * 0.55, lineY - 0.5, g.z);
        group.add(flag);
      }
    }

    // The menagerie: built here, choreographed by update() on sim time.
    for (const h of this.terrain.hazardsForChunk(index)) {
      if (h.kind === 'drone') this.addDrone(group, h);
      else if (h.kind === 'wyrm') this.addWyrm(group, h);
      else if (h.kind === 'jelly') this.addJelly(group, h);
      else this.addTumbler(group, h);
    }

    this.addSectionProps(group, index, zTop, zMid);
    this.addGrotto(group, zTop);

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

  // THE MENAGERIE'S BODIES. Each builder adds the meshes to the chunk's
  // group (so disposal is free) and registers an animator that drives them
  // from the same pure pose functions the sim's collision circles use.

  // The drone: amber ring, blinking beacon, a beam swept along the snow —
  // loud on purpose, a hazard you can't read from 150m out is an ambush.
  private addDrone(group: THREE.Group, h: Hazard): void {
    const drone = new THREE.Group();
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 0), this.droneShell);
    body.scale.y = 0.6;
    body.castShadow = true;
    drone.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.14, 6, 20), this.droneGlow);
    ring.rotation.x = Math.PI / 2;
    drone.add(ring);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), this.droneGlow);
    beacon.position.y = 0.78;
    drone.add(beacon);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.7, 2.6, 8, 1, true),
      this.droneBeam
    );
    beam.position.y = -1.2;
    drone.add(beam);
    group.add(drone);
    this.creatureAnims.set(h.id, (time) => {
      const x = hazardX(h, time);
      const y = this.terrain.height(x, h.z);
      drone.position.set(x, y + 1.2 + Math.sin(time * 2.6 + h.phase) * 0.12, h.z);
      drone.rotation.y = time * 2.2;
      beacon.visible = Math.sin(time * 5 + h.phase) > -0.3;
    });
  }

  // The wyrm: a chain of humps swimming the drifts. Each segment rides the
  // shared pose function; below the snow it simply sinks under the ribbon,
  // so surfacing and diving need no extra effects to read. The head gets a
  // snout and eyes; a couple of dorsal fins break the water line early —
  // the tell that something is coming before the first hump crests.
  private addWyrm(group: THREE.Group, h: Hazard): void {
    const segs: THREE.Group[] = [];
    for (let i = 0; i < WYRM_SEGMENTS; i++) {
      const seg = new THREE.Group();
      const r = i === 0 ? 0.75 : 0.68 - i * 0.03;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 7), this.wyrmSkin);
      ball.castShadow = true;
      seg.add(ball);
      // The glowing spine stud: the body reads at night and in the blizzard.
      const stud = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 5), this.caveGlowA);
      stud.position.y = r * 0.9;
      seg.add(stud);
      if (i === 0) {
        const snout = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 6), this.wyrmSkin);
        snout.rotation.x = -Math.PI / 2;
        snout.position.z = -0.8;
        seg.add(snout);
        for (const side of [-1, 1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 5, 5), this.wyrmEye);
          eye.position.set(side * 0.32, 0.28, -0.5);
          seg.add(eye);
        }
      }
      if (i === 3 || i === 6) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 4), this.wyrmSkin);
        fin.position.y = r * 0.8;
        seg.add(fin);
      }
      group.add(seg);
      segs.push(seg);
    }
    this.creatureAnims.set(h.id, (time) => {
      for (let i = 0; i < WYRM_SEGMENTS; i++) {
        const p = wyrmSegment(h, i, time);
        const ahead = wyrmSegment(h, i, time + 0.06);
        const gy = this.terrain.height(p.x, p.z);
        // lift < 0 sinks the segment under the ribbon; the snow hides it.
        segs[i]!.position.set(p.x, gy + p.lift * 1.1 - 0.15, p.z);
        segs[i]!.rotation.y = Math.atan2(ahead.x - p.x, ahead.z - p.z) + Math.PI;
      }
    });
  }

  // The jelly: a pulsing bell of pure light with tentacles dangling to the
  // clearance line. The pulse IS the readout: bell squeezed high and bright
  // = the pass-under window; bell spread low and dim = go around.
  private addJelly(group: THREE.Group, h: Hazard): void {
    const jelly = new THREE.Group();
    const bellMat = new THREE.MeshBasicMaterial({
      color: 0x9fd0ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const bell = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), bellMat);
    jelly.add(bell);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), this.magenta);
    core.position.y = -0.1;
    jelly.add(core);
    const TENT_LEN = 2.2;
    const tentacles: THREE.Mesh[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const tent = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.02, TENT_LEN, 5),
        this.jellyTent
      );
      tent.position.set(Math.cos(a) * 0.6, -TENT_LEN / 2 - 0.4, Math.sin(a) * 0.6);
      jelly.add(tent);
      tentacles.push(tent);
    }
    group.add(jelly);
    this.creatureAnims.set(h.id, (time) => {
      const p = jellyPose(h, time);
      const gy = this.terrain.height(p.x, p.z);
      // The bell floats so its tentacle tips graze the clearance line the
      // sim collides with: what you see hanging is what hits.
      jelly.position.set(p.x, gy + p.clearance + TENT_LEN + 0.4, p.z);
      bell.scale.set(1.2 - 0.3 * p.pulse, 0.62 + 0.33 * p.pulse, 1.2 - 0.3 * p.pulse);
      bellMat.opacity = 0.35 + 0.4 * p.pulse;
      for (const [k, tent] of tentacles.entries()) {
        tent.rotation.z = 0.12 * Math.sin(time * 1.7 + k);
        tent.rotation.x = 0.12 * Math.cos(time * 1.3 + k * 2);
      }
    });
  }

  // The tumbler: a crystal boulder bouncing down the terraces — squashing
  // on impact, stretching in flight, forming out of the snow at the top of
  // its patrol and collapsing at the bottom (presence 0..1 scales it, and
  // the sim's circle vanishes with it — the respawn can't ambush anyone).
  private addTumbler(group: THREE.Group, h: Hazard): void {
    const boulder = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), this.crystal);
    body.castShadow = true;
    boulder.add(body);
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), this.caveGlowB);
    boulder.add(gem);
    group.add(boulder);
    this.creatureAnims.set(h.id, (time) => {
      const p = tumblerPose(h, time);
      const gy = this.terrain.height(p.x, p.z);
      boulder.visible = p.presence > 0.02;
      boulder.position.set(p.x, gy + p.hop + 1.0, p.z);
      const land = Math.min(1, p.hop / 0.5);
      const squash = 0.65 + 0.35 * land;
      boulder.scale.set(
        p.presence * (1.15 - 0.15 * land),
        p.presence * squash,
        p.presence * (1.15 - 0.15 * land)
      );
      boulder.rotation.x = -time * 3.1;
      boulder.rotation.y = h.phase;
    });
  }

  // SECTION-SIGNATURE PROPS: each personality dresses its own stretch, so a
  // color-blind glance at the scenery names the section. Everything here is
  // pure decoration on the banks, edges, or overhead — never on the racing
  // floor, never a collider — and the finish apron stays ceremonial-clean.
  private addSectionProps(group: THREE.Group, index: number, zTop: number, zMid: number): void {
    if (this.terrain.finishApron(zMid) || this.terrain.pastFinish(zMid)) return;
    const type = this.terrain.sectionType(this.terrain.sectionIndexAt(zMid));
    const rng = mulberry32(Math.floor(hash2(this.terrain.seed, index, 90001) * 2 ** 31));
    const place = (
      mesh: THREE.Object3D,
      z: number,
      d: number, // offset from the centerline (signed)
      lift: number
    ): void => {
      const x = this.terrain.centerX(z) + d;
      mesh.position.set(x, this.terrain.height(x, z) + lift, z);
      group.add(mesh);
    };

    if (type === 'powder') {
      // Snow-laden pines lining the drifts: the deep-snow section reads as
      // the one stretch of forest on the whole floating course.
      for (let k = 0; k < 4; k++) {
        if (rng() < 0.25) continue;
        const z = zTop - 4 - rng() * (CHUNK_LENGTH - 8);
        const side = rng() < 0.5 ? -1 : 1;
        const d = side * (this.terrain.channelHalfWidth(z) + 2.5 + rng() * 5);
        const s = 0.8 + rng() * 0.7;
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.1, 5), this.pineTrunk);
        trunk.position.y = 0.5;
        tree.add(trunk);
        const lower = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.6, 7), this.pineDark);
        lower.position.y = 2.1;
        lower.castShadow = true;
        tree.add(lower);
        const upper = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.0, 7), this.pineSnow);
        upper.position.y = 3.4;
        upper.castShadow = true;
        tree.add(upper);
        tree.scale.setScalar(s * 1.6);
        tree.rotation.y = rng() * Math.PI * 2;
        place(tree, z, d, 0);
      }
    } else if (type === 'canyon' || type === 'glacier') {
      // Crystal country: the canyon grows carved pillars up its gorge walls,
      // the glacier grows wilder tilted monoliths over the blue ice.
      const count = type === 'canyon' ? 3 : 2;
      for (let k = 0; k < count; k++) {
        if (rng() < 0.2) continue;
        const z = zTop - 5 - rng() * (CHUNK_LENGTH - 10);
        const side = k % 2 === 0 ? -1 : 1;
        const d = side * (this.terrain.channelHalfWidth(z) + 3.5 + rng() * 3.5);
        const h = 4 + rng() * 6;
        const pillar =
          type === 'canyon'
            ? new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.95, h, 6), this.crystal)
            : new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), this.crystal);
        if (type === 'glacier') pillar.scale.set(0.8, h / 2.2, 0.8);
        pillar.rotation.z = side * (0.06 + rng() * 0.14);
        pillar.rotation.y = rng() * Math.PI * 2;
        pillar.castShadow = true;
        place(pillar, z, d, h * (type === 'canyon' ? 0.42 : 0.32));
        // A glow shard at each foot so the gallery reads at night too.
        const shard = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.22, 0),
          k % 2 === 0 ? this.caveGlowA : this.caveGlowB
        );
        place(shard, z, d - side * 0.9, 0.2);
      }
    } else if (type === 'steps') {
      // Every terrace edge is a launch line — light it like one. The studs
      // sit on the brink, right where the floor lets go. Terraces run every
      // 50m from each section head (and 400 is a multiple of 50), so the
      // brink — the drop fade's midpoint — sits at -z = 50k + 47.
      const TERRACE = 50;
      for (let k = Math.floor(-zTop / TERRACE); ; k++) {
        const zBrink = -(k * TERRACE + 47);
        if (zBrink <= zTop - CHUNK_LENGTH) break;
        if (zBrink > zTop) continue;
        if (this.terrain.sectionType(this.terrain.sectionIndexAt(zBrink)) !== 'steps') continue;
        const half = this.terrain.channelHalfWidth(zBrink) - 2;
        const neon = this.neons[k % this.neons.length]!;
        for (let d = -half; d <= half; d += 3.5) {
          const stud = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), neon);
          place(stud, zBrink, d, 0.16);
        }
      }
    } else if (type === 'sweeper') {
      // Gold studs trace the inside of each banked ess: the carve line,
      // drawn on the snow.
      for (let local = 2; local < CHUNK_LENGTH; local += 6) {
        const z = zTop - local;
        const curv =
          (this.terrain.centerX(z - 20) -
            2 * this.terrain.centerX(z) +
            this.terrain.centerX(z + 20)) /
          400;
        if (Math.abs(curv) < 0.012) continue;
        const d = Math.sign(curv) * (this.terrain.channelHalfWidth(z) + 0.8);
        const stud = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), this.gold);
        place(stud, z, d, 0.18);
      }
    } else if (type === 'plunge') {
      // Speed chevrons streak both edges: amber dashes angled downhill,
      // the drop announcing itself.
      for (const local of [8, 26]) {
        const z = zTop - local;
        for (const side of [-1, 1]) {
          const d = side * (this.terrain.channelHalfWidth(z) + 1.2);
          for (let k = 0; k < 2; k++) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.22), this.amber);
            bar.rotation.y = side * 0.55 * (k === 0 ? 1 : -1);
            place(bar, z - k * 1.4, d, 0.3);
          }
        }
      }
    } else if (type === 'bowl' && rng() < 0.5) {
      // A floodlight rig over the playground: a tall mast and a soft beam
      // washing across the bowl.
      const z = zTop - 8 - rng() * 24;
      const side = rng() < 0.5 ? -1 : 1;
      const d = side * (this.terrain.channelHalfWidth(z) + 6);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 10, 6), this.flagMast);
      place(mast, z, d, 5);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 6), this.beacon);
      place(head, z, d, 10.2);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(6, 26, 10, 1, true), this.searchBeam);
      beam.rotation.z = side * 1.15; // slant the cone over the track
      place(beam, z, d - side * 11, 6);
    }
  }

  // THE GROTTO: a vaulted ice roof slung wall-to-wall over the channel,
  // icicles and glow crystals under it, and runway studs carrying the line
  // through the dark. The heightfield is untouched — the sim's caveAt()
  // drives the scene-level darkness; this is the architecture it implies.
  private addGrotto(group: THREE.Group, zTop: number): void {
    const { z: mouth, span } = this.terrain.grotto;
    const zLo = Math.max(zTop - CHUNK_LENGTH, mouth - span);
    const zHi = Math.min(zTop, mouth);
    if (zLo >= zHi) return;
    const rng = mulberry32(Math.floor(hash2(this.terrain.seed, Math.round(zTop), 90007) * 2 ** 31));

    // The vault: a track-space grid like the ribbon's, its height blending
    // from the wall tops at the edges up to an apex over the centerline.
    // The apex breathes with caveAt, so both portals are lowered brows.
    const len = zHi - zLo;
    let roofGeo: THREE.BufferGeometry = new THREE.PlaneGeometry(2, len, 20, 16);
    roofGeo.rotateX(-Math.PI / 2);
    roofGeo.translate(0, 0, (zHi + zLo) / 2);
    roofGeo = roofGeo.toNonIndexed();
    const pos = roofGeo.getAttribute('position');
    for (let v = 0; v < pos.count; v++) {
      const z = pos.getZ(v);
      const u = pos.getX(v); // -1..1 across the span
      const halfSpan = this.terrain.channelHalfWidth(z) + RIBBON_WALL_MARGIN;
      const x = this.terrain.centerX(z) + u * halfSpan;
      const wallY = this.terrain.height(x, z);
      const floorY = this.terrain.height(this.terrain.centerX(z), z);
      const apex = 6 + 9 * this.terrain.caveAt(z);
      const t = Math.cos((u * Math.PI) / 2); // 1 over the middle, 0 at the walls
      pos.setX(v, x);
      pos.setY(v, wallY + Math.max(0, floorY + apex - wallY) * t * t);
    }
    roofGeo.computeVertexNormals();
    const roof = new THREE.Mesh(roofGeo, this.caveRock);
    group.add(roof);

    // Icicles hang from the vault; glow crystals stud it. Both use the same
    // height rule as the roof so nothing floats.
    const roofY = (x: number, z: number, u: number): number => {
      const wallY = this.terrain.height(x, z);
      const floorY = this.terrain.height(this.terrain.centerX(z), z);
      const apex = 6 + 9 * this.terrain.caveAt(z);
      const t = Math.cos((u * Math.PI) / 2);
      return wallY + Math.max(0, floorY + apex - wallY) * t * t;
    };
    const deep = (z: number) => this.terrain.caveAt(z) > 0.25;
    for (let k = 0; k < 9; k++) {
      const z = zLo + rng() * len;
      if (!deep(z)) continue;
      const u = (rng() * 2 - 1) * 0.7;
      const x =
        this.terrain.centerX(z) + u * (this.terrain.channelHalfWidth(z) + RIBBON_WALL_MARGIN);
      const drop = 0.8 + rng() * 1.8;
      const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.18, drop, 5), this.crystal);
      icicle.rotation.x = Math.PI;
      icicle.position.set(x, roofY(x, z, u) - drop / 2 + 0.1, z);
      group.add(icicle);
    }
    for (let k = 0; k < 7; k++) {
      const z = zLo + rng() * len;
      if (!deep(z)) continue;
      const u = (rng() * 2 - 1) * 0.85;
      const x =
        this.terrain.centerX(z) + u * (this.terrain.channelHalfWidth(z) + RIBBON_WALL_MARGIN);
      const gem = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.3 + rng() * 0.35, 0),
        rng() < 0.6 ? this.caveGlowA : this.caveGlowB
      );
      gem.position.set(x, roofY(x, z, u) - 0.25, z);
      gem.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      group.add(gem);
    }

    // Runway studs: paired cyan lights every few meters along the floor
    // edges, the line to ride when the sky goes away.
    for (let z = Math.floor(zHi) - 2; z > zLo; z -= 5) {
      if (this.terrain.caveAt(z) === 0) continue;
      const half = this.terrain.channelHalfWidth(z) + 0.6;
      for (const side of [-1, 1]) {
        const x = this.terrain.centerX(z) + side * half;
        const stud = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), this.caveGlowA);
        stud.position.set(x, this.terrain.height(x, z) + 0.15, z);
        group.add(stud);
      }
    }
  }
}
