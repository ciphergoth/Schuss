import { describe, expect, it } from 'vitest';
import { CHUNK_LENGTH, Terrain, jumpDrift } from './terrain';

// THE DRAINAGE GUARANTEE: everywhere a skier can stand, the floor drains
// downhill hard enough to restart them. The skier's only dead ends are
// rest points — spots where the fall-line slope can't beat snow friction
// (mu = 0.05) — because a stalled skier pivots to the fall line and
// gravity does the rest. A basin (the step-down scoop's old return leg,
// the old rollers' grade-cancelling backsides) is therefore a permanently
// stuck run: a fail state, which the design bans outright.
//
// KNOWN, INTENDED EXCEPTION: kicker ramp faces. A lip only launches
// because its exit slope nearly matches the grade (2*lip/ramp = 0.30-0.34
// against 0.35), so the last meters below every lip are necessarily
// sub-friction for a skier CRAWLING up them — pads are climbs you arrive
// at with speed. The pad footprint is exempted here and the exemption is
// logged in PHYSICS.md as an open item.
// 1.2x snow friction (0.05): a stopped skier always restarts, if slowly.
// The budget is real — grade 0.35 pays for rollers (~0.21), moguls
// (~0.04) and bank transitions (~0.04 at the capped arm), so demanding
// 2x friction would mean flattening the course's character instead.
const MIN_DRAIN = 0.06;

const onKickerPad = (terrain: Terrain, x: number, z: number): boolean => {
  const index = terrain.chunkIndexAt(z);
  const d = x - terrain.centerX(z);
  for (const i of [index, index - 1]) {
    const jump = terrain.jumpForChunk(i);
    if (!jump) continue;
    const q = z - jump.zLip;
    if (q < -2 || q > jump.rampLength + 2) continue;
    if (Math.abs(d - jump.xOffset - jumpDrift(jump, q)) < jump.halfWidth + 3) return true;
  }
  return false;
};

describe('the floor always drains', () => {
  it('no rest points on any lane, several courses deep (pads exempt)', () => {
    const restPoints: string[] = [];
    for (const seed of [1, 2, 3, 7]) {
      const terrain = new Terrain(seed, Infinity);
      for (let z = -CHUNK_LENGTH; z > -3300; z -= 1) {
        const center = terrain.centerX(z);
        const half = terrain.channelHalfWidth(z);
        // The golden-path lane runs straight through every kicker and
        // scoop; the fixed fractions cover the rest of the channel.
        const lanes = [
          center + terrain.planOffset(z),
          center - half * 0.8,
          center - half * 0.4,
          center,
          center + half * 0.4,
          center + half * 0.8,
        ];
        for (const x of lanes) {
          const [gx, gz] = terrain.gradient(x, z);
          if (Math.hypot(gx, gz) < MIN_DRAIN && !onKickerPad(terrain, x, z)) {
            restPoints.push(
              `seed ${seed} z=${z} x=${x.toFixed(1)} ` +
                `section=${terrain.sectionType(terrain.sectionIndexAt(z))} ` +
                `slope=${Math.hypot(gx, gz).toFixed(3)}`
            );
          }
        }
      }
    }
    expect(restPoints.slice(0, 12)).toEqual([]);
  });
});
