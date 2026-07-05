import * as THREE from 'three';
import { SIM_DT, Sim, SimEvent, createSim, distanceSkied, stepSim } from './sim/sim';
import { FLIP_TOLERANCE, SPIN_TOLERANCE, SkierInput } from './sim/skier';
import { setupInput } from './input';
import { FAR_HOLD_S, THUMB_ZONE, tiltZone } from './tilt';
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

// ?seed=N picks the starting course; finishing advances to seed+1, so
// course numbers are shareable ("try course 7").
let currentSeed = Number(new URLSearchParams(location.search).get('seed') ?? '1');

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
const finishScreen = document.getElementById('finish')!;
const finishStats = document.getElementById('finishstats')!;
const finishBest = document.getElementById('finishbest')!;
const trickText = document.getElementById('trick')!;
const padTricks = document.getElementById('padtricks')!;
const padBoost = document.getElementById('padboost')!;

// A short-lived banner: live spin readout while airborne, result on landing.
let trickBannerUntil = 0;

// Best score survives across runs and sessions, per course: every course
// has its own ladder.
const bestKey = () => `skigame-best-${currentSeed}`;
let best = Number(localStorage.getItem(bestKey()) ?? '0');
let bestAtCourseStart = best; // for the NEW BEST! call at the line
// The ceremony panel waits a beat after the line so the barrage lands first.
let finishPanelAt: number | null = null;

let sim = createSim(currentSeed);
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
  // The guide opens as the title screen; once the player drops in, later
  // pauses are just pauses.
  if (paused && !next) {
    document.getElementById('pausetitle')!.textContent = 'Paused';
    // Unpausing calibrates tilt: however the phone is held right now
    // becomes neutral. Re-unpause any time to recalibrate.
    input.calibrateTilt();
  }
  paused = next;
  if (paused) audio.setTiltWarning(0);
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

// Start a course fresh — the current one again, or the next seed up.
function startCourse(seed: number): void {
  currentSeed = seed;
  best = Number(localStorage.getItem(bestKey()) ?? '0');
  bestAtCourseStart = best;
  sim = createSim(currentSeed);
  chunkRenderer.setTerrain(sim.terrain);
  fx.reset();
  finishPanelAt = null;
  finishScreen.classList.remove('visible');
  trickBannerUntil = 0; // sim.time resets to 0; don't let a stale banner linger
  trickText.classList.remove('visible');
  input.resetActed();
}

function closeConfirm(restart: boolean): void {
  confirming = false;
  confirmScreen.classList.remove('visible');
  if (restart) {
    startCourse(currentSeed);
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
  // On the ceremony panel, Space rolls the next course.
  if (e.code === 'Space' && finishScreen.classList.contains('visible')) {
    startCourse(currentSeed + 1);
    return;
  }
  if (e.code === 'Escape' || e.key === '?') setPaused(!paused);
});

const audio = new GameAudio();

// The game opens paused: the key guide doubles as the title screen, and the
// run doesn't start rolling until the player is actually looking.
setPaused(true);

// ---- Touch & tilt ----------------------------------------------------
// On a phone the tilt IS the mouse (roll steers, pitch is stance) and the
// thumbs are the buttons. The body class switches the panels to their
// tappable variants.
if (navigator.maxTouchPoints > 0) document.body.classList.add('touch');

// iOS only grants motion access inside a user gesture, so the drop-in tap
// on the title screen is where we ask. Denial (or no sensor) leaves the
// legacy touch scheme: first finger steers, second snowplows.
let tiltAsked = false;
let tiltOn = false; // tilt granted: thumb zones live, center tap pauses
async function enableTilt(): Promise<void> {
  const DOE = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  try {
    if (typeof DOE.requestPermission === 'function') {
      if ((await DOE.requestPermission()) !== 'granted') return;
    }
    input.setTiltMode(true);
    tiltOn = true;
    document.body.classList.add('tilt'); // shows the thumb-zone chips
  } catch {
    // Permission prompt rejected or unavailable: stay on legacy touch.
  }
}

// Go as immersive as the platform allows — a browser chrome bar is dead
// screen on a phone. Must be called in-gesture; failure just means the
// platform (iPhone Safari) doesn't do fullscreen, and that's fine.
function tryFullscreen(): void {
  if (document.fullscreenElement) return;
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
  if (request) void request.call(root).catch(() => {});
}

pauseScreen.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return; // desktop resumes with Esc / ?
  // A panel tap is UI, not game input: without this, tilt mode would grab
  // the drop-in tap itself as a trick-pad or charge touch.
  e.stopPropagation();
  tryFullscreen();
  if (!tiltAsked) {
    tiltAsked = true;
    void enableTilt().finally(() => {
      setPaused(false);
      audio.unlock();
    });
  } else {
    setPaused(false);
    audio.unlock();
  }
});

// In tilt mode the thumbs own the screen edges, so the whole middle band
// is the pause button (the chip up top is its visible tip).
window.addEventListener('pointerdown', (e) => {
  if (!tiltOn || paused || confirming || e.pointerType === 'mouse') return;
  const frac = e.clientX / window.innerWidth;
  if (frac > THUMB_ZONE && frac < 1 - THUMB_ZONE) setPaused(true);
});

// A deliberate pause affordance for thumbs (besides tilting the phone flat).
document.getElementById('pausechip')!.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if (!paused && !confirming) setPaused(true);
});
document.getElementById('confirmy')!.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  closeConfirm(true);
});
document.getElementById('confirmn')!.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  closeConfirm(false);
});
document.getElementById('nextcourse')!.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  if (finishScreen.classList.contains('visible')) startCourse(currentSeed + 1);
});

// Tilting far outside the control envelope, sustained, pauses the game:
// putting the phone down IS the pause gesture. The warning dyad rises
// through the edge zone so the pause never comes as a surprise.
let farTiltFor = 0;

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
  // The sim owns the jump charge; inject it so the crouch pose and the
  // charge-ring fx read the real meter.
  lastInput = { ...input.peek(), charge: sim.charge };
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
      // Repeating your last trick demotes the praise: the judges are bored.
      const word = e.repeat ? 'AGAIN?' : mixed ? 'INCREDIBLE!' : big ? 'OUTSTANDING!' : 'NICE!';
      const mult = e.mult > 1 ? ` ×${e.mult}` : '';
      const color =
        e.mult >= 5 ? '#ff3ddc' : e.mult >= 3 ? '#ffd34d' : e.repeat ? '#b9c4d6' : '#7dff8a';
      showTrick(
        `${parts.join(' + ')}${mult} — ${word} +${e.points.toLocaleString('en')}`,
        color,
        1.4
      );
    } else if (e.type === 'finish') {
      audio.playFinish();
      audio.playFireworks(12, true);
      finishPanelAt = sim.time + 1.8; // let the barrage land first
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
    Math.floor(Math.max(0, -skier.z) / ZONE_LENGTH)
  );

  // Speed, distance and course top-left, the score ledger top-right, the
  // vertical bar on the left is the boost tank — SSX-style.
  stats.textContent = `${Math.round(skier.speed)} m/s · ${Math.round(distanceSkied(sim))} m · course ${currentSeed}`;

  // The ceremony: once the finish barrage has landed, raise the panel.
  const showFinish = finishPanelAt !== null && sim.time >= finishPanelAt && !confirming;
  if (showFinish && !finishScreen.classList.contains('visible')) {
    const t = sim.finishedAt ?? 0;
    const mins = Math.floor(t / 60);
    const secs = (t - mins * 60).toFixed(1).padStart(4, '0');
    finishStats.textContent = `SCORE ${sim.score.toLocaleString('en')} · TIME ${mins}:${secs}`;
    finishBest.textContent =
      sim.score > bestAtCourseStart && input.acted()
        ? 'NEW COURSE BEST!'
        : `COURSE BEST ${best.toLocaleString('en')}`;
  }
  finishScreen.classList.toggle('visible', showFinish);
  scoreText.textContent = sim.score.toLocaleString('en');
  // BEST is for runs actually played: an idle tab self-piloting downhill
  // (or debug pokes) never writes the persistent ledger.
  if (sim.score > best && input.acted()) {
    best = sim.score;
    localStorage.setItem(bestKey(), String(best));
  }
  bestText.textContent = best > 0 ? `BEST ${best.toLocaleString('en')}` : '';
  // The armed star glows under the score in its own color until touchdown.
  multText.classList.toggle('visible', sim.trickMult > 1);
  if (sim.trickMult > 1) {
    multText.textContent = `×${sim.trickMult}`;
    multText.style.color = sim.trickMult >= 5 ? '#ff3ddc' : '#ffd34d';
  }
  // The thumb-zone chips light up while their touch is live, so the
  // invisible controls answer back.
  padTricks.classList.toggle('active', !!lastInput.trickSpin || !!lastInput.trickFlip);
  padBoost.classList.toggle('active', !!lastInput.boost);
  boostFill.style.height = `${sim.boost * 100}%`;
  boostFill.style.background = sim.boosting
    ? 'hsl(18, 100%, 58%)'
    : `hsl(${35 + sim.boost * 10}, 95%, 58%)`;
  // The jump charge bar lives beside the tank and only exists while charge
  // is banked: gold through the human half, magenta past the marker
  // (superhuman, paid in boost), white-hot at full.
  const charge = sim.charge;
  chargeBar.classList.toggle('visible', charge > 0);
  if (charge > 0) {
    chargeFill.style.height = `${charge * 100}%`;
    chargeFill.style.background = charge >= 1 ? '#ffffff' : charge > 0.5 ? '#ff3ddc' : '#ffd34d';
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
  // The tilt envelope: warn through the edge zone, pause when far-out
  // holds for FAR_HOLD_S (a flick through doesn't count).
  const zone = tiltZone(input.tiltDeviation());
  audio.setTiltWarning(zone.zone === 'far' ? 1 : zone.edgeLevel);
  farTiltFor = zone.zone === 'far' ? farTiltFor + delta : 0;
  if (farTiltFor >= FAR_HOLD_S) {
    farTiltFor = 0;
    setPaused(true);
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
