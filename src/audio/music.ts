// Background music, sequenced live in Web Audio — no audio assets, and the
// groove can react to the run in ways a recording can't: the lowpass opens
// with speed, hats and the lead arp earn their way in with pace, every kick
// sidechain-ducks the mix, and a tumble muffles the whole track.

const BPM = 126;
const STEP = 60 / BPM / 4; // sixteenth notes
const LOOKAHEAD = 0.3; // seconds of schedule kept ahead of the playhead
const BAR = 16;
const LOOP = BAR * 4; // four bars, one chord each

// Am — F — C — G in low Hz, with the chord tones the voices draw from.
interface Chord {
  root: number;
  third: number;
  fifth: number;
}
const chord = (root: number, third: number, fifth: number): Chord => ({ root, third, fifth });
const PROGRESSION: readonly Chord[] = [
  chord(55.0, 65.41, 82.41), // A minor
  chord(43.65, 55.0, 65.41), // F major
  chord(65.41, 82.41, 98.0), // C major
  chord(49.0, 61.74, 73.42), // G major
];

// One bar of bass in chord-tone land: which step fires, and the multiple of
// the root it plays. Sparse and syncopated; the octave jump is the hook.
const BASS_STEPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [3, 1],
  [6, 2],
  [8, 1],
  [11, 1.5],
  [14, 2],
];

export class Music {
  private filter: BiquadFilterNode;
  private duck: GainNode;
  private out: GainNode;
  private nextTime = 0;
  private step = 0;

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
    private noise: AudioBuffer
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.duck = ctx.createGain();
    this.out = ctx.createGain();
    this.out.gain.value = 0.16;
    this.filter.connect(this.duck).connect(this.out).connect(destination);
  }

  // Called every rendered frame; schedules anything due in the lookahead
  // window. intensity 0..1 is the run's energy (speed, boost); a tumble
  // passes a low value and the whole mix goes underwater.
  update(intensity: number): void {
    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(700 + 8300 * intensity * intensity, now, 0.25);
    if (this.nextTime < now - 0.5) {
      // First call, or the tab slept: don't machine-gun the backlog.
      this.nextTime = now + 0.05;
    }
    while (this.nextTime < now + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextTime, intensity);
      this.step = (this.step + 1) % LOOP;
      this.nextTime += STEP;
    }
  }

  private scheduleStep(step: number, t: number, intensity: number): void {
    const inBar = step % BAR;
    const chordNow = PROGRESSION[Math.floor(step / BAR)]!;

    if (inBar === 0) this.pad(t, chordNow);
    if (inBar % 4 === 0) this.kick(t);
    if (inBar === 4 || inBar === 12) this.clap(t);
    // Offbeat hats arrive at cruising pace, full sixteenths at race pace.
    if (intensity > 0.25 && inBar % 4 === 2) this.hat(t, 0.9);
    else if (intensity > 0.65 && inBar % 2 === 0) this.hat(t, 0.45);
    for (const [at, mult] of BASS_STEPS) {
      if (inBar === at) this.bass(t, chordNow.root * 2 * mult);
    }
    // The lead arp is the reward for real pace: chord tones climbing.
    if (intensity > 0.55 && inBar % 2 === 1) {
      const tones = [
        chordNow.root * 8,
        chordNow.third * 8,
        chordNow.fifth * 8,
        chordNow.third * 16,
      ];
      this.arp(t, tones[(step >> 1) % tones.length]!, Math.min(1, (intensity - 0.55) * 3));
    }
  }

  private kick(t: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(gain).connect(this.out); // kicks bypass the filter: always punchy
    osc.start(t);
    osc.stop(t + 0.26);
    // Sidechain: everything else breathes around the kick.
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(0.5, t);
    this.duck.gain.linearRampToValueAtTime(1, t + 0.16);
  }

  private clap(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(gain).connect(this.filter);
    src.start(t, Math.random());
    src.stop(t + 0.14);
  }

  private hat(t: number, vel: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.07 * vel, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(hp).connect(gain).connect(this.filter);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  private bass(t: number, freq: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.003, t + STEP * 1.6);
    osc.connect(gain).connect(this.filter);
    osc.start(t);
    osc.stop(t + STEP * 1.7);
  }

  private pad(t: number, c: Chord): void {
    const barLen = STEP * BAR;
    for (const freq of [c.root * 4, c.third * 4, c.fifth * 4]) {
      for (const detune of [-6, 6]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.028, t + 0.35);
        gain.gain.setValueAtTime(0.028, t + barLen - 0.25);
        gain.gain.exponentialRampToValueAtTime(0.001, t + barLen + 0.1);
        osc.connect(gain).connect(this.filter);
        osc.start(t);
        osc.stop(t + barLen + 0.15);
      }
    }
  }

  private arp(t: number, freq: number, vel: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.075 * vel, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(gain).connect(this.filter);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}
