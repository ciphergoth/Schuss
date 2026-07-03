// Pure mapping from skier state to synth parameters — kept separate from the
// Web Audio graph so it can be unit tested headless.

export interface MixParams {
  windGain: number; // 0..~0.6
  windFreq: number; // lowpass cutoff in Hz
  carveGain: number; // 0..0.4
}

export function mix(speed: number, steer: number, stance: number): MixParams {
  const s = Math.min(speed / 40, 1);
  const plow = Math.max(0, stance);
  const tuck = Math.max(0, -stance);
  return {
    // Quadratic so the wind stays out of the way at low speed, with a little
    // extra roar in a tuck.
    windGain: 0.45 * s * s * (1 + 0.3 * tuck),
    windFreq: 150 + 1800 * s,
    // Edge noise: audible when carving hard or snowplowing, scaled by speed.
    carveGain: Math.min(0.4, s * (0.3 * Math.abs(steer) + 0.5 * plow)),
  };
}
