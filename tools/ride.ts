// REFERENCE RIDER: rides the designed course through the REAL sim with a
// simple autopilot and prints the storyboard — arrival time and speed at
// every feature, flight lengths off every lip, wall bounces, tumbles, gate
// passes, sector paces. Three riders:
//   cruiser  no buttons: the terrain's own pace
//   popper   charges to the human pop and releases at every designed lip
//   burner   full tank forever + pops: the worst-case (fastest) flights
// Run with `pnpm ride`.
import { GRAND_TOUR } from '../src/sim/design';
import { COURSE_LENGTH, Terrain } from '../src/sim/terrain';
import { SIM_DT, Sim, createSim, stepSim } from '../src/sim/sim';
import { SkierInput } from '../src/sim/skier';

type Profile = 'cruiser' | 'popper' | 'burner';

interface FlightLog {
  lipAt: number;
  kind: string;
  speedAtLip: number;
  airTime: number;
  length: number;
  landedAt: number;
}

function ride(profile: Profile): void {
  const sim: Sim = createSim(1, COURSE_LENGTH, GRAND_TOUR);
  const t: Terrain = sim.terrain;
  const lips = GRAND_TOUR.jumps.map((j) => j.at).sort((a, b) => a - b);
  let nextLip = 0;
  const flights: FlightLog[] = [];
  let airStartAt = 0;
  let airStartTime = 0;
  let wasAir = false;
  let bounces = 0;
  let tumbles = 0;
  let prevX = 0;
  const notes: string[] = [];

  for (let step = 0; step < 400 * 120; step++) {
    const s = sim.skier;
    const at = -s.z;
    if (profile === 'burner') sim.boost = 1; // an endless tank: worst case
    // Autopilot: chase the golden path; the heading-lag means this really
    // does steer the esses like a player would.
    const d = s.x - t.centerX(s.z);
    const err = t.planOffset(s.z) - d;
    const input: SkierInput = {
      steer: Math.max(-1, Math.min(1, err * 0.22)),
      stance: -0.5, // a working tuck
      boost: profile !== 'cruiser',
    };
    // Release the banked charge right at each designed lip.
    if (profile !== 'cruiser' && nextLip < lips.length && at >= lips[nextLip]! - 1) {
      input.jump = 1;
      nextLip++;
    }
    while (profile !== 'cruiser' && nextLip < lips.length && at > lips[nextLip]!) nextLip++;

    const preSpeed = s.speed;
    const preHeading = s.heading;
    const events = stepSim(sim, input);
    if (s.airTime > 0 && !wasAir) {
      airStartAt = at;
      airStartTime = sim.time;
    }
    if (wasAir && s.airTime === 0) {
      const lip = [...GRAND_TOUR.jumps]
        .reverse()
        .find((j) => airStartAt >= j.at - 3 && airStartAt < j.at + 8);
      if (lip && sim.time - airStartTime > 0.3) {
        flights.push({
          lipAt: lip.at,
          kind: lip.kind + (lip.pair ? `(${lip.pair})` : '') + (lip.hip ? '(hip)' : ''),
          speedAtLip: preSpeed,
          airTime: sim.time - airStartTime,
          length: -s.z - airStartAt,
          landedAt: -s.z,
        });
      }
    }
    wasAir = s.airTime > 0;
    // A carom flips the heading across the track line in one step.
    if (Math.abs(s.heading - preHeading) > 0.5 && s.tumbling === 0) bounces++;
    for (const e of events) {
      if (e.type === 'tumble') {
        tumbles++;
        notes.push(`  ! tumble at ${(-s.z).toFixed(0)}m t=${sim.time.toFixed(1)}s`);
      }
      if (e.type === 'sector')
        notes.push(`  sector @${(-s.z).toFixed(0)}m avg ${e.speed.toFixed(1)} m/s -> +${e.points}`);
      if (e.type === 'gate') notes.push(`  gate x${e.chain} at ${(-e.z).toFixed(0)}m`);
      if (e.type === 'finish') notes.push(`  FINISH t=${e.time.toFixed(1)}s`);
    }
    prevX = s.x;
    void prevX;
    if (sim.finishedAt !== null && -s.z > COURSE_LENGTH + 60) break;
  }

  console.log(`\n=== ${profile.toUpperCase()} ===`);
  console.log(
    `time ${(sim.finishedAt ?? -1).toFixed(1)}s  bounces ${bounces}  tumbles ${tumbles}  ` +
      `top ${flights.reduce((m, f) => Math.max(m, f.speedAtLip), 0).toFixed(1)} m/s at a lip`
  );
  console.log('flights:');
  for (const f of flights) {
    console.log(
      `  lip@${f.lipAt.toString().padStart(4)} ${f.kind.padEnd(11)} ` +
        `v=${f.speedAtLip.toFixed(1).padStart(5)}  air=${f.airTime.toFixed(2)}s  ` +
        `len=${f.length.toFixed(1).padStart(5)}m  lands@${f.landedAt.toFixed(0)}`
    );
  }
  for (const n of notes) console.log(n);
}

ride('cruiser');
ride('popper');
ride('burner');
