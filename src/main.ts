import * as THREE from 'three';
import { SIM_DT, Sim, createSim, distanceSkied, stepSim } from './sim/sim';
import { SkierInput } from './sim/skier';
import { setupInput } from './input';
import { createScene } from './render/scene';
import { ChunkRenderer } from './render/chunks';
import { createSkierView, updateSkierView } from './render/skierView';
import { createCamera, updateCamera } from './render/camera';

declare global {
  interface Window {
    __game: {
      readonly sim: Sim;
      readonly input: SkierInput; // as of the last rendered frame
      poll: () => SkierInput; // current input state, independent of the frame loop
    };
  }
}

// ?seed=N picks the mountain; a fixed default keeps runs comparable.
const seed = Number(new URLSearchParams(location.search).get('seed') ?? '1');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = createScene();
const camera = createCamera();
const skierView = createSkierView(scene);
const hud = document.getElementById('hud')!;
const overlay = document.getElementById('overlay')!;

let sim = createSim(seed);
let lastInput: SkierInput = { steer: 0, stance: 0 };
const chunkRenderer = new ChunkRenderer(scene, sim.terrain);
const getInput = setupInput(
  () => {
    sim = createSim(seed);
  },
  () => sim.skier.crashed
);

window.__game = {
  get sim() {
    return sim;
  },
  get input() {
    return lastInput;
  },
  poll: () => getInput(),
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

function frame(): void {
  const delta = Math.min(clock.getDelta(), 0.25);
  accumulator += delta;
  const input = getInput();
  lastInput = input;
  while (accumulator >= SIM_DT) {
    stepSim(sim, input);
    accumulator -= SIM_DT;
  }

  const skier = sim.skier;
  chunkRenderer.update(sim.terrain.chunkIndexAt(skier.z));
  updateSkierView(skierView, skier, sim.terrain, input, delta);
  updateCamera(camera, skier, sim.terrain, delta);

  hud.textContent = `${Math.round(skier.speed * 3.6)} km/h · ${Math.round(distanceSkied(sim))} m`;
  overlay.classList.toggle('visible', skier.crashed);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

frame();
