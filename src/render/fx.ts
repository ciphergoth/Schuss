import * as THREE from 'three';
import { Sim, SimEvent } from '../sim/sim';
import { SkierInput } from '../sim/skier';

// Visual celebration layer: snow spray, bursts, and the flow trail. Reads sim
// state and events; render-side randomness is fine (the sim never sees it).

const MAX_PARTICLES = 1000;
const HIDDEN_Y = -9999;
const SNOW_TINT = new THREE.Color(0xf2f7fd);

class Particles {
  private positions = new Float32Array(MAX_PARTICLES * 3);
  private colors = new Float32Array(MAX_PARTICLES * 3);
  private velocities = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private maxLife = new Float32Array(MAX_PARTICLES);
  private geometry = new THREE.BufferGeometry();
  private next = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = HIDDEN_Y;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const points = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({
        size: 0.17,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    points.frustumCulled = false; // positions update in place; skip stale-bounds culling
    scene.add(points);
  }

  spawn(
    origin: THREE.Vector3,
    baseVelocity: THREE.Vector3,
    spread: number,
    count: number,
    color: THREE.Color
  ): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      this.positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.3;
      this.positions[i * 3 + 1] = origin.y + Math.random() * 0.2;
      this.positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.3;
      this.velocities[i * 3] = baseVelocity.x + (Math.random() - 0.5) * spread;
      this.velocities[i * 3 + 1] = baseVelocity.y + Math.random() * spread;
      this.velocities[i * 3 + 2] = baseVelocity.z + (Math.random() - 0.5) * spread;
      this.life[i] = this.maxLife[i] = 0.45 + Math.random() * 0.4;
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
    }
  }

  liveCount(): number {
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  update(dt: number): void {
    // Typed-array reads at in-range indices are always numbers; the `!`s
    // paper over noUncheckedIndexedAccess, which can't know that.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const remaining = this.life[i]! - dt;
      if (this.life[i]! <= 0) continue;
      this.life[i] = remaining;
      if (remaining <= 0) {
        this.positions[i * 3 + 1] = HIDDEN_Y;
        continue;
      }
      const vy = this.velocities[i * 3 + 1]! - 7 * dt; // light gravity; snow floats
      this.velocities[i * 3 + 1] = vy;
      this.positions[i * 3] = this.positions[i * 3]! + this.velocities[i * 3]! * dt;
      this.positions[i * 3 + 1] = this.positions[i * 3 + 1]! + vy * dt;
      this.positions[i * 3 + 2] = this.positions[i * 3 + 2]! + this.velocities[i * 3 + 2]! * dt;
      // Fade by blending toward the snow tint as life runs out.
      const fade = (1 - remaining / this.maxLife[i]!) * dt * 6;
      this.colors[i * 3] = this.colors[i * 3]! + (SNOW_TINT.r - this.colors[i * 3]!) * fade;
      this.colors[i * 3 + 1] =
        this.colors[i * 3 + 1]! + (SNOW_TINT.g - this.colors[i * 3 + 1]!) * fade;
      this.colors[i * 3 + 2] =
        this.colors[i * 3 + 2]! + (SNOW_TINT.b - this.colors[i * 3 + 2]!) * fade;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
  }
}

// Ribbon of recent ski positions; cool blue normally, rainbow at high flow.
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

  rebuild(flow: number, time: number): void {
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
        // Rainbow earns its way in with flow; faint blue otherwise.
        const hue = (time * 90 + i * 4) % 360;
        color.setHSL(flow > 0.4 ? hue / 360 : 0.58, 0.35 + flow * 0.6, 0.72);
        this.colors[o] = color.r;
        this.colors[o + 1] = color.g;
        this.colors[o + 2] = color.b;
      }
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
  }
}

export class Effects {
  readonly particles: Particles;
  private trail: Trail;
  private white = new THREE.Color(0xffffff);
  private powder = new THREE.Color(0xe8f1fb);
  private gold = new THREE.Color(0xffd34d);
  private cyan = new THREE.Color(0x5df2ff);
  private flame = new THREE.Color(0xff7a2a);

  constructor(scene: THREE.Scene) {
    this.particles = new Particles(scene);
    this.trail = new Trail(scene);
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
      } else if (e.type === 'pickup') {
        this.particles.spawn(
          new THREE.Vector3(e.x, s.y + 1.1, e.z),
          new THREE.Vector3(0, e.gem ? 4 : 2.5, 0),
          e.gem ? 4 : 2.5,
          e.gem ? 40 : 12,
          e.gem ? this.cyan : this.gold
        );
      } else {
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

    // Burning boost: flame spray behind the skis and the rainbow trail.
    if (sim.boosting) {
      this.particles.spawn(
        new THREE.Vector3(s.x - dirX * 0.6, s.y + 0.15, s.z - dirZ * 0.6),
        new THREE.Vector3(-dirX * 6, 1.2, -dirZ * 6),
        2.2,
        6,
        this.flame
      );
    }

    if (grounded && s.speed > 4) this.trail.push(s.x, s.y, s.z, s.heading);
    this.trail.rebuild(sim.boosting ? 1 : 0, sim.time);
    this.particles.update(dt);
  }
}
