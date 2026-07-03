import * as THREE from 'three';
import { SIM_DT, Sim, SimEvent, createSim, distanceSkied, stepSim } from './sim/sim';
import { SkierInput } from './sim/skier';
import { setupInput } from './input';
import { createScene } from './render/scene';
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

const { scene, sun } = createScene();
const camera = createCamera();
const skierView = createSkierView(scene);
const fx = new Effects(scene);
const stats = document.getElementById('stats')!;
const boostFill = document.getElementById('flowfill') as HTMLElement;
const overlay = document.getElementById('overlay')!;
const pauseScreen = document.getElementById('pause')!;

let sim = createSim(seed);
let lastInput: SkierInput = { steer: 0, stance: 0 };
const chunkRenderer = new ChunkRenderer(scene, sim.terrain);
const input = setupInput(() => {
  sim = createSim(seed);
});

// Esc or ? pauses: the sim freezes, the cursor is yours, and the pause screen
// doubles as the key guide.
let paused = false;

function setPaused(next: boolean): void {
  paused = next;
  pauseScreen.classList.toggle('visible', paused);
  audio.setPaused(paused);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.key === '?') setPaused(!paused);
});

const audio = new GameAudio();

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
    else if (e.type === 'pickup') audio.playDing(e.gem);
  }

  // Keep the sun's shadow box centered on the skier.
  sun.position.set(skier.x + 40, skier.y + 24, skier.z - 12);
  sun.target.position.set(skier.x, skier.y, skier.z);

  audio.update(skier, lastInput, sim.boosting);

  // The run IS the score: speed and distance. The bar is the boost tank.
  stats.textContent = `${Math.round(skier.speed * 3.6)} km/h · ${Math.round(distanceSkied(sim))} m`;
  boostFill.style.width = `${sim.boost * 100}%`;
  boostFill.style.background = sim.boosting
    ? 'hsl(18, 100%, 58%)'
    : `hsl(${35 + sim.boost * 10}, 95%, 58%)`;
  overlay.classList.toggle('visible', skier.tumbling > 0);

  renderer.render(scene, camera);
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
