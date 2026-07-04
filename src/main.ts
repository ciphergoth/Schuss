import * as THREE from 'three';
import { SIM_DT, Sim, SimEvent, createSim, distanceSkied, stepSim } from './sim/sim';
import { FLIP_TOLERANCE, SPIN_TOLERANCE, SkierInput } from './sim/skier';
import { setupInput } from './input';
import { createScene } from './render/scene';
import { ZONE_LENGTH } from './render/palette';
import { ChunkRenderer } from './render/chunks';
import { createSkierView, updateSkierView } from './render/skierView';
import { createCamera, updateCamera } from './render/camera';
import { Effects } from './render/fx';
import { GameAudio } from './audio/engine';

declare global {
  interface Window {
    __game: {
      readonly sim: Sim;
      readonly input: SkierInput; // as of the last rendered frame
      poll: () => SkierInput; // current input state, independent of the frame loop
      renderFrame?: (delta: number, events?: SimEvent[]) => void; // force one frame while rAF is paused
      step?: (seconds: number) => void; // advance sim + render while rAF is paused
      readonly paused: boolean;
      readonly audio: GameAudio;
    };
  }
}

// ?seed=N picks the mountain; a fixed default keeps runs comparable.
const seed = Number(new URLSearchParams(location.search).get('seed') ?? '1');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const sceneSetup = createScene();
const { scene, sun } = sceneSetup;
const camera = createCamera();
const skierView = createSkierView(scene);
const fx = new Effects(scene);
const stats = document.getElementById('stats')!;
const scoreText = document.getElementById('score')!;
const bestText = document.getElementById('best')!;
const multText = document.getElementById('mult')!;
const boostFill = document.getElementById('boostfill') as HTMLElement;
const chargeBar = document.getElementById('chargebar')!;
const chargeFill = document.getElementById('chargefill') as HTMLElement;
const overlay = document.getElementById('overlay')!;
const pauseScreen = document.getElementById('pause')!;
const confirmScreen = document.getElementById('confirm')!;
const trickText = document.getElementById('trick')!;

// A short-lived banner: live spin readout while airborne, result on landing.
let trickBannerUntil = 0;

// Best score survives across runs and sessions.
const BEST_KEY = 'skigame-best';
let best = Number(localStorage.getItem(BEST_KEY) ?? '0');

let sim = createSim(seed);
let lastInput: SkierInput = { steer: 0, stance: 0 };
const chunkRenderer = new ChunkRenderer(scene, sim.terrain);
// R doesn't restart outright anymore — it pauses onto a Y/N confirm, so a
// stray keypress can't throw away a run.
const input = setupInput(() => openConfirm());

// Esc or ? pauses: the sim freezes, the cursor is yours, and the pause screen
// doubles as the key guide.
let paused = false;
let confirming = false; // the R restart ask; a special flavor of paused
let pausedBeforeConfirm = false;

function setPaused(next: boolean): void {
  paused = next;
  pauseScreen.classList.toggle('visible', paused && !confirming);
  audio.setPaused(paused);
}

function openConfirm(): void {
  if (confirming) return;
  confirming = true;
  pausedBeforeConfirm = paused;
  confirmScreen.classList.add('visible');
  pauseScreen.classList.remove('visible');
  if (!paused) setPaused(true);
}

function closeConfirm(restart: boolean): void {
  confirming = false;
  confirmScreen.classList.remove('visible');
  if (restart) {
    sim = createSim(seed);
    trickBannerUntil = 0; // sim.time resets to 0; don't let a stale banner linger
    trickText.classList.remove('visible');
    input.resetActed();
    setPaused(false);
  } else {
    // Back to wherever they came from: the run, or the pause guide.
    setPaused(pausedBeforeConfirm);
  }
}

window.addEventListener('keydown', (e) => {
  if (confirming) {
    if (e.code === 'KeyY') closeConfirm(true);
    else if (e.code === 'KeyN' || e.code === 'Escape') closeConfirm(false);
    return;
  }
  if (e.code === 'Escape' || e.key === '?') setPaused(!paused);
});

const audio = new GameAudio();

// The game opens paused: the key guide doubles as the title screen, and the
// run doesn't start rolling until the player is actually looking.
setPaused(true);

window.__game = {
  get sim() {
    return sim;
  },
  get input() {
    return lastInput;
  },
  poll: () => input.peek(),
  get paused() {
    return paused;
  },
  audio,
};

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// Fixed-timestep simulation under a variable-rate render loop: accumulate
// frame time and consume it in SIM_DT steps, clamped so a background tab
// doesn't fast-forward the run on return.
const clock = new THREE.Clock();
let accumulator = 0;

function renderFrame(delta: number, events: SimEvent[] = []): void {
  lastInput = input.peek();
  const skier = sim.skier;
  chunkRenderer.update(sim.terrain.chunkIndexAt(skier.z), sim.collected, sim.time);
  updateSkierView(skierView, skier, lastInput, delta);
  updateCamera(camera, skier, sim.terrain, delta, sim.boosting ? 1 : 0);
  fx.update(sim, lastInput, delta, events);
  for (const e of events) {
    if (e.type === 'nearMiss') audio.playWhoosh();
    else if (e.type === 'landing') audio.playThump(e.airTime);
    else if (e.type === 'pickup') audio.playDing();
    else if (e.type === 'bonus') {
      audio.playBonus(e.mult);
      showTrick(`×${e.mult}!`, e.mult >= 5 ? '#ff3ddc' : '#ffd34d', 0.9);
    } else if (e.type === 'trick') {
      // Praise ladder: INCREDIBLE is reserved for mixed combos; big
      // same-type tricks are OUTSTANDING; a single rotation is NICE.
      const mixed = e.spins >= 1 && e.flips >= 1;
      audio.playTrick(e.spins + e.flips, e.mult, mixed);
      // The showpieces get fireworks in the sky AND in the mix.
      if (e.mult >= 3) audio.playFireworks(e.mult, e.mult >= 5);
      else if (mixed) audio.playFireworks(3, false);
      const parts = [];
      if (e.spins >= 1) parts.push(`${e.spins * 360}°`);
      if (e.flips >= 1) {
        const name = e.flipBack ? 'BACKFLIP' : 'FRONTFLIP';
        parts.push(e.flips > 1 ? `${e.flips}x ${name}` : name);
      }
      const big = e.spins >= 2 || e.flips >= 2;
      const word = mixed ? 'INCREDIBLE!' : big ? 'OUTSTANDING!' : 'NICE!';
      const mult = e.mult > 1 ? ` ×${e.mult}` : '';
      const color = e.mult >= 5 ? '#ff3ddc' : e.mult >= 3 ? '#ffd34d' : '#7dff8a';
      showTrick(
        `${parts.join(' + ')}${mult} — ${word} +${e.points.toLocaleString('en')}`,
        color,
        1.4
      );
    } else if (e.type === 'sector') {
      // The pace grade: a fast sector is a jackpot, a slow one just a fact.
      if (e.points > 0) {
        audio.playSector(e.points >= 5000);
        audio.playFireworks(e.points >= 5000 ? 7 : 3, e.points >= 5000);
        showTrick(
          `SECTOR ${Math.round(e.speed)} m/s — +${e.points.toLocaleString('en')}`,
          e.points >= 5000 ? '#ffd34d' : '#9fd4ff',
          1.4
        );
      } else {
        showTrick(`SECTOR ${Math.round(e.speed)} m/s`, '#9fd4ff', 1.0);
      }
    } else if (e.type === 'tumble' && e.trick) {
      showTrick('SPUN OUT', '#ff6a5a', 1.0);
    }
  }

  // Keep the sun's shadow box centered on the skier.
  sun.position.set(skier.x + 40, skier.y + 24, skier.z - 12);
  sun.target.position.set(skier.x, skier.y, skier.z);

  // Cross-fade the sky/fog/light palette for this stretch of course and
  // keep the aurora waving overhead.
  sceneSetup.update(skier.x, skier.y, skier.z, sim.time);

  audio.update(
    skier,
    lastInput,
    sim.boosting,
    sim.terrain.stickinessAt(skier.x, skier.z),
    sim.trickMult,
    Math.floor(Math.max(0, -skier.z) / ZONE_LENGTH)
  );

  // Speed and distance top-left, the score ledger top-right, the vertical
  // bar on the left is the boost tank — SSX-style.
  stats.textContent = `${Math.round(skier.speed)} m/s · ${Math.round(distanceSkied(sim))} m`;
  scoreText.textContent = sim.score.toLocaleString('en');
  // BEST is for runs actually played: an idle tab self-piloting downhill
  // (or debug pokes) never writes the persistent ledger.
  if (sim.score > best && input.acted()) {
    best = sim.score;
    localStorage.setItem(BEST_KEY, String(best));
  }
  bestText.textContent = best > 0 ? `BEST ${best.toLocaleString('en')}` : '';
  // The armed star glows under the score in its own color until touchdown.
  multText.classList.toggle('visible', sim.trickMult > 1);
  if (sim.trickMult > 1) {
    multText.textContent = `×${sim.trickMult}`;
    multText.style.color = sim.trickMult >= 5 ? '#ff3ddc' : '#ffd34d';
  }
  boostFill.style.height = `${sim.boost * 100}%`;
  boostFill.style.background = sim.boosting
    ? 'hsl(18, 100%, 58%)'
    : `hsl(${35 + sim.boost * 10}, 95%, 58%)`;
  // The jump charge bar lives beside the tank and only exists while the
  // button is held: gold while filling, white when the pop is maxed.
  const charge = lastInput.charge ?? 0;
  chargeBar.classList.toggle('visible', charge > 0);
  if (charge > 0) {
    chargeFill.style.height = `${charge * 100}%`;
    chargeFill.style.background = charge >= 1 ? '#ffffff' : '#ffd34d';
  }
  overlay.classList.toggle('visible', skier.tumbling > 0);

  // Live rotation readout while airborne: spin and flip degrees, turning
  // green with a ✓ once every started rotation is lined up to land clean.
  // Result banners (set by showTrick) take priority while they last.
  if (sim.time >= trickBannerUntil) {
    const spinDeg = Math.round((Math.abs(skier.spin) * 180) / Math.PI);
    const flipDeg = Math.round((Math.abs(skier.flip) * 180) / Math.PI);
    if (skier.tumbling === 0 && (spinDeg >= 20 || flipDeg >= 20)) {
      const res = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      const clean =
        (spinDeg < 20 || res(skier.spin) < SPIN_TOLERANCE) &&
        (flipDeg < 20 || res(skier.flip) < FLIP_TOLERANCE);
      const committed = spinDeg >= 300 || flipDeg >= 300;
      const parts = [];
      if (spinDeg >= 20) parts.push(`${spinDeg}°`);
      if (flipDeg >= 20) parts.push(`flip ${flipDeg}°`);
      trickText.textContent = `${parts.join(' · ')}${clean && committed ? ' ✓' : ''}`;
      trickText.style.color = clean && committed ? '#7dff8a' : '#ffffff';
      trickText.classList.add('visible');
    } else {
      trickText.classList.remove('visible');
    }
  }

  renderer.render(scene, camera);
}

function showTrick(text: string, color: string, seconds: number): void {
  trickText.textContent = text;
  trickText.style.color = color;
  trickText.classList.add('visible');
  trickBannerUntil = sim.time + seconds;
}

window.__game.renderFrame = renderFrame;
window.__game.step = (seconds: number) => {
  for (let s = 0; s < seconds; s += SIM_DT) {
    renderFrame(SIM_DT, stepSim(sim, input.read()));
  }
};

function frame(): void {
  const delta = Math.min(clock.getDelta(), 0.25);
  if (paused) {
    // Keep drawing (resizes still work) but freeze the world; the clock keeps
    // draining so resuming doesn't fast-forward.
    accumulator = 0;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }
  accumulator += delta;
  const events: SimEvent[] = [];
  while (accumulator >= SIM_DT) {
    events.push(...stepSim(sim, input.read()));
    accumulator -= SIM_DT;
  }
  renderFrame(delta, events);
  requestAnimationFrame(frame);
}

frame();
