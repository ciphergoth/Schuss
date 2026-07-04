import * as THREE from 'three';
import { Sim, SimEvent } from '../sim/sim';
import { SkierInput } from '../sim/skier';

// Visual celebration layer: snow spray, bursts, fireworks, auras, and the
// flow trail. Reads sim state and events; render-side randomness is fine
// (the sim never sees it).

const HIDDEN_Y = -9999;
const SNOW_TINT = new THREE.Color(0xf2f7fd);
const BLACK = new THREE.Color(0x000000);
const NEON_PALETTE = [0x2ee6ff, 0xff3ddc, 0xffe14d, 0x7dff5a].map((c) => new THREE.Color(c));

// Soft round glow sprite, computed instead of drawn (no DOM, no assets):
// white with a smooth radial alpha falloff, so additive particles read as
// light, not confetti squares.
function glowTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - d, 2.2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true;
  return tex;
}

interface ParticleOptions {
  capacity: number;
  size: number;
  gravity: number;
  additive: boolean;
  fade: THREE.Color; // colors drift here as life runs out
  fadeRate?: number; // how eagerly (default 6); lower = holds color longer
  lifeScale?: number; // multiplies every spawned lifetime (default 1)
  sprite?: THREE.Texture; // soft glow map for light-like particles
}

class Particles {
  private positions: Float32Array;
  private colors: Float32Array;
  private velocities: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private geometry = new THREE.BufferGeometry();
  private next = 0;

  constructor(
    scene: THREE.Scene,
    private opts: ParticleOptions
  ) {
    const n = opts.capacity;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = HIDDEN_Y;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const points = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({
        size: opts.size,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        map: opts.sprite ?? null,
      })
    );
    points.frustumCulled = false; // positions update in place; skip stale-bounds culling
    scene.add(points);
  }

  private write(i: number, px: number, py: number, pz: number, v: THREE.Vector3): void {
    this.positions[i * 3] = px;
    this.positions[i * 3 + 1] = py;
    this.positions[i * 3 + 2] = pz;
    this.velocities[i * 3] = v.x;
    this.velocities[i * 3 + 1] = v.y;
    this.velocities[i * 3 + 2] = v.z;
  }

  private stamp(i: number, color: THREE.Color, life: number): void {
    this.life[i] = this.maxLife[i] = life * (this.opts.lifeScale ?? 1);
    this.colors[i * 3] = color.r;
    this.colors[i * 3 + 1] = color.g;
    this.colors[i * 3 + 2] = color.b;
  }

  spawn(
    origin: THREE.Vector3,
    baseVelocity: THREE.Vector3,
    spread: number,
    count: number,
    color: THREE.Color
  ): void {
    const v = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.opts.capacity;
      v.set(
        baseVelocity.x + (Math.random() - 0.5) * spread,
        baseVelocity.y + Math.random() * spread,
        baseVelocity.z + (Math.random() - 0.5) * spread
      );
      this.write(
        i,
        origin.x + (Math.random() - 0.5) * 0.3,
        origin.y + Math.random() * 0.2,
        origin.z + (Math.random() - 0.5) * 0.3,
        v
      );
      this.stamp(i, color, 0.45 + Math.random() * 0.4);
    }
  }

  // Spherical shell explosion — the firework shape.
  burst(origin: THREE.Vector3, speed: number, count: number, color: THREE.Color): void {
    const v = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.opts.capacity;
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.55 + Math.random() * 0.45));
      this.write(i, origin.x, origin.y, origin.z, v);
      this.stamp(i, color, 0.8 + Math.random() * 0.7);
    }
  }

  // Horizontal shockwave ring, expanding outward.
  ring(origin: THREE.Vector3, speed: number, count: number, color: THREE.Color): void {
    const v = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.opts.capacity;
      const a = (n / count) * Math.PI * 2;
      v.set(Math.cos(a) * speed, 1.2, Math.sin(a) * speed);
      this.write(i, origin.x, origin.y, origin.z, v);
      this.stamp(i, color, 0.6 + Math.random() * 0.3);
    }
  }

  liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.opts.capacity; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  update(dt: number): void {
    // Typed-array reads at in-range indices are always numbers; the `!`s
    // paper over noUncheckedIndexedAccess, which can't know that.
    const fade = this.opts.fade;
    for (let i = 0; i < this.opts.capacity; i++) {
      const remaining = this.life[i]! - dt;
      if (this.life[i]! <= 0) continue;
      this.life[i] = remaining;
      if (remaining <= 0) {
        this.positions[i * 3 + 1] = HIDDEN_Y;
        continue;
      }
      const vy = this.velocities[i * 3 + 1]! - this.opts.gravity * dt;
      this.velocities[i * 3 + 1] = vy;
      this.positions[i * 3] = this.positions[i * 3]! + this.velocities[i * 3]! * dt;
      this.positions[i * 3 + 1] = this.positions[i * 3 + 1]! + vy * dt;
      this.positions[i * 3 + 2] = this.positions[i * 3 + 2]! + this.velocities[i * 3 + 2]! * dt;
      // Fade by blending toward the fade color as life runs out (snow tint
      // for powder; black for additive sparks, which reads as dimming).
      const k = (1 - remaining / this.maxLife[i]!) * dt * (this.opts.fadeRate ?? 6);
      this.colors[i * 3] = this.colors[i * 3]! + (fade.r - this.colors[i * 3]!) * k;
      this.colors[i * 3 + 1] = this.colors[i * 3 + 1]! + (fade.g - this.colors[i * 3 + 1]!) * k;
      this.colors[i * 3 + 2] = this.colors[i * 3 + 2]! + (fade.b - this.colors[i * 3 + 2]!) * k;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
  }
}

// Ribbon of recent ski positions; cool blue normally, star-colored while a
// multiplier is armed, full rainbow while burning boost.
const TRAIL_POINTS = 140;
const TRAIL_WIDTH = 0.55;

class Trail {
  private centers: { x: number; y: number; z: number; px: number; pz: number }[] = [];
  private positions = new Float32Array(TRAIL_POINTS * 2 * 3);
  private colors = new Float32Array(TRAIL_POINTS * 2 * 3);
  private geometry = new THREE.BufferGeometry();

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const indices: number[] = [];
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(indices);
    const mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  push(x: number, y: number, z: number, heading: number): void {
    this.centers.push({ x, y, z, px: Math.cos(heading), pz: Math.sin(heading) });
    if (this.centers.length > TRAIL_POINTS) this.centers.shift();
  }

  rebuild(flow: number, time: number, armed: number): void {
    const color = new THREE.Color();
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const c = this.centers[Math.min(i, this.centers.length - 1)] ?? {
        x: 0,
        y: HIDDEN_Y,
        z: 0,
        px: 1,
        pz: 0,
      };
      const w = (TRAIL_WIDTH / 2) * (i / TRAIL_POINTS); // tapers toward the tail
      for (const side of [0, 1]) {
        const s = side === 0 ? -1 : 1;
        const o = (i * 2 + side) * 3;
        this.positions[o] = c.x + c.px * w * s;
        this.positions[o + 1] = c.y + 0.06;
        this.positions[o + 2] = c.z + c.pz * w * s;
        // Rainbow earns its way in with boost; an armed star dyes the trail
        // its own color; faint blue otherwise.
        if (flow > 0.4) {
          const hue = (time * 90 + i * 4) % 360;
          color.setHSL(hue / 360, 0.35 + flow * 0.6, 0.72);
        } else if (armed >= 3) {
          const pulse = 0.62 + 0.12 * Math.sin(time * 6 + i * 0.3);
          color.setHSL(armed >= 5 ? 0.88 : 0.12, 0.95, pulse);
        } else {
          color.setHSL(0.58, 0.35, 0.72);
        }
        this.colors[o] = color.r;
        this.colors[o + 1] = color.g;
        this.colors[o + 2] = color.b;
      }
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
  }
}

// A scheduled sky burst: fireworks are just bursts with a fuse.
interface Shell {
  delay: number;
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
  size: number; // burst particle count
}

const MAX_SHELLS = 48;

export class Effects {
  readonly particles: Particles; // powder: snow spray, landings, tumbles
  readonly sparks: Particles; // additive glitter close to the skier
  readonly pyro: Particles; // fireworks: big additive sprites, sky-sized
  private trail: Trail;
  private shells: Shell[] = [];
  private white = new THREE.Color(0xffffff);
  private powder = new THREE.Color(0xe8f1fb);
  private gold = new THREE.Color(0xffd34d);
  private cyan = new THREE.Color(0x5df2ff);
  private flame = new THREE.Color(0xff7a2a);
  private magenta = new THREE.Color(0xff3ddc);
  private scratch = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const glow = glowTexture();
    this.particles = new Particles(scene, {
      capacity: 1000,
      size: 0.17,
      gravity: 7,
      additive: false,
      fade: SNOW_TINT,
    });
    this.sparks = new Particles(scene, {
      capacity: 900,
      size: 0.4,
      gravity: 2.2,
      additive: true,
      fade: BLACK,
      sprite: glow,
    });
    // Fireworks bloom 30-90m away: the sprites must be house-window sized
    // up close to survive perspective at that range.
    this.pyro = new Particles(scene, {
      capacity: 1600,
      size: 1.5,
      gravity: 2.6,
      additive: true,
      fade: BLACK,
      fadeRate: 3.2, // blooms hold their color, then dim out
      lifeScale: 1.6,
      sprite: glow,
    });
    this.trail = new Trail(scene);
  }

  // Queue a volley of firework shells over the track around z, colored from
  // `colors`, biggest celebration first on screen (short fuses up close).
  private volley(
    sim: Sim,
    count: number,
    colors: readonly THREE.Color[],
    grandeur: number // 1 = polite, 2+ = jackpot
  ): void {
    const s = sim.skier;
    for (let n = 0; n < count && this.shells.length < MAX_SHELLS; n++) {
      const z = s.z - 25 - Math.random() * 55;
      const cX = sim.terrain.centerX(z);
      const half = sim.terrain.channelHalfWidth(z);
      const side = n % 2 === 0 ? -1 : 1;
      this.shells.push({
        delay: 0.15 + n * 0.14 + Math.random() * 0.25,
        x: cX + side * (half * (0.4 + Math.random() * 0.9)),
        y: s.y + 10 + Math.random() * 10 + grandeur * 4,
        z,
        color: colors[n % colors.length]!,
        size: Math.round(50 + grandeur * 25 + Math.random() * 20),
      });
    }
  }

  update(sim: Sim, input: SkierInput, dt: number, events: SimEvent[]): void {
    const s = sim.skier;
    const dirX = Math.sin(s.heading);
    const dirZ = -Math.cos(s.heading);
    const skierPos = new THREE.Vector3(s.x, s.y, s.z);
    const grounded = s.airTime === 0 && s.tumbling === 0;

    // Carve/plow spray from the skis, thrown to the outside of the turn.
    const intensity = grounded
      ? Math.min(1, (Math.abs(input.steer) * 0.8 + Math.max(0, input.stance)) * (s.speed / 25))
      : 0;
    if (intensity > 0.12) {
      const out = -Math.sign(input.steer || 1);
      this.particles.spawn(
        new THREE.Vector3(s.x - dirX * 0.4, s.y + 0.1, s.z - dirZ * 0.4),
        new THREE.Vector3(
          Math.cos(s.heading) * out * (2 + 3 * intensity) - dirX * 2,
          1.5 + 2.5 * intensity,
          Math.sin(s.heading) * out * (2 + 3 * intensity) - dirZ * 2
        ),
        2.5,
        Math.round(1 + 7 * intensity),
        this.powder
      );
    }

    for (const e of events) {
      if (e.type === 'tumble') {
        this.particles.spawn(
          skierPos,
          new THREE.Vector3(-dirX * 3, 3.5, -dirZ * 3),
          5,
          70,
          this.white
        );
      } else if (e.type === 'landing') {
        this.particles.spawn(
          skierPos,
          new THREE.Vector3(0, 2, 0),
          4,
          Math.min(60, Math.round(e.airTime * 45)),
          this.powder
        );
      } else if (e.type === 'trick') {
        // Landed trick: a two-tone burst at the skis, and for the showpieces
        // a firework volley in the sky ahead — star-colored when a
        // multiplier cashed in, rainbow for a mixed combo.
        const count = Math.min(70, Math.round((e.spins + e.flips) * 45));
        this.particles.spawn(skierPos, new THREE.Vector3(0, 4.5, 0), 5, count, this.gold);
        this.particles.spawn(skierPos, new THREE.Vector3(0, 3.5, 0), 4, count, this.cyan);
        const mixed = e.spins >= 1 && e.flips >= 1;
        if (e.mult >= 3) {
          const star = e.mult >= 5 ? this.magenta : this.gold;
          this.volley(sim, e.mult, [star, this.white], e.mult >= 5 ? 2.5 : 1.5);
        } else if (mixed) {
          this.volley(sim, 3, NEON_PALETTE, 1.5);
        }
      } else if (e.type === 'sector') {
        // The pace grade pays in the sky too: a polite pair for any paid
        // sector, a full barrage for a jackpot.
        if (e.points >= 5000) this.volley(sim, 7, NEON_PALETTE, 2.5);
        else if (e.points > 0) this.volley(sim, 3, NEON_PALETTE, 1);
      } else if (e.type === 'pickup') {
        this.particles.spawn(
          new THREE.Vector3(e.x, s.y + 1.1, e.z),
          new THREE.Vector3(0, 2.5, 0),
          2.5,
          12,
          this.gold
        );
        this.sparks.burst(new THREE.Vector3(e.x, s.y + 1.1, e.z), 3, 8, this.gold);
      } else if (e.type === 'bonus') {
        // A star grab: shockwave ring plus a burst worthy of it, bigger and
        // pinker for x5.
        const big = e.mult >= 5;
        const at = new THREE.Vector3(e.x, s.y + 1.2, e.z);
        const color = big ? this.magenta : this.gold;
        this.particles.spawn(at, new THREE.Vector3(0, big ? 5 : 4, 0), big ? 6 : 4.5, 30, color);
        this.sparks.burst(at, big ? 9 : 7, big ? 70 : 45, color);
        this.sparks.ring(at, big ? 14 : 10, 28, this.white);
      } else if (e.type === 'nearMiss') {
        // Near-miss: a puff plucked off the obstacle you grazed.
        this.particles.spawn(
          new THREE.Vector3(e.x, s.y + 1.2, e.z),
          new THREE.Vector3(dirX * 2, 1.5, dirZ * 2),
          2,
          14,
          this.white
        );
      }
    }

    // Fireworks: shells wait out their fuses, then bloom (color shell plus a
    // white-hot core).
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i]!;
      shell.delay -= dt;
      if (shell.delay > 0) continue;
      const at = new THREE.Vector3(shell.x, shell.y, shell.z);
      this.pyro.burst(at, 13, shell.size, shell.color);
      this.pyro.burst(at, 5, Math.round(shell.size / 4), this.white);
      this.shells.splice(i, 1);
    }

    // An armed star orbits the skier as a ring of sparkles — you carry the
    // multiplier visibly until a trick spends it.
    if (sim.trickMult > 1) {
      const color = sim.trickMult >= 5 ? this.magenta : this.gold;
      for (let k = 0; k < 2; k++) {
        const a = sim.time * 7 + k * Math.PI;
        this.sparks.spawn(
          new THREE.Vector3(
            s.x + Math.cos(a) * 0.9,
            s.y + 1.1 + Math.sin(a * 0.7) * 0.4,
            s.z + Math.sin(a) * 0.9
          ),
          new THREE.Vector3(0, 0.8, 0),
          0.4,
          1,
          color
        );
      }
    }

    // Mid-air rotation is a comet: hue-cycling glitter streams off the skier
    // while a trick is actually turning.
    if (s.airTime > 0 && (Math.abs(s.spin) > 0.25 || Math.abs(s.flip) > 0.25)) {
      const hue = (sim.time * 1.4 + (Math.abs(s.spin) + Math.abs(s.flip)) * 0.18) % 1;
      this.scratch.setHSL(hue, 0.95, 0.62);
      this.sparks.spawn(
        new THREE.Vector3(s.x, s.y + 0.9, s.z),
        new THREE.Vector3(-dirX * 2, 0.4, -dirZ * 2),
        2.4,
        3,
        this.scratch
      );
    }

    // Burning boost: flame spray plus a rainbow shimmer behind the skis.
    if (sim.boosting) {
      this.particles.spawn(
        new THREE.Vector3(s.x - dirX * 0.6, s.y + 0.15, s.z - dirZ * 0.6),
        new THREE.Vector3(-dirX * 6, 1.2, -dirZ * 6),
        2.2,
        6,
        this.flame
      );
      this.scratch.setHSL((sim.time * 1.6) % 1, 1, 0.6);
      this.sparks.spawn(
        new THREE.Vector3(s.x - dirX * 0.8, s.y + 0.3, s.z - dirZ * 0.8),
        new THREE.Vector3(-dirX * 7, 1.6, -dirZ * 7),
        2.5,
        2,
        this.scratch
      );
    }

    // Top-speed wind: faint streamers whipping past at race pace.
    if (grounded && s.speed > 26) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.particles.spawn(
        new THREE.Vector3(
          s.x + Math.cos(s.heading) * side * 2.2,
          s.y + 1 + Math.random() * 1.5,
          s.z
        ),
        new THREE.Vector3(-dirX * (s.speed * 0.7), 0, -dirZ * (s.speed * 0.7)),
        1.5,
        1,
        this.powder
      );
    }

    if (grounded && s.speed > 4) this.trail.push(s.x, s.y, s.z, s.heading);
    this.trail.rebuild(sim.boosting ? 1 : 0, sim.time, sim.trickMult);
    this.particles.update(dt);
    this.sparks.update(dt);
    this.pyro.update(dt);
  }
}
