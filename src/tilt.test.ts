import { describe, expect, it } from 'vitest';
import {
  EDGE_START,
  FAR_TILT,
  tiltAxes,
  tiltDeviation,
  tiltZone,
  toScreen,
  trickFromDrag,
  upFromOrientation,
} from './tilt';

const DEG = Math.PI / 180;

// World-up in SCREEN coordinates for a phone twisted phi (right edge down
// positive) and tipped back theta from vertical (top edge toward the sky).
// Unambiguous physical parametrization — the frame the axes math lives in.
const upS = (twistDeg: number, tipBackDeg: number) => {
  const phi = twistDeg * DEG;
  const theta = tipBackDeg * DEG;
  return {
    x: -Math.cos(theta) * Math.sin(phi),
    y: Math.cos(theta) * Math.cos(phi),
    z: Math.sin(theta),
  };
};

// A landscape phone held comfortably: tipped back 40 degrees, no twist.
const HELD = upS(0, 40);

describe('orientation plumbing', () => {
  it('portrait upright reads as up along the screen top', () => {
    const up = toScreen(upFromOrientation(90, 0), 0);
    expect(up.y).toBeCloseTo(1, 6);
    expect(Math.abs(up.x)).toBeLessThan(1e-6);
  });

  it('both landscape holds map to up-toward-the-top in screen coords', () => {
    // Device turned counterclockwise (its x-axis at the screen top, angle
    // 90), tipped back 40 degrees: beta 0, gamma theta-90 puts world-up at
    // (cos40, 0, sin40) in device coords.
    const ccw = toScreen(upFromOrientation(0, -50), 90);
    // The opposite landscape (angle 270): device x-axis points at the
    // screen bottom, so the same physical hold is gamma 90-theta.
    const cw = toScreen(upFromOrientation(0, 50), 270);
    for (const up of [ccw, cw]) {
      expect(up.y).toBeGreaterThan(0.7); // mostly toward the screen top
      expect(Math.abs(up.x)).toBeLessThan(1e-6); // no twist
      expect(up.z).toBeCloseTo(Math.sin(40 * DEG), 6);
    }
  });
});

describe('tilt axes', () => {
  it('any resting attitude calibrates to neutral', () => {
    for (const [twist, tip] of [
      [0, 40],
      [5, 15],
      [-8, 70],
      [0, 0],
    ] as const) {
      const up = upS(twist, tip);
      const { steer, stance } = tiltAxes(up, up);
      expect(steer).toBe(0);
      expect(stance).toBe(0);
    }
  });

  it('small wobble stays inside the dead zone', () => {
    const { steer, stance } = tiltAxes(upS(1, 41), HELD);
    expect(steer).toBe(0);
    expect(stance).toBe(0);
  });

  it('tipping the top edge away is tuck; pulling it back is brake', () => {
    expect(tiltAxes(upS(0, 55), HELD).stance).toBeLessThan(0); // flatter = tuck
    expect(tiltAxes(upS(0, 25), HELD).stance).toBeGreaterThan(0); // upright = brake
  });

  it('right edge down steers right, saturating and antisymmetric', () => {
    const r = tiltAxes(upS(40, 40), HELD).steer;
    const l = tiltAxes(upS(-40, 40), HELD).steer;
    expect(r).toBe(1); // well past the range: saturated
    expect(l).toBeCloseTo(-r, 6);
  });

  it('a modest twist gives a partial, monotonic deflection', () => {
    const small = tiltAxes(upS(10, 40), HELD).steer;
    const large = tiltAxes(upS(22, 40), HELD).steer;
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(1);
    expect(large).toBeGreaterThan(small);
  });
});

describe('tilt envelope', () => {
  it('deviation is zero at the reference and grows with tilt', () => {
    expect(tiltDeviation(HELD, HELD)).toBeCloseTo(0, 6);
    const d1 = tiltDeviation(upS(15, 40), HELD);
    const d2 = tiltDeviation(upS(30, 40), HELD);
    expect(d2).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(0);
  });

  it('zones: in, edge with rising level, far', () => {
    expect(tiltZone(0).zone).toBe('in');
    expect(tiltZone(EDGE_START * 0.9).zone).toBe('in');
    const mid = tiltZone((EDGE_START + FAR_TILT) / 2);
    expect(mid.zone).toBe('edge');
    expect(mid.edgeLevel).toBeGreaterThan(0.3);
    expect(mid.edgeLevel).toBeLessThan(0.7);
    expect(tiltZone(FAR_TILT + 0.01).zone).toBe('far');
  });
});

describe('trick drag pad', () => {
  it('needs a real drag before anything fires', () => {
    expect(trickFromDrag(5, 5)).toEqual({ spin: 0, flip: 0 });
  });

  it('maps the four cardinals like single WASD keys', () => {
    expect(trickFromDrag(40, 3)).toEqual({ spin: 1, flip: 0 }); // D: spin right
    expect(trickFromDrag(-40, -3)).toEqual({ spin: -1, flip: 0 }); // A: spin left
    expect(trickFromDrag(3, -40)).toEqual({ spin: 0, flip: -1 }); // W: frontflip
    expect(trickFromDrag(3, 40)).toEqual({ spin: 0, flip: 1 }); // S: backflip
  });

  it('maps the four diagonals to spin+flip combos, like holding two keys', () => {
    expect(trickFromDrag(40, -40)).toEqual({ spin: 1, flip: -1 }); // D+W
    expect(trickFromDrag(-40, -40)).toEqual({ spin: -1, flip: -1 }); // A+W
    expect(trickFromDrag(40, 40)).toEqual({ spin: 1, flip: 1 }); // D+S
    expect(trickFromDrag(-40, 40)).toEqual({ spin: -1, flip: 1 }); // A+S
  });

  it('splits the cardinal and diagonal sectors at 22.5 degrees', () => {
    // Just inside the cardinal cone (~20 deg off horizontal): spin only.
    expect(trickFromDrag(50, 18)).toEqual({ spin: 1, flip: 0 });
    // Just past the boundary (~25 deg off horizontal): the flip engages too.
    expect(trickFromDrag(50, 24)).toEqual({ spin: 1, flip: 1 });
  });
});
