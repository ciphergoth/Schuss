import * as THREE from 'three';
import { SIM_DT, Sim, createSim, distanceSkied, stepSim } from './sim/sim';
import { SkierInput } from './sim/skier';
import { setupInput } from './input';
import { createScene } from './render/scene';
import { ChunkRenderer } from './render/chunks';
import { createSkierView, updateSkierView } from './render/skierView';
import { createCamera, updateCamera } from './render/camera';
import { GameAudio } from './audio/engine';

declare global {
  interface Window {
    __game: {
      readonly sim: Sim;
      readonly input: SkierInput; // as of the last rendered frame
      poll: () => SkierInput; // current input state, independent of the frame loop
      renderFrame?: (delta: number) => void; // force one frame, even while rAF is paused
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
const hud = document.getElementById('hud')!;
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

function renderFrame(delta: number): void {
  lastInput = getInput();
  const skier = sim.skier;
  chunkRenderer.update(sim.terrain.chunkIndexAt(skier.z));
  updateSkierView(skierView, skier, sim.terrain, lastInput, delta);
  updateCamera(camera, skier, sim.terrain, delta);

  // Keep the sun's shadow box centered on the skier.
  const skierY = sim.terrain.height(skier.x, skier.z);
  sun.position.set(skier.x + 40, skierY + 24, skier.z - 12);
  sun.target.position.set(skier.x, skierY, skier.z);

  audio.update(skier, lastInput);

  hud.textContent = `${Math.round(skier.speed * 3.6)} km/h · ${Math.round(distanceSkied(sim))} m`;
  overlay.classList.toggle('visible', skier.tumbling > 0);

  renderer.render(scene, camera);
}

window.__game.renderFrame = renderFrame;

function frame(): void {
  const delta = Math.min(clock.getDelta(), 0.25);
  accumulator += delta;
  while (accumulator >= SIM_DT) {
    stepSim(sim, getInput());
    accumulator -= SIM_DT;
  }
  renderFrame(delta);
  requestAnimationFrame(frame);
}

frame();
