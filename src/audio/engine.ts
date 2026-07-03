import { SkierInput, SkierState } from '../sim/skier';
import { mix } from './params';

interface AudioNodes {
  ctx: AudioContext;
  master: GainNode;
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  carveGain: GainNode;
  boostGain: GainNode;
  crudGain: GainNode;
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
  private muted = false;
  private gamePaused = false;
  private wasTumbling = false;

  constructor() {
    const unlock = () => {
      // The autoplay unlock must not defeat the game pause: without this
      // guard, any keypress or click resumed the context behind the pause
      // screen (including the Escape that paused it).
      if (this.gamePaused) return;
      if (!this.nodes) this.nodes = this.build();
      else if (this.nodes.ctx.state === 'suspended') void this.nodes.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggleMute();
      unlock();
    });
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

    source.start();
    return { ctx, master, windGain, windFilter, carveGain, boostGain, crudGain, noise };
  }

  update(state: SkierState, input: SkierInput, boosting = false, stickiness = 0): void {
    if (!this.nodes) return;
    const { ctx, windGain, windFilter, carveGain, boostGain, crudGain } = this.nodes;
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

  // Pickup: a bright two-note ding; gems get a triumphant third note.
  playDing(gem = false): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const notes: readonly (readonly [number, number])[] = gem
      ? [
          [0, 880],
          [0.07, 1318],
          [0.14, 1760],
        ]
      : [
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

  // Game pause: silence everything by suspending the context (also stops the
  // wind loop from burning CPU), resume picks up exactly where it left off.
  setPaused(paused: boolean): void {
    this.gamePaused = paused;
    if (!this.nodes) return;
    if (paused) void this.nodes.ctx.suspend();
    else void this.nodes.ctx.resume();
  }

  // Landed trick: an ascending arpeggio, one extra note for a full turn+.
  playTrick(turns: number): void {
    if (!this.nodes) return;
    const { ctx, master } = this.nodes;
    const t = ctx.currentTime;
    const notes = turns >= 1 ? [660, 880, 1108, 1318] : [660, 880, 1108];
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
