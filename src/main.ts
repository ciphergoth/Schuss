import * as THREE from 'three';
import { SIM_DT, Sim, SimEvent, createSim, distanceSkied, stepSim } from './sim/sim';
import { ContractDemand, SECTION_LENGTH } from './sim/terrain';
import { SkierInput } from './sim/skier';
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

// What each contract demand asks for, in banner language. Spins carry the
// same rotation arrows the trick banner uses, so left and right read apart.
const DEMAND_LABEL: Record<ContractDemand, string> = {
  spinL: 'SPIN ↺',
  spinR: 'SPIN ↻',
  front: 'FRONTFLIP',
  back: 'BACKFLIP',
  spin2: '720 SPIN',
  flip2: 'DOUBLE FLIP',
  mix: 'MIX TRICKS',
  parallel: 'SPIN + FLIP AT ONCE',
};

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
const timeText = document.getElementById('time')!;
const courseNum = document.getElementById('coursenum')!;
const progressEl = document.getElementById('progress')!;
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
const countdownEl = document.getElementById('countdown')!;

// A short-lived banner: live spin readout while airborne, result on landing.
let trickBannerUntil = 0;

// Scores are tuned to a build's physics and economy, so mixing bests across
// versions compares incomparable numbers. The git commit the app was built
// from (stamped in by vite.config.ts) is stored beside the scores; whenever
// it changes — i.e. a new version is pushed — every saved BEST is wiped and
// the fresh version recorded, so each deploy starts a clean ladder.
const VERSION_KEY = 'skigame-version';
function resetScoresOnNewVersion(): void {
  if (localStorage.getItem(VERSION_KEY) === __APP_VERSION__) return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith('skigame-best-')) localStorage.removeItem(key);
  }
  localStorage.setItem(VERSION_KEY, __APP_VERSION__);
}
resetScoresOnNewVersion();

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

// The progress bar has one segment per course section; each fills as you
// ski through it. Built from the terrain so it tracks the real length.
const segFills: HTMLElement[] = [];
for (let i = 0; i < Math.round(sim.terrain.courseLength / SECTION_LENGTH); i++) {
  const seg = document.createElement('div');
  seg.className = 'seg';
  const fill = document.createElement('i');
  seg.appendChild(fill);
  progressEl.appendChild(seg);
  segFills.push(fill);
}
// R doesn't restart outright anymore — it pauses onto a Y/N confirm, so a
// stray keypress can't throw away a run.
const input = setupInput(() => openConfirm());

// Esc or ? pauses: the sim freezes, the cursor is yours, and the pause screen
// doubles as the key guide.
let paused = false;
let confirming = false; // the R restart ask; a special flavor of paused
let pausedBeforeConfirm = false;

// Race start: when a run begins fresh (first drop-in, restart, next course),
// the sim is held at the gate for a 3-2-1-GO countdown; the clock (sim.time)
// only starts on GO. Armed at course start, consumed by the loop. A mid-run
// pause/resume is NOT a fresh start, so it gets no countdown.
let countdownArmed = true;
let countingDown = false;
let countdownLeft = 0; // seconds until GO
let countdownShown = -1; // last integer painted, so each new count beeps once

function showCount(text: string, go: boolean): void {
  countdownEl.textContent = text;
  countdownEl.classList.toggle('go', go);
  countdownEl.classList.add('visible');
  // Restart the pop animation for each new number.
  countdownEl.style.animation = 'none';
  void countdownEl.offsetWidth;
  countdownEl.style.animation = 'cd-pop 0.55s ease-out';
}

// Before the first drop-in the guide is a title screen: "Drop in" and
// "Restart" would do the exact same thing (there's no run yet), so it shows
// one plain "Start" button instead. Once a run has begun, later pauses get
// both.
let started = false;
const restartBtn = document.getElementById('restartbtn')!;
const resumeLabel = document.getElementById('resumelabel')!;
function updateStartButtons(): void {
  restartBtn.style.display = started ? '' : 'none';
  resumeLabel.textContent = started ? 'Drop in' : 'Start';
}
updateStartButtons();

function setPaused(next: boolean): void {
  // The guide opens as the title screen; once the player drops in, later
  // pauses are just pauses.
  if (paused && !next) {
    document.getElementById('pausetitle')!.textContent = 'Paused';
    started = true;
    updateStartButtons();
    // Unpausing calibrates tilt: however the phone is held right now
    // becomes neutral. Re-unpause any time to recalibrate.
    input.calibrateTilt();
    // Every touch route back into the run funnels through here — the plain
    // resume and the restart confirm's Yes alike — so re-enter fullscreen
    // from all of them, not just the first drop-in. (The drop-in also asks
    // synchronously below, since its unpause happens after an await.)
    tryFullscreen();
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
  countdownArmed = true; // every fresh course starts with a 3-2-1-GO
}

function closeConfirm(restart: boolean): void {
  confirming = false;
  confirmScreen.classList.remove('visible');
  if (restart) {
    startCourse(currentSeed);
    // Re-enter through the ONE door: a restart on touch must re-verify tilt,
    // never drop into an uncontrollable run just because tilt wasn't on.
    dropIntoRun();
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
  // On the ceremony panel, N rolls the next course — a dedicated key, so
  // fumbling the boost button (Space) as you cross the line can't skip ahead.
  if (e.code === 'KeyN' && finishScreen.classList.contains('visible')) {
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
// on the title screen is where we ask. The tilt IS the only touch control
// scheme — there is no finger-steering fallback — so if we can't get it, we
// show an error instead of dropping into an unsteerable run.
const tiltError = document.getElementById('tilterror')!;
let tiltOn = false; // tilt granted: thumb zones live, center tap pauses
async function enableTilt(): Promise<boolean> {
  const DOE = (window as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent as
    { requestPermission?: () => Promise<string> } | undefined;
  if (!DOE) return false; // no orientation sensor at all
  try {
    if (typeof DOE.requestPermission === 'function') {
      if ((await DOE.requestPermission()) !== 'granted') return false;
    }
    // Bind the listener HERE, inside the grant gesture — iOS is far more
    // reliable this way than binding at page load.
    input.startTiltListening();
    input.setTiltMode(true);
    tiltOn = true;
    return true;
  } catch {
    return false;
  }
}

// Go as immersive as the platform allows — a browser chrome bar is dead
// screen on a phone. Must be called in-gesture; failure just means the
// platform (iPhone Safari) doesn't do fullscreen, and that's fine. Touch
// only: a desktop window shouldn't seize the whole screen on resume, and
// there Esc both unpauses and exits fullscreen — they'd fight.
function tryFullscreen(): void {
  if (!document.body.classList.contains('touch')) return;
  if (document.fullscreenElement) return;
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
  if (request) void request.call(root).catch(() => {});
}

// Panel touches are UI — scrolling the guide, pressing its buttons —
// never game input: without this, tilt mode would grab them as trick-pad
// or charge touches, or (for a centered button like Next course) as the
// middle-band pause, so tapping the ceremony's buttons just paused the run.
// Every full-screen panel gets the same guard.
for (const panel of [pauseScreen, confirmScreen, finishScreen]) {
  panel.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') e.stopPropagation();
  });
}

// The touch way out of the pause screen is a real button, wired to CLICK,
// not pointerdown. Fullscreen and motion permission both need a user
// gesture — but requesting them mid-pointerdown, while the touch is still
// down, WEDGES Android Chrome's input: the fullscreen transition cancels
// the in-flight touch and the page stops receiving further pointer (and
// sensor) events, leaving a run where nothing but that first touch ever
// worked. click fires after pointerup, so the gesture is already complete
// — and it only fires on a real tap, never a mid-scroll swipe on the
// panel. If tilt can't be granted we surface the error and stay on the
// guide — there is no fallback to fall into.
// The single door into a run — used by Drop in AND Restart AND Next course.
// On touch a run REQUIRES live tilt: if it isn't on, run the enable-and-
// wait-for-a-reading flow, and if that fails, stay on the guide with the
// error. NEVER unpause a touch run with tilt off — that is the "slides
// straight, nothing responds, can't even pause" dead run (it needs only
// tiltMode/tiltOn false, which the score/pace still tick through). On
// desktop there is no tilt to wait for, so just unpause.
function dropIntoRun(): void {
  if (tiltOn || !document.body.classList.contains('touch')) {
    setPaused(false);
    audio.unlock();
    return;
  }
  tiltError.classList.remove('show');
  void enableTilt().then(async (ok) => {
    // Permission granted isn't enough: the sensor must actually stream.
    // Wait for a real reading; if none comes, show the error and stay on
    // the guide (its Drop-in button still works, a retry usually wakes it).
    if (ok && (await input.waitForTilt(1500))) {
      setPaused(false);
      audio.unlock();
    } else {
      input.setTiltMode(false);
      tiltOn = false;
      tiltError.classList.add('show');
    }
  });
}

document.getElementById('resumebtn')!.addEventListener('click', () => {
  tryFullscreen();
  dropIntoRun();
});
document.getElementById('restartbtn')!.addEventListener('click', () => {
  openConfirm();
});

// In tilt mode the thumbs own the screen edges, so the whole middle band
// is the pause button.
window.addEventListener('pointerdown', (e) => {
  if (!tiltOn || paused || confirming || e.pointerType === 'mouse') return;
  const frac = e.clientX / window.innerWidth;
  if (frac > THUMB_ZONE && frac < 1 - THUMB_ZONE) setPaused(true);
});
document.getElementById('confirmy')!.addEventListener('click', () => {
  closeConfirm(true);
});
document.getElementById('confirmn')!.addEventListener('click', () => {
  closeConfirm(false);
});
document.getElementById('nextcourse')!.addEventListener('click', () => {
  if (finishScreen.classList.contains('visible')) {
    tryFullscreen(); // the ceremony doesn't re-pause, so ask here directly
    startCourse(currentSeed + 1);
  }
});
// Retry on the ceremony: same as R — the Y/N confirm, then restart this seed.
document.getElementById('retrybtn')!.addEventListener('click', () => {
  openConfirm();
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
    } else if (e.type === 'contract') {
      // The grabbed star's deal, revealed at touchdown: what the next trick
      // must be for the multiplier to pay.
      showTrick(
        `NEXT TRICK: ${DEMAND_LABEL[e.demand]} — ×${e.mult}`,
        e.mult >= 5 ? '#ff3ddc' : '#ffd34d',
        1.6
      );
    } else if (e.type === 'trick') {
      // Praise ladder: VARIETY (>=2 different tricks in sequence, the big
      // scorer) is INCREDIBLE, a PARALLEL combo (spin & flip at once) is a
      // COMBO, big same-type tricks are OUTSTANDING, a single rotation is NICE.
      const combo = e.variety || e.parallel;
      audio.playTrick(e.spins + e.flips, e.mult, combo);
      // The showpieces get fireworks in the sky AND in the mix.
      if (e.mult >= 3) audio.playFireworks(e.mult, e.mult >= 5);
      else if (combo) audio.playFireworks(3, false);
      // Spell out the whole sequence in order, so a spin one way then the
      // other reads as the two tricks it was, not a squashed total. Spins
      // carry a rotation arrow so the two directions are distinct.
      const parts = e.segments.map((s) => {
        if (s.kind === 'spinL') return s.turns > 1 ? `${s.turns}× SPIN ↺` : 'SPIN ↺';
        if (s.kind === 'spinR') return s.turns > 1 ? `${s.turns}× SPIN ↻` : 'SPIN ↻';
        const name = s.kind === 'back' ? 'BACKFLIP' : 'FRONTFLIP';
        return s.turns > 1 ? `${s.turns}× ${name}` : name;
      });
      const big = e.spins >= 2 || e.flips >= 2;
      // Repeating your last trick demotes the praise: the judges are bored.
      const word = e.repeat
        ? 'AGAIN?'
        : e.variety
          ? 'INCREDIBLE!'
          : e.parallel
            ? 'COMBO!'
            : big
              ? 'OUTSTANDING!'
              : 'NICE!';
      const mult = e.mult > 1 ? ` ×${e.mult}` : '';
      // A missed contract dies quietly in gray — the trick still gets its
      // due, the star just didn't pay.
      const missed = e.contract === 'missed' ? ' · ★ MISSED' : '';
      const color =
        e.mult >= 5 ? '#ff3ddc' : e.mult >= 3 ? '#ffd34d' : e.repeat ? '#b9c4d6' : '#7dff8a';
      showTrick(
        `${parts.join(' + ')}${mult} — ${word} +${e.points.toLocaleString('en')}${missed}`,
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

  // The race clock top-left (mirrors the score ledger top-right), the
  // vertical bar on the left is the boost tank — SSX-style. The clock stops
  // at the line: show the locked finish time once crossed.
  const clock = sim.finishedAt ?? sim.time;
  const clockMin = Math.floor(clock / 60);
  timeText.textContent = `${clockMin}:${(clock - clockMin * 60).toFixed(2).padStart(5, '0')}`;
  courseNum.textContent = `COURSE ${currentSeed}`;
  // Segmented course progress under the score: a vertical stack that fills
  // completed segments fully, the current one partway, top-to-bottom.
  const scaled = Math.min(1, distanceSkied(sim) / sim.terrain.courseLength) * segFills.length;
  segFills.forEach((fill, i) => {
    fill.style.height = `${Math.max(0, Math.min(1, scaled - i)) * 100}%`;
  });

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
  // The armed contract glows under the score in its star's color until it
  // settles: the multiplier AND what the next trick has to be to earn it.
  multText.classList.toggle('visible', sim.contract !== null);
  if (sim.contract) {
    multText.textContent = `×${sim.contract.mult} ${DEMAND_LABEL[sim.contract.demand]}`;
    multText.style.color = sim.contract.mult >= 5 ? '#ff3ddc' : '#ffd34d';
  }
  boostFill.style.height = `${sim.boost * 100}%`;
  boostFill.style.background = sim.boosting
    ? 'hsl(18, 100%, 58%)'
    : `hsl(${35 + sim.boost * 10}, 95%, 58%)`;
  // The jump charge bar lives beside the tank and only exists while charge
  // is banked: gold through the lower (human) half, magenta through the
  // upper (superhuman, paid in boost) half, white-hot at full.
  const charge = sim.charge;
  chargeBar.classList.toggle('visible', charge > 0);
  if (charge > 0) {
    chargeFill.style.height = `${charge * 100}%`;
    chargeFill.style.background = charge >= 1 ? '#ffffff' : charge > 0.5 ? '#ff3ddc' : '#ffd34d';
  }
  overlay.classList.toggle('visible', skier.tumbling > 0);

  // Nothing is drawn DURING a trick — the skier's own rotation is the only
  // readout in the air, so it stays clean and legible. The result banner
  // (set by showTrick on landing) describes what you did, then clears.
  if (sim.time >= trickBannerUntil) {
    trickText.classList.remove('visible');
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
  // Race start: hold the sim at the gate and count 3-2-1-GO. The clock
  // (sim.time) doesn't advance until GO, so the timed run starts on GO.
  if (countdownArmed) {
    countdownArmed = false;
    countingDown = true;
    countdownLeft = 3;
    countdownShown = -1;
  }
  if (countingDown) {
    countdownLeft -= delta;
    if (countdownLeft > 0) {
      const n = Math.ceil(countdownLeft);
      if (n !== countdownShown) {
        countdownShown = n;
        showCount(String(n), false);
        audio.playCountdown(false);
      }
      accumulator = 0; // no sim time passes at the gate
      renderFrame(delta, []);
      requestAnimationFrame(frame);
      return;
    }
    // GO: release the run this frame, flash GO, start the clock.
    countingDown = false;
    showCount('GO!', true);
    audio.playCountdown(true);
    setTimeout(() => countdownEl.classList.remove('visible'), 700);
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

// ?debug: an on-device input readout for chasing the "controls go dead"
// bug. Driven by a TIMER, not the rAF loop, so it keeps reporting even if
// that loop wedges. The Δ columns are the tell: tilt the phone and `orient
// Δ` should climb; tap and `touch Δ` should climb. A Δ stuck at 0 while
// you're moving/tapping is the exact moment those events stop reaching the
// page — which tells us whether it's the sensor, the touch, or both.
if (new URLSearchParams(location.search).has('debug')) {
  // Bind the sensor now (not at grant) so the readout shows orientation
  // activity from the title screen — letting you tell "sensor never starts"
  // apart from "sensor stops after drop-in." (On iOS events still gate on
  // the permission grant; on Android they stream immediately.)
  input.startTiltListening();
  const dbg = document.createElement('div');
  dbg.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:50;pointer-events:none;' +
    'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;' +
    'color:#7dff8a;background:rgba(0,0,0,0.6);padding:6px 9px;border-radius:6px;';
  document.body.appendChild(dbg);
  const yn = (b: boolean) => (b ? 'Y' : 'N');
  let prevOrient = 0;
  let prevTouch = 0;
  setInterval(() => {
    const s = input.debugSnapshot();
    const dO = s.tiltEvents - prevOrient;
    prevOrient = s.tiltEvents;
    const dT = s.pointerEvents - prevTouch;
    prevTouch = s.pointerEvents;
    dbg.textContent = [
      `orient ${s.tiltEvents}  Δ${dO}   β${s.lastBeta?.toFixed(0) ?? '-'} γ${s.lastGamma?.toFixed(0) ?? '-'}`,
      `up ${yn(s.hasReading)}  ref ${yn(s.hasRef)}   steer ${s.steer.toFixed(2)} stance ${s.stance.toFixed(2)}`,
      `touch ${s.pointerEvents}  Δ${dT}`,
      `tiltMode ${yn(s.tiltMode)}  tiltOn ${yn(tiltOn)}  paused ${yn(paused)}`,
      `angle ${screen.orientation?.angle ?? '-'}  hidden ${yn(document.hidden)}  fs ${yn(!!document.fullscreenElement)}`,
    ].join('\n');
  }, 100);
}

frame();
