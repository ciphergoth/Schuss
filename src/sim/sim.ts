import { Terrain } from './terrain';
import { SkierInput, SkierState, createSkier, stepSkier } from './skier';

// Fixed timestep: the simulation only ever advances in SIM_DT increments, so a
// given seed plus a given input sequence always produces the same run.
export const SIM_DT = 1 / 120;

export interface Sim {
  terrain: Terrain;
  skier: SkierState;
  time: number;
}

export function createSim(seed: number): Sim {
  const terrain = new Terrain(seed);
  const skier = createSkier();
  skier.y = terrain.height(skier.x, skier.z);
  return { terrain, skier, time: 0 };
}

export function stepSim(sim: Sim, input: SkierInput): void {
  stepSkier(sim.skier, sim.terrain, input, SIM_DT);
  sim.time += SIM_DT;
}

export function distanceSkied(sim: Sim): number {
  return Math.max(0, -sim.skier.z);
}
