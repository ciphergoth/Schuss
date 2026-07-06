import { SkierInput, SkierState } from '../sim/skier';
import { mix } from './params';
import { Music } from './music';

interface AudioNodes {
  ctx: AudioContext;
  master: GainNode;
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  carveGain: GainNode;
  boostGain: GainNode;
  crudGain: GainNode;
  spinGain: GainNode; // mid-air rotation whoosh
  spinFilter: BiquadFilterNode;
  warnGain: GainNode; // tilt-envelope warning dyad
  warnOscs: [OscillatorNode, OscillatorNode];
  noise: AudioBuffer;
}

const MASTER_LEVEL = 0.6;

// All sound is synthesized: looped white noise shaped by filters for wind and
// edge scrape, oscillator + noise burst for the crash. No audio assets.
//
// Browsers only allow audio after a user gesture, so the graph is built on the
// first pointer/key event and re-resumed on later gestures if the context was
// suspended (synthetic events can construct a suspended context; only trusted
// input can unlock it).
export class GameAudio {
  private nodes: AudioNodes | null = null;
  private music: Music | null = null;
  private muted = false;
  private gamePaused = false;
  private wasTumbling = false;
  private prevSpin = 0;
  private prevFlip = 0;
  private lastZone = 0;

  constructor() {
    window.addEventListener('pointerdown', () => this.unlock());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggleMute();
      this.unlock();
    });
  }

  // The autoplay unlock must not defeat the game pause: without the guard,
  // any keypress or click resumed the context behind the pause screen
  // (including the Escape that paused it). Public because the drop-in tap
  // handler stops propagation (a panel tap is not game input), so it calls
  // this directly instead of relying on the window listener.
  unlock(): void {
    if (this.gamePaused) return;
    if (!this.nodes) this.nodes = this.build();
    else if (this.nodes.ctx.state === 'suspended') void this.nodes.ctx.resume();
  }

  get running(): boolean {
    return this.nodes !== null && this.nodes.ctx.state === 'running';
  }

  private build(): AudioNodes {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = MASTER_LEVEL;
    master.connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 150;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    source.connect(windFilter).connect(windGain).connect(master);

    const carveFilter = ctx.createBiquadFilter();
    carveFilter.type = 'bandpass';
    carveFilter.frequency.value = 2200;
    carveFilter.Q.value = 0.9;
    const carveGain = ctx.createGain();
    carveGain.gain.value = 0;
    source.connect(carveFilter).connect(carveGain).connect(master);

    // Boost rumble: the same noise squeezed into a low rocket-ish band.
    const boostFilter = ctx.createBiquadFilter();
    boostFilter.type = 'lowpass';
    boostFilter.frequency.value = 220;
    const boostGain = ctx.createGain();
    boostGain.gain.value = 0;
    source.connect(boostFilter).connect(boostGain).connect(master);

    // Crud grind: a rough low-mid band, clearly apart from the bright carve
    // hiss and the deep boost rumble.
    const crudFilter = ctx.createBiquadFilter();
    crudFilter.type = 'bandpass';
    crudFilter.frequency.value = 520;
    crudFilter.Q.value = 1.4;
    const crudGain = ctx.createGain();
    crudGain.gain.value = 0;
    source.connect(crudFilter).connect(crudGain).connect(master);

    // Rotation whoosh: an airy band that opens while a trick is actually
    // turning and climbs in pitch as rotation accumulates — the audible
    // tension of "bring it round or eat snow".
    const spinFilter = ctx.createBiquadFilter();
    spinFilter.type = 'bandpass';
    spinFilter.frequency.value = 700;
    spinFilter.Q.value = 2.5;
    const spinGain = ctx.createGain();
    spinGain.gain.value = 0;
    source.connect(spinFilter).connect(spinGain).connect(master);

    // Tilt-envelope warning: a detuned two-tone edge, silent in-envelope,
    // that fades in and sharpens as the phone tilts toward the pause
    // threshold — unmistakably "you're leaving the controls".
    const warnGain = ctx.createGain();
    warnGain.gain.value = 0;
    const warnA = ctx.createOscillator();
    warnA.type = 'triangle';
    warnA.frequency.value = 520;
    const warnB = ctx.createOscillator();
    warnB.type = 'triangle';
    warnB.frequency.value = 520 * 1.06; // a rough, beating detune
    warnA.connect(warnGain).connect(master);
    warnB.connect(warnGain);
    warnA.start();
    warnB.start();

    source.start();
    this.music = new Music(ctx, master, noise);
    return {
      ctx,
      master,
      windGain,
      windFilter,
      carveGain,
      boostGain,
      crudGain,
      spinGain,
      spinFilter,
      warnGain,
      warnOscs: [warnA, warnB],
      noise,
    };
  }

  // level 0 = inside the envelope (silent) .. 1 = at the pause threshold.
  setTiltWarning(level: number): void {
    if (!this.nodes) return;
    const { ctx, warnGain, warnOscs } = this.nodes;
    const t = ctx.currentTime;
    warnGain.gain.setTargetAtTime(level * 0.18, t, 0.06);
    const base = 520 + level * 340; // sharpens as the pause approaches
    warnOscs[0].frequency.setTargetAtTime(base, t, 0.06);
    warnOscs[1].frequency.setTargetAtTime(base * 1.06, t, 0.06);
  }

  update(state: SkierState, input: SkierInput, boosting = false, stickiness = 0, zone = 0): void {
    // Zone crossings are tracked even before the graph exists, so the first
    // chime doesn't fire late; everything else needs live nodes.
    if (zone !== this.lastZone) {
      const ascended = zone > this.lastZone;
      this.lastZone = zone;
      if (ascended) this.playZoneShift(zone);
    }
    if (!this.nodes) return;
    const { ctx, windGain, windFilter, carveGain, boostGain, crudGain, spinGain, spinFilter } =
      this.nodes;
    const t = ctx.currentTime;

    const tumbling = state.tumbling > 0;
    if (tumbling && !this.wasTumbling) this.playCrash();
    this.wasTumbling = tumbling;

    // Airborne skiers touch no snow: no crud grind mid-flight.
    const p = mix(state.speed, input.steer, input.stance, state.airTime > 0 ? 0 : stickiness);
    windGain.gain.setTargetAtTime(p.windGain, t, 0.08);
    windFilter.frequency.setTargetAtTime(p.windFreq, t, 0.08);
    carveGain.gain.setTargetAtTime(p.carveGain, t, 0.05);
    boostGain.gain.setTargetAtTime(boosting ? 0.4 : 0, t, 0.05);
    crudGain.gain.setTargetAtTime(p.crudGain, t, 0.04);

    // The soundtrack's energy is the run's energy: speed opens it up, boost
    // maxes it, a tumble drops it underwater.
    const pace = Math.min(1, state.speed / 32) * 0.75 + (boosting ? 0.25 : 0);
    this.music?.update(tumbling ? pace * 0.2 : pace);

    // The rotation whoosh opens only while rotation is actively accruing,
    // and its pitch climbs with the amount already turned.
    const rotating =
      state.airTime > 0 &&
      Math.abs(state.spin - this.prevSpin) + Math.abs(state.flip - this.prevFlip) > 1e-4;
    this.prevSpin = state.spin;
    this.prevFlip = state.flip;
    const turned = Math.abs(state.spin) + Math.abs(state.flip);
    spinGain.gain.setTargetAtTime(rotating ? 0.22 : 0, t, rotating ? 0.05 : 0.12);
    spinFilter.frequency.setTargetAtTime(Math.min(2400, 650 + turned * 170), t, 0.05);
    // (The armed star used to shimmer continuously here — it fought the
    // soundtrack like a second, out-of-time music box. The grab fanfare and
    // the HUD/trail carry the armed state now; the mix stays clean.)
  }

  private playCrash(): void {
    if (!this.nodes) return;
    const { ctx, master, noise } = this.nodes;
    const t = ctx.currentTime;

    // Muffled noise burst: the body hitting snow.
    const burst = ctx.createBufferSource();
    burst.buffer = noise;
    const burstFilter = ctx.createBiquadFilter();
    burstFilter.type = 'lowpass';
    burstFilter.frequency.value = 800;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(0.6, t);
    burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    burst.connect(burstFilter).connect(burstGain).connect(master);
    burst.start(t);
    burst.stop(t + 0.45);

    // Pitch-dropping thud underneath it.
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(140, t);
    thud.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.5, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    thud.connect(thudGain).connect(master);
    thud.start(t);
    thud.stop(t + 0.35);
  }

  // Near-miss: a rising whoosh as the tree whips past.
  playWhoosh(): void {
    if (!this.nodes) return;
    const { ctx, master, noise } = this.nodes;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(2800, t + 0.22);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + 0.3);
  }

  // Landing after air time: a soft powder thump, bigger air = bigger thump.
  playThump(airTime: number): void {
    if (!this.nodes) return;
    const { ctx, master, noise } = this.nodes;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(0.5, 0.15 + airTime * 0.25), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + 0.2);
  }

  // Coin pickup: a bright two-note ding.
  playDing(): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const notes: readonly (readonly [number, number])[] = [
      [0, 880],
      [0.07, 1318],
    ];
    for (const [offset, freq] of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.18);
      osc.connect(gain).connect(master);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    }
  }

  // Race start: a crisp electronic timing beep. Three level tones on the
  // 3-2-1 counts, then a higher, longer tone on GO — the classic start
  // signal.
  playCountdown(go: boolean): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = go ? 1175 : 740; // GO a fifth up
    const gain = ctx.createGain();
    const dur = go ? 0.5 : 0.16;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(go ? 0.2 : 0.14, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Game pause: silence everything by suspending the context (also stops the
  // wind loop from burning CPU), resume picks up exactly where it left off.
  setPaused(paused: boolean): void {
    this.gamePaused = paused;
    if (!this.nodes) return;
    if (paused) void this.nodes.ctx.suspend();
    else void this.nodes.ctx.resume();
  }

  // Bonus star grabbed: a proper fanfare, grander for x5.
  playBonus(mult: number): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const notes = mult >= 5 ? [523, 659, 784, 1046, 1318] : [523, 659, 784, 1046];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.09, t + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.22);
      osc.connect(gain).connect(master);
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.24);
    });
  }

  // Sector pace paid out: a low-to-high sweep, a full fanfare for a jackpot.
  playSector(jackpot: boolean): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const notes = jackpot ? [392, 523, 659, 784, 1046] : [392, 523];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.07, t + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.25);
      osc.connect(gain).connect(master);
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.27);
    });
  }

  // Landed trick: an ascending arpeggio, one extra note for a full turn+, a
  // fifth for a mixed combo, and a glissando run on top when a star
  // multiplier cashed in (longer for x5).
  playTrick(turns: number, mult = 1, mixed = false): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const notes = turns >= 1 ? [660, 880, 1108, 1318] : [660, 880, 1108];
    if (mixed) notes.push(1661);
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, t + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.16);
      osc.connect(gain).connect(master);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.18);
    });
    if (mult >= 3) {
      const runStart = t + notes.length * 0.06 + 0.08;
      const steps = mult >= 5 ? 7 : 5;
      for (let k = 0; k < steps; k++) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 1318 * Math.pow(9 / 8, k);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.07, runStart + k * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, runStart + k * 0.05 + 0.14);
        osc.connect(gain).connect(master);
        osc.start(runStart + k * 0.05);
        osc.stop(runStart + k * 0.05 + 0.16);
      }
    }
  }

  // Firework volley: staggered booms (matching the fx layer's fuse rhythm)
  // with a pitch-dropping thud under each and crackle raining after.
  playFireworks(count: number, jackpot: boolean): void {
    if (!this.nodes) return;
    const { ctx, master, noise } = this.nodes;
    const now = ctx.currentTime;
    for (let n = 0; n < count; n++) {
      const t = now + 0.18 + n * 0.14 + Math.random() * 0.25;
      const boom = ctx.createBufferSource();
      boom.buffer = noise;
      const boomFilter = ctx.createBiquadFilter();
      boomFilter.type = 'lowpass';
      boomFilter.frequency.value = jackpot ? 520 : 420;
      const boomGain = ctx.createGain();
      boomGain.gain.setValueAtTime(jackpot ? 0.22 : 0.16, t);
      boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      boom.connect(boomFilter).connect(boomGain).connect(master);
      boom.start(t);
      boom.stop(t + 0.55);

      const thud = ctx.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(100, t);
      thud.frequency.exponentialRampToValueAtTime(38, t + 0.3);
      const thudGain = ctx.createGain();
      thudGain.gain.setValueAtTime(0.14, t);
      thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      thud.connect(thudGain).connect(master);
      thud.start(t);
      thud.stop(t + 0.4);

      const crackles = 5 + Math.floor(Math.random() * 4);
      for (let c = 0; c < crackles; c++) {
        const tick = t + 0.06 + Math.random() * 0.45;
        const crackle = ctx.createBufferSource();
        crackle.buffer = noise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2600;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.035, tick);
        g.gain.exponentialRampToValueAtTime(0.001, tick + 0.06);
        crackle.connect(hp).connect(g).connect(master);
        crackle.start(tick);
        crackle.stop(tick + 0.08);
      }
    }
  }

  // Crossing the FINISH: a proper victory fanfare — a rising major arpeggio
  // with a held top chord. The fireworks call in alongside (main fires
  // playFireworks separately, matching the fx barrage).
  playFinish(): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const run: readonly (readonly [number, number, number])[] = [
      [0, 523, 0.14],
      [0.12, 659, 0.14],
      [0.24, 784, 0.14],
      [0.36, 1046, 0.16],
    ];
    for (const [at, freq, level] of run) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level, t + at);
      gain.gain.exponentialRampToValueAtTime(0.001, t + at + 0.3);
      osc.connect(gain).connect(master);
      osc.start(t + at);
      osc.stop(t + at + 0.32);
    }
    // The held chord under the top note.
    for (const freq of [523, 659, 784]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t + 0.36);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
      osc.connect(gain).connect(master);
      osc.start(t + 0.36);
      osc.stop(t + 1.7);
    }
  }

  // Crossing into a new color world: a soft two-note swell, root rising
  // with the zone, felt more than heard.
  private playZoneShift(zone: number): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const roots = [523, 587, 659, 784];
    const root = roots[zone % roots.length]!;
    for (const [ratio, level] of [
      [1, 0.11],
      [1.5, 0.07],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = root * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 1.2);
    }
  }

  toggleMute(): void {
    if (!this.nodes) return;
    this.muted = !this.muted;
    this.nodes.master.gain.setTargetAtTime(
      this.muted ? 0 : MASTER_LEVEL,
      this.nodes.ctx.currentTime,
      0.02
    );
  }
}
