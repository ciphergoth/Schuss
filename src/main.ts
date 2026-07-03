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
const flowFill = document.getElementById('flowfill') as HTMLElement;
const overlay = document.getElementById('overlay')!;

let sim = createSim(seed);
let lastInput: SkierInput = { steer: 0, stance: 0 };
const chunkRenderer = new ChunkRenderer(scene, sim.terrain);
const getInput = setupInput(() => {
  sim = createSim(seed);
});

const audio = new GameAudio();

window.__game = {
  get sim() {
    return sim;
  },
  get input() {
    return lastInput;
  },
  poll: () => getInput(),
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
  lastInput = getInput();
  const skier = sim.skier;
  chunkRenderer.update(sim.terrain.chunkIndexAt(skier.z), sim.collected, sim.time);
  updateSkierView(skierView, skier, lastInput, delta);
  updateCamera(camera, skier, sim.terrain, delta, sim.flow);
  fx.update(sim, lastInput, delta, events);
  for (const e of events) {
    if (e.type === 'nearMiss') audio.playWhoosh();
    else if (e.type === 'landing') audio.playThump(e.airTime);
    else if (e.type === 'pickup') audio.playDing();
  }

  // Keep the sun's shadow box centered on the skier.
  sun.position.set(skier.x + 40, skier.y + 24, skier.z - 12);
  sun.target.position.set(skier.x, skier.y, skier.z);

  audio.update(skier, lastInput);

  stats.textContent = `${Math.round(skier.speed * 3.6)} km/h · ${Math.round(distanceSkied(sim))} m · ${sim.score} pts`;
  flowFill.style.width = `${sim.flow * 100}%`;
  flowFill.style.background = `hsl(${185 + sim.flow * 135}, 95%, 62%)`;
  overlay.classList.toggle('visible', skier.tumbling > 0);

  renderer.render(scene, camera);
}

window.__game.renderFrame = renderFrame;
window.__game.step = (seconds: number) => {
  for (let s = 0; s < seconds; s += SIM_DT) {
    renderFrame(SIM_DT, stepSim(sim, getInput()));
  }
};

function frame(): void {
  const delta = Math.min(clock.getDelta(), 0.25);
  accumulator += delta;
  const events: SimEvent[] = [];
  while (accumulator >= SIM_DT) {
    events.push(...stepSim(sim, getInput()));
    accumulator -= SIM_DT;
  }
  renderFrame(delta, events);
  requestAnimationFrame(frame);
}

frame();
